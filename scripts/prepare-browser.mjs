// Extract the pinned Linux headless browser without touching shared /tmp files.
import {readFile,writeFile,mkdir,chmod,stat} from 'node:fs/promises';
import {brotliDecompressSync} from 'node:zlib';
const target='artifacts/browser/chromium';
await mkdir('artifacts/browser',{recursive:true});
if(!(await stat(target).catch(()=>null))?.size){
 await writeFile(target,brotliDecompressSync(await readFile('node_modules/@sparticuz/chromium/bin/chromium.br')));
 await chmod(target,0o755);
}
console.log('Browser available at '+target);
