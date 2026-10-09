(()=>{
  const $=s=>document.querySelector(s),money=n=>new Intl.NumberFormat('es-AR',{style:'currency',currency:'ARS',maximumFractionDigits:0}).format(Number(n||0)),esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
  let data=null,cart=[],q='',cat='',sleeve='short',catalogMode='home',checkoutCity='',catalogBrowseOpen=false;
  const cfg=window.IMPORTB2B_CONFIG||{};
  const publicDb=window.supabase?.createClient(cfg.SUPABASE_URL,cfg.SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
  const slug=new URLSearchParams(location.search).get('slug')||'importb2b';

  // Mobile scroll guard: prevents Safari/Chrome pull-to-refresh without blocking normal page navigation.
  function installPullRefreshGuard(){
    let startY=0,startX=0,tracking=false;
    const isOwnScroller=target=>{
      const el=target?.closest?.('.store-drawer,.catalog-category-drawer,.store-modal-card,.product-gallery-thumbs');
      return !!(el&&el.scrollHeight>el.clientHeight+1);
    };
    document.addEventListener('touchstart',e=>{
      if(e.touches.length!==1){tracking=false;return}
      const t=e.touches[0];startY=t.clientY;startX=t.clientX;tracking=true;
    },{passive:true});
    document.addEventListener('touchmove',e=>{
      if(!tracking||e.touches.length!==1||e.defaultPrevented)return;
      const t=e.touches[0],dy=t.clientY-startY,dx=t.clientX-startX;
      if(Math.abs(dx)>Math.abs(dy))return;
      if(dy<=0)return;
      if(isOwnScroller(e.target))return;
      const y=window.scrollY||document.documentElement.scrollTop||0;
      if(y<=0)e.preventDefault();
    },{passive:false});
    document.addEventListener('touchend',()=>{tracking=false},{passive:true});
    document.addEventListener('touchcancel',()=>{tracking=false},{passive:true});
  }
  installPullRefreshGuard();
  function openCategoryDrawer(open=true){
    const drawer=$('#catalogCategoryDrawer'),backdrop=$('#catalogBackdrop'),trigger=$('#catalogCategoryMenuButton');
    if(!drawer)return;
    if(open){$('#catalogCartDrawer')?.classList.remove('open');$('#catalogCartDrawer')?.setAttribute('aria-hidden','true')}
    drawer.classList.toggle('open',open);drawer.setAttribute('aria-hidden',String(!open));
    trigger?.setAttribute('aria-expanded',String(open));
    backdrop?.classList.toggle('open',open);
  }
  function goHome(scroll=true){
    cat='';q='';sleeve='short';catalogMode='home';catalogBrowseOpen=false;
    if($('#catalogCategory'))$('#catalogCategory').value='';if($('#catalogSearch'))$('#catalogSearch').value='';
    document.querySelectorAll('[data-cat]').forEach(x=>x.classList.remove('active'));document.querySelectorAll('[data-home]').forEach(x=>x.classList.add('active'));
    openCategoryDrawer(false);renderProducts();if(scroll)window.scrollTo({top:0,behavior:'smooth'});
  }
  function chooseCategory(value=''){
    if(!value)return goHome();
    cat=value;q='';sleeve=String(value||'').trim().toLowerCase()==='camisetas'?'short':'';catalogMode='category';catalogBrowseOpen=true;
    if($('#catalogCategory'))$('#catalogCategory').value=cat;if($('#catalogSearch'))$('#catalogSearch').value='';
    document.querySelectorAll('[data-home]').forEach(x=>x.classList.remove('active'));document.querySelectorAll('[data-cat]').forEach(x=>x.classList.toggle('active',(x.dataset.cat||'')===cat));
    openCategoryDrawer(false);renderProducts();document.querySelector('.catalog-all-section')?.scrollIntoView({behavior:'smooth',block:'start'});
  }
  function initHeaderNavigation(){
    const home=$('#catalogCategoryHome'),header=$('.store-header');
    const sync=()=>{if(!home||!header)return;const cutoff=home.offsetTop+home.offsetHeight-header.offsetHeight;document.body.classList.toggle('catalog-categories-sticky',window.scrollY>cutoff)};
    window.addEventListener('scroll',sync,{passive:true});window.addEventListener('resize',sync,{passive:true});sync();
  }
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
    const categoryMarkup=`<button data-home="true" class="active">Inicio</button>${cats.map(x=>`<button data-cat="${esc(x)}">${esc(x)}</button>`).join('')}`;
    $('#catalogCategoryChips').innerHTML=categoryMarkup;
    $('#catalogCategoryDrawerList').innerHTML=categoryMarkup;
    document.querySelectorAll('[data-home]').forEach(b=>b.addEventListener('click',()=>goHome()));
    document.querySelectorAll('[data-cat]').forEach(b=>b.addEventListener('click',()=>chooseCategory(b.dataset.cat||'')));
    renderPromoCarousel();renderProducts();renderCart();bindCatalogActions();initHeaderNavigation();initFloatingSupport();
  }
  const contactWa='5493425575323',contactIg='https://www.instagram.com/import.b2b/';
  const waUrl=message=>`https://wa.me/${contactWa}?text=${encodeURIComponent(message)}`;
  const productMedia=p=>{
    const out=[],push=x=>{if(x&&!out.includes(x))out.push(x)};
    push(p.image_url);
    (Array.isArray(p.images)?p.images:[]).forEach(x=>push(typeof x==='string'?x:x?.image_url));
    if(!out.length)push(p.thumbnail_url);
    return out;
  };
  const saleActive=v=>Number(v?.sale_price_ars||0)>0&&Number(v?.price_ars||0)>0&&Number(v.sale_price_ars)<Number(v.price_ars);
  const effectivePrice=v=>saleActive(v)?Number(v.sale_price_ars):Number(v?.price_ars||0);
  const priceMarkup=(v,{from=false}={})=>{
    if(!v)return 'Consultar';
    const prefix=from?'Desde ':'';
    if(saleActive(v))return `<span class="catalog-price-stack"><small class="catalog-old-price">${money(v.price_ars)}</small><strong class="catalog-sale-price">${prefix}${money(v.sale_price_ars)}</strong></span>`;
    const p=Number(v.price_ars||0);
    return p?`${prefix}${money(p)}`:'Consultar';
  };
  const whatsappIcon='<svg class="wa-brand-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.095 3.2 5.076 4.487.709.306 1.262.489 1.694.626.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.981.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.892-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.993c-.003 5.45-4.437 9.886-9.889 9.886m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.056 24l6.3-1.654a11.882 11.882 0 0 0 5.69 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z"/></svg>';
  const instagramIcon='<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="3.5" width="17" height="17" rx="5"></rect><circle cx="12" cy="12" r="4"></circle><circle cx="17.4" cy="6.7" r="1"></circle></svg>';
  function card(p,badge=''){
    const vars=p.variants.filter(v=>v.in_stock&&Number(v.available||1)>0),ranked=[...vars].sort((a,b)=>effectivePrice(a)-effectivePrice(b)),best=ranked[0]||null,media=productMedia(p),img=media[0]||'';
    const direct=vars.length===1,hasSale=vars.some(saleActive),shownBadge=hasSale?'OFERTA':badge;
    return `<article class="store-card ${hasSale?'has-sale':''}" data-open-product="${p.id}">
      <div class="store-card-image" data-card-gallery="${p.id}" data-card-media="${esc(JSON.stringify(media))}">
        ${shownBadge?`<span class="catalog-badge ${hasSale?'sale':''}">${shownBadge}</span>`:''}
        ${img?`<div class="store-card-image-bg" style="background-image:url('${esc(img)}')"></div><img class="store-card-main-image" loading="lazy" decoding="async" src="${esc(img)}" alt="${esc(p.name)}">`:`<div class="store-card-placeholder">IB</div>`}
        ${media.length>1?`<div class="card-gallery-dots" aria-label="${media.length} fotos">${media.map((_,i)=>`<button type="button" class="${i?'':'active'}" data-card-dot="${i}" aria-label="Foto ${i+1}"></button>`).join('')}</div>`:''}
        ${direct?`<button class="catalog-direct-add" data-direct-p="${p.id}" data-direct-v="${vars[0].id}" aria-label="Agregar ${esc(p.name)}">＋</button>`:`<span class="catalog-options-pill">${vars.length} opciones ›</span>`}
      </div>
      <div class="store-card-body">
        <div class="store-card-copy"><h3>${esc(p.name)}</h3><small>${esc(p.category||'')}${String(p.category||'').trim().toLowerCase()==='camisetas'?` · ${p.sleeve_type==='long'?'MANGA LARGA':'MANGA CORTA'}`:''}</small></div>
        <div class="catalog-card-bottom"><div class="catalog-card-price">${best?priceMarkup(best,{from:!direct}):'Consultar'}</div><small class="${direct?'catalog-single-variant':''}">${direct?`Opción: ${esc(vars[0].name||'Única')}`:`${vars.length} variantes`}</small></div>
      </div>
    </article>`
  }
  function filteredProducts(){const term=q.trim().toLowerCase(),camisetas=String(cat||'').trim().toLowerCase()==='camisetas';return data.products.filter(p=>(!cat||p.category===cat)&&(!camisetas||!sleeve||(p.sleeve_type||'short')===sleeve)&&(!term||[p.name,p.category,p.sleeve_type,...p.variants.flatMap(v=>[v.name,v.sku,Object.values(v.attributes||{}).join(' ')])].join(' ').toLowerCase().includes(term)))}
  function bindProductCards(scope=document){
    scope.querySelectorAll('[data-open-product]').forEach(x=>x.addEventListener('click',e=>{if(e.target.closest('[data-direct-v],[data-card-dot]'))return;openProduct(x.dataset.openProduct)}));
    scope.querySelectorAll('[data-direct-v]').forEach(b=>b.addEventListener('click',e=>{e.stopPropagation();add(b.dataset.directP,b.dataset.directV);b.textContent='✓';setTimeout(()=>b.textContent='＋',700)}));
    scope.querySelectorAll('[data-card-gallery]').forEach(g=>{
      let media=[];try{media=JSON.parse(g.dataset.cardMedia||'[]')}catch{}if(media.length<2)return;
      const img=g.querySelector('.store-card-main-image'),bg=g.querySelector('.store-card-image-bg'),dots=[...g.querySelectorAll('[data-card-dot]')];if(!img)return;
      let ix=0,timer=null;
      const show=n=>{ix=(n+media.length)%media.length;img.classList.add('changing');setTimeout(()=>{img.src=media[ix];if(bg)bg.style.backgroundImage=`url("${media[ix].replace(/"/g,'%22')}")`;dots.forEach((d,i)=>d.classList.toggle('active',i===ix));requestAnimationFrame(()=>img.classList.remove('changing'))},150)};
      const stop=()=>{if(timer){clearInterval(timer);timer=null}};
      const start=()=>{stop();if(!document.hidden)timer=setInterval(()=>show(ix+1),3000)};
      dots.forEach((d,i)=>d.addEventListener('click',e=>{e.stopPropagation();stop();show(i);start()}));
      const io=new IntersectionObserver(entries=>entries.forEach(e=>e.isIntersecting?start():stop()),{threshold:.35});io.observe(g);
    });
  }
  function renderProducts(){
    if(!data)return;
    const homeMode=!catalogBrowseOpen;
    const rank=(a,b)=>Number(a.catalog_priority??100)-Number(b.catalog_priority??100)||new Date(b.created_at||0)-new Date(a.created_at||0)||String(a.name||'').localeCompare(String(b.name||''),'es');
    const newItems=data.products.filter(p=>p.new_arrival).sort(rank);
    const featuredItems=data.products.filter(p=>p.featured).sort(rank);

    $('#catalogPromoCarousel')?.classList.toggle('hidden',!homeMode);
    $('#catalogWholesaleCta')?.classList.toggle('hidden',!homeMode);
    $('#catalogNewSection')?.classList.toggle('hidden',!homeMode||!newItems.length);
    $('#catalogFeaturedSection')?.classList.toggle('hidden',!homeMode||!featuredItems.length);

    if(homeMode){
      $('#catalogNewGrid').innerHTML=newItems.slice(0,6).map(p=>card(p,'NUEVO')).join('');
      $('#catalogFeaturedGrid').innerHTML=featuredItems.slice(0,6).map(p=>card(p)).join('');
    }else{
      $('#catalogNewGrid').innerHTML='';
      $('#catalogFeaturedGrid').innerHTML='';
    }

    const discounts=data.products.filter(p=>p.variants?.some(saleActive)).slice(0,6);
    $('#catalogDiscountSection').classList.add('hidden');
    $('#catalogDiscountGrid').innerHTML=(catalogBrowseOpen&&catalogMode==='discount')?discounts.map(p=>card(p,'OFERTA')).join(''):'';

    const browse=$('.catalog-all-section'),grid=$('#catalogGrid'),title=$('#catalogBrowseTitle'),subbar=$('#catalogSubcategoryBar');
    const camisetaMode=catalogBrowseOpen&&String(cat||'').trim().toLowerCase()==='camisetas';
    if(subbar){
      subbar.classList.toggle('hidden',!camisetaMode);
      if(camisetaMode){
        subbar.innerHTML=`<button type="button" class="${sleeve==='short'?'active':''}" data-sleeve="short">MANGA CORTA</button><button type="button" class="${sleeve==='long'?'active':''}" data-sleeve="long">MANGA LARGA</button>`;
        subbar.querySelectorAll('[data-sleeve]').forEach(b=>b.addEventListener('click',()=>{sleeve=b.dataset.sleeve||'short';renderProducts()}));
      }else subbar.innerHTML='';
    }
    if(catalogBrowseOpen){
      browse?.classList.remove('hidden');
      let products=filteredProducts();
      if(catalogMode==='new')products=products.filter(p=>p.new_arrival).sort(rank);
      else if(catalogMode==='featured')products=products.filter(p=>p.featured).sort(rank);
      else if(catalogMode==='discount')products=products.filter(p=>p.variants?.some(saleActive));
      if(title)title.textContent=cat?cat:(catalogMode==='new'?'Nuevos ingresos':catalogMode==='featured'?'Destacados':catalogMode==='discount'?'Descuentos':q.trim()?('Resultados para “'+q.trim()+'”'):'Productos');
      grid.innerHTML=products.map(p=>card(p,catalogMode==='new'?'NUEVO':catalogMode==='discount'?'OFERTA':'')).join('')||'<div class="store-loading">No hay productos seleccionados para esta sección.</div>';
      bindProductCards(grid);
    }else{
      browse?.classList.add('hidden');
      if(grid)grid.innerHTML='';
    }

    if(homeMode){
      bindProductCards($('#catalogNewGrid'));
      bindProductCards($('#catalogFeaturedGrid'));
    }
    bindProductCards($('#catalogDiscountGrid'));
  }
  let catalogReturnScroll=0,productGalleryTimer=null;
  function closeProductPage(useHistory=false){
    const view=$('#catalogProductView'),main=$('#catalogMain');if(!view||!main)return;
    if(productGalleryTimer){clearInterval(productGalleryTimer);productGalleryTimer=null}view.classList.add('hidden');view.innerHTML='';main.classList.remove('hidden');document.body.classList.remove('catalog-product-open');
    requestAnimationFrame(()=>window.scrollTo({top:catalogReturnScroll,behavior:'instant'}));
    if(useHistory&&history.state?.catalogProduct)history.back();
  }
  function openProduct(pid,push=true){
    const p=data.products.find(x=>x.id===pid);if(!p)return;
    const vars=p.variants.filter(v=>v.in_stock&&Number(v.available||1)>0);
    const ordered=(Array.isArray(p.images)?p.images:[]).map(x=>typeof x==='string'?x:x?.image_url).filter(Boolean);
    const images=[];if(p.image_url)images.push(p.image_url);for(const src of ordered){if(!images.includes(src))images.push(src)}
    const media=images.length?images:[''];
    const view=$('#catalogProductView'),main=$('#catalogMain');if(!view||!main)return;
    catalogReturnScroll=window.scrollY;main.classList.add('hidden');view.classList.remove('hidden');document.body.classList.add('catalog-product-open');
    let selectedVariant=vars.length===1?String(vars[0].id):'';
    view.innerHTML=`<div class="catalog-inline-product">
      <div class="catalog-product-content">
        <div class="catalog-product-gallery">
          <div class="catalog-product-hero" style="--hero-bg:url('${esc(media[0]||'')}')">
            ${media[0]?`<div class="catalog-product-hero-bg"></div><img id="productMainImage" src="${esc(media[0])}" alt="${esc(p.name)}">`:'<div class="store-card-placeholder">IB</div>'}
            ${media.length>1?`<div class="product-hero-dots">${media.map((_,i)=>`<button type="button" class="${i?'':'active'}" data-hero-dot="${i}" aria-label="Foto ${i+1}"></button>`).join('')}</div>`:''}
          </div>
          ${media.length>1?`<div class="product-gallery-thumbs">${media.map((src,i)=>`<button class="${i?'':'active'}" data-gallery-index="${i}"><img src="${esc(src)}" alt=""></button>`).join('')}</div>`:''}
        </div>
        <div class="catalog-product-info">
          <small class="product-category-label">${esc(p.category||'')}${String(p.category||'').trim().toLowerCase()==='camisetas'?` · ${p.sleeve_type==='long'?'MANGA LARGA':'MANGA CORTA'}`:''}</small>
          <h1>${esc(p.name)}</h1>
          <div class="catalog-product-price" id="productPagePrice">${selectedVariant?priceMarkup(vars.find(v=>String(v.id)===selectedVariant)):(vars.length?priceMarkup([...vars].sort((a,b)=>effectivePrice(a)-effectivePrice(b))[0],{from:true}):'Consultar')}</div>
          ${vars.length?`<button id="jumpToVariants" class="product-option-title product-option-jump" type="button"><b>Elegí una opción</b><span>↓</span></button><div id="productVariantGrid" class="product-sheet-variants">${vars.map(v=>`<button class="${selectedVariant===String(v.id)?'active':''}" data-sheet-v="${v.id}"><span>${esc(v.name)}</span><b class="${saleActive(v)?'variant-sale-price':''}">${saleActive(v)?`<del>${money(v.price_ars)}</del><strong>${money(v.sale_price_ars)}</strong>`:money(v.price_ars)}</b><small>${data.settings.show_exact_stock?`${Number(v.available||0)} disponibles`:'Disponible'}</small></button>`).join('')}</div>`:''}
          <button id="productAddButton" class="store-primary product-inline-add ${selectedVariant?'':'needs-option'}">${selectedVariant?'Agregar al pedido':'Elegí una opción'}</button>
          <a class="product-whatsapp-cta" href="${waUrl(`Me interesa comprar ${p.name}`)}" target="_blank" rel="noopener">${whatsappIcon}<span>Comprar por WhatsApp</span></a>
          <div class="catalog-product-description"><span>DESCRIPCIÓN</span><p>${esc(p.description||'Producto disponible en IMPORTB2B. Consultanos por WhatsApp si necesitás más información.')}</p></div>
        </div>
      </div>
      <footer class="catalog-footer catalog-product-footer">
        <div class="catalog-footer-brand"><img src="./assets/img/logo-importb2b.png" alt="IMPORTB2B"><div><b>IMPORTB2B</b><small>Importados · Santa Fe</small></div></div>
        <div class="catalog-footer-social">
          <a class="catalog-social-link whatsapp" href="${waUrl('Hola me gustaria realizar un pedido en su pagina me ayudan con la eleccion?')}" target="_blank" rel="noopener" aria-label="Escribir a IMPORTB2B por WhatsApp">${whatsappIcon}<span>WhatsApp</span></a>
          <a class="catalog-social-link instagram" href="${contactIg}" target="_blank" rel="noopener" aria-label="Ver Instagram de IMPORTB2B">${instagramIcon}<span>Instagram</span></a>
        </div>
      </footer>
    </div>`;
    if(vars.length===1){const jump=view.querySelector('#jumpToVariants'),label=jump?.querySelector('b'),mark=jump?.querySelector('span'),grid=view.querySelector('#productVariantGrid');if(label)label.textContent='Opción seleccionada';if(mark)mark.textContent='✓';jump?.classList.add('single-selected');grid?.classList.add('single-variant');}
    window.scrollTo({top:0,behavior:'instant'});
    if(push)history.pushState({catalogProduct:pid},'',`${location.pathname}${location.search}#producto-${encodeURIComponent(pid)}`);
    if(productGalleryTimer){clearInterval(productGalleryTimer);productGalleryTimer=null}
    let galleryIx=0;
    const showProductMedia=n=>{if(media.length<2)return;galleryIx=(n+media.length)%media.length;const img=view.querySelector('#productMainImage'),hero=view.querySelector('.catalog-product-hero');if(!img)return;img.classList.add('changing');setTimeout(()=>{img.src=media[galleryIx];if(hero)hero.style.setProperty('--hero-bg',`url("${media[galleryIx].replace(/"/g,'%22')}")`);view.querySelectorAll('[data-gallery-index]').forEach((x,i)=>x.classList.toggle('active',i===galleryIx));view.querySelectorAll('[data-hero-dot]').forEach((x,i)=>x.classList.toggle('active',i===galleryIx));requestAnimationFrame(()=>img.classList.remove('changing'))},150)};
    const startProductGallery=()=>{if(productGalleryTimer)clearInterval(productGalleryTimer);if(media.length>1)productGalleryTimer=setInterval(()=>showProductMedia(galleryIx+1),3000)};
    view.querySelectorAll('[data-gallery-index],[data-hero-dot]').forEach(b=>b.addEventListener('click',()=>{const ix=Number(b.dataset.galleryIndex??b.dataset.heroDot);showProductMedia(ix);startProductGallery()}));
    startProductGallery();
    view.querySelector('#jumpToVariants')?.addEventListener('click',()=>view.querySelector('#productVariantGrid')?.scrollIntoView({behavior:'smooth',block:'center'}));
    let lastVariantTap={id:'',at:0};
    view.querySelectorAll('[data-sheet-v]').forEach(b=>b.addEventListener('click',()=>{const id=String(b.dataset.sheetV),now=Date.now();if(vars.length>1&&lastVariantTap.id===id&&now-lastVariantTap.at<450){selectedVariant='';lastVariantTap={id:'',at:0};view.querySelectorAll('[data-sheet-v]').forEach(x=>x.classList.remove('active'));const ranked=[...vars].sort((a,b)=>effectivePrice(a)-effectivePrice(b));view.querySelector('#productPagePrice').innerHTML=ranked.length?priceMarkup(ranked[0],{from:true}):'Consultar';const addBtn=view.querySelector('#productAddButton');addBtn.classList.add('needs-option');addBtn.textContent='Elegí una opción';return}lastVariantTap={id,at:now};selectedVariant=id;view.querySelectorAll('[data-sheet-v]').forEach(x=>x.classList.toggle('active',x===b));const v=vars.find(x=>String(x.id)===selectedVariant);view.querySelector('#productPagePrice').innerHTML=v?priceMarkup(v):'';const addBtn=view.querySelector('#productAddButton');addBtn.classList.toggle('needs-option',!selectedVariant);addBtn.textContent=selectedVariant?'Agregar al pedido':'Elegí una opción'}));
    view.querySelector('#productAddButton').addEventListener('click',()=>{if(!selectedVariant){view.querySelector('#productVariantGrid')?.scrollIntoView({behavior:'smooth',block:'center'});return}add(pid,selectedVariant);const btn=view.querySelector('#productAddButton');btn.textContent='✓ Agregado al pedido';btn.classList.add('added');setTimeout(()=>{btn.textContent='Agregar al pedido';btn.classList.remove('added')},900)});
  }
  window.addEventListener('popstate',()=>{if($('#catalogProductView')&&!$('#catalogProductView').classList.contains('hidden'))closeProductPage(false)});

  function renderPromoCarousel(){
    const el=$('#catalogPromoCarousel');if(!el)return;
    const slidesData=[
      ['NUEVOS INGRESOS','Lo último en IMPORTB2B.','new'],
      ['DESTACADOS','Elegidos para vos.','featured'],
      ['MAYORISTA','Precios especiales para revendedores.','wholesale']
    ];
    el.innerHTML=`<div class="catalog-promo-track">${slidesData.map((x,i)=>`<button class="catalog-promo-slide ${i?'':'active'}" data-promo="${x[2]}" aria-hidden="${i?'true':'false'}"><span>${x[0]}</span><b>${x[1]}</b><i>Ver más →</i></button>`).join('')}</div><div class="catalog-promo-dots" role="tablist" aria-label="Promociones">${slidesData.map((_,i)=>`<button type="button" aria-label="Banner ${i+1}" data-promo-dot="${i}" class="${i?'':'active'}"></button>`).join('')}</div>`;
    const slides=[...el.querySelectorAll('.catalog-promo-slide')],dots=[...el.querySelectorAll('[data-promo-dot]')];
    let ix=0,timer=null,startX=null,startY=null,dragging=false;
    const go=n=>{
      ix=(n+slides.length)%slides.length;
      slides.forEach((x,i)=>{const on=i===ix;x.classList.toggle('active',on);x.setAttribute('aria-hidden',String(!on))});
      dots.forEach((x,i)=>x.classList.toggle('active',i===ix));
    };
    const stop=()=>{if(timer){clearInterval(timer);timer=null}};
    const startAuto=()=>{stop();if(document.hidden)return;timer=setInterval(()=>go(ix+1),4200)};
    const manual=n=>{go(n);startAuto()};
    dots.forEach((b,i)=>b.addEventListener('click',e=>{e.stopPropagation();manual(i)}));
    slides.forEach(b=>b.addEventListener('click',()=>{if(dragging)return;if(b.dataset.promo==='wholesale')return openWholesaleWhatsapp();catalogMode=b.dataset.promo;cat='';q='';catalogBrowseOpen=true;$('#catalogSearch').value='';$('#catalogCategory').value='';document.querySelectorAll('[data-cat],[data-home]').forEach(x=>x.classList.remove('active'));renderProducts();document.querySelector('.catalog-all-section')?.scrollIntoView({behavior:'smooth',block:'start'})}));
    el.addEventListener('pointerdown',e=>{startX=e.clientX;startY=e.clientY;dragging=false;stop()});
    el.addEventListener('pointermove',e=>{if(startX===null)return;if(Math.abs(e.clientX-startX)>12&&Math.abs(e.clientX-startX)>Math.abs(e.clientY-startY))dragging=true});
    el.addEventListener('pointerup',e=>{if(startX!==null){const dx=e.clientX-startX,dy=e.clientY-startY;if(Math.abs(dx)>42&&Math.abs(dx)>Math.abs(dy)){go(ix+(dx<0?1:-1));dragging=true}}startX=startY=null;setTimeout(()=>{dragging=false},0);startAuto()});
    el.addEventListener('pointercancel',()=>{startX=startY=null;dragging=false;startAuto()});
    document.addEventListener('visibilitychange',()=>document.hidden?stop():startAuto());
    go(0);startAuto();
  }
  function initFloatingSupport(){
    if($('#catalogFloatingSupport'))return;
    const wrap=document.createElement('div');wrap.id='catalogFloatingSupport';wrap.className='catalog-floating-support';
    wrap.innerHTML=`<a class="catalog-floating-wa" href="${waUrl('Hola me gustaria realizar un pedido en su pagina me ayudan con la eleccion?')}" target="_blank" rel="noopener" aria-label="Contactar por WhatsApp">${whatsappIcon}</a><a class="catalog-help-bubble" href="${waUrl('Hola me gustaria realizar un pedido en su pagina me ayudan con la eleccion?')}" target="_blank" rel="noopener"><button type="button" class="catalog-help-close" aria-label="Cerrar">×</button><b>¿Necesitás ayuda?</b><span>Estamos para asesorarte. Escribinos por WhatsApp y te ayudamos a elegir.</span></a>`;
    document.body.appendChild(wrap);
    const bubble=wrap.querySelector('.catalog-help-bubble'),close=wrap.querySelector('.catalog-help-close');
    let showTimer=null,hideTimer=null,cooldownTimer=null;
    const clearBubbleTimers=()=>{if(showTimer)clearTimeout(showTimer);if(hideTimer)clearTimeout(hideTimer);showTimer=hideTimer=null};
    const hideBubble=()=>{bubble.classList.remove('show');if(hideTimer)clearTimeout(hideTimer);hideTimer=null};
    const showBubble=()=>{bubble.classList.add('show');if(hideTimer)clearTimeout(hideTimer);hideTimer=setTimeout(hideBubble,10000)};
    showTimer=setTimeout(showBubble,5000);
    close.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();clearBubbleTimers();hideBubble();if(cooldownTimer)clearTimeout(cooldownTimer);cooldownTimer=setTimeout(showBubble,60000)});
    const sync=()=>wrap.classList.toggle('scrolled',window.scrollY>180);
    window.addEventListener('scroll',sync,{passive:true});sync();
  }
  function bindCatalogActions(){document.querySelectorAll('[data-catalog-show]').forEach(b=>b.addEventListener('click',()=>{catalogMode=b.dataset.catalogShow;cat='';q='';sleeve='';catalogBrowseOpen=true;$('#catalogSearch').value='';$('#catalogCategory').value='';document.querySelectorAll('[data-cat],[data-home]').forEach(x=>x.classList.remove('active'));renderProducts();document.querySelector('.catalog-all-section')?.scrollIntoView({behavior:'smooth',block:'start'})}));$('#closeCatalogBrowse')?.addEventListener('click',()=>goHome());$('#wholesaleWhatsapp')?.addEventListener('click',openWholesaleWhatsapp);document.querySelectorAll('[data-city]').forEach(b=>b.addEventListener('click',()=>{checkoutCity=b.dataset.city;document.querySelectorAll('[data-city]').forEach(x=>x.classList.toggle('active',x===b))}))}
  function openWholesaleWhatsapp(){const wa=String(data?.settings?.whatsapp_number||'').replace(/\D/g,'');const msg='Hola! Quiero conocer precios mayoristas de ';if(!wa)return alert('WhatsApp mayorista todavía no está configurado.');window.open(`https://wa.me/${wa}?text=${encodeURIComponent(msg)}`,'_blank')}

  function add(pid,vid){const p=data.products.find(x=>x.id===pid),v=p?.variants.find(x=>x.id===vid);if(!v||!v.in_stock)return;const x=cart.find(i=>i.variant_id===vid);const max=data.settings.show_exact_stock?Number(v.available||0):20;if(x){if(x.quantity>=max)return alert('No hay más unidades disponibles');x.quantity++}else cart.push({product_id:pid,variant_id:vid,product_name:p.name,variant_name:v.name,price:effectivePrice(v),regular_price:Number(v.price_ars||0),sale_price:saleActive(v)?Number(v.sale_price_ars):null,quantity:1,max});renderCart()}
  function totals(paymentCode=null,delivery='pickup'){const subtotal=cart.reduce((a,x)=>a+x.price*x.quantity,0),shipping=delivery==='shipping'?Number(data?.settings.shipping_fee_ars||0):0,method=(data?.payment_methods||[]).find(m=>m.code===paymentCode);let adj=0,base=subtotal+shipping;if(method?.adjustment_kind==='percent')adj=base*Number(method.adjustment_value||0)/100;else if(method?.adjustment_kind==='fixed')adj=Number(method.adjustment_value||0);if(method?.adjustment_direction==='discount')adj=-Math.abs(adj);else adj=Math.abs(adj);return{subtotal,shipping,adj,total:base+adj}}
  function renderCart(){const t=totals();$('#catalogCartCount').textContent=cart.reduce((a,x)=>a+x.quantity,0);const headerTotal=$('#catalogCartTotal');if(headerTotal)headerTotal.textContent=money(t.subtotal);$('#catalogCartItems').innerHTML=cart.map((x,i)=>`<div class="cart-line"><div><b>${esc(x.product_name)}</b><small>${esc(x.variant_name)} · ${x.sale_price?`<del class="cart-old-price">${money(x.regular_price)}</del> ${money(x.price)}`:money(x.price)}</small></div><div class="cart-line-actions"><button data-i="${i}" data-d="-1">−</button><b>${x.quantity}</b><button data-i="${i}" data-d="1">+</button><button class="remove" data-i="${i}" data-remove>×</button></div></div>`).join('')||'<div class="store-loading">Tu carrito está vacío.</div>';$('#catalogSummary').innerHTML=`<div><span>Subtotal</span><b>${money(t.subtotal)}</b></div><div class="grand"><span>Total estimado</span><b>${money(t.subtotal)}</b></div>`;$('#checkoutButton').disabled=!cart.length;document.querySelectorAll('[data-d]').forEach(b=>b.addEventListener('click',()=>{const x=cart[Number(b.dataset.i)],d=Number(b.dataset.d);x.quantity=Math.max(1,Math.min(x.max,x.quantity+d));renderCart()}));document.querySelectorAll('[data-remove]').forEach(b=>b.addEventListener('click',()=>{cart.splice(Number(b.dataset.i),1);renderCart()}))}
  function openCart(open=true){if(open){$('#catalogCategoryDrawer')?.classList.remove('open');$('#catalogCategoryDrawer')?.setAttribute('aria-hidden','true');$('#catalogCategoryMenuButton')?.setAttribute('aria-expanded','false')}$('#catalogCartDrawer').classList.toggle('open',open);$('#catalogBackdrop').classList.toggle('open',open);$('#catalogCartDrawer').setAttribute('aria-hidden',String(!open))}
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
  $('#catalogSearch').addEventListener('input',e=>{q=e.target.value;cat='';catalogMode='search';catalogBrowseOpen=!!q.trim();document.querySelectorAll('[data-cat],[data-home]').forEach(x=>x.classList.remove('active'));if(!catalogBrowseOpen)document.querySelectorAll('[data-home]').forEach(x=>x.classList.add('active'));renderProducts();if(catalogBrowseOpen)document.querySelector('.catalog-all-section')?.scrollIntoView({behavior:'smooth',block:'start'})});$('#catalogCategory').addEventListener('change',e=>e.target.value?chooseCategory(e.target.value):goHome());$('#catalogCartButton').addEventListener('click',()=>openCart(true));$('#catalogCartClose').addEventListener('click',()=>openCart(false));$('#catalogCategoryMenuButton').addEventListener('click',()=>openCategoryDrawer(!$('#catalogCategoryDrawer').classList.contains('open')));$('#catalogProductBackMain')?.addEventListener('click',()=>closeProductPage(true));$('#catalogCategoryDrawerClose').addEventListener('click',()=>openCategoryDrawer(false));$('#catalogBackdrop').addEventListener('click',()=>{openCart(false);openCategoryDrawer(false)});$('#checkoutButton').addEventListener('click',openCheckout);$('#checkoutClose').addEventListener('click',()=>$('#checkoutModal').classList.add('hidden'));$('#checkoutDelivery').addEventListener('change',updateCheckout);$('#checkoutPayment').addEventListener('change',updateCheckout);$('#placeOrderButton').addEventListener('click',placeOrder);load().catch(e=>$('#catalogGrid').innerHTML=`<div class="store-loading">${esc(e.message)}</div>`);
})();
