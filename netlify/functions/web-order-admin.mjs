import {userClient,ok,preflight} from './_client.mjs';
export async function handler(event){
 if(event.httpMethod==='OPTIONS')return preflight();
 if(event.httpMethod!=='POST')return ok({error:'Método no permitido'},405);
 const token=(event.headers.authorization||'').replace(/^Bearer\s+/i,'');
 if(!token)return ok({error:'No autenticado'},401);
 try{
  const b=JSON.parse(event.body||'{}');
  const fn={accept:'importb2b_accept_web_order',confirm:'importb2b_confirm_web_order',
   cancel:'importb2b_cancel_web_order',deliver:'importb2b_deliver_web_order'}[b.action];
  if(!fn)return ok({error:'Acción inválida'},400);
  const args=b.action==='confirm'?{p_order_id:b.order_id,p_holder:b.holder||null}:
   b.action==='cancel'?{p_order_id:b.order_id,p_reason:b.reason||null}:{p_order_id:b.order_id};
  const {data,error}=await userClient(token).rpc(fn,args);
  return error?ok({error:error.message},400):ok(data);
 }catch{return ok({error:'No se pudo procesar el pedido'},400);}
}
