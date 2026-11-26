/* Dye the selected equipped garment in the existing preview area.
 * The wheel only previews. First contact starts dyeing; coverage completes it.
 * Clothing selection and equipment changes belong to the Clothes tab.
 */
(() => {
  "use strict";
  const scene = document.getElementById("ui-scene");
  const bench = scene?.querySelector(".ui-preview");
  const colors = scene?.querySelector(".ui-colors");
  const status = document.getElementById("ui-selection-status");
  if (!bench || !colors) return;

  const validHex = value => typeof value === "string" && /^#[\da-f]{6}$/i.test(value);
  const drafts = new Map();
  const WIDTH = 432, HEIGHT = 352, RADIUS = 35, FINISH_COVERAGE = .94;
  bench.classList.add("ui-dye-workbench");
  bench.setAttribute("aria-label", "의상 염색 작업대");
  bench.innerHTML = [
    '<canvas class="ui-dye-canvas" id="ui-dye-canvas" width="432" height="352"',
      ' role="button" tabindex="-1" aria-label="옷을 쓸어 염색하기"></canvas>',
    '<p class="ui-dye-note" id="ui-dye-note" hidden></p>',
    '<div class="ui-dye-progress" role="progressbar" aria-label="염색 진행"',
      ' aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" hidden>',
      '<span></span></div>'
  ].join("");
  const canvas = document.getElementById("ui-dye-canvas");
  const context = canvas.getContext("2d");
  const note = document.getElementById("ui-dye-note");
  const progressBar = bench.querySelector(".ui-dye-progress");
  const progressFill = progressBar.firstElementChild;
  const makeCanvas = () => {
    const image = document.createElement("canvas");
    image.width = WIDTH;
    image.height = HEIGHT;
    return image;
  };
  const original = makeCanvas(), target = makeCanvas(), mask = makeCanvas(), coating = makeCanvas();
  const maskContext = mask.getContext("2d");
  const coatingContext = coating.getContext("2d");
  if (!context || !maskContext || !coatingContext) return;
  let itemId = null, phase = "preview", candidate = "#FFFFFF", targetColor = null;
  let appliedColor = null, ready = false, applying = false, updatingPicker = false, errorText = "";
  let pointerId = null, lastPoint = null, samples = [], covered = 0, announced = -1;
  let previewFrame = 0;

  const active = () => scene.dataset.room === "dress" && scene.dataset.dressTab === "color";
  function announce(text) { if (status) status.textContent = text; }
  function setPicker(hex) {
    updatingPicker = true;
    try { window.DressLabColorWheel?.setHex(hex); }
    finally { updatingPicker = false; }
  }
  function endStroke() {
    const id = pointerId;
    pointerId = null;
    lastPoint = null;
    if (id !== null && canvas.hasPointerCapture?.(id)) canvas.releasePointerCapture(id);
  }
  function clearWork() {
    endStroke();
    phase = "preview";
    targetColor = null;
    samples = [];
    covered = 0;
    announced = -1;
    errorText = "";
    maskContext.clearRect(0, 0, WIDTH, HEIGHT);
  }
  function progress() {
    return phase === "complete" ? 100 : samples.length
      ? Math.min(99, Math.floor(covered / samples.length / FINISH_COVERAGE * 100)) : 0;
  }
  function drawWork() {
    context.clearRect(0, 0, WIDTH, HEIGHT);
    if (phase === "complete") { context.drawImage(target, 0, 0); return; }
    context.drawImage(original, 0, 0);
    coatingContext.clearRect(0, 0, WIDTH, HEIGHT);
    coatingContext.globalCompositeOperation = "source-over";
    coatingContext.drawImage(target, 0, 0);
    coatingContext.globalCompositeOperation = "destination-in";
    coatingContext.drawImage(mask, 0, 0);
    coatingContext.globalCompositeOperation = "source-over";
    context.globalCompositeOperation = "destination-out";
    context.drawImage(mask, 0, 0);
    context.globalCompositeOperation = "source-over";
    context.drawImage(coating, 0, 0);
  }
  function drawPreview() {
    previewFrame = 0;
    if (phase === "dyeing" || !ready || !itemId) return;
    if (!window.dressLabWardrobe.renderPreview(canvas, itemId, candidate)) {
      ready = false;
      errorText = "옷을 미리 볼 수 없어";
      announce(errorText);
      updateControls();
    }
  }
  function updateControls() {
    const state = itemId && window.dressLabWardrobe?.getItemState(itemId);
    const busy = phase === "dyeing";
    colors.inert = busy;
    colors.classList.toggle("ui-colors--dye-locked", busy);
    colors.setAttribute("aria-disabled", String(busy));
    bench.dataset.dyePhase = phase;
    bench.dataset.ready = String(ready);
    canvas.hidden = !ready;
    canvas.tabIndex = ready && active() ? 0 : -1;
    canvas.setAttribute("aria-disabled", String(!ready));
    canvas.setAttribute("aria-label", "염색 작업대. 옷을 쓸면 색이 입혀지고 완성되면 자동 적용된다. Enter 또는 Space로도 칠할 수 있다.");
    note.textContent = errorText || (!itemId ? "옷 탭에서 옷을 입혀 줘" :
      !ready ? state?.error ? "옷을 불러오지 못했어" : "옷 불러오는 중" : "");
    note.hidden = !note.textContent;
    const amount = progress();
    progressBar.hidden = phase === "preview";
    progressBar.setAttribute("aria-valuenow", String(amount));
    progressFill.style.width = amount + "%";
  }
  function sync() {
    if (applying) return;
    let nextId = window.DressLabOutfits?.selectedId || null;
    let state = nextId && window.dressLabWardrobe?.getItemState(nextId);
    if (!state?.equipped) { nextId = null; state = null; }
    const nextColor = state?.color || null;
    if (nextId !== itemId || nextColor !== appliedColor || !state?.ready) {
      if (itemId) drafts.set(itemId, candidate);
      clearWork();
      itemId = nextId;
      candidate = drafts.get(itemId) || nextColor || "#FFFFFF";
      appliedColor = nextColor;
      if (itemId) setPicker(candidate);
    }
    ready = Boolean(state?.ready && state.equipped);
    updateControls();
    if (phase !== "dyeing") drawPreview();
  }
  function startDye() {
    if (!active() || !ready) return false;
    if (phase === "dyeing") return true;
    const wardrobe = window.dressLabWardrobe;
    const state = wardrobe?.getItemState(itemId);
    if (!state?.ready || !state.equipped || candidate === state.color) return false;
    try {
      if (!wardrobe.renderPreview(original, itemId, state.color) ||
          !wardrobe.renderPreview(target, itemId, candidate)) throw new Error("Cannot prepare dye preview");
      const pixels = target.getContext("2d").getImageData(0, 0, WIDTH, HEIGHT).data;
      clearWork();
      for (let y = 3; y < HEIGHT; y += 6) {
        for (let x = 3; x < WIDTH; x += 6) {
          if (pixels[(y * WIDTH + x) * 4 + 3] > 32) samples.push({ x, y, covered: false });
        }
      }
      if (!samples.length) throw new Error("Empty dye preview");
      targetColor = candidate;
      appliedColor = state.color;
      phase = "dyeing";
      updateControls();
      drawWork();
      return true;
    } catch (error) {
      clearWork();
      errorText = "다시 문질러 줘";
      updateControls();
      announce("염색을 시작하지 못했어. 다시 문질러 줘.");
      console.warn("Dye workbench:", error);
      return false;
    }
  }
  function finishDye() {
    if (phase !== "dyeing" || !targetColor || !active()) return false;
    const wardrobe = window.dressLabWardrobe;
    const state = wardrobe?.getItemState(itemId);
    if (!state?.ready || !state.equipped || state.color !== appliedColor ||
        window.DressLabOutfits?.selectedId !== itemId) { sync(); return false; }
    endStroke();
    applying = true;
    let applied = false;
    try { applied = wardrobe.setDyeColor(targetColor, itemId); }
    finally { applying = false; }
    if (!applied) {
      clearWork();
      errorText = "다시 문질러 줘";
      updateControls();
      drawPreview();
      announce("염색을 적용하지 못했어. 기존 색은 유지된다.");
      return false;
    }
    candidate = targetColor;
    appliedColor = candidate;
    drafts.set(itemId, candidate);
    phase = "complete";
    drawWork();
    sync();
    announce(state.name + " 염색 완료");
    return true;
  }
  function paintStroke(a, b) {
    if (phase !== "dyeing" || !active()) return;
    const dx = b.x - a.x, dy = b.y - a.y, distance = dx * dx + dy * dy;
    maskContext.strokeStyle = "#fff";
    maskContext.fillStyle = "#fff";
    maskContext.lineWidth = RADIUS * 2;
    maskContext.lineCap = "round";
    maskContext.beginPath();
    maskContext.moveTo(a.x, a.y);
    maskContext.lineTo(b.x, b.y);
    maskContext.stroke();
    maskContext.beginPath();
    maskContext.arc(b.x, b.y, RADIUS, 0, Math.PI * 2);
    maskContext.fill();
    for (const sample of samples) {
      if (sample.covered) continue;
      const t = distance ? Math.max(0, Math.min(1,
        ((sample.x - a.x) * dx + (sample.y - a.y) * dy) / distance)) : 0;
      if ((sample.x - a.x - t * dx) ** 2 + (sample.y - a.y - t * dy) ** 2 <= RADIUS ** 2) {
        sample.covered = true;
        covered++;
      }
    }
    if (covered / samples.length >= FINISH_COVERAGE) { finishDye(); return; }
    if (Math.floor(progress() / 25) !== announced) {
      announced = Math.floor(progress() / 25);
      announce("염색 " + progress() + "%");
    }
    drawWork();
    updateControls();
  }
  // The keyboard draws the same brush band, with no extra visible controls.
  function paintNextBand() {
    const sample = samples.find(point => !point.covered);
    if (sample) paintStroke({ x: 0, y: sample.y + RADIUS * .6 }, { x: WIDTH, y: sample.y + RADIUS * .6 });
  }
  const pointAt = event => {
    const rect = canvas.getBoundingClientRect();
    return { x: (event.clientX - rect.left) * WIDTH / rect.width,
      y: (event.clientY - rect.top) * HEIGHT / rect.height };
  };
  canvas.addEventListener("pointerdown", event => {
    if (pointerId !== null || !event.isPrimary || event.button !== 0 || !startDye()) return;
    event.preventDefault();
    pointerId = event.pointerId;
    lastPoint = pointAt(event);
    canvas.setPointerCapture(pointerId);
    paintStroke(lastPoint, lastPoint);
  });
  canvas.addEventListener("pointermove", event => {
    if (event.pointerId !== pointerId || !lastPoint) return;
    event.preventDefault();
    const next = pointAt(event);
    paintStroke(lastPoint, next);
    if (pointerId !== null) lastPoint = next;
  });
  for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) {
    canvas.addEventListener(type, event => { if (event.pointerId === pointerId) endStroke(); });
  }
  canvas.addEventListener("keydown", event => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    if (!event.repeat && startDye()) paintNextBand();
  });
  window.addEventListener("blur", endStroke);
  document.addEventListener("visibilitychange", () => { if (document.hidden) endStroke(); });
  window.addEventListener("dresslab:color-change", event => {
    const hex = event.detail?.hex;
    if (updatingPicker || !itemId || !validHex(hex) || (event.detail.source && event.detail.source !== "dress")) return;
    if (phase === "dyeing") { setPicker(targetColor); return; }
    clearWork();
    candidate = hex.toUpperCase();
    drafts.set(itemId, candidate);
    updateControls();
    if (!previewFrame) previewFrame = requestAnimationFrame(drawPreview);
  });
  const navigationChanged = () => {
    if (!active()) clearWork();
    sync();
  };
  window.addEventListener("dresslab:room-change", navigationChanged);
  window.addEventListener("dresslab:dress-tab-change", navigationChanged);
  window.addEventListener("dresslab:outfit-selection-change", sync);
  window.addEventListener("dresslab:wardrobe-ready", sync);
  window.addEventListener("dresslab:wardrobe-change", sync);
  window.addEventListener("dresslab:wardrobe-error", sync);
  window.DressLabDyeWorkbench = {
    sync,
    getState: () => ({ itemId, phase, previewColor: candidate, targetColor,
      appliedColor, progress: progress(), ready })
  };
  sync();
})();
