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
const STORE = 'dresslab-v2:facial-care:v1';

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
const signature = state => plain({ stage: state.stage, stageIndex: state.stageIndex,
  completed: state.completed, stages: state.stages });

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
    setTool(tool) {
      if (currentTab !== 'facial' || !tools.includes(tool)) return false;
      if (selectedTool === tool) return true;
      selectedTool = tool;
      window.dispatchEvent({ type: 'dresslab:care-tool-select', detail: { tab: currentTab, tool } });
      return true;
    }
  };
  let frameId = 0, paints = 0;
  const rafs = new Map(), published = [], completion = [];
  window.addEventListener('dresslab:facial-progress', event => published.push(plain(event.detail)));
  window.addEventListener('dresslab:facial-complete', event => completion.push(plain(event.detail)));
  const sandbox = {
    window, document, console, localStorage: {
      getItem(key) { if (blockedStorage) throw new Error('Storage blocked'); return storage.get(key) || null; },
      setItem(key, value) { if (blockedStorage) throw new Error('Storage blocked'); storage.set(key, value); }
    },
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options?.detail; } },
    performance: { now: () => 1000 },
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
  const key = (key = 'Enter', repeat = false) => canvas.dispatchEvent({ type: 'keydown', key, repeat });
  function pointer(type, point, extra = {}) {
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
  function finishStage() {
    const stage = care.getState().stage;
    let count = 0;
    while (care.getState().stage === stage && count < 150) { key(count % 2 ? ' ' : 'Enter'); count++; }
    assert.ok(count > 0 && count < 150, 'Keyboard must complete ' + stage);
    return count;
  }
  function flush() {
    const callbacks = [...rafs.values()]; rafs.clear();
    callbacks.forEach(fn => fn(1000));
  }
  return { window, document, canvas, care, rig, shape, storage, key, pointer, client,
    finishStage, published, completion, flush, rafs, paints: () => paints };
}

// A wrong tool, inactive tab, right mouse button, second pointer, eyes and
// outside-face events must never create coverage.
const h = setup();
const empty = signature(h.care.getState());
h.window.DressLabCareRoom.setTool('roller');
h.key();
h.pointer('pointerdown', { x: 329, y: 650 });
h.pointer('pointerup', { x: 329, y: 650 });
assert.deepEqual(signature(h.care.getState()), empty);
assert.match(h.care.getState().message, /클렌저/);
h.window.DressLabCareRoom.setTool('cleanser');
for (const p of [{ x: 75, y: 720 }, { x: 237, y: 800 }, { x: 422, y: 800 }]) {
  h.pointer('pointerdown', p); h.pointer('pointermove', p); h.pointer('pointerup', p);
}
h.pointer('pointerdown', { x: 329, y: 650 }, { button: 2 });
h.pointer('pointerdown', { x: 329, y: 650 }, { isPrimary: false, pointerId: 2 });
h.key('Enter', true);
assert.deepEqual(signature(h.care.getState()), empty);

// Verify the inverse against independent forward geometry under extremes,
// current torso pivot changes, nonuniform root scales and CSS display sizing.
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
  h.pointer('pointerdown', { x: 329, y: 650 });
  h.pointer('pointermove', { x: 360, y: 680 });
  h.pointer('pointerup', { x: 360, y: 680 });
  assert.ok(h.care.getState().progress > 0 && h.care.getState().progress < 1,
    'Transformed pointer stroke must create partial coverage');
}

// Repeating a contact without covering new face area does not inflate progress.
const partial = signature(h.care.getState());
for (let i = 0; i < 20; i++) {
  h.pointer('pointerdown', { x: 329, y: 650 });
  h.pointer('pointerup', { x: 329, y: 650 });
}
assert.deepEqual(signature(h.care.getState()), partial);
h.pointer('pointerdown', { x: 329, y: 650 });
h.pointer('pointercancel', { x: 329, y: 650 });
h.pointer('pointermove', { x: 329, y: 570 });
assert.deepEqual(signature(h.care.getState()), partial, 'Cancelled pointer must not keep painting');
assert.equal(h.care.pointerId, null);
assert.equal(h.care.cursor.hidden, true);

// Room/tab changes disable input and terminate active strokes without losing
// progress. Return selects the first unfinished stage rather than a stale tool.
h.pointer('pointerdown', { x: 329, y: 650 });
h.window.DressLabRooms.setRoom('dress');
h.key();
h.pointer('pointermove', { x: 329, y: 570 });
assert.deepEqual(signature(h.care.getState()), partial);
assert.equal(h.canvas.getAttribute('role'), 'img');
assert.equal(h.canvas.getAttribute('aria-label'), '원래 인형');
assert.equal(h.care.pointerId, null);
h.window.DressLabRooms.setRoom('care');
h.window.DressLabCareRoom.setTab('relaxation');
h.key();
assert.deepEqual(signature(h.care.getState()), partial);
h.window.DressLabCareRoom.setTab('facial');
assert.equal(h.window.DressLabCareRoom.selectedTool, 'cleanser');
assert.equal(h.care.getState().active, true);

// Round-trip partial state through a fresh module/DOM, then complete all five
// stages only through the installed keyboard handler.
const restored = setup({ storage: h.storage });
assert.deepEqual(signature(restored.care.getState()), partial);
const presses = {};
for (const id of tools) {
  assert.equal(restored.care.getState().stage, id);
  assert.equal(restored.window.DressLabCareRoom.selectedTool, id, 'Next tool selection must be synchronized');
  presses[id] = restored.finishStage();
  assert.equal(restored.care.getState().stages.find(item => item.id === id).complete, true);
}
const complete = signature(restored.care.getState());
assert.equal(complete.completed, true);
assert.equal(complete.stage, null);
assert.ok(complete.stages.every(item => item.progress === 1 && item.complete));
assert.equal(restored.completion.length, 1, 'Exactly one completion event');
restored.key();
assert.equal(restored.completion.length, 1, 'Repeated input after completion must not fire again');
const resumed = setup({ storage: h.storage });
assert.deepEqual(signature(resumed.care.getState()), complete);
assert.equal(resumed.window.DressLabCareRoom.selectedTool, 'roller');
assert.ok(resumed.published.length > 0);
assert.deepEqual(signature(resumed.published.at(-1)), complete);

// Reset through the UI event, with independent appearance data on the rig.
resumed.rig.skinTone = { hex: '#C68C73' };
resumed.rig.wardrobe = { equipped: false };
resumed.rig.eyes = { targetX: 12, targetY: -7 };
resumed.shape.head = 113;
const appearance = plain({ shape: resumed.shape, skin: resumed.rig.skinTone,
  wardrobe: resumed.rig.wardrobe, eyes: resumed.rig.eyes });
resumed.window.dispatchEvent({ type: 'dresslab:facial-reset' });
assert.deepEqual(signature(resumed.care.getState()), empty);
assert.deepEqual(plain({ shape: resumed.shape, skin: resumed.rig.skinTone,
  wardrobe: resumed.rig.wardrobe, eyes: resumed.rig.eyes }), appearance);
assert.deepEqual(signature(setup({ storage: h.storage }).care.getState()), empty,
  'Reset must overwrite persisted coverage');

// Malformed, unknown, out-of-order and blocked storage must not crash or skip.
for (const value of ['{broken', 'null', '{"version":999}', '{"version":1,"coverage":[]}',
  JSON.stringify({ version: 1, coverage: Array.from({ length: 5 }, () => [NaN]) })]) {
  const candidate = setup({ storage: new Map([[STORE, value]]) });
  assert.deepEqual(signature(candidate.care.getState()), empty);
}
const validSaved = JSON.parse(h.storage.get(STORE));
validSaved.coverage[4].fill(1);
const unordered = setup({ storage: new Map([[STORE, JSON.stringify(validSaved)]]) });
assert.deepEqual(signature(unordered.care.getState()), empty, 'Future rows cannot skip earlier stages');
const blocked = setup({ blockedStorage: true });
blocked.key();
assert.ok(blocked.care.getState().progress > 0);
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

console.log('PASS: inverse transforms, face/eye/wrong-tool guards, cancellation, new-area coverage,');
console.log('room/tab transitions, 5-stage keyboard completion, tool/event sync, persistence and reset:', presses);
console.log('malformed/blocked storage, appearance isolation, coalesced rendering, head→care→eyes ordering.');
