import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../assets/js/app.js',import.meta.url),'utf8');
const variant=(id,name,available,attributes={})=>({id,variant_name:name,stock:{available},attributes,price_ars:45000});
const products=[
  {id:'a',name:'Alemania',category:'Camisetas',variants:[variant('al','L',2),variant('axl','XL',3),variant('am','M',0)]},
  {id:'b',name:'Liverpool',category:'Camisetas',variants:[variant('bxl','XL',4)]},
  {id:'c',name:'Argentina',category:'Camisetas',variants:[variant('cl','Talle L',0),variant('cm','M',1)]},
  {id:'d',name:'Short',category:'Shorts',variants:[variant('dl','Negro',1,{talle:'L'})]},
  {id:'e',name:'Oculto',category:'Camisetas',catalog_visible:false,variants:[variant('el','L',1)]}
];
let elements={},html='',loads=0,exported=[],saved=[];
const element=id=>elements[id]??=({value:'',checked:false,disabled:false,textContent:'',focus(){},setSelectionRange(){},addEventListener(event,handler){this[event]=handler}});
const context=vm.createContext({
  pdfSearch:'',pdfCategory:'Camisetas',pdfSize:'',pdfOnlyStock:true,pdfSelected:new Set(),pdfWholesaleTier:6,
  pdfExactStock:true,pdfTitle:'Mi catálogo',pdfSubtitle:'Talles disponibles',pdfRenderVersion:0,pdfCatalogCache:null,currentView:'pdfs',
  DB:{categories:async()=>['Camisetas','Shorts'],pdfCatalogProducts:async()=>{loads++;return products}},
  document:{activeElement:{id:'pdfSearch',selectionStart:1},querySelectorAll:()=>[]},
  content:{set innerHTML(value){html=value;elements={}}},$:element,
  esc:x=>String(x),number:x=>String(x),money:x=>String(x),alert:x=>{throw Error(x)},
  window:{jspdf:{jsPDF:class{addPage(){}save(name){saved.push(name)}}}},
  loadPdfLogo:async()=>null,drawPdfCover:()=>{},drawPdfProduct:async(doc,p)=>exported.push(p)
});
vm.runInContext(source.slice(source.indexOf('  function pdfVariantSizes'),source.indexOf('  function pdfText')),context);
const result=options=>JSON.parse(JSON.stringify(context.filterPdfProducts(products,options)));
assert.deepEqual(result({search:'L',category:'Camisetas'}).map(p=>p.id),['a']);
assert.deepEqual(result({search:'talle L',category:'Camisetas'})[0].variants.map(v=>v.id),['al']);
assert.deepEqual(result({size:'L',category:'Camisetas',onlyStock:false}).map(p=>p.id),['a','c']);
assert.deepEqual(result({size:'L',category:'Shorts'}).map(p=>p.id),['d']);
assert.deepEqual(result({search:'XL',category:'Camisetas'}).map(p=>p.id),['a','b']);
assert.equal(result({search:'inexistente'}).length,0);
assert.deepEqual(result({search:'Alemania'})[0].variants.map(v=>v.id),['al','axl']);
assert.deepEqual(result({search:'L',size:'XL'}),[]);
await context.renderPdfBuilder();
assert.match(html,/3 visibles/);
element('#pdfSearch').input({target:{value:'L'}});
await Promise.resolve();await Promise.resolve();
assert.match(html,/1 visibles/);assert.doesNotMatch(html,/<b>Liverpool<\/b>/);
assert.match(html,/2 disponibles · 1 variantes · L/);
assert.match(html,/id="pdfExactStock" type="checkbox" checked/);
assert.match(html,/value="Mi catálogo"/);
assert.equal(loads,1,'Typing must filter locally without fetching stock again');
context.pdfSelected.add('b'); // Previously selected hidden XL product must not leak into PDF.
element('#pdfSelectAll').click();
await Promise.resolve();await Promise.resolve();
element('#pdfTitle').value='Mi catálogo';element('#pdfSubtitle').value='Talle L';element('#pdfExactStock').checked=true;
await element('#pdfClient').click();
assert.deepEqual(exported.map(p=>p.id),['a']);
assert.deepEqual(Array.from(exported[0].variants,v=>v.id),['al']);
assert.equal(saved.length,1);
console.log('PASS: exact L vs XL, stock/category/attributes, live search, preserved settings, selection and actual PDF export payload');
