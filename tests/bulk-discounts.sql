-- All price changes in this test are rolled back.
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','9503c97f-e84e-467c-b22e-14745e6f62d9',true);
do $$
declare ids uuid[]; expected jsonb; result jsonb; stale boolean:=false; bad boolean:=false;
begin
 select array_agg(id) into ids from (select p.id from public.importb2b_products p where p.active and p.category='Camisetas' and exists(select 1 from public.importb2b_product_variants v where v.product_id=p.id and v.active) order by id limit 2) p;
 if cardinality(ids)<>2 then raise exception 'Test needs two apparel products';end if;
 select jsonb_agg(jsonb_build_object('id',id,'price',price_ars,'sale',sale_price_ars)) into expected from public.importb2b_product_variants where product_id=any(ids) and active;
 result:=public.importb2b_bulk_catalog_discount(ids,13,expected);
 if (result->>'products')::int<>2 or exists(select 1 from public.importb2b_product_variants where product_id=any(ids) and active and sale_price_ars<>round(price_ars*.87,2)) then raise exception 'Wrong bulk prices';end if;
 begin perform public.importb2b_bulk_catalog_discount(ids,10,expected);exception when others then stale:=sqlerrm like '%cambiaron%';end;
 if not stale then raise exception 'Stale preview accepted';end if;
 select jsonb_agg(jsonb_build_object('id',id,'price',price_ars,'sale',sale_price_ars)) into expected from public.importb2b_product_variants where product_id=any(ids) and active;
 perform public.importb2b_bulk_catalog_discount(ids,13,expected);
 if exists(select 1 from public.importb2b_product_variants where product_id=any(ids) and active and sale_price_ars<>round(price_ars*.87,2)) then raise exception 'Discount compounded';end if;
 begin perform public.importb2b_bulk_catalog_discount(ids,100,expected);exception when others then bad:=true;end;
 if not bad then raise exception 'Invalid percent accepted';end if;
 perform set_config('request.jwt.claim.sub','ff1ccd91-3b9a-4c37-bf19-dd28adabbb39',true);
 perform public.importb2b_bulk_catalog_discount(ids,null,expected);
 if exists(select 1 from public.importb2b_product_variants where product_id=any(ids) and active and sale_price_ars is not null) then raise exception 'Remove offers failed';end if;
 perform set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000000',true);
 bad:=false;begin perform public.importb2b_bulk_catalog_discount(ids,10,expected);exception when others then bad:=true;end;
 if not bad then raise exception 'Unrelated actor allowed';end if;
 if has_function_privilege('anon','public.importb2b_bulk_catalog_discount(uuid[],numeric,jsonb)','execute') then raise exception 'Anonymous bulk write permission';end if;
end $$;
select 'PASS: both admins, percentage, no compounding, stale preview, removal, invalid percentage, unrelated and anonymous permissions' as result;
rollback;
