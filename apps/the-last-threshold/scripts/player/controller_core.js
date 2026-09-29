export class PlatformerController {
  constructor(config={}) {
    this.maxSpeed=config.maxSpeed ?? 275;
    this.accel=config.accel ?? 2200;
    this.friction=config.friction ?? 3100;
    this.gravity=config.gravity ?? 1850;
    this.jumpSpeed=config.jumpSpeed ?? 690;
    this.airJumpSpeed=config.airJumpSpeed ?? 610;
    this.coyoteTime=config.coyoteTime ?? 0.12;
    this.jumpBufferTime=config.jumpBufferTime ?? 0.14;
    this.maxJumps=config.maxJumps ?? 1;
  }
  tick(body,input,dt) {
    const dir=(input.right?1:0)-(input.left?1:0);
    const target=dir*this.maxSpeed;
    const rate=dir?this.accel:this.friction;
    body.vx += (target-body.vx)*Math.min(1,rate*dt/1000);
    if(Math.abs(body.vx)<3&&!dir) body.vx=0;
    if(dir) body.facing=dir;
    body.x += body.vx*dt;
    if(body.jumpBuffer>0) body.jumpBuffer-=dt;
    if(body.coyote>0) body.coyote-=dt;
    body.vy += this.gravity*dt;
    body.y += body.vy*dt;
  }
  requestJump(body) {
    body.jumpBuffer=this.jumpBufferTime;
  }
  consumeJump(body) {
    if(body.grounded || body.coyote>0) {
      body.vy=-this.jumpSpeed;
      body.grounded=false;
      body.coyote=0;
      body.jumpsUsed=1;
      body.jumpBuffer=0;
      return true;
    }
    if(body.jumpsUsed<this.maxJumps) {
      body.vy=-this.airJumpSpeed;
      body.jumpsUsed++;
      body.jumpBuffer=0;
      return true;
    }
    return false;
  }
  landed(body) {
    body.vy=0;
    body.grounded=true;
    body.jumpsUsed=0;
    body.coyote=this.coyoteTime;
  }
}
