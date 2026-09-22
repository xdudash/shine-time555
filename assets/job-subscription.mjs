// A connected socket can precede the replication listener by several seconds.
// Refetch when that listener is ready, including after reconnects, to close the gap.
export function subscribeJobChanges(client,onChange,onStatus=()=>{}) {
  const channel=client.channel('shinetime-jobs-live')
    .on('system',{},payload=>{
      if(payload.extension!=='postgres_changes')return;
      if(payload.status==='ok'){onStatus('SUBSCRIBED');onChange();}
      else onStatus('CHANNEL_ERROR');
    })
    .on('postgres_changes',{event:'*',schema:'public',table:'st_job_signals'},onChange)
    .subscribe(status=>onStatus(status==='SUBSCRIBED'?'CONNECTING':status));
  return ()=>client.removeChannel(channel);
}
