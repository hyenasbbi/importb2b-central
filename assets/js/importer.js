(function(){
  const OWNER=()=>window.currentUser?.id;
  const money=(value)=>{
    if(value===null||value===undefined||String(value).trim()==='') return 0;
    let s=String(value).trim().replace(/\s/g,'');
    if(s.includes(',')) s=s.replace(/\./g,'').replace(',','.');
    else if(/^[-+]?\d{1,3}(\.\d{3})+$/.test(s)) s=s.replace(/\./g,'');
    const n=Number(s); return Number.isFinite(n)?n:0;
  };
  const num=(v)=>{const n=Number(String(v??'').replace(',','.'));return Number.isFinite(n)?n:0};
  const text=(v)=>String(v??'').trim();
  const sizePattern=/^(.*?)\s+-\s+(XS|S|M|L|XL|XXL|XXXL|2XL|3XL|4XL|5XL)$/i;

  function normalizeProduct(r,row){
    const name=text(r['Nombre']);
    const rawCategory=text(r['Categoria']);
    const categoryMap={'CAMISETAS':'Camisetas','CAMPERAS':'Camperas','SHORES IMPORTADOS':'Shores Importados','VAPERS':'Vapers'};
    const category=categoryMap[rawCategory.toUpperCase()]||rawCategory||'SIN CLASIFICAR';
    const stock=num(r['Stock Actual']);
    const issues=[];
    if(!name) issues.push('SIN_NOMBRE');
    if(!rawCategory) issues.push('SIN_CATEGORIA');
    if(stock<0) issues.push('STOCK_NEGATIVO');

    let baseName=name, size=null, flavor=null;
    if(category.toLowerCase()==='vapers'){
      const vm=name.match(/^(.*?)\s+-\s+(.+)$/);
      if(vm){ baseName=vm[1].trim(); flavor=vm[2].trim(); }
    }else{
      const sm=name.match(sizePattern);
      if(sm){ baseName=sm[1].trim(); size=sm[2].toUpperCase(); }
    }

    return {
      row,
      name,
      category,
      base_name:baseName,
      size,
      flavor,
      unit:text(r['Unid / Frac.'])||'unidad',
      stock,
      stock_min:num(r['Stock Minimo']),
      cost_ars:money(r['Costo']),
      price_ars:money(r['Precio']),
      sold_value_ars:money(r['Valor vendido']),
      sold_qty:num(r['Cantidad Vendida']),
      profit_ars:money(r['Ganancia']),
      issues
    };
  }

  function normalizeCustomer(r,row){
    const name=text(r['Nombre']); const issues=[]; if(!name) issues.push('SIN_NOMBRE');
    return {row,full_name:name,phone:text(r['Teléfono']),phone2:text(r['Teléfono 2']),email:text(r['Correo']),document_number:text(r['N° Doc.']),address:text(r['Dirección']),address_extra:text(r['Complemento']),notes:text(r['Observación']),historical_sales_ars:money(r['Valor de Venta']),historical_sales_count:num(r['Cantidad de Ventas']),created_date:text(r['Fecha Creación']),issues};
  }

  function parseDate(s){ const m=String(s||'').match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2}))?/); if(!m)return null; return `${m[3]}-${m[2]}-${m[1]}T${m[4]||'00'}:${m[5]||'00'}:00`; }

  function normalizeSale(r,row){
    const rawStatus=text(r['Status']);
    const map={'Venta':'completed','confirmado':'confirmed','Pedido Pendiente':'pending','Cancelado':'cancelled'};
    const issues=[];
    if(!text(r['N°'])) issues.push('SIN_NUMERO');
    return {row,sale_code:text(r['N°']),status:map[rawStatus]||'pending',raw_status:rawStatus,sold_at:parseDate(r['Fecha/Hora']),item_count:num(r['Total de ítems']),quantity:num(r['Cantidad']),items_description:text(r['Descri. Items']),subtotal_ars:money(r['Subtotal']),discount_ars:money(r['Descuento']),fee_ars:money(r['Tasa']),shipping_ars:money(r['Envío']),total_ars:money(r['Total']),profit_ars:money(r['Ganancia']),payment_method:text(r['Forma de Pago']),customer_name:text(r['Cliente']),seller_name:text(r['Vendedor']),notes:text(r['Observación']),issues};
  }

  function rowHasData(r){ return Object.values(r||{}).some(v=>String(v??'').trim()!==''); }

  async function parseFile(file,type){
    return new Promise((resolve,reject)=>Papa.parse(file,{
      header:true,
      skipEmptyLines:'greedy',
      complete:r=>{
        if(r.errors?.length) console.warn(r.errors);
        const fn=type==='product'?normalizeProduct:type==='customer'?normalizeCustomer:normalizeSale;
        const rows=(r.data||[]).filter(rowHasData).map((x,i)=>({raw:x,normalized:fn(x,i+2)}));
        resolve(rows);
      },
      error:reject
    }));
  }

  async function insertChunks(table,rows,size=100){
    for(let i=0;i<rows.length;i+=size){
      const {error}=await db.from(table).insert(rows.slice(i,i+size)); if(error) throw error;
    }
  }

  async function createBatch(files){
    const u=OWNER(); if(!u) throw new Error('Sesión no válida');
    const {data,error}=await db.from('importb2b_import_batches').insert({owner_id:u,source:'kyte',status:'uploaded',products_filename:files.products?.name||null,customers_filename:files.customers?.name||null,sales_filename:files.sales?.name||null,metadata:{phase:'phase3',created_from:'import_center'},created_by:u}).select().single();
    if(error) throw error; return data;
  }

  async function stage(batch,parsed,type){
    const u=OWNER();
    const rows=parsed.map((x,i)=>({
      owner_id:u,
      batch_id:batch.id,
      entity_type:type,
      row_number:i+2,
      source_id:type==='sale'?x.normalized.sale_code:`row:${i+2}`,
      raw_data:x.raw,
      normalized_data:x.normalized,
      status:x.normalized.issues?.length?'needs_review':'ready',
      issues:x.normalized.issues||[]
    }));
    await insertChunks('importb2b_import_rows',rows); return rows;
  }

  async function uploadAll(files,onProgress=()=>{}){
    const selected=[['product',files.products],['customer',files.customers],['sale',files.sales]].filter(x=>x[1]);
    if(!selected.length) throw new Error('Seleccioná al menos un archivo');
    const batch=await createBatch(files); let done=0,total=selected.length; const summary={batch_id:batch.id};
    for(const [type,file] of selected){
      const parsed=await parseFile(file,type);
      await stage(batch,parsed,type);
      summary[type]={rows:parsed.length,issues:parsed.filter(x=>x.normalized.issues?.length).length};
      done++; onProgress(done/total*.9);
    }
    if(files.products){
      await DB.refreshImportProductIssues(batch.id);
      const rows=await DB.importRows(batch.id,'product');
      summary.product.issues=rows.filter(x=>x.status==='needs_review').length;
    }
    await db.from('importb2b_import_batches').update({status:'analyzed',metadata:{...batch.metadata,summary}}).eq('id',batch.id);
    onProgress(1);
    return summary;
  }

  window.KyteImporter={money,parseFile,uploadAll};
})();
