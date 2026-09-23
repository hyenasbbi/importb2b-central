(function(){
  const $=s=>document.querySelector(s);
  const content=$('#content');
  window.currentUser=null;
  let currentView='dashboard';
  let selectedBatchId=null;
  let importStatusFilter='needs_review';
  let importSearch='';
  let importSearchTimer=null;

  const money=n=>new Intl.NumberFormat('es-AR',{style:'currency',currency:'ARS',maximumFractionDigits:0}).format(Number(n||0));
  const number=n=>new Intl.NumberFormat('es-AR',{maximumFractionDigits:2}).format(Number(n||0));
  const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
  const metric=(label,value,sub='')=>`<div class="card metric"><small>${esc(label)}</small><b>${value}</b>${sub?`<small>${esc(sub)}</small>`:''}</div>`;
  const issueLabel=i=>({SIN_NOMBRE:'Sin nombre',SIN_CATEGORIA:'Sin categoría',STOCK_NEGATIVO:'Stock negativo',POSIBLE_DUPLICADO:'Posible duplicado',FUSIONADO:'Fusionado'}[i]||i);
  const statusPill=s=>({ready:'<span class="pill green">Listo</span>',needs_review:'<span class="pill yellow">Revisar</span>',imported:'<span class="pill blue">Importado</span>',skipped:'<span class="pill">Omitido</span>',error:'<span class="pill red">Error</span>'}[s]||`<span class="pill">${esc(s)}</span>`);

  async function start(){
    const {data:{session}}=await db.auth.getSession(); if(session){await enter(session.user)}
    db.auth.onAuthStateChange(async(_,session)=>{ if(session&&!window.currentUser) await enter(session.user); if(!session) leave(); });
  }
  async function enter(user){ window.currentUser=user; $('#loginView').classList.add('hidden'); $('#appView').classList.remove('hidden'); $('#userLabel').textContent=user.email||user.id; await render(); }
  function leave(){ window.currentUser=null; $('#appView').classList.add('hidden'); $('#loginView').classList.remove('hidden'); }

  $('#loginForm').addEventListener('submit',async e=>{e.preventDefault();$('#loginError').textContent='';const {error}=await db.auth.signInWithPassword({email:$('#email').value,password:$('#password').value});if(error)$('#loginError').textContent=error.message});
  $('#logoutBtn').addEventListener('click',()=>db.auth.signOut());
  $('#nav').addEventListener('click',e=>{const b=e.target.closest('button[data-view]');if(!b)return;currentView=b.dataset.view;document.querySelectorAll('#nav button').forEach(x=>x.classList.toggle('active',x===b));render();});
  $('#globalSearch').addEventListener('input',e=>{if(currentView==='products') renderProducts(e.target.value)});

  async function render(){
    const titles={dashboard:'Inicio',products:'Productos / Stock',imports:'Importar Kyte',orders:'Pedidos',finance:'Finanzas'}; $('#viewTitle').textContent=titles[currentView]||'IMPORTB2B';
    content.innerHTML='<div class="empty">Cargando…</div>';
    try{
      if(currentView==='dashboard') await renderDashboard();
      else if(currentView==='products') await renderProducts($('#globalSearch').value);
      else if(currentView==='imports') await renderImports();
      else if(currentView==='orders') await renderOrders();
      else if(currentView==='finance') await renderFinance();
    }catch(e){console.error(e);content.innerHTML=`<div class="notice danger">Error: ${esc(e.message)}</div>`}
  }

  async function renderDashboard(){
    const d=await DB.dashboard();
    const batch=d.importBatch;
    const v=d.valuation||{};
    content.innerHTML=`<div class="grid">${metric('Productos',number(d.products),'Base central')}${metric('Stock disponible',number(d.stock),'Unidades')}${metric('En tránsito',number(d.transit),'Pendiente de recepción')}${metric('Pedidos registrados',number(d.orders),'App actual')}${metric('A cobrar',money(d.receivable),'Control financiero')}${metric('Ingresos del mes',money(d.income))}${metric('Egresos del mes',money(d.expense))}${metric('Resultado simple',money(d.income-d.expense))}</div>
    <details class="card stock-valuation" open style="margin-top:14px">
      <summary><div><small>Valorización de stock disponible</small><b>${money(v.stock_sale_value_ars)}</b></div><span class="muted">Ver detalle ▾</span></summary>
      <div class="valuation-grid">
        <div><small>Costo del stock</small><strong>${money(v.stock_cost_ars)}</strong></div>
        <div><small>Valor de venta estimado</small><strong>${money(v.stock_sale_value_ars)}</strong></div>
        <div class="profit-value"><small>Ganancia esperada</small><strong>${money(v.expected_profit_ars)}</strong></div>
        <div><small>Unidades disponibles</small><strong>${number(v.available_units)}</strong></div>
      </div>
      <p class="muted small-text">Ganancia esperada = valor de venta actual menos costo actual de las unidades disponibles. No incluye gastos operativos ni comisiones futuras.</p>
    </details>
    <div class="two-col" style="margin-top:14px"><div class="card"><div class="section-title"><h3>Integraciones</h3></div><div class="list"><div class="row"><span>Pedidos / Vía Cargo</span><span class="pill green">Fase 3 activa</span></div><div class="row"><span>Control Financiero</span><span class="pill green">Conectado</span></div><div class="row"><span>Productos / Stock</span><span class="pill blue">Fase 2.1</span></div><div class="row"><span>Importador Kyte</span><span class="pill purple">Revisión + consolidación</span></div><div class="row"><span>Club</span><span class="pill yellow">Supabase externo</span></div></div></div>
    <div class="card"><h3 style="margin-top:0">Migración Kyte</h3>${batch?`<p><b>${number(batch.product_ready||0)}</b> listos · <b>${number(batch.product_review||0)}</b> requieren revisión · <b>${number(batch.product_imported||0)}</b> importados.</p><button id="goImports" class="btn primary">Abrir revisión</button>`:'<p class="muted">Todavía no hay un lote de importación.</p>'}<div class="notice good-notice" style="margin-top:12px">Los Vapers ahora se agrupan por modelo y cada sabor queda como variante independiente.</div></div></div>`;
    $('#goImports')?.addEventListener('click',()=>{currentView='imports';document.querySelectorAll('#nav button').forEach(x=>x.classList.toggle('active',x.dataset.view==='imports'));render();});
  }

  async function renderProducts(q=''){
    const [cats,products]=await Promise.all([DB.categories(),DB.products(q,$('#categoryFilter')?.value||'',$('#stockFilter')?.value||'all')]);
    const currentCat=$('#categoryFilter')?.value||'';
    const currentStock=$('#stockFilter')?.value||'all';
    const catSel=`<select id="categoryFilter"><option value="">Todas las categorías</option>${cats.map(c=>`<option ${c===currentCat?'selected':''}>${esc(c)}</option>`).join('')}</select>`;
    content.innerHTML=`<div class="toolbar"><input id="productSearch" value="${esc(q)}" placeholder="Nombre, SKU, categoría…">${catSel}<select id="stockFilter"><option value="all" ${currentStock==='all'?'selected':''}>Todo stock</option><option value="available" ${currentStock==='available'?'selected':''}>Con stock</option><option value="low" ${currentStock==='low'?'selected':''}>Stock bajo</option><option value="out" ${currentStock==='out'?'selected':''}>Sin stock</option><option value="transit" ${currentStock==='transit'?'selected':''}>En tránsito</option></select></div>
    <div class="table-wrap"><table class="table"><thead><tr><th>Producto</th><th>Categoría</th><th>Variantes</th><th>Disponible</th><th>Reservado</th><th>En tránsito</th><th>Precio</th><th></th></tr></thead><tbody>${products.map(p=>{const av=p.variants.reduce((a,v)=>a+Number(v.stock.available||0),0),res=p.variants.reduce((a,v)=>a+Number(v.stock.reserved||0),0),tr=p.variants.reduce((a,v)=>a+Number(v.stock.in_transit||0),0);const prices=p.variants.map(v=>Number(v.price_ars||0)).filter(Boolean);return `<tr><td><b>${esc(p.name)}</b><br><small class="muted">${esc(p.sku||'Sin SKU')}</small></td><td>${esc(p.category||'—')}</td><td>${p.variants.length||0}</td><td><span class="pill ${av>0?'green':'red'}">${number(av)}</span></td><td>${number(res)}</td><td>${tr?`<span class="pill blue">${number(tr)}</span>`:'0'}</td><td>${prices.length?money(Math.min(...prices)):'—'}</td><td><button class="btn tiny ghost edit-product" data-id="${p.id}">Editar</button></td></tr>`}).join('')||`<tr><td colspan="8" class="empty">Sin productos todavía. Consolidá el lote de Kyte desde Importar Kyte.</td></tr>`}</tbody></table></div>`;
    $('#productSearch').addEventListener('input',e=>{const v=e.target.value;$('#globalSearch').value=v;clearTimeout(importSearchTimer);importSearchTimer=setTimeout(async()=>{await renderProducts(v);const i=$('#productSearch');if(i){i.focus();i.setSelectionRange(v.length,v.length)}},120)});
    $('#categoryFilter').addEventListener('change',()=>renderProducts($('#productSearch').value));
    $('#stockFilter').addEventListener('change',()=>renderProducts($('#productSearch').value));
    document.querySelectorAll('.edit-product').forEach(b=>b.addEventListener('click',()=>openProductEditor(b.dataset.id)));
  }

  async function openProductEditor(productId){
    const [p,cats]=await Promise.all([DB.productDetail(productId),DB.categories()]);
    const isVape=String(p.category||'').toLowerCase()==='vapers';
    const variantTitle=isVape?'Sabores':'Variantes';
    const variantColumn=isVape?'Sabor':'Variante';
    const rows=p.variants.map(v=>`<tr data-variant="${v.id}"><td><input class="v-name" value="${esc(v.variant_name)}"></td><td><input class="v-sku" value="${esc(v.sku||'')}"></td><td><input class="v-cost" type="number" step="0.01" value="${Number(v.cost_ars||0)}"></td><td><input class="v-price" type="number" step="0.01" value="${Number(v.price_ars||0)}"></td><td><input class="v-min" type="number" step="1" value="${Number(v.stock_min||0)}"></td><td><b>${number(v.stock.on_hand)}</b><br><small class="muted">disp. ${number(v.stock.available)}</small></td><td><button class="btn tiny ghost adjust-stock" data-vid="${v.id}" data-current="${Number(v.stock.on_hand||0)}">Ajustar</button></td></tr>`).join('');
    const categoryOptions=cats.map(c=>`<option value="${esc(c)}" ${c===p.category?'selected':''}>${esc(c)}</option>`).join('');
    openModal(`<div class="section-title"><div><h3>Editar producto</h3><small class="muted">${esc(p.source==='kyte'?'Migrado desde Kyte':'Producto')}</small></div><button class="modal-close">×</button></div>
      <div class="form-grid"><label>Nombre<input id="epName" value="${esc(p.name)}"></label><label>Categoría<select id="epCategory">${categoryOptions}</select></label><label>SKU general<input id="epSku" value="${esc(p.sku||'')}"></label><label class="check"><input id="epCatalog" type="checkbox" ${p.catalog_visible?'checked':''}> Visible en catálogo</label></div>
      <div class="section-title" style="margin-top:12px"><div><h3>${variantTitle}</h3>${isVape?'<small class="muted">Cada sabor comparte el mismo producto/modelo.</small>':''}</div><button id="addVariant" class="btn ghost">+ ${isVape?'Sabor':'Variante'}</button></div>
      <div class="table-wrap"><table class="table compact"><thead><tr><th>${variantColumn}</th><th>SKU</th><th>Costo</th><th>Precio</th><th>Mín.</th><th>Stock físico</th><th></th></tr></thead><tbody>${rows||'<tr><td colspan="7" class="empty">Sin variantes</td></tr>'}</tbody></table></div>
      <div class="modal-actions"><button class="btn ghost modal-close">Cancelar</button><button id="saveProduct" class="btn primary">Guardar cambios</button></div>`);

    $('#saveProduct').addEventListener('click',async()=>{
      const btn=$('#saveProduct'); btn.disabled=true;
      try{
        const category=$('#epCategory').value;
        await DB.saveProduct(productId,{name:$('#epName').value.trim(),category,sku:$('#epSku').value.trim()||null,catalog_visible:$('#epCatalog').checked});
        for(const tr of document.querySelectorAll('[data-variant]')){
          const variantName=tr.querySelector('.v-name').value.trim()||'Única';
          const attrs=category.toLowerCase()==='vapers'?{sabor:variantName}:undefined;
          const payload={variant_name:variantName,sku:tr.querySelector('.v-sku').value.trim()||null,cost_ars:Number(tr.querySelector('.v-cost').value||0),price_ars:Number(tr.querySelector('.v-price').value||0),stock_min:Number(tr.querySelector('.v-min').value||0)};
          if(attrs) payload.attributes=attrs;
          await DB.saveVariant(tr.dataset.variant,payload);
        }
        closeModal(); await renderProducts($('#globalSearch').value);
      }catch(e){alert(e.message)}finally{btn.disabled=false}
    });

    document.querySelectorAll('.adjust-stock').forEach(b=>b.addEventListener('click',async()=>{
      const current=Number(b.dataset.current||0);
      const value=prompt(`Stock físico actual: ${current}\nIngresá la NUEVA cantidad física:`,String(current));
      if(value===null) return;
      const next=Number(value); if(!Number.isFinite(next)||next<0) return alert('Cantidad inválida');
      const note=prompt('Motivo del ajuste:','Conteo físico / corrección manual')||'Ajuste manual de stock';
      try{await DB.adjustStock(productId,b.dataset.vid,current,next,note);closeModal();await openProductEditor(productId);}catch(e){alert(e.message)}
    }));

    $('#addVariant').addEventListener('click',async()=>{
      const category=$('#epCategory').value;
      const vape=category.toLowerCase()==='vapers';
      const name=prompt(vape?'Nombre del sabor (ej: Pink Lemonade):':'Nombre de variante (ej: XL, Black):',''); if(!name) return;
      const price=Number(prompt('Precio de venta ARS:','0')||0);
      const cost=Number(prompt('Costo ARS:','0')||0);
      const initial=Number(prompt('Stock inicial de esta variante:','0')||0);
      if([price,cost,initial].some(x=>!Number.isFinite(x))||initial<0) return alert('Valores inválidos');
      const payload={variant_name:name.trim(),cost_ars:cost,price_ars:price,stock_min:0,active:true};
      if(vape) payload.attributes={sabor:name.trim()};
      try{await DB.createVariant(productId,payload,initial,vape?'Alta manual de nuevo sabor':'Alta manual de nueva variante');closeModal();await openProductEditor(productId);}catch(e){alert(e.message)}
    });
  }

  async function renderImports(){
    const batches=await DB.importBatches();
    if(!selectedBatchId && batches.length) selectedBatchId=batches[0].batch_id;
    if(selectedBatchId && !batches.some(x=>x.batch_id===selectedBatchId)) selectedBatchId=batches[0]?.batch_id||null;
    const batch=batches.find(x=>x.batch_id===selectedBatchId)||null;
    let rows=batch?await DB.importRows(batch.batch_id,'product'):[];
    const counts={all:rows.length,ready:rows.filter(x=>x.status==='ready').length,needs_review:rows.filter(x=>x.status==='needs_review').length,imported:rows.filter(x=>x.status==='imported').length,skipped:rows.filter(x=>x.status==='skipped').length};
    if(importStatusFilter==='needs_review' && !counts.needs_review && counts.ready) importStatusFilter='ready';
    const query=importSearch.trim().toLowerCase();
    const filtered=rows.filter(r=>{
      if(importStatusFilter!=='all' && r.status!==importStatusFilter) return false;
      if(!query) return true;
      const n=r.normalized_data||{};
      return [n.name,n.base_name,n.category,n.size,n.flavor,r.row_number,(r.issues||[]).join(' ')].join(' ').toLowerCase().includes(query);
    });

    content.innerHTML=`<div class="card"><div class="section-title"><div><h3>Centro de importación Kyte</h3><p class="muted">Los archivos se analizan primero. Nada modifica el stock hasta tocar Consolidar.</p></div></div><div class="import-grid"><div class="upload-card"><b>Productos</b><input id="productsFile" type="file" accept=".csv,text/csv"></div><div class="upload-card"><b>Clientes</b><input id="customersFile" type="file" accept=".csv,text/csv"></div><div class="upload-card"><b>Ventas</b><input id="salesFile" type="file" accept=".csv,text/csv"></div></div><div class="section-title" style="margin-top:14px"><div class="progress grow"><span id="importProgress"></span></div><button id="stageBtn" class="btn ghost">Analizar nuevo lote</button></div><div id="importResult" class="muted small-text"></div></div>
    ${batch?`<div class="card" style="margin-top:14px"><div class="section-title"><div><h3>Revisión del lote</h3><small class="muted">${esc(batch.products_filename||'Kyte')} · ${new Date(batch.created_at).toLocaleString('es-AR')}</small></div><select id="batchSelect">${batches.map(x=>`<option value="${x.batch_id}" ${x.batch_id===batch.batch_id?'selected':''}>${new Date(x.created_at).toLocaleString('es-AR')} · ${x.product_rows||0} productos</option>`).join('')}</select></div>
      <div class="grid mini-grid">${metric('Filas',number(counts.all))}${metric('Listas',number(counts.ready))}${metric('Revisar',number(counts.needs_review))}${metric('Importadas',number(counts.imported))}</div>
      <div class="toolbar" style="margin-top:14px"><input id="importSearch" value="${esc(importSearch)}" placeholder="Buscar producto, categoría, talle…"><select id="importStatus"><option value="needs_review" ${importStatusFilter==='needs_review'?'selected':''}>Requieren revisión</option><option value="ready" ${importStatusFilter==='ready'?'selected':''}>Listos</option><option value="imported" ${importStatusFilter==='imported'?'selected':''}>Importados</option><option value="skipped" ${importStatusFilter==='skipped'?'selected':''}>Omitidos</option><option value="all" ${importStatusFilter==='all'?'selected':''}>Todos</option></select><button id="refreshIssues" class="btn ghost">Reanalizar</button><button id="commitProducts" class="btn primary" ${counts.ready?'':'disabled'}>Consolidar ${counts.ready} listos</button></div>
      <div class="notice ${counts.needs_review?'':'good-notice'}" style="margin-bottom:14px">${counts.needs_review?`${counts.needs_review} filas necesitan decisión antes de importarse. Podés consolidar las filas listas ahora; las demás quedan intactas.`:'No quedan conflictos en las filas pendientes.'}</div>
      <div class="table-wrap"><table class="table"><thead><tr><th>#</th><th>Producto base</th><th>Categoría</th><th>Variante</th><th>Stock</th><th>Costo</th><th>Precio</th><th>Estado</th><th>Problemas</th><th></th></tr></thead><tbody>${filtered.map(r=>{const n=r.normalized_data||{};return `<tr><td>${r.row_number}</td><td><b>${esc(n.base_name||n.name||'—')}</b><br><small class="muted">${esc(n.name||'')}</small></td><td>${esc(n.category||'—')}</td><td>${esc(n.flavor||n.size||'Única')}</td><td><span class="pill ${Number(n.stock)>0?'green':Number(n.stock)<0?'red':''}">${number(n.stock)}</span></td><td>${money(n.cost_ars)}</td><td>${money(n.price_ars)}</td><td>${statusPill(r.status)}</td><td>${(r.issues||[]).map(i=>`<span class="issue-tag">${esc(issueLabel(i))}</span>`).join(' ')||'—'}</td><td class="actions">${r.status==='imported'?'<span class="muted">✓</span>':r.status==='skipped'?`<button class="btn tiny ghost restore-row" data-id="${r.id}">Restaurar</button>`:`<button class="btn tiny ghost edit-import-row" data-id="${r.id}">Editar</button>${(r.issues||[]).includes('POSIBLE_DUPLICADO')?` <button class="btn tiny ghost merge-row" data-id="${r.id}">Fusionar</button>`:''} <button class="btn tiny danger-btn skip-row" data-id="${r.id}">Omitir</button>`}</td></tr>`}).join('')||'<tr><td colspan="10" class="empty">No hay filas para este filtro.</td></tr>'}</tbody></table></div></div>`:'<div class="card" style="margin-top:14px"><div class="empty">Todavía no hay un lote. Cargá los CSV exportados desde Kyte.</div></div>'}`;

    $('#stageBtn').addEventListener('click',async()=>{
      const files={products:$('#productsFile').files[0],customers:$('#customersFile').files[0],sales:$('#salesFile').files[0]};
      const btn=$('#stageBtn'); btn.disabled=true;
      try{
        const s=await KyteImporter.uploadAll(files,p=>$('#importProgress').style.width=(p*100)+'%');
        selectedBatchId=s.batch_id; importStatusFilter='needs_review'; importSearch='';
        $('#importResult').innerHTML=`Lote analizado correctamente. ${s.product?`${s.product.rows} productos · ${s.product.issues} para revisar.`:''}`;
        setTimeout(()=>renderImports(),450);
      }catch(e){$('#importResult').innerHTML=`<span class="error">${esc(e.message)}</span>`}finally{btn.disabled=false}
    });

    if(!batch) return;
    $('#batchSelect').addEventListener('change',e=>{selectedBatchId=e.target.value;importSearch='';renderImports();});
    $('#importSearch').addEventListener('input',e=>{const v=e.target.value;importSearch=v;clearTimeout(importSearchTimer);importSearchTimer=setTimeout(async()=>{await renderImports();const i=$('#importSearch');if(i){i.focus();i.setSelectionRange(v.length,v.length)}},120)});
    $('#importStatus').addEventListener('change',e=>{importStatusFilter=e.target.value;renderImports();});
    $('#refreshIssues').addEventListener('click',async()=>{try{await DB.refreshImportProductIssues(batch.batch_id);await renderImports();}catch(e){alert(e.message)}});
    $('#commitProducts').addEventListener('click',async()=>{
      if(!counts.ready) return;
      if(!confirm(`Se consolidarán ${counts.ready} filas LISTAS.\n\nLas variantes con stock 0 se conservan sin sumar unidades. Las filas en revisión quedan pendientes. ¿Continuar?`)) return;
      const btn=$('#commitProducts'); btn.disabled=true; btn.textContent='Consolidando…';
      try{const r=await DB.commitKyteProducts(batch.batch_id);alert(`Listo.\nFilas importadas: ${r.rows_imported}\nProductos creados: ${r.products_created}\nVariantes creadas: ${r.variants_created}\nMovimientos de stock: ${r.stock_movements}`);await renderImports();}catch(e){alert(e.message);btn.disabled=false}
    });

    document.querySelectorAll('.edit-import-row').forEach(b=>b.addEventListener('click',()=>openImportRowEditor(rows.find(x=>String(x.id)===String(b.dataset.id)),batch.batch_id)));
    document.querySelectorAll('.skip-row').forEach(b=>b.addEventListener('click',async()=>{if(!confirm('¿Omitir esta fila de la migración? No se elimina el registro original.'))return;try{await DB.skipImportRow(b.dataset.id);await DB.refreshImportProductIssues(batch.batch_id);await renderImports();}catch(e){alert(e.message)}}));
    document.querySelectorAll('.restore-row').forEach(b=>b.addEventListener('click',async()=>{try{await DB.restoreImportRow(b.dataset.id,batch.batch_id);await renderImports();}catch(e){alert(e.message)}}));
    document.querySelectorAll('.merge-row').forEach(b=>b.addEventListener('click',async()=>{
      const row=rows.find(x=>String(x.id)===String(b.dataset.id)); const n=row.normalized_data||{};
      const candidates=rows.filter(x=>x.id!==row.id && !['skipped','imported'].includes(x.status) && canonicalImport(x)===canonicalImport(row));
      if(!candidates.length) return alert('No encuentro otra fila equivalente para fusionar. Reanalizá el lote.');
      const choices=candidates.map(x=>`fila ${x.row_number} · stock ${x.normalized_data?.stock} · precio ${money(x.normalized_data?.price_ars)}`).join('\n');
      const chosen=prompt(`Se sumará el stock de otra fila a ESTA fila y se conservarán el costo/precio de ESTA fila.\n\nDuplicados encontrados:\n${choices}\n\nEscribí el número de fila que querés absorber:`,String(candidates[0].row_number));
      if(chosen===null) return;
      const source=candidates.find(x=>String(x.row_number)===String(chosen.trim())); if(!source) return alert('Fila no válida');
      if(!confirm(`Conservar fila ${row.row_number} (${money(n.price_ars)}) y absorber fila ${source.row_number} (${money(source.normalized_data?.price_ars)})?`)) return;
      try{await DB.mergeImportProductRows(row.id,source.id);await renderImports();}catch(e){alert(e.message)}
    }));
  }

  function canonicalImport(r){
    const n=r.normalized_data||{}; return [n.category||'',n.base_name||n.name||'',n.flavor||n.size||'Única'].map(x=>String(x).trim().toLowerCase()).join('|');
  }

  async function openImportRowEditor(row,batchId){
    if(!row) return;
    const [cats]=await Promise.all([DB.categories()]);
    const n=row.normalized_data||{};
    const currentCategory=n.category==='SIN CLASIFICAR'?'':(n.category||'');
    const currentVariant=n.flavor||n.size||'';
    const categoryOptions=`<option value="">Seleccionar categoría</option>${cats.map(c=>`<option value="${esc(c)}" ${c===currentCategory?'selected':''}>${esc(c)}</option>`).join('')}`;
    openModal(`<div class="section-title"><div><h3>Revisar fila #${row.row_number}</h3><small class="muted">Los cambios afectan solamente la migración hasta que consolides.</small></div><button class="modal-close">×</button></div>
      <div class="form-grid"><label>Producto base<input id="irBase" value="${esc(n.base_name||n.name||'')}"></label><label>Categoría<select id="irCategory">${categoryOptions}</select></label><label>Variante / talle / sabor<input id="irSize" value="${esc(currentVariant)}"></label><label>Stock actual<input id="irStock" type="number" step="1" value="${Number(n.stock||0)}"></label><label>Stock mínimo<input id="irMin" type="number" step="1" value="${Number(n.stock_min||0)}"></label><label>Costo ARS<input id="irCost" type="number" step="0.01" value="${Number(n.cost_ars||0)}"></label><label>Precio venta ARS<input id="irPrice" type="number" step="0.01" value="${Number(n.price_ars||0)}"></label></div>
      <div class="notice" style="margin-top:10px">Stock 0 es válido y conserva la variante. En Vapers, el tercer campo representa el sabor.</div>
      <div class="modal-actions"><button class="btn ghost modal-close">Cancelar</button><button id="saveImportRow" class="btn primary">Guardar revisión</button></div>`);
    $('#saveImportRow').addEventListener('click',async()=>{
      const base=$('#irBase').value.trim(),category=$('#irCategory').value.trim(),variant=$('#irSize').value.trim();
      const stock=Number($('#irStock').value||0),stockMin=Number($('#irMin').value||0),cost=Number($('#irCost').value||0),price=Number($('#irPrice').value||0);
      if(!base) return alert('El producto necesita nombre');
      if(!category) return alert('Elegí una categoría');
      if([stock,stockMin,cost,price].some(x=>!Number.isFinite(x))) return alert('Hay números inválidos');
      const isVape=category.toLowerCase()==='vapers';
      const normalizedVariant=isVape?variant:variant.toUpperCase();
      const updated={...n,base_name:base,name:normalizedVariant?`${base} - ${normalizedVariant}`:base,category,size:isVape?null:(normalizedVariant||null),flavor:isVape?(normalizedVariant||null):null,stock,stock_min:stockMin,cost_ars:cost,price_ars:price,issues:[]};
      try{await DB.saveImportProduct(row.id,batchId,updated);closeModal();await renderImports();}catch(e){alert(e.message)}
    });
  }

  function openModal(inner){
    closeModal(); const el=document.createElement('div'); el.id='modalLayer'; el.className='modal-layer'; el.innerHTML=`<div class="modal-card">${inner}</div>`; document.body.appendChild(el);
    el.addEventListener('click',e=>{if(e.target===el||e.target.closest('.modal-close')) closeModal();});
  }
  function closeModal(){document.querySelector('#modalLayer')?.remove();}

  const orderItemStatusLabel=s=>({
    historical:'Histórico',unlinked:'Sin vincular',partial_allocation:'Distribución parcial',
    allocated:'Distribuido',partial_received:'Recepción parcial',received:'Recibido'
  }[s]||s||'Sin vincular');

  function candidateScore(name,target){
    const clean=v=>String(v||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim();
    const a=clean(name),b=clean(target);
    if(!a||!b) return 0;
    if(a===b) return 100;
    let score=0;
    if(a.includes(b)||b.includes(a)) score+=50;
    const aw=new Set(a.split(/\s+/)),bw=new Set(b.split(/\s+/));
    for(const w of bw) if(aw.has(w)) score+=10;
    return score;
  }

  async function renderOrders(){
    const rows=await DB.recentOrders();
    content.innerHTML=`<div class="notice good-notice" style="margin-bottom:14px"><b>Fase 3 activa:</b> los pedidos nuevos pueden vincularse a productos/variantes y, al recibir mercadería, sumar stock automáticamente. Los pedidos anteriores a la migración quedaron protegidos como <b>Históricos</b> para evitar duplicar el stock que ya vino desde Kyte.</div>
      <div class="order-stack">${rows.map(o=>{
        const ship=o.shipment;
        const shipText=ship?`${esc(ship.carrier_name||'Envío')} · ${esc(ship.normalized_status||ship.latest_checkpoint_description||'Sin estado')}`:'Sin tracking';
        const items=(o.items||[]).map(i=>{
          const allocations=i.allocations||[];
          const allocHtml=allocations.length?`<div class="allocation-list">${allocations.map(a=>{
            const remaining=Math.max(0,Number(a.ordered_quantity||0)-Number(a.received_quantity||0));
            return `<div class="allocation-row"><div><b>${esc(a.product?.name||'Producto')}</b> · ${esc(a.variant?.variant_name||'Variante')}<br><small class="muted">Asignado ${number(a.ordered_quantity)} · recibido ${number(a.received_quantity)}</small></div>${remaining>0&&i.stock_link_status!=='historical'?`<button class="btn tiny good receive-allocation" data-aid="${a.id}" data-remaining="${remaining}">Recibir ${number(remaining)}</button>`:''}</div>`;
          }).join('')}</div>`:'';
          const historical=i.stock_link_status==='historical';
          const statusClass=i.stock_link_status==='received'?'green':historical?'':'yellow';
          return `<div class="order-item" data-item="${i.id}">
            <div class="order-item-main"><div><b>${esc(i.product)}</b>${i.detail&&i.detail!=='Sin detalle'?` <small class="muted">· ${esc(i.detail)}</small>`:''}<br><small class="muted">${esc(i.category||'')} · pedido ${number(i.quantity)} · recibido ${number(i.received_quantity||0)} · costo ${money(i.cost_ars)}</small></div><span class="pill ${statusClass}">${esc(orderItemStatusLabel(i.stock_link_status))}</span></div>
            ${allocHtml}
            <div class="order-item-actions">${i.excluded_from_stock?'<span class="muted">Excluido del stock</span>':historical?`<button class="btn tiny ghost activate-item" data-item="${i.id}">Activar para stock</button><small class="muted">Solo si esta mercadería todavía NO está incluida en el stock migrado.</small>`:`<button class="btn tiny ghost allocate-item" data-order="${o.id}" data-item="${i.id}">${allocations.length?'Editar distribución':'Vincular / distribuir'}</button>`}</div>
          </div>`;
        }).join('');
        return `<section class="card order-card"><div class="section-title"><div><h3>Pedido #${esc(o.order_number??o.id)}</h3><small class="muted">${esc(o.order_date||'')} · ${number(o.total_units)} unidades · USD ${number(o.investment_usd)}</small></div><span class="pill ${ship?.is_received?'green':'blue'}">${shipText}</span></div>${items||'<div class="empty">Sin artículos</div>'}</section>`;
      }).join('')||'<div class="card empty">No hay pedidos.</div>'}</div>`;

    document.querySelectorAll('.activate-item').forEach(b=>b.addEventListener('click',async()=>{
      if(!confirm('Este pedido histórico probablemente ya está incluido en el stock migrado desde Kyte. Activarlo permitirá recibirlo nuevamente y SUMAR stock. ¿Confirmás que esta mercadería todavía no fue contabilizada?')) return;
      try{await DB.setOrderItemStockMode(b.dataset.item,true);await renderOrders();}catch(e){alert(e.message)}
    }));
    document.querySelectorAll('.allocate-item').forEach(b=>b.addEventListener('click',async()=>{
      const order=rows.find(x=>String(x.id)===String(b.dataset.order));
      const item=order?.items?.find(x=>String(x.id)===String(b.dataset.item));
      if(item) await openOrderAllocationEditor(order,item);
    }));
    document.querySelectorAll('.receive-allocation').forEach(b=>b.addEventListener('click',async()=>{
      const max=Number(b.dataset.remaining||0);
      const raw=prompt(`Quedan ${max} unidades por recibir.\n¿Cuántas llegaron ahora?`,String(max));
      if(raw===null) return;
      const qty=Number(raw);
      if(!Number.isFinite(qty)||qty<=0||qty>max) return alert('Cantidad inválida');
      const note=prompt('Observación de recepción:','Recepción de mercadería')||'Recepción de mercadería';
      try{await DB.receiveOrderAllocation(b.dataset.aid,qty,note);await renderOrders();}catch(e){alert(e.message)}
    }));
  }

  async function openOrderAllocationEditor(order,item){
    const products=await DB.orderProductOptions();
    if(!products.length) return alert('No hay productos en la base central.');
    const existing=item.allocations||[];
    const lockedProduct=existing.find(x=>Number(x.received_quantity||0)>0)?.product_id||null;
    const orderedCategory=String(item.category||'').toLowerCase();
    const ranked=[...products].sort((a,b)=>{
      const ca=String(a.category||'').toLowerCase()===orderedCategory?25:0;
      const cb=String(b.category||'').toLowerCase()===orderedCategory?25:0;
      return (candidateScore(b.name,item.product)+cb)-(candidateScore(a.name,item.product)+ca);
    });
    const initialProduct=lockedProduct||item.product_id||ranked[0]?.id;
    openModal(`<div class="section-title"><div><h3>Vincular pedido a stock</h3><small class="muted">Pedido #${esc(order.order_number??order.id)} · ${esc(item.product)} · ${number(item.quantity)} unidades</small></div><button class="modal-close">×</button></div>
      <div class="notice" style="margin-bottom:12px">Elegí el producto correcto y distribuí la cantidad del pedido entre sus variantes. En Vapers, cada variante es un sabor.</div>
      <div class="form-grid"><label>Buscar producto<input id="oaSearch" value="${esc(item.product||'')}" placeholder="Buscar por modelo, nombre o categoría"></label><label>Producto<select id="oaProduct"></select></label></div>
      <div id="oaVariants" style="margin-top:14px"></div>
      <div class="modal-actions"><button class="btn ghost modal-close">Cancelar</button><button id="saveAllocations" class="btn primary">Guardar distribución</button></div>`);

    const search=$('#oaSearch'),select=$('#oaProduct'),variantBox=$('#oaVariants');
    function refillProducts(){
      const q=search.value.trim().toLowerCase();
      const filtered=ranked.filter(p=>!q||[p.name,p.category,p.sku].join(' ').toLowerCase().includes(q)).slice(0,100);
      const list=filtered.length?filtered:ranked.slice(0,100);
      select.innerHTML=list.map(p=>`<option value="${p.id}" ${p.id===initialProduct?'selected':''}>${esc(p.name)} · ${esc(p.category||'')}</option>`).join('');
      if(!select.value&&list[0]) select.value=list[0].id;
      renderVariantAllocation();
    }
    function renderVariantAllocation(){
      const product=products.find(p=>p.id===select.value);
      if(!product){variantBox.innerHTML='<div class="empty">Elegí un producto.</div>';return}
      const rows=(product.variants||[]).map((v,idx)=>{
        const a=existing.find(x=>x.variant_id===v.id);
        let initial=a?Number(a.ordered_quantity||0):0;
        if(!existing.length&&product.variants.length===1&&idx===0) initial=Number(item.quantity||0);
        return `<tr data-alloc-variant="${v.id}" data-existing="${a?.id||''}" data-received="${Number(a?.received_quantity||0)}"><td><b>${esc(v.variant_name)}</b><br><small class="muted">${esc(v.sku||'Sin SKU')}</small></td><td>${number(v.stock.available||0)}</td><td>${number(a?.received_quantity||0)}</td><td><input class="alloc-qty" type="number" min="${Number(a?.received_quantity||0)}" step="1" value="${initial}"></td></tr>`;
      }).join('');
      variantBox.innerHTML=`<div class="section-title"><div><h3>${String(product.category).toLowerCase()==='vapers'?'Sabores':'Variantes'}</h3><small class="muted">${esc(product.name)}</small></div><div><b id="allocTotal">0</b> / ${number(item.quantity)} asignadas</div></div><div class="table-wrap"><table class="table compact"><thead><tr><th>${String(product.category).toLowerCase()==='vapers'?'Sabor':'Variante'}</th><th>Stock actual</th><th>Ya recibido</th><th>Unidades del pedido</th></tr></thead><tbody>${rows||'<tr><td colspan="4" class="empty">Este producto no tiene variantes.</td></tr>'}</tbody></table></div>`;
      const inputs=[...variantBox.querySelectorAll('.alloc-qty')];
      const updateTotal=()=>{$('#allocTotal').textContent=number(inputs.reduce((a,x)=>a+Number(x.value||0),0));};
      inputs.forEach(i=>i.addEventListener('input',updateTotal)); updateTotal();
    }
    let searchTimer;
    search.addEventListener('input',()=>{clearTimeout(searchTimer);searchTimer=setTimeout(refillProducts,120)});
    select.addEventListener('change',renderVariantAllocation);
    refillProducts();

    $('#saveAllocations').addEventListener('click',async()=>{
      const product=products.find(p=>p.id===select.value);
      if(!product) return alert('Elegí un producto');
      if(lockedProduct&&lockedProduct!==product.id) return alert('Ya hay unidades recibidas para otro producto. No se puede cambiar el producto después de una recepción.');
      const rows=[...document.querySelectorAll('[data-alloc-variant]')];
      const total=rows.reduce((a,tr)=>a+Number(tr.querySelector('.alloc-qty').value||0),0);
      if(total>Number(item.quantity)) return alert(`La distribución suma ${total} y el pedido tiene ${item.quantity} unidades.`);
      const btn=$('#saveAllocations');btn.disabled=true;btn.textContent='Guardando…';
      try{
        const chosenVariantIds=new Set(rows.map(tr=>tr.dataset.allocVariant));
        for(const old of existing){
          if(old.product_id!==product.id || !chosenVariantIds.has(old.variant_id)){
            if(Number(old.received_quantity||0)>0) throw new Error('Hay una distribución recibida que no puede eliminarse.');
            await DB.deleteOrderAllocation(old.id);
          }
        }
        for(const tr of rows){
          const qty=Number(tr.querySelector('.alloc-qty').value||0);
          const received=Number(tr.dataset.received||0);
          const existingId=tr.dataset.existing;
          if(qty<received) throw new Error('No podés asignar menos unidades que las ya recibidas.');
          if(qty>0) await DB.saveOrderAllocation(item.id,tr.dataset.allocVariant,qty);
          else if(existingId&&received===0) await DB.deleteOrderAllocation(existingId);
        }
        closeModal();await renderOrders();
      }catch(e){alert(e.message);btn.disabled=false;btn.textContent='Guardar distribución'}
    });
  }

  async function renderFinance(){
    const rows=await DB.recentFinance();
    content.innerHTML=`<div class="notice" style="margin-bottom:14px">Lee los movimientos reales del Control Financiero. Las ventas nuevas usarán source_type/source_id para quedar enlazadas al movimiento correspondiente.</div><div class="table-wrap"><table class="table"><thead><tr><th>Fecha</th><th>Tipo</th><th>Monto</th><th>Método</th><th>Categoría</th><th>Detalle</th></tr></thead><tbody>${rows.map(x=>`<tr><td>${new Date(x.occurred_at).toLocaleString('es-AR')}</td><td><span class="pill ${x.kind==='income'?'green':'red'}">${esc(x.kind)}</span></td><td>${esc(x.currency)} ${number(x.amount)}</td><td>${esc(x.payment_method||'—')}</td><td>${esc(x.category||'—')}</td><td>${esc(x.description||'—')}</td></tr>`).join('')}</tbody></table></div>`;
  }

  start();
})();
