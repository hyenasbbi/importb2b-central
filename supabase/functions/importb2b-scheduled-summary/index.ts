import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const headers={"content-type":"application/json"};
const json=(b:unknown,s=200)=>new Response(JSON.stringify(b),{status:s,headers});
const money=(n:number)=>"$ "+Math.round(n||0).toLocaleString("es-AR");
const usdt=(n:number)=>Number(n||0).toLocaleString("es-AR",{minimumFractionDigits:2,maximumFractionDigits:2});

Deno.serve(async(req)=>{
  try{
    const url=Deno.env.get("SUPABASE_URL")!;
    const role=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin=createClient(url,role);

    const {data:secretData,error:secretErr}=await admin.rpc("get_importb2b_cron_secret");
    if(secretErr) return json({error:secretErr.message},500);
    const supplied=req.headers.get("x-cron-secret")||"";
    if(!secretData || supplied!==secretData) return json({error:"Unauthorized"},401);

    const nowIso=new Date().toISOString();
    const {data:settings,error:setErr}=await admin
      .from("notification_settings")
      .select("owner_id,enabled,interval_days,local_hour,timezone,last_sent_at,next_due_at")
      .eq("enabled",true)
      .lte("next_due_at",nowIso);
    if(setErr) return json({error:setErr.message},500);
    if(!settings?.length) return json({ok:true,due:0,pushed:0});

    const [movRes,settRes,recvRes,quoteRes,cfgRes]=await Promise.all([
      admin.from("movements").select("kind,amount,currency,payment_method,cash_holder,transfer_holder,usdt_holder"),
      admin.from("settlements").select("net_amount,status").eq("status","pending"),
      admin.from("receivables").select("pending_amount,status").in("status",["pending","partial"]),
      admin.from("quote_snapshots").select("sell_ars,captured_at").order("captured_at",{ascending:false}).limit(1).maybeSingle(),
      admin.from("importb2b_push_config").select("*").eq("id",1).maybeSingle()
    ]);

    if(movRes.error) return json({error:movRes.error.message},500);
    if(settRes.error) return json({error:settRes.error.message},500);
    if(recvRes.error) return json({error:recvRes.error.message},500);
    if(quoteRes.error) return json({error:quoteRes.error.message},500);

    let cfg=cfgRes.data;
    if(!cfg){
      const keys=webpush.generateVAPIDKeys();
      const ins=await admin.from("importb2b_push_config").insert({
        id:1,vapid_public_key:keys.publicKey,vapid_private_key:keys.privateKey,
        subject:"mailto:notifications@importb2b.local"
      }).select("*").single();
      if(ins.error) return json({error:ins.error.message},500);
      cfg=ins.data;
    }
    webpush.setVapidDetails(cfg.subject,cfg.vapid_public_key,cfg.vapid_private_key);

    let transfer=0,cash=0,usdtTotal=0;
    const by={transfer:{nahuel:0,esteban:0,unassigned:0},cash:{nahuel:0,esteban:0,unassigned:0},usdt:{nahuel:0,esteban:0,unassigned:0}};
    for(const m of (movRes.data||[])){
      const sign=m.kind==="income"?1:-1;
      const amount=Number(m.amount||0)*sign;
      if(m.currency==="ARS" && m.payment_method==="transferencia"){
        transfer+=amount;
        const h=m.transfer_holder==="nahuel"||m.transfer_holder==="esteban"?m.transfer_holder:"unassigned";
        by.transfer[h]+=amount;
      }else if(m.currency==="ARS" && m.payment_method==="efectivo"){
        cash+=amount;
        const h=m.cash_holder==="nahuel"||m.cash_holder==="esteban"?m.cash_holder:"unassigned";
        by.cash[h]+=amount;
      }else if(m.currency==="USDT"){
        usdtTotal+=amount;
        const h=m.usdt_holder==="nahuel"||m.usdt_holder==="esteban"?m.usdt_holder:"unassigned";
        by.usdt[h]+=amount;
      }
    }

    const sell=Number(quoteRes.data?.sell_ars||0);
    const available=transfer+cash+(usdtTotal*sell);
    const pendingSettlement=(settRes.data||[]).reduce((s,x)=>s+Number(x.net_amount||0),0);
    const pendingReceivable=(recvRes.data||[]).reduce((s,x)=>s+Number(x.pending_amount||0),0);
    const payloadData={available,transfer,cash,usdt:usdtTotal,sell_quote:sell,pending_settlement:pendingSettlement,pending_receivable:pendingReceivable,by_holder:by};

    const title="IMPORTB2B · Control financiero";
    const body=`¿Actualizamos caja? Transf. ${money(transfer)} · Efectivo ${money(cash)} · USDT ${usdt(usdtTotal)} · Revisá si faltó registrar algún movimiento.`;
    let pushed=0,failed=0;

    for(const s of settings){
      const notification=await admin.from("notifications").insert({
        owner_id:s.owner_id,type:"financial_reminder",title,body,data:payloadData
      }).select("id").single();
      if(notification.error){console.error(notification.error);continue;}

      const {data:subs,error:subErr}=await admin.from("importb2b_push_subscriptions")
        .select("id,endpoint,p256dh,auth,app_source")
        .eq("owner_id",s.owner_id).eq("active",true);
      if(subErr){console.error(subErr);continue;}
      const central=(subs||[]).filter(x=>x.app_source==="central");
      const targets=central.length?central:(subs||[]);
      const payload=JSON.stringify({
        title,body,url:"/?view=finance&action=recount",tag:"importb2b-finance-control",
        icon:"/assets/img/app-icon-512.png",badge:"/assets/img/app-icon-512.png",data:payloadData
      });

      for(const sub of targets){
        try{
          await webpush.sendNotification(
            {endpoint:sub.endpoint,keys:{p256dh:sub.p256dh,auth:sub.auth}},
            payload,{timeout:15000,TTL:3600,urgency:"high",topic:"importb2b-finance-control"}
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

      const next=new Date();
      next.setUTCDate(next.getUTCDate()+Number(s.interval_days||3));
      next.setUTCHours(17,0,0,0);
      await admin.from("notification_settings")
        .update({last_sent_at:nowIso,next_due_at:next.toISOString(),local_hour:14})
        .eq("owner_id",s.owner_id);
    }

    return json({ok:true,due:settings.length,pushed,failed,summary:payloadData});
  }catch(e){
    console.error(e);
    return json({error:String(e)},500);
  }
});
