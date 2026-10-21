import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {stripTypeScriptTypes} from 'node:module';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const context=vm.createContext({Intl});
vm.runInContext(read('assets/js/order-utils.js'),context);
const utils=context.Importb2bOrderUtils;
assert.equal(utils.phone('3424425792'),'5493424425792');
assert.equal(utils.phone('+54 342 5575323'),'5493425575323');
assert.equal(utils.phone('+5493425575323'),'5493425575323');
const msg=utils.summary({order_code:'WEB-TEST',customer_name:'Prueba',customer_phone:'3420000000',payment_method:'Transferencia',delivery_type:'shipping',delivery_address:'Dirección de prueba',subtotal_ars:20000,shipping_ars:1000,adjustment_ars:0,total_ars:21000},[{quantity:1,product_name:'Short',variant_name:'XL',unit_price_ars:20000}]);
for(const s of ['WEB-TEST','1x Short · XL','Prueba','Dirección de prueba','Transferencia','21.000','Pedido registrado en el catálogo'])assert.ok(msg.includes(s),s);
assert.equal(new URL(utils.link('3420000000',msg)).searchParams.get('text'),msg);
const app=read('assets/js/app.js');
const detail=app.slice(app.indexOf('  async function openWebOrder(id)'),app.indexOf('  /* -------------------- PHASE',app.indexOf('  async function openWebOrder(id)')));
for(const s of ['acceptWebOrder','confirmWebOrder','deliverWebOrder','orderWhatsapp(o)'])assert.ok(detail.includes(s));
// Parse every deployed TypeScript source; this detects malformed auth edits.
for(const p of ['importb2b-operational-notifications','seventeen-track-refresh','seventeen-track-webhook']){
 const source=read('supabase/functions/'+p+'/index.ts');
 new vm.Script(stripTypeScriptTypes(source.replace(/^import .*;\r?\n/gm,'')));
}
// Exercise endpoint method/auth enforcement without sending any push or polling.
let handler,claimed=false;
const worker=read('supabase/functions/importb2b-operational-notifications/index.ts').replace(/^import .*;\r?\n/gm,'');
const server=vm.createContext({Deno:{env:{get:()=>''},serve:fn=>handler=fn},createClient:()=>({rpc:async name=>{if(name==='get_importb2b_cron_secret')return {data:'secret'};claimed=true;return {data:[]}}}),Request,Response,Date,console});
vm.runInContext(stripTypeScriptTypes(worker),server);
assert.equal((await handler(new Request('https://test/'))).status,405);
assert.equal((await handler(new Request('https://test/',{method:'POST',body:'{}'}))).status,401);
assert.equal(claimed,false);
const response=await handler(new Request('https://test/',{method:'POST',headers:{'x-cron-secret':'secret'},body:'{}'}));
assert.equal(response.status,200);assert.equal(claimed,true);
console.log('PASS: WhatsApp details/phone encoding, order action UI, TS parse, worker method/auth and empty queue');
