/* The existing garment preview doubles as the dye workbench.
 * Candidate color, work-in-progress, and equipped color have separate lifetimes.
 * Nothing writes to the wardrobe until the completed work is explicitly applied.
 */
(() => {
  "use strict";
  const scene = document.getElementById("ui-scene");
  const bench = scene?.querySelector(".ui-preview");
  const colors = scene?.querySelector(".ui-colors");
  const status = document.getElementById("ui-selection-status");
  if (!bench || !colors) return;

  const items = { shirt: "basic-white-tee", pants: "basic-charcoal-pants" };
  const validHex = value => typeof value === "string" && /^#[\da-f]{6}$/i.test(value);
  const drafts = new Map();
  const WIDTH = 432, HEIGHT = 244, RADIUS = 35, FINISH_COVERAGE = .88;
  bench.classList.add("ui-dye-workbench");
  bench.setAttribute("aria-label", "의상 염색 작업대");
  bench.innerHTML = [
    '<div class="ui-dye-heading"><span id="ui-dye-phase">색 미리보기</span>',
      '<span class="ui-dye-swatch" aria-hidden="true"></span></div>',
    '<svg class="ui-preview__icon" viewBox="0 0 64 64" aria-hidden="true">',
      '<use id="ui-preview-use" href="#dl2-shirt"></use></svg>',
    '<canvas class="ui-dye-canvas" id="ui-dye-canvas" width="432" height="244"',
      ' role="img" aria-label="선택한 옷의 색 미리보기"></canvas>',
    '<div class="ui-dye-progress" role="progressbar" aria-label="염색 진행"',
      ' aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" hidden>',
      '<span></span></div>',
    '<div class="ui-dye-actions">',
      '<button type="button" class="ui-dye-secondary" id="ui-dye-cancel" hidden>취소</button>',
      '<button type="button" class="ui-dye-primary" id="ui-dye-select" disabled>선택</button>',
    '</div>'
  ].join("");

  const canvas = document.getElementById("ui-dye-canvas");
  const context = canvas.getContext("2d");
  const primary = document.getElementById("ui-dye-select");
  const secondary = document.getElementById("ui-dye-cancel");
  const phaseLabel = document.getElementById("ui-dye-phase");
  const progressBar = bench.querySelector(".ui-dye-progress");
  const progressFill = progressBar.firstElementChild;
  const symbol = bench.querySelector(".ui-preview__icon");
  const makeCanvas = () => {
    const image = document.createElement("canvas");
    image.width = WIDTH;
    image.height = HEIGHT;
    return image;
  };
  const original = makeCanvas(), target = makeCanvas(), mask = makeCanvas(), coating = makeCanvas();
  const maskContext = mask.getContext("2d");
  const coatingContext = coating.getContext("2d");
  let itemId = null, phase = "preview", candidate = "#FFFFFF", targetColor = null;
  let appliedColor = null, ready = false, applying = false, updatingPicker = false;
  let pointerId = null, lastPoint = null, samples = [], covered = 0, announced = -1;
  let previewFrame = 0;

  function announce(text) {
    if (status) status.textContent = text;
  }

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
    maskContext.clearRect(0, 0, WIDTH, HEIGHT);
  }

  function progress() {
    return phase === "complete" ? 100 : samples.length
      ? Math.min(99, Math.floor(covered / samples.length / FINISH_COVERAGE * 100)) : 0;
  }

  function drawWork() {
    context.clearRect(0, 0, WIDTH, HEIGHT);
    if (phase === "complete") {
      context.drawImage(target, 0, 0);
      return;
    }
    context.drawImage(original, 0, 0);
    coatingContext.clearRect(0, 0, WIDTH, HEIGHT);
    coatingContext.globalCompositeOperation = "source-over";
    coatingContext.drawImage(target, 0, 0);
    coatingContext.globalCompositeOperation = "destination-in";
    coatingContext.drawImage(mask, 0, 0);
    coatingContext.globalCompositeOperation = "source-over";
    // Replace the brushed source pixels instead of darkening translucent edges.
    context.globalCompositeOperation = "destination-out";
    context.drawImage(mask, 0, 0);
    context.globalCompositeOperation = "source-over";
    context.drawImage(coating, 0, 0);
  }

  function drawPreview() {
    previewFrame = 0;
    if (phase !== "preview" || !ready || !itemId) return;
    try {
      if (!window.dressLabWardrobe.renderPreview(canvas, itemId, candidate)) {
        throw new Error("의상 프리뷰를 불러올 수 없음");
      }
    } catch (error) {
      ready = false;
      announce("옷을 미리 볼 수 없어. 다른 옷을 선택해 줘.");
      console.warn("Dye preview:", error);
      updateControls();
    }
  }

  function updateControls() {
    const state = itemId && window.dressLabWardrobe?.getItemState(itemId);
    const busy = phase !== "preview";
    colors.inert = busy;
    colors.classList.toggle("ui-colors--dye-locked", busy);
    colors.setAttribute("aria-disabled", String(busy));
    bench.dataset.dyePhase = phase;
    bench.style.setProperty("--dye-color", targetColor || candidate);
    canvas.hidden = !ready;
    symbol.toggleAttribute("hidden", ready);
    canvas.tabIndex = phase === "dyeing" ? 0 : -1;
    canvas.setAttribute("role", phase === "dyeing" ? "button" : "img");
    canvas.setAttribute("aria-label", phase === "dyeing"
      ? "옷을 쓸어 염색하기. Enter 또는 Space로도 색을 입힐 수 있다."
      : phase === "complete" ? "염색을 마친 옷. 적용하면 인형이 입는다." : "선택한 옷의 색 미리보기");
    primary.disabled = !ready;
    secondary.hidden = !busy && !state?.equipped;
    secondary.textContent = phase === "complete" ? "다시 고르기" : busy ? "취소" : "벗기";
    progressBar.hidden = !busy;
    const amount = progress();
    progressBar.setAttribute("aria-valuenow", String(amount));
    progressFill.style.width = amount + "%";
    if (!ready) {
      phaseLabel.textContent = !itemId ? "염색할 옷 없음" : state?.error ? "옷을 불러오지 못함" : "옷 불러오는 중";
      primary.textContent = "선택";
      secondary.hidden = true;
    } else if (phase === "dyeing") {
      phaseLabel.textContent = "옷을 쓸어 염색하기";
      primary.textContent = "색 입히기";
    } else if (phase === "complete") {
      phaseLabel.textContent = "염색 완료";
      primary.textContent = "적용";
    } else {
      phaseLabel.textContent = "색 미리보기";
      const sameColor = candidate === state.color;
      primary.textContent = sameColor ? state.equipped ? "현재 색" : "착용" : "선택";
      primary.disabled = sameColor && state.equipped;
    }
  }

  function sync() {
    if (applying) return;
    const selected = scene.querySelector(".ui-outfit-item[aria-pressed='true']")?.dataset.item;
    const nextId = items[selected] || null;
    const state = nextId && window.dressLabWardrobe?.getItemState(nextId);
    const nextColor = state?.color || (nextId === items.pants ? "#4C4E58" : "#FFFFFF");
    if (nextId !== itemId || nextColor !== appliedColor || !state?.ready) {
      if (itemId) drafts.set(itemId, candidate);
      clearWork();
      itemId = nextId;
      candidate = drafts.get(itemId) || nextColor;
      appliedColor = nextColor;
      setPicker(candidate);
    }
    ready = Boolean(state?.ready && context);
    bench.querySelector("#ui-preview-use").setAttribute("href", "#dl2-" + (selected || "shirt"));
    updateControls();
    if (phase === "preview") drawPreview();
  }

  function startDye() {
    if (phase !== "preview" || !ready) return false;
    const wardrobe = window.dressLabWardrobe;
    const state = wardrobe?.getItemState(itemId);
    if (!state?.ready) return false;
    if (candidate === state.color) {
      wardrobe.setEquipped(true, itemId);
      announce(state.name + " 착용");
      return true;
    }
    try {
      if (!wardrobe.renderPreview(original, itemId, state.color) ||
          !wardrobe.renderPreview(target, itemId, candidate)) return false;
      const pixels = target.getContext("2d").getImageData(0, 0, WIDTH, HEIGHT).data;
      clearWork();
      for (let y = 3; y < HEIGHT; y += 6) {
        for (let x = 3; x < WIDTH; x += 6) {
          if (pixels[(y * WIDTH + x) * 4 + 3] > 32) samples.push({ x, y, covered: false });
        }
      }
      if (!samples.length) return false;
      targetColor = candidate; // Freeze both the garment and color for this job.
      appliedColor = state.color;
      phase = "dyeing";
      updateControls();
      drawWork();
      announce("옷을 쓸어 색을 입혀 줘. 색 입히기 버튼도 사용할 수 있다.");
      return true;
    } catch (error) {
      clearWork();
      updateControls();
      announce("염색을 시작하지 못했어. 다시 선택해 줘.");
      console.warn("Dye workbench:", error);
      return false;
    }
  }

  function paintStroke(a, b) {
    if (phase !== "dyeing" || scene.dataset.room !== "dress") return;
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
    if (covered / samples.length >= FINISH_COVERAGE) {
      phase = "complete";
      endStroke();
      announce("염색 완료. 적용을 누르면 인형의 옷에 반영된다.");
    } else if (Math.floor(progress() / 25) !== announced) {
      announced = Math.floor(progress() / 25);
      announce("염색 " + progress() + "%");
    }
    drawWork();
    updateControls();
  }

  // A real brush stroke also provides an equivalent tap/keyboard path.
  function paintNextBand() {
    const sample = samples.find(point => !point.covered);
    if (sample) paintStroke({ x: 0, y: sample.y + RADIUS * .6 }, { x: WIDTH, y: sample.y + RADIUS * .6 });
  }

  function applyDye() {
    if (phase !== "complete" || !targetColor || !ready) return false;
    const wardrobe = window.dressLabWardrobe;
    const state = wardrobe?.getItemState(itemId);
    if (!state?.ready || state.color !== appliedColor) { sync(); return false; }
    applying = true;
    try {
      if (!wardrobe.setDyeColor(targetColor, itemId)) throw new Error("Dye color was not applied");
      wardrobe.setEquipped(true, itemId);
      candidate = targetColor;
      drafts.set(itemId, candidate);
      appliedColor = candidate;
      clearWork();
      announce(state.name + " 염색 적용 완료");
    } catch (error) {
      announce("염색을 적용하지 못했어. 다시 적용해 줘.");
      console.warn("Dye apply:", error);
      return false;
    } finally {
      applying = false;
      updateControls();
    }
    drawPreview();
    return true;
  }

  primary.addEventListener("click", event => {
    if (!ready || scene.dataset.room !== "dress") return;
    // A double-tap finishing the last band must not also commit the new color.
    if (phase === "complete" && event.detail > 1) return;
    if (phase === "preview") startDye();
    else if (phase === "dyeing") paintNextBand();
    else if (phase === "complete") applyDye();
  });
  primary.addEventListener("keydown", event => {
    if (event.repeat && (event.key === "Enter" || event.key === " ")) event.preventDefault();
  });
  secondary.addEventListener("click", () => {
    if (phase === "preview") {
      window.dressLabWardrobe?.setEquipped(false, itemId);
      announce("착용 해제");
    } else {
      clearWork();
      setPicker(candidate);
      updateControls();
      drawPreview();
      announce("염색 취소. 입고 있는 옷의 색은 유지된다.");
    }
  });
  const pointAt = event => {
    const rect = canvas.getBoundingClientRect();
    return { x: (event.clientX - rect.left) * WIDTH / rect.width,
      y: (event.clientY - rect.top) * HEIGHT / rect.height };
  };
  canvas.addEventListener("pointerdown", event => {
    if (phase !== "dyeing" || pointerId !== null || !event.isPrimary || event.button !== 0) return;
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
    if (phase === "dyeing" && !event.repeat && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      paintNextBand();
    }
  });
  window.addEventListener("blur", endStroke);
  document.addEventListener("visibilitychange", () => { if (document.hidden) endStroke(); });
  window.addEventListener("dresslab:color-change", event => {
    const hex = event.detail?.hex;
    if (updatingPicker || !itemId || !validHex(hex) || (event.detail.source && event.detail.source !== "dress")) return;
    if (phase !== "preview") { setPicker(targetColor); return; }
    candidate = hex.toUpperCase();
    drafts.set(itemId, candidate);
    updateControls();
    if (!previewFrame) previewFrame = requestAnimationFrame(drawPreview);
  });
  window.addEventListener("dresslab:room-change", event => {
    if (event.detail?.room !== "dress") {
      clearWork();
      updateControls();
    } else sync();
  });

  window.DressLabDyeWorkbench = {
    sync,
    getState: () => ({ itemId, phase, previewColor: candidate, targetColor,
      appliedColor, progress: progress(), ready })
  };
  sync();
})();
