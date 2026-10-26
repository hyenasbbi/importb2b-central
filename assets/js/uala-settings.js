(function(){
 const fields=[['vat_bps','IVA'],['processing_bps','Procesamiento débito / crédito'],['financing_3_bps','Financiación 3 cuotas'],['financing_6_naranja_bps','Financiación 6 cuotas Naranja promo'],['financing_9_bps','Financiación 9 cuotas']];
 window.renderUalaSettings=async function(container){
  const panel=document.createElement('article');panel.className='card';container.appendChild(panel);
  panel.innerHTML='<h3>Ualá Bis · Tienda Online</h3><p class="muted">Cargando configuración…</p>';
  try{
   const r=await window.db.from('importb2b_uala_settings').select('*').limit(1).single();
   if(r.error)throw r.error;
   const cfg=r.data;
   panel.innerHTML='<h3>Ualá Bis · Tienda Online</h3><p>Cobros con tarjeta todavía no habilitados. Los planes requieren confirmación de Ualá.</p><p class="muted">El precio base es el neto deseado. El IVA se aplica por separado a procesamiento y financiación.</p>';
   const form=document.createElement('form');form.className='form-grid';
   for(const [key,label] of fields){const l=document.createElement('label');l.textContent=label+' (%)';const input=document.createElement('input');input.name=key;input.type='number';input.min='0';input.max='100';input.step='0.01';input.required=true;input.value=cfg[key]/100;l.appendChild(input);form.appendChild(l);}
   const save=document.createElement('button');save.className='btn primary';save.type='submit';save.textContent='Guardar tasas';form.appendChild(save);
   const status=document.createElement('p');status.setAttribute('role','status');form.appendChild(status);
   form.addEventListener('submit',async e=>{e.preventDefault();save.disabled=true;status.textContent='';try{const payload=Object.fromEntries(fields.map(([key])=>[key,Math.round(Number(form.elements.namedItem(key).value)*100)]));const result=await window.db.from('importb2b_uala_settings').update(payload).eq('owner_id',cfg.owner_id).select('owner_id').single();if(result.error)throw result.error;status.textContent='Tasas guardadas. Los cobros continúan deshabilitados.';}catch{status.textContent='No se pudieron guardar las tasas. Revisá los valores y los permisos.';}finally{save.disabled=false;}});
   panel.appendChild(form);
  }catch{panel.innerHTML='<h3>Ualá Bis · Tienda Online</h3><p>Configuración no disponible para esta sesión. Los cobros con tarjeta no están habilitados.</p>';}
 };
})();
