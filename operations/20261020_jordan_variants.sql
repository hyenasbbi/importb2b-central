-- Authorized Jordan update, 2026-10-20. One-time operation, not a schema migration.
-- Existing variants and sale items are never deleted or reassigned.
begin;
set local lock_timeout='5s';
lock table public.importb2b_products, public.importb2b_product_variants,
  public.importb2b_inventory_movements in share row exclusive mode;
lock table public.importb2b_sale_items in share mode;
do $operation$
declare
  owner uuid;
  product_row record;
  v public.importb2b_product_variants%rowtype;
  size text;
  physical numeric;
  reserved_qty numeric;
  sales_before text;
  names text[] := array['Jordan AZUL MARINO','Jordan CELESTE',
    'Jordan BLANCO NEGRO ROJO','Jordan BLANCO VERDE','Jordan VERDE AGUA / NEGRO / ROJO'];
begin
  select owner_id into strict owner from public.importb2b_catalog_settings
    where public_slug='importb2b' and is_public;
  if exists(select 1 from public.importb2b_inventory_movements
    where reference_type='jordan_variants_20261020' and owner_id=owner) then
    raise exception 'Operation already applied: do not replenish sold stock by rerunning';
  end if;
  if (select count(*) from public.importb2b_products
    where owner_id=owner and category='Shores Importados' and name=any(names))<>5
    or (select count(*) from public.importb2b_products
    where owner_id=owner and category='Shores Importados' and name ilike '%jordan%')<>5 then
    raise exception 'Jordan product set changed; review records';
  end if;
  if exists(select 1 from public.importb2b_product_variants pv
    join public.importb2b_products p on p.id=pv.product_id
    where p.owner_id=owner and p.category='Shores Importados' and p.name=any(names)
    and pv.variant_name not in ('L','XL')) then
    raise exception 'Unexpected existing variant; review without deleting historical records';
  end if;
  select md5(coalesce(jsonb_agg(to_jsonb(si) order by si.id)::text,'[]'))
    into sales_before from public.importb2b_sale_items si;
  for product_row in select * from public.importb2b_products
    where owner_id=owner and category='Shores Importados' and name=any(names)
    order by id
  loop
    update public.importb2b_products set subcategory='Jordan Dri Fit',
      active=true,catalog_visible=true where id=product_row.id
      and (subcategory is distinct from 'Jordan Dri Fit' or not active or not catalog_visible);
    foreach size in array array['L','XL'] loop
      if (select count(*) from public.importb2b_product_variants
        where product_id=product_row.id and upper(btrim(variant_name))=size)>1 then
        raise exception 'Duplicate size for %',product_row.name;
      end if;
      select * into v from public.importb2b_product_variants
        where product_id=product_row.id and upper(btrim(variant_name))=size;
      if not found then
        insert into public.importb2b_product_variants
          (owner_id,product_id,variant_name,sku,cost_ars,price_ars,sale_price_ars,stock_min,attributes)
          values(owner,product_row.id,size,null,25000,45000,35000,0,jsonb_build_object('opcion',size))
          returning * into v;
      else
        update public.importb2b_product_variants set variant_name=size,sku=null,
          cost_ars=25000,price_ars=45000,sale_price_ars=35000,stock_min=0,active=true
          where id=v.id and (variant_name,sku,cost_ars,price_ars,sale_price_ars,stock_min,active)
          is distinct from (size,null::text,25000::numeric,45000::numeric,35000::numeric,0::numeric,true);
      end if;
      select on_hand,reserved into strict physical,reserved_qty
        from public.importb2b_stock_summary where variant_id=v.id;
      if physical not in (0,1) or reserved_qty<>0 then
        raise exception 'Unexpected stock for % %',product_row.name,size;
      end if;
      if physical=0 then
        insert into public.importb2b_inventory_movements
          (owner_id,product_id,variant_id,bucket,movement_type,quantity_delta,
           unit_cost_ars,reference_type,reference_id,note)
        values(owner,product_row.id,v.id,'on_hand','adjustment',1,25000,
          'jordan_variants_20261020',v.id::text,
          'Autorizado por usuario: stock fisico de 0 a 1 por talle Jordan L/XL; chat 6ac9776d-e58c-83ea-8e4f-909cc919498a. Ejecutado via SQL administrativo.');
      end if;
    end loop;
  end loop;
  if sales_before is distinct from (select md5(coalesce(jsonb_agg(to_jsonb(si) order by si.id)::text,'[]'))
    from public.importb2b_sale_items si) then
    raise exception 'Historical sale items changed';
  end if;
  if (select count(*) from public.importb2b_product_variants pv
    join public.importb2b_products p on p.id=pv.product_id
    join public.importb2b_stock_summary s on s.variant_id=pv.id
    where p.owner_id=owner and p.category='Shores Importados' and p.name=any(names)
    and p.subcategory='Jordan Dri Fit' and p.active and p.catalog_visible
    and pv.variant_name in ('L','XL') and pv.active and pv.sku is null
    and pv.cost_ars=25000 and pv.price_ars=45000 and pv.sale_price_ars=35000
    and pv.stock_min=0 and s.on_hand=1 and s.available=1)<>10 then
    raise exception 'Final verification failed';
  end if;
end;
$operation$;
commit;
