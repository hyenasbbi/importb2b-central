(function(root){
  'use strict';
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money=n=>new Intl.NumberFormat('es-AR',{style:'currency',currency:'ARS',maximumFractionDigits:2}).format(n);
  const sale=(price,percent)=>Math.round((Number(price)*(1-Number(percent)/100)+Number.EPSILON)*100)/100;
  async function mount(host,onLink){
    let products=[],selected=new Set(),busy=false,loaded=false;
    host.innerHTML=`<section class="card bulk-offers"><span class="eyebrow">PROMOCIONES</span><h3>Descuentos por selección</h3><p class="muted">Elegí productos o una categoría y aplicá un porcentaje a todas sus variantes. Se calcula sobre el precio normal, sin acumular descuentos.</p><button class="btn ghost" data-load>Cargar productos</button><div data-panel hidden><div class="bulk-offer-filters"><label>Buscar<input data-search placeholder="Nombre o SKU"></label><label>Categoría<select data-category><option value="">Todas</option></select></label><label>Mostrar<select data-offers><option value="all">Todos</option><option value="sale">Con oferta</option><option value="selected">Seleccionados</option></select></label><label>Descuento %<input data-percent type="number" min="0.01" max="99.99" step="0.01" value="10"></label></div><div class="bulk-offer-actions"><button class="btn ghost" data-select>Seleccionar resultados</button><button class="btn ghost" data-clear>Limpiar selección</button><b data-count aria-live="polite"></b></div><div data-list class="bulk-offer-list"></div><p class="muted">La selección incluye todas las variantes activas, también las que no tienen stock. Los productos ocultos seguirán ocultos.</p><div class="bulk-offer-actions"><button class="btn primary" data-preview>Revisar descuento</button><button class="btn ghost" data-remove>Revisar quitar ofertas</button></div><div data-review hidden></div></div><div data-status role="status" aria-live="polite"></div><hr><p>Los productos con oferta aparecen automáticamente en <b>Descuentos</b>. Podés vincular el botón de la portada y poner esa sección primero.</p><button class="btn ghost" data-link>Vincular portada a Descuentos</button><small class="muted" data-link-status></small></section>`;
    const $=s=>host.querySelector(s),status=s=>{$('[data-status]').textContent=s;};
    const visible=()=>{const q=$('[data-search]').value.trim().toLowerCase(),cat=$('[data-category]').value,mode=$('[data-offers]').value;return products.filter(p=>(!q||[p.name,p.sku].join(' ').toLowerCase().includes(q))&&(!cat||p.category===cat)&&(mode==='all'||mode==='selected'&&selected.has(p.id)||mode==='sale'&&p.variants.some(v=>Number(v.sale_price_ars)>0)));};
    function invalidate(){$('[data-review]').hidden=true;}
    function render(){
      const list=visible();$('[data-count]').textContent=`${selected.size} seleccionados · ${list.length} resultados`;
      $('[data-list]').innerHTML=list.map(p=>`<label class="bulk-offer-product"><input type="checkbox" data-product="${p.id}" ${selected.has(p.id)?'checked':''}><span><b>${esc(p.name)}</b><small>${esc(p.category||'Sin categoría')} · ${p.variants.length} variantes${p.catalog_visible?'':' · Oculto en catálogo'}</small></span><span>${p.variants.length?'Desde '+money(Math.min(...p.variants.map(v=>Number(v.price_ars)))):'Sin variantes'}</span></label>`).join('')||'<p>No hay productos para este filtro.</p>';
      $('[data-preview]').disabled=!selected.size||busy;$('[data-remove]').disabled=!selected.size||busy;
    }
    async function load(){
      if(busy)return;busy=true;$('[data-load]').disabled=true;status('Cargando productos…');invalidate();
      try{products=await root.DB.bulkDiscountProducts();selected=new Set([...selected].filter(id=>products.some(p=>p.id===id)));loaded=true;
        $('[data-category]').innerHTML='<option value="">Todas</option>'+[...new Set(products.map(p=>p.category).filter(Boolean))].sort().map(c=>`<option>${esc(c)}</option>`).join('');
        $('[data-panel]').hidden=false;$('[data-load]').textContent='Recargar productos';status('');
      }catch(e){status(e.message)}finally{busy=false;$('[data-load]').disabled=false;if(loaded)render();}
    }
    function review(remove){
      if(busy)return;const chosen=products.filter(p=>selected.has(p.id));if(!chosen.length)return;
      const percent=remove?null:Number($('[data-percent]').value);
      if(!remove&&(!Number.isFinite(percent)||percent<=0||percent>=100)){status('Ingresá un porcentaje mayor a 0 y menor a 100.');return;}
      if(chosen.some(p=>!p.variants.length)){status('Hay productos sin variantes activas. Quitalos de la selección.');return;}
      const rows=chosen.flatMap(p=>p.variants.map(v=>({p,v,next:remove?null:sale(v.price_ars,percent)})));
      if(!remove&&rows.some(({v,next})=>!Number.isFinite(next)||next<=0||next>=Number(v.price_ars))){status('Hay precios normales inválidos para este descuento. Revisalos antes de continuar.');return;}
      const expected=rows.map(({v})=>({id:v.id,price:Number(v.price_ars),sale:v.sale_price_ars==null?null:Number(v.sale_price_ars)}));
      const ids=chosen.map(p=>p.id),existing=rows.filter(({v})=>v.sale_price_ars!=null).length,box=$('[data-review]');
      box.hidden=false;status('');box.innerHTML=`<h4>${remove?'Quitar ofertas':`Aplicar ${percent}% de descuento`} · ${chosen.length} productos / ${rows.length} variantes</h4><p>${remove?'Vuelven a su precio normal. No se restauran descuentos anteriores.':`Reemplaza las ofertas actuales de ${existing} variantes. Conserva el precio normal y el mayorista.`} <b>Al confirmar, el cambio se publica inmediatamente.</b></p><div class="bulk-offer-price-scroll"><table class="table"><thead><tr><th>Producto / variante</th><th>Normal</th><th>Oferta actual</th><th>Nuevo precio</th></tr></thead><tbody>${rows.map(({p,v,next})=>`<tr><td>${esc(p.name)}<br><small>${esc(v.variant_name)}</small></td><td>${money(v.price_ars)}</td><td>${v.sale_price_ars==null?'—':money(v.sale_price_ars)}</td><td><b>${money(next??v.price_ars)}</b></td></tr>`).join('')}</tbody></table></div><div class="bulk-offer-actions"><button class="btn primary" data-confirm>Confirmar ${remove?'quitar ofertas':'descuento'}</button><button class="btn ghost" data-cancel>Cancelar</button></div>`;
      box.querySelector('[data-cancel]').onclick=invalidate;
      box.querySelector('[data-confirm]').onclick=async()=>{
        if(busy)return;busy=true;host.querySelectorAll('input,select,button').forEach(el=>el.disabled=true);status('Aplicando cambios…');
        try{const result=await root.DB.applyBulkDiscount(ids,percent,expected);rows.forEach(({v,next})=>v.sale_price_ars=next);invalidate();status(`Listo: ${result.products} productos y ${result.variants} variantes actualizados. ${remove?'Las ofertas seleccionadas se quitaron.':'Ya aparecen en Descuentos si están visibles y disponibles.'}`);}
        catch(e){status(e.message+' Recargá los productos para comprobar los precios y volver a revisar.');invalidate();}
        finally{busy=false;host.querySelectorAll('input,select,button').forEach(el=>el.disabled=false);render();}
      };
      box.scrollIntoView({behavior:'smooth',block:'nearest'});
    }
    $('[data-load]').onclick=load;
    ['search','category','offers'].forEach(k=>$(`[data-${k}]`).addEventListener(k==='search'?'input':'change',render));
    $('[data-percent]').oninput=invalidate;
    $('[data-select]').onclick=()=>{visible().forEach(p=>selected.add(p.id));invalidate();render();};
    $('[data-clear]').onclick=()=>{selected.clear();invalidate();render();};
    $('[data-list]').onchange=e=>{const id=e.target.dataset.product;if(!id)return;e.target.checked?selected.add(id):selected.delete(id);invalidate();render();};
    $('[data-preview]').onclick=()=>review(false);$('[data-remove]').onclick=()=>review(true);
    $('[data-link]').onclick=()=>{onLink();$('[data-link-status]').textContent='Destino y orden preparados en el editor. Publicá el diseño para mostrar ese enlace.';};
  }
  root.Importb2bBulkDiscounts={mount,sale};
  if(typeof module!=='undefined')module.exports={sale};
})(typeof window!=='undefined'?window:globalThis);
