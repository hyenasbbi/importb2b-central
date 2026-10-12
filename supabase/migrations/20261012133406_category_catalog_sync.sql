CREATE OR REPLACE FUNCTION public.importb2b_public_catalog_safe(p_slug text DEFAULT 'importb2b'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  cfg public.importb2b_catalog_settings;
  v_products jsonb;
  v_methods jsonb;
  v_categories jsonb;
begin
  select * into cfg
  from public.importb2b_catalog_settings
  where public_slug=lower(trim(p_slug)) and is_public=true
  limit 1;

  if cfg.owner_id is null then
    return jsonb_build_object('error','Catálogo no disponible');
  end if;

  select coalesce(
    jsonb_agg(
      row_data
      order by
        coalesce((row_data->>'catalog_priority')::int,100) asc,
        (row_data->>'created_at')::timestamptz desc,
        row_data->>'name'
    ),
    '[]'::jsonb
  )
  into v_products
  from (
    select jsonb_build_object(
      'id',p.id,
      'name',p.name,
      'category',p.category,
      'sleeve_type',p.sleeve_type,
      'description',p.description,
      'created_at',p.created_at,
      'new_arrival',p.new_arrival,
      'featured',p.featured,
      'catalog_priority',p.catalog_priority,
      'image_url',coalesce(
        p.primary_image_url,
        (
          select pi.image_url
          from public.importb2b_product_images pi
          where pi.product_id=p.id and pi.image_url is not null
          order by pi.is_primary desc,pi.sort_order,pi.created_at
          limit 1
        )
      ),
      'thumbnail_url',(
        select coalesce(pi.thumbnail_url,pi.image_url)
        from public.importb2b_product_images pi
        where pi.product_id=p.id and pi.image_url is not null
        order by pi.is_primary desc,pi.sort_order,pi.created_at
        limit 1
      ),
      'images',coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id',pi.id,
            'image_url',pi.image_url,
            'is_primary',pi.is_primary,
            'sort_order',pi.sort_order
          )
          order by pi.sort_order,pi.created_at
        )
        from public.importb2b_product_images pi
        where pi.product_id=p.id and pi.image_url is not null
      ),'[]'::jsonb),
      'variants',coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id',v.id,
            'name',v.variant_name,
            'sku',v.sku,
            'price_ars',v.price_ars,
            'sale_price_ars',v.sale_price_ars,
            'in_stock',coalesce(s.available,0)>0,
            'available',case
              when cfg.show_exact_stock then greatest(coalesce(s.available,0),0)
              else case when coalesce(s.available,0)>0 then 1 else 0 end
            end,
            'attributes',coalesce(v.attributes,'{}'::jsonb)
          )
          order by v.variant_name
        )
        from public.importb2b_product_variants v
        left join public.importb2b_stock_summary s on s.variant_id=v.id
        where v.product_id=p.id
          and v.active=true
          and (cfg.show_out_of_stock or coalesce(s.available,0)>0)
      ),'[]'::jsonb)
    ) row_data
    from public.importb2b_products p
    where p.owner_id=cfg.owner_id
      and p.active=true
      and p.catalog_visible=true
      and exists (select 1 from public.importb2b_categories c where c.owner_id=cfg.owner_id and c.name=p.category and c.active=true)
  ) x
  where jsonb_array_length(x.row_data->'variants')>0;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id',m.id,
        'code',m.code,
        'name',m.name,
        'adjustment_kind',m.adjustment_kind,
        'adjustment_direction',m.adjustment_direction,
        'adjustment_value',m.adjustment_value
      )
      order by m.sort_order,m.name
    ),
    '[]'::jsonb
  )
  into v_methods
  from public.importb2b_payment_methods m
  where m.owner_id=cfg.owner_id
    and m.active=true
    and (m.code<>'pay_later' or cfg.allow_pay_later_public=true);

  select coalesce(jsonb_agg(jsonb_build_object('name',c.name,'sort_order',c.sort_order,'active',c.active) order by c.sort_order,c.name),'[]'::jsonb)
  into v_categories from public.importb2b_categories c where c.owner_id=cfg.owner_id;

  return jsonb_build_object(
    'categories',v_categories,
    'settings',jsonb_build_object(
      'slug',cfg.public_slug,
      'title',cfg.catalog_title,
      'subtitle',cfg.catalog_subtitle,
      'whatsapp_number',cfg.whatsapp_number,
      'show_exact_stock',cfg.show_exact_stock,
      'show_out_of_stock',cfg.show_out_of_stock,
      'allow_pickup',cfg.allow_pickup,
      'allow_shipping',cfg.allow_shipping,
      'pickup_label',cfg.pickup_label,
      'shipping_label',cfg.shipping_label,
      'shipping_note',cfg.shipping_note,
      'shipping_fee_ars',cfg.shipping_fee_ars,
      'min_order_ars',cfg.min_order_ars
    ),
    'payment_methods',v_methods,
    'products',v_products
  );
end;
$function$
;
create or replace function public.importb2b_set_category_order(p_ids uuid[])
returns void language plpgsql security invoker set search_path=public as $$
declare v_owner uuid := auth.uid(); v_count integer;
begin
  if v_owner is null then raise exception 'Sesión no válida'; end if;
  perform 1 from public.importb2b_categories where owner_id=v_owner order by id for update;
  select count(*) into v_count from public.importb2b_categories where owner_id=v_owner;
  if p_ids is null or cardinality(p_ids)<>v_count
    or (select count(distinct id) from unnest(p_ids) id)<>v_count
    or exists(select 1 from unnest(p_ids) u(id) where not exists(select 1 from public.importb2b_categories c where c.id=u.id and c.owner_id=v_owner))
  then raise exception 'La lista de categorías cambió. Volvé a abrir Categorías.'; end if;
  update public.importb2b_categories c set sort_order=o.position::integer
  from unnest(p_ids) with ordinality o(id,position)
  where c.id=o.id and c.owner_id=v_owner;
end; $$;
revoke all on function public.importb2b_set_category_order(uuid[]) from public,anon;
grant execute on function public.importb2b_set_category_order(uuid[]) to authenticated;
