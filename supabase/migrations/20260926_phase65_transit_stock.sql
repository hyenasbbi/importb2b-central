-- IMPORTB2B Central 6.5 — mercadería nueva separada en tránsito hasta recepción.
-- Producción ya tiene esta migración aplicada.

create or replace function public.importb2b_create_purchase_order(
  p_order_date date,p_usdt_rate numeric,p_shipping_amount numeric,p_shipping_currency text,p_provider text,p_note text,p_items jsonb
) returns jsonb
language plpgsql security invoker set search_path=public as $$
declare
  uid uuid:=auth.uid();v_order_id bigint;v_order_no integer;x jsonb;v_qty integer;v_supplier_usdt numeric;
  v_shipping_usdt numeric;v_shipping_per_unit numeric;v_total_units integer;v_merch_usdt numeric;v_investment numeric;
  v_landed_usdt numeric;v_landed_ars numeric;v_product_id uuid;v_variant_id uuid;v_item_id bigint;v_allocation_id uuid;
  v_product_name text;v_category text;v_variant_name text;v_sku text;
  existing_product public.importb2b_products;existing_variant public.importb2b_product_variants;
begin
  if uid is null then raise exception 'No autenticado'; end if;
  if p_order_date is null then raise exception 'Ingresá la fecha'; end if;
  if coalesce(p_usdt_rate,0)<=0 then raise exception 'Cotización USDT inválida'; end if;
  if p_shipping_currency not in ('USDT','ARS') then raise exception 'Moneda de envío inválida'; end if;
  if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then raise exception 'Cargá al menos un producto'; end if;
  select coalesce(sum((value->>'quantity')::integer),0),coalesce(sum((value->>'quantity')::numeric*coalesce((value->>'supplier_usdt')::numeric,0)),0)
    into v_total_units,v_merch_usdt from jsonb_array_elements(p_items);
  if v_total_units<=0 then raise exception 'Cantidad total inválida'; end if;
  v_shipping_usdt:=case when p_shipping_currency='ARS' then coalesce(p_shipping_amount,0)/p_usdt_rate else coalesce(p_shipping_amount,0) end;
  v_shipping_per_unit:=v_shipping_usdt/v_total_units;v_investment:=v_merch_usdt+v_shipping_usdt;
  perform pg_advisory_xact_lock(hashtext(uid::text||':importb2b-purchase-order'));
  select coalesce(max(o.order_number),0)+1 into v_order_no from public.importb2b_orders o where o.owner_id=uid;
  insert into public.importb2b_orders(owner_id,order_number,order_date,note,investment_usd,merchandise_usdt,shipping_input_amount,shipping_input_currency,shipping_usdt,usdt_rate_ars,total_units,shipping_usdt_per_unit,provider,purchase_status)
  values(uid,v_order_no,p_order_date,nullif(trim(coalesce(p_note,'')),''),v_investment,v_merch_usdt,coalesce(p_shipping_amount,0),p_shipping_currency,v_shipping_usdt,p_usdt_rate,v_total_units,v_shipping_per_unit,nullif(trim(coalesce(p_provider,'')),''),'ordered') returning id into v_order_id;
  for x in select value from jsonb_array_elements(p_items) loop
    v_qty:=coalesce((x->>'quantity')::integer,0);v_supplier_usdt:=coalesce((x->>'supplier_usdt')::numeric,0);
    if v_qty<=0 or v_supplier_usdt<0 then raise exception 'Producto con cantidad/costo inválido'; end if;
    v_category:=trim(coalesce(x->>'category','OTROS'));v_product_name:=trim(coalesce(x->>'product_name',''));v_variant_name:=trim(coalesce(x->>'variant_name','Única'));v_sku:=nullif(trim(coalesce(x->>'sku','')),'');
    if v_product_name='' then raise exception 'Producto sin nombre'; end if;
    v_product_id:=null;v_variant_id:=null;
    if nullif(x->>'variant_id','') is not null then
      select * into existing_variant from public.importb2b_product_variants pv where pv.id=(x->>'variant_id')::uuid and pv.owner_id=uid and pv.active=true;
      if existing_variant.id is null then raise exception 'Variante existente no encontrada'; end if;
      v_variant_id:=existing_variant.id;v_product_id:=existing_variant.product_id;
      select * into existing_product from public.importb2b_products p where p.id=v_product_id and p.owner_id=uid;
      v_product_name:=existing_product.name;v_category:=coalesce(existing_product.category,v_category);v_variant_name:=existing_variant.variant_name;v_sku:=existing_variant.sku;
    else
      select * into existing_product from public.importb2b_products p where p.owner_id=uid and p.active=true and lower(trim(p.name))=lower(v_product_name) and lower(trim(coalesce(p.category,'')))=lower(v_category) order by p.created_at limit 1;
      if existing_product.id is null then insert into public.importb2b_products(owner_id,name,category,sku,active,catalog_visible,source,source_payload) values(uid,v_product_name,v_category,v_sku,true,true,'purchase_order',jsonb_build_object('order_number',v_order_no)) returning id into v_product_id; else v_product_id:=existing_product.id; end if;
      select * into existing_variant from public.importb2b_product_variants pv where pv.owner_id=uid and pv.product_id=v_product_id and pv.active=true and lower(trim(pv.variant_name))=lower(coalesce(nullif(v_variant_name,''),'Única')) order by pv.created_at limit 1;
      if existing_variant.id is null then insert into public.importb2b_product_variants(owner_id,product_id,sku,variant_name,cost_ars,price_ars,stock_min,active,source,source_payload) values(uid,v_product_id,v_sku,coalesce(nullif(v_variant_name,''),'Única'),null,null,0,true,'purchase_order',jsonb_build_object('order_number',v_order_no)) returning id into v_variant_id; else v_variant_id:=existing_variant.id; end if;
    end if;
    v_landed_usdt:=v_supplier_usdt+v_shipping_per_unit;v_landed_ars:=v_landed_usdt*p_usdt_rate;
    insert into public.importb2b_order_items(owner_id,order_id,category,product,detail,quantity,original_usd,cost_usd,dollar_rate,cost_ars,excluded_from_stock,product_id,variant_id,received_quantity,stock_link_status)
    values(uid,v_order_id,v_category,v_product_name,v_variant_name,v_qty,v_supplier_usdt,v_landed_usdt,p_usdt_rate,v_landed_ars,false,v_product_id,v_variant_id,0,'linked') returning id into v_item_id;
    insert into public.importb2b_order_item_allocations(owner_id,order_item_id,product_id,variant_id,ordered_quantity,received_quantity,unit_cost_ars) values(uid,v_item_id,v_product_id,v_variant_id,v_qty,0,v_landed_ars) returning id into v_allocation_id;
    insert into public.importb2b_inventory_movements(owner_id,product_id,variant_id,bucket,movement_type,quantity_delta,unit_cost_ars,reference_type,reference_id,note,created_by) values(uid,v_product_id,v_variant_id,'in_transit','purchase_order',v_qty,v_landed_ars,'order_allocation',v_allocation_id::text,'Pedido #'||v_order_no||' en tránsito',uid);
  end loop;
  insert into public.audit_log(entity_type,entity_id,action,actor_id,new_data) values('purchase_order',null,'INSERT',uid,jsonb_build_object('order_id',v_order_id,'order_number',v_order_no,'units',v_total_units,'investment_usdt',v_investment));
  return jsonb_build_object('order_id',v_order_id,'order_number',v_order_no,'total_units',v_total_units,'merchandise_usdt',v_merch_usdt,'shipping_usdt',v_shipping_usdt,'investment_usdt',v_investment);
end;$$;
grant execute on function public.importb2b_create_purchase_order(date,numeric,numeric,text,text,text,jsonb) to authenticated;

create or replace function public.importb2b_receive_order_allocation(p_allocation_id uuid,p_receive_quantity numeric,p_note text default null)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare uid uuid:=auth.uid();a public.importb2b_order_item_allocations;i public.importb2b_order_items;remaining numeric;item_received numeric;item_status text;order_received numeric;order_total numeric;order_status text;cost numeric;
begin
  if uid is null then raise exception 'No autenticado'; end if;
  if p_receive_quantity<=0 then raise exception 'La cantidad recibida debe ser mayor a 0'; end if;
  select * into a from public.importb2b_order_item_allocations where id=p_allocation_id and owner_id=uid for update;
  if a.id is null then raise exception 'Distribución no encontrada'; end if;
  select * into i from public.importb2b_order_items where id=a.order_item_id for update;
  remaining:=a.ordered_quantity-a.received_quantity;if p_receive_quantity>remaining then raise exception 'Solo quedan % unidades por recibir en esta variante',remaining; end if;cost:=coalesce(a.unit_cost_ars,i.cost_ars);
  insert into public.importb2b_inventory_movements(owner_id,product_id,variant_id,bucket,movement_type,quantity_delta,unit_cost_ars,reference_type,reference_id,note,created_by) values(uid,a.product_id,a.variant_id,'in_transit','purchase_receipt',-p_receive_quantity,cost,'order_allocation',a.id::text,'Salida de tránsito por recepción',uid);
  insert into public.importb2b_inventory_movements(owner_id,product_id,variant_id,bucket,movement_type,quantity_delta,unit_cost_ars,reference_type,reference_id,note,created_by) values(uid,a.product_id,a.variant_id,'on_hand','purchase_receipt',p_receive_quantity,cost,'order_allocation',a.id::text,coalesce(nullif(trim(p_note),''),'Recepción desde Pedido #'||i.order_id::text),uid);
  update public.importb2b_order_item_allocations set received_quantity=received_quantity+p_receive_quantity,updated_at=now() where id=a.id;
  select coalesce(sum(received_quantity),0) into item_received from public.importb2b_order_item_allocations where order_item_id=a.order_item_id;
  item_status:=case when item_received>=i.quantity then 'received' when item_received>0 then 'partial_received' else 'allocated' end;
  update public.importb2b_order_items set received_quantity=item_received,stock_link_status=item_status,updated_at=now() where id=a.order_item_id;
  if cost is not null then update public.importb2b_product_variants set cost_ars=cost,updated_at=now() where id=a.variant_id; end if;
  select coalesce(sum(received_quantity),0),coalesce(sum(quantity),0) into order_received,order_total from public.importb2b_order_items where order_id=i.order_id;
  order_status:=case when order_total>0 and order_received>=order_total then 'received' when order_received>0 then 'receiving' else 'picked_up' end;
  update public.importb2b_orders set purchase_status=order_status,updated_at=now() where id=i.order_id and owner_id=uid;
  return jsonb_build_object('allocation_id',a.id,'received',p_receive_quantity,'item_received_total',item_received,'item_status',item_status,'order_received_total',order_received,'order_total',order_total,'order_status',order_status);
end;$$;
grant execute on function public.importb2b_receive_order_allocation(uuid,numeric,text) to authenticated;
