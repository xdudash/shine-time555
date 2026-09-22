/* Additive schedule tools: time-slot generation, conflict detection and shift utilities. */
(()=>{
 const pad=n=>String(n).padStart(2,'0');
 const parse=v=>{const m=String(v||'').match(/^(\d{1,2}):(\d{2})$/);if(!m)return null;const h=Number(m[1]),min=Number(m[2]);return h<24&&min<60?h*60+min:null};
 const clock=n=>`${pad(Math.floor(n/60)%24)}:${pad(n%60)}`;
 const slots=({start='08:00',end='18:00',duration=120,breakMinutes=15}={})=>{let a=parse(start),b=parse(end),d=Number(duration),br=Number(breakMinutes);if(a===null||b===null||d<1||br<0||b<=a)return[];const out=[];while(a+d<=b){out.push({start:clock(a),end:clock(a+d),minutes:d});a+=d+br}return out};
 const overlap=(a,b)=>Math.max(parse(a.start)||0,parse(b.start)||0)<Math.min(parse(a.end)||0,parse(b.end)||0);
 const conflicts=list=>{const out=[];for(let i=0;i<list.length;i++)for(let j=i+1;j<list.length;j++)if(list[i].date===list[j].date&&overlap(list[i],list[j]))out.push([i,j]);return out};
 const shiftMinutes=(start,end)=>{const a=parse(start),b=parse(end);if(a===null||b===null)return 0;return b>=a?b-a:1440-a+b};
 const weeklyHours=shifts=>Math.round(shifts.reduce((s,x)=>s+shiftMinutes(x.start,x.end),0)/60*100)/100;
 const nextWeekday=(date,days)=>{const d=new Date(`${date}T12:00:00`);if(Number.isNaN(d.getTime()))return null;const wanted=Number(days);const delta=(wanted-d.getDay()+7)%7;d.setDate(d.getDate()+(delta||7));return new Intl.DateTimeFormat('en-CA').format(d)};
 window.ShineTimeSchedule={parse,clock,slots,conflicts,shiftMinutes,weeklyHours,nextWeekday};
})();
