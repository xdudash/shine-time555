import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');

test('navigation highlights parent tabs for details and ignores booking query parameters',()=>{
  const context={window:{}};vm.runInNewContext(read('assets/operations-ui-core.js'),context);
  for(const [route,expected] of [['client/home','client/home'],['client/book?object=11','client/book'],['client/booking/101','client/bookings'],['cleaner/job/101','cleaner/myday'],['admin/jobs','admin/jobs']])assert.equal(context.window.ShineTimeUi.navigationRoute(route),expected);
});

test('table sorting handles text, natural property identifiers and localized money',()=>{
  const context={window:{addEventListener:()=>{}},document:{querySelectorAll:()=>[],body:{}},setTimeout:()=>{},MutationObserver:class{observe(){}}};
  vm.runInNewContext(read('assets/table-tools.js'),context);
  for(const [values,expected] of [[['-€120.00','-€42.00','€10.00'],['-€120.00','-€42.00','€10.00']],[['Prague','Bratislava'],['Bratislava','Prague']],[['PR-001','BA-010','BA-002'],['BA-002','BA-010','PR-001']],[['€1,240.50','€42','€120'],['€42','€120','€1,240.50']],[['1 240,50 €','42,00 €','120,00 €'],['42,00 €','120,00 €','1 240,50 €']]]){
    const rows=values.map(value=>({cells:[{innerText:value}]}));
    const body={rows,appendChild(row){this.rows.splice(this.rows.indexOf(row),1);this.rows.push(row)}};
    const table={tBodies:[body],dataset:{}};
    context.window.ShineTimeTables.sort(table,0,1);
    assert.deepEqual(body.rows.map(row=>row.cells[0].innerText),expected);
    context.window.ShineTimeTables.sort(table,0,-1);
    assert.deepEqual(body.rows.map(row=>row.cells[0].innerText),[...expected].reverse());
  }
});
