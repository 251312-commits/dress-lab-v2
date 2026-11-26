// Real wardrobe + SVG thumbnails; minimal DOM events model the tab boundary.
// Run: node tests/wardrobe-panel.cjs (requires @napi-rs/canvas).
// This does not verify CSS visibility or native mobile event delivery.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createHash } = require('node:crypto');
let raster;
try { raster = require('@napi-rs/canvas'); }
catch (_) { raster = require(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES ||
  '/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules', '@napi-rs/canvas')); }
const { createCanvas, loadImage } = raster;
const root = path.join(__dirname, '..');
const TEE = 'basic-white-tee', PANTS = 'basic-charcoal-pants';
const slotsOrder = ['upper', 'accessory', 'belt', 'lower', 'shoes', 'extra'];
class Element {
  constructor() { this.dataset = {}; this.attributes = new Map(); this.listeners = new Map(); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  addEventListener(type, callback) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(callback);
  }
  fire(type, target = this) { for (const callback of this.listeners.get(type) || []) callback({ target }); }
  closest(selector) {
    if (selector === '[data-wardrobe-item]' && this.dataset.wardrobeItem ||
        selector === '[data-outfit-slot]' && this.dataset.outfitSlot ||
        selector === '#ui-wardrobe-clear' && this.id === 'ui-wardrobe-clear') return this;
    return this.parent?.closest(selector) || null;
  }
}
const hash = canvas => createHash('sha256').update(Buffer.from(
  canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data)).digest('hex');
const opaque = canvas => {
  const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
  let count = 0;
  for (let index = 3; index < data.length; index += 4) if (data[index]) count++;
  return count;
};

async function run() {
  const scene = new Element(), panel = new Element(), slots = new Element(), status = new Element();
  scene.dataset.room = 'dress'; scene.dataset.dressTab = 'color';
  const cards = new Map(), clearButton = new Element(); clearButton.id = 'ui-wardrobe-clear';
  Object.defineProperty(panel, 'innerHTML', { set(html) {
    this.markup = html;
    for (const match of html.matchAll(/data-wardrobe-item="([^"]+)"/g)) {
      const card = new Element(); card.dataset.wardrobeItem = match[1];
      card.canvas = createCanvas(210, 320); card.canvas.hidden = true;
      card.canvas.parent = card; card.canvas.closest = selector => card.closest(selector);
      card.state = new Element();
      card.querySelector = selector => ({ '.ui-wardrobe-card__art': card.canvas,
        '.ui-wardrobe-card__state': card.state })[selector];
      cards.set(match[1], card);
    }
  } });
  panel.querySelector = selector => selector === '#ui-wardrobe-clear' ? clearButton :
    cards.get(/^\[data-wardrobe-item="([^"]+)"\]$/.exec(selector)?.[1]);
  const buttons = slotsOrder.map(id => {
    const button = new Element(); button.dataset.outfitSlot = id;
    button.canvas = createCanvas(138, 152); button.canvas.hidden = true;
    button.canvas.closest = selector => button.closest(selector);
    button.querySelector = selector => selector === '.ui-outfit-item__art' ? button.canvas : null;
    return button;
  });
  const slot = id => buttons.find(button => button.dataset.outfitSlot === id);
  slots.querySelectorAll = selector => selector === '[data-outfit-slot]' ? buttons : [];
  scene.querySelector = selector => ({ '.ui-wardrobe-panel': panel, '.ui-outfit-grid': slots })[selector];
  const document = { getElementById: id => ({ 'ui-scene': scene, 'ui-selection-status': status })[id],
    createElement(tag) { assert.equal(tag, 'canvas'); return createCanvas(1, 1); } };
  const window = new EventTarget();
  const context = vm.createContext({ window, document, CustomEvent, console });
  vm.runInContext(fs.readFileSync(path.join(root, 'clothes/wardrobe.js'), 'utf8'), context);
  const doll = createCanvas(1206, 2622), ctx = doll.getContext('2d');
  const rig = { canvas: doll, config: { pivots: {} }, angles: {}, ancestors: () => [], renders: 0,
    render() { this.renders++; ctx.clearRect(0, 0, doll.width, doll.height); this.wardrobe.draw(ctx); } };
  const wardrobe = new window.DressLabWardrobe(rig); window.dressLabWardrobe = wardrobe;
  const drawPreview = wardrobe.renderPreview.bind(wardrobe), previewCalls = [];
  wardrobe.renderPreview = (canvas, id, color) => {
    previewCalls.push({ id, color }); return drawPreview(canvas, id, color);
  };
  const selections = [];
  window.addEventListener('dresslab:outfit-selection-change', event => selections.push(event.detail.id));
  vm.runInContext(fs.readFileSync(path.join(root, 'ui/wardrobe-panel.js'), 'utf8'), context);
  const outfits = window.DressLabOutfits;
  assert.equal(outfits.selectedId, null);
  assert.ok(buttons.every(button => button.disabled && button.canvas.hidden));
  assert.ok([...cards.values()].every(card => card.disabled));
  assert.equal(outfits.select(TEE), false, 'Unloaded items cannot become dye targets');

  for (const id of [TEE, PANTS]) {
    const dir = path.join(root, 'clothes', id);
    const item = JSON.parse(fs.readFileSync(path.join(dir, 'item.json'), 'utf8'));
    const parts = await Promise.all(item.parts.map(async part => ({ ...part,
      image: await loadImage(fs.readFileSync(path.join(dir, part.src))) })));
    Object.assign(wardrobe.garmentFor(id), { ready: true, equipped: true, item, parts });
    window.dispatchEvent(new CustomEvent('dresslab:wardrobe-ready', { detail: { id } }));
  }
  assert.equal(outfits.selectedId, TEE);
  assert.deepEqual(selections, [TEE], 'Ready events do not duplicate unchanged selection');
  assert.equal(buttons.filter(button => !button.disabled).length, 2);
  assert.equal(slot('upper').dataset.equippedItem, TEE);
  assert.equal(slot('lower').dataset.equippedItem, PANTS);
  for (const button of buttons.filter(button => !button.disabled)) {
    assert.equal(button.canvas.hidden, false);
    assert.ok(opaque(button.canvas) > 1000, 'Filled slots contain real garment art');
  }
  for (const button of buttons.filter(button => button.disabled)) {
    assert.equal(button.dataset.equippedItem, undefined);
    assert.equal(opaque(button.canvas), 0, 'Empty slots cannot show unrelated category icons');
  }
  const nativeUpper = hash(slot('upper').canvas), nativeCard = hash(cards.get(TEE).canvas);
  const nativeLower = hash(slot('lower').canvas), beforePreviewCalls = previewCalls.length;
  window.dispatchEvent(new CustomEvent('dresslab:color-change', { detail: { hex: '#D27B95', source: 'dress' } }));
  outfits.sync();
  assert.equal(hash(slot('upper').canvas), nativeUpper);
  assert.equal(hash(cards.get(TEE).canvas), nativeCard);
  assert.equal(previewCalls.length, beforePreviewCalls, 'Candidate changes never rerasterize equipped thumbnails');
  wardrobe.setDyeColor('#D27B95', TEE);
  const dyedUpper = hash(slot('upper').canvas);
  assert.notEqual(dyedUpper, nativeUpper);
  assert.notEqual(hash(cards.get(TEE).canvas), nativeCard);
  assert.equal(hash(slot('lower').canvas), nativeLower);
  assert.equal(previewCalls.length - beforePreviewCalls, 2, 'Only the changed slot and catalog thumbnail redraw');
  const equippedSnapshot = JSON.stringify([wardrobe.getItemState(TEE), wardrobe.getItemState(PANTS)]);
  const beforeSelectionRenders = rig.renders;
  slots.fire('click', slot('lower').canvas);
  assert.equal(outfits.selectedId, PANTS);
  assert.equal(JSON.stringify([wardrobe.getItemState(TEE), wardrobe.getItemState(PANTS)]), equippedSnapshot);
  assert.equal(rig.renders, beforeSelectionRenders, 'Choosing a dye target never changes equipment');

  panel.fire('click', cards.get(TEE));
  assert.equal(wardrobe.getItemState(TEE).equipped, true, 'Color tab cannot trigger hidden wear controls');
  scene.dataset.room = 'magic'; scene.dataset.dressTab = 'clothes';
  panel.fire('click', cards.get(TEE));
  assert.equal(wardrobe.getItemState(TEE).equipped, true);
  scene.dataset.room = 'dress';
  panel.fire('click', cards.get(TEE).canvas);
  assert.equal(wardrobe.getItemState(TEE).equipped, false);
  assert.equal(cards.get(TEE).getAttribute('aria-pressed'), 'false');
  assert.equal(slot('upper').disabled, true);
  assert.equal(slot('upper').canvas.hidden, true);
  assert.equal(slot('upper').dataset.equippedItem, undefined);
  assert.equal(opaque(slot('upper').canvas), 0, 'Removing an item clears its real thumbnail pixels');
  assert.equal(outfits.select(TEE), false, 'Unworn garments cannot be selected on the dye bench');
  slots.fire('click', slot('upper'));
  assert.equal(wardrobe.getItemState(TEE).equipped, false);
  panel.fire('click', cards.get(TEE));
  assert.equal(wardrobe.getItemState(TEE).equipped, true);
  assert.equal(outfits.selectedId, TEE);
  assert.equal(wardrobe.getItemState(TEE).color, '#D27B95');
  assert.equal(hash(slot('upper').canvas), dyedUpper);
  assert.equal(scene.dataset.dressTab, 'clothes', 'Choosing clothes does not force a tab switch');
  const selectionCount = selections.length;
  outfits.select(TEE);
  assert.equal(selections.length, selectionCount);

  scene.dataset.dressTab = 'color'; panel.fire('click', clearButton);
  assert.equal(wardrobe.getItemState(TEE).equipped, true);
  scene.dataset.dressTab = 'clothes'; panel.fire('click', clearButton);
  assert.equal(outfits.selectedId, null);
  assert.equal(wardrobe.getItemState(TEE).equipped, false);
  assert.equal(wardrobe.getItemState(PANTS).equipped, false);
  assert.ok(buttons.every(button => button.disabled && button.canvas.hidden && opaque(button.canvas) === 0));
  assert.equal(clearButton.disabled, true);

  wardrobe.pants.ready = false; wardrobe.loadErrors[PANTS] = 'Fixture load failure';
  window.dispatchEvent(new CustomEvent('dresslab:wardrobe-error', { detail: { id: PANTS } }));
  assert.equal(cards.get(PANTS).disabled, true);
  assert.equal(cards.get(PANTS).state.textContent, '로드 실패');
  panel.fire('click', cards.get(TEE));
  assert.equal(outfits.selectedId, TEE, 'A failed garment leaves the other usable');
  assert.equal(slot('lower').disabled, true);
  const stableCalls = previewCalls.length;
  outfits.sync(); outfits.sync();
  assert.equal(previewCalls.length, stableCalls, 'Stable applied thumbnails reuse their cached render');
  console.log('PASS: clothes-only equipment changes, delayed/partial load, real applied-color thumbnails, empty slots, dye-target-only selection and cached redraws');
  console.log('LIMIT: minimal DOM fixture; browser CSS visibility and native touch still need browser QA.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
