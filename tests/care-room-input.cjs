/* Production UI handlers run in a small DOM/event harness. This covers gesture
 * arbitration and UI state; it does not replace browser/device visual checks. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../ui/care-room.js'), 'utf8');

function fixture(initial = { selectedTool: 'cleanser', overallProgress: 0 }) {
  const captures = new Map(), emitted = [], nodes = {}, scrollCalls = [];
  let window, document, viewport, careRoom;
  class Event {
    constructor(type, init = {}) { Object.assign(this, { type, bubbles: true, detail: 0 }, init); }
    preventDefault() { this.defaultPrevented = true; }
    stopPropagation() { this.stopped = true; }
  }
  class Node {
    constructor(kind) {
      this.kind = kind; this.dataset = {}; this.attributes = {}; this.listeners = {};
      this.hidden = false; this.textContent = ''; this.children = []; this._scrollLeft = 0;
      this.style = { setProperty(name, value) { this[name] = String(value); } };
      const classes = new Set();
      this.classList = { add: (...xs) => xs.forEach(x => classes.add(x)),
        remove: (...xs) => xs.forEach(x => classes.delete(x)), contains: x => classes.has(x) };
    }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    getAttribute(name) { return this.attributes[name] ?? null; }
    appendChild(node) { node.parentElement = this; return node; }
    addEventListener(type, fn, options) {
      (this.listeners[type] ||= []).push({ fn, capture: options === true || !!options?.capture });
    }
    dispatchEvent(event) {
      event.target ||= this;
      if (this === window) emitted.push(event);
      const ancestors = []; for (let p = this.parentElement; p; p = p.parentElement) ancestors.push(p);
      const call = (node, capture) => {
        for (const item of node.listeners[event.type] || []) if (item.capture === capture) item.fn(event);
      };
      for (const node of ancestors.slice().reverse()) { call(node, true); if (event.stopped) return false; }
      call(this, true); if (event.stopped) return false;
      call(this, false); if (event.stopped) return false;
      if (event.bubbles) for (const node of ancestors) { call(node, false); if (event.stopped) break; }
      return !event.defaultPrevented;
    }
    closest(selector) {
      const matches = { '.ui-care-tool': 'tool', '.ui-care-tab': 'tab', '#ui-care-talk': 'talk',
        '[data-shelf-direction]': 'arrow' };
      for (let node = this; node; node = node.parentElement) if (node.kind === matches[selector]) return node;
      return null;
    }
    querySelector(selector) { return nodes[selector] || null; }
    querySelectorAll(selector) {
      if (selector === '.ui-care-tool') return viewport.children.map(slot => slot.children[0]);
      if (selector === '.ui-care-tab') return this.tabs || [];
      if (selector === '.ui-care-shelf-page') return this.dots || [];
      return [];
    }
    get innerHTML() { return this.html || ''; }
    set innerHTML(value) {
      this.html = value;
      if (this.kind === 'viewport') {
        this.children = [...value.matchAll(/data-care-tool="([^"]+)"/g)].map((match, index) => {
          const slot = new Node('slot'), button = new Node('tool');
          slot.offsetLeft = index * 1030 / 3; slot.offsetWidth = 1030 / 3;
          slot.parentElement = this; button.parentElement = slot;
          button.dataset.careTool = match[1]; slot.children = [button]; return slot;
        });
      } else if (this.kind === 'care') {
        this.tabs = [...value.matchAll(/data-care-tab="([^"]+)"/g)].map(match => {
          const tab = new Node('tab'); tab.dataset.careTab = match[1]; tab.parentElement = this; return tab;
        });
        const markup = value.match(/<div class="ui-facial-overall"([^>]*)>/)?.[1] || '';
        for (const match of markup.matchAll(/([\w-]+)="([^"]*)"/g)) nodes['.ui-facial-overall'].setAttribute(match[1], match[2]);
      } else if (this.kind === 'pages') {
        this.dots = [...value.matchAll(/ui-care-shelf-page/g)].map(() => new Node('dot'));
      }
    }
    get clientWidth() { return 1030; }
    get scrollWidth() { return this.children.length * 1030 / 3; }
    get scrollLeft() { return Math.max(0, Math.min(this.scrollWidth - this.clientWidth, this._scrollLeft)); }
    set scrollLeft(value) { this._scrollLeft = Math.max(0, Math.min(this.scrollWidth - this.clientWidth, value)); }
    scrollTo(options) { this.scrollLeft = options.left; scrollCalls.push(options); this.dispatchEvent(new Event('scroll', { bubbles: false })); }
    getBoundingClientRect() { return { left: 28.16, top: 623.04, width: 329.6, height: 115.2 }; }
    setPointerCapture(id) { captures.set(id, this); }
    hasPointerCapture(id) { return captures.get(id) === this; }
    releasePointerCapture(id) { captures.delete(id); }
    focus() { document.activeElement = this; this.dispatchEvent(new Event('focusin')); }
  }
  window = new Node('window'); document = new Node('document'); document.parentElement = window;
  const scene = new Node('scene'); scene.parentElement = document; scene.dataset.room = 'care';
  careRoom = new Node('care'); viewport = new Node('viewport');
  const selectors = { '.ui-facial-overall': 'overall', '.ui-facial-overall__value': 'value',
    '.ui-care-dialog': 'dialog', '#ui-care-dialog-text': 'text', '#ui-care-talk': 'talk',
    '.ui-care-shelf': 'shelf', '.ui-care-tools': 'viewport',
    '[data-shelf-direction="-1"]': 'arrow', '[data-shelf-direction="1"]': 'arrow', '.ui-care-shelf-pages': 'pages' };
  for (const [selector, kind] of Object.entries(selectors)) {
    nodes[selector] = kind === 'viewport' ? viewport : new Node(kind);
    nodes[selector].parentElement = careRoom;
  }
  nodes['[data-shelf-direction="-1"]'].dataset.shelfDirection = '-1';
  nodes['[data-shelf-direction="1"]'].dataset.shelfDirection = '1';
  const status = new Node('status'); document.hidden = false;
  document.getElementById = id => id === 'ui-scene' ? scene : id === 'ui-selection-status' ? status : null;
  document.createElement = () => careRoom;
  window.matchMedia = () => ({ matches: true });
  window.DressLabFacialCare = { getState: () => initial };
  vm.runInNewContext(source, { window, document, CustomEvent: Event,
    performance: { now: () => 1000 }, requestAnimationFrame: fn => { fn(); return 1; }, console });
  const api = window.DressLabCareRoom; api.setTab('facial'); emitted.length = 0; scrollCalls.length = 0;
  const tool = id => viewport.querySelectorAll('.ui-care-tool').find(button => button.dataset.careTool === id);
  const fire = (target, type, init) => { const event = new Event(type, init); target.dispatchEvent(event); return event; };
  const pointer = (type, target, x, y, pointerType = 'touch', extra = {}) => fire(
    type === 'pointerdown' ? target : captures.get(extra.pointerId || 1) || target, type,
    { pointerId: 1, pointerType, button: 0, isPrimary: true, clientX: x, clientY: y, ...extra });
  const events = type => emitted.filter(event => event.type === type).map(event => event.detail);
  const dragEvents = () => events('dresslab:facial-tool-drag');
  return { api, window, document, scene, careRoom, viewport, nodes, captures, scrollCalls, tool, fire, pointer, events, dragEvents };
}

for (const type of ['mouse', 'touch', 'pen']) {
  const app = fixture(), cream = app.tool('cream');
  app.pointer('pointerdown', cream, 250, 700, type);
  app.pointer('pointermove', cream, 180, 696, type);
  assert.ok(app.viewport.scrollLeft > 200, type + ' pans in scaled shelf coordinates');
  app.pointer('pointermove', cream, 180, 350, type);
  app.pointer('pointerup', cream, 180, 350, type);
  assert.equal(app.dragEvents().length, 0, type + ' horizontal lock must never apply a tool');
  assert.equal(app.api.selectedTool, 'cleanser');
  assert.ok(app.fire(cream, 'click', { detail: 1 }).defaultPrevented, 'post-pan click must be suppressed');
  assert.equal(app.api.selectedTool, 'cleanser');
  app.pointer('pointerdown', cream, 100, 700, type);
  app.pointer('pointerup', cream, 102, 701, type);
  assert.equal(app.api.selectedTool, 'cream', 'a fresh tap after pan must still work');
  app.fire(cream, 'click', { detail: 1 });
  assert.equal(app.events('dresslab:care-tool-select').length, 1, 'captured tap selects only once');

  const vertical = fixture(), serum = vertical.tool('serum');
  vertical.pointer('pointerdown', serum, 100, 700, type);
  vertical.pointer('pointermove', serum, 104, 680, type);
  vertical.pointer('pointermove', serum, 300, 350, type);
  vertical.pointer('pointerup', serum, 300, 350, type);
  assert.deepEqual(vertical.dragEvents().map(event => event.phase), ['start', 'move', 'end']);
  assert.ok(vertical.dragEvents().every(event => event.tool === 'serum' && event.pointerId === 1));
  assert.equal(vertical.api.selectedTool, 'serum');
  assert.equal(vertical.viewport.scrollLeft, 0, type + ' vertical lock must not move the shelf');
  vertical.fire(vertical.tool('cream'), 'click', { detail: 1 });
  assert.equal(vertical.api.selectedTool, 'serum', 'post-tool-drag click must not select another tool');
}

const cancellations = {
  pointercancel: app => app.pointer('pointercancel', app.viewport, 102, 680),
  lostcapture: app => app.fire(app.viewport, 'lostpointercapture', { pointerId: 1 }),
  blur: app => app.fire(app.window, 'blur'),
  visibility: app => { app.document.hidden = true; app.fire(app.document, 'visibilitychange'); },
  pagehide: app => app.fire(app.window, 'pagehide'),
  tab: app => app.api.setTab('hair'),
  room: app => { app.scene.dataset.room = 'dress'; app.fire(app.window, 'dresslab:room-change', { detail: { room: 'dress' } }); },
  resize: app => app.fire(app.window, 'resize')
};
for (const [reason, cancel] of Object.entries(cancellations)) {
  const app = fixture(), button = app.tool('towel');
  app.pointer('pointerdown', button, 100, 700);
  app.pointer('pointermove', button, 102, 680);
  cancel(app);
  app.pointer('pointermove', app.window, 200, 400);
  app.pointer('pointerup', app.window, 200, 400);
  assert.deepEqual(app.dragEvents().map(event => event.phase), ['start', 'cancel'], reason);
  assert.equal(app.captures.size, 0, reason + ' releases pointer capture');
  for (const name of ['is-gesturing', 'is-dragging', 'is-tool-dragging']) assert.equal(app.viewport.classList.contains(name), false, reason);
}

{
  const app = fixture(), button = app.tool('roller');
  app.pointer('pointerdown', button, 100, 700, 'pen');
  app.pointer('pointermove', button, 102, 680, 'pen');
  app.fire(button, 'lostpointercapture', { pointerId: 1 });
  app.pointer('pointerup', button, 102, 680, 'pen');
  assert.deepEqual(app.dragEvents().map(event => event.phase), ['start', 'end'], 'descendant capture transfer must not cancel shelf capture');
  const empty = fixture();
  empty.pointer('pointerdown', empty.viewport, 100, 700);
  empty.pointer('pointermove', empty.viewport, 102, 680);
  empty.pointer('pointerup', empty.viewport, 102, 680);
  assert.equal(empty.dragEvents().length, 0, 'blank shelf cannot create a tool');
  empty.pointer('pointerdown', empty.tool('cream'), 100, 700, 'touch', { isPrimary: false });
  assert.equal(empty.captures.size, 0, 'secondary pointers cannot start a gesture');
}

{
  const app = fixture();
  for (const [key, id] of [['Enter', 'serum'], [' ', 'roller']]) {
    const button = app.tool(id), before = app.events('dresslab:facial-tool-key').length;
    assert.ok(app.fire(button, 'keydown', { key, repeat: false }).defaultPrevented);
    app.fire(button, 'keydown', { key, repeat: true });
    assert.ok(app.fire(button, 'keyup', { key }).defaultPrevented);
    assert.equal(app.events('dresslab:facial-tool-key').length, before + 1, 'one dose per key press, without native activation');
    assert.equal(app.api.selectedTool, id);
  }
  app.fire(app.tool('serum'), 'keydown', { key: 'ArrowLeft' });
  assert.equal(app.document.activeElement.dataset.careTool, 'towel');
  assert.equal(app.api.selectedTool, 'roller', 'browsing tools must not select or apply them');
  assert.equal(app.events('dresslab:facial-tool-key').length, 2);
}

{
  const app = fixture({ selectedTool: 'roller', overallProgress: 0.2 });
  const overall = app.nodes['.ui-facial-overall'], value = app.nodes['.ui-facial-overall__value'];
  assert.equal(app.api.selectedTool, 'roller', 'restore the user choice without automatic selection');
  assert.equal(overall.getAttribute('role'), 'progressbar');
  assert.equal((app.careRoom.innerHTML.match(/role="progressbar"/g) || []).length, 1);
  assert.ok(app.viewport.innerHTML.includes('./assets/care/facial/roller-v2.png'));
  assert.doesNotMatch(app.viewport.innerHTML, /ui-care-tool__(?:progress|done)|data-complete|aria-valuenow/);
  for (const button of app.viewport.querySelectorAll('.ui-care-tool')) assert.doesNotMatch(button.getAttribute('aria-label'), /%|완료/);
  app.viewport.scrollLeft = 343; app.scrollCalls.length = 0;
  for (const [progress, expected] of [[-1, 0], [0.425, 43], [1.4, 100], [NaN, 0], [null, 0], [undefined, 0]]) {
    app.fire(app.window, 'dresslab:facial-state', { detail: {
      overallProgress: progress, selectedTool: 'cleanser', recommendedTool: 'cream' } });
    assert.equal(overall.getAttribute('aria-valuenow'), String(expected));
    assert.equal(overall.getAttribute('aria-valuetext'), expected + '%');
    assert.equal(value.textContent, expected + '%');
    assert.equal(app.api.selectedTool, 'roller');
    assert.equal(app.viewport.scrollLeft, 343);
  }
  assert.equal(app.scrollCalls.length, 0, 'state updates must not move the shelf');
  assert.equal(app.tool('cream').dataset.recommended, 'true');
  app.api.setTab('hair'); assert.equal(overall.hidden, true);
  app.api.setTab('facial'); assert.equal(overall.hidden, false);
  assert.equal(app.api.selectedTool, 'roller');
}
console.log('Care-room input tests passed: mouse/touch/pen axes, capture/cancel, click suppression, keyboard, overall progress and tool artwork.');
