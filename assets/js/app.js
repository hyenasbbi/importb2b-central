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
    content.innerHTML=`<div class="grid">${metric('Productos',number(d.products),'Base central')}${metric('Stock disponible',number(d.stock),'Unidades')}${metric('En tránsito',number(d.transit),'Pendiente de recepción')}${metric('Pedidos registrados',number(d.orders),'App actual')}${metric('A cobrar',money(d.receivable),'Control financiero')}${metric('Ingresos del mes',money(d.income))}${metric('Egresos del mes',money(d.expense))}${metric('Resultado simple',money(d.income-d.expense))}</div>
    <div class="two-col" style="margin-top:14px"><div class="card"><div class="section-title"><h3>Integraciones</h3></div><div class="list"><div class="row"><span>Pedidos / Vía Cargo</span><span class="pill green">Conectado</span></div><div class="row"><span>Control Financiero</span><span class="pill green">Conectado</span></div><div class="row"><span>Productos / Stock</span><span class="pill blue">Fase 2</span></div><div class="row"><span>Importador Kyte</span><span class="pill purple">Revisión + consolidación</span></div><div class="row"><span>Club</span><span class="pill yellow">Supabase externo</span></div></div></div>
    <div class="card"><h3 style="margin-top:0">Migración Kyte</h3>${batch?`<p><b>${number(batch.product_ready||0)}</b> listos · <b>${number(batch.product_review||0)}</b> requieren revisión · <b>${number(batch.product_imported||0)}</b> importados.</p><button id="goImports" class="btn primary">Abrir revisión</button>`:'<p class="muted">Todavía no hay un lote de importación.</p>'}<div class="notice" style="margin-top:12px">Stock 0 conserva la variante y no suma unidades. Todo stock positivo entra como movimiento auditable.</div></div></div>`;
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
    const p=await DB.productDetail(productId);
    const rows=p.variants.map(v=>`<tr data-variant="${v.id}"><td><input class="v-name" value="${esc(v.variant_name)}"></td><td><input class="v-sku" value="${esc(v.sku||'')}"></td><td><input class="v-cost" type="number" step="0.01" value="${Number(v.cost_ars||0)}"></td><td><input class="v-price" type="number" step="0.01" value="${Number(v.price_ars||0)}"></td><td><input class="v-min" type="number" step="1" value="${Number(v.stock_min||0)}"></td><td><b>${number(v.stock.on_hand)}</b><br><small class="muted">disp. ${number(v.stock.available)}</small></td><td><button class="btn tiny ghost adjust-stock" data-vid="${v.id}" data-current="${Number(v.stock.on_hand||0)}">Ajustar</button></td></tr>`).join('');
    openModal(`<div class="section-title"><div><h3>Editar producto</h3><small class="muted">${esc(p.source==='kyte'?'Migrado desde Kyte':'Producto')}</small></div><button class="modal-close">×</button></div>
      <div class="form-grid"><label>Nombre<input id="epName" value="${esc(p.name)}"></label><label>Categoría<input id="epCategory" value="${esc(p.category||'')}"></label><label>SKU general<input id="epSku" value="${esc(p.sku||'')}"></label><label class="check"><input id="epCatalog" type="checkbox" ${p.catalog_visible?'checked':''}> Visible en catálogo</label></div>
      <div class="section-title" style="margin-top:12px"><h3>Variantes</h3><button id="addVariant" class="btn ghost">+ Variante</button></div>
      <div class="table-wrap"><table class="table compact"><thead><tr><th>Variante</th><th>SKU</th><th>Costo</th><th>Precio</th><th>Mín.</th><th>Stock físico</th><th></th></tr></thead><tbody>${rows||'<tr><td colspan="7" class="empty">Sin variantes</td></tr>'}</tbody></table></div>
      <div class="modal-actions"><button class="btn ghost modal-close">Cancelar</button><button id="saveProduct" class="btn primary">Guardar cambios</button></div>`);

    $('#saveProduct').addEventListener('click',async()=>{
      const btn=$('#saveProduct'); btn.disabled=true;
      try{
        await DB.saveProduct(productId,{name:$('#epName').value.trim(),category:$('#epCategory').value.trim()||null,sku:$('#epSku').value.trim()||null,catalog_visible:$('#epCatalog').checked});
        for(const tr of document.querySelectorAll('[data-variant]')){
          await DB.saveVariant(tr.dataset.variant,{variant_name:tr.querySelector('.v-name').value.trim()||'Única',sku:tr.querySelector('.v-sku').value.trim()||null,cost_ars:Number(tr.querySelector('.v-cost').value||0),price_ars:Number(tr.querySelector('.v-price').value||0),stock_min:Number(tr.querySelector('.v-min').value||0)});
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
      const name=prompt('Nombre de variante (ej: XL, Black, Pink Lemonade):',''); if(!name) return;
      const price=Number(prompt('Precio de venta ARS:','0')||0);
      const cost=Number(prompt('Costo ARS:','0')||0);
      const initial=Number(prompt('Stock inicial de esta variante:','0')||0);
      if([price,cost,initial].some(x=>!Number.isFinite(x))||initial<0) return alert('Valores inválidos');
      try{await DB.createVariant(productId,{variant_name:name.trim(),cost_ars:cost,price_ars:price,stock_min:0,active:true},initial,'Alta manual de nueva variante');closeModal();await openProductEditor(productId);}catch(e){alert(e.message)}
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
      return [n.name,n.base_name,n.category,n.size,r.row_number,(r.issues||[]).join(' ')].join(' ').toLowerCase().includes(query);
    });

    content.innerHTML=`<div class="card"><div class="section-title"><div><h3>Centro de importación Kyte</h3><p class="muted">Los archivos se analizan primero. Nada modifica el stock hasta tocar Consolidar.</p></div></div><div class="import-grid"><div class="upload-card"><b>Productos</b><input id="productsFile" type="file" accept=".csv,text/csv"></div><div class="upload-card"><b>Clientes</b><input id="customersFile" type="file" accept=".csv,text/csv"></div><div class="upload-card"><b>Ventas</b><input id="salesFile" type="file" accept=".csv,text/csv"></div></div><div class="section-title" style="margin-top:14px"><div class="progress grow"><span id="importProgress"></span></div><button id="stageBtn" class="btn ghost">Analizar nuevo lote</button></div><div id="importResult" class="muted small-text"></div></div>
    ${batch?`<div class="card" style="margin-top:14px"><div class="section-title"><div><h3>Revisión del lote</h3><small class="muted">${esc(batch.products_filename||'Kyte')} · ${new Date(batch.created_at).toLocaleString('es-AR')}</small></div><select id="batchSelect">${batches.map(x=>`<option value="${x.batch_id}" ${x.batch_id===batch.batch_id?'selected':''}>${new Date(x.created_at).toLocaleString('es-AR')} · ${x.product_rows||0} productos</option>`).join('')}</select></div>
      <div class="grid mini-grid">${metric('Filas',number(counts.all))}${metric('Listas',number(counts.ready))}${metric('Revisar',number(counts.needs_review))}${metric('Importadas',number(counts.imported))}</div>
      <div class="toolbar" style="margin-top:14px"><input id="importSearch" value="${esc(importSearch)}" placeholder="Buscar producto, categoría, talle…"><select id="importStatus"><option value="needs_review" ${importStatusFilter==='needs_review'?'selected':''}>Requieren revisión</option><option value="ready" ${importStatusFilter==='ready'?'selected':''}>Listos</option><option value="imported" ${importStatusFilter==='imported'?'selected':''}>Importados</option><option value="skipped" ${importStatusFilter==='skipped'?'selected':''}>Omitidos</option><option value="all" ${importStatusFilter==='all'?'selected':''}>Todos</option></select><button id="refreshIssues" class="btn ghost">Reanalizar</button><button id="commitProducts" class="btn primary" ${counts.ready?'':'disabled'}>Consolidar ${counts.ready} listos</button></div>
      <div class="notice ${counts.needs_review?'':'good-notice'}" style="margin-bottom:14px">${counts.needs_review?`${counts.needs_review} filas necesitan decisión antes de importarse. Podés consolidar las filas listas ahora; las demás quedan intactas.`:'No quedan conflictos en las filas pendientes.'}</div>
      <div class="table-wrap"><table class="table"><thead><tr><th>#</th><th>Producto base</th><th>Categoría</th><th>Variante</th><th>Stock</th><th>Costo</th><th>Precio</th><th>Estado</th><th>Problemas</th><th></th></tr></thead><tbody>${filtered.map(r=>{const n=r.normalized_data||{};return `<tr><td>${r.row_number}</td><td><b>${esc(n.base_name||n.name||'—')}</b><br><small class="muted">${esc(n.name||'')}</small></td><td>${esc(n.category||'—')}</td><td>${esc(n.size||'Única')}</td><td><span class="pill ${Number(n.stock)>0?'green':Number(n.stock)<0?'red':''}">${number(n.stock)}</span></td><td>${money(n.cost_ars)}</td><td>${money(n.price_ars)}</td><td>${statusPill(r.status)}</td><td>${(r.issues||[]).map(i=>`<span class="issue-tag">${esc(issueLabel(i))}</span>`).join(' ')||'—'}</td><td class="actions">${r.status==='imported'?'<span class="muted">✓</span>':r.status==='skipped'?`<button class="btn tiny ghost restore-row" data-id="${r.id}">Restaurar</button>`:`<button class="btn tiny ghost edit-import-row" data-id="${r.id}">Editar</button>${(r.issues||[]).includes('POSIBLE_DUPLICADO')?` <button class="btn tiny ghost merge-row" data-id="${r.id}">Fusionar</button>`:''} <button class="btn tiny danger-btn skip-row" data-id="${r.id}">Omitir</button>`}</td></tr>`}).join('')||'<tr><td colspan="10" class="empty">No hay filas para este filtro.</td></tr>'}</tbody></table></div></div>`:'<div class="card" style="margin-top:14px"><div class="empty">Todavía no hay un lote. Cargá los CSV exportados desde Kyte.</div></div>'}`;

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
    const n=r.normalized_data||{}; return [n.category||'',n.base_name||n.name||'',n.size||'Única'].map(x=>String(x).trim().toLowerCase()).join('|');
  }

  function openImportRowEditor(row,batchId){
    if(!row) return;
    const n=row.normalized_data||{};
    openModal(`<div class="section-title"><div><h3>Revisar fila #${row.row_number}</h3><small class="muted">Los cambios afectan solamente la migración hasta que consolides.</small></div><button class="modal-close">×</button></div>
      <div class="form-grid"><label>Producto base<input id="irBase" value="${esc(n.base_name||n.name||'')}"></label><label>Categoría<input id="irCategory" value="${esc(n.category==='SIN CLASIFICAR'?'':n.category||'')}"></label><label>Variante / talle<input id="irSize" value="${esc(n.size||'')}"></label><label>Stock actual<input id="irStock" type="number" step="1" value="${Number(n.stock||0)}"></label><label>Stock mínimo<input id="irMin" type="number" step="1" value="${Number(n.stock_min||0)}"></label><label>Costo ARS<input id="irCost" type="number" step="0.01" value="${Number(n.cost_ars||0)}"></label><label>Precio venta ARS<input id="irPrice" type="number" step="0.01" value="${Number(n.price_ars||0)}"></label></div>
      <div class="notice" style="margin-top:10px">Stock 0 es válido y conserva la variante. Stock negativo seguirá marcado para revisión.</div>
      <div class="modal-actions"><button class="btn ghost modal-close">Cancelar</button><button id="saveImportRow" class="btn primary">Guardar revisión</button></div>`);
    $('#saveImportRow').addEventListener('click',async()=>{
      const base=$('#irBase').value.trim(),category=$('#irCategory').value.trim(),size=$('#irSize').value.trim().toUpperCase();
      const stock=Number($('#irStock').value||0),stockMin=Number($('#irMin').value||0),cost=Number($('#irCost').value||0),price=Number($('#irPrice').value||0);
      if(!base) return alert('El producto necesita nombre');
      if([stock,stockMin,cost,price].some(x=>!Number.isFinite(x))) return alert('Hay números inválidos');
      const updated={...n,base_name:base,name:size?`${base} - ${size}`:base,category:category||'SIN CLASIFICAR',size:size||null,stock,stock_min:stockMin,cost_ars:cost,price_ars:price,issues:[]};
      try{await DB.saveImportProduct(row.id,batchId,updated);closeModal();await renderImports();}catch(e){alert(e.message)}
    });
  }

  function openModal(inner){
    closeModal(); const el=document.createElement('div'); el.id='modalLayer'; el.className='modal-layer'; el.innerHTML=`<div class="modal-card">${inner}</div>`; document.body.appendChild(el);
    el.addEventListener('click',e=>{if(e.target===el||e.target.closest('.modal-close')) closeModal();});
  }
  function closeModal(){document.querySelector('#modalLayer')?.remove();}

  async function renderOrders(){
    const rows=await DB.recentOrders();
    content.innerHTML=`<div class="notice" style="margin-bottom:14px">Lee directamente la tabla de Pedidos existente. Los artículos ya están preparados para enlazar producto, variante y cantidad recibida.</div><div class="table-wrap"><table class="table"><thead><tr><th>#</th><th>Fecha</th><th>Unidades</th><th>Inversión USD</th><th>Nota</th></tr></thead><tbody>${rows.map(x=>`<tr><td>${x.order_number??x.id}</td><td>${esc(x.order_date||'')}</td><td>${number(x.total_units)}</td><td>${number(x.investment_usd)}</td><td>${esc(x.note||'—')}</td></tr>`).join('')}</tbody></table></div>`;
  }

  async function renderFinance(){
    const rows=await DB.recentFinance();
    content.innerHTML=`<div class="notice" style="margin-bottom:14px">Lee los movimientos reales del Control Financiero. Las ventas nuevas usarán source_type/source_id para quedar enlazadas al movimiento correspondiente.</div><div class="table-wrap"><table class="table"><thead><tr><th>Fecha</th><th>Tipo</th><th>Monto</th><th>Método</th><th>Categoría</th><th>Detalle</th></tr></thead><tbody>${rows.map(x=>`<tr><td>${new Date(x.occurred_at).toLocaleString('es-AR')}</td><td><span class="pill ${x.kind==='income'?'green':'red'}">${esc(x.kind)}</span></td><td>${esc(x.currency)} ${number(x.amount)}</td><td>${esc(x.payment_method||'—')}</td><td>${esc(x.category||'—')}</td><td>${esc(x.description||'—')}</td></tr>`).join('')}</tbody></table></div>`;
  }

  start();
})();
