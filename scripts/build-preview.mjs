import {readFile, writeFile, mkdir, cp, rm} from 'node:fs/promises';
import {join} from 'node:path';

const root=process.cwd();
const dest=join(root,'_site');
await rm(dest,{recursive:true,force:true});
await mkdir(join(dest,'assets'),{recursive:true});
const php=await readFile(join(root,'index.php'),'utf8');
const scripts=[...php.matchAll(/<script src="(assets\/[^"?]+)(?:\?[^"]*)?"><\/script>/g)].map(match=>match[1]);
if(!scripts.includes('assets/app.js')||!scripts.includes('assets/supabase-client.js')) throw Error('Entry-point scripts changed; update preview builder');
for(const script of scripts) {
  if(['assets/supabase-client.js','assets/operations-dashboard.js'].includes(script)) continue;
  await cp(join(root,script),join(dest,script));
}
for(const css of ['styles.css','ui-system.css','job-lifecycle.css']) await cp(join(root,'assets',css),join(dest,'assets',css));
await cp(join(root,'preview/fixtures.js'),join(dest,'assets/preview-fixtures.js'));
const commit=process.env.PREVIEW_COMMIT||'local';
const assetVersion=encodeURIComponent(commit.slice(0,12));
const head=php.match(/<head>([\s\S]*?)<\/head>/)?.[1]||'';
const styles=head.replace(/<\?=[\s\S]*?\?>/g,'').replace(/\?v=[^"]*/g,'').replace(/<link rel="manifest"[^>]*>/g,'').replace(/(href="assets\/[^"?]+\.css)"/g,`$1?v=${assetVersion}"`);
const scriptTags=scripts.filter(script=>script!=='assets/operations-dashboard.js').map(script=>'<script src="'+(script==='assets/supabase-client.js'?'assets/preview-fixtures.js':script)+'?v='+assetVersion+'"></script>').join('\n');
const html='<!doctype html><html lang="en"><head>'+styles+'<meta name="robots" content="noindex,nofollow"></head><body>'+
  '<div id="preview-banner" role="status" style="position:sticky;z-index:99999;top:0;background:#172033;color:white;padding:9px 14px;display:flex;gap:12px;align-items:center;flex-wrap:wrap;font:14px system-ui"><strong>DEMO · synthetic data</strong><label>View as <select id="preview-role"><option>ADMIN</option><option>OPERATIONS_MANAGER</option><option>CLEANER</option><option>OWNER</option><option>PROPERTY_MANAGER</option></select></label><small>Bratislava + Praha · commit '+commit.slice(0,12)+'</small><small>Changes are disabled</small></div>'+
  '<div id="app"></div><div id="modal-root"></div><div id="toast-root"></div>'+
  '<script>window.ST_BASE="./";window.ST_BUILD="preview-'+commit.slice(0,12)+'";</script>'+scriptTags+
  '<script>bootstrap();document.getElementById("preview-role").addEventListener("change",event=>window.STPreview.switchRole(event.target.value));</script></body></html>';
await writeFile(join(dest,'index.html'),html);
await writeFile(join(dest,'.nojekyll'),'');
console.log('Built actual-source preview from',scripts.length,'application scripts, commit',commit);
