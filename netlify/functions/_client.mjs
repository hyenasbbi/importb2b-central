import { createClient } from '@supabase/supabase-js';

export const SUPABASE_URL = process.env.SUPABASE_URL;
export const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
export const PUBLIC_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;

export function adminClient(){
  if(!SUPABASE_URL || !SERVICE_KEY) throw new Error('Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY en Netlify');
  return createClient(SUPABASE_URL,SERVICE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
}
export function userClient(token){
  if(!SUPABASE_URL || !PUBLIC_KEY) throw new Error('Falta SUPABASE_PUBLISHABLE_KEY en Netlify');
  return createClient(SUPABASE_URL,PUBLIC_KEY,{auth:{persistSession:false,autoRefreshToken:false},global:{headers:{Authorization:`Bearer ${token}`}}});
}
export const ok=(body,status=200)=>({statusCode:status,headers:{'content-type':'application/json; charset=utf-8','access-control-allow-origin':'*','access-control-allow-headers':'content-type,authorization','access-control-allow-methods':'GET,POST,OPTIONS'},body:JSON.stringify(body)});
export const preflight=()=>({statusCode:204,headers:{'access-control-allow-origin':'*','access-control-allow-headers':'content-type,authorization','access-control-allow-methods':'GET,POST,OPTIONS'},body:''});
export const clean=(v,max=250)=>String(v??'').trim().slice(0,max);
export const digits=v=>String(v??'').replace(/\D/g,'').slice(0,24);
