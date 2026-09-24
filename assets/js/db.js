(function(){
  const c=window.IMPORTB2B_CONFIG;
  if(!c?.SUPABASE_URL || !c?.SUPABASE_PUBLISHABLE_KEY) throw new Error('Falta configuración Supabase');
  window.db=window.supabase.createClient(c.SUPABASE_URL,c.SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:true,autoRefreshToken:true}});
  const assert=r=>{ if(r?.error) throw r.error; };

  async function authUser(){
    const {data,error}=await db.auth.getUser();
    if(error) throw error;
    if(!data.user) throw new Error('Sesión no válida');
    return data.user;
  }

  window.DB={
    async user(){ try{return await authUser()}catch{return null} },

    async dashboard(){
      const monthStart=new Date(); monthStart.setDate(1); monthStart.setHours(0,0,0,0);
      const todayStart=new Date(); todayStart.setHours(0,0,0,0);
      const [p,s,o,r,m,b,v,sales]=await Promise.all([
        db.from('importb2b_products').select('id',{count:'exact',head:true}).eq('active',true),
        db.from('importb2b_stock_summary').select('available,in_transit'),
        db.from('importb2b_orders').select('id',{count:'exact',head:true}),
        db.from('receivables').select('pending_amount,status').neq('status','paid').neq('status','cancelled'),
        db.from('movements').select('kind,ars_equivalent,amount,currency').gte('occurred_at',monthStart.toISOString()),
        db.from('importb2b_import_batch_stats').select('product_review,product_ready,product_imported,created_at').order('created_at',{ascending:false}).limit(1),
        db.from('importb2b_stock_valuation').select('*').limit(1),
        db.from('importb2b_sales').select('id,total_ars,sold_at,status').eq('status','completed').gte('sold_at',monthStart.toISOString())
      ]);
      [p,s,o,r,m,b,v,sales].forEach(assert);
      const receivable=(r.data||[]).reduce((a,x)=>a+Number(x.pending_amount||0),0);
      let income=0,expense=0;
      for(const x of (m.data||[])){
        const val=Number(x.ars_equivalent ?? (x.currency==='ARS'?x.amount:0) ?? 0);
        if(x.kind==='income') income+=val; else if(x.kind==='expense') expense+=val;
      }
      const monthSales=(sales.data||[]).reduce((a,x)=>a+Number(x.total_ars||0),0);
      const todaySales=(sales.data||[]).filter(x=>new Date(x.sold_at)>=todayStart).reduce((a,x)=>a+Number(x.total_ars||0),0);
      const todayCount=(sales.data||[]).filter(x=>new Date(x.sold_at)>=todayStart).length;
      const valuation=(v.data||[])[0]||{physical_units:0,available_units:0,reserved_units:0,in_transit_units:0,stock_cost_ars:0,stock_sale_value_ars:0,expected_profit_ars:0};
      const stock=Number(valuation.available_units||0), transit=Number(valuation.in_transit_units||0);
      return {products:p.count||0,stock,transit,orders:o.count||0,receivable,income,expense,monthSales,todaySales,todayCount,valuation,importBatch:(b.data||[])[0]||null};
    },

    async categories(){
      const r=await db.from('importb2b_categories').select('name').eq('active',true).order('sort_order').order('name');
      assert(r); return (r.data||[]).map(x=>x.name);
    },

    async products(q='',category='',stockFilter='all'){
      let req=db.from('importb2b_products').select('id,sku,name,category,active,catalog_visible,primary_image_url,created_at').eq('active',true).order('name');
      if(category) req=req.eq('category',category);
      const pr=await req.limit(1200); assert(pr);
      const products=pr.data||[], ids=products.map(x=>x.id); if(!ids.length) return [];
      const [vr,sr]=await Promise.all([
        db.from('importb2b_product_variants').select('id,product_id,sku,variant_name,price_ars,cost_ars,stock_min,active,attributes').in('product_id',ids).eq('active',true).order('variant_name'),
        db.from('importb2b_stock_summary').select('*').in('product_id',ids)
      ]); assert(vr); assert(sr);
      const sm=new Map((sr.data||[]).map(x=>[x.variant_id,x]));
      const vm=new Map();
      for(const v of (vr.data||[])){
        const a=vm.get(v.product_id)||[];
        a.push({...v,stock:sm.get(v.id)||{on_hand:0,reserved:0,in_transit:0,available:0}}); vm.set(v.product_id,a);
      }
      let out=products.map(p=>({...p,variants:vm.get(p.id)||[]}));
      const term=String(q||'').trim().toLowerCase();
      if(term) out=out.filter(p=>[
        p.name,p.sku,p.category,
        ...p.variants.flatMap(v=>[v.variant_name,v.sku,Object.values(v.attributes||{}).join(' ')])
      ].join(' ').toLowerCase().includes(term));
      if(stockFilter!=='all') out=out.filter(p=>{
        const av=p.variants.reduce((a,v)=>a+Number(v.stock.available||0),0);
        const tr=p.variants.reduce((a,v)=>a+Number(v.stock.in_transit||0),0);
        if(stockFilter==='available') return av>0;
        if(stockFilter==='out') return av<=0;
        if(stockFilter==='transit') return tr>0;
        if(stockFilter==='low') return p.variants.some(v=>Number(v.stock.available||0)>0 && Number(v.stock.available||0)<=Number(v.stock_min||0));
        return true;
      });
      return out;
    },

    async productDetail(id){
      const [p,v,s,img]=await Promise.all([
        db.from('importb2b_products').select('*').eq('id',id).single(),
        db.from('importb2b_product_variants').select('*').eq('product_id',id).eq('active',true).order('variant_name'),
        db.from('importb2b_stock_summary').select('*').eq('product_id',id),
        db.from('importb2b_product_images').select('*').eq('product_id',id).order('is_primary',{ascending:false}).order('sort_order')
      ]); [p,v,s,img].forEach(assert);
      const sm=new Map((s.data||[]).map(x=>[x.variant_id,x]));
      return {...p.data,images:img.data||[],variants:(v.data||[]).map(x=>({...x,stock:sm.get(x.id)||{on_hand:0,reserved:0,in_transit:0,available:0}}))};
    },
    async saveProduct(id,payload){ const r=await db.from('importb2b_products').update(payload).eq('id',id); assert(r); },
    async saveVariant(id,payload){ const r=await db.from('importb2b_product_variants').update(payload).eq('id',id); assert(r); },
    async createVariant(productId,payload,initialStock=0,note='Alta manual de variante'){
      const u=await authUser();
      const r=await db.from('importb2b_product_variants').insert({owner_id:u.id,product_id:productId,...payload}).select().single(); assert(r);
      const qty=Number(initialStock||0);
      if(qty>0){
        const m=await db.from('importb2b_inventory_movements').insert({owner_id:u.id,product_id:productId,variant_id:r.data.id,bucket:'on_hand',movement_type:'adjustment',quantity_delta:qty,unit_cost_ars:payload.cost_ars||null,reference_type:'manual_variant_create',reference_id:r.data.id,note,created_by:u.id}); assert(m);
      }
      return r.data;
    },
    async adjustStock(productId,variantId,currentOnHand,newOnHand,note){
      const u=await authUser(); const delta=Number(newOnHand)-Number(currentOnHand);
      if(!Number.isFinite(delta)) throw new Error('Cantidad inválida'); if(delta===0) return {delta:0};
      const r=await db.from('importb2b_inventory_movements').insert({owner_id:u.id,product_id:productId,variant_id:variantId,bucket:'on_hand',movement_type:'adjustment',quantity_delta:delta,reference_type:'manual_stock_adjustment',reference_id:variantId,note:note||'Ajuste manual de stock',created_by:u.id}); assert(r); return {delta};
    },

    async archiveProduct(productId,reason=''){
      const r=await db.rpc('importb2b_archive_product',{p_product_id:productId,p_reason:reason||null}); assert(r); return r.data;
    },
    async mergeProduct(targetProductId,sourceProductId,variantLabel=''){
      const r=await db.rpc('importb2b_merge_product_into',{p_target_product_id:targetProductId,p_source_product_id:sourceProductId,p_variant_label:variantLabel||null}); assert(r); return r.data;
    },

    async importBatches(){ const r=await db.from('importb2b_import_batch_stats').select('*').order('created_at',{ascending:false}).limit(20); assert(r); return r.data||[]; },
    async importRows(batchId,entityType='product'){ const r=await db.from('importb2b_import_rows').select('id,row_number,entity_type,raw_data,normalized_data,status,issues,target_id,updated_at').eq('batch_id',batchId).eq('entity_type',entityType).order('row_number'); assert(r); return r.data||[]; },
    async saveImportProduct(rowId,batchId,normalized){ const r=await db.from('importb2b_import_rows').update({normalized_data:normalized,status:'ready',issues:[]}).eq('id',rowId); assert(r); return this.refreshImportProductIssues(batchId); },
    async skipImportRow(rowId){ const r=await db.from('importb2b_import_rows').update({status:'skipped'}).eq('id',rowId); assert(r); },
    async restoreImportRow(rowId,batchId){ const r=await db.from('importb2b_import_rows').update({status:'ready'}).eq('id',rowId); assert(r); return this.refreshImportProductIssues(batchId); },
    async refreshImportProductIssues(batchId){ const r=await db.rpc('importb2b_refresh_kyte_product_issues',{p_batch_id:batchId}); assert(r); return r.data; },
    async mergeImportProductRows(targetId,sourceId){ const r=await db.rpc('importb2b_merge_kyte_product_rows',{p_target_id:targetId,p_source_id:sourceId}); assert(r); return r.data; },
    async commitKyteProducts(batchId){ const r=await db.rpc('importb2b_commit_kyte_products',{p_batch_id:batchId}); assert(r); return r.data; },

    async recentOrders(){
      const or=await db.from('importb2b_orders').select('id,order_number,order_date,total_units,investment_usd,note').order('order_date',{ascending:false}).limit(15); assert(or);
      const orders=or.data||[], orderIds=orders.map(x=>x.id); if(!orderIds.length) return [];
      const ir=await db.from('importb2b_order_items').select('id,order_id,product,detail,category,quantity,cost_ars,cost_usd,excluded_from_stock,product_id,variant_id,received_quantity,stock_link_status').in('order_id',orderIds).order('id'); assert(ir);
      const items=ir.data||[], itemIds=items.map(x=>x.id);
      let allocations=[];
      if(itemIds.length){ const ar=await db.from('importb2b_order_item_allocations').select('id,order_item_id,product_id,variant_id,ordered_quantity,received_quantity,unit_cost_ars').in('order_item_id',itemIds).order('created_at'); assert(ar); allocations=ar.data||[]; }
      const productIds=[...new Set(allocations.map(x=>x.product_id).filter(Boolean))], variantIds=[...new Set(allocations.map(x=>x.variant_id).filter(Boolean))];
      let products=[],variants=[];
      if(productIds.length){ const r=await db.from('importb2b_products').select('id,name,category').in('id',productIds); assert(r); products=r.data||[]; }
      if(variantIds.length){ const r=await db.from('importb2b_product_variants').select('id,product_id,variant_name,sku').in('id',variantIds); assert(r); variants=r.data||[]; }
      const pmap=new Map(products.map(x=>[x.id,x])), vmap=new Map(variants.map(x=>[x.id,x])), amap=new Map();
      for(const a of allocations){ const arr=amap.get(a.order_item_id)||[]; arr.push({...a,product:pmap.get(a.product_id)||null,variant:vmap.get(a.variant_id)||null}); amap.set(a.order_item_id,arr); }
      const imap=new Map(); for(const i of items){ const arr=imap.get(i.order_id)||[]; arr.push({...i,allocations:amap.get(i.id)||[]}); imap.set(i.order_id,arr); }
      const sr=await db.from('importb2b_shipments').select('order_id,carrier_name,tracking_number,normalized_status,latest_checkpoint_description,is_received,received_at').in('order_id',orderIds); assert(sr);
      const smap=new Map((sr.data||[]).map(x=>[x.order_id,x]));
      return orders.map(o=>({...o,items:imap.get(o.id)||[],shipment:smap.get(o.id)||null}));
    },
    async orderProductOptions(){ return this.products('','','all'); },
    async saveOrderAllocation(itemId,variantId,quantity){ const r=await db.rpc('importb2b_save_order_allocation',{p_item_id:Number(itemId),p_variant_id:variantId,p_ordered_quantity:Number(quantity)}); assert(r); return r.data; },
    async deleteOrderAllocation(allocationId){ const r=await db.rpc('importb2b_delete_order_allocation',{p_allocation_id:allocationId}); assert(r); },
    async receiveOrderAllocation(allocationId,quantity,note=''){ const r=await db.rpc('importb2b_receive_order_allocation',{p_allocation_id:allocationId,p_receive_quantity:Number(quantity),p_note:note||null}); assert(r); return r.data; },
    async setOrderItemStockMode(itemId,active){ const r=await db.rpc('importb2b_set_order_item_stock_mode',{p_item_id:Number(itemId),p_active:Boolean(active)}); assert(r); return r.data; },

    async customers(q=''){
      let req=db.from('importb2b_customer_summary').select('*').eq('active',true).order('full_name').limit(500);
      if(q){ const s=String(q).replace(/[,%()]/g,' '); req=req.or(`full_name.ilike.%${s}%,phone.ilike.%${s}%,email.ilike.%${s}%,customer_code.ilike.%${s}%`); }
      const r=await req; assert(r); return r.data||[];
    },
    async createCustomer(payload){
      const u=await authUser();
      const r=await db.from('importb2b_customers').insert({owner_id:u.id,active:true,source:'manual',...payload}).select().single(); assert(r); return r.data;
    },
    async updateCustomer(id,payload){ const r=await db.from('importb2b_customers').update(payload).eq('id',id); assert(r); },

    async paymentMethods(){ const r=await db.from('importb2b_payment_methods').select('*').eq('active',true).order('sort_order').order('name'); assert(r); return r.data||[]; },
    async completeSale({customerId=null,items,paymentMethodId,shipping=0,discount=0,notes=''}){
      const r=await db.rpc('importb2b_complete_sale',{p_customer_id:customerId||null,p_items:items,p_payment_method_id:paymentMethodId,p_shipping_ars:Number(shipping||0),p_discount_ars:Number(discount||0),p_notes:notes||null}); assert(r); return r.data;
    },
    async recentSales(limit=20){
      const sr=await db.from('importb2b_sales').select('id,sale_code,status,customer_id,subtotal_ars,discount_ars,fee_ars,shipping_ars,total_ars,profit_ars,original_payment_method,notes,seller_name,sold_at,created_at').order('sold_at',{ascending:false}).limit(limit); assert(sr);
      const sales=sr.data||[], ids=sales.map(x=>x.id), customerIds=[...new Set(sales.map(x=>x.customer_id).filter(Boolean))];
      let customers=[],payments=[];
      if(customerIds.length){ const r=await db.from('importb2b_customers').select('id,full_name,phone').in('id',customerIds); assert(r); customers=r.data||[]; }
      if(ids.length){ const r=await db.from('importb2b_sale_payments').select('sale_id,status,amount_ars,adjustment_amount_ars,payment_method_id,movement_id,settlement_id').in('sale_id',ids); assert(r); payments=r.data||[]; }
      const methodIds=[...new Set(payments.map(x=>x.payment_method_id).filter(Boolean))]; let methods=[];
      if(methodIds.length){ const r=await db.from('importb2b_payment_methods').select('id,name,code,finance_mode').in('id',methodIds); assert(r); methods=r.data||[]; }
      const cmap=new Map(customers.map(x=>[x.id,x])), mmap=new Map(methods.map(x=>[x.id,x])), pmap=new Map();
      for(const p of payments){ const arr=pmap.get(p.sale_id)||[]; arr.push({...p,method:mmap.get(p.payment_method_id)||null}); pmap.set(p.sale_id,arr); }
      return sales.map(s=>({...s,customer:cmap.get(s.customer_id)||null,payments:pmap.get(s.id)||[]}));
    },
    async saleDetail(id){
      const [s,i]=await Promise.all([
        db.from('importb2b_sales').select('*').eq('id',id).single(),
        db.from('importb2b_sale_items').select('*').eq('sale_id',id).order('created_at')
      ]); assert(s); assert(i); return {...s.data,items:i.data||[]};
    },
    async cancelSale(id,reason=''){ const r=await db.rpc('importb2b_cancel_sale',{p_sale_id:id,p_reason:reason||null}); assert(r); return r.data; },

    async uploadProductImage(productId,file,isPrimary=false){
      const u=await authUser();
      const ext=(file.name.split('.').pop()||'jpg').toLowerCase().replace(/[^a-z0-9]/g,'')||'jpg';
      const path=`${u.id}/${productId}/${crypto.randomUUID()}.${ext}`;
      const up=await db.storage.from('importb2b-catalog').upload(path,file,{cacheControl:'3600',upsert:false,contentType:file.type||undefined});
      if(up.error) throw up.error;
      const pub=db.storage.from('importb2b-catalog').getPublicUrl(path).data.publicUrl;
      if(isPrimary){ await db.from('importb2b_product_images').update({is_primary:false}).eq('product_id',productId); }
      const ins=await db.from('importb2b_product_images').insert({owner_id:u.id,product_id:productId,image_url:pub,storage_path:path,alt_text:file.name,is_primary:isPrimary,sort_order:0}).select().single();assert(ins);
      if(isPrimary){ const r=await db.from('importb2b_products').update({primary_image_url:pub}).eq('id',productId);assert(r); }
      return ins.data;
    },
    async setPrimaryImage(productId,imageId){
      const u=await authUser();
      const r=await db.from('importb2b_product_images').select('*').eq('id',imageId).eq('product_id',productId).single();assert(r);
      let x=await db.from('importb2b_product_images').update({is_primary:false}).eq('product_id',productId);assert(x);
      x=await db.from('importb2b_product_images').update({is_primary:true}).eq('id',imageId);assert(x);
      x=await db.from('importb2b_products').update({primary_image_url:r.data.image_url}).eq('id',productId);assert(x);
      return r.data;
    },
    async deleteProductImage(productId,image){
      if(image.storage_path){ const r=await db.storage.from('importb2b-catalog').remove([image.storage_path]); if(r.error) throw r.error; }
      const d=await db.from('importb2b_product_images').delete().eq('id',image.id);assert(d);
      if(image.is_primary){
        const n=await db.from('importb2b_product_images').select('*').eq('product_id',productId).order('created_at').limit(1);assert(n);
        const next=(n.data||[])[0];
        if(next) await this.setPrimaryImage(productId,next.id); else { const r=await db.from('importb2b_products').update({primary_image_url:null}).eq('id',productId);assert(r); }
      }
    },

    async catalogSettings(){ const u=await authUser(); const r=await db.from('importb2b_catalog_settings').select('*').eq('owner_id',u.id).single();assert(r);return r.data; },
    async saveCatalogSettings(payload){ const u=await authUser(); const r=await db.from('importb2b_catalog_settings').upsert({owner_id:u.id,...payload},{onConflict:'owner_id'}).select().single();assert(r);return r.data; },
    async webOrders(status='all'){
      let q=db.from('importb2b_web_orders').select('*').order('created_at',{ascending:false}).limit(150);if(status!=='all')q=q.eq('status',status);const r=await q;assert(r);return r.data||[];
    },
    async webOrderDetail(id){
      const [o,i,m]=await Promise.all([
        db.from('importb2b_web_orders').select('*').eq('id',id).single(),
        db.from('importb2b_web_order_items').select('*').eq('order_id',id).order('created_at'),
        db.from('importb2b_payment_methods').select('id,name,code').eq('active',true)
      ]);[o,i,m].forEach(assert);const mm=new Map((m.data||[]).map(x=>[x.id,x]));return {...o.data,items:i.data||[],payment_method:mm.get(o.data.payment_method_id)||null};
    },
    async webOrderAction(id,action,reason=''){
      const {data:{session}}=await db.auth.getSession();if(!session)throw new Error('Sesión no válida');
      const r=await fetch('/api/web-order-admin',{method:'POST',headers:{'content-type':'application/json','authorization':`Bearer ${session.access_token}`},body:JSON.stringify({order_id:id,action,reason})});
      const j=await r.json();if(!r.ok)throw new Error(j.error||'Error procesando pedido');return j;
    },

    async recentFinance(){
      const [m,s,r]=await Promise.all([
        db.from('movements').select('id,kind,amount,currency,payment_method,category,description,occurred_at,source_type,source_id').order('occurred_at',{ascending:false}).limit(25),
        db.from('settlements').select('id,provider,description,gross_amount,fees_amount,net_amount,expected_at,status,source_type,source_id').eq('status','pending').order('expected_at').limit(20),
        db.from('receivables').select('id,client_name,client_phone,description,total_amount,paid_amount,pending_amount,due_at,status,source_type,source_id').neq('status','paid').neq('status','cancelled').order('created_at',{ascending:false}).limit(20)
      ]); [m,s,r].forEach(assert); return {movements:m.data||[],settlements:s.data||[],receivables:r.data||[]};
    }
  };
})();
