import { adminClient, userClient, ok, preflight } from './_client.mjs';

export async function handler(event){
  if(event.httpMethod==='OPTIONS')return preflight();if(event.httpMethod!=='POST')return ok({error:'Método no permitido'},405);
  try{
    const token=(event.headers.authorization||'').replace(/^Bearer\s+/i,'');if(!token)return ok({error:'No autenticado'},401);
    const admin=adminClient();const {data:{user},error:ue}=await admin.auth.getUser(token);if(ue||!user)return ok({error:'Sesión inválida'},401);
    const body=JSON.parse(event.body||'{}'),action=body.action,orderId=body.order_id;
    const {data:o,error:oe}=await admin.from('importb2b_web_orders').select('*').eq('id',orderId).single();if(oe||!o||o.owner_id!==user.id)return ok({error:'Pedido no encontrado'},404);if(o.status!=='pending')return ok({error:'El pedido ya fue procesado'},409);
    const {data:items,error:ie}=await admin.from('importb2b_web_order_items').select('*').eq('order_id',o.id);if(ie)throw ie;
    const vids=(items||[]).map(i=>i.variant_id);const {data:vars,error:ve}=await admin.from('importb2b_product_variants').select('id,cost_ars').in('id',vids);if(ve)throw ve;const cm=new Map((vars||[]).map(v=>[v.id,Number(v.cost_ars||0)]));
    if(action==='cancel'){
      const rel=(items||[]).map(i=>({owner_id:user.id,product_id:i.product_id,variant_id:i.variant_id,bucket:'reserved',movement_type:'reservation_release',quantity_delta:-Number(i.quantity),unit_cost_ars:cm.get(i.variant_id)||0,reference_type:'web_order_cancel',reference_id:o.id,note:`Cancelación ${o.order_code}`,created_by:user.id}));
      if(rel.length){const r=await admin.from('importb2b_inventory_movements').insert(rel);if(r.error)throw r.error}
      const r=await admin.from('importb2b_web_orders').update({status:'cancelled',notes:[o.notes,`CANCELADO: ${body.reason||'Sin motivo'}`].filter(Boolean).join('\n')}).eq('id',o.id);if(r.error)throw r.error;return ok({status:'cancelled',order_code:o.order_code});
    }
    if(action!=='confirm')return ok({error:'Acción inválida'},400);
    let customerId=null;const phone=String(o.customer_phone||'').replace(/\D/g,'');const {data:cs}=await admin.from('importb2b_customers').select('id,phone,email').eq('owner_id',user.id).eq('active',true).limit(500);customerId=(cs||[]).find(c=>(c.phone&&String(c.phone).replace(/\D/g,'')===phone)||(o.customer_email&&c.email&&c.email.toLowerCase()===o.customer_email.toLowerCase()))?.id||null;
    if(!customerId){const c=await admin.from('importb2b_customers').insert({owner_id:user.id,full_name:o.customer_name,phone:o.customer_phone,email:o.customer_email,address:o.delivery_address,active:true,source:'web_catalog',source_id:`web:${o.id}`}).select().single();if(c.error)throw c.error;customerId=c.data.id}
    const releases=(items||[]).map(i=>({owner_id:user.id,product_id:i.product_id,variant_id:i.variant_id,bucket:'reserved',movement_type:'reservation_release',quantity_delta:-Number(i.quantity),unit_cost_ars:cm.get(i.variant_id)||0,reference_type:'web_order_confirm',reference_id:o.id,note:`Liberación para confirmar ${o.order_code}`,created_by:user.id}));
    if(releases.length){const rr=await admin.from('importb2b_inventory_movements').insert(releases);if(rr.error)throw rr.error}
    const uc=userClient(token);const sale=await uc.rpc('importb2b_complete_sale',{p_customer_id:customerId,p_items:(items||[]).map(i=>({variant_id:i.variant_id,quantity:Number(i.quantity),unit_price_ars:Number(i.unit_price_ars)})),p_payment_method_id:o.payment_method_id,p_shipping_ars:Number(o.shipping_ars||0),p_discount_ars:0,p_notes:`Pedido web ${o.order_code}${o.notes?`\n${o.notes}`:''}`});
    if(sale.error){if(releases.length)await admin.from('importb2b_inventory_movements').insert(releases.map(x=>({...x,movement_type:'reservation',quantity_delta:-x.quantity_delta,reference_type:'web_order_recover',note:`Recuperación ${o.order_code}`})));throw sale.error}
    if(Math.abs(Number(sale.data?.total_ars||0)-Number(o.total_ars||0))>.01){await uc.rpc('importb2b_cancel_sale',{p_sale_id:sale.data.sale_id,p_reason:'Total del pedido web cambió'});if(releases.length)await admin.from('importb2b_inventory_movements').insert(releases.map(x=>({...x,movement_type:'reservation',quantity_delta:-x.quantity_delta,reference_type:'web_order_recover',note:`Recuperación ${o.order_code}`})));return ok({error:'El total cambió desde que se creó el pedido. Revisalo antes de confirmar.'},409)}
    const ur=await admin.from('importb2b_web_orders').update({status:'confirmed',sale_id:sale.data.sale_id}).eq('id',o.id);if(ur.error)throw ur.error;return ok({status:'confirmed',order_code:o.order_code,sale:sale.data,customer_id:customerId});
  }catch(e){return ok({error:e?.message||'Error procesando pedido'},500)}
}
