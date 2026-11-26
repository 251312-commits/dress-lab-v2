// State/input regression with the real workbench, wardrobe and SVG rasterization.
// Requires @napi-rs/canvas. Run: node tests/dye-workbench-state.cjs
// DOM/event geometry is a fixture: this is NOT browser/layout/touch QA.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createHash } = require('node:crypto');
let raster;
try { raster = require('@napi-rs/canvas'); }
catch (_) {
  raster = require(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES ||
    '/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules', '@napi-rs/canvas'));
}
const { createCanvas, loadImage } = raster;
const root = path.join(__dirname, '..');
const TEE = 'basic-white-tee', PANTS = 'basic-charcoal-pants';

class Element extends EventTarget {
  constructor() {
    super();
    this.attributes = new Map();
    this.dataset = {};
    this.style = { setProperty(name, value) { this[name] = value; } };
    this.hidden = false;
    this.disabled = false;
    this.classes = new Set();
    this.classList = { add: name => this.classes.add(name), toggle: (name, force) =>
      force ? this.classes.add(name) : this.classes.delete(name) };
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  toggleAttribute(name, enabled) {
    if (enabled) this.attributes.set(name, ''); else this.attributes.delete(name);
  }
}

// Native Canvas objects remain valid drawImage inputs; attach only DOM methods.
function interactiveCanvas() {
  const canvas = createCanvas(432, 352), node = new Element();
  for (const name of ['addEventListener', 'dispatchEvent', 'setAttribute', 'getAttribute']) {
    canvas[name] = node[name].bind(node);
  }
  const captured = new Set();
  canvas.setPointerCapture = id => captured.add(id);
  canvas.hasPointerCapture = id => captured.has(id);
  canvas.releasePointerCapture = id => captured.delete(id);
  canvas.getBoundingClientRect = () => ({ left: 220, top: 340, width: 144, height: 352 / 3 });
  return canvas;
}
function emit(target, type, props = {}) {
  const event = new Event(type, { cancelable: true });
  Object.assign(event, props);
  target.dispatchEvent(event);
  return event;
}
const pixelHash = canvas => createHash('sha256').update(Buffer.from(
  canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data)).digest('hex');

async function run() {
  const scene = new Element(), bench = new Element(), colors = new Element();
  scene.dataset.room = 'dress'; scene.dataset.dressTab = 'color';
  const canvas = interactiveCanvas(), progress = new Element(), note = new Element();
  progress.firstElementChild = new Element();
  const nodes = new Map([
    ['ui-scene', scene], ['ui-selection-status', new Element()],
    ['ui-dye-canvas', canvas], ['ui-dye-note', note]
  ]);
  scene.querySelector = selector => ({ '.ui-preview': bench, '.ui-colors': colors })[selector];
  bench.querySelector = selector => ({ '.ui-dye-progress': progress })[selector];
  const document = new EventTarget();
  document.getElementById = id => nodes.get(id) || null;
  document.createElement = tag => { assert.equal(tag, 'canvas'); return createCanvas(1, 1); };
  const window = new EventTarget();
  let selectedId = TEE, nextFrame = 0;
  window.DressLabOutfits = { get selectedId() { return selectedId; } };
  const frames = new Map();
  const flush = () => { for (const [id, callback] of [...frames]) { frames.delete(id); callback(); } };
  const sandbox = { window, document, CustomEvent, console,
    requestAnimationFrame(callback) { frames.set(++nextFrame, callback); return nextFrame; } };
  const context = vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(root, 'clothes/wardrobe.js'), 'utf8'), context);
  const doll = createCanvas(1206, 2622), dollContext = doll.getContext('2d');
  const rig = { canvas: doll, angles: {}, config: { pivots: {} }, renderCount: 0,
    ancestors: () => [], render() {
      this.renderCount++;
      dollContext.clearRect(0, 0, doll.width, doll.height);
      this.wardrobe.draw(dollContext);
    } };
  const wardrobe = new window.DressLabWardrobe(rig);
  window.dressLabWardrobe = wardrobe;
  for (const id of [TEE, PANTS]) {
    const dir = path.join(root, 'clothes', id);
    const item = JSON.parse(fs.readFileSync(path.join(dir, 'item.json'), 'utf8'));
    const parts = await Promise.all(item.parts.map(async part => ({ ...part,
      image: await loadImage(fs.readFileSync(path.join(dir, part.src))) })));
    Object.assign(wardrobe.garmentFor(id), { ready: true, equipped: true, item, parts });
  }
  rig.render();
  const mutationEvents = [];
  window.addEventListener('dresslab:wardrobe-change', event => mutationEvents.push(event.detail));
  let pickerColor;
  window.DressLabColorWheel = { setHex(hex) {
    pickerColor = hex;
    window.dispatchEvent(new CustomEvent('dresslab:color-change', { detail: { hex, source: 'dress' } }));
  } };
  vm.runInContext(fs.readFileSync(path.join(root, 'ui/dye-workbench.js'), 'utf8'), context);
  const workbench = window.DressLabDyeWorkbench;
  const state = () => workbench.getState();
  const appearance = () => JSON.stringify([wardrobe.getItemState(TEE), wardrobe.getItemState(PANTS)]);
  const chooseColor = hex => { window.DressLabColorWheel.setHex(hex); flush(); };
  const chooseItem = id => {
    selectedId = id;
    window.dispatchEvent(new CustomEvent('dresslab:outfit-selection-change', { detail: { id } }));
    flush();
  };
  const room = name => {
    scene.dataset.room = name;
    window.dispatchEvent(new CustomEvent('dresslab:room-change', { detail: { room: name } }));
    flush();
  };
  const tab = name => {
    scene.dataset.dressTab = name;
    window.dispatchEvent(new CustomEvent('dresslab:dress-tab-change', { detail: { tab: name } }));
    flush();
  };
  const pointer = (type, x, y, id = 4) => emit(canvas, type, { pointerId: id,
    isPrimary: true, button: 0, clientX: 220 + x / 3, clientY: 340 + y / 3 });
  const firstStroke = () => {
    pointer('pointerdown', 216, 145);
    pointer('pointermove', 240, 160);
    pointer('pointerup', 240, 160);
  };
  const finish = () => {
    for (let i = 0; i < 16 && state().phase !== 'complete'; i++) {
      emit(canvas, 'keydown', { key: i % 2 ? ' ' : 'Enter', repeat: false });
    }
    assert.equal(state().phase, 'complete');
    assert.equal(state().progress, 100);
    flush();
  };

  assert.equal(state().ready, true);
  assert.doesNotMatch(bench.innerHTML, /<button\b/, 'Dye workbench has no selection or apply buttons');
  const initialPreview = pixelHash(canvas), initialDoll = pixelHash(doll), initialState = appearance();
  chooseColor('#D27B95');
  const pinkPreview = pixelHash(canvas);
  assert.notEqual(pinkPreview, initialPreview);
  assert.equal(pixelHash(doll), initialDoll);
  assert.equal(appearance(), initialState, 'Preview cannot change equipped state or color');
  assert.equal(mutationEvents.length, 0);
  window.dispatchEvent(new CustomEvent('dresslab:skin-color-change', { detail: { hex: '#123456' } }));
  window.dispatchEvent(new CustomEvent('dresslab:color-change', { detail: { hex: '#123456', source: 'skin' } }));
  assert.equal(state().previewColor, '#D27B95', 'Skin input stays independent');

  firstStroke();
  assert.equal(state().phase, 'dyeing', 'First stroke starts work without a selection button');
  assert.equal(colors.inert, true);
  assert.ok(state().progress > 0 && state().progress < 100);
  assert.notEqual(pixelHash(canvas), initialPreview);
  assert.notEqual(pixelHash(canvas), pinkPreview, 'Partial stroke is not the finished preview');
  assert.equal(appearance(), initialState);
  assert.equal(mutationEvents.length, 0);
  chooseColor('#326DD0');
  assert.equal(state().targetColor, '#D27B95');
  assert.equal(pickerColor, '#D27B95', 'In-progress work freezes its target color');
  pointer('pointerdown', 216, 145);
  const partial = state().progress;
  pointer('pointercancel', 216, 145);
  pointer('pointermove', 0, 340);
  assert.equal(state().progress, partial, 'Cancelled pointer movement cannot paint');
  emit(canvas, 'keydown', { key: 'Enter', repeat: true });
  assert.equal(state().progress, partial, 'Held keyboard action cannot finish work');
  finish();
  assert.equal(pixelHash(canvas), pinkPreview);
  assert.equal(wardrobe.getItemState(TEE).color, '#D27B95', 'Completion itself commits the color');
  assert.equal(wardrobe.getItemState(TEE).equipped, true);
  assert.equal(wardrobe.getItemState(PANTS).color, '#4C4E58');
  assert.equal(colors.inert, false, 'Completion unlocks the wheel immediately');
  assert.equal(mutationEvents.length, 1, 'Automatic completion emits one change');
  assert.notEqual(pixelHash(doll), initialDoll);
  firstStroke();
  emit(canvas, 'keydown', { key: 'Enter', repeat: false });
  assert.equal(mutationEvents.length, 1, 'Further input at the same applied color is inert');
  assert.ok(mutationEvents.every(event => event.color), 'Dyeing never changes equipment');

  chooseColor('#326DD0'); firstStroke();
  const beforeCancel = appearance(), eventsBeforeCancel = mutationEvents.length;
  tab('clothes');
  assert.equal(state().phase, 'preview');
  assert.equal(state().targetColor, null);
  assert.equal(appearance(), beforeCancel);
  assert.equal(mutationEvents.length, eventsBeforeCancel);
  assert.equal(colors.inert, false);
  firstStroke();
  emit(canvas, 'keydown', { key: 'Enter', repeat: false });
  assert.equal(state().phase, 'preview', 'Hidden color tab does not receive dye work');
  tab('color');
  assert.equal(state().previewColor, '#326DD0');
  firstStroke();
  chooseItem(PANTS);
  assert.equal(state().phase, 'preview');
  assert.equal(state().itemId, PANTS);
  assert.equal(appearance(), beforeCancel, 'Switching worn garments discards unfinished dye');
  pointer('pointermove', 400, 300);
  assert.equal(state().progress, 0);

  chooseColor('#548C66');
  emit(canvas, 'keydown', { key: 'Enter', repeat: false });
  assert.equal(state().phase, 'dyeing', 'Keyboard starts dyeing directly');
  assert.ok(state().progress > 0);
  assert.equal(wardrobe.getItemState(PANTS).color, '#4C4E58');
  finish();
  assert.equal(wardrobe.getItemState(PANTS).color, '#548C66');
  assert.equal(wardrobe.getItemState(TEE).color, '#D27B95');
  chooseItem(TEE); firstStroke();
  const beforeRoom = appearance(), roomEvents = mutationEvents.length;
  room('magic');
  assert.equal(state().phase, 'preview');
  assert.equal(colors.inert, false);
  assert.equal(appearance(), beforeRoom);
  assert.equal(mutationEvents.length, roomEvents);
  room('dress');
  assert.equal(state().phase, 'preview');

  // Equipment changes belong to the clothes panel, never to dye input.
  wardrobe.setEquipped(false, TEE);
  chooseItem(null);
  assert.equal(state().ready, false);
  const noGarmentEvents = mutationEvents.length;
  firstStroke(); emit(canvas, 'keydown', { key: 'Enter', repeat: false });
  assert.equal(wardrobe.getItemState(TEE).equipped, false);
  assert.equal(mutationEvents.length, noGarmentEvents);
  wardrobe.setEquipped(true, TEE); chooseItem(TEE);
  assert.equal(state().ready, true);
  assert.equal(wardrobe.getItemState(TEE).color, '#D27B95', 'Re-equipping keeps the dyed color');
  chooseColor('#8B7FC4');
  const realCommit = wardrobe.setDyeColor, failedEvents = mutationEvents.length;
  let failedCommits = 0;
  wardrobe.setDyeColor = () => { failedCommits++; return false; };
  for (let index = 0; index < 16 && !failedCommits; index++) {
    emit(canvas, 'keydown', { key: 'Enter', repeat: false });
  }
  assert.equal(failedCommits, 1);
  assert.equal(wardrobe.getItemState(TEE).color, '#D27B95', 'Failed automatic apply preserves the worn color');
  assert.equal(mutationEvents.length, failedEvents);
  assert.equal(state().phase, 'preview');
  assert.equal(colors.inert, false);
  assert.equal(note.hidden, false, 'A failed commit has a short visible retry message');
  wardrobe.setDyeColor = realCommit;
  finish();
  assert.equal(wardrobe.getItemState(TEE).color, '#8B7FC4', 'Another stroke can retry without a button');
  chooseColor('#FFFFFF'); finish();
  assert.equal(wardrobe.getItemState(TEE).color, '#FFFFFF');
  assert.equal(pixelHash(canvas), initialPreview, 'Native color restores original SVG art');
  assert.equal(wardrobe.getItemState(PANTS).color, '#548C66');
  console.log('PASS: button-free preview/first-stroke/automatic-commit, real masked pixels, one commit, tab/room/item cancellation, equipped-only targets, independent colors and native restore');
  console.log('LIMIT: DOM, geometry and pointer delivery are fixtures; CSS and native mobile interaction still require browser QA.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
