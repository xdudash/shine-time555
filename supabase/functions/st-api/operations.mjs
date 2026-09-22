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
    admin();return {schedules:await result(service.from('st_recurring').select('*,st_objects(code,name,service_category)').order('id',{ascending:false}).limit(500))};
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
    if(!recurring[2]&&method==='PATCH')return {schedule:await result(service.from('st_recurring').update({active:body.active===true}).eq('id',id).select().single())};
  }
  const checklist=route.match(/^admin\/objects\/(\d+)\/checklist$/);
  if(checklist&&method==='GET') {
    admin();return {items:await result(service.from('st_checklist_items').select('*').eq('object_id',Number(checklist[1])).order('sort_order'))};
  }
  return null;
}
