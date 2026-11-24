// Regression for sleeve geometry, source reset and animation-frame caching.
// Uses the actual body/wardrobe code; no browser or external package required.
// Run: node tests/wardrobe-fit.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
let canvases = 0;
class Canvas {
  constructor() { this.width = this.height = 1; this.draws = []; canvases++; }
  getContext() {
    let matrix = [1, 0, 0, 1, 0, 0];
    return {
      setTransform(...values) { matrix = values; },
      drawImage: (image, ...args) => this.draws.push({ image, args, matrix: [...matrix] })
    };
  }
}
const window = {};
const sandbox = { window, document: { createElement: () => new Canvas() }, console };
for (const filename of ['rig/body-shape.js', 'clothes/wardrobe.js']) {
  vm.runInNewContext(fs.readFileSync(path.join(root, filename), 'utf8'), sandbox, { filename });
}
const config = JSON.parse(fs.readFileSync(path.join(root, 'rig/rig.json'), 'utf8'));
const shape = Object.create(window.DressLabBodyShape.prototype);
for (const key of ['head', 'neck', 'neckWidth', 'upperTorso', 'bust', 'ratio',
  'armWidth', 'armLength', 'handSize', 'waist', 'hips', 'thighs', 'calves']) shape[key] = 100;
Object.assign(shape, {
  baseLayers: new Map(), basePivots: structuredClone(config.pivots),
  ratioAnchors: { top: 1013.25, hip: 1367.75, bottom: 2050 },
  hipInfluence: 0.35, kneeInfluence: 0.25, canvasesBuilt: 0
});
window.dressLabBodyShape = shape;
const rig = { config, render() {}, angles: {} };
const wardrobe = new window.DressLabWardrobe(rig);
const item = JSON.parse(fs.readFileSync(path.join(root, 'clothes/basic-white-tee/item.json'), 'utf8'));
wardrobe.parts = item.parts.map(part => {
  const svg = fs.readFileSync(path.join(root, 'clothes/basic-white-tee', part.src), 'utf8');
  return { ...part, image: { width: +/width="(\d+)"/.exec(svg)[1], height: +/height="(\d+)"/.exec(svg)[1] } };
});

// Follow a source marker through the real offscreen-canvas blits. This tests
// their combined output mapping, including the split at the shoulder line.
function positions(image, source, point) {
  if (image === source) return [point];
  return (image.draws || []).flatMap(draw => {
    const { args, matrix: [a, b, c, d, e, f] } = draw;
    const rect = args.length === 2
      ? [0, 0, draw.image.width, draw.image.height, args[0], args[1], draw.image.width, draw.image.height]
      : args;
    const [sx, sy, sw, sh, dx, dy, dw, dh] = rect;
    return positions(draw.image, source, point).filter(([x, y]) =>
      x >= sx && x < sx + sw && y >= sy && y < sy + sh).map(([x, y]) => {
      const px = dx + (x - sx) * dw / sw, py = dy + (y - sy) * dh / sh;
      return [a * px + c * py + e, b * px + d * py + f];
    });
  });
}
assert.equal(wardrobe.fitParts(), wardrobe.parts, 'Neutral fit must retain original source images');
for (const [armWidth, armLength, ratio] of [[125, 120, 118], [80, 85, 82], [125, 85, 118]]) {
  Object.assign(shape, { armWidth, armLength, ratio });
  for (const side of ['L', 'R']) {
    const base = shape.basePivots['shoulder' + side];
    // Include a translated shoulder to catch fitting around a stale pivot.
    config.pivots['shoulder' + side].x = base.x + (side === 'L' ? -12 : 12);
    config.pivots['shoulder' + side].y = shape.mapRatioY(base.y);
  }
  const fitted = wardrobe.fitParts();
  for (const part of wardrobe.parts.filter(part => part.joint !== 'torso')) {
    const output = fitted.find(next => next.id === part.id);
    const side = part.joint === 'shoulderL' ? 'L' : 'R';
    const start = shape.basePivots[part.joint], end = shape.basePivots['elbow' + side];
    const length = Math.hypot(end.x - start.x, end.y - start.y);
    const ux = (end.x - start.x) / length, uy = (end.y - start.y) / length;
    for (const point of [[20, 20], [50, 70], [70, 140]]) {
      const dx = part.x + point[0] - start.x, dy = part.y + point[1] - start.y;
      const along = (dx * ux + dy * uy) * armLength / 100;
      const across = (-dx * uy + dy * ux) * armWidth / 100;
      const expected = [config.pivots[part.joint].x + along * ux - across * uy,
        shape.mapRatioY(start.y + along * uy + across * ux)];
      const actual = positions(output.image, part.image, point);
      assert.equal(actual.length, 1, 'Each marker must survive exactly one ratio band');
      actual[0][0] += output.x; actual[0][1] += output.y;
      for (let axis = 0; axis < 2; axis++) assert.ok(Math.abs(actual[0][axis] - expected[axis]) < 1e-7,
        `Sleeve must follow bone width/length and exactly one ratio transform: ${part.id}`);
    }
  }
  const count = canvases;
  rig.angles = { torso: 6, shoulderL: 18, shoulderR: -18 };
  assert.equal(wardrobe.fitParts(), fitted, 'Pose changes must reuse fitted sprites');
  assert.equal(canvases, count, 'Animation frames must not rebuild garment canvases');
}
Object.assign(shape, { armWidth: 100, armLength: 100, ratio: 100 });
assert.equal(wardrobe.fitParts(), wardrobe.parts, 'Reset must restore the exact original images');
window.dressLabBodyShape = null;
assert.equal(wardrobe.fitParts(), wardrobe.parts, 'Garment remains usable without shape controls');
console.log('PASS: sleeve bone geometry, shoulder translation, ratio boundary, exact reset and cached animation frames');
