-- Preserve existing permissive business policies; add an AND gate for Central.
-- The two IDs come from 20261015_shared_central_admins.sql, not generated here.
do $$
declare t text;
begin
 foreach t in array array['audit_log','currency_conversions','internal_transfers',
   'movements','quote_snapshots','receivable_payments','receivables','settlements'] loop
  execute format('create policy audit_central_admin_gate on public.%I as restrictive for all to authenticated
    using (auth.uid() in (''9503c97f-e84e-467c-b22e-14745e6f62d9''::uuid,''ff1ccd91-3b9a-4c37-bf19-dd28adabbb39''::uuid))
    with check (auth.uid() in (''9503c97f-e84e-467c-b22e-14745e6f62d9''::uuid,''ff1ccd91-3b9a-4c37-bf19-dd28adabbb39''::uuid))',t);
 end loop;
end $$;

create policy audit_profile_read_gate on public.profiles as restrictive for select to authenticated
 using (id=auth.uid() or auth.uid() in ('9503c97f-e84e-467c-b22e-14745e6f62d9'::uuid,'ff1ccd91-3b9a-4c37-bf19-dd28adabbb39'::uuid));

-- RLS does not constrain SECURITY DEFINER. Guard the privileged recounter too.
-- Abort on definition drift rather than replacing concurrent financial changes.
do $$
declare src text; changed text;
begin
 select pg_get_functiondef('public.importb2b_reconcile_finance_balance(text,text,numeric)'::regprocedure) into src;
 changed:=replace(src,'if v_uid is null then raise exception ''No autenticado''; end if;',
   'if v_uid is null then raise exception ''No autenticado''; end if;
    if v_uid not in (''9503c97f-e84e-467c-b22e-14745e6f62d9''::uuid,''ff1ccd91-3b9a-4c37-bf19-dd28adabbb39''::uuid) then raise exception ''No autorizado''; end if;');
 if src=changed then raise exception 'Unexpected recounter definition; review concurrent changes'; end if;
 execute changed;
end $$;

revoke execute on function public.importb2b_reconcile_finance_balance(text,text,numeric) from public,anon;
revoke execute on function public.importb2b_update_historical_sale(uuid,timestamptz,uuid,numeric,numeric,numeric,numeric,numeric,numeric,text,text,text,jsonb) from public,anon;
revoke execute on function public.register_importb2b_push_subscription(text,text,text,text) from public,anon;
grant execute on function public.importb2b_reconcile_finance_balance(text,text,numeric) to authenticated;
grant execute on function public.importb2b_update_historical_sale(uuid,timestamptz,uuid,numeric,numeric,numeric,numeric,numeric,numeric,text,text,text,jsonb) to authenticated;
grant execute on function public.register_importb2b_push_subscription(text,text,text,text) to authenticated;
