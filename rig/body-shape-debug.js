/* Dress Lab V2 — head/neck and five-body-part testing controls.
 * Only displayed when the page is opened with ?body=1.
 * Limits are read directly from the same config as the deformation engine.
 */
(() => {
  "use strict";

  function mount(shape, motion = window.dressLabMotion) {
    if (!shape || document.getElementById("body-shape-panel")) return;

    const style = document.createElement("style");
    style.textContent = [
      "#body-shape-panel{position:fixed;right:10px;top:calc(10px + env(safe-area-inset-top));",
      "z-index:11000;width:min(336px,calc(100vw - 20px));",
      "border:1px solid #c7aea6;border-radius:14px;background:#fffaf8f5;",
      "box-shadow:0 8px 30px #4d38383a;color:#4b3433;",
      "font:13px/1.45 -apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo','Noto Sans KR',sans-serif;",
      "overflow:hidden}",
      "#body-shape-panel *{box-sizing:border-box}",
      "#body-shape-panel .shape-head{display:flex;align-items:center;justify-content:space-between;",
      "gap:9px;padding:9px 11px;background:#f7ece7;border-bottom:1px solid #dcc8bf}",
      "#body-shape-panel .shape-head strong{font-size:14px;letter-spacing:-.02em}",
      "#body-shape-panel .shape-head div{display:flex;gap:5px}",
      "#body-shape-panel button{font:inherit;color:#594540;border:1px solid #c9b2a7;",
      "border-radius:8px;background:#fff;min-height:30px;padding:5px 8px;cursor:pointer}",
      "#body-shape-panel .shape-body{max-height:min(73dvh,600px);overflow-y:auto;",
      "padding:8px 12px;-webkit-overflow-scrolling:touch;overscroll-behavior:contain}",
      "#body-shape-panel[data-collapsed='true'] .shape-body{display:none}",
      "#body-shape-panel .shape-intro{margin:2px 0 9px;font-size:11px;color:#806c68;line-height:1.45}",
      "#body-shape-panel .shape-row{display:grid;grid-template-columns:85px 1fr 45px;",
      "align-items:center;gap:8px;margin:9px 0}",
      "#body-shape-panel .shape-row label{font-size:12px;font-weight:670}",
      "#body-shape-panel .shape-row input{width:100%;min-width:0;height:28px;",
      "margin:0;accent-color:#ad7e8a;touch-action:pan-x}",
      "#body-shape-panel .shape-row output{text-align:right;font-size:12px;",
      "font-variant-numeric:tabular-nums;font-weight:760}",
      "#body-shape-panel .shape-limit{font-size:10px;color:#9b5a53;white-space:nowrap;}",
      "#body-shape-panel .shape-notes{background:#f7e9e3;padding:7px 8px;",
      "border-radius:9px;margin:8px 0 10px;font-size:11px;line-height:1.7}",
      "#body-shape-panel .shape-notes div{display:flex;justify-content:space-between;gap:8px}",
      "#body-shape-panel .shape-tools{display:flex;align-items:center;justify-content:space-between;gap:6px}",
      "#body-shape-panel .shape-tools small{font-size:10px;color:#88726c}",
      "#body-shape-panel input:focus-visible,#body-shape-panel button:focus-visible{outline:2px solid #875c78;outline-offset:2px}",
      "#body-shape-panel button:active{background:#efded9}",
      "@media(max-height:570px){#body-shape-panel .shape-body{max-height:55dvh}",
      "#body-shape-panel .shape-row{margin:5px 0}}"
    ].join("");
    document.head.append(style);

    const panel = document.createElement("section");
    panel.id = "body-shape-panel";
    panel.setAttribute("aria-label", "체형 조절 실험");
    const controls = [
      ["head", "머리 크기"],
      ["neck", "목 길이"],
      ["neckWidth", "목 두께"],
      ["upperTorso", "상체 폭"],
      ["armWidth", "팔 두께"],
      ["armLength", "팔 길이"],
      ["waist", "허리 관절"],
      ["hips", "골반"],
      ["thighs", "허벅지"],
      ["calves", "종아리"]
    ];
    panel.innerHTML = [
      '<header class="shape-head"><strong>체형 조절 · V5</strong><div>',
        '<button type="button" id="shape-reset">초기화</button>',
        '<button type="button" id="shape-collapse" aria-expanded="true">접기</button>',
      '</div></header>',
      '<div class="shape-body">',
        '<p class="shape-intro">머리는 70%까지 축소할 수 있고, 목 두께와 팔 전체 굵기·길이도 조절할 수 있어. 팔꿈치·손목은 팔 길이에 맞춰 이동해.</p>',
        controls.map(([key, label]) => {
          const [min, max] = shape.limits[key];
          return [
            '<div class="shape-row">',
              '<label for="shape-', key, '">', label, '</label>',
              '<input id="shape-', key, '" data-shape-key="', key,
                '" type="range" min="', min, '" max="', max, '" step="1" value="100"',
                ' aria-label="', label, ' 두께">',
              '<output id="shape-', key, '-value" for="shape-', key, '">100%</output>',
            '</div>'
          ].join("");
        }).join(""),
        '<p class="shape-intro shape-limit">종아리 상한 115% · 엔진과 슬라이더에 동일하게 적용됨</p>',
        '<div class="shape-notes" role="status" aria-live="polite">',
          '<div><span>머리 높이 이동</span><output id="shape-neck-shift-value">0px</output></div>',
          '<div><span>허리 연결부</span><output id="shape-waist-seam-value">100.0%</output></div>',
          '<div><span>골반 → 허벅지 연결부</span><output id="shape-hip-value">100.0%</output></div>',
          '<div><span>무릎 위·아래 공통</span><output id="shape-knee-value">100.0%</output></div>',
        '</div>',
        '<div class="shape-tools">',
          '<button type="button" id="shape-toggle-idle">움직임 정지</button>',
          '<small>원본 100% · 좌우 동시 변형</small>',
        '</div>',
      '</div>'
    ].join("");
    document.body.append(panel);

    const inputs = Object.fromEntries(controls.map(([key]) => {
      const input = panel.querySelector("#shape-" + key);
      const [min, max] = shape.limits[key];
      // Reinforce at runtime to avoid stale slider attributes on cached pages.
      input.min = String(min);
      input.max = String(max);
      input.step = "1";
      input.value = "100";
      return [key, input];
    }));
    const outputs = Object.fromEntries(controls.map(([key]) =>
      [key, panel.querySelector("#shape-" + key + "-value")]));

    let queued = false;
    let latest = shape.getState();

    function currentInput() {
      const values = {};
      for (const [key, input] of Object.entries(inputs)) {
        const [low, high] = shape.limits[key];
        const value = Math.round(Math.min(high, Math.max(low, Number(input.value) || 100)));
        input.value = String(value);
        values[key] = value;
        outputs[key].textContent = value + "%";
      }
      return values;
    }
    function showState(state) {
      for (const [key, input] of Object.entries(inputs)) {
        input.value = String(state[key]);
        outputs[key].textContent = state[key] + "%";
      }
      // Head position follows neck stretch while torso joints remain fixed.
      const headMove = shape.neckOffsetY();
      panel.querySelector("#shape-neck-shift-value").textContent =
        Math.abs(headMove).toFixed(1) + "px " +
        (headMove < -0.01 ? "↑" : headMove > 0.01 ? "↓" : "—");
      // Both sides of each seam use the same computed scale.
      panel.querySelector("#shape-waist-seam-value").textContent = state.waist.toFixed(1) + "%";
      panel.querySelector("#shape-hip-value").textContent = (state.hipScale * 100).toFixed(1) + "%";
      panel.querySelector("#shape-knee-value").textContent = (state.kneeScale * 100).toFixed(1) + "%";
    }
    function updateNow() {
      queued = false;
      const values = currentInput();
      const ok = shape.setShape(values);
      if (!ok) return;
      latest = shape.getState();
      showState(latest);
    }
    function schedule() {
      currentInput();
      if (queued) return;
      queued = true;
      requestAnimationFrame(updateNow);
    }
    for (const input of Object.values(inputs)) {
      input.addEventListener("input", schedule);
      input.addEventListener("change", schedule);
    }
    panel.querySelector("#shape-reset").addEventListener("click", () => {
      for (const input of Object.values(inputs)) input.value = "100";
      // Restore all shapes from the original immutable sprites immediately.
      shape.reset();
      latest = shape.getState();
      showState(latest);
      queued = false;
    });

    const collapse = panel.querySelector("#shape-collapse");
    collapse.addEventListener("click", () => {
      const folded = panel.dataset.collapsed !== "true";
      panel.dataset.collapsed = String(folded);
      collapse.textContent = folded ? "펼치기" : "접기";
      collapse.setAttribute("aria-expanded", String(!folded));
    });
    const toggle = panel.querySelector("#shape-toggle-idle");
    if (!motion) toggle.disabled = true;
    toggle.addEventListener("click", () => {
      if (!motion) return;
      if (motion.enabled) {
        motion.pause();
        toggle.textContent = "움직임 재개";
      } else {
        motion.resumeIdle();
        toggle.textContent = "움직임 정지";
      }
    });

    showState(latest);
  }

  window.DressLabBodyShapeDebug = { mount };
})();