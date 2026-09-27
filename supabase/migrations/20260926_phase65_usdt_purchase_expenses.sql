-- IMPORTB2B Central 6.5 — pagos de compras y gastos también en USDT.
-- Producción ya tiene esta migración aplicada.

create or replace function public.importb2b_register_purchase_payment(
  p_order_id bigint,p_amount_ars numeric,p_method text,p_holder text
) returns jsonb
language plpgsql security invoker set search_path=public as $$
declare uid uuid:=auth.uid();o public.importb2b_orders;mid uuid;method text:=lower(trim(p_method));holder text:=lower(trim(p_holder));amount_input numeric:=coalesce(p_amount_ars,0);ars_equiv numeric;
begin
  if uid is null then raise exception 'No autenticado'; end if;if amount_input<=0 then raise exception 'Monto inválido'; end if;if method not in ('efectivo','transferencia','usdt') then raise exception 'Medio inválido'; end if;if holder not in ('nahuel','esteban') then raise exception 'Elegí Nahuel o Esteban'; end if;
  select * into o from public.importb2b_orders where id=p_order_id and owner_id=uid for update;if o.id is null then raise exception 'Pedido no encontrado'; end if;if o.purchase_payment_movement_id is not null then raise exception 'Este pedido ya tiene un pago registrado'; end if;if method='usdt' and coalesce(o.usdt_rate_ars,0)<=0 then raise exception 'El pedido no tiene cotización USDT válida'; end if;
  ars_equiv:=case when method='usdt' then amount_input*o.usdt_rate_ars else amount_input end;
  insert into public.movements(kind,amount,currency,payment_method,category,description,occurred_at,quote_type,quote_ars,ars_equivalent,created_by,source_type,source_id,cash_holder,transfer_holder,usdt_holder)
  values('expense',amount_input,case when method='usdt' then 'USDT' else 'ARS' end,method,'COMPRA','Compra / mercadería · Pedido #'||o.order_number,now(),case when method='usdt' then 'buy' end,case when method='usdt' then o.usdt_rate_ars end,ars_equiv,uid,'purchase_order',o.finance_reference_id,case when method='efectivo' then holder end,case when method='transferencia' then holder end,case when method='usdt' then holder end) returning id into mid;
  update public.importb2b_orders set purchase_payment_method=method,purchase_payment_holder=holder,purchase_payment_amount_ars=ars_equiv,purchase_payment_movement_id=mid,purchase_paid_at=now(),updated_at=now() where id=o.id;
  insert into public.audit_log(entity_type,entity_id,action,actor_id,new_data) values('purchase_order',null,'UPDATE',uid,jsonb_build_object('order_id',o.id,'payment_movement_id',mid,'amount_input',amount_input,'amount_ars',ars_equiv,'method',method,'holder',holder));
  return jsonb_build_object('order_id',o.id,'movement_id',mid,'amount',amount_input,'amount_ars',ars_equiv,'method',method,'holder',holder);
end;$$;
grant execute on function public.importb2b_register_purchase_payment(bigint,numeric,text,text) to authenticated;

create or replace function public.importb2b_create_expense(
  p_date date,p_type text,p_provider text,p_description text,p_amount_ars numeric,p_amount_usd numeric,p_dollar_rate numeric,
  p_order_id bigint default null,p_product_id uuid default null,p_payment_method text default null,p_holder text default null
) returns jsonb
language plpgsql security invoker set search_path=public as $$
declare uid uuid:=auth.uid();eid bigint;mid uuid;method text:=nullif(lower(trim(coalesce(p_payment_method,''))),'');holder text:=nullif(lower(trim(coalesce(p_holder,''))),'');ars numeric:=coalesce(p_amount_ars,0);usd numeric:=coalesce(p_amount_usd,0);rate numeric:=coalesce(p_dollar_rate,0);movement_amount numeric;
begin
  if uid is null then raise exception 'No autenticado'; end if;if p_date is null then raise exception 'Ingresá la fecha'; end if;if ars<=0 and usd<=0 then raise exception 'Ingresá un monto'; end if;if method is not null and method not in ('efectivo','transferencia','usdt') then raise exception 'Método inválido'; end if;if method is not null and holder not in ('nahuel','esteban') then raise exception 'Elegí quién pagó'; end if;if ars<=0 and usd>0 and rate>0 then ars:=usd*rate; end if;
  if method is not null then
    if method='usdt' then
      if usd<=0 or rate<=0 then raise exception 'Para un gasto USDT ingresá monto USDT y cotización'; end if;movement_amount:=usd;ars:=usd*rate;
      insert into public.movements(kind,amount,currency,payment_method,category,description,occurred_at,quote_type,quote_ars,ars_equivalent,created_by,source_type,source_id,usdt_holder)
      values('expense',movement_amount,'USDT','usdt',upper(coalesce(p_type,'GASTO')),coalesce(nullif(trim(p_description),''),'Gasto IMPORTB2B'),now(),'buy',rate,ars,uid,'manual',null,holder) returning id into mid;
    elsif ars>0 then
      movement_amount:=ars;
      insert into public.movements(kind,amount,currency,payment_method,category,description,occurred_at,ars_equivalent,created_by,source_type,source_id,cash_holder,transfer_holder)
      values('expense',ars,'ARS',method,upper(coalesce(p_type,'GASTO')),coalesce(nullif(trim(p_description),''),'Gasto IMPORTB2B'),now(),ars,uid,'manual',null,case when method='efectivo' then holder end,case when method='transferencia' then holder end) returning id into mid;
    end if;
  end if;
  insert into public.importb2b_expenses(owner_id,expense_date,expense_type,provider,description,amount_ars,amount_usd,dollar_rate,order_id,product_id,finance_movement_id,payment_method,holder)
  values(uid,p_date,coalesce(nullif(trim(p_type),''),'Otro'),nullif(trim(coalesce(p_provider,'')),''),nullif(trim(coalesce(p_description,'')),''),ars,nullif(usd,0),nullif(rate,0),p_order_id,p_product_id,mid,method,holder) returning id into eid;
  return jsonb_build_object('expense_id',eid,'movement_id',mid,'amount_ars',ars);
end;$$;
grant execute on function public.importb2b_create_expense(date,text,text,text,numeric,numeric,numeric,bigint,uuid,text,text) to authenticated;
