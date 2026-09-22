/* Additive SVG charts: no external dependency, safe for the existing operations UI. */
(()=>{
 const n=v=>Number.isFinite(Number(v))?Number(v):0;
 const esc=v=>String(v??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[c]||c));
 const spark=(values=[],width=420,height=120)=>{const a=values.map(n);if(!a.length)return'';const max=Math.max(...a,1),min=Math.min(...a,0),range=max-min||1,step=a.length===1?width:a.length>1?width/(a.length-1):width;const pts=a.map((v,i)=>`${Math.round(i*step)},${Math.round(height-((v-min)/range)*height)}`).join(' ');return`<svg viewBox="0 0 ${width} ${height}" width="100%" role="img" aria-label="Trend"><polyline fill="none" stroke="currentColor" stroke-width="3" points="${pts}"/></svg>`};
 const bars=(items=[],width=420,height=160)=>{const a=items.map(x=>({label:String(x.label??''),value:n(x.value)}));if(!a.length)return'';const max=Math.max(...a.map(x=>x.value),1),gap=8,bw=Math.max(8,(width-gap*(a.length-1))/a.length);return`<svg viewBox="0 0 ${width} ${height}" width="100%" role="img" aria-label="Bar chart">${a.map((x,i)=>{const h=(x.value/max)*(height-28),y=height-h-20;return`<g><rect x="${i*(bw+gap)}" y="${y}" width="${bw}" height="${h}" rx="4"/><text x="${i*(bw+gap)+bw/2}" y="${height-4}" text-anchor="middle" font-size="10">${esc(x.label.slice(0,8))}</text></g>`}).join('')}</svg>`};
 const install=()=>document.querySelectorAll('[data-st-spark]').forEach(el=>{if(el.dataset.ready)return;try{el.innerHTML=spark(JSON.parse(el.dataset.stSpark||'[]'));el.dataset.ready='1'}catch{}});
 window.ShineTimeCharts={spark,bars,install};new MutationObserver(install).observe(document.body,{childList:true,subtree:true});setTimeout(install,100);
})();
