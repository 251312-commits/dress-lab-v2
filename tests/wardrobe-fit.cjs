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
// Keep the production geometric inverse map while replacing only its pixel
// rasterizer. Real-image coverage and raster quality have a separate visual QA.
shape.inverseSprite = (base, bounds, inversePoint) => {
  const x = Math.floor(bounds.left) - 2, y = Math.floor(bounds.top) - 2;
  canvases++;
  return { ...base, x, y, image: {
    width: Math.ceil(bounds.right) - x + 2,
    height: Math.ceil(bounds.bottom) - y + 2,
    base, inversePoint, origin: [x, y]
  } };
};
window.dressLabBodyShape = shape;
const rig = { config, render() {}, angles: {} };
const wardrobe = new window.DressLabWardrobe(rig);
const item = JSON.parse(fs.readFileSync(path.join(root, 'clothes/basic-white-tee/item.json'), 'utf8'));
wardrobe.parts = item.parts.map(part => {
  const svg = fs.readFileSync(path.join(root, 'clothes/basic-white-tee', part.src), 'utf8');
  return { ...part, image: { width: +/width="(\d+)"/.exec(svg)[1], height: +/height="(\d+)"/.exec(svg)[1] } };
});

// Trace an output position back through the actual inverse map and ratio
// blits. This checks the combined transform, not just a helper's arguments.
function sourcesAt(image, source, point) {
  if (image === source) return [point];
  if (image.inversePoint) {
    const p = image.inversePoint(point[0] + image.origin[0], point[1] + image.origin[1]);
    return sourcesAt(image.base.image, source,
      [p[0] - (image.base.x || 0), p[1] - (image.base.y || 0)]);
  }
  return (image.draws || []).flatMap(draw => {
    const { args, matrix: [a, b, c, d, e, f] } = draw;
    const rect = args.length === 2
      ? [0, 0, draw.image.width, draw.image.height, args[0], args[1], draw.image.width, draw.image.height]
      : args;
    const [sx, sy, sw, sh, dx, dy, dw, dh] = rect;
    const determinant = a * d - b * c;
    const qx = point[0] - e, qy = point[1] - f;
    const x = (d * qx - c * qy) / determinant, y = (-b * qx + a * qy) / determinant;
    if (x < dx || x >= dx + dw || y < dy || y >= dy + dh) return [];
    return sourcesAt(draw.image, source, [sx + (x - dx) * sw / dw, sy + (y - dy) * sh / dh]);
  });
}
function close(actual, expected, message, tolerance = 1e-6) {
  assert.equal(actual.length, expected.length);
  for (let axis = 0; axis < actual.length; axis++) {
    assert.ok(Math.abs(actual[axis] - expected[axis]) < tolerance,
      `${message}: ${actual} != ${expected}`);
  }
}
assert.equal(wardrobe.fitParts(), wardrobe.parts, 'Neutral fit must retain original source images');
for (const [armWidth, armLength, ratio] of [[125, 120, 118], [80, 85, 82], [125, 85, 118], [80, 120, 82]]) {
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
    const position = { x: config.pivots[part.joint].x, y: start.y };
    const map = shape.upperArmMapping(start, end, position);
    const cap = side === 'L' ? [243, 978] : [415, 978];
    const cuff = side === 'L' ? [[179, 1103], [241, 1124]] : [[479, 1103], [417, 1124]];
    const translatedCap = [cap[0] + position.x - start.x, cap[1]];
    // The old whole-arm affine transform fails this assertion: at 120% length
    // it pulled this attachment upward by more than six pixels.
    close(map.forward(...cap), translatedCap, 'Shoulder attachment must stay pinned');
    const capSource = sourcesAt(output.image, part.image,
      [translatedCap[0] - output.x, shape.mapRatioY(translatedCap[1]) - output.y]);
    assert.equal(capSource.length, 1, 'Cap must survive exactly one ratio band');
    close(capSource[0], [cap[0] - part.x, cap[1] - part.y], 'Fitted sleeve must retain its shoulder attachment');
    for (const point of [...cuff, [end.x, end.y]]) {
      const dx = point[0] - start.x, dy = point[1] - start.y;
      const along = (dx * ux + dy * uy) * armLength / 100;
      const across = (-dx * uy + dy * ux) * armWidth / 100;
      const expected = [position.x + along * ux - across * uy,
        position.y + along * uy + across * ux];
      close(map.forward(...point), expected, 'Cuff/elbow must reach the full requested length and width');
      if (point[1] === end.y) continue; // Elbow lies beyond the sleeve image.
      const actual = sourcesAt(output.image, part.image,
        [expected[0] - output.x, shape.mapRatioY(expected[1]) - output.y]);
      assert.equal(actual.length, 1, 'Each cuff marker must survive exactly one ratio band');
      close(actual[0], [point[0] - part.x, point[1] - part.y], 'Ratio must apply once after sleeve shaping');
    }
    let previousDepth = -Infinity;
    for (let depth = -40; depth <= length + 10; depth += 2.5) {
      const center = map.forward(start.x + ux * depth, start.y + uy * depth);
      const currentDepth = (center[0] - position.x) * ux + (center[1] - position.y) * uy;
      assert.ok(currentDepth > previousDepth, 'Shoulder transition must never fold or reverse');
      previousDepth = currentDepth;
      for (const across of [-35, 0, 35]) {
        const original = [start.x + ux * depth - uy * across, start.y + uy * depth + ux * across];
        close(map.inverse(...map.forward(...original)), original,
          'Inverse shoulder map must recover the original point', 0.005);
      }
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
console.log('PASS: pinned shoulder caps, full cuff/elbow scale, monotone inverse mapping, single ratio transform, exact reset and pose cache');
