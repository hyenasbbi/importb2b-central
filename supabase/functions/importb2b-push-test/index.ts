import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import webpush from "npm:web-push@3.6.7";

const headers={"content-type":"application/json","access-control-allow-origin":"*","access-control-allow-headers":"authorization, x-client-info, apikey, content-type","access-control-allow-methods":"POST, OPTIONS"};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers});
Deno.serve(async req=>{
  if(req.method==="OPTIONS")return json({ok:true});
  if(req.method!=="POST")return json({error:"Método no permitido"},405);
  try{
    const admin=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const jwt=(req.headers.get("authorization")||"").replace(/^Bearer\s+/i,"");
    const {data:{user},error:authError}=await admin.auth.getUser(jwt);
    if(authError||!user)return json({error:"Sesión no válida"},401);
    const input=await req.json().catch(()=>({}));
    const id=input.subscription_id;
    if(!((typeof id==="number"&&Number.isSafeInteger(id)&&id>0)||
      (typeof id==="string"&&/^[1-9][0-9]*$/.test(id))))return json({error:"Falta registrar este dispositivo"},400);
    // Never send to an arbitrary endpoint or another account.
    const {data:sub,error:subError}=await admin.from("importb2b_push_subscriptions")
      .select("id,endpoint,p256dh,auth").eq("id",input.subscription_id)
      .eq("owner_id",user.id).eq("active",true).eq("app_source","central").maybeSingle();
    if(subError)throw subError;
    if(!sub)return json({error:"Este dispositivo no está registrado en tu cuenta"},404);
    const host=new URL(sub.endpoint).hostname;
    if(!sub.endpoint.startsWith("https://")||!(
      host==="fcm.googleapis.com"||host==="updates.push.services.mozilla.com"||
      host.endsWith(".push.apple.com")||host.endsWith(".notify.windows.com")))
      return json({error:"Proveedor push no reconocido"},400);
    const {data:recent}=await admin.from("notifications").select("id").eq("owner_id",user.id)
      .eq("type","push_test").gte("created_at",new Date(Date.now()-30000).toISOString()).limit(1);
    if(recent?.length)return json({error:"Esperá 30 segundos antes de repetir la prueba"},429);
    const {data:cfg,error:cfgError}=await admin.from("importb2b_push_config")
      .select("subject,vapid_public_key,vapid_private_key").eq("id",1).single();
    if(cfgError||!cfg)throw new Error("Falta configuración push del servidor");
    const title="IMPORTB2B · Prueba de notificación";
    const body="Si ves este aviso, la notificación llegó a este dispositivo.";
    const {error:recordError}=await admin.from("notifications").insert({
      owner_id:user.id,type:"push_test",title,body,data:{subscription_id:sub.id}});
    if(recordError)throw recordError;
    try{
      const result=await webpush.sendNotification(
        {endpoint:sub.endpoint,keys:{p256dh:sub.p256dh,auth:sub.auth}},
        JSON.stringify({title,body,url:"/?view=settings",tag:"importb2b-push-test"}),
        {vapidDetails:{subject:cfg.subject,publicKey:cfg.vapid_public_key,privateKey:cfg.vapid_private_key},
         TTL:120,urgency:"high",timeout:15000});
      return json({ok:true,accepted:true,status:result.statusCode,
        message:"El servicio push aceptó el envío. Confirmá si apareció el aviso en este dispositivo."});
    }catch(error){
      const e=error as {statusCode?:number;body?:string};
      const status=Number(e.statusCode)||0;
      if(status===404||status===410)await admin.from("importb2b_push_subscriptions")
        .update({active:false}).eq("id",sub.id).eq("owner_id",user.id);
      // Log status/reason only, never keys, endpoints, JWTs or full errors.
      const reason=String(e.body||"").match(/BadJwtToken|BadWebPushTopic|BadTtl|BadUrgency|VapidPkHashMismatch|UnauthorizedRegistration|NotRegistered|ExpiredToken/i)?.[0]||"";
      console.error(JSON.stringify({event:"push_test_failed",status,reason}));
      return json({ok:false,accepted:false,status,reason,
        error:status===404||status===410?"La suscripción venció. Volvé a activar las notificaciones.":
        status===401||status===403?"El proveedor rechazó la autenticación push. Informá este código para reparar el servidor.":
        "No se pudo enviar la prueba. Informá el código mostrado."});
    }
  }catch{
    console.error("push_test_internal_error");
    return json({error:"Error interno al probar notificaciones"},500);
  }
});
