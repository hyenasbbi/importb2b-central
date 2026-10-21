(function(root){
  const money=n=>new Intl.NumberFormat('es-AR',{style:'currency',currency:'ARS',maximumFractionDigits:2}).format(Number(n||0));
  function phone(value){
    let n=String(value||'').replace(/\D/g,'');
    if(n.length===11&&n.startsWith('0'))n=n.slice(1);
    if(n.length===10)n='549'+n;
    else if(n.length===12&&n.startsWith('54'))n='549'+n.slice(2);
    return n;
  }
  const link=(number,message='')=>'https://wa.me/'+phone(number)+'?text='+encodeURIComponent(message);
  function summary(order,items){
    return [
      '¡Hola IMPORTB2B! 👋 Soy '+order.customer_name+'. Quiero coordinar este pedido con ustedes.','',
      '🛍️ *PEDIDO '+order.order_code+'*','',
      '*DETALLES DEL PEDIDO*',
      ...items.map(i=>i.quantity+'x '+i.product_name+' · '+i.variant_name+' · '+money(i.unit_price_ars)+'/unid'),
      '', '*DATOS DEL CLIENTE*','Nombre: '+order.customer_name,'Teléfono: '+order.customer_phone,
      ...(order.delivery_address?['Dirección: '+order.delivery_address]:[]),
      '', '*ENTREGA Y PAGO*','Entrega: '+(order.delivery_type==='shipping'?'Envío':'Retiro'),
      'Forma de pago: '+order.payment_method,'Productos: '+money(order.subtotal_ars),
      'Envío: '+money(order.shipping_ars),'Ajuste de pago: '+money(order.adjustment_ars),
      '*Total: '+money(order.total_ars)+'*',
      ...(order.notes?['Observaciones: '+order.notes]:[]),
      '', 'Pedido registrado en el catálogo. Quedo atento/a para confirmar disponibilidad, pago y entrega.'
    ].join('\n');
  }
  root.Importb2bOrderUtils={phone,link,summary,icon:'<svg class="wa-brand-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.095 3.2 5.076 4.487.709.306 1.262.489 1.694.626.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.981.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.892-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.993c-.003 5.45-4.437 9.886-9.889 9.886m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.056 24l6.3-1.654a11.882 11.882 0 0 0 5.69 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z"/></svg>'};
})(globalThis);
