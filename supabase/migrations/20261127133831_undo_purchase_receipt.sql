create or replace function public.importb2b_undo_purchase_receipt(p_allocation_id uuid) returns void language plpgsql security invoker set search_path='' as $$
declare a public.importb2b_order_item_allocations; i public.importb2b_order_items; available numeric; n numeric;
begin
 if auth.uid() is null then raise exception 'No autenticado'; end if;
 select * into a from public.importb2b_order_item_allocations where id=p_allocation_id and owner_id=auth.uid() for update;
 if a.id is null or a.received_quantity<=0 then raise exception 'La recepción ya está pendiente'; end if;
 select * into i from public.importb2b_order_items where id=a.order_item_id for update;
 perform 1 from public.importb2b_product_variants where id=a.variant_id for update;
 select s.available into available from public.importb2b_stock_summary s where s.variant_id=a.variant_id;
 if coalesce(available,0)<a.received_quantity then raise exception 'No se puede desmarcar: hay unidades vendidas, reservadas o no disponibles'; end if;
 if exists(select 1 from public.importb2b_inventory_movements m where m.variant_id=a.variant_id and m.quantity_delta<0 and m.bucket='on_hand' and m.reference_type is distinct from 'receipt_reversal' and m.occurred_at>=(select min(created_at) from public.importb2b_inventory_movements where reference_id=a.id::text and movement_type='purchase_receipt')) then raise exception 'Esta variante tuvo salidas posteriores. Revisá su historial antes de revertir'; end if;
 insert into public.importb2b_inventory_movements(owner_id,product_id,variant_id,bucket,movement_type,quantity_delta,unit_cost_ars,reference_type,reference_id,note,created_by)
 values(a.owner_id,a.product_id,a.variant_id,'on_hand','adjustment',-a.received_quantity,a.unit_cost_ars,'receipt_reversal',a.id::text,'Recepción desmarcada',auth.uid()),
 (a.owner_id,a.product_id,a.variant_id,'in_transit','adjustment',a.received_quantity,a.unit_cost_ars,'receipt_reversal',a.id::text,'Recepción desmarcada: vuelve a tránsito',auth.uid());
 update public.importb2b_order_item_allocations set received_quantity=0 where id=a.id;
 select coalesce(sum(received_quantity),0) into n from public.importb2b_order_item_allocations where order_item_id=i.id;
 update public.importb2b_order_items set received_quantity=n,stock_link_status=case when n>=quantity then 'received' when n>0 then 'partial_received' else 'allocated' end where id=i.id;
 update public.importb2b_orders set purchase_status=case when exists(select 1 from public.importb2b_order_items where order_id=i.order_id and received_quantity>0) then 'receiving' else 'picked_up' end where id=i.order_id;
end; $$;
revoke all on function public.importb2b_undo_purchase_receipt(uuid) from public,anon;
grant execute on function public.importb2b_undo_purchase_receipt(uuid) to authenticated;
