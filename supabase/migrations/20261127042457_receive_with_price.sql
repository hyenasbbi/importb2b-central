create or replace function public.importb2b_receive_with_price(p_allocation_id uuid,p_quantity numeric,p_price numeric,p_note text default null) returns jsonb language plpgsql security invoker set search_path='' as $$
declare a public.importb2b_order_item_allocations; r jsonb;
begin
 if auth.uid() is null then raise exception 'No autenticado'; end if;
 if p_price is null or p_price<=0 or p_price::text in ('NaN','Infinity','-Infinity') then raise exception 'Ingresá un precio válido'; end if;
 if p_quantity is null or p_quantity<=0 or p_quantity::text in ('NaN','Infinity','-Infinity') then raise exception 'Cantidad inválida'; end if;
 select * into a from public.importb2b_order_item_allocations where id=p_allocation_id and owner_id=auth.uid() for update;
 if a.id is null then raise exception 'Distribución no encontrada'; end if;
 r:=public.importb2b_receive_order_allocation(p_allocation_id,p_quantity,p_note);
 update public.importb2b_product_variants set price_ars=p_price where id=a.variant_id and owner_id=a.owner_id;
 if not found then raise exception 'Variante no encontrada'; end if;
 return r;
end; $$;
revoke all on function public.importb2b_receive_with_price(uuid,numeric,numeric,text) from public,anon;
grant execute on function public.importb2b_receive_with_price(uuid,numeric,numeric,text) to authenticated;
