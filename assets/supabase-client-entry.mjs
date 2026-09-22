import {subscribeJobChanges} from './job-subscription.mjs';
import { createClient } from '@supabase/supabase-js';
import { toEdgeRequest } from './supabase-api-core.mjs';

const config = window.ST_SUPABASE || {};
let client;
const pendingRequests=new Map();
const uncertainCommands=new Map();

function requireConfig() {
  if (!config.url || !config.publishableKey || !config.functionName) {
    throw new Error('Supabase configuration is missing. Check config/supabase.php on Hostinger.');
  }
}

function getClient() {
  requireConfig();
  if (!client) {
    client = createClient(config.url, config.publishableKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
  }
  return client;
}

async function responseError(error) {
  let detail;
  try { detail = await error?.context?.json(); } catch { detail = null; }
  const result = new Error(detail?.error || error?.message || 'Supabase request failed');
  result.status = error?.context?.status || 500;
  result.data = detail || {};
  return result;
}

async function invoke(path, opts = {}) {
  const method=String(opts.method||'GET').toUpperCase();
  const key=method+':'+path+':'+JSON.stringify(opts.body??null);
  if(pendingRequests.has(key))return pendingRequests.get(key);
  const command=method!=='GET'&&/\/jobs\/\d+(?:\/(accept|assign|rescue|status|complete|cancel|bonus))?$/.test(path);
  if(command&&!uncertainCommands.has(key))uncertainCommands.set(key,crypto.randomUUID());
  const body=command?{...opts.body,requestId:opts.body?.requestId||uncertainCommands.get(key)}:opts.body??null;
  const payload = toEdgeRequest(path,method,body,window.ST_BUILD||null);
  const promise=(async()=>{
    const {data,error}=await getClient().functions.invoke(config.functionName,{body:payload});
    if(error){const detail=await responseError(error);if(detail.status<500)uncertainCommands.delete(key);throw detail;}
    uncertainCommands.delete(key);return data;
  })().finally(()=>pendingRequests.delete(key));
  pendingRequests.set(key,promise);return promise;
}

async function request(path, opts = {}) {
  const method = String(opts.method || 'GET').toUpperCase();
  const body = opts.body || {};
  if (path === '/api/login' && method === 'POST') {
    const { data, error } = await getClient().auth.signInWithPassword({ email: String(body.email || ''), password: String(body.password || '') });
    if (error || !data.session) throw new Error(error?.message || 'Invalid email or password');
    const me = await invoke('/api/me');
    return { ...me, csrf: 'supabase' };
  }
  if (path === '/api/logout' && method === 'POST') {
    const { error } = await getClient().auth.signOut();
    if (error) throw new Error(error.message);
    pendingRequests.clear();uncertainCommands.clear();proofUploads.clear();
    return { ok: true };
  }
  return invoke(path, opts);
}

async function bootstrapFirstAdmin(input) {
  const email = String(input.email || '').trim();
  const password = String(input.password || '');
  let data;
  const signedIn = await getClient().auth.signInWithPassword({ email, password });
  if (!signedIn.error && signedIn.data.session) {
    data = signedIn.data;
  } else {
    const signedUp = await getClient().auth.signUp({ email, password, options: { data: {} } });
    if (signedUp.error) {
      const details = String(signedIn.error?.message || '') + ' ' + String(signedUp.error.message || '');
      if (/already registered|already exists|email not confirmed/i.test(details)) {
        throw new Error('Confirm the Supabase email, then return here and submit the same form once more to activate the administrator role.');
      }
      throw new Error(signedUp.error.message);
    }
    data = signedUp.data;
    if (!data.session) {
      throw new Error('Confirm the Supabase email, then return here and submit the same form once more to activate the administrator role.');
    }
  }
  const { data: created, error: invokeError } = await getClient().functions.invoke(config.functionName, {
    body: {
      route: 'bootstrap',
      method: 'POST',
      query: {},
      body: { fullName: input.fullName, phone: input.phone || '', language: input.language || 'ru' },
      clientBuild: window.ST_BUILD || null,
    },
  });
  if (invokeError) throw await responseError(invokeError);
  return created;
}

function subscribeJobs(onChange,onStatus=()=>{}) {
  return subscribeJobChanges(getClient(),onChange,onStatus);
}

async function resetPassword(email){
  const {error}=await getClient().auth.resetPasswordForEmail(email,{redirectTo:new URL(window.ST_BASE||'./',location.origin).href});
  if(error)throw error;
}
async function recoverPassword(password){const {error}=await getClient().auth.updateUser({password});if(error)throw error;}
function onRecovery(callback){return getClient().auth.onAuthStateChange(event=>{if(event==='PASSWORD_RECOVERY')setTimeout(callback,0);}).data.subscription;}
const proofUploads=new Map();
async function uploadProofFile(jobId,category,file,onStage=()=>{}) {
  const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await file.arrayBuffer())),b=>b.toString(16).padStart(2,'0')).join('');
  const key=JSON.stringify([jobId,category,file.name,digest]);
  let ticket=proofUploads.get(key);
  if(!ticket){
    onStage('Preparing upload');
    ticket=await request(`/api/cleaner/jobs/${jobId}/photos/prepare`,{method:'POST',body:{category,fileName:file.name,mime:file.type,fileSize:file.size}});
    proofUploads.set(key,ticket);
  }
  onStage('Uploading photo');
  const {error}=await getClient().storage.from(ticket.bucket).uploadToSignedUrl(ticket.path,ticket.token,file,{contentType:file.type});
  onStage('Verifying photo');
  // If upload acknowledgement was lost, finalize the existing object safely.
  try {
    const result=await request(`/api/cleaner/jobs/${jobId}/photos/finalize`,{method:'POST',body:{uploadId:ticket.uploadId}});
    proofUploads.delete(key);return result;
  }catch(finalizeError){
    if(/expired/i.test(finalizeError.message))proofUploads.delete(key);
    throw error||finalizeError;
  }
}
window.ShineTimeSupabase = { request, uploadProofFile, bootstrapFirstAdmin, subscribeJobs, resetPassword, recoverPassword, onRecovery, client: getClient };
