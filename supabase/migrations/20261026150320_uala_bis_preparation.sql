-- Preparation only: no payment method is published and no business records change.
create table public.importb2b_uala_settings (
 owner_id uuid primary key references public.profiles(id),
 vat_bps integer not null default 2100 check(vat_bps between 0 and 10000),
 processing_bps integer not null default 490 check(processing_bps between 0 and 10000),
 financing_3_bps integer not null default 1000 check(financing_3_bps between 0 and 10000),
 financing_6_naranja_bps integer not null default 1700 check(financing_6_naranja_bps between 0 and 10000),
 financing_9_bps integer not null default 2570 check(financing_9_bps between 0 and 10000),
 check((processing_bps+greatest(financing_3_bps,financing_6_naranja_bps,financing_9_bps))*(10000+vat_bps)<100000000)
);
alter table public.importb2b_uala_settings enable row level security;
revoke all on public.importb2b_uala_settings from public,anon,authenticated;
grant select on public.importb2b_uala_settings to authenticated;
grant update(vat_bps,processing_bps,financing_3_bps,financing_6_naranja_bps,financing_9_bps) on public.importb2b_uala_settings to authenticated;
create policy uala_admin_settings on public.importb2b_uala_settings for all to authenticated
 using(owner_id=public.importb2b_shared_owner() and exists(select 1 from public.profiles where id=auth.uid() and role='admin'))
 with check(owner_id=public.importb2b_shared_owner() and exists(select 1 from public.profiles where id=auth.uid() and role='admin'));
insert into public.importb2b_uala_settings(owner_id) select owner_id from public.importb2b_catalog_settings on conflict do nothing;

-- All amounts are ARS cents. Rounded up to whole ARS as requested.
create function public.importb2b_uala_quote_math(p_net_cents bigint,p_processing_bps integer,p_financing_bps integer,p_vat_bps integer)
returns jsonb language plpgsql immutable security invoker set search_path=public,pg_temp as $$
declare denominator numeric; gross numeric; processing numeric; financing numeric; pv numeric; fv numeric; fee numeric;
begin
 if p_net_cents is null or p_net_cents<=0 or p_net_cents>999999900
 or p_processing_bps is null or p_financing_bps is null or p_vat_bps is null
 or p_processing_bps not between 0 and 10000 or p_financing_bps not between 0 and 10000 or p_vat_bps not between 0 and 10000
 then raise exception 'Importe o tasas inválidas'; end if;
 denominator:=1-(p_processing_bps+p_financing_bps)::numeric/10000*(1+p_vat_bps::numeric/10000);
 if denominator<=0 then raise exception 'Comisiones inválidas'; end if;
 gross:=ceil(p_net_cents/denominator/100)*100;
 loop
  if gross<2500 or gross>999999900 then raise exception 'Importe fuera del rango oficial de Ualá'; end if;
  processing:=ceil(gross*p_processing_bps/10000);
  financing:=ceil(gross*p_financing_bps/10000);
  pv:=ceil(processing*p_vat_bps/10000);fv:=ceil(financing*p_vat_bps/10000);
  fee:=processing+financing+pv+fv;
  exit when gross-fee>=p_net_cents;
  gross:=gross+100;
 end loop;
 if gross<2500 or gross>999999900 then raise exception 'Importe fuera del rango oficial de Ualá'; end if;
 return jsonb_build_object('net_cents',p_net_cents,'final_cents',gross,'processing_bps',p_processing_bps,
 'financing_bps',p_financing_bps,'vat_bps',p_vat_bps,'processing_cents',processing,'financing_cents',financing,
 'processing_vat_cents',pv,'financing_vat_cents',fv,'fee_cents',fee,'estimated_net_cents',gross-fee);
end $$;
revoke all on function public.importb2b_uala_quote_math(bigint,integer,integer,integer) from public,anon;
grant execute on function public.importb2b_uala_quote_math(bigint,integer,integer,integer) to authenticated,service_role;

create table public.importb2b_uala_quotes (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references public.profiles(id),
 order_id uuid not null references public.importb2b_web_orders(id),
 plan text not null check(plan in ('debit','credit_1','credit_3','naranja_6','credit_9')),
 estimate jsonb not null,
 created_by uuid not null default auth.uid() references public.profiles(id),
 created_at timestamptz not null default now()
);
create index uala_quotes_order_idx on public.importb2b_uala_quotes(order_id);
create index uala_quotes_owner_idx on public.importb2b_uala_quotes(owner_id);
create index uala_quotes_actor_idx on public.importb2b_uala_quotes(created_by);
alter table public.importb2b_uala_quotes enable row level security;
revoke all on public.importb2b_uala_quotes from public,anon,authenticated;
grant select,insert on public.importb2b_uala_quotes to authenticated;
create policy uala_admin_quotes_read on public.importb2b_uala_quotes for select to authenticated
 using(owner_id=public.importb2b_shared_owner() and exists(select 1 from public.profiles where id=auth.uid() and role='admin'));
create policy uala_admin_quotes_insert on public.importb2b_uala_quotes for insert to authenticated
 with check(created_by=auth.uid() and owner_id=public.importb2b_shared_owner()
 and exists(select 1 from public.profiles where id=auth.uid() and role='admin')
 and exists(select 1 from public.importb2b_web_orders o where o.id=order_id and o.owner_id=importb2b_uala_quotes.owner_id));

-- Admin estimate of an existing order, never a payment authorization.
-- Ignore existing cash/transfer adjustments; base is the authoritative product+shipping net.
create function public.importb2b_uala_quote_order(p_order_id uuid,p_plan text)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare o public.importb2b_web_orders; cfg public.importb2b_uala_settings; financing integer; q jsonb; qid uuid;
begin
 if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid() and role='admin') then raise exception 'No autorizado'; end if;
 select * into o from public.importb2b_web_orders where id=p_order_id and owner_id=public.importb2b_shared_owner();
 if o.id is null then raise exception 'Pedido no disponible'; end if;
 select * into cfg from public.importb2b_uala_settings where owner_id=o.owner_id;
 if cfg.owner_id is null then raise exception 'Falta configuración Ualá'; end if;
 financing:=case p_plan when 'debit' then 0 when 'credit_1' then 0 when 'credit_3' then cfg.financing_3_bps when 'naranja_6' then cfg.financing_6_naranja_bps when 'credit_9' then cfg.financing_9_bps else null end;
 if financing is null then raise exception 'Plan inválido'; end if;
 q:=public.importb2b_uala_quote_math(ceil((o.subtotal_ars+o.shipping_ars)*100)::bigint,cfg.processing_bps,financing,cfg.vat_bps);
 insert into public.importb2b_uala_quotes(owner_id,order_id,plan,estimate) values(o.owner_id,o.id,p_plan,q) returning id into qid;
 return q||jsonb_build_object('quote_id',qid,'plan',p_plan,'enabled',false,'estimate_only',true);
end $$;
revoke all on function public.importb2b_uala_quote_order(uuid,text) from public,anon;
grant execute on function public.importb2b_uala_quote_order(uuid,text) to authenticated;
