const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Synthetic registered assets keep the test deterministic without a browser.
// The recorder retains real affine transforms, and tint buffers retain RGBA.
const identity = () => [1, 0, 0, 1, 0, 0];
const multiply = (a, b) => [
  a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
  a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
  a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]
];
const point = (m, x, y) => ({ x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] });
const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-7, message);
const json = value => JSON.parse(JSON.stringify(value));
let canvasCount = 0, failContextAt = -1, timerCount = 0;
const pendingImages = [], events = [], warnings = [];

function fixture(source, x, y) {
  x -= 146; y -= 729;
  const ellipse = (cx, cy, rx, ry) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;
  let alpha = 0, rgb = [255, 255, 255];
  if (source?.includes('Sclera')) alpha = ellipse(91, 73, 59, 46) || ellipse(275, 73, 59, 46) ? 255 : 0;
  if (source?.includes('Eyelashes')) alpha = ellipse(91, 73, 62, 49) || ellipse(275, 73, 62, 49) ? 255 : 0;
  if (source?.includes('Pupil')) {
    alpha = ellipse(105, 71, 40, 40) || ellipse(261, 71, 40, 40) ? 255 : 0;
    rgb = ellipse(105, 71, 8, 16) || ellipse(261, 71, 8, 16) ? [24, 24, 24] : [170, 130, 130];
  }
  if (source?.includes('Highlights')) alpha = ellipse(109, 40, 9, 11) || ellipse(257, 40, 9, 11) ? 255 : 0;
  return [...rgb, alpha];
}

function createContext(canvas) {
  let matrix = identity();
  const stack = [];
  return {
    canvas, paints: [], paths: [], globalCompositeOperation: 'source-over', globalAlpha: 1,
    save() { stack.push({ matrix: matrix.slice(), alpha: this.globalAlpha, op: this.globalCompositeOperation }); },
    restore() { const saved = stack.pop(); matrix = saved.matrix; this.globalAlpha = saved.alpha; this.globalCompositeOperation = saved.op; },
    translate(x, y) { matrix = multiply(matrix, [1, 0, 0, 1, x, y]); },
    scale(x, y) { matrix = multiply(matrix, [x, 0, 0, y, 0, 0]); },
    rotate(r) { matrix = multiply(matrix, [Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0]); },
    setTransform(...values) { matrix = values; },
    clearRect() {},
    drawImage(image, ...args) {
      this.paints.push({ image, args, matrix: matrix.slice(), op: this.globalCompositeOperation });
      if (image.path) this.source = { path: image.path, x: args.length === 8 ? args[0] : 0, y: args.length === 8 ? args[1] : 0 };
      else if (image.context?.source) this.source = image.context.source;
    },
    getImageData(x, y, w, h) {
      if (this.pixels) return { data: this.pixels.slice(), width: w, height: h };
      const data = new Uint8ClampedArray(w * h * 4);
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
        data.set(fixture(this.source?.path, (this.source?.x || 0) + i + x + 0.5,
          (this.source?.y || 0) + j + y + 0.5), (j * w + i) * 4);
      }
      return { data, width: w, height: h };
    },
    createImageData(w, h) { return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h }; },
    putImageData(data) { this.pixels = data.data.slice(); },
    beginPath() {}, closePath() {},
    moveTo(...args) { this.paths.push({ type: 'move', args, matrix: matrix.slice() }); },
    lineTo(...args) { this.paths.push({ type: 'line', args, matrix: matrix.slice() }); },
    bezierCurveTo(...args) { this.paths.push({ type: 'bezier', args, matrix: matrix.slice() }); },
    quadraticCurveTo(...args) { this.paths.push({ type: 'quadratic', args, matrix: matrix.slice() }); },
    ellipse(...args) { this.paths.push({ type: 'ellipse', args, matrix: matrix.slice() }); },
    arc(...args) { this.paths.push({ type: 'arc', args, matrix: matrix.slice() }); },
    stroke() {}, fill() {}, clip() {}
  };
}

function createCanvas() {
  const canvas = { width: 0, height: 0, id: ++canvasCount };
  canvas.context = createContext(canvas);
  canvas.getContext = () => canvas.id === failContextAt ? null : canvas.context;
  return canvas;
}
class FakeImage {
  set src(value) {
    this.path = value; this.naturalWidth = 1206; this.naturalHeight = 2622;
    const finish = () => value.includes('missing') ? this.onerror?.() : this.onload?.();
    if (value.includes('slow')) pendingImages.push(finish);
    else queueMicrotask(finish);
  }
}
const canvas = Object.assign(createCanvas(), {
  width: 1206, height: 2622,
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 402, height: 874 }),
  addEventListener() {}, removeEventListener() {}, setPointerCapture() {}, releasePointerCapture() {}
});
const rig = {
  canvas, angles: { torso: 0 }, root: { x: 0, y: 0, scaleX: 1, scaleY: 1 },
  rootAnchor: { x: 328.6, y: 2050 }, config: { pivots: { torso: { x: 328.6, y: 1166.5 } } },
  render() { this.eyes?.draw(canvas.context); }
};
const bodyShape = { head: 100, headNeckAnchors: { x: 328.6, jawY: 931 }, neckOffsetY: () => 0 };
const windowHandlers = new Map();
const sandbox = {
  window: {
    matchMedia: () => ({ matches: false }),
    dispatchEvent(event) { events.push(event); for (const fn of windowHandlers.get(event.type) || []) fn(event); return true; },
    addEventListener(type, fn) { if (!windowHandlers.has(type)) windowHandlers.set(type, []); windowHandlers.get(type).push(fn); },
    removeEventListener() {}
  },
  document: { hidden: false, createElement: createCanvas, addEventListener() {}, removeEventListener() {} },
  Image: FakeImage, CustomEvent: class { constructor(type, options = {}) { this.type = type; this.detail = options.detail; } },
  performance: { now: () => 2000 }, requestAnimationFrame: () => ++timerCount, cancelAnimationFrame() {},
  setTimeout: () => ++timerCount, clearTimeout() {}, Math,
  console: { ...console, warn: (...args) => warnings.push(args) }
};
vm.createContext(sandbox);
function loadScript(name) { vm.runInContext(fs.readFileSync(path.join(__dirname, '..', name), 'utf8'), sandbox, { filename: name }); }
function screenshot(eyes) {
  const context = createCanvas().context;
  eyes.draw(context);
  return context.paints;
}

(async () => {
  loadScript('rig/eye-shapes.js');
  loadScript('rig/eyes.js');
  const base = sandbox.window.DressLabEyeShapes[0];
  const variant = (id, prefix = id, extra = {}) => ({ ...json(base), id, label: id,
    sources: Object.fromEntries(Object.entries(base.sources).map(([key, value]) => [key, prefix + '/' + value])), ...extra });
  sandbox.window.DressLabEyeShapes = [base, variant('slow'), variant('fast'), variant('missing'), variant('buffer-failure'),
    variant('wide', 'wide', { box: { x: 126, y: 709, w: 408, h: 170 },
      eye: { ...json(base.eye), maxX: 25, maxY: 18 } })];
  const eyes = new sandbox.window.DressLabEyes(rig, canvas);
  eyes.bodyShape = bodyShape;
  await eyes.load();
  assert.deepEqual(json(eyes.getAppearance()), { eyeSize: 100, eyeSpacing: 100, eyeColor: null, eyeShape: 'eyes01' });
  const returned = eyes.getAppearance(); returned.eyeSize = 1;
  assert.equal(eyes.getAppearance().eyeSize, 100, 'Appearance snapshots cannot mutate the renderer');

  // At each size/spacing extreme, all four layers of each eye must share an
  // affine transform. The pair stays symmetric and cannot overlap inward.
  for (const eyeSize of [75, 100, 125]) for (const eyeSpacing of [75, 100, 125]) {
    assert.equal(eyes.setAppearance({ eyeSize, eyeSpacing }), true);
    const draws = screenshot(eyes);
    assert.equal(draws.length, 8);
    for (let eye = 0; eye < 2; eye++) {
      const group = draws.slice(eye * 4, eye * 4 + 4);
      for (const draw of group) assert.deepEqual(draw.matrix, group[0].matrix, 'Eye layers drifted apart');
      near(group[0].matrix[0], eyeSize / 100, 'Eye width must use requested scale');
      near(group[0].matrix[3], eyeSize / 100, 'Eye height must use requested scale');
    }
    const left = eyes.eyeParts[0], right = eyes.eyeParts[1];
    const leftCentre = point(draws[0].matrix, eyes.box.x + left.sclera.cx, eyes.box.y + left.sclera.cy);
    const rightCentre = point(draws[4].matrix, eyes.box.x + right.sclera.cx, eyes.box.y + right.sclera.cy);
    near((leftCentre.x + rightCentre.x) / 2, eyes.box.x + (left.sclera.cx + right.sclera.cx) / 2,
      'Spacing must not move the pair off the face centre');
    const leftEdge = point(draws[0].matrix, eyes.box.x + left.eyelashes.x1, eyes.box.y);
    const rightEdge = point(draws[4].matrix, eyes.box.x + right.eyelashes.x0, eyes.box.y);
    assert.ok(rightEdge.x > leftEdge.x, 'Maximum eye size at minimum spacing overlapped');
    const outerLeft = point(draws[0].matrix, eyes.box.x + left.eyelashes.x0, eyes.box.y);
    const outerRight = point(draws[4].matrix, eyes.box.x + right.eyelashes.x1, eyes.box.y);
    assert.ok(outerLeft.x >= base.faceBounds.left && outerRight.x <= base.faceBounds.right,
      'Large/wide eyes must stay within the head bounds');
  }
  const beforeInvalid = json(eyes.getAppearance());
  assert.equal(eyes.setAppearance({ eyeSize: 80, eyeColor: 'invalid' }), false);
  assert.deepEqual(json(eyes.getAppearance()), beforeInvalid, 'Invalid patches must be atomic');
  assert.equal(eyes.setAppearance({ eyeSize: NaN }), false);
  eyes.setAppearance({ eyeSize: -10, eyeSpacing: 1000 });
  assert.equal(eyes.getAppearance().eyeSize, 75);
  assert.equal(eyes.getAppearance().eyeSpacing, 125);

  // Iris color never changes the other assets or alpha; exact source pixels
  // remain available after repeated recoloring, and dark pupils stay dark.
  const original = eyes.sprites.pupil;
  const originalPixels = original.context.getImageData(0, 0, original.width, original.height).data;
  const otherLayers = { sclera: eyes.sprites.sclera, highlights: eyes.sprites.highlights, eyelashes: eyes.sprites.eyelashes };
  assert.equal(eyes.setAppearance({ eyeColor: '#32ab4e' }), true);
  assert.equal(eyes.getAppearance().eyeColor, '#32AB4E');
  const tintedPixels = eyes.sprites.pupil.context.pixels;
  assert.ok(tintedPixels, 'A separate tint buffer is required');
  let colored = 0, dark = 0;
  for (let i = 0; i < originalPixels.length; i += 4) {
    assert.equal(tintedPixels[i + 3], originalPixels[i + 3], 'Tint changed alpha');
    if (!originalPixels[i + 3]) continue;
    if (originalPixels[i] === 24) {
      assert.deepEqual(Array.from(tintedPixels.slice(i, i + 3)), [24, 24, 24], 'Tint erased the dark pupil'); dark++;
    } else { assert.ok(tintedPixels[i + 1] > tintedPixels[i], 'Green selection should produce a green iris'); colored++; }
  }
  assert.ok(colored && dark);
  for (const [key, image] of Object.entries(otherLayers)) assert.equal(eyes.sprites[key], image);
  eyes.setAppearance({ eyeColor: '#D9468B' });
  eyes.setAppearance({ eyeColor: null });
  assert.equal(eyes.sprites.pupil, original, 'Original color must restore the original sprite');
  assert.deepEqual(original.context.getImageData(0, 0, original.width, original.height).data, originalPixels);

  // Latest request wins even if an older image set finishes later. Missing
  // assets and buffer failures preserve the last complete, working shape.
  const slow = eyes.setShape('slow');
  assert.equal(await eyes.setShape('fast'), true);
  pendingImages.splice(0).forEach(finish => finish());
  assert.equal(await slow, false);
  assert.equal(eyes.getAppearance().eyeShape, 'fast');
  const stableSprites = eyes.sprites;
  assert.equal(await eyes.setShape('missing'), false);
  assert.equal(await eyes.setShape('unknown'), false);
  assert.equal(eyes.sprites, stableSprites);
  assert.equal(eyes.getAppearance().eyeShape, 'fast');
  failContextAt = canvasCount + 5; // Four source crops load, then buffer allocation fails.
  assert.equal(await eyes.setShape('buffer-failure'), false);
  failContextAt = -1;
  assert.equal(eyes.sprites, stableSprites, 'Failed composition setup must preserve the current shape');
  assert.equal(eyes.getAppearance().eyeShape, 'fast');
  eyes.reduced = true;
  eyes.setGaze(1, -1);
  assert.equal(await eyes.setShape('wide'), true);
  assert.equal(eyes.box.w, 408);
  assert.equal(eyes.irisBuffer.width, 408);
  near(eyes.targetX / eyes.eye.maxX, 1, 'Shape change should retain horizontal gaze direction');
  near(eyes.targetY / eyes.eye.maxY, -1, 'Shape change should retain vertical gaze direction');
  assert.equal(await eyes.setShape('eyes01'), true);
  eyes.setAppearance({ eyeSize: 100, eyeSpacing: 100 });

  // Controller-level tests are below; it owns nose/mouth and coordinates UI state.
  loadScript('rig/face.js');
  const face = new sandbox.window.DressLabFace(rig, bodyShape, eyes);
  assert.equal(face.setState({ eyeSize: 115, eyeSpacing: 90, noseSize: 80, mouthSize: 120, eyeColor: '#5588CC' }), true);
  assert.equal(face.getState().eyeSize, 115);
  assert.equal(eyes.getAppearance().eyeSize, 115);
  assert.equal(eyes.getAppearance().eyeColor, '#5588CC');
  const state = face.getState(); state.mouthSize = 1;
  assert.equal(face.getState().mouthSize, 120);
  const beforeBadFacePatch = json(face.getState());
  assert.equal(face.setState({ noseSize: 110, eyeColor: 'broken' }), false);
  assert.deepEqual(json(face.getState()), beforeBadFacePatch);
  const open = createCanvas().context;
  face.draw(open);
  eyes.blinkValue = 0.8;
  const blinking = createCanvas().context;
  face.draw(blinking);
  assert.ok(open.paths.length > 0, 'Nose and mouth must draw visible paths');
  assert.deepEqual(blinking.paths, open.paths, 'Nose and mouth must not squash during blinking');
  eyes.blinkValue = 0;
  bodyShape.head = 75;
  bodyShape.neckOffsetY = () => -12;
  const smallerHead = createCanvas().context;
  face.draw(smallerHead);
  for (let i = 0; i < open.paths.length; i++) {
    const start = point(open.paths[i].matrix, 0, 0);
    const changed = point(smallerHead.paths[i].matrix, 0, 0);
    near(changed.x, bodyShape.headNeckAnchors.x + (start.x - bodyShape.headNeckAnchors.x) * 0.75,
      'Face feature must follow head scale');
    near(changed.y, bodyShape.headNeckAnchors.jawY + (start.y - bodyShape.headNeckAnchors.jawY) * 0.75 - 12,
      'Face feature must follow head and neck transform');
  }
  assert.equal(await face.selectEyeShape('missing'), false);
  assert.equal(face.getState().eyeShape, eyes.getAppearance().eyeShape);
  assert.equal(await face.reset(), true);
  assert.deepEqual(json(face.getState()), { eyeSize: 100, eyeSpacing: 100, eyeColor: null, eyeShape: 'eyes01', noseSize: 100, mouthSize: 100 });
  assert.equal(bodyShape.head, 75, 'Face reset must not reset the body');
  await face.selectEyeShape('fast');
  sandbox.window.DressLabEyeShapes[0] = variant('eyes01', 'reset-slow');
  const pendingReset = face.reset();
  face.setState({ mouthSize: 113, eyeSize: 110, eyeColor: '#123456' });
  pendingImages.splice(0).forEach(finish => finish());
  assert.equal(await pendingReset, true);
  assert.equal(face.getState().mouthSize, 113, 'A completed reset must preserve edits made during image loading');
  assert.equal(face.getState().eyeSize, 110);
  assert.equal(face.getState().eyeColor, '#123456');
  await face.selectEyeShape('fast');
  const supersededReset = face.reset();
  assert.equal(await face.selectEyeShape('fast'), true);
  pendingImages.splice(0).forEach(finish => finish());
  assert.equal(await supersededReset, false);
  assert.equal(face.getState().eyeShape, 'fast', 'A later selection must cancel an in-flight reset');

  // The renderer and controller must agree on fallback choices when the
  // optional catalog script is missing, empty or contains malformed entries.
  for (const catalog of [undefined, [], 'invalid', [null, {}, { id: '', label: 'empty' }, { id: 12, label: 'invalid' }]]) {
    if (catalog === undefined) delete sandbox.window.DressLabEyeShapes;
    else sandbox.window.DressLabEyeShapes = catalog;
    assert.deepEqual(json(eyes.getShapes().map(shape => shape.id)), ['eyes01']);
    assert.deepEqual(json(face.eyeShapes.map(shape => shape.id)), ['eyes01']);
    face.setState({ eyeSize: 85, mouthSize: 115, eyeColor: '#987654' });
    assert.equal(await face.reset(), true, 'Catalog fallback must support a successful face reset');
    assert.equal(face.getState().eyeShape, 'eyes01');
    assert.equal(face.getState().eyeSize, 100);
    assert.equal(face.getState().mouthSize, 100);
    assert.equal(face.getState().eyeColor, null);
  }
  sandbox.window.DressLabEyeShapes = [null, base, { ...base, label: 'duplicate' }, {}, variant('custom')];
  assert.deepEqual(json(face.eyeShapes.map(shape => shape.id)), ['eyes01', 'custom'], 'Malformed and duplicate entries must be filtered');
  sandbox.window.DressLabEyeShapes = [variant('custom')];
  assert.equal(await face.reset(), true, 'Reset should use the first valid option if the original option was replaced');
  assert.equal(face.getState().eyeShape, 'custom');

  const noEyes = new sandbox.window.DressLabFace({ render() {} }, bodyShape, null);
  assert.equal(noEyes.eyesAvailable, false);
  assert.equal(noEyes.setState({ noseSize: 115, mouthSize: 85 }), true);
  assert.equal(noEyes.setState({ noseSize: 90, eyeSize: 120 }), false);
  assert.equal(noEyes.getState().noseSize, 115, 'Unavailable eye renderer cannot partially apply a mixed patch');
  assert.equal(await noEyes.reset(), true, 'Nose/mouth reset remains available when eye assets failed');
  assert.equal(noEyes.getState().noseSize, 100);
  assert.ok(events.some(event => event.type === 'dresslab:face-change'));
  eyes.dispose();
  console.log('PASS: face geometry extremes, complete layer registration, original/tinted iris isolation, atomic/racing shape loads, per-shape bounds/gaze, catalog fallbacks, nose/mouth head transform, blink isolation and face-only reset');
})().catch(error => { console.error(error); process.exitCode = 1; });
