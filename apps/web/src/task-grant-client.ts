import { api } from './api.ts';
import { isTaskGrantInput, isTaskGrantStatus, type TaskGrantInput, type TaskGrantStatus } from '../../../shared/task-grant.ts';
export type TaskGrantClientState = {status:TaskGrantStatus|null;loading:boolean;message:string};
type Request=(body?:TaskGrantInput)=>Promise<unknown>;
export class TaskGrantClient {
  state:TaskGrantClientState={status:null,loading:false,message:''};
  private disposed=false;
  constructor(private changed:(state:TaskGrantClientState)=>void,private request:Request=body=>api('/api/task-grant',isTaskGrantStatus,body)){}
  private publish(){if(!this.disposed)this.changed(structuredClone(this.state));}
  async refresh(){await this.run();}
  async save(input:TaskGrantInput){
    if(!isTaskGrantInput(input)||!this.state.status?.canSave||this.state.loading||this.disposed)return;
    await this.run(structuredClone(input));
  }
  private async run(body?:TaskGrantInput){
    if(this.disposed||this.state.loading)return;
    const context=this.state.status?.context;
    this.state.loading=true;this.state.message=body?'正在保存任务许可，不会扫描或付款。':'正在查询已保存的任务许可。';this.publish();
    try{
      const next=await this.request(body);
      if(!isTaskGrantStatus(next))throw new Error('invalid');
      if(body&&(!next.grant||JSON.stringify(next.context)!==JSON.stringify(context)||Object.keys(body).some(k=>next.grant![k as keyof TaskGrantInput]!==body[k as keyof TaskGrantInput])))throw new Error('unbound');
      if(this.disposed)return;
      this.state.status=structuredClone(next);
      this.state.message=body?'任务许可已保存。执行链尚未接通，没有开始购买或付款。':next.grant?'已读取原许可；没有重新授权、扫描或付款。':'尚未保存任务许可。';
    }catch{
      if(this.disposed)return;
      this.state.status=null;
      this.state.message=body?'保存结果未确认，请查询已有许可；不会自动重复保存。':'无法取得任务许可，请确认本机 Demo 已启动后再查询。';
    }finally{this.state.loading=false;this.publish();}
  }
  dispose(){this.disposed=true;}
}
