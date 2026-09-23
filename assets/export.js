/* Lightweight CSV export for operational tables. Exports the currently visible history/report page. */
(function(){
  function csvCell(value){let s=String(value??'').replace(/\s+/g,' ').trim();if(/^[=+@-]/.test(s))s="'"+s;return /[\",\n]/.test(s)?`"${s.replace(/"/g,'""')}"`:s}
  function exportTable(table,filename){
    const rows=[...table.querySelectorAll('tr')].filter(row=>!row.hidden&&row.style.display!=='none').map(row=>[...row.querySelectorAll('th,td')].map(cell=>cell.innerText));
    if(rows.length<2)return;
    const csv='\ufeff'+rows.map(row=>row.map(csvCell).join(',')).join('\r\n');
    const blob=new Blob([csv],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');
    a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  window.exportVisibleTable=()=>{
    const table=document.querySelector('#page table');
    if(!table){window.toast?.(window.ST_I18N?.t('Nothing to export','Nothing to export'),'error');return;}
    const state=window.ShineTimeApp?.getState()||{};
    const month=(location.hash.split('?')[0]==='#admin/finance'?state.financeMonth:state.settlementMonth)||new Date().toISOString().slice(0,7);
    exportTable(table,`shine-time-${location.hash.replace(/^#/,'').replace(/[^a-z0-9_-]+/gi,'-')||'report'}-${month}.csv`);
  };
  const labels={ru:'Экспорт CSV',sk:'Export CSV',uk:'Експорт CSV',en:'Export CSV'};
  const addButton=()=>{
    const page=document.getElementById('page');if(!page||page.querySelector('[data-export-table]'))return;
    const table=page.querySelector('table');if(!table)return;
    const head=page.querySelector('.section-head');if(!head)return;
    const button=document.createElement('button');button.dataset.exportTable='1';button.className='btn';button.type='button';button.textContent=labels[window.ST_I18N?.getLocale?.()||'en']||labels.en;button.onclick=window.exportVisibleTable;
    (head.querySelector('.input')?.parentElement||head).appendChild(button);
  };
  window.addEventListener('shine:rendered',addButton);
  setTimeout(addButton,0);
})();
