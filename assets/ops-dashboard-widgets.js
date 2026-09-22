/* Additive dashboard widgets: local trend calculations, utilization and risk summaries. */
(()=>{
 const num=v=>Number.isFinite(Number(v))?Number(v):0;
 const pct=(a,b)=>b?Math.round((num(a)/num(b))*1000)/10:0;
 const summarize=(rows=[])=>{const total=rows.length,completed=rows.filter(x=>['DONE','COMPLETED'].includes(String(x.status||'').toUpperCase())).length,open=rows.filter(x=>!['DONE','COMPLETED','CANCELLED'].includes(String(x.status||'').toUpperCase())).length,risk=rows.filter(x=>['OVERDUE','AT_RISK','LATE','RESCUE'].includes(String(x.status||'').toUpperCase())||x.risk===true).length;return{total,completed,open,risk,completionPercent:pct(completed,total),riskPercent:pct(risk,total)}};
 const trend=(values=[],windowSize=7)=>{const a=values.map(num);if(!a.length)return{values:[],average:0,delta:0,direction:'flat'};const recent=a.slice(-windowSize),previous=a.slice(-(windowSize*2),-windowSize);const average=recent.reduce((s,v)=>s+v,0)/recent.length;const old=previous.length?previous.reduce((s,v)=>s+v,0)/previous.length:average;const delta=Math.round((average-old)*100)/100;return{values:a,average:Math.round(average*100)/100,delta,direction:delta>0?'up':delta<0?'down':'flat'}};
 const utilization=(used,capacity)=>{const u=num(used),c=num(capacity);return{used:u,capacity:c,percent:pct(u,c),remaining:Math.max(0,c-u),state:c<=0?'unknown':u>c?'over':u/c>=.85?'tight':'healthy'}};
 const riskScore=({overdue=0,openIssues=0,unassigned=0,capacityPressure=0}={})=>Math.min(100,Math.round(num(overdue)*25+num(openIssues)*10+num(unassigned)*15+num(capacityPressure)*50));
 const card=(title,value,meta='')=>`<div class="kpi"><span>${title}</span><strong>${value}</strong>${meta?`<small class="subtle">${meta}</small>`:''}</div>`;
 const render=(container,data={})=>{if(!container)return;const s=summarize(data.jobs||[]),u=utilization(data.used,data.capacity),r=riskScore(data);container.innerHTML=`<div class="kpi-grid">${card('Completion',`${s.completionPercent}%`,`${s.completed}/${s.total}`)}${card('Open',s.open)}${card('Risk',`${s.risk}`,`${s.riskPercent}%`)}${card('Utilization',`${u.percent}%`,u.state)}${card('Risk score',r+'/100')}</div>`};
 window.ShineTimeWidgets={summarize,trend,utilization,riskScore,render};
})();
