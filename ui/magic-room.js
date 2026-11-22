/* Dress Lab V2 • Magic Room shape editor
 *
 * The artboard UI is already scaled to the same 1206x2622 source coordinates
 * as the character. All seven actual V4 shape controls belong in this right
 * panel; the independent ?body=1 developer panel remains optional elsewhere.
 * This module owns UI state only: shape data is held by DressLabBodyShape.
 */
(() => {
  "use strict";

  const scene = document.getElementById("ui-scene");
  const editor = scene?.querySelector(".ui-editor");
  if (!scene || !editor) return;

  const controls = [
    ["head", "머리 크기", 70, 113],
    ["neck", "목 길이", 78, 127],
    ["neckWidth", "목 두께", 80, 120],
    ["upperTorso", "상체 폭", 90, 118],
    ["armWidth", "팔 두께", 80, 125],
    ["armLength", "팔 길이", 85, 120],
    ["waist", "허리 관절", 85, 120],
    ["hips", "골반", 90, 120],
    ["thighs", "허벅지", 85, 135],
    ["calves", "종아리", 85, 115]
  ];

  const panel = document.createElement("section");
  panel.className = "ui-magic-panel";
  panel.id = "ui-magic-panel";
  panel.setAttribute("aria-label", "마법룸 체형 조절");
  panel.innerHTML = [
    controls.map(([key, label, min, max]) => [
      '<div class="ui-magic-row">',
        '<label class="ui-magic-title" for="magic-range-', key, '">', label, '</label>',
        '<div class="ui-magic-input-line">',
          '<output class="ui-magic-output" id="magic-value-', key, '" for="magic-range-', key, '">0%</output>',
          '<button type="button" class="ui-magic-step" data-magic-step="-1" data-shape-key="',
            key, '" aria-label="', label, ' 줄이기" disabled>−</button>',
          '<input class="ui-magic-slider" type="range" id="magic-range-', key,
            '" data-shape-key="', key, '" min="', min, '" max="', max,
            '" step="1" value="100" aria-label="', label, '" disabled>',
          '<button type="button" class="ui-magic-step" data-magic-step="1" data-shape-key="',
            key, '" aria-label="', label, ' 늘이기" disabled>+</button>',
        '</div>',
      '</div>'
    ].join("")).join(""),
    '<div class="ui-magic-actions"><button class="ui-magic-reset" id="ui-magic-reset" type="button" disabled>초기화</button></div>',
    '<p class="ui-magic-status" id="ui-magic-status" role="status" aria-live="polite"></p>'
  ].join("");
  editor.appendChild(panel);

  // These categories are visible in the sketch, but their editing engines
  // have not been implemented. Do not misrepresent them as functional.
  for (const [id, label, explanation] of [
    ["skin", "피부톤", "피부톤 편집 기능은 아직 준비 중이야."],
    ["face", "얼굴", "얼굴 편집 기능은 아직 준비 중이야."]
  ]) {
    const placeholder = document.createElement("section");
    placeholder.className = "ui-magic-placeholder ui-magic-placeholder--" + id;
    placeholder.setAttribute("aria-label", label + " 편집");
    const title = document.createElement("strong");
    title.textContent = label;
    const description = document.createElement("p");
    description.textContent = explanation;
    placeholder.append(title, description);
    editor.appendChild(placeholder);
  }

  const rangeElements = Object.fromEntries(controls.map(([key]) =>
    [key, panel.querySelector("#magic-range-" + key)]));
  const outputElements = Object.fromEntries(controls.map(([key]) =>
    [key, panel.querySelector("#magic-value-" + key)]));
  const resetButton = panel.querySelector("#ui-magic-reset");
  const status = panel.querySelector("#ui-magic-status");

  let shape = null;
  let scheduled = 0;

  function deltaLabel(percent) {
    const change = Math.round(percent - 100);
    return (change > 0 ? "+" : "") + change + "%";
  }

  function syncFromShape() {
    if (!shape) return;
    const state = shape.getState();
    for (const [key] of controls) {
      rangeElements[key].value = String(state[key]);
      outputElements[key].textContent = deltaLabel(state[key]);
    }
  }

  function clampInput(key) {
    const [low, high] = shape.limits[key];
    const input = rangeElements[key];
    const value = Number(input.value);
    const clamped = Number.isFinite(value)
      ? Math.round(Math.max(low, Math.min(high, value)))
      : 100;
    input.value = String(clamped);
    outputElements[key].textContent = deltaLabel(clamped);
    return clamped;
  }

  function apply() {
    scheduled = 0;
    if (!shape) return;
    const next = {};
    for (const [key] of controls) next[key] = clampInput(key);
    if (!shape.setShape(next)) {
      status.textContent = "체형을 변경하지 못했어.";
      return;
    }
    syncFromShape();
    status.textContent = "";
  }

  function queue() {
    if (scheduled || !shape) return;
    scheduled = requestAnimationFrame(apply);
  }

  function bindShape(nextShape) {
    if (!nextShape || !nextShape.limits || typeof nextShape.setShape !== "function") {
      status.textContent = "체형 엔진을 불러올 수 없어.";
      return false;
    }
    if (scheduled) cancelAnimationFrame(scheduled);
    scheduled = 0;
    shape = nextShape;
    for (const [key] of controls) {
      const [low, high] = shape.limits[key];
      const input = rangeElements[key];
      input.min = String(low);
      input.max = String(high);
      input.step = "1";
      input.disabled = false;
    }
    panel.querySelectorAll("[data-magic-step]").forEach(button => {
      button.disabled = false;
    });
    resetButton.disabled = false;
    syncFromShape();
    status.textContent = "";
    return true;
  }

  panel.addEventListener("input", event => {
    const input = event.target.closest(".ui-magic-slider");
    if (!input || !shape) return;
    clampInput(input.dataset.shapeKey);
    queue();
  });

  panel.addEventListener("change", event => {
    if (event.target.closest(".ui-magic-slider")) queue();
  });

  panel.addEventListener("click", event => {
    const stepper = event.target.closest("[data-magic-step]");
    if (stepper && shape) {
      const key = stepper.dataset.shapeKey;
      const input = rangeElements[key];
      input.value = String(Number(input.value) + Number(stepper.dataset.magicStep));
      clampInput(key);
      queue();
      return;
    }
    if (event.target.closest("#ui-magic-reset") && shape) {
      if (scheduled) cancelAnimationFrame(scheduled);
      scheduled = 0;
      shape.reset();
      syncFromShape();
      status.textContent = "";
    }
  });

  window.addEventListener("dresslab:room-change", event => {
    const isMagic = event.detail?.room === "magic";
    if (isMagic) {
      if (!shape && window.dressLabBodyShape) bindShape(window.dressLabBodyShape);
      syncFromShape();
    }
    // When the user enters the Magic Room, the old floating developer
    // sliders should not cover the real room UI.
    const legacy = document.getElementById("body-shape-panel");
    if (legacy) legacy.style.display = isMagic ? "none" : "";
  });

  window.DressLabMagicRoom = {
    bindShape,
    get shape() { return shape; },
    get room() { return scene.dataset.room; },
    get controls() { return controls.map(([key]) => key); },
    reset() {
      if (!shape) return false;
      shape.reset();
      syncFromShape();
      return true;
    }
  };

  // Covers either script execution order: the shape engine can initialize
  // before or after the deferred UI scripts.
  if (window.dressLabBodyShape) bindShape(window.dressLabBodyShape);
})();