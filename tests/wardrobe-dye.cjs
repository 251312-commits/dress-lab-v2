// Dye commit boundary and immutable-raster regression. Node built-ins only.
// Pixel fixtures isolate color/alpha/caching; browser QA covers real SVG appearance.
// Run: node tests/wardrobe-dye.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const TEE = 'basic-white-tee', PANTS = 'basic-charcoal-pants';
let allocations = 0, brokenRaster = false;

class Canvas {
  constructor() { this.width = 1; this.height = 1; this.draws = []; allocations++; }
  getContext() {
    const canvas = this;
    let matrix = [1, 0, 0, 1, 0, 0];
    const stack = [];
    return {
      save() { stack.push([...matrix]); },
      restore() { matrix = stack.pop() || [1, 0, 0, 1, 0, 0]; },
      setTransform(...values) { matrix = values; },
      clearRect() { canvas.pixels = new Uint8ClampedArray(canvas.width * canvas.height * 4); },
      drawImage(image, ...args) {
        canvas.draws.push({ image, args, matrix: [...matrix] });
        if (image.pixels) canvas.pixels = new Uint8ClampedArray(image.pixels);
      },
      getImageData() {
        if (brokenRaster) throw new Error('Injected inaccessible image pixels');
        return { data: new Uint8ClampedArray(canvas.pixels), width: canvas.width, height: canvas.height };
      },
      putImageData(data) { canvas.pixels = new Uint8ClampedArray(data.data); }
    };
  }
}
const fixture = (...pixels) => ({ width: pixels.length, height: 1,
  pixels: new Uint8ClampedArray(pixels.flat()) });
const events = [];
const window = { dispatchEvent(event) { events.push(event); } };
const sandbox = {
  window,
  document: { createElement(tag) { assert.equal(tag, 'canvas'); return new Canvas(); } },
  CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
  console: { warn() {} }
};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../clothes/wardrobe.js'), 'utf8'), sandbox);
const drawLog = [];
const context = { save() {}, restore() {}, translate() {}, rotate() {},
  drawImage(image, x, y) { drawLog.push({ image, x, y }); } };
const rig = { renderCount: 0, fail: false, angles: {}, config: { pivots: {} },
  ancestors() { return []; }, render() {
    this.renderCount++;
    if (this.fail) throw new Error('Injected render failure');
    this.wardrobe.draw(context);
  } };
const wardrobe = new window.DressLabWardrobe(rig);
assert.equal(wardrobe.getItemState(TEE).color, '#FFFFFF');
assert.equal(wardrobe.getItemState(PANTS).defaultColor, '#4C4E58');
assert.equal(wardrobe.setDyeColor('#C08070', TEE), false, 'Unloaded items cannot commit');
const shirt = fixture([255,255,255,255], [128,128,128,255], [64,64,64,255],
  [200,200,200,61], [21,83,255,0]);
const trousers = fixture([76,78,88,255], [38,39,44,255], [150,152,162,255]);
Object.assign(wardrobe, { ready: true, equipped: true,
  item: { name: 'Shirt', color: '#FFFFFF' },
  parts: [{ image: shirt, x: 10, y: 20, joint: null }] });
Object.assign(wardrobe.pants, { ready: true, equipped: true,
  item: { name: 'Pants', color: '#4C4E58' },
  parts: [{ image: trousers, x: 12, y: 30, joint: null }] });
const originalShirt = [...shirt.pixels], originalTrousers = [...trousers.pixels];
const pixel = (image, index) => [...image.pixels.slice(index * 4, index * 4 + 4)];

// The native colors remain exact references, so default drawing stays cheap.
const initialAllocations = allocations;
wardrobe.draw(context);
assert.equal(drawLog[0].image, trousers);
assert.equal(drawLog[1].image, shirt);
assert.equal(allocations, initialAllocations);

const preview = new Canvas(); preview.width = 120; preview.height = 90;
const initialState = JSON.stringify([wardrobe.getItemState(TEE), wardrobe.getItemState(PANTS)]);
const initialRenders = rig.renderCount;
assert.equal(wardrobe.renderPreview(preview, TEE, '#5080c0'), true);
assert.equal(JSON.stringify([wardrobe.getItemState(TEE), wardrobe.getItemState(PANTS)]), initialState,
  'Candidate colors never change applied or equipped state');
assert.equal(events.length, 0);
assert.equal(rig.renderCount, initialRenders, 'A workbench preview does not repaint the doll');
const staging = preview.draws.at(-1).image;
const candidate = staging.draws[0].image;
assert.deepEqual(pixel(candidate, 0), [80,128,192,255], 'Unshaded fabric uses the target RGB');
assert.deepEqual(pixel(candidate, 1), [40,64,96,255], 'Shadow remains proportional');
assert.ok(pixel(candidate, 2)[0] < pixel(candidate, 1)[0], 'Outlines retain darker values');
assert.equal(pixel(candidate, 3)[3], 61, 'Anti-aliased alpha is untouched');
assert.equal(pixel(candidate, 4)[3], 0, 'Transparent background stays transparent');
assert.deepEqual([...shirt.pixels], originalShirt, 'Previewing never rewrites source pixels');

assert.equal(wardrobe.setDyeColor('#5080c0', TEE), true);
assert.equal(wardrobe.getItemState(TEE).color, '#5080C0');
assert.equal(wardrobe.getItemState(PANTS).color, '#4C4E58');
assert.equal(events.length, 1);
assert.equal(events[0].detail.id, TEE);
assert.equal(events[0].detail.color, '#5080C0');
assert.equal(drawLog.at(-1).image, candidate, 'Apply uses the very same cached dyed artwork as preview');
assert.equal(drawLog.at(-1).x, 10); assert.equal(drawLog.at(-1).y, 20);
const afterApply = allocations;
for (let count = 0; count < 30; count++) wardrobe.draw(context);
assert.equal(allocations, afterApply, 'Motion frames reuse dyed images');
const rendersBeforeDuplicate = rig.renderCount;
assert.equal(wardrobe.setDyeColor('#5080C0', TEE), true);
assert.equal(events.length, 1, 'Duplicate apply emits no second mutation event');
assert.equal(rig.renderCount, rendersBeforeDuplicate);

// Wheel previews and motion drawing share source images at the neutral fit.
// Frequently drawn applied colors must not be evicted by older candidate colors.
for (const hex of ['#112233', '#224466', '#336699', '#884422', '#777777', '#DD8844']) {
  assert.equal(wardrobe.renderPreview(preview, TEE, hex), true);
  const beforeMotion = allocations;
  wardrobe.draw(context);
  assert.equal(allocations, beforeMotion, 'Preview churn must not force motion to recolor applied art');
  assert.equal(drawLog.at(-1).image, candidate, 'Most recently used applied image survives preview churn');
  assert.ok(wardrobe.dyeImages.get(shirt).size <= 3, 'Candidate cache remains bounded');
}
assert.equal(wardrobe.getItemState(TEE).color, '#5080C0');
assert.equal(events.length, 1, 'Preview churn never commits a color');

for (const invalid of [null, '', '5080C0', '#ABC', '#GG0000', '#5080C0;', {}, 0]) {
  assert.equal(wardrobe.setDyeColor(invalid, TEE), false);
  assert.equal(wardrobe.renderPreview(preview, TEE, invalid), false);
}
assert.equal(wardrobe.setDyeColor('#FF0000', 'missing'), false);
assert.equal(wardrobe.renderPreview(preview, 'missing', '#FF0000'), false);
assert.equal(wardrobe.getItemState(TEE).color, '#5080C0');

// Re-dye always starts at source pixels, even after many candidate colors.
assert.equal(wardrobe.setDyeColor('#C04080', TEE), true);
const dyedAgain = drawLog.at(-1).image;
assert.deepEqual(pixel(dyedAgain, 0), [192,64,128,255]);
assert.deepEqual(pixel(dyedAgain, 1), [96,32,64,255]);
assert.deepEqual([...shirt.pixels], originalShirt);
assert.equal(wardrobe.setDyeColor('#C04080', PANTS), true);
const dyedPants = drawLog.at(-2).image;
assert.deepEqual(pixel(dyedPants, 0), [192,64,128,255], 'Dark fabric can be dyed a bright target color');
assert.ok(pixel(dyedPants, 1)[0] < pixel(dyedPants, 0)[0]);
assert.ok(pixel(dyedPants, 2)[0] > pixel(dyedPants, 0)[0], 'Light stitching remains visible');
assert.deepEqual([...trousers.pixels], originalTrousers);
assert.equal(wardrobe.setDyeColor('#000000', TEE), true);
const black = drawLog.at(-1).image;
assert.ok(pixel(black, 0)[0] <= 16 && pixel(black, 0)[0] > pixel(black, 1)[0],
  'Near-black fabric retains a small reflected-light range');

// Shape changes have new immutable image identities; geometry is left alone.
const reshaped = fixture([255,255,255,255], [180,180,180,255]);
wardrobe.fitParts = () => [{ image: reshaped, x: -7, y: 41, joint: null }];
wardrobe.draw(context);
assert.equal(drawLog.at(-1).x, -7); assert.equal(drawLog.at(-1).y, 41);
assert.notEqual(drawLog.at(-1).image, reshaped);
const afterFit = allocations;
wardrobe.draw(context);
assert.equal(allocations, afterFit, 'Unchanged fit/color remains cached');
delete wardrobe.fitParts;

// A failed canvas conversion or draw cannot commit a new appearance.
let beforeFailure = wardrobe.getItemState(TEE).color;
let eventsBeforeFailure = events.length;
brokenRaster = true;
assert.equal(wardrobe.setDyeColor('#123456', TEE), false);
assert.equal(wardrobe.getItemState(TEE).color, beforeFailure);
assert.equal(events.length, eventsBeforeFailure);
brokenRaster = false;
rig.fail = true;
assert.equal(wardrobe.setDyeColor('#654321', TEE), false);
assert.equal(wardrobe.getItemState(TEE).color, beforeFailure);
assert.equal(events.length, eventsBeforeFailure);
rig.fail = false;

assert.equal(wardrobe.setDyeColor('#FFFFFF', TEE), true);
assert.equal(drawLog.at(-1).image, shirt, 'Restoring the default uses the exact source image');
assert.equal(wardrobe.setDyeColor('#4C4E58', PANTS), true);
assert.equal(drawLog.at(-2).image, trousers);
wardrobe.setEquipped(false, TEE);
assert.equal(wardrobe.setDyeColor('#CC8800', TEE), true);
assert.equal(wardrobe.getItemState(TEE).equipped, false, 'Changing dye does not secretly equip an item');
assert.equal(wardrobe.getItemState(PANTS).equipped, true);
assert.deepEqual([...shirt.pixels], originalShirt);
assert.deepEqual([...trousers.pixels], originalTrousers);
console.log('PASS: isolated previews, explicit color commit, RGB/shading/alpha, independent garments, immutable sources, fit caches, failure rollback and exact native restore');
