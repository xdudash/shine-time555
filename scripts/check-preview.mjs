import {readFile, access, readdir} from 'node:fs/promises';
import {join} from 'node:path';
const root=process.env.PREVIEW_SITE_DIR||join(process.cwd(),'_site');
const html=await readFile(join(root,'index.html'),'utf8');
await access(join(root,'assets/app.js'));
await access(join(root,'assets/preview-fixtures.js'));
if(!html.includes('assets/app.js')||!html.includes('assets/preview-fixtures.js')) throw Error('Real application or fixture is missing');
if(html.includes('assets/supabase-client.js')) throw Error('Live API client must not load in demo');
if(html.includes('preview-demo.js')) throw Error('The old mockup must not load');
if(!html.includes('DEMO · synthetic data')) throw Error('Demo disclosure is missing');
async function verifyDirectory(directory) {
  for(const entry of await readdir(directory,{withFileTypes:true})) {
    const path=join(directory,entry.name);
    if(entry.isDirectory()) { await verifyDirectory(path); continue; }
    if(!entry.isFile()) throw Error('Unexpected preview artifact: '+path);
    if(/(^|[/\\])(?:supabase-client|\.env|config)(?:\.|[/\\])/.test(path)) throw Error('Live configuration in preview: '+path);
    if(!/\.(?:html|js|css|json|svg)$/.test(path)) continue;
    const content=await readFile(path,'utf8');
    for(const forbidden of ['qbbtroiqioufuucrqair','sb_publishable_','service_role','preview-demo.js']) {
      if(content.includes(forbidden)) throw Error('Unsafe preview content in '+path+': '+forbidden);
    }
  }
}
await verifyDirectory(root);
console.log('Preview uses real app assets, synthetic fixtures, and no production configuration.');
