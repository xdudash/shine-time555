/* Shine Time Cleaner GPS enforcement — additive safety layer for check-in. */
(()=>{
  'use strict';
  const toast=(message,type='')=>window.toast?.(message,type);
  // A fix from the last minute is good enough for a 150 m check-in radius. If precise GPS does not
  // answer quickly (indoors), the phone's network position is tried before giving up.
  const locate=()=>new Promise((resolve,reject)=>navigator.geolocation.getCurrentPosition(resolve,error=>{
    if(error?.code===1)return reject(error);
    navigator.geolocation.getCurrentPosition(resolve,reject,{enableHighAccuracy:false,timeout:6000,maximumAge:120000});
  },{enableHighAccuracy:true,timeout:5000,maximumAge:60000}));
  window.checkInJob=async id=>{
    if(!navigator.geolocation)return toast('Location is required to check in. Enable GPS/location services and try again.','error');
    const tapped=document.activeElement?.closest?.('button,.btn');
    const busy=window.markBusy?.(tapped);
    toast('Getting your location…');
    let position;
    try{position=await locate()}
    catch(error){
      window.clearBusy?.(busy);
      const message=error?.code===1?'Location permission is required to check in.':error?.code===2?'Your location is unavailable. Move to an area with GPS/network coverage and try again.':'Location request timed out. Try again.';
      return toast(message,'error');
    }
    await (async position=>{
      try{
        const request=window.ShineTimeSupabase?.request;
        if(typeof request!=='function')throw new Error('Supabase API client is not available');
        const result=await request(`/api/cleaner/jobs/${encodeURIComponent(id)}/status`,{method:'POST',body:{status:'ARRIVED',lat:position.coords.latitude,lng:position.coords.longitude,accuracyMeters:position.coords.accuracy}});
        if(result?.error)throw new Error(result.error.message||'Check-in failed');
        toast(result?.warning||'Checked in','success');
        await window.render?.();
      }catch(error){toast(error?.message||'Check-in failed','error');}
      finally{window.clearBusy?.(busy);}
    })(position);
  };
})();
