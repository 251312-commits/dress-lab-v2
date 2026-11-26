// Real mobile browser checks for the preview -> dye -> apply commit boundary.
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
    y: box.y + point.y / 244 * box.height, id: 1 });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [client(points[0])] });
  for (const point of points.slice(1)) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [client(point)] });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

async function finishWithTouch() {
  for (const y of [30, 80, 130, 180, 230]) {
    if ((await state()).phase === 'complete') break;
    await touchStroke(Array.from({ length: 9 }, (_, index) => ({ x: 15 + index * 50, y })));
  }
  assert.equal((await state()).phase, 'complete', 'Sweeping the garment must complete dyeing');
}

async function finishWithButtons() {
  for (let press = 0; press < 8 && (await state()).phase === 'dyeing'; press++) {
    await page.getByRole('button', { name: '색 입히기', exact: true }).click();
  }
  assert.equal((await state()).phase, 'complete', 'Button alternative must complete dyeing');
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
    window.DressLabDyeWorkbench?.getState().ready && window.dressLabWardrobe?.ready &&
    window.dressLabWardrobe?.pants.ready && window.dressLabEyes, null, { timeout: 30000 });
  await page.locator('.ui-room-button[data-room="dress"]').click();
  await page.locator('.ui-outfit-item[data-item="shirt"]').click();
  await page.evaluate(() => {
    window.__dyeColorEvents = [];
    window.addEventListener('dresslab:wardrobe-change', event => {
      if (event.detail.color) window.__dyeColorEvents.push({ ...event.detail });
    });
  });
  const primary = page.locator('#ui-dye-select');
  const secondary = page.locator('#ui-dye-cancel');
  const shirtInitial = await outfit(TEE), pantsInitial = await outfit(PANTS);
  const shirtPixels = await pixels('#character', [180, 950, 300, 320]);
  const nativePreview = await pixels();
  const skinInitial = await page.evaluate(() => window.dressLabSkinTone.getColor());
  assert.ok(nativePreview.opaque > 1000, 'The preview must contain actual garment artwork');
  assert.equal(await page.locator('.ui-dye-workbench .ui-preview__icon').isVisible(), false,
    'The fallback category SVG must be hidden behind a loaded garment');
  assert.equal(await primary.textContent(), '현재 색');
  assert.equal(await primary.isDisabled(), true);

  const red = await chooseHue(0);
  const redPreview = await pixels();
  assert.notEqual(redPreview.hash, nativePreview.hash, 'The wheel must repaint the preview pixels');
  assert.deepEqual(await outfit(TEE), shirtInitial, 'Previewing must not alter the worn shirt');
  assert.deepEqual(await pixels('#character', [180, 950, 300, 320]), shirtPixels,
    'The actual doll shirt pixels must remain unchanged during preview');
  assert.equal(await page.evaluate(() => window.dressLabSkinTone.getColor()), skinInitial);
  await snapshot('01-dye-preview-mobile');

  await primary.click();
  assert.equal((await state()).phase, 'dyeing');
  assert.deepEqual(await pixels(), nativePreview, 'Dye work must begin with the current worn color');
  assert.equal(await page.locator('.ui-colors').evaluate(node => node.inert), true);
  assert.equal(await page.getByRole('button', { name: '적용', exact: true }).count(), 0,
    'An unfinished garment must not expose Apply');
  const wheel = await page.locator('.ui-colors .ui-wheel').boundingBox();
  await page.touchscreen.tap(wheel.x + wheel.width * .08, wheel.y + wheel.height / 2);
  assert.equal((await state()).targetColor, red, 'The dye target must be frozen while working');
  assert.equal(await page.evaluate(() => window.DressLabColorWheel.getColor().hex), red);
  await touchStroke([{ x: 190, y: 105 }, { x: 210, y: 105 }]);
  const partial = await state(), partialPixels = await pixels();
  assert.equal(partial.phase, 'dyeing');
  assert.ok(partial.progress > 0 && partial.progress < 100, 'A short real touch stroke must do partial work');
  assert.notEqual(partialPixels.hash, nativePreview.hash);
  assert.notEqual(partialPixels.hash, redPreview.hash);
  assert.deepEqual(await outfit(TEE), shirtInitial);
  await snapshot('02-dye-partial-mobile');
  await finishWithTouch();
  assert.equal((await state()).progress, 100);
  assert.deepEqual(await pixels(), redPreview, 'Completed dye must match the selected preview');
  assert.deepEqual(await outfit(TEE), shirtInitial, 'Completion still needs an explicit Apply');
  assert.equal(await primary.textContent(), '적용');
  await snapshot('03-dye-complete-mobile');
  await primary.dblclick();
  assert.equal((await outfit(TEE)).color, red);
  assert.equal((await outfit(TEE)).equipped, true);
  assert.equal((await state()).phase, 'preview');
  assert.equal(await primary.isDisabled(), true);
  assert.equal((await colorEvents()).length, 1, 'Rapid duplicate clicks must commit exactly once');
  assert.notDeepEqual(await pixels('#character', [180, 950, 300, 320]), shirtPixels,
    'Apply must visibly recolor the real doll');
  assert.deepEqual(await outfit(PANTS), pantsInitial);
  await snapshot('04-dye-applied-mobile');

  const cyan = await chooseHue(180);
  await primary.click();
  await touchStroke([{ x: 190, y: 105 }, { x: 210, y: 105 }]);
  await secondary.click();
  assert.equal((await state()).phase, 'preview');
  assert.equal((await state()).previewColor, cyan);
  assert.equal((await outfit(TEE)).color, red, 'Cancel must preserve the applied color');
  assert.equal(await page.locator('.ui-colors').evaluate(node => node.inert), false);

  await primary.click();
  await page.locator('.ui-room-button[data-room="magic"]').click();
  assert.equal((await state()).phase, 'preview', 'Leaving the room must cancel unfinished work');
  assert.equal((await state()).targetColor, null);
  const dressDraft = (await state()).previewColor;
  await page.locator('[data-magic-tab="skin"]').click();
  await page.locator('.ui-magic-skin-panel [data-channel="s"] input').focus();
  await page.keyboard.press('End');
  await page.waitForFunction(old => window.dressLabSkinTone.getColor() !== old, skinInitial);
  assert.equal((await state()).previewColor, dressDraft, 'Skin input must not alter the dress candidate');
  assert.equal((await outfit(TEE)).color, red);
  await page.evaluate(hex => window.DressLabSkinColorWheel.setHex(hex), skinInitial);
  await page.locator('.ui-room-button[data-room="dress"]').click();
  assert.equal((await state()).previewColor, cyan, 'Returning keeps the candidate but not partial dye');

  await primary.click();
  await page.locator('.ui-outfit-item[data-item="pants"]').click();
  assert.equal((await state()).itemId, PANTS);
  assert.equal((await state()).phase, 'preview', 'Changing garments must cancel the old dye job');
  assert.equal((await outfit(TEE)).color, red);
  assert.equal((await state()).previewColor, pantsInitial.color);
  const eventsBeforeEquip = (await colorEvents()).length;
  await secondary.click();
  assert.equal((await outfit(PANTS)).equipped, false);
  assert.equal(await primary.textContent(), '착용');
  await primary.click();
  assert.equal((await outfit(PANTS)).equipped, true);
  assert.equal((await state()).phase, 'preview', 'A saved same color must re-equip without dye work');
  assert.equal((await colorEvents()).length, eventsBeforeEquip);

  const pantsColor = await chooseHue(270);
  await primary.click();
  const keyboardCanvas = page.locator('#ui-dye-canvas');
  await keyboardCanvas.focus();
  await page.keyboard.press('Enter');
  assert.ok((await state()).progress > 0, 'Keyboard input must perform real dye work');
  assert.equal((await outfit(PANTS)).color, pantsInitial.color);
  await finishWithButtons();
  assert.equal((await outfit(PANTS)).color, pantsInitial.color);
  await primary.click();
  assert.equal((await outfit(PANTS)).color, pantsColor);
  assert.equal((await outfit(TEE)).color, red, 'Pants dye must not recolor the shirt');
  await snapshot('05-dye-pants-mobile');

  // A finished but unapplied result is cancellable; re-dyeing always returns
  // to original source shading rather than compounding already dyed pixels.
  await page.locator('.ui-outfit-item[data-item="shirt"]').click();
  assert.equal((await state()).previewColor, cyan);
  await primary.click();
  await finishWithButtons();
  assert.equal(await secondary.textContent(), '다시 고르기');
  await secondary.click();
  assert.equal((await outfit(TEE)).color, red);
  await primary.click();
  await finishWithButtons();
  await primary.click();
  assert.equal((await outfit(TEE)).color, cyan);
  await chooseHue(0);
  assert.deepEqual(await pixels(), redPreview, 'Re-dye preview must reproduce the original red pixels exactly');
  await primary.click();
  await finishWithButtons();
  await primary.click();
  assert.equal((await outfit(TEE)).color, red);
  assert.deepEqual(await pixels(), redPreview);
  assert.equal((await outfit(PANTS)).color, pantsColor);
  assert.equal(await page.evaluate(() => window.dressLabSkinTone.getColor()), skinInitial);
  assert.deepEqual(errors, [], 'There must be no uncaught browser errors');
  const unexpectedMissing = [...missing].filter(url => !url.startsWith('/assets/care/') && url !== '/favicon.ico');
  assert.deepEqual(unexpectedMissing, [], 'Required dress assets must all load');
  const report = { viewport: '390x844 touch', red, cyan, pantsColor,
    colorCommits: (await colorEvents()).length, missing: [...missing], pageErrors: errors };
  if (qa) fs.writeFileSync(path.join(qa, 'dye-workbench-result.json'), JSON.stringify(report, null, 2));
  console.log('PASS: real mobile wheel preview; unchanged doll before apply; touch coverage and completion;');
  console.log('locked picker, explicit commit and duplicate protection; cancel/room/item changes;');
  console.log('independent garments and skin; same-color re-equip; keyboard/button controls; source-based re-dye.');
  console.log(JSON.stringify(report));
})().catch(async error => {
  console.error(error);
  if (page) { try { await snapshot('dye-failure'); } catch (_) {} }
  process.exitCode = 1;
}).finally(async () => {
  if (browser) await browser.close();
  if (server) await new Promise(resolve => server.close(resolve));
});
