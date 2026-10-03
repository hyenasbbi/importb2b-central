-- IMPORTB2B Central 7.2.8
-- Finance recount + branded push routing + reminder schedules.

alter table public.importb2b_push_subscriptions
  add column if not exists app_source text not null default 'legacy';

create index if not exists idx_importb2b_push_subscriptions_source_active
  on public.importb2b_push_subscriptions(owner_id, app_source, active);

create or replace function public.importb2b_reconcile_finance_balance(
  p_method text,
  p_holder text,
  p_target_balance numeric
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_method text := lower(trim(coalesce(p_method,'')));
  v_holder text := lower(trim(coalesce(p_holder,'')));
  v_target numeric := coalesce(p_target_balance,0);
  v_current numeric := 0;
  v_delta numeric := 0;
  v_kind text;
  v_currency text;
  v_label text;
  v_quote numeric := null;
  v_ars numeric := 0;
  v_id uuid;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  if v_method not in ('efectivo','transferencia','usdt') then raise exception 'Método inválido'; end if;
  if v_holder not in ('nahuel','esteban') then raise exception 'Titular inválido'; end if;

  if v_method='efectivo' then
    select coalesce(sum(case when kind='income' then amount else -amount end),0)
      into v_current
    from public.movements
    where currency='ARS' and payment_method='efectivo'
      and lower(coalesce(cash_holder,''))=v_holder;
    v_currency:='ARS'; v_label:='Efectivo';
  elsif v_method='transferencia' then
    select coalesce(sum(case when kind='income' then amount else -amount end),0)
      into v_current
    from public.movements
    where currency='ARS' and payment_method='transferencia'
      and lower(coalesce(transfer_holder,''))=v_holder;
    v_currency:='ARS'; v_label:='Transferencias';
  else
    select coalesce(sum(case when kind='income' then amount else -amount end),0)
      into v_current
    from public.movements
    where currency='USDT' and payment_method='usdt'
      and lower(coalesce(usdt_holder,''))=v_holder;
    v_currency:='USDT'; v_label:='USDT';
  end if;

  v_delta := v_target - v_current;
  if abs(v_delta) < 0.000001 then
    return jsonb_build_object(
      'changed',false,'method',v_method,'holder',v_holder,
      'previous_balance',v_current,'new_balance',v_target,'delta',0
    );
  end if;

  v_kind := case when v_delta>0 then 'income' else 'expense' end;

  if v_currency='USDT' then
    select sell_ars into v_quote
    from public.quote_snapshots
    order by captured_at desc
    limit 1;
    v_ars := abs(v_delta) * coalesce(v_quote,0);
  else
    v_ars := abs(v_delta);
  end if;

  insert into public.movements(
    kind,amount,currency,payment_method,category,description,
    occurred_at,quote_type,quote_ars,ars_equivalent,created_by,
    source_type,cash_holder,transfer_holder,usdt_holder
  )
  values(
    v_kind,abs(v_delta),v_currency,v_method,'RECUENTO DE CAJA',
    case when v_kind='income' then 'Ingreso por recuento · ' else 'Egreso por recuento · ' end
      || v_label || ' · ' || initcap(v_holder),
    now(),
    case when v_currency='USDT' then 'sell' else null end,
    case when v_currency='USDT' then v_quote else null end,
    v_ars,v_uid,'finance_recount',
    case when v_method='efectivo' then v_holder else null end,
    case when v_method='transferencia' then v_holder else null end,
    case when v_method='usdt' then v_holder else null end
  )
  returning id into v_id;

  insert into public.audit_log(entity_type,entity_id,action,actor_id,new_data)
  values(
    'movement',v_id,'RECONCILE',v_uid,
    jsonb_build_object(
      'method',v_method,'holder',v_holder,'previous_balance',v_current,
      'new_balance',v_target,'delta',v_delta
    )
  );

  return jsonb_build_object(
    'changed',true,'movement_id',v_id,'method',v_method,'holder',v_holder,
    'previous_balance',v_current,'new_balance',v_target,'delta',v_delta,'kind',v_kind
  );
end;
$$;

revoke all on function public.importb2b_reconcile_finance_balance(text,text,numeric) from public;
grant execute on function public.importb2b_reconcile_finance_balance(text,text,numeric) to authenticated;

update public.notification_settings
set interval_days=3,
    local_hour=14,
    timezone='America/Argentina/Buenos_Aires',
    next_due_at=((current_date + interval '3 days' + interval '14 hours') at time zone 'America/Argentina/Buenos_Aires'),
    updated_at=now()
where enabled=true;

do $$
begin
  perform cron.unschedule('importb2b-summary-reminder-daily');
exception when others then null;
end $$;

do $$
begin
  perform cron.unschedule('importb2b-finance-reminder-3d');
exception when others then null;
end $$;

do $$
begin
  perform cron.unschedule('importb2b-sales-reminder-weekdays');
exception when others then null;
end $$;

select cron.schedule(
  'importb2b-finance-reminder-3d',
  '0 17 * * *',
  $job$
    select net.http_post(
      url := 'https://jgjvzqfxakvogaeqfual.supabase.co/functions/v1/importb2b-scheduled-summary',
      body := '{}'::jsonb,
      params := '{}'::jsonb,
      headers := jsonb_build_object(
        'Content-Type','application/json',
        'x-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='importb2b_summary_cron_secret' limit 1)
      ),
      timeout_milliseconds := 10000
    );
  $job$
);

select cron.schedule(
  'importb2b-sales-reminder-weekdays',
  '30 20 * * 1-5',
  $job$
    select net.http_post(
      url := 'https://jgjvzqfxakvogaeqfual.supabase.co/functions/v1/importb2b-sales-reminder',
      body := '{}'::jsonb,
      params := '{}'::jsonb,
      headers := jsonb_build_object(
        'Content-Type','application/json',
        'x-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='importb2b_summary_cron_secret' limit 1)
      ),
      timeout_milliseconds := 10000
    );
  $job$
);
