/* Shine Time Cleaner GPS enforcement — additive safety layer for check-in. */
(()=>{
  'use strict';
  const toast=(message,type='')=>window.toast?.(message,type);
  window.checkInJob=async id=>{
    if(!navigator.geolocation)return toast('Location is required to check in. Enable GPS/location services and try again.','error');
    navigator.geolocation.getCurrentPosition(async position=>{
      try{
        const request=window.ShineTimeSupabase?.request;
        if(typeof request!=='function')throw new Error('Supabase API client is not available');
        const result=await request(`/api/cleaner/jobs/${encodeURIComponent(id)}/status`,{method:'POST',body:{status:'ARRIVED',lat:position.coords.latitude,lng:position.coords.longitude,accuracyMeters:position.coords.accuracy}});
        if(result?.error)throw new Error(result.error.message||'Check-in failed');
        toast(result?.warning||'Checked in','success');
        await window.render?.();
      }catch(error){toast(error?.message||'Check-in failed','error');}
    },error=>{
      const message=error?.code===1?'Location permission is required to check in.':error?.code===2?'Your location is unavailable. Move to an area with GPS/network coverage and try again.':'Location request timed out. Try again.';
      toast(message,'error');
    },{enableHighAccuracy:true,timeout:10000,maximumAge:0});
  };
})();
