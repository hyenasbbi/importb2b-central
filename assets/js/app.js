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
  let webOrderStatusFilter='pending';
  let operationsTab='purchases';
  let financeSearch='';
  let financeKind='all';
  let financeMethod='all';
  let financeTab='summary';

  const money=n=>new Intl.NumberFormat('es-AR',{style:'currency',currency:'ARS',maximumFractionDigits:0}).format(Number(n||0));
  const number=n=>new Intl.NumberFormat('es-AR',{maximumFractionDigits:2}).format(Number(n||0));
  const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
  const metric=(label,value,sub='')=>`<div class="card metric"><small>${esc(label)}</small><b>${value}</b>${sub?`<small>${esc(sub)}</small>`:''}</div>`;
  const issueLabel=i=>({SIN_NOMBRE:'Sin nombre',SIN_CATEGORIA:'Sin categoría',STOCK_NEGATIVO:'Stock negativo',POSIBLE_DUPLICADO:'Posible duplicado',FUSIONADO:'Fusionado'}[i]||i);
  const statusPill=s=>({ready:'<span class="pill green">Listo</span>',needs_review:'<span class="pill yellow">Revisar</span>',imported:'<span class="pill blue">Importado</span>',skipped:'<span class="pill">Omitido</span>',error:'<span class="pill red">Error</span>',completed:'<span class="pill green">Completada</span>',confirmed:'<span class="pill green">Confirmado</span>',pending:'<span class="pill yellow">Pendiente</span>',cancelled:'<span class="pill red">Anulada</span>'}[s]||`<span class="pill">${esc(s)}</span>`);
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
    const titles={dashboard:'Inicio',sell:'Vender',products:'Productos / Stock',orders:'Operaciones',customers:'Clientes',finance:'Finanzas',catalog:'Catálogo / Web',imports:'Importar Kyte'};
    $('#viewTitle').textContent=titles[currentView]||'IMPORTB2B'; content.innerHTML='<div class="empty">Cargando…</div>';
    try{
      if(currentView==='dashboard') await renderDashboard();
      else if(currentView==='sell') await renderSell();
      else if(currentView==='products') await renderProducts($('#globalSearch').value);
      else if(currentView==='orders') await renderOrders();
      else if(currentView==='customers') await renderCustomers($('#globalSearch').value);
      else if(currentView==='finance') await renderFinance();
      else if(currentView==='catalog') await renderCatalogAdmin();
      else if(currentView==='imports') await renderImports();
    }catch(e){console.error(e);content.innerHTML=`<div class="notice danger">Error: ${esc(e.message)}</div>`}
  }

  async function renderDashboard(){
    const d=await DB.dashboard(),v=d.valuation||{};
    const maxHour=Math.max(1,...d.hours.map(x=>x.total));
    const diff=d.yesterdaySales?((d.todaySales-d.yesterdaySales)/d.yesterdaySales*100):(d.todaySales>0?100:0);
    const diffClass=diff>=0?'positive':'negative';
    const diffText=d.yesterdaySales?`${diff>=0?'+':''}${number(diff)}% vs ayer`:(d.todaySales>0?'Primera venta del día':'Sin ventas registradas hoy');
    content.innerHTML=`
      <section class="dashboard-hero card">
        <div class="dashboard-hero-head">
          <div><span class="eyebrow">VENTAS DE HOY</span><h3>${money(d.todaySales)}</h3><p>${number(d.todayCount)} operaciones · Ticket promedio <b>${money(d.todayTicket)}</b></p></div>
          <div class="dashboard-diff ${diffClass}">${esc(diffText)}</div>
        </div>
        <div class="sales-hour-chart" aria-label="Ventas por hora">${d.hours.map(x=>`<div class="hour-col"><span class="hour-bar" style="height:${Math.max(4,Math.round(x.total/maxHour*100))}%" title="${money(x.total)}"></span><small>${String(x.hour).padStart(2,'0')}</small></div>`).join('')}</div>
        <div class="month-inside-hero">
          <div><small>Mes actual</small><b>${money(d.monthSales)}</b></div>
          <div><small>Operaciones</small><b>${number(d.monthCount)}</b></div>
          <div><small>Promedio diario</small><b>${money(d.monthDailyAvg)}</b></div>
          <button id="dashSell" class="btn primary">+ Registrar venta</button>
        </div>
      </section>

      <section class="dashboard-alerts">
        <button class="dash-alert" data-go="orders"><span>Pedidos del catálogo</span><b>${number(d.webPending)}</b><small>${d.webPending?'Requieren atención':'Sin pendientes'}</small></button>
        <button class="dash-alert" data-go="finance" data-finance="settlements"><span>Dinero a liquidar</span><b>${money(d.settlements)}</b><small>${number(d.settlementCount)} operaciones</small></button>
        <button class="dash-alert" data-go="finance" data-finance="receivables"><span>Dinero a cobrar</span><b>${money(d.receivable)}</b><small>${number(d.receivableCount)} cuentas</small></button>
        <button class="dash-alert" data-go="products"><span>Stock crítico</span><b>${number(d.lowStock)}</b><small>Variantes en mínimo</small></button>
      </section>

      <section class="dashboard-mini-stats">
        <div class="mini-stat"><small>Unidades disponibles</small><b>${number(d.stock)}</b><span>${d.transit?`${number(d.transit)} en tránsito`:'Stock actual'}</span></div>
        <div class="mini-stat"><small>Productos activos</small><b>${number(d.products)}</b><span>Base central</span></div>
        <div class="mini-stat"><small>Valor de venta del stock</small><b>${money(v.stock_sale_value_ars)}</b><span>Costo ${money(v.stock_cost_ars)}</span></div>
        <div class="mini-stat profit"><small>Ganancia esperada</small><b>${money(v.expected_profit_ars)}</b><span>Sobre stock disponible</span></div>
      </section>

      <section class="dashboard-bottom-grid">
        <div class="card recent-activity"><div class="section-title"><div><span class="eyebrow">ACTIVIDAD</span><h3>Últimos movimientos</h3></div></div>
          <div class="activity-list">${d.recent.map(x=>`<div class="activity-row"><span class="activity-dot ${x.type}"></span><div><b>${esc(x.title)}</b><small>${safeDate(x.date)}</small></div><strong class="${x.amount<0?'negative':''}">${x.amount<0?'−':''}${money(Math.abs(x.amount||0))}</strong></div>`).join('')||'<div class="empty">Todavía no hay actividad reciente.</div>'}</div>
        </div>
        <div class="card finance-compact"><div class="section-title"><div><span class="eyebrow">FINANZAS</span><h3>Resumen operativo</h3></div><button id="dashFinance" class="btn ghost tiny">Abrir Finanzas</button></div>
          <div class="finance-compact-grid"><div><small>Ingresos</small><b>${money(d.income)}</b></div><div><small>Egresos</small><b>${money(d.expense)}</b></div><div class="${d.operationalNet>=0?'profit':'negative'}"><small>Resultado</small><b>${money(d.operationalNet)}</b></div></div>
          <p class="muted small-text">No incluye transferencias internas ni conversiones como resultado comercial.</p>
        </div>
      </section>`;
    $('#dashSell')?.addEventListener('click',()=>setView('sell'));
    $('#dashFinance')?.addEventListener('click',()=>setView('finance'));
    document.querySelectorAll('.dash-alert').forEach(b=>b.addEventListener('click',()=>{if(b.dataset.finance)financeTab=b.dataset.finance;setView(b.dataset.go)}));
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
      <section class="pos-catalog card pos-catalog-full">
        <div class="section-title"><div><span class="eyebrow">VENTA RÁPIDA</span><h3>Productos</h3></div><span class="pill blue">${products.reduce((a,p)=>a+p.variants.filter(v=>Number(v.stock.available)>0).length,0)} variantes disponibles</span></div>
        <div class="toolbar"><input id="posSearch" value="${esc(posSearch)}" placeholder="Buscar producto, SKU, modelo, color, talle o sabor…"><select id="posCategory"><option value="">Todas las categorías</option>${cats.map(c=>`<option value="${esc(c)}" ${c===posCategory?'selected':''}>${esc(c)}</option>`).join('')}</select></div>
        <div id="posCatalogGrid" class="pos-product-grid pos-product-grid-wide"></div>
      </section>

      <button id="cartToggle" class="cart-launcher" type="button" aria-label="Abrir carrito">
        <span class="cart-launcher-count" id="cartLauncherCount">0</span>
        <span class="cart-launcher-copy"><small>CARRITO</small><b id="cartLauncherLabel">Venta vacía</b></span>
        <strong id="cartLauncherTotal">${money(0)}</strong>
      </button>
      <div id="cartBackdrop" class="cart-backdrop"></div>
      <aside id="posCartDrawer" class="cart-drawer" aria-hidden="true">
        <div class="cart-drawer-head">
          <div><span class="eyebrow">CARRITO</span><h3>Venta actual</h3></div>
          <div class="cart-drawer-head-actions"><span id="cartCount" class="pill">0</span><button id="cartClose" class="drawer-close" type="button">×</button></div>
        </div>
        <div class="cart-drawer-body">
          <div class="pos-customer-row"><label>Cliente<select id="posCustomer"><option value="">Venta sin cliente</option>${customers.map(c=>`<option value="${c.id}" ${c.id===currentCustomer?'selected':''}>${esc(c.full_name)}${c.phone?` · ${esc(c.phone)}`:''}</option>`).join('')}</select></label><button id="quickCustomer" class="btn ghost tiny">+ Cliente</button></div>
          <div id="cartItems" class="cart-items"></div>
          <div class="pos-fields"><label>Envío<input id="posShipping" type="number" min="0" step="100" value="${esc(currentShipping)}"></label><label>Descuento<input id="posDiscount" type="number" min="0" step="100" value="${esc(currentDiscount)}"></label></div>
          <label>Forma de pago<select id="posPayment">${methods.map(m=>`<option value="${m.id}" ${m.id===currentMethod?'selected':''}>${esc(m.name)}${Number(m.adjustment_value)?` · ${m.adjustment_direction==='discount'?'-':'+'}${number(m.adjustment_value)}${m.adjustment_kind==='percent'?'%':''}`:''}</option>`).join('')}</select></label>
          <div id="paymentHint" class="payment-hint"></div>
          <label>Nota<textarea id="posNotes" rows="2" placeholder="Opcional">${esc(currentNotes)}</textarea></label>
          <div id="cartTotals"></div>
        </div>
        <div class="cart-drawer-footer"><button id="finishSale" class="btn primary full">Finalizar venta</button></div>
      </aside>

      <section class="card" style="margin-top:14px"><div class="section-title"><div><span class="eyebrow">HISTORIAL</span><h3>Últimas ventas</h3></div></div><div id="recentSales"></div></section>`;
    renderPosCatalog(); renderCart(); renderRecentSales();
    $('#posSearch').addEventListener('input',e=>{posSearch=e.target.value;$('#globalSearch').value=posSearch;renderPosCatalog()});
    $('#posCategory').addEventListener('change',e=>{posCategory=e.target.value;renderPosCatalog()});
    ['#posShipping','#posDiscount','#posPayment'].forEach(sel=>$(sel).addEventListener('input',renderCartTotals));
    $('#quickCustomer').addEventListener('click',()=>openCustomerEditor(null,true));
    $('#finishSale').addEventListener('click',finishSale);
    $('#cartToggle').addEventListener('click',openCartDrawer);
    $('#cartClose').addEventListener('click',closeCartDrawer);
    $('#cartBackdrop').addEventListener('click',closeCartDrawer);
  }
  function openCartDrawer(){
    $('#posCartDrawer')?.classList.add('open'); $('#cartBackdrop')?.classList.add('open'); $('#posCartDrawer')?.setAttribute('aria-hidden','false'); document.body.classList.add('cart-open');
  }
  function closeCartDrawer(){
    $('#posCartDrawer')?.classList.remove('open'); $('#cartBackdrop')?.classList.remove('open'); $('#posCartDrawer')?.setAttribute('aria-hidden','true'); document.body.classList.remove('cart-open');
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
    const launcher=$('#cartToggle'); if(launcher){launcher.classList.remove('pulse');void launcher.offsetWidth;launcher.classList.add('pulse');setTimeout(()=>launcher.classList.remove('pulse'),420)}
  }
  function renderCart(){
    const el=$('#cartItems'); if(!el)return;
    const itemCount=saleCart.reduce((a,x)=>a+x.qty,0);
    if($('#cartCount')) $('#cartCount').textContent=itemCount;
    if($('#cartLauncherCount')) $('#cartLauncherCount').textContent=itemCount;
    if($('#cartLauncherLabel')) $('#cartLauncherLabel').textContent=itemCount?`${itemCount} ${itemCount===1?'unidad':'unidades'}`:'Venta vacía';
    el.innerHTML=saleCart.length?saleCart.map(x=>`<div class="cart-line" data-cart="${x.variantId}"><div class="cart-line-top"><div class="cart-line-info"><b>${esc(x.name)}</b><small>${esc(x.variant||'Única')} · ${esc(x.sku||'')}</small></div><button class="cart-remove" type="button">×</button></div><div class="cart-line-bottom"><div class="cart-controls"><button class="cart-minus" type="button">−</button><input class="cart-qty" type="number" min="1" max="${x.available}" value="${x.qty}"><button class="cart-plus" type="button">+</button></div><div class="cart-price"><label>Precio unitario<input class="cart-unit-price" type="number" min="0" step="100" value="${x.price}"></label><b>${money(x.price*x.qty)}</b></div></div></div>`).join(''):'<div class="empty compact-empty">Agregá productos y abrí el carrito cuando quieras finalizar.</div>';
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
    if($('#cartLauncherTotal')) $('#cartLauncherTotal').textContent=money(t.total);
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
  async function openSaleDetail(id){
    try{
      const s=await DB.saleDetail(id);
      openModal(`<div class="section-title"><div><span class="eyebrow">VENTA</span><h3>${esc(s.sale_code||'Detalle')}</h3><small class="muted">${safeDate(s.sold_at||s.created_at)} · ${esc(s.original_payment_method||'')}</small></div><button class="modal-close modal-x">×</button></div><div class="receipt-lines">${(s.items||[]).map(i=>`<div><span>${number(i.quantity)}× ${esc(i.original_item_name)}</span><b>${money(i.line_total_ars)}</b></div>`).join('')||'<div class="empty">Sin productos.</div>'}</div><div class="order-total-lines"><div><span>Subtotal</span><b>${money(s.subtotal_ars)}</b></div><div><span>Descuento</span><b>-${money(s.discount_ars)}</b></div><div><span>Envío</span><b>${money(s.shipping_ars)}</b></div>${Number(s.fee_ars)?`<div><span>Ajuste de pago</span><b>${money(s.fee_ars)}</b></div>`:''}<div class="grand"><span>Total</span><b>${money(s.total_ars)}</b></div></div>${s.notes?`<div class="notice" style="margin-top:12px">${esc(s.notes)}</div>`:''}<div class="modal-actions"><button class="btn ghost modal-close">Cerrar</button>${s.status==='completed'?`<button id="cancelSaleFromDetail" class="btn danger-btn">Anular venta</button>`:''}</div>`);
      $('#cancelSaleFromDetail')?.addEventListener('click',async()=>{const reason=prompt(`Motivo para anular ${s.sale_code}:`,'Error / devolución');if(reason===null)return;if(!confirm('Esto devolverá el stock y revertirá el efecto financiero. ¿Continuar?'))return;try{await DB.cancelSale(s.id,reason);closeModal();if(currentView==='finance')await renderFinance();else await renderSell()}catch(e){alert(e.message)}});
    }catch(e){alert(e.message)}
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
    const [p,cats]=await Promise.all([DB.productDetail(productId),DB.categories()]);
    const vape=String(p.category||'').toLowerCase()==='vapers';
    const totalAvailable=p.variants.reduce((a,v)=>a+Number(v.stock.available||0),0);
    const imageCards=(p.images||[]).map(img=>`<div class="product-image-card ${img.is_primary?'primary':''}"><img src="${esc(img.image_url)}" alt="${esc(img.alt_text||p.name)}"><div class="product-image-actions">${img.is_primary?'<span class="pill green">Principal</span>':`<button class="btn tiny ghost set-primary-image" data-img="${img.id}">Principal</button>`}<button class="btn tiny danger-btn delete-product-image" data-img="${img.id}">Eliminar</button></div></div>`).join('');
    const rows=p.variants.map(v=>`<tr data-variant="${v.id}"><td><input class="v-name" value="${esc(v.variant_name)}"></td><td><input class="v-sku" value="${esc(v.sku||'')}"></td><td><input class="v-cost" type="number" step="0.01" value="${Number(v.cost_ars||0)}"></td><td><input class="v-price" type="number" step="0.01" value="${Number(v.price_ars||0)}"></td><td><input class="v-min" type="number" step="1" value="${Number(v.stock_min||0)}"></td><td><b>${number(v.stock.on_hand)}</b><br><small class="muted">disp. ${number(v.stock.available)}</small></td><td><button class="btn tiny ghost adjust-stock" data-vid="${v.id}" data-current="${Number(v.stock.on_hand||0)}">Ajustar</button></td></tr>`).join('');
    openModal(`<div class="section-title"><div><span class="eyebrow">PRODUCTO</span><h3>Editar producto</h3><small class="muted">${number(totalAvailable)} unidades disponibles</small></div><button class="modal-close modal-x">×</button></div><div class="form-grid"><label>Nombre<input id="epName" value="${esc(p.name)}"></label><label>Categoría<select id="epCategory">${cats.map(c=>`<option value="${esc(c)}" ${c===p.category?'selected':''}>${esc(c)}</option>`).join('')}</select></label><label>SKU general<input id="epSku" value="${esc(p.sku||'')}"></label><label class="check"><input id="epCatalog" type="checkbox" ${p.catalog_visible?'checked':''}> Visible en catálogo</label></div><div class="section-title product-variant-title" style="margin-top:18px"><div><h3>${vape?'Sabores':'Variantes'}</h3><small class="muted">${vape?'Cada sabor comparte el mismo modelo de Vaper.':'Color, talle, modelo o número deben vivir como variantes del mismo producto.'}</small></div><div class="product-editor-actions"><button id="mergeProduct" class="btn ghost">Unificar otro producto</button><button id="addVariant" class="btn ghost">+ ${vape?'Sabor':'Variante'}</button></div></div><div class="table-wrap"><table class="table compact"><thead><tr><th>${vape?'Sabor':'Variante'}</th><th>SKU</th><th>Costo</th><th>Precio</th><th>Mín.</th><th>Stock físico</th><th></th></tr></thead><tbody>${rows||'<tr><td colspan="7" class="empty">Sin variantes.</td></tr>'}</tbody></table></div><div class="product-images-section"><div class="section-title"><div><h3>Fotos del catálogo</h3><small class="muted">Se usan automáticamente en el catálogo público.</small></div><label class="btn ghost upload-image-label">+ Subir fotos<input id="productImageUpload" type="file" accept="image/jpeg,image/png,image/webp,image/avif" multiple hidden></label></div><div class="product-image-grid">${imageCards||'<div class="empty">Todavía no hay fotos cargadas.</div>'}</div></div><div class="modal-actions product-modal-actions"><button id="deleteProduct" class="btn danger-btn">Eliminar producto</button><div class="modal-action-main"><button class="btn ghost modal-close">Cancelar</button><button id="saveProduct" class="btn primary">Guardar cambios</button></div></div>`);

    $('#saveProduct').addEventListener('click',async()=>{const btn=$('#saveProduct');btn.disabled=true;try{const cat=$('#epCategory').value;await DB.saveProduct(productId,{name:$('#epName').value.trim(),category:cat,sku:$('#epSku').value.trim()||null,catalog_visible:$('#epCatalog').checked});for(const tr of document.querySelectorAll('[data-variant]')){const variant=tr.querySelector('.v-name').value.trim()||'Única';const payload={variant_name:variant,sku:tr.querySelector('.v-sku').value.trim()||null,cost_ars:Number(tr.querySelector('.v-cost').value||0),price_ars:Number(tr.querySelector('.v-price').value||0),stock_min:Number(tr.querySelector('.v-min').value||0)};if(cat.toLowerCase()==='vapers')payload.attributes={sabor:variant};await DB.saveVariant(tr.dataset.variant,payload)}closeModal();await renderProducts($('#globalSearch').value)}catch(e){alert(e.message)}finally{btn.disabled=false}});
    document.querySelectorAll('.adjust-stock').forEach(b=>b.addEventListener('click',async()=>{const current=Number(b.dataset.current),val=prompt(`Stock físico actual: ${current}
Nueva cantidad física:`,String(current));if(val===null)return;const next=Number(val);if(!Number.isFinite(next)||next<0)return alert('Cantidad inválida');const note=prompt('Motivo:','Conteo físico / corrección manual')||'Ajuste manual';try{await DB.adjustStock(productId,b.dataset.vid,current,next,note);closeModal();await openProductEditor(productId)}catch(e){alert(e.message)}}));
    $('#addVariant').addEventListener('click',async()=>{const name=prompt(vape?'Nombre del sabor:':'Nombre de variante (color, talle, número, modelo):','');if(!name)return;const price=Number(prompt('Precio venta ARS:','0')||0),cost=Number(prompt('Costo ARS:','0')||0),initial=Number(prompt('Stock inicial:','0')||0);if([price,cost,initial].some(x=>!Number.isFinite(x))||initial<0)return alert('Valores inválidos');try{await DB.createVariant(productId,{variant_name:name.trim(),cost_ars:cost,price_ars:price,stock_min:0,active:true,attributes:vape?{sabor:name.trim()}:{opcion:name.trim()}},initial,'Alta manual de variante');closeModal();await openProductEditor(productId)}catch(e){alert(e.message)}});
    $('#productImageUpload')?.addEventListener('change',async e=>{const files=[...(e.target.files||[])];if(!files.length)return;const hadPrimary=(p.images||[]).some(x=>x.is_primary);try{for(let i=0;i<files.length;i++)await DB.uploadProductImage(productId,files[i],!hadPrimary&&i===0);closeModal();await openProductEditor(productId)}catch(err){alert(err.message)}});
    document.querySelectorAll('.set-primary-image').forEach(b=>b.addEventListener('click',async()=>{try{await DB.setPrimaryImage(productId,b.dataset.img);closeModal();await openProductEditor(productId)}catch(e){alert(e.message)}}));
    document.querySelectorAll('.delete-product-image').forEach(b=>b.addEventListener('click',async()=>{const img=(p.images||[]).find(x=>String(x.id)===String(b.dataset.img));if(!img||!confirm('¿Eliminar esta foto?'))return;try{await DB.deleteProductImage(productId,img);closeModal();await openProductEditor(productId)}catch(e){alert(e.message)}}));
    $('#mergeProduct').addEventListener('click',()=>openMergeProduct(productId,p));
    $('#deleteProduct').addEventListener('click',async()=>{
      const stock=totalAvailable>0?`

ATENCIÓN: hoy tiene ${number(totalAvailable)} unidades disponibles. Al eliminarlo dejarán de aparecer como stock vendible.`:'';
      if(!confirm(`¿Eliminar ${p.name}?${stock}

No se borra el historial: el producto queda archivado y sale del catálogo/stock operativo.`))return;
      const reason=prompt('Motivo (opcional):','Producto discontinuado / duplicado')||'';
      try{await DB.archiveProduct(productId,reason);closeModal();await renderProducts($('#globalSearch').value)}catch(e){alert(e.message)}
    });
  }

  function guessVariantLabel(targetName,sourceName){
    const t=String(targetName||'').trim(),s=String(sourceName||'').trim();
    if(s.toLowerCase().startsWith((t+' - ').toLowerCase())) return s.slice(t.length+3).trim();
    const m=s.match(/ - ([^-]+)$/); if(m)return m[1].trim();
    if(s.toLowerCase().startsWith((t+' ').toLowerCase())) return s.slice(t.length).trim();
    return '';
  }
  async function openMergeProduct(targetId,target){
    const products=(await DB.products('',target.category||'','all')).filter(x=>x.id!==targetId);
    openModal(`<div class="section-title"><div><span class="eyebrow">UNIFICAR</span><h3>Convertir productos duplicados en variantes</h3><small class="muted">Destino: ${esc(target.name)}</small></div><button class="modal-close modal-x">×</button></div><div class="notice good-notice">Elegí otro producto de la misma categoría. Sus variantes, stock e historial pasarán a <b>${esc(target.name)}</b> y el registro duplicado quedará archivado.</div><div class="toolbar" style="margin-top:14px"><input id="mergeSearch" placeholder="Buscar producto a unificar…"></div><div id="mergeResults" class="merge-results"></div><div class="modal-actions"><button class="btn ghost modal-close">Volver</button></div>`);
    const renderMerge=()=>{
      const q=$('#mergeSearch').value.trim().toLowerCase();
      const rows=products.filter(x=>!q||[x.name,x.sku,x.category,...x.variants.flatMap(v=>[v.variant_name,v.sku])].join(' ').toLowerCase().includes(q)).slice(0,80);
      $('#mergeResults').innerHTML=rows.map(x=>{const av=x.variants.reduce((a,v)=>a+Number(v.stock.available||0),0);return`<button class="merge-candidate" data-id="${x.id}"><span><b>${esc(x.name)}</b><small>${x.variants.length} variante${x.variants.length===1?'':'s'} · stock ${number(av)}</small></span><strong>Unificar →</strong></button>`}).join('')||'<div class="empty">No hay coincidencias.</div>';
      document.querySelectorAll('.merge-candidate').forEach(b=>b.addEventListener('click',async()=>{
        const source=products.find(x=>x.id===b.dataset.id);if(!source)return;
        let label='';
        if(source.variants.length===1){label=guessVariantLabel(target.name,source.name)||source.variants[0].variant_name||'';const entered=prompt(`¿Cómo querés llamar a esta variante dentro de ${target.name}?`,label);if(entered===null)return;label=entered.trim()||label;}
        if(!confirm(`Unificar “${source.name}” dentro de “${target.name}”?

El stock y el historial se conservan.`))return;
        try{await DB.mergeProduct(targetId,source.id,label);closeModal();await openProductEditor(targetId)}catch(e){alert(e.message)}
      }));
    };
    $('#mergeSearch').addEventListener('input',renderMerge);renderMerge();
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
    const [rows,webAll]=await Promise.all([DB.recentOrders(),DB.webOrders('all')]);
    const webFiltered=webOrderStatusFilter==='all'?webAll:webAll.filter(x=>x.status===webOrderStatusFilter);
    const webPending=webAll.filter(x=>x.status==='pending').length;
    const purchaseHistorical=rows.filter(o=>o.items.length&&o.items.every(i=>i.stock_link_status==='historical')).length;
    const purchaseActive=rows.length-purchaseHistorical;

    content.innerHTML=`
      <div class="operations-head card">
        <div class="section-title"><div><span class="eyebrow">OPERACIONES</span><h3>Compras y pedidos del catálogo</h3><p class="muted">Los registros históricos ya están incluidos en el stock migrado: se muestran como referencia y no requieren activación.</p></div></div>
        <div class="operation-stats"><span class="pill blue">${purchaseActive} compras activas</span><span class="pill">${purchaseHistorical} históricas</span><span class="pill yellow">${webPending} web pendientes</span></div>
        <div class="operation-tabs"><button class="${operationsTab==='purchases'?'active':''}" data-operation-tab="purchases">Compras / Mercadería</button><button class="${operationsTab==='web'?'active':''}" data-operation-tab="web">Pedidos del catálogo ${webPending?`<b>${webPending}</b>`:''}</button></div>
      </div>
      <div id="operationsBody" style="margin-top:14px">${operationsTab==='purchases'?renderPurchaseAccordions(rows):renderWebOrderAccordions(webFiltered)}</div>`;

    document.querySelectorAll('[data-operation-tab]').forEach(b=>b.addEventListener('click',()=>{operationsTab=b.dataset.operationTab;renderOrders()}));
    bindOperationAccordions();
    document.querySelectorAll('.edit-allocation').forEach(b=>b.addEventListener('click',()=>openOrderAllocation(b.dataset.id,rows)));
    document.querySelectorAll('.receive-allocation').forEach(b=>b.addEventListener('click',async()=>{const remaining=Number(b.dataset.remaining);const q=prompt(`Quedan ${remaining} unidades por recibir. ¿Cuántas llegaron?`,String(remaining));if(q===null)return;const n=Number(q);if(!Number.isFinite(n)||n<=0||n>remaining)return alert('Cantidad inválida');const note=prompt('Nota de recepción:','Recepción de mercadería')||'';try{await DB.receiveOrderAllocation(b.dataset.id,n,note);await renderOrders()}catch(e){alert(e.message)}}));
    document.querySelectorAll('.open-web-order').forEach(b=>b.addEventListener('click',()=>openWebOrder(b.dataset.id)));
    $('#webOpsStatus')?.addEventListener('change',e=>{webOrderStatusFilter=e.target.value;renderOrders()});
  }
  function bindOperationAccordions(){
    document.querySelectorAll('.operation-accordion').forEach(d=>d.addEventListener('toggle',()=>{if(!d.open)return;document.querySelectorAll('.operation-accordion[open]').forEach(other=>{if(other!==d)other.open=false})}));
  }
  function renderPurchaseAccordions(rows){
    if(!rows.length)return'<div class="card empty">Sin compras registradas.</div>';
    return `<div class="order-stack">${rows.map(o=>{
      const historical=o.items.length&&o.items.every(i=>i.stock_link_status==='historical');
      const totalQty=o.items.reduce((a,i)=>a+Number(i.quantity||0),0);
      const received=o.items.reduce((a,i)=>a+Number(i.received_quantity||0),0);
      const shipText=o.shipment?.latest_checkpoint_description||o.shipment?.normalized_status||o.shipment?.carrier_name||'';
      const status=historical?'<span class="pill yellow">Histórico · stock incluido</span>':o.shipment?.is_received?'<span class="pill green">Entregado</span>':shipText?`<span class="pill blue">${esc(shipText)}</span>`:'<span class="pill">En gestión</span>';
      return `<details class="card order-card operation-accordion"><summary class="operation-summary"><div class="operation-summary-main"><span class="eyebrow">COMPRA #${esc(o.order_number??o.id)}</span><h3>${esc(o.order_date||'Sin fecha')}</h3><small>${number(o.total_units||totalQty)} unidades · USD ${number(o.investment_usd)}</small></div><div class="operation-summary-side">${status}<span class="accordion-chevron">⌄</span></div></summary><div class="operation-body">${historical?`<div class="notice good-notice historical-note">Esta compra es histórica y sus unidades ya forman parte del stock actual. Se conserva para trazabilidad.</div>`:`<div class="operation-progress"><span>Recibido ${number(received)} / ${number(totalQty)}</span><div><i style="width:${totalQty?Math.min(100,received/totalQty*100):0}%"></i></div></div>`}${o.items.map(i=>renderOrderItem(i)).join('')}</div></details>`
    }).join('')}</div>`;
  }
  function renderWebOrderAccordions(rows){
    const filter=`<div class="toolbar operations-filter"><select id="webOpsStatus"><option value="pending" ${webOrderStatusFilter==='pending'?'selected':''}>Pendientes</option><option value="confirmed" ${webOrderStatusFilter==='confirmed'?'selected':''}>Confirmados</option><option value="cancelled" ${webOrderStatusFilter==='cancelled'?'selected':''}>Cancelados</option><option value="all" ${webOrderStatusFilter==='all'?'selected':''}>Todos</option></select></div>`;
    if(!rows.length)return `${filter}<div class="card empty">No hay pedidos del catálogo en este estado.</div>`;
    return `${filter}<div class="order-stack">${rows.map(o=>`<details class="card order-card operation-accordion web-operation"><summary class="operation-summary"><div class="operation-summary-main"><span class="eyebrow">${esc(o.order_code)}</span><h3>${esc(o.customer_name)}</h3><small>${safeDate(o.created_at)} · ${esc(o.customer_phone||'')}</small></div><div class="operation-summary-side"><strong>${money(o.total_ars)}</strong>${statusPill(o.status)}<span class="accordion-chevron">⌄</span></div></summary><div class="operation-body web-operation-body"><div class="operation-kv"><div><small>Entrega</small><b>${o.delivery_type==='shipping'?'Envío':'Retiro'}</b></div><div><small>Total</small><b>${money(o.total_ars)}</b></div><div><small>Estado</small>${statusPill(o.status)}</div>${o.delivery_address?`<div><small>Dirección</small><b>${esc(o.delivery_address)}</b></div>`:''}</div><div class="modal-actions"><button class="btn ${o.status==='pending'?'primary':'ghost'} open-web-order" data-id="${o.id}">${o.status==='pending'?'Gestionar pedido':'Ver detalle'}</button></div></div></details>`).join('')}</div>`;
  }
  function renderOrderItem(i){
    const hist=i.stock_link_status==='historical',alloc=i.allocations||[],rec=Number(i.received_quantity||0);
    return `<div class="order-item"><div class="order-item-main"><div><b>${esc(i.product)}</b><br><small class="muted">${esc(i.category||'')} · ${number(i.quantity)} un. · costo ${money(i.cost_ars)}</small></div><span class="pill ${hist?'yellow':rec>=Number(i.quantity)?'green':alloc.length?'blue':''}">${hist?'Histórico · incluido':rec>=Number(i.quantity)?'Recibido':alloc.length?'Vinculado':'Pendiente'}</span></div>${alloc.length?`<div class="allocation-list">${alloc.map(a=>{const rem=Number(a.ordered_quantity)-Number(a.received_quantity);return`<div class="allocation-row"><span><b>${esc(a.product?.name||'Producto')}</b> · ${esc(a.variant?.variant_name||'Única')}<br><small class="muted">${number(a.received_quantity)} / ${number(a.ordered_quantity)} recibidas</small></span>${rem>0?`<button class="btn tiny good receive-allocation" data-id="${a.id}" data-remaining="${rem}">Recibir ${number(rem)}</button>`:'<span class="pill green">Completo</span>'}</div>`}).join('')}</div>`:''}<div class="order-item-actions">${hist?`<small class="historical-inline">✓ Ya incluido en el stock actual</small>`:`<button class="btn tiny ghost edit-allocation" data-id="${i.id}">${alloc.length?'Editar distribución':'Vincular / distribuir'}</button>`}</div></div>`;
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
    const f=await DB.financeData(500);
    const pendingSett=f.settlements.filter(x=>x.status==='pending');
    const openRecv=f.receivables.filter(x=>!['paid','cancelled'].includes(x.status));
    const methods=[...new Set(f.movements.map(x=>x.payment_method).filter(Boolean))].sort();
    const tabs=[['summary','Resumen'],['movements','Movimientos'],['settlements','A liquidar'],['receivables','A cobrar'],['usdt','USDT / ARS'],['results','Resultados'],['audit','Auditoría']];
    const tabbar=`<div class="finance-tabs">${tabs.map(([id,label])=>`<button class="${financeTab===id?'active':''}" data-fin-tab="${id}">${label}${id==='settlements'&&pendingSett.length?` <b>${pendingSett.length}</b>`:''}${id==='receivables'&&openRecv.length?` <b>${openRecv.length}</b>`:''}</button>`).join('')}</div>`;
    let body='';
    if(financeTab==='summary'){
      const q=f.quote||{};const usdtVal=f.balances.usdt*Number(q.sell_ars||0);const available=f.balances.cash+f.balances.transfer+usdtVal;
      body=`<div class="finance-dashboard-grid"><section class="card finance-balance-card"><span class="eyebrow">SALDO DISPONIBLE ESTIMADO</span><h3>${money(available)}</h3><p class="muted">Transferencias + efectivo + USDT valorizado a cotización de venta.</p><div class="finance-balance-breakdown"><div><small>Transferencias</small><b>${money(f.balances.transfer)}</b></div><div><small>Efectivo</small><b>${money(f.balances.cash)}</b></div><div><small>USDT</small><b>${number(f.balances.usdt)} USDT</b></div></div></section><section class="card finance-quote-card"><span class="eyebrow">USDT / ARS</span><h3>Cotización</h3>${q.captured_at?`<div class="quote-pair"><div><small>Compra USDT</small><b>${money(q.buy_ars)}</b></div><div class="profit"><small>Venta USDT</small><b>${money(q.sell_ars)}</b></div></div><p class="muted small-text">${esc(q.source||'Cotización')} · ${safeDate(q.captured_at)}</p>`:'<div class="empty">Sin cotización disponible.</div>'}</section></div>
      <div class="finance-control-cards"><button data-fin-jump="settlements"><small>Pendiente de acreditación</small><b>${money(pendingSett.reduce((a,x)=>a+Number(x.net_amount||0),0))}</b><span>${pendingSett.length} operaciones</span></button><button data-fin-jump="receivables"><small>Total a cobrar</small><b>${money(openRecv.reduce((a,x)=>a+Number(x.pending_amount||0),0))}</b><span>${openRecv.length} cuentas</span></button><button data-fin-jump="results"><small>Resultado operativo</small><b class="${f.net>=0?'profit':'negative'}">${money(f.net)}</b><span>Ingresos − egresos reales</span></button></div>`;
    }else if(financeTab==='movements'){
      const q=financeSearch.trim().toLowerCase();
      const rows=f.movements.filter(x=>(financeKind==='all'||x.kind===financeKind)&&(financeMethod==='all'||x.payment_method===financeMethod)&&(!q||[x.description,x.category,x.payment_method,x.source_type,x.amount].join(' ').toLowerCase().includes(q)));
      body=`<section class="card"><div class="section-title"><div><span class="eyebrow">HISTORIAL</span><h3>Transacciones</h3></div></div><div class="toolbar"><input id="financeSearch" value="${esc(financeSearch)}" placeholder="Buscar detalle, categoría o monto…"><select id="financeKind"><option value="all">Ingresos y egresos</option><option value="income" ${financeKind==='income'?'selected':''}>Ingresos</option><option value="expense" ${financeKind==='expense'?'selected':''}>Egresos</option></select><select id="financeMethod"><option value="all">Todos los métodos</option>${methods.map(m=>`<option value="${esc(m)}" ${financeMethod===m?'selected':''}>${esc(m)}</option>`).join('')}</select></div><div class="finance-history-list">${rows.map(x=>{const manual=!x.source_type||x.source_type==='manual';return`<details class="finance-movement operation-accordion"><summary><span><b>${x.kind==='income'?'+':'−'} ${x.currency==='USDT'?`${number(x.amount)} USDT`:money(x.amount)}</b><small>${safeDate(x.occurred_at)} · ${esc(x.payment_method)}</small></span><span>${x.kind==='income'?'<span class="pill green">Ingreso</span>':'<span class="pill red">Egreso</span>'}<i>⌄</i></span></summary><div class="finance-movement-body"><div class="operation-kv"><div><small>Categoría</small><b>${esc(x.category||'—')}</b></div><div><small>Detalle</small><b>${esc(x.description||'—')}</b></div><div><small>Origen</small><b>${esc(x.source_type||'manual')}</b></div><div><small>Método</small><b>${esc(x.payment_method)}</b></div></div><div class="modal-actions"><button class="btn ghost tiny edit-finance" data-id="${x.id}">Editar</button>${manual?`<button class="btn danger-btn tiny delete-finance" data-id="${x.id}">Eliminar</button>`:`<button class="btn ghost tiny view-fin-origin" data-type="${esc(x.source_type||'')}" data-id="${esc(x.source_id||'')}">Ver origen</button>`}</div></div></details>`}).join('')||'<div class="empty">No hay transacciones.</div>'}</div></section>`;
    }else if(financeTab==='settlements'){
      body=`<section class="card"><div class="section-title"><div><span class="eyebrow">PENDIENTES</span><h3>Dinero a liquidar</h3><p class="muted">Go Cuotas y tarjetas: no se suman al saldo disponible hasta acreditarse.</p></div><strong>${money(pendingSett.reduce((a,x)=>a+Number(x.net_amount||0),0))}</strong></div><div class="finance-card-list">${pendingSett.map(x=>`<details class="finance-control-row operation-accordion"><summary><span><b>${esc(x.payment_name||x.provider?.replaceAll('_',' ')||'Liquidación')}</b><small>${x.sale_code?`Venta ${esc(x.sale_code)} · `:''}${esc(x.customer_name||x.description||'Sin origen vinculado')}</small></span><span><strong>${money(x.net_amount)}</strong>${x.overdue?'<span class="pill red">Vencida</span>':'<span class="pill yellow">Pendiente</span>'}<i>⌄</i></span></summary><div class="finance-control-body"><div class="operation-kv"><div><small>Bruto</small><b>${money(x.gross_amount)}</b></div><div><small>Comisiones</small><b>${money(x.fees_amount)}</b></div><div><small>Acreditación</small><b>${esc(x.expected_at||'—')}</b></div><div><small>Origen</small><b>${x.sale_code?`Venta ${esc(x.sale_code)}`:'Manual / histórico'}</b></div></div>${x.items_summary?`<div class="finance-origin-box"><small>Productos</small><b>${esc(x.items_summary)}</b></div>`:''}<div class="modal-actions">${x.sale_code?`<button class="btn ghost tiny open-sale-from-fin" data-id="${x.source_id}">Ver venta</button>`:`<button class="btn ghost tiny link-settlement" data-id="${x.id}">Vincular venta</button>`}${!x.source_type?`<button class="btn ghost tiny edit-settlement" data-id="${x.id}">Editar</button>`:''}<button class="btn primary tiny settle-item" data-id="${x.id}">Liquidar</button>${!x.source_type?`<button class="btn danger-btn tiny delete-settlement" data-id="${x.id}">Eliminar</button>`:''}</div></div></details>`).join('')||'<div class="empty">Sin liquidaciones pendientes.</div>'}</div></section>`;
    }else if(financeTab==='receivables'){
      body=`<section class="card"><div class="section-title"><div><span class="eyebrow">CLIENTES</span><h3>Dinero a cobrar</h3><p class="muted">Cada cobro registrado ingresa automáticamente a Caja.</p></div><strong>${money(openRecv.reduce((a,x)=>a+Number(x.pending_amount||0),0))}</strong></div><div class="finance-card-list">${openRecv.map(x=>`<details class="finance-control-row operation-accordion"><summary><span><b>${esc(x.customer_name||x.client_name)}</b><small>${x.sale_code?`Venta ${esc(x.sale_code)} · `:''}${esc(x.items_summary||x.description||'Sin descripción')}</small></span><span><strong>${money(x.pending_amount)}</strong>${x.status==='partial'?'<span class="pill blue">Pago parcial</span>':'<span class="pill yellow">Pendiente</span>'}<i>⌄</i></span></summary><div class="finance-control-body"><div class="operation-kv"><div><small>Total</small><b>${money(x.total_amount)}</b></div><div><small>Pagado</small><b>${money(x.paid_amount)}</b></div><div><small>Pendiente</small><b>${money(x.pending_amount)}</b></div><div><small>Vencimiento</small><b>${esc(x.due_at||'Sin fecha')}</b></div></div><div class="modal-actions">${x.sale_code?`<button class="btn ghost tiny open-sale-from-fin" data-id="${x.source_id}">Ver venta</button>`:`<button class="btn ghost tiny link-receivable" data-id="${x.id}">Vincular venta</button>`}${!x.source_type?`<button class="btn ghost tiny edit-receivable" data-id="${x.id}">Editar</button>`:''}<button class="btn primary tiny collect-receivable" data-id="${x.id}">Cobrar</button><button class="btn ghost tiny payments-receivable" data-id="${x.id}">Historial</button>${!x.source_type&&Number(x.payments_count||0)===0?`<button class="btn danger-btn tiny delete-receivable" data-id="${x.id}">Eliminar</button>`:''}</div></div></details>`).join('')||'<div class="empty">Sin cuentas pendientes.</div>'}</div></section>`;
    }else if(financeTab==='usdt'){
      const q=f.quote||{};body=`<div class="finance-dashboard-grid"><section class="card finance-balance-card"><span class="eyebrow">TENENCIA</span><h3>${number(f.balances.usdt)} USDT</h3><p class="muted">Saldo calculado desde los movimientos registrados.</p>${q.sell_ars?`<div class="finance-origin-box"><small>Valorización a venta</small><b>${money(f.balances.usdt*Number(q.sell_ars))}</b></div>`:''}</section><section class="card"><span class="eyebrow">COTIZACIÓN</span><h3>USDT / ARS</h3>${q.captured_at?`<div class="quote-pair"><div><small>Compra</small><b>${money(q.buy_ars)}</b></div><div class="profit"><small>Venta</small><b>${money(q.sell_ars)}</b></div></div><p class="muted">${safeDate(q.captured_at)}</p>`:'<div class="empty">Sin cotización.</div>'}</section></div><div class="notice" style="margin-top:14px">Las conversiones ARS ↔ USDT actualizan las tenencias, pero no se cuentan como ingreso o egreso operativo.</div>`;
    }else if(financeTab==='results'){
      body=`<div class="finance-control-cards three"><div><small>Ingresos operativos</small><b>${money(f.income)}</b><span>Sin conversiones ni transferencias internas</span></div><div><small>Egresos operativos</small><b>${money(f.expense)}</b><span>Gastos reales registrados</span></div><div><small>Resultado</small><b class="${f.net>=0?'profit':'negative'}">${money(f.net)}</b><span>Ingresos − egresos</span></div></div>`;
    }else{
      body=`<section class="card"><div class="section-title"><div><span class="eyebrow">CONTROL</span><h3>Auditoría financiera</h3></div></div><div class="audit-list">${f.audit.map(x=>`<div class="audit-row"><div><b>${esc(x.action)}</b><small>${esc(x.entity_type)} · ${safeDate(x.created_at)}</small></div><span class="pill">${String(x.entity_id||'').slice(0,8)}</span></div>`).join('')||'<div class="empty">Sin eventos de auditoría.</div>'}</div></section>`;
    }
    const actionbar=financeTab==='movements'?`<div class="finance-actionbar"><button id="newMovement" class="btn primary">+ Nuevo movimiento</button></div>`:financeTab==='settlements'?`<div class="finance-actionbar"><button id="newSettlement" class="btn primary">+ Nueva liquidación</button></div>`:financeTab==='receivables'?`<div class="finance-actionbar"><button id="newReceivable" class="btn primary">+ Nuevo deudor</button></div>`:'';
    content.innerHTML=`${tabbar}${actionbar}<div class="finance-tab-body">${body}</div>`;
    document.querySelectorAll('[data-fin-tab]').forEach(b=>b.addEventListener('click',()=>{financeTab=b.dataset.finTab;renderFinance()}));
    document.querySelectorAll('[data-fin-jump]').forEach(b=>b.addEventListener('click',()=>{financeTab=b.dataset.finJump;renderFinance()}));
    $('#newMovement')?.addEventListener('click',openNewFinanceMovement);
    $('#newSettlement')?.addEventListener('click',openNewSettlement);
    $('#newReceivable')?.addEventListener('click',openNewReceivable);
    $('#financeSearch')?.addEventListener('input',e=>{financeSearch=e.target.value;clearTimeout(timer);timer=setTimeout(renderFinance,130)});
    $('#financeKind')?.addEventListener('change',e=>{financeKind=e.target.value;renderFinance()});
    $('#financeMethod')?.addEventListener('change',e=>{financeMethod=e.target.value;renderFinance()});
    bindOperationAccordions();
    document.querySelectorAll('.edit-finance').forEach(b=>b.addEventListener('click',()=>openFinanceEditor(f.movements.find(x=>x.id===b.dataset.id))));
    document.querySelectorAll('.delete-finance').forEach(b=>b.addEventListener('click',async()=>{if(!confirm('¿Eliminar este movimiento manual? El saldo se recalculará.'))return;try{await DB.deleteManualMovement(b.dataset.id);await renderFinance()}catch(e){alert(e.message)}}));
    document.querySelectorAll('.settle-item').forEach(b=>b.addEventListener('click',()=>openSettlementLiquidation(b.dataset.id)));
    document.querySelectorAll('.delete-settlement').forEach(b=>b.addEventListener('click',async()=>{if(!confirm('¿Eliminar esta liquidación manual pendiente?'))return;try{await DB.deleteManualSettlement(b.dataset.id);await renderFinance()}catch(e){alert(e.message)}}));
    document.querySelectorAll('.edit-settlement').forEach(b=>b.addEventListener('click',()=>openEditSettlement(pendingSett.find(x=>x.id===b.dataset.id))));
    document.querySelectorAll('.collect-receivable').forEach(b=>b.addEventListener('click',()=>openReceivableCollection(openRecv.find(x=>x.id===b.dataset.id))));
    document.querySelectorAll('.payments-receivable').forEach(b=>b.addEventListener('click',()=>openReceivableHistory(openRecv.find(x=>x.id===b.dataset.id))));
    document.querySelectorAll('.delete-receivable').forEach(b=>b.addEventListener('click',async()=>{if(!confirm('¿Eliminar esta cuenta por cobrar sin pagos?'))return;try{await DB.deleteManualReceivable(b.dataset.id);await renderFinance()}catch(e){alert(e.message)}}));
    document.querySelectorAll('.edit-receivable').forEach(b=>b.addEventListener('click',()=>openEditReceivable(openRecv.find(x=>x.id===b.dataset.id))));
    document.querySelectorAll('.open-sale-from-fin').forEach(b=>b.addEventListener('click',()=>openSaleDetail(b.dataset.id)));
    document.querySelectorAll('.link-settlement').forEach(b=>b.addEventListener('click',()=>openFinanceSaleLink('settlement',b.dataset.id,f.sales)));
    document.querySelectorAll('.link-receivable').forEach(b=>b.addEventListener('click',()=>openFinanceSaleLink('receivable',b.dataset.id,f.sales)));
    document.querySelectorAll('.view-fin-origin').forEach(b=>b.addEventListener('click',()=>{if(b.dataset.type==='sale'&&b.dataset.id)openSaleDetail(b.dataset.id);else alert(`Origen: ${b.dataset.type||'automático'}`)}));
  }
  function openNewFinanceMovement(){
    openModal(`<div class="section-title"><div><span class="eyebrow">CAJA</span><h3>Nuevo movimiento</h3></div><button class="modal-close modal-x">×</button></div><div class="form-grid"><label>Tipo<select id="nmKind"><option value="income">Ingreso</option><option value="expense">Egreso</option></select></label><label>Monto<input id="nmAmount" type="number" min="0" step="0.01"></label><label>Moneda<select id="nmCurrency"><option value="ARS">ARS</option><option value="USDT">USDT</option></select></label><label>Método<select id="nmMethod"><option value="transferencia">Transferencia</option><option value="efectivo">Efectivo</option><option value="usdt">USDT</option></select></label><label>Titular<select id="nmHolder"><option value="nahuel">Nahuel</option><option value="esteban">Esteban</option></select></label><label>Categoría<input id="nmCategory" value="OTRO"></label><label id="nmQuoteWrap" class="hidden">Cotización ARS<input id="nmQuote" type="number" min="0" step="0.01"></label></div><label style="margin-top:12px">Detalle<textarea id="nmDescription" rows="3"></textarea></label><div class="modal-actions"><button class="btn ghost modal-close">Cancelar</button><button id="saveNewMovement" class="btn primary">Guardar movimiento</button></div>`);
    const sync=()=>{const usdt=$('#nmCurrency').value==='USDT';$('#nmQuoteWrap').classList.toggle('hidden',!usdt);if(usdt)$('#nmMethod').value='usdt'};$('#nmCurrency').addEventListener('change',sync);sync();
    $('#saveNewMovement').addEventListener('click',async()=>{try{await DB.createManualMovement({kind:$('#nmKind').value,amount:Number($('#nmAmount').value||0),currency:$('#nmCurrency').value,payment_method:$('#nmMethod').value,holder:$('#nmHolder').value,category:$('#nmCategory').value.trim()||'OTRO',description:$('#nmDescription').value.trim()||null,quote_ars:Number($('#nmQuote').value||0),quote_type:'buy'});closeModal();financeTab='movements';await renderFinance()}catch(e){alert(e.message)}});
  }
  function openNewSettlement(){
    openModal(`<div class="section-title"><div><span class="eyebrow">A LIQUIDAR</span><h3>Nueva liquidación manual</h3></div><button class="modal-close modal-x">×</button></div><div class="form-grid"><label>Proveedor<select id="nsProvider"><option value="go_cuotas">Go Cuotas</option><option value="tarjeta_credito">Tarjeta crédito</option><option value="otro">Otro</option></select></label><label>Bruto<input id="nsGross" type="number" min="1"></label><label>Comisiones<input id="nsFees" type="number" min="0" value="0"></label><label>Acreditación<input id="nsDate" type="date"></label></div><label style="margin-top:12px">Concepto<input id="nsDescription" placeholder="Ej. venta anterior / vaper / camiseta"></label><div class="modal-actions"><button class="btn ghost modal-close">Cancelar</button><button id="saveNewSettlement" class="btn primary">Guardar liquidación</button></div>`);
    $('#saveNewSettlement').addEventListener('click',async()=>{try{await DB.createManualSettlement({provider:$('#nsProvider').value,gross_amount:Number($('#nsGross').value||0),fees_amount:Number($('#nsFees').value||0),expected_at:$('#nsDate').value||null,description:$('#nsDescription').value.trim()||null});closeModal();financeTab='settlements';await renderFinance()}catch(e){alert(e.message)}});
  }
  function openEditSettlement(x){if(!x)return;openModal(`<div class="section-title"><div><span class="eyebrow">A LIQUIDAR</span><h3>Editar liquidación</h3></div><button class="modal-close modal-x">×</button></div><div class="form-grid"><label>Bruto<input id="esGross" type="number" min="1" value="${Number(x.gross_amount||0)}"></label><label>Comisiones<input id="esFees" type="number" min="0" value="${Number(x.fees_amount||0)}"></label><label>Acreditación<input id="esDate" type="date" value="${esc(x.expected_at||'')}"></label></div><label style="margin-top:12px">Concepto<input id="esDescription" value="${esc(x.description||'')}"></label><div class="modal-actions"><button class="btn ghost modal-close">Cancelar</button><button id="saveEditSettlement" class="btn primary">Guardar</button></div>`);$('#saveEditSettlement').addEventListener('click',async()=>{try{await DB.updateManualSettlement(x.id,{gross_amount:Number($('#esGross').value||0),fees_amount:Number($('#esFees').value||0),expected_at:$('#esDate').value||null,description:$('#esDescription').value.trim()||null});closeModal();await renderFinance()}catch(e){alert(e.message)}})}
  function openNewReceivable(){
    openModal(`<div class="section-title"><div><span class="eyebrow">A COBRAR</span><h3>Nuevo deudor</h3></div><button class="modal-close modal-x">×</button></div><div class="form-grid"><label>Cliente<input id="nrName"></label><label>Teléfono<input id="nrPhone"></label><label>Total<input id="nrTotal" type="number" min="1"></label><label>Vencimiento<input id="nrDue" type="date"></label></div><label style="margin-top:12px">Descripción<input id="nrDescription"></label><div class="modal-actions"><button class="btn ghost modal-close">Cancelar</button><button id="saveNewReceivable" class="btn primary">Guardar deuda</button></div>`);$('#saveNewReceivable').addEventListener('click',async()=>{try{await DB.createManualReceivable({client_name:$('#nrName').value.trim(),client_phone:$('#nrPhone').value.trim()||null,total_amount:Number($('#nrTotal').value||0),due_at:$('#nrDue').value||null,description:$('#nrDescription').value.trim()||null});closeModal();financeTab='receivables';await renderFinance()}catch(e){alert(e.message)}})
  }
  function openEditReceivable(x){if(!x)return;openModal(`<div class="section-title"><div><span class="eyebrow">A COBRAR</span><h3>Editar deudor</h3></div><button class="modal-close modal-x">×</button></div><div class="form-grid"><label>Cliente<input id="erName" value="${esc(x.client_name||'')}"></label><label>Teléfono<input id="erPhone" value="${esc(x.client_phone||'')}"></label><label>Total<input id="erTotal" type="number" min="1" value="${Number(x.total_amount||0)}"></label><label>Vencimiento<input id="erDue" type="date" value="${esc(x.due_at||'')}"></label></div><label style="margin-top:12px">Descripción<input id="erDescription" value="${esc(x.description||'')}"></label><div class="modal-actions"><button class="btn ghost modal-close">Cancelar</button><button id="saveEditReceivable" class="btn primary">Guardar</button></div>`);$('#saveEditReceivable').addEventListener('click',async()=>{try{await DB.updateManualReceivable(x.id,{client_name:$('#erName').value.trim(),client_phone:$('#erPhone').value.trim()||null,total_amount:Number($('#erTotal').value||0),due_at:$('#erDue').value||null,description:$('#erDescription').value.trim()||null});closeModal();await renderFinance()}catch(e){alert(e.message)}})}

  function localDateTimeValue(v){if(!v)return'';const d=new Date(v),z=n=>String(n).padStart(2,'0');return `${d.getFullYear()}-${z(d.getMonth()+1)}-${z(d.getDate())}T${z(d.getHours())}:${z(d.getMinutes())}`}
  function openFinanceEditor(m){
    const manual=!m.source_type||m.source_type==='manual';
    openModal(`<div class="section-title"><div><span class="eyebrow">TRANSACCIÓN</span><h3>Editar movimiento</h3><small class="muted">${manual?'Movimiento manual: edición completa.':'Movimiento automático: monto y tipo protegidos.'}</small></div><button class="modal-close modal-x">×</button></div><div class="form-grid"><label>Monto<input id="fmAmount" type="number" min="0" value="${Number(m.amount||0)}" ${manual?'':'disabled'}></label><label>Tipo<select id="fmKind" ${manual?'':'disabled'}><option value="income" ${m.kind==='income'?'selected':''}>Ingreso</option><option value="expense" ${m.kind==='expense'?'selected':''}>Egreso</option></select></label><label>Método<select id="fmMethod" ${manual?'':'disabled'}><option value="efectivo" ${m.payment_method==='efectivo'?'selected':''}>Efectivo</option><option value="transferencia" ${m.payment_method==='transferencia'?'selected':''}>Transferencia</option><option value="usdt" ${m.payment_method==='usdt'?'selected':''}>USDT</option></select></label><label>Categoría<input id="fmCategory" value="${esc(m.category||'')}"></label><label>Fecha<input id="fmDate" type="datetime-local" value="${localDateTimeValue(m.occurred_at)}"></label><label>Origen<input value="${esc(m.source_type||'manual')}" disabled></label></div><label style="margin-top:12px">Detalle<textarea id="fmDescription" rows="3">${esc(m.description||'')}</textarea></label><div class="modal-actions"><button class="btn ghost modal-close">Cancelar</button><button id="saveFinanceMovement" class="btn primary">Guardar cambios</button></div>`);
    $('#saveFinanceMovement').addEventListener('click',async()=>{try{await DB.updateFinanceMovement(m.id,{amount:manual?Number($('#fmAmount').value||0):null,kind:manual?$('#fmKind').value:null,payment_method:manual?$('#fmMethod').value:null,category:$('#fmCategory').value.trim()||null,description:$('#fmDescription').value.trim()||null,occurred_at:$('#fmDate').value?new Date($('#fmDate').value).toISOString():null});closeModal();await renderFinance()}catch(e){alert(e.message)}});
  }
  function openSettlementLiquidation(id){
    openModal(`<div class="section-title"><div><span class="eyebrow">ACREDITACIÓN</span><h3>Liquidar operación</h3><p class="muted">El importe ingresará al saldo disponible recién al confirmar.</p></div><button class="modal-close modal-x">×</button></div><div class="form-grid"><label>Destino<select id="liqMethod"><option value="transferencia">Transferencia</option><option value="efectivo">Efectivo</option></select></label><label>Titular<select id="liqHolder"><option value="nahuel">Nahuel</option><option value="esteban">Esteban</option></select></label></div><div class="modal-actions"><button class="btn ghost modal-close">Cancelar</button><button id="confirmLiquidation" class="btn primary">Confirmar liquidación</button></div>`);
    $('#confirmLiquidation').addEventListener('click',async()=>{try{await DB.settleFinanceItem(id,$('#liqMethod').value,$('#liqHolder').value);closeModal();await renderFinance()}catch(e){alert(e.message)}});
  }
  function openReceivableCollection(r){
    openModal(`<div class="section-title"><div><span class="eyebrow">COBRO</span><h3>${esc(r.customer_name||r.client_name)}</h3><p class="muted">Pendiente ${money(r.pending_amount)}</p></div><button class="modal-close modal-x">×</button></div><div class="form-grid"><label>Monto<input id="rcAmount" type="number" min="1" max="${Number(r.pending_amount||0)}" value="${Number(r.pending_amount||0)}"></label><label>Método<select id="rcMethod"><option value="transferencia">Transferencia</option><option value="efectivo">Efectivo</option></select></label><label>Titular<select id="rcHolder"><option value="nahuel">Nahuel</option><option value="esteban">Esteban</option></select></label></div><div class="modal-actions"><button class="btn ghost modal-close">Cancelar</button><button id="confirmReceivable" class="btn primary">Registrar cobro</button></div>`);
    $('#confirmReceivable').addEventListener('click',async()=>{try{await DB.recordReceivablePayment(r.id,Number($('#rcAmount').value),$('#rcMethod').value,$('#rcHolder').value);closeModal();await renderFinance()}catch(e){alert(e.message)}});
  }
  async function openReceivableHistory(r){
    const payments=await DB.receivablePayments(r.id);
    openModal(`<div class="section-title"><div><span class="eyebrow">HISTORIAL DE COBROS</span><h3>${esc(r.customer_name||r.client_name)}</h3></div><button class="modal-close modal-x">×</button></div><div class="timeline-list">${payments.map(x=>`<div class="timeline-row"><div><b>${money(x.amount)}</b><small>${safeDate(x.created_at)} · ${esc(x.payment_method)}${x.transfer_holder||x.cash_holder?` · ${esc(x.transfer_holder||x.cash_holder)}`:''}</small></div></div>`).join('')||'<div class="empty">Todavía no tiene cobros registrados.</div>'}</div>`);
  }
  function openFinanceSaleLink(type,id,sales){
    const available=sales.filter(x=>x.status==='completed');
    openModal(`<div class="section-title"><div><span class="eyebrow">TRAZABILIDAD</span><h3>Vincular con una venta</h3></div><button class="modal-close modal-x">×</button></div><label>Venta<select id="financeSaleLink"><option value="">Seleccionar…</option>${available.map(s=>`<option value="${s.id}">${esc(s.sale_code)} · ${money(s.total_ars)} · ${safeDate(s.sold_at)}</option>`).join('')}</select></label><div class="modal-actions"><button class="btn ghost modal-close">Cancelar</button><button id="saveFinanceSaleLink" class="btn primary">Vincular</button></div>`);
    $('#saveFinanceSaleLink').addEventListener('click',async()=>{const saleId=$('#financeSaleLink').value;if(!saleId)return alert('Elegí una venta');try{if(type==='settlement')await DB.linkSettlementSale(id,saleId);else await DB.linkReceivableSale(id,saleId);closeModal();await renderFinance()}catch(e){alert(e.message)}});
  }

  /* -------------------- PUBLIC CATALOG / WEB ORDERS -------------------- */
  async function renderCatalogAdmin(){
    const cfg=await DB.catalogSettings();
    const publicUrl=`${location.origin}/catalogo`;
    content.innerHTML=`<section class="card catalog-settings-single"><div class="section-title"><div><span class="eyebrow">CATÁLOGO PÚBLICO</span><h3>Configuración</h3><p class="muted">Los pedidos que entren desde el catálogo se administran en <b>Operaciones → Pedidos del catálogo</b>.</p></div><a class="btn primary" href="${publicUrl}" target="_blank" rel="noopener">Abrir catálogo</a></div><div class="catalog-url-box"><small>URL pública</small><code>${esc(publicUrl)}</code></div><div class="form-grid" style="margin-top:14px"><label>Título<input id="catTitle" value="${esc(cfg.catalog_title||'IMPORTB2B')}"></label><label>Subtítulo<input id="catSubtitle" value="${esc(cfg.catalog_subtitle||'')}"></label><label>WhatsApp<input id="catWhatsapp" value="${esc(cfg.whatsapp_number||'')}" placeholder="549342..."></label><label>Pedido mínimo<input id="catMin" type="number" min="0" value="${Number(cfg.min_order_ars||0)}"></label><label>Costo de envío<input id="catShippingFee" type="number" min="0" value="${Number(cfg.shipping_fee_ars||0)}"></label><label>Nota de envío<input id="catShippingNote" value="${esc(cfg.shipping_note||'')}"></label></div><div class="catalog-toggle-grid"><label class="check"><input id="catPublic" type="checkbox" ${cfg.is_public?'checked':''}> Catálogo activo</label><label class="check"><input id="catExact" type="checkbox" ${cfg.show_exact_stock?'checked':''}> Mostrar cantidad exacta</label><label class="check"><input id="catOut" type="checkbox" ${cfg.show_out_of_stock?'checked':''}> Mostrar agotados</label><label class="check"><input id="catPickup" type="checkbox" ${cfg.allow_pickup?'checked':''}> Permitir retiro</label><label class="check"><input id="catShipping" type="checkbox" ${cfg.allow_shipping?'checked':''}> Permitir envío</label><label class="check"><input id="catPayLater" type="checkbox" ${cfg.allow_pay_later_public?'checked':''}> Cuenta corriente pública</label></div><div class="modal-actions"><button id="goWebOperations" class="btn ghost">Ver pedidos del catálogo</button><button id="saveCatalogSettings" class="btn primary">Guardar catálogo</button></div></section>`;
    $('#saveCatalogSettings').addEventListener('click',async()=>{const b=$('#saveCatalogSettings');b.disabled=true;try{await DB.saveCatalogSettings({public_slug:cfg.public_slug||'importb2b',catalog_title:$('#catTitle').value.trim()||'IMPORTB2B',catalog_subtitle:$('#catSubtitle').value.trim()||null,whatsapp_number:$('#catWhatsapp').value.trim()||null,min_order_ars:Number($('#catMin').value||0),shipping_fee_ars:Number($('#catShippingFee').value||0),shipping_note:$('#catShippingNote').value.trim()||null,is_public:$('#catPublic').checked,show_exact_stock:$('#catExact').checked,show_out_of_stock:$('#catOut').checked,allow_pickup:$('#catPickup').checked,allow_shipping:$('#catShipping').checked,allow_pay_later_public:$('#catPayLater').checked,pickup_label:'Retiro',shipping_label:'Envío'});alert('Catálogo actualizado');await renderCatalogAdmin()}catch(e){alert(e.message)}finally{b.disabled=false}});
    $('#goWebOperations').addEventListener('click',()=>{operationsTab='web';webOrderStatusFilter='pending';setView('orders')});
  }
  async function openWebOrder(id){
    const o=await DB.webOrderDetail(id);
    openModal(`<div class="section-title"><div><span class="eyebrow">${esc(o.order_code)}</span><h3>${esc(o.customer_name)}</h3><small class="muted">${safeDate(o.created_at)} · ${esc(o.customer_phone)}</small></div><button class="modal-close modal-x">×</button></div>
      <div class="grid mini-grid"><div class="card metric"><small>Estado</small><b style="font-size:18px">${statusPill(o.status)}</b></div><div class="card metric"><small>Total</small><b style="font-size:24px">${money(o.total_ars)}</b></div><div class="card metric"><small>Pago</small><b style="font-size:18px">${esc(o.payment_method?.name||'—')}</b></div><div class="card metric"><small>Entrega</small><b style="font-size:18px">${o.delivery_type==='shipping'?'Envío':'Retiro'}</b></div></div>
      ${o.delivery_address?`<div class="notice" style="margin-top:12px">Dirección: ${esc(o.delivery_address)}</div>`:''}
      <div class="table-wrap" style="margin-top:14px"><table class="table"><thead><tr><th>Producto</th><th>Variante</th><th>Cant.</th><th>Precio</th><th>Total</th></tr></thead><tbody>${o.items.map(i=>`<tr><td><b>${esc(i.product_name)}</b></td><td>${esc(i.variant_name)}</td><td>${number(i.quantity)}</td><td>${money(i.unit_price_ars)}</td><td>${money(i.line_total_ars)}</td></tr>`).join('')}</tbody></table></div>
      <div class="order-total-lines"><div><span>Subtotal</span><b>${money(o.subtotal_ars)}</b></div><div><span>Envío</span><b>${money(o.shipping_ars)}</b></div>${Number(o.adjustment_ars)?`<div><span>Ajuste de pago</span><b>${money(o.adjustment_ars)}</b></div>`:''}<div class="grand"><span>Total</span><b>${money(o.total_ars)}</b></div></div>
      ${o.notes?`<div class="notice" style="margin-top:12px">${esc(o.notes)}</div>`:''}
      <div class="modal-actions">${o.status==='pending'?`<button id="cancelWebOrder" class="btn danger-btn">Cancelar pedido</button><button id="confirmWebOrder" class="btn primary">Confirmar → Venta</button>`:`<button class="btn ghost modal-close">Cerrar</button>`}</div>`);
    $('#confirmWebOrder')?.addEventListener('click',async()=>{if(!confirm('¿Confirmar este pedido y convertirlo en venta real? Se descontará stock y se registrará en Finanzas.'))return;const b=$('#confirmWebOrder');b.disabled=true;try{const r=await DB.webOrderAction(o.id,'confirm');alert(`Venta ${r.sale?.sale_code||''} confirmada`);closeModal();if(currentView==='orders')await renderOrders();else await renderCatalogAdmin()}catch(e){alert(e.message);b.disabled=false}});
    $('#cancelWebOrder')?.addEventListener('click',async()=>{const reason=prompt('Motivo de cancelación:','Cliente canceló')||'';if(!confirm('¿Cancelar y liberar el stock reservado?'))return;try{await DB.webOrderAction(o.id,'cancel',reason);closeModal();if(currentView==='orders')await renderOrders();else await renderCatalogAdmin()}catch(e){alert(e.message)}});
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
