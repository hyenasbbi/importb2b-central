-- Atomic bulk retail offers. Existing row-level permissions remain in force.
create or replace function public.importb2b_bulk_catalog_discount(
  p_product_ids uuid[], p_percent numeric, p_expected jsonb
) returns jsonb language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  ids uuid[]; actual jsonb; affected integer; product_count integer;
begin
  if auth.uid() is null then raise exception 'Iniciá sesión para modificar ofertas'; end if;
  select array_agg(distinct x order by x) into ids from unnest(p_product_ids) x where x is not null;
  if coalesce(cardinality(ids),0)=0 or cardinality(ids)>2000 then raise exception 'Seleccioná entre 1 y 2000 productos'; end if;
  if p_percent is not null and (p_percent::text in ('NaN','Infinity','-Infinity') or p_percent<=0 or p_percent>=100) then
    raise exception 'El descuento debe ser mayor a 0 y menor a 100';
  end if;
  if jsonb_typeof(p_expected) is distinct from 'array' then raise exception 'Falta la vista previa de precios'; end if;
  perform id from public.importb2b_products where id=any(ids) and active order by id for update;
  select count(*) into product_count from public.importb2b_products where id=any(ids) and active;
  if product_count<>cardinality(ids) then raise exception 'Hay productos no disponibles o sin permiso'; end if;
  perform id from public.importb2b_product_variants where product_id=any(ids) and active order by id for update;
  if exists(select 1 from unnest(ids) x where not exists(select 1 from public.importb2b_product_variants v where v.product_id=x and v.active)) then
    raise exception 'Hay productos sin variantes activas';
  end if;
  select jsonb_agg(jsonb_build_object('id',id,'price',price_ars,'sale',sale_price_ars) order by id) into actual
    from public.importb2b_product_variants where product_id=any(ids) and active;
  if actual is distinct from (select jsonb_agg(e order by (e->>'id')::uuid) from jsonb_array_elements(p_expected) e) then
    raise exception 'Los precios o variantes cambiaron. Recargá los productos y revisá la vista previa';
  end if;
  if p_percent is not null and exists(select 1 from public.importb2b_product_variants where product_id=any(ids) and active and
    (price_ars is null or price_ars<=0 or price_ars::text in ('NaN','Infinity','-Infinity') or round(price_ars*(1-p_percent/100),2)<=0 or round(price_ars*(1-p_percent/100),2)>=price_ars)) then
    raise exception 'Revisá los precios normales: la oferta debe ser mayor a cero y menor al precio normal';
  end if;
  update public.importb2b_product_variants set sale_price_ars=case when p_percent is null then null else round(price_ars*(1-p_percent/100),2) end
    where product_id=any(ids) and active;
  get diagnostics affected=row_count;
  if affected<>jsonb_array_length(actual) then raise exception 'No se pudieron actualizar todas las variantes'; end if;
  return jsonb_build_object('products',product_count,'variants',affected,'percent',p_percent);
end $$;
revoke all on function public.importb2b_bulk_catalog_discount(uuid[],numeric,jsonb) from public, anon;
grant execute on function public.importb2b_bulk_catalog_discount(uuid[],numeric,jsonb) to authenticated;
