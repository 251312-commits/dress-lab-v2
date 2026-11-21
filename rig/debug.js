/* Dress Lab V2 - opt-in rig tester.
 * Add ?rig=1 to the URL to show this panel. It is not part of the game UI.
 */
(() => {
  "use strict";

  function mount(rig) {
    if (!rig || document.getElementById("rig-debug-panel")) return;

    const style = document.createElement("style");
    style.textContent = [
      "#rig-debug-panel{position:fixed;right:10px;bottom:calc(10px + env(safe-area-inset-bottom));z-index:10000;",
      "width:min(340px,calc(100vw - 20px));max-height:min(68dvh,670px);background:#fffffff2;color:#262629;",
      "border:1px solid #baafa9;border-radius:14px;box-shadow:0 8px 26px #33252540;",
      "font:13px/1.4 -apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo',sans-serif;overflow:hidden}",
      "#rig-debug-panel *{box-sizing:border-box}",
      "#rig-debug-panel button{cursor:pointer;background:#f0eeeb;color:#262629;border:1px solid #bdb4b0;",
      "border-radius:7px;min-height:34px;padding:5px 8px;font:inherit}",
      "#rig-debug-panel button:focus-visible,#rig-debug-panel input:focus-visible{outline:2px solid #2c73c7;outline-offset:2px}",
      "#rig-debug-panel header{display:flex;align-items:center;justify-content:space-between;padding:9px 11px;background:#f2ede9;",
      "border-bottom:1px solid #d8ccc3;gap:10px}",
      "#rig-debug-panel header strong{font-weight:750}",
      "#rig-debug-panel .rig-body{padding:10px 11px;max-height:calc(min(68dvh,670px) - 48px);overflow-y:auto;",
      "-webkit-overflow-scrolling:touch}",
      "#rig-debug-panel[data-collapsed='true'] .rig-body{display:none}",
      "#rig-debug-panel .rig-controls{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px}",
      "#rig-debug-panel .rig-flags{display:flex;flex-wrap:wrap;gap:11px;margin-bottom:8px}",
      "#rig-debug-panel .rig-flags label{display:flex;align-items:center;gap:5px}",
      "#rig-debug-panel .rig-row{display:grid;grid-template-columns:88px 1fr 43px;align-items:center;gap:6px;",
      "min-height:31px;border-top:1px solid #f0eae6}",
      "#rig-debug-panel .rig-row input{width:100%;min-width:0;accent-color:#6485ba}",
      "#rig-debug-panel .rig-row output{text-align:right;font-variant-numeric:tabular-nums}",
      "#rig-debug-panel .rig-note{margin:8px 0 0;color:#716a67;font-size:11px}",
      "@media(max-width:600px){#rig-debug-panel{max-height:55dvh}#rig-debug-panel .rig-body{max-height:calc(55dvh - 48px)}}"
    ].join("");
    document.head.append(style);

    const ids = Object.keys(rig.config.pivots);
    const section = document.createElement("section");
    section.id = "rig-debug-panel";
    section.setAttribute("aria-label", "관절 회전 테스트");
    section.innerHTML = [
      '<header><strong>관절 테스트 · 11축</strong><button type="button" id="rig-collapse" aria-expanded="true">접기</button></header>',
      '<div class="rig-body">',
        '<div class="rig-controls">',
          '<button type="button" id="rig-neutral">기본 자세</button>',
          '<button type="button" id="rig-pose">팔 들기</button>',
          '<button type="button" id="rig-wave">손 흔들기</button>',
          '<button type="button" id="rig-export">포즈 저장</button>',
        '</div>',
        '<div class="rig-flags">',
          '<label><input type="checkbox" id="rig-show-dots" checked> 축 표시</label>',
          '<label><input type="checkbox" id="rig-show-full"> 원본 참고그림</label>',
        '</div>',
        ids.map(id => {
          const j = rig.config.pivots[id];
          return '<label class="rig-row"><span>' + j.label + '</span>' +
             '<input type="range" data-rig-joint="' + id + '" min="' + j.min +
             '" max="' + j.max + '" step="1" value="0" aria-label="' + j.label + ' 회전">' +
             '<output data-rig-angle="' + id + '">0°</output></label>';
        }).join(""),
        '<p class="rig-note">각도만 시험하는 개발용 화면이다. 머리·목은 별도의 회전축이 없다. 관절 접합부는 추후 보정할 수 있다.</p>',
      '</div>'
    ].join("");
    document.body.append(section);

    const inputs = [...section.querySelectorAll("[data-rig-joint]")];
    const displays = new Map([...section.querySelectorAll("[data-rig-angle]")]
      .map(output => [output.dataset.rigAngle, output]));
    const sync = () => {
      for (const input of inputs) {
        const value = Math.round(rig.getAngle(input.dataset.rigJoint));
        input.value = String(value);
        displays.get(input.dataset.rigJoint).textContent = value + "°";
      }
    };

    let rafId = 0;
    function stopMotion() {
      if (!rafId) return;
      cancelAnimationFrame(rafId);
      rafId = 0;
      section.querySelector("#rig-wave").textContent = "손 흔들기";
    }

    for (const input of inputs) {
      input.addEventListener("input", () => {
        stopMotion();
        rig.setAngle(input.dataset.rigJoint, Number(input.value));
        displays.get(input.dataset.rigJoint).textContent = input.value + "°";
      });
    }
    section.querySelector("#rig-collapse").addEventListener("click", event => {
      const collapsed = section.dataset.collapsed !== "true";
      section.dataset.collapsed = String(collapsed);
      event.currentTarget.textContent = collapsed ? "펼치기" : "접기";
      event.currentTarget.setAttribute("aria-expanded", String(!collapsed));
    });
    section.querySelector("#rig-neutral").addEventListener("click", () => {
      stopMotion(); rig.reset(); sync();
    });
    section.querySelector("#rig-pose").addEventListener("click", () => {
      stopMotion();
      rig.setPose({ shoulderR:-60, elbowR:-45, wristR:10 }, true);
      sync();
    });

    section.querySelector("#rig-wave").addEventListener("click", () => {
      if (rafId) { stopMotion(); return; }
      section.querySelector("#rig-wave").textContent = "정지";
      const start = performance.now();
      function tick(now) {
        const t = (now-start)/1000;
        rig.setPose({
          shoulderR:-61,
          elbowR:-48 + 17 * Math.sin(t * Math.PI * 3.3),
          wristR:12 + 12 * Math.sin(t * Math.PI * 3.3 + 1)
        }, true);
        sync();
        if (t < 2.7) rafId = requestAnimationFrame(tick);
        else { rafId = 0; section.querySelector("#rig-wave").textContent="손 흔들기"; }
      }
      rafId = requestAnimationFrame(tick);
    });

    section.querySelector("#rig-show-dots").addEventListener("change", event => {
      rig.showMarkers(event.target.checked);
    });
    const referenceControl = section.querySelector("#rig-show-full");
    let guide = null;
    referenceControl.addEventListener("change", () => {
      if (!referenceControl.checked) { rig.showReference(null, false); return; }
      if (guide && guide.complete && guide.naturalWidth) {
        rig.showReference(guide, true);
        return;
      }
      guide = new Image();
      guide.onload = () => { if (referenceControl.checked) rig.showReference(guide, true); };
      guide.onerror = () => { referenceControl.checked = false; alert("Full.PNG를 불러올 수 없어."); };
      guide.src = "./base/Full.PNG";
    });
    section.querySelector("#rig-export").addEventListener("click", () => {
      const content = JSON.stringify({
        rigVersion:rig.config.version,
        angles:Object.fromEntries(ids.map(id => [id, rig.getAngle(id)]))
      }, null, 2);
      const blob = new Blob([content], { type:"application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "dress-lab-pose.json";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    });

    rig.showMarkers(true);
    window.addEventListener("pagehide", stopMotion, { once:true });
  }

  window.DressLabRigDebug = { mount };
})();