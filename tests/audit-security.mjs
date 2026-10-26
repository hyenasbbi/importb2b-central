import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
import {execFileSync} from 'node:child_process';
// Exercise the real checkout handler: no order is submitted before acknowledgement.
const catalog=fs.readFileSync('assets/js/catalog.js','utf8');
let called=0,focused=0;
const nodes=new Map();
const $=s=>{if(!nodes.has(s))nodes.set(s,{value:'test',checked:false,focus:()=>focused++});return nodes.get(s)};
const ctx=vm.createContext({$,publicDb:{rpc:async()=>{called++;throw Error('Stop before any real order')}},slug:'importb2b',cart:[],checkoutCity:''});
vm.runInContext(catalog.slice(catalog.indexOf('  async function placeOrder()'),catalog.indexOf("  $('#checkoutModal').addEventListener('keydown'")),ctx);
await ctx.placeOrder();assert.equal(called,0);assert.equal(focused,1);assert.equal($('#placeOrderButton').disabled,false);
$('#checkoutPrivacy').checked=true;await ctx.placeOrder();assert.equal(called,1);
// Exercise deployed push code with a forged private destination. Never make network calls.
let handler,sendCount=0;
const push=stripTypeScriptTypes(fs.readFileSync('supabase/functions/importb2b-send-push/index.ts','utf8').replace(/^import .*;\r?\n/gm,''));
const query={select(){return this},eq(){return this},async single(){return {data:{vapid_public_key:'test',vapid_private_key:'test',subject:'https://example.com'}}},then(resolve){resolve({data:[{id:1,endpoint:'https://127.0.0.1/private',p256dh:'test',auth:'test'}]})}};
vm.runInNewContext(push,{Deno:{env:{get:()=> 'test'},serve:fn=>handler=fn},createClient:()=>({auth:{getUser:async()=>({data:{user:{id:'test'}}})},from:()=>query}),webpush:{setVapidDetails(){},sendNotification:async()=>{sendCount++}},Response,URL,console});
const response=await handler({method:'POST',headers:new Headers({authorization:'Bearer test'}),json:async()=>({})});
const result=await response.json();assert.equal(sendCount,0);assert.equal(result.results[0].statusCode,400);
// Build output must exclude server implementation, SQL and configuration.
execFileSync(process.execPath,['scripts/build-public.mjs']);
for(const p of ['supabase','netlify','docs','tests','.env','package.json','package-lock.json','scripts'])assert.equal(fs.existsSync('dist/'+p),false,p);
for(const p of ['privacidad.html','terminos.html','datos-personales.html','arrepentimiento.html','assets/js/catalog.js'])assert.equal(fs.existsSync('dist/'+p),true,p);
console.log('PASS: checkout acknowledgement, push SSRF rejection, public build isolation');
