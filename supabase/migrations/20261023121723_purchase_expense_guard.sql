-- Additive protection: no historical row is rewritten.
alter table public.movements add column purchase_request_id uuid;
create unique index movements_purchase_request_unique on public.movements(created_by,purchase_request_id) where purchase_request_id is not null;

create view public.importb2b_purchase_payment_status with (security_invoker=true) as
select o.id as order_id,
  round(coalesce(nullif(o.merchandise_usdt,0),o.investment_usd)*o.usdt_rate_ars,2) as total_ars,
  greatest(coalesce(o.purchase_payment_amount_ars,0),coalesce(m.paid,0)) + coalesce(e.recorded,0) as registered_ars,
  coalesce(m.paid,0) as movement_ars,
  coalesce(e.recorded,0) as expense_ars
from public.importb2b_orders o
left join lateral (
  select sum(coalesce(ars_equivalent,case when currency='ARS' then amount else amount*o.usdt_rate_ars end)) paid
  from public.movements where source_type='purchase_order' and source_id=o.finance_reference_id and kind='expense'
) m on true
left join lateral (
  select sum(coalesce(nullif(amount_ars,0),amount_usd*o.usdt_rate_ars,0)) recorded
  from public.importb2b_expenses e where e.order_id=o.id
    and lower(trim(e.expense_type)) in ('materia prima','proveedor','mercadería','mercaderia','compra')
    and not exists (select 1 from public.movements m where m.id=e.finance_movement_id and m.source_type='purchase_order' and m.source_id=o.finance_reference_id)
) e on true;
grant select on public.importb2b_purchase_payment_status to authenticated;

-- Serialize all purchase movement inserts, including direct API writes.
create function public.importb2b_guard_purchase_movement() returns trigger
language plpgsql security invoker set search_path=public as $$
declare o public.importb2b_orders; s record; incoming numeric;
begin
  if tg_op='UPDATE' then
    if (old.source_type='purchase_order' or new.source_type='purchase_order') and
      row(old.source_type,old.source_id,old.kind,old.amount,old.currency,old.ars_equivalent,old.purchase_request_id,old.created_by)
      is distinct from row(new.source_type,new.source_id,new.kind,new.amount,new.currency,new.ars_equivalent,new.purchase_request_id,new.created_by) then
      raise exception 'Los importes y el origen de un pago de compra están protegidos';
    end if;
    return new;
  end if;
  if new.source_type='purchase_order' and new.kind='expense' then
    if new.purchase_request_id is null then raise exception 'Registrá el pago desde la compra con su identificador único'; end if;
    select * into o from public.importb2b_orders where finance_reference_id=new.source_id for update;
    if o.id is null then raise exception 'Compra no encontrada'; end if;
    select * into s from public.importb2b_purchase_payment_status where order_id=o.id;
    incoming:=case when new.currency='USDT' then new.amount*o.usdt_rate_ars when new.currency='ARS' then new.amount end;
    if incoming is null or incoming<=0 or incoming='NaN'::numeric then raise exception 'Monto o cotización inválidos'; end if;
    if s.total_ars is null or s.total_ars<=0 then raise exception 'La compra no tiene cotización válida'; end if;
    if round(s.registered_ars+incoming,2)>s.total_ars then raise exception 'La mercadería ya está registrada o el pago supera el saldo pendiente'; end if;
    new.ars_equivalent:=incoming;
  end if;
  return new;
end;$$;
create trigger importb2b_purchase_movement_guard before insert or update on public.movements for each row execute function public.importb2b_guard_purchase_movement();

-- A merchandise payment belongs to the purchase flow. Extra costs remain separate.
-- Locking the purchase also prevents concurrent identical extra-expense inserts.
create function public.importb2b_guard_linked_expense() returns trigger
language plpgsql security invoker set search_path=public as $$
begin
  if tg_op='UPDATE' and row(old.order_id,old.expense_type,old.amount_ars,old.amount_usd,old.provider,old.description)
    is not distinct from row(new.order_id,new.expense_type,new.amount_ars,new.amount_usd,new.provider,new.description) then return new; end if;
  if new.order_id is null then return new; end if;
  perform 1 from public.importb2b_orders where id=new.order_id for update;
  if not found then raise exception 'Compra no encontrada'; end if;
  if lower(trim(new.expense_type)) in ('materia prima','proveedor','mercadería','mercaderia','compra') then
    raise exception 'La mercadería se registra desde Registrar pago en la compra; usá gastos vinculados solo para gastos adicionales';
  end if;
  if exists(select 1 from public.importb2b_expenses e where e.order_id=new.order_id and e.id<>new.id
    and lower(trim(e.expense_type))=lower(trim(new.expense_type))
    and e.amount_ars is not distinct from new.amount_ars
    and coalesce(e.amount_usd,0)=coalesce(new.amount_usd,0)
    and lower(trim(coalesce(e.provider,'')))=lower(trim(coalesce(new.provider,'')))
    and lower(trim(coalesce(e.description,'')))=lower(trim(coalesce(new.description,'')))) then
    raise exception 'Este gasto ya está registrado en la compra';
  end if;
  return new;
end;$$;
create trigger importb2b_linked_expense_guard before insert or update on public.importb2b_expenses for each row execute function public.importb2b_guard_linked_expense();

create function public.importb2b_register_purchase_payment_safe(p_order_id bigint,p_amount_ars numeric,p_method text,p_holder text,p_request_id uuid)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare uid uuid:=auth.uid(); o public.importb2b_orders; m public.movements; mid uuid;
  method text:=lower(trim(p_method)); holder text:=lower(trim(p_holder)); ars numeric; s record;
begin
  if uid is null then raise exception 'No autenticado'; end if;
  if p_request_id is null then raise exception 'Falta identificador de pago'; end if;
  if p_amount_ars is null or p_amount_ars<=0 or p_amount_ars='NaN'::numeric then raise exception 'Monto inválido'; end if;
  if method is null or method not in ('efectivo','transferencia','usdt') then raise exception 'Medio inválido'; end if;
  if holder is null or holder not in ('nahuel','esteban') then raise exception 'Elegí Nahuel o Esteban'; end if;
  select * into o from public.importb2b_orders where id=p_order_id for update;
  if o.id is null then raise exception 'Pedido no encontrado'; end if;
  select * into m from public.movements where created_by=uid and purchase_request_id=p_request_id;
  if m.id is not null then
    if m.source_id is distinct from o.finance_reference_id or m.amount<>p_amount_ars or m.payment_method<>method
      or coalesce(m.cash_holder,m.transfer_holder,m.usdt_holder)<>holder then raise exception 'El identificador ya se usó para otro pago'; end if;
    return jsonb_build_object('order_id',o.id,'movement_id',m.id,'amount_ars',m.ars_equivalent,'replayed',true);
  end if;
  ars:=case when method='usdt' then p_amount_ars*o.usdt_rate_ars else p_amount_ars end;
  insert into public.movements(kind,amount,currency,payment_method,category,description,occurred_at,quote_type,quote_ars,ars_equivalent,created_by,source_type,source_id,cash_holder,transfer_holder,usdt_holder,purchase_request_id)
  values('expense',p_amount_ars,case when method='usdt' then 'USDT' else 'ARS' end,method,'COMPRA','Compra / mercadería · Pedido #'||o.order_number,now(),case when method='usdt' then 'buy' end,case when method='usdt' then o.usdt_rate_ars end,ars,uid,'purchase_order',o.finance_reference_id,case when method='efectivo' then holder end,case when method='transferencia' then holder end,case when method='usdt' then holder end,p_request_id) returning id into mid;
  select * into s from public.importb2b_purchase_payment_status where order_id=o.id;
  update public.importb2b_orders set purchase_payment_method=method,purchase_payment_holder=holder,
    purchase_payment_amount_ars=s.movement_ars,purchase_payment_movement_id=mid,
    purchase_paid_at=now(),updated_at=now() where id=o.id;
  return jsonb_build_object('order_id',o.id,'movement_id',mid,'amount_ars',ars,'registered_ars',s.registered_ars);
end;$$;

-- Stable legacy request: retries of the old four-argument endpoint cannot add a payment.
create or replace function public.importb2b_register_purchase_payment(p_order_id bigint,p_amount_ars numeric,p_method text,p_holder text)
returns jsonb language plpgsql security invoker set search_path=public as $$
begin
  return public.importb2b_register_purchase_payment_safe(p_order_id,p_amount_ars,p_method,p_holder,md5('legacy-purchase-'||p_order_id::text)::uuid);
end;$$;
revoke all on function public.importb2b_register_purchase_payment_safe(bigint,numeric,text,text,uuid) from public,anon;
grant execute on function public.importb2b_register_purchase_payment_safe(bigint,numeric,text,text,uuid) to authenticated;
revoke all on function public.importb2b_register_purchase_payment(bigint,numeric,text,text) from public,anon;
grant execute on function public.importb2b_register_purchase_payment(bigint,numeric,text,text) to authenticated;
revoke all on function public.importb2b_guard_purchase_movement(), public.importb2b_guard_linked_expense() from public,anon;
