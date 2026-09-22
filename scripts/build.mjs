import {build} from 'esbuild';
await build({entryPoints:['assets/supabase-client-entry.mjs'],bundle:true,outfile:'assets/supabase-client.js',format:'iife',target:'es2020',minify:true,legalComments:'none'});
await build({entryPoints:['assets/live-updates.mjs'],bundle:true,outfile:'assets/live-updates.js',format:'iife',target:'es2020',minify:true});
await build({entryPoints:['assets/service-worker-entry.mjs'],bundle:true,outfile:'sw.js',format:'iife',target:'es2020',minify:true});
console.log('Built auth client, live coordinator and cache-restricted service worker');

await build({entryPoints:['assets/money.mjs'],bundle:true,outfile:'assets/money.js',format:'iife',target:'es2020',minify:true});
