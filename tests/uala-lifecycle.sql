-- Run only inside BEGIN + migration + this file + ROLLBACK.
-- Synthetic fixtures are never committed; no HTTP requests or payment calls.
do $$
declare owner uuid; product uuid; variant uuid; method uuid; oid uuid; oid2 uuid; oid3 uuid;
 q jsonb; result jsonb; attempt uuid; provider uuid:=gen_random_uuid(); total bigint; fee bigint;
 amount numeric; count_before bigint;
begin
 select owner_id into owner from public.importb2b_catalog_settings limit 1;
 if owner is null then raise exception 'Test requires existing catalog owner'; end if;
 insert into public.importb2b_products(owner_id,name,active,catalog_visible) values(owner,'TEST UALA ROLLBACK',true,true) returning id into product;
 insert into public.importb2b_product_variants(owner_id,product_id,variant_name,price_ars,cost_ars) values(owner,product,'TEST',10000,5000) returning id into variant;
 insert into public.importb2b_inventory_movements(owner_id,product_id,variant_id,bucket,movement_type,quantity_delta,unit_cost_ars,created_by)
 values(owner,product,variant,'on_hand','opening',5,5000,owner);
 insert into public.importb2b_payment_methods(owner_id,code,name,active,finance_mode) values(owner,'uala_bis_online','TEST UALA',false,'none') returning id into method;
 insert into public.importb2b_web_orders(owner_id,order_code,customer_name,customer_phone,delivery_type,payment_method_id,subtotal_ars,total_ars)
 values(owner,'TEST-U-'||gen_random_uuid()::text,'TEST UALA','00000000','pickup',method,10000,10000) returning id into oid;
 insert into public.importb2b_web_order_items(owner_id,order_id,product_id,variant_id,product_name,variant_name,quantity,unit_price_ars,line_total_ars)
 values(owner,oid,product,variant,'TEST','TEST',1,10000,10000);
 begin
  perform public.importb2b_uala_prepare(oid,gen_random_uuid(),'credit_3','production');
  raise exception 'FAIL: unverified contract accepted';
 exception when others then if sqlerrm not like '%Plan sin contrato%' then raise; end if; end;
 insert into public.importb2b_uala_contracts(owner_id,environment,plan,enabled,allowed_issuers,evidence_reference)
 values(owner,'production','credit_3',true,array['VISA'],'TEST ONLY; rolled back'),(owner,'test','credit_3',true,array['VISA'],'TEST ONLY; rolled back');
 q:=public.importb2b_uala_prepare(oid,gen_random_uuid(),'credit_3','production');attempt:=(q->>'id')::uuid;total:=(q->>'final_cents')::bigint;
 fee:=(q->'estimate'->>'fee_cents')::bigint;
 if not (q->>'new_attempt')::boolean then raise exception 'FAIL: first claim'; end if;
 result:=public.importb2b_uala_prepare(oid,gen_random_uuid(),'credit_3','production');
 if (result->>'new_attempt')::boolean or result->>'id'<>attempt::text then raise exception 'FAIL: duplicate claim'; end if;
 perform public.importb2b_uala_bind(attempt,provider,q->>'external_reference',total,'https://uala-checkout.com/orders/test');
 begin
  perform public.importb2b_uala_apply_verified(attempt,provider,q->>'external_reference',total+1,'APPROVED',3,'VISA');
  raise exception 'FAIL: mismatched amount accepted';
 exception when others then if sqlerrm not like '%no coincide%' then raise; end if; end;
 result:=public.importb2b_uala_apply_verified(attempt,provider,q->>'external_reference',total,'APPROVED',9,'VISA');
 if result->>'state'<>'review' then raise exception 'FAIL: wrong installments'; end if;
 -- Sandbox returned 13 after selecting the UI label for 3: never infer a mapping.
 result:=public.importb2b_uala_apply_verified(attempt,provider,q->>'external_reference',total,'APPROVED',13,'VISA');
 if result->>'state'<>'review' then raise exception 'FAIL: undocumented plan code accepted as installment count'; end if;
 result:=public.importb2b_uala_apply_verified(attempt,provider,q->>'external_reference',total,'APPROVED',3,'VISA');
 if result->>'state'<>'approved' then raise exception 'FAIL: verified approval'; end if;
 perform public.importb2b_uala_apply_verified(attempt,provider,q->>'external_reference',total,'PENDING',null,null);
 if (select state from public.importb2b_uala_attempts where id=attempt)<>'approved' then raise exception 'FAIL: stale downgrade'; end if;
 begin
  perform public.importb2b_uala_post_to_caja(attempt,total,'nahuel');
  raise exception 'FAIL: invalid fee accepted';
 exception when others then if sqlerrm not like '%Conciliación inválida%' then raise; end if; end;
 select count(*) into count_before from public.movements;
 result:=public.importb2b_uala_post_to_caja(attempt,fee,'nahuel');
 if (result->>'already_posted')::boolean then raise exception 'FAIL: initial posting'; end if;
 result:=public.importb2b_uala_post_to_caja(attempt,fee,'nahuel');
 if not (result->>'already_posted')::boolean or (select count(*) from public.movements)<>count_before+1 then raise exception 'FAIL: duplicate Caja'; end if;
 select sum(quantity_delta) into amount from public.importb2b_inventory_movements where variant_id=variant and bucket='on_hand';
 if amount<>4 then raise exception 'FAIL: stock consumed more than once'; end if;
 select sum(quantity_delta) into amount from public.importb2b_inventory_movements where variant_id=variant and bucket='reserved';
 if amount<>0 then raise exception 'FAIL: outstanding reservation after sale'; end if;
 perform public.importb2b_uala_apply_verified(attempt,provider,q->>'external_reference',total,'APPROVED',3,'VISA');
 if (select state from public.importb2b_uala_attempts where id=attempt)<>'posted' then raise exception 'FAIL: duplicate approval changed posting'; end if;
 perform public.importb2b_uala_apply_verified(attempt,provider,q->>'external_reference',total,'REFUNDED',3,'VISA');
 if (select state from public.importb2b_uala_attempts where id=attempt)<>'refund_review' then raise exception 'FAIL: refund after sale'; end if;

 insert into public.importb2b_web_orders(owner_id,order_code,customer_name,customer_phone,delivery_type,payment_method_id,subtotal_ars,total_ars)
 values(owner,'TEST-U-'||gen_random_uuid()::text,'TEST UALA','00000000','pickup',method,10000,10000) returning id into oid2;
 insert into public.importb2b_web_order_items(owner_id,order_id,product_id,variant_id,product_name,variant_name,quantity,unit_price_ars,line_total_ars)
 values(owner,oid2,product,variant,'TEST','TEST',1,10000,10000);
 q:=public.importb2b_uala_prepare(oid2,gen_random_uuid(),'credit_3','test');attempt:=(q->>'id')::uuid;provider:=gen_random_uuid();
 perform public.importb2b_uala_bind(attempt,provider,q->>'external_reference',total,'https://uala-checkout.com/orders/test');
 perform public.importb2b_uala_apply_verified(attempt,provider,q->>'external_reference',total,'APPROVED',3,'VISA');
 begin
  perform public.importb2b_uala_post_to_caja(attempt,fee,'nahuel');
  raise exception 'FAIL: sandbox affected Caja';
 exception when others then if sqlerrm not like '%no apto para Caja%' then raise; end if; end;
 perform public.importb2b_uala_apply_verified(attempt,provider,q->>'external_reference',total,'REFUNDED',3,'VISA');
 perform public.importb2b_uala_release_refunded(attempt);perform public.importb2b_uala_release_refunded(attempt);
 select sum(quantity_delta) into amount from public.importb2b_inventory_movements where variant_id=variant and bucket='reserved';
 if amount<>0 then raise exception 'FAIL: duplicate refund release'; end if;
 if has_function_privilege('anon','public.importb2b_uala_apply_verified(uuid,uuid,text,bigint,text,integer,text)','execute')
 or has_function_privilege('authenticated','public.importb2b_uala_post_to_caja(uuid,bigint,text)','execute') then raise exception 'FAIL: public payment mutation'; end if;
 perform set_config('test.uala_order',oid::text,true);perform set_config('test.uala_owner',owner::text,true);
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('test.uala_owner'),true);
do $$begin
 begin
  update public.importb2b_web_orders set status='cancelled' where id=current_setting('test.uala_order')::uuid;
  raise exception 'FAIL: manual cancellation bypass';
 exception when others then if sqlerrm not like '%requiere conciliación%' then raise; end if; end;
 begin
  update public.importb2b_web_order_items set quantity=2 where order_id=current_setting('test.uala_order')::uuid;
  raise exception 'FAIL: mutable payment items';
 exception when others then if sqlerrm not like '%inmutable%' then raise; end if; end;
end $$;
reset role;
select 'PASS: contract gate, reserve, duplicate claim, amount/plan verification, stale events, unique Caja, stock consumption, sandbox isolation, refund release, permissions and manual bypass guard' as result;
