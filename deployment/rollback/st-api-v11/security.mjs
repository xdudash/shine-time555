const MARKETPLACE_FIELDS = [
  'id', 'object_id', 'service_date', 'earliest_start', 'deadline', 'duration_minutes',
  'status', 'planned_start', 'risk_score', 'risk_level', 'risk_reasons', 'rescue_state',
  'object_code', 'object_name', 'zone', 'apartment_type', 'bedrooms', 'bathrooms',
  'payout', 'bonus', 'feasible', 'feasibility_reason', 'projected_finish',
];

export function marketplaceJob(job) {
  return Object.fromEntries(MARKETPLACE_FIELDS.filter((key) => job[key] !== undefined).map((key) => [key, job[key]]));
}

export function marketplaceJobs(jobs) {
  return jobs.map(marketplaceJob);
}

export function projectResponse(value,role){
  if(role==='ADMIN')return value;
  const hidden=new Set(role==='CLEANER'?['client_price','object_client_price','extra_revenue','extra_cost','client_company','client_name','client_id','financial_status']:
    role==='OPERATIONS_MANAGER'?['client_price','object_client_price','extra_revenue','extra_cost','financial_status']:
    ['payout','bonus','extra_cost','object_notes','cleaner_reliability']);
  const privateGuide=new Set(['access_instructions','key_instructions','parking','linen_location','supplies_location','wifi','object_notes']);
  const activeGuide=new Set(['ACCEPTED','EN_ROUTE','ARRIVED','CLEANING']);
  const visit=item=>Array.isArray(item)?item.map(visit):item&&typeof item==='object'?Object.fromEntries(Object.entries(item).filter(([key])=>!hidden.has(key)&&!(role==='CLEANER'&&item.object_id!==undefined&&!activeGuide.has(item.status)&&privateGuide.has(key))).map(([key,value])=>[key,visit(value)])):item;
  return visit(value);
}
