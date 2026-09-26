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

  async function blobToImageSource(blob){
    if('createImageBitmap' in window){
      try{return await createImageBitmap(blob,{imageOrientation:'from-image'});}catch(e){try{return await createImageBitmap(blob);}catch(_){}}
    }
    return await new Promise((resolve,reject)=>{
      const u=URL.createObjectURL(blob),img=new Image();
      img.onload=()=>{URL.revokeObjectURL(u);resolve(img)};
      img.onerror=()=>{URL.revokeObjectURL(u);reject(new Error('No se pudo leer la imagen'))};
      img.src=u;
    });
  }

  async function resizeImageBlob(file,maxSide=1600,quality=.82){
    const src=await blobToImageSource(file);
    const ow=src.width||src.naturalWidth,oh=src.height||src.naturalHeight;
    if(!ow||!oh) throw new Error('Imagen sin dimensiones válidas');
    const scale=Math.min(1,maxSide/Math.max(ow,oh));
    const w=Math.max(1,Math.round(ow*scale)),h=Math.max(1,Math.round(oh*scale));
    const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;
    const ctx=canvas.getContext('2d',{alpha:true});ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';ctx.clearRect(0,0,w,h);ctx.drawImage(src,0,0,w,h);
    src.close?.();
    let blob=await new Promise(r=>canvas.toBlob(r,'image/webp',quality));
    if(!blob) blob=await new Promise(r=>canvas.toBlob(r,'image/jpeg',Math.min(.9,quality+.05)));
    canvas.width=1;canvas.height=1;
    if(!blob) throw new Error('No se pudo optimizar la imagen');
    return {blob,width:w,height:h};
  }

  async function prepareCatalogImage(file){
    if(!file?.type?.startsWith('image/')) throw new Error('Archivo de imagen inválido');
    const main=await resizeImageBlob(file,1700,.82);
    const thumb=await resizeImageBlob(file,480,.72);
    return {main,thumb,originalSize:Number(file.size||0),originalName:file.name||'producto'};
  }

  window.DB={
    async user(){ try{return await authUser()}catch{return null} },

    async dashboard(){
      const now=new Date();
      const monthStart=new Date(now.getFullYear(),now.getMonth(),1);
      const todayStart=new Date(now.getFullYear(),now.getMonth(),now.getDate());
      const yesterdayStart=new Date(todayStart);yesterdayStart.setDate(yesterdayStart.getDate()-1);
      const salesStart=yesterdayStart<monthStart?yesterdayStart:monthStart;
      const [p,v,sales,recv,sett,web,vars,stock,mov,recentWeb,recentMov,quickPending]=await Promise.all([
        db.from('importb2b_products').select('id',{count:'exact',head:true}).eq('active',true),
        db.from('importb2b_stock_valuation').select('*').limit(1),
        db.from('importb2b_sales').select('id,sale_code,total_ars,profit_ars,sold_at,status,customer_id,original_payment_method').eq('status','completed').gte('sold_at',salesStart.toISOString()).order('sold_at',{ascending:true}),
        db.from('importb2b_receivable_control').select('id,pending_amount,status,client_name,sale_code').neq('status','paid').neq('status','cancelled'),
        db.from('importb2b_settlement_control').select('id,net_amount,status,provider,expected_at,sale_code,customer_name').eq('status','pending'),
        db.from('importb2b_web_orders').select('id',{count:'exact',head:true}).eq('status','pending'),
        db.from('importb2b_product_variants').select('id,stock_min').eq('active',true),
        db.from('importb2b_stock_summary').select('variant_id,available,in_transit'),
        db.from('movements').select('id,kind,amount,currency,payment_method,category,description,occurred_at,source_type,source_id,ars_equivalent').gte('occurred_at',monthStart.toISOString()),
        db.from('importb2b_web_orders').select('id,order_code,status,total_ars,customer_name,created_at').order('created_at',{ascending:false}).limit(5),
        db.from('movements').select('id,kind,amount,currency,payment_method,category,description,occurred_at,source_type,source_id,ars_equivalent').order('occurred_at',{ascending:false}).limit(8),
        db.from('importb2b_sales').select('id',{count:'exact',head:true}).eq('status','completed').eq('stock_link_status','pending')
      ]);
      [p,v,sales,recv,sett,web,vars,stock,mov,recentWeb,recentMov,quickPending].forEach(assert);
      const valuation=(v.data||[])[0]||{physical_units:0,available_units:0,reserved_units:0,in_transit_units:0,stock_cost_ars:0,stock_sale_value_ars:0,expected_profit_ars:0};
      const allSales=sales.data||[];
      const isToday=x=>new Date(x.sold_at)>=todayStart;
      const isYesterday=x=>{const d=new Date(x.sold_at);return d>=yesterdayStart&&d<todayStart};
      const isMonth=x=>new Date(x.sold_at)>=monthStart;
      const today=allSales.filter(isToday), yesterday=allSales.filter(isYesterday), month=allSales.filter(isMonth);
      const sum=a=>a.reduce((n,x)=>n+Number(x.total_ars||0),0);
      const todaySales=sum(today),yesterdaySales=sum(yesterday),monthSales=sum(month);
      const todayCount=today.length,monthCount=month.length;
      const todayTicket=todayCount?todaySales/todayCount:0;
      const daysElapsed=Math.max(1,Math.floor((todayStart-monthStart)/86400000)+1);
      const monthDailyAvg=monthSales/daysElapsed;
      const hours=Array.from({length:15},(_,i)=>({hour:i+8,total:0,count:0}));
      for(const sale of today){const h=new Date(sale.sold_at).getHours();const slot=hours.find(x=>x.hour===h);if(slot){slot.total+=Number(sale.total_ars||0);slot.count++}}
      const stockMap=new Map((stock.data||[]).map(x=>[x.variant_id,x]));
      const lowStock=(vars.data||[]).filter(x=>{const s=stockMap.get(x.id)||{};const av=Number(s.available||0),min=Number(x.stock_min||0);return min>0&&av<=min}).length;
      const receivable=(recv.data||[]).reduce((a,x)=>a+Number(x.pending_amount||0),0);
      const settlements=(sett.data||[]).reduce((a,x)=>a+Number(x.net_amount||0),0);
      let income=0,expense=0;
      for(const x of (mov.data||[])){
        if(['internal_conversion','internal_transfer'].includes(x.source_type))continue;
        const val=Number(x.ars_equivalent ?? (x.currency==='ARS'?x.amount:0) ?? 0);
        if(x.kind==='income')income+=val; else if(x.kind==='expense')expense+=val;
      }
      const recent=(recentMov.data||[]).map(x=>({
        type:x.source_type==='sale'?'sale':'finance',
        date:x.occurred_at,
        title:x.description||x.category||'Movimiento',
        amount:(x.kind==='expense'?-1:1)*Number(x.ars_equivalent??x.amount??0),
        status:x.kind,
        movement_id:x.id,
        source_type:x.source_type,
        source_id:x.source_id
      })).slice(0,8);
      return {
        products:p.count||0,
        stock:Number(valuation.available_units||0),
        transit:Number(valuation.in_transit_units||0),
        valuation,
        todaySales,todayCount,todayTicket,yesterdaySales,monthSales,monthCount,monthDailyAvg,hours,
        receivable,receivableCount:(recv.data||[]).length,
        settlements,settlementCount:(sett.data||[]).length,
        webPending:web.count||0,quickPending:quickPending.count||0,lowStock,
        income,expense,operationalNet:income-expense,recent
      };
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
      const [vr,sr,ir]=await Promise.all([
        db.from('importb2b_product_variants').select('id,product_id,sku,variant_name,price_ars,wholesale_price_ars,cost_ars,stock_min,active,attributes').in('product_id',ids).eq('active',true).order('variant_name'),
        db.from('importb2b_stock_summary').select('*').in('product_id',ids),
        db.from('importb2b_product_images').select('product_id,image_url,thumbnail_url,is_primary,sort_order').in('product_id',ids).order('is_primary',{ascending:false}).order('sort_order')
      ]); assert(vr); assert(sr); assert(ir);
      const sm=new Map((sr.data||[]).map(x=>[x.variant_id,x]));
      const im=new Map(); for(const x of (ir.data||[])){ if(!im.has(x.product_id)) im.set(x.product_id,x); }
      const vm=new Map();
      for(const v of (vr.data||[])){
        const a=vm.get(v.product_id)||[];
        a.push({...v,stock:sm.get(v.id)||{on_hand:0,reserved:0,in_transit:0,available:0}}); vm.set(v.product_id,a);
      }
      let out=products.map(p=>{const img=im.get(p.id)||{};return {...p,thumbnail_url:img.thumbnail_url||img.image_url||p.primary_image_url||null,variants:vm.get(p.id)||[]}});
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
      let req=db.from('importb2b_customer_360').select('*').eq('active',true).order('full_name').limit(500);
      if(q){ const s=String(q).replace(/[,%()]/g,' '); req=req.or(`full_name.ilike.%${s}%,phone.ilike.%${s}%,email.ilike.%${s}%,customer_code.ilike.%${s}%`); }
      const r=await req; assert(r); return r.data||[];
    },
    async createCustomer(payload){
      const u=await authUser();
      const r=await db.from('importb2b_customers').insert({owner_id:u.id,active:true,source:'manual',...payload}).select().single(); assert(r); return r.data;
    },
    async updateCustomer(id,payload){ const r=await db.from('importb2b_customers').update(payload).eq('id',id); assert(r); },

    async customer360(id){
      const [c,sales,recv,memberships,claims,actions,rules,profile,events]=await Promise.all([
        db.from('importb2b_customer_360').select('*').eq('id',id).single(),
        db.from('importb2b_sales').select('id,sale_code,status,total_ars,profit_ars,original_payment_method,sold_at,notes').eq('customer_id',id).order('sold_at',{ascending:false}).limit(100),
        db.from('importb2b_receivable_control').select('*').eq('customer_id',id).order('created_at',{ascending:false}),
        db.from('importb2b_club_memberships').select('*').eq('customer_id',id).order('club_type'),
        db.from('importb2b_club_reward_claims').select('*').eq('customer_id',id).order('unlocked_at',{ascending:false}),
        db.from('importb2b_club_actions').select('*').eq('customer_id',id).order('created_at',{ascending:false}).limit(100),
        db.from('importb2b_club_reward_rules').select('*').eq('active',true).order('club_type').order('milestone'),
        db.from('importb2b_club_profiles').select('*').eq('customer_id',id).maybeSingle(),
        db.from('importb2b_club_events').select('*').eq('customer_id',id).order('occurred_at',{ascending:false}).limit(120)
      ]);[c,sales,recv,memberships,claims,actions,rules,profile,events].forEach(assert);
      const saleRows=sales.data||[], saleIds=saleRows.map(x=>x.id);let items=[];
      if(saleIds.length){const ir=await db.from('importb2b_sale_items').select('sale_id,original_item_name,quantity,line_total_ars').in('sale_id',saleIds).order('created_at');assert(ir);items=ir.data||[];}
      const imap=new Map();for(const x of items){const a=imap.get(x.sale_id)||[];a.push(x);imap.set(x.sale_id,a);}
      const smap=new Map(saleRows.map(x=>[x.id,x]));
      return {customer:c.data,sales:saleRows.map(x=>({...x,items:imap.get(x.id)||[]})),receivables:recv.data||[],memberships:memberships.data||[],claims:claims.data||[],actions:(actions.data||[]).map(x=>({...x,sale:smap.get(x.sale_id)||null})),rules:rules.data||[],profile:profile.data||null,events:events.data||[]};
    },
    async ensureClubProfile(customerId){ const r=await db.rpc('importb2b_club_ensure_profile',{p_customer_id:customerId});assert(r);return r.data; },
    async addCustomerClub(customerId,clubType){ const r=await db.rpc('importb2b_club_add_membership',{p_customer_id:customerId,p_club_type:clubType});assert(r);return r.data; },
    async registerClubPoint(customerId,clubType,saleId=null,purchaseAmount=null,observation=''){
      const r=await db.rpc('importb2b_club_register_verified_purchase',{p_customer_id:customerId,p_club_type:clubType,p_sale_id:saleId||null,p_purchase_amount:purchaseAmount==null?null:Number(purchaseAmount),p_observation:observation||null});assert(r);return r.data;
    },
    async deliverClubReward(claimId,notes=''){ const r=await db.rpc('importb2b_club_deliver_reward',{p_claim_id:claimId,p_notes:notes||null});assert(r);return r.data; },
    async importLegacyClub(payload){ const r=await db.rpc('importb2b_import_legacy_club',{p_payload:payload});assert(r);return r.data; },
    async legacyClubMap(){ const u=await authUser();const r=await db.from('importb2b_club_legacy_customer_map').select('*').eq('owner_id',u.id).order('migrated_at',{ascending:false});assert(r);return r.data||[]; },
    async pdfCatalogProducts(){
      const products=await this.products('','','all');
      const ids=products.map(x=>x.id);if(!ids.length)return [];
      const ir=await db.from('importb2b_product_images').select('product_id,image_url,is_primary,sort_order').in('product_id',ids).order('is_primary',{ascending:false}).order('sort_order');assert(ir);
      const im=new Map();for(const x of (ir.data||[])){if(!im.has(x.product_id)&&x.image_url)im.set(x.product_id,x.image_url)}
      return products.map(x=>({...x,pdf_image_url:x.primary_image_url||im.get(x.id)||null}));
    },
    async clubOverview(q=''){
      const u=await authUser();
      const [ov,mr,cr,pr,rr]=await Promise.all([
        db.from('importb2b_club_overview').select('*').eq('owner_id',u.id).maybeSingle(),
        db.from('importb2b_club_memberships').select('*').eq('owner_id',u.id).eq('active',true).order('updated_at',{ascending:false}),
        db.from('importb2b_customer_360').select('id,full_name,phone,instagram_username,completed_sales,total_spent_ars,pending_receivable_ars,club_points,pending_rewards,member_code,club_access_token').eq('owner_id',u.id).eq('active',true).order('full_name'),
        db.from('importb2b_club_profiles').select('*').eq('owner_id',u.id).eq('active',true),
        db.from('importb2b_club_reward_claims').select('*').eq('owner_id',u.id).eq('status','pending').order('unlocked_at',{ascending:false})
      ]);[ov,mr,cr,pr,rr].forEach(assert);
      const customers=cr.data||[], cmap=new Map(customers.map(x=>[x.id,x])), pmap=new Map((pr.data||[]).map(x=>[x.customer_id,x])), mmap=new Map();
      for(const m of (mr.data||[])){const a=mmap.get(m.customer_id)||[];a.push(m);mmap.set(m.customer_id,a);}
      const term=String(q||'').trim().toLowerCase();
      const members=[...mmap.entries()].map(([id,clubs])=>({customer:cmap.get(id)||null,profile:pmap.get(id)||null,memberships:clubs})).filter(x=>x.customer&&(!term||[x.customer.full_name,x.customer.phone,x.customer.instagram_username,x.profile?.member_code,...x.memberships.map(m=>m.club_type)].join(' ').toLowerCase().includes(term)));
      const claims=(rr.data||[]).map(x=>({...x,customer:cmap.get(x.customer_id)||null}));
      return {overview:ov.data||{members:0,total_points:0,vapers_memberships:0,jerseys_memberships:0,perfumes_memberships:0,importb2b_memberships:0,pending_rewards:0},members,claims};
    },

    async paymentMethods(){ const r=await db.from('importb2b_payment_methods').select('*').eq('active',true).order('sort_order').order('name'); assert(r); return r.data||[]; },
    async completeSale({customerId=null,items,paymentMethodId,shipping=0,discount=0,notes='',holder=null}){
      const r=await db.rpc('importb2b_complete_sale',{p_customer_id:customerId||null,p_items:items,p_payment_method_id:paymentMethodId,p_shipping_ars:Number(shipping||0),p_discount_ars:Number(discount||0),p_notes:notes||null,p_holder:holder||null}); assert(r); return r.data;
    },
    async quickSale({amount,paymentMethodId,holder=null,customerId=null,notes=''}){
      const r=await db.rpc('importb2b_complete_quick_sale',{p_amount_ars:Number(amount),p_payment_method_id:paymentMethodId,p_holder:holder||null,p_customer_id:customerId||null,p_notes:notes||null});assert(r);return r.data;
    },
    async pendingQuickSales(){ const r=await db.from('importb2b_sales').select('id,sale_code,total_ars,original_payment_method,notes,sold_at,stock_link_status').eq('status','completed').eq('stock_link_status','pending').order('sold_at',{ascending:false}).limit(100);assert(r);return r.data||[]; },
    async linkQuickSaleItem(saleId,variantId,quantity=1){ const r=await db.rpc('importb2b_link_quick_sale_item',{p_sale_id:saleId,p_variant_id:variantId,p_quantity:Number(quantity)});assert(r);return r.data; },
    async recentSales(limit=20){
      const sr=await db.from('importb2b_sales').select('id,sale_code,status,customer_id,subtotal_ars,discount_ars,fee_ars,shipping_ars,total_ars,profit_ars,original_payment_method,notes,seller_name,source,stock_link_status,sold_at,created_at').order('sold_at',{ascending:false}).limit(limit); assert(sr);
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
      const prepared=await prepareCatalogImage(file);
      const token=crypto.randomUUID();
      const mainPath=`${u.id}/${productId}/${token}.webp`;
      const thumbPath=`${u.id}/${productId}/${token}_thumb.webp`;
      const upMain=await db.storage.from('importb2b-catalog').upload(mainPath,prepared.main.blob,{cacheControl:'31536000',upsert:false,contentType:prepared.main.blob.type||'image/webp'});
      if(upMain.error) throw upMain.error;
      const upThumb=await db.storage.from('importb2b-catalog').upload(thumbPath,prepared.thumb.blob,{cacheControl:'31536000',upsert:false,contentType:prepared.thumb.blob.type||'image/webp'});
      if(upThumb.error){await db.storage.from('importb2b-catalog').remove([mainPath]);throw upThumb.error;}
      const pub=db.storage.from('importb2b-catalog').getPublicUrl(mainPath).data.publicUrl;
      const thumbPub=db.storage.from('importb2b-catalog').getPublicUrl(thumbPath).data.publicUrl;
      if(isPrimary){ const x=await db.from('importb2b_product_images').update({is_primary:false}).eq('product_id',productId);assert(x); }
      const ins=await db.from('importb2b_product_images').insert({owner_id:u.id,product_id:productId,image_url:pub,storage_path:mainPath,thumbnail_url:thumbPub,thumbnail_storage_path:thumbPath,alt_text:prepared.originalName,is_primary:isPrimary,sort_order:0,original_size_bytes:prepared.originalSize,optimized_size_bytes:prepared.main.blob.size,width:prepared.main.width,height:prepared.main.height,mime_type:prepared.main.blob.type||'image/webp'}).select().single();assert(ins);
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
      const paths=[image.storage_path,image.thumbnail_storage_path].filter(Boolean);if(paths.length){ const r=await db.storage.from('importb2b-catalog').remove(paths); if(r.error) throw r.error; }
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
        db.from('importb2b_payment_methods').select('id,name,code,finance_mode,finance_payment_method').eq('active',true)
      ]);[o,i,m].forEach(assert);const mm=new Map((m.data||[]).map(x=>[x.id,x]));return {...o.data,items:i.data||[],payment_method:mm.get(o.data.payment_method_id)||null};
    },
    async webOrderAction(id,action,reason='',holder=null){
      const fn=action==='confirm'?'importb2b_confirm_web_order':action==='cancel'?'importb2b_cancel_web_order':null;
      if(!fn) throw new Error('Acción inválida');
      const params=action==='confirm'?{p_order_id:id,p_holder:holder||null}:{p_order_id:id,p_reason:reason||null};
      const r=await db.rpc(fn,params);assert(r);return r.data;
    },

    async createManualMovement(payload){
      const u=await authUser();
      const currency=payload.currency||'ARS', amount=Number(payload.amount||0);
      if(amount<=0) throw new Error('El monto debe ser mayor a 0');
      const quote=currency==='USDT'?Number(payload.quote_ars||0):null;
      if(currency==='USDT'&&quote<=0) throw new Error('Ingresá la cotización USDT');
      const row={kind:payload.kind,amount,currency,payment_method:payload.payment_method,category:payload.category||'OTRO',description:payload.description||null,occurred_at:payload.occurred_at||new Date().toISOString(),quote_type:currency==='USDT'?(payload.quote_type||'buy'):null,quote_ars:quote,ars_equivalent:currency==='USDT'?amount*quote:amount,created_by:u.id,source_type:'manual',cash_holder:payload.payment_method==='efectivo'?(payload.holder||'nahuel'):null,transfer_holder:payload.payment_method==='transferencia'?(payload.holder||'nahuel'):null,usdt_holder:payload.payment_method==='usdt'?(payload.holder||'nahuel'):null};
      const r=await db.from('movements').insert(row).select().single();assert(r);return r.data;
    },
    async createManualSettlement(payload){
      const u=await authUser();
      const gross=Number(payload.gross_amount||0),fees=Number(payload.fees_amount||0);
      if(gross<=0||fees<0||fees>gross) throw new Error('Revisá bruto y comisiones');
      const r=await db.from('settlements').insert({provider:payload.provider||'otro',description:payload.description||null,gross_amount:gross,fees_amount:fees,expected_at:payload.expected_at||null,status:'pending',destination_method:'transferencia',created_by:u.id,payment_method_id:payload.payment_method_id||null}).select().single();assert(r);return r.data;
    },
    async updateManualSettlement(id,payload){ const r=await db.from('settlements').update(payload).eq('id',id).is('source_type',null).eq('status','pending').select().single();assert(r);return r.data; },
    async createManualReceivable(payload){
      const u=await authUser();const total=Number(payload.total_amount||0);if(total<=0)throw new Error('El total debe ser mayor a 0');
      const r=await db.from('receivables').insert({client_name:payload.client_name,client_phone:payload.client_phone||null,description:payload.description||null,total_amount:total,paid_amount:0,due_at:payload.due_at||null,status:'pending',created_by:u.id}).select().single();assert(r);return r.data;
    },
    async updateManualReceivable(id,payload){ const r=await db.from('receivables').update(payload).eq('id',id).is('source_type',null).select().single();assert(r);return r.data; },
    async updateFinanceMovement(id,payload){
      const r=await db.rpc('importb2b_update_finance_movement',{
        p_movement_id:id,
        p_amount:payload.amount??null,
        p_kind:payload.kind??null,
        p_payment_method:payload.payment_method??null,
        p_category:payload.category??null,
        p_description:payload.description??null,
        p_occurred_at:payload.occurred_at??null
      });assert(r);return r.data;
    },
    async deleteManualMovement(id){ const r=await db.rpc('importb2b_delete_manual_movement',{p_movement_id:id});assert(r);return r.data; },
    async settleFinanceItem(id,method,holder){ const r=await db.rpc('importb2b_settle_finance_item',{p_settlement_id:id,p_destination_method:method,p_holder:holder});assert(r);return r.data; },
    async deleteManualSettlement(id){ const r=await db.rpc('importb2b_delete_manual_settlement',{p_settlement_id:id});assert(r);return r.data; },
    async deleteManualReceivable(id){ const r=await db.rpc('importb2b_delete_manual_receivable',{p_receivable_id:id});assert(r);return r.data; },
    async recordReceivablePayment(id,amount,method,holder){ const r=await db.rpc('record_receivable_payment_v2',{p_receivable_id:id,p_amount:Number(amount),p_payment_method:method,p_holder:holder});assert(r);return r.data; },
    async linkSettlementSale(settlementId,saleId){ const r=await db.rpc('importb2b_link_settlement_to_sale',{p_settlement_id:settlementId,p_sale_id:saleId});assert(r);return r.data; },
    async linkReceivableSale(receivableId,saleId){ const r=await db.rpc('importb2b_link_receivable_to_sale',{p_receivable_id:receivableId,p_sale_id:saleId});assert(r);return r.data; },
    async assignMovementHolder(movementId,holder){ const r=await db.rpc('importb2b_assign_movement_holder',{p_movement_id:movementId,p_holder:holder});assert(r);return r.data; },
    async financeData(limit=400){
      const [m,s,r,q,a,sales]=await Promise.all([
        db.from('movements').select('id,kind,amount,currency,payment_method,category,description,occurred_at,source_type,source_id,ars_equivalent,cash_holder,transfer_holder,usdt_holder,edited_at').order('occurred_at',{ascending:false}).limit(limit),
        db.from('importb2b_settlement_control').select('*').order('expected_at',{ascending:true}).limit(200),
        db.from('importb2b_receivable_control').select('*').order('created_at',{ascending:false}).limit(200),
        db.from('quote_snapshots').select('buy_ars,sell_ars,source,captured_at').order('captured_at',{ascending:false}).limit(1),
        db.from('audit_log').select('id,entity_type,entity_id,action,actor_id,old_data,new_data,created_at').in('entity_type',['movement','settlement','receivable']).order('created_at',{ascending:false}).limit(100),
        db.from('importb2b_sales').select('id,sale_code,total_ars,sold_at,customer_id,status,original_payment_method').order('sold_at',{ascending:false}).limit(250)
      ]);[m,s,r,q,a,sales].forEach(assert);
      const movements=m.data||[], settlements=s.data||[], receivables=r.data||[];
      const balances={cash:0,transfer:0,usdt:0};let income=0,expense=0;
      for(const x of movements){
        const sign=x.kind==='income'?1:-1;
        if(x.currency==='USDT'&&x.payment_method==='usdt')balances.usdt+=sign*Number(x.amount||0);
        if(x.currency==='ARS'&&x.payment_method==='efectivo')balances.cash+=sign*Number(x.amount||0);
        if(x.currency==='ARS'&&x.payment_method==='transferencia')balances.transfer+=sign*Number(x.amount||0);
        if(!['internal_conversion','internal_transfer'].includes(x.source_type)){
          const val=Number(x.ars_equivalent ?? (x.currency==='ARS'?x.amount:0) ?? 0);
          if(x.kind==='income')income+=val; else if(x.kind==='expense')expense+=val;
        }
      }
      return {movements,settlements,receivables,quote:(q.data||[])[0]||null,audit:a.data||[],sales:sales.data||[],balances,income,expense,net:income-expense};
    },
    async receivablePayments(id){ const r=await db.from('receivable_payments').select('*').eq('receivable_id',id).order('created_at',{ascending:false});assert(r);return r.data||[]; },
    async recentFinance(limit=250){ return this.financeData(limit); }
  };
})();
