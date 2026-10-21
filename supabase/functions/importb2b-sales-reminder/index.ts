import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const headers={"content-type":"application/json"};
const json=(b:unknown,s=200)=>new Response(JSON.stringify(b),{status:s,headers});

function argentinaDayRange(now=new Date()){
  const parts=new Intl.DateTimeFormat("en-CA",{
    timeZone:"America/Argentina/Buenos_Aires",year:"numeric",month:"2-digit",day:"2-digit"
  }).formatToParts(now);
  const value=(t:string)=>parts.find(p=>p.type===t)?.value||"";
  const date=`${value("year")}-${value("month")}-${value("day")}`;
  const start=new Date(`${date}T03:00:00.000Z`);
  const end=new Date(start.getTime()+86400000);
  return {date,start,end};
}

Deno.serve(async(req)=>{
  try{
    const url=Deno.env.get("SUPABASE_URL")!;
    const role=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin=createClient(url,role);

    const {data:secretData,error:secretErr}=await admin.rpc("get_importb2b_cron_secret");
    if(secretErr) return json({error:secretErr.message},500);
    const supplied=req.headers.get("x-cron-secret")||"";
    if(!secretData || supplied!==secretData) return json({error:"Unauthorized"},401);

    const {date,start,end}=argentinaDayRange();
    const saleCount=await admin.from("importb2b_sales")
      .select("id",{count:"exact",head:true})
      .eq("status","completed")
      .gte("sold_at",start.toISOString())
      .lt("sold_at",end.toISOString());
    if(saleCount.error) return json({error:saleCount.error.message},500);
    if(Number(saleCount.count||0)>0) return json({ok:true,date,sales:saleCount.count,pushed:0,reason:"sales_exist"});

    const [{data:settings,error:setErr},{data:cfg,error:cfgErr}]=await Promise.all([
      admin.from("notification_settings").select("owner_id").eq("enabled",true),
      admin.from("importb2b_push_config").select("*").eq("id",1).single()
    ]);
    if(setErr) return json({error:setErr.message},500);
    if(cfgErr||!cfg) return json({error:cfgErr?.message||"Push config not found"},500);

    webpush.setVapidDetails(cfg.subject,cfg.vapid_public_key,cfg.vapid_private_key);
    const title="IMPORTB2B · Ventas de hoy";
    const body="Hoy no hubo movimientos. ¿Te olvidaste de registrar alguna venta? Tocá para abrir Vender.";
    let pushed=0,failed=0;

    for(const s of settings||[]){
      await admin.from("notifications").insert({
        owner_id:s.owner_id,type:"sales_reminder",title,body,data:{date,sales:0}
      });

      const {data:subs}=await admin.from("importb2b_push_subscriptions")
        .select("id,endpoint,p256dh,auth,app_source")
        .eq("owner_id",s.owner_id).eq("active",true);
      const central=(subs||[]).filter(x=>x.app_source==="central");
      const targets=central.length?central:(subs||[]);
      const payload=JSON.stringify({
        title,body,url:"/?view=sell",tag:"importb2b-sales-reminder",
        icon:"/assets/img/app-icon-512.png",badge:"/assets/img/app-icon-512.png",
        data:{date,sales:0}
      });

      for(const sub of targets){
        try{
          await webpush.sendNotification(
            {endpoint:sub.endpoint,keys:{p256dh:sub.p256dh,auth:sub.auth}},
            payload,{timeout:15000,TTL:7200,urgency:"normal",topic:"importb2b-sales-reminder"}
          );
          pushed++;
        }catch(e:any){
          failed++;
          const code=e?.statusCode||e?.status;
          if(code===404||code===410){
            await admin.from("importb2b_push_subscriptions").update({active:false}).eq("id",sub.id);
          }
          console.error(JSON.stringify({event:"push_failed",status:Number(code)||0,reason:String(e?.body||"").match(/BadJwtToken|BadWebPushTopic|VapidPkHashMismatch|UnauthorizedRegistration|NotRegistered|ExpiredToken/i)?.[0]||""}));
        }
      }
    }
    return json({ok:true,date,sales:0,pushed,failed});
  }catch(e){
    console.error(e);
    return json({error:String(e)},500);
  }
});
