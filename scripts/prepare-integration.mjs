import {mkdir,cp,copyFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
const root='artifacts/supabase-integration';
await mkdir(root,{recursive:true});
execFileSync('node_modules/.bin/supabase',['init','--workdir',root],{stdio:'inherit'});
await cp('supabase/migrations',`${root}/supabase/migrations`,{recursive:true});
await copyFile('supabase/hostinger_schema.sql',`${root}/supabase/migrations/20260901081027_shine_time_v4_hostinger.sql`);
await cp('supabase/functions/st-api',`${root}/supabase/functions/st-api`,{recursive:true});
