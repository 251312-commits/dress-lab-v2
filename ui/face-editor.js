/* Dress Lab V2 • Magic Room face controls.
 * Character state and drawing belong to DressLabFace; this module owns the UI.
 */
(() => {
  "use strict";

  const scene = document.getElementById("ui-scene");
  const editor = scene?.querySelector(".ui-editor");
  if (!scene || !editor) return;

  const controls = [
    ["eyeSize", "눈 크기"],
    ["eyeSpacing", "미간 간격"],
    ["noseSize", "코 크기"],
    ["mouthSize", "입 크기"]
  ];
  function slider([key, label]) {
    return [
      '<div class="ui-magic-row ui-face-row">',
        '<label class="ui-magic-title" for="face-range-', key, '">', label, '</label>',
        '<div class="ui-magic-input-line">',
          '<output class="ui-magic-output" for="face-range-', key,
            '" id="face-value-', key, '">0%</output>',
          '<button type="button" class="ui-magic-step" data-face-step="-1" data-face-key="', key,
            '" aria-label="', label, ' 줄이기" disabled>−</button>',
          '<input class="ui-magic-slider" type="range" id="face-range-', key,
            '" data-face-key="', key, '" min="75" max="125" step="1" value="100" disabled>',
          '<button type="button" class="ui-magic-step" data-face-step="1" data-face-key="', key,
            '" aria-label="', label, ' 늘이기" disabled>+</button>',
        '</div>',
      '</div>'
    ].join("");
  }

  const colorSliders = [["h", "색조", 360], ["s", "채도", 100], ["b", "밝기", 100]]
    .map(([key, label, max]) => [
      '<div class="ui-slider-row" data-channel="', key, '">',
        '<output class="ui-slider-row__value" for="eye-range-', key, '">0', key === "h" ? '°' : '%', '</output>',
        '<button type="button" class="ui-slider-step" data-adjust="-1" aria-label="눈 색 ', label, ' 감소">−</button>',
        '<input class="ui-slider-input" type="range" id="eye-range-', key,
          '" aria-label="눈 색 ', label, '" min="0" max="', max, '" step="1" value="0">',
        '<button type="button" class="ui-slider-step" data-adjust="1" aria-label="눈 색 ', label, ' 증가">+</button>',
      '</div>'
    ].join("")).join("");

  const panel = document.createElement("section");
  panel.className = "ui-face-panel";
  panel.id = "ui-face-panel";
  panel.setAttribute("aria-label", "마법룸 얼굴 조절");
  panel.setAttribute("aria-busy", "true");
  panel.innerHTML = [
    '<h2 class="ui-face-title">얼굴</h2>',
    '<div class="ui-face-controls">', controls.slice(0, 2).map(slider).join(""), '</div>',
    '<section class="ui-face-shapes" aria-labelledby="ui-eye-shapes-title">',
      '<h3 id="ui-eye-shapes-title">눈 모양</h3>',
      '<div class="ui-face-shape-list" role="group" aria-label="눈 모양 선택"></div>',
    '</section>',
    '<section class="ui-face-color-section" aria-labelledby="ui-eye-color-title">',
      '<div class="ui-face-color-heading">',
        '<h3 id="ui-eye-color-title">눈 색</h3>',
        '<button type="button" class="ui-face-original" aria-pressed="true" disabled>원래 색</button>',
      '</div>',
      '<p class="ui-face-color-state">원래 색 사용 중</p>',
      '<div class="ui-face-colors">',
        '<div class="ui-wheel" aria-label="눈 색상환"></div>',
        '<output class="ui-hex" aria-label="선택할 눈 색상 HEX 코드"></output>',
        '<div class="ui-sliders" aria-label="눈 색 HSB 슬라이더">', colorSliders, '</div>',
      '</div>',
    '</section>',
    '<div class="ui-face-controls ui-face-features">', controls.slice(2).map(slider).join(""), '</div>',
    '<div class="ui-face-actions"><button type="button" class="ui-face-reset" disabled>얼굴 초기화</button></div>',
    '<p class="ui-face-status" role="status" aria-live="polite">얼굴을 불러오는 중…</p>'
  ].join("");
  editor.appendChild(panel);

  const ranges = Object.fromEntries(controls.map(([key]) => [key, panel.querySelector("#face-range-" + key)]));
  const outputs = Object.fromEntries(controls.map(([key]) => [key, panel.querySelector("#face-value-" + key)]));
  const shapeList = panel.querySelector(".ui-face-shape-list");
  const originalButton = panel.querySelector(".ui-face-original");
  const resetButton = panel.querySelector(".ui-face-reset");
  const colorState = panel.querySelector(".ui-face-color-state");
  const colorTools = panel.querySelector(".ui-face-colors");
  const status = panel.querySelector(".ui-face-status");
  let face = null;
  let busy = false;
  let operation = 0;
  const colorWheel = window.DressLabColorPicker?.mount(colorTools, "eye", "#9F2C3E", { announceInitial: false }) || null;
  window.DressLabEyeColorWheel = colorWheel;

  function deltaLabel(value) {
    const change = Math.round(value - 100);
    return (change > 0 ? "+" : "") + change + "%";
  }

  function updateAvailability() {
    const hasEyes = face && face.eyesAvailable !== false;
    panel.setAttribute("aria-busy", String(!face || busy));
    for (const [key, input] of Object.entries(ranges)) input.disabled = !face || (key.startsWith("eye") && !hasEyes);
    panel.querySelectorAll("[data-face-step]").forEach(button => {
      button.disabled = !face || (button.dataset.faceKey.startsWith("eye") && !hasEyes);
    });
    shapeList.querySelectorAll("button").forEach(button => { button.disabled = !hasEyes || busy; });
    originalButton.disabled = !hasEyes;
    resetButton.disabled = !face || busy;
    colorTools.inert = !hasEyes;
    colorTools.setAttribute("aria-disabled", String(!hasEyes));
  }

  function showStatus(message = "") {
    status.textContent = message || (face?.eyesAvailable === false
      ? "눈을 불러오지 못했어. 새로고침 후 다시 시도해 줘." : "");
  }

  function sync() {
    if (!face) return;
    const state = face.getState();
    for (const [key] of controls) {
      ranges[key].value = String(state[key]);
      outputs[key].textContent = deltaLabel(state[key]);
    }
    shapeList.querySelectorAll("[data-eye-shape]").forEach(button => {
      button.setAttribute("aria-pressed", String(button.dataset.eyeShape === state.eyeShape));
    });
    const original = state.eyeColor === null;
    originalButton.setAttribute("aria-pressed", String(original));
    colorState.textContent = original ? "원래 색 사용 중" : "선택한 색 사용 중";
    colorTools.dataset.original = String(original);
    // The neutral wheel is only a starting choice; null retains the PNG color.
    // Neither mounting nor external state changes should become a user edit.
    const selectedShape = face.eyeShapes?.find(shape => shape.id === state.eyeShape);
    const wheelHex = original ? (selectedShape?.defaultColor || "#9F2C3E") : state.eyeColor;
    if (colorWheel?.getColor().hex !== wheelHex) colorWheel?.setHex(wheelHex, false);
  }

  async function drawShapePreview(canvas, shape) {
    const context = canvas.getContext("2d");
    if (!context) return;
    try {
      const paths = shape.preview ? [shape.preview]
        : ["sclera", "pupil", "highlights", "eyelashes"].map(key => shape.sources?.[key]);
      if (paths.some(path => typeof path !== "string" || !path)) return;
      const images = await Promise.all(paths.map(src => new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = reject;
        image.src = src;
      })));
      if (!canvas.isConnected) return;
      const box = shape.box;
      const source = shape.preview ? { x: 0, y: 0, w: images[0].naturalWidth, h: images[0].naturalHeight } : box;
      if (!source?.w || !source?.h) return;
      const scale = Math.min(canvas.width / source.w, canvas.height / source.h);
      const width = source.w * scale, height = source.h * scale;
      context.clearRect(0, 0, canvas.width, canvas.height);
      for (const image of images) context.drawImage(image, source.x, source.y, source.w, source.h,
        (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
      canvas.hidden = false;
    } catch (_) { /* The labeled choice stays usable if only its preview fails. */ }
  }

  function renderShapes() {
    shapeList.replaceChildren();
    const catalog = face?.eyeShapes || window.DressLabEyeShapes;
    const shapes = Array.isArray(catalog) ? catalog.filter(shape => shape &&
      typeof shape.id === "string" && typeof shape.label === "string") : [];
    for (const shape of shapes) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "ui-face-shape";
      button.dataset.eyeShape = shape.id;
      button.setAttribute("aria-label", "눈 모양 " + shape.label);
      button.setAttribute("aria-pressed", "false");
      const preview = document.createElement("canvas");
      preview.width = 360;
      preview.height = 144;
      preview.hidden = true;
      preview.setAttribute("aria-hidden", "true");
      const label = document.createElement("span");
      label.textContent = shape.label;
      button.append(preview, label);
      shapeList.appendChild(button);
      drawShapePreview(preview, shape);
    }
  }

  function bindFace(nextFace) {
    if (!nextFace || typeof nextFace.getState !== "function" || typeof nextFace.setState !== "function") return false;
    face = nextFace;
    operation++;
    busy = false;
    for (const [key] of controls) {
      const [min, max] = face.limits?.[key] || [75, 125];
      ranges[key].min = String(min);
      ranges[key].max = String(max);
    }
    renderShapes();
    sync();
    updateAvailability();
    showStatus();
    return true;
  }

  function applyValue(key, value) {
    if (!face || !ranges[key]) return;
    const input = ranges[key];
    const next = Math.max(Number(input.min), Math.min(Number(input.max), Number(value)));
    if (!Number.isFinite(next)) return;
    const changed = face.setState({ [key]: Math.round(next) });
    showStatus(changed === false ? "얼굴을 변경하지 못했어." : "");
    sync();
  }

  async function applyAsync(action, loading, failure) {
    if (!face || busy) return;
    const current = ++operation;
    busy = true;
    updateAvailability();
    showStatus(loading);
    try {
      const result = await action();
      if (current !== operation) return;
      showStatus(result === false ? failure : "");
    } catch (_) {
      if (current === operation) showStatus(failure);
    } finally {
      if (current === operation) {
        busy = false;
        sync();
        updateAvailability();
      }
    }
  }

  panel.addEventListener("input", event => {
    const input = event.target.closest("input[data-face-key]");
    if (input) applyValue(input.dataset.faceKey, input.value);
  });
  panel.addEventListener("click", event => {
    const stepper = event.target.closest("[data-face-step]");
    if (stepper) {
      const key = stepper.dataset.faceKey;
      applyValue(key, Number(ranges[key].value) + Number(stepper.dataset.faceStep));
      return;
    }
    const shape = event.target.closest("[data-eye-shape]");
    if (shape && face && shape.dataset.eyeShape !== face.getState().eyeShape) {
      applyAsync(() => face.selectEyeShape(shape.dataset.eyeShape), "눈 모양을 불러오는 중…", "눈 모양을 불러오지 못했어.");
      return;
    }
    if (event.target.closest(".ui-face-original") && face) {
      face.setState({ eyeColor: null });
      sync();
      showStatus();
    }
    if (event.target.closest(".ui-face-reset") && face) {
      applyAsync(() => face.reset(), "얼굴을 되돌리는 중…", "얼굴을 되돌리지 못했어.");
    }
  });
  window.addEventListener("dresslab:eye-color-change", event => {
    if (!face || face.eyesAvailable === false || event.detail?.source !== "eye") return;
    const changed = face.setState({ eyeColor: event.detail.hex });
    showStatus(changed === false ? "눈 색을 변경하지 못했어." : "");
    sync();
  });
  window.addEventListener("dresslab:face-change", sync);
  window.addEventListener("dresslab:face-ready", event => bindFace(event.detail?.face || window.dressLabFace));
  window.addEventListener("dresslab:face-error", event => {
    showStatus(event.detail?.message || "얼굴을 불러오지 못했어.");
  });
  window.addEventListener("dresslab:magic-tab-change", event => {
    if (event.detail?.tab !== "face") return;
    if (!face && window.dressLabFace) bindFace(window.dressLabFace);
    sync();
  });

  window.DressLabFaceEditor = { bindFace, get face() { return face; } };
  renderShapes();
  updateAvailability();
  if (window.dressLabFace) bindFace(window.dressLabFace);
})();
