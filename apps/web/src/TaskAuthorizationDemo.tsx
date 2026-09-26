import { useEffect,useRef,useState } from 'react';
import { TaskAuthorizationPanel } from './TaskAuthorizationPanel.tsx';
import { TaskGrantClient,type TaskGrantClientState } from './task-grant-client.ts';
export function TaskAuthorizationDemo(){
  const client=useRef<TaskGrantClient|null>(null);
  const [state,setState]=useState<TaskGrantClientState>({status:null,loading:false,message:''});
  useEffect(()=>{
    let active=true;
    const instance=new TaskGrantClient(next=>{if(active)setState(next);});client.current=instance;
    if(window.location.protocol==='http:')void instance.refresh();
    return()=>{active=false;instance.dispose();client.current=null;};
  },[]);
  return <TaskAuthorizationPanel {...state} onSave={input=>client.current?.save(input)} onRefresh={()=>client.current?.refresh()}/>;
}
