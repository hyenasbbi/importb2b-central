import {test} from 'node:test';
import assert from 'node:assert/strict';
import {quote,verifiedOrder,UalaClient,READINESS} from '../netlify/functions/_uala.mjs';
import {handler} from '../netlify/functions/uala-checkout.mjs';

test('all requested financing rates preserve net, including cent and rounding boundaries',()=>{
 for(const net of [2500,2501,9999,10000,10001,1000000,12345678])for(const financing of [0,1000,1700,2570])for(const vat of [0,2100,2700]){
  const q=quote(net,490,financing,vat);
  assert.equal(q.final_cents%100,0);
  assert.ok(q.estimated_net_cents>=net);
  assert.equal(q.estimated_net_cents,q.final_cents-q.fee_cents);
  assert.equal(q.fee_cents,q.processing_cents+q.financing_cents+q.processing_vat_cents+q.financing_vat_cents);
 }
 assert.equal(quote(1000000).final_cents,1063100);
});
test('invalid rates, out of range amounts and non-integer inputs are rejected',()=>{
 for(const args of [[0],[-1],[NaN],[12.3],[Number.MAX_SAFE_INTEGER],[1000000,10000,0,2100],[1000000,9999,0,1],[1000000,490,-1],[1000000,490,0,NaN]])assert.throws(()=>quote(...args));
});
test('forged status, mismatched amount or reference never confirm payment',()=>{
 const expected={provider_id:'abc',external_reference:'order1',final_cents:10000};
 const remote={uuid:'abc',external_reference:'order1',amount:10000,status:'APPROVED',customer:{card:{pan:'sensitive'}}};
 assert.deepEqual(verifiedOrder(remote,expected),{provider_id:'abc',external_reference:'order1',amount_cents:10000,status:'APPROVED'});
 for(const change of [{uuid:'other'},{amount:9999},{amount:'10000'},{external_reference:'other'},{status:'SUCCESS'}])assert.throws(()=>verifiedOrder({...remote,...change},expected));
 for(const status of ['PENDING','PROCESSED','REJECTED','REFUNDED'])assert.equal(verifiedOrder({...remote,status},expected).status,status);
});
test('official v2 auth, integer cents, hosted checkout and token reuse with mocked transport',async()=>{
 const calls=[];
 const fetchImpl=async(url,opts)=>{calls.push({url,opts});return {ok:true,json:async()=>url.includes('/auth/token')?{access_token:'fake-test-token',expires_in:86400}:{uuid:'00000000-0000-0000-0000-000000000001'}};};
 const client=new UalaClient({environment:'test',username:'test',clientId:'test',clientSecret:'test',fetchImpl});
 await client.createOrder({amountCents:1063100,description:'Test',successUrl:'https://store.example/return',failUrl:'https://store.example/return',notificationUrl:'https://store.example/webhook',externalReference:'test-reference'});
 await client.getOrder('00000000-0000-0000-0000-000000000001');
 assert.equal(calls.length,3);
 assert.equal(calls[0].url,'https://auth.stage.developers.ar.ua.la/v2/api/auth/token');
 assert.equal(JSON.parse(calls[0].opts.body).grant_type,'client_credentials');
 assert.equal(calls[1].url,'https://checkout.stage.developers.ar.ua.la/v2/api/checkout');
 assert.equal(JSON.parse(calls[1].opts.body).amount,'1063100');
 assert.equal(calls[2].opts.headers.authorization,'Bearer fake-test-token');
 assert.equal(calls[1].opts.redirect,'error');
});
test('provider failures are sanitized and POST is not retried',async()=>{
 let calls=0;
 const client=new UalaClient({environment:'test',username:'t',clientId:'t',clientSecret:'secret',fetchImpl:async()=>{calls++;return {ok:false,status:500,text:async()=>'secret'};}});
 await assert.rejects(client.token(),/^Error: Ualá HTTP 500$/);assert.equal(calls,1);
 assert.throws(()=>new UalaClient({environment:'typo',username:'t',clientId:'t',clientSecret:'t'}));
});
test('checkout stays blocked even if env switches, callbacks or installment requests are forged',async()=>{
 process.env.UALA_ENABLED='true';
 for(const body of [{status:'APPROVED'},{plan:'naranja_6'},{callback_success:true},{}]){
  const r=await handler({httpMethod:'POST',body:JSON.stringify(body)});assert.equal(r.statusCode,503);assert.equal(JSON.parse(r.body).code,'UALA_NOT_READY');
 }
 assert.equal(READINESS.enabled,false);assert.deepEqual(READINESS.plans,[]);
});
