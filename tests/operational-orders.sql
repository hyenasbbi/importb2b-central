begin;
do $test$
declare owner uuid; pm record; p uuid; v uuid; created jsonb; oid uuid; stock record; cnt integer; sale jsonb; original_count bigint; before_sale bigint;
begin
 select owner_id into owner from public.importb2b_catalog_settings where public_slug='importb2b';
 select * into strict pm from public.importb2b_payment_methods where owner_id=owner and active and finance_mode='movement' order by id limit 1;
 perform set_config('request.jwt.claim.sub',owner::text,true);
 insert into public.importb2b_products(owner_id,name,category,active,catalog_visible)
 values(owner,'AUTOMATED TEST - ROLLBACK','Accesorios',true,true) returning id into p;
 insert into public.importb2b_product_variants(owner_id,product_id,variant_name,cost_ars,price_ars,active)
 values(owner,p,'Test',10000,20000,true) returning id into v;
 insert into public.importb2b_inventory_movements(owner_id,product_id,variant_id,bucket,movement_type,quantity_delta)
 values(owner,p,v,'on_hand','opening',5);
 select count(*) into before_sale from public.importb2b_sales;
 created:=public.importb2b_create_web_order_safe('importb2b','AUTOMATED TEST','3420000000','','pickup','',pm.code,
  jsonb_build_array(jsonb_build_object('variant_id',v,'quantity',1)),null);
 oid:=(created->>'order_id')::uuid;
 select * into stock from public.importb2b_stock_summary where variant_id=v;
 if stock.on_hand<>5 or stock.reserved<>0 then raise exception 'Creation reserved or deducted stock'; end if;
 select count(*) into cnt from importb2b_private.notification_outbox where event_key='web:new:'||oid;
 if cnt<>(select count(*) from public.profiles where role='admin') then raise exception 'Missing admin notifications'; end if;
 perform public.importb2b_accept_web_order(oid);perform public.importb2b_accept_web_order(oid);
 select * into stock from public.importb2b_stock_summary where variant_id=v;
 if stock.on_hand<>5 or stock.reserved<>1 then raise exception 'Acceptance duplicated reservation'; end if;
 if (select count(*) from public.importb2b_sales)<>before_sale then raise exception 'Acceptance created a sale'; end if;
 sale:=public.importb2b_confirm_web_order(oid,'nahuel');
 select * into stock from public.importb2b_stock_summary where variant_id=v;
 if stock.on_hand<>4 or stock.reserved<>0 or (select count(*) from public.importb2b_sales)<>before_sale+1 then raise exception 'Sale stock/accounting mismatch'; end if;
 begin perform public.importb2b_confirm_web_order(oid,'nahuel');raise exception 'Duplicate confirmation allowed';
 exception when others then if SQLERRM='Duplicate confirmation allowed' then raise;end if;end;
 perform public.importb2b_deliver_web_order(oid);perform public.importb2b_deliver_web_order(oid);
 if (select count(*) from public.importb2b_sales)<>before_sale+1 then raise exception 'Delivery created another sale'; end if;
 created:=public.importb2b_create_web_order_safe('importb2b','AUTOMATED TEST CANCEL','3420000000','','pickup','',pm.code,jsonb_build_array(jsonb_build_object('variant_id',v,'quantity',1)),null);
 oid:=(created->>'order_id')::uuid;
 perform public.importb2b_cancel_web_order(oid,'Rollback test, no reservation');
 select * into stock from public.importb2b_stock_summary where variant_id=v;
 if stock.on_hand<>4 or stock.reserved<>0 then raise exception 'Cancel unreserved order changed stock'; end if;
 created:=public.importb2b_create_web_order_safe('importb2b','AUTOMATED TEST RESERVED CANCEL','3420000000','','pickup','',pm.code,jsonb_build_array(jsonb_build_object('variant_id',v,'quantity',1)),null);
 oid:=(created->>'order_id')::uuid;
 perform public.importb2b_accept_web_order(oid);perform public.importb2b_cancel_web_order(oid,'Rollback test');
 select * into stock from public.importb2b_stock_summary where variant_id=v;
 if stock.on_hand<>4 or stock.reserved<>0 then raise exception 'Cancel reserved order did not release'; end if;
 -- De-duplication creates exactly one inbox row per admin.
 perform importb2b_private.enqueue_admin_notice('test:dedup','Test','Test','{"type":"test"}'::jsonb);
 perform importb2b_private.enqueue_admin_notice('test:dedup','Test','Test','{"type":"test"}'::jsonb);
 if (select count(*) from importb2b_private.notification_outbox where event_key='test:dedup')<>(select count(*) from profiles where role='admin') then raise exception 'Duplicate notices'; end if;
end $test$;
rollback;
