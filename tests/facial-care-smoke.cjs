// Dependency-free engine/event regression. Browser interaction and asset layout
// are separately exercised by facial-care.cjs when Chromium is available.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'ui/facial-care.js'), 'utf8');
const rigSource = fs.readFileSync(path.join(root, 'rig/rig.js'), 'utf8');
const config = JSON.parse(fs.readFileSync(path.join(root, 'rig/rig.json'), 'utf8'));
const tools = ['cleanser', 'towel', 'serum', 'cream', 'roller'];
const STORE = 'dresslab-v2:facial-care:v2';

class Target {
  constructor() { this.handlers = new Map(); this.attributes = {}; this.dataset = {}; this.style = {}; }
  addEventListener(type, fn) {
    const handlers = this.handlers.get(type) || [];
    handlers.push(fn); this.handlers.set(type, handlers);
  }
  dispatchEvent(event) {
    if (!event.preventDefault) event.preventDefault = () => { event.defaultPrevented = true; };
    for (const fn of this.handlers.get(event.type) || []) fn.call(this, event);
    return !event.defaultPrevented;
  }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  getAttribute(key) { return this.attributes[key] ?? null; }
  removeAttribute(key) { delete this.attributes[key]; }
  appendChild(child) { (this.children ||= []).push(child); }
}
const plain = value => JSON.parse(JSON.stringify(value));
const signature = state => plain({ products: state.products, dirt: state.dirt,
  hydration: state.hydration, massage: state.massage });
const sum = values => values.reduce((total, value) => total + value, 0);
const material = product => sum(product.dots.map(dot => dot.amount)) + sum(product.film);
const noStages = state => ['stage', 'stageIndex', 'stages', 'progress', 'completed']
  .forEach(key => assert.equal(key in state, false, 'Unexpected global ' + key));

function setup({ storage = new Map(), blockedStorage = false, rect, shape: changes = {} } = {}) {
  const window = new Target(), document = new Target(), canvas = new Target(), artboard = new Target();
  canvas.width = 1206; canvas.height = 2622;
  canvas.setAttribute('aria-label', '원래 인형');
  canvas.setAttribute('role', 'img');
  const view = rect || { left: -35, top: -108, width: 826.8, height: 1797.55 };
  canvas.getBoundingClientRect = () => ({ ...view });
  artboard.getBoundingClientRect = () => ({ left: 0, top: 0, width: 390, height: 844 });
  canvas.setPointerCapture = id => { canvas.captured = id; };
  const documentElements = { character: canvas, artboard };
  document.hidden = false;
  document.getElementById = id => documentElements[id] || null;
  document.createElement = () => new Target();
  window.matchMedia = () => ({ matches: true });
  let currentTab = 'hair', currentRoom = 'care', selectedTool = 'cleanser';
  window.DressLabRooms = {
    get current() { return currentRoom; },
    setRoom(room) {
      currentRoom = room;
      window.dispatchEvent({ type: 'dresslab:room-change', detail: { room } });
    }
  };
  window.DressLabCareRoom = {
    get currentTab() { return currentTab; },
    get selectedTool() { return selectedTool; },
    setTab(tab) {
      currentTab = tab;
      window.dispatchEvent({ type: 'dresslab:care-tab-change', detail: { tab } });
    },
    setTool(tool, options = {}) {
      if (currentTab !== 'facial' || !tools.includes(tool)) return false;
      if (selectedTool === tool) return true;
      selectedTool = tool;
      if (options.emit !== false) window.dispatchEvent({ type: 'dresslab:care-tool-select', detail: { tab: currentTab, tool } });
      return true;
    }
  };
  let frameId = 0, paints = 0;
  let now = 1000;
  const rafs = new Map(), published = [], completion = [], selections = [];
  window.addEventListener('dresslab:facial-state', event => published.push(plain(event.detail)));
  window.addEventListener('dresslab:facial-complete', event => completion.push(plain(event.detail)));
  window.addEventListener('dresslab:care-tool-select', event => selections.push(plain(event.detail)));
  const sandbox = {
    window, document, console, localStorage: {
      getItem(key) { if (blockedStorage) throw new Error('Storage blocked'); return storage.get(key) || null; },
      setItem(key, value) { if (blockedStorage) throw new Error('Storage blocked'); storage.set(key, value); }
    },
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options?.detail; } },
    performance: { now: () => now },
    requestAnimationFrame(fn) { rafs.set(++frameId, fn); return frameId; },
    cancelAnimationFrame(id) { rafs.delete(id); }
  };
  vm.runInNewContext(source, sandbox, { filename: 'ui/facial-care.js' });
  const rig = { config: structuredClone(config), angles: { torso: 0 },
    root: { x: 0, y: 0, scaleX: 1, scaleY: 1 }, rootAnchor: { x: 328.6, y: 2050 },
    render() { paints++; } };
  const shape = { head: 100, neck: 100, ...changes,
    headNeckAnchors: { x: 328.6, jawY: 926, span: 75 },
    neckOffsetY() { return (1 - this.neck / 100) * this.headNeckAnchors.span; } };
  const care = window.DressLabFacialCare;
  care.bind(rig, shape);
  assert.equal(care.getState().active, false, 'Hair tab must not activate facial input');
  window.DressLabCareRoom.setTab('facial');
  assert.equal(care.getState().active, true);
  assert.equal(canvas.getAttribute('role'), 'button');
  assert.equal(canvas.tabIndex, 0);
  const advance = (ms = 80) => { now += ms; };
  const key = (key = 'Enter', repeat = false) => { advance(); canvas.dispatchEvent({ type: 'keydown', key, repeat }); };
  function pointer(type, point, extra = {}, elapsed = 80) {
    advance(elapsed);
    const screen = client(point);
    canvas.dispatchEvent({ type, pointerId: 1, button: 0, isPrimary: true,
      clientX: screen.x, clientY: screen.y, ...extra });
  }
  // Independent forward transform models where a source point is rendered.
  function client({ x, y }) {
    const anchor = shape.headNeckAnchors, head = shape.head / 100;
    x = anchor.x + (x - anchor.x) * head;
    y = anchor.jawY + (y - anchor.jawY) * head + shape.neckOffsetY();
    const pivot = rig.config.pivots.torso, radians = rig.angles.torso * Math.PI / 180;
    const dx = x - pivot.x, dy = y - pivot.y;
    x = pivot.x + Math.cos(radians) * dx - Math.sin(radians) * dy;
    y = pivot.y + Math.sin(radians) * dx + Math.cos(radians) * dy;
    x = rig.rootAnchor.x + (x - rig.rootAnchor.x) * rig.root.scaleX + rig.root.x;
    y = rig.rootAnchor.y + (y - rig.rootAnchor.y) * rig.root.scaleY + rig.root.y;
    return { x: view.left + x / canvas.width * view.width,
      y: view.top + y / canvas.height * view.height };
  }
  function tap(point) { pointer('pointerdown', point); pointer('pointerup', point); }
  function stroke(points, elapsed = 80) {
    pointer('pointerdown', points[0], {}, elapsed);
    points.slice(1).forEach(point => pointer('pointermove', point, {}, elapsed));
    pointer('pointerup', points.at(-1), {}, elapsed);
  }
  function flush() {
    const callbacks = [...rafs.values()]; rafs.clear();
    callbacks.forEach(fn => fn(now));
  }
  return { window, document, canvas, care, rig, shape, storage, key, pointer, client,
    advance, tap, stroke, published, completion, selections, flush, rafs, paints: () => paints };
}

// Free order: roller and towel work immediately; recommendations never take
// over the tool selection, even if another product would usually be used first.
const h = setup();
const empty = signature(h.care.getState());
noStages(h.care.getState());
h.window.DressLabCareRoom.setTool('roller');
let userSelections = h.selections.length;
h.stroke([{ x: 260, y: 620 }, { x: 290, y: 630 }, { x: 325, y: 640 }, { x: 370, y: 660 }]);
assert.ok(sum(h.care.getState().massage) > sum(empty.massage), 'Roller must work before any product');
assert.equal(h.care.getState().selectedTool, 'roller');
assert.equal(h.window.DressLabCareRoom.selectedTool, 'roller');
assert.equal(h.selections.length, userSelections, 'Working must not emit a tool-selection event');
h.window.DressLabCareRoom.setTool('towel');
const dusty = sum(h.care.getState().dirt);
h.stroke([{ x: 260, y: 620 }, { x: 290, y: 630 }, { x: 325, y: 640 }, { x: 370, y: 660 }]);
assert.ok(sum(h.care.getState().dirt) < dusty, 'Towel must work without waiting for cleanser');
assert.equal(h.care.getState().selectedTool, 'towel');
h.care.reset();
assert.deepEqual(signature(h.care.getState()), empty);
assert.equal(h.care.getState().selectedTool, 'towel', 'Reset must preserve selection');

// Inactive, secondary, eye and outside-face contacts must not deposit product.
h.window.DressLabCareRoom.setTool('serum');
for (const p of [{ x: 75, y: 720 }, { x: 237, y: 800 }, { x: 422, y: 800 }]) {
  h.tap(p);
}
h.pointer('pointerdown', { x: 329, y: 650 }, { button: 2 });
h.pointer('pointerdown', { x: 329, y: 650 }, { isPrimary: false, pointerId: 2 });
h.key('Enter', true);
assert.deepEqual(signature(h.care.getState()), empty);

// Actual installed pointer handlers deposit three contacts before spreading.
// A held drag, including the third contact, cannot both deposit and spread.
const points = [{ x: 260, y: 620 }, { x: 405, y: 650 }, { x: 329, y: 880 }];
userSelections = h.selections.length;
h.stroke([points[0], { x: 300, y: 630 }, { x: 350, y: 650 }]);
let serum = h.care.getState().products.serum;
assert.equal(serum.dots.length, 1);
assert.equal(serum.phase, 'apply');
assert.equal(sum(serum.film), 0);
h.tap(points[1]);
serum = h.care.getState().products.serum;
assert.equal(serum.dots.length, 2);
assert.equal(serum.phase, 'apply');
assert.equal(sum(serum.film), 0);
h.stroke([points[2], { x: 329, y: 865 }, { x: 345, y: 875 }]);
serum = h.care.getState().products.serum;
assert.equal(serum.dots.length, 3);
assert.equal(serum.phase, 'spread');
assert.equal(sum(serum.film), 0, 'Third deposition drag must not spread');
const depositedMass = material(serum);
assert.ok(depositedMass > 0);
assert.equal(h.care.getState().selectedTool, 'serum');
assert.equal(h.selections.length, userSelections);
const dotted = signature(h.care.getState());

// Separate taps at the same spot still count; there is no invisible spacing gate.
const overlapping = setup();
for (let i = 0; i < 3; i++) overlapping.tap({ x: 329, y: 650 });
assert.equal(overlapping.care.getState().products.cleanser.dots.length, 3);
assert.equal(overlapping.care.getState().products.cleanser.phase, 'spread');

// Stationary/repeated events and rubbing far from product cannot create film.
h.pointer('pointerdown', points[0]);
for (let i = 0; i < 15; i++) h.pointer('pointermove', points[0], {}, 500);
h.pointer('pointerup', points[0]);
assert.deepEqual(signature(h.care.getState()), dotted, 'Time without movement must not spread');
h.stroke([{ x: 330, y: 555 }, { x: 350, y: 555 }, { x: 365, y: 570 }]);
assert.equal(sum(h.care.getState().products.serum.film), 0, 'Empty-face rubbing cannot invent product');

// Spreading moves finite material from a deposited dot to nearby skin slowly.
h.stroke([points[0], { x: 275, y: 620 }, { x: 290, y: 625 }, { x: 310, y: 635 }]);
serum = h.care.getState().products.serum;
assert.ok(sum(serum.film) > 0, 'A later rub near a dot must spread its material');
assert.ok(serum.dots.some(dot => dot.amount > 0), 'One short rub must leave unspread product');
assert.ok(Math.abs(material(serum) + sum(h.care.getState().hydration) / 2.2 - depositedMass) < 1e-6,
  'Serum material must remain on the face or become measured hydration');
assert.equal(h.care.getState().selectedTool, 'serum');
assert.equal(h.selections.length, userSelections);

// Equal geometric paths over different durations should not award the same
// amount of work per event. Long waits are capped, and motion stays gradual.
function timedRub(elapsed) {
  const item = setup();
  item.window.DressLabCareRoom.setTool('cream');
  points.forEach(point => item.tap(point));
  item.stroke([points[0], { x: 269, y: 620 }, { x: 278, y: 621 },
    { x: 287, y: 622 }, { x: 296, y: 623 }, { x: 305, y: 624 }], elapsed);
  return item.care.getState().products.cream;
}
const quick = timedRub(5), slow = timedRub(80), paused = timedRub(2000);
assert.ok(slow.work > quick.work * 2, 'Spreading must depend on elapsed time, not event count');
assert.ok(sum(slow.film) > sum(quick.film), 'A slower real rub must transfer more material');
assert.ok(paused.work <= slow.work * 1.1, 'A paused pointer must not earn seconds of free work');
assert.ok(slow.dots.some(dot => dot.amount > 0));

// Cleanser does not absorb. Its dot+film amount must be conserved exactly,
// including material temporarily carried by the pointer at cancellation.
const cleanser = setup();
points.forEach(point => cleanser.tap(point));
const cleanserMass = material(cleanser.care.getState().products.cleanser);
cleanser.pointer('pointerdown', points[0]);
cleanser.pointer('pointermove', { x: 280, y: 625 });
cleanser.pointer('pointermove', { x: 300, y: 630 });
cleanser.pointer('pointercancel', { x: 300, y: 630 });
assert.ok(Math.abs(material(cleanser.care.getState().products.cleanser) - cleanserMass) < 1e-6,
  'Cleanser spreading/cancellation must conserve all material');
assert.equal(sum(cleanser.care.getState().hydration), 0);

// High-frequency gentle movement can be smaller than one CSS pixel per
// event. Preserve .1/.2 px movement while still rejecting zero movement.
// Each variant covers the same 10 CSS px in 500 ms with a different event
// count; neither sample count nor interpolation may multiply work or material.
function gentleRub(cssStep) {
  const item = setup();
  points.forEach(point => item.tap(point));
  const start = points[0], screen = item.client(start);
  const cssPerSourcePixel = item.client({ x: start.x + 1, y: start.y }).x - screen.x;
  const samples = Math.round(10 / cssStep);
  item.pointer('pointerdown', start);
  for (let index = 1; index <= samples; index++) {
    item.pointer('pointermove', { x: start.x + index * cssStep / cssPerSourcePixel,
      y: start.y }, {}, 500 / samples);
  }
  item.pointer('pointerup', { x: start.x + 10 / cssPerSourcePixel, y: start.y });
  return item.care.getState().products.cleanser;
}
const finePointOne = gentleRub(.1), finePointTwo = gentleRub(.2), coarse = gentleRub(1);
for (const product of [finePointOne, finePointTwo, coarse]) {
  assert.ok(sum(product.film) > 0, 'Subpixel movement must spread real product');
  assert.ok(Math.abs(material(product) - cleanserMass) < 1e-6,
    'Changing event frequency must not create or lose cleanser');
  assert.ok(Math.abs(product.work - coarse.work) < 1e-8,
    'Equal paths at equal duration must not gain work from more pointer events');
}

// Coordinate inverse follows the actual torso pivot, head/neck extremes,
// nonuniform root scale/translation and scaled/translated CSS canvas bounds.
for (const setting of [
  { head: 70, neck: 127, torso: -12, x: -29, y: 33, scaleX: .97, scaleY: 1.03, torsoY: 1190 },
  { head: 113, neck: 78, torso: 12, x: 35, y: -42, scaleX: 1.03, scaleY: .97, torsoY: 1140 },
  { head: 100, neck: 100, torso: 0, x: 0, y: 0, scaleX: 1, scaleY: 1, torsoY: 1166.5 }
]) {
  Object.assign(h.shape, { head: setting.head, neck: setting.neck });
  h.rig.angles.torso = setting.torso;
  h.rig.config.pivots.torso.y = setting.torsoY;
  h.rig.root = { x: setting.x, y: setting.y, scaleX: setting.scaleX, scaleY: setting.scaleY };
  for (const point of [{ x: 329, y: 650 }, { x: 220, y: 700 }, { x: 420, y: 620 }, { x: 329, y: 890 }]) {
    const screen = h.client(point), inverse = h.care.clientToFace(screen.x, screen.y);
    assert.ok(Math.hypot(inverse.x - point.x, inverse.y - point.y) < 1e-7, 'Inverse transform drift');
  }
  h.care.reset();
  h.tap({ x: 329, y: 650 });
  const dot = h.care.getState().products.serum.dots[0];
  assert.ok(dot && Math.hypot(dot.x - 329, dot.y - 650) < 1e-7,
    'Transformed contact must deposit at the original source location');
}

// Cancellation flushes carried material without losing mass or keeping input
// active. Room/tab/visibility changes do the same and preserve tool selection.
h.care.reset();
points.forEach(point => h.tap(point));
h.pointer('pointerdown', points[0]);
h.pointer('pointermove', { x: 280, y: 625 });
h.pointer('pointercancel', { x: 280, y: 625 });
const cancelled = signature(h.care.getState());
h.pointer('pointermove', { x: 329, y: 570 });
assert.deepEqual(signature(h.care.getState()), cancelled);
assert.equal(h.care.pointerId, null);
assert.equal(h.care.cursor.hidden, true);
assert.ok(Math.abs(material(h.care.getState().products.serum) +
  sum(h.care.getState().hydration) / 2.2 - depositedMass) < 1e-6,
  'Cancellation must return carried material instead of losing it');
h.window.DressLabRooms.setRoom('dress');
h.key();
assert.deepEqual(signature(h.care.getState()), cancelled);
assert.equal(h.canvas.getAttribute('role'), 'img');
assert.equal(h.canvas.getAttribute('aria-label'), '원래 인형');
h.window.DressLabRooms.setRoom('care');
h.window.DressLabCareRoom.setTab('relaxation');
h.key();
assert.deepEqual(signature(h.care.getState()), cancelled);
h.window.DressLabCareRoom.setTab('facial');
assert.equal(h.care.getState().selectedTool, 'serum');
assert.equal(h.window.DressLabCareRoom.selectedTool, 'serum');

// Snapshot independence and v2 persistence for deposits, film and skin state.
const beforeSnapshotMutation = signature(h.care.getState());
const snapshot = h.care.getState();
snapshot.products.serum.dots[0].amount = 999;
snapshot.products.serum.film[0] = 999;
assert.deepEqual(signature(h.care.getState()), beforeSnapshotMutation, 'Snapshots must be immutable copies');
const restored = setup({ storage: h.storage });
assert.deepEqual(signature(restored.care.getState()), beforeSnapshotMutation);
assert.equal(restored.completion.length, 0);
assert.ok(restored.published.length > 0);
restored.published.forEach(noStages);

// Enter/Space retain an accessible way to deposit, then rub incrementally.
restored.window.DressLabCareRoom.setTool('cleanser');
userSelections = restored.selections.length;
for (const key of ['Enter', ' ', 'Enter']) restored.key(key);
assert.equal(restored.care.getState().products.cleanser.dots.length, 3);
assert.equal(sum(restored.care.getState().products.cleanser.film), 0);
restored.key(' ');
assert.ok(sum(restored.care.getState().products.cleanser.film) > 0);
assert.equal(restored.care.getState().selectedTool, 'cleanser');
assert.equal(restored.selections.length, userSelections);
assert.equal(restored.completion.length, 0);

// Wiping is local and gradual, rather than erasing the whole product at once.
restored.window.DressLabCareRoom.setTool('towel');
const beforeWipe = material(restored.care.getState().products.serum);
restored.stroke([points[0], { x: 275, y: 620 }, { x: 290, y: 625 }]);
const afterWipe = material(restored.care.getState().products.serum);
assert.ok(afterWipe < beforeWipe && afterWipe > 0, 'Towel should remove only some nearby material');
assert.equal(restored.care.getState().selectedTool, 'towel');

// Reset through the UI event leaves all separate appearance state and the
// currently selected tool alone. It emits no completion or tool-change event.
restored.rig.skinTone = { hex: '#C68C73' };
restored.rig.wardrobe = { equipped: false };
restored.rig.eyes = { targetX: 12, targetY: -7 };
restored.shape.head = 113;
const appearance = plain({ shape: restored.shape, skin: restored.rig.skinTone,
  wardrobe: restored.rig.wardrobe, eyes: restored.rig.eyes });
userSelections = restored.selections.length;
restored.window.dispatchEvent({ type: 'dresslab:facial-reset' });
assert.deepEqual(signature(restored.care.getState()), empty);
assert.equal(restored.care.getState().selectedTool, 'towel');
assert.equal(restored.selections.length, userSelections);
assert.deepEqual(plain({ shape: restored.shape, skin: restored.rig.skinTone,
  wardrobe: restored.rig.wardrobe, eyes: restored.rig.eyes }), appearance);
assert.deepEqual(signature(setup({ storage: h.storage }).care.getState()), empty);

// Old v1 completion cannot recreate forced stages. Invalid or blocked v2
// storage must not crash or grant material; the current session remains usable.
const old = new Map([['dresslab-v2:facial-care:v1', JSON.stringify({ version: 1,
  coverage: Array.from({ length: 5 }, () => Array(100).fill(1)) })]]);
assert.deepEqual(signature(setup({ storage: old }).care.getState()), empty);
for (const value of ['{broken', 'null', '{"version":999}', '{"version":2,"products":{}}']) {
  const candidate = setup({ storage: new Map([[STORE, value]]) });
  assert.deepEqual(signature(candidate.care.getState()), empty);
}
const blocked = setup({ blockedStorage: true });
blocked.key();
assert.equal(blocked.care.getState().products.cleanser.dots.length, 1);
blocked.care.reset();
assert.deepEqual(signature(blocked.care.getState()), empty);
assert.equal(blocked.rafs.size, 1, 'Repaints should be coalesced');
blocked.flush();
assert.equal(blocked.rafs.size, 0, 'Reduced-motion mode needs no perpetual RAF');
assert.equal(blocked.paints(), 1);

// Exercise the actual rig's drawing order, not a source-text assertion.
const draws = [], context = { save() {}, restore() {}, setTransform() {}, clearRect() {},
  translate() {}, rotate() {}, scale() {}, drawImage(image) { draws.push(image.id); } };
const canvas = { width: 1206, height: 2622, getContext: () => context };
const environment = { window: {}, console };
vm.runInNewContext(rigSource, environment, { filename: 'rig/rig.js' });
const rig = new environment.window.DressLabRig({ canvas, config: structuredClone(config),
  layers: [{ filename: '01-Head.PNG', image: { id: 'head' } },
    { filename: '17-Hand(R).PNG', image: { id: 'hand' } }] });
rig.facialCare = { draw() { draws.push('care'); } };
rig.eyes = { draw() { draws.push('eyes'); } };
draws.length = 0;
rig.render();
assert.deepEqual(draws, ['hand', 'head', 'care', 'eyes'], 'Care must be between head and eyes');

console.log('PASS: free tool order; three deposits before gradual spreading; conserved finite material;');
console.log('time/distance response; no automatic selection or stage/completion state; transformed input;');
console.log('cancel/room/tab isolation; v2 persistence and v1 rejection; local wiping; keyboard support;');
console.log('appearance-preserving reset; blocked storage; coalesced rendering; head→care→eyes ordering.');
