-- IMPORTB2B Central 6.3
-- Mobile UX, finance holder routing, quick sales and optimized catalog images.

alter table public.importb2b_product_images
  add column if not exists thumbnail_url text,
  add column if not exists thumbnail_storage_path text,
  add column if not exists original_size_bytes bigint,
  add column if not exists optimized_size_bytes bigint,
  add column if not exists width integer,
  add column if not exists height integer,
  add column if not exists mime_type text;

alter table public.importb2b_sales
  add column if not exists stock_link_status text not null default 'linked';

alter table public.importb2b_sales drop constraint if exists importb2b_sales_stock_link_status_check;
alter table public.importb2b_sales add constraint importb2b_sales_stock_link_status_check
  check (stock_link_status in ('linked','pending','not_required'));

update public.importb2b_sales
set stock_link_status='linked'
where stock_link_status is null;

create index if not exists importb2b_sales_stock_link_status_idx
on public.importb2b_sales(owner_id,stock_link_status,status,sold_at desc);

-- Assign / reassign the physical holder of a finance movement without creating a new movement.
create or replace function public.importb2b_assign_movement_holder(
  p_movement_id uuid,
  p_holder text
) returns jsonb
language plpgsql
security invoker
set search_path=public
as $$
declare
  v_uid uuid:=auth.uid();
  m public.movements;
  old_row jsonb;
  h text:=lower(trim(coalesce(p_holder,'')));
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  if h not in ('nahuel','esteban') then raise exception 'Titular inválido'; end if;

  select * into m from public.movements
  where id=p_movement_id and created_by=v_uid
  for update;
  if m.id is null then raise exception 'Movimiento no encontrado'; end if;
  if m.payment_method not in ('efectivo','transferencia','usdt') then raise exception 'Este movimiento no admite titular'; end if;

  old_row:=to_jsonb(m);
  update public.movements
  set cash_holder=case when m.payment_method='efectivo' then h else null end,
      transfer_holder=case when m.payment_method='transferencia' then h else null end,
      usdt_holder=case when m.payment_method='usdt' then h else null end,
      edited_at=now(),edited_by=v_uid
  where id=m.id;

  insert into public.audit_log(entity_type,entity_id,action,actor_id,old_data,new_data)
  select 'movement',m.id,'UPDATE',v_uid,old_row,to_jsonb(x)
  from public.movements x where x.id=m.id;

  return jsonb_build_object('movement_id',m.id,'holder',h,'payment_method',m.payment_method);
end;
$$;
grant execute on function public.importb2b_assign_movement_holder(uuid,text) to authenticated;

-- Replace sale completion with holder-aware version.
drop function if exists public.importb2b_complete_sale(uuid,jsonb,uuid,numeric,numeric,text);
create or replace function public.importb2b_complete_sale(
  p_customer_id uuid,
  p_items jsonb,
  p_payment_method_id uuid,
  p_shipping_ars numeric default 0,
  p_discount_ars numeric default 0,
  p_notes text default null,
  p_holder text default null
) returns jsonb
language plpgsql
security invoker
set search_path=public
as $$
declare
  v_uid uuid:=auth.uid();
  v_sale_id uuid;
  v_sale_code text;
  v_method public.importb2b_payment_methods;
  v_customer public.importb2b_customers;
  x jsonb;
  v_variant public.importb2b_product_variants;
  v_product public.importb2b_products;
  v_qty numeric;
  v_price numeric;
  v_cost numeric;
  v_available numeric;
  v_subtotal numeric:=0;
  v_profit numeric:=0;
  v_base numeric;
  v_adjustment numeric:=0;
  v_total numeric;
  v_movement_id uuid;
  v_settlement_id uuid;
  v_payment_status text:='paid';
  v_expected date;
  v_desc text;
  v_provider text;
  v_holder text:=lower(trim(coalesce(p_holder,'')));
  v_fin_method text;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then raise exception 'La venta necesita al menos un producto'; end if;
  if coalesce(p_shipping_ars,0)<0 or coalesce(p_discount_ars,0)<0 then raise exception 'Envío o descuento inválido'; end if;

  select * into v_method from public.importb2b_payment_methods
  where id=p_payment_method_id and owner_id=v_uid and active=true;
  if v_method.id is null then raise exception 'Forma de pago no válida'; end if;

  v_fin_method:=coalesce(v_method.finance_payment_method,'transferencia');
  if v_method.finance_mode='movement' then
    if v_holder not in ('nahuel','esteban') then raise exception 'Elegí quién recibe el dinero: Nahuel o Esteban'; end if;
    if v_fin_method not in ('efectivo','transferencia') then raise exception 'Forma financiera no soportada por ventas ARS'; end if;
  end if;

  if p_customer_id is not null then
    select * into v_customer from public.importb2b_customers
    where id=p_customer_id and owner_id=v_uid and active=true;
    if v_customer.id is null then raise exception 'Cliente no válido'; end if;
  end if;
  if v_method.finance_mode='receivable' and v_customer.id is null then raise exception 'La venta a cuenta corriente necesita un cliente'; end if;

  v_sale_code:='V-'||lpad(nextval('public.importb2b_sale_number_seq')::text,6,'0');
  insert into public.importb2b_sales(
    owner_id,sale_code,status,customer_id,subtotal_ars,discount_ars,fee_ars,shipping_ars,total_ars,
    profit_ars,original_payment_method,notes,seller_name,source,sold_at,created_by,stock_link_status
  ) values(
    v_uid,v_sale_code,'completed',p_customer_id,0,coalesce(p_discount_ars,0),0,coalesce(p_shipping_ars,0),0,
    0,v_method.name,p_notes,coalesce((select full_name from public.profiles where id=v_uid),auth.email()),
    'central_pos',now(),v_uid,'linked'
  ) returning id into v_sale_id;

  for x in select value from jsonb_array_elements(p_items)
  loop
    v_qty:=coalesce(nullif(x->>'quantity','')::numeric,0);
    if v_qty<=0 then raise exception 'Cantidad inválida'; end if;
    select * into v_variant from public.importb2b_product_variants
    where id=(x->>'variant_id')::uuid and owner_id=v_uid and active=true for update;
    if v_variant.id is null then raise exception 'Variante no encontrada'; end if;
    select * into v_product from public.importb2b_products where id=v_variant.product_id and owner_id=v_uid and active=true;
    if v_product.id is null then raise exception 'Producto no encontrado'; end if;

    select coalesce(sum(quantity_delta) filter(where bucket='on_hand'),0)-coalesce(sum(quantity_delta) filter(where bucket='reserved'),0)
    into v_available from public.importb2b_inventory_movements where variant_id=v_variant.id;
    if v_available<v_qty then raise exception 'Stock insuficiente para % / %. Disponible: %',v_product.name,v_variant.variant_name,v_available; end if;

    v_price:=coalesce(nullif(x->>'unit_price_ars','')::numeric,v_variant.price_ars,0);
    v_cost:=coalesce(v_variant.cost_ars,0);
    if v_price<0 then raise exception 'Precio inválido'; end if;

    insert into public.importb2b_sale_items(owner_id,sale_id,product_id,variant_id,original_item_name,quantity,unit_price_ars,unit_cost_ars,line_total_ars,source_payload)
    values(v_uid,v_sale_id,v_product.id,v_variant.id,v_product.name||case when v_variant.variant_name<>'Única' then ' - '||v_variant.variant_name else '' end,
      v_qty,v_price,v_cost,v_qty*v_price,'{}'::jsonb);

    insert into public.importb2b_inventory_movements(owner_id,product_id,variant_id,bucket,movement_type,quantity_delta,unit_cost_ars,reference_type,reference_id,note,created_by)
    values(v_uid,v_product.id,v_variant.id,'on_hand','sale',-v_qty,v_cost,'sale',v_sale_id::text,'Venta '||v_sale_code,v_uid);

    v_subtotal:=v_subtotal+(v_qty*v_price);
    v_profit:=v_profit+(v_qty*(v_price-v_cost));
  end loop;

  if coalesce(p_discount_ars,0)>v_subtotal+coalesce(p_shipping_ars,0) then raise exception 'El descuento supera el total base'; end if;
  v_base:=v_subtotal-coalesce(p_discount_ars,0)+coalesce(p_shipping_ars,0);
  if v_method.adjustment_kind='percent' then v_adjustment:=round(v_base*coalesce(v_method.adjustment_value,0)/100.0,2);
  elsif v_method.adjustment_kind='fixed' then v_adjustment:=coalesce(v_method.adjustment_value,0); else v_adjustment:=0; end if;
  if v_method.adjustment_direction='discount' then v_adjustment:=-abs(v_adjustment); else v_adjustment:=abs(v_adjustment); end if;
  v_total:=v_base+v_adjustment;
  if v_total<0 then raise exception 'Total final inválido'; end if;

  update public.importb2b_sales set subtotal_ars=v_subtotal,discount_ars=coalesce(p_discount_ars,0),fee_ars=v_adjustment,
    shipping_ars=coalesce(p_shipping_ars,0),total_ars=v_total,profit_ars=v_profit,original_payment_method=v_method.name,updated_at=now()
  where id=v_sale_id;

  v_desc:='Venta '||v_sale_code||' · '||v_method.name;
  if v_method.finance_mode='movement' then
    insert into public.movements(kind,amount,currency,payment_method,category,description,occurred_at,quote_type,quote_ars,ars_equivalent,
      created_by,source_type,source_id,cash_holder,transfer_holder,usdt_holder)
    values('income',v_total,'ARS',v_fin_method,'VENTA',v_desc,now(),null,null,v_total,v_uid,'sale',v_sale_id,
      case when v_fin_method='efectivo' then v_holder else null end,
      case when v_fin_method='transferencia' then v_holder else null end,
      null)
    returning id into v_movement_id;
    v_payment_status:='paid';
  elsif v_method.finance_mode='settlement' then
    if v_method.settlement_business_days then v_expected:=public.importb2b_add_business_days(v_uid,current_date,coalesce(v_method.settlement_days,0));
    else v_expected:=current_date+coalesce(v_method.settlement_days,0); end if;
    v_provider:=case when v_method.code='go_cuotas' then 'go_cuotas' when v_method.code='credit' then 'tarjeta_credito' else 'otro' end;
    insert into public.settlements(provider,description,gross_amount,fees_amount,expected_at,status,destination_method,created_by,source_type,source_id,payment_method_id)
    values(v_provider,v_desc,v_total,0,v_expected,'pending','transferencia',v_uid,'sale',v_sale_id,v_method.id)
    returning id into v_settlement_id;
    v_payment_status:='settling';
  elsif v_method.finance_mode='receivable' then
    insert into public.receivables(client_name,client_phone,description,total_amount,paid_amount,due_at,status,created_by,customer_id,source_type,source_id)
    values(v_customer.full_name,v_customer.phone,v_desc,v_total,0,null,'pending',v_uid,v_customer.id,'sale',v_sale_id);
    v_payment_status:='pending';
  else v_payment_status:='pending'; end if;

  insert into public.importb2b_sale_payments(owner_id,sale_id,payment_method_id,base_amount_ars,adjustment_amount_ars,amount_ars,status,movement_id,settlement_id)
  values(v_uid,v_sale_id,v_method.id,v_base,v_adjustment,v_total,v_payment_status,v_movement_id,v_settlement_id);

  return jsonb_build_object('sale_id',v_sale_id,'sale_code',v_sale_code,'subtotal_ars',v_subtotal,'discount_ars',coalesce(p_discount_ars,0),
    'shipping_ars',coalesce(p_shipping_ars,0),'adjustment_ars',v_adjustment,'total_ars',v_total,'profit_ars',v_profit,
    'payment_method',v_method.name,'finance_mode',v_method.finance_mode,'movement_id',v_movement_id,'settlement_id',v_settlement_id,
    'expected_settlement_at',v_expected,'customer_id',p_customer_id,'holder',nullif(v_holder,''),'sold_at',now(),'stock_link_status','linked');
end;
$$;
grant execute on function public.importb2b_complete_sale(uuid,jsonb,uuid,numeric,numeric,text,text) to authenticated;

-- Quick sale: records money immediately but leaves stock pending until linked.
create or replace function public.importb2b_complete_quick_sale(
  p_amount_ars numeric,
  p_payment_method_id uuid,
  p_holder text default null,
  p_customer_id uuid default null,
  p_notes text default null
) returns jsonb
language plpgsql
security invoker
set search_path=public
as $$
declare
  v_uid uuid:=auth.uid();
  v_method public.importb2b_payment_methods;
  v_customer public.importb2b_customers;
  v_sale_id uuid;v_sale_code text;v_movement uuid;v_settlement uuid;v_expected date;v_provider text;
  v_status text:='paid';v_holder text:=lower(trim(coalesce(p_holder,'')));v_fin_method text;v_amount numeric:=coalesce(p_amount_ars,0);
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  if v_amount<=0 then raise exception 'Monto inválido'; end if;
  select * into v_method from public.importb2b_payment_methods where id=p_payment_method_id and owner_id=v_uid and active=true;
  if v_method.id is null then raise exception 'Forma de pago no válida'; end if;
  v_fin_method:=coalesce(v_method.finance_payment_method,'transferencia');
  if v_method.finance_mode='movement' and v_holder not in ('nahuel','esteban') then raise exception 'Elegí quién recibe el dinero'; end if;
  if v_method.finance_mode='movement' and v_fin_method not in ('efectivo','transferencia') then raise exception 'Venta fugaz USDT requiere registro manual con cotización'; end if;

  if p_customer_id is not null then select * into v_customer from public.importb2b_customers where id=p_customer_id and owner_id=v_uid and active=true; end if;
  if v_method.finance_mode='receivable' and v_customer.id is null then raise exception 'Cuenta corriente requiere cliente'; end if;

  v_sale_code:='V-'||lpad(nextval('public.importb2b_sale_number_seq')::text,6,'0');
  insert into public.importb2b_sales(owner_id,sale_code,status,customer_id,subtotal_ars,discount_ars,fee_ars,shipping_ars,total_ars,
    profit_ars,original_payment_method,notes,seller_name,source,sold_at,created_by,stock_link_status)
  values(v_uid,v_sale_code,'completed',p_customer_id,v_amount,0,0,0,v_amount,null,v_method.name,p_notes,
    coalesce((select full_name from public.profiles where id=v_uid),auth.email()),'central_quick_sale',now(),v_uid,'pending')
  returning id into v_sale_id;

  if v_method.finance_mode='movement' then
    insert into public.movements(kind,amount,currency,payment_method,category,description,occurred_at,ars_equivalent,created_by,source_type,source_id,cash_holder,transfer_holder)
    values('income',v_amount,'ARS',v_fin_method,'VENTA','Venta fugaz '||v_sale_code,now(),v_amount,v_uid,'sale',v_sale_id,
      case when v_fin_method='efectivo' then v_holder else null end,case when v_fin_method='transferencia' then v_holder else null end)
    returning id into v_movement;
  elsif v_method.finance_mode='settlement' then
    if v_method.settlement_business_days then v_expected:=public.importb2b_add_business_days(v_uid,current_date,coalesce(v_method.settlement_days,0));
    else v_expected:=current_date+coalesce(v_method.settlement_days,0); end if;
    v_provider:=case when v_method.code='go_cuotas' then 'go_cuotas' when v_method.code='credit' then 'tarjeta_credito' else 'otro' end;
    insert into public.settlements(provider,description,gross_amount,fees_amount,expected_at,status,destination_method,created_by,source_type,source_id,payment_method_id)
    values(v_provider,'Venta fugaz '||v_sale_code,v_amount,0,v_expected,'pending','transferencia',v_uid,'sale',v_sale_id,v_method.id)
    returning id into v_settlement;v_status:='settling';
  elsif v_method.finance_mode='receivable' then
    insert into public.receivables(client_name,client_phone,description,total_amount,paid_amount,status,created_by,customer_id,source_type,source_id)
    values(v_customer.full_name,v_customer.phone,'Venta fugaz '||v_sale_code,v_amount,0,'pending',v_uid,v_customer.id,'sale',v_sale_id);v_status:='pending';
  end if;

  insert into public.importb2b_sale_payments(owner_id,sale_id,payment_method_id,base_amount_ars,adjustment_amount_ars,amount_ars,status,movement_id,settlement_id)
  values(v_uid,v_sale_id,v_method.id,v_amount,0,v_amount,v_status,v_movement,v_settlement);

  return jsonb_build_object('sale_id',v_sale_id,'sale_code',v_sale_code,'total_ars',v_amount,'payment_method',v_method.name,
    'finance_mode',v_method.finance_mode,'holder',nullif(v_holder,''),'stock_link_status','pending','sold_at',now());
end;
$$;
grant execute on function public.importb2b_complete_quick_sale(numeric,uuid,text,uuid,text) to authenticated;

create or replace function public.importb2b_link_quick_sale_item(
  p_sale_id uuid,
  p_variant_id uuid,
  p_quantity numeric default 1
) returns jsonb
language plpgsql
security invoker
set search_path=public
as $$
declare
  v_uid uuid:=auth.uid();s public.importb2b_sales;v public.importb2b_product_variants;p public.importb2b_products;
  av numeric;q numeric:=coalesce(p_quantity,0);price numeric;cost numeric;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  if q<=0 then raise exception 'Cantidad inválida'; end if;
  select * into s from public.importb2b_sales where id=p_sale_id and owner_id=v_uid for update;
  if s.id is null or s.status<>'completed' then raise exception 'Venta no disponible'; end if;
  if s.stock_link_status<>'pending' then raise exception 'La venta ya fue vinculada al stock'; end if;
  if exists(select 1 from public.importb2b_sale_items where sale_id=s.id) then raise exception 'La venta fugaz ya tiene un artículo vinculado'; end if;
  select * into v from public.importb2b_product_variants where id=p_variant_id and owner_id=v_uid and active=true for update;
  if v.id is null then raise exception 'Variante no encontrada'; end if;
  select * into p from public.importb2b_products where id=v.product_id and owner_id=v_uid and active=true;
  select coalesce(sum(quantity_delta) filter(where bucket='on_hand'),0)-coalesce(sum(quantity_delta) filter(where bucket='reserved'),0)
  into av from public.importb2b_inventory_movements where variant_id=v.id;
  if av<q then raise exception 'Stock insuficiente. Disponible: %',av; end if;
  price:=round(s.subtotal_ars/q,2);cost:=coalesce(v.cost_ars,0);
  insert into public.importb2b_sale_items(owner_id,sale_id,product_id,variant_id,original_item_name,quantity,unit_price_ars,unit_cost_ars,line_total_ars,source_payload)
  values(v_uid,s.id,p.id,v.id,p.name||case when v.variant_name<>'Única' then ' - '||v.variant_name else '' end,q,price,cost,s.subtotal_ars,jsonb_build_object('quick_sale_link',true));
  insert into public.importb2b_inventory_movements(owner_id,product_id,variant_id,bucket,movement_type,quantity_delta,unit_cost_ars,reference_type,reference_id,note,created_by)
  values(v_uid,p.id,v.id,'on_hand','sale',-q,cost,'sale',s.id::text,'Vinculación venta fugaz '||s.sale_code,v_uid);
  update public.importb2b_sales set stock_link_status='linked',profit_ars=s.subtotal_ars-(q*cost),updated_at=now() where id=s.id;
  return jsonb_build_object('sale_id',s.id,'sale_code',s.sale_code,'stock_link_status','linked','variant_id',v.id,'quantity',q);
end;
$$;
grant execute on function public.importb2b_link_quick_sale_item(uuid,uuid,numeric) to authenticated;

-- Cancellation keeps history but reverses stock and every finance effect, preserving holders.
create or replace function public.importb2b_cancel_sale(p_sale_id uuid,p_reason text default null)
returns jsonb
language plpgsql
security invoker
set search_path=public
as $$
declare
  v_uid uuid:=auth.uid();s public.importb2b_sales;i record;pmt record;m public.movements;rv uuid;r record;rp record;st record;
  reason text:=coalesce(nullif(trim(p_reason),''),'Sin motivo informado');
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  select * into s from public.importb2b_sales where id=p_sale_id and owner_id=v_uid for update;
  if s.id is null then raise exception 'Venta no encontrada'; end if;
  if s.status='cancelled' then raise exception 'La venta ya está anulada'; end if;
  if s.status<>'completed' then raise exception 'Solo se pueden anular ventas completadas'; end if;

  for i in select * from public.importb2b_sale_items where sale_id=s.id loop
    insert into public.importb2b_inventory_movements(owner_id,product_id,variant_id,bucket,movement_type,quantity_delta,unit_cost_ars,reference_type,reference_id,note,created_by)
    values(v_uid,i.product_id,i.variant_id,'on_hand','sale_cancel',i.quantity,i.unit_cost_ars,'sale_cancel',s.id::text,'Anulación '||s.sale_code||' · '||reason,v_uid);
  end loop;

  for pmt in select * from public.importb2b_sale_payments where sale_id=s.id loop
    if pmt.movement_id is not null then
      select * into m from public.movements where id=pmt.movement_id;
      if m.id is not null then
        insert into public.movements(kind,amount,currency,payment_method,category,description,occurred_at,quote_type,quote_ars,ars_equivalent,
          created_by,source_type,source_id,cash_holder,transfer_holder,usdt_holder)
        values('expense',m.amount,m.currency,m.payment_method,'VENTA ANULADA','Anulación '||s.sale_code||' · '||reason,now(),m.quote_type,m.quote_ars,m.ars_equivalent,
          v_uid,'sale',s.id,m.cash_holder,m.transfer_holder,m.usdt_holder) returning id into rv;
      end if;
    end if;
    if pmt.settlement_id is not null then
      select * into st from public.settlements where id=pmt.settlement_id;
      if st.id is not null and st.status='settled' and st.movement_id is not null then
        select * into m from public.movements where id=st.movement_id;
        if m.id is not null then
          insert into public.movements(kind,amount,currency,payment_method,category,description,occurred_at,quote_type,quote_ars,ars_equivalent,
            created_by,source_type,source_id,cash_holder,transfer_holder,usdt_holder)
          values('expense',m.amount,m.currency,m.payment_method,'VENTA ANULADA','Reversión liquidación · '||s.sale_code,now(),m.quote_type,m.quote_ars,m.ars_equivalent,
            v_uid,'sale',s.id,m.cash_holder,m.transfer_holder,m.usdt_holder);
        end if;
      end if;
      update public.settlements set status='cancelled',updated_at=now() where id=pmt.settlement_id;
    end if;
    update public.importb2b_sale_payments set status='cancelled' where id=pmt.id;
  end loop;

  for r in select * from public.receivables where source_type='sale' and source_id=s.id loop
    for rp in select * from public.receivable_payments where receivable_id=r.id loop
      if rp.movement_id is not null then
        select * into m from public.movements where id=rp.movement_id;
        if m.id is not null then
          insert into public.movements(kind,amount,currency,payment_method,category,description,occurred_at,quote_type,quote_ars,ars_equivalent,
            created_by,source_type,source_id,cash_holder,transfer_holder,usdt_holder)
          values('expense',m.amount,m.currency,m.payment_method,'VENTA ANULADA','Reversión cobro · '||s.sale_code,now(),m.quote_type,m.quote_ars,m.ars_equivalent,
            v_uid,'sale',s.id,m.cash_holder,m.transfer_holder,m.usdt_holder);
        end if;
      end if;
    end loop;
    update public.receivables set status='cancelled',updated_at=now() where id=r.id;
  end loop;

  update public.importb2b_sales set status='cancelled',notes=concat_ws(E'\n',notes,'ANULADA: '||reason),updated_at=now() where id=s.id;
  insert into public.audit_log(entity_type,entity_id,action,actor_id,old_data,new_data)
  values('sale',s.id,'UPDATE',v_uid,to_jsonb(s),jsonb_build_object('status','cancelled','reason',reason));
  return jsonb_build_object('sale_id',s.id,'sale_code',s.sale_code,'status','cancelled','reversal_movement_id',rv);
end;
$$;
grant execute on function public.importb2b_cancel_sale(uuid,text) to authenticated;

-- Web order confirmation now asks who receives immediate cash/transfer funds.
drop function if exists public.importb2b_confirm_web_order(uuid);
create or replace function public.importb2b_confirm_web_order(p_order_id uuid,p_holder text default null)
returns jsonb
language plpgsql
security invoker
set search_path=public
as $$
declare
  v_uid uuid:=auth.uid();o public.importb2b_web_orders;v_customer_id uuid;v_items jsonb;v_sale jsonb;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  select * into o from public.importb2b_web_orders where id=p_order_id and owner_id=v_uid for update;
  if o.id is null then raise exception 'Pedido web no encontrado'; end if;
  if o.status<>'pending' then raise exception 'El pedido ya fue procesado'; end if;

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
$$;
grant execute on function public.importb2b_confirm_web_order(uuid,text) to authenticated;

-- Public catalog exposes thumbnail URLs for fast grids while keeping full image URLs.
create or replace function public.importb2b_public_catalog_safe(p_slug text default 'importb2b')
returns jsonb
language plpgsql
stable
security definer
set search_path=public
as $$
declare cfg public.importb2b_catalog_settings;v_products jsonb;v_methods jsonb;
begin
  select * into cfg from public.importb2b_catalog_settings where public_slug=lower(trim(p_slug)) and is_public=true limit 1;
  if cfg.owner_id is null then return jsonb_build_object('error','Catálogo no disponible'); end if;

  select coalesce(jsonb_agg(row_data order by row_data->>'name'),'[]'::jsonb) into v_products
  from (
    select jsonb_build_object(
      'id',p.id,'name',p.name,'category',p.category,'description',p.description,
      'image_url',coalesce(p.primary_image_url,(select pi.image_url from public.importb2b_product_images pi where pi.product_id=p.id and pi.image_url is not null order by pi.is_primary desc,pi.sort_order,pi.created_at limit 1)),
      'thumbnail_url',(select coalesce(pi.thumbnail_url,pi.image_url) from public.importb2b_product_images pi where pi.product_id=p.id and pi.image_url is not null order by pi.is_primary desc,pi.sort_order,pi.created_at limit 1),
      'variants',coalesce((select jsonb_agg(jsonb_build_object(
        'id',v.id,'name',v.variant_name,'sku',v.sku,'price_ars',v.price_ars,'in_stock',coalesce(s.available,0)>0,
        'available',case when cfg.show_exact_stock then greatest(coalesce(s.available,0),0) else case when coalesce(s.available,0)>0 then 1 else 0 end end,
        'attributes',coalesce(v.attributes,'{}'::jsonb)) order by v.variant_name)
        from public.importb2b_product_variants v left join public.importb2b_stock_summary s on s.variant_id=v.id
        where v.product_id=p.id and v.active=true and (cfg.show_out_of_stock or coalesce(s.available,0)>0)),'[]'::jsonb)
    ) row_data
    from public.importb2b_products p where p.owner_id=cfg.owner_id and p.active=true and p.catalog_visible=true
  ) x where jsonb_array_length(x.row_data->'variants')>0;

  select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'code',m.code,'name',m.name,'adjustment_kind',m.adjustment_kind,
    'adjustment_direction',m.adjustment_direction,'adjustment_value',m.adjustment_value) order by m.sort_order,m.name),'[]'::jsonb)
  into v_methods from public.importb2b_payment_methods m where m.owner_id=cfg.owner_id and m.active=true and (m.code<>'pay_later' or cfg.allow_pay_later_public=true);

  return jsonb_build_object('settings',jsonb_build_object('slug',cfg.public_slug,'title',cfg.catalog_title,'subtitle',cfg.catalog_subtitle,
    'whatsapp_number',cfg.whatsapp_number,'show_exact_stock',cfg.show_exact_stock,'show_out_of_stock',cfg.show_out_of_stock,
    'allow_pickup',cfg.allow_pickup,'allow_shipping',cfg.allow_shipping,'pickup_label',cfg.pickup_label,'shipping_label',cfg.shipping_label,
    'shipping_note',cfg.shipping_note,'shipping_fee_ars',cfg.shipping_fee_ars,'min_order_ars',cfg.min_order_ars),
    'payment_methods',v_methods,'products',v_products);
end;
$$;
revoke all on function public.importb2b_public_catalog_safe(text) from public;
grant execute on function public.importb2b_public_catalog_safe(text) to anon,authenticated;
