/* Additive table tools: instant search, sorting, row copy and keyboard navigation. */
(()=>{
 const text=v=>String(v??'').replace(/\s+/g,' ').trim();
 const numeric=value=>{
   let raw=text(value).replace(/[€$£]/g,'').replace(/\s*(?:EUR|%)$/,'').replace(/\s/g,'');
   if(!/^[+-]?\d[\d.,]*$/.test(raw))return NaN;
   const decimal=raw.lastIndexOf(',')>raw.lastIndexOf('.')?',':'.';
   const parts=raw.split(decimal);
   if(parts.length===2&&parts[1].length<=2)raw=parts[0].replace(/[.,]/g,'')+'.'+parts[1];
   else raw=raw.replace(/[.,]/g,'');
   return Number(raw);
 };
 const sort=(table,index,dir=1)=>{const body=table.tBodies[0];if(!body)return;const rows=[...body.rows];rows.sort((a,b)=>{const av=text(a.cells[index]?.innerText),bv=text(b.cells[index]?.innerText);const an=numeric(av),bn=numeric(bv);if(Number.isFinite(an)&&Number.isFinite(bn))return(an-bn)*dir;return av.localeCompare(bv,undefined,{numeric:true,sensitivity:'base'})*dir});rows.forEach(r=>body.appendChild(r));table.dataset.sortColumn=index;table.dataset.sortDir=dir};
 const search=(table,q)=>{const needle=text(q).toLowerCase();[...table.tBodies[0]?.rows||[]].forEach(row=>{row.hidden=needle&&!text(row.innerText).toLowerCase().includes(needle)})};
 const copyRow=row=>{const value=[...row.cells].map(c=>text(c.innerText)).join('\t');navigator.clipboard?.writeText(value).then(()=>window.toast?.(window.ST_I18N?.t('Row copied','Row copied'),'success')).catch(()=>{})};
 const install=table=>{if(!table||table.dataset.tableTools==='1')return;table.dataset.tableTools='1';const heads=[...table.querySelectorAll('thead th')];heads.forEach((th,i)=>{if(th.dataset.noSort==='1')return;th.style.cursor='pointer';th.title=window.ST_I18N?.t('Sort','Sort')||'Sort';th.addEventListener('click',()=>{const current=Number(table.dataset.sortColumn);const dir=current===i&&Number(table.dataset.sortDir)===1?-1:1;sort(table,i,dir)})});[...table.tBodies[0]?.rows||[]].forEach(row=>{row.addEventListener('dblclick',()=>copyRow(row));row.title=(window.ST_I18N?.t('Double-click to copy row','Double-click to copy row')||'Double-click to copy row')});};
 const installAll=()=>document.querySelectorAll('#page table').forEach(install);
 window.ShineTimeTables={install,installAll,sort,search,copyRow};
 window.addEventListener('shine:rendered',installAll);setTimeout(installAll,120);
})();
