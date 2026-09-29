import {readFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import assert from 'node:assert/strict';
const root='_production';const html=await readFile(join(root,'index.html'),'utf8');
assert.match(html,/assets\/supabase-client\.js/);assert.match(html,/window\.ST_SUPABASE=/);
assert.doesNotMatch(html,/STPreview|preview-fixtures|preview-role|Changes are disabled|DEMO/);
const release=JSON.parse(await readFile(join(root,'release.json'),'utf8'));assert.equal(release.mode,'production');
for(const m of html.matchAll(/(?:src|href)="((?:assets\/|manifest)[^"?]+)(?:\?[^" ]*)?"/g))await readFile(join(root,m[1]));
async function scan(dir){for(const e of await readdir(dir,{withFileTypes:true})){const p=join(dir,e.name);if(e.isDirectory()){await scan(p);continue}assert.doesNotMatch(e.name,/\.php$|\.sql$|\.env|fixture/);if(/\.(js|html|json)$/.test(e.name))assert.doesNotMatch(await readFile(p,'utf8'),/sb_secret_[A-Za-z0-9_-]+|SUPABASE_SERVICE_ROLE_KEY|Demo preview: editing is unavailable/);}}
await scan(root);console.log('Production artifact: real auth client, no fixtures, no privileged keys, all entry assets present.');
