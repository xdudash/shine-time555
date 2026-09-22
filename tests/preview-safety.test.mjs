import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, rm, readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';

test('preview scanner checks nested assets, not only the HTML entry point', async () => {
  const site=await mkdtemp(join(tmpdir(),'shine-preview-check-'));
  const html='<!doctype html><div>DEMO · synthetic data</div><script src="assets/preview-fixtures.js"></script><script src="assets/app.js"></script>';
  try {
    await mkdir(join(site,'assets'));
    await writeFile(join(site,'index.html'),html);
    await writeFile(join(site,'assets/app.js'),'');
    await writeFile(join(site,'assets/preview-fixtures.js'),'');
    const check=()=>spawnSync(process.execPath,['scripts/check-preview.mjs'],{
      cwd:new URL('..',import.meta.url),env:{...process.env,PREVIEW_SITE_DIR:site},encoding:'utf8'
    });
    assert.equal(check().status,0);
    await writeFile(join(site,'assets/unrelated.js'),'const project = "qbbtroiqioufuucrqair";');
    const unsafe=check();
    assert.notEqual(unsafe.status,0);
    assert.match(unsafe.stderr,/Unsafe preview content/);
  } finally { await rm(site,{recursive:true,force:true}); }
});

test('Pages publication requires a successful verified push from main', async () => {
  const workflow=await readFile(new URL('../.github/workflows/pages-preview.yml',import.meta.url),'utf8');
  assert.match(workflow,/workflow_run\.conclusion == 'success'/);
  assert.match(workflow,/workflow_run\.event == 'push'/);
  assert.match(workflow,/workflow_run\.head_branch == 'main'/);
  assert.match(workflow,/workflow_run\.head_repository\.full_name == github\.repository/);
  assert.doesNotMatch(workflow,/workflow_dispatch/);
});
