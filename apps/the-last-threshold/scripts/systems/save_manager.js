export class SaveManager {
  constructor(slot="tlt_save_v01") { this.slot=slot; }
  write(state) {
    localStorage.setItem(this.slot, JSON.stringify(state));
  }
  read() {
    try { return JSON.parse(localStorage.getItem(this.slot)||"null"); }
    catch { return null; }
  }
  clear() { localStorage.removeItem(this.slot); }
}
