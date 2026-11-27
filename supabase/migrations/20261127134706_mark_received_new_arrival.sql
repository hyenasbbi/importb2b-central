CREATE OR REPLACE FUNCTION public.importb2b_receive_order_allocation(p_allocation_id uuid, p_receive_quantity numeric, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare uid uuid:=auth.uid();a public.importb2b_order_item_allocations;i public.importb2b_order_items;
  remaining numeric;item_received numeric;item_status text;order_received numeric;order_total numeric;order_status text;cost numeric;
begin
  if uid is null then raise exception 'No autenticado'; end if;
  if p_receive_quantity<=0 then raise exception 'La cantidad recibida debe ser mayor a 0'; end if;
  select * into a from public.importb2b_order_item_allocations where id=p_allocation_id and owner_id=uid for update;
  if a.id is null then raise exception 'Distribución no encontrada'; end if;
  select * into i from public.importb2b_order_items where id=a.order_item_id for update;
  remaining:=a.ordered_quantity-a.received_quantity;
  if p_receive_quantity>remaining then raise exception 'Solo quedan % unidades por recibir en esta variante',remaining; end if;
  cost:=coalesce(a.unit_cost_ars,i.cost_ars);

  insert into public.importb2b_inventory_movements(owner_id,product_id,variant_id,bucket,movement_type,quantity_delta,unit_cost_ars,reference_type,reference_id,note,created_by)
  values(uid,a.product_id,a.variant_id,'in_transit','purchase_receipt',-p_receive_quantity,cost,'order_allocation',a.id::text,'Salida de tránsito por recepción',uid);
  insert into public.importb2b_inventory_movements(owner_id,product_id,variant_id,bucket,movement_type,quantity_delta,unit_cost_ars,reference_type,reference_id,note,created_by)
  values(uid,a.product_id,a.variant_id,'on_hand','purchase_receipt',p_receive_quantity,cost,'order_allocation',a.id::text,coalesce(nullif(trim(p_note),''),'Recepción desde Pedido #'||i.order_id::text),uid);

  update public.importb2b_order_item_allocations set received_quantity=received_quantity+p_receive_quantity,updated_at=now() where id=a.id;
  select coalesce(sum(received_quantity),0) into item_received from public.importb2b_order_item_allocations where order_item_id=a.order_item_id;
  item_status:=case when item_received>=i.quantity then 'received' when item_received>0 then 'partial_received' else 'allocated' end;
  update public.importb2b_order_items set received_quantity=item_received,stock_link_status=item_status,updated_at=now() where id=a.order_item_id;
  if cost is not null then update public.importb2b_product_variants set cost_ars=cost,updated_at=now() where id=a.variant_id; end if;

  select coalesce(sum(received_quantity),0),coalesce(sum(quantity),0) into order_received,order_total from public.importb2b_order_items where order_id=i.order_id;
  order_status:=case when order_total>0 and order_received>=order_total then 'received' when order_received>0 then 'receiving' else 'picked_up' end;
  update public.importb2b_orders set purchase_status=order_status,updated_at=now() where id=i.order_id and owner_id=uid;
  update public.importb2b_products set new_arrival=true where id=a.product_id and owner_id=a.owner_id;
  return jsonb_build_object('allocation_id',a.id,'received',p_receive_quantity,'item_received_total',item_received,'item_status',item_status,'order_received_total',order_received,'order_total',order_total,'order_status',order_status);
end;$function$
