import assert from 'node:assert/strict';
import {handler} from '../netlify/functions/catalog.mjs';
import {createClient} from '@supabase/supabase-js';
const response=await handler({httpMethod:'GET',queryStringParameters:{slug:'importb2b'}});
assert.equal(response.statusCode,200);assert.equal(response.headers['cache-control'],'no-store');
const data=JSON.parse(response.body);assert.ok(data.products.length>0);assert.ok(Array.isArray(data.categories));
for(const p of data.products){assert.ok(data.categories.some(c=>c.active&&c.name===p.category));assert.equal(Object.hasOwn(p,'cost_ars'),false);assert.equal(Object.hasOwn(p,'owner_id'),false);for(const v of p.variants)assert.equal(Object.hasOwn(v,'cost_ars'),false)}
assert.equal((await handler({httpMethod:'GET',queryStringParameters:{slug:'missing-test-catalog'}})).statusCode,404);
assert.equal((await handler({httpMethod:'POST'})).statusCode,405);
const db=createClient('https://jgjvzqfxakvogaeqfual.supabase.co','sb_publishable_ylZfwhV3QQ98wG9qLiL7Jg_vTLaLByl',{auth:{persistSession:false,autoRefreshToken:false}});
const denied=await db.rpc('importb2b_set_category_order',{p_ids:[]});assert.ok(denied.error);
const settings=await (await fetch('https://jgjvzqfxakvogaeqfual.supabase.co/auth/v1/settings',{headers:{apikey:'sb_publishable_ylZfwhV3QQ98wG9qLiL7Jg_vTLaLByl'}})).json();
console.log('PASS: public catalog, filtered products, no cost/owner fields, missing catalog, methods, anonymous reorder denied');
console.log(JSON.stringify({disable_signup:settings.disable_signup,mailer_autoconfirm:settings.mailer_autoconfirm}));
