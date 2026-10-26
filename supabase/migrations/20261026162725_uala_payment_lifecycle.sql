-- Server-only lifecycle. No contract is enabled by this migration.
create table public.importb2b_uala_contracts (
 owner_id uuid not null references public.profiles(id),
 environment text not null check(environment in ('test','production')),
 plan text not null check(plan in ('credit_3','naranja_6','credit_9')),
 enabled boolean not null default false,
 allowed_issuers text[] not null default '{}',
 evidence_reference text not null check(length(trim(evidence_reference))>0),
 primary key(owner_id,environment,plan),
 check(not enabled or cardinality(allowed_issuers)>0)
);
alter table public.importb2b_uala_contracts enable row level security;
revoke all on public.importb2b_uala_contracts from public,anon,authenticated;
grant select on public.importb2b_uala_contracts to authenticated;
grant all on public.importb2b_uala_contracts to service_role;
create policy uala_contract_admin_read on public.importb2b_uala_contracts for select to authenticated
 using(owner_id=public.importb2b_shared_owner() and exists(select 1 from public.profiles where id=auth.uid() and role='admin'));

create table public.importb2b_uala_attempts (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references public.profiles(id),
 order_id uuid not null unique references public.importb2b_web_orders(id),
 request_id uuid not null unique,
 environment text not null check(environment in ('test','production')),
 plan text not null check(plan in ('credit_3','naranja_6','credit_9')),
 external_reference text not null unique default gen_random_uuid()::text,
 provider_id uuid unique,
 checkout_url text,
 final_cents bigint not null check(final_cents between 2500 and 999999900),
 estimate jsonb not null,
 state text not null default 'creating' check(state in ('creating','unknown','pending','processed','rejected','approved','review','posted','refunded','refund_review')),
 provider_status text check(provider_status in ('PENDING','PROCESSED','REJECTED','APPROVED','REFUNDED')),
 verified_installments integer,
 verified_issuer text,
 sale_id uuid unique references public.importb2b_sales(id),
 movement_id uuid unique references public.movements(id),
 actual_fee_cents bigint check(actual_fee_cents>=0),
 created_at timestamptz not null default now(),
 checked_at timestamptz,
 posted_at timestamptz
);
create index uala_attempt_owner_idx on public.importb2b_uala_attempts(owner_id);
create index uala_attempt_pending_idx on public.importb2b_uala_attempts(checked_at) where state in ('pending','processed','unknown','rejected','review');
alter table public.importb2b_uala_attempts enable row level security;
revoke all on public.importb2b_uala_attempts from public,anon,authenticated;
grant select on public.importb2b_uala_attempts to authenticated;
grant all on public.importb2b_uala_attempts to service_role;
create policy uala_attempt_admin_read on public.importb2b_uala_attempts for select to authenticated
 using(owner_id=public.importb2b_shared_owner() and exists(select 1 from public.profiles where id=auth.uid() and role='admin'));

-- Reserve in the same transaction that durably claims the one provider POST.
-- An ambiguous timeout NEVER frees this claim or stock automatically.
create function public.importb2b_uala_prepare(p_order_id uuid,p_request_id uuid,p_plan text,p_environment text)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare o public.importb2b_web_orders; a public.importb2b_uala_attempts; cfg public.importb2b_uala_settings;
 i record; held numeric; available_qty numeric; base numeric:=0; financing integer; q jsonb;
begin
 select * into o from public.importb2b_web_orders where id=p_order_id for update;
 if o.id is null then raise exception 'Pedido no encontrado'; end if;
 select * into a from public.importb2b_uala_attempts where order_id=o.id;
 if a.id is not null then
  if a.plan<>p_plan or a.environment<>p_environment then raise exception 'El intento existente tiene otro plan o ambiente'; end if;
  return to_jsonb(a)||jsonb_build_object('new_attempt',false);
 end if;
 if p_request_id is null or o.status not in ('pending','accepted') or o.sale_id is not null then raise exception 'Pedido no apto para cobro'; end if;
 if not exists(select 1 from public.importb2b_payment_methods where id=o.payment_method_id and owner_id=o.owner_id and code='uala_bis_online') then raise exception 'El pedido no es de Ualá Bis'; end if;
 if not exists(select 1 from public.importb2b_uala_contracts where owner_id=o.owner_id and plan=p_plan and environment=p_environment and enabled) then raise exception 'Plan sin contrato oficial habilitado'; end if;
 select * into cfg from public.importb2b_uala_settings where owner_id=o.owner_id for share;
 if cfg.owner_id is null then raise exception 'Configuración no disponible'; end if;
 if (select count(*)<>count(distinct variant_id) or count(*)=0 from public.importb2b_web_order_items where order_id=o.id) then raise exception 'Detalle de variantes inconsistente'; end if;
 for i in select wi.*,v.price_ars,v.sale_price_ars,v.cost_ars,v.active variant_active,p.active product_active,p.catalog_visible
  from public.importb2b_web_order_items wi join public.importb2b_product_variants v on v.id=wi.variant_id
  join public.importb2b_products p on p.id=wi.product_id and p.id=v.product_id and p.owner_id=o.owner_id where wi.order_id=o.id and wi.owner_id=o.owner_id order by wi.variant_id loop
  perform 1 from public.importb2b_product_variants where id=i.variant_id and owner_id=o.owner_id for update;
  if not found or not i.variant_active or not i.product_active or not i.catalog_visible or i.quantity<=0 then raise exception 'Producto no disponible'; end if;
  if i.unit_price_ars is distinct from (case when i.sale_price_ars>0 and i.sale_price_ars<i.price_ars then i.sale_price_ars else i.price_ars end) then raise exception 'El precio cambió; se requiere nueva cotización'; end if;
  select coalesce(sum(quantity_delta),0) into held from public.importb2b_inventory_movements where variant_id=i.variant_id and reference_id=o.id::text and bucket='reserved';
  select coalesce(sum(quantity_delta) filter(where bucket='on_hand'),0)-coalesce(sum(quantity_delta) filter(where bucket='reserved'),0) into available_qty
   from public.importb2b_inventory_movements where variant_id=i.variant_id;
  if held<0 or held>i.quantity or available_qty<i.quantity-held then raise exception 'Stock insuficiente o reserva inconsistente'; end if;
  if held<i.quantity then
   insert into public.importb2b_inventory_movements(owner_id,product_id,variant_id,bucket,movement_type,quantity_delta,unit_cost_ars,reference_type,reference_id,note,created_by)
   values(o.owner_id,i.product_id,i.variant_id,'reserved','reservation',i.quantity-held,i.cost_ars,'web_order',o.id::text,'Reserva Ualá Bis',o.owner_id);
  end if;
  base:=base+i.quantity*i.unit_price_ars;
 end loop;
 if base<=0 or base<>o.subtotal_ars or o.shipping_ars<0 then raise exception 'Total base inconsistente'; end if;
 financing:=case p_plan when 'credit_3' then cfg.financing_3_bps when 'naranja_6' then cfg.financing_6_naranja_bps when 'credit_9' then cfg.financing_9_bps end;
 q:=public.importb2b_uala_quote_math(ceil((base+o.shipping_ars)*100)::bigint,cfg.processing_bps,financing,cfg.vat_bps);
 insert into public.importb2b_uala_attempts(owner_id,order_id,request_id,environment,plan,final_cents,estimate)
 values(o.owner_id,o.id,p_request_id,p_environment,p_plan,(q->>'final_cents')::bigint,q) returning * into a;
 update public.importb2b_web_orders set status='accepted',accepted_at=coalesce(accepted_at,now()),total_ars=a.final_cents/100.0,adjustment_ars=a.final_cents/100.0-base-o.shipping_ars where id=o.id;
 return to_jsonb(a)||jsonb_build_object('new_attempt',true);
end $$;
revoke all on function public.importb2b_uala_prepare(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.importb2b_uala_prepare(uuid,uuid,text,text) to service_role;

create function public.importb2b_uala_bind(p_attempt_id uuid,p_provider_id uuid,p_reference text,p_amount_cents bigint,p_checkout_url text)
returns void language plpgsql security invoker set search_path=public,pg_temp as $$
declare a public.importb2b_uala_attempts;
begin
 select * into a from public.importb2b_uala_attempts where id=p_attempt_id for update;
 if a.id is null or a.state<>'creating' or a.provider_id is not null or a.external_reference<>p_reference or a.final_cents<>p_amount_cents or p_provider_id is null
 or p_checkout_url is null or p_checkout_url !~ '^https://uala-checkout[.]com/' then raise exception 'Respuesta de creación no válida'; end if;
 update public.importb2b_uala_attempts set provider_id=p_provider_id,checkout_url=p_checkout_url,state='pending' where id=a.id;
end $$;
revoke all on function public.importb2b_uala_bind(uuid,uuid,text,bigint,text) from public,anon,authenticated;
grant execute on function public.importb2b_uala_bind(uuid,uuid,text,bigint,text) to service_role;

create function public.importb2b_uala_mark_unknown(p_attempt_id uuid)
returns void language sql security invoker set search_path=public,pg_temp as $$
 update public.importb2b_uala_attempts set state='unknown' where id=p_attempt_id and state='creating' and provider_id is null;
$$;
revoke all on function public.importb2b_uala_mark_unknown(uuid) from public,anon,authenticated;
grant execute on function public.importb2b_uala_mark_unknown(uuid) to service_role;

-- Accept ONLY the result of a server-authenticated provider query. No money moves here.
create function public.importb2b_uala_apply_verified(p_attempt_id uuid,p_provider_id uuid,p_reference text,p_amount_cents bigint,p_status text,p_installments integer,p_issuer text)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare a public.importb2b_uala_attempts; next_state text; expected_installments integer;
begin
 select * into a from public.importb2b_uala_attempts where id=p_attempt_id for update;
 if a.id is null or p_provider_id is distinct from a.provider_id or p_reference is distinct from a.external_reference or p_amount_cents is distinct from a.final_cents then raise exception 'Identidad o importe no coincide'; end if;
 if p_status is null or p_status not in ('PENDING','PROCESSED','REJECTED','APPROVED','REFUNDED') then raise exception 'Estado no reconocido'; end if;
 if a.provider_status='REFUNDED' or (a.provider_status='APPROVED' and p_status not in ('APPROVED','REFUNDED')) or (a.state='posted' and p_status='APPROVED') or (a.provider_status='PROCESSED' and p_status='PENDING') then
  update public.importb2b_uala_attempts set checked_at=now() where id=a.id;
  return jsonb_build_object('state',a.state,'ignored_stale',true);
 end if;
 next_state:=lower(p_status);
 if p_status='APPROVED' then
  expected_installments:=case a.plan when 'credit_3' then 3 when 'naranja_6' then 6 when 'credit_9' then 9 end;
  if p_installments is distinct from expected_installments or p_issuer is null or not exists(select 1 from public.importb2b_uala_contracts c
   where c.owner_id=a.owner_id and c.environment=a.environment and c.plan=a.plan and c.enabled and p_issuer=any(c.allowed_issuers)) then next_state:='review'; end if;
 end if;
 if p_status='REFUNDED' and a.sale_id is not null then next_state:='refund_review'; end if;
 update public.importb2b_uala_attempts set provider_status=p_status,state=next_state,verified_installments=p_installments,verified_issuer=left(p_issuer,40),checked_at=now() where id=a.id;
 return jsonb_build_object('state',next_state,'attempt_id',a.id);
end $$;
revoke all on function public.importb2b_uala_apply_verified(uuid,uuid,text,bigint,text,integer,text) from public,anon,authenticated;
grant execute on function public.importb2b_uala_apply_verified(uuid,uuid,text,bigint,text,integer,text) to service_role;

-- Ualá orders with a remote attempt cannot use manual cash/transfer confirmation,
-- edits or cancellation. The provider may still charge a previously issued URL.
create schema if not exists importb2b_private;
-- Trigger-only definer guards must see attempts hidden from a caller by RLS.
-- No public RPC grant; the outer SQL role is preserved by current_setting('role').
create function importb2b_private.uala_guard_order()
returns trigger language plpgsql security definer set search_path='' as $$
declare actor_role text:=coalesce(nullif(pg_catalog.current_setting('role',true),'none'),session_user);
begin
 if actor_role not in ('service_role','postgres') and exists(select 1 from public.importb2b_uala_attempts where order_id=old.id) then
  raise exception 'Pedido Ualá: requiere conciliación de pago en servidor';
 end if;
 if tg_op='DELETE' then return old; end if;
 return new;
end $$;
revoke all on function importb2b_private.uala_guard_order() from public,anon,authenticated,service_role;
create trigger uala_order_guard before update or delete on public.importb2b_web_orders for each row execute function importb2b_private.uala_guard_order();

create function importb2b_private.uala_guard_items()
returns trigger language plpgsql security definer set search_path='' as $$
declare old_order uuid; new_order uuid; actor_role text:=coalesce(nullif(pg_catalog.current_setting('role',true),'none'),session_user);
begin
 if tg_op<>'INSERT' then old_order:=old.order_id; end if;
 if tg_op<>'DELETE' then new_order:=new.order_id; end if;
 if actor_role not in ('service_role','postgres') and exists(select 1 from public.importb2b_uala_attempts where order_id=old_order or order_id=new_order) then
  raise exception 'Detalle Ualá inmutable durante conciliación';
 end if;
 if tg_op='DELETE' then return old; end if;
 return new;
end $$;
revoke all on function importb2b_private.uala_guard_items() from public,anon,authenticated,service_role;
create trigger uala_items_guard before insert or update or delete on public.importb2b_web_order_items for each row execute function importb2b_private.uala_guard_items();

-- Post the actual reconciled fee, never a browser amount or the fee estimate.
-- Caller must first query Ualá and reconcile the actual account credit.
-- Sandbox is prohibited from creating sales or Caja movements.
create function public.importb2b_uala_post_to_caja(p_attempt_id uuid,p_actual_fee_cents bigint,p_holder text)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare a public.importb2b_uala_attempts; o public.importb2b_web_orders; oid uuid; i record;
 held numeric; onhand numeric; cost_total numeric:=0; item_total numeric:=0; customer uuid;
 sid uuid; mid uuid; sale_code text; net_credit numeric;
begin
 select order_id into oid from public.importb2b_uala_attempts where id=p_attempt_id;
 select * into o from public.importb2b_web_orders where id=oid for update;
 select * into a from public.importb2b_uala_attempts where id=p_attempt_id for update;
 if a.id is null then raise exception 'Intento no encontrado'; end if;
 if a.sale_id is not null then return jsonb_build_object('sale_id',a.sale_id,'movement_id',a.movement_id,'already_posted',true); end if;
 if a.environment<>'production' or a.state<>'approved' or a.provider_status<>'APPROVED' then raise exception 'Pago no apto para Caja'; end if;
 if o.owner_id is distinct from a.owner_id or o.status<>'accepted' or o.sale_id is not null or o.total_ars*100<>a.final_cents then raise exception 'Pedido inconsistente'; end if;
 if p_actual_fee_cents is null or p_actual_fee_cents<0 or p_actual_fee_cents>=a.final_cents or p_holder is null or p_holder not in ('nahuel','esteban') then raise exception 'Conciliación inválida'; end if;
 net_credit:=(a.final_cents-p_actual_fee_cents)/100.0;
 if net_credit<o.subtotal_ars+o.shipping_ars then raise exception 'Neto real menor al deseado: revisión requerida'; end if;
 if not exists(select 1 from public.importb2b_uala_contracts c where c.owner_id=a.owner_id and c.environment=a.environment and c.plan=a.plan and c.enabled and a.verified_issuer=any(c.allowed_issuers)) then raise exception 'Contrato no habilitado'; end if;
 if (select count(*)<>count(distinct variant_id) or count(*)=0 from public.importb2b_web_order_items where order_id=o.id) then raise exception 'Detalle de variantes inconsistente'; end if;
 for i in select wi.*,v.cost_ars from public.importb2b_web_order_items wi
  join public.importb2b_product_variants v on v.id=wi.variant_id where wi.order_id=o.id order by wi.variant_id loop
  perform 1 from public.importb2b_product_variants where id=i.variant_id for update;
  select coalesce(sum(quantity_delta) filter(where bucket='on_hand'),0) into onhand from public.importb2b_inventory_movements where variant_id=i.variant_id;
  select coalesce(sum(quantity_delta),0) into held from public.importb2b_inventory_movements where variant_id=i.variant_id and reference_id=o.id::text and bucket='reserved';
  if held<>i.quantity or onhand<i.quantity or i.quantity<=0 then raise exception 'Reserva o stock inconsistente'; end if;
  cost_total:=cost_total+i.quantity*coalesce(i.cost_ars,0);item_total:=item_total+i.quantity*i.unit_price_ars;
 end loop;
 if item_total<=0 or item_total<>o.subtotal_ars then raise exception 'Detalle del pedido inconsistente'; end if;
 select id into customer from public.importb2b_customers where owner_id=o.owner_id and active
 and (source_id='web:'||o.id::text or (nullif(o.customer_phone,'') is not null and regexp_replace(phone,'\D','','g')=regexp_replace(o.customer_phone,'\D','','g'))
 or (nullif(o.customer_email,'') is not null and lower(email)=lower(o.customer_email))) order by created_at limit 1;
 if customer is null then
  insert into public.importb2b_customers(owner_id,full_name,phone,email,address,active,source,source_id)
  values(o.owner_id,o.customer_name,o.customer_phone,o.customer_email,o.delivery_address,true,'web_catalog','web:'||o.id::text) returning id into customer;
 end if;
 sale_code:='V-U-'||replace(a.id::text,'-','');
 insert into public.importb2b_sales(owner_id,sale_code,status,customer_id,subtotal_ars,discount_ars,fee_ars,shipping_ars,total_ars,profit_ars,original_payment_method,notes,seller_name,source,source_id,sold_at,created_by,stock_link_status)
 values(o.owner_id,sale_code,'completed',customer,o.subtotal_ars,0,a.final_cents/100.0-o.subtotal_ars-o.shipping_ars,o.shipping_ars,a.final_cents/100.0,
 net_credit-cost_total-o.shipping_ars,'Ualá Bis Tienda Online','Pedido '||o.order_code||' · Ualá '||a.provider_id::text,'Ualá Bis','uala_online',a.provider_id::text,now(),o.owner_id,'linked') returning id into sid;
 insert into public.importb2b_sale_items(owner_id,sale_id,product_id,variant_id,original_item_name,quantity,unit_price_ars,unit_cost_ars,line_total_ars,source_payload)
 select o.owner_id,sid,wi.product_id,wi.variant_id,wi.product_name||' / '||wi.variant_name,wi.quantity,wi.unit_price_ars,v.cost_ars,wi.quantity*wi.unit_price_ars,'{}'::jsonb
 from public.importb2b_web_order_items wi join public.importb2b_product_variants v on v.id=wi.variant_id where wi.order_id=o.id;
 for i in select wi.*,v.cost_ars from public.importb2b_web_order_items wi join public.importb2b_product_variants v on v.id=wi.variant_id where wi.order_id=o.id order by wi.variant_id loop
  insert into public.importb2b_inventory_movements(owner_id,product_id,variant_id,bucket,movement_type,quantity_delta,unit_cost_ars,reference_type,reference_id,note,created_by)
  values(o.owner_id,i.product_id,i.variant_id,'reserved','reservation_release',-i.quantity,i.cost_ars,'web_order_confirm',o.id::text,'Ualá confirmada',o.owner_id),
   (o.owner_id,i.product_id,i.variant_id,'on_hand','sale',-i.quantity,i.cost_ars,'sale',sid::text,'Venta Ualá',o.owner_id);
 end loop;
 insert into public.movements(kind,amount,currency,payment_method,category,description,occurred_at,ars_equivalent,created_by,source_type,source_id,transfer_holder)
 values('income',net_credit,'ARS','transferencia','VENTA','Ualá Bis '||o.order_code||' · bruto '||(a.final_cents/100.0)::text||' · comisión real '||(p_actual_fee_cents/100.0)::text,now(),net_credit,o.owner_id,'sale',sid,p_holder) returning id into mid;
 insert into public.importb2b_sale_payments(owner_id,sale_id,payment_method_id,base_amount_ars,adjustment_amount_ars,amount_ars,status,movement_id)
 values(o.owner_id,sid,o.payment_method_id,o.subtotal_ars+o.shipping_ars,a.final_cents/100.0-o.subtotal_ars-o.shipping_ars,a.final_cents/100.0,'paid',mid);
 update public.importb2b_web_orders set status='confirmed',sale_id=sid,updated_at=now() where id=o.id;
 update public.importb2b_uala_attempts set state='posted',sale_id=sid,movement_id=mid,actual_fee_cents=p_actual_fee_cents,posted_at=now() where id=a.id;
 return jsonb_build_object('sale_id',sid,'movement_id',mid,'net_credit_ars',net_credit,'already_posted',false);
end $$;
revoke all on function public.importb2b_uala_post_to_caja(uuid,bigint,text) from public,anon,authenticated;
grant execute on function public.importb2b_uala_post_to_caja(uuid,bigint,text) to service_role;

-- Releasing stock is safe only after a server-confirmed refund before posting.
-- A local timeout/cancel request or REJECTED webhook never releases it here.
create function public.importb2b_uala_release_refunded(p_attempt_id uuid)
returns void language plpgsql security invoker set search_path=public,pg_temp as $$
declare a public.importb2b_uala_attempts; oid uuid; i record; held numeric;
begin
 select order_id into oid from public.importb2b_uala_attempts where id=p_attempt_id;
 perform 1 from public.importb2b_web_orders where id=oid for update;
 select * into a from public.importb2b_uala_attempts where id=p_attempt_id for update;
 if a.id is null or a.provider_status is distinct from 'REFUNDED' or a.sale_id is not null then raise exception 'Reembolso no apto para liberar reserva'; end if;
 for i in select wi.*,v.cost_ars from public.importb2b_web_order_items wi join public.importb2b_product_variants v on v.id=wi.variant_id where wi.order_id=oid order by wi.variant_id loop
  perform 1 from public.importb2b_product_variants where id=i.variant_id for update;
  select coalesce(sum(quantity_delta),0) into held from public.importb2b_inventory_movements where variant_id=i.variant_id and reference_id=oid::text and bucket='reserved';
  if held<0 or held>i.quantity then raise exception 'Reserva inconsistente'; end if;
  if held>0 then
   insert into public.importb2b_inventory_movements(owner_id,product_id,variant_id,bucket,movement_type,quantity_delta,unit_cost_ars,reference_type,reference_id,note,created_by)
   values(a.owner_id,i.product_id,i.variant_id,'reserved','reservation_release',-held,i.cost_ars,'web_order_cancel',oid::text,'Reembolso Ualá confirmado antes de venta',a.owner_id);
  end if;
 end loop;
 update public.importb2b_web_orders set status='cancelled',updated_at=now() where id=oid;
end $$;
revoke all on function public.importb2b_uala_release_refunded(uuid) from public,anon,authenticated;
grant execute on function public.importb2b_uala_release_refunded(uuid) to service_role;
