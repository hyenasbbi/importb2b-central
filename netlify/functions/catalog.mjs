import { createClient } from '@supabase/supabase-js';
import { ok, preflight, clean } from './_client.mjs';

export async function handler(event){
  if(event.httpMethod==='OPTIONS') return preflight();
  if(event.httpMethod!=='GET') return ok({error:'Método no permitido'},405);
  try{
    // This RPC exposes only the public catalog; it does not need a service key.
    const admin=createClient(process.env.SUPABASE_URL||'https://jgjvzqfxakvogaeqfual.supabase.co',process.env.SUPABASE_PUBLISHABLE_KEY||process.env.SUPABASE_ANON_KEY||'sb_publishable_ylZfwhV3QQ98wG9qLiL7Jg_vTLaLByl',{auth:{persistSession:false,autoRefreshToken:false}});
    const slug=clean(event.queryStringParameters?.slug||'importb2b',80).toLowerCase();
    const {data,error}=await admin.rpc('importb2b_public_catalog_safe',{p_slug:slug});
    if(error)throw error;
    if(!data||data.error)return ok({error:data?.error||'Catálogo no disponible'},404);
    return {...ok(data),headers:{...ok(data).headers,'cache-control':'no-store','netlify-cdn-cache-control':'no-store'}};

  }catch(e){return ok({error:e?.message||'Error cargando catálogo'},500)}
}
