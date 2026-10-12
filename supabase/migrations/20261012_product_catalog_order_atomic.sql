-- Atomic product ordering within one category, scoped to the authenticated owner.
create or replace function public.importb2b_set_product_order(p_ids uuid[], p_category text)
returns void language plpgsql security invoker set search_path=public as $$
declare v_owner uuid:=auth.uid(); v_count integer;
begin
 if v_owner is null then raise exception 'Sesión no válida'; end if;
 perform 1 from public.importb2b_products where owner_id=v_owner and category=p_category and active=true order by id for update;
 select count(*) into v_count from public.importb2b_products where owner_id=v_owner and category=p_category and active=true;
 if p_ids is null or cardinality(p_ids)<>v_count
 or (select count(distinct id) from unnest(p_ids) t(id))<>v_count
 or exists(select 1 from unnest(p_ids) t(id) where not exists(select 1 from public.importb2b_products p where p.id=t.id and p.owner_id=v_owner and p.category=p_category and p.active=true))
 then raise exception 'La lista de productos cambió. Actualizá la vista e intentá nuevamente.'; end if;
 update public.importb2b_products p set catalog_priority=o.position::integer
 from unnest(p_ids) with ordinality o(id,position)
 where p.id=o.id and p.owner_id=v_owner;
end; $$;
revoke all on function public.importb2b_set_product_order(uuid[],text) from public,anon;
grant execute on function public.importb2b_set_product_order(uuid[],text) to authenticated;
