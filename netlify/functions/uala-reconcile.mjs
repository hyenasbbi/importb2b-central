import {adminClient} from './_client.mjs';
import {clientFromEnvironment,supabaseStore,reconcileAttempt} from './_uala-lifecycle.mjs';

// Netlify scheduled invocation only. Caller cannot supply a provider UUID.
export const config={schedule:'*/15 * * * *'};
export default async function scheduled(req){
  // Netlify's schedule configuration disables direct HTTP invocation.
  const input=await req.json();
  if(!input || !Number.isFinite(Date.parse(input.next_run)))return new Response(null,{status:400});
  try{
    const db=adminClient(),provider=clientFromEnvironment(),store=supabaseStore(db);
    const r=await db.from('importb2b_uala_attempts').select('provider_id').eq('environment',provider.environment)
      .in('state',['pending','processed','rejected','review']).not('provider_id','is',null).order('checked_at',{ascending:true,nullsFirst:true}).limit(2);
    if(r.error)throw new Error('No se pudo leer conciliación');
    const results=await Promise.allSettled(r.data.map(a=>reconcileAttempt({store,provider,providerId:a.provider_id})));
    return new Response(null,{status:results.some(x=>x.status==='rejected')?503:200});
  }catch{return new Response(null,{status:503});}
}
