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
  let posProductPage=1;
  const posProductPageSize=25;
  let posRecentPage=1;
  const posRecentPageSize=25;
  let posSearch='';
  let posCategory='';
  let posViewMode=localStorage.getItem('importb2b-pos-view')||'grid';
  let posHolder=localStorage.getItem('importb2b-pos-holder')||'nahuel';
  let posQuickPending=[];
  let financeCache=null;
  let webOrderStatusFilter='pending';
  let operationsTab='purchases';
  let financeSearch='';
  let financeKind='all';
  let financeMethod='all';
  let financeTab='summary';
  let financeFocusMovementId=null;
  let clubSearch='';
  let pdfSearch='';
  let pdfCategory='';
  let pdfOnlyStock=true;
  let pdfSelected=new Set();
  let pdfWholesaleTier=6;
  let wholesaleSearch='';
  let wholesaleCategory='';
  let statsDays=30;
  let stockSort={key:'',dir:0};
  let customerFilter='all';
  let customerSort={key:'',dir:0};

  // Mobile scroll guard: prevents browser pull-to-refresh while keeping Central fully scrollable.
  function installPullRefreshGuard(){
    let startY=0,startX=0,tracking=false;
    const ownScroller=target=>{
      const el=target?.closest?.('.modal-card,.sidebar,.cart-drawer,.table-wrap,.merge-results,.category-manager-list');
      return !!(el&&el.scrollHeight>el.clientHeight+1);
    };
    document.addEventListener('touchstart',e=>{
      if(e.touches.length!==1){tracking=false;return}
      const t=e.touches[0];startY=t.clientY;startX=t.clientX;tracking=true;
    },{passive:true});
    document.addEventListener('touchmove',e=>{
      if(!tracking||e.touches.length!==1||e.defaultPrevented)return;
      const t=e.touches[0],dy=t.clientY-startY,dx=t.clientX-startX;
      if(Math.abs(dx)>Math.abs(dy)||dy<=0)return;
      if(ownScroller(e.target))return;
      const y=window.scrollY||document.documentElement.scrollTop||0;
      if(y<=0)e.preventDefault();
    },{passive:false});
    document.addEventListener('touchend',()=>{tracking=false},{passive:true});
    document.addEventListener('touchcancel',()=>{tracking=false},{passive:true});
  }
  installPullRefreshGuard();

  const money=n=>new Intl.NumberFormat('es-AR',{style:'currency',currency:'ARS',maximumFractionDigits:0}).format(Number(n||0));
  const number=n=>new Intl.NumberFormat('es-AR',{maximumFractionDigits:2}).format(Number(n||0));
  const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
  const metric=(label,value,sub='')=>`<div class="card metric"><small>${esc(label)}</small><b>${value}</b>${sub?`<small>${esc(sub)}</small>`:''}</div>`;
  const issueLabel=i=>({SIN_NOMBRE:'Sin nombre',SIN_CATEGORIA:'Sin categoría',STOCK_NEGATIVO:'Stock negativo',POSIBLE_DUPLICADO:'Posible duplicado',FUSIONADO:'Fusionado'}[i]||i);
  const statusPill=s=>({ready:'<span class="pill green">Listo</span>',needs_review:'<span class="pill yellow">Revisar</span>',imported:'<span class="pill blue">Importado</span>',skipped:'<span class="pill">Omitido</span>',error:'<span class="pill red">Error</span>',completed:'<span class="pill green">Completada</span>',confirmed:'<span class="pill green">Confirmado</span>',pending:'<span class="pill yellow">Pendiente</span>',cancelled:'<span class="pill red">Anulada</span>'}[s]||`<span class="pill">${esc(s)}</span>`);
  const safeDate=x=>x?new Date(x).toLocaleString('es-AR'):'—';
  function urlBase64ToUint8Array(base64String){
    const padding='='.repeat((4-base64String.length%4)%4);
    const base64=(base64String+padding).replace(/-/g,'+').replace(/_/g,'/');
    const raw=atob(base64);
    return Uint8Array.from([...raw].map(ch=>ch.charCodeAt(0)));
  }
  async function ensurePushSubscription(requestPermission=false){
    if(!('serviceWorker' in navigator)||!('PushManager' in window)||!('Notification' in window)) throw new Error('Este dispositivo no soporta notificaciones web.');
    const registration=await navigator.serviceWorker.register('/sw.js?v=7.2.10',{scope:'/'});
    let permission=Notification.permission;
    if(permission==='default'&&requestPermission)permission=await Notification.requestPermission();
    if(permission!=='granted')return {enabled:false,permission};
    const publicKey=await DB.pushPublicKey();
    let subscription=await registration.pushManager.getSubscription();
    if(!subscription){
      subscription=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:urlBase64ToUint8Array(publicKey)});
    }
    const data=subscription.toJSON();
    await DB.savePushSubscription({endpoint:subscription.endpoint,p256dh:data.keys?.p256dh,auth:data.keys?.auth});
    return {enabled:true,permission:'granted'};
  }

  async function start(){
    const {data:{session}}=await db.auth.getSession(); if(session) await enter(session.user);
    db.auth.onAuthStateChange(async(_,session)=>{ if(session&&!window.currentUser) await enter(session.user); if(!session) leave(); });
  }
  async function enter(user){
    window.currentUser=user;
    $('#loginView').classList.add('hidden');
    $('#appView').classList.remove('hidden');
    $('#userLabel').textContent=user.email||user.id;
    const params=new URLSearchParams(location.search);
    const deepView=params.get('view');
    const allowedViews=new Set(['dashboard','sell','products','orders','finance','wholesale','customers','catalog','stats','users','settings']);
    if(deepView&&allowedViews.has(deepView))currentView=deepView;
    if(currentView==='finance')financeTab='summary';
    if(currentView==='orders'&&params.get('tab')==='web'){operationsTab='web';webOrderStatusFilter='pending'}
    const deepOrderId=currentView==='orders'&&operationsTab==='web'?params.get('order'):null;
    await render();
    ensurePushSubscription(false).catch(()=>{});
    if(deepView==='finance'&&params.get('action')==='recount')setTimeout(()=>openFinanceRecount(),120);
    if(deepOrderId)setTimeout(()=>openWebOrder(deepOrderId),140);
    if(deepView){
      const clean=new URL(location.href);
      ['view','action','tab','order'].forEach(k=>clean.searchParams.delete(k));
      history.replaceState({},'',clean.pathname+clean.search+clean.hash);
    }
  }
  function leave(){ window.currentUser=null; $('#appView').classList.add('hidden'); $('#loginView').classList.remove('hidden'); }
  $('#loginForm').addEventListener('submit',async e=>{e.preventDefault();$('#loginError').textContent='';const {error}=await db.auth.signInWithPassword({email:$('#email').value,password:$('#password').value});if(error)$('#loginError').textContent=error.message});
  $('#logoutBtn').addEventListener('click',()=>db.auth.signOut());
  // iOS/mobile viewport lock: overlays never move the page underneath them.
  const uiScrollLocks=new Set();
  let uiLockedScrollY=0;
  function lockPageScroll(reason){
    if(uiScrollLocks.has(reason))return;
    if(uiScrollLocks.size===0){
      uiLockedScrollY=window.scrollY||window.pageYOffset||0;
      document.documentElement.classList.add('ui-scroll-locked');
      document.body.classList.add('ui-scroll-locked');
      document.body.style.position='fixed';
      document.body.style.top=`-${uiLockedScrollY}px`;
      document.body.style.left='0';
      document.body.style.right='0';
      document.body.style.width='100%';
    }
    uiScrollLocks.add(reason);
  }
  function unlockPageScroll(reason,{restore=true}={}){
    uiScrollLocks.delete(reason);
    if(uiScrollLocks.size)return;
    const y=uiLockedScrollY;
    document.documentElement.classList.remove('ui-scroll-locked');
    document.body.classList.remove('ui-scroll-locked');
    document.body.style.position='';
    document.body.style.top='';
    document.body.style.left='';
    document.body.style.right='';
    document.body.style.width='';
    if(restore)window.scrollTo({top:y,left:0,behavior:'auto'});
    else window.scrollTo({top:0,left:0,behavior:'auto'});
  }
  function closeMobileMenu(options={}){
    document.querySelector('.sidebar')?.classList.remove('open');
    $('#mobileMenuBackdrop')?.classList.remove('open');
    $('#appView')?.classList.remove('mobile-menu-open');
    unlockPageScroll('mobile-menu',options);
  }
  function openMobileMenu(){
    lockPageScroll('mobile-menu');
    document.querySelector('.sidebar')?.classList.add('open');
    $('#mobileMenuBackdrop')?.classList.add('open');
    $('#appView')?.classList.add('mobile-menu-open');
  }
  $('#mobileMenuBtn')?.addEventListener('click',()=>document.querySelector('.sidebar')?.classList.contains('open')?closeMobileMenu():openMobileMenu());
  $('#mobileMenuBackdrop')?.addEventListener('click',()=>closeMobileMenu());
  $('#nav').addEventListener('click',e=>{
    const b=e.target.closest('button[data-view]');if(!b)return;
    // Main navigation always starts at the top of the target view, without sliding the frozen background.
    closeMobileMenu({restore:false});
    setView(b.dataset.view);
  });
  $('#globalSearch').addEventListener('input',e=>{
    const v=e.target.value;
    if(currentView==='products') renderProducts(v);
    if(currentView==='customers') renderCustomers(v);
    if(currentView==='club'){clubSearch=v;renderClub(v);}
    if(currentView==='pdfs'){pdfSearch=v;renderPdfBuilder();}
    if(currentView==='sell'){posSearch=v;renderPosCatalog();}
    if(currentView==='wholesale'){wholesaleSearch=v;renderWholesale();}
  });
  function navView(v){if(v==='club')return 'customers';if(v==='pdfs')return 'wholesale';if(v==='imports')return 'settings';return v;}
  function setView(v){currentView=v;document.querySelectorAll('#nav button').forEach(x=>x.classList.toggle('active',x.dataset.view===navView(v)));render();}

  async function render(){
    document.querySelectorAll('#nav button').forEach(x=>x.classList.toggle('active',x.dataset.view===navView(currentView)));
    const titles={dashboard:'Inicio',sell:'Vender',products:'Productos / Stock',orders:'Operaciones',finance:'Finanzas',wholesale:'Mayorista / PDF Catálogos',pdfs:'Mayorista / PDF Catálogos',customers:'Clientes / Club',club:'Clientes / Club',catalog:'Catálogo / Web',stats:'Estadísticas',users:'Usuarios',settings:'Configuración',imports:'Configuración'};
    const searchPlaceholders={products:'Buscar producto, SKU, categoría…',customers:'Buscar cliente, teléfono o Instagram…',club:'Buscar miembro del Club…',pdfs:'Buscar producto para el PDF…',wholesale:'Buscar producto, variante o categoría…'};
    $('#viewTitle').textContent=titles[currentView]||'IMPORTB2B';
    const gs=$('#globalSearch'),gsWrap=document.querySelector('.global-search');
    const showGlobalSearch=Object.prototype.hasOwnProperty.call(searchPlaceholders,currentView);
    if(gsWrap)gsWrap.classList.toggle('hidden',!showGlobalSearch);
    if(gs&&showGlobalSearch)gs.placeholder=searchPlaceholders[currentView];
    content.innerHTML='<div class="empty">Cargando…</div>';
    try{
      if(currentView==='dashboard') await renderDashboard();
      else if(currentView==='sell') await renderSell();
      else if(currentView==='products') await renderProducts($('#globalSearch').value);
      else if(currentView==='orders') await renderOrders();
      else if(currentView==='customers') await renderCustomers($('#globalSearch').value);
      else if(currentView==='club') await renderClub(clubSearch||$('#globalSearch').value);
      else if(currentView==='pdfs') await renderPdfBuilder();
      else if(currentView==='wholesale') await renderWholesale();
      else if(currentView==='finance') await renderFinance();
      else if(currentView==='catalog') await renderCatalogAdmin();
      else if(currentView==='stats') await renderStatistics();
      else if(currentView==='users') await renderUsers();
      else if(currentView==='settings') await renderSettings();
      else if(currentView==='imports') await renderImports();
    }catch(e){console.error(e);content.innerHTML=`<div class="notice danger">Error: ${esc(e.message)}</div>`}
  }

  async function renderDashboard(){
    const d=await DB.dashboard(),v=d.valuation||{};
    const diff=d.yesterdaySales?((d.todaySales-d.yesterdaySales)/d.yesterdaySales*100):(d.todaySales>0?100:0);
    const diffClass=diff>=0?'positive':'negative';
    const diffText=d.yesterdaySales?`${diff>=0?'+':''}${number(diff)}% vs ayer`:(d.todaySales>0?'Primera venta del día':'Sin ventas registradas hoy');
    content.innerHTML=`
      <section class="dashboard-hero card">
        <div class="dashboard-hero-head">
          <div><span class="eyebrow">VENTAS DE HOY</span><h3>${money(d.todaySales)}</h3><p>${number(d.todayCount)} operaciones · Ticket promedio <b>${money(d.todayTicket)}</b></p></div>
          <div class="dashboard-diff ${diffClass}">${esc(diffText)}</div>
        </div>
        <div class="month-inside-hero dashboard-summary-no-chart">
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
        <button class="dash-alert" data-go="products"><span>Stock crítico</span><b>${number(d.lowStock)}</b><small>Variantes en mínimo</small></button>${d.quickPending?`<button class="dash-alert quick-alert" data-go="sell"><span>Ventas fugaces</span><b>${number(d.quickPending)}</b><small>Stock pendiente de vincular</small></button>`:''}
      </section>

      <section class="dashboard-mini-stats">
        <div class="mini-stat"><small>Unidades disponibles</small><b>${number(d.stock)}</b><span>${d.transit?`${number(d.transit)} en tránsito`:'Stock actual'}</span></div>
        <div class="mini-stat"><small>Productos activos</small><b>${number(d.products)}</b><span>Base central</span></div>
        <div class="mini-stat"><small>Valor de venta del stock</small><b>${money(v.stock_sale_value_ars)}</b><span>Costo ${money(v.stock_cost_ars)}</span></div>
        <div class="mini-stat profit"><small>Ganancia esperada</small><b>${money(v.expected_profit_ars)}</b><span>Sobre stock disponible</span></div>
      </section>

      <section class="dashboard-bottom-grid">
        <div class="card recent-activity"><div class="section-title"><div><span class="eyebrow">ACTIVIDAD</span><h3>Últimos movimientos</h3></div></div>
          <div class="activity-list">${d.recent.map(x=>`<button class="activity-row activity-link" data-finance-search="${esc(x.title)}" data-finance-id="${esc(x.movement_id||'')}"><span class="activity-dot ${x.type}"></span><div><b>${esc(x.title)}</b><small>${safeDate(x.date)}</small></div><strong class="${x.amount<0?'negative':''}">${x.amount<0?'−':''}${money(Math.abs(x.amount||0))}</strong><i>›</i></button>`).join('')||'<div class="empty">Todavía no hay actividad reciente.</div>'}</div>
        </div>
        <div class="card finance-compact"><div class="section-title"><div><span class="eyebrow">FINANZAS</span><h3>Resumen operativo</h3></div><button id="dashFinance" class="btn ghost tiny">Abrir Finanzas</button></div>
          <div class="finance-compact-grid"><div><small>Ingresos</small><b>${money(d.income)}</b></div><div><small>Egresos</small><b>${money(d.expense)}</b></div><div class="${d.operationalNet>=0?'profit':'negative'}"><small>Resultado</small><b>${money(d.operationalNet)}</b></div></div>
          <p class="muted small-text">No incluye transferencias internas ni conversiones como resultado comercial.</p>
        </div>
      </section>`;
    $('#dashSell')?.addEventListener('click',()=>setView('sell'));
    $('#dashFinance')?.addEventListener('click',()=>setView('finance'));
    document.querySelectorAll('.dash-alert').forEach(b=>b.addEventListener('click',()=>{if(b.dataset.finance)financeTab=b.dataset.finance;setView(b.dataset.go)}));
    document.querySelectorAll('.activity-link').forEach(b=>b.addEventListener('click',()=>{financeTab='movements';financeSearch=b.dataset.financeSearch||'';financeFocusMovementId=b.dataset.financeId||null;setView('finance')}));
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
    const [cats,products,methods,customers,recent,pendingQuick]=await Promise.all([DB.categories(),DB.products('','','all'),DB.paymentMethods(),DB.customers(''),DB.recentSales(400),DB.pendingQuickSales()]);
    posProducts=products;posMethods=methods;posCustomers=customers;posRecentSales=recent;posQuickPending=pendingQuick;
    const currentCustomer=$('#posCustomer')?.value||'';
    const currentMethod=$('#posPayment')?.value||methods[0]?.id||'';
    const currentShipping=$('#posShipping')?.value||'0',currentDiscount=$('#posDiscount')?.value||'0',currentNotes=$('#posNotes')?.value||'';
    content.innerHTML=`
      ${pendingQuick.length?`<div class="notice quick-sale-warning"><span><b>⚡ ${pendingQuick.length} venta${pendingQuick.length===1?'':'s'} fugaz${pendingQuick.length===1?'':'es'} con stock pendiente</b><small>El dinero ya fue registrado. Falta vincular el artículo para descontar inventario.</small></span><button id="reviewQuickSales" class="btn ghost tiny">Vincular ahora</button></div>`:''}
      <section class="pos-catalog card pos-catalog-full">
        <div class="section-title"><div><span class="eyebrow">VENDER</span><h3>Productos</h3></div><div class="product-editor-actions"><button id="jumpRecentSales" class="btn ghost tiny" type="button">Últimas ventas ↓</button><span class="pill blue">${products.reduce((a,p)=>a+p.variants.filter(v=>Number(v.stock.available)>0).length,0)} variantes con stock</span></div></div>
        <div class="pos-shell-tools">
          <div class="pos-quick-tools"><input id="posSearch" value="${esc(posSearch)}" placeholder="Buscar producto, SKU, modelo, color, talle o sabor…"><button id="quickSaleBtn" class="pos-icon-btn quick" title="Venta fugaz">⚡</button><button id="posViewToggle" class="pos-icon-btn ${posViewMode==='grid'?'active':''}" title="Cambiar vista">${posViewMode==='grid'?'☷':'▦'}</button></div>
          <div id="posCategoryStrip" class="pos-category-strip"><button class="pos-category-chip ${!posCategory?'active':''}" data-pos-cat="">TODOS</button>${cats.map(c=>`<button class="pos-category-chip ${c===posCategory?'active':''}" data-pos-cat="${esc(c)}">${esc(c).toUpperCase()}</button>`).join('')}</div>
        </div>
        <div id="posCatalogGrid" class="pos-product-grid pos-product-grid-wide ${posViewMode==='grid'?'cards-view':'list-view'}"></div>
        <div id="posCatalogPagination"></div>
      </section>

      <div id="cartBackdrop" class="cart-backdrop"></div>
      <aside id="posCartDrawer" class="cart-drawer" aria-hidden="true">
        <div class="cart-drawer-head"><div><span class="eyebrow">CARRITO</span><h3>Venta actual</h3></div><div class="cart-drawer-head-actions"><span id="cartCount" class="pill">0</span><button id="cartClose" class="drawer-close" type="button">×</button></div></div>
        <div class="cart-drawer-body">
          <div class="pos-customer-row smart-customer-row"><label>Cliente<input id="posCustomerSearch" autocomplete="off" placeholder="Buscar cliente por nombre, teléfono…"><input id="posCustomer" type="hidden" value="${esc(currentCustomer)}"></label><div id="posCustomerResults" class="smart-search-results customer-search-results"></div></div>
          <div id="cartItems" class="cart-items"></div>
          <div class="pos-fields"><label>Envío<input id="posShipping" type="number" min="0" step="100" value="${esc(currentShipping)}"></label><label>Descuento<input id="posDiscount" type="number" min="0" step="100" value="${esc(currentDiscount)}"></label></div>
          <label>Forma de pago<select id="posPayment">${methods.map(m=>`<option value="${m.id}" ${m.id===currentMethod?'selected':''}>${esc(m.name)}${Number(m.adjustment_value)?` · ${m.adjustment_direction==='discount'?'-':'+'}${number(m.adjustment_value)}${m.adjustment_kind==='percent'?'%':''}`:''}</option>`).join('')}</select></label>
          <div id="paymentHint" class="payment-hint"></div>
          <label id="posHolderWrap">¿Quién recibe el dinero?<select id="posHolder"><option value="nahuel" ${posHolder==='nahuel'?'selected':''}>Nahuel</option><option value="esteban" ${posHolder==='esteban'?'selected':''}>Esteban</option></select></label>
          <label>Nota<textarea id="posNotes" rows="2" placeholder="Opcional">${esc(currentNotes)}</textarea></label><div id="cartTotals"></div>
        </div>
        <div class="cart-drawer-footer"><button id="finishSale" class="btn primary full">Finalizar venta</button></div>
      </aside>
      <section class="card" style="margin-top:14px"><div class="section-title"><div><span class="eyebrow">HISTORIAL</span><h3>Últimas ventas</h3></div></div><div id="recentSales"></div></section>`;
    renderPosCatalog();renderCart();renderRecentSales();
    $('#posSearch').addEventListener('input',e=>{posSearch=e.target.value;posProductPage=1;$('#globalSearch').value=posSearch;renderPosCatalog()});
    document.querySelectorAll('[data-pos-cat]').forEach(b=>b.addEventListener('click',()=>{posCategory=b.dataset.posCat||'';posProductPage=1;document.querySelectorAll('[data-pos-cat]').forEach(x=>x.classList.toggle('active',(x.dataset.posCat||'')===posCategory));renderPosCatalog()}));
    $('#posViewToggle').addEventListener('click',()=>{posViewMode=posViewMode==='grid'?'list':'grid';localStorage.setItem('importb2b-pos-view',posViewMode);renderPosCatalog();const b=$('#posViewToggle');b.textContent=posViewMode==='grid'?'☷':'▦';b.classList.toggle('active',posViewMode==='grid')});
    ['#posShipping','#posDiscount','#posPayment'].forEach(sel=>$(sel).addEventListener('input',renderCartTotals));
    $('#posHolder').addEventListener('change',e=>{posHolder=e.target.value;localStorage.setItem('importb2b-pos-holder',posHolder)});
    bindPosCustomerSearch(currentCustomer);$('#finishSale').addEventListener('click',finishSale);$('#cartClose').addEventListener('click',closeCartDrawer);$('#cartBackdrop').addEventListener('click',closeCartDrawer);
    $('#quickSaleBtn').addEventListener('click',openQuickSale);
    $('#jumpRecentSales')?.addEventListener('click',()=>document.querySelector('#recentSales')?.scrollIntoView({behavior:'smooth',block:'start'}));
    $('#reviewQuickSales')?.addEventListener('click',()=>openPendingQuickSales());
  }
  function bindPosCustomerSearch(initialId=''){
    const input=$('#posCustomerSearch'),hidden=$('#posCustomer'),box=$('#posCustomerResults');if(!input||!hidden||!box)return;
    let selected=posCustomers.find(c=>c.id===initialId)||null;if(selected)input.value=selected.full_name;
    const draw=()=>{const q=input.value.trim().toLowerCase();const exact=posCustomers.some(c=>String(c.full_name||'').trim().toLowerCase()===q);const rows=posCustomers.filter(c=>!q||[c.full_name,c.phone,c.email,c.instagram_username,c.customer_code].join(' ').toLowerCase().includes(q)).slice(0,12);box.innerHTML=(q?rows:rows.slice(0,8)).map(c=>`<button type="button" class="smart-search-row ${hidden.value===c.id?'selected':''}" data-pos-customer="${c.id}"><span><b>${esc(c.full_name)}</b><small>${esc(c.phone||c.instagram_username||c.email||'Sin datos extra')}</small></span><strong>${number(c.completed_sales||0)} compras</strong></button>`).join('')+`${q&&!exact?`<button type="button" class="smart-search-row create-new" id="posCreateCustomer"><span><b>+ Crear “${esc(input.value.trim())}”</b><small>Se guarda ahora y queda marcado para completar sus datos después.</small></span></button>`:''}`;box.classList.toggle('open',document.activeElement===input&&Boolean(q));document.querySelectorAll('[data-pos-customer]').forEach(b=>b.addEventListener('click',()=>{selected=posCustomers.find(c=>c.id===b.dataset.posCustomer)||null;hidden.value=selected?.id||'';input.value=selected?.full_name||'';box.classList.remove('open')}));$('#posCreateCustomer')?.addEventListener('click',async()=>{const name=input.value.trim();if(!name)return;const b=$('#posCreateCustomer');b.disabled=true;try{const c=await DB.createQuickCustomer(name);posCustomers.push({...c,completed_sales:0});selected=c;hidden.value=c.id;input.value=c.full_name;box.classList.remove('open')}catch(e){alert(e.message);b.disabled=false}})};
    input.addEventListener('focus',draw);input.addEventListener('input',()=>{selected=null;hidden.value='';draw()});input.addEventListener('blur',()=>setTimeout(()=>box.classList.remove('open'),180));draw();
  }
  function openCartDrawer(){$('#posCartDrawer')?.classList.add('open');$('#cartBackdrop')?.classList.add('open');$('#posCartDrawer')?.setAttribute('aria-hidden','false');document.body.classList.add('cart-open')}
  function closeCartDrawer(){$('#posCartDrawer')?.classList.remove('open');$('#cartBackdrop')?.classList.remove('open');$('#posCartDrawer')?.setAttribute('aria-hidden','true');document.body.classList.remove('cart-open')}
  function renderPosCatalog(){
    const el=$('#posCatalogGrid'),pager=$('#posCatalogPagination');if(!el)return;
    const q=posSearch.trim().toLowerCase();
    const rows=posProducts.filter(p=>(!posCategory||p.category===posCategory)&&(!q||[p.name,p.sku,p.category,...p.variants.flatMap(v=>[v.variant_name,v.sku])].join(' ').toLowerCase().includes(q)));
    const total=rows.length,totalPages=Math.max(1,Math.ceil(total/posProductPageSize));
    posProductPage=Math.min(Math.max(1,posProductPage),totalPages);
    const from=(posProductPage-1)*posProductPageSize,to=Math.min(from+posProductPageSize,total),visible=rows.slice(from,to);
    const pageWindow=()=>{if(totalPages<=7)return Array.from({length:totalPages},(_,i)=>i+1);const out=[1],a=Math.max(2,posProductPage-1),b=Math.min(totalPages-1,posProductPage+1);if(a>2)out.push('…');for(let i=a;i<=b;i++)out.push(i);if(b<totalPages-1)out.push('…');out.push(totalPages);return out};

    el.className=`pos-product-grid pos-product-grid-wide ${posViewMode==='grid'?'cards-view':'list-view'}`;
    const head=posViewMode==='list'?`<div class="pos-list-head"><span></span><b>Producto</b><b>Categoría</b><b>Variante</b><b>Precio</b><b>Stock</b></div>`:'';
    el.innerHTML=head+(visible.map(p=>{const variants=p.variants.filter(v=>Number(v.stock.available)>0),totalStock=variants.reduce((a,v)=>a+Number(v.stock.available||0),0),prices=(variants.length?variants:p.variants).map(v=>Number(v.price_ars||0)).filter(Boolean),price=prices.length?Math.min(...prices):0;const img=p.thumbnail_url||p.primary_image_url;return `<article class="pos-product-card-v63 ${totalStock<=0?'out':''}" data-product="${p.id}"><div class="pos-product-photo">${img?`<img loading="lazy" decoding="async" src="${esc(img)}" alt="${esc(p.name)}">`:'<div class="pos-product-placeholder">IB</div>'}</div><div class="pos-product-main"><b>${esc(p.name)}</b><small>${esc(p.sku||'Sin SKU')}</small></div><div class="pos-product-category">${esc(p.category||'—')}</div><div class="pos-product-variant">${p.variants.length>1?`${number(p.variants.length)} variantes`:esc(p.variants[0]?.variant_name||'Única')}</div><div class="pos-product-price">${price?money(price):'Consultar'}</div><div class="pos-product-stock stock-text ${totalStock<=0?'out':totalStock<=1?'low':'ok'}">${totalStock<=0?'Agotado':`Stock: ${number(totalStock)}`}</div></article>`}).join('')||'<div class="empty">No hay productos para esta búsqueda.</div>');

    if(pager){
      pager.innerHTML=total?`<div class="recent-sales-pagination pos-product-pagination"><small>Mostrando ${number(from+1)}–${number(to)} de ${number(total)} productos</small><div class="recent-sales-pages"><button class="recent-page-arrow" data-pos-product-page="${posProductPage-1}" ${posProductPage<=1?'disabled':''} aria-label="Página anterior">←</button>${pageWindow().map(x=>x==='…'?'<span class="recent-page-ellipsis">…</span>':`<button class="recent-page-number ${x===posProductPage?'active':''}" data-pos-product-page="${x}">${x}</button>`).join('')}<button class="recent-page-arrow" data-pos-product-page="${posProductPage+1}" ${posProductPage>=totalPages?'disabled':''} aria-label="Página siguiente">→</button></div></div>`:'';
      pager.querySelectorAll('[data-pos-product-page]').forEach(b=>b.addEventListener('click',()=>{const page=Number(b.dataset.posProductPage);if(!Number.isFinite(page)||page<1||page>totalPages||page===posProductPage)return;posProductPage=page;renderPosCatalog();document.querySelector('.pos-catalog')?.scrollIntoView({behavior:'smooth',block:'start'})}));
    }

    el.querySelectorAll('[data-product]').forEach(card=>card.addEventListener('click',()=>{const p=posProducts.find(x=>x.id===card.dataset.product);if(!p)return;const vars=p.variants.filter(v=>Number(v.stock.available)>0);if(!vars.length)return alert('Producto agotado');if(vars.length===1){addToCart(p.id,vars[0].id);openCartDrawer()}else openVariantPicker(p,vars)}));
  }
  function openVariantPicker(p,variants){
    openModal(`<div class="section-title"><div><span class="eyebrow">OPCIONES</span><h3>${esc(p.name)}</h3><small class="muted">Elegí la variante disponible</small></div><button class="modal-close modal-x">×</button></div><div class="variant-sheet-list">${variants.map(v=>`<button class="variant-sheet-option" data-variant-pick="${v.id}"><i class="variant-box">${esc((v.variant_name||'U').slice(0,5))}</i><span><b>${esc(v.variant_name||'Única')}</b><small>${esc(v.sku||'Sin SKU')}</small></span><strong>${money(v.price_ars)}<small>Stock: ${number(v.stock.available)}</small></strong></button>`).join('')}</div>`);
    $('#modalLayer')?.classList.add('variant-sheet-layer');document.querySelectorAll('[data-variant-pick]').forEach(b=>b.addEventListener('click',()=>{addToCart(p.id,b.dataset.variantPick);closeModal();openCartDrawer()}));
  }
  function openQuickSale(){
    const method=posMethods.find(x=>x.finance_mode==='movement')||posMethods[0];
    openModal(`<div class="section-title"><div><span class="eyebrow">⚡ VENTA FUGAZ</span><h3>Registrar sin buscar producto</h3><p class="muted">El dinero se registra ahora. El stock queda pendiente para vincular después.</p></div><button class="modal-close modal-x">×</button></div><div class="form-grid"><label>Monto<input id="qsAmount" type="number" min="1" step="100" inputmode="numeric"></label><label>Forma de pago<select id="qsPayment">${posMethods.map(m=>`<option value="${m.id}" ${m.id===method?.id?'selected':''}>${esc(m.name)}</option>`).join('')}</select></label><label id="qsHolderWrap">¿Quién recibe?<select id="qsHolder"><option value="nahuel">Nahuel</option><option value="esteban">Esteban</option></select></label><label>Cliente (opcional)<select id="qsCustomer"><option value="">Sin cliente</option>${posCustomers.map(c=>`<option value="${c.id}">${esc(c.full_name)}</option>`).join('')}</select></label></div><label style="margin-top:12px">Descripción<input id="qsNotes" placeholder="Ej. Camiseta Argentina / perfume / venta rápida"></label><div class="notice" style="margin-top:12px">⚠ Quedará una alerta de <b>stock pendiente de vincular</b>.</div><div class="modal-actions"><button class="btn ghost modal-close">Cancelar</button><button id="saveQuickSale" class="btn primary">Registrar venta fugaz</button></div>`);
    const sync=()=>{const m=posMethods.find(x=>x.id===$('#qsPayment').value);$('#qsHolderWrap').classList.toggle('hidden',m?.finance_mode!=='movement')};$('#qsPayment').addEventListener('change',sync);sync();
    $('#saveQuickSale').addEventListener('click',async()=>{const amount=Number($('#qsAmount').value||0),m=posMethods.find(x=>x.id===$('#qsPayment').value);if(amount<=0)return alert('Ingresá un monto');if(m?.finance_mode==='receivable'&&!$('#qsCustomer').value)return alert('Cuenta corriente requiere cliente');try{const r=await DB.quickSale({amount,paymentMethodId:m.id,holder:m.finance_mode==='movement'?$('#qsHolder').value:null,customerId:$('#qsCustomer').value||null,notes:$('#qsNotes').value.trim()||null});closeModal();await renderSell();alert(`${r.sale_code} registrada. Recordá vincular el producto para descontar stock.`)}catch(e){alert(e.message)}});
  }
  function openPendingQuickSales(){
    openModal(`<div class="section-title"><div><span class="eyebrow">STOCK PENDIENTE</span><h3>Ventas fugaces</h3></div><button class="modal-close modal-x">×</button></div><div class="list">${posQuickPending.map(s=>`<div class="row"><span><b>${esc(s.sale_code)} · ${money(s.total_ars)}</b><small class="muted">${safeDate(s.sold_at)} · ${esc(s.notes||'Sin descripción')}</small></span><button class="btn tiny primary link-quick-stock" data-id="${s.id}">Vincular stock</button></div>`).join('')||'<div class="empty">Todo vinculado.</div>'}</div>`);document.querySelectorAll('.link-quick-stock').forEach(b=>b.addEventListener('click',()=>openQuickSaleStockLink(b.dataset.id)));
  }
  function openQuickSaleStockLink(saleId){
    const options=posProducts.flatMap(p=>p.variants.filter(v=>Number(v.stock.available)>0).map(v=>({p,v})));const sale=posQuickPending.find(x=>x.id===saleId);let selectedVariantId='';
    openModal(`<div class="section-title"><div><span class="eyebrow">VINCULAR STOCK</span><h3>${esc(sale?.sale_code||'Venta fugaz')}</h3><p class="muted">Buscá por producto, variante o SKU y elegí el artículo exacto.</p></div><button class="modal-close modal-x">×</button></div><label>Buscar producto<input id="qslSearch" autocomplete="off" placeholder="Ej. Argentina, XL, perfume…"></label><div id="qslResults" class="smart-search-results"></div><input id="qslVariant" type="hidden"><label>Cantidad<input id="qslQty" type="number" min="1" step="1" value="1"></label><div class="modal-actions"><button class="btn ghost modal-close">Cancelar</button><button id="saveQuickLink" class="btn primary" disabled>Descontar stock y vincular</button></div>`);
    const draw=()=>{const q=$('#qslSearch').value.trim().toLowerCase();const rows=options.filter(x=>!q||[x.p.name,x.p.sku,x.p.category,x.v.variant_name,x.v.sku].join(' ').toLowerCase().includes(q)).slice(0,40);$('#qslResults').innerHTML=rows.map(x=>`<button type="button" class="smart-search-row ${selectedVariantId===x.v.id?'selected':''}" data-qsl-variant="${x.v.id}"><span><b>${esc(x.p.name)}</b><small>${esc(x.v.variant_name||'Única')}${x.v.sku?` · ${esc(x.v.sku)}`:''}</small></span><strong>Stock ${number(x.v.stock.available)}</strong></button>`).join('')||'<div class="empty compact-empty">No encontramos productos con esa búsqueda.</div>';document.querySelectorAll('[data-qsl-variant]').forEach(b=>b.addEventListener('click',()=>{selectedVariantId=b.dataset.qslVariant;$('#qslVariant').value=selectedVariantId;$('#saveQuickLink').disabled=false;draw()}));};
    $('#qslSearch').addEventListener('input',()=>{selectedVariantId='';$('#qslVariant').value='';$('#saveQuickLink').disabled=true;draw()});draw();setTimeout(()=>$('#qslSearch')?.focus(),80);
    $('#saveQuickLink').addEventListener('click',async()=>{if(!selectedVariantId)return alert('Elegí una variante');try{await DB.linkQuickSaleItem(saleId,selectedVariantId,Number($('#qslQty').value||1));closeModal();await renderSell()}catch(e){alert(e.message)}});
  }
  function addToCart(productId,variantId){
    const p=posProducts.find(x=>x.id===productId),v=p?.variants.find(x=>x.id===variantId); if(!p||!v)return;
    const old=saleCart.find(x=>x.variantId===variantId);
    if(old){if(old.qty>=Number(v.stock.available))return alert('No hay más stock disponible');old.qty+=1}
    else saleCart.push({productId:p.id,variantId:v.id,name:p.name,variant:v.variant_name,sku:v.sku,image:p.thumbnail_url||p.primary_image_url||null,price:Number(v.price_ars||0),cost:Number(v.cost_ars||0),available:Number(v.stock.available||0),qty:1});
    renderCart();
    const launcher=$('#cartToggle'); if(launcher){launcher.classList.remove('pulse');void launcher.offsetWidth;launcher.classList.add('pulse');setTimeout(()=>launcher.classList.remove('pulse'),420)}
  }
  function renderCart(){
    const el=$('#cartItems'); if(!el)return;
    const itemCount=saleCart.reduce((a,x)=>a+x.qty,0);
    if($('#cartCount')) $('#cartCount').textContent=itemCount;
    if($('#cartLauncherCount')) $('#cartLauncherCount').textContent=itemCount;
    if($('#cartLauncherLabel')) $('#cartLauncherLabel').textContent=itemCount?`${itemCount} ${itemCount===1?'unidad':'unidades'}`:'Venta vacía';
    el.innerHTML=saleCart.length?saleCart.map(x=>`<article class="cart-product" data-cart="${x.variantId}"><div class="cart-product-media">${x.image?`<img src="${esc(x.image)}" alt="${esc(x.name)}">`:'<span>IB</span>'}</div><div class="cart-product-main"><div class="cart-product-title"><div><b>${esc(x.name)}</b><small>${esc(x.variant||'Única')}${x.sku?` · ${esc(x.sku)}`:''}</small></div><button class="cart-remove" type="button" title="Eliminar producto">Eliminar</button></div><div class="cart-product-actions"><div class="cart-controls"><button class="cart-minus" type="button">−</button><input class="cart-qty" type="number" min="1" max="${x.available}" value="${x.qty}"><button class="cart-plus" type="button">+</button></div><label class="cart-unit-label"><span>Precio unitario</span><input class="cart-unit-price" type="number" min="0" step="100" value="${x.price}"></label><div class="cart-line-total"><small>Total</small><b>${money(x.price*x.qty)}</b></div></div></div></article>`).join(''):'<div class="empty compact-empty">Agregá productos y abrí el carrito cuando quieras finalizar.</div>';
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
    const box=$('#cartTotals');if(!box)return;const t=calcTotals(),m=t.method;
    $('#paymentHint').innerHTML=m?`${m.finance_mode==='settlement'?'Se registra como <b>dinero a liquidar</b>.':m.finance_mode==='receivable'?'Se registra como <b>cuenta por cobrar</b>.':`Se registra como <b>ingreso</b> y queda asignado a quien recibe el dinero.`}`:'';
    const holderWrap=$('#posHolderWrap');if(holderWrap)holderWrap.classList.toggle('hidden',m?.finance_mode!=='movement');
    box.innerHTML=`<div class="totals-list"><div><span>Subtotal</span><b>${money(t.subtotal)}</b></div><div><span>Descuento</span><b>-${money(t.discount)}</b></div><div><span>Envío</span><b>${money(t.shipping)}</b></div>${t.adjustment?`<div><span>${t.adjustment>0?'Recargo':'Descuento'} ${esc(m?.name||'')}</span><b>${t.adjustment>0?'+':''}${money(t.adjustment)}</b></div>`:''}<div class="grand-total"><span>Total</span><strong>${money(t.total)}</strong></div></div>`;
    const btn=$('#finishSale');if(btn){btn.disabled=!saleCart.length||!m;btn.textContent=`Finalizar ${money(t.total)}`}if($('#cartLauncherTotal'))$('#cartLauncherTotal').textContent=money(t.total);
  }
  async function finishSale(){
    if(!saleCart.length)return;const t=calcTotals();if(!t.method)return alert('Elegí una forma de pago');
    const customerId=$('#posCustomer').value||null;if(t.method.finance_mode==='receivable'&&!customerId)return alert('Cuenta corriente requiere seleccionar un cliente');
    const holder=t.method.finance_mode==='movement'?($('#posHolder')?.value||posHolder):null;if(t.method.finance_mode==='movement'&&!holder)return alert('Elegí quién recibe el dinero');
    if(!confirm(`Confirmar venta por ${money(t.total)} con ${t.method.name}${holder?` · recibe ${holder==='nahuel'?'Nahuel':'Esteban'}`:''}?`))return;
    const btn=$('#finishSale');btn.disabled=true;btn.textContent='Registrando…';const snapshot=saleCart.map(x=>({...x}));
    try{const result=await DB.completeSale({customerId,items:snapshot.map(x=>({variant_id:x.variantId,quantity:x.qty,unit_price_ars:x.price})),paymentMethodId:t.method.id,shipping:t.shipping,discount:t.discount,notes:$('#posNotes').value.trim(),holder});const customer=posCustomers.find(x=>x.id===customerId)||null;saleCart=[];await renderSell();openReceipt(result,snapshot,customer)}catch(e){alert(e.message);btn.disabled=false;renderCartTotals()}
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
      const historical=!!s.is_historical;
      const recent=posRecentSales.find(x=>String(x.id)===String(s.id));
      const customer=posCustomers.find(c=>String(c.id)===String(s.customer_id))||recent?.customer||null;
      openModal(`<div class="section-title"><div><span class="eyebrow">${historical?'VENTA HISTÓRICA':'VENTA'}</span><h3 class="${s.status==='cancelled'?'sale-cancelled-row':''}">${esc(s.sale_code||'Detalle')} ${historical?'<span class="pill blue">HISTÓRICA</span>':''}</h3><small class="muted">${safeDate(s.sold_at||s.created_at)} · ${esc(s.original_payment_method||'')}</small></div><button class="modal-close modal-x">×</button></div><div class="notice sale-client-link"><span><small>CLIENTE VINCULADO</small><b>${esc(customer?.full_name||'Consumidor final')}</b>${customer?.phone?`<em>${esc(customer.phone)}</em>`:''}</span></div>${historical?'<div class="notice good-notice">Registro histórico editable · No modifica stock ni saldos actuales de Finanzas.</div>':''}${s.stock_link_status==='pending'?`<div class="notice">⚡ Venta fugaz: el dinero está registrado pero falta vincular el producto al stock.</div>`:''}<div class="receipt-lines">${(s.items||[]).map(i=>`<div><span>${number(i.quantity)}× ${esc(i.original_item_name)}</span><b>${i.line_total_ars==null?'—':money(i.line_total_ars)}</b></div>`).join('')||'<div class="empty">Sin productos vinculados.</div>'}</div><div class="order-total-lines"><div><span>Subtotal</span><b>${money(s.subtotal_ars)}</b></div><div><span>Descuento</span><b>-${money(s.discount_ars)}</b></div><div><span>Envío</span><b>${money(s.shipping_ars)}</b></div>${Number(s.fee_ars)?`<div><span>Ajuste / tasa</span><b>${money(s.fee_ars)}</b></div>`:''}<div class="grand"><span>Total</span><b>${money(s.total_ars)}</b></div></div>${s.profit_ars!=null?`<div class="notice" style="margin-top:12px">Ganancia histórica: <b>${money(s.profit_ars)}</b></div>`:''}${s.notes?`<div class="notice" style="margin-top:12px">${esc(s.notes)}</div>`:''}<div class="modal-actions"><button class="btn ghost modal-close">Cerrar</button>${historical&&s.historical_editable?'<button id="editHistoricalSale" class="btn primary">Editar venta</button>':''}${!historical&&s.status==='completed'&&s.stock_link_status==='pending'?`<button id="linkStockFromDetail" class="btn ghost">Vincular stock</button>`:''}${!historical&&s.status==='completed'?`<button id="cancelSaleFromDetail" class="btn danger-btn">Anular venta</button>`:''}</div>`);
      $('#editHistoricalSale')?.addEventListener('click',()=>openHistoricalSaleEditor(s));
      $('#linkStockFromDetail')?.addEventListener('click',()=>{closeModal();openQuickSaleStockLink(s.id)});
      $('#cancelSaleFromDetail')?.addEventListener('click',async()=>{const reason=prompt(`Motivo para anular ${s.sale_code}:`,'Error / devolución');if(reason===null)return;if(!confirm('Esto devolverá el stock y revertirá el efecto financiero. ¿Continuar?'))return;try{await DB.cancelSale(s.id,reason);closeModal();if(currentView==='finance')await renderFinance();else await renderSell()}catch(e){alert(e.message)}});
    }catch(e){alert(e.message)}
  }

  function historicalDateInput(value){
    if(!value)return '';
    const d=new Date(value),pad=n=>String(n).padStart(2,'0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function openHistoricalSaleEditor(sale){
    const items=(sale.items||[]).map(i=>({name:i.original_item_name||'',quantity:Number(i.quantity||1)}));
    const customerOptions=posCustomers.map(c=>`<option value="${c.id}" ${c.id===sale.customer_id?'selected':''}>${esc(c.full_name)}</option>`).join('');
    openModal(`<div class="section-title"><div><span class="eyebrow">EDITAR HISTÓRICA</span><h3>${esc(sale.sale_code)}</h3><p class="muted">Los cambios actualizan historial y Estadísticas. Nunca mueven stock ni caja actual.</p></div><button class="modal-close modal-x">×</button></div>
      <div class="form-grid">
        <label>Fecha y hora<input id="hsDate" type="datetime-local" value="${historicalDateInput(sale.sold_at)}"></label>
        <label>Cliente<select id="hsCustomer"><option value="">Consumidor final</option>${customerOptions}</select></label>
        <label>Subtotal<input id="hsSubtotal" type="number" min="0" step="0.01" value="${Number(sale.subtotal_ars||0)}"></label>
        <label>Descuento<input id="hsDiscount" type="number" min="0" step="0.01" value="${Number(sale.discount_ars||0)}"></label>
        <label>Tasa / ajuste<input id="hsFee" type="number" min="0" step="0.01" value="${Number(sale.fee_ars||0)}"></label>
        <label>Envío<input id="hsShipping" type="number" min="0" step="0.01" value="${Number(sale.shipping_ars||0)}"></label>
        <label>Total<input id="hsTotal" type="number" min="0" step="0.01" value="${Number(sale.total_ars||0)}"></label>
        <label>Ganancia<input id="hsProfit" type="number" step="0.01" value="${sale.profit_ars==null?'':Number(sale.profit_ars)}"></label>
        <label>Forma de pago<input id="hsPayment" value="${esc(sale.original_payment_method||'')}"></label>
        <label>Vendedor<input id="hsSeller" value="${esc(sale.seller_name||'')}"></label>
      </div>
      <label style="margin-top:12px">Observación<textarea id="hsNotes" rows="2">${esc(sale.notes||'')}</textarea></label>
      <div class="section-title" style="margin-top:16px"><div><span class="eyebrow">PRODUCTOS</span><h3>Detalle original</h3></div><button id="hsAddItem" class="btn tiny ghost" type="button">+ Producto</button></div>
      <div id="hsItems" class="list"></div>
      <div class="modal-actions"><button class="btn ghost modal-close">Cancelar</button><button id="hsSave" class="btn primary">Guardar cambios</button></div>`);

    const draw=()=>{
      const box=$('#hsItems');box.innerHTML=items.map((x,i)=>`<div class="row historical-item-row" data-i="${i}"><input class="hs-item-name" value="${esc(x.name)}" placeholder="Descripción del producto"><input class="hs-item-qty" type="number" min="0.01" step="0.01" value="${x.quantity}" style="max-width:90px"><button class="btn tiny danger-btn hs-remove-item" type="button">×</button></div>`).join('')||'<div class="empty compact-empty">Sin productos.</div>';
      box.querySelectorAll('.historical-item-row').forEach(row=>{
        const i=Number(row.dataset.i);
        row.querySelector('.hs-item-name').addEventListener('input',e=>items[i].name=e.target.value);
        row.querySelector('.hs-item-qty').addEventListener('input',e=>items[i].quantity=Number(e.target.value||1));
        row.querySelector('.hs-remove-item').addEventListener('click',()=>{items.splice(i,1);draw()});
      });
    };
    draw();
    $('#hsAddItem').addEventListener('click',()=>{items.push({name:'',quantity:1});draw()});
    $('#hsSave').addEventListener('click',async()=>{
      const soldAt=$('#hsDate').value;if(!soldAt)return alert('Ingresá fecha y hora');
      const payload={id:sale.id,soldAt:new Date(soldAt).toISOString(),customerId:$('#hsCustomer').value||null,subtotal:$('#hsSubtotal').value,discount:$('#hsDiscount').value,fee:$('#hsFee').value,shipping:$('#hsShipping').value,total:$('#hsTotal').value,profit:$('#hsProfit').value,paymentMethod:$('#hsPayment').value.trim(),sellerName:$('#hsSeller').value.trim(),notes:$('#hsNotes').value.trim(),items:items.filter(x=>x.name.trim()).map(x=>({name:x.name.trim(),quantity:Number(x.quantity||1)}))};
      if(Number(payload.total)<0)return alert('El total no puede ser negativo');
      const btn=$('#hsSave');btn.disabled=true;btn.textContent='Guardando…';
      try{await DB.updateHistoricalSale(payload);closeModal();await renderSell();const updated=posRecentSales.find(x=>x.id===sale.id);if(updated)await openSaleDetail(updated.id)}catch(e){alert(e.message);btn.disabled=false;btn.textContent='Guardar cambios'}
    });
  }

  function renderRecentSales(){
    const el=$('#recentSales');if(!el)return;
    const total=posRecentSales.length,totalPages=Math.max(1,Math.ceil(total/posRecentPageSize));
    posRecentPage=Math.min(Math.max(1,posRecentPage),totalPages);
    const from=(posRecentPage-1)*posRecentPageSize,to=Math.min(from+posRecentPageSize,total),visible=posRecentSales.slice(from,to);
    const pageWindow=()=>{if(totalPages<=7)return Array.from({length:totalPages},(_,i)=>i+1);const out=[1],a=Math.max(2,posRecentPage-1),b=Math.min(totalPages-1,posRecentPage+1);if(a>2)out.push("…");for(let i=a;i<=b;i++)out.push(i);if(b<totalPages-1)out.push("…");out.push(totalPages);return out};
    el.innerHTML=`<div class="table-wrap"><table class="table"><thead><tr><th>Venta</th><th>Fecha</th><th>Cliente</th><th>Pago</th><th>Total</th><th>Estado</th><th></th></tr></thead><tbody>${visible.map(s=>`<tr class="${s.status==='cancelled'?'sale-cancelled-row':''}"><td><button class="btn tiny ghost open-recent-sale" data-id="${s.id}">${esc(s.sale_code)}</button>${s.is_historical?' <span class="pill blue">HISTÓRICA</span>':''}${s.stock_link_status==='pending'?` <span class="pill stock-pending-pill">Stock pendiente</span>`:''}</td><td>${safeDate(s.sold_at)}</td><td>${esc(s.customer?.full_name||'Consumidor final')}</td><td>${esc(s.payments?.[0]?.method?.name||s.original_payment_method||'—')}</td><td>${money(s.total_ars)}</td><td>${statusPill(s.status)}</td><td><button class="btn tiny ghost open-recent-sale" data-id="${s.id}">Ver detalle</button> ${s.is_historical?'<button class="btn tiny primary edit-historical-sale" data-id="'+s.id+'">Editar</button>':s.status==='completed'?(s.stock_link_status==='pending'?`<button class="btn tiny ghost link-quick-sale" data-id="${s.id}">Vincular</button> `:'')+`<button class="btn tiny danger-btn cancel-sale" data-id="${s.id}" data-code="${esc(s.sale_code)}">Anular</button>`:''}</td></tr>`).join('')||'<tr><td colspan="7" class="empty">Aún no hay ventas en Central.</td></tr>'}</tbody></table></div>${total?`<div class="recent-sales-pagination"><small>Mostrando ${number(from+1)}–${number(to)} de ${number(total)} ventas</small><div class="recent-sales-pages"><button class="recent-page-arrow" data-recent-page="${posRecentPage-1}" ${posRecentPage<=1?"disabled":""} aria-label="Página anterior">←</button>${pageWindow().map(x=>x==="…"?`<span class="recent-page-ellipsis">…</span>`:`<button class="recent-page-number ${x===posRecentPage?"active":""}" data-recent-page="${x}">${x}</button>`).join("")}<button class="recent-page-arrow" data-recent-page="${posRecentPage+1}" ${posRecentPage>=totalPages?"disabled":""} aria-label="Página siguiente">→</button></div></div>`:""}`;
    el.querySelectorAll('.open-recent-sale').forEach(b=>b.addEventListener('click',()=>openSaleDetail(b.dataset.id)));
    el.querySelectorAll('.edit-historical-sale').forEach(b=>b.addEventListener('click',async()=>{try{const sale=await DB.saleDetail(b.dataset.id);openHistoricalSaleEditor(sale)}catch(e){alert(e.message)}}));
    el.querySelectorAll('.link-quick-sale').forEach(b=>b.addEventListener('click',()=>openQuickSaleStockLink(b.dataset.id)));
    el.querySelectorAll('.cancel-sale').forEach(b=>b.addEventListener('click',async()=>{const reason=prompt(`Motivo para anular ${b.dataset.code}:`,'Error / devolución');if(reason===null)return;if(!confirm('Esto devolverá el stock vinculado y revertirá el dinero en Finanzas. La venta seguirá visible como CANCELADA. ¿Continuar?'))return;try{await DB.cancelSale(b.dataset.id,reason);await renderSell()}catch(e){alert(e.message)}}));
    el.querySelectorAll("[data-recent-page]").forEach(b=>b.addEventListener("click",()=>{const page=Number(b.dataset.recentPage);if(!Number.isFinite(page)||page<1||page>totalPages||page===posRecentPage)return;posRecentPage=page;renderRecentSales();document.querySelector("#recentSales")?.scrollIntoView({behavior:"smooth",block:"start"})}));
  }

  /* -------------------- PRODUCTS -------------------- */
  let stockPage=1;
  const stockPageSize=25;
  async function renderProducts(q=''){
    const currentStock=window.__stockFilter||'all', currentCat=window.__stockCategory||'';
    const summaryFilters=window.__stockSummaryFilters instanceof Set?window.__stockSummaryFilters:new Set(window.__stockSummaryFilters||[]);
    window.__stockSummaryFilters=summaryFilters;
    const [cats,baseRows]=await Promise.all([DB.categoryRecords(),DB.products(q,currentCat,currentStock)]);
    let products=[...baseRows];
    if(summaryFilters.has('available')) products=products.filter(p=>p.variants.reduce((a,v)=>a+Number(v.stock.available||0),0)>0);
    if(summaryFilters.has('out')) products=products.filter(p=>p.variants.reduce((a,v)=>a+Number(v.stock.available||0),0)<=0);
    if(summaryFilters.has('no_image')) products=products.filter(p=>!p.thumbnail_url);
    if(stockSort.dir){
      const val=(p,key)=>key==='available'?p.variants.reduce((a,v)=>a+Number(v.stock.available||0),0):key==='variants'?p.variants.length:key==='price'?Math.min(...p.variants.map(v=>Number(v.price_ars||0)).filter(Boolean),0):key==='cost'?Math.min(...p.variants.map(v=>Number(v.cost_ars||0)).filter(Boolean),0):String(p.name||'').toLowerCase();
      products.sort((a,b)=>{const x=val(a,stockSort.key),y=val(b,stockSort.key);return (typeof x==='string'?x.localeCompare(y):x-y)*stockSort.dir});
    } else products.sort((a,b)=>String(a.name||'').localeCompare(String(b.name||''),'es',{sensitivity:'base'}));
    const stockTotalFiltered=products.length,stockTotalPages=Math.max(1,Math.ceil(stockTotalFiltered/stockPageSize));
    stockPage=Math.min(Math.max(1,stockPage),stockTotalPages);
    const stockFrom=(stockPage-1)*stockPageSize,stockTo=Math.min(stockFrom+stockPageSize,stockTotalFiltered),visibleProducts=products.slice(stockFrom,stockTo);
    const all=await DB.products('','','all');
    const totalStock=all.reduce((n,p)=>n+p.variants.reduce((a,v)=>a+Number(v.stock.available||0),0),0);
    const noPhoto=all.filter(p=>!p.thumbnail_url).length;
    const out=all.filter(p=>p.variants.reduce((a,v)=>a+Number(v.stock.available||0),0)<=0).length;
    const sortHead=(key,label)=>`<button class="stock-sort-head ${stockSort.key===key&&stockSort.dir?'active':''}" data-stock-sort="${key}">${label}<span>${stockSort.key===key&&stockSort.dir?(stockSort.dir===1?'↑':'↓'):'↕'}</span></button>`;
    content.innerHTML=`<div class="stock-commandbar">
      <button id="stockFilterBtn" class="btn ghost stock-command"><span class="stock-tool-icon">≡</span><span>Filtro</span>${currentStock!=='all'?'<b class="filter-dot"></b>':''}</button>
      <button id="stockCategoriesBtn" class="btn ghost stock-command"><svg class="stock-folder-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 6.5h6l2 2h9v10a2 2 0 0 1-2 2h-15z"/><path d="M3.5 8.5v-3a2 2 0 0 1 2-2h4l2 2h5"/></svg><span>Categorías</span></button>
      <div class="stock-command-spacer"></div><button id="newProductBtn" class="btn primary stock-add-product">＋ Producto</button>
    </div>
    <div class="stock-summary">
      <button class="stock-stat blue ${summaryFilters.size===0?'active':''}" data-summary-filter="all"><b>${number(all.length)}</b><small>Productos visibles</small></button>
      <button class="stock-stat green ${summaryFilters.has('available')?'active':''}" data-summary-filter="available"><b>${number(totalStock)}</b><small>Stock total</small></button>
      <button class="stock-stat red ${summaryFilters.has('out')?'active':''}" data-summary-filter="out"><b>${number(out)}</b><small>Sin stock</small></button>
      <button class="stock-stat orange ${summaryFilters.has('no_image')?'active':''}" data-summary-filter="no_image"><b>${number(noPhoto)}</b><small>Sin foto</small></button>
      ${currentCat?`<button id="clearStockCategory" class="stock-active-category">Categoría: ${esc(currentCat)} ×</button>`:''}
    </div>
    <div class="table-wrap"><table class="table"><thead><tr><th>Producto</th><th>Categoría</th><th>${sortHead('variants','Variantes')}</th><th>${sortHead('available','Disponible')}</th><th>En tránsito</th><th>${sortHead('cost','Costo')}</th><th>${sortHead('price','Precio')}</th><th></th></tr></thead><tbody>${visibleProducts.map(p=>{const av=p.variants.reduce((a,v)=>a+Number(v.stock.available||0),0),tr=p.variants.reduce((a,v)=>a+Number(v.stock.in_transit||0),0),prices=p.variants.map(v=>Number(v.price_ars||0)).filter(Boolean),costs=p.variants.map(v=>Number(v.cost_ars||0)).filter(Boolean),minPrice=prices.length?Math.min(...prices):0,minCost=costs.length?Math.min(...costs):0,costDanger=minCost>0&&minPrice>0&&minCost>=minPrice;return`<tr><td><b>${esc(p.name)}</b> ${!p.thumbnail_url?'<span class="pill yellow stock-no-photo">SIN FOTO</span>':''}<br><small class="muted">${esc(p.sku||'Sin SKU')}</small></td><td>${esc(p.category||'—')}${String(p.category||'').trim().toLowerCase()==='camisetas'?`<br><button class="btn tiny sleeve-toggle ${p.sleeve_type==='long'?'long':'short'}" data-id="${p.id}" data-sleeve="${p.sleeve_type==='long'?'long':'short'}" title="Cambiar tipo de manga">${p.sleeve_type==='long'?'MANGA LARGA':'MANGA CORTA'}</button>`:''}</td><td>${p.variants.length}</td><td><span class="pill ${av>0?'green':'red'}">${number(av)}</span></td><td>${tr?`<span class="pill blue">${number(tr)}</span>`:'0'}</td><td><span class="${costDanger?'stock-cost-danger':''}" ${costDanger?'title="Costo igual o superior al precio de venta"':''}>${minCost?money(minCost):'—'}</span></td><td>${minPrice?money(minPrice):'—'}</td><td><div class="stock-row-actions"><button class="btn tiny catalog-merch-toggle new ${p.new_arrival?'active':''}" data-merch="new_arrival" data-id="${p.id}" data-value="${p.new_arrival?'1':'0'}" title="Nuevo ingreso">🆕</button><button class="btn tiny catalog-merch-toggle featured ${p.featured?'active':''}" data-merch="featured" data-id="${p.id}" data-value="${p.featured?'1':'0'}" title="Destacado">★</button><button class="btn tiny ghost duplicate-product" data-id="${p.id}" title="Duplicar producto">⧉</button><button class="btn tiny ghost edit-product" data-id="${p.id}">Editar</button></div></td></tr>`}).join('')||'<tr><td colspan="8" class="empty">Sin resultados.</td></tr>'}</tbody></table></div>`;
    if(stockTotalFiltered){const nav=document.createElement('div');nav.className='stock-pagination';const pages=[];for(let i=1;i<=stockTotalPages;i++){if(stockTotalPages<=7||i===1||i===stockTotalPages||Math.abs(i-stockPage)<=1)pages.push(i);else if(pages[pages.length-1]!=='…')pages.push('…')}nav.innerHTML='<small>Mostrando '+number(stockFrom+1)+'–'+number(stockTo)+' de '+number(stockTotalFiltered)+' productos</small><div class="stock-pages"><button class="stock-page-arrow" data-stock-page="'+(stockPage-1)+'" '+(stockPage<=1?'disabled':'')+'>←</button>'+pages.map(x=>x==='…'?'<span class="stock-page-ellipsis">…</span>':'<button class="stock-page-number '+(x===stockPage?'active':'')+'" data-stock-page="'+x+'">'+x+'</button>').join('')+'<button class="stock-page-arrow" data-stock-page="'+(stockPage+1)+'" '+(stockPage>=stockTotalPages?'disabled':'')+'>→</button></div>';content.appendChild(nav);nav.querySelectorAll('[data-stock-page]').forEach(b=>b.addEventListener('click',()=>{const page=Number(b.dataset.stockPage);if(page<1||page>stockTotalPages||page===stockPage)return;stockPage=page;renderProducts($('#globalSearch').value);window.scrollTo({top:0,behavior:'smooth'})}))}
    $('#stockFilterBtn').addEventListener('click',()=>openStockFilters());$('#stockCategoriesBtn').addEventListener('click',()=>openCategoryManager());$('#newProductBtn').addEventListener('click',()=>openNewProduct());
    $('#clearStockCategory')?.addEventListener('click',()=>{window.__stockCategory='';renderProducts($('#globalSearch').value)});
    document.querySelectorAll('[data-summary-filter]').forEach(b=>b.addEventListener('click',()=>{stockPage=1;const key=b.dataset.summaryFilter;if(key==='all'){summaryFilters.clear()}else if(summaryFilters.has(key)){summaryFilters.delete(key)}else{if(key==='available')summaryFilters.delete('out');if(key==='out')summaryFilters.delete('available');summaryFilters.add(key)}renderProducts($('#globalSearch').value)}));
    document.querySelectorAll('[data-stock-sort]').forEach(b=>b.addEventListener('click',()=>{stockPage=1;const k=b.dataset.stockSort;if(stockSort.key!==k)stockSort={key:k,dir:-1};else if(stockSort.dir===-1)stockSort.dir=1;else stockSort={key:'',dir:0};renderProducts($('#globalSearch').value)}));
    document.querySelectorAll('.catalog-merch-toggle').forEach(b=>b.addEventListener('click',async()=>{const key=b.dataset.merch,next=b.dataset.value!=='1';b.disabled=true;try{await DB.saveProduct(b.dataset.id,{[key]:next});await renderProducts($('#globalSearch').value)}catch(e){alert(e.message);b.disabled=false}}));
    document.querySelectorAll('.sleeve-toggle').forEach(b=>b.addEventListener('click',async()=>{const next=b.dataset.sleeve==='long'?'short':'long';b.disabled=true;try{await DB.saveProduct(b.dataset.id,{sleeve_type:next});await renderProducts($('#globalSearch').value)}catch(e){alert(e.message);b.disabled=false}}));
    document.querySelectorAll('.edit-product').forEach(b=>b.addEventListener('click',()=>openProductEditor(b.dataset.id)));
    document.querySelectorAll('.duplicate-product').forEach(b=>b.addEventListener('click',async()=>{if(!confirm('¿Duplicar este producto para usarlo como base? La copia quedará oculta del catálogo hasta que la revises.'))return;try{const p=await DB.duplicateProduct(b.dataset.id);await renderProducts($('#globalSearch').value);await openProductEditor(p.id)}catch(e){alert(e.message)}}));
  }

  function openStockFilters(){
    const current=window.__stockFilter||'all',filters=[['all','Todo stock'],['available','Con stock'],['low','Stock bajo'],['out','Sin stock'],['transit','En tránsito'],['no_image','Sin foto']];
    openModal(`<div class="section-title"><div><span class="eyebrow">PRODUCTOS</span><h3>Filtrar</h3></div><button class="modal-close modal-x">×</button></div><div class="stock-filter-list">${filters.map(([v,l])=>`<button class="stock-filter-option ${current===v?'active':''}" data-stock-filter="${v}">${l}<span>›</span></button>`).join('')}</div>`);
    document.querySelectorAll('[data-stock-filter]').forEach(b=>b.addEventListener('click',async()=>{window.__stockFilter=b.dataset.stockFilter;stockPage=1;closeModal();await renderProducts($('#globalSearch').value)}));
  }

  async function openCategoryManager(){
    const cats=await DB.categoryRecords();
    openModal(`<div class="section-title category-manager-head"><div><span class="eyebrow">ORGANIZACIÓN</span><h3>Categorías</h3><small class="muted">En PC mantené presionado y arrastrá para definir la prioridad. Ese orden se usa en el catálogo.</small></div><button class="modal-close modal-x">×</button></div><div class="category-manager-list">${cats.map(c=>`<div class="category-manager-row" draggable="true" data-cat-id="${c.id}"><span class="category-drag" title="Arrastrar">⋮⋮</span><button class="category-pick ${window.__stockCategory===c.name?'active':''}" data-pick-cat="${esc(c.name)}"><span class="category-filter-check">${window.__stockCategory===c.name?'✓':''}</span><span>${esc(c.name)}</span></button><div class="category-row-actions"><button class="btn tiny ghost cat-edit" data-id="${c.id}" data-name="${esc(c.name)}" title="Editar nombre">✎</button><button class="btn tiny danger-btn cat-delete" data-id="${c.id}" data-name="${esc(c.name)}" title="Eliminar">×</button></div></div>`).join('')}</div><div class="category-manager-footer"><button id="addCategoryBtn" class="btn primary">＋ Nueva categoría</button></div>`);
    $('#addCategoryBtn').addEventListener('click',async()=>{const n=prompt('Nueva categoría:','');if(!n)return;try{await DB.createCategory(n);closeModal();await openCategoryManager()}catch(e){alert(e.message)}});
    document.querySelectorAll('[data-pick-cat]').forEach(b=>b.addEventListener('click',async()=>{const picked=b.dataset.pickCat||'';window.__stockCategory=(window.__stockCategory===picked)?'':picked;closeModal();await renderProducts($('#globalSearch').value)}));
    document.querySelectorAll('.cat-edit').forEach(b=>b.addEventListener('click',async()=>{const n=prompt('Nuevo nombre:',b.dataset.name);if(!n||n===b.dataset.name)return;try{await DB.renameCategory(b.dataset.id,b.dataset.name,n);closeModal();await openCategoryManager()}catch(e){alert(e.message)}}));
    document.querySelectorAll('.cat-delete').forEach(b=>b.addEventListener('click',async()=>{if(!confirm(`¿Eliminar la categoría "${b.dataset.name}"? Solo se permite si no tiene productos.`))return;try{await DB.deleteCategory(b.dataset.id,b.dataset.name);closeModal();await openCategoryManager()}catch(e){alert(e.message)}}));
    const list=document.querySelector('.category-manager-list');let dragged=null;
    list.querySelectorAll('.category-manager-row').forEach(row=>{row.addEventListener('dragstart',()=>{dragged=row;row.classList.add('dragging')});row.addEventListener('dragend',async()=>{row.classList.remove('dragging');dragged=null;const ids=[...list.querySelectorAll('.category-manager-row')].map(x=>x.dataset.catId);try{await DB.setCategoryOrder(ids)}catch(e){alert(e.message)}});row.addEventListener('dragover',e=>{e.preventDefault();if(!dragged||dragged===row)return;const r=row.getBoundingClientRect();list.insertBefore(dragged,e.clientY<r.top+r.height/2?row:row.nextSibling)})});
  }

  async function openNewProduct(){
    const cats=await DB.categories();
    const initialCat=cats[0]||'';
    const initialCamiseta=String(initialCat).trim().toLowerCase()==='camisetas';
    openModal(`<div class="section-title"><div><span class="eyebrow">STOCK</span><h3>Nuevo producto</h3></div><button class="modal-close modal-x">×</button></div>
      <div class="form-grid">
        <label>Nombre<input id="npName" placeholder="Nombre del producto"></label>
        <label>Categoría<select id="npCategory">${cats.map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join('')}</select></label>
        <label id="npSleeveWrap" class="${initialCamiseta?'':'hidden'}">Tipo de manga
          <select id="npSleeveType"><option value="short">MANGA CORTA</option><option value="long">MANGA LARGA</option></select>
        </label>
        <label>SKU general<input id="npSku" placeholder="Opcional"></label>
      </div>
      <div class="modal-actions"><button class="btn ghost modal-close">Cancelar</button><button id="createProductBtn" class="btn primary">Crear y editar</button></div>`);
    const syncNewSleeve=()=>$('#npSleeveWrap')?.classList.toggle('hidden',String($('#npCategory')?.value||'').trim().toLowerCase()!=='camisetas');
    $('#npCategory')?.addEventListener('change',syncNewSleeve);
    syncNewSleeve();
    $('#createProductBtn').addEventListener('click',async()=>{
      const name=$('#npName').value.trim();if(!name)return alert('Ingresá un nombre');
      const btn=$('#createProductBtn');btn.disabled=true;
      try{
        const category=$('#npCategory').value;
        const p=await DB.createProduct({
          name,
          category,
          sleeve_type:String(category||'').trim().toLowerCase()==='camisetas'?($('#npSleeveType').value||'short'):null,
          sku:$('#npSku').value.trim()||null
        });
        closeModal();await renderProducts($('#globalSearch').value);await openProductEditor(p.id);
      }catch(e){alert(e.message)}finally{btn.disabled=false}
    });
  }

  async function openProductEditor(productId){
    const [p,cats]=await Promise.all([DB.productDetail(productId),DB.categories()]);
    const vape=String(p.category||'').toLowerCase()==='vapers';
    const camiseta=String(p.category||'').trim().toLowerCase()==='camisetas';
    const totalAvailable=p.variants.reduce((a,v)=>a+Number(v.stock.available||0),0);
    const imageCards=(p.images||[]).map((img,i)=>`<div class="product-image-card ${img.is_primary?'primary':''} ${img.thumbnail_url?'optimized':''}" data-gallery-img="${img.id}" draggable="true"><span class="product-image-drag" title="Mantener y arrastrar">⋮⋮</span><span class="product-image-order">${i+1}</span><img src="${esc(img.thumbnail_url||img.image_url)}" alt="${esc(img.alt_text||p.name)}" draggable="false"><div class="product-image-actions">${img.is_primary?'<span class="pill green">Principal</span>':`<button class="btn tiny ghost set-primary-image" data-img="${img.id}">Principal</button>`}<button class="btn tiny danger-btn delete-product-image" data-img="${img.id}">Eliminar</button></div></div>`).join('');
    const rows=p.variants.map(v=>`<tr data-variant="${v.id}" data-current-stock="${Number(v.stock.on_hand||0)}"><td><input class="v-name" value="${esc(v.variant_name)}"></td><td><input class="v-sku" value="${esc(v.sku||'')}"></td><td><input class="v-cost" type="number" step="0.01" value="${Number(v.cost_ars||0)}"></td><td><input class="v-price" type="number" step="0.01" value="${Number(v.price_ars||0)}"></td><td><input class="v-min" type="number" step="1" value="${Number(v.stock_min||0)}"></td><td><input class="v-stock" type="number" min="0" step="1" value="${Number(v.stock.on_hand||0)}"><small class="muted variant-available-note">disp. ${number(v.stock.available)}</small></td><td><button class="btn tiny ghost adjust-stock" data-vid="${v.id}" data-current="${Number(v.stock.on_hand||0)}">Ajustar</button></td></tr>`).join('');
    openModal(`<div class="section-title"><div><span class="eyebrow">PRODUCTO</span><h3>Editar producto</h3><small class="muted">${number(totalAvailable)} unidades disponibles</small></div><button class="modal-close modal-x">×</button></div><div class="form-grid"><label>Nombre<input id="epName" value="${esc(p.name)}"></label><label>Categoría<select id="epCategory">${cats.map(c=>`<option value="${esc(c)}" ${c===p.category?'selected':''}>${esc(c)}</option>`).join('')}</select></label><label id="epSleeveWrap" class="${camiseta?'':'hidden'}">Tipo de manga<select id="epSleeveType"><option value="short" ${p.sleeve_type!=='long'?'selected':''}>MANGA CORTA</option><option value="long" ${p.sleeve_type==='long'?'selected':''}>MANGA LARGA</option></select></label><label>SKU general<input id="epSku" value="${esc(p.sku||'')}"></label><label class="check"><input id="epCatalog" type="checkbox" ${p.catalog_visible?'checked':''}> Visible en catálogo</label><label class="check merch-check new"><input id="epNewArrival" type="checkbox" ${p.new_arrival?'checked':''}> 🆕 Nuevo ingreso</label><label class="check merch-check featured"><input id="epFeatured" type="checkbox" ${p.featured?'checked':''}> ★ Destacado</label><label>Prioridad en inicio<input id="epCatalogPriority" type="number" min="1" max="999" step="1" value="${Number(p.catalog_priority||100)}"><small class="muted">1 aparece antes · 999 después</small></label></div><div class="section-title product-variant-title" style="margin-top:18px"><div><h3>${vape?'Sabores':'Variantes'}</h3><small class="muted">${vape?'Cada sabor comparte el mismo modelo de Vaper.':'Color, talle, modelo o número deben vivir como variantes del mismo producto.'}</small></div><div class="product-editor-actions"><button id="mergeProduct" class="btn ghost">Unificar otro producto</button><button id="addVariant" class="btn ghost">+ ${vape?'Sabores':'Variantes'}</button></div></div><div id="bulkVariantPanel" class="bulk-variant-panel hidden"><div class="bulk-variant-head"><div><b>Agregar varias ${vape?'sabores':'variantes'} de una vez</b><small>Escribí una por línea o separalas con coma. Después podés retocar stock, costo y precio directamente en la tabla.</small></div><button id="closeBulkVariants" class="btn tiny ghost" type="button">Cerrar</button></div><textarea id="bulkVariantNames" rows="5" placeholder="${vape?'Blue Razz\nStrawberry Ice\nWatermelon':'S\nM\nL\nXL'}"></textarea><div class="bulk-variant-defaults"><label>Stock inicial<input id="bulkVariantStock" type="number" min="0" step="1" value="0"></label><label>Costo inicial<input id="bulkVariantCost" type="number" min="0" step="0.01" value="0"></label><label>Precio inicial<input id="bulkVariantPrice" type="number" min="0" step="0.01" value="0"></label><button id="createBulkVariants" class="btn primary" type="button">Agregar todas</button></div></div><div class="table-wrap"><table class="table compact"><thead><tr><th>${vape?'Sabor':'Variante'}</th><th>SKU</th><th>Costo</th><th>Precio</th><th>Mín.</th><th>Stock físico</th><th></th></tr></thead><tbody>${rows||'<tr><td colspan="7" class="empty">Sin variantes.</td></tr>'}</tbody></table></div><div class="product-images-section"><div class="section-title"><div><h3>Fotos del catálogo</h3><small class="muted">Arrastrá las fotos cargadas para definir el orden de la galería. Funciona con mouse y también manteniendo presionado en el celular.</small></div></div><div id="productImageDropZone" class="product-image-dropzone" tabindex="0"><b>Arrastrá las fotos del producto acá</b><small>También podés hacer click para elegirlas · JPG, PNG, WEBP o AVIF · se optimizan antes de subir</small><span id="productUploadProgress" class="product-upload-progress"></span><input id="productImageUpload" type="file" accept="image/jpeg,image/png,image/webp,image/avif" multiple hidden></div><div class="product-image-grid">${imageCards||'<div class="empty">Todavía no hay fotos cargadas.</div>'}</div></div><div class="modal-actions product-modal-actions"><button id="deleteProduct" class="btn danger-btn">Eliminar producto</button><div class="modal-action-main"><button class="btn ghost modal-close">Cancelar</button><button id="saveProduct" class="btn primary">Guardar cambios</button></div></div>`);

    const syncEditorSleeve=()=>$('#epSleeveWrap')?.classList.toggle('hidden',String($('#epCategory')?.value||'').trim().toLowerCase()!=='camisetas');
    $('#epCategory')?.addEventListener('change',syncEditorSleeve);
    syncEditorSleeve();
    $('#saveProduct').addEventListener('click',async()=>{const btn=$('#saveProduct');btn.disabled=true;try{const cat=$('#epCategory').value;await DB.saveProduct(productId,{name:$('#epName').value.trim(),category:cat,sleeve_type:String(cat||'').trim().toLowerCase()==='camisetas'?($('#epSleeveType').value||'short'):null,sku:$('#epSku').value.trim()||null,catalog_visible:$('#epCatalog').checked,new_arrival:$('#epNewArrival').checked,featured:$('#epFeatured').checked,catalog_priority:Math.max(1,Math.min(999,Number($('#epCatalogPriority').value||100)))});for(const tr of document.querySelectorAll('[data-variant]')){const variant=tr.querySelector('.v-name').value.trim()||'Única';const payload={variant_name:variant,sku:tr.querySelector('.v-sku').value.trim()||null,cost_ars:Number(tr.querySelector('.v-cost').value||0),price_ars:Number(tr.querySelector('.v-price').value||0),stock_min:Number(tr.querySelector('.v-min').value||0)};if(cat.toLowerCase()==='vapers')payload.attributes={sabor:variant};await DB.saveVariant(tr.dataset.variant,payload);const currentStock=Number(tr.dataset.currentStock||0),nextStock=Number(tr.querySelector('.v-stock').value||0);if(!Number.isFinite(nextStock)||nextStock<0)throw new Error('Stock inválido en '+variant);if(nextStock!==currentStock)await DB.adjustStock(productId,tr.dataset.variant,currentStock,nextStock,'Conteo físico / edición masiva de variantes')}closeModal();await renderProducts($('#globalSearch').value)}catch(e){alert(e.message)}finally{btn.disabled=false}});
    document.querySelectorAll('.adjust-stock').forEach(b=>b.addEventListener('click',async()=>{const current=Number(b.dataset.current),val=prompt(`Stock físico actual: ${current}
Nueva cantidad física:`,String(current));if(val===null)return;const next=Number(val);if(!Number.isFinite(next)||next<0)return alert('Cantidad inválida');const note=prompt('Motivo:','Conteo físico / corrección manual')||'Ajuste manual';try{await DB.adjustStock(productId,b.dataset.vid,current,next,note);closeModal();await openProductEditor(productId)}catch(e){alert(e.message)}}));
    $('#addVariant').addEventListener('click',()=>{$('#bulkVariantPanel')?.classList.remove('hidden');$('#bulkVariantNames')?.focus()});$('#closeBulkVariants')?.addEventListener('click',()=>$('#bulkVariantPanel')?.classList.add('hidden'));$('#createBulkVariants')?.addEventListener('click',async()=>{const raw=$('#bulkVariantNames')?.value||'';const names=[...new Set(raw.split(/[\n,;]+/).map(x=>x.trim()).filter(Boolean))];if(!names.length)return alert('Ingresá al menos una variante');const existing=new Set(p.variants.map(v=>String(v.variant_name||'').trim().toLowerCase()));const pending=names.filter(name=>!existing.has(name.toLowerCase()));if(!pending.length)return alert('Todas esas variantes ya existen');const stock=Number($('#bulkVariantStock').value||0),cost=Number($('#bulkVariantCost').value||0),price=Number($('#bulkVariantPrice').value||0);if([stock,cost,price].some(x=>!Number.isFinite(x)||x<0))return alert('Stock, costo o precio inválido');const btn=$('#createBulkVariants');btn.disabled=true;btn.textContent=`Agregando 0/${pending.length}…`;try{for(let i=0;i<pending.length;i++){const name=pending[i];btn.textContent=`Agregando ${i+1}/${pending.length}…`;await DB.createVariant(productId,{variant_name:name,cost_ars:cost,price_ars:price,stock_min:0,active:true,attributes:vape?{sabor:name}:{opcion:name}},stock,'Alta masiva de variantes')}closeModal();await openProductEditor(productId)}catch(e){alert(e.message);btn.disabled=false;btn.textContent='Agregar todas'}});
    const imageInput=$('#productImageUpload'),dropZone=$('#productImageDropZone'),progress=$('#productUploadProgress');
    const uploadImages=async files=>{files=[...files].filter(f=>f?.type?.startsWith('image/'));if(!files.length)return;const hadPrimary=(p.images||[]).some(x=>x.is_primary);try{dropZone.classList.add('drag');for(let i=0;i<files.length;i++){progress.textContent=`Optimizando y subiendo ${i+1} / ${files.length}: ${files[i].name}`;await DB.uploadProductImage(productId,files[i],!hadPrimary&&i===0)}progress.textContent='✓ Fotos optimizadas y guardadas';setTimeout(async()=>{closeModal();await openProductEditor(productId)},250)}catch(err){dropZone.classList.remove('drag');progress.textContent='';alert(err.message)}};
    imageInput?.addEventListener('change',e=>{const files=[...(e.target.files||[])];e.target.value='';uploadImages(files)});
    dropZone?.addEventListener('click',()=>imageInput?.click());dropZone?.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();imageInput?.click()}});
    ['dragenter','dragover'].forEach(ev=>dropZone?.addEventListener(ev,e=>{e.preventDefault();dropZone.classList.add('drag')}));
    ['dragleave','drop'].forEach(ev=>dropZone?.addEventListener(ev,e=>{e.preventDefault();if(ev==='dragleave')dropZone.classList.remove('drag')}));
    dropZone?.addEventListener('drop',e=>uploadImages(e.dataTransfer?.files||[]));
    const gallery=$('.product-image-grid');
    if(gallery){
      let dragCard=null,touchCard=null,touchTimer=null,touchActive=false;
      const persistGalleryOrder=async()=>{const ids=[...gallery.querySelectorAll('[data-gallery-img]')].map(x=>x.dataset.galleryImg);gallery.querySelectorAll('[data-gallery-img]').forEach((x,i)=>{const n=x.querySelector('.product-image-order');if(n)n.textContent=i+1});try{await DB.setProductImageOrder(productId,ids)}catch(e){alert(e.message)}};
      const placeCard=(card,x,y)=>{const others=[...gallery.querySelectorAll('[data-gallery-img]')].filter(el=>el!==card);let target=null,before=false,best=Infinity;for(const el of others){const r=el.getBoundingClientRect(),cx=r.left+r.width/2,cy=r.top+r.height/2,d=Math.hypot(x-cx,y-cy);if(d<best){best=d;target=el;before=(y<cy)||(Math.abs(y-cy)<r.height*.45&&x<cx)}}if(target)gallery.insertBefore(card,before?target:target.nextSibling)};
      gallery.querySelectorAll('[data-gallery-img]').forEach(card=>{
        card.addEventListener('dragstart',e=>{dragCard=card;card.classList.add('dragging');e.dataTransfer.effectAllowed='move'});
        card.addEventListener('dragend',async()=>{card.classList.remove('dragging');dragCard=null;await persistGalleryOrder()});
        card.addEventListener('dragover',e=>{e.preventDefault();if(dragCard)placeCard(dragCard,e.clientX,e.clientY)});
        card.addEventListener('touchstart',e=>{if(e.target.closest('button'))return;touchCard=card;touchTimer=setTimeout(()=>{touchActive=true;card.classList.add('dragging','touch-dragging');if(navigator.vibrate)navigator.vibrate(20)},320)},{passive:true});
        card.addEventListener('touchmove',e=>{if(!touchActive||touchCard!==card)return;e.preventDefault();const t=e.touches[0];placeCard(card,t.clientX,t.clientY)},{passive:false});
        const finishTouch=async()=>{clearTimeout(touchTimer);touchTimer=null;if(touchActive&&touchCard===card){card.classList.remove('dragging','touch-dragging');touchActive=false;touchCard=null;await persistGalleryOrder()}else{touchActive=false;touchCard=null}};
        card.addEventListener('touchend',finishTouch);card.addEventListener('touchcancel',finishTouch);
      });
    }
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
    const all=await DB.customers(q);let rows=[...all];
    if(customerFilter==='receivable')rows=rows.filter(c=>Number(c.pending_receivable_ars)>0);
    if(customerFilter==='club')rows=rows.filter(c=>Number(c.active_clubs)>0);
    if(customerFilter==='buyers')rows=rows.filter(c=>Number(c.completed_sales)>0);
    if(customerSort.dir){const k=customerSort.key;rows.sort((a,b)=>(Number(a[k]||0)-Number(b[k]||0))*customerSort.dir)}
    const totalSpent=all.reduce((a,c)=>a+Number(c.total_spent_ars||0),0),receivable=all.reduce((a,c)=>a+Number(c.pending_receivable_ars||0),0),clubCount=all.filter(c=>Number(c.active_clubs)>0).length;
    const sh=(key,label)=>`<button class="stock-sort-head ${customerSort.key===key&&customerSort.dir?'active':''}" data-customer-sort="${key}">${label}<span>${customerSort.key===key&&customerSort.dir?(customerSort.dir===1?'↑':'↓'):'↕'}</span></button>`;
    content.innerHTML=`<div class="module-switch"><button class="active" data-combined-view="customers">Clientes</button><button data-combined-view="club">Club</button></div><div class="section-title"><div><span class="eyebrow">CLIENTE 360°</span><h3>Clientes</h3><p class="muted">Ventas, deuda, Club y datos personales en una sola ficha.</p></div><button id="addCustomer" class="btn primary">+ Cliente</button></div>
    <div class="customer-summary">
      <button data-customer-filter="all" class="${customerFilter==='all'?'active':''}"><b>${number(all.length)}</b><small>Todos</small></button>
      <button data-customer-filter="buyers" class="${customerFilter==='buyers'?'active':''}"><b>${money(totalSpent)}</b><small>Total gastado</small></button>
      <button data-customer-filter="receivable" class="${customerFilter==='receivable'?'active':''}"><b>${money(receivable)}</b><small>A cobrar</small></button>
      <button data-customer-filter="club" class="${customerFilter==='club'?'active':''}"><b>${number(clubCount)}</b><small>Con Club</small></button>
    </div>
    <div class="table-wrap"><table class="table"><thead><tr><th>Cliente</th><th>${sh('completed_sales','Compras')}</th><th>${sh('total_spent_ars','Total gastado')}</th><th>${sh('pending_receivable_ars','A cobrar')}</th><th class="club-crown-head">Club</th><th>Última compra</th><th></th></tr></thead><tbody>${rows.map(c=>{const incomplete=c.source==='quick_sale'||c.source_payload?.incomplete_profile||!c.phone||!c.address;return`<tr class="${incomplete?'customer-incomplete-row':''}"><td><b>${esc(c.full_name)}</b>${incomplete?' <span class="pill customer-incomplete-pill">Completar ficha</span>':''}<br><small class="muted">${esc(c.member_code||c.customer_code||c.source||'')}</small></td><td>${number(c.completed_sales)}</td><td>${money(c.total_spent_ars)}</td><td>${Number(c.pending_receivable_ars)>0?`<span class="pill yellow">${money(c.pending_receivable_ars)}</span>`:'—'}</td><td class="club-crown-cell">${Number(c.active_clubs)>0?`<span class="club-crowns" title="${number(c.active_clubs)} club(es)">${'👑'.repeat(Math.max(1,Number(c.active_clubs)||1))}</span>`:'<span class="club-none">—</span>'}</td><td>${c.last_sale_at?safeDate(c.last_sale_at):'—'}</td><td><button class="btn tiny ghost open-customer360" data-id="${c.id}">Abrir ficha</button></td></tr>`}).join('')||'<tr><td colspan="7" class="empty">Sin clientes.</td></tr>'}</tbody></table></div>`;
    document.querySelectorAll('[data-combined-view]').forEach(b=>b.addEventListener('click',()=>setView(b.dataset.combinedView)));
    document.querySelectorAll('[data-customer-filter]').forEach(b=>b.addEventListener('click',()=>{customerFilter=b.dataset.customerFilter;renderCustomers($('#globalSearch').value)}));
    document.querySelectorAll('[data-customer-sort]').forEach(b=>b.addEventListener('click',()=>{const k=b.dataset.customerSort;if(customerSort.key!==k)customerSort={key:k,dir:-1};else if(customerSort.dir===-1)customerSort.dir=1;else customerSort={key:'',dir:0};renderCustomers($('#globalSearch').value)}));
    $('#addCustomer').addEventListener('click',()=>openCustomerEditor());document.querySelectorAll('.open-customer360').forEach(b=>b.addEventListener('click',()=>openCustomer360(b.dataset.id)));
  }
  function openCustomerEditor(customer=null,fromPos=false){
    openModal(`<div class="section-title"><div><span class="eyebrow">CLIENTE</span><h3>${customer?'Editar':'Nuevo'} cliente</h3></div><button class="modal-close">×</button></div><div class="form-grid"><label>Nombre<input id="cuName" value="${esc(customer?.full_name||'')}"></label><label>Teléfono<input id="cuPhone" value="${esc(customer?.phone||'')}"></label><label>Email<input id="cuEmail" type="email" value="${esc(customer?.email||'')}"></label><label>Instagram<input id="cuInstagram" value="${esc(customer?.instagram_username||'')}"></label><label>Dirección<input id="cuAddress" value="${esc(customer?.address||'')}"></label><label>Documento<input id="cuDoc" value="${esc(customer?.document_number||'')}"></label></div><label style="margin-top:12px">Notas<textarea id="cuNotes" rows="3">${esc(customer?.notes||'')}</textarea></label>${customer?`<section class="customer-admin-zone"><div><span class="eyebrow">ADMINISTRACIÓN</span><h4>Gestionar ficha</h4><p class="muted">Unificá duplicados o retiralos de la base activa sin romper ventas, deuda ni Club.</p></div><div class="customer-admin-actions"><button id="mergeCustomerBtn" class="btn ghost">Unificar cliente</button><button id="archiveCustomerBtn" class="btn ghost">Archivar</button><button id="deleteCustomerBtn" class="btn danger-btn">Eliminar</button></div></section>`:''}<div class="modal-actions"><button class="btn ghost modal-close">Cancelar</button><button id="saveCustomer" class="btn primary">Guardar cliente</button></div>`);
    $('#saveCustomer').addEventListener('click',async()=>{const payload={full_name:$('#cuName').value.trim(),phone:$('#cuPhone').value.trim()||null,email:$('#cuEmail').value.trim()||null,instagram_username:$('#cuInstagram').value.trim()||null,address:$('#cuAddress').value.trim()||null,document_number:$('#cuDoc').value.trim()||null,notes:$('#cuNotes').value.trim()||null};if(!payload.full_name)return alert('Ingresá el nombre');try{if(customer)await DB.updateCustomer(customer.id,payload);else await DB.createCustomer(payload);closeModal();if(fromPos)await renderSell();else await renderCustomers($('#globalSearch').value)}catch(e){alert(e.message)}});
    $('#mergeCustomerBtn')?.addEventListener('click',()=>openMergeCustomer(customer));
    $('#archiveCustomerBtn')?.addEventListener('click',async()=>{const reason=prompt('Motivo para archivar esta ficha:','Duplicado / cliente inactivo');if(reason===null)return;if(!confirm('La ficha dejará de aparecer en Clientes, pero se conserva todo su historial. ¿Continuar?'))return;try{await DB.archiveCustomer(customer.id,reason);closeModal();await renderCustomers($('#globalSearch').value)}catch(e){alert(e.message)}});
    $('#deleteCustomerBtn')?.addEventListener('click',async()=>{if(!confirm('Eliminar solo es posible si la ficha no tiene ventas, deuda ni Club. ¿Intentar eliminar?'))return;try{await DB.deleteCustomerSafe(customer.id);closeModal();await renderCustomers($('#globalSearch').value)}catch(e){alert(e.message)}});
  }

  async function openMergeCustomer(source){
    const all=(await DB.customers('')).filter(x=>x.id!==source.id);
    openModal(`<div class="section-title"><div><span class="eyebrow">UNIFICAR CLIENTE</span><h3>${esc(source.full_name)}</h3><p class="muted">Elegí la ficha definitiva. Las ventas, deudas y Club se trasladan al cliente seleccionado; la ficha origen queda archivada.</p></div><button class="modal-close modal-x">×</button></div><label>Buscar ficha destino<input id="mergeCustomerSearch" placeholder="Nombre, teléfono, Instagram…"></label><div id="mergeCustomerResults" class="merge-customer-list"></div><div id="mergeCustomerSummary" class="notice" style="margin-top:12px">Todavía no seleccionaste una ficha destino.</div><div class="modal-actions"><button class="btn ghost modal-close">Cancelar</button><button id="confirmCustomerMerge" class="btn primary" disabled>Unificar fichas</button></div>`);
    let target=null;
    const renderList=()=>{const q=$('#mergeCustomerSearch').value.trim().toLowerCase();const rows=all.filter(x=>!q||[x.full_name,x.phone,x.instagram_username,x.member_code,x.customer_code].join(' ').toLowerCase().includes(q)).slice(0,60);$('#mergeCustomerResults').innerHTML=rows.map(x=>`<button class="merge-customer-row ${target?.id===x.id?'selected':''}" data-id="${x.id}"><span><b>${esc(x.full_name)}</b><small>${esc(x.phone||x.instagram_username||x.member_code||'Sin datos extra')}</small></span><span><b>${number(x.completed_sales||0)} compras</b><small>${Number(x.active_clubs||0)?'👑'.repeat(Number(x.active_clubs)):''}</small></span></button>`).join('')||'<div class="empty compact-empty">Sin coincidencias.</div>';document.querySelectorAll('.merge-customer-row').forEach(b=>b.addEventListener('click',()=>{target=all.find(x=>x.id===b.dataset.id);$('#confirmCustomerMerge').disabled=!target;$('#mergeCustomerSummary').innerHTML=target?`<b>Destino:</b> ${esc(target.full_name)} · ${number(target.completed_sales||0)} compras · ${number(target.active_clubs||0)} club(es)`:'Seleccioná destino';renderList()}));};
    $('#mergeCustomerSearch').addEventListener('input',renderList);renderList();
    $('#confirmCustomerMerge').addEventListener('click',async()=>{if(!target)return;if(!confirm(`¿Unificar ${source.full_name} dentro de ${target.full_name}? Esta operación preserva trazabilidad.`))return;const btn=$('#confirmCustomerMerge');btn.disabled=true;btn.textContent='Unificando…';try{await DB.mergeCustomers(target.id,source.id);closeModal();await renderCustomers($('#globalSearch').value);setTimeout(()=>openCustomer360(target.id),80)}catch(e){alert(e.message);btn.disabled=false;btn.textContent='Unificar fichas'}});
  }


  /* -------------------- PHASE 6 · CUSTOMER 360 + CLUB -------------------- */
  const clubLabels={vapers:'Club Vapers',jerseys:'Club Jerseys',perfumes:'Club Perfumes',importb2b:'Club IMPORTB2B'};
  const clubLabel=t=>clubLabels[t]||t;

  async function openCustomer360(customerId,tab='summary'){
    const data=await DB.customer360(customerId),c=data.customer;
    const publicLink=data.profile?`${location.origin}/club/${data.profile.access_token}`:null;
    openModal(`<div class="customer360-shell"><div class="section-title customer360-head"><div><span class="eyebrow">CLIENTE 360°</span><h3>${esc(c.full_name)}</h3><p class="muted">${esc(c.phone||'Sin teléfono')} ${c.instagram_username?`· @${esc(String(c.instagram_username).replace(/^@/,''))}`:''}</p></div><div class="customer360-head-actions">${data.profile?`<span class="pill red">${esc(data.profile.member_code)}</span><button id="copyClubLink" class="btn ghost">Copiar Club</button>`:''}<button id="editCustomer360" class="btn ghost">Editar</button><button class="modal-close modal-x">×</button></div></div><div class="customer360-tabs"><button data-c360-tab="summary" class="${tab==='summary'?'active':''}">Resumen</button><button data-c360-tab="purchases" class="${tab==='purchases'?'active':''}">Compras</button><button data-c360-tab="debts" class="${tab==='debts'?'active':''}">Deudas</button><button data-c360-tab="club" class="${tab==='club'?'active':''}">Club</button><button data-c360-tab="data" class="${tab==='data'?'active':''}">Datos</button></div><div id="customer360Body">${customer360TabHtml(data,tab)}</div></div>`);
    document.querySelectorAll('[data-c360-tab]').forEach(b=>b.addEventListener('click',()=>openCustomer360(customerId,b.dataset.c360Tab)));
    $('#editCustomer360')?.addEventListener('click',()=>openCustomerEditor(c));
    $('#copyClubLink')?.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(publicLink);alert('Enlace del Club copiado')}catch{prompt('Copiá este enlace:',publicLink)}});
    bindCustomer360Actions(data,tab);
  }

  function customer360TabHtml(data,tab){
    const c=data.customer;
    if(tab==='summary'){
      return `<div class="customer360-stats"><div><small>Compras</small><b>${number(c.completed_sales)}</b></div><div><small>Total gastado</small><b>${money(c.total_spent_ars)}</b></div><div><small>Ganancia bruta</small><b class="positive">${money(c.gross_profit_ars)}</b></div><div><small>A cobrar</small><b class="${Number(c.pending_receivable_ars)>0?'negative':''}">${money(c.pending_receivable_ars)}</b></div></div><div class="customer360-grid"><section class="card"><div class="section-title"><div><span class="eyebrow">ÚLTIMAS COMPRAS</span><h3>Actividad comercial</h3></div></div><div class="c360-list">${data.sales.slice(0,5).map(s=>`<div class="c360-row"><span><b>${esc(s.sale_code)}</b><small>${safeDate(s.sold_at)} · ${esc(s.original_payment_method||'')}</small></span><strong>${money(s.total_ars)}</strong></div>`).join('')||'<div class="empty">Sin ventas Central.</div>'}</div></section><section class="card"><div class="section-title"><div><span class="eyebrow">CLUB</span><h3>Estado</h3></div></div>${data.memberships.filter(x=>x.active).length?`<div class="club-mini-list">${data.memberships.filter(x=>x.active).map(m=>`<div><span>${esc(clubLabel(m.club_type))}</span><b>${number(m.points)} pts</b></div>`).join('')}</div>`:'<div class="empty compact-empty">Todavía no pertenece a ningún Club.</div>'}${Number(c.pending_rewards)>0?`<div class="notice good-notice" style="margin-top:10px">${number(c.pending_rewards)} premio(s) pendiente(s) de entrega.</div>`:''}</section></div>`;
    }
    if(tab==='purchases'){
      return `<div class="card"><div class="section-title"><div><span class="eyebrow">COMPRAS</span><h3>Historial de ventas</h3></div></div><div class="c360-list">${data.sales.map(s=>`<details class="c360-sale"><summary><span><b>${esc(s.sale_code)}</b><small>${safeDate(s.sold_at)} · ${esc(s.original_payment_method||'')}</small></span><strong>${money(s.total_ars)}</strong></summary><div class="c360-sale-body">${s.items.map(i=>`<div><span>${esc(i.original_item_name)} × ${number(i.quantity)}</span><b>${money(i.line_total_ars)}</b></div>`).join('')||'<span class="muted">Sin detalle.</span>'}</div></details>`).join('')||'<div class="empty">Sin ventas Central.</div>'}</div></div>`;
    }
    if(tab==='debts'){
      return `<div class="card"><div class="section-title"><div><span class="eyebrow">CUENTA CORRIENTE</span><h3>Dinero a cobrar</h3></div></div><div class="c360-list">${data.receivables.map(r=>`<div class="c360-debt"><span><b>${esc(r.sale_code||r.description||'Cuenta por cobrar')}</b><small>${esc(r.items_summary||r.description||'')} ${r.due_at?`· vence ${esc(r.due_at)}`:''}</small></span><div><small>Pagado ${money(r.paid_amount)}</small><b>${money(r.pending_amount)}</b></div></div>`).join('')||'<div class="empty">Sin deuda pendiente.</div>'}</div></div>`;
    }
    if(tab==='club'){
      const active=data.memberships.filter(x=>x.active), missing=['vapers','jerseys','perfumes','importb2b'].filter(t=>!active.some(m=>m.club_type===t));
      const claims=data.claims.filter(x=>x.status==='pending');
      return `<div class="club-c360-head"><div><span class="eyebrow">FIDELIZACIÓN</span><h3>Club IMPORTB2B</h3><p class="muted">1 punto = compra + historia etiquetando a IMPORTB2B, verificadas por el equipo.</p></div><div class="customer360-head-actions">${missing.length?`<button id="addClubMembership" class="btn ghost">+ Agregar Club</button>`:''}${data.profile?`<button id="copyClubLinkBody" class="btn primary">Compartir tarjeta</button>`:''}</div></div><div class="club-membership-grid">${active.map(m=>membershipCardHtml(m,data)).join('')||'<div class="card empty">Este cliente todavía no tiene membresías.</div>'}</div>${claims.length?`<section class="card" style="margin-top:14px"><div class="section-title"><div><span class="eyebrow">PENDIENTES</span><h3>Premios por entregar</h3></div></div><div class="club-claims">${claims.map(x=>`<div class="club-claim-row"><span><b>${esc(x.reward_name)}</b><small>${esc(clubLabel(x.club_type))} · meta ${x.milestone} pts</small></span><button class="btn tiny good deliver-club-reward" data-id="${x.id}">Marcar entregado</button></div>`).join('')}</div></section>`:''}<section class="card" style="margin-top:14px"><div class="section-title"><div><span class="eyebrow">TRAZABILIDAD</span><h3>Historial del Club</h3></div></div><div class="club-history-list">${(data.events||[]).slice(0,40).map(e=>`<div class="club-history-row"><span><b>${esc(e.description)}</b><small>${esc(e.event_type)} · ${safeDate(e.occurred_at)}</small></span></div>`).join('')||'<div class="empty compact-empty">Sin eventos históricos.</div>'}</div></section>`;
    }
    return `<div class="customer360-grid"><section class="card"><div class="section-title"><div><span class="eyebrow">CONTACTO</span><h3>Datos del cliente</h3></div></div><div class="data-kv"><div><small>Nombre</small><b>${esc(c.full_name)}</b></div><div><small>Teléfono</small><b>${esc(c.phone||'—')}</b></div><div><small>Email</small><b>${esc(c.email||'—')}</b></div><div><small>Instagram</small><b>${esc(c.instagram_username||'—')}</b></div><div><small>Dirección</small><b>${esc(c.address||'—')}</b></div><div><small>Documento</small><b>${esc(c.document_number||'—')}</b></div></div></section><section class="card"><div class="section-title"><div><span class="eyebrow">NOTAS</span><h3>Información interna</h3></div></div><p>${esc(c.notes||'Sin notas.')}</p><button id="editCustomerData" class="btn ghost">Editar datos</button></section></div>`;
  }

  function membershipCardHtml(m,data){
    const rules=data.rules.filter(r=>r.club_type===m.club_type),next=rules.find(r=>Number(r.milestone)>Number(m.points));
    const pct=next?Math.min(100,Math.round(Number(m.points)/Number(next.milestone)*100)):100;
    return `<article class="club-membership card"><div class="club-membership-title"><span><small>${esc(clubLabel(m.club_type))}</small><b>${number(m.points)} puntos</b></span><div class="club-point-actions"><button class="btn tiny ghost adjust-club-points" data-membership="${m.id}">Ajustar</button><button class="btn tiny primary add-club-point" data-club="${m.club_type}">+1 punto</button></div></div><div class="club-progress"><i style="width:${pct}%"></i></div><small>${next?`Próximo: ${esc(next.reward_name)} a los ${next.milestone} pts`:'Todas las metas configuradas alcanzadas'}</small><div class="club-reward-chips">${rules.map(r=>{const claim=data.claims.find(c=>c.club_type===m.club_type&&Number(c.milestone)===Number(r.milestone));const status=claim?.status==='delivered'?'Entregado':Number(m.points)>=Number(r.milestone)?'Desbloqueado':'Bloqueado';return`<span class="reward-chip ${status==='Entregado'?'done':status==='Desbloqueado'?'unlocked':''}"><b>${r.milestone}</b> ${esc(r.reward_name)} · ${status}</span>`}).join('')}</div></article>`;
  }

  function bindCustomer360Actions(data,tab){
    if(tab==='data')$('#editCustomerData')?.addEventListener('click',()=>openCustomerEditor(data.customer));
    if(tab!=='club')return;
    $('#addClubMembership')?.addEventListener('click',()=>openAddClubMembership(data));
    const publicLink=data.profile?`${location.origin}/club/${data.profile.access_token}`:null;
    $('#copyClubLinkBody')?.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(publicLink);alert('Enlace del Club copiado')}catch{prompt('Copiá este enlace:',publicLink)}});
    document.querySelectorAll('.add-club-point').forEach(b=>b.addEventListener('click',()=>openRegisterClubPoint(data,b.dataset.club)));
    document.querySelectorAll('.adjust-club-points').forEach(b=>b.addEventListener('click',()=>openAdjustClubPoints(data,b.dataset.membership)));
    document.querySelectorAll('.deliver-club-reward').forEach(b=>b.addEventListener('click',async()=>{if(!confirm('¿Marcar este premio como entregado?'))return;const note=prompt('Nota opcional:','')||'';try{await DB.deliverClubReward(b.dataset.id,note);await openCustomer360(data.customer.id,'club')}catch(e){alert(e.message)}}));
  }

  function openAdjustClubPoints(data,membershipId){
    const m=data.memberships.find(x=>x.id===membershipId);if(!m)return;
    openModal(`<div class="section-title"><div><span class="eyebrow">${esc(clubLabel(m.club_type))}</span><h3>Ajustar puntos</h3><p class="muted">Corregí un valor erróneo sin borrar el historial. Los premios entregados nunca se eliminan.</p></div><button class="modal-close modal-x">×</button></div><div class="club-adjust-current"><small>Puntos actuales</small><b>${number(m.points)}</b></div><div class="form-grid"><label>Nuevo total de puntos<input id="clubNewPoints" type="number" min="0" step="1" value="${Number(m.points||0)}"></label><label>Motivo del ajuste<input id="clubAdjustReason" placeholder="Ej: punto cargado por error"></label></div><div class="notice" style="margin-top:12px">Si bajás de una meta, los premios pendientes que ya no correspondan vuelven a bloquearse. Los premios ya entregados permanecen registrados.</div><div class="modal-actions"><button class="btn ghost modal-close">Cancelar</button><button id="saveClubAdjustment" class="btn primary">Guardar ajuste</button></div>`);
    $('#saveClubAdjustment').addEventListener('click',async()=>{const pts=Number($('#clubNewPoints').value),reason=$('#clubAdjustReason').value.trim();if(!Number.isInteger(pts)||pts<0)return alert('Ingresá un total de puntos válido');if(!reason)return alert('Indicá el motivo del ajuste');if(!confirm(`Cambiar ${m.points} → ${pts} puntos en ${clubLabel(m.club_type)}?`))return;try{await DB.adjustClubPoints(m.id,pts,reason);closeModal();await openCustomer360(data.customer.id,'club')}catch(e){alert(e.message)}});
  }

  function openAddClubMembership(data){
    const active=data.memberships.filter(x=>x.active).map(x=>x.club_type),missing=['vapers','jerseys','perfumes','importb2b'].filter(x=>!active.includes(x));
    if(!missing.length)return alert('El cliente ya pertenece a todos los clubes.');
    openModal(`<div class="section-title"><div><span class="eyebrow">CLUB</span><h3>Agregar membresía</h3></div><button class="modal-close modal-x">×</button></div><label>Club<select id="newClubType">${missing.map(x=>`<option value="${x}">${esc(clubLabel(x))}</option>`).join('')}</select></label><div class="modal-actions"><button class="btn ghost modal-close">Cancelar</button><button id="saveClubMembership" class="btn primary">Agregar Club</button></div>`);
    $('#saveClubMembership').addEventListener('click',async()=>{try{await DB.addCustomerClub(data.customer.id,$('#newClubType').value);closeModal();await openCustomer360(data.customer.id,'club')}catch(e){alert(e.message)}});
  }

  function openRegisterClubPoint(data,clubType){
    const used=new Set(data.actions.filter(a=>a.club_type===clubType&&a.sale_id).map(a=>a.sale_id));
    const sales=data.sales.filter(s=>s.status==='completed'&&!used.has(s.id));
    openModal(`<div class="section-title"><div><span class="eyebrow">${esc(clubLabel(clubType))}</span><h3>Compra + historia verificada</h3></div><button class="modal-close modal-x">×</button></div><div class="notice good-notice">Este botón suma el punto inmediatamente. Usalo solo cuando la historia etiquetando a IMPORTB2B ya esté verificada.</div><label style="margin-top:12px">Venta vinculada<select id="clubSale"><option value="">Registro manual / sin venta Central</option>${sales.map(s=>`<option value="${s.id}" data-total="${Number(s.total_ars||0)}">${esc(s.sale_code)} · ${money(s.total_ars)} · ${safeDate(s.sold_at)}</option>`).join('')}</select></label><div class="form-grid"><label>Monto de compra<input id="clubAmount" type="number" min="0" placeholder="${clubType==='importb2b'?'Mínimo 30000':'Opcional'}"></label><label>Observación<input id="clubObservation" placeholder="Producto, referencia o detalle"></label></div><div class="modal-actions"><button class="btn ghost modal-close">Cancelar</button><button id="confirmClubPoint" class="btn primary">Confirmar · +1 punto</button></div>`);
    $('#clubSale').addEventListener('change',e=>{const o=e.target.selectedOptions[0];if(o?.dataset.total)$('#clubAmount').value=o.dataset.total});
    $('#confirmClubPoint').addEventListener('click',async()=>{const saleId=$('#clubSale').value||null,amount=$('#clubAmount').value?Number($('#clubAmount').value):null,obs=$('#clubObservation').value.trim();if(clubType==='importb2b'&&Number(amount||0)<30000)return alert('Club IMPORTB2B requiere compra mínima de $30.000');try{await DB.registerClubPoint(data.customer.id,clubType,saleId,amount,obs);closeModal();await openCustomer360(data.customer.id,'club')}catch(e){alert(e.message)}});
  }

  async function renderClub(q=''){
    clubSearch=q||'';const data=await DB.clubOverview(clubSearch),o=data.overview||{};
    content.innerHTML=`<div class="module-switch"><button data-combined-view="customers">Clientes</button><button class="active" data-combined-view="club">Club</button></div><div class="section-title"><div><span class="eyebrow">FIDELIZACIÓN</span><h3>Club IMPORTB2B</h3><p class="muted">Un cliente, un código, múltiples clubes con progreso independiente.</p></div><button id="legacyClubImport" class="btn ghost">Migrar Club anterior</button></div><div class="club-overview-grid"><div class="card metric"><small>Miembros</small><b>${number(o.members)}</b><small>Clientes con Club activo</small></div><div class="card metric"><small>Puntos registrados</small><b>${number(o.total_points)}</b><small>Compra + historia verificadas</small></div><div class="card metric"><small>Premios pendientes</small><b>${number(o.pending_rewards)}</b><small>Por entregar</small></div><div class="card metric"><small>Membresías</small><b>${number(Number(o.vapers_memberships||0)+Number(o.jerseys_memberships||0)+Number(o.perfumes_memberships||0)+Number(o.importb2b_memberships||0))}</b><small>Entre todos los clubes</small></div></div><div class="club-split" style="margin-top:14px"><section class="card"><div class="section-title"><div><span class="eyebrow">MIEMBROS</span><h3>Clientes del Club</h3></div></div><div class="toolbar"><input id="clubSearch" value="${esc(clubSearch)}" placeholder="Buscar miembro, código, teléfono o club…"></div><div class="club-member-list">${data.members.map(x=>`<button class="club-member-row open-club-member" data-id="${x.customer.id}"><span><b>${esc(x.customer.full_name)}</b><small>${esc(x.profile?.member_code||'Sin código')} · ${x.memberships.map(m=>esc(clubLabel(m.club_type))).join(' · ')}</small></span><span><b>${number(x.memberships.reduce((a,m)=>a+Number(m.points||0),0))} pts</b><small>${number(x.customer.pending_rewards||0)} premios pendientes</small></span></button>`).join('')||'<div class="empty">Todavía no hay membresías en Central.</div>'}</div></section><section class="card"><div class="section-title"><div><span class="eyebrow">PREMIOS</span><h3>Pendientes de entrega</h3></div></div><div class="club-claims">${data.claims.map(x=>`<div class="club-claim-row"><span><b>${esc(x.reward_name)}</b><small>${esc(x.customer?.full_name||'Cliente')} · ${esc(clubLabel(x.club_type))} · ${x.milestone} pts</small></span><button class="btn tiny good deliver-overview-reward" data-id="${x.id}">Entregar</button></div>`).join('')||'<div class="empty compact-empty">Sin premios pendientes.</div>'}</div></section></div>`;
    $('#legacyClubImport')?.addEventListener('click',openLegacyClubImport);
    document.querySelectorAll('[data-combined-view]').forEach(b=>b.addEventListener('click',()=>setView(b.dataset.combinedView)));
    $('#clubSearch')?.addEventListener('input',e=>{clubSearch=e.target.value;$('#globalSearch').value=clubSearch;clearTimeout(timer);timer=setTimeout(()=>renderClub(clubSearch),150)});
    document.querySelectorAll('.open-club-member').forEach(b=>b.addEventListener('click',()=>openCustomer360(b.dataset.id,'club')));
    document.querySelectorAll('.deliver-overview-reward').forEach(b=>b.addEventListener('click',async()=>{if(!confirm('¿Marcar premio como entregado?'))return;try{await DB.deliverClubReward(b.dataset.id,'');await renderClub(clubSearch)}catch(e){alert(e.message)}}));
  }


  async function openLegacyClubImport(){
    const map=await DB.legacyClubMap().catch(()=>[]);
    openModal(`<div class="section-title"><div><span class="eyebrow">MIGRACIÓN SEGURA</span><h3>Club IMPORTB2B anterior</h3><p class="muted">Seleccioná los seis CSV exportados de Supabase. El sistema fusiona clientes por teléfono, Instagram o nombre y conserva códigos, puntos, premios e historial.</p></div><button class="modal-close modal-x">×</button></div>${map.length?`<div class="notice good-notice">Ya hay ${map.length} clientes históricos mapeados. Podés ejecutar nuevamente: la importación es idempotente.</div>`:''}<div class="legacy-import-grid"><label>1 · clients.csv<input id="legacyClients" type="file" accept=".csv,text/csv"></label><label>2 · client_clubs.csv<input id="legacyClubs" type="file" accept=".csv,text/csv"></label><label>3 · club_actions.csv<input id="legacyActions" type="file" accept=".csv,text/csv"></label><label>4 · reward_claims.csv<input id="legacyClaims" type="file" accept=".csv,text/csv"></label><label>5 · client_events.csv<input id="legacyEvents" type="file" accept=".csv,text/csv"></label><label>6 · club_reward_rules.csv<input id="legacyRules" type="file" accept=".csv,text/csv"></label></div><div id="legacyImportResult" class="muted small-text" style="margin-top:12px">Los archivos se leen en tu navegador y se envían autenticados a tu Supabase. No se guardan en GitHub.</div><div class="modal-actions"><button class="btn ghost modal-close">Cancelar</button><button id="runLegacyImport" class="btn primary">Migrar todo</button></div>`);
    $('#runLegacyImport').addEventListener('click',async()=>{
      const btn=$('#runLegacyImport'),out=$('#legacyImportResult');
      const fields=[['clients','#legacyClients'],['client_clubs','#legacyClubs'],['club_actions','#legacyActions'],['reward_claims','#legacyClaims'],['client_events','#legacyEvents'],['club_reward_rules','#legacyRules']];
      if(fields.some(([,id])=>!$(id).files[0]))return alert('Seleccioná los seis CSV.');
      btn.disabled=true;btn.textContent='Migrando…';
      try{
        const payload={};
        for(const [key,id] of fields){payload[key]=await parseLegacyCsv($(id).files[0],key);out.textContent=`Leyendo ${key}… ${payload[key].length} filas`;}
        const r=await DB.importLegacyClub(payload);
        out.innerHTML=`<span class="positive"><b>Migración completada.</b></span> Nuevos: ${number(r.created_customers)} · Fusionados: ${number(r.matched_customers)} · Acciones: ${number(r.actions_processed)} · Eventos: ${number(r.events_processed)} · Premios: ${number(r.claims_processed)}`;
        btn.textContent='Listo';
        setTimeout(()=>{closeModal();renderClub(clubSearch)},1200);
      }catch(e){console.error(e);out.innerHTML=`<span class="error">${esc(e.message)}</span>`;btn.disabled=false;btn.textContent='Reintentar'}
    });
  }

  function parseLegacyCsv(file,key){
    return new Promise((resolve,reject)=>Papa.parse(file,{header:true,skipEmptyLines:true,complete:r=>{
      if(r.errors?.length)return reject(new Error(`CSV ${key}: ${r.errors[0].message}`));
      const rows=(r.data||[]).filter(x=>Object.values(x).some(v=>String(v??'').trim()!==''));
      if(key==='client_events')for(const row of rows){try{row.metadata=typeof row.metadata==='string'?JSON.parse(row.metadata||'{}'):row.metadata||{}}catch{row.metadata={raw:row.metadata}}}
      resolve(rows);
    },error:reject}));
  }

  /* -------------------- PHASE 6.2 · PDF SELECTIVO + BRANDING -------------------- */
  async function renderPdfBuilder(){
    const [cats,all]=await Promise.all([DB.categories(),DB.pdfCatalogProducts()]);
    let rows=all.filter(p=>p.catalog_visible!==false);
    if(pdfCategory)rows=rows.filter(p=>p.category===pdfCategory);
    if(pdfOnlyStock)rows=rows.filter(p=>p.variants.some(v=>Number(v.stock?.available||0)>0));
    const term=String(pdfSearch||'').trim().toLowerCase();
    if(term)rows=rows.filter(p=>[p.name,p.sku,p.category,...p.variants.flatMap(v=>[v.variant_name,v.sku])].join(' ').toLowerCase().includes(term));

    const selectedTotal=all.filter(x=>pdfSelected.has(x.id)).length;
    const selectedVisible=rows.filter(x=>pdfSelected.has(x.id)).length;

    content.innerHTML=`<div class="module-switch"><button data-combined-view="wholesale">Mayorista</button><button class="active" data-combined-view="pdfs">PDF Catálogos</button></div>
      <div class="pdf-builder-head card">
        <div>
          <span class="eyebrow">GENERADOR AUTOMÁTICO · 6.5</span>
          <h3>PDF desde Stock Central</h3>
          <p class="muted">El PDF incluye solamente los productos que marques. Podés filtrar, seleccionar por categoría y exportar sin tocar el stock real.</p>
        </div>
        <div class="pdf-head-actions">
          <button id="pdfClient" class="btn primary" ${selectedTotal?'':'disabled'}>PDF Clientes · ${selectedTotal}</button>
          <button id="pdfReseller" class="btn ghost" ${selectedTotal?'':'disabled'}>PDF Revendedores · ${selectedTotal}</button>
        </div>
      </div>
      <div class="pdf-builder-grid">
        <aside class="card pdf-controls">
          <label>Buscar<input id="pdfSearch" value="${esc(pdfSearch)}" placeholder="Producto, talle, sabor…"></label>
          <label>Categoría<select id="pdfCategory"><option value="">Todas</option>${cats.map(c=>`<option value="${esc(c)}" ${pdfCategory===c?'selected':''}>${esc(c)}</option>`).join('')}</select></label>
          <label class="check"><input id="pdfOnlyStock" type="checkbox" ${pdfOnlyStock?'checked':''}> Solo productos con stock</label>
          <label class="check"><input id="pdfExactStock" type="checkbox"> Mostrar cantidad exacta</label>
          <label>Precio mayorista<select id="pdfWholesaleTier"><option value="6" ${pdfWholesaleTier===6?'selected':''}>Mayorista 6+</option><option value="12" ${pdfWholesaleTier===12?'selected':''}>Mayorista 12+</option><option value="36" ${pdfWholesaleTier===36?'selected':''}>Mayorista 36+</option></select></label>
          <label>Título<input id="pdfTitle" value="CATÁLOGO IMPORTB2B"></label>
          <label>Subtítulo<input id="pdfSubtitle" value="Stock disponible"></label>

          <div class="pdf-selection-summary">
            <small>Seleccionados</small>
            <b id="pdfSelectedCount">${selectedTotal}</b>
            <span id="pdfSelectedMeta">${selectedVisible} visibles de ${rows.length} · ${selectedTotal} total</span>
          </div>
          <div class="pdf-selection-actions">
            <button id="pdfSelectAll" class="btn ghost full">Seleccionar visibles</button>
            <button id="pdfClear" class="btn ghost full">Limpiar selección</button>
          </div>
          <div class="pdf-selection-note">Solo se exportan los productos tildados. Los filtros no agregan productos automáticamente.</div>
        </aside>

        <section class="card">
          <div class="section-title">
            <div><span class="eyebrow">PRODUCTOS</span><h3>Elegí qué incluir</h3></div>
            <span class="pill blue">${rows.length} visibles</span>
          </div>
          <div class="pdf-product-list">
            ${rows.map(p=>{
              const av=p.variants.reduce((a,v)=>a+Number(v.stock?.available||0),0);
              const prices=p.variants.map(v=>Number(v.price_ars||0)).filter(Boolean);
              const checked=pdfSelected.has(p.id);
              return `<label class="pdf-product-row ${checked?'selected':''}">
                <input class="pdf-product-check" data-id="${p.id}" type="checkbox" ${checked?'checked':''}>
                <span class="pdf-product-thumb">${p.pdf_image_url?`<img src="${esc(p.pdf_image_url)}" alt="">`:'<i>IB</i>'}</span>
                <span class="grow"><b>${esc(p.name)}</b><small>${esc(p.category||'Sin categoría')} · ${number(av)} disponibles · ${p.variants.length} variantes</small></span>
                <strong>${prices.length?money(Math.min(...prices)):'—'}</strong>
              </label>`
            }).join('')||'<div class="empty">No hay productos con estos filtros.</div>'}
          </div>
        </section>
      </div>`;

    const syncSelectionUi=()=>{
      const total=all.filter(x=>pdfSelected.has(x.id)).length;
      const visible=rows.filter(x=>pdfSelected.has(x.id)).length;
      $('#pdfSelectedCount').textContent=String(total);
      $('#pdfSelectedMeta').textContent=`${visible} visibles de ${rows.length} · ${total} total`;
      $('#pdfClient').disabled=!total;
      $('#pdfReseller').disabled=!total;
      $('#pdfClient').textContent=`PDF Clientes · ${total}`;
      $('#pdfReseller').textContent=`PDF Revendedores · ${total}`;
    };

    $('#pdfSearch').addEventListener('input',e=>{pdfSearch=e.target.value;$('#globalSearch').value=pdfSearch;clearTimeout(timer);timer=setTimeout(renderPdfBuilder,160)});
    $('#pdfCategory').addEventListener('change',e=>{pdfCategory=e.target.value;renderPdfBuilder()});
    $('#pdfOnlyStock').addEventListener('change',e=>{pdfOnlyStock=e.target.checked;renderPdfBuilder()});
    $('#pdfWholesaleTier').addEventListener('change',e=>{pdfWholesaleTier=Number(e.target.value);});
    document.querySelectorAll('.pdf-product-check').forEach(x=>x.addEventListener('change',()=>{
      x.checked?pdfSelected.add(x.dataset.id):pdfSelected.delete(x.dataset.id);
      x.closest('.pdf-product-row')?.classList.toggle('selected',x.checked);
      syncSelectionUi();
    }));
    $('#pdfSelectAll').addEventListener('click',()=>{rows.forEach(x=>pdfSelected.add(x.id));renderPdfBuilder()});
    $('#pdfClear').addEventListener('click',()=>{pdfSelected.clear();renderPdfBuilder()});
    $('#pdfClient').addEventListener('click',()=>generateStockPdf(all.filter(x=>pdfSelected.has(x.id)),{mode:'client',exactStock:$('#pdfExactStock').checked,title:$('#pdfTitle').value.trim()||'CATÁLOGO IMPORTB2B',subtitle:$('#pdfSubtitle').value.trim()}));
    $('#pdfReseller').addEventListener('click',()=>generateStockPdf(all.filter(x=>pdfSelected.has(x.id)),{mode:'reseller',wholesaleTier:pdfWholesaleTier,exactStock:$('#pdfExactStock').checked,title:'CATÁLOGO MAYORISTA',subtitle:`Mayorista ${pdfWholesaleTier}+ · ${$('#pdfSubtitle').value.trim()}`}));
  }

  async function generateStockPdf(products,opts){
    if(!products.length)return alert('Seleccioná al menos un producto.');
    if(!window.jspdf?.jsPDF)return alert('No se pudo cargar el generador PDF.');
    const onlyStock=pdfOnlyStock;
    const usable=products.map(p=>({...p,variants:p.variants.filter(v=>!onlyStock||Number(v.stock?.available||0)>0)})).filter(p=>p.variants.length);
    if(!usable.length)return alert('No hay variantes disponibles para exportar.');

    const {jsPDF}=window.jspdf;
    const doc=new jsPDF({orientation:'portrait',unit:'mm',format:'a4'});
    const logo=await loadPdfLogo('./assets/img/logo-importb2b-transparent.png').catch(()=>null);

    drawPdfCover(doc,opts,usable.length,logo);
    for(let i=0;i<usable.length;i++){
      doc.addPage();
      await drawPdfProduct(doc,usable[i],opts,i+1,usable.length,logo);
    }
    const date=new Date().toISOString().slice(0,10);
    doc.save(`${opts.mode==='client'?'IMPORTB2B':`IMPORTB2B-Mayorista-${opts.wholesaleTier||6}+`}-${date}.pdf`);
  }

  function pdfText(doc,text,x,y,size=10,style='normal',maxWidth=178){
    doc.setFont('helvetica',style);doc.setFontSize(size);
    return doc.splitTextToSize(String(text??''),maxWidth).map((line,i)=>doc.text(line,x,y+i*(size*.38)));
  }

  function addPdfLogo(doc,logo,x,y,maxW,maxH,{center=false}={}){
    if(!logo?.data||!logo.width||!logo.height)return;
    const ratio=logo.width/logo.height;
    let w=maxW,h=w/ratio;
    if(h>maxH){h=maxH;w=h*ratio;}
    const drawX=center?x-w/2:x;
    try{doc.addImage(logo.data,'PNG',drawX,y,w,h,undefined,'FAST')}catch(e){console.warn('No se pudo dibujar el logo PDF',e)}
  }

  function drawPdfCover(doc,opts,count,logo){
    doc.setFillColor(9,10,12);doc.rect(0,0,210,297,'F');
    if(logo)addPdfLogo(doc,logo,105,30,82,42,{center:true});

    doc.setTextColor(255,255,255);doc.setFont('helvetica','bold');doc.setFontSize(29);
    doc.text(opts.title||'CATÁLOGO IMPORTB2B',105,136,{align:'center'});
    doc.setDrawColor(237,28,36);doc.setLineWidth(1.4);doc.line(76,148,134,148);
    doc.setFont('helvetica','normal');doc.setFontSize(12);doc.setTextColor(205,209,214);
    doc.text(opts.subtitle||'Stock disponible',105,164,{align:'center'});
    doc.setFontSize(9);doc.setTextColor(130,137,144);doc.text(`${count} productos seleccionados · ${new Date().toLocaleDateString('es-AR')}`,105,178,{align:'center'});
    doc.setDrawColor(55,60,66);doc.line(62,265,148,265);
    doc.setTextColor(245,245,245);doc.setFont('helvetica','bold');doc.setFontSize(8);doc.text(opts.mode==='client'?'IMPORTB2B · STOCK ACTUALIZADO':`IMPORTB2B · MAYORISTA ${opts.wholesaleTier||6}+`,105,275,{align:'center'});
  }

  async function drawPdfProduct(doc,p,opts,index,total,logo){
    doc.setFillColor(15,17,19);doc.rect(0,0,210,297,'F');

    if(logo)addPdfLogo(doc,logo,16,10,38,14);
    doc.setTextColor(237,28,36);doc.setFontSize(8);doc.setFont('helvetica','bold');
    doc.text((p.category||'PRODUCTO').toUpperCase(),194,18,{align:'right'});

    doc.setTextColor(255,255,255);doc.setFontSize(21);doc.setFont('helvetica','bold');
    const title=doc.splitTextToSize(p.name,178);doc.text(title,16,38);

    const imageY=56;
    if(p.pdf_image_url){
      const img=await imageToData(p.pdf_image_url).catch(()=>null);
      if(img){
        try{
          doc.setFillColor(8,9,10);doc.roundedRect(16,imageY,178,98,2,2,'F');
          doc.addImage(img,'JPEG',21,imageY+5,168,88,undefined,'FAST');
        }catch{}
      }
    }else{
      doc.setDrawColor(55,58,61);doc.rect(16,imageY,178,98);
      doc.setTextColor(100,103,106);doc.setFontSize(14);doc.text('SIN FOTO',105,imageY+51,{align:'center'});
    }

    let y=170;
    doc.setTextColor(255,255,255);doc.setFontSize(9);doc.setFont('helvetica','bold');
    doc.text('VARIANTE',16,y);doc.text('STOCK',125,y);doc.text(opts.mode==='reseller'?`MAYORISTA ${opts.wholesaleTier||6}+`:'PRECIO',194,y,{align:'right'});
    y+=4;doc.setDrawColor(65,68,72);doc.line(16,y,194,y);y+=8;

    for(const v of p.variants.slice(0,11)){
      const tier=Number(opts.wholesaleTier||6);
      const tierPrice=v.wholesale_tiers?.[`wholesale_${tier}_ars`];
      const price=opts.mode==='reseller'?Number(tierPrice||v.wholesale_price_ars||v.price_ars||0):Number(v.price_ars||0);
      const av=Number(v.stock?.available||0);
      doc.setTextColor(235,237,239);doc.setFont('helvetica','normal');doc.setFontSize(8.5);
      doc.text(String(v.variant_name||'Única').slice(0,46),16,y);
      doc.setTextColor(av>0?120:170,av>0?220:170,av>0?155:170);
      doc.text(opts.exactStock?`${number(av)} u.`:(av>0?'Disponible':'Sin stock'),125,y);
      doc.setTextColor(255,255,255);doc.setFont('helvetica','bold');
      doc.text(price?money(price):'Consultar',194,y,{align:'right'});y+=9;
    }
    if(p.variants.length>11){doc.setFont('helvetica','normal');doc.setTextColor(160,164,168);doc.text(`+ ${p.variants.length-11} variantes adicionales`,16,y)}

    doc.setDrawColor(237,28,36);doc.line(16,276,194,276);
    doc.setFontSize(7.5);doc.setTextColor(160,164,168);doc.text(`${index} / ${total}`,194,284,{align:'right'});
    if(opts.mode==='client'){
      doc.setTextColor(235,235,235);doc.setFont('helvetica','bold');doc.text('IMPORTB2B',16,284);
    }
  }

  async function loadPdfLogo(url){
    const res=await fetch(url,{mode:'cors'});if(!res.ok)throw new Error('Logo no disponible');
    const blob=await res.blob();
    const bmp=await createImageBitmap(blob);
    const source=document.createElement('canvas');source.width=bmp.width;source.height=bmp.height;
    const sctx=source.getContext('2d',{willReadFrequently:true});sctx.clearRect(0,0,source.width,source.height);sctx.drawImage(bmp,0,0);bmp.close?.();
    const img=sctx.getImageData(0,0,source.width,source.height);const d=img.data;

    // Si el archivo viniera sin transparencia, elimina únicamente el fondo negro.
    let hasTransparent=false;
    for(let i=3;i<d.length;i+=4){if(d[i]<250){hasTransparent=true;break}}
    if(!hasTransparent){
      for(let i=0;i<d.length;i+=4){
        if(d[i]<36&&d[i+1]<36&&d[i+2]<36)d[i+3]=0;
      }
      sctx.putImageData(img,0,0);
    }

    const data=sctx.getImageData(0,0,source.width,source.height).data;
    let minX=source.width,minY=source.height,maxX=-1,maxY=-1;
    for(let y=0;y<source.height;y++)for(let x=0;x<source.width;x++){
      const a=data[(y*source.width+x)*4+3];
      if(a>18){if(x<minX)minX=x;if(y<minY)minY=y;if(x>maxX)maxX=x;if(y>maxY)maxY=y;}
    }
    if(maxX<minX||maxY<minY)throw new Error('Logo vacío');
    const pad=Math.max(4,Math.round(Math.max(source.width,source.height)*.012));
    minX=Math.max(0,minX-pad);minY=Math.max(0,minY-pad);maxX=Math.min(source.width-1,maxX+pad);maxY=Math.min(source.height-1,maxY+pad);
    const w=maxX-minX+1,h=maxY-minY+1;
    const out=document.createElement('canvas');out.width=w;out.height=h;
    out.getContext('2d').drawImage(source,minX,minY,w,h,0,0,w,h);
    return {data:out.toDataURL('image/png'),width:w,height:h};
  }

  async function imageToData(url,bg='#ffffff'){
    const res=await fetch(url,{mode:'cors'});if(!res.ok)throw new Error('Imagen no disponible');const blob=await res.blob();
    const bmp=await createImageBitmap(blob);const max=1200,scale=Math.min(1,max/Math.max(bmp.width,bmp.height));const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bmp.width*scale));canvas.height=Math.max(1,Math.round(bmp.height*scale));const ctx=canvas.getContext('2d');ctx.fillStyle=bg;ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(bmp,0,0,canvas.width,canvas.height);bmp.close?.();return canvas.toDataURL('image/jpeg',.9);
    document.querySelectorAll('[data-combined-view]').forEach(b=>b.addEventListener('click',()=>setView(b.dataset.combinedView)));

  }

  /* -------------------- FASE 6.5 · MAYORISTA -------------------- */
  async function renderWholesale(){
    const data=await DB.wholesaleData();
    const cats=[...new Set(data.rows.map(x=>x.category).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'es'));
    let rows=data.rows;
    if(wholesaleCategory)rows=rows.filter(x=>x.category===wholesaleCategory);
    const term=String(wholesaleSearch||'').trim().toLowerCase();
    if(term)rows=rows.filter(x=>[x.product_name,x.variant_name,x.sku,x.category].join(' ').toLowerCase().includes(term));
    const marginMap=new Map((data.margins||[]).map(x=>[String(x.category).toLowerCase(),x]));
    content.innerHTML=`<div class="module-switch"><button class="active" data-combined-view="wholesale">Mayorista</button><button data-combined-view="pdfs">PDF Catálogos</button></div><div class="section-title"><div><span class="eyebrow">MAYORISTA</span><h3>Calculadora de precios</h3><p class="muted">Los precios sugeridos parten del costo real de cada variante y del margen configurado por categoría. Podés sobrescribir un precio puntual.</p></div><span class="pill blue">6+ · 12+ · 36+</span></div>
      <section class="card wholesale-margin-card"><div class="section-title"><div><span class="eyebrow">MÁRGENES</span><h3>Por categoría</h3></div><button id="saveWholesaleMargins" class="btn primary">Guardar márgenes</button></div><div class="table-wrap"><table class="table wholesale-margin-table"><thead><tr><th>Categoría</th><th>Minorista %</th><th>Mayorista 6 %</th><th>Mayorista 12 %</th><th>Mayorista 36 %</th></tr></thead><tbody>${cats.map(cat=>{const m=marginMap.get(cat.toLowerCase())||{};return`<tr data-margin-cat="${esc(cat)}"><td><b>${esc(cat)}</b></td><td><input data-field="retail" type="number" step="0.1" value="${Number(m.retail||0)}"></td><td><input data-field="wholesale_6" type="number" step="0.1" value="${Number(m.wholesale_6||0)}"></td><td><input data-field="wholesale_12" type="number" step="0.1" value="${Number(m.wholesale_12||0)}"></td><td><input data-field="wholesale_36" type="number" step="0.1" value="${Number(m.wholesale_36||0)}"></td></tr>`}).join('')}</tbody></table></div></section>
      <section class="card" style="margin-top:14px"><div class="wholesale-toolbar"><input id="wholesaleSearch" value="${esc(wholesaleSearch)}" placeholder="Producto, variante o SKU…"><select id="wholesaleCategory"><option value="">Todas las categorías</option>${cats.map(c=>`<option value="${esc(c)}" ${wholesaleCategory===c?'selected':''}>${esc(c)}</option>`).join('')}</select></div><div class="table-wrap"><table class="table wholesale-price-table"><thead><tr><th>Producto</th><th>Variante</th><th>Costo</th><th>Minorista</th><th>6+</th><th>12+</th><th>36+</th><th></th></tr></thead><tbody>${rows.map(r=>`<tr data-wholesale-variant="${r.variant_id}"><td><b>${esc(r.product_name)}</b><br><small class="muted">${esc(r.category||'')}</small></td><td>${esc(r.variant_name||'Única')}<br><small class="muted">${esc(r.sku||'')}</small></td><td>${money(r.cost_ars)}</td><td>${money(r.retail_price_ars)}</td><td><input class="wh-price" data-tier="6" type="number" value="${Number(r.wholesale_6_ars||0)}"><small>${r.wholesale_6_manual?'Manual':'Margen'}</small></td><td><input class="wh-price" data-tier="12" type="number" value="${Number(r.wholesale_12_ars||0)}"><small>${r.wholesale_12_manual?'Manual':'Margen'}</small></td><td><input class="wh-price" data-tier="36" type="number" value="${Number(r.wholesale_36_ars||0)}"><small>${r.wholesale_36_manual?'Manual':'Margen'}</small></td><td><button class="btn tiny ghost save-wholesale-row">Guardar</button></td></tr>`).join('')||'<tr><td colspan="8" class="empty">No hay productos con este filtro.</td></tr>'}</tbody></table></div></section>`;
    $('#wholesaleSearch')?.addEventListener('input',e=>{wholesaleSearch=e.target.value;$('#globalSearch').value=wholesaleSearch;clearTimeout(timer);timer=setTimeout(renderWholesale,160)});
    $('#wholesaleCategory')?.addEventListener('change',e=>{wholesaleCategory=e.target.value;renderWholesale()});
    $('#saveWholesaleMargins')?.addEventListener('click',async()=>{const btn=$('#saveWholesaleMargins');btn.disabled=true;try{const drafts=[...document.querySelectorAll('[data-margin-cat]')].map(tr=>({category:tr.dataset.marginCat,retail:tr.querySelector('[data-field="retail"]').value,wholesale_6:tr.querySelector('[data-field="wholesale_6"]').value,wholesale_12:tr.querySelector('[data-field="wholesale_12"]').value,wholesale_36:tr.querySelector('[data-field="wholesale_36"]').value}));await DB.saveMargins(drafts);await renderWholesale()}catch(e){alert(e.message);btn.disabled=false}});
    document.querySelectorAll('.save-wholesale-row').forEach(b=>b.addEventListener('click',async()=>{const tr=b.closest('[data-wholesale-variant]');const vid=tr.dataset.wholesaleVariant;b.disabled=true;try{for(const inp of tr.querySelectorAll('.wh-price'))await DB.saveWholesalePrice(vid,Number(inp.dataset.tier),Number(inp.value||0));await renderWholesale()}catch(e){alert(e.message);b.disabled=false}}));
    document.querySelectorAll('[data-combined-view]').forEach(b=>b.addEventListener('click',()=>setView(b.dataset.combinedView)));

  }

  /* -------------------- FASE 6.5 · OPERACIONES / COMPRAS / TRACKING / GASTOS -------------------- */
  async function renderOrders(){
    const [rows,webAll]=await Promise.all([DB.recentOrders(),DB.webOrders('all')]);
    const webFiltered=webOrderStatusFilter==='all'?webAll:webAll.filter(x=>x.status===webOrderStatusFilter);
    const webPending=webAll.filter(x=>x.status==='pending').length;
    const purchaseHistorical=rows.filter(o=>o.items.length&&o.items.every(i=>i.stock_link_status==='historical')).length;
    const purchaseActive=rows.length-purchaseHistorical;
    let extra=null;
    if(operationsTab==='tracking')extra=await DB.trackingData();
    if(operationsTab==='expenses')extra=await DB.expenses();

    const body=operationsTab==='purchases'?`<div class="operations-actionbar"><button id="newPurchaseOrder" class="btn primary">+ Nuevo pedido</button></div>${renderPurchaseAccordions(rows)}`:
      operationsTab==='tracking'?renderTrackingSection(rows,extra):
      operationsTab==='expenses'?renderExpensesSection(extra,rows):renderWebOrderAccordions(webFiltered);

    content.innerHTML=`
      <div class="operations-head card">
        <div class="section-title"><div><span class="eyebrow">OPERACIONES</span><h3>Compras y mercadería</h3><p class="muted">Pedido → seguimiento → retiro → recepción → stock. Los registros históricos conservan la leyenda “stock incluido”.</p></div></div>
        <div class="operation-stats"><span class="pill blue">${purchaseActive} compras activas</span><span class="pill">${purchaseHistorical} históricas</span><span class="pill yellow">${webPending} web pendientes</span></div>
        <div class="operation-tabs"><button class="${operationsTab==='purchases'?'active':''}" data-operation-tab="purchases">Compras / Mercadería</button><button class="${operationsTab==='tracking'?'active':''}" data-operation-tab="tracking">📦 Seguimiento</button><button class="${operationsTab==='expenses'?'active':''}" data-operation-tab="expenses">Gastos</button><button class="${operationsTab==='web'?'active':''}" data-operation-tab="web">Pedidos del catálogo ${webPending?`<b>${webPending}</b>`:''}</button></div>
      </div><div id="operationsBody" style="margin-top:14px">${body}</div>`;

    document.querySelectorAll('[data-operation-tab]').forEach(b=>b.addEventListener('click',()=>{operationsTab=b.dataset.operationTab;renderOrders()}));
    bindOperationAccordions();
    $('#newPurchaseOrder')?.addEventListener('click',openNewPurchaseOrder);
    document.querySelectorAll('.edit-allocation').forEach(b=>b.addEventListener('click',()=>openOrderAllocation(b.dataset.id,rows)));
    document.querySelectorAll('.receive-allocation').forEach(b=>b.addEventListener('click',async()=>{const remaining=Number(b.dataset.remaining);const q=prompt(`Quedan ${remaining} unidades por recibir. ¿Cuántas llegaron?`,String(remaining));if(q===null)return;const n=Number(q);if(!Number.isFinite(n)||n<=0||n>remaining)return alert('Cantidad inválida');const note=prompt('Nota de recepción:','Recepción de mercadería')||'';try{await DB.receiveOrderAllocation(b.dataset.id,n,note);await renderOrders()}catch(e){alert(e.message)}}));
    document.querySelectorAll('.purchase-tracking').forEach(b=>b.addEventListener('click',()=>openAddTracking(Number(b.dataset.order),rows)));
    document.querySelectorAll('.purchase-payment').forEach(b=>b.addEventListener('click',()=>openPurchasePayment(rows.find(x=>Number(x.id)===Number(b.dataset.order)))));
    document.querySelectorAll('.purchase-expense').forEach(b=>b.addEventListener('click',()=>openNewExpense(rows,Number(b.dataset.order))));
    document.querySelectorAll('.open-web-order').forEach(b=>b.addEventListener('click',()=>openWebOrder(b.dataset.id)));
    $('#webOpsStatus')?.addEventListener('change',e=>{webOrderStatusFilter=e.target.value;renderOrders()});
    $('#newExpense')?.addEventListener('click',()=>openNewExpense(rows));
    document.querySelectorAll('.delete-expense').forEach(b=>b.addEventListener('click',async()=>{if(!confirm('¿Eliminar este gasto? Si generó un movimiento financiero también se revertirá.'))return;try{await DB.deleteExpense(b.dataset.id);await renderOrders()}catch(e){alert(e.message)}}));
    $('#addTracking')?.addEventListener('click',()=>openAddTracking(null,rows));
    document.querySelectorAll('.tracking-refresh').forEach(b=>b.addEventListener('click',async()=>{b.disabled=true;try{await DB.refreshShipment(b.dataset.id);await renderOrders()}catch(e){alert(e.message);b.disabled=false}}));
    document.querySelectorAll('.tracking-register').forEach(b=>b.addEventListener('click',async()=>{b.disabled=true;try{await DB.registerShipment(b.dataset.id);await renderOrders()}catch(e){alert(e.message);b.disabled=false}}));
    document.querySelectorAll('.tracking-picked').forEach(b=>b.addEventListener('click',async()=>{if(!confirm('¿Marcar la mercadería como retirada? Esto NO la suma todavía al stock.'))return;try{await DB.markShipmentPickedUp(b.dataset.id);await renderOrders()}catch(e){alert(e.message)}}));
    document.querySelectorAll('.tracking-delete').forEach(b=>b.addEventListener('click',async()=>{if(!confirm('¿Eliminar este seguimiento y su historial?'))return;try{await DB.deleteShipment(b.dataset.id);await renderOrders()}catch(e){alert(e.message)}}));
    document.querySelectorAll('.tracking-history-btn').forEach(b=>b.addEventListener('click',()=>document.querySelector(`#trackingHistory_${b.dataset.id}`)?.classList.toggle('hidden')));
  }

  function bindOperationAccordions(){
    document.querySelectorAll('.operation-accordion').forEach(d=>d.addEventListener('toggle',()=>{if(!d.open)return;document.querySelectorAll('.operation-accordion[open]').forEach(other=>{if(other!==d)other.open=false})}));
  }

  function purchaseStatusPill(status){
    const map={ordered:['Pedido',''],in_transit:['En viaje','blue'],ready_for_pickup:['Para retirar','green'],picked_up:['Retirado','purple'],receiving:['Recepción parcial','yellow'],received:['Recibido','green'],cancelled:['Cancelado','red']};
    const x=map[status]||['En gestión',''];return`<span class="pill ${x[1]}">${x[0]}</span>`;
  }

  function renderPurchaseAccordions(rows){
    if(!rows.length)return'<div class="card empty">Sin compras registradas.</div>';
    return `<div class="order-stack">${rows.map(o=>{
      const historical=o.items.length&&o.items.every(i=>i.stock_link_status==='historical');
      const totalQty=o.items.reduce((a,i)=>a+Number(i.quantity||0),0),received=o.items.reduce((a,i)=>a+Number(i.received_quantity||0),0);
      const ship=o.shipment||null;
      const status=historical?'<span class="pill yellow">Histórico · stock incluido</span>':ship?.normalized_status==='READY_FOR_PICKUP'?'<span class="pill green">PARA RETIRAR</span>':purchaseStatusPill(o.purchase_status||'ordered');
      const pay=o.purchase_payment_amount_ars?`<span class="pill green">Pagado ${money(o.purchase_payment_amount_ars)} · ${esc(o.purchase_payment_holder||'')}</span>`:'<span class="pill">Pago no registrado</span>';
      return `<details class="card order-card operation-accordion"><summary class="operation-summary"><div class="operation-summary-main"><span class="eyebrow">COMPRA #${esc(o.order_number??o.id)}</span><h3>${esc(o.provider||o.order_date||'Sin proveedor')}</h3><small>${esc(o.order_date||'')} · ${number(o.total_units||totalQty)} unidades · USD ${number(o.investment_usd)}</small></div><div class="operation-summary-side">${status}<span class="accordion-chevron">⌄</span></div></summary><div class="operation-body">${historical?`<div class="notice good-notice historical-note">Esta compra es histórica y sus unidades ya forman parte del stock actual. Se conserva para trazabilidad.</div>`:`<div class="purchase-summary-grid"><div><small>Mercadería</small><b>USD ${number(o.merchandise_usdt||0)}</b></div><div><small>Envío</small><b>USD ${number(o.shipping_usdt||0)}</b></div><div><small>Inversión</small><b>USD ${number(o.investment_usd||0)}</b></div><div><small>Recibido</small><b>${number(received)} / ${number(totalQty)}</b></div></div><div class="operation-progress"><span>Recepción de mercadería</span><div><i style="width:${totalQty?Math.min(100,received/totalQty*100):0}%"></i></div></div>`}${!historical?`<div class="purchase-actions"><button class="btn tiny ghost purchase-tracking" data-order="${o.id}">${ship?'📍 Seguimiento':'+ Seguimiento'}</button><button class="btn tiny ghost purchase-payment" data-order="${o.id}" ${o.purchase_payment_amount_ars?'disabled':''}>${o.purchase_payment_amount_ars?'Pago registrado':'Registrar pago'}</button><button class="btn tiny ghost purchase-expense" data-order="${o.id}">+ Gasto vinculado</button>${pay}</div>`:''}${ship?`<div class="tracking-inline-card"><span><b>${esc(ship.carrier_name||'Vía Cargo')}</b><small>Guía ${esc(ship.tracking_number||'')} · ${esc(ship.latest_checkpoint_description||ship.normalized_status||'Sin novedades')}</small></span>${ship.normalized_status==='READY_FOR_PICKUP'&&!ship.is_received?`<button class="btn tiny good tracking-picked" data-id="${ship.id}">Marcar retirado</button>`:''}</div>`:''}${o.items.map(i=>renderOrderItem(i)).join('')}</div></details>`;
    }).join('')}</div>`;
  }

  function renderWebOrderAccordions(rows){
    const filter=`<div class="toolbar operations-filter"><select id="webOpsStatus"><option value="pending" ${webOrderStatusFilter==='pending'?'selected':''}>Pendientes</option><option value="confirmed" ${webOrderStatusFilter==='confirmed'?'selected':''}>Confirmados</option><option value="cancelled" ${webOrderStatusFilter==='cancelled'?'selected':''}>Cancelados</option><option value="all" ${webOrderStatusFilter==='all'?'selected':''}>Todos</option></select></div>`;
    if(!rows.length)return `${filter}<div class="card empty">No hay pedidos del catálogo en este estado.</div>`;
    return `${filter}<div class="order-stack">${rows.map(o=>`<details class="card order-card operation-accordion web-operation"><summary class="operation-summary"><div class="operation-summary-main"><span class="eyebrow">${esc(o.order_code)}</span><h3>${esc(o.customer_name)}</h3><small>${safeDate(o.created_at)} · ${esc(o.customer_phone||'')}</small></div><div class="operation-summary-side"><strong>${money(o.total_ars)}</strong>${statusPill(o.status)}<span class="accordion-chevron">⌄</span></div></summary><div class="operation-body web-operation-body"><div class="operation-kv"><div><small>Entrega</small><b>${o.delivery_type==='shipping'?'Envío':'Retiro'}</b></div><div><small>Total</small><b>${money(o.total_ars)}</b></div><div><small>Estado</small>${statusPill(o.status)}</div>${o.delivery_address?`<div><small>Dirección</small><b>${esc(o.delivery_address)}</b></div>`:''}</div><div class="modal-actions"><button class="btn ${o.status==='pending'?'primary':'ghost'} open-web-order" data-id="${o.id}">${o.status==='pending'?'Gestionar pedido':'Ver detalle'}</button></div></div></details>`).join('')}</div>`;
  }

  function renderOrderItem(i){
    const hist=i.stock_link_status==='historical',alloc=i.allocations||[],rec=Number(i.received_quantity||0);
    return `<div class="order-item"><div class="order-item-main"><div><b>${esc(i.product)}</b><br><small class="muted">${esc(i.detail||'Única')} · ${esc(i.category||'')} · ${number(i.quantity)} un. · costo puesto ${money(i.cost_ars)}</small></div><span class="pill ${hist?'yellow':rec>=Number(i.quantity)?'green':alloc.length?'blue':''}">${hist?'Histórico · incluido':rec>=Number(i.quantity)?'Recibido':rec>0?'Parcial':alloc.length?'En camino':'Pendiente'}</span></div>${alloc.length?`<div class="allocation-list">${alloc.map(a=>{const rem=Number(a.ordered_quantity)-Number(a.received_quantity);return`<div class="allocation-row"><span><b>${esc(a.product?.name||'Producto')}</b> · ${esc(a.variant?.variant_name||'Única')}<br><small class="muted">${number(a.received_quantity)} / ${number(a.ordered_quantity)} recibidas</small></span>${rem>0?`<button class="btn tiny good receive-allocation" data-id="${a.id}" data-remaining="${rem}">Recibir ${number(rem)}</button>`:'<span class="pill green">Completo</span>'}</div>`}).join('')}</div>`:''}<div class="order-item-actions">${hist?`<small class="historical-inline">✓ Ya incluido en el stock actual</small>`:`<button class="btn tiny ghost edit-allocation" data-id="${i.id}">${alloc.length?'Editar distribución':'Vincular / distribuir'}</button>`}</div></div>`;
  }

  function trackingStatusMeta(status,error=''){
    if(error)return {label:'INCIDENCIA',cls:'red',rank:1};
    const map={READY_FOR_PICKUP:{label:'PARA RETIRAR',cls:'green',rank:0},ARRIVED_AT_DISTRIBUTION_CENTER:{label:'CENTRO DE DISTRIBUCIÓN',cls:'yellow',rank:2},IN_TRANSIT:{label:'EN VIAJE',cls:'blue',rank:3},CARRIER_RECEIVED:{label:'INGRESADO A VÍA CARGO',cls:'yellow',rank:4},NO_UPDATES:{label:'SIN NOVEDADES',cls:'',rank:5},RECEIVED:{label:'RETIRADO',cls:'purple',rank:6}};
    return map[status]||map.NO_UPDATES;
  }

  function renderTrackingSection(orders,data){
    const shipments=[...(data?.shipments||[])].sort((a,b)=>trackingStatusMeta(a.normalized_status,a.sync_error).rank-trackingStatusMeta(b.normalized_status,b.sync_error).rank);
    const events=data?.events||[], omap=new Map(orders.map(o=>[Number(o.id),o]));
    const counts={transit:shipments.filter(x=>x.normalized_status==='IN_TRANSIT').length,center:shipments.filter(x=>x.normalized_status==='ARRIVED_AT_DISTRIBUTION_CENTER').length,ready:shipments.filter(x=>x.normalized_status==='READY_FOR_PICKUP'&&!x.is_received).length,received:shipments.filter(x=>x.is_received||x.normalized_status==='RECEIVED').length};
    return `<div class="operations-actionbar"><button id="addTracking" class="btn primary">+ Agregar seguimiento</button></div>
      <div class="tracking-kpis"><div class="card"><small>En viaje</small><b>${counts.transit}</b></div><div class="card"><small>En centro</small><b>${counts.center}</b></div><div class="card tracking-ready"><small>Para retirar</small><b>${counts.ready}</b></div><div class="card"><small>Retirados</small><b>${counts.received}</b></div></div>
      <div class="tracking-grid">${shipments.map(s=>{const o=omap.get(Number(s.order_id)),meta=trackingStatusMeta(s.normalized_status,s.sync_error),evs=events.filter(e=>Number(e.shipment_id)===Number(s.id)).slice(0,15);return`<article class="card tracking-card ${s.normalized_status==='READY_FOR_PICKUP'&&!s.is_received?'ready':''}"><div class="tracking-card-head"><div><span class="eyebrow">${o?`PEDIDO #${esc(o.order_number)}`:'SEGUIMIENTO'}</span><h3>${esc(s.carrier_name||'Vía Cargo')}</h3><small>Guía ${esc(s.tracking_number||'')}</small></div><span class="pill ${meta.cls}">${meta.label}</span></div><div class="tracking-last">${s.latest_checkpoint_description?`<b>${esc(s.latest_checkpoint_description)}</b>`:'<b>Sin movimientos informados</b>'}${s.latest_checkpoint_location?`<span>📍 ${esc(s.latest_checkpoint_location)}</span>`:''}<small>${s.latest_checkpoint_at?safeDate(s.latest_checkpoint_at):'Todavía sin fecha de evento'}${s.last_sync_at?` · sync ${safeDate(s.last_sync_at)}`:''}</small>${s.sync_error?`<small class="error">${esc(s.sync_error)}</small>`:''}</div><div class="tracking-actions">${!s.tracking_registered?`<button class="btn tiny ghost tracking-register" data-id="${s.id}">Registrar 17TRACK</button>`:''}${!s.is_received?`<button class="btn tiny ghost tracking-refresh" data-id="${s.id}">↻ Actualizar</button>`:''}${s.normalized_status==='READY_FOR_PICKUP'&&!s.is_received?`<button class="btn tiny good tracking-picked" data-id="${s.id}">✓ Marcar retirado</button>`:''}<button class="btn tiny ghost tracking-history-btn" data-id="${s.id}">Historial</button><button class="btn tiny danger-btn tracking-delete" data-id="${s.id}">Eliminar</button></div><div id="trackingHistory_${s.id}" class="tracking-history hidden">${evs.map(e=>`<div class="tracking-event"><i></i><span><b>${esc(e.description_original||trackingStatusMeta(e.normalized_status).label)}</b><small>${esc(e.location_original||'')}${e.event_datetime?` · ${safeDate(e.event_datetime)}`:''}</small></span></div>`).join('')||'<div class="empty">Todavía no hay eventos guardados.</div>'}</div></article>`}).join('')||'<div class="card empty">No hay seguimientos registrados.</div>'}</div>`;
  }

  function renderExpensesSection(expenses,orders){
    const omap=new Map(orders.map(o=>[Number(o.id),o])),total=(expenses||[]).reduce((a,x)=>a+Number(x.amount_ars||0),0);
    return `<div class="operations-actionbar"><button id="newExpense" class="btn primary">+ Registrar gasto</button></div><div class="expense-summary"><div class="card"><small>Total gastos registrados</small><b>${money(total)}</b></div><div class="card"><small>Registros</small><b>${number(expenses?.length||0)}</b></div></div><div class="expense-list">${(expenses||[]).map(e=>{const o=omap.get(Number(e.order_id));return`<article class="card expense-row"><div><span class="eyebrow">${esc(e.expense_type||'GASTO')}</span><b>${esc(e.description||e.provider||'Sin detalle')}</b><small>${safeDate(e.expense_date)}${e.provider?` · ${esc(e.provider)}`:''}${o?` · Pedido #${esc(o.order_number)}`:''}</small></div><div class="expense-row-side"><strong>${money(e.amount_ars)}</strong>${e.payment_method?`<small>${esc(e.payment_method)} · ${esc(e.holder||'')}</small>`:'<small>Sin impacto financiero</small>'}<button class="btn tiny danger-btn delete-expense" data-id="${e.id}">Eliminar</button></div></article>`}).join('')||'<div class="card empty">No hay gastos registrados.</div>'}</div>`;
  }

  async function openNewPurchaseOrder(){
    const [products,categories]=await Promise.all([DB.orderProductOptions(),DB.categories().catch(()=>[])]);
    const cats=(categories?.length?categories:[...new Set(products.map(x=>x.category).filter(Boolean))]).sort((a,b)=>String(a).localeCompare(String(b),'es'));
    const today=new Date().toISOString().slice(0,10),draft=[];
    openModal(`<div class="section-title purchase-modal-head"><div><span class="eyebrow">NUEVA COMPRA</span><h3>Nuevo pedido de mercadería</h3><p class="muted">La mercadería queda en camino. El stock físico aumenta recién cuando registrás la recepción.</p></div><button class="modal-close">×</button></div>
      <div class="purchase-builder">
        <section class="purchase-step"><div class="purchase-step-title"><b>1</b><span><strong>Datos generales y envío</strong><small>El envío se distribuye automáticamente entre todas las unidades.</small></span></div><div class="purchase-form-grid"><label>Fecha<input id="poDate" type="date" value="${today}"></label><label>Cotización USDT<input id="poRate" type="number" step="0.01" value="1480"></label><label>Costo total del envío<input id="poShipping" type="number" step="0.01" value="0"></label><label>Moneda del envío<select id="poShippingCurrency"><option value="USDT">USDT</option><option value="ARS">ARS</option></select></label><label>Proveedor<input id="poProvider" placeholder="Proveedor / distribuidor"></label><label>Nota<input id="poNote" placeholder="Observaciones opcionales"></label></div><div id="poShippingInfo" class="purchase-info"></div></section>
        <section class="purchase-step"><div class="purchase-step-title"><b>2</b><span><strong>Cargar productos</strong><small>Podés vincular un producto existente o crear uno nuevo desde este pedido.</small></span></div><div class="purchase-mode-row"><label>Tipo<select id="poItemMode"><option value="existing">Producto existente</option><option value="new">Producto nuevo</option></select></label></div><div id="poExistingFields" class="purchase-existing-fields"><div class="purchase-product-search"><label>Producto existente<input id="poProductSearch" autocomplete="off" placeholder="Escribí nombre, SKU, categoría…"><input id="poProduct" type="hidden"></label><div id="poProductResults" class="smart-search-results purchase-product-results"></div></div><div id="poVariantArea" class="purchase-variant-area hidden"><div class="purchase-variant-head"><label>Variante<select id="poVariant"><option value="">Elegí una variante</option></select></label><button id="poNewVariantToggle" type="button" class="btn ghost tiny">+ Nueva variante</button></div><div id="poNewVariantExisting" class="purchase-new-variant-inline hidden"><label>Nombre de variante<input id="poExistingNewVariant" placeholder="Ej: XL / Blue Razz / 100 ml"></label><label>SKU opcional<input id="poExistingNewVariantSku" placeholder="SKU"></label><button id="poCreateExistingVariant" type="button" class="btn primary tiny">Crear variante</button></div></div><div class="purchase-form-grid purchase-existing-values"><label>Costo proveedor USDT / unidad<input id="poCostExisting" type="number" step="0.01" placeholder="Ej: 18"></label><label>Cantidad<input id="poQtyExisting" type="number" min="1" step="1" value="1"></label></div></div><div id="poNewFields" class="purchase-form-grid hidden"><label>Categoría<select id="poCategory">${cats.map(c=>`<option>${esc(c)}</option>`).join('')}</select></label><label>Producto<input id="poNewName" placeholder="Ej: Argentina 2006"></label><label>Detalle / variante<input id="poNewVariant" placeholder="Ej: Messi XL / 100 ml / Blue Razz"></label><label>SKU opcional<input id="poNewSku" placeholder="SKU"></label><label>Costo proveedor USDT / unidad<input id="poCostNew" type="number" step="0.01" placeholder="Ej: 18"></label><label>Cantidad<input id="poQtyNew" type="number" min="1" step="1" value="1"></label></div><div id="poSimilar" class="purchase-similar hidden"></div><button id="poAddItem" class="btn good">Agregar al pedido</button></section>
        <section class="purchase-step"><div class="purchase-step-title"><b>3</b><span><strong>Pedido en carga</strong><small>Revisá productos, cantidades y costo puesto antes de finalizar.</small></span></div><div id="poDraft"></div><div id="poSummary" class="purchase-summary-cards"></div><div class="modal-actions"><button class="btn ghost modal-close">Cancelar</button><button id="poFinalize" class="btn primary">Finalizar pedido</button></div></section>
      </div>`);
    const productMap=new Map(products.map(x=>[x.id,x]));
    const el=id=>document.getElementById(id);
    function currentCalc(){const rate=Number(el('poRate').value||0),shipIn=Number(el('poShipping').value||0),cur=el('poShippingCurrency').value,units=draft.reduce((a,x)=>a+Number(x.quantity||0),0),merch=draft.reduce((a,x)=>a+Number(x.supplier_usdt||0)*Number(x.quantity||0),0),shipUsdt=cur==='ARS'?(rate>0?shipIn/rate:0):shipIn,shipPer=units?shipUsdt/units:0;return{rate,shipIn,cur,units,merch,shipUsdt,shipPer,investment:merch+shipUsdt,ars:(merch+shipUsdt)*rate}}
    function updateShipping(){const c=currentCalc();el('poShippingInfo').innerHTML=c.cur==='ARS'?`Envío ingresado: <b>${money(c.shipIn)}</b> · equivalente <b>USD ${number(c.shipUsdt)}</b>. ${c.units?`Distribución: <b>USD ${number(c.shipPer)} por unidad</b>.`:'Se distribuirá cuando cargues unidades.'}`:`Envío ingresado: <b>USD ${number(c.shipIn)}</b>. ${c.units?`Distribución: <b>USD ${number(c.shipPer)} por unidad</b>.`:'Se distribuirá cuando cargues unidades.'}`;renderDraft()}
    let selectedPurchaseProduct=null;
    function fillVariants(){const p=selectedPurchaseProduct||productMap.get(el('poProduct').value);el('poVariant').innerHTML='<option value="">Elegí una variante</option>'+(p?.variants||[]).map(v=>`<option value="${v.id}">${esc(v.variant_name||'Única')} · stock ${number(v.stock?.available||0)}</option>`).join('');el('poVariantArea').classList.toggle('hidden',!p);if(p?.variants?.length===1)el('poVariant').value=p.variants[0].id}
    function drawProductMatches(){const input=el('poProductSearch'),box=el('poProductResults'),q=input.value.trim().toLowerCase();if(!q){box.innerHTML='';box.classList.remove('open');return}const hits=products.filter(p=>[p.name,p.sku,p.category,...(p.variants||[]).flatMap(v=>[v.variant_name,v.sku])].join(' ').toLowerCase().includes(q)).slice(0,20);box.innerHTML=hits.map(p=>`<button type="button" class="smart-search-row ${selectedPurchaseProduct?.id===p.id?'selected':''}" data-po-product="${p.id}"><span><b>${esc(p.name)}</b><small>${esc(p.category||'Sin categoría')}${p.sku?` · ${esc(p.sku)}`:''}</small></span><strong>${number((p.variants||[]).length)} ${(p.variants||[]).length===1?'variante':'variantes'}</strong></button>`).join('')||'<div class="empty compact-empty">No encontramos productos con esas letras.</div>';box.classList.add('open');box.querySelectorAll('[data-po-product]').forEach(b=>b.addEventListener('click',()=>{selectedPurchaseProduct=productMap.get(b.dataset.poProduct)||null;el('poProduct').value=selectedPurchaseProduct?.id||'';input.value=selectedPurchaseProduct?.name||'';box.classList.remove('open');fillVariants()}))}
    function similar(){const name=String(el('poNewName').value||'').trim().toLowerCase(),cat=el('poCategory').value;if(name.length<3){el('poSimilar').classList.add('hidden');return}const hits=products.filter(p=>p.name.toLowerCase().includes(name)||name.includes(p.name.toLowerCase())).filter(p=>!cat||String(p.category||'').toLowerCase()===String(cat).toLowerCase()).slice(0,4);el('poSimilar').innerHTML=hits.length?`<b>¿Ya existe?</b> ${hits.map(p=>`<span>${esc(p.name)} · ${esc(p.category||'')}</span>`).join('')}`:'<span>No encontramos una coincidencia exacta en Central.</span>';el('poSimilar').classList.remove('hidden')}
    function renderDraft(){const c=currentCalc();el('poDraft').innerHTML=draft.length?`<div class="table-wrap"><table class="table purchase-draft-table"><thead><tr><th>Producto</th><th>Variante</th><th>Cant.</th><th>Proveedor/u.</th><th>Envío/u.</th><th>Costo puesto/u.</th><th></th></tr></thead><tbody>${draft.map((x,i)=>{const landed=Number(x.supplier_usdt)+c.shipPer;return`<tr><td><b>${esc(x.product_name)}</b><br><small>${esc(x.category||'')}</small></td><td>${esc(x.variant_name||'Única')}</td><td>${number(x.quantity)}</td><td>USD ${number(x.supplier_usdt)}</td><td>USD ${number(c.shipPer)}</td><td><b>USD ${number(landed)}</b><br><small>${money(landed*c.rate)}</small></td><td><button class="btn tiny danger-btn po-remove" data-i="${i}">Eliminar</button></td></tr>`}).join('')}</tbody></table></div>`:'<div class="empty purchase-empty">No hay productos cargados.</div>';el('poSummary').innerHTML=`<div><small>Unidades</small><b>${number(c.units)}</b></div><div><small>Mercadería</small><b>USD ${number(c.merch)}</b></div><div><small>Envío</small><b>USD ${number(c.shipUsdt)}</b></div><div><small>Envío / unidad</small><b>USD ${number(c.shipPer)}</b></div><div class="primary"><small>Inversión total</small><b>USD ${number(c.investment)}</b></div><div><small>Equivalente ARS</small><b>${money(c.ars)}</b></div>`;document.querySelectorAll('.po-remove').forEach(b=>b.addEventListener('click',()=>{draft.splice(Number(b.dataset.i),1);updateShipping()}))}
    el('poItemMode').addEventListener('change',()=>{const isNew=el('poItemMode').value==='new';el('poExistingFields').classList.toggle('hidden',isNew);el('poNewFields').classList.toggle('hidden',!isNew);el('poSimilar').classList.add('hidden')});el('poProductSearch').addEventListener('input',()=>{selectedPurchaseProduct=null;el('poProduct').value='';el('poVariantArea').classList.add('hidden');drawProductMatches()});el('poProductSearch').addEventListener('focus',drawProductMatches);el('poProductSearch').addEventListener('blur',()=>setTimeout(()=>el('poProductResults')?.classList.remove('open'),180));el('poNewVariantToggle').addEventListener('click',()=>{el('poNewVariantExisting').classList.toggle('hidden');if(!el('poNewVariantExisting').classList.contains('hidden'))el('poExistingNewVariant').focus()});el('poCreateExistingVariant').addEventListener('click',async()=>{const p=selectedPurchaseProduct,name=el('poExistingNewVariant').value.trim(),sku=el('poExistingNewVariantSku').value.trim()||null;if(!p)return alert('Elegí primero un producto existente.');if(!name)return alert('Ingresá el nombre de la variante.');if((p.variants||[]).some(v=>String(v.variant_name||'').trim().toLowerCase()===name.toLowerCase()))return alert('Esa variante ya existe en este producto.');const btn=el('poCreateExistingVariant');btn.disabled=true;btn.textContent='Creando…';try{const v=await DB.createVariant(p.id,{variant_name:name,sku,cost_ars:0,price_ars:0,stock_min:0,active:true,attributes:{opcion:name}},0,'Alta desde compra de mercadería');v.stock={on_hand:0,available:0,reserved:0,in_transit:0};p.variants.push(v);el('poExistingNewVariant').value='';el('poExistingNewVariantSku').value='';el('poNewVariantExisting').classList.add('hidden');fillVariants();el('poVariant').value=v.id}catch(e){alert(e.message)}finally{btn.disabled=false;btn.textContent='Crear variante'}});el('poNewName').addEventListener('input',()=>{clearTimeout(timer);timer=setTimeout(similar,180)});['poRate','poShipping'].forEach(id=>el(id).addEventListener('input',updateShipping));el('poShippingCurrency').addEventListener('change',updateShipping);
    el('poAddItem').addEventListener('click',()=>{const mode=el('poItemMode').value;if(mode==='existing'){const p=selectedPurchaseProduct||productMap.get(el('poProduct').value),v=p?.variants.find(x=>x.id===el('poVariant').value),cost=Number(el('poCostExisting').value),qty=Number(el('poQtyExisting').value);if(!p||!v||!Number.isFinite(cost)||cost<0||!Number.isFinite(qty)||qty<=0)return alert('Completá producto, variante, costo y cantidad.');draft.push({variant_id:v.id,category:p.category,product_name:p.name,variant_name:v.variant_name,sku:v.sku,supplier_usdt:cost,quantity:qty});el('poCostExisting').value='';el('poQtyExisting').value='1'}else{const name=el('poNewName').value.trim(),variant=el('poNewVariant').value.trim()||'Única',cost=Number(el('poCostNew').value),qty=Number(el('poQtyNew').value);if(!name||!Number.isFinite(cost)||cost<0||!Number.isFinite(qty)||qty<=0)return alert('Completá nombre, costo y cantidad.');draft.push({variant_id:null,category:el('poCategory').value,product_name:name,variant_name:variant,sku:el('poNewSku').value.trim()||null,supplier_usdt:cost,quantity:qty});el('poNewName').value='';el('poNewVariant').value='';el('poNewSku').value='';el('poCostNew').value='';el('poQtyNew').value='1';el('poSimilar').classList.add('hidden')}updateShipping()});
    el('poFinalize').addEventListener('click',async()=>{if(!draft.length)return alert('Cargá al menos un producto.');const rate=Number(el('poRate').value);if(!(rate>0))return alert('Ingresá una cotización USDT válida.');const btn=el('poFinalize');btn.disabled=true;try{const res=await DB.createPurchaseOrder({orderDate:el('poDate').value,usdtRate:rate,shippingAmount:Number(el('poShipping').value||0),shippingCurrency:el('poShippingCurrency').value,provider:el('poProvider').value.trim(),note:el('poNote').value.trim(),items:draft});closeModal();operationsTab='purchases';await renderOrders();alert(`Pedido #${res.order_number} guardado. ${res.total_units} unidades · USD ${number(res.investment_usdt)} invertidos.`)}catch(e){alert(e.message);btn.disabled=false}});
    fillVariants();updateShipping();
  }

  async function openAddTracking(orderId,orders){
    const eligible=orders.filter(o=>!(o.items.length&&o.items.every(i=>i.stock_link_status==='historical')));
    openModal(`<div class="section-title"><div><span class="eyebrow">SEGUIMIENTO</span><h3>Agregar guía</h3><p class="muted">La guía se registra en 17TRACK desde Supabase; la clave privada nunca llega al navegador.</p></div><button class="modal-close">×</button></div><div class="form-grid"><label>Pedido<select id="trackOrder">${eligible.map(o=>`<option value="${o.id}" ${Number(orderId)===Number(o.id)?'selected':''}>Pedido #${esc(o.order_number)} · ${esc(o.provider||o.order_date||'')}</option>`).join('')}</select></label><label>Transportista<select id="trackCarrier"><option>Via Cargo</option></select></label><label class="wide">Número de seguimiento<input id="trackNumber" placeholder="Ej: 999037813885"></label></div><div class="modal-actions"><button class="btn ghost modal-close">Cancelar</button><button id="saveTracking" class="btn primary">Guardar seguimiento</button></div>`);
    $('#saveTracking').addEventListener('click',async()=>{const order=Number($('#trackOrder').value),tracking=$('#trackNumber').value.trim();if(!order||!tracking)return alert('Seleccioná el pedido e ingresá la guía.');const b=$('#saveTracking');b.disabled=true;try{const res=await DB.createShipment(order,tracking,$('#trackCarrier').value);if(res.register_error)alert('La guía quedó guardada, pero 17TRACK no pudo registrarla todavía. Podés reintentar desde Seguimiento.');else{try{await DB.refreshShipment(res.id)}catch{}}closeModal();operationsTab='tracking';await renderOrders()}catch(e){alert(e.message);b.disabled=false}});
  }

  function openPurchasePayment(order){
    if(!order)return;const estimated=Number(order.investment_usd||0)*Number(order.usdt_rate_ars||0);
    openModal(`<div class="section-title"><div><span class="eyebrow">PAGO DE COMPRA</span><h3>Pedido #${esc(order.order_number)}</h3><p class="muted">El egreso queda vinculado a esta compra y al titular que pagó.</p></div><button class="modal-close">×</button></div><div class="form-grid"><label id="purchasePayAmountLabel">Monto ARS<input id="purchasePayAmount" type="number" step="0.01" value="${Math.round(estimated||0)}"></label><label>Medio<select id="purchasePayMethod"><option value="transferencia">Transferencia</option><option value="efectivo">Efectivo</option><option value="usdt">USDT</option></select></label><label>Pagó<select id="purchasePayHolder"><option value="nahuel">Nahuel</option><option value="esteban">Esteban</option></select></label></div><div class="modal-actions"><button class="btn ghost modal-close">Cancelar</button><button id="purchasePaySave" class="btn primary">Registrar pago</button></div>`);
    $('#purchasePayMethod').addEventListener('change',e=>{const usdt=e.target.value==='usdt';$('#purchasePayAmountLabel').childNodes[0].nodeValue=usdt?'Monto USDT':'Monto ARS';$('#purchasePayAmount').value=usdt?Number(order.investment_usd||0).toFixed(2):Math.round(estimated||0)});
    $('#purchasePaySave').addEventListener('click',async()=>{const b=$('#purchasePaySave');b.disabled=true;try{await DB.registerPurchasePayment(order.id,Number($('#purchasePayAmount').value),$('#purchasePayMethod').value,$('#purchasePayHolder').value);closeModal();await renderOrders()}catch(e){alert(e.message);b.disabled=false}})
  }

  function openNewExpense(orders,preOrderId=null){
    const today=new Date().toISOString().slice(0,10);
    openModal(`<div class="section-title"><div><span class="eyebrow">GASTOS</span><h3>Registrar gasto</h3><p class="muted">Podés vincularlo a una compra y, si fue pagado ahora, impactarlo también en Finanzas.</p></div><button class="modal-close">×</button></div><div class="form-grid expense-form"><label>Fecha<input id="expenseDate" type="date" value="${today}"></label><label>Tipo<select id="expenseType"><option>Materia prima</option><option>Envío</option><option>Impuesto</option><option>Logística</option><option>Proveedor</option><option>Servicio</option><option>Comisión</option><option>Publicidad</option><option>Otro</option></select></label><label>Proveedor<input id="expenseProvider"></label><label>Descripción<input id="expenseDescription"></label><label>Monto ARS<input id="expenseArs" type="number" step="0.01" value="0"></label><label>Monto USD / USDT opcional<input id="expenseUsd" type="number" step="0.01"></label><label>Cotización opcional<input id="expenseRate" type="number" step="0.01"></label><label>Vincular a compra<select id="expenseOrder"><option value="">Gasto general</option>${orders.map(o=>`<option value="${o.id}" ${Number(preOrderId)===Number(o.id)?'selected':''}>Pedido #${esc(o.order_number)} · ${esc(o.provider||o.order_date||'')}</option>`).join('')}</select></label></div><label class="check finance-expense-check"><input id="expenseFinance" type="checkbox"> También registrar como egreso en Finanzas</label><div id="expenseFinanceFields" class="form-grid hidden"><label>Medio<select id="expenseMethod"><option value="transferencia">Transferencia</option><option value="efectivo">Efectivo</option><option value="usdt">USDT</option></select></label><label>Pagó<select id="expenseHolder"><option value="nahuel">Nahuel</option><option value="esteban">Esteban</option></select></label></div><div class="modal-actions"><button class="btn ghost modal-close">Cancelar</button><button id="expenseSave" class="btn primary">Guardar gasto</button></div>`);
    $('#expenseFinance').addEventListener('change',e=>$('#expenseFinanceFields').classList.toggle('hidden',!e.target.checked));$('#expenseSave').addEventListener('click',async()=>{const b=$('#expenseSave');b.disabled=true;try{await DB.createExpense({date:$('#expenseDate').value,type:$('#expenseType').value,provider:$('#expenseProvider').value.trim(),description:$('#expenseDescription').value.trim(),amountArs:Number($('#expenseArs').value||0),amountUsd:$('#expenseUsd').value===''?null:Number($('#expenseUsd').value),dollarRate:$('#expenseRate').value===''?null:Number($('#expenseRate').value),orderId:$('#expenseOrder').value||null,paymentMethod:$('#expenseFinance').checked?$('#expenseMethod').value:null,holder:$('#expenseFinance').checked?$('#expenseHolder').value:null});closeModal();operationsTab='expenses';await renderOrders()}catch(e){alert(e.message);b.disabled=false}})
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
  function financeHolderValue(movement,method){
    if(method==='transferencia')return String(movement.transfer_holder||'').toLowerCase();
    if(method==='efectivo')return String(movement.cash_holder||'').toLowerCase();
    if(method==='usdt')return String(movement.usdt_holder||'').toLowerCase();
    return '';
  }
  function financeMethodMovements(f,method){
    return (f?.movements||[]).filter(x=>{
      if(method==='usdt')return x.currency==='USDT'&&x.payment_method==='usdt';
      return x.currency==='ARS'&&x.payment_method===method;
    });
  }
  function financeHolderBreakdown(f,method){
    const out={nahuel:0,esteban:0,unassigned:0,total:0};
    for(const x of financeMethodMovements(f,method)){
      const sign=x.kind==='income'?1:-1;
      const value=sign*Number(x.amount||0);
      const holder=financeHolderValue(x,method);
      if(holder==='nahuel')out.nahuel+=value;
      else if(holder==='esteban')out.esteban+=value;
      else out.unassigned+=value;
      out.total+=value;
    }
    return out;
  }
  function financeMethodLabel(method){return method==='transferencia'?'Transferencias':method==='efectivo'?'Efectivo':'USDT'}
  function financeAmountByMethod(method,n){return method==='usdt'?`${number(n)} USDT`:money(n)}
  function renderFinanceHolderCard(f,method){
    const b=financeHolderBreakdown(f,method),label=financeMethodLabel(method);
    return `<details class="card finance-holder-card" open><summary><div><span class="eyebrow">${esc(label.toUpperCase())}</span><strong>${financeAmountByMethod(method,b.total)}</strong></div><span class="accordion-chevron">⌄</span></summary><div class="finance-holder-rows"><button class="finance-holder-row open-holder-movements" data-method="${method}" data-holder="nahuel"><span>Nahuel</span><b>${financeAmountByMethod(method,b.nahuel)}</b></button><button class="finance-holder-row open-holder-movements" data-method="${method}" data-holder="esteban"><span>Esteban</span><b>${financeAmountByMethod(method,b.esteban)}</b></button><button class="finance-holder-row unassigned ${Math.abs(b.unassigned)>0.000001?'has-value':''} assign-unassigned-group" data-method="${method}"><span>Sin asignar</span><b>${financeAmountByMethod(method,b.unassigned)}</b><small>${Math.abs(b.unassigned)>0.000001?'Tocar para asignar':'Todo asignado'}</small></button></div></details>`;
  }
  function openFinanceHolderMovements(method,holder){
    const f=financeCache;if(!f)return;
    const rows=financeMethodMovements(f,method).filter(x=>financeHolderValue(x,method)===holder);
    openModal(`<div class="section-title"><div><span class="eyebrow">${esc(financeMethodLabel(method).toUpperCase())}</span><h3>${holder==='nahuel'?'Nahuel':'Esteban'}</h3><p class="muted">Movimientos que explican este saldo.</p></div><button class="modal-close modal-x">×</button></div><div class="finance-holder-history">${rows.map(x=>`<div class="finance-holder-movement"><div><b>${x.kind==='income'?'+':'−'} ${financeAmountByMethod(method,Math.abs(Number(x.amount||0)))}</b><small>${safeDate(x.occurred_at)} · ${esc(x.category||'—')}</small></div><span>${esc(x.description||'Sin detalle')}</span></div>`).join('')||'<div class="empty">No hay movimientos para este titular.</div>'}</div>`);
  }
  function openUnassignedFinance(method){
    const f=financeCache;if(!f)return;
    const rows=financeMethodMovements(f,method).filter(x=>!['nahuel','esteban'].includes(financeHolderValue(x,method)));
    openModal(`<div class="section-title"><div><span class="eyebrow">SIN ASIGNAR</span><h3>${esc(financeMethodLabel(method))}</h3><p class="muted">Asignar no genera otro ingreso: solo identifica quién tiene el dinero.</p></div><button class="modal-close modal-x">×</button></div><div class="finance-unassigned-list">${rows.map(x=>`<div class="finance-unassigned-item"><div><b>${x.kind==='income'?'+':'−'} ${financeAmountByMethod(method,Math.abs(Number(x.amount||0)))}</b><small>${safeDate(x.occurred_at)} · ${esc(x.description||x.category||'Movimiento')}</small></div><div class="finance-assign-actions"><button class="btn tiny ghost assign-movement-holder" data-id="${x.id}" data-holder="nahuel">Nahuel</button><button class="btn tiny ghost assign-movement-holder" data-id="${x.id}" data-holder="esteban">Esteban</button></div></div>`).join('')||'<div class="empty">No hay dinero sin asignar.</div>'}</div>`);
    document.querySelectorAll('.assign-movement-holder').forEach(b=>b.addEventListener('click',async()=>{b.disabled=true;try{await DB.assignMovementHolder(b.dataset.id,b.dataset.holder);closeModal();await renderFinance()}catch(e){alert(e.message);b.disabled=false}}));
  }
  function openFinanceRecount(){
    const f=financeCache;if(!f)return;
    const cash=financeHolderBreakdown(f,'efectivo'),transfer=financeHolderBreakdown(f,'transferencia'),usdtB=financeHolderBreakdown(f,'usdt');
    const field=(id,label,value,method)=>`<label>${label}<input id="${id}" type="number" step="${method==='usdt'?'0.01':'1'}" value="${Number(value||0)}"></label>`;
    openModal(`<div class="section-title"><div><span class="eyebrow">RECUENTO RÁPIDO</span><h3>Actualizar saldos reales</h3><p class="muted">Escribí cuánto hay realmente. Central calcula la diferencia y crea el ingreso o egreso de ajuste automáticamente, sin alterar el resultado operativo.</p></div><button class="modal-close modal-x">×</button></div>
      <div class="finance-recount-grid">
        <section><div><span class="eyebrow">EFECTIVO</span><small>Saldo contado</small></div>${field('frCashNahuel','Nahuel',cash.nahuel,'cash')}${field('frCashEsteban','Esteban',cash.esteban,'cash')}</section>
        <section><div><span class="eyebrow">TRANSFERENCIAS</span><small>Saldo real</small></div>${field('frTransferNahuel','Nahuel',transfer.nahuel,'transfer')}${field('frTransferEsteban','Esteban',transfer.esteban,'transfer')}</section>
        <section><div><span class="eyebrow">USDT</span><small>Tenencia real</small></div>${field('frUsdtNahuel','Nahuel',usdtB.nahuel,'usdt')}${field('frUsdtEsteban','Esteban',usdtB.esteban,'usdt')}</section>
      </div>
      <div class="notice finance-recount-example">Ejemplo: si Efectivo · Nahuel figura en $50.000 y en el recuento tenés $150.000, Central registra automáticamente un ingreso de ajuste de $100.000 a Nahuel.</div>
      <div class="modal-actions"><button class="btn ghost modal-close">Cancelar</button><button id="saveFinanceRecount" class="btn primary">Actualizar y registrar diferencias</button></div>`);
    $('#saveFinanceRecount').addEventListener('click',async()=>{
      const entries=[
        ['efectivo','nahuel','frCashNahuel',cash.nahuel],['efectivo','esteban','frCashEsteban',cash.esteban],
        ['transferencia','nahuel','frTransferNahuel',transfer.nahuel],['transferencia','esteban','frTransferEsteban',transfer.esteban],
        ['usdt','nahuel','frUsdtNahuel',usdtB.nahuel],['usdt','esteban','frUsdtEsteban',usdtB.esteban]
      ];
      const changed=entries.filter(([, ,id,current])=>{const target=Number($('#'+id).value);return Number.isFinite(target)&&Math.abs(target-Number(current||0))>0.000001});
      if(entries.some(([, ,id])=>!Number.isFinite(Number($('#'+id).value))))return alert('Revisá los saldos ingresados.');
      if(!changed.length)return alert('No hay diferencias para registrar.');
      const btn=$('#saveFinanceRecount');btn.disabled=true;btn.textContent='Actualizando…';
      try{
        for(const [method,holder,id] of changed)await DB.reconcileFinanceBalance(method,holder,Number($('#'+id).value));
        closeModal();financeTab='summary';await renderFinance();
      }catch(e){alert(e.message);btn.disabled=false;btn.textContent='Actualizar y registrar diferencias'}
    });
  }

  async function renderFinance(){
    const f=await DB.financeData(500);
    financeCache=f;
    const pendingSett=f.settlements.filter(x=>x.status==='pending');
    const openRecv=f.receivables.filter(x=>!['paid','cancelled'].includes(x.status));
    const methods=[...new Set(f.movements.map(x=>x.payment_method).filter(Boolean))].sort();
    const tabs=[['summary','Resumen'],['movements','Movimientos'],['settlements','A liquidar'],['receivables','A cobrar'],['usdt','USDT / ARS'],['results','Resultados'],['audit','Auditoría']];
    const tabbar=`<div class="finance-tabs">${tabs.map(([id,label])=>`<button class="${financeTab===id?'active':''}" data-fin-tab="${id}">${label}${id==='settlements'&&pendingSett.length?` <b>${pendingSett.length}</b>`:''}${id==='receivables'&&openRecv.length?` <b>${openRecv.length}</b>`:''}</button>`).join('')}</div>`;
    let body='';
    if(financeTab==='summary'){
      const q=f.quote||{};const usdtVal=f.balances.usdt*Number(q.sell_ars||0);const available=f.balances.cash+f.balances.transfer+usdtVal;
      body=`<div class="finance-dashboard-grid"><section class="card finance-balance-card"><span class="eyebrow">SALDO DISPONIBLE ESTIMADO</span><h3>${money(available)}</h3><p class="muted">Transferencias + efectivo + USDT valorizado a cotización de venta.</p></section><section class="card finance-quote-card"><span class="eyebrow">USDT / ARS</span><h3>Cotización</h3>${q.captured_at?`<div class="quote-pair"><div><small>Compra USDT</small><b>${money(q.buy_ars)}</b></div><div class="profit"><small>Venta USDT</small><b>${money(q.sell_ars)}</b></div></div><p class="muted small-text">${esc(q.source||'Cotización')} · ${safeDate(q.captured_at)}</p>`:'<div class="empty">Sin cotización disponible.</div>'}</section></div>
      <div class="finance-holder-stack">${renderFinanceHolderCard(f,'transferencia')}${renderFinanceHolderCard(f,'efectivo')}${renderFinanceHolderCard(f,'usdt')}</div>
      <div class="finance-control-cards"><button data-fin-jump="settlements"><small>Pendiente de acreditación</small><b>${money(pendingSett.reduce((a,x)=>a+Number(x.net_amount||0),0))}</b><span>${pendingSett.length} operaciones</span></button><button data-fin-jump="receivables"><small>Total a cobrar</small><b>${money(openRecv.reduce((a,x)=>a+Number(x.pending_amount||0),0))}</b><span>${openRecv.length} cuentas</span></button><button data-fin-jump="results"><small>Resultado operativo</small><b class="${f.net>=0?'profit':'negative'}">${money(f.net)}</b><span>Ingresos − egresos reales</span></button></div>`;
    }else if(financeTab==='movements'){
      const q=financeSearch.trim().toLowerCase();
      const saleMap=new Map((f.sales||[]).map(x=>[String(x.id),x]));
      const rows=f.movements.filter(x=>(financeKind==='all'||x.kind===financeKind)&&(financeMethod==='all'||x.payment_method===financeMethod)&&(!q||[x.description,x.category,x.payment_method,x.source_type,x.amount,saleMap.get(String(x.source_id))?.sale_code].join(' ').toLowerCase().includes(q)));
      body=`<section class="card"><div class="section-title"><div><span class="eyebrow">HISTORIAL</span><h3>Transacciones</h3></div></div><div class="toolbar"><input id="financeSearch" value="${esc(financeSearch)}" placeholder="Buscar detalle, venta, categoría o monto…"><select id="financeKind"><option value="all">Ingresos y egresos</option><option value="income" ${financeKind==='income'?'selected':''}>Ingresos</option><option value="expense" ${financeKind==='expense'?'selected':''}>Egresos</option></select><select id="financeMethod"><option value="all">Todos los métodos</option>${methods.map(m=>`<option value="${esc(m)}" ${financeMethod===m?'selected':''}>${esc(m)}</option>`).join('')}</select></div><div class="finance-history-list">${rows.map(x=>{const manual=!x.source_type||x.source_type==='manual';const linkedSale=x.source_type==='sale'?saleMap.get(String(x.source_id)):null;const cancelled=linkedSale?.status==='cancelled';return`<details class="finance-movement operation-accordion ${cancelled?'movement-cancelled':''}" ${financeFocusMovementId===x.id?'open':''}><summary><span><b>${x.kind==='income'?'+':'−'} ${x.currency==='USDT'?`${number(x.amount)} USDT`:money(x.amount)}</b><small>${safeDate(x.occurred_at)} · ${esc(x.payment_method)}${linkedSale?` · ${esc(linkedSale.sale_code)}`:x.source_type==='finance_recount'&&x.description?` · ${esc(x.description)}`:''}</small></span><span>${cancelled?'<span class="pill red">CANCELADA</span>':x.kind==='income'?'<span class="pill green">Ingreso</span>':'<span class="pill red">Egreso</span>'}<i>⌄</i></span></summary><div class="finance-movement-body"><div class="operation-kv"><div><small>Categoría</small><b>${esc(x.category||'—')}</b></div><div><small>Detalle</small><b>${esc(x.description||'—')}</b></div><div><small>Origen</small><b>${linkedSale?`Venta ${esc(linkedSale.sale_code)}`:esc(x.source_type||'manual')}</b></div><div><small>Método</small><b>${esc(x.payment_method)}</b></div></div><div class="modal-actions"><button class="btn ghost tiny edit-finance" data-id="${x.id}">Editar</button>${manual?`<button class="btn danger-btn tiny delete-finance" data-id="${x.id}">Eliminar</button>`:linkedSale&&!cancelled?`<button class="btn danger-btn tiny cancel-fin-sale" data-id="${linkedSale.id}" data-code="${esc(linkedSale.sale_code)}">Anular venta</button>`:linkedSale?`<button class="btn ghost tiny view-fin-origin" data-type="sale" data-id="${linkedSale.id}">Ver venta cancelada</button>`:`<button class="btn ghost tiny view-fin-origin" data-type="${esc(x.source_type||'')}" data-id="${esc(x.source_id||'')}">Ver origen</button>`}</div></div></details>`}).join('')||'<div class="empty">No hay transacciones.</div>'}</div></section>`;
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
    const actionbar=financeTab==='summary'?`<div class="finance-actionbar finance-summary-actions"><button id="financeRecount" class="btn primary">↻ Actualizar saldos</button></div>`:financeTab==='movements'?`<div class="finance-actionbar"><button id="newMovement" class="btn primary">+ Nuevo movimiento</button></div>`:financeTab==='settlements'?`<div class="finance-actionbar"><button id="newSettlement" class="btn primary">+ Nueva liquidación</button></div>`:financeTab==='receivables'?`<div class="finance-actionbar"><button id="newReceivable" class="btn primary">+ Nuevo deudor</button></div>`:'';
    content.innerHTML=`${tabbar}${actionbar}<div class="finance-tab-body">${body}</div>`;
    document.querySelectorAll('[data-fin-tab]').forEach(b=>b.addEventListener('click',()=>{financeTab=b.dataset.finTab;renderFinance()}));
    document.querySelectorAll('[data-fin-jump]').forEach(b=>b.addEventListener('click',()=>{financeTab=b.dataset.finJump;renderFinance()}));
    document.querySelectorAll('.open-holder-movements').forEach(b=>b.addEventListener('click',()=>openFinanceHolderMovements(b.dataset.method,b.dataset.holder)));
    document.querySelectorAll('.assign-unassigned-group').forEach(b=>b.addEventListener('click',()=>openUnassignedFinance(b.dataset.method)));
    $('#financeRecount')?.addEventListener('click',openFinanceRecount);
    $('#newMovement')?.addEventListener('click',openNewFinanceMovement);
    $('#newSettlement')?.addEventListener('click',openNewSettlement);
    $('#newReceivable')?.addEventListener('click',openNewReceivable);
    $('#financeSearch')?.addEventListener('input',e=>{financeSearch=e.target.value;clearTimeout(timer);timer=setTimeout(renderFinance,130)});
    $('#financeKind')?.addEventListener('change',e=>{financeKind=e.target.value;renderFinance()});
    $('#financeMethod')?.addEventListener('change',e=>{financeMethod=e.target.value;renderFinance()});
    bindOperationAccordions();
    document.querySelectorAll('.edit-finance').forEach(b=>b.addEventListener('click',()=>openFinanceEditor(f.movements.find(x=>x.id===b.dataset.id))));
    document.querySelectorAll('.delete-finance').forEach(b=>b.addEventListener('click',async()=>{if(!confirm('¿Eliminar este movimiento manual? El saldo se recalculará.'))return;try{await DB.deleteManualMovement(b.dataset.id);await renderFinance()}catch(e){alert(e.message)}}));
    document.querySelectorAll('.cancel-fin-sale').forEach(b=>b.addEventListener('click',async()=>{const reason=prompt(`Motivo para anular ${b.dataset.code}:`,'Error / devolución');if(reason===null)return;if(!confirm('Se reintegrará el stock y se revertirá el dinero. La venta y el movimiento quedarán visibles como cancelados. ¿Continuar?'))return;try{await DB.cancelSale(b.dataset.id,reason);financeFocusMovementId=null;await renderFinance()}catch(e){alert(e.message)}}));
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
  async function openNewReceivable(){
    let customers=[];
    try{customers=await DB.customers('')}catch(e){console.error(e)}
    let selectedCustomer=null;
    openModal(`<div class="section-title"><div><span class="eyebrow">A COBRAR</span><h3>Nuevo deudor</h3><p class="muted">Buscá primero en tu base de Clientes. Así la deuda queda vinculada a la ficha correcta.</p></div><button class="modal-close modal-x">×</button></div>
      <div class="form-grid">
        <div class="smart-customer-row wide">
          <label>Cliente<input id="nrCustomerSearch" autocomplete="off" placeholder="Escribí nombre, teléfono, email o código…"></label>
          <input id="nrCustomerId" type="hidden">
          <div id="nrCustomerResults" class="customer-search-results"></div>
          <div id="nrCustomerSelected" class="finance-customer-selected hidden"></div>
        </div>
        <label>Teléfono<input id="nrPhone" placeholder="Se completa al elegir cliente"></label>
        <label>Total<input id="nrTotal" type="number" min="1"></label>
        <label>Vencimiento<input id="nrDue" type="date"></label>
      </div>
      <label style="margin-top:12px">Descripción<input id="nrDescription"></label>
      <div class="modal-actions"><button class="btn ghost modal-close">Cancelar</button><button id="saveNewReceivable" class="btn primary">Guardar deuda</button></div>`);

    const input=$('#nrCustomerSearch'),results=$('#nrCustomerResults'),selectedBox=$('#nrCustomerSelected');
    const normalized=v=>String(v||'').trim().toLowerCase();
    const clearSelected=()=>{
      selectedCustomer=null;
      $('#nrCustomerId').value='';
      selectedBox.classList.add('hidden');
      selectedBox.innerHTML='';
    };
    const selectCustomer=c=>{
      selectedCustomer=c;
      $('#nrCustomerId').value=c.id;
      input.value=c.full_name||'';
      $('#nrPhone').value=c.phone||'';
      results.classList.remove('open');
      selectedBox.classList.remove('hidden');
      selectedBox.innerHTML=`<span><b>${esc(c.full_name||'Cliente')}</b><small>${esc(c.phone||c.email||c.customer_code||'Ficha de cliente vinculada')}</small></span><button id="nrChangeCustomer" type="button" class="btn tiny ghost">Cambiar</button>`;
      $('#nrChangeCustomer')?.addEventListener('click',()=>{clearSelected();input.focus();renderMatches()});
    };
    const renderMatches=()=>{
      if(selectedCustomer)return;
      const term=normalized(input.value);
      if(!term){results.classList.remove('open');results.innerHTML='';return}
      const matches=customers.filter(c=>[c.full_name,c.phone,c.email,c.customer_code,c.instagram_username].join(' ').toLowerCase().includes(term)).slice(0,10);
      results.innerHTML=matches.map(c=>`<button type="button" class="smart-search-row nr-customer-option" data-id="${c.id}"><span><b>${esc(c.full_name||'Sin nombre')}</b><small>${esc([c.phone,c.email,c.customer_code].filter(Boolean).join(' · ')||'Cliente registrado')}</small></span><strong>Elegir</strong></button>`).join('')+
        `<button type="button" class="smart-search-row create-new" id="nrCreateCustomer"><span><b>＋ Crear cliente “${esc(input.value.trim())}”</b><small>Se crea una ficha incompleta y queda vinculada a esta deuda</small></span><strong>Nuevo</strong></button>`;
      results.classList.add('open');
      results.querySelectorAll('.nr-customer-option').forEach(b=>b.addEventListener('click',()=>{const c=customers.find(x=>String(x.id)===String(b.dataset.id));if(c)selectCustomer(c)}));
      $('#nrCreateCustomer')?.addEventListener('click',async()=>{
        const name=input.value.trim();if(!name)return;
        const btn=$('#nrCreateCustomer');btn.disabled=true;btn.querySelector('strong').textContent='Creando…';
        try{
          const c=await DB.createQuickCustomer(name);
          customers.push({...c,full_name:c.full_name||name});
          selectCustomer({...c,full_name:c.full_name||name});
        }catch(e){alert(e.message);btn.disabled=false;btn.querySelector('strong').textContent='Nuevo'}
      });
    };
    input.addEventListener('input',()=>{if(selectedCustomer&&normalized(input.value)!==normalized(selectedCustomer.full_name))clearSelected();renderMatches()});
    input.addEventListener('focus',renderMatches);

    $('#saveNewReceivable').addEventListener('click',async()=>{
      const name=input.value.trim();
      if(!selectedCustomer){
        const exact=customers.find(c=>normalized(c.full_name)===normalized(name));
        if(exact)selectCustomer(exact);
      }
      if(!selectedCustomer)return alert('Elegí un cliente de tu base o crealo desde la búsqueda.');
      const total=Number($('#nrTotal').value||0);if(total<=0)return alert('Ingresá el total de la deuda.');
      const btn=$('#saveNewReceivable');btn.disabled=true;btn.textContent='Guardando…';
      try{
        await DB.createManualReceivable({
          customer_id:selectedCustomer.id,
          client_name:selectedCustomer.full_name||name,
          client_phone:$('#nrPhone').value.trim()||selectedCustomer.phone||null,
          total_amount:total,
          due_at:$('#nrDue').value||null,
          description:$('#nrDescription').value.trim()||null
        });
        closeModal();financeTab='receivables';await renderFinance();
      }catch(e){alert(e.message);btn.disabled=false;btn.textContent='Guardar deuda'}
    });
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
      ${o.status==='pending'&&o.payment_method?.finance_mode==='movement'?`<div class="card web-order-holder-card" style="margin-top:12px"><span class="eyebrow">DESTINO DEL DINERO</span><label style="margin-top:10px">¿Quién recibe esta venta?<select id="webOrderHolder"><option value="nahuel" ${posHolder==='nahuel'?'selected':''}>Nahuel</option><option value="esteban" ${posHolder==='esteban'?'selected':''}>Esteban</option></select></label><small class="muted">Se guardará junto a ${esc(o.payment_method.finance_payment_method==='efectivo'?'Efectivo':'Transferencia')} para que Finanzas sepa dónde quedó el dinero.</small></div>`:''}
      <div class="modal-actions">${o.status==='pending'?`<button id="cancelWebOrder" class="btn danger-btn">Cancelar pedido</button><button id="confirmWebOrder" class="btn primary">Confirmar → Venta</button>`:`<button class="btn ghost modal-close">Cerrar</button>`}</div>`);
    $('#confirmWebOrder')?.addEventListener('click',async()=>{const holder=o.payment_method?.finance_mode==='movement'?($('#webOrderHolder')?.value||null):null;if(o.payment_method?.finance_mode==='movement'&&!holder)return alert('Elegí quién recibe el dinero.');if(holder){posHolder=holder;localStorage.setItem('importb2b-pos-holder',holder)}if(!confirm('¿Confirmar este pedido y convertirlo en venta real? Se descontará stock y se registrará en Finanzas.'))return;const b=$('#confirmWebOrder');b.disabled=true;try{const r=await DB.webOrderAction(o.id,'confirm','',holder);alert(`Venta ${r.sale?.sale_code||''} confirmada`);closeModal();if(currentView==='orders')await renderOrders();else await renderCatalogAdmin()}catch(e){alert(e.message);b.disabled=false}});
    $('#cancelWebOrder')?.addEventListener('click',async()=>{const reason=prompt('Motivo de cancelación:','Cliente canceló')||'';if(!confirm('¿Cancelar y liberar el stock reservado?'))return;try{await DB.webOrderAction(o.id,'cancel',reason);closeModal();if(currentView==='orders')await renderOrders();else await renderCatalogAdmin()}catch(e){alert(e.message)}});
  }

  /* -------------------- PHASE 6.5.2 · STATS / USERS / SETTINGS -------------------- */
  async function renderStatistics(){
    const d=await DB.statistics(statsDays),maxDaily=Math.max(1,...d.daily.map(x=>x.total));
    content.innerHTML=`<div class="section-title"><div><span class="eyebrow">ESTADÍSTICAS</span><h3>Progreso IMPORTB2B</h3><p class="muted">Ventas, rentabilidad, clientes y operación en un solo tablero.</p></div><select id="statsRange"><option value="7" ${statsDays===7?'selected':''}>7 días</option><option value="30" ${statsDays===30?'selected':''}>30 días</option><option value="90" ${statsDays===90?'selected':''}>90 días</option></select></div>
      <section class="stats-kpis"><div><small>Facturación</small><b>${money(d.total)}</b><span>${number(d.count)} ventas</span></div><div><small>Ganancia bruta</small><b class="positive">${money(d.profit)}</b><span>${number(d.margin)}% margen</span></div><div><small>Ticket promedio</small><b>${money(d.ticket)}</b><span>${statsDays} días</span></div><div><small>Clientes nuevos</small><b>${number(d.newCustomers)}</b><span>${number(d.clubMembers)} miembros Club</span></div></section>
      <section class="card stats-main"><div class="section-title"><div><span class="eyebrow">VENTAS</span><h3>Evolución diaria</h3></div></div><div class="stats-bars">${d.daily.map(x=>`<div class="stats-bar-col"><div class="stats-bar-value">${x.total?money(x.total):''}</div><span style="height:${Math.max(4,Math.round(x.total/maxDaily*100))}%"></span><small>${new Date(x.date+'T12:00:00').toLocaleDateString('es-AR',{day:'2-digit',month:'2-digit'})}</small></div>`).join('')}</div></section>
      <section class="stats-grid"><div class="card"><div class="section-title"><div><span class="eyebrow">PRODUCTOS</span><h3>Más vendidos</h3></div></div><div class="stats-list">${d.topProducts.map((x,i)=>`<div><i>${i+1}</i><span><b>${esc(x.name)}</b><small>${number(x.units)} unidades</small></span><strong>${money(x.total)}</strong></div>`).join('')||'<div class="empty compact-empty">Sin ventas.</div>'}</div></div><div class="card"><div class="section-title"><div><span class="eyebrow">CLIENTES</span><h3>Top clientes</h3></div></div><div class="stats-list">${d.topCustomers.map((x,i)=>`<div><i>${i+1}</i><span><b>${esc(x.name)}</b><small>${number(x.count)} compras</small></span><strong>${money(x.total)}</strong></div>`).join('')||'<div class="empty compact-empty">Sin ventas vinculadas.</div>'}</div></div></section>
      <section class="stats-grid"><div class="card"><div class="section-title"><div><span class="eyebrow">COBROS</span><h3>Formas de pago</h3></div></div><div class="stats-list">${d.payments.map(x=>`<div><span><b>${esc(x.name)}</b><small>${number(x.count)} ventas</small></span><strong>${money(x.total)}</strong></div>`).join('')||'<div class="empty compact-empty">Sin datos.</div>'}</div></div><div class="card"><div class="section-title"><div><span class="eyebrow">COMPRAS</span><h3>Mercadería</h3></div></div><div class="stats-purchase"><div><small>Inversión del período</small><b>USDT ${number(d.purchaseInvestmentUsd)}</b></div><div><small>Unidades compradas</small><b>${number(d.purchaseUnits)}</b></div><div><small>Puntos Club activos</small><b>${number(d.clubPoints)}</b></div></div></div></section>`;
    $('#statsRange')?.addEventListener('change',e=>{statsDays=Number(e.target.value);renderStatistics()});
  }

  async function renderUsers(){
    const rows=await DB.users();
    content.innerHTML=`<div class="section-title"><div><span class="eyebrow">ADMINISTRACIÓN</span><h3>Usuarios</h3><p class="muted">Perfiles habilitados para operar IMPORTB2B Central.</p></div><span class="pill blue">${rows.length} usuario${rows.length===1?'':'s'}</span></div><div class="users-grid">${rows.map(u=>`<article class="user-card"><div class="user-avatar">${esc((u.full_name||'U').slice(0,1).toUpperCase())}</div><div><b>${esc(u.full_name||'Usuario')}</b><small>${esc(u.role||'sin rol')}</small><span>Alta ${new Date(u.created_at).toLocaleDateString('es-AR')}</span></div><span class="pill ${u.role==='admin'?'red':'blue'}">${esc((u.role||'usuario').toUpperCase())}</span></article>`).join('')||'<div class="card empty">No hay perfiles visibles para esta sesión.</div>'}</div><div class="notice" style="margin-top:14px">Los permisos finos por módulo se incorporarán sobre esta misma sección; por ahora se muestra el rol registrado en Supabase.</div>`;
  }

  async function renderSettings(){
    const pushSupported='serviceWorker' in navigator&&'PushManager' in window&&'Notification' in window;
    const pushPermission=pushSupported?Notification.permission:'unsupported';
    const pushTitle=pushPermission==='granted'?'Notificaciones activas':pushPermission==='denied'?'Notificaciones bloqueadas':'Activar notificaciones';
    content.innerHTML=`<div class="section-title"><div><span class="eyebrow">CONFIGURACIÓN</span><h3>Administración del sistema</h3><p class="muted">Herramientas de mantenimiento que no necesitás en la operación diaria.</p></div><span class="pill">v7.2.10</span></div><div class="settings-grid"><button id="settingsKyte" class="settings-card"><span>IMPORTACIONES</span><b>Importar Kyte</b><small>Migraciones, auditoría y consolidación de archivos históricos.</small><i>›</i></button><button id="settingsPush" class="settings-card" ${pushSupported?'':'disabled'}><span>NOTIFICACIONES</span><b>${esc(pushTitle)}</b><small>Control financiero cada 3 días cerca de las 14:00 · recordatorio de ventas de lunes a viernes cerca de las 17:30.</small><i>${pushPermission==='granted'?'✓':'›'}</i></button><article class="settings-card static"><span>SISTEMA</span><b>IMPORTB2B Central</b><small>Supabase · Inventario · POS · Finanzas · Club · Catálogo</small></article></div>`;
    $('#settingsKyte')?.addEventListener('click',()=>setView('imports'));
    $('#settingsPush')?.addEventListener('click',async()=>{
      const b=$('#settingsPush');b.disabled=true;
      try{
        const result=await ensurePushSubscription(true);
        if(!result.enabled){
          if(result.permission==='denied')alert('Las notificaciones están bloqueadas para esta app. Habilitalas desde los ajustes del dispositivo.');
          else alert('No se activaron las notificaciones.');
        }else{
          alert('Notificaciones activadas para IMPORTB2B Central.');
          await renderSettings();
        }
      }catch(e){
        alert(e.message||'No se pudieron activar las notificaciones. En iPhone abrí la app instalada desde la pantalla de inicio.');
        b.disabled=false;
      }
    });
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

  function openModal(inner){
    closeModal();
    lockPageScroll('modal');
    const el=document.createElement('div');
    el.id='modalLayer';el.className='modal-layer';el.innerHTML=`<div class="modal-card"><button class="modal-close modal-corner-x" type="button" aria-label="Cerrar">×</button>${inner}</div>`;
    document.body.appendChild(el);
    el.addEventListener('click',e=>{if(e.target===el||e.target.closest('.modal-close'))closeModal()});
  }
  function closeModal(){
    const modal=document.querySelector('#modalLayer');
    if(!modal)return;
    modal.remove();
    unlockPageScroll('modal');
  }

  // Global desktop shortcut: Escape closes only the top-most transient UI.
  document.addEventListener('keydown',e=>{
    if(e.key!=='Escape'||e.defaultPrevented)return;
    if(document.querySelector('#modalLayer')){
      e.preventDefault();closeModal();return;
    }
    if($('#posCartDrawer')?.classList.contains('open')){
      e.preventDefault();closeCartDrawer();return;
    }
    if(document.querySelector('.sidebar')?.classList.contains('open')){
      e.preventDefault();closeMobileMenu();return;
    }
  });

  start();
})();
