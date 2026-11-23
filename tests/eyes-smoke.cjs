const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const handlers = new Map();
const rafs = new Map();
let counter=0, timer=0, draws=0;
const ctx = () => ({
 drawImage(){draws++}, save(){},restore(){},translate(){},scale(){},
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
 Image:FakeImage,performance:{now:()=>2000},requestAnimationFrame:(fn)=>{rafs.set(++counter,fn);return counter},
 cancelAnimationFrame:(id)=>rafs.delete(id),setTimeout:()=>++timer,clearTimeout:()=>{},Math,console};
vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname, '../rig/eyes.js'),'utf8'),sandbox);
(async()=>{
 const eyes=new sandbox.window.DressLabEyes(rig,canvas);
 eyes.bodyShape={head:113,headNeckAnchors:{x:328.6,jawY:931,span:40},neckOffsetY:()=>-10};
 await eyes.load();
 assert.equal(handlers.size,5);assert.ok(draws>0);
 const t=eyes.eyeInCanvas();assert.ok(Number.isFinite(t.x)&&Number.isFinite(t.y));
 handlers.get('pointerdown')({pointerId:1,button:0,clientX:320,clientY:330});
 assert.ok(eyes.targetX>0);
 assert.ok(rafs.size>0);
 let [id,frame]=rafs.entries().next().value;rafs.delete(id); frame(2016);
 assert.ok(eyes.x>0);
 handlers.get('pointerup')({pointerId:1}); assert.equal(eyes.targetX,0);
 assert.equal(eyes.blink(),true);
 ;[id,frame]=rafs.entries().next().value;rafs.delete(id);frame(2120);
 assert.ok(eyes.blinkValue>0);
 rig.render();assert.ok(draws>10);
 eyes.dispose();assert.equal(handlers.size,0);
 console.log('PASS: load, draw, shape anchor, pointer gaze, blink, dispose');
})().catch(e=>{console.error(e);process.exitCode=1});