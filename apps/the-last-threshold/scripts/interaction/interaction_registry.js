export class InteractionRegistry {
  constructor(){ this.entries=new Map(); }
  register(id,entry){ this.entries.set(id,entry); }
  get(id){ return this.entries.get(id)||null; }
  canInteract(id,context){
    const e=this.entries.get(id);
    return !!e && (!e.canInteract || e.canInteract(context));
  }
  activate(id,context){
    const e=this.entries.get(id);
    if(!e || (e.canInteract && !e.canInteract(context))) return false;
    e.activate?.(context);
    return true;
  }
}
