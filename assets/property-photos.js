/* Private reference media: never persisted in browser storage or shared between views. */
(function(){
 const words={uk:['Фото об’єкта','Додати фото','Підпис: будинок, вхід, орієнтир','Завантаження…','Фото поки немає','Повторити','Використовуйте JPEG, PNG або WebP до 5 МБ','Збережено','Закрити','Фото для розпізнавання об’єкта, не звіт про прибирання.'],ru:['Фото объекта','Добавить фото','Подпись: здание, вход, ориентир','Загрузка…','Фото пока нет','Повторить','Используйте JPEG, PNG или WebP до 5 МБ','Сохранено','Закрыть','Фото помогают узнать объект; это не отчёт об уборке.'],sk:['Fotografie objektu','Pridať fotografiu','Popis: budova, vchod, orientačný bod','Načítavanie…','Zatiaľ žiadne fotografie','Skúsiť znova','Použite JPEG, PNG alebo WebP do 5 MB','Uložené','Zavrieť','Fotografie na rozpoznanie objektu, nie dôkaz upratovania.'],en:['Property photos','Add photo','Caption: building, entrance, landmark','Loading…','No photos yet','Retry','Use JPEG, PNG or WebP up to 5 MB','Saved','Close','Reference photos help identify the property; they are not cleaning proof.']};
 const label=i=>(words[state.locale==='ua'?'uk':state.locale]||words.en)[i];
 const validData=s=>typeof s==='string'&&/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(s);
 let running=0;const queue=[];
 function drain(){while(running<3&&queue.length){const task=queue.shift();running++;task().finally(()=>{running--;drain()})}}
 const schedule=task=>{queue.push(task);drain()};
 window.propertyPhotoCard=(id,job=false)=>`<div class="property-photo-card" data-property-photo="${Number(id)}" data-job-photo="${job?'1':'0'}"><button class="btn" type="button">${esc(label(0))}</button></div>`;
 function route(id,job){return `/api/${job?'cleaner/jobs':'objects'}/${id}/reference-photos`}
 const observer=new IntersectionObserver(entries=>entries.forEach(({target,isIntersecting})=>{if(isIntersecting){observer.unobserve(target);schedule(()=>cover(target))}}),{rootMargin:'120px'});
 async function cover(el){if(!el.isConnected||!state.me)return;const user=state.me,id=Number(el.dataset.propertyPhoto),job=el.dataset.jobPhoto==='1';
 const alive=()=>el.isConnected&&state.me===user;
 el.querySelector('button').onclick=()=>open(id,job,el);
 try{const d=await api(route(id,job));if(!alive())return;
 if(d.photos?.length){const p=await api(route(id,job)+'/'+d.photos[0].id);if(!alive()||!validData(p.dataUrl))return;const img=document.createElement('img');img.src=p.dataUrl;img.alt=d.photos[0].caption||label(0);el.querySelector('button').prepend(img)}
 }catch(e){if(alive()){el.querySelector('button').textContent=label(0)+' · '+label(5);el.title=e.message}}
 }
 new MutationObserver(()=>document.querySelectorAll('[data-property-photo]:not([data-observed])').forEach(el=>{el.dataset.observed='1';observer.observe(el)})).observe(document.getElementById('app'),{childList:true,subtree:true});
 async function open(id,job,source){
 const user=state.me;if(!user)return;
 const editable=!job&&['ADMIN','OPERATIONS_MANAGER','OWNER'].includes(user.role);
 modal(esc(label(0)),`<p>${esc(label(9))}</p><div id="reference-gallery" aria-live="polite"></div>${editable?`<form id="reference-upload"><label>${esc(label(2))}<input class="input" name="caption" maxlength="300"></label><label class="btn">${esc(label(1))}<input name="photo" type="file" accept="image/jpeg,image/png,image/webp" required></label><button class="btn primary" type="submit">${esc(label(1))}</button><p role="status"></p></form>`:''}`,`<button class="btn" onclick="closeModal()">${esc(label(8))}</button>`);
 const gallery=document.getElementById('reference-gallery'),form=document.getElementById('reference-upload');
 const alive=()=>gallery.isConnected&&state.me===user;
 async function refresh(){gallery.textContent=label(3);try{const d=await api(route(id,job));if(!alive())return;gallery.innerHTML='';if(!d.photos?.length)gallery.textContent=label(4);
 for(const photo of d.photos||[]){const figure=document.createElement('figure'),caption=document.createElement('figcaption'),button=document.createElement('button');caption.textContent=photo.caption||label(0);button.className='btn';button.textContent=label(3);figure.append(button,caption);gallery.append(figure);
 const load=async()=>{if(!alive())return;try{const p=await api(route(id,job)+'/'+photo.id);if(!alive())return;if(!validData(p.dataUrl))throw Error(label(6));const img=document.createElement('img');img.src=p.dataUrl;img.alt=photo.caption||label(0);button.replaceWith(img)}catch(e){if(alive()){button.textContent=label(5);button.title=e.message;button.onclick=()=>schedule(load)}}};schedule(load)}
 }catch(e){if(alive()){gallery.textContent=e.message+' ';const retry=document.createElement('button');retry.className='btn';retry.textContent=label(5);retry.onclick=refresh;gallery.append(retry)}}}
 if(form)form.onsubmit=async e=>{e.preventDefault();const file=form.photo.files[0],status=form.querySelector('[role=status]');if(!file||!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>5*1024*1024){status.textContent=label(6);return}
 const controls=[...form.querySelectorAll('input,button')];controls.forEach(x=>x.disabled=true);status.textContent=label(3);
 try{const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(Error(label(6)));reader.readAsDataURL(file)});if(!alive())return;
 await api(route(id,job),{method:'POST',body:{caption:form.caption.value.trim(),mime:file.type,base64:data.split(',')[1]}});if(!alive())return;form.reset();status.textContent=label(7);await refresh();if(source?.isConnected){source.querySelector('img')?.remove();schedule(()=>cover(source))}
 }catch(e){if(alive())status.textContent=e.message}finally{if(alive())controls.forEach(x=>x.disabled=false)}};
 await refresh();
 }
})();
