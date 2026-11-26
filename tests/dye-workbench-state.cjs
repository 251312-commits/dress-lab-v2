// State/input regression with the real workbench, wardrobe and SVG rasterization.
// Requires @napi-rs/canvas. Run: node tests/dye-workbench-state.cjs
// DOM/event geometry is a small fixture: this is NOT browser/layout/touch QA.
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

// Keep native Canvas objects as native drawImage inputs; attach only DOM methods.
function interactiveCanvas() {
  const canvas = createCanvas(432, 244), node = new Element();
  for (const name of ['addEventListener', 'dispatchEvent', 'setAttribute', 'getAttribute']) {
    canvas[name] = node[name].bind(node);
  }
  const captured = new Set();
  canvas.setPointerCapture = id => captured.add(id);
  canvas.hasPointerCapture = id => captured.has(id);
  canvas.releasePointerCapture = id => captured.delete(id);
  canvas.getBoundingClientRect = () => ({ left: 220, top: 340, width: 144, height: 244 / 3 });
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
  const selected = new Element(); selected.dataset.item = 'shirt'; scene.dataset.room = 'dress';
  const canvas = interactiveCanvas();
  const primary = new Element(), secondary = new Element(), progress = new Element();
  progress.firstElementChild = new Element();
  const symbol = new Element(), use = new Element();
  const nodes = new Map([
    ['ui-scene', scene], ['ui-selection-status', new Element()],
    ['ui-dye-canvas', canvas], ['ui-dye-select', primary],
    ['ui-dye-cancel', secondary], ['ui-dye-phase', new Element()]
  ]);
  scene.querySelector = selector => ({ '.ui-preview': bench, '.ui-colors': colors,
    ".ui-outfit-item[aria-pressed='true']": selected })[selector];
  bench.querySelector = selector => ({ '.ui-dye-progress': progress,
    '.ui-preview__icon': symbol, '#ui-preview-use': use })[selector];
  const document = new EventTarget();
  document.getElementById = id => nodes.get(id) || null;
  document.createElement = tag => { assert.equal(tag, 'canvas'); return createCanvas(1, 1); };
  const window = new EventTarget();
  let nextFrame = 0;
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
  window.addEventListener('dresslab:wardrobe-change', event => {
    mutationEvents.push(event.detail);
    // Mirrors layout.js's public event wiring without mocking the controller.
    window.DressLabDyeWorkbench?.sync();
  });
  let pickerColor;
  window.DressLabColorWheel = { setHex(hex) {
    pickerColor = hex;
    window.dispatchEvent(new CustomEvent('dresslab:color-change', { detail: { hex, source: 'dress' } }));
  } };
  vm.runInContext(fs.readFileSync(path.join(root, 'ui/dye-workbench.js'), 'utf8'), context);
  const workbench = window.DressLabDyeWorkbench;
  const state = () => workbench.getState();
  const appearance = () => JSON.stringify([wardrobe.getItemState(TEE), wardrobe.getItemState(PANTS)]);
  const click = (button = primary, detail = 1) => {
    if (!button.disabled) emit(button, 'click', { detail });
    flush();
  };
  const chooseColor = hex => { window.DressLabColorWheel.setHex(hex); flush(); };
  const chooseItem = item => { selected.dataset.item = item; workbench.sync(); flush(); };
  const room = name => {
    scene.dataset.room = name;
    window.dispatchEvent(new CustomEvent('dresslab:room-change', { detail: { room: name } }));
    flush();
  };
  const pointer = (type, x, y, id = 4) => emit(canvas, type, { pointerId: id,
    isPrimary: true, button: 0, clientX: 220 + x / 3, clientY: 340 + y / 3 });
  const finish = (keyboard = false) => {
    for (let i = 0; i < 12 && state().phase === 'dyeing'; i++) {
      if (keyboard) emit(canvas, 'keydown', { key: 'Enter', repeat: false }); else click();
    }
    assert.equal(state().phase, 'complete');
    assert.equal(primary.textContent, '적용');
  };

  assert.equal(state().ready, true);
  assert.equal(primary.disabled, true);
  assert.equal(symbol.getAttribute('hidden'), '', 'Loaded art hides the SVG placeholder attribute');
  const initialPreview = pixelHash(canvas), initialDoll = pixelHash(doll), initialState = appearance();
  chooseColor('#D27B95');
  const pinkPreview = pixelHash(canvas);
  assert.notEqual(pinkPreview, initialPreview);
  assert.equal(pixelHash(doll), initialDoll);
  assert.equal(appearance(), initialState, 'Candidate color cannot change equipped state or color');
  assert.equal(mutationEvents.length, 0);
  window.dispatchEvent(new CustomEvent('dresslab:skin-color-change', { detail: { hex: '#123456' } }));
  window.dispatchEvent(new CustomEvent('dresslab:color-change', { detail: { hex: '#123456', source: 'skin' } }));
  assert.equal(state().previewColor, '#D27B95', 'Skin input stays independent');

  click();
  assert.equal(state().phase, 'dyeing');
  assert.equal(colors.inert, true);
  assert.equal(pixelHash(canvas), initialPreview, 'Dyeing begins from the applied color');
  chooseColor('#326DD0');
  assert.equal(state().targetColor, '#D27B95');
  assert.equal(pickerColor, '#D27B95', 'An in-progress job freezes its target color');
  pointer('pointerdown', 216, 85);
  pointer('pointermove', 240, 110);
  assert.ok(state().progress > 0 && state().progress < 100);
  assert.notEqual(pixelHash(canvas), initialPreview, 'Real masked canvas changes on a brush stroke');
  assert.notEqual(pixelHash(canvas), pinkPreview, 'A partial stroke is not the complete preview');
  const partial = state().progress;
  pointer('pointercancel', 240, 110);
  pointer('pointermove', 0, 240);
  assert.equal(state().progress, partial, 'Cancelled pointer movement cannot paint');
  emit(canvas, 'keydown', { key: 'Enter', repeat: true });
  assert.equal(state().progress, partial, 'Holding the keyboard action cannot finish the job');
  finish(true);
  assert.equal(pixelHash(canvas), pinkPreview);
  assert.equal(pixelHash(doll), initialDoll);
  assert.equal(appearance(), initialState, 'Even a completed job remains unapplied');
  assert.equal(mutationEvents.length, 0);
  click(primary, 2);
  assert.equal(state().phase, 'complete', 'Double-click continuation cannot apply');
  const repeatedKey = emit(primary, 'keydown', { key: 'Enter', repeat: true });
  assert.equal(repeatedKey.defaultPrevented, true, 'Native repeated-key click is prevented');
  click();
  assert.equal(wardrobe.getItemState(TEE).color, '#D27B95');
  assert.equal(wardrobe.getItemState(TEE).equipped, true);
  assert.equal(wardrobe.getItemState(PANTS).color, '#4C4E58');
  assert.equal(state().phase, 'preview');
  assert.equal(colors.inert, false);
  assert.equal(mutationEvents.filter(event => event.color).length, 1);
  assert.notEqual(pixelHash(doll), initialDoll);
  click();
  assert.equal(mutationEvents.filter(event => event.color).length, 1, 'Applied color is committed once');

  click(secondary);
  assert.equal(wardrobe.getItemState(TEE).equipped, false);
  assert.equal(primary.textContent, '착용');
  click();
  assert.equal(wardrobe.getItemState(TEE).equipped, true, 'Same-color clothes can be worn without re-dyeing');
  assert.equal(state().phase, 'preview');
  chooseColor('#326DD0'); click(); click();
  const beforeCancel = appearance(), eventsBeforeCancel = mutationEvents.length;
  click(secondary);
  assert.equal(state().phase, 'preview');
  assert.equal(appearance(), beforeCancel);
  assert.equal(mutationEvents.length, eventsBeforeCancel);
  click(); pointer('pointerdown', 216, 100);
  chooseItem('pants');
  assert.equal(state().phase, 'preview');
  assert.equal(state().itemId, PANTS);
  assert.equal(appearance(), beforeCancel, 'Changing garments discards the unfinished job');
  pointer('pointermove', 400, 200);
  assert.equal(state().progress, 0);

  chooseColor('#548C66'); click(); finish();
  assert.equal(wardrobe.getItemState(PANTS).color, '#4C4E58');
  click();
  assert.equal(wardrobe.getItemState(PANTS).color, '#548C66');
  assert.equal(wardrobe.getItemState(TEE).color, '#D27B95');
  chooseItem('shirt'); click(); click();
  const beforeRoom = appearance(), roomEvents = mutationEvents.length;
  room('magic');
  assert.equal(state().phase, 'preview');
  assert.equal(colors.inert, false);
  assert.equal(appearance(), beforeRoom);
  assert.equal(mutationEvents.length, roomEvents);
  room('dress');
  assert.equal(state().phase, 'preview');
  chooseItem('bow');
  assert.equal(state().ready, false);
  assert.equal(primary.disabled, true);
  chooseItem('shirt');
  assert.equal(state().ready, true);
  chooseColor('#FFFFFF'); click(); finish(); click();
  assert.equal(wardrobe.getItemState(TEE).color, '#FFFFFF');
  assert.equal(pixelHash(canvas), initialPreview, 'Re-dyeing to the native color restores original SVG art');
  assert.equal(wardrobe.getItemState(PANTS).color, '#548C66');
  console.log('PASS: real SVG/canvas preview isolation, masked strokes, completion/apply boundary, cancellation, item/room changes, garment/skin independence, repeat-input guards and native-color restore');
  console.log('LIMIT: DOM nodes, pointer geometry/capture and button defaults are fixtures; browser rendering, CSS, mobile hit targets and native event delivery require browser QA.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
