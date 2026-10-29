import {mkdir,cp,copyFile,rm} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
const out=path.join(root,'dist');
// Only this generated directory may be cleared, never a computed parent.
if(path.dirname(path.resolve(out))!==path.resolve(root)||path.basename(out)!=='dist')throw new Error('Unsafe output path');
await rm(out,{recursive:true,force:true});
await mkdir(out,{recursive:true});
// Explicit allowlist: never publish SQL, functions source, tests, docs or env files.
for(const file of ['index.html','catalogo.html','revendedores.html','club.html','privacidad.html','terminos.html','datos-personales.html','arrepentimiento.html','manifest.webmanifest','sw.js'])await copyFile(path.join(root,file),path.join(out,file));
await cp(path.join(root,'assets'),path.join(out,'assets'),{recursive:true});
console.log('Public assets prepared in dist');
