create schema if not exists importb2b_private;
revoke all on schema importb2b_private from public,anon,authenticated;
create table if not exists importb2b_private.notification_outbox(
 id uuid primary key default gen_random_uuid(), event_key text not null,
 owner_id uuid not null references public.profiles(id),notification_id uuid,
 title text not null,body text not null,data jsonb not null default '{}',
 state text not null default 'pending',attempts integer not null default 0,
 delivered_device_ids bigint[] not null default '{}',
 available_at timestamptz not null default now(),last_error text,created_at timestamptz not null default now(),
 unique(event_key,owner_id));
alter table importb2b_private.notification_outbox enable row level security;
revoke all on importb2b_private.notification_outbox from public,anon,authenticated;
create or replace function importb2b_private.wake_notifications()
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare secret text;
begin
 select decrypted_secret into secret from vault.decrypted_secrets where name='importb2b_summary_cron_secret' limit 1;
 if secret is not null then
  perform net.http_post(url:='https://jgjvzqfxakvogaeqfual.supabase.co/functions/v1/importb2b-operational-notifications',
   body:='{}'::jsonb,headers:=jsonb_build_object('Content-Type','application/json','x-cron-secret',secret),
   timeout_milliseconds:=60000);
 end if;
exception when others then raise warning 'Push wake deferred to scheduled worker';
end $$;
revoke all on function importb2b_private.wake_notifications() from public,anon,authenticated;

create or replace function importb2b_private.enqueue_admin_notice(k text,t text,b text,d jsonb)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare a record; q uuid; n uuid; created_any boolean:=false;
begin
 for a in select id from public.profiles where role='admin' loop
  q:=null;
  insert into importb2b_private.notification_outbox(event_key,owner_id,title,body,data)
   values(k,a.id,t,b,d) on conflict(event_key,owner_id) do nothing returning id into q;
  if q is not null then
   created_any:=true;
   insert into public.notifications(owner_id,type,title,body,data)
   values(a.id,d->>'type',t,b,d) returning id into n;
   update importb2b_private.notification_outbox set notification_id=n where id=q;
  end if;
 end loop;
 perform importb2b_private.wake_notifications();
end $$;
revoke all on function importb2b_private.enqueue_admin_notice(text,text,text,jsonb) from public,anon,authenticated;
create or replace function importb2b_private.order_notice()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 perform importb2b_private.enqueue_admin_notice('web:new:'||new.id,
  'Nuevo pedido '||new.order_code,
  new.customer_name||' · $ '||new.total_ars::text||' · Pendiente de confirmar',
  jsonb_build_object('type','web_order_new','order_id',new.id,'url','/?view=orders&tab=web&order='||new.id));
 return new;
end $$;
revoke all on function importb2b_private.order_notice() from public,anon,authenticated;
create trigger importb2b_web_order_notice after insert on public.importb2b_web_orders
for each row execute function importb2b_private.order_notice();
create or replace function importb2b_private.tracking_notice()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 perform importb2b_private.enqueue_admin_notice('tracking:'||new.shipment_id||':'||new.provider_event_id,
  case when new.normalized_status='READY_FOR_PICKUP' then 'Vía Cargo · Listo para retirar' else 'Vía Cargo · Nuevo movimiento' end,
  coalesce(new.description_original,'Actualización del envío')||coalesce(' · '||new.location_original,''),
  jsonb_build_object('type','tracking_update','shipment_id',new.shipment_id,'event_id',new.id,
   'url','/?view=orders&tab=tracking&shipment='||new.shipment_id));
 return new;
end $$;
revoke all on function importb2b_private.tracking_notice() from public,anon,authenticated;
create trigger importb2b_tracking_event_notice after insert on public.importb2b_tracking_events
for each row execute function importb2b_private.tracking_notice();

create or replace function public.importb2b_claim_operational_notifications()
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare o record; jobs jsonb;
begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Forbidden'; end if;
 for o in select * from public.importb2b_web_orders where status in ('pending','accepted')
   and sale_id is null and created_at<=now()-interval '24 hours' loop
  perform importb2b_private.enqueue_admin_notice('web:24h:'||o.id,
   'Seguimiento pendiente · '||o.order_code,
   o.customer_name||' · Más de 24 horas sin confirmar la venta',
   jsonb_build_object('type','web_order_followup','order_id',o.id,'url','/?view=orders&tab=web&order='||o.id));
 end loop;
 with selected as (
  select id from importb2b_private.notification_outbox
  where state in ('pending','retry') and available_at<=now() and attempts<5
  order by created_at for update skip locked limit 15
 ), claimed as (
  update importb2b_private.notification_outbox q set attempts=q.attempts+1,
   state='retry',available_at=now()+interval '5 minutes'
  from selected s where q.id=s.id returning q.*
 )
 select coalesce(jsonb_agg(to_jsonb(c)),'[]') into jobs from claimed c;
 return jobs;
end $$;
revoke all on function public.importb2b_claim_operational_notifications() from public,anon,authenticated;
grant execute on function public.importb2b_claim_operational_notifications() to service_role;
create or replace function public.importb2b_finish_operational_notification(p_id uuid,p_ok boolean,p_error text default null,p_device_ids bigint[] default '{}')
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Forbidden'; end if;
 update importb2b_private.notification_outbox set
 state=case when p_ok then 'sent' when attempts>=5 then 'failed' else 'retry' end,
 available_at=now()+interval '5 minutes',last_error=left(p_error,250),
 delivered_device_ids=array(select distinct unnest(delivered_device_ids||p_device_ids)) where id=p_id;
end $$;
revoke all on function public.importb2b_finish_operational_notification(uuid,boolean,text,bigint[]) from public,anon,authenticated;
grant execute on function public.importb2b_finish_operational_notification(uuid,boolean,text,bigint[]) to service_role;

alter table public.importb2b_web_orders add column if not exists accepted_at timestamptz;
alter table public.importb2b_web_orders add column if not exists delivered_at timestamptz;
alter table public.importb2b_web_orders drop constraint importb2b_web_orders_status_check;
alter table public.importb2b_web_orders add constraint importb2b_web_orders_status_check
 check(status in ('pending','accepted','confirmed','cancelled','completed'));
create or replace function public.importb2b_accept_web_order(p_order_id uuid)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare o public.importb2b_web_orders; i record; held numeric; av numeric; actor uuid:=auth.uid();
begin
 if actor is null or not exists(select 1 from public.profiles where id=actor and role='admin') then raise exception 'No autorizado'; end if;
 select * into o from public.importb2b_web_orders where id=p_order_id for update;
 if o.id is null then raise exception 'Pedido no encontrado'; end if;
 if o.status='accepted' then return jsonb_build_object('status','accepted','order_id',o.id); end if;
 if o.status<>'pending' then raise exception 'El pedido ya fue procesado'; end if;
 for i in select wi.*,v.cost_ars from public.importb2b_web_order_items wi
   join public.importb2b_product_variants v on v.id=wi.variant_id where wi.order_id=o.id order by wi.variant_id loop
  perform 1 from public.importb2b_product_variants where id=i.variant_id for update;
  select coalesce(sum(quantity_delta),0) into held from public.importb2b_inventory_movements
   where variant_id=i.variant_id and reference_id=o.id::text and bucket='reserved';
  if held<0 or held>i.quantity then raise exception 'Reserva inconsistente'; end if;
  select available into av from public.importb2b_stock_summary where variant_id=i.variant_id;
  if av<i.quantity-held then raise exception 'Stock insuficiente para %',i.product_name; end if;
  if held<i.quantity then
   insert into public.importb2b_inventory_movements(owner_id,product_id,variant_id,bucket,movement_type,
    quantity_delta,unit_cost_ars,reference_type,reference_id,note,created_by)
   values(o.owner_id,i.product_id,i.variant_id,'reserved','reservation',i.quantity-held,i.cost_ars,
    'web_order',o.id::text,'Confirmación de pedido '||o.order_code,actor);
  end if;
 end loop;
 update public.importb2b_web_orders set status='accepted',accepted_at=now() where id=o.id;
 return jsonb_build_object('status','accepted','order_id',o.id);
end $$;
revoke all on function public.importb2b_accept_web_order(uuid) from public,anon;
grant execute on function public.importb2b_accept_web_order(uuid) to authenticated;

create or replace function public.importb2b_deliver_web_order(p_order_id uuid)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
begin
 if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid() and role='admin') then raise exception 'No autorizado'; end if;
 update public.importb2b_web_orders set delivered_at=coalesce(delivered_at,now()),status='completed'
 where id=p_order_id and status in ('confirmed','completed') and sale_id is not null;
 if not found then raise exception 'Primero confirmá la venta'; end if;
 return jsonb_build_object('status','completed','order_id',p_order_id);
end $$;
revoke all on function public.importb2b_deliver_web_order(uuid) from public,anon;
grant execute on function public.importb2b_deliver_web_order(uuid) to authenticated;

CREATE OR REPLACE FUNCTION public.importb2b_create_web_order_safe(p_slug text, p_customer_name text, p_customer_phone text, p_customer_email text, p_delivery_type text, p_delivery_address text, p_payment_code text, p_items jsonb, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  cfg public.importb2b_catalog_settings;
  pm public.importb2b_payment_methods;
  x record;
  v_variant public.importb2b_product_variants;
  v_product public.importb2b_products;
  v_available numeric;
  v_unit_price numeric;
  v_subtotal numeric:=0;
  v_shipping numeric:=0;
  v_adjustment numeric:=0;
  v_total numeric:=0;
  v_order_id uuid;
  v_order_code text;
  v_name text:=left(trim(coalesce(p_customer_name,'')),120);
  v_phone text:=left(regexp_replace(coalesce(p_customer_phone,''),'\D','','g'),24);
  v_email text:=nullif(left(lower(trim(coalesce(p_customer_email,''))),160),'');
  v_address text:=nullif(left(trim(coalesce(p_delivery_address,'')),300),'');
  v_notes text:=nullif(left(trim(coalesce(p_notes,'')),500),'');
begin
  select * into cfg
  from public.importb2b_catalog_settings
  where public_slug=lower(trim(coalesce(p_slug,'importb2b'))) and is_public=true
  limit 1;
  if cfg.owner_id is null then raise exception 'Catálogo no disponible'; end if;

  if v_name='' or length(v_phone)<6 then raise exception 'Nombre y teléfono son obligatorios'; end if;
  if p_delivery_type not in ('pickup','shipping') then raise exception 'Entrega inválida'; end if;
  if p_delivery_type='pickup' and not cfg.allow_pickup then raise exception 'Retiro no disponible'; end if;
  if p_delivery_type='shipping' and not cfg.allow_shipping then raise exception 'Envío no disponible'; end if;
  if p_delivery_type='shipping' and v_address is null then raise exception 'Ingresá la dirección de envío'; end if;
  if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then raise exception 'El carrito está vacío'; end if;
  if jsonb_array_length(p_items)>30 then raise exception 'Demasiados productos en el pedido'; end if;

  select * into pm
  from public.importb2b_payment_methods
  where owner_id=cfg.owner_id
    and code=trim(coalesce(p_payment_code,''))
    and active=true
    and (code<>'pay_later' or cfg.allow_pay_later_public=true)
  limit 1;
  if pm.id is null then raise exception 'Forma de pago no disponible'; end if;

  for x in
    select
      (e->>'variant_id')::uuid as variant_id,
      sum(greatest(0,least(20,coalesce(nullif(e->>'quantity','')::numeric,0)))) as quantity
    from jsonb_array_elements(p_items) e
    where coalesce(e->>'variant_id','')<>''
    group by (e->>'variant_id')::uuid
    order by (e->>'variant_id')::uuid
  loop
    if x.quantity<=0 then continue; end if;

    select * into v_variant
    from public.importb2b_product_variants
    where id=x.variant_id and owner_id=cfg.owner_id and active=true
    for update;
    if v_variant.id is null then raise exception 'Una variante ya no está disponible'; end if;

    select * into v_product
    from public.importb2b_products
    where id=v_variant.product_id and owner_id=cfg.owner_id and active=true and catalog_visible=true;
    if v_product.id is null then raise exception 'Un producto ya no está disponible'; end if;

    select
      coalesce(sum(quantity_delta) filter(where bucket='on_hand'),0)
      - coalesce(sum(quantity_delta) filter(where bucket='reserved'),0)
    into v_available
    from public.importb2b_inventory_movements
    where variant_id=v_variant.id;

    if v_available<x.quantity then
      raise exception 'Stock insuficiente para % / %. Disponible: %',v_product.name,v_variant.variant_name,v_available;
    end if;

    v_unit_price:=case
      when v_variant.sale_price_ars is not null
       and v_variant.sale_price_ars>0
       and v_variant.sale_price_ars<v_variant.price_ars
      then v_variant.sale_price_ars
      else coalesce(v_variant.price_ars,0)
    end;
    v_subtotal:=v_subtotal + x.quantity*v_unit_price;
  end loop;

  if v_subtotal<=0 then raise exception 'No hay productos válidos'; end if;
  if v_subtotal<cfg.min_order_ars then raise exception 'El pedido mínimo es %',cfg.min_order_ars; end if;

  v_shipping:=case when p_delivery_type='shipping' then cfg.shipping_fee_ars else 0 end;
  if pm.adjustment_kind='percent' then
    v_adjustment:=round((v_subtotal+v_shipping)*coalesce(pm.adjustment_value,0)/100.0,2);
  elsif pm.adjustment_kind='fixed' then
    v_adjustment:=coalesce(pm.adjustment_value,0);
  else
    v_adjustment:=0;
  end if;
  if pm.adjustment_direction='discount' then v_adjustment:=-abs(v_adjustment); else v_adjustment:=abs(v_adjustment); end if;
  v_total:=v_subtotal+v_shipping+v_adjustment;

  v_order_code:='WEB-'||lpad(nextval('public.importb2b_web_order_number_seq')::text,6,'0');

  insert into public.importb2b_web_orders(
    owner_id,order_code,status,customer_name,customer_phone,customer_email,
    delivery_type,delivery_address,notes,payment_method_id,
    subtotal_ars,shipping_ars,adjustment_ars,total_ars
  ) values (
    cfg.owner_id,v_order_code,'pending',v_name,v_phone,v_email,
    p_delivery_type,v_address,v_notes,pm.id,
    v_subtotal,v_shipping,v_adjustment,v_total
  ) returning id into v_order_id;

  for x in
    select
      (e->>'variant_id')::uuid as variant_id,
      sum(greatest(0,least(20,coalesce(nullif(e->>'quantity','')::numeric,0)))) as quantity
    from jsonb_array_elements(p_items) e
    where coalesce(e->>'variant_id','')<>''
    group by (e->>'variant_id')::uuid
    order by (e->>'variant_id')::uuid
  loop
    if x.quantity<=0 then continue; end if;

    select * into v_variant
    from public.importb2b_product_variants
    where id=x.variant_id and owner_id=cfg.owner_id and active=true;

    select * into v_product
    from public.importb2b_products
    where id=v_variant.product_id;

    v_unit_price:=case
      when v_variant.sale_price_ars is not null
       and v_variant.sale_price_ars>0
       and v_variant.sale_price_ars<v_variant.price_ars
      then v_variant.sale_price_ars
      else coalesce(v_variant.price_ars,0)
    end;

    insert into public.importb2b_web_order_items(
      owner_id,order_id,product_id,variant_id,product_name,variant_name,
      quantity,unit_price_ars,line_total_ars
    ) values (
      cfg.owner_id,v_order_id,v_product.id,v_variant.id,v_product.name,v_variant.variant_name,
      x.quantity,v_unit_price,x.quantity*v_unit_price
    );

    -- Stock is reserved only when an administrator accepts this request.

  end loop;

  return jsonb_build_object(
    'order_id',v_order_id,
    'order_code',v_order_code,
    'status','pending',
    'subtotal_ars',v_subtotal,
    'shipping_ars',v_shipping,
    'adjustment_ars',v_adjustment,
    'total_ars',v_total,
    'payment_method',pm.name,
    'items',(select jsonb_agg(jsonb_build_object('product_name',product_name,'variant_name',variant_name,'quantity',quantity,'unit_price_ars',unit_price_ars)) from public.importb2b_web_order_items where order_id=v_order_id),
    'customer_name',v_name,'customer_phone',v_phone,'delivery_type',p_delivery_type,'delivery_address',v_address,
    'whatsapp_number',cfg.whatsapp_number
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.importb2b_confirm_web_order(p_order_id uuid, p_holder text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid:=public.importb2b_shared_owner();o public.importb2b_web_orders;v_customer_id uuid;v_items jsonb;v_sale jsonb;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  select * into o from public.importb2b_web_orders where id=p_order_id and owner_id=v_uid for update;
  if o.id is null then raise exception 'Pedido web no encontrado'; end if;
  if o.status<>'accepted' then raise exception 'Primero confirmá el pedido para reservar el stock'; end if;

  select id into v_customer_id from public.importb2b_customers
  where owner_id=v_uid and active=true and ((phone is not null and regexp_replace(phone,'\D','','g')=regexp_replace(o.customer_phone,'\D','','g'))
    or (o.customer_email is not null and email is not null and lower(email)=lower(o.customer_email)))
  order by created_at limit 1;
  if v_customer_id is null then
    insert into public.importb2b_customers(owner_id,full_name,phone,email,address,active,source,source_id)
    values(v_uid,o.customer_name,o.customer_phone,o.customer_email,o.delivery_address,true,'web_catalog','web:'||o.id::text)
    returning id into v_customer_id;
  end if;

  insert into public.importb2b_inventory_movements(owner_id,product_id,variant_id,bucket,movement_type,quantity_delta,unit_cost_ars,reference_type,reference_id,note,created_by)
  select v_uid,i.product_id,i.variant_id,'reserved','reservation_release',-i.quantity,v.cost_ars,'web_order_confirm',o.id::text,'Liberación para confirmar '||o.order_code,v_uid
  from public.importb2b_web_order_items i join public.importb2b_product_variants v on v.id=i.variant_id where i.order_id=o.id;

  select jsonb_agg(jsonb_build_object('variant_id',variant_id,'quantity',quantity,'unit_price_ars',unit_price_ars) order by variant_id)
  into v_items from public.importb2b_web_order_items where order_id=o.id;

  v_sale:=public.importb2b_complete_sale(v_customer_id,v_items,o.payment_method_id,o.shipping_ars,0,
    concat_ws(E'\n','Pedido web '||o.order_code,o.notes),p_holder);
  if abs(coalesce((v_sale->>'total_ars')::numeric,0)-o.total_ars)>0.01 then raise exception 'El total cambió desde que se creó el pedido. Revisá la forma de pago antes de confirmar.'; end if;
  update public.importb2b_web_orders set status='confirmed',sale_id=(v_sale->>'sale_id')::uuid,updated_at=now() where id=o.id;
  return jsonb_build_object('order_id',o.id,'order_code',o.order_code,'status','confirmed','sale',v_sale,'customer_id',v_customer_id);
end;
$function$;

CREATE OR REPLACE FUNCTION public.importb2b_cancel_web_order(p_order_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid:=public.importb2b_shared_owner();
  o public.importb2b_web_orders;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  select * into o from public.importb2b_web_orders
  where id=p_order_id and owner_id=v_uid
  for update;
  if o.id is null then raise exception 'Pedido web no encontrado'; end if;
  if o.status not in ('pending','accepted') then raise exception 'Solo se pueden cancelar pedidos pendientes'; end if;

  insert into public.importb2b_inventory_movements(
    owner_id,product_id,variant_id,bucket,movement_type,quantity_delta,unit_cost_ars,
    reference_type,reference_id,note,created_by
  )
  select
    v_uid,i.product_id,i.variant_id,'reserved','reservation_release',-(select coalesce(sum(m.quantity_delta),0) from public.importb2b_inventory_movements m where m.variant_id=i.variant_id and m.reference_id=o.id::text and m.bucket='reserved'),v.cost_ars,
    'web_order_cancel',o.id::text,
    'Cancelación '||o.order_code||coalesce(' · '||nullif(trim(p_reason),''),''),v_uid
  from public.importb2b_web_order_items i
  join public.importb2b_product_variants v on v.id=i.variant_id
  where i.order_id=o.id and (select coalesce(sum(m.quantity_delta),0) from public.importb2b_inventory_movements m where m.variant_id=i.variant_id and m.reference_id=o.id::text and m.bucket='reserved')>0;

  update public.importb2b_web_orders
  set status='cancelled',
      notes=concat_ws(E'\n',notes,'CANCELADO: '||coalesce(nullif(trim(p_reason),''),'Sin motivo')),
      updated_at=now()
  where id=o.id;

  return jsonb_build_object('order_id',o.id,'order_code',o.order_code,'status','cancelled');
end;
$function$;

select cron.schedule('importb2b-operational-notifications','* * * * *',$job$
 select net.http_post(url:='https://jgjvzqfxakvogaeqfual.supabase.co/functions/v1/importb2b-operational-notifications',
 body:='{}'::jsonb,headers:=jsonb_build_object('Content-Type','application/json','x-cron-secret',
 (select decrypted_secret from vault.decrypted_secrets where name='importb2b_summary_cron_secret' limit 1)),timeout_milliseconds:=60000);
$job$);
select cron.schedule('importb2b-tracking-poll','*/15 * * * *',$job$
 select net.http_post(url:='https://jgjvzqfxakvogaeqfual.supabase.co/functions/v1/importb2b-operational-notifications',
 body:='{"poll":true}'::jsonb,headers:=jsonb_build_object('Content-Type','application/json','x-cron-secret',
 (select decrypted_secret from vault.decrypted_secrets where name='importb2b_summary_cron_secret' limit 1)),timeout_milliseconds:=60000);
$job$);
