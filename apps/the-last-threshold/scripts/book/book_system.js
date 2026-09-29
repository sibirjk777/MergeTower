export class BookSystem {
  constructor() {
    this.pages=[];
    this.flags={};
  }
  addPage(page) {
    if(!this.pages.some(p=>p.id===page.id)) this.pages.push(page);
  }
  setFlag(id,value=true) { this.flags[id]=value; }
  hasFlag(id) { return !!this.flags[id]; }
  snapshot() { return {pages:this.pages,flags:this.flags}; }
  restore(data) {
    if(!data) return;
    this.pages=Array.isArray(data.pages)?data.pages:[];
    this.flags=data.flags||{};
  }
}
