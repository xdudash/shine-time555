/** Checklist-only offline intent. No credentials, labels, notes, access or media data. */
export const CHECKLIST_DRAFT_KEY = 'shine-time:checklist-drafts:v1';
export const CHECKLIST_DRAFT_TTL_MS = 24 * 60 * 60 * 1000;
const ACTIVE = new Set(['ACCEPTED', 'EN_ROUTE', 'ARRIVED', 'CLEANING']);
export class ChecklistDraftError extends Error {
  constructor(code) { super(code); this.name = 'ChecklistDraftError'; this.code = code; }
}
const id = value => {
  if ((typeof value !== 'string' && typeof value !== 'number') || !String(value).trim() || String(value).length > 200) throw new TypeError('Invalid checklist scope identifier');
  return String(value);
};
const same = (a, userId, jobId, itemId) => a.userId === userId && (jobId === undefined || a.jobId === jobId) && (itemId === undefined || a.itemId === itemId);
const denied = error => [403, 404].includes(Number(error?.status ?? error?.statusCode ?? error?.response?.status));

export function createChecklistDrafts({ storage, now = Date.now, ttlMs = CHECKLIST_DRAFT_TTL_MS } = {}) {
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) throw new TypeError('Invalid draft lifetime');
  let sequence = 0;
  const instance = Math.random().toString(36).slice(2);
  const flights = new Map();
  function write(rows) {
    try { rows.length ? storage.setItem(CHECKLIST_DRAFT_KEY, JSON.stringify(rows)) : storage.removeItem(CHECKLIST_DRAFT_KEY); }
    catch { throw new ChecklistDraftError('STORAGE_UNAVAILABLE'); }
  }
  function read() {
    let raw;
    try { raw = storage.getItem(CHECKLIST_DRAFT_KEY); } catch { throw new ChecklistDraftError('STORAGE_UNAVAILABLE'); }
    if (raw === null) return [];
    let rows;
    try {
      rows = JSON.parse(raw);
      if (!Array.isArray(rows)) throw new Error();
      const scopes = new Set();
      for (const row of rows) {
        if (!row || Object.keys(row).sort().join(',') !== 'completed,itemId,jobId,revision,updatedAt,userId' ||
            ['userId', 'jobId', 'itemId'].some(key => typeof row[key] !== 'string' || id(row[key]) !== row[key]) ||
            typeof row.completed !== 'boolean' || typeof row.revision !== 'string' || !row.revision ||
            !Number.isFinite(row.updatedAt)) throw new Error();
        const scope = JSON.stringify([row.userId,row.jobId,row.itemId]);
        if (scopes.has(scope)) throw new Error();
        scopes.add(scope);
      }
    } catch { throw new ChecklistDraftError('STORAGE_CORRUPT'); }
    const current = rows.filter(row => now() - row.updatedAt < ttlMs && row.updatedAt <= now());
    if (current.length !== rows.length) write(current);
    return current;
  }
  const publicRows = rows => rows.map(({ itemId, completed }) => ({ itemId, completed }));
  function list(userId, jobId) { return publicRows(read().filter(row => same(row,id(userId),id(jobId)))); }
  function remove(userId, jobId, itemId, revision) {
    userId = id(userId); if (jobId !== undefined) jobId = id(jobId); if (itemId !== undefined) itemId = id(itemId);
    write(read().filter(row => !(same(row,userId,jobId,itemId) && (revision === undefined || revision === row.revision))));
  }
  function set(userId, jobId, itemId, completed) {
    userId=id(userId); jobId=id(jobId); itemId=id(itemId);
    if (typeof completed !== 'boolean') throw new TypeError('Checklist completion must be boolean');
    const rows=read().filter(row => !same(row,userId,jobId,itemId));
    rows.push({userId,jobId,itemId,completed,updatedAt:now(),revision:`${instance}:${++sequence}`});
    write(rows);
  }
  // Server checklist rows use {id,completed}. Missing/locked items are discarded;
  // matching values are already confirmed, remaining differences are pending intent.
  function reconcile(userId, jobId, serverChecklist, canEdit) {
    userId=id(userId); jobId=id(jobId);
    if (!Array.isArray(serverChecklist)) throw new TypeError('Invalid authoritative checklist');
    const server = new Map(serverChecklist.map(item => [id(item.id),item.completed]));
    const conflicts=[];
    const rows=read().filter(row => {
      if (!same(row,userId,jobId)) return true;
      if (!canEdit || !server.has(row.itemId)) { conflicts.push({itemId:row.itemId,reason:canEdit?'item_removed':'job_unavailable'}); return false; }
      return server.get(row.itemId) !== row.completed;
    });
    write(rows);
    return {pending:publicRows(rows.filter(row => same(row,userId,jobId))),conflicts};
  }
  /** loadJob MUST fetch fresh authorized cleaner detail, not cached detail.
   * saveItem MUST use the server's ownership/state-checked checklist endpoint.
   * isCurrent prevents continued synchronization after account/session changes.
   */
  function flush({userId,jobId,loadJob,saveItem,isCurrent=()=>true,onChange=()=>{}}) {
    userId=id(userId); jobId=id(jobId);
    const scope=JSON.stringify([userId,jobId]);
    if (flights.has(scope)) return flights.get(scope);
    async function run() {
      const result={pending:[],conflicts:[],saved:0,offline:false,cancelled:false};
      const finish=()=>{result.pending=list(userId,jobId); onChange(result); return result;};
      const discard=reason=>{result.conflicts.push(...list(userId,jobId).map(row=>({itemId:row.itemId,reason})));remove(userId,jobId);};
      // Snapshot limits this attempt: new changes remain for the next flush.
      const initial=read().filter(row=>same(row,userId,jobId));
      for (const original of initial) {
        if (!isCurrent()) {result.cancelled=true;break;}
        let current=read().find(row=>same(row,userId,jobId,original.itemId));
        if (!current || current.revision!==original.revision) continue;
        try {
          const job=await loadJob(jobId);
          if (!isCurrent()) {result.cancelled=true;break;}
          if (!job || id(job.id)!==jobId || !ACTIVE.has(job.status)) {discard('job_unavailable');break;}
          if (!Array.isArray(job.checklist)) throw new TypeError('Invalid authoritative checklist');
          const server=job.checklist.find(item=>id(item.id)===original.itemId);
          current=read().find(row=>same(row,userId,jobId,original.itemId));
          if (!current || current.revision!==original.revision) continue;
          if (!server) {remove(userId,jobId,current.itemId,current.revision);result.conflicts.push({itemId:current.itemId,reason:'item_removed'});continue;}
          if (server.completed !== current.completed) {
            await saveItem(jobId,current.itemId,current.completed);
            result.saved++;
          }
          remove(userId,jobId,current.itemId,current.revision);
        } catch (error) {
          if (error instanceof ChecklistDraftError) throw error;
          if (!isCurrent()) {result.cancelled=true;break;}
          if (denied(error)) discard('access_revoked');
          else {result.offline=true;result.error=error;}
          break;
        }
      }
      return finish();
    }
    const promise=run().finally(()=>flights.delete(scope));
    flights.set(scope,promise);
    return promise;
  }
  return {set,list,clearItem:(u,j,i)=>remove(u,j,i),clearJob:(u,j)=>remove(u,j),clearUser:u=>remove(u),reconcile,flush};
}
