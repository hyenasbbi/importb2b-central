-- IMPORTB2B Central — Fase 6.5
-- Compras / tracking / gastos / mayorista / administración de clientes y Club.

alter table public.importb2b_orders
  add column if not exists provider text,
  add column if not exists purchase_status text not null default 'ordered',
  add column if not exists purchase_payment_method text,
  add column if not exists purchase_payment_holder text,
  add column if not exists purchase_payment_amount_ars numeric,
  add column if not exists purchase_payment_movement_id uuid references public.movements(id) on delete set null,
  add column if not exists purchase_paid_at timestamptz;

alter table public.movements drop constraint if exists movements_source_type_check;
alter table public.movements add constraint movements_source_type_check
check (source_type is null or source_type in ('manual','settlement','receivable','internal_transfer','internal_conversion','sale','purchase_order'));

alter table public.importb2b_orders drop constraint if exists importb2b_orders_purchase_status_check;
alter table public.importb2b_orders add constraint importb2b_orders_purchase_status_check
check (purchase_status in ('ordered','in_transit','ready_for_pickup','picked_up','receiving','received','cancelled'));

alter table public.importb2b_orders drop constraint if exists importb2b_orders_purchase_payment_method_check;
alter table public.importb2b_orders add constraint importb2b_orders_purchase_payment_method_check
check (purchase_payment_method is null or purchase_payment_method in ('efectivo','transferencia','usdt'));

alter table public.importb2b_orders drop constraint if exists importb2b_orders_purchase_payment_holder_check;
alter table public.importb2b_orders add constraint importb2b_orders_purchase_payment_holder_check
check (purchase_payment_holder is null or purchase_payment_holder in ('nahuel','esteban'));

alter table public.importb2b_expenses
  add column if not exists order_id bigint references public.importb2b_orders(id) on delete set null,
  add column if not exists product_id uuid references public.importb2b_products(id) on delete set null,
  add column if not exists finance_movement_id uuid references public.movements(id) on delete set null,
  add column if not exists payment_method text,
  add column if not exists holder text;

alter table public.importb2b_expenses drop constraint if exists importb2b_expenses_payment_method_check;
alter table public.importb2b_expenses add constraint importb2b_expenses_payment_method_check
check (payment_method is null or payment_method in ('efectivo','transferencia','usdt'));
alter table public.importb2b_expenses drop constraint if exists importb2b_expenses_holder_check;
alter table public.importb2b_expenses add constraint importb2b_expenses_holder_check
check (holder is null or holder in ('nahuel','esteban'));

create table if not exists public.importb2b_variant_wholesale_prices (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  variant_id uuid not null references public.importb2b_product_variants(id) on delete cascade,
  min_quantity integer not null check (min_quantity > 0),
  price_ars numeric not null check (price_ars >= 0),
  source text not null default 'manual' check (source in ('manual','margin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id,variant_id,min_quantity)
);
create index if not exists importb2b_variant_wholesale_prices_variant_idx
on public.importb2b_variant_wholesale_prices(variant_id,min_quantity);
alter table public.importb2b_variant_wholesale_prices enable row level security;
drop policy if exists importb2b_variant_wholesale_prices_select_own on public.importb2b_variant_wholesale_prices;
drop policy if exists importb2b_variant_wholesale_prices_insert_own on public.importb2b_variant_wholesale_prices;
drop policy if exists importb2b_variant_wholesale_prices_update_own on public.importb2b_variant_wholesale_prices;
drop policy if exists importb2b_variant_wholesale_prices_delete_own on public.importb2b_variant_wholesale_prices;
create policy importb2b_variant_wholesale_prices_select_own on public.importb2b_variant_wholesale_prices for select to authenticated using ((select auth.uid())=owner_id);
create policy importb2b_variant_wholesale_prices_insert_own on public.importb2b_variant_wholesale_prices for insert to authenticated with check ((select auth.uid())=owner_id);
create policy importb2b_variant_wholesale_prices_update_own on public.importb2b_variant_wholesale_prices for update to authenticated using ((select auth.uid())=owner_id) with check ((select auth.uid())=owner_id);
create policy importb2b_variant_wholesale_prices_delete_own on public.importb2b_variant_wholesale_prices for delete to authenticated using ((select auth.uid())=owner_id);
grant select,insert,update,delete on public.importb2b_variant_wholesale_prices to authenticated;

create or replace view public.importb2b_wholesale_pricing
with (security_invoker=true) as
select
  v.owner_id,
  p.id product_id,p.name product_name,p.category,p.primary_image_url,
  v.id variant_id,v.variant_name,v.sku,v.cost_ars,v.price_ars retail_price_ars,
  s.available,
  m.retail retail_margin_percent,
  m.wholesale_6 margin_6_percent,
  m.wholesale_12 margin_12_percent,
  m.wholesale_36 margin_36_percent,
  coalesce(w6.price_ars,ceil((coalesce(v.cost_ars,0)*(1+coalesce(m.wholesale_6,0)/100.0))/500.0)*500) wholesale_6_ars,
  coalesce(w12.price_ars,ceil((coalesce(v.cost_ars,0)*(1+coalesce(m.wholesale_12,0)/100.0))/500.0)*500) wholesale_12_ars,
  coalesce(w36.price_ars,ceil((coalesce(v.cost_ars,0)*(1+coalesce(m.wholesale_36,0)/100.0))/500.0)*500) wholesale_36_ars,
  (w6.id is not null) wholesale_6_manual,
  (w12.id is not null) wholesale_12_manual,
  (w36.id is not null) wholesale_36_manual
from public.importb2b_product_variants v
join public.importb2b_products p on p.id=v.product_id
left join public.importb2b_stock_summary s on s.variant_id=v.id
left join public.importb2b_margins m on m.owner_id=v.owner_id and lower(m.category)=lower(coalesce(p.category,''))
left join public.importb2b_variant_wholesale_prices w6 on w6.owner_id=v.owner_id and w6.variant_id=v.id and w6.min_quantity=6
left join public.importb2b_variant_wholesale_prices w12 on w12.owner_id=v.owner_id and w12.variant_id=v.id and w12.min_quantity=12
left join public.importb2b_variant_wholesale_prices w36 on w36.owner_id=v.owner_id and w36.variant_id=v.id and w36.min_quantity=36
where p.active=true and v.active=true;
grant select on public.importb2b_wholesale_pricing to authenticated;

create or replace function public.importb2b_create_purchase_order(
  p_order_date date,
  p_usdt_rate numeric,
  p_shipping_amount numeric,
  p_shipping_currency text,
  p_provider text,
  p_note text,
  p_items jsonb
) returns jsonb
language plpgsql
security invoker
set search_path=public
as $$
declare
  uid uuid:=auth.uid();
  v_order_id bigint;v_order_no integer;
  x jsonb;v_qty integer;v_supplier_usdt numeric;v_shipping_usdt numeric;v_shipping_per_unit numeric;
  v_total_units integer;v_merch_usdt numeric;v_investment numeric;v_landed_usdt numeric;v_landed_ars numeric;
  v_product_id uuid;v_variant_id uuid;v_item_id bigint;
  v_product_name text;v_category text;v_variant_name text;v_sku text;
  existing_product public.importb2b_products;existing_variant public.importb2b_product_variants;
begin
  if uid is null then raise exception 'No autenticado'; end if;
  if p_order_date is null then raise exception 'Ingresá la fecha'; end if;
  if coalesce(p_usdt_rate,0)<=0 then raise exception 'Cotización USDT inválida'; end if;
  if p_shipping_currency not in ('USDT','ARS') then raise exception 'Moneda de envío inválida'; end if;
  if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then raise exception 'Cargá al menos un producto'; end if;

  select coalesce(sum((value->>'quantity')::integer),0),
         coalesce(sum((value->>'quantity')::numeric*coalesce((value->>'supplier_usdt')::numeric,0)),0)
  into v_total_units,v_merch_usdt from jsonb_array_elements(p_items);
  if v_total_units<=0 then raise exception 'Cantidad total inválida'; end if;
  v_shipping_usdt:=case when p_shipping_currency='ARS' then coalesce(p_shipping_amount,0)/p_usdt_rate else coalesce(p_shipping_amount,0) end;
  v_shipping_per_unit:=v_shipping_usdt/v_total_units;
  v_investment:=v_merch_usdt+v_shipping_usdt;

  perform pg_advisory_xact_lock(hashtext(uid::text||':importb2b-purchase-order'));
  select coalesce(max(o.order_number),0)+1 into v_order_no from public.importb2b_orders o where o.owner_id=uid;
  insert into public.importb2b_orders(owner_id,order_number,order_date,note,investment_usd,merchandise_usdt,shipping_input_amount,shipping_input_currency,shipping_usdt,usdt_rate_ars,total_units,shipping_usdt_per_unit,provider,purchase_status)
  values(uid,v_order_no,p_order_date,nullif(trim(coalesce(p_note,'')),''),v_investment,v_merch_usdt,coalesce(p_shipping_amount,0),p_shipping_currency,v_shipping_usdt,p_usdt_rate,v_total_units,v_shipping_per_unit,nullif(trim(coalesce(p_provider,'')),''),'ordered')
  returning id into v_order_id;

  for x in select value from jsonb_array_elements(p_items) loop
    v_qty:=coalesce((x->>'quantity')::integer,0);v_supplier_usdt:=coalesce((x->>'supplier_usdt')::numeric,0);
    if v_qty<=0 or v_supplier_usdt<0 then raise exception 'Producto con cantidad/costo inválido'; end if;
    v_category:=trim(coalesce(x->>'category','OTROS'));
    v_product_name:=trim(coalesce(x->>'product_name',''));
    v_variant_name:=trim(coalesce(x->>'variant_name','Única'));
    v_sku:=nullif(trim(coalesce(x->>'sku','')),'');
    if v_product_name='' then raise exception 'Producto sin nombre'; end if;
    v_product_id:=null;v_variant_id:=null;

    if nullif(x->>'variant_id','') is not null then
      select * into existing_variant from public.importb2b_product_variants pv
      where pv.id=(x->>'variant_id')::uuid and pv.owner_id=uid and pv.active=true;
      if existing_variant.id is null then raise exception 'Variante existente no encontrada'; end if;
      v_variant_id:=existing_variant.id;v_product_id:=existing_variant.product_id;
      select * into existing_product from public.importb2b_products p where p.id=v_product_id and p.owner_id=uid;
      v_product_name:=existing_product.name;v_category:=coalesce(existing_product.category,v_category);v_variant_name:=existing_variant.variant_name;v_sku:=existing_variant.sku;
    else
      select * into existing_product from public.importb2b_products p
      where p.owner_id=uid and p.active=true and lower(trim(p.name))=lower(v_product_name) and lower(trim(coalesce(p.category,'')))=lower(v_category)
      order by p.created_at limit 1;
      if existing_product.id is null then
        insert into public.importb2b_products(owner_id,name,category,sku,active,catalog_visible,source,source_payload)
        values(uid,v_product_name,v_category,v_sku,true,true,'purchase_order',jsonb_build_object('order_number',v_order_no)) returning id into v_product_id;
      else v_product_id:=existing_product.id; end if;

      select * into existing_variant from public.importb2b_product_variants pv
      where pv.owner_id=uid and pv.product_id=v_product_id and pv.active=true and lower(trim(pv.variant_name))=lower(coalesce(nullif(v_variant_name,''),'Única'))
      order by pv.created_at limit 1;
      if existing_variant.id is null then
        insert into public.importb2b_product_variants(owner_id,product_id,sku,variant_name,cost_ars,price_ars,stock_min,active,source,source_payload)
        values(uid,v_product_id,v_sku,coalesce(nullif(v_variant_name,''),'Única'),null,null,0,true,'purchase_order',jsonb_build_object('order_number',v_order_no)) returning id into v_variant_id;
      else v_variant_id:=existing_variant.id; end if;
    end if;

    v_landed_usdt:=v_supplier_usdt+v_shipping_per_unit;v_landed_ars:=v_landed_usdt*p_usdt_rate;
    insert into public.importb2b_order_items(owner_id,order_id,category,product,detail,quantity,original_usd,cost_usd,dollar_rate,cost_ars,excluded_from_stock,product_id,variant_id,received_quantity,stock_link_status)
    values(uid,v_order_id,v_category,v_product_name,v_variant_name,v_qty,v_supplier_usdt,v_landed_usdt,p_usdt_rate,v_landed_ars,false,v_product_id,v_variant_id,0,'linked') returning id into v_item_id;
    insert into public.importb2b_order_item_allocations(owner_id,order_item_id,product_id,variant_id,ordered_quantity,received_quantity,unit_cost_ars)
    values(uid,v_item_id,v_product_id,v_variant_id,v_qty,0,v_landed_ars);
    update public.importb2b_product_variants set cost_ars=v_landed_ars,updated_at=now() where id=v_variant_id;
  end loop;

  insert into public.audit_log(entity_type,entity_id,action,actor_id,new_data)
  values('purchase_order',null,'INSERT',uid,jsonb_build_object('order_id',v_order_id,'order_number',v_order_no,'units',v_total_units,'investment_usdt',v_investment));
  return jsonb_build_object('order_id',v_order_id,'order_number',v_order_no,'total_units',v_total_units,'merchandise_usdt',v_merch_usdt,'shipping_usdt',v_shipping_usdt,'investment_usdt',v_investment);
end;$$;
grant execute on function public.importb2b_create_purchase_order(date,numeric,numeric,text,text,text,jsonb) to authenticated;

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
  values('expense',p_amount_ars,'ARS',method,'COMPRA','Compra / mercadería · Pedido #'||o.order_number,now(),p_amount_ars,uid,'purchase_order',gen_random_uuid(),case when method='efectivo' then holder end,case when method='transferencia' then holder end)
  returning id into mid;
  update public.importb2b_orders set purchase_payment_method=method,purchase_payment_holder=holder,purchase_payment_amount_ars=p_amount_ars,purchase_payment_movement_id=mid,purchase_paid_at=now(),updated_at=now() where id=o.id;
  insert into public.audit_log(entity_type,entity_id,action,actor_id,new_data) values('purchase_order',null,'UPDATE',uid,jsonb_build_object('order_id',o.id,'payment_movement_id',mid,'amount_ars',p_amount_ars,'method',method,'holder',holder));
  return jsonb_build_object('order_id',o.id,'movement_id',mid,'amount_ars',p_amount_ars,'method',method,'holder',holder);
end;$$;
grant execute on function public.importb2b_register_purchase_payment(bigint,numeric,text,text) to authenticated;

create or replace function public.importb2b_create_expense(
  p_date date,p_type text,p_provider text,p_description text,p_amount_ars numeric,p_amount_usd numeric,p_dollar_rate numeric,
  p_order_id bigint default null,p_product_id uuid default null,p_payment_method text default null,p_holder text default null
) returns jsonb
language plpgsql security invoker set search_path=public as $$
declare uid uuid:=auth.uid();eid bigint;mid uuid;method text:=nullif(lower(trim(coalesce(p_payment_method,''))),'');holder text:=nullif(lower(trim(coalesce(p_holder,''))),'');ars numeric:=coalesce(p_amount_ars,0);
begin
  if uid is null then raise exception 'No autenticado'; end if;
  if p_date is null then raise exception 'Ingresá la fecha'; end if;
  if ars<=0 and coalesce(p_amount_usd,0)<=0 then raise exception 'Ingresá un monto'; end if;
  if method is not null and method not in ('efectivo','transferencia') then raise exception 'Método inválido'; end if;
  if method is not null and holder not in ('nahuel','esteban') then raise exception 'Elegí quién pagó'; end if;
  if ars<=0 and coalesce(p_amount_usd,0)>0 and coalesce(p_dollar_rate,0)>0 then ars:=p_amount_usd*p_dollar_rate; end if;
  if method is not null and ars>0 then
    insert into public.movements(kind,amount,currency,payment_method,category,description,occurred_at,ars_equivalent,created_by,source_type,source_id,cash_holder,transfer_holder)
    values('expense',ars,'ARS',method,upper(coalesce(p_type,'GASTO')),coalesce(nullif(trim(p_description),''),'Gasto IMPORTB2B'),now(),ars,uid,'manual',null,case when method='efectivo' then holder end,case when method='transferencia' then holder end)
    returning id into mid;
  end if;
  insert into public.importb2b_expenses(owner_id,expense_date,expense_type,provider,description,amount_ars,amount_usd,dollar_rate,order_id,product_id,finance_movement_id,payment_method,holder)
  values(uid,p_date,coalesce(nullif(trim(p_type),''),'Otro'),nullif(trim(coalesce(p_provider,'')),''),nullif(trim(coalesce(p_description,'')),''),ars,p_amount_usd,p_dollar_rate,p_order_id,p_product_id,mid,method,holder)
  returning id into eid;
  return jsonb_build_object('expense_id',eid,'movement_id',mid,'amount_ars',ars);
end;$$;
grant execute on function public.importb2b_create_expense(date,text,text,text,numeric,numeric,numeric,bigint,uuid,text,text) to authenticated;

create or replace function public.importb2b_mark_shipment_picked_up(p_shipment_id bigint)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare uid uuid:=auth.uid();s public.importb2b_shipments;
begin
  if uid is null then raise exception 'No autenticado'; end if;
  select * into s from public.importb2b_shipments where id=p_shipment_id and owner_id=uid for update;
  if s.id is null then raise exception 'Seguimiento no encontrado'; end if;
  update public.importb2b_shipments set is_received=true,received_at=now(),normalized_status='RECEIVED',updated_at=now() where id=s.id;
  update public.importb2b_orders set purchase_status='picked_up',updated_at=now() where id=s.order_id and owner_id=uid;
  return jsonb_build_object('shipment_id',s.id,'order_id',s.order_id,'status','RECEIVED');
end;$$;
grant execute on function public.importb2b_mark_shipment_picked_up(bigint) to authenticated;

create or replace function public.importb2b_save_wholesale_price(p_variant_id uuid,p_min_quantity integer,p_price_ars numeric)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare uid uuid:=auth.uid();wid uuid;
begin
  if uid is null then raise exception 'No autenticado'; end if;
  if p_min_quantity not in (6,12,36) then raise exception 'Escalón no válido'; end if;
  if coalesce(p_price_ars,0)<0 then raise exception 'Precio inválido'; end if;
  if not exists(select 1 from public.importb2b_product_variants where id=p_variant_id and owner_id=uid) then raise exception 'Variante no encontrada'; end if;
  insert into public.importb2b_variant_wholesale_prices(owner_id,variant_id,min_quantity,price_ars,source)
  values(uid,p_variant_id,p_min_quantity,p_price_ars,'manual')
  on conflict(owner_id,variant_id,min_quantity) do update set price_ars=excluded.price_ars,source='manual',updated_at=now()
  returning id into wid;
  if p_min_quantity=6 then update public.importb2b_product_variants set wholesale_price_ars=p_price_ars,updated_at=now() where id=p_variant_id; end if;
  return jsonb_build_object('id',wid,'variant_id',p_variant_id,'min_quantity',p_min_quantity,'price_ars',p_price_ars);
end;$$;
grant execute on function public.importb2b_save_wholesale_price(uuid,integer,numeric) to authenticated;

create or replace function public.importb2b_adjust_club_points(p_membership_id uuid,p_new_points integer,p_reason text)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare uid uuid:=auth.uid();m public.importb2b_club_memberships;old_points integer;r record;
begin
  if uid is null then raise exception 'No autenticado'; end if;
  if p_new_points<0 then raise exception 'Los puntos no pueden ser negativos'; end if;
  if nullif(trim(coalesce(p_reason,'')),'') is null then raise exception 'Indicá el motivo del ajuste'; end if;
  select * into m from public.importb2b_club_memberships where id=p_membership_id and owner_id=uid for update;
  if m.id is null then raise exception 'Membresía no encontrada'; end if;
  old_points:=m.points;
  update public.importb2b_club_memberships set points=p_new_points,updated_at=now() where id=m.id;
  delete from public.importb2b_club_reward_claims where membership_id=m.id and status='pending' and milestone>p_new_points;
  for r in select * from public.importb2b_club_reward_rules where owner_id=uid and club_type=m.club_type and active=true and milestone<=p_new_points loop
    insert into public.importb2b_club_reward_claims(owner_id,customer_id,membership_id,club_type,milestone,reward_name,status)
    values(uid,m.customer_id,m.id,m.club_type,r.milestone,r.reward_name,'pending')
    on conflict(owner_id,customer_id,club_type,milestone) do nothing;
  end loop;
  insert into public.importb2b_club_events(owner_id,customer_id,event_type,description,credit_amount,metadata,occurred_at)
  values(uid,m.customer_id,'points_adjustment','Ajuste manual de puntos: '||old_points||' → '||p_new_points,p_new_points-old_points,jsonb_build_object('club_type',m.club_type,'old_points',old_points,'new_points',p_new_points,'reason',trim(p_reason)),now());
  insert into public.audit_log(entity_type,entity_id,action,actor_id,old_data,new_data)
  values('club_membership',m.id,'UPDATE',uid,to_jsonb(m),jsonb_build_object('points',p_new_points,'reason',trim(p_reason)));
  return jsonb_build_object('membership_id',m.id,'old_points',old_points,'new_points',p_new_points);
end;$$;
grant execute on function public.importb2b_adjust_club_points(uuid,integer,text) to authenticated;

create or replace function public.importb2b_archive_customer(p_customer_id uuid,p_reason text default null)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare uid uuid:=auth.uid();c public.importb2b_customers;
begin
  if uid is null then raise exception 'No autenticado'; end if;
  select * into c from public.importb2b_customers where id=p_customer_id and owner_id=uid for update;
  if c.id is null then raise exception 'Cliente no encontrado'; end if;
  update public.importb2b_customers set active=false,notes=concat_ws(E'\n',notes,'ARCHIVADO: '||coalesce(nullif(trim(p_reason),''),'Sin motivo')),updated_at=now() where id=c.id;
  insert into public.audit_log(entity_type,entity_id,action,actor_id,old_data,new_data) values('customer',c.id,'UPDATE',uid,to_jsonb(c),jsonb_build_object('active',false,'reason',p_reason));
  return jsonb_build_object('customer_id',c.id,'active',false);
end;$$;
grant execute on function public.importb2b_archive_customer(uuid,text) to authenticated;

create or replace function public.importb2b_delete_customer_safe(p_customer_id uuid)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare uid uuid:=auth.uid();c public.importb2b_customers;refs integer;
begin
  if uid is null then raise exception 'No autenticado'; end if;
  select * into c from public.importb2b_customers where id=p_customer_id and owner_id=uid for update;
  if c.id is null then raise exception 'Cliente no encontrado'; end if;
  refs:=(select count(*) from public.importb2b_sales where customer_id=c.id)+(select count(*) from public.receivables where customer_id=c.id)+(select count(*) from public.importb2b_club_memberships where customer_id=c.id);
  if refs>0 then raise exception 'Este cliente tiene historial. Unificalo o archivá la ficha para no perder trazabilidad.'; end if;
  insert into public.audit_log(entity_type,entity_id,action,actor_id,old_data) values('customer',c.id,'DELETE',uid,to_jsonb(c));
  delete from public.importb2b_customers where id=c.id;
  return jsonb_build_object('customer_id',c.id,'deleted',true);
end;$$;
grant execute on function public.importb2b_delete_customer_safe(uuid) to authenticated;

create or replace function public.importb2b_merge_customers(p_target_customer_id uuid,p_source_customer_id uuid)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare uid uuid:=auth.uid();t public.importb2b_customers;s public.importb2b_customers;sm record;tm public.importb2b_club_memberships;tc public.importb2b_club_reward_claims;sc record;action_points integer;
begin
  if uid is null then raise exception 'No autenticado'; end if;
  if p_target_customer_id=p_source_customer_id then raise exception 'Elegí dos clientes distintos'; end if;
  select * into t from public.importb2b_customers where id=p_target_customer_id and owner_id=uid for update;
  select * into s from public.importb2b_customers where id=p_source_customer_id and owner_id=uid for update;
  if t.id is null or s.id is null then raise exception 'Cliente no encontrado'; end if;

  update public.importb2b_sales set customer_id=t.id where customer_id=s.id;
  update public.receivables set customer_id=t.id,client_name=t.full_name,client_phone=coalesce(t.phone,client_phone) where customer_id=s.id;
  update public.importb2b_club_legacy_customer_map set customer_id=t.id where customer_id=s.id;
  update public.importb2b_club_events set customer_id=t.id where customer_id=s.id;

  for sm in select * from public.importb2b_club_memberships where customer_id=s.id loop
    select * into tm from public.importb2b_club_memberships where owner_id=uid and customer_id=t.id and club_type=sm.club_type;
    if tm.id is null then
      update public.importb2b_club_memberships set customer_id=t.id where id=sm.id;
      update public.importb2b_club_actions set customer_id=t.id where membership_id=sm.id;
      update public.importb2b_club_reward_claims set customer_id=t.id where membership_id=sm.id;
    else
      for sc in select * from public.importb2b_club_reward_claims where membership_id=sm.id loop
        select * into tc from public.importb2b_club_reward_claims where owner_id=uid and customer_id=t.id and club_type=sc.club_type and milestone=sc.milestone;
        if tc.id is null then
          update public.importb2b_club_reward_claims set customer_id=t.id,membership_id=tm.id where id=sc.id;
        else
          if sc.status='delivered' and tc.status<>'delivered' then update public.importb2b_club_reward_claims set status='delivered',delivered_at=sc.delivered_at,delivered_by=sc.delivered_by where id=tc.id; end if;
          delete from public.importb2b_club_reward_claims where id=sc.id;
        end if;
      end loop;
      update public.importb2b_club_actions set customer_id=t.id,membership_id=tm.id where membership_id=sm.id;
      select coalesce(sum(point_value),0)::integer into action_points from public.importb2b_club_actions where membership_id=tm.id;
      update public.importb2b_club_memberships set points=greatest(tm.points,sm.points,action_points),active=(tm.active or sm.active),joined_at=least(tm.joined_at,sm.joined_at),updated_at=now() where id=tm.id;
      delete from public.importb2b_club_memberships where id=sm.id;
    end if;
  end loop;

  if exists(select 1 from public.importb2b_club_profiles where customer_id=s.id) then
    if exists(select 1 from public.importb2b_club_profiles where customer_id=t.id) then delete from public.importb2b_club_profiles where customer_id=s.id;
    else update public.importb2b_club_profiles set customer_id=t.id,updated_at=now() where customer_id=s.id; end if;
  end if;

  update public.importb2b_customers set
    phone=coalesce(nullif(phone,''),s.phone),email=coalesce(nullif(email,''),s.email),instagram_username=coalesce(nullif(instagram_username,''),s.instagram_username),address=coalesce(nullif(address,''),s.address),
    notes=concat_ws(E'\n',notes,nullif(s.notes,''),'Unificado con '||s.full_name||' el '||to_char(now(),'DD/MM/YYYY HH24:MI')),updated_at=now()
  where id=t.id;
  update public.importb2b_customers set active=false,notes=concat_ws(E'\n',notes,'UNIFICADO EN: '||t.full_name),updated_at=now() where id=s.id;
  insert into public.audit_log(entity_type,entity_id,action,actor_id,old_data,new_data) values('customer',s.id,'UPDATE',uid,to_jsonb(s),jsonb_build_object('merged_into',t.id));
  return jsonb_build_object('target_customer_id',t.id,'source_customer_id',s.id,'merged',true);
end;$$;
grant execute on function public.importb2b_merge_customers(uuid,uuid) to authenticated;
