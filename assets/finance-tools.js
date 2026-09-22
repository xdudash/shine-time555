/* Additive finance tools: exact money math, settlement preview, margin and payment status helpers. */
(()=>{
 const money=window.ShineTimeMoney?.toMinorUnits;
 const fmt=v=>new Intl.NumberFormat(window.ST_I18N?.getLocale?.()||'en',{style:'currency',currency:'EUR',minimumFractionDigits:2}).format(Number(v||0));
 const minor=v=>{if(typeof money==='function')return money(String(v));const n=Number(String(v).replace(',','.'));if(!Number.isFinite(n)||n<=0)return 0;return Math.round(n*100)};
 const percent=(a,b)=>b?Math.round((a/b)*10000)/100:0;
 const settlement=({gross=0,cleaner=0,fees=0,adjustments=0,tax=0}={})=>{
   const g=minor(gross),c=minor(cleaner),f=minor(fees),a=Math.round(Number(adjustments||0)*100),tx=Math.round(Number(tax||0)*100);
   const net=g-c-f+a-tx;return {grossMinor:g,cleanerMinor:c,feesMinor:f,adjustmentsMinor:a,taxMinor:tx,netMinor:net,marginPercent:percent(net,g),gross:fmt(g/100),cleaner:fmt(c/100),net:fmt(net/100)};
 };
 const paymentStatus=(due,paid)=>{const d=minor(due),p=minor(paid);if(p<=0)return'UNPAID';if(p<d)return'PARTIAL';return p===d?'PAID':'OVERPAID'};
 const buildPreview=(data={})=>{const x=settlement(data);return `<div class="finance-preview"><div class="kpi-grid"><div class="kpi"><span>Gross</span><strong>${x.gross}</strong></div><div class="kpi"><span>Cleaner</span><strong>${x.cleaner}</strong></div><div class="kpi"><span>Net</span><strong>${x.net}</strong></div><div class="kpi"><span>Margin</span><strong>${x.marginPercent}%</strong></div></div></div>`};
 window.ShineTimeFinance={minor,settlement,paymentStatus,buildPreview,format:fmt};
 function enhance(){document.querySelectorAll('#page [data-finance-preview]').forEach(el=>{if(el.dataset.ready)return;el.dataset.ready='1';try{el.innerHTML=buildPreview(JSON.parse(el.dataset.financePreview||'{}'))}catch{}})}
 new MutationObserver(enhance).observe(document.body,{childList:true,subtree:true});setTimeout(enhance,100);
})();
