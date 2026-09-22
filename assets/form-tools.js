/* Additive form tools: local drafts, restore/clear actions and lightweight field validation. */
(()=>{
 const PREFIX='shine-time:draft:';
 const safeStorage=()=>{try{return window.localStorage}catch{return null}};
 const key=form=>PREFIX+(form.id||form.getAttribute('name')||'form')+'@'+location.hash;
 const fields=form=>[...form.querySelectorAll('input,textarea,select')].filter(x=>x.type!=='password'&&x.type!=='file'&&x.type!=='hidden'&&x.name);
 const serialize=form=>fields(form).reduce((o,x)=>{if(x.type==='checkbox')o[x.name]=x.checked;else if(x.type==='radio'){if(x.checked)o[x.name]=x.value}else o[x.name]=x.value;return o},{});
 const restore=(form,data)=>{if(!form||!data)return false;fields(form).forEach(x=>{if(!(x.name in data))return;if(x.type==='checkbox')x.checked=!!data[x.name];else if(x.type==='radio')x.checked=x.value===data[x.name];else x.value=data[x.name]??'';x.dispatchEvent(new Event('input',{bubbles:true}))});return true};
 const save=(form)=>{const s=safeStorage();if(!s||!form)return false;try{s.setItem(key(form),JSON.stringify({savedAt:Date.now(),data:serialize(form)}));return true}catch{return false}};
 const load=form=>{const s=safeStorage();if(!s||!form)return null;try{const raw=s.getItem(key(form));if(!raw)return null;const x=JSON.parse(raw);return x?.data?x:null}catch{return null}};
 const clear=form=>{const s=safeStorage();if(!s||!form)return false;try{s.removeItem(key(form));return true}catch{return false}};
 const required=form=>fields(form).filter(x=>x.required&&!String(x.value||'').trim()).map(x=>x.name);
 const mark=(form,dirty=true)=>{if(form)form.dataset.dirty=dirty?'1':'0'};
 const install=form=>{if(!form||form.dataset.formTools==='1')return;form.dataset.formTools='1';let timer=0;form.addEventListener('input',()=>{mark(form);clearTimeout(timer);timer=setTimeout(()=>save(form),700)});form.addEventListener('change',()=>{mark(form);save(form)});form.addEventListener('submit',()=>{clear(form);mark(form,false)});const draft=load(form);if(draft){const age=Date.now()-Number(draft.savedAt||0);if(age<604800000){restore(form,draft.data);mark(form);toast?.(tr('Draft restored','Draft restored'),'success')}}};
 const tr=(k,f)=>window.ST_I18N?.t?.(k,f)||f;const toast=(m,t)=>window.toast?.(m,t);
 const installAll=()=>document.querySelectorAll('#page form').forEach(install);
 window.ShineTimeForms={save,load,clear,restore,serialize,required,install,installAll,mark};
 new MutationObserver(installAll).observe(document.body,{childList:true,subtree:true});
 setTimeout(installAll,100);
})();
