import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import webpush from "npm:web-push@3.6.7";
const json=(x:unknown,s=200)=>new Response(JSON.stringify(x),{status:s,headers:{"content-type":"application/json"}});
Deno.serve(async req=>{
 if(req.method!=="POST")return json({error:"Method not allowed"},405);
 const url=Deno.env.get("SUPABASE_URL")!, key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
 const admin=createClient(url,key,{auth:{persistSession:false}});
 try{
  const {data:secret,error:secretError}=await admin.rpc("get_importb2b_cron_secret");
  const supplied=req.headers.get("x-cron-secret")||"";
  if(secretError||!secret||supplied!==secret)return json({error:"Unauthorized"},401);
  const input=await req.json().catch(()=>({}));
  let polled=0;
  if(input.poll===true){
   const {data:ships,error}=await admin.from("importb2b_shipments").select("id")
    .eq("is_received",false).eq("tracking_registered",true)
    .or("last_sync_at.is.null,last_sync_at.lt."+new Date(Date.now()-14*60000).toISOString()).limit(10);
   if(error)throw error;
   await Promise.all((ships||[]).map(async s=>{
    const r=await fetch(url+"/functions/v1/seventeen-track-refresh",{
     method:"POST",headers:{"content-type":"application/json",authorization:"Bearer "+key},
     body:JSON.stringify({shipment_id:s.id}),signal:AbortSignal.timeout(25000)});
    if(r.ok)polled++;else console.error("shipment_poll_failed",s.id,r.status);
   }));
  }
  const {data:jobs,error}=await admin.rpc("importb2b_claim_operational_notifications");
  if(error)throw error;
  if(!jobs?.length)return json({ok:true,jobs:0,polled});
  const {data:cfg,error:cfgError}=await admin.from("importb2b_push_config")
   .select("subject,vapid_public_key,vapid_private_key").eq("id",1).single();
  if(cfgError||!cfg)throw new Error("Push configuration unavailable");
  let sent=0,failed=0;
  // Limit concurrency to three queue entries; avoid a long chain of device timeouts.
  for(let offset=0;offset<jobs.length;offset+=3){
   await Promise.all(jobs.slice(offset,offset+3).map(async (job:any)=>{
    if(job.data?.order_id){
     const {data:order,error:orderError}=await admin.from("importb2b_web_orders").select("status,sale_id").eq("id",job.data.order_id).maybeSingle();
     if(!orderError&&(!order||!["pending","accepted"].includes(order.status)||order.sale_id)){
      await admin.rpc("importb2b_finish_operational_notification",{p_id:job.id,p_ok:true,p_error:"order_already_resolved",p_device_ids:[]});return;
     }
    }
    const {data:subs,error:subError}=await admin.from("importb2b_push_subscriptions")
     .select("id,endpoint,p256dh,auth,app_source").eq("owner_id",job.owner_id).eq("active",true);
    const central=(subs||[]).filter(s=>s.app_source==="central");
    const previous=(job.delivered_device_ids||[]).map(String);
    const targets=(central.length?central:(subs||[])).filter(s=>!previous.includes(String(s.id)));
    const deliveredIds:number[]=[];
    let ok=0,bad=0;const errors:string[]=[];
    if(subError){bad++;errors.push("subscription_query_failed");}
    const payload=JSON.stringify({title:job.title,body:job.body,url:job.data.url,
     tag:"ops-"+job.id,data:job.data,icon:"/assets/img/app-icon-512.png"});
    await Promise.all(targets.map(async sub=>{
     try{
      await webpush.sendNotification({endpoint:sub.endpoint,keys:{p256dh:sub.p256dh,auth:sub.auth}},
       payload,{vapidDetails:{subject:cfg.subject,publicKey:cfg.vapid_public_key,privateKey:cfg.vapid_private_key},
        TTL:3600,urgency:"high",timeout:12000});
      ok++;sent++;deliveredIds.push(sub.id);
     }catch(e){
      const status=Number((e as any)?.statusCode)||0;
      if(status===404||status===410){
       await admin.from("importb2b_push_subscriptions").update({active:false}).eq("id",sub.id);
      }else bad++;
      errors.push("provider_status_"+status);failed++;
     }
    }));
    const delivered=bad===0&&(ok>0||previous.length>0);
    const result=await admin.rpc("importb2b_finish_operational_notification",{
     p_id:job.id,p_ok:delivered,p_device_ids:deliveredIds,p_error:errors.join(",")||(!targets.length?"no_active_devices":null)});
    if(result.error)console.error("notification_finish_failed",job.id);
   }));
  }
  return json({ok:true,jobs:jobs.length,sent,failed,polled});
 }catch{console.error("operational_notification_worker_failed");return json({error:"Worker failed; queued notices remain retryable"},500);}
});
