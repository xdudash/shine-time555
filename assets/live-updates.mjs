export function createLiveUpdates({refresh,isBusy=()=>false,onPending=()=>{},onError=()=>{},delay=350}) {
  let pending=false,running=false,stopped=false,timer;
  const schedule=()=>{clearTimeout(timer);if(!stopped&&pending&&!running)timer=setTimeout(flush,delay);};
  async function flush(){
    if(stopped||running||!pending)return;
    if(isBusy()){onPending(true);return;}
    pending=false;running=true;
    try{await refresh();}catch(error){onError(error);}
    finally{running=false;onPending(pending);schedule();}
  }
  return {
    invalidate(){if(stopped)return;pending=true;onPending(true);schedule();},
    resume(){schedule();},
    stop(){stopped=true;clearTimeout(timer);},
    get pending(){return pending;},
  };
}

export function staticCacheAllowed(input,origin,base='/') {
  const url=new URL(input,origin);
  if(url.origin!==origin)return false;
  const prefix=base.endsWith('/')?base:base+'/';
  if(!url.pathname.startsWith(prefix))return false;
  const path=url.pathname.slice(prefix.length);
  return /^(assets\/[a-zA-Z0-9_-]+\.(css|js|png|svg|woff2)|manifest\.webmanifest)$/.test(path);
}

if(typeof window!=='undefined') window.ShineTimeLive={createLiveUpdates};
