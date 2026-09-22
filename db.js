(function(){
  const c=window.IMPORTB2B_CONFIG;
  if(!c?.SUPABASE_URL || !c?.SUPABASE_PUBLISHABLE_KEY) throw new Error("Falta configuración Supabase");
  window.db=window.supabase.createClient(c.SUPABASE_URL,c.SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:true,autoRefreshToken:true}});

  window.DB={
    async user(){ const {data,error}=await db.auth.getUser(); if(error) return null; return data.user; },
    async dashboard(ownerId){
      const monthStart=new Date(); monthStart.setDate(1); monthStart.setHours(0,0,0,0);
      const [p,s,o,r,m]=await Promise.all([
        db.from('importb2b_products').select('id',{count:'exact',head:true}),
        db.from('importb2b_stock_summary').select('available,in_transit'),
        db.from('importb2b_orders').select('id',{count:'exact',head:true}),
        db.from('receivables').select('pending_amount,status').neq('status','paid'),
        db.from('movements').select('kind,ars_equivalent,amount,currency').gte('occurred_at',monthStart.toISOString())
      ]);
      const stock=(s.data||[]).reduce((a,x)=>a+Number(x.available||0),0);
      const transit=(s.data||[]).reduce((a,x)=>a+Number(x.in_transit||0),0);
      const receivable=(r.data||[]).reduce((a,x)=>a+Number(x.pending_amount||0),0);
      let income=0,expense=0;
      for(const x of (m.data||[])){
        const val=Number(x.ars_equivalent ?? (x.currency==='ARS'?x.amount:0) ?? 0);
        if(x.kind==='income') income+=val; else if(x.kind==='expense') expense+=val;
      }
      return {products:p.count||0,stock,transit,orders:o.count||0,receivable,income,expense};
    },
    async products(q='',category='',stockFilter='all'){
      let req=db.from('importb2b_products').select('id,sku,name,category,active,catalog_visible,primary_image_url,created_at').order('name');
      if(q) req=req.ilike('search_text',`%${q.toLowerCase()}%`);
      if(category) req=req.eq('category',category);
      const {data:products,error}=await req.limit(1000); if(error) throw error;
      const ids=(products||[]).map(x=>x.id); if(!ids.length) return [];
      const [{data:vars,error:ve},{data:stock,error:se}]=await Promise.all([
        db.from('importb2b_product_variants').select('id,product_id,sku,variant_name,price_ars,cost_ars,stock_min,active').in('product_id',ids),
        db.from('importb2b_stock_summary').select('*').in('product_id',ids)
      ]); if(ve) throw ve; if(se) throw se;
      const sm=new Map((stock||[]).map(x=>[x.variant_id,x]));
      const vm=new Map(); for(const v of (vars||[])){ const a=vm.get(v.product_id)||[]; a.push({...v,stock:sm.get(v.id)||{on_hand:0,reserved:0,in_transit:0,available:0}}); vm.set(v.product_id,a); }
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
    async categories(){ const {data}=await db.from('importb2b_products').select('category'); return [...new Set((data||[]).map(x=>x.category).filter(Boolean))].sort(); },
    async recentOrders(){ const {data,error}=await db.from('importb2b_orders').select('id,order_number,order_date,total_units,investment_usd,note').order('order_date',{ascending:false}).limit(12); if(error) throw error; return data||[]; },
    async recentFinance(){ const {data,error}=await db.from('movements').select('id,kind,amount,currency,payment_method,category,description,occurred_at,source_type,source_id').order('occurred_at',{ascending:false}).limit(20); if(error) throw error; return data||[]; }
  };
})();
