// Real mobile browser checks for clothes selection and button-free auto dye.
// Run: node tests/dye-workbench.cjs
// Optional: DYE_WORKBENCH_URL, DYE_WORKBENCH_QA, CHROMIUM_PATH.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { once } = require('node:events');
let playwright;
try { playwright = require('playwright'); }
catch (_) {
  playwright = require(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES ||
    '/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules', 'playwright'));
}
const root = path.join(__dirname, '..');
const qa = process.env.DYE_WORKBENCH_QA;
const TEE = 'basic-white-tee', PANTS = 'basic-charcoal-pants';
let server, browser, page, cdp;
const missing = new Set(), errors = [];
const state = () => page.evaluate(() => window.DressLabDyeWorkbench.getState());
const outfit = id => page.evaluate(id => window.dressLabWardrobe.getItemState(id), id);
const colorEvents = () => page.evaluate(() => window.__dyeColorEvents.slice());

async function startServer() {
  if (process.env.DYE_WORKBENCH_URL) return process.env.DYE_WORKBENCH_URL;
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
    '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
  server = http.createServer((req, res) => {
    let name;
    try { name = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); }
    catch (_) { res.writeHead(400).end(); return; }
    const file = path.resolve(root, '.' + (name === '/' ? '/index.html' : name));
    if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
    fs.readFile(file, (error, bytes) => {
      if (error) { missing.add(name); res.writeHead(404).end(); return; }
      res.writeHead(200, { 'Content-Type': types[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': 'no-store' });
      res.end(bytes);
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return 'http://127.0.0.1:' + server.address().port;
}

async function snapshot(name) {
  if (!qa) return;
  fs.mkdirSync(qa, { recursive: true });
  await page.screenshot({ path: path.join(qa, name + '.png') });
}

// Hash real canvas pixels. A torso crop excludes animated blinking and gaze.
async function pixels(selector = '#ui-dye-canvas', crop) {
  return page.locator(selector).evaluate((canvas, crop) => {
    const region = crop || [0, 0, canvas.width, canvas.height];
    const bytes = canvas.getContext('2d').getImageData(...region).data;
    let hash = 2166136261, opaque = 0;
    for (let i = 0; i < bytes.length; i++) hash = Math.imul(hash ^ bytes[i], 16777619) >>> 0;
    for (let i = 3; i < bytes.length; i += 4) if (bytes[i]) opaque++;
    return { hash, opaque };
  }, crop);
}

// Actual touch on the hue ring, then native range keyboard input. No direct
// picker or workbench state mutations stand in for the user's color selection.
async function chooseHue(degrees) {
  const wheel = await page.locator('.ui-colors .ui-wheel').boundingBox();
  const angle = degrees * Math.PI / 180, radius = wheel.width * .42;
  await page.touchscreen.tap(wheel.x + wheel.width / 2 + Math.cos(angle) * radius,
    wheel.y + wheel.height / 2 - Math.sin(angle) * radius);
  await page.locator('.ui-colors [data-channel="s"] input').focus();
  await page.keyboard.press('End');
  await page.locator('.ui-colors [data-channel="b"] input').focus();
  await page.keyboard.press('End');
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const current = await state();
  assert.equal(await page.evaluate(() => window.DressLabColorWheel.getColor().hex), current.previewColor);
  return current.previewColor;
}

// CDP sends real touchscreen events, including pointer capture and touch-action.
async function touchStroke(points) {
  const box = await page.locator('#ui-dye-canvas').boundingBox();
  const client = point => ({ x: box.x + point.x / 432 * box.width,
    y: box.y + point.y / 352 * box.height, id: 1 });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [client(points[0])] });
  for (const point of points.slice(1)) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [client(point)] });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

async function finishWithTouch() {
  for (const y of [30, 80, 130, 180, 230, 280, 330]) {
    if ((await state()).phase === 'complete') break;
    await touchStroke(Array.from({ length: 9 }, (_, index) => ({ x: 15 + index * 50, y })));
  }
  assert.equal((await state()).phase, 'complete', 'Sweeping the garment must complete dyeing');
}

async function finishWithKeyboard() {
  await page.locator('#ui-dye-canvas').focus();
  for (let press = 0; press < 16 && (await state()).phase !== 'complete'; press++) {
    await page.keyboard.press(press % 2 ? 'Space' : 'Enter');
  }
  assert.equal((await state()).phase, 'complete', 'Keyboard work must auto-apply after complete coverage');
}

(async () => {
  const url = await startServer();
  const bundled = playwright.chromium.executablePath();
  const executablePath = process.env.CHROMIUM_PATH || (fs.existsSync(bundled) ? bundled :
    (fs.existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined));
  browser = await playwright.chromium.launch({ executablePath, headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 },
    isMobile: true, hasTouch: true, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  page = await context.newPage();
  cdp = await context.newCDPSession(page);
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => { if (response.status() === 404) missing.add(new URL(response.url()).pathname); });
  await page.route('https://api.github.com/repos/251312-commits/dress-lab-v2/contents/base?*',
    route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(
      fs.readdirSync(path.join(root, 'base')).filter(name => /^\d+.*\.png$/i.test(name))
        .map(name => ({ name, type: 'file' }))) }));
  await page.goto(url + '/?room=dress&idle=0', { waitUntil: 'load' });
  await page.waitForFunction(() => document.querySelector('#stage')?.getAttribute('aria-busy') === 'false' &&
    window.DressLabDyeWorkbench?.getState().ready && window.DressLabOutfits &&
    window.dressLabWardrobe?.ready && window.dressLabWardrobe?.pants.ready && window.dressLabEyes,
    null, { timeout: 30000 });
  await page.evaluate(() => {
    window.__dyeColorEvents = [];
    window.addEventListener('dresslab:wardrobe-change', event => {
      if (event.detail.color) window.__dyeColorEvents.push({ ...event.detail });
    });
  });
  const tab = name => page.locator('.ui-tabs__button[data-tab="' + name + '"]').click();
  const card = id => page.locator('.ui-wardrobe-card[data-wardrobe-item="' + id + '"]');
  const slot = name => page.locator('.ui-outfit-item[data-outfit-slot="' + name + '"]');
  const slotCanvas = name => '.ui-outfit-item[data-outfit-slot="' + name + '"] canvas';
  const cardCanvas = id => '.ui-wardrobe-card[data-wardrobe-item="' + id + '"] canvas';
  const partialStroke = () => touchStroke([{ x: 195, y: 150 }, { x: 220, y: 155 }]);
  assert.equal(await page.locator('.ui-dye-workbench button').count(), 0,
    'The workbench must have no selection, paint, cancel or apply buttons');
  assert.equal(await page.locator('.ui-wardrobe-panel').isVisible(), false);
  assert.equal(await page.locator('.ui-outfit-item').count(), 6);
  assert.equal(await page.locator('.ui-outfit-item[data-equipped-item]').count(), 2);
  assert.equal(await page.locator('.ui-outfit-item:disabled').count(), 4);

  // Clothing choices and wear/remove actions exist only on the clothes tab.
  await tab('clothes');
  assert.equal(await page.locator('.ui-wardrobe-panel').isVisible(), true);
  assert.equal(await page.locator('.ui-colors').isVisible(), false);
  assert.equal(await page.locator('.ui-dye-workbench').isVisible(), false);
  assert.equal(await card(TEE).getAttribute('aria-pressed'), 'true');
  await card(TEE).click();
  assert.equal((await outfit(TEE)).equipped, false);
  assert.equal(await slot('upper').isDisabled(), true);
  assert.equal(await page.locator(slotCanvas('upper')).isVisible(), false);
  assert.equal(await slot('upper').getAttribute('data-equipped-item'), null);
  await card(TEE).click();
  assert.equal((await outfit(TEE)).equipped, true);
  assert.equal(await slot('upper').getAttribute('data-equipped-item'), TEE);
  assert.equal(await page.locator(slotCanvas('upper')).isVisible(), true);
  await snapshot('01-clothes-tab-mobile');
  await tab('color');
  await slot('upper').click();

  const shirtInitial = await outfit(TEE), pantsInitial = await outfit(PANTS);
  const shirtPixels = await pixels('#character', [180, 950, 300, 320]);
  const nativePreview = await pixels(), nativeSlot = await pixels(slotCanvas('upper'));
  const nativeCard = await pixels(cardCanvas(TEE));
  const skinInitial = await page.evaluate(() => window.dressLabSkinTone.getColor());
  assert.ok(nativePreview.opaque > 1000, 'Preview contains actual garment artwork');
  const red = await chooseHue(0), redPreview = await pixels();
  assert.notEqual(redPreview.hash, nativePreview.hash);
  assert.deepEqual(await pixels(slotCanvas('upper')), nativeSlot,
    'Equipped square must show applied color while workbench previews a candidate');
  assert.deepEqual(await pixels(cardCanvas(TEE)), nativeCard);
  assert.deepEqual(await outfit(TEE), shirtInitial);
  assert.deepEqual(await pixels('#character', [180, 950, 300, 320]), shirtPixels);
  await snapshot('02-dye-preview-mobile');

  await partialStroke();
  const partial = await state(), partialPixels = await pixels();
  assert.equal(partial.phase, 'dyeing', 'First stroke starts work directly');
  assert.ok(partial.progress > 0 && partial.progress < 100);
  assert.notEqual(partialPixels.hash, nativePreview.hash);
  assert.notEqual(partialPixels.hash, redPreview.hash);
  assert.deepEqual(await outfit(TEE), shirtInitial);
  assert.deepEqual(await pixels(slotCanvas('upper')), nativeSlot);
  assert.equal(await page.locator('.ui-colors').evaluate(node => node.inert), true);
  const wheel = await page.locator('.ui-colors .ui-wheel').boundingBox();
  await page.touchscreen.tap(wheel.x + wheel.width * .08, wheel.y + wheel.height / 2);
  assert.equal((await state()).targetColor, red);
  assert.equal(await page.evaluate(() => window.DressLabColorWheel.getColor().hex), red);
  await snapshot('03-dye-partial-mobile');
  await finishWithTouch();
  assert.equal((await outfit(TEE)).color, red, 'Completion must auto-apply without another button');
  assert.equal((await outfit(TEE)).equipped, true);
  assert.equal((await state()).progress, 100);
  assert.deepEqual(await pixels(), redPreview);
  assert.notDeepEqual(await pixels('#character', [180, 950, 300, 320]), shirtPixels);
  assert.notDeepEqual(await pixels(slotCanvas('upper')), nativeSlot);
  assert.notDeepEqual(await pixels(cardCanvas(TEE)), nativeCard);
  assert.equal(await page.locator('.ui-colors').evaluate(node => node.inert), false);
  assert.equal((await colorEvents()).length, 1);
  await partialStroke();
  await page.locator('#ui-dye-canvas').press('Enter');
  assert.equal((await colorEvents()).length, 1, 'Further same-color input cannot duplicate commits');
  assert.deepEqual(await outfit(PANTS), pantsInitial);
  const redSlot = await pixels(slotCanvas('upper'));
  await snapshot('04-dye-auto-applied-mobile');

  const cyan = await chooseHue(180);
  await partialStroke();
  await tab('clothes');
  assert.equal((await state()).phase, 'preview');
  assert.equal((await state()).targetColor, null);
  assert.equal((await outfit(TEE)).color, red);
  assert.deepEqual(await pixels(slotCanvas('upper')), redSlot);
  await tab('color');
  assert.equal((await state()).previewColor, cyan);
  await partialStroke();
  await page.locator('.ui-room-button[data-room="magic"]').click();
  assert.equal((await state()).phase, 'preview');
  const dressDraft = (await state()).previewColor;
  await page.locator('.ui-tabs__button[data-tab="skin"]').click();
  await page.locator('.ui-magic-skin-panel [data-channel="s"] input').focus();
  await page.keyboard.press('End');
  await page.waitForFunction(old => window.dressLabSkinTone.getColor() !== old, skinInitial);
  assert.equal((await state()).previewColor, dressDraft);
  assert.equal((await outfit(TEE)).color, red);
  await page.evaluate(hex => window.DressLabSkinColorWheel.setHex(hex), skinInitial);
  await page.locator('.ui-room-button[data-room="dress"]').click();
  assert.equal((await state()).previewColor, cyan);
  await partialStroke();
  await slot('lower').click();
  assert.equal((await state()).itemId, PANTS);
  assert.equal((await state()).phase, 'preview');
  assert.equal((await outfit(TEE)).color, red);

  const pantsColor = await chooseHue(270);
  await page.locator('#ui-dye-canvas').press('Enter');
  assert.ok((await state()).progress > 0);
  assert.equal((await outfit(PANTS)).color, pantsInitial.color);
  await finishWithKeyboard();
  assert.equal((await outfit(PANTS)).color, pantsColor);
  assert.equal((await outfit(TEE)).color, red);
  const beforeWear = (await colorEvents()).length;
  await tab('clothes');
  await card(PANTS).click();
  assert.equal((await outfit(PANTS)).equipped, false);
  assert.equal(await slot('lower').isDisabled(), true);
  assert.equal(await page.locator(slotCanvas('lower')).isVisible(), false);
  await card(PANTS).click();
  await tab('color');
  assert.equal((await outfit(PANTS)).equipped, true);
  assert.equal((await outfit(PANTS)).color, pantsColor);
  await partialStroke();
  assert.equal((await state()).phase, 'preview', 'Same-color wearing needs no dye work');
  assert.equal((await colorEvents()).length, beforeWear);
  await snapshot('05-equipped-colors-mobile');

  await slot('upper').click();
  assert.equal((await state()).previewColor, cyan);
  await finishWithKeyboard();
  assert.equal((await outfit(TEE)).color, cyan);
  await chooseHue(0);
  assert.deepEqual(await pixels(), redPreview, 'Repeated dye starts from original art');
  await finishWithKeyboard();
  assert.equal((await outfit(TEE)).color, red);
  assert.deepEqual(await pixels(slotCanvas('upper')), redSlot);
  assert.equal((await outfit(PANTS)).color, pantsColor);
  assert.equal(await page.evaluate(() => window.dressLabSkinTone.getColor()), skinInitial);
  assert.deepEqual(errors, [], 'There must be no uncaught browser errors');
  const unexpectedMissing = [...missing].filter(url => !url.startsWith('/assets/care/') && url !== '/favicon.ico');
  assert.deepEqual(unexpectedMissing, [], 'Required dress assets must all load');
  const report = { viewport: '390x844 touch', red, cyan, pantsColor,
    colorCommits: (await colorEvents()).length, missing: [...missing], pageErrors: errors };
  if (qa) fs.writeFileSync(path.join(qa, 'dye-workbench-result.json'), JSON.stringify(report, null, 2));
  console.log('PASS: separated clothes tab; actual equipped thumbnails; candidate isolation;');
  console.log('button-free first-stroke dye and one automatic commit; tab/room/item cancellation;');
  console.log('independent garment/skin colors, keyboard access, same-color re-equip and source-based re-dye.');
  console.log(JSON.stringify(report));
})().catch(async error => {
  console.error(error);
  if (page) { try { await snapshot('dye-failure'); } catch (_) {} }
  process.exitCode = 1;
}).finally(async () => {
  if (browser) await browser.close();
  if (server) await new Promise(resolve => server.close(resolve));
});
