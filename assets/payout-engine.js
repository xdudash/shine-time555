/* Additive payout engine: gross/net calculations, thresholds, adjustments and payout batches. */
(()=>{
 const cents=v=>{const s=String(v??'0').trim().replace(',','.');if(!/^\-?\d+(?:\.\d{1,2})?$/.test(s))return 0;return Math.round(Number(s)*100)};
 const money=v=>Math.round(Number(v||0));
 const calculate=(x={})=>{const gross=cents(x.gross),bonus=cents(x.bonus),deductions=cents(x.deductions),tax=cents(x.tax),fees=cents(x.fees);const net=gross+bonus-deductions-tax-fees;return{grossMinor:gross,bonusMinor:bonus,deductionsMinor:deductions,taxMinor:tax,feesMinor:fees,netMinor:net,payoutMinor:Math.max(0,net)}};
 const batch=(items=[])=>{const rows=items.map(x=>({id:x.id||x.cleanerId||x.cleaner_id,cleanerId:x.cleanerId||x.cleaner_id,amount:calculate(x).payoutMinor,status:x.status||'READY'}));return{count:rows.length,totalMinor:rows.reduce((s,x)=>s+x.amount,0),ready:rows.filter(x=>x.status==='READY'),rows}};
 const threshold=(amount,minimum=0)=>{const a=money(amount),m=Math.max(0,money(minimum));return{amountMinor:a,minimumMinor:m,eligible:a>=m,remainingMinor:Math.max(0,m-a)}};
 const reconcile=(expected=0,actual=0,tolerance=1)=>{const e=money(expected),a=money(actual),delta=a-e;return{expectedMinor:e,actualMinor:a,deltaMinor:delta,reconciled:Math.abs(delta)<=money(tolerance)}};
 const status=(amount,paid=0)=>{const a=money(amount),p=money(paid);return p<=0?'PENDING':p<a?'PARTIAL':p===a?'PAID':'OVERPAID'};
 window.ShineTimePayouts={cents,calculate,batch,threshold,reconcile,status};
})();
