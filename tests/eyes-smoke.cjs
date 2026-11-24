const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const handlers = new Map();
const rafs = new Map();
let counter=0, timer=0, draws=0, now=2000;
const scales = [], paints = [];
const ctx = () => ({
 drawImage(image){draws++;paints.push({image,alpha:this.globalAlpha})},
 save(){},restore(){},translate(){},scale(x,y){scales.push([x,y])},
 setTransform(){},clearRect(){},globalCompositeOperation:'source-over',globalAlpha:1
});
class FakeImage {set src(value){this.path=value;this.naturalWidth=1206;this.naturalHeight=2622;queueMicrotask(()=>this.onload?.());}}
const canvas={width:1206,height:2622,
  getBoundingClientRect:()=>({left:0,top:0,width:400,height:870}),
  addEventListener:(k,f)=>handlers.set(k,f),removeEventListener:(k)=>handlers.delete(k),
  setPointerCapture(){},releasePointerCapture(){}
};
const rig={angles:{torso:0},root:{x:0,y:0,scaleX:1,scaleY:1},rootAnchor:{x:328.6,y:2050},
 config:{pivots:{torso:{x:328.6,y:1166.5}}},render(){ if(this.eyes)this.eyes.draw(ctx());}};
const sandbox={window:{matchMedia:()=>({matches:false})},document:{hidden:false,
 createElement:()=>({width:0,height:0,getContext:()=>ctx()}),addEventListener(){},removeEventListener(){}},
 Image:FakeImage,performance:{now:()=>now},requestAnimationFrame:(fn)=>{rafs.set(++counter,fn);return counter},
 cancelAnimationFrame:(id)=>rafs.delete(id),setTimeout:()=>++timer,clearTimeout:()=>{},Math,console};
vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname, '../rig/eyes.js'),'utf8'),sandbox);
function frame(ms=1000/60){
 now+=ms;
 const callbacks=[...rafs.values()];rafs.clear();
 for(const callback of callbacks)callback(now);
}
function settle(){
 for(let i=0;i<150&&rafs.size;i++)frame();
 assert.equal(rafs.size,0,'Animation must stop after settling');
}
(async()=>{
 const eyes=new sandbox.window.DressLabEyes(rig,canvas);
 eyes.bodyShape={head:113,headNeckAnchors:{x:328.6,jawY:931,span:40},neckOffsetY:()=>-10};
 await eyes.load();
 assert.equal(handlers.size,4);assert.ok(draws>0);
 const t=eyes.eyeInCanvas();assert.ok(Number.isFinite(t.x)&&Number.isFinite(t.y));
 handlers.get('pointerdown')({pointerId:1,button:0,clientX:320,clientY:330});
 const targetX=eyes.targetX,targetY=eyes.targetY;
 assert.ok(targetX>0);assert.ok(rafs.size>0);
 handlers.get('pointerup')({pointerId:1});
 assert.equal(eyes.targetX,targetX);assert.equal(eyes.targetY,targetY);
 handlers.get('pointermove')({pointerId:1,pointerType:'mouse',clientX:0,clientY:0});
 handlers.get('pointerleave')?.({pointerType:'mouse'});
 assert.equal(eyes.targetX,targetX);assert.equal(eyes.targetY,targetY);
 let peakX=0;
 for(let i=0;i<120&&rafs.size;i++){frame();peakX=Math.max(peakX,eyes.x);}
 assert.ok(peakX>targetX+0.5,'Iris must visibly overshoot its target');
 assert.equal(rafs.size,0);assert.equal(eyes.x,targetX);assert.equal(eyes.y,targetY);

 // Blinking must not reset gaze, and the white/iris remain fully painted
 // at the narrowest point instead of fading almost to transparency.
 assert.equal(eyes.blink(),true);frame(115);
 assert.equal(eyes.blinkValue,0.8);
 scales.length=0;paints.length=0;rig.render();
 assert.ok(Math.abs(scales[scales.length-1][1]-0.2)<1e-9);
 assert.ok(paints.some(p=>p.image===eyes.sprites.sclera&&p.alpha===1));
 assert.ok(paints.some(p=>p.image===eyes.irisBuffer&&p.alpha===1));
 frame(210);assert.ok(eyes.blinkValue<0,'Reopening should bounce past neutral');
 settle();assert.equal(eyes.blinkValue,0);assert.equal(eyes.x,targetX);assert.equal(eyes.y,targetY);

 // A subsequent click or held drag selects a new persistent target.
 handlers.get('pointerdown')({pointerId:2,button:0,clientX:320,clientY:330});
 handlers.get('pointermove')({pointerId:2,pointerType:'touch',clientX:0,clientY:170});
 const left=eyes.targetX,up=eyes.targetY;
 assert.ok(left<0);assert.ok(up<0);
 handlers.get('pointercancel')({pointerId:2});
 settle();assert.equal(eyes.x,left);assert.equal(eyes.y,up);
 eyes.dispose();assert.equal(handlers.size,0);
 console.log('PASS: shape anchor, sticky gaze, hover/leave, elastic overshoot, 80% blink, rebound, drag/cancel, dispose');
})().catch(e=>{console.error(e);process.exitCode=1});
