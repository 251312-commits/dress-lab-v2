// Browser integration: real input, face transforms, persistence, and shelf gestures.
// Requires Playwright + Chromium. Run: node tests/facial-care.cjs
// Optional: FACIAL_CARE_URL=http://127.0.0.1:8765 FACIAL_CARE_QA=/tmp/care-qa
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { once } = require('node:events');

let playwright;
try { playwright = require('playwright'); }
catch (_) {
  const modules = process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES ||
    '/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules';
  playwright = require(path.join(modules, 'playwright'));
}
const root = path.join(__dirname, '..');
const toolIds = ['cleanser', 'towel', 'serum', 'cream', 'roller'];
let server, browser, page;
const qa = process.env.FACIAL_CARE_QA;
const signature = state => ({
  stage: state.stage, stageIndex: state.stageIndex, completed: state.completed,
  stages: state.stages.map(({ id, progress, complete }) => ({ id, progress, complete }))
});
const state = () => page.evaluate(() => window.DressLabFacialCare.getState());

async function startServer() {
  if (process.env.FACIAL_CARE_URL) return process.env.FACIAL_CARE_URL;
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
    '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
  server = http.createServer((req, res) => {
    let name;
    try { name = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); }
    catch (_) { res.writeHead(400).end(); return; }
    const file = path.resolve(root, '.' + (name === '/' ? '/index.html' : name));
    if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
    fs.readFile(file, (error, bytes) => {
      if (error) { res.writeHead(404).end(); return; }
      res.writeHead(200, { 'Content-Type': types[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': 'no-store' });
      res.end(bytes);
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return 'http://127.0.0.1:' + server.address().port;
}

async function ready() {
  await page.waitForFunction(() => document.querySelector('#stage')?.getAttribute('aria-busy') === 'false' &&
    window.DressLabFacialCare && window.dressLabRig && window.dressLabBodyShape &&
    window.dressLabWardrobe?.ready && window.dressLabEyes, null, { timeout: 20000 });
  await page.locator('[data-care-tab="facial"]').click();
  await page.waitForFunction(() => window.DressLabFacialCare.getState().active);
  await page.waitForFunction(() => {
    const images = Array.from(document.querySelectorAll('.ui-care-tool__art img'));
    return images.length === 5 && images.every(image => image.complete && image.naturalWidth > 0);
  }, null, { timeout: 20000 });
}

// Independent forward geometry follows the renderer, not the care engine inverse.
async function toClient(source) {
  return page.evaluate(({ x, y }) => {
    const rig = window.dressLabRig, shape = window.dressLabBodyShape;
    const head = shape.headNeckAnchors, scale = shape.head / 100;
    x = head.x + (x - head.x) * scale;
    y = head.jawY + (y - head.jawY) * scale + shape.neckOffsetY();
    const pivot = rig.config.pivots.torso, angle = rig.angles.torso * Math.PI / 180;
    const dx = x - pivot.x, dy = y - pivot.y;
    x = pivot.x + dx * Math.cos(angle) - dy * Math.sin(angle);
    y = pivot.y + dx * Math.sin(angle) + dy * Math.cos(angle);
    const anchor = rig.rootAnchor;
    x = rig.root.x + anchor.x + (x - anchor.x) * rig.root.scaleX;
    y = rig.root.y + anchor.y + (y - anchor.y) * rig.root.scaleY;
    const canvas = document.querySelector('#character'), rect = canvas.getBoundingClientRect();
    return { x: rect.left + x * rect.width / canvas.width,
      y: rect.top + y * rect.height / canvas.height };
  }, source);
}
async function stroke(points) {
  const first = await toClient(points[0]);
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  for (const point of points.slice(1)) {
    const client = await toClient(point);
    await page.mouse.move(client.x, client.y, { steps: 5 });
  }
  await page.mouse.up();
}

async function snapshot(name) {
  if (!qa) return;
  fs.mkdirSync(qa, { recursive: true });
  await page.screenshot({ path: path.join(qa, name + '.png') });
}

(async () => {
  const url = await startServer();
  const executablePath = process.env.CHROMIUM_PATH ||
    (fs.existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
  browser = await playwright.chromium.launch({ executablePath, headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 },
    isMobile: true, hasTouch: true, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  const errors = [];
  page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  // The app intentionally supports a local fallback list. Only its external
  // directory request is intercepted; all game scripts and images are real.
  await page.route('https://api.github.com/repos/251312-commits/dress-lab-v2/contents/base?*',
    route => route.fulfill({ status: 503, body: 'Use local asset manifest' }));
  await page.goto(url + '/?room=care&idle=0', { waitUntil: 'load' });
  await ready();
  await page.evaluate(() => window.DressLabFacialCare.reset());
  assert.equal((await state()).stage, 'cleanser');

  // Three visible slots with five tools must overflow without widening the page.
  const shelf = page.locator('.ui-care-tools');
  const shelfMetrics = await shelf.evaluate(node => ({ width: node.clientWidth, scrollWidth: node.scrollWidth,
    slots: Array.from(node.children).map(child => child.getBoundingClientRect().width),
    displayedWidth: node.getBoundingClientRect().width }));
  assert.ok(shelfMetrics.scrollWidth > shelfMetrics.width, 'Five tools need a scrolling shelf');
  assert.ok(Math.abs(shelfMetrics.slots[0] * 3 - shelfMetrics.displayedWidth) < 2,
    'Exactly three slots should fit the shelf');
  const initialSelection = await page.evaluate(() => window.DressLabCareRoom.selectedTool);
  const rect = await shelf.boundingBox();
  const cdp = await context.newCDPSession(page);
  const start = { x: rect.x + rect.width * 0.86, y: rect.y + rect.height * 0.43 };
  const end = { x: rect.x + rect.width * 0.12, y: start.y };
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...start, id: 1 }] });
  for (let step = 1; step <= 12; step++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{
      x: start.x + (end.x - start.x) * step / 12, y: start.y, id: 1 }] });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForFunction(() => document.querySelector('.ui-care-tools').scrollLeft > 100);
  assert.equal(await page.evaluate(() => window.DressLabCareRoom.selectedTool), initialSelection,
    'A touch swipe must not select a tool accidentally');

  await page.locator('[data-care-tool="cleanser"]').focus();
  await page.keyboard.press('End');
  await page.waitForFunction(() => {
    const item = document.querySelector('[data-care-tool="roller"]');
    const shelf = document.querySelector('.ui-care-tools').getBoundingClientRect();
    const rect = item.getBoundingClientRect();
    return document.activeElement === item && rect.left >= shelf.left - 1 && rect.right <= shelf.right + 1;
  });
  await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => window.DressLabCareRoom.selectedTool), 'roller');
  const untouched = signature(await state());
  await page.locator('#character').focus();
  await page.keyboard.press('Enter');
  assert.deepEqual(signature(await state()), untouched, 'A later tool must not bypass cleanser');

  await page.locator('[data-care-tool="cleanser"]').click();
  await stroke([{ x: 75, y: 690 }, { x: 80, y: 720 }, { x: 75, y: 750 }]);
  assert.deepEqual(signature(await state()), untouched, 'Outside-face movement must not count');

  // Vary head/neck and the full rig simultaneously. A real stroke over the
  // transformed forehead should still reach the same source face region.
  await page.evaluate(() => {
    window.dressLabBodyShape.setShape({ head: 73, neck: 123, ratio: 118 });
    window.dressLabRig.setFrame({ torso: 6 }, { x: 12, y: -10, scaleX: 1.02, scaleY: .98 });
  });
  await stroke([{ x: 280, y: 630 }, { x: 320, y: 605 }, { x: 380, y: 650 }, { x: 300, y: 700 }]);
  const painted = await state();
  assert.equal(painted.stage, 'cleanser');
  assert.ok(painted.stages[0].progress > 0, 'Stroke on transformed face must add progress');
  assert.ok(painted.stages[0].progress < 1, 'One small stroke must not complete the whole face');
  const partial = signature(painted);

  await page.locator('.ui-room-button[data-room="dress"]').click();
  assert.equal((await state()).active, false);
  assert.deepEqual(signature(await state()), partial, 'Room change must preserve partial treatment');
  await page.locator('.ui-room-button[data-room="care"]').click();
  await page.locator('[data-care-tab="facial"]').click();
  assert.deepEqual(signature(await state()), partial);
  await page.reload({ waitUntil: 'load' });
  await ready();
  assert.deepEqual(signature(await state()), partial, 'Refresh must preserve partial coverage');

  // The accessible action exercises the same coverage/state transitions as
  // pointer care. It does not call internal treatment or completion methods.
  await page.locator('#character').focus();
  const presses = {};
  for (const id of toolIds) {
    assert.equal((await state()).stage, id, 'Treatment sequence changed unexpectedly');
    await page.locator('[data-care-tool="' + id + '"]').click();
    await page.locator('#character').focus();
    let count = 0;
    while ((await state()).stage === id && count < 200) {
      await page.keyboard.press(count % 2 ? 'Space' : 'Enter');
      count++;
    }
    presses[id] = count;
    assert.ok(count > 0 && count < 200, id + ' must be completable with keyboard input');
    assert.equal((await state()).stages.find(stage => stage.id === id).complete, true);
  }
  const completed = await state();
  assert.equal(completed.completed, true);
  assert.ok(completed.stages.every(stage => stage.complete && stage.progress === 1));
  await snapshot('facial-complete-mobile');
  await page.reload({ waitUntil: 'load' });
  await ready();
  assert.deepEqual(signature(await state()), signature(completed), 'Completion must survive refresh');

  // Use the visible replay button and verify it only resets care data.
  const appearance = await page.evaluate(() => {
    window.dressLabBodyShape.setShape({ head: 113, neck: 78, armWidth: 117 });
    window.dressLabSkinTone.setColor('#C68C73');
    window.dressLabWardrobe.setEquipped(false);
    return { shape: window.dressLabBodyShape.getState(), skin: window.dressLabSkinTone.getColor(),
      outfit: window.dressLabWardrobe.equipped };
  });
  await page.getByRole('button', { name: '페이셜 케어 다시 시작', exact: true }).click();
  const reset = await state();
  assert.equal(reset.stage, 'cleanser');
  assert.equal(reset.completed, false);
  assert.ok(reset.stages.every(stage => stage.progress === 0 && !stage.complete));
  assert.deepEqual(await page.evaluate(() => ({ shape: window.dressLabBodyShape.getState(),
    skin: window.dressLabSkinTone.getColor(), outfit: window.dressLabWardrobe.equipped })), appearance,
  'Replay must leave appearance and outfit untouched');
  await snapshot('facial-reset-mobile');

  await page.locator('[data-care-tab="hair"]').click();
  assert.equal(await page.locator('.ui-care-tool').count(), 3);
  assert.equal(await page.locator('[data-shelf-direction="1"]').isVisible(), false);
  assert.equal(await page.locator('[data-shelf-direction="-1"]').isVisible(), false);
  assert.deepEqual(errors, [], 'There must be no uncaught browser errors');
  console.log('PASS: 5 real tool assets; three-slot native touch/keyboard shelf; wrong-tool/outside guards;');
  console.log('transformed pointer care; partial/completed persistence; 5-stage keyboard completion;', presses);
  console.log('replay preserves body/skin/outfit; other tabs keep three placeholders; no page errors.');
})().catch(async error => {
  console.error(error);
  if (page) { try { await snapshot('facial-failure'); } catch (_) {} }
  process.exitCode = 1;
}).finally(async () => {
  if (browser) await browser.close();
  if (server) await new Promise(resolve => server.close(resolve));
});
