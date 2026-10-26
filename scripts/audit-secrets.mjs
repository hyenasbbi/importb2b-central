import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
const findings=[];
function scan(text,label){
 const patterns=[['private-key',/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g],['supabase-secret',/sb_secret_[A-Za-z0-9_-]{16,}/g],['github-token',/gh[pousr]_[A-Za-z0-9]{30,}/g],['aws-access-key',/AKIA[A-Z0-9]{16}/g]];
 for(const [kind,pattern] of patterns)if(pattern.test(text))findings.push({file:label,kind});
 for(const jwt of text.matchAll(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g))try{if(JSON.parse(Buffer.from(jwt[0].split('.')[1],'base64url')).role==='service_role')findings.push({file:label,kind:'service-role-jwt'})}catch{}
}
for(const p of execFileSync('git',['ls-files','-z']).toString().split('\0').filter(Boolean)){if(!/\.(png|jpg|jpeg|webp|pdf|ico|woff2?)$/i.test(p))scan(fs.readFileSync(p,'utf8'),p)}
if(process.argv.includes('--history')){
 const objects=execFileSync('git',['rev-list','--objects','--all']).toString().split('\n').map(l=>l.split(' ')).filter(([sha,p])=>p&&!/\.(png|jpg|jpeg|webp|pdf|ico|woff2?)$/i.test(p));
 const batch=execFileSync('git',['cat-file','--batch'],{input:objects.map(([sha])=>sha).join('\n')+'\n',maxBuffer:256*1024*1024});let pos=0;
 for(const [sha,p] of objects){const e=batch.indexOf(10,pos);const header=batch.subarray(pos,e).toString().split(' ');const size=Number(header[2]);if(!Number.isFinite(size))throw Error('Invalid object header');if(header[1]==='blob')scan(batch.subarray(e+1,e+1+size).toString(),'history:'+p);pos=e+size+2}
 console.log('Historical objects inspected:',objects.length);
}
if(process.argv.includes('--live')){
 const paths=new Set(['/','/catalogo.html','/club.html']);
 for(const p of ['/','/catalogo.html','/club.html']){const r=await fetch('https://importb2b.shop'+p);const html=await r.text();scan(html,p);for(const m of html.matchAll(/<script[^>]+src="([^"]+)"/g)){const u=new URL(m[1],r.url);if(u.origin==='https://importb2b.shop')paths.add(u.pathname+u.search)}}
 for(const p of paths){const r=await fetch('https://importb2b.shop'+p);if(!r.ok)throw Error('Public asset unavailable: '+p);scan(await r.text(),'live:'+p)}
 console.log('Public HTML and first-party script assets inspected:',paths.size);
}
console.log(JSON.stringify({findings,scope:'High-confidence patterns only; not proof of absence of every secret. Values are never printed.'}));
if(findings.length)process.exitCode=1;
