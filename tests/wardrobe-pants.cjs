// Behavioral/geometry regression for the separate shirt and trousers.
// Run: node tests/wardrobe-pants.cjs (Node built-ins only).
// Real SVG manifests are loaded; geometry uses the production body/wardrobe
// methods with deterministic body-row fixtures. Raster quality is visual QA.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const TEE = 'basic-white-tee', PANTS = 'basic-charcoal-pants';
const shapeKeys = ['head', 'neck', 'neckWidth', 'upperTorso', 'bust', 'ratio',
  'armWidth', 'armLength', 'handSize', 'waist', 'hips', 'thighs', 'calves'];
const neutral = Object.fromEntries(shapeKeys.map(key => [key, 100]));
const approx = (a, b, message, tolerance = 1e-7) =>
  assert.ok(Number.isFinite(a) && Math.abs(a - b) < tolerance, `${message}: ${a} != ${b}`);

function environment({ failImage, failFetch } = {}) {
  const events = [];
  const assetPath = src => path.join(root, decodeURIComponent(src.split('?')[0]));
  class Image {
    set src(src) {
      this.url = src;
      queueMicrotask(() => {
        if (failImage?.(src)) return this.onerror(new Error('Injected image failure'));
        try {
          const svg = fs.readFileSync(assetPath(src), 'utf8');
          this.width = this.naturalWidth = +/\bwidth="(\d+)"/.exec(svg)[1];
          this.height = this.naturalHeight = +/\bheight="(\d+)"/.exec(svg)[1];
          this.onload();
        } catch (error) { this.onerror(error); }
      });
    }
  }
  class CustomEvent { constructor(type, options) { this.type = type; this.detail = options.detail; } }
  const window = { dispatchEvent: event => events.push(event) };
  const sandbox = {
    window, Image, CustomEvent, console,
    document: { createElement() { throw new Error('Unexpected pixel allocation in geometry test'); } },
    fetch: async src => {
      if (failFetch?.(src)) return { ok: false, status: 503 };
      return { ok: true, json: async () => JSON.parse(fs.readFileSync(assetPath(src), 'utf8')) };
    }
  };
  for (const filename of ['rig/rig.js', 'rig/body-shape.js', 'clothes/wardrobe.js']) {
    vm.runInNewContext(fs.readFileSync(path.join(root, filename), 'utf8'), sandbox, { filename });
  }
  const config = JSON.parse(fs.readFileSync(path.join(root, 'rig/rig.json'), 'utf8'));
  const rig = {
    config, canvas: config.canvas, renders: 0, angles: {},
    render() { this.renders++; },
    ancestors: window.DressLabRig.prototype.ancestors
  };
  const wardrobe = new window.DressLabWardrobe(rig);
  return { window, events, rig, wardrobe };
}

function bodyFixture(window, rig) {
  const shape = Object.create(window.DressLabBodyShape.prototype);
  Object.assign(shape, neutral, {
    basePivots: structuredClone(rig.config.pivots), baseLayers: new Map(),
    sources: new Map(), hipInfluence: 0.35, kneeInfluence: 0.25,
    ratioAnchors: { top: 1013.25, hip: 1367.75, bottom: 2050 },
    canvasesBuilt: 0
  });
  const source = (filename, y, bottom, axisAt) => {
    const h = bottom - y + 1;
    const rows = Array.from({ length: h }, (_, index) => {
      const yy = y + index, axis = axisAt(yy);
      return { y: yy, left: axis - 40, right: axis + 40, axis,
        smoothLeft: axis - 39, smoothRight: axis + 41 };
    });
    const value = { filename, y, h, x: 0, w: 650, rows };
    shape.sources.set(filename, value);
    return value;
  };
  source('07-LowerTorso.PNG', 1140, 1285, () => shape.basePivots.torso.x);
  source('09-Hips.PNG', 1257, 1395, () => shape.basePivots.torso.x);
  for (const side of ['L', 'R']) {
    const hip = shape.basePivots['hip' + side], knee = shape.basePivots['knee' + side];
    source(side === 'L' ? '10-UpperLeg(L).PNG' : '11-UpperLeg(R).PNG', 1310, 1670,
      y => hip.x + (knee.x - hip.x) * Math.max(0, Math.min(1, (y - hip.y) / (knee.y - hip.y))));
    source(side === 'L' ? '12-LowerLeg(L).PNG' : '13-LowerLeg(R).PNG', 1570, 2050, () => knee.x);
  }
  // Only pixel rasterization is replaced: capture the real inverse map and
  // source image identity so composed-fit behavior remains observable.
  shape.inverseSprite = (base, bounds, inversePoint) => {
    shape.canvasesBuilt++;
    const x = Math.floor(bounds.left) - 2, y = Math.floor(bounds.top) - 2;
    return { ...base, x, y, image: { width: Math.ceil(bounds.right) - x + 2,
      height: Math.ceil(bounds.bottom) - y + 2, source: base.image, inversePoint } };
  };
  window.dressLabBodyShape = shape;
  return shape;
}

function drawRecorder() {
  const drawn = [];
  const rotations = [];
  return { drawn, rotations, save() {}, restore() {}, translate() {},
    rotate(angle) { rotations.push(angle); },
    drawImage(image) { drawn.push(image); } };
}

async function lifecycle() {
  const env = environment(), { wardrobe, events, rig } = env;
  assert.equal(await wardrobe.load(), true);
  assert.ok(wardrobe.getItemState(TEE).ready && wardrobe.getItemState(PANTS).ready);
  assert.ok(wardrobe.getItemState(TEE).equipped && wardrobe.getItemState(PANTS).equipped);
  assert.deepEqual(events.filter(event => event.type === 'dresslab:wardrobe-ready')
    .map(event => event.detail.id), [TEE, PANTS]);
  assert.equal(wardrobe.setEquipped(false), true, 'Legacy default toggles only the shirt');
  assert.equal(wardrobe.getItemState(TEE).equipped, false);
  assert.equal(wardrobe.getItemState(PANTS).equipped, true);
  const eventCount = events.length, renderCount = rig.renders;
  assert.equal(wardrobe.setEquipped(false), true);
  assert.equal(events.length, eventCount, 'Unchanged selection emits no duplicate change');
  assert.equal(rig.renders, renderCount, 'Unchanged selection does not repaint');
  assert.equal(wardrobe.setEquipped(false, 'missing-item'), false);
  assert.equal(wardrobe.getItemState('missing-item'), null);
  wardrobe.setEquipped(true, TEE);
  wardrobe.setEquipped(false, PANTS);
  assert.equal(wardrobe.getItemState(TEE).equipped, true);
  assert.equal(wardrobe.getItemState(PANTS).equipped, false);
  wardrobe.setEquipped(true, PANTS);
  let ctx = drawRecorder();
  wardrobe.draw(ctx);
  assert.deepEqual(ctx.drawn, [...wardrobe.pants.parts, ...wardrobe.parts].map(part => part.image),
    'Trousers must be drawn before the shirt overlapping the waistband');
  wardrobe.unequipAll();
  assert.equal(wardrobe.getItemState(TEE).equipped, false);
  assert.equal(wardrobe.getItemState(PANTS).equipped, false);
  ctx = drawRecorder(); wardrobe.draw(ctx);
  assert.equal(ctx.drawn.length, 0);
  assert.deepEqual(events.filter(event => event.type === 'dresslab:wardrobe-change')
    .map(event => [event.detail.id, event.detail.equipped]),
  [[TEE, false], [TEE, true], [PANTS, false], [PANTS, true], [TEE, false], [PANTS, false]]);

  for (const [failed, available, failure] of [
    [PANTS, TEE, '/left-lower-leg.svg'], [TEE, PANTS, '/torso.svg']
  ]) {
    const broken = environment({ failImage: src => src.includes(failure) });
    assert.equal(await broken.wardrobe.load(), true, 'The surviving garment remains available');
    assert.equal(broken.wardrobe.getItemState(failed).ready, false);
    assert.equal(broken.wardrobe.getItemState(available).ready, true);
    assert.equal(broken.wardrobe.setEquipped(true, failed), false);
    const errors = broken.events.filter(event => event.type === 'dresslab:wardrobe-error');
    assert.equal(errors.length, 1); assert.equal(errors[0].detail.id, failed);
    assert.ok(errors[0].detail.message && broken.wardrobe.getItemState(failed).error);
    const draws = drawRecorder(); broken.wardrobe.draw(draws);
    assert.equal(draws.drawn.length, available === TEE ? 3 : 5,
      'A failed shirt must not block pants rendering, or vice versa');
    assert.equal(broken.wardrobe.setEquipped(false, available), true);
    assert.equal(broken.events.at(-1).detail.id, available);
  }
  const unavailable = environment({ failFetch: () => true });
  assert.equal(await unavailable.wardrobe.load(), false);
  assert.equal(unavailable.events.filter(event => event.type === 'dresslab:wardrobe-error').length, 2);
  assert.ok(unavailable.rig.renders > 0, 'The base doll still receives its render after load failures');
  return env;
}

function geometry({ window, wardrobe, rig }) {
  const shape = bodyFixture(window, rig);
  const parts = wardrobe.pants.parts;
  assert.equal(wardrobe.fitPantsParts(), parts, 'Neutral trousers preserve original source images');
  assert.equal(shape.canvasesBuilt, 0);
  const extremes = [
    { waist: 85, hips: 90, thighs: 90, calves: 92, ratio: 82 },
    { waist: 120, hips: 120, thighs: 125, calves: 112, ratio: 118 },
    { waist: 85, hips: 90, thighs: 125, calves: 92, ratio: 82 },
    { waist: 120, hips: 120, thighs: 90, calves: 112, ratio: 118 }
  ];
  for (const values of extremes) {
    Object.assign(shape, neutral, values);
    const fitted = wardrobe.fitPantsParts();
    for (const part of parts) {
      const map = wardrobe.pantsMapping(part, shape);
      const output = fitted.find(value => value.id === part.id);
      assert.equal(output.image.source, part.image, 'Fit must start from immutable original artwork');
      let previousY = -Infinity;
      for (let row = 0; row <= part.image.height; row += 3.25) {
        const y = part.y + row;
        for (const x of [part.x, part.x + part.image.width / 2, part.x + part.image.width]) {
          const mapped = map.forward(x, y), restored = map.inverse(...mapped);
          approx(restored[0], x, 'Inverse fit restores source X');
          approx(restored[1], y, 'Inverse fit restores source Y');
          approx(mapped[1], shape.mapRatioY(y), 'Body ratio must be applied exactly once');
          const rasterSource = output.image.inversePoint(...mapped);
          approx(rasterSource[0], x, 'The fitted sprite uses the same inverse X map');
          approx(rasterSource[1], y, 'The fitted sprite uses the same inverse Y map');
        }
        const mappedY = map.forward(part.x, y)[1];
        assert.ok(mappedY > previousY, 'Ratio must preserve vertical order');
        previousY = mappedY;
      }
    }
    const count = shape.canvasesBuilt;
    rig.angles = { torso: 8, hipL: -22, kneeL: 56, hipR: 8, kneeR: 38 };
    assert.equal(wardrobe.fitPantsParts(), fitted, 'Pose-only changes reuse fitted clothing');
    assert.equal(shape.canvasesBuilt, count, 'Animation cannot allocate new clothing canvases');
  }

  // At the knee centerline, width cannot add an extra horizontal movement.
  // The complete translation must equal the body's hip-driven pivot offset.
  Object.assign(shape, neutral, { hips: 120, thighs: 125, calves: 112, ratio: 118 });
  for (const side of ['L', 'R']) {
    const lower = parts.find(part => part.fit === 'lower' && part.side === side);
    const knee = shape.basePivots['knee' + side], hip = shape.basePivots['hip' + side];
    const expectedOffset = (hip.x - shape.basePivots.torso.x) * (1.2 * 1.0875 - 1);
    const map = wardrobe.pantsMapping(lower, shape);
    approx(map.forward(knee.x, knee.y)[0], knee.x + expectedOffset,
      'Knee follows the same pelvis translation as both leg sprites', 0.0002);
    const y = 1870, left = map.forward(knee.x - 10, y), right = map.forward(knee.x + 10, y);
    const originalBody = shape.sources.get(lower.bodyPart);
    const expectedWidth = 20 * shape.factor('lower', side, y, originalBody);
    approx(right[0] - left[0], expectedWidth, 'Calf fit must use the original body foot endpoint');
    const truncated = { ...originalBody, y: lower.y, h: lower.image.height };
    assert.ok(Math.abs(shape.factor('lower', side, y, truncated) * 20 - expectedWidth) > 0.2,
      'Fixture must catch accidentally using the shorter trouser endpoint');
  }
  // The waistband reaches the lower torso: waist changes must affect its top.
  const pelvis = parts.find(part => part.fit === 'pelvis');
  Object.assign(shape, neutral, { waist: 120 });
  const waistMap = wardrobe.pantsMapping(pelvis, shape), y = 1240;
  const bandLeft = waistMap.forward(280, y), bandRight = waistMap.forward(380, y);
  approx(bandRight[0] - bandLeft[0],
    100 * shape.factor('lowerTorso', null, y, shape.sources.get('07-LowerTorso.PNG')),
    'Waistband follows lower-torso shaping above the pelvis');

  Object.assign(shape, neutral);
  assert.equal(wardrobe.fitPantsParts(), parts);
  shape.thighs = 101;
  const thighFit = wardrobe.fitPantsParts(), count = shape.canvasesBuilt;
  assert.notEqual(thighFit, parts, 'Thigh-only changes invalidate the neutral cache');
  shape.calves = 101;
  const calfFit = wardrobe.fitPantsParts();
  assert.notEqual(calfFit, thighFit, 'Calf-only changes invalidate the fit cache');
  assert.ok(shape.canvasesBuilt > count);
  shape.head = 110;
  assert.equal(wardrobe.fitPantsParts(), calfFit, 'Unrelated head edits do not rebuild trousers');
  Object.assign(shape, neutral);
  assert.equal(wardrobe.fitPantsParts(), parts, 'Reset returns exact original sprites');
  window.dressLabBodyShape = null;
  assert.equal(wardrobe.fitPantsParts(), parts, 'Clothing remains usable without shape controls');
}

lifecycle().then(geometry).then(() => {
  console.log('PASS: independent separates, per-item failures/events, draw order, fit inverse/ratio/pivots, body foot reference, slider cache and exact reset');
}).catch(error => { console.error(error); process.exitCode = 1; });
