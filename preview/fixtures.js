/* Fictional records for the public frontend preview. No customer records or live credentials. */
(() => {
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Bratislava'}).format(new Date());
  const tomorrow=new Date(Date.parse(today+'T12:00:00Z')+86400000).toISOString().slice(0,10);
  const yesterday=new Date(Date.parse(today+'T12:00:00Z')-86400000).toISOString().slice(0,10);
  const identities={
    ADMIN:{id:1,role:'ADMIN',full_name:'Demo administrator',language:'en'},
    OPERATIONS_MANAGER:{id:2,role:'OPERATIONS_MANAGER',full_name:'Demo dispatcher',language:'en'},
    CLEANER:{id:3,role:'CLEANER',full_name:'Demo cleaner',email:'cleaner@example.invalid',language:'en',cleaner_mode:'FLEX',reliability_score:96,rating:4.9,transport:'CAR',preferred_zones:['Bratislava — Staré Mesto','Praha — Nové Město']},
    OWNER:{id:4,role:'OWNER',full_name:'Demo owner',company_name:'Demo stays',email:'owner@example.invalid',language:'en'},
    PROPERTY_MANAGER:{id:5,role:'PROPERTY_MANAGER',full_name:'Demo manager',company_name:'Demo stays',email:'manager@example.invalid',language:'en'}
  };
  let role='ADMIN';
  const objects=[
    {id:11,code:'BA-001',name:'Old Town apartment',address:'Dunajská 15, Bratislava',zone:'Bratislava — Staré Mesto',lat:48.1458,lng:17.1155,apartment_type:'2 rooms',client_name:'Demo stays',client_id:4,active:true,approval_status:'APPROVED',duration_minutes:90,client_price:42,payout:24,bedrooms:1,bathrooms:1},
    {id:12,code:'BA-002',name:'Riverside studio',address:'Pribinova 8, Bratislava',zone:'Bratislava — Ružinov',lat:48.1397,lng:17.1224,apartment_type:'Studio',client_name:'Demo stays',client_id:4,active:true,approval_status:'APPROVED',duration_minutes:75,client_price:36,payout:20,bedrooms:0,bathrooms:1},
    {id:13,code:'PR-001',name:'New Town apartment',address:'Vodičkova 20, Praha',zone:'Praha — Nové Město',lat:50.0799,lng:14.4231,apartment_type:'3 rooms',client_name:'Demo stays',client_id:5,active:true,approval_status:'APPROVED',duration_minutes:120,client_price:55,payout:31,bedrooms:2,bathrooms:1},
    {id:14,code:'PR-002',name:'Vinohrady flat',address:'Korunní 47, Praha',zone:'Praha — Vinohrady',lat:50.0750,lng:14.4495,apartment_type:'2 rooms',client_name:'Demo stays',client_id:5,active:true,approval_status:'APPROVED',duration_minutes:90,client_price:45,payout:25,bedrooms:1,bathrooms:1}
  ];
  const jobs=[
    {id:101,object_id:11,status:'CLEANING',risk_score:15,risk_level:'GREEN',risk_reasons:[],cleaner_name:'Demo cleaner',planned_start:'10:00',eta:'11:30',deadline:'15:00',service_date:today},
    {id:102,object_id:12,status:'UNASSIGNED',risk_score:68,risk_level:'ORANGE',risk_reasons:['Unassigned'],cleaner_name:null,planned_start:'12:00',eta:'13:15',deadline:'15:00',service_date:today},
    {id:103,object_id:13,status:'ACCEPTED',risk_score:18,risk_level:'GREEN',risk_reasons:[],cleaner_name:'Demo cleaner',planned_start:'10:30',eta:'12:30',deadline:'15:00',service_date:tomorrow},
    {id:104,object_id:14,status:'UNASSIGNED',risk_score:22,risk_level:'GREEN',risk_reasons:[],cleaner_name:null,planned_start:'11:00',eta:'12:30',deadline:'15:00',service_date:tomorrow},
    {id:105,object_id:11,status:'COMPLETED',risk_score:0,risk_level:'GREEN',risk_reasons:[],cleaner_name:'Demo cleaner',planned_start:'10:00',eta:'11:30',deadline:'15:00',service_date:yesterday}
  ].map(j=>({...objects.find(o=>o.id===j.object_id),...j,object_code:objects.find(o=>o.id===j.object_id).code,object_name:objects.find(o=>o.id===j.object_id).name,projected_finish:j.eta,bonus:0}));
  const cleaners=[{id:3,full_name:'Demo cleaner',email:'cleaner@example.invalid',active:true,mode:'FLEX',transport:'CAR',reliability_score:96,rating:4.9,today_jobs:1,today_earnings:24,completed_jobs:42,cancellation_rate:0,reclean_rate:0,avg_delay_minutes:2,preferred_zones:['Bratislava — Staré Mesto','Praha — Nové Město']}];
  const clients=[{id:4,full_name:'Demo owner',company_name:'Demo stays',account_type:'OWNER',email:'owner@example.invalid',language:'en',user_active:true,active:true,objects:2,approved_objects:2,month_jobs:2,month_revenue:175},{id:5,full_name:'Demo manager',company_name:'Demo stays Prague',account_type:'PROPERTY_MANAGER',email:'manager@example.invalid',language:'en',user_active:true,active:true,objects:2,approved_objects:2,month_jobs:2,month_revenue:100}];
  const settings={companyName:'Shine Time Demo',timezone:'Europe/Bratislava',windowStart:'10:00',windowEnd:'15:00',travelBuffer:30,sameZoneTravelBuffer:15,safetyBuffer:15,rescueStart:'13:30',checkinRadiusMeters:150,reserveTargetPct:20,clientBookingStepMinutes:30,clientCancellationCutoffHours:12};
  const issues=[{id:1,object_code:'BA-002',type:'SUPPLIES',cleaner_name:'Demo cleaner',description:'Fictional example: restock towels',status:'OPEN',priority:'NORMAL',created_at:new Date().toISOString()}];
  const current=()=>jobs.filter(j=>j.service_date===today);
  const clone=x=>structuredClone(x);
  const omit=(record,keys)=>Object.fromEntries(Object.entries(record).filter(([key])=>!keys.includes(key)));
  const clientObject=o=>omit(o,['payout','client_id']);
  const clientJob=j=>omit(j,['payout','bonus','cleaner_name','client_id']);
  const cleanerJob=j=>omit(j,['client_price','client_name','client_id']);
  const dashboard=()=>({kpis:{total:2,completed:0,cleaning:1,assigned:1,unassigned:1,atRisk:1,rescue:0},sla:{projectedReadyPct:50,health:'ORANGE'},capacity:{reservePct:25,health:'GREEN',cleaners:1},jobs:current()});
  const capacity=date=>({jobs:jobs.filter(j=>j.service_date===date),capacity:{cleaners:1,demandMinutes:210,capacityMinutes:390,freeMinutes:180,reservePct:46,health:'GREEN'},cleaners:cleaners.map(c=>({...c,available:true,availability:{fromTime:'08:00',toTime:'16:00'}}))});
  const analytics=()=>({summary:{jobs:5,completed:1,onTimePct:100,issues:1,rescue:0},cleanerRanking:cleaners,objectPerformance:objects.map(o=>({...o,jobs:1,avg_duration:o.duration_minutes})),jobsToday:2,completedToday:0,risk:1});
  const finance=month=>({month,from:month+'-01',to:today,summary:{completedJobs:1,totalRevenue:42,cleaningRevenue:42,manualIncome:0,cleanerPayouts:24,cleanerBonuses:0,jobExtraCosts:0,manualExpenses:0,totalExpenses:24,profit:18,marginPct:43,avgProfitPerJob:18,avgRevenuePerJob:42},trend:[{month,revenue:42,expenses:24,profit:18}],byObject:[{code:'BA-001',name:'Old Town apartment',jobs:1,revenue:42,cost:24,profit:18}],byClient:[{id:4,name:'Demo stays',jobs:1,revenue:42,cost:24,profit:18}],entries:[]});
  const settlements=()=>({summary:{chargedCents:4200,receivedCents:0,dueCents:4200,earnedCents:2400,paidCents:0,payableCents:2400},jobs:[{id:105,object_code:'BA-001',object_name:'Old Town apartment',service_date:yesterday,chargedCents:4200,receivedCents:0,dueCents:4200,earnedCents:2400,paidCents:0,payableCents:2400}],hasMore:false});
  function request(path,options={}){
    if(String(options.method||'GET').toUpperCase()!=='GET')return Promise.reject(Error('Demo preview: editing is unavailable. Changes require a connected staging or production account.'));
    const url=new URL(path,'https://preview.invalid');const resource=url.pathname;
    let data;
    if(resource==='/api/me')data={user:identities[role],settings,csrf:'demo',apiVersion:window.ST_BUILD};
    else if(resource==='/api/admin/dashboard')data=dashboard();
    else if(resource==='/api/admin/jobs')data={jobs};
    else if(resource==='/api/admin/objects')data={objects};
    else if(resource==='/api/client/objects')data={objects:objects.map(clientObject)};
    else if(resource==='/api/admin/clients')data={clients};
    else if(resource==='/api/admin/cleaners')data={cleaners};
    else if(resource==='/api/admin/capacity')data=capacity(url.searchParams.get('date'));
    else if(resource==='/api/admin/analytics')data=analytics();
    else if(resource==='/api/admin/finance'||resource==='/api/client/finance')data=finance(url.searchParams.get('month')||today.slice(0,7));
    else if(resource==='/api/admin/issues')data={issues};
    else if(resource==='/api/admin/settings')data={settings};
    else if(resource==='/api/admin/recurring')data={schedules:[{id:1,st_objects:objects[0],weekdays:[1,3,5],planned_start:'10:00',start_date:today,end_date:null,active:true}]};
    else if(/^\/api\/(admin|cleaner|client)\/settlements$/.test(resource))data=settlements();
    else if(resource==='/api/cleaner/dashboard'){
      const assigned=jobs.filter(j=>j.service_date===(url.searchParams.get('date')||today)&&j.cleaner_name);
      data={availability:{online:true,fromTime:'08:00',toTime:'16:00'},jobs:assigned.map(cleanerJob),nextJob:assigned[0]?cleanerJob(assigned[0]):null,total:assigned.length,earnings:assigned.reduce((n,j)=>n+j.payout,0),projectedFinish:assigned.at(-1)?.eta||'—'};
    }
    else if(resource==='/api/cleaner/marketplace')data={jobs:jobs.filter(j=>j.service_date===(url.searchParams.get('date')||today)&&j.status==='UNASSIGNED').map(j=>({...cleanerJob(j),feasible:true})),bundles:[]};
    else if(resource==='/api/cleaner/earnings')data={today:0,jobs:[cleanerJob(jobs.at(-1))]};
    else if(/^\/api\/cleaner\/jobs\/\d+$/.test(resource)){
      const j=jobs.find(x=>x.id===Number(resource.split('/').at(-1))&&x.cleaner_name);
      if(!j)return Promise.reject(Error('This cleaning is not assigned to the demo cleaner.'));
      data={...cleanerJob(j),access_instructions:'Fictional example: ask Operations for entry details.',key_instructions:'No real access code',parking:'Follow local signs',checklist:[{id:1,label:'Kitchen surfaces',required:true,completed:false,photo_required:false}],photos:[],issues:[]};
    }
    else if(resource==='/api/client/dashboard')data={objects:{total:objects.length,approved:objects.length,pending:0},upcoming:jobs.slice(0,2).map(clientJob),completedToday:0,nextBooking:clientJob(jobs[0])};
    else if(/^\/api\/client\/objects\/\d+$/.test(resource))data={object:clientObject(objects.find(o=>o.id===Number(resource.split('/').at(-1))))};
    else if(resource==='/api/client/slots')data={object:clientObject(objects.find(o=>o.id===Number(url.searchParams.get('objectId')))),slots:['10:00','11:00','12:00']};
    else if(resource==='/api/client/bookings')data={bookings:jobs.map(clientJob)};
    else if(/^\/api\/client\/bookings\/\d+$/.test(resource))data={booking:clientJob(jobs.find(j=>j.id===Number(resource.split('/').at(-1)))),photos:[],issues:[]};
    else if(resource==='/api/client/profile')data={client:{...identities[role],account_type:role}};
    else if(resource==='/api/notifications')data={notifications:[],unread:0};
    else return Promise.reject(Error('No synthetic data for this screen yet: '+resource));
    return Promise.resolve(clone(data));
  }
  window.ShineTimeSupabase={request,subscribeJobs:()=>()=>{},onRecovery:()=>{}};
  window.STPreview={identities,request,switchRole(next){
    if(!Object.hasOwn(identities,next))return;
    role=next;
    state.me={...identities[next]};state.settings=settings;
    window.location.hash=['ADMIN','OPERATIONS_MANAGER'].includes(next)?'admin/live':next==='CLEANER'?'cleaner/home':'client/home';
    render();
  }};
})();
