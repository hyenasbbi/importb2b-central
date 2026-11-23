-- Correct a new purchase variant without duplicating stock or changing receipts.
create or replace function public.importb2b_correct_purchase_product(
 p_item_id bigint, p_expected_variant_id uuid, p_expected_updated_at timestamptz,
 p_name text, p_variant_name text, p_category text, p_sleeve_type text
) returns uuid language plpgsql security invoker set search_path='' as $$
declare
 i public.importb2b_order_items;
 a public.importb2b_order_item_allocations;
 v public.importb2b_product_variants;
 p public.importb2b_products;
 target_id uuid;
begin
 if auth.uid() is null then raise exception 'No autenticado'; end if;
 if nullif(trim(p_name),'') is null or nullif(trim(p_variant_name),'') is null or nullif(trim(p_category),'') is null then
  raise exception 'Completá producto, variante y categoría';
 end if;
 if p_sleeve_type is not null and p_sleeve_type not in ('short','long') then raise exception 'Tipo de manga inválido'; end if;
 select * into i from public.importb2b_order_items where id=p_item_id for update;
 if i.id is null then raise exception 'Artículo no encontrado'; end if;
 if i.stock_link_status='historical' then raise exception 'La compra histórica se corrige desde Productos / Stock'; end if;
 if (select count(*) from public.importb2b_order_item_allocations where order_item_id=i.id)<>1 then
  raise exception 'Esta corrección requiere una única variante vinculada';
 end if;
 select * into a from public.importb2b_order_item_allocations where order_item_id=i.id for update;
 select * into v from public.importb2b_product_variants where id=a.variant_id for update;
 if v.id is null or v.id is distinct from p_expected_variant_id or v.updated_at is distinct from p_expected_updated_at then
  raise exception 'El producto cambió. Cerrá y volvé a abrir la corrección';
 end if;
 select * into p from public.importb2b_products where id=v.product_id for update;
 if p.id is null or p.owner_id<>i.owner_id or v.owner_id<>i.owner_id or a.owner_id<>i.owner_id then raise exception 'Producto no disponible'; end if;
 if v.source is distinct from 'purchase_order' then
  raise exception 'Esta variante ya existía. Editala desde Productos / Stock';
 end if;
 if exists(select 1 from public.importb2b_sale_items where variant_id=v.id)
 or exists(select 1 from public.importb2b_web_order_items where variant_id=v.id)
 or exists(select 1 from public.importb2b_order_items where variant_id=v.id and id<>i.id)
 or exists(select 1 from public.importb2b_order_item_allocations where variant_id=v.id and id<>a.id)
 or exists(select 1 from public.importb2b_inventory_movements where variant_id=v.id and
   (reference_type is distinct from 'order_allocation' or reference_id is distinct from a.id::text))
 then raise exception 'La variante tiene otras operaciones. Revisá su historial en Productos / Stock antes de corregirla'; end if;
 -- Reuse a product created solely for this variant; otherwise isolate it from the old product.
 if p.source in ('purchase_order','purchase_correction')
 and not exists(select 1 from public.importb2b_product_variants where product_id=p.id and id<>v.id) then
  target_id:=p.id;
  update public.importb2b_products set name=trim(p_name),category=trim(p_category),sleeve_type=p_sleeve_type,
   subcategory=case when category=trim(p_category) then subcategory else null end,updated_at=now() where id=target_id;
 else
  insert into public.importb2b_products(owner_id,name,category,sleeve_type,source,source_payload,active,catalog_visible)
  values(i.owner_id,trim(p_name),trim(p_category),p_sleeve_type,'purchase_correction',
   jsonb_build_object('order_item_id',i.id,'previous_product_id',p.id,'corrected_by',auth.uid()),true,true)
  returning id into target_id;
 end if;
 update public.importb2b_product_variants set product_id=target_id,variant_name=trim(p_variant_name),
  source_payload=coalesce(source_payload,'{}')||jsonb_build_object('previous_product_id',p.id,'corrected_by',auth.uid(),'corrected_at',now()),updated_at=now()
 where id=v.id;
 update public.importb2b_inventory_movements set product_id=target_id where variant_id=v.id;
 update public.importb2b_order_item_allocations set product_id=target_id where id=a.id;
 update public.importb2b_order_items set product_id=target_id,variant_id=v.id,product=trim(p_name),
  detail=trim(p_variant_name),category=trim(p_category),updated_at=now() where id=i.id;
 return target_id;
end;
$$;
revoke all on function public.importb2b_correct_purchase_product(bigint,uuid,timestamptz,text,text,text,text) from public,anon;
grant execute on function public.importb2b_correct_purchase_product(bigint,uuid,timestamptz,text,text,text,text) to authenticated;
