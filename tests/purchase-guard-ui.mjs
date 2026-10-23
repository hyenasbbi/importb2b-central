import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const app=readFileSync(new URL('../assets/js/app.js',import.meta.url),'utf8');
const extract=(start,end)=>app.slice(app.indexOf(start),app.indexOf(end,app.indexOf(start)));
let modal='',alerts=[],elements={},stored=new Map(),calls=[];
const context=vm.createContext({
  money:x=>String(x),number:x=>String(x),esc:x=>String(x),purchaseStatusPill:()=>'',renderOrderItem:()=>'',
  DB:{purchasePaymentStatus:async()=>context.status,registerPurchasePayment:async(...args)=>{calls.push(args)}},
  crypto:{randomUUID:()=> 'request-one'},sessionStorage:{getItem:k=>stored.get(k),setItem:(k,v)=>stored.set(k,v),removeItem:k=>stored.delete(k)},
  alert:x=>alerts.push(x),openModal:html=>{modal=html;elements={};},closeModal:()=>{},renderOrders:async()=>{},
  $:id=>elements[id]??=({value:'',max:0,disabled:false,childNodes:[{nodeValue:''}],addEventListener(event,fn){this[event]=fn}})
});
vm.runInContext(extract('  function renderPurchaseAccordions','  function renderWebOrderAccordions')+extract('  async function openPurchasePayment','  async function openNewExpense'),context);
const order={id:15,order_number:11,items:[],investment_usd:120,merchandise_usdt:100,usdt_rate_ars:1000,payment_status:{registered_ars:100000,total_ars:100000}};
let html=context.renderPurchaseAccordions([order]);
assert.match(html,/purchase-payment[^>]*disabled[^>]*>Mercadería registrada/);
order.payment_status.registered_ars=40000;
html=context.renderPurchaseAccordions([order]);assert.match(html,/purchase-payment[^>]*>Registrar pago parcial/);
context.status={total_ars:100000,registered_ars:100000};await context.openPurchasePayment(order);
assert.equal(modal,'');assert.equal(alerts.length,1);
context.status={total_ars:100000,registered_ars:40000};await context.openPurchasePayment(order);
assert.match(modal,/max="60000.00"/);assert.match(modal,/Saldo de mercadería: 60000/);
elements['#purchasePayAmount']={value:'60000',max:'60000'};
elements['#purchasePayMethod'].value='transferencia';context.$('#purchasePayHolder').value='nahuel';
await elements['#purchasePaySave'].click();assert.equal(calls.length,1);assert.equal(calls[0][4],'request-one');
await elements['#purchasePaySave'].click();assert.equal(calls.length,1,'Double click sent another request');
console.log('PASS: paid purchase disabled, partial balance displayed, fresh balance check, request ID, double click');
