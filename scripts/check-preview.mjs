import {readFile, access} from 'node:fs/promises';
import {join} from 'node:path';
const root=join(process.cwd(),'_site');
const html=await readFile(join(root,'index.html'),'utf8');
await access(join(root,'assets/app.js'));
await access(join(root,'assets/preview-fixtures.js'));
if(!html.includes('assets/app.js')||!html.includes('assets/preview-fixtures.js')) throw Error('Real application or fixture is missing');
if(html.includes('assets/supabase-client.js')) throw Error('Live API client must not load in demo');
for(const forbidden of ['qbbtroiqioufuucrqair','sb_publishable_','service_role','preview-demo.js']) {
  if(html.includes(forbidden)) throw Error('Unsafe or unrelated preview content: '+forbidden);
}
console.log('Preview uses real app assets, synthetic fixtures, and no production configuration.');
