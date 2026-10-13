/* Finance statements: what each client owes and each cleaner is owed, per month, with a printable report.
   Uses existing admin-only APIs; the server includes only completed jobs approved by quality review. */
(()=>{
 const tr=(k)=>t(k,k);
 const cents=v=>money(Number(v||0)/100);
 const monthLabel=m=>{try{return new Intl.DateTimeFormat(intlLocale(),{month:'long',year:'numeric'}).format(new Date(m+'-15T12:00:00'))}catch{return m}};
 const lastMonths=(month,n)=>{const [y,m]=month.split('-').map(Number);return Array.from({length:n},(_,i)=>{const d=new Date(Date.UTC(y,m-1-i,15));return d.toISOString().slice(0,7)})};
 const monthlyGroups=(month,side)=>api(`/api/admin/settlements/monthly?month=${encodeURIComponent(month)}&side=${side}`);
 const monthlyJobs=(month,side,id)=>api(`/api/admin/settlements/monthly?month=${encodeURIComponent(month)}&side=${side}&partyId=${Number(id)}`);

 /* Statements is the second tab of Finance since fix 21. */
 const originalRenderAdmin=renderAdminPage;
 renderAdminPage=async function(page){if(page==='statements'&&window.ShineTimeUi.adminRouteAllowed('finance',state.me.role))return statementsScreen();return originalRenderAdmin(page)};

 async function statementsScreen(){
  const month=state.statementMonth||today().slice(0,7);
  shellTitle(tr('Monthly reconciliation','Monthly reconciliation'),tr('One monthly total per property, with client and cleaner payments separate.'));
  $('#page').innerHTML='<div class="card pad"><div class="empty">'+tr('Loading…')+'</div></div>';
  try{
   const data=await api('/api/admin/settlements/reconciliation?month='+encodeURIComponent(month));
   state.reconciliationData=data;
   renderReconciliation(data,month);
  }catch(e){
   $('#page').innerHTML='<div class="card pad"><div class="empty error-text">'+esc(e.message)+'</div></div>';
  }
 }

 const reconCents=v=>cents(Number(v||0));
 const reconMajor=v=>(Number(v||0)/100).toFixed(2);
 const reconDue=(due,paid)=>{
  const amount=Number(due||0);
  if(amount<=0)return '<span class="pill green">'+tr('Paid')+'</span>';
  if(Number(paid||0)>0)return '<span class="pill orange">'+tr('Partially paid')+' · '+reconCents(amount)+'</span>';
  return '<span class="pill gray">'+tr('Unpaid')+' · '+reconCents(amount)+'</span>';
 };
 const reconWeekday=date=>{
  try{return new Intl.DateTimeFormat(intlLocale(),{weekday:'short'}).format(new Date(String(date)+'T12:00:00'))}
  catch{return ''}
 };
 function renderReconciliation(data,month){
  const summary=data.summary||{};
  const objects=data.objects||[];
  const jobs=data.jobs||[];
  const expanded=state.reconciliationExpanded||(state.reconciliationExpanded=new Set());
  const objectRows=objects.map(o=>{
   const id=Number(o.objectId);
   const clientAction=Number(o.clientDueCents)>0
    ?'<button class="btn sm primary" '+(data.hasMore?'disabled':'')+' onclick="settleReconciliationObject('+id+',&quot;CLIENT&quot;)">'+tr('Mark client paid')+'</button>'
    :'<span class="pill green">'+tr('Paid')+'</span>';
   const cleanerAction=Number(o.cleanerDueCents)>0
    ?'<button class="btn sm primary" '+(data.hasMore?'disabled':'')+' onclick="settleReconciliationObject('+id+',&quot;CLEANER&quot;)">'+tr('Mark cleaners paid')+'</button>'
    :'<span class="pill green">'+tr('Paid')+'</span>';
   const clientSummary='<strong>'+reconCents(o.clientAmountCents)+'</strong><small>'+tr('Paid')+': '+reconCents(o.clientPaidCents)+' · '+tr('Due')+': '+reconCents(o.clientDueCents)+'</small><small class="subtle">'+esc(o.clientNames||'—')+'</small>';
   const cleanerSummary='<strong>'+reconCents(o.cleanerAmountCents)+'</strong><small>'+tr('Paid')+': '+reconCents(o.cleanerPaidCents)+' · '+tr('Due')+': '+reconCents(o.cleanerDueCents)+'</small><small class="subtle">'+esc(o.cleanerNames||tr('No cleaner assigned'))+'</small>';
   let row='<tr><td><strong>'+esc(o.objectCode||('#'+id))+'</strong><br><small>'+esc(o.objectName||'')+'</small></td>'+
    '<td>'+Number(o.jobsCount||0)+'</td><td class="recon-amount">'+clientSummary+'</td><td>'+clientAction+'</td>'+
    '<td class="recon-amount">'+cleanerSummary+'</td><td>'+cleanerAction+'</td>'+
    '<td><button class="btn sm" onclick="toggleReconciliationObject('+id+')">'+(expanded.has(id)?tr('Hide details'):tr('Details'))+'</button></td></tr>';
   if(expanded.has(id))row+='<tr class="recon-detail-row"><td colspan="7">'+reconciliationDetails(o,jobs,month,data.hasMore)+'</td></tr>';
   return row;
  }).join('');
  const expandedClientDue=Number(summary.clientDueCents||0),expandedCleanerDue=Number(summary.cleanerDueCents||0);
  const overLimit=data.hasMore?'<p class="notice-inline">'+tr('Totals cover the whole month, but only the first 5000 cleanings are loaded. Payment actions are disabled until the list is narrowed.')+'</p>':'';
  $('#page').innerHTML=
   '<div class="section-head"><div><h2>'+tr('Monthly reconciliation')+'</h2><p>'+tr('Correct cleanings first, then record client receipts and cleaner payouts separately.')+'</p></div>'+
   '<input class="input" style="width:170px" type="month" value="'+esc(month)+'" onchange="setStatementMonth(this.value)"></div>'+
   '<div class="grid finance-kpis recon-kpis">'+
    '<div class="card kpi"><div class="label">'+tr('Client total')+'</div><div class="value small-money">'+reconCents(summary.clientAmountCents)+'</div><div class="hint">'+tr('Paid')+' '+reconCents(summary.clientPaidCents)+' · '+tr('Due')+' <strong>'+reconCents(expandedClientDue)+'</strong></div></div>'+
    '<div class="card kpi"><div class="label">'+tr('Cleaner total')+'</div><div class="value small-money">'+reconCents(summary.cleanerAmountCents)+'</div><div class="hint">'+tr('Paid out')+' '+reconCents(summary.cleanerPaidCents)+' · '+tr('Due')+' <strong>'+reconCents(expandedCleanerDue)+'</strong></div></div>'+
   '</div>'+overLimit+
   '<div class="card recon-table-card"><div class="table-wrap"><table><thead><tr><th>'+tr('Object')+'</th><th>'+tr('Cleanings')+'</th><th>'+tr('Client · total / paid / due')+'</th><th></th><th>'+tr('Cleaner · total / paid / due')+'</th><th></th><th></th></tr></thead><tbody>'+
   (objectRows||'')+(objectRows?'':'<tr><td colspan="7"><div class="empty">'+tr('No completed cleanings in this month.')+'</div></td></tr>')+
   '</tbody></table></div></div>';
 }
 function reconciliationDetails(object,jobs,month,hasMore){
  const rows=jobs.filter(j=>Number(j.objectId)===Number(object.objectId)).map(j=>{
   const id=Number(j.id),editable=j.editable===true;
   const dateCell=editable
    ?'<input class="input recon-date-input" type="date" data-recon-date="'+id+'" value="'+esc(j.serviceDate)+'"><small class="subtle">'+esc(reconWeekday(j.serviceDate))+'</small>'
    :'<strong>'+esc(fmtDate(j.serviceDate))+'</strong><br><small class="subtle">'+esc(reconWeekday(j.serviceDate))+' · #'+id+'</small>';
   const clientCell=editable
    ?'<input class="input recon-money-input" type="text" inputmode="decimal" pattern="[0-9]+([.,][0-9]{1,2})?" data-recon-client="'+id+'" value="'+reconMajor(j.clientAmountCents)+'">'
    :'<strong>'+reconCents(j.clientAmountCents)+'</strong>';
   const cleanerCell=editable
    ?'<input class="input recon-money-input" type="text" inputmode="decimal" pattern="[0-9]+([.,][0-9]{1,2})?" data-recon-cleaner="'+id+'" value="'+reconMajor(j.cleanerAmountCents)+'">'
    :'<strong>'+reconCents(j.cleanerAmountCents)+'</strong>';
   const reason=editable?'<input class="input recon-reason-input" type="text" maxlength="500" data-recon-reason="'+id+'" placeholder="'+esc(tr('Reason for correction'))+'">':'<small class="subtle">'+tr('Locked after first payment')+'</small>';
   const save=editable?'<button class="btn sm primary" onclick="saveMonthlyCorrection('+id+','+Number(object.objectId)+')">'+tr('Save correction')+'</button>':'<span class="subtle">—</span>';
   return '<tr><td>'+dateCell+'</td><td><strong>'+esc(j.clientName||'—')+'</strong><br><small class="subtle">'+tr('Client')+' · '+reconDue(j.clientDueCents,j.clientPaidCents)+'</small></td><td>'+clientCell+'</td>'+
    '<td><strong>'+esc(j.cleanerName||tr('No cleaner assigned'))+'</strong><br><small class="subtle">'+tr('Cleaner')+' · '+reconDue(j.cleanerDueCents,j.cleanerPaidCents)+'</small></td><td>'+cleanerCell+'</td><td>'+reason+'</td><td>'+save+'</td></tr>';
  }).join('');
  return '<div class="recon-detail"><div class="section-head compact"><div><h3>'+esc(object.objectCode||'')+' · '+esc(object.objectName||'')+'</h3><p>'+tr('Change dates or total amounts here. Payment records are never overwritten.')+'</p></div>'+
   '<div class="row-actions"><button class="btn sm" '+(hasMore?'disabled':'')+' onclick="settleReconciliationObject('+Number(object.objectId)+',&quot;CLIENT&quot;)">'+tr('Mark client paid')+'</button><button class="btn sm" '+(hasMore?'disabled':'')+' onclick="settleReconciliationObject('+Number(object.objectId)+',&quot;CLEANER&quot;)">'+tr('Mark cleaners paid')+'</button></div></div>'+
   '<div class="table-wrap"><table class="recon-detail-table"><thead><tr><th>'+tr('Cleaning date')+'</th><th>'+tr('Client / status')+'</th><th>'+tr('Client total (€)')+'</th><th>'+tr('Cleaner / status')+'</th><th>'+tr('Cleaner total (€)')+'</th><th>'+tr('Correction reason')+'</th><th></th></tr></thead><tbody>'+
   (rows||'')+(rows?'':'<tr><td colspan="7"><div class="empty">'+tr('No cleanings to show here.')+'</div></td></tr>')+
   '</tbody></table></div><p class="subtle">'+tr('After a payment is recorded, use a refund or return entry to correct the financial history.')+'</p></div>';
 }
 window.toggleReconciliationObject=id=>{
  const expanded=state.reconciliationExpanded||(state.reconciliationExpanded=new Set());
  if(expanded.has(Number(id)))expanded.delete(Number(id));else expanded.add(Number(id));
  renderReconciliation(state.reconciliationData,state.statementMonth||today().slice(0,7));
 };
 window.settleReconciliationObject=async(objectId,side)=>{
  const data=state.reconciliationData,month=state.statementMonth||today().slice(0,7);
  if(!data)return;
  const dueKey=side==='CLIENT'?'clientDueCents':'cleanerDueCents';
  const partyKey=side==='CLIENT'?'clientId':'cleanerId';
  const rows=(data.jobs||[]).filter(j=>Number(j.objectId)===Number(objectId)&&Number(j[dueKey]||0)>0&&j[partyKey]!==null&&j[partyKey]!==undefined);
  const groups=new Map();
  rows.forEach(j=>{const partyId=Number(j[partyKey]);if(!groups.has(partyId))groups.set(partyId,[]);groups.get(partyId).push({jobId:Number(j.id),amountCents:Number(j[dueKey])})});
  if(!groups.size)return toast(tr('No outstanding payments for this side.'),'error');
  try{
   for(const [partyId,items] of groups){
    await api('/api/admin/settlements/batch',{method:'POST',body:{
     month,side,partyId,items,
     note:(side==='CLIENT'?'Monthly client payment ':'Monthly cleaner payout ')+month+' · '+String((data.objects||[]).find(o=>Number(o.objectId)===Number(objectId))?.objectCode||objectId),
     requestId:crypto.randomUUID()
    }});
   }
   toast(tr(side==='CLIENT'?'Client payment recorded.':'Cleaner payout recorded.'),'success');
   await statementsScreen();
  }catch(e){
   toast(e.message,'error');
   await statementsScreen();
  }
 };
 window.saveMonthlyCorrection=async(id,objectId)=>{
  const pick=selector=>document.querySelector('[data-recon-'+selector+'="'+id+'"]');
  const date=pick('date')?.value;
  const clientValue=String(pick('client')?.value??'').trim();
  const cleanerValue=String(pick('cleaner')?.value??'').trim();
  const reason=pick('reason')?.value?.trim();
  const validMoney=value=>/^\d+(?:[.,]\d{1,2})?$/.test(value);
  if(!date||!validMoney(clientValue)||!validMoney(cleanerValue)||!reason){
   return toast(tr('Enter the date, non-negative amounts and a correction reason.'),'error');
  }
  try{
   await api('/api/admin/settlements/jobs/'+Number(id)+'/correct',{method:'PATCH',body:{
    serviceDate:date,
    clientAmountCents:window.ShineTimeMoney.toMinorUnits(String(clientValue)),
    cleanerAmountCents:window.ShineTimeMoney.toMinorUnits(String(cleanerValue)),
    reason
   }});
   state.reconciliationExpanded?.add(Number(objectId));
   toast(tr('Correction saved.'),'success');
   await statementsScreen();
  }catch(e){toast(e.message,'error')}
 }
 window.setStatementSide=side=>{state.statementSide=side;render()};
 window.setStatementMonth=month=>{if(/^\d{4}-\d{2}$/.test(month)){state.statementMonth=month;render()}};

 async function statementData(id,month,side){
  const [jobs,parties,finance]=await Promise.all([monthlyJobs(month,side,id),side==='CLIENT'?api('/api/admin/clients'):api('/api/admin/cleaners'),side==='CLIENT'?api(`/api/admin/finance?month=${encodeURIComponent(month)}`).catch(()=>({entries:[]})):Promise.resolve({entries:[]})]);
  const party=(side==='CLIENT'?parties.clients:parties.cleaners).find(x=>Number(x.id)===Number(id))||{};
  const entries=(finance.entries||[]).filter(e=>Number(e.client_id)===Number(id));
  const list=jobs.jobs||[];
  const totals=list.reduce((a,j)=>({charged:a.charged+Number(j.chargedCents),paid:a.paid+Number(j.paidCents),due:a.due+Number(j.dueCents)}),{charged:0,paid:0,due:0});
  return {party,jobs:list,entries,totals,hasMore:jobs.hasMore};
 }
 window.openStatement=async id=>{
  const side=state.statementSide||'CLIENT',month=state.statementMonth||today().slice(0,7);
  modal(tr('Statement'),`<div class="empty">${tr('Loading…')}</div>`);
  try{
   const d=await statementData(id,month,side);state.statement={id,month,side,...d};
   const name=d.party.company_name||d.party.full_name||'#'+id;
   $('#modal-root .modal-body').innerHTML=`<div class="statement-head"><div><h3>${esc(name)}</h3><p class="subtle">${esc(monthLabel(month))} · ${tr(side==='CLIENT'?'Client statement':'Cleaner statement')}</p></div><div class="statement-due"><span>${tr('Outstanding')}</span><strong class="${d.totals.due>0?'profit-neg':'profit-pos'}">${cents(d.totals.due)}</strong></div></div>
   <div class="table-wrap"><table><thead><tr><th>${tr('Date')}</th><th>${tr('Property')}</th><th>#</th><th>${tr(side==='CLIENT'?'Charged':'Earned')}</th><th>${tr(side==='CLIENT'?'Received':'Paid out')}</th><th>${tr('Outstanding')}</th></tr></thead><tbody>${d.jobs.map(j=>`<tr><td>${fmtDate(j.service_date)}</td><td>${esc(j.object_name||'')}</td><td class="subtle">${Number(j.id)}</td><td>${cents(j.chargedCents)}</td><td>${cents(j.paidCents)}</td><td class="${j.dueCents>0?'profit-neg':''}">${cents(j.dueCents)}</td></tr>`).join('')||`<tr><td colspan="6"><div class="empty">${tr('No approved jobs in this month.')}</div></td></tr>`}</tbody><tfoot><tr><th colspan="3">${tr('Total')}</th><th>${cents(d.totals.charged)}</th><th>${cents(d.totals.paid)}</th><th>${cents(d.totals.due)}</th></tr></tfoot></table></div>
   ${d.entries.length?`<h4>${tr('Other entries')}</h4><div class="table-wrap"><table><tbody>${d.entries.map(e=>`<tr><td>${fmtDate(e.entry_date)}</td><td>${esc(tr(e.category||e.entry_type))}${e.description?` · ${esc(e.description)}`:''}</td><td>${e.entry_type==='INCOME'?'+':'−'}${money(e.amount)}</td></tr>`).join('')}</tbody></table></div><p class="subtle">${tr('Informational; not included in the outstanding amount.')}</p>`:''}`;
   $('#modal-root .modal').insertAdjacentHTML('beforeend',`<div class="modal-foot"><button class="btn" onclick="closeModal()">${tr('Close')}</button>${d.totals.due>0?`<button class="btn" onclick="closeModal();state.settlementMonth='${esc(month)}';navTo('admin/settlements');setTimeout(()=>monthlySettlementModal('${side}'),400)">${tr('Record payment')}</button>`:''}<button class="btn" onclick="exportStatementCsv()">CSV</button><button class="btn primary" onclick="printStatement()">🖨 ${tr('Print / PDF')}</button></div>`);
  }catch(e){$('#modal-root .modal-body').innerHTML=`<div class="empty error-text">${esc(e.message)}</div>`}
 };
 window.exportStatementCsv=()=>{
  const s=state.statement;if(!s)return;const q=v=>`"${String(v??'').replaceAll('"','""')}"`;
  const lines=[[tr('Date'),tr('Property'),'#',tr(s.side==='CLIENT'?'Charged':'Earned'),tr(s.side==='CLIENT'?'Received':'Paid out'),tr('Outstanding')].map(q).join(';')].concat(s.jobs.map(j=>[j.service_date,j.object_name,j.id,(j.chargedCents/100).toFixed(2),(j.paidCents/100).toFixed(2),(j.dueCents/100).toFixed(2)].map(q).join(';')));
  lines.push([tr('Total'),'','',(s.totals.charged/100).toFixed(2),(s.totals.paid/100).toFixed(2),(s.totals.due/100).toFixed(2)].map(q).join(';'));
  const a=document.createElement('a');a.href=URL.createObjectURL(new Blob(['﻿'+lines.join('\r\n')],{type:'text/csv;charset=utf-8'}));const who=(s.party.company_name||s.party.full_name||s.id).toString().replace(/[^\p{L}\p{N}]+/gu,'-');a.download=`statement-${who}-${s.month}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
 };
 window.printStatement=()=>{
  const s=state.statement;if(!s)return;const p=s.party;const company=state.settings?.companyName||'Shine Time';
  const billing=[p.billing_name||p.company_name||p.full_name,p.billing_address,p.ico?`IČO ${p.ico}`:'',p.dic?`DIČ ${p.dic}`:'',p.ic_dph?`IČ DPH ${p.ic_dph}`:'',p.email,p.phone].filter(Boolean);
  const html=`<!doctype html><html lang="${esc(ST_I18N.getLocale())}"><head><meta charset="utf-8"><title>${esc(tr(s.side==='CLIENT'?'Client statement':'Cleaner statement'))} ${esc(s.month)}</title><style>body{font:13px/1.45 system-ui,-apple-system,Segoe UI,sans-serif;color:#111827;margin:32px}h1{font-size:20px;margin:0}header{display:flex;justify-content:space-between;gap:24px;border-bottom:2px solid #123c32;padding-bottom:14px;margin-bottom:18px}.muted{color:#5b6472}table{width:100%;border-collapse:collapse;margin-top:12px}th,td{padding:7px 8px;border-bottom:1px solid #e3e7ec;text-align:left}th{font-size:11px;text-transform:uppercase;color:#5b6472}td.n,th.n{text-align:right}tfoot td{font-weight:700;border-top:2px solid #111827}.due{font-size:18px;font-weight:800}footer{margin-top:28px;font-size:11px;color:#5b6472}@media print{body{margin:14mm}}</style></head><body>
  <header><div><h1>${esc(company)}</h1><div class="muted">${esc(tr(s.side==='CLIENT'?'Client statement':'Cleaner statement'))} · ${esc(monthLabel(s.month))}</div></div><div>${billing.map(x=>`<div>${esc(x)}</div>`).join('')}</div></header>
  <table><thead><tr><th>${esc(tr('Date'))}</th><th>${esc(tr('Property'))}</th><th>#</th><th class="n">${esc(tr(s.side==='CLIENT'?'Charged':'Earned'))}</th><th class="n">${esc(tr(s.side==='CLIENT'?'Received':'Paid out'))}</th><th class="n">${esc(tr('Outstanding'))}</th></tr></thead><tbody>${s.jobs.map(j=>`<tr><td>${esc(fmtDate(j.service_date))}</td><td>${esc(j.object_name||'')}</td><td>${Number(j.id)}</td><td class="n">${esc(cents(j.chargedCents))}</td><td class="n">${esc(cents(j.paidCents))}</td><td class="n">${esc(cents(j.dueCents))}</td></tr>`).join('')}</tbody><tfoot><tr><td colspan="3">${esc(tr('Total'))}</td><td class="n">${esc(cents(s.totals.charged))}</td><td class="n">${esc(cents(s.totals.paid))}</td><td class="n">${esc(cents(s.totals.due))}</td></tr></tfoot></table>
  <p class="due">${esc(tr(s.side==='CLIENT'?'Amount due':'Amount to be paid'))}: ${esc(cents(s.totals.due))}</p>
  <footer>${esc(tr('Only completed cleanings approved by quality review are included.'))} ${esc(tr('Generated'))} ${esc(new Intl.DateTimeFormat(intlLocale(),{dateStyle:'medium',timeStyle:'short'}).format(new Date()))}</footer></body></html>`;
  const w=window.open('','_blank');
  if(!w){toast(tr('Allow pop-ups to print the report'),'error');return}
  w.document.open();w.document.write(html);w.document.close();w.focus();setTimeout(()=>w.print(),300);
 };
 ST_I18N.addTranslations({
  ru:{'Statements':'Выписки','Who owes what, for which cleanings, and monthly reports':'Кто сколько должен, за какие уборки, и отчёты за месяц','What each client owes you, job by job.':'Сколько должен каждый клиент — по каждой уборке.','What you owe each cleaner, job by job.':'Сколько вы должны каждому клинеру — по каждой уборке.','Clients':'Клиенты','Cleaners':'Клинеры','Charged':'Начислено','Earned':'Заработано','Received':'Получено','Paid out':'Выплачено','Outstanding this month':'Долг за месяц','To pay this month':'К выплате за месяц','Outstanding, last 12 months':'Долг за 12 месяцев','To pay, last 12 months':'К выплате за 12 месяцев','Outstanding':'Долг','12 months':'12 месяцев','Statement':'Выписка','No approved jobs this month':'В этом месяце нет принятых уборок','No approved jobs in this month.':'В этом месяце нет принятых уборок.','Only completed cleanings approved by quality review are billed. Payments are recorded in Payments & payouts.':'В счёт входят только завершённые уборки, принятые после проверки. Оплаты записываются в разделе «Оплаты и выплаты».','Client statement':'Выписка клиента','Cleaner statement':'Выписка клинера','Date':'Дата','Property':'Объект','Total':'Итого','Other entries':'Прочие записи','Informational; not included in the outstanding amount.':'Для справки; в сумму долга не входит.','Record payment':'Записать оплату','Print / PDF':'Печать / PDF','Amount due':'К оплате','Amount to be paid':'К выплате','Only completed cleanings approved by quality review are included.':'Включены только завершённые уборки, принятые после проверки качества.','Generated':'Сформировано','Allow pop-ups to print the report':'Разрешите всплывающие окна, чтобы распечатать отчёт','Client':'Клиент','Cleaner':'Клинер','Jobs':'Уборки','Archive':'В архив','Activate':'Активировать','Deactivate':'Деактивировать','Delete property':'Удалить объект','Archive property':'Архивировать объект','Archived properties cannot be booked and do not appear in new jobs. History and finance stay intact.':'Архивный объект нельзя забронировать, он не попадёт в новые уборки. История и финансы сохранятся.','Property activated':'Объект активирован','Property archived':'Объект в архиве','The property, its photos and checklist will be deleted permanently. Properties with cleaning history cannot be deleted — archive them instead.':'Объект, его фото и чек-лист будут удалены навсегда. Объект с историей уборок удалить нельзя — отправьте его в архив.','Property deleted':'Объект удалён','This property has cleaning history. Archive it instead.':'У объекта есть история уборок. Отправьте его в архив.','Deactivate client':'Деактивировать клиента','The client can no longer sign in or book. Properties, bookings and finance history stay intact.':'Клиент не сможет войти и бронировать. Объекты, брони и финансы сохранятся.','Deactivate cleaner':'Деактивировать клинера','The cleaner can no longer sign in or take jobs. Completed work and payouts stay intact. Reassign their upcoming jobs.':'Клинер не сможет войти и брать уборки. Выполненные работы и выплаты сохранятся. Переназначьте его будущие уборки.','Account activated':'Аккаунт активирован','Account deactivated':'Аккаунт деактивирован','Delete photo':'Удалить фото','Tap again to delete':'Нажмите ещё раз для удаления','Photo deleted':'Фото удалено'},
  uk:{'Statements':'Виписки','Who owes what, for which cleanings, and monthly reports':'Хто скільки винен, за які прибирання, і звіти за місяць','What each client owes you, job by job.':'Скільки винен кожен клієнт — за кожним прибиранням.','What you owe each cleaner, job by job.':'Скільки ви винні кожному клінеру — за кожним прибиранням.','Clients':'Клієнти','Cleaners':'Клінери','Charged':'Нараховано','Earned':'Зароблено','Received':'Отримано','Paid out':'Виплачено','Outstanding this month':'Борг за місяць','To pay this month':'До виплати за місяць','Outstanding, last 12 months':'Борг за 12 місяців','To pay, last 12 months':'До виплати за 12 місяців','Outstanding':'Борг','12 months':'12 місяців','Statement':'Виписка','No approved jobs this month':'Цього місяця немає прийнятих прибирань','No approved jobs in this month.':'Цього місяця немає прийнятих прибирань.','Only completed cleanings approved by quality review are billed. Payments are recorded in Payments & payouts.':'До рахунку входять лише завершені прибирання, прийняті після перевірки. Оплати записуються в розділі «Оплати та виплати».','Client statement':'Виписка клієнта','Cleaner statement':'Виписка клінера','Date':'Дата','Property':'Об’єкт','Total':'Разом','Other entries':'Інші записи','Informational; not included in the outstanding amount.':'Для довідки; до суми боргу не входить.','Record payment':'Записати оплату','Print / PDF':'Друк / PDF','Amount due':'До сплати','Amount to be paid':'До виплати','Only completed cleanings approved by quality review are included.':'Включено лише завершені прибирання, прийняті після перевірки якості.','Generated':'Сформовано','Allow pop-ups to print the report':'Дозвольте спливаючі вікна, щоб надрукувати звіт','Client':'Клієнт','Cleaner':'Клінер','Jobs':'Прибирання','Archive':'В архів','Activate':'Активувати','Deactivate':'Деактивувати','Delete property':'Видалити об’єкт','Archive property':'Архівувати об’єкт','Archived properties cannot be booked and do not appear in new jobs. History and finance stay intact.':'Архівний об’єкт не можна забронювати, він не потрапить у нові прибирання. Історія та фінанси збережуться.','Property activated':'Об’єкт активовано','Property archived':'Об’єкт в архіві','The property, its photos and checklist will be deleted permanently. Properties with cleaning history cannot be deleted — archive them instead.':'Об’єкт, його фото та чек-лист буде видалено назавжди. Об’єкт з історією прибирань видалити не можна — надішліть його в архів.','Property deleted':'Об’єкт видалено','This property has cleaning history. Archive it instead.':'Об’єкт має історію прибирань. Надішліть його в архів.','Deactivate client':'Деактивувати клієнта','The client can no longer sign in or book. Properties, bookings and finance history stay intact.':'Клієнт не зможе увійти та бронювати. Об’єкти, бронювання та фінанси збережуться.','Deactivate cleaner':'Деактивувати клінера','The cleaner can no longer sign in or take jobs. Completed work and payouts stay intact. Reassign their upcoming jobs.':'Клінер не зможе увійти та брати прибирання. Виконані роботи й виплати збережуться. Перепризначте його майбутні прибирання.','Account activated':'Акаунт активовано','Account deactivated':'Акаунт деактивовано','Delete photo':'Видалити фото','Tap again to delete':'Натисніть ще раз для видалення','Photo deleted':'Фото видалено'},
  sk:{'Statements':'Výpisy','Who owes what, for which cleanings, and monthly reports':'Kto koľko dlhuje, za ktoré upratovania, a mesačné reporty','What each client owes you, job by job.':'Koľko vám dlhuje každý klient — po upratovaniach.','What you owe each cleaner, job by job.':'Koľko dlhujete každému upratovačovi — po upratovaniach.','Clients':'Klienti','Cleaners':'Upratovači','Charged':'Vyúčtované','Earned':'Zarobené','Received':'Prijaté','Paid out':'Vyplatené','Outstanding this month':'Dlh za mesiac','To pay this month':'Na výplatu za mesiac','Outstanding, last 12 months':'Dlh za 12 mesiacov','To pay, last 12 months':'Na výplatu za 12 mesiacov','Outstanding':'Dlh','12 months':'12 mesiacov','Statement':'Výpis','No approved jobs this month':'Tento mesiac žiadne schválené upratovania','No approved jobs in this month.':'V tomto mesiaci nie sú schválené upratovania.','Only completed cleanings approved by quality review are billed. Payments are recorded in Payments & payouts.':'Fakturujú sa len dokončené upratovania schválené kontrolou kvality. Platby sa zaznamenávajú v časti Platby a výplaty.','Client statement':'Výpis klienta','Cleaner statement':'Výpis upratovača','Date':'Dátum','Property':'Objekt','Total':'Spolu','Other entries':'Ostatné záznamy','Informational; not included in the outstanding amount.':'Informatívne; nie je súčasťou dlhu.','Record payment':'Zaznamenať platbu','Print / PDF':'Tlač / PDF','Amount due':'Na úhradu','Amount to be paid':'Na výplatu','Only completed cleanings approved by quality review are included.':'Zahrnuté sú len dokončené upratovania schválené kontrolou kvality.','Generated':'Vygenerované','Allow pop-ups to print the report':'Povoľte vyskakovacie okná na tlač reportu','Client':'Klient','Cleaner':'Upratovač','Jobs':'Upratovania','Archive':'Archivovať','Activate':'Aktivovať','Deactivate':'Deaktivovať','Delete property':'Odstrániť objekt','Archive property':'Archivovať objekt','Archived properties cannot be booked and do not appear in new jobs. History and finance stay intact.':'Archivovaný objekt sa nedá rezervovať a nebude v nových upratovaniach. História a financie zostanú.','Property activated':'Objekt aktivovaný','Property archived':'Objekt archivovaný','The property, its photos and checklist will be deleted permanently. Properties with cleaning history cannot be deleted — archive them instead.':'Objekt, jeho fotky a kontrolný zoznam budú natrvalo odstránené. Objekt s históriou upratovaní sa nedá odstrániť — archivujte ho.','Property deleted':'Objekt odstránený','This property has cleaning history. Archive it instead.':'Objekt má históriu upratovaní. Archivujte ho.','Deactivate client':'Deaktivovať klienta','The client can no longer sign in or book. Properties, bookings and finance history stay intact.':'Klient sa nebude môcť prihlásiť ani rezervovať. Objekty, rezervácie a financie zostanú.','Deactivate cleaner':'Deaktivovať upratovača','The cleaner can no longer sign in or take jobs. Completed work and payouts stay intact. Reassign their upcoming jobs.':'Upratovač sa nebude môcť prihlásiť ani brať upratovania. Vykonaná práca a výplaty zostanú. Preraďte jeho budúce upratovania.','Account activated':'Účet aktivovaný','Account deactivated':'Účet deaktivovaný','Delete photo':'Odstrániť fotku','Tap again to delete':'Ťuknite znova na odstránenie','Photo deleted':'Fotka odstránená'}
 });
})();
