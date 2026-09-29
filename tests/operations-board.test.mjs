import test from 'node:test';
import assert from 'node:assert/strict';
import { bucketForJob, deriveBoard } from '../assets/operations-board.mjs';

test('primary buckets preserve cancellation, review and rework before operational risk', () => {
  const cases = [
    [{status:'CANCELLED',review_status:'PENDING',risk_level:'RED'}, 'cancelled'],
    [{status:'COMPLETED',review_status:'PENDING',risk_level:'RED'}, 'review'],
    [{status:'COMPLETED',review_status:'REWORK_REQUIRED',risk_level:'RED'}, 'active'],
    [{status:'COMPLETED',review_status:'APPROVED',risk_level:'RED'}, 'completed'],
    [{status:'COMPLETED'}, 'completed'],
    [{status:'CLEANING',assigned_cleaner_id:1,risk_level:'ORANGE'}, 'atRisk'],
    [{status:'RESCUE'}, 'atRisk'], [{status:'AT_RISK'}, 'atRisk'],
    [{status:'UNASSIGNED',assigned_cleaner_id:1}, 'unassigned'],
    [{status:'OFFERED',assigned_cleaner_id:1}, 'unassigned'],
    [{status:'ACCEPTED',assigned_cleaner_id:1}, 'assigned'],
    [{status:'EN_ROUTE',assigned_cleaner_id:'1'}, 'assigned'],
    [{status:'ACCEPTED'}, 'unassigned'],
    [{status:'ARRIVED',assigned_cleaner_id:1}, 'active'],
    [{status:'CLEANING',assigned_cleaner_id:1}, 'active'],
    [{status:'UNKNOWN',assigned_cleaner_id:1}, 'assigned'],
    [null, 'unassigned'],
  ];
  for (const [job, expected] of cases) assert.equal(bucketForJob(job), expected);
});

test('100 simultaneous workflow snapshots belong to exactly one bucket without mutating inputs', () => {
  const templates = [
    {status:'UNASSIGNED'}, {status:'OFFERED'},
    {status:'ACCEPTED',assigned_cleaner_id:1}, {status:'EN_ROUTE',assigned_cleaner_id:2},
    {status:'ARRIVED',assigned_cleaner_id:1}, {status:'CLEANING',assigned_cleaner_id:2},
    {status:'RESCUE'}, {status:'COMPLETED',review_status:'PENDING'},
    {status:'COMPLETED',review_status:'APPROVED'}, {status:'CANCELLED'},
  ];
  const jobs = Object.freeze(Array.from({length:100}, (_,i) => Object.freeze({id:i+1,...templates[i%10]})));
  const board = deriveBoard(jobs);
  assert.deepEqual(board.counts,{all:100,unassigned:20,assigned:20,active:20,atRisk:10,review:10,completed:10,cancelled:10});
  const allIds = Object.keys(board.counts).filter(key => key !== 'all').flatMap(bucket => deriveBoard(jobs,{bucket}).jobs.map(job => job.id));
  assert.equal(new Set(allIds).size,100);
  assert.equal(allIds.length,100);
  assert.deepEqual(jobs.map(job=>job.id),Array.from({length:100},(_,i)=>i+1));
  assert.notEqual(board.jobs,jobs);
});

test('accent-insensitive Unicode search intersects zone and cleaner filters before bucket counts', () => {
  const jobs = [
    {id:1,status:'ACCEPTED',assigned_cleaner_id:7,cleaner_name:'Žofia',object_code:'BA-101',object_name:'Útulný byt',address:'Šancová 1',zone:'Staré Mesto'},
    {id:2,status:'COMPLETED',assigned_cleaner_id:'7',cleaner_name:'Žofia',address:'Šancová 2',zone:'Staré Mesto'},
    {id:3,status:'CLEANING',assigned_cleaner_id:8,cleaner_name:'Ірина',address:'Šancová 3',zone:'Ružinov'},
  ];
  const board=deriveBoard(jobs,{query:'SANCOVA',zone:'Staré Mesto',cleanerId:'7',bucket:'assigned'});
  assert.deepEqual(board.jobs.map(job=>job.id),[1]);
  assert.equal(board.counts.all,2);
  assert.equal(board.counts.completed,1);
  assert.deepEqual(board.zones,['Ružinov','Staré Mesto']);
  assert.deepEqual(board.cleaners,[{id:'7',name:'Žofia'},{id:'8',name:'Ірина'}]);
  for (const query of ['ba-101','utulny','zofia','STARE MESTO','s\u030cancova 1']) assert.ok(deriveBoard(jobs,{query}).jobs.some(job=>job.id===1));
  assert.deepEqual(deriveBoard(jobs,{query:'ІРИНА'}).jobs.map(job=>job.id),[3]);
  assert.deepEqual(deriveBoard(jobs,{cleanerId:7}).jobs.map(job=>job.id),[1,2]);
});

test('urgency ordering uses risk, score, deadline, planned start, then numeric identity', () => {
  const jobs = [
    {id:10,risk_level:'GREEN',deadline:'12:00',planned_start:'10:00'},
    {id:2,risk_level:'GREEN',deadline:'12:00',planned_start:'10:00'},
    {id:3,risk_level:'GREEN',deadline:'12:00',planned_start:'09:00'},
    {id:4,risk_level:'GREEN',deadline:'11:00'},
    {id:5,risk_level:'ORANGE',risk_score:50,deadline:'15:00'},
    {id:6,risk_level:'RED',risk_score:90},
    {id:7,risk_level:'RED',risk_score:95},
    {id:8,risk_level:'GREEN'},
  ];
  assert.deepEqual(deriveBoard(jobs).jobs.map(job=>job.id),[7,6,5,4,3,2,10,8]);
  assert.deepEqual(deriveBoard([...jobs].reverse()).jobs.map(job=>job.id),[7,6,5,4,3,2,10,8]);
});

test('invalid data is harmless and unknown filters never broaden a valid filter', () => {
  assert.equal(deriveBoard(null).counts.all,0);
  const board=deriveBoard([null,undefined,4,'job',[],{id:1,status:null,risk_score:'bad',deadline:'bad'}],null);
  assert.equal(board.counts.all,1);
  assert.equal(board.counts.unassigned,1);
  assert.equal(deriveBoard(board.jobs,{bucket:'invalid'}).jobs.length,1);
  assert.equal(deriveBoard(board.jobs,{cleanerId:'unknown'}).jobs.length,0);
  assert.equal(deriveBoard(board.jobs,{zone:'unknown'}).jobs.length,0);
});

test('cleaner options deduplicate numeric/string IDs and prefer available names over fallback IDs', () => {
  const jobs=[{id:1,assigned_cleaner_id:7},{id:2,assigned_cleaner_id:'7',cleaner_name:'Žofia'}];
  assert.deepEqual(deriveBoard(jobs).cleaners,[{id:'7',name:'Žofia'}]);
  assert.deepEqual(deriveBoard([...jobs].reverse()).cleaners,[{id:'7',name:'Žofia'}]);
});
