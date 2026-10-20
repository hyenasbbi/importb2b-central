import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Exercise the actual catalog renderer and click handlers without network or
// writes to inventory. Include an unclassified product to guard against hiding it.
const nodes=new Map();
function element(){return {innerHTML:'',value:'',dataset:{},append(){},classList:{toggle(){},add(){},remove(){}},setAttribute(){},scrollIntoView(){},addEventListener(type,fn){this[type]=fn},querySelectorAll(selector){
  if(selector!=='[data-subcategory]')return [];
  return [...this.innerHTML.matchAll(/data-subcategory="([^"]*)"/g)].map(m=>{const b=element();b.dataset.subcategory=m[1];return b});
}}};
const document={createElement:element,addEventListener(){},querySelectorAll(){return []},querySelector(s){if(!nodes.has(s))nodes.set(s,element());return nodes.get(s)}};
const context=vm.createContext({document,window:{},location:{search:'',href:'https://example.test/catalogo'},history:{replaceState(){}},URL,URLSearchParams,Intl});
const source=fs.readFileSync(new URL('../assets/js/catalog.js',import.meta.url),'utf8');
const prefix=source.slice(0,source.indexOf('  let catalogReturnScroll='));
vm.runInContext(prefix+`globalThis.testCatalog={set(products){data={products};},chooseCategory,goHome,filteredProducts,renderProducts,select(value){subcategory=value;renderProducts()},search(value){q=value;}};})();`,context);
const api=context.testCatalog;
const variant={id:'v',in_stock:true,available:1,price_ars:100};
api.set([
  {id:'j',name:'Jordan azul',category:'Shores Importados',subcategory:'Jordan Dri Fit',variants:[variant]},
  {id:'v',name:'Jugador',category:'Shores Importados',subcategory:'Versión Jugador',variants:[variant]},
  {id:'u',name:'Sin clasificar',category:'Shores Importados',subcategory:null,variants:[variant]},
  {id:'c',name:'PSG Jordan',category:'Camisetas',sleeve_type:'short',variants:[variant]},
  {id:'l',name:'Larga',category:'Camisetas',sleeve_type:'long',variants:[variant]},
  {id:'alias',name:'Short alias',category:'Shorts Importados',subcategory:'Jordan Dri Fit',variants:[variant]}
]);
const ids=()=>Array.from(api.filteredProducts(),p=>p.id);
api.chooseCategory('Shores Importados');
assert.deepEqual(ids(),['v']);
const bar=nodes.get('#catalogSubcategoryBar');
assert.match(bar.innerHTML,/VERSIÓN JUGADOR/);
const buttons=bar.querySelectorAll('[data-subcategory]');
// Renderer has attached handlers to its own instances; bind the same events to
// stable mock buttons and render again to exercise a real filter button click.
bar.querySelectorAll=()=>buttons;
api.renderProducts();
buttons.find(b=>b.dataset.subcategory==='Jordan Dri Fit').click();
assert.deepEqual(ids(),['j']);
api.select('Versión Jugador');assert.deepEqual(ids(),['v']);
api.select('');assert.deepEqual(ids(),['j','v','u']);
api.select('Jordan Dri Fit');api.chooseCategory('Camisetas');
assert.deepEqual(ids(),['c']); // Existing sleeve filter remains effective.
api.chooseCategory('Shores Importados');assert.deepEqual(ids(),['v']);
api.select('');api.search('jordan dri fit');assert.deepEqual(ids(),['j']);
api.search('');api.chooseCategory('Shorts Importados');api.select('Jordan Dri Fit');assert.deepEqual(ids(),['alias']);
api.select('Jordan Dri Fit');api.goHome(false);assert.equal(ids().length,6);

// Both forms expose an explicit unassigned choice and preserve saved metadata.
const app=fs.readFileSync(new URL('../assets/js/app.js',import.meta.url),'utf8');
const helpers=app.slice(app.indexOf('  const isImportedShorts='),app.indexOf('  async function openNewProduct()'));
vm.runInContext(`{const esc=s=>String(s??'');const $=s=>document.querySelector(s);${helpers}globalThis.shortField=shortsSubcategoryField;}`,context);
assert.match(context.shortField('ep','Shores Importados','Jordan Dri Fit'),/value="Jordan Dri Fit" selected/);
assert.match(context.shortField('np','Shorts Importados'),/Versión Jugador/);
assert.match(context.shortField('ep','Camisetas'),/class="hidden"/);
console.log('PASS: shorts filters, unassigned products, category navigation, sleeve regression, editor choices');
