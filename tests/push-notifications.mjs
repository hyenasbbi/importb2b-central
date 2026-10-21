import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';

const app=fs.readFileSync(new URL('../assets/js/app.js',import.meta.url),'utf8');
const helper=app.slice(app.indexOf('  function urlBase64ToUint8Array'),app.indexOf('  async function start()'));
let calls=[],permission='granted';
const subscription={endpoint:'https://fcm.googleapis.com/test',toJSON:()=>({keys:{p256dh:'p',auth:'a'}}),unsubscribe:async()=>{calls.push('unsubscribe')}};
const registration={pushManager:{getSubscription:async()=>subscription,subscribe:async()=>{calls.push('subscribe');return subscription}}};
const navigator={serviceWorker:{register:async()=>{calls.push('register')},get ready(){calls.push('ready');return Promise.resolve(registration)}}};
const Notification={get permission(){return permission},requestPermission:async()=>{calls.push('permission');return 'granted'}};
const DB={pushPublicKey:async()=>'AQID',savePushSubscription:async()=>{calls.push('save');return {id:'123'}}};
const context=vm.createContext({navigator,window:{PushManager:true,Notification},Notification,DB,atob:s=>Buffer.from(s,'base64').toString('binary'),Uint8Array,setTimeout,clearTimeout});
vm.runInContext(helper+'globalThis.run=ensurePushSubscription;',context);
let r=await context.run(true);
assert.equal(r.subscriptionId,'123');
assert.ok(calls.indexOf('ready')<calls.indexOf('subscribe'));
assert.ok(calls.includes('unsubscribe'));
permission='denied';calls=[];r=await context.run(false);
assert.equal(r.enabled,false);assert.deepEqual(calls,[]);
permission='default';calls=[];await context.run(true);
assert.equal(calls[0],'permission','Request permission before awaiting registration');

const raw=fs.readFileSync(new URL('../supabase/functions/importb2b-push-test/index.ts',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'');
let handler,sends=0,user={id:'self'},sub={id:'123',endpoint:'https://fcm.googleapis.com/test',p256dh:'p',auth:'a'},filters=[];
let pushError=null;
function from(table){
 const query={select(){return this},eq(k,v){filters.push([table,k,v]);return this},gte(){return this},limit(){return this},update(){return this},insert(){return this},
  maybeSingle:async()=>({data:sub}),single:async()=>({data:{subject:'mailto:test@example.com',vapid_public_key:'public',vapid_private_key:'private'}}),
  then(resolve,reject){return Promise.resolve({data:table==='notifications'?[]:null}).then(resolve,reject)}};return query;
}
const server=vm.createContext({Deno:{env:{get:()=>''},serve:fn=>handler=fn},createClient:()=>({auth:{getUser:async()=>({data:{user}})},from}),webpush:{sendNotification:async()=>{sends++;if(pushError)throw pushError;return {statusCode:201}}},Request,Response,URL,console:{error(){}},Date});
vm.runInContext(stripTypeScriptTypes(raw),server);
const request=()=>new Request('https://example.com',{method:'POST',headers:{authorization:'Bearer test','content-type':'application/json'},body:JSON.stringify({subscription_id:123})});
user=null;assert.equal((await handler(request())).status,401);assert.equal(sends,0);
user={id:'self'};sub=null;assert.equal((await handler(request())).status,404);assert.equal(sends,0);
sub={id:'123',endpoint:'https://internal.example/test'};assert.equal((await handler(request())).status,400);assert.equal(sends,0);
sub={id:'123',endpoint:'https://fcm.googleapis.com/test',p256dh:'p',auth:'a'};
const result=await (await handler(request())).json();assert.equal(result.accepted,true);assert.equal(sends,1);
assert.ok(filters.some(([t,k,v])=>t==='importb2b_push_subscriptions'&&k==='owner_id'&&v==='self'));
pushError={statusCode:403,body:'BadJwtToken'};
const rejected=await (await handler(request())).json();assert.equal(rejected.accepted,false);assert.equal(rejected.status,403);assert.equal(rejected.reason,'BadJwtToken');
// Exercise the actual registration wrapper: RPC deduplicates the endpoint;
// the Central source tag is updated only for the authenticated owner's row.
const dbSource=fs.readFileSync(new URL('../assets/js/db.js',import.meta.url),'utf8');
const method=dbSource.slice(dbSource.indexOf('    async savePushSubscription('),dbSource.indexOf('    async financeData('));
let rpcError=null,updates=0,registrationFilters=[];
const registrationDb={rpc:async(name,args)=>{assert.equal(name,'register_importb2b_push_subscription');assert.equal(args.p_endpoint,'same-endpoint');return {data:{id:123},error:rpcError}},from:()=>({update(value){assert.equal(value.app_source,'central');updates++;return this},eq(k,v){registrationFilters.push([k,v]);return this},select(){return this},single:async()=>({data:{id:123}})})};
const registrationContext=vm.createContext({db:registrationDb,authUser:async()=>({id:'self'}),assert:r=>{if(r.error)throw r.error},navigator:{userAgent:'test'},Date});
const registrar=vm.runInContext('({'+method+'})',registrationContext);
assert.equal((await registrar.savePushSubscription({endpoint:'same-endpoint'})).id,123);
assert.equal((await registrar.savePushSubscription({endpoint:'same-endpoint'})).id,123);
assert.ok(registrationFilters.some(([k,v])=>k==='owner_id'&&v==='self'));
rpcError=new Error('registration failed');await assert.rejects(()=>registrar.savePushSubscription({endpoint:'same-endpoint'}));assert.equal(updates,2);
console.log('PASS: push activation, numeric subscription IDs, self-only sends, rejected pushes, repeated registration, owner-filtered update, registration failure');
