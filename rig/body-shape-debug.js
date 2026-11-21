/* Optional 2-slider body-shape test UI.
 * Appears only with ?body=1, and never displaces the existing doll or layout.
 */
(() => {
  "use strict";

  function mount(shape, motion = window.dressLabMotion) {
    if (!shape || document.getElementById("body-shape-panel")) return;

    const style = document.createElement("style");
    style.textContent = [
      "#body-shape-panel{position:fixed;right:10px;top:calc(10px + env(safe-area-inset-top));",
      "z-index:11000;width:min(310px,calc(100vw - 20px));padding:13px 15px;",
      "border:1px solid #c8a9a2;border-radius:15px;background:#fffaf7f5;",
      "box-shadow:0 8px 30px #4d383842;color:#4b3433;",
      "font:13px/1.5 -apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo','Noto Sans KR',sans-serif;",
      "max-height:min(55dvh,340px);overflow:auto;-webkit-overflow-scrolling:touch}",
      "#body-shape-panel *{box-sizing:border-box}",
      "#body-shape-panel header{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px}",
      "#body-shape-panel header strong{font-size:15px;letter-spacing:-.02em}",
      "#body-shape-panel p{margin:3px 0 9px;font-size:11px;color:#806c68;line-height:1.45}",
      "#body-shape-panel .shape-row{display:grid;grid-template-columns:62px 1fr 45px;",
      "align-items:center;gap:10px;margin:11px 0}",
      "#body-shape-panel label{font-size:13px;font-weight:650}",
      "#body-shape-panel input[type=range]{width:100%;margin:0;accent-color:#aa7d84;",
      "touch-action:pan-x;min-width:0;height:26px}",
      "#body-shape-panel output{text-align:right;font-variant-numeric:tabular-nums;font-weight:700}",
      "#body-shape-panel .shape-tools{display:flex;align-items:center;gap:6px;justify-content:space-between}",
      "#body-shape-panel button{border:1px solid #ccb4ac;border-radius:9px;background:#fff;",
      "color:#594540;padding:7px 9px;font:inherit;min-height:35px;cursor:pointer}",
      "#body-shape-panel button:focus-visible,#body-shape-panel input:focus-visible{outline:2px solid #7f5676;outline-offset:2px}",
      "#body-shape-panel button:active{background:#f0e2de}",
      "#body-shape-panel .shape-note{background:#f7e9e4;border-radius:8px;padding:7px 9px;margin:8px 0 0}",
      "@media(max-height:600px){#body-shape-panel{max-height:70dvh;padding:8px 12px}",
      "#body-shape-panel .shape-row{margin:5px 0}}"
    ].join("");
    document.head.append(style);

    const panel = document.createElement("section");
    panel.id = "body-shape-panel";
    panel.setAttribute("aria-label", "허벅지와 종아리 체형 조절");
    panel.innerHTML = [
      '<header><strong>다리 체형 조절 · 실험</strong><button type="button" id="shape-reset">초기화</button></header>',
      '<p>허벅지와 종아리의 가운데를 변형하고, 무릎 연결부는 변화량의 10%만 따라가게 했어.</p>',
      '<div class="shape-row">',
        '<label for="shape-thighs">허벅지</label>',
        '<input id="shape-thighs" type="range" min="85" max="135" step="1" value="100">',
        '<output id="shape-thighs-value" for="shape-thighs">100%</output>',
      '</div>',
      '<div class="shape-row">',
        '<label for="shape-calves">종아리</label>',
        '<input id="shape-calves" type="range" min="85" max="135" step="1" value="100">',
        '<output id="shape-calves-value" for="shape-calves">100%</output>',
      '</div>',
      '<p class="shape-note" id="shape-knee" role="status">무릎 연결부: 100.0%</p>',
      '<div class="shape-tools">',
        '<button type="button" id="shape-toggle-idle">움직임 정지</button>',
        '<small>양쪽 다리 동시 조절</small>',
      '</div>'
    ].join("");
    document.body.append(panel);

    const thigh = panel.querySelector("#shape-thighs");
    const calf = panel.querySelector("#shape-calves");
    const outThigh = panel.querySelector("#shape-thighs-value");
    const outCalf = panel.querySelector("#shape-calves-value");
    const knee = panel.querySelector("#shape-knee");
    const motionButton = panel.querySelector("#shape-toggle-idle");

    let scheduled = false;
    function updateOutputs() {
      outThigh.textContent = thigh.value + "%";
      outCalf.textContent = calf.value + "%";
      const delta = 0.1 * ((Number(thigh.value) - 100) + (Number(calf.value) - 100));
      knee.textContent = "무릎 연결부: " + (100 + delta).toFixed(1) + "%";
    }
    function applyNow() {
      scheduled = false;
      const success = shape.setShape({
        thighs:Number(thigh.value),
        calves:Number(calf.value)
      });
      if (!success) knee.textContent = "변형을 적용하지 못했어.";
    }
    function requestUpdate() {
      updateOutputs();
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(applyNow);
    }
    thigh.addEventListener("input", requestUpdate);
    calf.addEventListener("input", requestUpdate);

    panel.querySelector("#shape-reset").addEventListener("click", () => {
      thigh.value = "100";
      calf.value = "100";
      updateOutputs();
      requestAnimationFrame(applyNow);
    });
    motionButton.addEventListener("click", () => {
      if (!motion) return;
      if (motion.enabled) {
        motion.pause();
        motionButton.textContent = "움직임 재개";
      } else {
        motion.resumeIdle();
        motionButton.textContent = "움직임 정지";
      }
    });
    updateOutputs();
  }

  window.DressLabBodyShapeDebug = { mount };
})();