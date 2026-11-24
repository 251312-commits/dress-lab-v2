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
const signature = state => JSON.parse(JSON.stringify({ products: state.products, dirt: state.dirt, hydration: state.hydration, massage: state.massage, overallProgress: state.overallProgress }));
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
    await page.waitForTimeout(50); // Care work uses real elapsed input time.
    await page.mouse.move(client.x, client.y, { steps: 5 });
  }
  await page.mouse.up();
}

// Actual shelf gesture: lift vertically to distinguish pickup from paging,
// then move the picked-up tool to original-face coordinates.
async function dragTool(id, points) {
  const tool = page.locator('[data-care-tool="' + id + '"]');
  await tool.focus();
  await page.waitForFunction(id => {
    const item = document.querySelector('[data-care-tool="' + id + '"]').getBoundingClientRect();
    const shelf = document.querySelector('.ui-care-tools').getBoundingClientRect();
    return item.left >= shelf.left - 1 && item.right <= shelf.right + 1;
  }, id);
  const rect = await tool.boundingBox();
  const start = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 3 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x, start.y - 18, { steps: 2 });
  for (const point of points) {
    const destination = await toClient(point);
    await page.mouse.move(destination.x, destination.y, { steps: 3 });
    await page.waitForTimeout(90); // Deliberate application motion, above the dose spacing interval.
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
  assert.equal((await state()).selectedTool, 'cleanser');

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
  // Tool keyboard input operates the focused tool; direct face input is bare.
  await page.keyboard.press('Enter');
  assert.equal((await state()).selectedTool, 'roller');
  assert.ok((await state()).massage.some(value => value > 0));
  await page.getByRole('button', { name: '페이셜 케어 다시 시작', exact: true }).click();
  assert.equal((await state()).overallProgress, 0);

  const progress = page.locator('.ui-facial-overall[role="progressbar"]');
  assert.equal(await progress.count(), 1);
  assert.equal(await progress.isVisible(), true);
  assert.equal(await progress.getAttribute('aria-valuenow'), '0');
  assert.equal(await page.locator('.ui-care-tool__done, .ui-care-tool__progress').count(), 0);
  assert.equal(await page.locator('.ui-care-dialog').isVisible(), false);
  assert.ok((await page.locator('.ui-care-tool').evaluateAll(nodes => nodes.map(node => node.getAttribute('aria-label'))))
    .every(label => !/%|완료|진행/.test(label)), 'Tool labels must not have per-tool progress');

  const recommendedBefore = await page.evaluate(() => ({ selected: window.DressLabCareRoom.selectedTool,
    scroll: document.querySelector('.ui-care-tools').scrollLeft }));
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('dresslab:facial-state', {
    detail: { ...window.DressLabFacialCare.getState(), recommendedTool: 'cleanser' }
  })));
  assert.deepEqual(await page.evaluate(() => ({ selected: window.DressLabCareRoom.selectedTool,
    scroll: document.querySelector('.ui-care-tools').scrollLeft })), recommendedBefore);

  // Clicking a bottle only selects it. Direct face gestures do not dispense it.
  await page.locator('[data-care-tool="serum"]').click();
  const emptyFace = signature(await state());
  await stroke([{ x: 255, y: 620 }, { x: 290, y: 625 }, { x: 320, y: 640 }]);
  assert.deepEqual(signature(await state()), emptyFace, 'Selection must not turn a bare hand into a bottle');
  assert.equal(await page.locator('.ui-facial-cursor').isVisible(), false);

  // A real vertical pickup from the shelf applies more than three doses in
  // one drag and leaves the overall work bar unchanged until actual care.
  await dragTool('cleanser', [{ x: 220, y: 620 }, { x: 300, y: 620 }, { x: 380, y: 620 },
    { x: 440, y: 680 }, { x: 360, y: 700 }, { x: 280, y: 700 }, { x: 220, y: 620 }]);
  const applied = await state();
  const appliedMass = applied.products.cleanser.dots.reduce((total, dot) => total + dot.amount, 0);
  assert.ok(appliedMass > 3, 'Application drag must not stop at three doses');
  assert.ok(applied.products.cleanser.film.every(value => value === 0));
  assert.equal(applied.overallProgress, 0, 'Deposits alone must not increase progress');
  await page.getByRole('button', { name: '페이셜 케어 다시 시작', exact: true }).click();

  // Keyboard application gives exactly one dose. Bare rubbing starts at once,
  // even when the roller is selected, and never displays the tool cursor.
  await page.locator('[data-care-tool="serum"]').focus();
  await page.keyboard.press('Enter');
  assert.equal((await state()).products.serum.dots.length, 1);
  await page.locator('[data-care-tool="roller"]').click();
  const contact = await toClient({ x: 255, y: 620 });
  await page.mouse.move(contact.x, contact.y);
  await page.mouse.down();
  assert.equal(await page.locator('.ui-facial-cursor').isVisible(), false);
  for (const point of [{ x: 275, y: 620 }, { x: 255, y: 620 }, { x: 275, y: 620 }]) {
    const target = await toClient(point);
    await page.waitForTimeout(50);
    await page.mouse.move(target.x, target.y, { steps: 5 });
    assert.equal(await page.locator('.ui-facial-cursor').isVisible(), false);
  }
  await page.mouse.up();
  const rubbed = await state();
  assert.ok(rubbed.products.serum.film.some(value => value > 0));
  assert.ok(rubbed.overallProgress > 0);
  assert.ok(rubbed.massage.every(value => value === 0), 'Selected roller must not operate during bare rubbing');
  assert.equal(rubbed.selectedTool, 'roller');
  assert.ok(Number(await progress.getAttribute('aria-valuenow')) > 0);

  // Add cream over the serum, then rub the mixture independently of tool choice.
  await page.locator('[data-care-tool="cream"]').focus();
  await page.keyboard.press('Enter');
  await page.locator('[data-care-tool="towel"]').click();
  const beforeMixed = await state();
  await stroke([{ x: 255, y: 620 }, { x: 275, y: 620 }, { x: 255, y: 620 }]);
  const afterMixed = await state();
  assert.ok(afterMixed.products.cream.film.some(value => value > 0));
  assert.ok(afterMixed.products.serum.work > beforeMixed.products.serum.work);
  assert.equal(afterMixed.selectedTool, 'towel');
  const partial = signature(afterMixed);
  await snapshot('facial-mixed-mobile');

  await page.locator('.ui-room-button[data-room="dress"]').click();
  assert.equal((await state()).active, false);
  assert.deepEqual(signature(await state()), partial);
  await page.locator('.ui-room-button[data-room="care"]').click();
  await page.locator('[data-care-tab="facial"]').click();
  assert.equal((await state()).selectedTool, 'towel');
  await page.reload({ waitUntil: 'load' });
  await ready();
  assert.deepEqual(signature(await state()), partial, 'Refresh must preserve material and overall work');

  // Actual tool placement respects the current head/neck/torso/root transform.
  await page.evaluate(() => {
    window.dressLabBodyShape.setShape({ head: 73, neck: 123, ratio: 118 });
    window.dressLabRig.setFrame({ torso: 6 }, { x: 12, y: -10, scaleX: 1.02, scaleY: .98 });
  });
  const beforeTransform = (await state()).products.cleanser.dots.reduce((n, dot) => n + dot.amount, 0);
  await dragTool('cleanser', [{ x: 329, y: 650 }]);
  assert.ok((await state()).products.cleanser.dots.reduce((n, dot) => n + dot.amount, 0) > beforeTransform);

  const appearance = await page.evaluate(() => {
    window.dressLabBodyShape.setShape({ head: 113, neck: 78, armWidth: 117 });
    window.dressLabSkinTone.setColor('#C68C73');
    window.dressLabWardrobe.setEquipped(false);
    return { shape: window.dressLabBodyShape.getState(), skin: window.dressLabSkinTone.getColor(),
      outfit: window.dressLabWardrobe.equipped, selected: window.DressLabCareRoom.selectedTool };
  });
  await page.getByRole('button', { name: '페이셜 케어 다시 시작', exact: true }).click();
  const reset = await state();
  assert.ok(Object.values(reset.products).every(product => product.dots.length === 0 && product.film.every(value => value === 0)));
  assert.equal(reset.overallProgress, 0);
  assert.deepEqual(await page.evaluate(() => ({ shape: window.dressLabBodyShape.getState(),
    skin: window.dressLabSkinTone.getColor(), outfit: window.dressLabWardrobe.equipped,
    selected: window.DressLabCareRoom.selectedTool })), appearance);
  assert.ok(['stage', 'stageIndex', 'progress', 'completed', 'stages'].every(key => !(key in reset)));
  await snapshot('facial-reset-mobile');

  await page.locator('[data-care-tab="hair"]').click();
  assert.equal(await page.locator('.ui-care-tool').count(), 3);
  assert.equal(await page.locator('[data-shelf-direction="1"]').isVisible(), false);
  assert.equal(await page.locator('[data-shelf-direction="-1"]').isVisible(), false);
  assert.deepEqual(errors, [], 'There must be no uncaught browser errors');
  console.log('PASS: five real assets; touch/keyboard shelf; vertical tool pickup and unlimited application;');
  console.log('one-dose bare rubbing and mixed materials; no tool cursor for hand; work-only overall bar;');
  console.log('no automatic selection/per-tool progress; transforms, persistence, isolated reset; no page errors.');
})().catch(async error => {
  console.error(error);
  if (page) { try { await snapshot('facial-failure'); } catch (_) {} }
  process.exitCode = 1;
}).finally(async () => {
  if (browser) await browser.close();
  if (server) await new Promise(resolve => server.close(resolve));
});
