(function(){
  const c=window.IMPORTB2B_CONFIG;
  if(!c?.SUPABASE_URL || !c?.SUPABASE_PUBLISHABLE_KEY) throw new Error("Falta configuración Supabase");
  window.db=window.supabase.createClient(c.SUPABASE_URL,c.SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:true,autoRefreshToken:true}});

  const assert=({error})=>{ if(error) throw error; };

  window.DB={
    async user(){ const {data,error}=await db.auth.getUser(); if(error) return null; return data.user; },

    async dashboard(){
      const monthStart=new Date(); monthStart.setDate(1); monthStart.setHours(0,0,0,0);
      const [p,s,o,r,m,b]=await Promise.all([
        db.from('importb2b_products').select('id',{count:'exact',head:true}),
        db.from('importb2b_stock_summary').select('available,in_transit'),
        db.from('importb2b_orders').select('id',{count:'exact',head:true}),
        db.from('receivables').select('pending_amount,status').neq('status','paid'),
        db.from('movements').select('kind,ars_equivalent,amount,currency').gte('occurred_at',monthStart.toISOString()),
        db.from('importb2b_import_batch_stats').select('product_review,product_ready,product_imported,created_at').order('created_at',{ascending:false}).limit(1)
      ]);
      [p,s,o,r,m,b].forEach(assert);
      const stock=(s.data||[]).reduce((a,x)=>a+Number(x.available||0),0);
      const transit=(s.data||[]).reduce((a,x)=>a+Number(x.in_transit||0),0);
      const receivable=(r.data||[]).reduce((a,x)=>a+Number(x.pending_amount||0),0);
      let income=0,expense=0;
      for(const x of (m.data||[])){
        const val=Number(x.ars_equivalent ?? (x.currency==='ARS'?x.amount:0) ?? 0);
        if(x.kind==='income') income+=val; else if(x.kind==='expense') expense+=val;
      }
      return {products:p.count||0,stock,transit,orders:o.count||0,receivable,income,expense,importBatch:(b.data||[])[0]||null};
    },

    async products(q='',category='',stockFilter='all'){
      let req=db.from('importb2b_products').select('id,sku,name,category,active,catalog_visible,primary_image_url,created_at').order('name');
      if(q) req=req.ilike('search_text',`%${q.toLowerCase()}%`);
      if(category) req=req.eq('category',category);
      const {data:products,error}=await req.limit(1000); if(error) throw error;
      const ids=(products||[]).map(x=>x.id); if(!ids.length) return [];
      const [{data:vars,error:ve},{data:stock,error:se}]=await Promise.all([
        db.from('importb2b_product_variants').select('id,product_id,sku,variant_name,price_ars,cost_ars,stock_min,active,attributes').in('product_id',ids).order('variant_name'),
        db.from('importb2b_stock_summary').select('*').in('product_id',ids)
      ]); if(ve) throw ve; if(se) throw se;
      const sm=new Map((stock||[]).map(x=>[x.variant_id,x]));
      const vm=new Map();
      for(const v of (vars||[])){
        const a=vm.get(v.product_id)||[];
        a.push({...v,stock:sm.get(v.id)||{on_hand:0,reserved:0,in_transit:0,available:0}});
        vm.set(v.product_id,a);
      }
      let out=(products||[]).map(p=>({...p,variants:vm.get(p.id)||[]}));
      if(stockFilter!=='all') out=out.filter(p=>{
        const available=p.variants.reduce((a,v)=>a+Number(v.stock.available||0),0);
        const transit=p.variants.reduce((a,v)=>a+Number(v.stock.in_transit||0),0);
        if(stockFilter==='available') return available>0;
        if(stockFilter==='out') return available<=0;
        if(stockFilter==='transit') return transit>0;
        if(stockFilter==='low') return p.variants.some(v=>Number(v.stock.available||0)<=Number(v.stock_min||0) && Number(v.stock.available||0)>0);
        return true;
      });
      return out;
    },

    async productDetail(id){
      const [p,v,s]=await Promise.all([
        db.from('importb2b_products').select('*').eq('id',id).single(),
        db.from('importb2b_product_variants').select('*').eq('product_id',id).order('variant_name'),
        db.from('importb2b_stock_summary').select('*').eq('product_id',id)
      ]);
      [p,v,s].forEach(assert);
      const sm=new Map((s.data||[]).map(x=>[x.variant_id,x]));
      return {...p.data,variants:(v.data||[]).map(x=>({...x,stock:sm.get(x.id)||{on_hand:0,reserved:0,in_transit:0,available:0}}))};
    },

    async saveProduct(id,payload){
      const {error}=await db.from('importb2b_products').update(payload).eq('id',id); if(error) throw error;
    },

    async saveVariant(id,payload){
      const {error}=await db.from('importb2b_product_variants').update(payload).eq('id',id); if(error) throw error;
    },

    async createVariant(productId,payload,initialStock=0,note='Alta manual de variante'){
      const user=(await db.auth.getUser()).data.user; if(!user) throw new Error('Sesión no válida');
      const {data:v,error}=await db.from('importb2b_product_variants').insert({owner_id:user.id,product_id:productId,...payload}).select().single(); if(error) throw error;
      const qty=Number(initialStock||0);
      if(qty>0){
        const {error:me}=await db.from('importb2b_inventory_movements').insert({owner_id:user.id,product_id:productId,variant_id:v.id,bucket:'on_hand',movement_type:'adjustment',quantity_delta:qty,unit_cost_ars:payload.cost_ars||null,reference_type:'manual_variant_create',reference_id:v.id,note,created_by:user.id});
        if(me) throw me;
      }
      return v;
    },

    async adjustStock(productId,variantId,currentOnHand,newOnHand,note){
      const user=(await db.auth.getUser()).data.user; if(!user) throw new Error('Sesión no válida');
      const delta=Number(newOnHand)-Number(currentOnHand);
      if(!Number.isFinite(delta)) throw new Error('Cantidad inválida');
      if(delta===0) return {delta:0};
      const {error}=await db.from('importb2b_inventory_movements').insert({owner_id:user.id,product_id:productId,variant_id:variantId,bucket:'on_hand',movement_type:'adjustment',quantity_delta:delta,reference_type:'manual_stock_adjustment',reference_id:variantId,note:note||'Ajuste manual de stock',created_by:user.id});
      if(error) throw error; return {delta};
    },

    async categories(){
      const {data,error}=await db.from('importb2b_products').select('category'); if(error) throw error;
      return [...new Set((data||[]).map(x=>x.category).filter(Boolean))].sort();
    },

    async importBatches(){
      const {data,error}=await db.from('importb2b_import_batch_stats').select('*').order('created_at',{ascending:false}).limit(20); if(error) throw error; return data||[];
    },

    async importRows(batchId,entityType='product'){
      const {data,error}=await db.from('importb2b_import_rows').select('id,row_number,entity_type,raw_data,normalized_data,status,issues,target_id,updated_at').eq('batch_id',batchId).eq('entity_type',entityType).order('row_number');
      if(error) throw error; return data||[];
    },

    async saveImportProduct(rowId,batchId,normalized){
      const {error}=await db.from('importb2b_import_rows').update({normalized_data:normalized,status:'ready',issues:[]}).eq('id',rowId); if(error) throw error;
      return this.refreshImportProductIssues(batchId);
    },

    async skipImportRow(rowId){
      const {error}=await db.from('importb2b_import_rows').update({status:'skipped'}).eq('id',rowId); if(error) throw error;
    },

    async restoreImportRow(rowId,batchId){
      const {error}=await db.from('importb2b_import_rows').update({status:'ready'}).eq('id',rowId); if(error) throw error;
      return this.refreshImportProductIssues(batchId);
    },

    async refreshImportProductIssues(batchId){
      const {data,error}=await db.rpc('importb2b_refresh_kyte_product_issues',{p_batch_id:batchId}); if(error) throw error; return data;
    },

    async mergeImportProductRows(targetId,sourceId){
      const {data,error}=await db.rpc('importb2b_merge_kyte_product_rows',{p_target_id:targetId,p_source_id:sourceId}); if(error) throw error; return data;
    },

    async commitKyteProducts(batchId){
      const {data,error}=await db.rpc('importb2b_commit_kyte_products',{p_batch_id:batchId}); if(error) throw error; return data;
    },

    async recentOrders(){
      const {data,error}=await db.from('importb2b_orders').select('id,order_number,order_date,total_units,investment_usd,note').order('order_date',{ascending:false}).limit(12); if(error) throw error; return data||[];
    },

    async recentFinance(){
      const {data,error}=await db.from('movements').select('id,kind,amount,currency,payment_method,category,description,occurred_at,source_type,source_id').order('occurred_at',{ascending:false}).limit(20); if(error) throw error; return data||[];
    }
  };
})();
