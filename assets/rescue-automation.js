/* Additive rescue automation: proposes safe replacements without mutating server data. */
(()=>{
 const assignment=()=>window.ShineTimeAutoAssignment;
 const plan=(jobs=[],cleaners=[],shifts=[],options={})=>assignment()?.rescue(jobs,cleaners,shifts,options)||[];
 const summarize=(proposals=[])=>{const total=proposals.length,covered=proposals.filter(x=>x.assignment).length;return{total,covered,uncovered:total-covered,coveragePercent:total?Math.round(covered/total*100):0}};
 const applyLocal=(proposals=[],shifts=[])=>proposals.filter(x=>x.assignment).map(x=>({...x.job,cleanerId:x.assignment.cleanerId,assignmentReason:'AUTO_RESCUE'}));
 const render=(container,proposals=[])=>{if(!container)return false;const s=summarize(proposals);container.innerHTML=`<div class="section-head"><div><h3>Rescue Automation</h3><p class="subtle">${s.covered}/${s.total} at-risk jobs have a candidate</p></div></div><div class="kpi-grid"><div class="kpi"><span>At risk</span><strong>${s.total}</strong></div><div class="kpi"><span>Covered</span><strong>${s.covered}</strong></div><div class="kpi"><span>Coverage</span><strong>${s.coveragePercent}%</strong></div></div><div class="list">${proposals.map(x=>`<div class="list-row"><div><strong>${String(x.job?.id||x.job?.title||'Job').replace(/[&<>\"]/g,'')}</strong><div class="subtle">${x.assignment?`Candidate: ${String(x.assignment.cleanerId).replace(/[&<>\"]/g,'')} · ${x.assignment.distanceKm??'—'} km`:'No eligible cleaner'}</div></div><span class="badge">${x.assignment?'READY':'UNASSIGNED'}</span></div>`).join('')||'<div class="empty">No rescue jobs</div>'}</div>`;return true};
 window.ShineTimeRescue={plan,summarize,applyLocal,render};
})();
