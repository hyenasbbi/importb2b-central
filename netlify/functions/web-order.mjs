import { createClient } from '@supabase/supabase-js';
import {ok,preflight} from './_client.mjs';
export async function handler(event){
 if(event.httpMethod==='OPTIONS')return preflight();
 if(event.httpMethod!=='POST')return ok({error:'Método no permitido'},405);
 try{
  const b=JSON.parse(event.body||'{}');
  const db=createClient(process.env.SUPABASE_URL||'https://jgjvzqfxakvogaeqfual.supabase.co',
   process.env.SUPABASE_PUBLISHABLE_KEY||process.env.SUPABASE_ANON_KEY||'sb_publishable_ylZfwhV3QQ98wG9qLiL7Jg_vTLaLByl',
   {auth:{persistSession:false}});
  const {data,error}=await db.rpc('importb2b_create_web_order_safe',{
   p_slug:b.slug||'importb2b',p_customer_name:b.customer_name,p_customer_phone:b.customer_phone,
   p_customer_email:b.customer_email||'',p_delivery_type:b.delivery_type,
   p_delivery_address:b.delivery_address||'',p_payment_code:b.payment_code,
   p_items:b.items,p_notes:b.notes||null});
  if(error)return ok({error:error.message},400);
  return ok(data);
 }catch{return ok({error:'No se pudo procesar el pedido'},400);}
}
