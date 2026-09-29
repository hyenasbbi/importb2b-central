(()=>{
  const $=s=>document.querySelector(s),money=n=>new Intl.NumberFormat('es-AR',{style:'currency',currency:'ARS',maximumFractionDigits:0}).format(Number(n||0)),esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
  let data=null,cart=[],q='',cat='',catalogMode='all',checkoutCity='';
  const cfg=window.IMPORTB2B_CONFIG||{};
  const publicDb=window.supabase?.createClient(cfg.SUPABASE_URL,cfg.SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
  const slug=new URLSearchParams(location.search).get('slug')||'importb2b';
  async function load(){
    let j=null, directError=null;
    if(publicDb){
      const r=await publicDb.rpc('importb2b_public_catalog_safe',{p_slug:slug});
      if(!r.error && r.data && !r.data.error) j=r.data;
      else directError=r.error?.message||r.data?.error||null;
    }
    if(!j){
      const r=await fetch(`/api/catalog?slug=${encodeURIComponent(slug)}`);
      const fallback=await r.json().catch(()=>({}));
      if(!r.ok) throw new Error(fallback.error||directError||'No se pudo cargar el catálogo');
      j=fallback;
    }
    data=j;
    $('#storeTitle').textContent=j.settings.title||'IMPORTB2B';
    $('#storeSubtitle').textContent=j.settings.subtitle||'Catálogo online';
    document.title=`${j.settings.title||'IMPORTB2B'} · Catálogo`;
    data.products=(j.products||[]).filter(p=>p.variants?.some(v=>v.in_stock&&Number(v.available||1)>0));
    const cats=[...new Set(data.products.map(p=>p.category).filter(Boolean))].sort();
    $('#catalogCategory').innerHTML='<option value="">Todas las categorías</option>'+cats.map(x=>`<option>${esc(x)}</option>`).join('');
    $('#catalogCategoryChips').innerHTML=`<button class="active" data-cat="">Todos</button>${cats.map(x=>`<button data-cat="${esc(x)}">${esc(x)}</button>`).join('')}`;
    $('#catalogCategoryChips').querySelectorAll('[data-cat]').forEach(b=>b.addEventListener('click',()=>{cat=b.dataset.cat||'';$('#catalogCategory').value=cat;catalogMode='all';$('#catalogCategoryChips').querySelectorAll('[data-cat]').forEach(x=>x.classList.toggle('active',x===b));renderProducts();document.querySelector('.catalog-all-section')?.scrollIntoView({behavior:'smooth',block:'start'})}));
    renderPromoCarousel();renderProducts();renderCart();bindCatalogActions();
  }
  function card(p,badge=''){const vars=p.variants.filter(v=>v.in_stock&&Number(v.available||1)>0),prices=vars.map(v=>Number(v.price_ars||0)).filter(Boolean),price=prices.length?Math.min(...prices):0,img=p.thumbnail_url||p.image_url;return `<article class="store-card" data-open-product="${p.id}"><div class="store-card-image">${badge?`<span class="catalog-badge">${badge}</span>`:''}${img?`<img loading="lazy" decoding="async" src="${esc(img)}" alt="${esc(p.name)}">`:`<div class="store-card-placeholder">IB</div>`}</div><div class="store-card-body"><div><h3>${esc(p.name)}</h3><small>${esc(p.category||'')}</small></div><div class="catalog-card-bottom"><strong>${price?`Desde ${money(price)}`:'Consultar'}</strong><small>${vars.length>1?`${vars.length} variantes`:'Disponible'}</small></div></div></article>`}
  function filteredProducts(){const term=q.trim().toLowerCase();return data.products.filter(p=>(!cat||p.category===cat)&&(!term||[p.name,p.category,...p.variants.flatMap(v=>[v.name,v.sku,Object.values(v.attributes||{}).join(' ')])].join(' ').toLowerCase().includes(term)))}
  function renderProducts(){if(!data)return;let products=filteredProducts();if(catalogMode==='new')products=[...products].slice(0,24);$('#catalogGrid').innerHTML=products.map(p=>card(p)).join('')||'<div class="store-loading">No encontramos productos con esos filtros.</div>';const newest=[...data.products].slice(0,6),featured=data.products.filter(p=>p.featured).slice(0,6);$('#catalogNewGrid').innerHTML=newest.map(p=>card(p,'NUEVO')).join('');$('#catalogFeaturedGrid').innerHTML=(featured.length?featured:data.products.slice(0,6)).map(p=>card(p)).join('');const discounts=data.products.filter(p=>p.discount_price_ars||p.on_sale).slice(0,6);$('#catalogDiscountSection').classList.toggle('hidden',!discounts.length);$('#catalogDiscountGrid').innerHTML=discounts.map(p=>card(p,'OFERTA')).join('');document.querySelectorAll('[data-open-product]').forEach(x=>x.addEventListener('click',()=>openProduct(x.dataset.openProduct)))}
  function openProduct(pid){const p=data.products.find(x=>x.id===pid);if(!p)return;const vars=p.variants.filter(v=>v.in_stock&&Number(v.available||1)>0),img=p.image_url||p.thumbnail_url;const modal=document.createElement('div');modal.className='store-modal catalog-product-modal';modal.innerHTML=`<div class="store-modal-card product-sheet"><button class="product-sheet-close" type="button">×</button><div class="product-sheet-media">${img?`<img src="${esc(img)}" alt="${esc(p.name)}">`:'<div class="store-card-placeholder">IB</div>'}</div><div class="product-sheet-copy"><small>${esc(p.category||'')}</small><h2>${esc(p.name)}</h2>${p.description?`<p>${esc(p.description)}</p>`:''}<div class="product-sheet-variants">${vars.map(v=>`<button data-sheet-v="${v.id}"><span>${esc(v.name)}</span><b>${money(v.price_ars)}</b><small>Disponible</small></button>`).join('')}</div></div></div>`;document.body.appendChild(modal);modal.querySelector('.product-sheet-close').onclick=()=>modal.remove();modal.addEventListener('click',e=>{if(e.target===modal)modal.remove()});modal.querySelectorAll('[data-sheet-v]').forEach(b=>b.addEventListener('click',()=>{add(pid,b.dataset.sheetV);modal.remove();openCart(true)}))}
  function renderPromoCarousel(){const el=$('#catalogPromoCarousel');if(!el)return;const slides=[['NUEVOS INGRESOS','Descubrí lo último que llegó a IMPORTB2B','new'],['DESTACADOS','Una selección para encontrar rápido nuestros productos elegidos','featured'],['PRECIOS MAYORISTAS','Comprá para revender y consultá condiciones especiales','wholesale']];el.innerHTML=`<div class="catalog-promo-track">${slides.map((x,i)=>`<button class="catalog-promo-slide ${i?'':'active'}" data-promo="${x[2]}"><span>${x[0]}</span><b>${x[1]}</b><i>Ver más →</i></button>`).join('')}</div><div class="catalog-promo-dots">${slides.map((_,i)=>`<button data-promo-dot="${i}" class="${i?'':'active'}"></button>`).join('')}</div>`;let ix=0,timer;const go=n=>{const slides=[...el.querySelectorAll('.catalog-promo-slide')],dots=[...el.querySelectorAll('[data-promo-dot]')];ix=(n+slides.length)%slides.length;slides.forEach((x,i)=>x.classList.toggle('active',i===ix));dots.forEach((x,i)=>x.classList.toggle('active',i===ix))};timer=setInterval(()=>go(ix+1),4800);el.querySelectorAll('[data-promo-dot]').forEach((b,i)=>b.onclick=()=>go(i));el.querySelectorAll('[data-promo]').forEach(b=>b.onclick=()=>{if(b.dataset.promo==='wholesale')return openWholesaleWhatsapp();catalogMode=b.dataset.promo;document.querySelector(b.dataset.promo==='new'?'#catalogNewGrid':'#catalogFeaturedGrid')?.scrollIntoView({behavior:'smooth',block:'center'})});el.addEventListener('pointerdown',()=>clearInterval(timer),{once:true})}
  function bindCatalogActions(){document.querySelectorAll('[data-catalog-show]').forEach(b=>b.addEventListener('click',()=>{catalogMode=b.dataset.catalogShow;document.querySelector('.catalog-all-section')?.scrollIntoView({behavior:'smooth'});renderProducts()}));$('#wholesaleWhatsapp')?.addEventListener('click',openWholesaleWhatsapp);document.querySelectorAll('[data-city]').forEach(b=>b.addEventListener('click',()=>{checkoutCity=b.dataset.city;document.querySelectorAll('[data-city]').forEach(x=>x.classList.toggle('active',x===b))}))}
  function openWholesaleWhatsapp(){const wa=String(data?.settings?.whatsapp_number||'').replace(/\D/g,'');const msg='Hola! Quiero conocer precios mayoristas de ';if(!wa)return alert('WhatsApp mayorista todavía no está configurado.');window.open(`https://wa.me/${wa}?text=${encodeURIComponent(msg)}`,'_blank')}

  function add(pid,vid){const p=data.products.find(x=>x.id===pid),v=p?.variants.find(x=>x.id===vid);if(!v||!v.in_stock)return;const x=cart.find(i=>i.variant_id===vid);const max=data.settings.show_exact_stock?Number(v.available||0):20;if(x){if(x.quantity>=max)return alert('No hay más unidades disponibles');x.quantity++}else cart.push({product_id:pid,variant_id:vid,product_name:p.name,variant_name:v.name,price:Number(v.price_ars||0),quantity:1,max});renderCart()}
  function totals(paymentCode=null,delivery='pickup'){const subtotal=cart.reduce((a,x)=>a+x.price*x.quantity,0),shipping=delivery==='shipping'?Number(data?.settings.shipping_fee_ars||0):0,method=(data?.payment_methods||[]).find(m=>m.code===paymentCode);let adj=0,base=subtotal+shipping;if(method?.adjustment_kind==='percent')adj=base*Number(method.adjustment_value||0)/100;else if(method?.adjustment_kind==='fixed')adj=Number(method.adjustment_value||0);if(method?.adjustment_direction==='discount')adj=-Math.abs(adj);else adj=Math.abs(adj);return{subtotal,shipping,adj,total:base+adj}}
  function renderCart(){const t=totals();$('#catalogCartCount').textContent=cart.reduce((a,x)=>a+x.quantity,0);$('#catalogCartTotal').textContent=money(t.subtotal);$('#catalogCartItems').innerHTML=cart.map((x,i)=>`<div class="cart-line"><div><b>${esc(x.product_name)}</b><small>${esc(x.variant_name)} · ${money(x.price)}</small></div><div class="cart-line-actions"><button data-i="${i}" data-d="-1">−</button><b>${x.quantity}</b><button data-i="${i}" data-d="1">+</button><button class="remove" data-i="${i}" data-remove>×</button></div></div>`).join('')||'<div class="store-loading">Tu carrito está vacío.</div>';$('#catalogSummary').innerHTML=`<div><span>Subtotal</span><b>${money(t.subtotal)}</b></div><div class="grand"><span>Total estimado</span><b>${money(t.subtotal)}</b></div>`;$('#checkoutButton').disabled=!cart.length;document.querySelectorAll('[data-d]').forEach(b=>b.addEventListener('click',()=>{const x=cart[Number(b.dataset.i)],d=Number(b.dataset.d);x.quantity=Math.max(1,Math.min(x.max,x.quantity+d));renderCart()}));document.querySelectorAll('[data-remove]').forEach(b=>b.addEventListener('click',()=>{cart.splice(Number(b.dataset.i),1);renderCart()}))}
  function openCart(open=true){$('#catalogCartDrawer').classList.toggle('open',open);$('#catalogBackdrop').classList.toggle('open',open);$('#catalogCartDrawer').setAttribute('aria-hidden',String(!open))}
  function openCheckout(){if(!cart.length)return;openCart(false);const d=$('#checkoutDelivery');d.innerHTML='';if(data.settings.allow_pickup)d.innerHTML+=`<option value="pickup">${esc(data.settings.pickup_label||'Retiro')}</option>`;if(data.settings.allow_shipping)d.innerHTML+=`<option value="shipping">${esc(data.settings.shipping_label||'Envío')}</option>`;$('#checkoutPayment').innerHTML=data.payment_methods.map(m=>`<option value="${m.code}">${esc(m.name)}${Number(m.adjustment_value)?` · ${m.adjustment_direction==='discount'?'-':'+'}${m.adjustment_value}${m.adjustment_kind==='percent'?'%':''}`:''}</option>`).join('');$('#checkoutModal').classList.remove('hidden');updateCheckout()}
  function updateCheckout(){const delivery=$('#checkoutDelivery').value,pay=$('#checkoutPayment').value,t=totals(pay,delivery);$('#addressLabel').classList.toggle('hidden',delivery!=='shipping');if(delivery!=='shipping'){checkoutCity='';document.querySelectorAll('[data-city]').forEach(x=>x.classList.remove('active'))};$('#checkoutTotals').innerHTML=`<div><span>Productos</span><b>${money(t.subtotal)}</b></div><div><span>Envío</span><b>${money(t.shipping)}</b></div>${t.adj?`<div><span>Ajuste de pago</span><b>${money(t.adj)}</b></div>`:''}<div class="grand"><span>Total</span><b>${money(t.total)}</b></div>`}
  async function placeOrder(){
    const btn=$('#placeOrderButton');btn.disabled=true;$('#checkoutError').textContent='';
    try{
      const args={
        p_slug:slug,
        p_customer_name:$('#checkoutName').value,
        p_customer_phone:$('#checkoutPhone').value,
        p_customer_email:$('#checkoutEmail').value,
        p_delivery_type:$('#checkoutDelivery').value,
        p_delivery_address:[$('#checkoutAddress').value,checkoutCity].filter(Boolean).join(' · '),
        p_payment_code:$('#checkoutPayment').value,
        p_items:cart.map(x=>({variant_id:x.variant_id,quantity:x.quantity})),
        p_notes:$('#checkoutNotes').value||null
      };
      let j=null;
      if(publicDb){
        const r=await publicDb.rpc('importb2b_create_web_order_safe',args);
        if(r.error) throw r.error;
        j=r.data;
      }else{
        const r=await fetch('/api/web-order',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({slug,customer_name:args.p_customer_name,customer_phone:args.p_customer_phone,customer_email:args.p_customer_email,delivery_type:args.p_delivery_type,delivery_address:args.p_delivery_address,payment_code:args.p_payment_code,notes:args.p_notes,items:args.p_items})});
        j=await r.json();if(!r.ok)throw new Error(j.error||'No se pudo crear el pedido');
      }
      const msg=`Hola! Acabo de generar el pedido ${j.order_code} por ${money(j.total_ars)}.`;
      const wa=String(j.whatsapp_number||'').replace(/\D/g,'');
      cart=[];renderCart();
      $('#checkoutModal').querySelector('.store-modal-card').innerHTML=`<div class="order-success"><span>✓</span><b>${esc(j.order_code)}</b><h2>Pedido recibido</h2><p>Reservamos tu stock. IMPORTB2B debe confirmar la operación para convertirla en venta.</p>${wa?`<a class="store-primary" style="display:block;text-decoration:none" target="_blank" href="https://wa.me/${wa}?text=${encodeURIComponent(msg)}">Continuar por WhatsApp</a>`:''}<button class="store-primary" onclick="location.reload()">Volver al catálogo</button></div>`;
    }catch(e){$('#checkoutError').textContent=e.message;btn.disabled=false}
  }
  $('#catalogSearch').addEventListener('input',e=>{q=e.target.value;renderProducts()});$('#catalogCategory').addEventListener('change',e=>{cat=e.target.value;renderProducts()});$('#catalogCartButton').addEventListener('click',()=>openCart(true));$('#catalogCartClose').addEventListener('click',()=>openCart(false));$('#catalogBackdrop').addEventListener('click',()=>openCart(false));$('#checkoutButton').addEventListener('click',openCheckout);$('#checkoutClose').addEventListener('click',()=>$('#checkoutModal').classList.add('hidden'));$('#checkoutDelivery').addEventListener('change',updateCheckout);$('#checkoutPayment').addEventListener('change',updateCheckout);$('#placeOrderButton').addEventListener('click',placeOrder);load().catch(e=>$('#catalogGrid').innerHTML=`<div class="store-loading">${esc(e.message)}</div>`);
})();
