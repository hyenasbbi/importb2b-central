import {test} from 'node:test';
import assert from 'node:assert/strict';
import {reconcileAttempt,makeWebhook,createAttemptOnce,clientFromEnvironment} from '../netlify/functions/_uala-lifecycle.mjs';
const id='00000000-0000-0000-0000-000000000001';
const orderId='00000000-0000-0000-0000-000000000002';
const requestId='00000000-0000-0000-0000-000000000003';
const attempt={id,provider_id:id,external_reference:'reference',final_cents:1220000,environment:'test'};
const remote={uuid:id,external_reference:'reference',amount:1220000,status:'APPROVED',customer:{name:'private',card:{pan:'sensitive',holder_name:'private',issuer:'VISA',installments:{number:3}}}};
test('webhook forged approval does not override the authenticated server response',async()=>{
 let applied;
 const handler=makeWebhook({getStore:()=>({byProviderId:async()=>attempt,applyVerified:async v=>{applied=v;}}),getProvider:()=>({environment:'test',getOrder:async()=>({...remote,status:'PENDING'})})});
 const r=await handler({httpMethod:'POST',body:JSON.stringify({uuid:id,api_version:'2',status:'APPROVED',amount:1})});
 assert.equal(r.statusCode,200);assert.equal(applied.status,'PENDING');assert.equal(applied.amountCents,1220000);
 assert.ok(!JSON.stringify(applied).includes('sensitive'));assert.ok(!JSON.stringify(applied).includes('private'));
});
test('foreign UUIDs do not call the provider; mismatched references and environments cannot update records',async()=>{
 let calls=0,updates=0;
 const provider={environment:'test',getOrder:async()=>{calls++;return remote;}};
 assert.deepEqual(await reconcileAttempt({store:{byProviderId:async()=>null},provider,providerId:id}),{ignored:true});
 assert.equal(calls,0);
 for(const a of [{...attempt,environment:'production'},{...attempt,external_reference:'other'},{...attempt,final_cents:1220001}]){
  await assert.rejects(reconcileAttempt({store:{byProviderId:async()=>a,applyVerified:async()=>updates++},provider,providerId:id}));
 }
 assert.equal(updates,0);
});
test('invalid and oversized webhooks never access storage; provider failure requests retry',async()=>{
 let calls=0;
 const handler=makeWebhook({getStore:()=>{calls++;throw new Error('unavailable');},getProvider:()=>({})});
 for(const body of ['null','{}','bad','x'.repeat(4097),JSON.stringify({uuid:id,api_version:'1'})])assert.equal((await handler({httpMethod:'POST',body})).statusCode,400);
 assert.equal(calls,0);assert.equal((await handler({httpMethod:'GET'})).statusCode,405);
 assert.equal((await handler({httpMethod:'POST',body:JSON.stringify({uuid:id,api_version:'2'})})).statusCode,503);
});
function mockStore(){let claimed=false,state='creating';return {
 prepare:async()=>{const fresh=!claimed;claimed=true;return {...attempt,new_attempt:fresh,state};},
 bind:async()=>{state='pending';},markUnknown:async()=>{state='unknown';},state:()=>state
};}
const urls={success:'https://store.example/return',fail:'https://store.example/return',notification:'https://store.example/webhook'};
test('concurrent checkout retries claim one provider POST',async()=>{
 const store=mockStore();let posts=0;
 const provider={environment:'test',createOrder:async()=>{posts++;return {...remote,links:{checkout_link:'https://uala-checkout.com/orders/test'}};}};
 await Promise.all([1,2].map(()=>createAttemptOnce({store,provider,orderId,requestId,plan:'credit_3',urls})));
 assert.equal(posts,1);assert.equal(store.state(),'pending');
});
test('ambiguous timeout and failed persistence never repeat POST or release the claim',async()=>{
 for(const failBind of [false,true]){
  const store=mockStore();let posts=0;
  if(failBind)store.bind=async()=>{throw new Error('db failure');};
  const provider={environment:'test',createOrder:async()=>{posts++;if(!failBind)throw new Error('timeout');return {...remote,links:{checkout_link:'https://uala-checkout.com/orders/test'}};}};
  const args={store,provider,orderId,requestId,plan:'credit_3',urls};
  await assert.rejects(createAttemptOnce(args),/incierta/);
  await createAttemptOnce(args);assert.equal(posts,1);assert.equal(store.state(),'unknown');
 }
});
test('provider checkout URL cannot redirect to an unrelated host',async()=>{
 const store=mockStore();
 await assert.rejects(createAttemptOnce({store,provider:{environment:'test',createOrder:async()=>({...remote,links:{checkout_link:'https://uala-checkout.com.attacker.example/orders/test'}})},orderId,requestId,plan:'credit_3',urls}),/incierta/);
 assert.equal(store.state(),'unknown');
});
test('environment is explicit and secrets stay out of returned errors',()=>{
 assert.throws(()=>clientFromEnvironment({UALA_USERNAME:'x',UALA_CLIENT_ID:'x',UALA_CLIENT_SECRET_ID:'sensitive'}),/Ambiente/);
 assert.equal(clientFromEnvironment({UALA_ENVIRONMENT:'test',UALA_USERNAME:'x',UALA_CLIENT_ID:'x',UALA_CLIENT_SECRET_ID:'x'}).environment,'test');
});

// Importing the scheduled route must never trigger network calls or payments.
test('scheduled reconciliation is dormant until explicitly enabled',async()=>{
 const {default:scheduled}=await import('../netlify/functions/uala-reconcile.mjs');
 const previous=process.env.UALA_RECONCILIATION_ENABLED;
 delete process.env.UALA_RECONCILIATION_ENABLED;
 try{assert.equal((await scheduled({json:()=>{throw new Error('must not access input')}})).status,204)}
 finally{if(previous===undefined)delete process.env.UALA_RECONCILIATION_ENABLED;else process.env.UALA_RECONCILIATION_ENABLED=previous}
});
