-- IMPORTB2B Central 6.5 — sincronización final con funciones aplicadas en producción.

alter table public.importb2b_orders
  add column if not exists finance_reference_id uuid not null default gen_random_uuid();
create unique index if not exists importb2b_orders_finance_reference_uidx
on public.importb2b_orders(owner_id,finance_reference_id);

create or replace function public.importb2b_register_purchase_payment(
  p_order_id bigint,p_amount_ars numeric,p_method text,p_holder text
) returns jsonb
language plpgsql security invoker set search_path=public as $$
declare uid uuid:=auth.uid();o public.importb2b_orders;mid uuid;method text:=lower(trim(p_method));holder text:=lower(trim(p_holder));
begin
  if uid is null then raise exception 'No autenticado'; end if;
  if coalesce(p_amount_ars,0)<=0 then raise exception 'Monto inválido'; end if;
  if method not in ('efectivo','transferencia') then raise exception 'Para compras en ARS usá efectivo o transferencia'; end if;
  if holder not in ('nahuel','esteban') then raise exception 'Elegí Nahuel o Esteban'; end if;
  select * into o from public.importb2b_orders where id=p_order_id and owner_id=uid for update;
  if o.id is null then raise exception 'Pedido no encontrado'; end if;
  if o.purchase_payment_movement_id is not null then raise exception 'Este pedido ya tiene un pago registrado'; end if;
  insert into public.movements(kind,amount,currency,payment_method,category,description,occurred_at,ars_equivalent,created_by,source_type,source_id,cash_holder,transfer_holder)
  values('expense',p_amount_ars,'ARS',method,'COMPRA','Compra / mercadería · Pedido #'||o.order_number,now(),p_amount_ars,uid,'purchase_order',o.finance_reference_id,case when method='efectivo' then holder end,case when method='transferencia' then holder end)
  returning id into mid;
  update public.importb2b_orders set purchase_payment_method=method,purchase_payment_holder=holder,purchase_payment_amount_ars=p_amount_ars,purchase_payment_movement_id=mid,purchase_paid_at=now(),updated_at=now() where id=o.id;
  insert into public.audit_log(entity_type,entity_id,action,actor_id,new_data) values('purchase_order',null,'UPDATE',uid,jsonb_build_object('order_id',o.id,'payment_movement_id',mid,'amount_ars',p_amount_ars,'method',method,'holder',holder));
  return jsonb_build_object('order_id',o.id,'movement_id',mid,'amount_ars',p_amount_ars,'method',method,'holder',holder);
end;$$;
grant execute on function public.importb2b_register_purchase_payment(bigint,numeric,text,text) to authenticated;

create or replace function public.importb2b_receive_order_allocation(p_allocation_id uuid,p_receive_quantity numeric,p_note text default null)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare
  uid uuid:=auth.uid();a public.importb2b_order_item_allocations;i public.importb2b_order_items;
  remaining numeric;item_received numeric;item_status text;order_received numeric;order_total numeric;order_status text;
begin
  if uid is null then raise exception 'No autenticado'; end if;
  if p_receive_quantity<=0 then raise exception 'La cantidad recibida debe ser mayor a 0'; end if;
  select * into a from public.importb2b_order_item_allocations where id=p_allocation_id and owner_id=uid for update;
  if a.id is null then raise exception 'Distribución no encontrada'; end if;
  select * into i from public.importb2b_order_items where id=a.order_item_id for update;
  remaining:=a.ordered_quantity-a.received_quantity;
  if p_receive_quantity>remaining then raise exception 'Solo quedan % unidades por recibir en esta variante',remaining; end if;

  insert into public.importb2b_inventory_movements(owner_id,product_id,variant_id,bucket,movement_type,quantity_delta,unit_cost_ars,reference_type,reference_id,note,created_by)
  values(uid,a.product_id,a.variant_id,'on_hand','purchase_receipt',p_receive_quantity,coalesce(a.unit_cost_ars,i.cost_ars),'order_allocation',a.id::text,coalesce(nullif(trim(p_note),''),'Recepción desde Pedido #'||i.order_id::text),uid);

  update public.importb2b_order_item_allocations set received_quantity=received_quantity+p_receive_quantity,updated_at=now() where id=a.id;
  select coalesce(sum(received_quantity),0) into item_received from public.importb2b_order_item_allocations where order_item_id=a.order_item_id;
  item_status:=case when item_received>=i.quantity then 'received' when item_received>0 then 'partial_received' else 'allocated' end;
  update public.importb2b_order_items set received_quantity=item_received,stock_link_status=item_status,updated_at=now() where id=a.order_item_id;
  if coalesce(a.unit_cost_ars,i.cost_ars) is not null then update public.importb2b_product_variants set cost_ars=coalesce(a.unit_cost_ars,i.cost_ars),updated_at=now() where id=a.variant_id; end if;

  select coalesce(sum(received_quantity),0),coalesce(sum(quantity),0) into order_received,order_total from public.importb2b_order_items where order_id=i.order_id;
  order_status:=case when order_total>0 and order_received>=order_total then 'received' when order_received>0 then 'receiving' else 'picked_up' end;
  update public.importb2b_orders set purchase_status=order_status,updated_at=now() where id=i.order_id and owner_id=uid;

  return jsonb_build_object('allocation_id',a.id,'received',p_receive_quantity,'item_received_total',item_received,'item_status',item_status,'order_received_total',order_received,'order_total',order_total,'order_status',order_status);
end;$$;
grant execute on function public.importb2b_receive_order_allocation(uuid,numeric,text) to authenticated;

create or replace function public.importb2b_sync_order_status_from_shipment()
returns trigger language plpgsql set search_path=public as $$
declare next_status text;
begin
  next_status:=case
    when new.is_received or new.normalized_status='RECEIVED' then 'picked_up'
    when new.normalized_status='READY_FOR_PICKUP' then 'ready_for_pickup'
    when new.normalized_status in ('CARRIER_RECEIVED','IN_TRANSIT','ARRIVED_AT_DISTRIBUTION_CENTER') then 'in_transit'
    else null
  end;
  if next_status is not null then
    update public.importb2b_orders
    set purchase_status=case when purchase_status in ('received','receiving','cancelled') then purchase_status else next_status end,
        updated_at=now()
    where id=new.order_id and owner_id=new.owner_id;
  end if;
  return new;
end;$$;
drop trigger if exists importb2b_shipments_sync_order_status_trg on public.importb2b_shipments;
create trigger importb2b_shipments_sync_order_status_trg
after insert or update of normalized_status,is_received on public.importb2b_shipments
for each row execute function public.importb2b_sync_order_status_from_shipment();
