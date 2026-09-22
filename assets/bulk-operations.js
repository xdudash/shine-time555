/* Additive bulk operations: selection model and guarded client-side batch planning. */
(()=>{
 const selected=new Set();
 const select=id=>selected.add(String(id));
 const unselect=id=>selected.delete(String(id));
 const toggle=id=>{const k=String(id);selected.has(k)?selected.delete(k):selected.add(k);return selected.has(k)};
 const clear=()=>selected.clear();
 const values=()=>[...selected];
 const size=()=>selected.size;
 const plan=(items=[],action='')=>items.filter(x=>selected.has(String(x.id))).map(x=>({...x,pendingAction:action}));
 const execute=async(items=[],action,handler)=>{const rows=plan(items,action);if(typeof handler!=='function')return{count:rows.length,rows};const results=[];for(const row of rows){try{results.push({id:row.id,ok:true,value:await handler(row,action)})}catch(error){results.push({id:row.id,ok:false,error:String(error?.message||error)})}}return{count:rows.length,results,ok:results.filter(x=>x.ok).length,failed:results.filter(x=>!x.ok).length}};
 const install=container=>{if(!container||container.dataset.bulkReady)return;container.dataset.bulkReady='1';container.addEventListener('change',e=>{const input=e.target.closest('[data-bulk-id]');if(!input)return;toggle(input.dataset.bulkId);container.dispatchEvent(new CustomEvent('bulkchange',{detail:{ids:values()}}))})};
 window.ShineTimeBulk={select,unselect,toggle,clear,values,size,plan,execute,install};
})();
