/* Dress Lab V2 - opt-in rig tester.
 * Add ?rig=1 to the URL to show this panel. It is not part of the game UI.
 */
(() => {
  "use strict";

  function mount(rig, motionController = window.dressLabMotion) {
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
      "#rig-debug-panel .rig-quick-actions{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));",
      "gap:6px;padding:9px 10px 5px;background:#fff8f1;border-bottom:1px solid #e9ded5}",
      "#rig-debug-panel .rig-quick-actions button{font-size:12px;font-weight:760;",
      "line-height:1.25;min-height:42px;padding:6px 4px;background:#fff;border-color:#c6b5aa}",
      "#rig-debug-panel .rig-quick-actions button:active{background:#ffe7cd}",
      "#rig-debug-panel .rig-quick-actions button[aria-pressed='true']{background:#f9e2ca;border-color:#9c7163}",
      "#rig-debug-panel .rig-motion-hint{padding:3px 11px 8px;background:#fff8f1;",
      "font-size:11px;color:#66554a;line-height:1.3;margin:0}",
      "#rig-debug-panel[data-collapsed='true'] .rig-motion-hint{border-bottom:0}",
      "#rig-debug-panel .rig-flags{display:flex;flex-wrap:wrap;gap:11px;margin-bottom:8px}",
      "#rig-debug-panel .rig-flags label{display:flex;align-items:center;gap:5px}",
      "#rig-debug-panel .rig-row{display:grid;grid-template-columns:88px 1fr 43px;align-items:center;gap:6px;",
      "min-height:31px;border-top:1px solid #f0eae6}",
      "#rig-debug-panel .rig-row input{width:100%;min-width:0;accent-color:#6485ba}",
      "#rig-debug-panel .rig-row output{text-align:right;font-variant-numeric:tabular-nums}",
      "#rig-debug-panel .rig-note{margin:8px 0 0;color:#716a67;font-size:11px}",
      "#rig-debug-panel .rig-subtitle{margin:11px 0 5px;font-weight:760;font-size:12px}",
      "#rig-debug-panel .rig-strength{width:100%;display:flex;gap:7px;align-items:center;justify-content:space-between}",
      "#rig-debug-panel .rig-strength input{flex:1;min-width:40px;accent-color:#6485ba}",
      "#rig-debug-panel .rig-strength output{min-width:35px;text-align:right}",
      "@media(max-width:600px){#rig-debug-panel{max-height:55dvh}#rig-debug-panel .rig-body{max-height:calc(55dvh - 48px)}}"
    ].join("");
    document.head.append(style);

    const ids = Object.keys(rig.config.pivots);
    const section = document.createElement("section");
    section.id = "rig-debug-panel";
    section.setAttribute("aria-label", "관절 회전 테스트");
    section.innerHTML = [
      '<header><strong>움직임 미리보기</strong><button type="button" id="rig-collapse" aria-expanded="true">상세 조절 접기</button></header>',
      '<nav class="rig-quick-actions" aria-label="큰 동작 바로 실행">',
        '<button type="button" data-rig-action="showPose">첨부 포즈 연기</button>',
        '<button type="button" data-rig-action="bigWave">큰 손짓</button>',
        '<button type="button" data-rig-action="hop">한발 콩콩</button>',
        '<button type="button" data-rig-action="dance">좌우 율동</button>',
        '<button type="button" data-rig-action="stretch">기지개</button>',
        '<button type="button" id="rig-quick-idle">숨쉬기 idle</button>',
      '</nav>',
      '<p class="rig-motion-hint" id="rig-motion-hint" role="status" aria-live="polite">큰 동작 버튼을 누르면 즉시 재생돼. 아래 옵션은 펼쳐서 볼 수 있어.</p>',
      '<div class="rig-body">',
        '<p class="rig-subtitle">자동 움직임 · 탄성 애니메이션</p>',
        '<div class="rig-controls">',
          '<button type="button" id="rig-idle">숨쉬기 idle</button>',
          '<button type="button" data-rig-action="boing">보잉!</button>',
          '<button type="button" data-rig-action="wave">손 흔들기</button>',
          '<button type="button" data-rig-action="hello">인사하기</button>',
          '<button type="button" id="rig-stop">정지</button>',
        '</div>',
        '<p class="rig-subtitle">기본 포즈</p>',
        '<div class="rig-controls">',
          '<button type="button" id="rig-neutral">기본 자세</button>',
          '<button type="button" data-rig-pose="reference">첨부 포즈</button>',
          '<button type="button" data-rig-pose="relaxed">편안하게</button>',
          '<button type="button" data-rig-pose="shy">수줍게</button>',
          '<button type="button" data-rig-pose="greeting">팔 들기</button>',
          '<button type="button" data-rig-pose="cheer">만세</button>',
          '<button type="button" data-rig-pose="sway">기울기</button>',
          '<button type="button" id="rig-export">포즈 저장</button>',
        '</div>',
        '<label class="rig-strength">애니메이션 강도 <input id="rig-strength" type="range" min="0.35" max="1.6" step="0.05" value="1"><output id="rig-strength-value">1.00×</output></label>',
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
    // The large-motion dock stays visible even when the detailed controls
    // are collapsed or too long to fit on a small phone screen.
    const motionOnly = new URLSearchParams(window.location.search).get("motions") === "1";
    if (motionOnly) {
      section.dataset.collapsed = "true";
      const toggle = section.querySelector("#rig-collapse");
      toggle.textContent = "세부 조절 보기";
      toggle.setAttribute("aria-expanded", "false");
    }
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

    const stopMotion = () => {
      if (motionController) motionController.pause();
    };

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
      event.currentTarget.textContent = collapsed ? "세부 조절 보기" : "상세 조절 접기";
      event.currentTarget.setAttribute("aria-expanded", String(!collapsed));
    });
    section.querySelector("#rig-neutral").addEventListener("click", () => {
      if (motionController) motionController.pause(true);
      else rig.reset();
      sync();
    });
    for (const button of [section.querySelector("#rig-idle"), section.querySelector("#rig-quick-idle")]) {
      button.addEventListener("click", () => {
        motionController?.resumeIdle();
        section.querySelectorAll(".rig-quick-actions [data-rig-action]").forEach(b => b.setAttribute("aria-pressed", "false"));
        section.querySelector("#rig-motion-hint").textContent = "숨쉬기 idle로 돌아왔어.";
      });
    }
    section.querySelector("#rig-stop").addEventListener("click", () => {
      stopMotion();
      sync();
    });
    for (const button of section.querySelectorAll("[data-rig-pose]")) {
      button.addEventListener("click", () => {
        if (motionController) motionController.setPose(button.dataset.rigPose);
        else if (window.DressLabMotionPoses) rig.setPose(window.DressLabMotionPoses[button.dataset.rigPose], true);
        sync();
      });
    }
    for (const button of section.querySelectorAll("[data-rig-action]")) {
      button.addEventListener("click", () => {
        const played = motionController?.play(button.dataset.rigAction) || false;
        const hint = section.querySelector("#rig-motion-hint");
        if (!hint) return;
        hint.textContent = played
          ? button.textContent + " 재생 중 · 끝나면 숨쉬기 idle로 돌아가."
          : "재생할 수 없어. 기기의 '움직임 줄이기' 설정 또는 리그 상태를 확인해 줘.";
        section.querySelectorAll(".rig-quick-actions [data-rig-action]").forEach(b => {
          b.setAttribute("aria-pressed", String(played && b.dataset.rigAction === button.dataset.rigAction));
        });
      });
    }
    const power = section.querySelector("#rig-strength");
    if (motionController) power.value = String(motionController.intensity);
    power.addEventListener("input", () => {
      const n = Number(power.value);
      motionController?.setIntensity(n);
      section.querySelector("#rig-strength-value").textContent = n.toFixed(2) + "×";
    });
    section.querySelector("#rig-strength-value").textContent = Number(power.value).toFixed(2) + "×";
    if (motionController) motionController.subscribe(() => {
      sync();
      if (!motionController.action) {
        section.querySelectorAll(".rig-quick-actions [data-rig-action]").forEach(button => button.setAttribute("aria-pressed", "false"));
      }
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

    // The compact motion preview is for watching gestures, not inspecting axes.
    // Keep the reference markers only in the detailed rig tester.
    const showDots = !motionOnly;
    section.querySelector("#rig-show-dots").checked = showDots;
    rig.showMarkers(showDots);
    window.addEventListener("pagehide", stopMotion, { once:true });
  }

  window.DressLabRigDebug = { mount };
})();