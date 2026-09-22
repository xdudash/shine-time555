/* Synthetic data for the real Shine Time UI. Never connects to production. */
(() => {
  const today = new Intl.DateTimeFormat('en-CA', {timeZone:'Europe/Bratislava'}).format(new Date());
  const identities = {
    ADMIN: {id:1, role:'ADMIN', full_name:'Demo administrator', language:'en'},
    OPERATIONS_MANAGER: {id:2, role:'OPERATIONS_MANAGER', full_name:'Demo dispatcher', language:'en'},
    CLEANER: {id:3, role:'CLEANER', full_name:'Demo cleaner', language:'en'},
    OWNER: {id:4, role:'OWNER', full_name:'Demo owner', company_name:'Demo portfolio', language:'en'},
    PROPERTY_MANAGER: {id:5, role:'PROPERTY_MANAGER', full_name:'Demo manager', company_name:'Demo portfolio', language:'en'}
  };
  let role = 'ADMIN';
  const jobs = [
    {id:101, object_id:11, object_code:'ST-101', object_name:'River Apartment', address:'Demo Street 12, Bratislava', zone:'Central', apartment_type:'2 rooms', status:'CLEANING', risk_score:15, risk_level:'GREEN', risk_reasons:[], cleaner_name:'Demo cleaner', planned_start:'10:00', eta:'11:30', deadline:'15:00', duration_minutes:90, payout:24, bonus:0, client_price:42, service_date:today},
    {id:102, object_id:12, object_code:'ST-102', object_name:'Park Studio', address:'Sample Lane 8, Bratislava', zone:'North', apartment_type:'1 room', status:'UNASSIGNED', risk_score:68, risk_level:'ORANGE', risk_reasons:['Unassigned'], cleaner_name:null, planned_start:'12:00', eta:'13:30', deadline:'15:00', duration_minutes:90, payout:20, bonus:0, client_price:36, service_date:today}
  ];
  const objects = [
    {id:11, code:'ST-101', name:'River Apartment', address:'Demo Street 12, Bratislava', zone:'Central', client_name:'Demo owner', active:true, approval_status:'APPROVED', duration_minutes:90, client_price:42, payout:24},
    {id:12, code:'ST-102', name:'Park Studio', address:'Sample Lane 8, Bratislava', zone:'North', client_name:'Demo owner', active:true, approval_status:'APPROVED', duration_minutes:90, client_price:36, payout:20}
  ];
  const dashboard = () => ({
    kpis:{total:jobs.length,completed:0,cleaning:1,assigned:1,unassigned:1,atRisk:1,rescue:0},
    sla:{projectedReadyPct:50,health:'ORANGE'},
    capacity:{reservePct:25,health:'GREEN',cleaners:1},
    jobs:jobs.map(job=>({...job}))
  });
  function request(path, options={}) {
    if(options.method && options.method!=='GET') throw Error('Demo data: changes are disabled.');
    const resource=path.split('?')[0];
    if(resource==='/api/me') return Promise.resolve({user:identities[role],settings:{},csrf:'demo',apiVersion:window.ST_BUILD});
    if(resource==='/api/admin/dashboard') return Promise.resolve(dashboard());
    if(resource==='/api/admin/jobs') return Promise.resolve({jobs:jobs.map(job=>({...job}))});
    if(resource==='/api/admin/objects') return Promise.resolve({objects:objects.map(object=>({...object}))});
    if(resource==='/api/admin/clients') return Promise.resolve({clients:[]});
    if(resource==='/api/cleaner/dashboard') return Promise.resolve({
      availability:{online:true,fromTime:'08:00',toTime:'16:00'},
      jobs:[jobs[0]],nextJob:jobs[0],total:1,earnings:24,projectedFinish:'11:30'
    });
    if(resource==='/api/client/dashboard') return Promise.resolve({
      objects:{total:2,approved:2,pending:0},upcoming:[jobs[0]],completedToday:0,nextBooking:jobs[0]
    });
    if(resource==='/api/notifications') return Promise.resolve({notifications:[],unread:0});
    return Promise.reject(Error('No synthetic data for this screen yet: '+resource));
  }
  window.ShineTimeSupabase = {request,subscribeJobs:()=>()=>{},onRecovery:()=>{}};
  window.STPreview = {identities, switchRole(next) {
    if(!Object.hasOwn(identities,next)) return;
    role=next;
    window.location.hash=['ADMIN','OPERATIONS_MANAGER'].includes(next)?'admin/live':next==='CLEANER'?'cleaner/home':'client/home';
    state.me={...identities[next]};
    render();
  }};
})();
