import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const VIA_CARGO=100535;
const KNOWN_WRONG_CARRIER=190175;
const cors={"content-type":"application/json","access-control-allow-origin":"*","access-control-allow-headers":"authorization, x-client-info, apikey, content-type"};
const json=(b:unknown,s=200)=>new Response(JSON.stringify(b),{status:s,headers:cors});
const norm=(s:string|null|undefined)=>(s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toUpperCase().trim().replace(/\s+/g," ");
function statusFor(desc:string,stage?:string,sub?:string){const n=norm(desc);if(n.includes("RECIBIDO EN DESTINO"))return"READY_FOR_PICKUP";if(n.includes("LLEGADA A CENTRO DE DISTRIBUCION"))return"ARRIVED_AT_DISTRIBUTION_CENTER";if(n.includes("EN VIAJE A CD")||n==="EN VIAJE")return"IN_TRANSIT";if(n.includes("INGRESO A VIA CARGO"))return"CARRIER_RECEIVED";if(stage==="AvailableForPickup"||String(sub||"").startsWith("AvailableForPickup"))return"READY_FOR_PICKUP";return"NO_UPDATES";}
async function sha256(s:string){const b=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(s));return[...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,"0")).join("");}
async function call17(token:string,endpoint:string,body:unknown){const r=await fetch(`https://api.17track.net/track/v2.4/${endpoint}`,{method:"POST",headers:{"content-type":"application/json","17token":token},body:JSON.stringify(body)});const text=await r.text();let data:any={};try{data=JSON.parse(text)}catch{data={raw:text}}return{http:r.status,data};}
function acceptedArray(data:any):any[]{const a=data?.data?.accepted;if(Array.isArray(a))return a;if(a&&typeof a==="object")return[a];return[];}
function providerError(data:any){const r=data?.data?.rejected;const arr=Array.isArray(r)?r:(r?[r]:[]);const first=arr[0];const e=first?.error||data?.data?.errors?.[0]||null;return e?{code:e.code,message:e.message}:null;}
function extractEvents(p:any){const out:any[]=[];const ti=p?.track_info||p?.tracking||p;const providers=ti?.tracking?.providers||ti?.providers||[];if(Array.isArray(providers))for(const pr of providers)if(Array.isArray(pr?.events))out.push(...pr.events);if(Array.isArray(ti?.events))out.push(...ti.events);return out;}

async function sendPush(admin:any,ownerId:string,payload:any){const serviceRole=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;const supabaseUrl=Deno.env.get("SUPABASE_URL")!;try{const r=await fetch(`${supabaseUrl}/functions/v1/importb2b-send-push`,{method:"POST",headers:{"content-type":"application/json","authorization":`Bearer ${serviceRole}`},body:JSON.stringify({owner_id:ownerId,...payload})});const result=await r.json().catch(()=>({}));return r.ok?result:{ok:false};}catch(e){console.error("push send failed",e);return{ok:false};}}

async function notifyNewEvents(admin:any,s:any){const {data:order}=await admin.from("importb2b_orders").select("order_number").eq("id",s.order_id).maybeSingle();const {data:pending}=await admin.from("importb2b_tracking_events").select("*").eq("shipment_id",s.id).is("push_notified_at",null).order("event_datetime",{ascending:true});
  for(const e of (pending||[])){
    const isReady=e.normalized_status==="READY_FOR_PICKUP";
    const title=isReady?"📦 Pedido listo para retirar":"📦 Nuevo movimiento del paquete";
    const parts=[`Pedido #${order?.order_number||""}`,e.description_original||"Actualización de Vía Cargo"];
    if(e.location_original)parts.push(e.location_original);
    const result=await sendPush(admin,s.owner_id,{title,body:parts.join(" · "),url:"./#seguimiento",tag:`tracking-event-${e.id}`,data:{shipment_id:s.id,event_id:e.id,tracking_number:s.tracking_number,status:e.normalized_status}});
    if(Number(result?.sent||0)>0){const now=new Date().toISOString();await admin.from("importb2b_tracking_events").update({push_notified_at:now}).eq("id",e.id).is("push_notified_at",null);if(isReady)await admin.from("importb2b_shipments").update({ready_for_pickup_notified_at:now,updated_at:now}).eq("id",s.id);}
  }
}

async function process(admin:any,s:any,p:any){
  const evs=extractEvents(p);
  for(const e of evs){const dt=e.time_iso||e.time_utc||((e.time_raw?.date||"")+(e.time_raw?.time?`T${e.time_raw.time}`:""))||null;const pid=await sha256(`${s.tracking_number}|${dt}|${e.description||""}|${e.location||""}`);await admin.from("importb2b_tracking_events").upsert({owner_id:s.owner_id,shipment_id:s.id,tracking_number:s.tracking_number,provider_event_id:pid,description_original:e.description||null,description_normalized:norm(e.description),location_original:e.location||null,location_normalized:norm(e.location),event_datetime:dt,normalized_status:statusFor(e.description||"",e.stage,e.sub_status),raw_provider_data:e},{onConflict:"shipment_id,provider_event_id",ignoreDuplicates:true});}
  evs.sort((a,b)=>new Date(b.time_iso||b.time_utc||0).getTime()-new Date(a.time_iso||a.time_utc||0).getTime());
  const latest=evs[0]||p?.track_info?.latest_event||p?.latest_event||null;
  const latestStatus=p?.track_info?.latest_status||p?.latest_status||{};
  let ns=s.is_received?"RECEIVED":statusFor(latest?.description||"",latest?.stage,latest?.sub_status);
  const sub=latestStatus?.sub_status||latestStatus?.status||"";if(ns==="NO_UPDATES"&&String(sub).includes("AvailableForPickup"))ns="READY_FOR_PICKUP";
  await admin.from("importb2b_shipments").update({provider_carrier_code:VIA_CARGO,provider_global_status:latestStatus?.status||null,normalized_status:ns,latest_checkpoint_description:latest?.description||s.latest_checkpoint_description,latest_checkpoint_location:latest?.location||s.latest_checkpoint_location,latest_checkpoint_at:latest?.time_iso||latest?.time_utc||s.latest_checkpoint_at,last_sync_at:new Date().toISOString(),sync_error:null,updated_at:new Date().toISOString()}).eq("id",s.id);
  /* Notices are queued by the tracking event trigger. */
  return ns;
}

Deno.serve(async(req)=>{if(req.method==="OPTIONS")return json({ok:true});try{const token=Deno.env.get("SEVENTEEN_TRACK_API_TOKEN");if(!token)return json({error:"Missing SEVENTEEN_TRACK_API_TOKEN"},503);const admin=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);const jwt=(req.headers.get("authorization")||"").replace(/^Bearer\s+/i,"");const internal=jwt===Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");const {data:{user}}=internal?{data:{user:null}}:await admin.auth.getUser(jwt);if(!internal&&!user)return json({error:"Unauthorized"},401);const {shipment_id}=await req.json();let query=admin.from("importb2b_shipments").select("*").eq("id",shipment_id);if(!internal)query=query.eq("owner_id",user.id);const {data:s}=await query.single();if(!s)return json({error:"Shipment not found"},404);
  const list=await call17(token,"gettrackinfo",[{number:s.tracking_number}]);let candidates=acceptedArray(list.data);let correct=candidates.find(x=>Number(x?.carrier)===VIA_CARGO)||null;if(!correct){const wrong=candidates.find(x=>Number(x?.carrier)===KNOWN_WRONG_CARRIER)||null;if(wrong){const change=await call17(token,"changecarrier",[{number:s.tracking_number,carrier_old:KNOWN_WRONG_CARRIER,carrier_new:VIA_CARGO}]);const changed=acceptedArray(change.data);const changeErr=providerError(change.data);if(!changed.length&&changeErr&&![-18019809,-18019803].includes(Number(changeErr.code))){const msg=`17TRACK changecarrier: ${changeErr.message||changeErr.code}`;await admin.from("importb2b_shipments").update({sync_error:msg,last_sync_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq("id",s.id);return json({ok:false,error:msg},400);}}}
  let realtime=await call17(token,"getRealTimeTrackInfo",[{number:s.tracking_number,carrier:VIA_CARGO,cacheLevel:"Instant"}]);let accepted=acceptedArray(realtime.data).find(x=>Number(x?.carrier)===VIA_CARGO)||acceptedArray(realtime.data)[0]||null;if(!accepted){const stored=await call17(token,"gettrackinfo",[{number:s.tracking_number,carrier:VIA_CARGO}]);accepted=acceptedArray(stored.data).find(x=>Number(x?.carrier)===VIA_CARGO)||acceptedArray(stored.data)[0]||null;if(!accepted){const err=providerError(stored.data)||providerError(realtime.data);const msg=err?.message||`17TRACK returned no Via Cargo payload (HTTP ${stored.http})`;await admin.from("importb2b_shipments").update({provider_carrier_code:VIA_CARGO,sync_error:msg,last_sync_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq("id",s.id);return json({ok:false,error:msg},400);}}
  const ns=await process(admin,s,accepted);return json({ok:true,status:ns,carrier:VIA_CARGO});}catch(e){console.error(e);return json({error:String(e)},500)}});
