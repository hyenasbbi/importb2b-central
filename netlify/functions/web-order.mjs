import { adminClient, ok, preflight, clean, digits } from './_client.mjs';

export async function handler(event){
  if(event.httpMethod==='OPTIONS') return preflight();
  if(event.httpMethod!=='POST') return ok({error:'Método no permitido'},405);
  const admin=adminClient();let created=null;
  try{
    const b=JSON.parse(event.body||'{}');const slug=clean(b.slug||'importb2b',80).toLowerCase();
    const {data:cfg,error:ce}=await admin.from('importb2b_catalog_settings').select('*').eq('public_slug',slug).eq('is_public',true).single();if(ce||!cfg)return ok({error:'Catálogo no disponible'},404);
    const name=clean(b.customer_name,120),phone=digits(b.customer_phone),email=clean(b.customer_email,160).toLowerCase(),delivery=clean(b.delivery_type,20),address=clean(b.delivery_address,300),notes=clean(b.notes,500),paymentCode=clean(b.payment_code,40);
    const items=Array.isArray(b.items)?b.items.slice(0,30):[];
    if(!name||phone.length<6)return ok({error:'Nombre y teléfono son obligatorios'},400);
    if(!['pickup','shipping'].includes(delivery))return ok({error:'Entrega inválida'},400);
    if(delivery==='pickup'&&!cfg.allow_pickup)return ok({error:'Retiro no disponible'},400);
    if(delivery==='shipping'&&!cfg.allow_shipping)return ok({error:'Envío no disponible'},400);
    if(delivery==='shipping'&&!address)return ok({error:'Ingresá la dirección de envío'},400);
    if(!items.length)return ok({error:'El carrito está vacío'},400);
    const {data:pm,error:pme}=await admin.from('importb2b_payment_methods').select('*').eq('owner_id',cfg.owner_id).eq('code',paymentCode).eq('active',true).single();if(pme||!pm||(pm.code==='pay_later'&&!cfg.allow_pay_later_public))return ok({error:'Forma de pago no disponible'},400);
    const normalized=items.map(i=>({variant_id:clean(i.variant_id,60),quantity:Math.max(0,Math.min(20,Number(i.quantity||0)))})).filter(i=>i.variant_id&&i.quantity>0);if(!normalized.length)return ok({error:'No hay productos válidos'},400);
    const vids=[...new Set(normalized.map(i=>i.variant_id))];
    const {data:vars,error:ve}=await admin.from('importb2b_product_variants').select('id,product_id,variant_name,price_ars,cost_ars').in('id',vids).eq('owner_id',cfg.owner_id).eq('active',true);if(ve)throw ve;
    const vm=new Map((vars||[]).map(v=>[v.id,v]));const pids=[...new Set((vars||[]).map(v=>v.product_id))];
    const [pr,sr]=await Promise.all([admin.from('importb2b_products').select('id,name,active,catalog_visible').in('id',pids).eq('owner_id',cfg.owner_id),admin.from('importb2b_stock_summary').select('variant_id,available').in('variant_id',vids)]);if(pr.error)throw pr.error;if(sr.error)throw sr.error;
    const pmx=new Map((pr.data||[]).map(p=>[p.id,p])),sm=new Map((sr.data||[]).map(s=>[s.variant_id,Number(s.available||0)]));let subtotal=0;const rows=[];
    for(const i of normalized){const v=vm.get(i.variant_id);if(!v)return ok({error:'Una variante ya no está disponible'},409);const p=pmx.get(v.product_id);if(!p?.active||!p?.catalog_visible)return ok({error:'Un producto ya no está disponible'},409);if((sm.get(v.id)||0)<i.quantity)return ok({error:`Stock insuficiente para ${p.name} / ${v.variant_name}`},409);const price=Number(v.price_ars||0);subtotal+=price*i.quantity;rows.push({product_id:p.id,variant_id:v.id,product_name:p.name,variant_name:v.variant_name,quantity:i.quantity,unit_price_ars:price,line_total_ars:price*i.quantity,cost_ars:Number(v.cost_ars||0)})}
    if(subtotal<Number(cfg.min_order_ars||0))return ok({error:`El pedido mínimo es $ ${Number(cfg.min_order_ars||0).toLocaleString('es-AR')}`},400);
    const shipping=delivery==='shipping'?Number(cfg.shipping_fee_ars||0):0,base=subtotal+shipping;let adj=0;if(pm.adjustment_kind==='percent')adj=base*Number(pm.adjustment_value||0)/100;else if(pm.adjustment_kind==='fixed')adj=Number(pm.adjustment_value||0);adj=pm.adjustment_direction==='discount'?-Math.abs(adj):Math.abs(adj);const total=base+adj;
    const code=`WEB-${Date.now().toString().slice(-7)}-${crypto.randomUUID().slice(0,4).toUpperCase()}`;
    const {data:o,error:oe}=await admin.from('importb2b_web_orders').insert({owner_id:cfg.owner_id,order_code:code,status:'pending',customer_name:name,customer_phone:phone,customer_email:email||null,delivery_type:delivery,delivery_address:address||null,notes:notes||null,payment_method_id:pm.id,subtotal_ars:subtotal,shipping_ars:shipping,adjustment_ars:adj,total_ars:total}).select().single();if(oe)throw oe;created=o.id;
    const {error:ie}=await admin.from('importb2b_web_order_items').insert(rows.map(({cost_ars,...x})=>({owner_id:cfg.owner_id,order_id:o.id,...x})));if(ie)throw ie;
    const {error:re}=await admin.from('importb2b_inventory_movements').insert(rows.map(x=>({owner_id:cfg.owner_id,product_id:x.product_id,variant_id:x.variant_id,bucket:'reserved',movement_type:'reservation',quantity_delta:x.quantity,unit_cost_ars:x.cost_ars,reference_type:'web_order',reference_id:o.id,note:`Reserva ${code}`,created_by:null})));if(re)throw re;
    return ok({order_id:o.id,order_code:code,status:'pending',subtotal_ars:subtotal,shipping_ars:shipping,adjustment_ars:adj,total_ars:total,payment_method:pm.name,whatsapp_number:cfg.whatsapp_number});
  }catch(e){if(created){try{await admin.from('importb2b_inventory_movements').delete().eq('reference_type','web_order').eq('reference_id',created);await admin.from('importb2b_web_orders').delete().eq('id',created)}catch{}}return ok({error:e?.message||'Error procesando pedido'},500)}
}
