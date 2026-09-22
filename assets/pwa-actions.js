/* Additive PWA layer: install prompt, online state and service-worker update notice. */
(()=>{
 let deferred=null,installed=false;
 const tr=(k,f)=>window.ST_I18N?.t?.(k,f)||f;
 const toast=(m,t)=>window.toast?.(m,t);
 const install=async()=>{if(!deferred)return false;deferred.prompt();const result=await deferred.userChoice;deferred=null;installed=result.outcome==='accepted';return installed};
 const addButton=()=>{if(installed||!deferred||document.getElementById('st-install-app'))return;const b=document.createElement('button');b.id='st-install-app';b.type='button';b.className='live-state';b.textContent=tr('Install app','Install app');b.onclick=async()=>{if(await install())b.remove()};document.body.appendChild(b)};
 window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferred=e;addButton()});
 window.addEventListener('appinstalled',()=>{installed=true;document.getElementById('st-install-app')?.remove();toast(tr('App installed','App installed'),'success')});
 window.addEventListener('online',()=>toast(tr('Back online','Back online'),'success'));
 window.addEventListener('offline',()=>toast(tr('You are offline','You are offline'),'error'));
 if('serviceWorker' in navigator){navigator.serviceWorker.ready.then(reg=>{reg.addEventListener('updatefound',()=>{const worker=reg.installing;if(!worker)return;worker.addEventListener('statechange',()=>{if(worker.state==='installed'&&navigator.serviceWorker.controller){const b=document.createElement('button');b.id='st-sw-update';b.className='live-state';b.type='button';b.textContent=tr('Update available','Update available');b.onclick=()=>{worker.postMessage({type:'SKIP_WAITING'});location.reload()};document.body.appendChild(b)}})})}).catch(()=>{})}
 window.ShineTimePwa={install,available:()=>!!deferred};
})();
