import {validatePhoto} from './media.mjs';
const bucket='st-property-guides';
const active=new Set(['ACCEPTED','EN_ROUTE','ARRIVED','CLEANING']);
export async function propertyPhotosRoute({ctx,route,method,body,service,result,ApiError,jobFor,clientObject}) {
 const jobRoute=route.match(/^cleaner\/jobs\/(\d+)\/reference-photos(?:\/(\d+))?$/);
 const objectRoute=route.match(/^objects\/(\d+)\/reference-photos(?:\/(\d+))?$/);
 if(!jobRoute&&!objectRoute)return null;
 const role=ctx.appUser.role;
 let objectId,canEdit=false;
 const deny=()=>{throw new ApiError('Forbidden',403)};
 if(jobRoute){
  if(role!=='CLEANER'||method!=='GET')deny();
  const job=await jobFor(ctx,Number(jobRoute[1]));
  if(!ctx.cleaner?.id||String(job.assigned_cleaner_id)!==String(ctx.cleaner.id)||!active.has(job.status))deny();
  objectId=job.object_id;
 }else{
  objectId=Number(objectRoute[1]);
  if(['ADMIN','OPERATIONS_MANAGER'].includes(role)){
   const object=await result(service.from('st_objects').select('id').eq('id',objectId).maybeSingle());
   if(!object)throw new ApiError('Property not found',404);
   canEdit=true;
  }else if(['OWNER','PROPERTY_MANAGER'].includes(role)){
   await clientObject(ctx,objectId);canEdit=role==='OWNER';
  }else deny();
 }
 const photoId=(jobRoute||objectRoute)[2];
 if(method!=='GET'&&!canEdit)deny();
 if(method==='GET'&&!photoId)return {photos:await result(service.from('st_object_photos').select('id,caption,mime').eq('object_id',objectId).order('id'))};
 if(photoId){
  const photo=await result(service.from('st_object_photos').select('*').eq('id',Number(photoId)).eq('object_id',objectId).maybeSingle());
  if(!photo)throw new ApiError('Photo not found',404);
  if(method==='GET'){
   const blob=await result(service.storage.from(bucket).download(photo.storage_path));
   const bytes=new Uint8Array(await blob.arrayBuffer());
   let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
   // No bearer URLs: every file read is authenticated and rechecks assignment.
   return {dataUrl:`data:${photo.mime};base64,${btoa(binary)}`};
  }
  if(method==='DELETE'){
   await result(service.storage.from(bucket).remove([photo.storage_path]));
   await result(service.from('st_object_photos').delete().eq('id',photo.id).eq('object_id',objectId));
   return {ok:true};
  }
 }
 if(method==='POST'&&!photoId){
  const caption=String(body.caption||'').trim(),encoded=String(body.base64||'');
  if(caption.length>300||encoded.length>7*1024*1024)throw new ApiError('Invalid photo or caption',400);
  let bytes,extension;
  try{bytes=Uint8Array.from(atob(encoded),c=>c.charCodeAt(0));extension=validatePhoto(bytes,String(body.mime));}catch(e){throw new ApiError(e.message,400)}
  const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
  const path=`${objectId}/${digest}.${extension}`;
  await result(service.storage.from(bucket).upload(path,bytes,{contentType:body.mime,upsert:true}));
  const photo=await result(service.from('st_object_photos').upsert({object_id:objectId,storage_path:path,caption,mime:body.mime,created_by:ctx.appUser.id},{onConflict:'storage_path'}).select('id,caption,mime').single());
  return {photo};
 }
 throw new ApiError('Method not allowed',405);
}
