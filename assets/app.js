(function(){
  const $=s=>document.querySelector(s);
  const content=$('#content');
  window.currentUser=null;
  let currentView='dashboard';
  let selectedBatchId=null;
  let importStatusFilter='needs_review';
  let importSearch='';
  let timer=null;
  let saleCart=[];
  let posProducts=[];
  let posMethods=[];
  let posCustomers=[];
  let posRecentSales=[];
  let posSearch='';
  let posCategory='';

  const money=n=>new Intl.NumberFormat('es-AR',{style:'currency',currency:'ARS',maximumFractionDigits:0}).format(Number(n||0));
  const number=n=>new Intl.NumberFormat('es-AR',{maximumFractionDigits:2}).format(Number(n||0));
  const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
  const metric=(label,value,sub='')=>`<div class="card metric"><small>${esc(label)}</small><b>${value}</b>${sub?`<small>${esc(sub)}</small>`:''}</div>`;
  const issueLabel=i=>({SIN_NOMBRE:'Sin nombre',SIN_CATEGORIA:'Sin categoría',STOCK_NEGATIVO:'Stock negativo',POSIBLE_DUPLICADO:'Posible duplicado',FUSIONADO:'Fusionado'}[i]||i);
  const statusPill=s=>({ready:'<span class="pill green">Listo</span>',needs_review:'<span class="pill yellow">Revisar</span>',imported:'<span class="pill blue">Importado</span>',skipped:'<span class="pill">Omitido</span>',error:'<span class="pill red">Error</span>',completed:'<span class="pill green">Completada</span>',cancelled:'<span class="pill red">Anulada</span>'}[s]||`<span class="pill">${esc(s)}</span>`);
  const safeDate=x=>x?new Date(x).toLocaleString('es-AR'):'—';

  async function start(){
    const {data:{session}}=await db.auth.getSession(); if(session) await enter(session.user);
    db.auth.onAuthStateChange(async(_,session)=>{ if(session&&!window.currentUser) await enter(session.user); if(!session) leave(); });
  }
  async function enter(user){ window.currentUser=user; $('#loginView').classList.add('hidden'); $('#appView').classList.remove('hidden'); $('#userLabel').textContent=user.email||user.id; await render(); }
  function leave(){ window.currentUser=null; $('#appView').classList.add('hidden'); $('#loginView').classList.remove('hidden'); }
  $('#loginForm').addEventListener('submit',async e=>{e.preventDefault();$('#loginError').textContent='';const {error}=await db.auth.signInWithPassword({email:$('#email').value,password:$('#password').value});if(error)$('#loginError').textContent=error.message});
  $('#logoutBtn').addEventListener('click',()=>db.auth.signOut());
  $('#nav').addEventListener('click',e=>{const b=e.target.closest('button[data-view]');if(!b)return;setView(b.dataset.view)});
  $('#globalSearch').addEventListener('input',e=>{
    const v=e.target.value;
    if(currentView==='products') renderProducts(v);
    if(currentView==='customers') renderCustomers(v);
    if(currentView==='sell'){posSearch=v;renderPosCatalog();}
  });
  function setView(v){currentView=v;document.querySelectorAll('#nav button').forEach(x=>x.classList.toggle('active',x.dataset.view===v));render();}

  async function render(){
    const titles={dashboard:'Inicio',sell:'Vender',products:'Productos / Stock',orders:'Pedidos',customers:'Clientes',finance:'Finanzas',imports:'Importar Kyte'};
    $('#viewTitle').textContent=titles[currentView]||'IMPORTB2B'; content.innerHTML='<div class="empty">Cargando…</div>';
    try{
      if(currentView==='dashboard') await renderDashboard();
      else if(currentView==='sell') await renderSell();
      else if(currentView==='products') await renderProducts($('#globalSearch').value);
      else if(currentView==='orders') await renderOrders();
      else if(currentView==='customers') await renderCustomers($('#globalSearch').value);
      else if(currentView==='finance') await renderFinance();
      else if(currentView==='imports') await renderImports();
    }catch(e){console.error(e);content.innerHTML=`<div class="notice danger">Error: ${esc(e.message)}</div>`}
  }

  async function renderDashboard(){
    const d=await DB.dashboard(), v=d.valuation||{}, b=d.importBatch;
    content.innerHTML=`
      <div class="grid dashboard-grid">
        ${metric('Ventas hoy',money(d.todaySales),`${d.todayCount} operaciones`)}
        ${metric('Facturación del mes',money(d.monthSales),'Ventas completadas')}
        ${metric('Stock disponible',number(d.stock),'Unidades vendibles')}
        ${metric('Productos',number(d.products),'Base central')}
        ${metric('A cobrar',money(d.receivable),'Cuentas corrientes')}
        ${metric('Ingresos del mes',money(d.income),'Control financiero')}
        ${metric('Egresos del mes',money(d.expense),'Control financiero')}
        ${metric('Resultado de caja',money(d.income-d.expense),'Ingresos - egresos')}
      </div>
      <details class="card stock-valuation" open style="margin-top:14px">
        <summary><div><small>Valorización del stock disponible</small><b>${money(v.stock_sale_value_ars)}</b></div><span class="muted">Ver detalle ▾</span></summary>
        <div class="valuation-grid">
          <div><small>Costo del stock</small><strong>${money(v.stock_cost_ars)}</strong></div>
          <div><small>Valor de venta</small><strong>${money(v.stock_sale_value_ars)}</strong></div>
          <div class="profit-value"><small>Ganancia esperada</small><strong>${money(v.expected_profit_ars)}</strong></div>
          <div><small>Unidades disponibles</small><strong>${number(v.available_units)}</strong></div>
        </div>
      </details>
      <div class="two-col" style="margin-top:14px">
        <div class="card"><div class="section-title"><div><span class="eyebrow">FASE 4</span><h3>Flujo conectado</h3></div></div>
          <div class="flow-strip"><span>Venta</span><b>→</b><span>Stock</span><b>→</b><span>Cliente</span><b>→</b><span>Finanzas</span></div>
          <div class="list" style="margin-top:14px"><div class="row"><span>POS / Ventas</span><span class="pill green">Activo</span></div><div class="row"><span>Pedidos → Stock</span><span class="pill green">Activo</span></div><div class="row"><span>Control Financiero</span><span class="pill green">Conectado</span></div><div class="row"><span>Clientes Kyte</span><span class="pill blue">161 migrados</span></div></div>
        </div>
        <div class="card"><h3 style="margin-top:0">Migración Kyte</h3>${b?`<p><b>${number(b.product_imported||0)}</b> importados · <b>${number(b.product_review||0)}</b> en revisión.</p><button id="goImports" class="btn ghost">Abrir importador</button>`:'<p class="muted">Sin lote activo.</p>'}<button id="goSell" class="btn primary" style="margin-top:10px">Registrar una venta</button></div>
      </div>`;
    $('#goImports')?.addEventListener('click',()=>setView('imports'));
    $('#goSell')?.addEventListener('click',()=>setView('sell'));
  }

  /* -------------------- POS / SALES -------------------- */
  function calcTotals(){
    const subtotal=saleCart.reduce((a,x)=>a+(Number(x.price)||0)*(Number(x.qty)||0),0);
    const shipping=Number($('#posShipping')?.value||0), discount=Number($('#posDiscount')?.value||0);
    const method=posMethods.find(x=>x.id===$('#posPayment')?.value)||posMethods[0];
    const base=Math.max(0,subtotal-discount+shipping); let adjustment=0;
    if(method?.adjustment_kind==='percent') adjustment=base*Number(method.adjustment_value||0)/100;
    else if(method?.adjustment_kind==='fixed') adjustment=Number(method.adjustment_value||0);
    if(method?.adjustment_direction==='discount') adjustment=-Math.abs(adjustment); else adjustment=Math.abs(adjustment);
    return {subtotal,shipping,discount,adjustment,total:Math.max(0,base+adjustment),method};
  }
  async function renderSell(){
    const [cats,products,methods,customers,recent]=await Promise.all([DB.categories(),DB.products('','','available'),DB.paymentMethods(),DB.customers(''),DB.recentSales(12)]);
    posProducts=products;posMethods=methods;posCustomers=customers;posRecentSales=recent;
    const currentCustomer=$('#posCustomer')?.value||'';
    const currentMethod=$('#posPayment')?.value||methods[0]?.id||'';
    const currentShipping=$('#posShipping')?.value||'0',currentDiscount=$('#posDiscount')?.value||'0',currentNotes=$('#posNotes')?.value||'';
    content.innerHTML=`
      <div class="pos-layout">
        <section class="pos-catalog card">
          <div class="section-title"><div><span class="eyebrow">VENTA RÁPIDA</span><h3>Productos</h3></div><span class="pill blue">${products.reduce((a,p)=>a+p.variants.filter(v=>Number(v.stock.available)>0).length,0)} variantes disponibles</span></div>
          <div class="toolbar"><input id="posSearch" value="${esc(posSearch)}" placeholder="Buscar producto, SKU, modelo o sabor…"><select id="posCategory"><option value="">Todas las categorías</option>${cats.map(c=>`<option value="${esc(c)}" ${c===posCategory?'selected':''}>${esc(c)}</option>`).join('')}</select></div>
          <div id="posCatalogGrid" class="pos-product-grid"></div>
        </section>
        <aside class="pos-cart card">
          <div class="section-title"><div><span class="eyebrow">CARRITO</span><h3>Venta actual</h3></div><span id="cartCount" class="pill">0</span></div>
          <div class="pos-customer-row"><label>Cliente<select id="posCustomer"><option value="">Venta sin cliente</option>${customers.map(c=>`<option value="${c.id}" ${c.id===currentCustomer?'selected':''}>${esc(c.full_name)}${c.phone?` · ${esc(c.phone)}`:''}</option>`).join('')}</select></label><button id="quickCustomer" class="btn ghost tiny">+ Cliente</button></div>
          <div id="cartItems" class="cart-items"></div>
          <div class="pos-fields"><label>Envío<input id="posShipping" type="number" min="0" step="100" value="${esc(currentShipping)}"></label><label>Descuento<input id="posDiscount" type="number" min="0" step="100" value="${esc(currentDiscount)}"></label></div>
          <label>Forma de pago<select id="posPayment">${methods.map(m=>`<option value="${m.id}" ${m.id===currentMethod?'selected':''}>${esc(m.name)}${Number(m.adjustment_value)?` · ${m.adjustment_direction==='discount'?'-':'+'}${number(m.adjustment_value)}${m.adjustment_kind==='percent'?'%':''}`:''}</option>`).join('')}</select></label>
          <div id="paymentHint" class="payment-hint"></div>
          <label>Nota<textarea id="posNotes" rows="2" placeholder="Opcional">${esc(currentNotes)}</textarea></label>
          <div id="cartTotals"></div>
          <button id="finishSale" class="btn primary full">Finalizar venta</button>
        </aside>
      </div>
      <section class="card" style="margin-top:14px"><div class="section-title"><div><span class="eyebrow">HISTORIAL</span><h3>Últimas ventas</h3></div></div><div id="recentSales"></div></section>`;
    renderPosCatalog(); renderCart(); renderRecentSales();
    $('#posSearch').addEventListener('input',e=>{posSearch=e.target.value;$('#globalSearch').value=posSearch;renderPosCatalog()});
    $('#posCategory').addEventListener('change',e=>{posCategory=e.target.value;renderPosCatalog()});
    ['#posShipping','#posDiscount','#posPayment'].forEach(sel=>$(sel).addEventListener('input',renderCartTotals));
    $('#quickCustomer').addEventListener('click',()=>openCustomerEditor(null,true));
    $('#finishSale').addEventListener('click',finishSale);
  }
  function renderPosCatalog(){
    const el=$('#posCatalogGrid'); if(!el)return;
    const q=posSearch.trim().toLowerCase();
    const rows=posProducts.filter(p=>(!posCategory||p.category===posCategory)&&(!q||[p.name,p.sku,p.category,...p.variants.flatMap(v=>[v.variant_name,v.sku])].join(' ').toLowerCase().includes(q)));
    el.innerHTML=rows.map(p=>{
      const variants=p.variants.filter(v=>Number(v.stock.available)>0);
      if(!variants.length)return'';
      return `<article class="pos-product-card"><div class="pos-product-head"><div><b>${esc(p.name)}</b><small>${esc(p.category||'')}</small></div><span class="pill ${variants.reduce((a,v)=>a+Number(v.stock.available),0)>0?'green':'red'}">${number(variants.reduce((a,v)=>a+Number(v.stock.available),0))}</span></div><div class="pos-variants">${variants.map(v=>`<button class="variant-add" data-pid="${p.id}" data-vid="${v.id}"><span><b>${esc(v.variant_name||'Única')}</b><small>${esc(v.sku||'Sin SKU')} · stock ${number(v.stock.available)}</small></span><strong>${money(v.price_ars)}</strong><em>+</em></button>`).join('')}</div></article>`;
    }).join('')||'<div class="empty">No hay productos disponibles para esta búsqueda.</div>';
    el.querySelectorAll('.variant-add').forEach(b=>b.addEventListener('click',()=>addToCart(b.dataset.pid,b.dataset.vid)));
  }
  function addToCart(productId,variantId){
    const p=posProducts.find(x=>x.id===productId),v=p?.variants.find(x=>x.id===variantId); if(!p||!v)return;
    const old=saleCart.find(x=>x.variantId===variantId);
    if(old){if(old.qty>=Number(v.stock.available))return alert('No hay más stock disponible');old.qty+=1}
    else saleCart.push({productId:p.id,variantId:v.id,name:p.name,variant:v.variant_name,sku:v.sku,price:Number(v.price_ars||0),cost:Number(v.cost_ars||0),available:Number(v.stock.available||0),qty:1});
    renderCart();
  }
  function renderCart(){
    const el=$('#cartItems'); if(!el)return;
    $('#cartCount').textContent=saleCart.reduce((a,x)=>a+x.qty,0);
    el.innerHTML=saleCart.length?saleCart.map(x=>`<div class="cart-line" data-cart="${x.variantId}"><div class="cart-line-info"><b>${esc(x.name)}</b><small>${esc(x.variant||'Única')} · ${esc(x.sku||'')}</small></div><div class="cart-controls"><button class="cart-minus">−</button><input class="cart-qty" type="number" min="1" max="${x.available}" value="${x.qty}"><button class="cart-plus">+</button></div><div class="cart-price"><input class="cart-unit-price" type="number" min="0" step="100" value="${x.price}"><b>${money(x.price*x.qty)}</b></div><button class="cart-remove">×</button></div>`).join(''):'<div class="empty compact-empty">Agregá productos para comenzar.</div>';
    el.querySelectorAll('[data-cart]').forEach(row=>{
      const item=saleCart.find(x=>x.variantId===row.dataset.cart);
      row.querySelector('.cart-minus').addEventListener('click',()=>{if(item.qty>1)item.qty--;else saleCart=saleCart.filter(x=>x!==item);renderCart()});
      row.querySelector('.cart-plus').addEventListener('click',()=>{if(item.qty<item.available)item.qty++;else alert('No hay más stock disponible');renderCart()});
      row.querySelector('.cart-remove').addEventListener('click',()=>{saleCart=saleCart.filter(x=>x!==item);renderCart()});
      row.querySelector('.cart-qty').addEventListener('change',e=>{let n=Math.max(1,Math.min(item.available,Number(e.target.value||1)));item.qty=n;renderCart()});
      row.querySelector('.cart-unit-price').addEventListener('change',e=>{item.price=Math.max(0,Number(e.target.value||0));renderCart()});
    });
    renderCartTotals();
  }
  function renderCartTotals(){
    const box=$('#cartTotals');if(!box)return; const t=calcTotals(),m=t.method;
    $('#paymentHint').innerHTML=m?`${m.finance_mode==='settlement'?'Se registra como <b>dinero a liquidar</b>.':m.finance_mode==='receivable'?'Se registra como <b>cuenta por cobrar</b>.':'Se registra automáticamente como <b>ingreso</b> en Finanzas.'}`:'';
    box.innerHTML=`<div class="totals-list"><div><span>Subtotal</span><b>${money(t.subtotal)}</b></div><div><span>Descuento</span><b>-${money(t.discount)}</b></div><div><span>Envío</span><b>${money(t.shipping)}</b></div>${t.adjustment?`<div><span>${t.adjustment>0?'Recargo':'Descuento'} ${esc(m?.name||'')}</span><b>${t.adjustment>0?'+':''}${money(t.adjustment)}</b></div>`:''}<div class="grand-total"><span>Total</span><strong>${money(t.total)}</strong></div></div>`;
    const btn=$('#finishSale');if(btn){btn.disabled=!saleCart.length||!m;btn.textContent=`Finalizar ${money(t.total)}`}
  }
  async function finishSale(){
    if(!saleCart.length)return; const t=calcTotals(); if(!t.method)return alert('Elegí una forma de pago');
    const customerId=$('#posCustomer').value||null; if(t.method.finance_mode==='receivable'&&!customerId)return alert('Cuenta corriente requiere seleccionar un cliente');
    if(!confirm(`Confirmar venta por ${money(t.total)} con ${t.method.name}?`))return;
    const btn=$('#finishSale');btn.disabled=true;btn.textContent='Registrando…'; const snapshot=saleCart.map(x=>({...x}));
    try{
      const result=await DB.completeSale({customerId,items:snapshot.map(x=>({variant_id:x.variantId,quantity:x.qty,unit_price_ars:x.price})),paymentMethodId:t.method.id,shipping:t.shipping,discount:t.discount,notes:$('#posNotes').value.trim()});
      const customer=posCustomers.find(x=>x.id===customerId)||null; saleCart=[]; await renderSell(); openReceipt(result,snapshot,customer);
    }catch(e){alert(e.message);btn.disabled=false;renderCartTotals()}
  }
  function openReceipt(r,items,customer){
    openModal(`<div class="receipt"><div class="receipt-brand"><img src="./assets/img/logo-importb2b.png" alt="IMPORTB2B"><div><span class="eyebrow">VENTA REGISTRADA</span><h3>Recibo ${esc(r.sale_code)}</h3></div></div><div class="receipt-meta"><span>${safeDate(r.sold_at)}</span><span>${customer?esc(customer.full_name):'Consumidor final'}</span></div><div class="receipt-lines">${items.map(x=>`<div><span>${x.qty}× ${esc(x.name)}${x.variant&&x.variant!=='Única'?` · ${esc(x.variant)}`:''}</span><b>${money(x.qty*x.price)}</b></div>`).join('')}</div><div class="receipt-totals"><div><span>Subtotal</span><b>${money(r.subtotal_ars)}</b></div><div><span>Descuento</span><b>-${money(r.discount_ars)}</b></div><div><span>Envío</span><b>${money(r.shipping_ars)}</b></div>${Number(r.adjustment_ars)?`<div><span>Ajuste ${esc(r.payment_method)}</span><b>${Number(r.adjustment_ars)>0?'+':''}${money(r.adjustment_ars)}</b></div>`:''}<div class="grand-total"><span>Total</span><strong>${money(r.total_ars)}</strong></div></div><div class="notice good-notice">${r.finance_mode==='settlement'?'Registrada en dinero a liquidar.':r.finance_mode==='receivable'?'Registrada como cuenta por cobrar.':'Ingreso registrado automáticamente en Control Financiero.'}</div><div class="modal-actions"><button class="btn ghost modal-close">Cerrar</button><button id="printReceipt" class="btn ghost">Imprimir</button><button id="newSale" class="btn primary">Nueva venta</button></div></div>`);
    $('#newSale').addEventListener('click',()=>{closeModal();setView('sell')});
    $('#printReceipt').addEventListener('click',()=>printReceipt(r,items,customer));
  }
  function printReceipt(r,items,customer){
    const w=window.open('','_blank','width=420,height=720');if(!w)return alert('El navegador bloqueó la ventana de impresión');
    w.document.write(`<html><head><title>${esc(r.sale_code)}</title><style>body{font-family:Arial;padding:24px;color:#111}h2{margin:0}hr{border:0;border-top:1px solid #ddd}.row{display:flex;justify-content:space-between;margin:8px 0}.total{font-size:24px;font-weight:800}</style></head><body><h2>IMPORTB2B</h2><p>Recibo ${esc(r.sale_code)}<br>${customer?esc(customer.full_name):'Consumidor final'}</p><hr>${items.map(x=>`<div class="row"><span>${x.qty}× ${esc(x.name)} ${esc(x.variant||'')}</span><b>${money(x.qty*x.price)}</b></div>`).join('')}<hr><div class="row total"><span>Total</span><span>${money(r.total_ars)}</span></div><p>${esc(r.payment_method)}</p><script>window.onload=()=>window.print()<\/script></body></html>`);w.document.close();
  }
  function renderRecentSales(){
    const el=$('#recentSales');if(!el)return;
    el.innerHTML=`<div class="table-wrap"><table class="table"><thead><tr><th>Venta</th><th>Fecha</th><th>Cliente</th><th>Pago</th><th>Total</th><th>Estado</th><th></th></tr></thead><tbody>${posRecentSales.map(s=>`<tr><td><b>${esc(s.sale_code)}</b></td><td>${safeDate(s.sold_at)}</td><td>${esc(s.customer?.full_name||'Consumidor final')}</td><td>${esc(s.payments?.[0]?.method?.name||s.original_payment_method||'—')}</td><td>${money(s.total_ars)}</td><td>${statusPill(s.status)}</td><td>${s.status==='completed'?`<button class="btn tiny danger-btn cancel-sale" data-id="${s.id}" data-code="${esc(s.sale_code)}">Anular</button>`:'—'}</td></tr>`).join('')||'<tr><td colspan="7" class="empty">Aún no hay ventas en Central.</td></tr>'}</tbody></table></div>`;
    el.querySelectorAll('.cancel-sale').forEach(b=>b.addEventListener('click',async()=>{const reason=prompt(`Motivo para anular ${b.dataset.code}:`,'Error / devolución');if(reason===null)return;if(!confirm('Esto devolverá el stock y revertirá el efecto financiero. ¿Continuar?'))return;try{await DB.cancelSale(b.dataset.id,reason);await renderSell()}catch(e){alert(e.message)}}));
  }

  /* -------------------- PRODUCTS -------------------- */
  async function renderProducts(q=''){
    const currentCat=$('#categoryFilter')?.value||'', currentStock=$('#stockFilter')?.value||'all';
    const [cats,products]=await Promise.all([DB.categories(),DB.products(q,currentCat,currentStock)]);
    content.innerHTML=`<div class="toolbar"><input id="productSearch" value="${esc(q)}" placeholder="Nombre, SKU, categoría, variante…"><select id="categoryFilter"><option value="">Todas las categorías</option>${cats.map(c=>`<option value="${esc(c)}" ${c===currentCat?'selected':''}>${esc(c)}</option>`).join('')}</select><select id="stockFilter"><option value="all" ${currentStock==='all'?'selected':''}>Todo stock</option><option value="available" ${currentStock==='available'?'selected':''}>Con stock</option><option value="low" ${currentStock==='low'?'selected':''}>Stock bajo</option><option value="out" ${currentStock==='out'?'selected':''}>Sin stock</option><option value="transit" ${currentStock==='transit'?'selected':''}>En tránsito</option></select></div><div class="table-wrap"><table class="table"><thead><tr><th>Producto</th><th>Categoría</th><th>Variantes</th><th>Disponible</th><th>Reservado</th><th>En tránsito</th><th>Precio</th><th></th></tr></thead><tbody>${products.map(p=>{const av=p.variants.reduce((a,v)=>a+Number(v.stock.available||0),0),res=p.variants.reduce((a,v)=>a+Number(v.stock.reserved||0),0),tr=p.variants.reduce((a,v)=>a+Number(v.stock.in_transit||0),0),prices=p.variants.map(v=>Number(v.price_ars||0)).filter(Boolean);return`<tr><td><b>${esc(p.name)}</b><br><small class="muted">${esc(p.sku||'Sin SKU')}</small></td><td>${esc(p.category||'—')}</td><td>${p.variants.length}</td><td><span class="pill ${av>0?'green':'red'}">${number(av)}</span></td><td>${number(res)}</td><td>${tr?`<span class="pill blue">${number(tr)}</span>`:'0'}</td><td>${prices.length?money(Math.min(...prices)):'—'}</td><td><button class="btn tiny ghost edit-product" data-id="${p.id}">Editar</button></td></tr>`}).join('')||'<tr><td colspan="8" class="empty">Sin resultados.</td></tr>'}</tbody></table></div>`;
    $('#productSearch').addEventListener('input',e=>{const v=e.target.value;$('#globalSearch').value=v;clearTimeout(timer);timer=setTimeout(()=>renderProducts(v),140)});
    $('#categoryFilter').addEventListener('change',()=>renderProducts($('#productSearch').value));$('#stockFilter').addEventListener('change',()=>renderProducts($('#productSearch').value));
    document.querySelectorAll('.edit-product').forEach(b=>b.addEventListener('click',()=>openProductEditor(b.dataset.id)));
  }
  async function openProductEditor(productId){
    const [p,cats]=await Promise.all([DB.productDetail(productId),DB.categories()]); const vape=String(p.category).toLowerCase()==='vapers';
    const rows=p.variants.map(v=>`<tr data-variant="${v.id}"><td><input class="v-name" value="${esc(v.variant_name)}"></td><td><input class="v-sku" value="${esc(v.sku||'')}"></td><td><input class="v-cost" type="number" value="${Number(v.cost_ars||0)}"></td><td><input class="v-price" type="number" value="${Number(v.price_ars||0)}"></td><td><input class="v-min" type="number" value="${Number(v.stock_min||0)}"></td><td><b>${number(v.stock.on_hand)}</b><br><small class="muted">disp. ${number(v.stock.available)}</small></td><td><button class="btn tiny ghost adjust-stock" data-vid="${v.id}" data-current="${Number(v.stock.on_hand||0)}">Ajustar</button></td></tr>`).join('');
    openModal(`<div class="section-title"><div><span class="eyebrow">PRODUCTO</span><h3>Editar producto</h3></div><button class="modal-close">×</button></div><div class="form-grid"><label>Nombre<input id="epName" value="${esc(p.name)}"></label><label>Categoría<select id="epCategory">${cats.map(c=>`<option value="${esc(c)}" ${c===p.category?'selected':''}>${esc(c)}</option>`).join('')}</select></label><label>SKU general<input id="epSku" value="${esc(p.sku||'')}"></label><label class="check"><input id="epCatalog" type="checkbox" ${p.catalog_visible?'checked':''}> Visible en catálogo</label></div><div class="section-title" style="margin-top:18px"><div><h3>${vape?'Sabores':'Variantes'}</h3><small class="muted">${vape?'Cada sabor comparte el mismo modelo de Vaper.':'Stock y precio independiente por variante.'}</small></div><button id="addVariant" class="btn ghost">+ ${vape?'Sabor':'Variante'}</button></div><div class="table-wrap"><table class="table compact"><thead><tr><th>${vape?'Sabor':'Variante'}</th><th>SKU</th><th>Costo</th><th>Precio</th><th>Mín.</th><th>Stock físico</th><th></th></tr></thead><tbody>${rows}</tbody></table></div><div class="modal-actions"><button class="btn ghost modal-close">Cancelar</button><button id="saveProduct" class="btn primary">Guardar cambios</button></div>`);
    $('#saveProduct').addEventListener('click',async()=>{try{const category=$('#epCategory').value;await DB.saveProduct(productId,{name:$('#epName').value.trim(),category,sku:$('#epSku').value.trim()||null,catalog_visible:$('#epCatalog').checked});for(const tr of document.querySelectorAll('[data-variant]')){const variant_name=tr.querySelector('.v-name').value.trim()||'Única';const payload={variant_name,sku:tr.querySelector('.v-sku').value.trim()||null,cost_ars:Number(tr.querySelector('.v-cost').value||0),price_ars:Number(tr.querySelector('.v-price').value||0),stock_min:Number(tr.querySelector('.v-min').value||0)};if(category.toLowerCase()==='vapers')payload.attributes={sabor:variant_name};await DB.saveVariant(tr.dataset.variant,payload)}closeModal();await renderProducts($('#globalSearch').value)}catch(e){alert(e.message)}});
    document.querySelectorAll('.adjust-stock').forEach(b=>b.addEventListener('click',async()=>{const current=Number(b.dataset.current),val=prompt(`Stock físico actual: ${current}\nNueva cantidad física:`,String(current));if(val===null)return;const next=Number(val);if(!Number.isFinite(next)||next<0)return alert('Cantidad inválida');const note=prompt('Motivo:','Conteo físico / corrección manual')||'Ajuste manual';try{await DB.adjustStock(productId,b.dataset.vid,current,next,note);closeModal();await openProductEditor(productId)}catch(e){alert(e.message)}}));
    $('#addVariant').addEventListener('click',async()=>{const name=prompt(vape?'Nombre del sabor:':'Nombre de variante:','');if(!name)return;const price=Number(prompt('Precio venta ARS:','0')||0),cost=Number(prompt('Costo ARS:','0')||0),initial=Number(prompt('Stock inicial:','0')||0);if([price,cost,initial].some(x=>!Number.isFinite(x))||initial<0)return alert('Valores inválidos');try{await DB.createVariant(productId,{variant_name:name.trim(),cost_ars:cost,price_ars:price,stock_min:0,active:true,attributes:vape?{sabor:name.trim()}:{}},initial,'Alta manual de variante');closeModal();await openProductEditor(productId)}catch(e){alert(e.message)}});
  }

  /* -------------------- CUSTOMERS -------------------- */
  async function renderCustomers(q=''){
    const rows=await DB.customers(q);
    content.innerHTML=`<div class="section-title"><div><span class="eyebrow">BASE ÚNICA</span><h3>Clientes</h3></div><button id="addCustomer" class="btn primary">+ Cliente</button></div><div class="toolbar"><input id="customerSearch" value="${esc(q)}" placeholder="Buscar por nombre, teléfono, email o código…"></div><div class="table-wrap"><table class="table"><thead><tr><th>Cliente</th><th>Contacto</th><th>Compras Central</th><th>Total Central</th><th>A cobrar</th><th>Última compra</th><th></th></tr></thead><tbody>${rows.map(c=>`<tr><td><b>${esc(c.full_name)}</b><br><small class="muted">${esc(c.customer_code||c.source||'')}</small></td><td>${esc(c.phone||'—')}<br><small class="muted">${esc(c.email||'')}</small></td><td>${number(c.completed_sales)}</td><td>${money(c.total_spent_ars)}</td><td>${Number(c.pending_receivable_ars)>0?`<span class="pill yellow">${money(c.pending_receivable_ars)}</span>`:'—'}</td><td>${c.last_sale_at?safeDate(c.last_sale_at):'—'}</td><td><button class="btn tiny ghost edit-customer" data-id="${c.id}">Editar</button></td></tr>`).join('')||'<tr><td colspan="7" class="empty">Sin clientes.</td></tr>'}</tbody></table></div>`;
    $('#customerSearch').addEventListener('input',e=>{const v=e.target.value;$('#globalSearch').value=v;clearTimeout(timer);timer=setTimeout(()=>renderCustomers(v),150)});$('#addCustomer').addEventListener('click',()=>openCustomerEditor());document.querySelectorAll('.edit-customer').forEach(b=>b.addEventListener('click',()=>openCustomerEditor(rows.find(x=>x.id===b.dataset.id))));
  }
  function openCustomerEditor(customer=null,fromPos=false){
    openModal(`<div class="section-title"><div><span class="eyebrow">CLIENTE</span><h3>${customer?'Editar':'Nuevo'} cliente</h3></div><button class="modal-close">×</button></div><div class="form-grid"><label>Nombre<input id="cuName" value="${esc(customer?.full_name||'')}"></label><label>Teléfono<input id="cuPhone" value="${esc(customer?.phone||'')}"></label><label>Email<input id="cuEmail" type="email" value="${esc(customer?.email||'')}"></label><label>Instagram<input id="cuInstagram" value="${esc(customer?.instagram_username||'')}"></label><label>Dirección<input id="cuAddress" value="${esc(customer?.address||'')}"></label><label>Documento<input id="cuDoc" value="${esc(customer?.document_number||'')}"></label></div><label style="margin-top:12px">Notas<textarea id="cuNotes" rows="3">${esc(customer?.notes||'')}</textarea></label><div class="modal-actions"><button class="btn ghost modal-close">Cancelar</button><button id="saveCustomer" class="btn primary">Guardar cliente</button></div>`);
    $('#saveCustomer').addEventListener('click',async()=>{const payload={full_name:$('#cuName').value.trim(),phone:$('#cuPhone').value.trim()||null,email:$('#cuEmail').value.trim()||null,instagram_username:$('#cuInstagram').value.trim()||null,address:$('#cuAddress').value.trim()||null,document_number:$('#cuDoc').value.trim()||null,notes:$('#cuNotes').value.trim()||null};if(!payload.full_name)return alert('Ingresá el nombre');try{if(customer)await DB.updateCustomer(customer.id,payload);else await DB.createCustomer(payload);closeModal();if(fromPos)await renderSell();else await renderCustomers($('#globalSearch').value)}catch(e){alert(e.message)}});
  }

  /* -------------------- ORDERS -> STOCK -------------------- */
  async function renderOrders(){
    const rows=await DB.recentOrders();
    content.innerHTML=`<div class="notice good-notice" style="margin-bottom:14px">Los pedidos históricos están protegidos para no duplicar el stock ya migrado desde Kyte. Los nuevos pueden distribuirse por variante y recibirse parcial o totalmente.</div><div class="order-stack">${rows.map(o=>`<article class="card order-card"><div class="section-title"><div><span class="eyebrow">PEDIDO #${esc(o.order_number??o.id)}</span><h3>${esc(o.order_date||'')}</h3><small class="muted">${number(o.total_units)} unidades · USD ${number(o.investment_usd)}</small></div>${o.shipment?`<span class="pill ${o.shipment.is_received?'green':'blue'}">${esc(o.shipment.latest_checkpoint_description||o.shipment.normalized_status||o.shipment.carrier_name)}</span>`:''}</div>${o.items.map(i=>renderOrderItem(i)).join('')}</article>`).join('')||'<div class="empty">Sin pedidos.</div>'}</div>`;
    document.querySelectorAll('.activate-stock-item').forEach(b=>b.addEventListener('click',async()=>{if(!confirm('Este pedido es histórico. Activarlo puede sumar unidades al stock actual. ¿Confirmás que estas unidades NO están incluidas en el stock migrado?'))return;try{await DB.setOrderItemStockMode(b.dataset.id,true);await renderOrders()}catch(e){alert(e.message)}}));
    document.querySelectorAll('.edit-allocation').forEach(b=>b.addEventListener('click',()=>openOrderAllocation(b.dataset.id,rows)));
    document.querySelectorAll('.receive-allocation').forEach(b=>b.addEventListener('click',async()=>{const remaining=Number(b.dataset.remaining);const q=prompt(`Quedan ${remaining} unidades por recibir. ¿Cuántas llegaron?`,String(remaining));if(q===null)return;const n=Number(q);if(!Number.isFinite(n)||n<=0||n>remaining)return alert('Cantidad inválida');const note=prompt('Nota de recepción:','Recepción de mercadería')||'';try{await DB.receiveOrderAllocation(b.dataset.id,n,note);await renderOrders()}catch(e){alert(e.message)}}));
  }
  function renderOrderItem(i){
    const hist=i.stock_link_status==='historical',alloc=i.allocations||[],rec=Number(i.received_quantity||0);
    return `<div class="order-item"><div class="order-item-main"><div><b>${esc(i.product)}</b><br><small class="muted">${esc(i.category||'')} · ${number(i.quantity)} un. · costo ${money(i.cost_ars)}</small></div><span class="pill ${hist?'yellow':rec>=Number(i.quantity)?'green':alloc.length?'blue':''}">${hist?'Histórico':rec>=Number(i.quantity)?'Recibido':alloc.length?'Vinculado':'Pendiente'}</span></div>${alloc.length?`<div class="allocation-list">${alloc.map(a=>{const rem=Number(a.ordered_quantity)-Number(a.received_quantity);return`<div class="allocation-row"><span><b>${esc(a.product?.name||'Producto')}</b> · ${esc(a.variant?.variant_name||'Única')}<br><small class="muted">${number(a.received_quantity)} / ${number(a.ordered_quantity)} recibidas</small></span>${rem>0?`<button class="btn tiny good receive-allocation" data-id="${a.id}" data-remaining="${rem}">Recibir ${number(rem)}</button>`:'<span class="pill green">Completo</span>'}</div>`}).join('')}</div>`:''}<div class="order-item-actions">${hist?`<button class="btn tiny danger-btn activate-stock-item" data-id="${i.id}">Activar para stock</button>`:`<button class="btn tiny ghost edit-allocation" data-id="${i.id}">${alloc.length?'Editar distribución':'Vincular / distribuir'}</button>`}</div></div>`;
  }
  async function openOrderAllocation(itemId,orders){
    const item=orders.flatMap(o=>o.items).find(i=>String(i.id)===String(itemId));if(!item)return;
    const products=await DB.orderProductOptions(); const existing=item.allocations||[],lockedProduct=existing.find(x=>Number(x.received_quantity)>0)?.product_id||null;
    openModal(`<div class="section-title"><div><span class="eyebrow">PEDIDO</span><h3>Distribuir ${esc(item.product)}</h3><small class="muted">${number(item.quantity)} unidades totales</small></div><button class="modal-close">×</button></div><div class="toolbar"><input id="oaSearch" placeholder="Buscar producto…"><select id="oaProduct"><option value="">Elegí un producto</option></select></div><div id="oaVariants"></div><div class="modal-actions"><button class="btn ghost modal-close">Cancelar</button><button id="saveAllocations" class="btn primary">Guardar distribución</button></div>`);
    const search=$('#oaSearch'),select=$('#oaProduct');
    function refill(){const q=search.value.toLowerCase();const list=products.filter(p=>!q||[p.name,p.category,p.sku].join(' ').toLowerCase().includes(q));select.innerHTML='<option value="">Elegí un producto</option>'+list.map(p=>`<option value="${p.id}" ${existing[0]?.product_id===p.id?'selected':''}>${esc(p.name)} · ${esc(p.category||'')}</option>`).join('');renderVars()}
    function renderVars(){const p=products.find(x=>x.id===select.value);if(!p){$('#oaVariants').innerHTML='<div class="empty">Elegí un producto.</div>';return}$('#oaVariants').innerHTML=`<div class="table-wrap"><table class="table compact"><thead><tr><th>Variante</th><th>Stock actual</th><th>Asignar del pedido</th></tr></thead><tbody>${p.variants.map(v=>{const old=existing.find(a=>a.variant_id===v.id);return`<tr data-alloc="${v.id}" data-received="${Number(old?.received_quantity||0)}" data-existing="${old?.id||''}"><td><b>${esc(v.variant_name)}</b><br><small class="muted">${esc(v.sku||'')}</small></td><td>${number(v.stock.available)}</td><td><input class="alloc-qty" type="number" min="0" step="1" value="${Number(old?.ordered_quantity||0)}"></td></tr>`}).join('')}</tbody></table></div><p class="muted">Total asignado: <b id="oaTotal">0</b> / ${number(item.quantity)}</p>`;const ins=[...document.querySelectorAll('.alloc-qty')];const update=()=>$('#oaTotal').textContent=number(ins.reduce((a,x)=>a+Number(x.value||0),0));ins.forEach(x=>x.addEventListener('input',update));update()}
    search.addEventListener('input',()=>{clearTimeout(timer);timer=setTimeout(refill,120)});select.addEventListener('change',renderVars);refill();
    $('#saveAllocations').addEventListener('click',async()=>{const p=products.find(x=>x.id===select.value);if(!p)return alert('Elegí un producto');if(lockedProduct&&lockedProduct!==p.id)return alert('Ya hay unidades recibidas para otro producto.');const rows=[...document.querySelectorAll('[data-alloc]')],total=rows.reduce((a,tr)=>a+Number(tr.querySelector('.alloc-qty').value||0),0);if(total>Number(item.quantity))return alert('La distribución supera las unidades del pedido');try{const chosen=new Set(rows.filter(tr=>Number(tr.querySelector('.alloc-qty').value)>0).map(tr=>tr.dataset.alloc));for(const old of existing){if(old.product_id!==p.id||!chosen.has(old.variant_id)){if(Number(old.received_quantity)>0)throw new Error('No se puede eliminar una variante ya recibida');await DB.deleteOrderAllocation(old.id)}}for(const tr of rows){const qty=Number(tr.querySelector('.alloc-qty').value||0),received=Number(tr.dataset.received||0);if(qty<received)throw new Error('No podés asignar menos de lo ya recibido');if(qty>0)await DB.saveOrderAllocation(item.id,tr.dataset.alloc,qty);else if(tr.dataset.existing&&received===0)await DB.deleteOrderAllocation(tr.dataset.existing)}closeModal();await renderOrders()}catch(e){alert(e.message)}});
  }

  /* -------------------- FINANCE -------------------- */
  async function renderFinance(){
    const f=await DB.recentFinance();
    content.innerHTML=`<div class="grid mini-grid">${metric('Movimientos recientes',number(f.movements.length))}${metric('A liquidar',money(f.settlements.reduce((a,x)=>a+Number(x.net_amount||x.gross_amount||0),0)))}${metric('A cobrar',money(f.receivables.reduce((a,x)=>a+Number(x.pending_amount||0),0)))}</div><div class="two-col" style="margin-top:14px"><section class="card"><div class="section-title"><div><span class="eyebrow">CAJA</span><h3>Movimientos</h3></div></div><div class="table-wrap"><table class="table"><thead><tr><th>Fecha</th><th>Tipo</th><th>Monto</th><th>Método</th><th>Categoría</th><th>Detalle</th></tr></thead><tbody>${f.movements.map(x=>`<tr><td>${safeDate(x.occurred_at)}</td><td><span class="pill ${x.kind==='income'?'green':'red'}">${x.kind==='income'?'Ingreso':'Egreso'}</span></td><td>${esc(x.currency)} ${number(x.amount)}</td><td>${esc(x.payment_method)}</td><td>${esc(x.category)}</td><td>${esc(x.description||'—')}</td></tr>`).join('')}</tbody></table></div></section><div class="finance-side"><section class="card"><div class="section-title"><h3>Dinero a liquidar</h3></div>${f.settlements.map(x=>`<div class="row"><span><b>${esc(x.provider)}</b><br><small class="muted">${esc(x.description||'')} · ${esc(x.expected_at||'')}</small></span><strong>${money(x.net_amount||x.gross_amount)}</strong></div>`).join('')||'<div class="empty">Sin liquidaciones pendientes.</div>'}</section><section class="card"><div class="section-title"><h3>Cuentas por cobrar</h3></div>${f.receivables.map(x=>`<div class="row"><span><b>${esc(x.client_name)}</b><br><small class="muted">${esc(x.description||'')}</small></span><strong>${money(x.pending_amount)}</strong></div>`).join('')||'<div class="empty">Sin cuentas pendientes.</div>'}</section></div></div>`;
  }

  /* -------------------- KYTE IMPORT -------------------- */
  async function renderImports(){
    const batches=await DB.importBatches(); if(!selectedBatchId&&batches.length)selectedBatchId=batches[0].batch_id;if(selectedBatchId&&!batches.some(x=>x.batch_id===selectedBatchId))selectedBatchId=batches[0]?.batch_id||null;const batch=batches.find(x=>x.batch_id===selectedBatchId)||null;let rows=batch?await DB.importRows(batch.batch_id,'product'):[];
    const counts={all:rows.length,ready:rows.filter(x=>x.status==='ready').length,needs_review:rows.filter(x=>x.status==='needs_review').length,imported:rows.filter(x=>x.status==='imported').length,skipped:rows.filter(x=>x.status==='skipped').length};if(importStatusFilter==='needs_review'&&!counts.needs_review&&counts.ready)importStatusFilter='ready';const q=importSearch.trim().toLowerCase();const filtered=rows.filter(r=>(importStatusFilter==='all'||r.status===importStatusFilter)&&(!q||[r.normalized_data?.name,r.normalized_data?.base_name,r.normalized_data?.category,r.normalized_data?.size,r.normalized_data?.flavor,r.row_number,(r.issues||[]).join(' ')].join(' ').toLowerCase().includes(q)));
    content.innerHTML=`<div class="card"><div class="section-title"><div><span class="eyebrow">MIGRACIÓN</span><h3>Centro de importación Kyte</h3><p class="muted">El stock real ya está centralizado. Usá este módulo solo para nuevas importaciones o auditoría.</p></div></div><div class="import-grid"><div class="upload-card"><b>Productos</b><input id="productsFile" type="file" accept=".csv,text/csv"></div><div class="upload-card"><b>Clientes</b><input id="customersFile" type="file" accept=".csv,text/csv"></div><div class="upload-card"><b>Ventas</b><input id="salesFile" type="file" accept=".csv,text/csv"></div></div><div class="section-title" style="margin-top:14px"><div class="progress grow"><span id="importProgress"></span></div><button id="stageBtn" class="btn ghost">Analizar lote</button></div><div id="importResult" class="muted small-text"></div></div>${batch?`<div class="card" style="margin-top:14px"><div class="section-title"><div><h3>Revisión</h3><small class="muted">${esc(batch.products_filename||'Kyte')} · ${safeDate(batch.created_at)}</small></div><select id="batchSelect">${batches.map(x=>`<option value="${x.batch_id}" ${x.batch_id===batch.batch_id?'selected':''}>${safeDate(x.created_at)} · ${x.product_rows||0} productos</option>`).join('')}</select></div><div class="grid mini-grid">${metric('Filas',number(counts.all))}${metric('Listas',number(counts.ready))}${metric('Revisar',number(counts.needs_review))}${metric('Importadas',number(counts.imported))}</div><div class="toolbar" style="margin-top:14px"><input id="importSearch" value="${esc(importSearch)}" placeholder="Buscar producto, categoría, talle o sabor…"><select id="importStatus"><option value="needs_review" ${importStatusFilter==='needs_review'?'selected':''}>Requieren revisión</option><option value="ready" ${importStatusFilter==='ready'?'selected':''}>Listos</option><option value="imported" ${importStatusFilter==='imported'?'selected':''}>Importados</option><option value="skipped" ${importStatusFilter==='skipped'?'selected':''}>Omitidos</option><option value="all" ${importStatusFilter==='all'?'selected':''}>Todos</option></select><button id="refreshIssues" class="btn ghost">Reanalizar</button><button id="commitProducts" class="btn primary" ${counts.ready?'':'disabled'}>Consolidar ${counts.ready}</button></div><div class="table-wrap"><table class="table"><thead><tr><th>#</th><th>Producto base</th><th>Categoría</th><th>Variante</th><th>Stock</th><th>Costo</th><th>Precio</th><th>Estado</th><th>Problemas</th><th></th></tr></thead><tbody>${filtered.map(r=>{const n=r.normalized_data||{},variant=n.flavor||n.size||'Única';return`<tr><td>${r.row_number}</td><td><b>${esc(n.base_name||n.name||'—')}</b><br><small class="muted">${esc(n.name||'')}</small></td><td>${esc(n.category||'—')}</td><td>${esc(variant)}</td><td>${number(n.stock)}</td><td>${money(n.cost_ars)}</td><td>${money(n.price_ars)}</td><td>${statusPill(r.status)}</td><td>${(r.issues||[]).map(i=>`<span class="issue-tag">${esc(issueLabel(i))}</span>`).join(' ')||'—'}</td><td>${r.status==='imported'?'✓':r.status==='skipped'?`<button class="btn tiny ghost restore-row" data-id="${r.id}">Restaurar</button>`:`<button class="btn tiny ghost edit-import-row" data-id="${r.id}">Editar</button> <button class="btn tiny danger-btn skip-row" data-id="${r.id}">Omitir</button>`}</td></tr>`}).join('')}</tbody></table></div></div>`:''}`;
    $('#stageBtn').addEventListener('click',async()=>{const files={products:$('#productsFile').files[0],customers:$('#customersFile').files[0],sales:$('#salesFile').files[0]};try{const s=await KyteImporter.uploadAll(files,p=>$('#importProgress').style.width=(p*100)+'%');selectedBatchId=s.batch_id;importStatusFilter='needs_review';importSearch='';setTimeout(renderImports,300)}catch(e){$('#importResult').innerHTML=`<span class="error">${esc(e.message)}</span>`}});if(!batch)return;
    $('#batchSelect').addEventListener('change',e=>{selectedBatchId=e.target.value;renderImports()});$('#importSearch').addEventListener('input',e=>{importSearch=e.target.value;clearTimeout(timer);timer=setTimeout(renderImports,130)});$('#importStatus').addEventListener('change',e=>{importStatusFilter=e.target.value;renderImports()});$('#refreshIssues').addEventListener('click',async()=>{try{await DB.refreshImportProductIssues(batch.batch_id);await renderImports()}catch(e){alert(e.message)}});$('#commitProducts').addEventListener('click',async()=>{if(!counts.ready||!confirm(`Consolidar ${counts.ready} filas listas?`))return;try{const r=await DB.commitKyteProducts(batch.batch_id);alert(`Importadas: ${r.rows_imported}`);await renderImports()}catch(e){alert(e.message)}});document.querySelectorAll('.skip-row').forEach(b=>b.addEventListener('click',async()=>{try{await DB.skipImportRow(b.dataset.id);await DB.refreshImportProductIssues(batch.batch_id);await renderImports()}catch(e){alert(e.message)}}));document.querySelectorAll('.restore-row').forEach(b=>b.addEventListener('click',async()=>{try{await DB.restoreImportRow(b.dataset.id,batch.batch_id);await renderImports()}catch(e){alert(e.message)}}));document.querySelectorAll('.edit-import-row').forEach(b=>b.addEventListener('click',()=>openImportRowEditor(rows.find(x=>String(x.id)===String(b.dataset.id)),batch.batch_id)));
  }
  function openImportRowEditor(row,batchId){const n=row.normalized_data||{};const isVape=String(n.category||'').toLowerCase()==='vapers';openModal(`<div class="section-title"><div><h3>Revisar fila #${row.row_number}</h3></div><button class="modal-close">×</button></div><div class="form-grid"><label>Producto base<input id="irBase" value="${esc(n.base_name||n.name||'')}"></label><label>Categoría<input id="irCategory" value="${esc(n.category==='SIN CLASIFICAR'?'':n.category||'')}"></label><label>${isVape?'Sabor':'Variante / talle'}<input id="irVariant" value="${esc(isVape?n.flavor||'':n.size||'')}"></label><label>Stock<input id="irStock" type="number" value="${Number(n.stock||0)}"></label><label>Costo<input id="irCost" type="number" value="${Number(n.cost_ars||0)}"></label><label>Precio<input id="irPrice" type="number" value="${Number(n.price_ars||0)}"></label></div><div class="modal-actions"><button class="btn ghost modal-close">Cancelar</button><button id="saveImportRow" class="btn primary">Guardar</button></div>`);$('#saveImportRow').addEventListener('click',async()=>{const base=$('#irBase').value.trim(),category=$('#irCategory').value.trim()||'SIN CLASIFICAR',variant=$('#irVariant').value.trim();if(!base)return alert('Falta nombre');const updated={...n,base_name:base,category,stock:Number($('#irStock').value||0),cost_ars:Number($('#irCost').value||0),price_ars:Number($('#irPrice').value||0),issues:[]};if(category.toLowerCase()==='vapers'){updated.flavor=variant||null;updated.size=null;updated.name=variant?`${base} - ${variant}`:base}else{updated.size=variant?variant.toUpperCase():null;updated.flavor=null;updated.name=variant?`${base} - ${variant.toUpperCase()}`:base}try{await DB.saveImportProduct(row.id,batchId,updated);closeModal();await renderImports()}catch(e){alert(e.message)}})}

  function openModal(inner){closeModal();const el=document.createElement('div');el.id='modalLayer';el.className='modal-layer';el.innerHTML=`<div class="modal-card">${inner}</div>`;document.body.appendChild(el);el.addEventListener('click',e=>{if(e.target===el||e.target.closest('.modal-close'))closeModal()})}
  function closeModal(){document.querySelector('#modalLayer')?.remove()}

  start();
})();
