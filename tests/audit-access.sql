-- Read-only authorization checks. No customer rows are returned or modified.
begin;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
do $$
begin
 if exists(select 1 from public.movements) or exists(select 1 from public.receivables)
 or exists(select 1 from public.settlements) or exists(select 1 from public.profiles)
 then raise exception 'Unexpected access for unrelated account'; end if;
 begin
  perform public.importb2b_reconcile_finance_balance('efectivo','nahuel',0);
  raise exception 'Recounter unexpectedly allowed';
 exception when raise_exception then
  if sqlerrm<>'No autorizado' then raise; end if;
 end;
end $$;
reset role;
do $$ begin
 if has_function_privilege('anon','public.importb2b_reconcile_finance_balance(text,text,numeric)','execute')
 or has_function_privilege('anon','public.register_importb2b_push_subscription(text,text,text,text)','execute')
 then raise exception 'Anonymous internal RPC execution'; end if;
 if not has_function_privilege('anon','public.importb2b_public_catalog_safe(text)','execute')
 or not has_function_privilege('anon','public.importb2b_create_web_order_safe(text,text,text,text,text,text,text,jsonb,text)','execute')
 then raise exception 'Public catalog or checkout disabled'; end if;
end $$;
rollback;
