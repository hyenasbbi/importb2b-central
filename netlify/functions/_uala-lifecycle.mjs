import {verifiedOrder,UalaClient} from './_uala.mjs';

export const uuidPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid=value=>typeof value==='string'&&uuidPattern.test(value);
export function clientFromEnvironment(env=process.env,fetchImpl=fetch){
  return new UalaClient({environment:env.UALA_ENVIRONMENT,username:env.UALA_USERNAME,clientId:env.UALA_CLIENT_ID,clientSecret:env.UALA_CLIENT_SECRET_ID,fetchImpl});
}

// All operations require a server-only store. A webhook is an untrusted wakeup,
// never evidence of payment. Fetch only UUIDs already bound to a local attempt.
export async function reconcileAttempt({store,provider,providerId}){
  if(!isUuid(providerId))throw new Error('UUID inválido');
  const attempt=await store.byProviderId(providerId);
  if(!attempt)return {ignored:true};
  if(attempt.environment!==provider.environment)throw new Error('Ambiente no coincide');
  const remote=await provider.getOrder(providerId);
  const verified=verifiedOrder(remote,attempt);
  const installments=remote.customer?.card?.installments?.number;
  const issuer=remote.customer?.card?.issuer;
  // Deliberately discard PAN, cardholder, customer identity and raw response.
  return store.applyVerified({attemptId:attempt.id,providerId:verified.provider_id,
    externalReference:verified.external_reference,amountCents:verified.amount_cents,
    status:verified.status,installments:Number.isSafeInteger(installments)?installments:null,
    issuer:typeof issuer==='string'?issuer.slice(0,40):null});
}

export function supabaseStore(db){
  return {
    async prepare({orderId,requestId,plan,environment}){
      const r=await db.rpc('importb2b_uala_prepare',{p_order_id:orderId,p_request_id:requestId,p_plan:plan,p_environment:environment});
      if(r.error)throw new Error('No se pudo reservar el pedido');return r.data;
    },
    async bind(id,remote){
      const r=await db.rpc('importb2b_uala_bind',{p_attempt_id:id,p_provider_id:remote.uuid,p_reference:remote.external_reference,p_amount_cents:remote.amount,p_checkout_url:remote.links?.checkout_link});
      if(r.error)throw new Error('No se pudo vincular la orden');
    },
    async markUnknown(id){const r=await db.rpc('importb2b_uala_mark_unknown',{p_attempt_id:id});if(r.error)throw new Error('Requiere conciliación manual');},
    async byProviderId(id){
      const r=await db.from('importb2b_uala_attempts').select('id,environment,provider_id,external_reference,final_cents').eq('provider_id',id).maybeSingle();
      if(r.error)throw new Error('No se pudo leer el intento');return r.data;
    },
    async applyVerified(v){
      const r=await db.rpc('importb2b_uala_apply_verified',{
        p_attempt_id:v.attemptId,p_provider_id:v.providerId,p_reference:v.externalReference,
        p_amount_cents:v.amountCents,p_status:v.status,p_installments:v.installments,p_issuer:v.issuer});
      if(r.error)throw new Error('No se pudo conciliar el intento');return r.data;
    }
  };
}

export function makeWebhook({getStore,getProvider}){
  return async event=>{
    const response=(statusCode,body)=>({statusCode,headers:{'content-type':'application/json','cache-control':'no-store'},body:JSON.stringify(body)});
    if(event.httpMethod!=='POST')return response(405,{error:'Método no permitido'});
    if(event.isBase64Encoded || typeof event.body!=='string' || event.body.length>4096)return response(400,{error:'Notificación inválida'});
    let body;try{body=JSON.parse(event.body);}catch{return response(400,{error:'Notificación inválida'});}
    if(!body || !isUuid(body.uuid) || String(body.api_version)!=='2')return response(400,{error:'Notificación inválida'});
    try{
      await reconcileAttempt({store:getStore(),provider:getProvider(),providerId:body.uuid});
      // Generic acknowledgement. Do not disclose order existence/status to callers.
      return response(200,{received:true});
    }catch{return response(503,{error:'Conciliación pendiente'});}
  };
}

// Internal orchestration only. The public checkout remains gated by READINESS.
// No automatic second POST, including timeout or failure persisting the response.
export async function createAttemptOnce({store,provider,orderId,requestId,plan,urls}){
  if(!isUuid(orderId)||!isUuid(requestId))throw new Error('Referencia inválida');
  const a=await store.prepare({orderId,requestId,plan,environment:provider.environment});
  if(!a.new_attempt)return {attemptId:a.id,state:a.state,checkoutUrl:a.checkout_url||null};
  try{
    const remote=await provider.createOrder({amountCents:a.final_cents,description:'Pedido IMPORTB2B',externalReference:a.external_reference,
      successUrl:urls.success,failUrl:urls.fail,notificationUrl:urls.notification});
    if(!isUuid(remote.uuid) || remote.external_reference!==a.external_reference || remote.amount!==a.final_cents)throw new Error('Respuesta no coincide');
    const checkoutUrl=new URL(remote.links?.checkout_link);
    if(checkoutUrl.protocol!=='https:'||checkoutUrl.hostname!=='uala-checkout.com'||checkoutUrl.username||checkoutUrl.password)throw new Error('Formulario no autorizado');
    await store.bind(a.id,remote);
    return {attemptId:a.id,state:'pending',checkoutUrl:checkoutUrl.href};
  }catch{
    await store.markUnknown(a.id);
    throw new Error('Creación incierta: conciliar antes de reintentar');
  }
}
