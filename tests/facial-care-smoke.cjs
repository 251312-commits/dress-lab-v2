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
const STORE = 'dresslab-v2:facial-care:v3';

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
  hydration: state.hydration, massage: state.massage, overallProgress: state.overallProgress });
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
  function toolEvent(phase, tool, point, elapsed = 80) {
    advance(elapsed);
    const screen = client(point);
    window.dispatchEvent({ type: 'dresslab:facial-tool-drag', detail: {
      phase, tool, pointerId: 91, clientX: screen.x, clientY: screen.y
    } });
  }
  function toolTap(tool, point) { toolEvent('start', tool, point); toolEvent('end', tool, point); }
  function toolStroke(tool, points, elapsed = 80) {
    toolEvent('start', tool, points[0], elapsed);
    points.slice(1).forEach(point => toolEvent('move', tool, point, elapsed));
    toolEvent('end', tool, points.at(-1), elapsed);
  }
  function toolKey(tool) {
    advance(); window.dispatchEvent({ type: 'dresslab:facial-tool-key', detail: { tool } });
  }
  function flush() {
    const callbacks = [...rafs.values()]; rafs.clear();
    callbacks.forEach(fn => fn(now));
  }
  return { window, document, canvas, care, rig, shape, storage, key, pointer, client,
    advance, tap, stroke, toolEvent, toolTap, toolStroke, toolKey,
    published, completion, selections, flush, rafs, paints: () => paints };
}

// Selecting a tool does not make the bare finger an applicator. Direct taps,
// strokes and keyboard input on an empty face cannot deposit or use a roller.
const h = setup();
const empty = signature(h.care.getState());
const point = { x: 260, y: 620 };
const shortPath = [point, { x: 280, y: 620 }, point, { x: 280, y: 620 }];
noStages(h.care.getState());
assert.equal(h.care.getState().overallProgress, 0);
for (const id of tools) {
  h.window.DressLabCareRoom.setTool(id);
  h.tap(point);
  h.stroke(shortPath);
  h.key();
  assert.deepEqual(signature(h.care.getState()), empty, 'Selection alone must not operate ' + id);
}

// Towel and roller remain freely usable, but only when actually picked up.
h.window.DressLabCareRoom.setTool('roller');
let userSelections = h.selections.length;
h.toolStroke('roller', shortPath);
assert.ok(sum(h.care.getState().massage) > 0, 'Dragged roller must work before products');
assert.ok(h.care.getState().overallProgress > 0);
assert.equal(h.care.getState().selectedTool, 'roller');
assert.equal(h.selections.length, userSelections);
h.care.reset();
h.window.DressLabCareRoom.setTool('towel');
const dusty = sum(h.care.getState().dirt);
h.toolStroke('towel', [point, { x: 290, y: 630 }, { x: 325, y: 640 }, { x: 370, y: 660 }]);
assert.ok(sum(h.care.getState().dirt) < dusty, 'Dragged towel must clean independently');
assert.ok(h.care.getState().overallProgress > 0);
h.care.reset();
assert.deepEqual(signature(h.care.getState()), empty);
assert.equal(h.care.getState().selectedTool, 'towel', 'Reset must preserve selected tool');

// Unlimited application: neither repeated placement nor a single long drag
// stops at three doses. Coalescing nearby dots is allowed; total mass must grow.
h.window.DressLabCareRoom.setTool('cleanser');
for (let index = 1; index <= 8; index++) {
  h.toolTap('cleanser', point);
  assert.ok(Math.abs(material(h.care.getState().products.cleanser) - index) < 1e-6,
    'Every repeated application must add a dose beyond three');
}
assert.equal(sum(h.care.getState().products.cleanser.film), 0);
assert.equal(h.care.getState().overallProgress, 0, 'Depositing alone must not fill the work bar');
h.care.reset();
const locations = [{ x: 220, y: 610 }, { x: 300, y: 565 }, { x: 405, y: 620 },
  { x: 185, y: 700 }, { x: 329, y: 720 }, { x: 470, y: 700 }];
locations.forEach(location => h.toolTap('cleanser', location));
assert.ok(h.care.getState().products.cleanser.dots.length > 3, 'Distinct applications must exceed three dots');
h.care.reset();
const applicationPath = [];
for (let lap = 0; lap < 2; lap++) {
  for (let x = 220; x <= 440; x += 22) applicationPath.push({ x, y: 620 });
  for (let x = 440; x >= 220; x -= 22) applicationPath.push({ x, y: 700 });
}
h.toolStroke('cleanser', applicationPath, 100);
assert.ok(material(h.care.getState().products.cleanser) > 3, 'One applicator drag must lay multiple doses');
assert.equal(sum(h.care.getState().products.cleanser.film), 0, 'Application must not also rub product');
assert.equal(h.care.getState().overallProgress, 0);

// Rub immediately after one dose with bare fingers, despite a different
// selected tool. No dragged-tool cursor, extra deposition or auto-selection.
h.care.reset();
h.toolTap('cleanser', point);
h.window.DressLabCareRoom.setTool('roller');
userSelections = h.selections.length;
h.pointer('pointerdown', point);
assert.equal(h.care.cursor.hidden, true, 'Bare contact must not display an applicator');
for (const position of shortPath.slice(1)) {
  h.pointer('pointermove', position);
  assert.equal(h.care.cursor.hidden, true);
}
h.pointer('pointerup', shortPath.at(-1));
let cleanser = h.care.getState().products.cleanser;
assert.ok(sum(cleanser.film) >= .20, 'Short .24s rub must visibly respond faster than the former .36/sec rate');
assert.ok(Math.abs(material(cleanser) - 1) < 1e-6, 'Bare rubbing must conserve the single dose');
assert.equal(h.care.getState().selectedTool, 'roller');
assert.equal(h.window.DressLabCareRoom.selectedTool, 'roller');
assert.equal(h.selections.length, userSelections);
assert.equal(sum(h.care.getState().massage), 0, 'Selected roller must not act during bare rubbing');
assert.deepEqual(plain(h.care.getState().dirt), empty.dirt);
assert.ok(h.care.getState().overallProgress > 0);

// Bare rubbing works on every nearby material, including cleanser/serum/cream
// mixed together. Absorption is accounted for explicitly in hydration.
const mixed = setup();
for (const id of ['cleanser', 'serum', 'cream']) {
  mixed.window.DressLabCareRoom.setTool(id);
  mixed.toolTap(id, point);
}
mixed.window.DressLabCareRoom.setTool('towel');
userSelections = mixed.selections.length;
mixed.stroke(shortPath);
const mixedState = mixed.care.getState();
for (const id of ['cleanser', 'serum', 'cream']) {
  assert.ok(sum(mixedState.products[id].film) > 0, 'Bare finger must spread mixed ' + id);
  assert.ok(mixedState.products[id].work > 0);
}
assert.ok(Math.abs(material(mixedState.products.cleanser) - 1) < 1e-6);
assert.ok(Math.abs(material(mixedState.products.serum) + material(mixedState.products.cream) +
  mixedState.products.serum.absorbed + mixedState.products.cream.absorbed - 2) < 1e-6,
  'Serum/cream must remain or be explicitly recorded as absorbed');
assert.equal(sum(mixedState.massage), 0);
assert.deepEqual(plain(mixedState.dirt), empty.dirt);
assert.equal(mixedState.selectedTool, 'towel');
assert.equal(mixed.selections.length, userSelections);
assert.equal(mixed.care.cursor.hidden, true);

// Zero movement, eye/outside contacts and rubbing away from material do not
// create product or work. Pauses do not become a large jump on the next move.
const stationary = setup();
stationary.toolTap('cleanser', point);
const dotted = signature(stationary.care.getState());
stationary.pointer('pointerdown', point);
for (let i = 0; i < 15; i++) stationary.pointer('pointermove', point, {}, 500);
stationary.pointer('pointerup', point);
assert.deepEqual(signature(stationary.care.getState()), dotted);
for (const p of [{ x: 75, y: 720 }, { x: 237, y: 800 }, { x: 422, y: 800 }]) stationary.tap(p);
stationary.pointer('pointerdown', point, { button: 2 });
stationary.pointer('pointerdown', point, { isPrimary: false, pointerId: 2 });
stationary.key('Enter', true);
stationary.stroke([{ x: 365, y: 565 }, { x: 385, y: 585 }, { x: 410, y: 610 }]);
assert.deepEqual(signature(stationary.care.getState()), dotted, 'Empty face rubbing must not invent work');
function timedRub(elapsed) {
  const item = setup(); item.toolTap('cleanser', point);
  item.stroke([point, { x: 269, y: 620 }, { x: 278, y: 621 },
    { x: 287, y: 622 }, { x: 296, y: 623 }, { x: 305, y: 624 }], elapsed);
  return item.care.getState().products.cleanser;
}
const quick = timedRub(5), slow = timedRub(80), paused = timedRub(2000);
assert.ok(slow.work > quick.work * 2);
assert.ok(sum(slow.film) > sum(quick.film));
assert.ok(paused.work <= slow.work * 1.1, 'Paused input must be capped');
assert.ok(slow.dots.some(dot => dot.amount > 0));

// Preserve .1/.2 CSS px movement and frequency-independent work/mass.
function gentleRub(cssStep) {
  const item = setup(); item.toolTap('cleanser', point);
  const screen = item.client(point);
  const cssPerSourcePixel = item.client({ x: point.x + 1, y: point.y }).x - screen.x;
  const samples = Math.round(10 / cssStep);
  item.pointer('pointerdown', point);
  for (let index = 1; index <= samples; index++) {
    item.pointer('pointermove', { x: point.x + index * cssStep / cssPerSourcePixel,
      y: point.y }, {}, 500 / samples);
  }
  item.pointer('pointerup', { x: point.x + 10 / cssPerSourcePixel, y: point.y });
  return item.care.getState().products.cleanser;
}
const finePointOne = gentleRub(.1), finePointTwo = gentleRub(.2), coarse = gentleRub(1);
for (const product of [finePointOne, finePointTwo, coarse]) {
  assert.ok(sum(product.film) > 0);
  assert.ok(Math.abs(material(product) - 1) < 1e-6);
  assert.ok(Math.abs(product.work - coarse.work) < 1e-8);
}

// Coordinate inverse and actual applicator placement follow head/neck extremes,
// changed torso pivots, root scale/translation and CSS canvas scaling.
h.window.DressLabCareRoom.setTool('serum');
for (const setting of [
  { head: 70, neck: 127, torso: -12, x: -29, y: 33, scaleX: .97, scaleY: 1.03, torsoY: 1190 },
  { head: 113, neck: 78, torso: 12, x: 35, y: -42, scaleX: 1.03, scaleY: .97, torsoY: 1140 },
  { head: 100, neck: 100, torso: 0, x: 0, y: 0, scaleX: 1, scaleY: 1, torsoY: 1166.5 }
]) {
  Object.assign(h.shape, { head: setting.head, neck: setting.neck });
  h.rig.angles.torso = setting.torso;
  h.rig.config.pivots.torso.y = setting.torsoY;
  h.rig.root = { x: setting.x, y: setting.y, scaleX: setting.scaleX, scaleY: setting.scaleY };
  for (const p of [{ x: 329, y: 650 }, { x: 220, y: 700 }, { x: 420, y: 620 }, { x: 329, y: 890 }]) {
    const screen = h.client(p), inverse = h.care.clientToFace(screen.x, screen.y);
    assert.ok(Math.hypot(inverse.x - p.x, inverse.y - p.y) < 1e-7, 'Inverse transform drift');
  }
  h.care.reset();
  h.toolTap('serum', { x: 329, y: 650 });
  const dot = h.care.getState().products.serum.dots[0];
  assert.ok(dot && Math.hypot(dot.x - 329, dot.y - 650) < 1e-7);
}

// Cancellation returns carried mixed material, stops further input and hides
// the tool cursor. Cancelling application must also prevent further deposits.
h.care.reset(); h.toolTap('serum', point);
h.pointer('pointerdown', point);
h.pointer('pointermove', { x: 280, y: 625 });
h.pointer('pointercancel', { x: 280, y: 625 });
const cancelled = signature(h.care.getState());
h.pointer('pointermove', { x: 329, y: 570 });
assert.deepEqual(signature(h.care.getState()), cancelled);
assert.equal(h.care.pointerId, null);
assert.equal(h.care.cursor.hidden, true);
assert.ok(Math.abs(material(h.care.getState().products.serum) +
  h.care.getState().products.serum.absorbed - 1) < 1e-6);
h.toolEvent('start', 'serum', point);
h.toolEvent('cancel', 'serum', point);
const cancelledTool = signature(h.care.getState());
h.toolEvent('move', 'serum', { x: 400, y: 650 });
assert.deepEqual(signature(h.care.getState()), cancelledTool);
assert.equal(h.care.cursor.hidden, true);

// Room/tab transitions disable both direct and dragged input without losing
// materials, work or the user's selection.
h.window.DressLabRooms.setRoom('dress');
h.key(); h.toolStroke('cream', shortPath);
assert.deepEqual(signature(h.care.getState()), cancelledTool);
assert.equal(h.canvas.getAttribute('role'), 'img');
assert.equal(h.canvas.getAttribute('aria-label'), '원래 인형');
h.window.DressLabRooms.setRoom('care');
h.window.DressLabCareRoom.setTab('relaxation');
h.key(); h.toolKey('cream');
assert.deepEqual(signature(h.care.getState()), cancelledTool);
h.window.DressLabCareRoom.setTab('facial');
assert.equal(h.care.getState().selectedTool, 'serum');

// V3 snapshots and saved progress are independent copies. Migrate valid V2
// material state without restoring the obsolete three-dose workflow.
const beforeSnapshotMutation = signature(h.care.getState());
const snapshot = h.care.getState();
snapshot.products.serum.dots[0].amount = 999;
snapshot.products.serum.film[0] = 999;
assert.deepEqual(signature(h.care.getState()), beforeSnapshotMutation);
const restored = setup({ storage: h.storage });
assert.deepEqual(signature(restored.care.getState()), beforeSnapshotMutation);
assert.equal(restored.completion.length, 0);
restored.published.forEach(noStages);
const savedV3 = JSON.parse(h.storage.get(STORE));
const savedV2 = { ...savedV3, version: 2, rollerWork: 0 };
delete savedV2.careWork;
savedV2.products = Object.fromEntries(Object.entries(savedV2.products).map(([id, product]) =>
  [id, { dots: product.dots, film: product.film, work: product.work }]));
const migrationStore = new Map([['dresslab-v2:facial-care:v2', JSON.stringify(savedV2)]]);
const migrated = setup({ storage: migrationStore });
for (const id of ['cleanser', 'serum', 'cream']) {
  const product = migrated.care.getState().products[id];
  assert.deepEqual(plain({ dots: product.dots, film: product.film, work: product.work }), savedV2.products[id]);
  assert.equal(product.absorbed, 0, 'V2 has no prior absorption counter');
}
migrated.window.DressLabCareRoom.setTool('cleanser');
for (let i = 0; i < 5; i++) migrated.toolKey('cleanser');
assert.ok(material(migrated.care.getState().products.cleanser) > 3);
assert.equal(JSON.parse(migrationStore.get(STORE)).version, 3);

// Tool keys apply/use the chosen tool; canvas keys only rub what exists.
const accessible = setup();
accessible.key();
assert.deepEqual(signature(accessible.care.getState()), empty);
for (let i = 0; i < 6; i++) accessible.toolKey('cleanser');
assert.ok(Math.abs(material(accessible.care.getState().products.cleanser) - 6) < 1e-6);
assert.equal(accessible.care.getState().overallProgress, 0);
userSelections = accessible.selections.length;
accessible.key(' ');
assert.ok(sum(accessible.care.getState().products.cleanser.film) > 0);
assert.ok(Math.abs(material(accessible.care.getState().products.cleanser) - 6) < 1e-6);
assert.equal(accessible.care.cursor.hidden, true);
assert.equal(accessible.selections.length, userSelections);

// Wiping a mixed face removes nearby material gradually, and the overall bar
// reflects real care instead of deposits. A full bar never locks free play.
restored.window.DressLabCareRoom.setTool('towel');
const beforeWipe = material(restored.care.getState().products.serum);
restored.toolStroke('towel', [point, { x: 275, y: 620 }, { x: 290, y: 625 }]);
const afterWipe = material(restored.care.getState().products.serum);
assert.ok(afterWipe < beforeWipe && afterWipe > 0);
const fullSave = JSON.parse(h.storage.get(STORE));
fullSave.careWork = Object.fromEntries(tools.map(id => [id, 120]));
fullSave.hydration.fill(1);
const full = setup({ storage: new Map([[STORE, JSON.stringify(fullSave)]]) });
assert.equal(full.care.getState().overallProgress, 1);
const atFull = material(full.care.getState().products.cream);
full.toolTap('cream', point);
assert.ok(material(full.care.getState().products.cream) > atFull, 'Full bar must not block further application');
full.stroke(shortPath);
const saturatedCream = full.care.getState().products.cream;
assert.ok(saturatedCream.absorbed > 0, 'Absorption counter must record material even after skin hydration saturates');
assert.ok(Math.abs(material(saturatedCream) + saturatedCream.absorbed - atFull - 1) < 1e-6);
assert.ok(full.care.getState().hydration.every(value => value === 1));
assert.equal(full.care.getState().overallProgress, 1);
noStages(full.care.getState());
assert.equal(full.completion.length, 0);

// Keyboard towel must find unspread dots at arbitrary source positions,
// even when the face has no dirt/film and the dot misses preset keyboard spots.
const cleanFixture = setup(); cleanFixture.care.reset();
const arbitraryDotSave = JSON.parse(cleanFixture.storage.get(STORE));
arbitraryDotSave.dirt.fill(0);
arbitraryDotSave.products.serum.dots = [{ x: 345, y: 705, amount: 1 }];
const arbitraryWipe = setup({ storage: new Map([[STORE, JSON.stringify(arbitraryDotSave)]]) });
arbitraryWipe.toolKey('towel');
const wipedDot = material(arbitraryWipe.care.getState().products.serum);
assert.ok(wipedDot > 0 && wipedDot < 1, 'Keyboard towel must target and gradually wipe an arbitrary live dot');
assert.ok(arbitraryWipe.care.getState().overallProgress > 0);

// Reset leaves appearance, selected tool and unrelated state untouched.
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

const old = new Map([['dresslab-v2:facial-care:v1', JSON.stringify({ version: 1,
  coverage: Array.from({ length: 5 }, () => Array(100).fill(1)) })]]);
assert.deepEqual(signature(setup({ storage: old }).care.getState()), empty);
for (const value of ['{broken', 'null', '{"version":999}', '{"version":3,"products":{}}']) {
  assert.deepEqual(signature(setup({ storage: new Map([[STORE, value]]) }).care.getState()), empty);
}
// V3 requires a valid absorption counter; V2 migration above accepts absence.
for (const amount of [undefined, null, -1]) {
  const invalidCounter = structuredClone(arbitraryDotSave);
  if (amount === undefined) delete invalidCounter.products.serum.absorbed;
  else invalidCounter.products.serum.absorbed = amount;
  assert.deepEqual(signature(setup({ storage: new Map([[STORE, JSON.stringify(invalidCounter)]]) }).care.getState()), empty);
}
const blocked = setup({ blockedStorage: true });
blocked.toolKey('cleanser');
assert.ok(material(blocked.care.getState().products.cleanser) > 0);
blocked.care.reset();
assert.deepEqual(signature(blocked.care.getState()), empty);
assert.equal(blocked.rafs.size, 1);
blocked.flush();
assert.equal(blocked.rafs.size, 0);
assert.equal(blocked.paints(), 1);

// Source-level UI contract only; this does not claim DOM/layout verification.
const uiSource = fs.readFileSync(path.join(root, 'ui/care-room.js'), 'utf8');
assert.ok(uiSource.includes('ui-facial-overall'));
assert.equal((uiSource.match(/role="progressbar"/g) || []).length, 1);
assert.ok(!/ui-care-tool__(?:done|progress)/.test(uiSource), 'No per-tool completion or progress markup');

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

console.log('PASS: unlimited dragged applications; selection-only taps; bare-finger mixed spreading;');
console.log('tool-only towel/roller; accelerated, time-aware, subpixel-safe work; finite mass/absorption;');
console.log('overall progress from real work with no lock; cancellation/transforms; v3 persistence/v2 migration;');
console.log('keyboard split, no auto-selection, appearance-safe reset, storage fallback and head→care→eyes.');
