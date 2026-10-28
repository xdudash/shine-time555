export async function operationsRoute({ctx,route,method,query,body,service,result,ApiError,today}) {
  const role=ctx.appUser.role;
  const admin=()=>{if(!['ADMIN','OPERATIONS_MANAGER'].includes(role))throw new ApiError('Forbidden',403);};
  if(/^(admin|client|cleaner)\/settlements$/.test(route)&&method==='GET') {
    const month=String(query.month||today().slice(0,7));
    if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))throw new ApiError('Invalid month');
    const before=query.before?Number(query.before):null;
    if(before!==null&&(!Number.isSafeInteger(before)||before<=0))throw new ApiError('Invalid cursor');
    return result(service.rpc('st_settlement_report',{p_actor_id:ctx.appUser.id,p_month:month,p_before:before,p_limit:100}));
  }
  if(route==='admin/settlements/reconciliation' && method==='GET') {
    if(!['ADMIN','OPERATIONS_MANAGER','PROPERTY_MANAGER'].includes(role))throw new ApiError('Forbidden',403);
    const month=String(query.month||today().slice(0,7));
    if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))throw new ApiError('Invalid period');
    return result(service.rpc('st_monthly_reconciliation',{p_actor_id:ctx.appUser.id,p_month:month}));
  }
  const correction=route.match(/^admin\/settlements\/jobs\/(\d+)\/correct$/);
  if(correction && method==='PATCH') {
    if(role!=='ADMIN')throw new ApiError('Forbidden',403);
    const serviceDate=String(body.serviceDate||'');
    if(!/^\d{4}-\d{2}-\d{2}$/.test(serviceDate))throw new ApiError('Enter a valid service date');
    for(const key of ['clientAmountCents','cleanerAmountCents']) {
      if(!Number.isSafeInteger(body[key])||body[key]<0||body[key]>100000000)throw new ApiError('Amounts must be whole cents between 0 and 100000000');
    }
    if(!String(body.reason||'').trim()||String(body.reason).trim().length>500)throw new ApiError('A correction reason (up to 500 characters) is required');
    return {job:await result(service.rpc('st_correct_completed_job_finance',{
      p_actor_id:ctx.appUser.id,p_job_id:Number(correction[1]),
      p_body:{serviceDate,clientAmountCents:body.clientAmountCents,cleanerAmountCents:body.cleanerAmountCents,reason:String(body.reason).trim()}
    }).single())};
  }
  if(route==='admin/settlements/monthly' && method==='GET') {
    if(!['ADMIN','OPERATIONS_MANAGER','PROPERTY_MANAGER'].includes(role))throw new ApiError('Forbidden',403);
    return result(service.rpc('st_monthly_settlements',{p_actor_id:ctx.appUser.id,p_month:String(query.month||today().slice(0,7)),p_side:String(query.side||'CLIENT'),p_party_id:query.partyId?Number(query.partyId):null}));
  }
  if(route==='admin/settlements/batch' && method==='POST') {
    if(!['ADMIN','OPERATIONS_MANAGER','PROPERTY_MANAGER'].includes(role))throw new ApiError('Forbidden',403);
    return result(service.rpc('st_settle_batch',{p_actor_id:ctx.appUser.id,p_month:body.month,p_side:body.side,p_party_id:Number(body.partyId),p_items:body.items,p_note:String(body.note||''),p_request_id:String(body.requestId||'')}));
  }
  if(route==='admin/finance'&&method==='GET') {
    const month=String(query.month||today().slice(0,7)),before=query.before?Number(query.before):null;
    if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)||before!==null&&(!Number.isSafeInteger(before)||before<=0))throw new ApiError('Invalid report period or cursor');
    return result(service.rpc('st_finance_report',{p_actor_id:ctx.appUser.id,p_month:month,p_before:before}));
  }
  if(route==='admin/settlements'&&method==='POST') {
    if(role!=='ADMIN')throw new ApiError('Forbidden',403);
    if(!Number.isSafeInteger(body.amountCents)||body.amountCents<=0)throw new ApiError('Amount must be positive whole cents');
    return {entry:await result(service.rpc('st_record_settlement',{p_actor_id:ctx.appUser.id,p_job_id:Number(body.jobId),p_kind:body.kind,p_amount_cents:body.amountCents,p_note:String(body.note||''),p_request_id:String(body.requestId||crypto.randomUUID())}).single())};
  }
  if(route==='admin/settlements/manual'&&method==='POST') {
    if(!['ADMIN','OPERATIONS_MANAGER','PROPERTY_MANAGER'].includes(role))throw new ApiError('Forbidden',403);
    return result(service.rpc('st_record_manual_monthly_payment',{p_actor_id:ctx.appUser.id,p_month:String(body.month||''),p_side:String(body.side||''),p_party_id:Number(body.partyId),p_amount_cents:Number(body.amountCents),p_note:String(body.note||''),p_request_id:String(body.requestId||'')}));
  }
  const jobPayments=route.match(/^admin\/finance\/jobs\/(\d+)\/payments$/);
  if(jobPayments&&method==='GET') {
    if(role!=='ADMIN')throw new ApiError('Forbidden',403);
    const jobId=Number(jobPayments[1]);
    const rows=await result(service.from('st_settlements').select('id,kind,amount_cents,note,created_at,reverses_settlement_id').eq('job_id',jobId).order('id'));
    const events=await result(service.from('st_job_events').select('event_type').eq('job_id',jobId).eq('event_type','MANUAL_ENTRY').limit(1));
    const job=await result(service.from('st_jobs').select('id,status').eq('id',jobId).single());
    const reversedBy=new Map(rows.filter(r=>r.reverses_settlement_id).map(r=>[Number(r.reverses_settlement_id),Number(r.id)]));
    const net=(plus,minus)=>rows.reduce((a,r)=>a+(r.kind===plus?Number(r.amount_cents):r.kind===minus?-Number(r.amount_cents):0),0);
    return {
      job:{id:jobId,status:job.status,manual:events.length>0,clientNetCents:net('CLIENT_PAYMENT','CLIENT_REFUND'),cleanerNetCents:net('CLEANER_PAYOUT','CLEANER_RETURN')},
      payments:rows.map(r=>({id:Number(r.id),kind:r.kind,amountCents:Number(r.amount_cents),note:r.note,createdAt:r.created_at,reversesId:r.reverses_settlement_id?Number(r.reverses_settlement_id):null,reversedBy:reversedBy.get(Number(r.id))||null}))
    };
  }
  const settlementAction=route.match(/^admin\/settlements\/(\d+)\/(reverse|correct)$/);
  if(settlementAction&&method==='POST') {
    if(role!=='ADMIN')throw new ApiError('Forbidden',403);
    const id=Number(settlementAction[1]);
    const reason=String(body.reason||'').trim();
    if(!reason||reason.length>300)throw new ApiError('A reason (up to 300 characters) is required');
    if(settlementAction[2]==='reverse') {
      return {entry:await result(service.rpc('st_reverse_settlement',{p_actor_id:ctx.appUser.id,p_settlement_id:id,p_reason:reason}).single())};
    }
    if(!Number.isSafeInteger(body.amountCents)||body.amountCents<=0||body.amountCents>100000000)throw new ApiError('Amount must be positive whole cents');
    return {entry:await result(service.rpc('st_correct_settlement',{p_actor_id:ctx.appUser.id,p_settlement_id:id,p_amount_cents:body.amountCents,p_reason:reason,p_request_id:String(body.requestId||'')}).single())};
  }
  const jobCancel=route.match(/^admin\/finance\/jobs\/(\d+)\/cancel$/);
  if(jobCancel&&method==='POST') {
    if(role!=='ADMIN')throw new ApiError('Forbidden',403);
    const reason=String(body.reason||'').trim();
    if(!reason||reason.length>300)throw new ApiError('A reason (up to 300 characters) is required');
    return {job:await result(service.rpc('st_cancel_manual_job',{p_actor_id:ctx.appUser.id,p_job_id:Number(jobCancel[1]),p_reason:reason}).single())};
  }
  if(route==='admin/finance/manual-cleanings'&&method==='POST') {
    if(role!=='ADMIN')throw new ApiError('Forbidden',403);
    return {job:await result(service.rpc('st_create_manual_completed_job',{p_actor_id:ctx.appUser.id,p_body:body}).single())};
  }
  if(route==='admin/media/cleanup'&&method==='POST') {
    if(role!=='ADMIN')throw new ApiError('Forbidden',403);
    const cutoff=new Date(Date.now()-48*3600*1000).toISOString();
    const tickets=await result(service.from('st_upload_tickets').select('id,storage_path').is('photo_id',null).lt('expires_at',cutoff).limit(100));
    const outcomes=[];
    for(const ticket of tickets){
      try{
        const references=await result(service.from('st_job_photos').select('id').eq('storage_path',ticket.storage_path).limit(1));
        if(references.length){outcomes.push({id:ticket.id,skipped:true});continue;}
        await result(service.storage.from('st-cleaning-media').remove([ticket.storage_path]));
        await result(service.from('st_upload_tickets').delete().eq('id',ticket.id).is('photo_id',null));
        outcomes.push({id:ticket.id,removed:true});
      }catch(error){outcomes.push({id:ticket.id,error:error.message});}
    }
    return {outcomes};
  }
  if(route==='admin/recurring'&&method==='GET') {
    admin();
    let builder=service.from('st_recurring').select('*,st_objects(code,name,service_category)').order('id',{ascending:false}).limit(500);
    if(String(query.includeHistory||'')!=='true')builder=builder.eq('active',true).or(`end_date.is.null,end_date.gte.${today()}`);
    return {schedules:await result(builder)};
  }
  if(route==='admin/recurring'&&method==='POST') {
    admin();
    if(!Number.isSafeInteger(Number(body.objectId))||Number(body.objectId)<=0)throw new ApiError('Choose a property');
    if(!/^\d{4}-\d{2}-\d{2}$/.test(String(body.startDate))||!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(body.plannedStart)))throw new ApiError('Invalid date or time');
    if(!Array.isArray(body.weekdays)||!body.weekdays.length||body.weekdays.some(n=>!Number.isInteger(n)||n<1||n>7))throw new ApiError('Choose weekdays');
    const object=await result(service.from('st_objects').select('id,active,approval_status').eq('id',body.objectId).single());
    if(!object?.active||object.approval_status!=='APPROVED')throw new ApiError('Property must be active and approved');
    return {schedule:await result(service.from('st_recurring').insert({object_id:body.objectId,created_by_user_id:ctx.appUser.id,start_date:body.startDate,end_date:body.endDate||null,planned_start:body.plannedStart,weekdays:[...new Set(body.weekdays)]}).select().single())};
  }
  const recurring=route.match(/^admin\/recurring\/(\d+)(?:\/(generate))?$/);
  if(recurring) {
    admin();const id=Number(recurring[1]);
    if(recurring[2]==='generate'&&method==='POST')return result(service.rpc('st_generate_recurring',{p_actor_id:ctx.appUser.id,p_recurring_id:id,p_until:body.until}));
    if(!recurring[2]&&method==='PATCH'){
      const current=await result(service.from('st_recurring').select('*').eq('id',id).single());
      const startDate=body.startDate===undefined?String(current.start_date):String(body.startDate);
      const endDate=body.endDate===undefined?current.end_date:(body.endDate?String(body.endDate):null);
      const plannedStart=body.plannedStart===undefined?String(current.planned_start).slice(0,5):String(body.plannedStart);
      const weekdays=body.weekdays===undefined?current.weekdays:body.weekdays;
      if(!/^\d{4}-\d{2}-\d{2}$/.test(startDate)||endDate!==null&&!/^\d{4}-\d{2}-\d{2}$/.test(String(endDate))||!/^([01]\d|2[0-3]):[0-5]\d$/.test(plannedStart))throw new ApiError('Invalid date or time');
      if(endDate&&endDate<startDate)throw new ApiError('End date must be on or after the start date');
      if(!Array.isArray(weekdays)||!weekdays.length||weekdays.some(n=>!Number.isInteger(n)||n<1||n>7))throw new ApiError('Choose at least one weekday');
      const updates={start_date:startDate,end_date:endDate,planned_start:plannedStart,weekdays:[...new Set(weekdays)].sort((a,b)=>a-b)};
      if(body.active!==undefined){if(typeof body.active!=='boolean')throw new ApiError('Active must be boolean');updates.active=body.active;}
      return {schedule:await result(service.from('st_recurring').update(updates).eq('id',id).select().single())};
    }
  }
  const checklist=route.match(/^admin\/objects\/(\d+)\/checklist$/);
  if(checklist&&method==='GET') {
    admin();return {items:await result(service.from('st_checklist_items').select('*').eq('object_id',Number(checklist[1])).order('sort_order'))};
  }
  return null;
}
