/* Dress Lab V2 • room navigation and wardrobe controls.
 * The rig and wardrobe own character rendering; UI selects their public state.
 */
(() => {
  "use strict";

  const overlay = document.getElementById("ui-overlay");
  const artboard = document.getElementById("artboard");
  if (!overlay || !artboard) return;

  // Renderable inline vector symbols: later these can be replaced by game assets.
  const symbols = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0" style="position:absolute;overflow:hidden" aria-hidden="true" focusable="false">',
    '<symbol id="dl2-shirt" viewBox="0 0 64 64"><path d="M18 11 L28 7 Q32 12 36 7 L46 11 L60 24 L51 35 L44 29 L44 57 Q32 55 20 57 L20 29 L13 35 L4 24 Z"/><path d="M28 7 Q32 18 36 7"/></symbol>',
    '<symbol id="dl2-bow" viewBox="0 0 64 64"><path d="M29 27 C10 9 2 14 7 31 C9 42 22 40 29 34"/><path d="M35 27 C54 9 62 14 57 31 C55 42 42 40 35 34"/><rect x="28" y="26" width="8" height="11" rx="2"/><path d="M29 37 L17 57 L31 52 L34 38 M35 37 L48 57 L34 52 L31 38"/></symbol>',
    '<symbol id="dl2-belt" viewBox="0 0 64 64"><rect x="5" y="24" width="54" height="17" rx="2"/><rect x="24" y="21" width="17" height="23" rx="1"/><path d="M13 24 V41 M51 24 V41 M29 33 H39"/></symbol>',
    '<symbol id="dl2-pants" viewBox="0 0 64 64"><path d="M18 8 Q32 11 46 8 L53 55 L36 57 L32 33 L28 57 L11 55 Z"/><path d="M18 8 H46 M32 32 V20"/></symbol>',
    '<symbol id="dl2-shoes" viewBox="0 0 64 64"><path d="M7 37 C13 33 19 31 23 34 L26 45 Q25 51 18 51 H7 Q2 48 5 43 Z"/><path d="M41 34 C45 31 52 33 57 37 L59 43 Q62 48 56 51 H45 Q38 51 38 45 Z"/><path d="M6 47 H25 M39 47 H58"/></symbol>',
    '<symbol id="dl2-none" viewBox="0 0 64 64"><circle cx="32" cy="32" r="23"/><path d="M16 16 L48 48"/></symbol>',
    '</svg>'
  ].join("");

  // Keep Dress Room's original tab names. The Magic Room tabs have their
  // own top-to-bottom labels: 체형 → 피부톤 → 얼굴.
  const tabs = [
    ["color", "색상"],
    ["clothes", "옷"],
    ["review", "평가"]
  ];
  const magicTabs = [
    ["body", "체형"],
    ["skin", "피부톤"],
    ["face", "얼굴"]
  ];
  const items = [
    ["shirt", "상의"],
    ["bow", "장식"],
    ["belt", "벨트"],
    ["pants", "하의"],
    ["shoes", "신발"],
    ["none", "착용 해제"]
  ];
  const wearables = {
    shirt: { id: "basic-white-tee", name: "베이직 화이트 반팔 티셔츠" },
    pants: { id: "basic-charcoal-pants", name: "베이직 차콜 긴바지" }
  };
  const rooms = [
    ["reception", "접수실"],
    ["care", "케어룸"],
    ["magic", "마법룸"],
    ["dress", "드레스룸"]
  ];
  const channels = [
    ["h", "색조", 0, 360, 0, 1],
    ["s", "채도", 0, 100, 0, 1],
    ["b", "밝기", 0, 100, 0, 1]
  ];

  const sliderMarkup = channels.map(([id, label, min, max, value, step]) => [
    '<div class="ui-slider-row" data-channel="', id, '">',
      '<output class="ui-slider-row__value" for="ui-range-', id, '" id="ui-value-', id, '">',
        value, (id === "h" ? "°" : "%"),
      '</output>',
      '<button type="button" class="ui-slider-step" data-adjust="-1" aria-label="', label, ' 감소">−</button>',
      '<input class="ui-slider-input" type="range" id="ui-range-', id, '" aria-label="', label, '" min="', min,
        '" max="', max, '" value="', value, '" step="', step, '">',
      '<button type="button" class="ui-slider-step" data-adjust="1" aria-label="', label, ' 증가">+</button>',
    '</div>'
  ].join("")).join("");

  overlay.innerHTML = [
    '<div class="ui-scene" id="ui-scene" aria-label="Dress Lab V2 인터페이스 배치 미리보기">',
      symbols,

      '<section class="ui-dialog" aria-label="대화창">',
        '<svg viewBox="0 0 550 425" preserveAspectRatio="none" aria-hidden="true"><path d="M4 4 H546 V373 H313 L275 421 L237 373 H4 Z"/></svg>',
        '<div class="ui-dialog__text" id="ui-dialog-text">대화창</div>',
      '</section>',

      '<aside class="ui-editor" aria-label="캐릭터 편집 사이드바">',
        '<div class="ui-editor__header" aria-hidden="true"></div>',

        '<section class="ui-colors" aria-label="컬러휠과 HSB 조절기 배치">',
          '<div class="ui-wheel" role="img" aria-label="컬러휠이 들어갈 자리">',
            '<div class="ui-wheel__inner"></div>',
            '<div class="ui-wheel__diamond"></div>',
            '<div class="ui-wheel__copy">COLOR WHEEL<small>HSB</small></div>',
          '</div>',
          '<output class="ui-hex" id="ui-hex" aria-label="색상 미리보기 코드">#FFFFFF</output>',
          '<div class="ui-sliders" aria-label="HSB 슬라이더">', sliderMarkup, '</div>',
        '</section>',

        '<section class="ui-preview" aria-label="선택한 의상 카테고리 미리보기">',
          '<svg class="ui-preview__icon" viewBox="0 0 64 64" aria-hidden="true">',
            '<use id="ui-preview-use" href="#dl2-shirt"></use>',
          '</svg>',
          '<img id="ui-garment-preview" class="ui-preview__garment" src="./clothes/basic-white-tee/preview.svg?v=separates-pants-v1" alt="" aria-hidden="true">',
          '<button type="button" class="ui-preview__check" id="ui-preview-check" aria-label="베이직 화이트 반팔 티셔츠 불러오는 중" aria-pressed="false" disabled>',
            '<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M11 33 L26 48 L53 13"/></svg>',
          '</button>',
        '</section>',

        '<h2 class="ui-outfit-heading">현재 착용중</h2>',
        '<div class="ui-outfit-grid" role="group" aria-label="의상 종류 선택">',
          items.map(([id, label], index) => [
            '<button type="button" class="ui-outfit-item" data-item="', id,
              '" aria-label="', label, '" aria-pressed="', index === 0, '">',
              '<svg viewBox="0 0 64 64" aria-hidden="true"><use href="#dl2-', id, '"></use></svg>',
            '</button>'
          ].join("")).join(""),
        '</div>',
      '</aside>',

      '<nav class="ui-tabs" aria-label="편집 카테고리">',
        tabs.map(([id, label], index) => [
          '<button type="button" class="ui-tabs__button" data-tab="', id,
          '" aria-label="', label, '" aria-pressed="', index === 0, '">', label, '</button>'
        ].join("")).join(""),
      '</nav>',

      '<div class="ui-actions" aria-label="대화 및 완료">',
        '<button type="button" class="ui-action-dialog" id="ui-action-dialog">대화하기 (대화 옵션 나옴)</button>',
        '<button type="button" class="ui-action-next" id="ui-action-next">',
          '<span>완료</span>',
          '<svg viewBox="0 0 160 55" aria-hidden="true"><path d="M6 27 H151 M112 4 L152 27 L112 51"/></svg>',
        '</button>',
      '</div>',

      '<div class="ui-room-divider" aria-hidden="true"></div>',
      '<nav class="ui-rooms" aria-label="방 이동">',
        rooms.map(([id, label]) => [
          '<button type="button" class="ui-room-button" data-room="', id, '"',
            id === "dress" ? ' aria-current="page"' : '', '>', label, '</button>'
        ].join("")).join(""),
      '</nav>',
      '<p class="sr-only" role="status" id="ui-selection-status" aria-live="polite"></p>',
    '</div>'
  ].join("");

  const scene = document.getElementById("ui-scene");
  const bubble = document.getElementById("ui-dialog-text");
  const selectionStatus = document.getElementById("ui-selection-status");

  // Scale in perfect sync with the 1206 × 2622 base artboard.
  // Since only the entire artboard is scaled, image and UI coordinates stay aligned.
  function sizeUi() {
    const width = artboard.getBoundingClientRect().width;
    const height = artboard.getBoundingClientRect().height;
    if (!(width > 0 && height > 0)) return;
    const scale = Math.min(width / 1206, height / 2622);
    scene.style.transform = "scale(" + scale + ")";
  }
  window.addEventListener("resize", sizeUi);
  if ("ResizeObserver" in window) new ResizeObserver(sizeUi).observe(artboard);
  sizeUi();

  // Keep the four original room buttons; only the available panel changes.
  // No character coordinates or body rendering are changed by room navigation.
  const validRooms = new Set(rooms.map(([id]) => id));
  function setTab(tabName) {
    const isMagic = scene.dataset.room === "magic";
    const config = isMagic ? magicTabs : tabs;
    if (!config.some(([id]) => id === tabName)) return false;
    scene.dataset.magicTab = isMagic ? tabName : "";
    overlay.querySelectorAll(".ui-tabs__button").forEach(button => {
      button.setAttribute("aria-pressed", String(button.dataset.tab === tabName));
    });
    if (isMagic) {
      window.dispatchEvent(new CustomEvent("dresslab:magic-tab-change", {
        detail: { tab: tabName }
      }));
    }
    return true;
  }
  function setRoom(id) {
    if (!validRooms.has(id)) return false;
    scene.dataset.room = id;
    artboard.dataset.room = id; // Care Room portrait crop follows existing navigation.
    const tabConfig = id === "magic" ? magicTabs : tabs;
    overlay.querySelectorAll(".ui-tabs__button").forEach((button, index) => {
      const [key, label] = tabConfig[index];
      button.dataset.tab = key;
      button.textContent = label;
      button.setAttribute("aria-label", label);
    });
    setTab(tabConfig[0][0]);
    overlay.querySelectorAll(".ui-room-button").forEach(button => {
      if (button.dataset.room === id) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    });
    window.dispatchEvent(new CustomEvent("dresslab:room-change", {
      detail: { room: id }
    }));
    return true;
  }
  const requestedRoom = new URLSearchParams(window.location.search).get("room");
  setRoom(validRooms.has(requestedRoom) ? requestedRoom : "dress");
  window.DressLabRooms = {
    get current() { return scene.dataset.room; },
    setRoom,
    setTab
  };

  // Room buttons now reveal a real Magic Room shape panel. Other game rooms
  // keep their current prototype state without gaining invented game logic.
  overlay.addEventListener("click", (event) => {
    const tab = event.target.closest(".ui-tabs__button");
    if (tab) {
      setTab(tab.dataset.tab);
      selectionStatus.textContent = tab.getAttribute("aria-label") + " 카테고리 선택";
      return;
    }

    const room = event.target.closest(".ui-room-button");
    if (room) {
      setRoom(room.dataset.room);
      selectionStatus.textContent = room.textContent + " 선택";
      return;
    }

    const item = event.target.closest(".ui-outfit-item");
    if (item) {
      overlay.querySelectorAll(".ui-outfit-item").forEach(button => {
        button.setAttribute("aria-pressed", String(button === item));
      });
      document.getElementById("ui-preview-use").setAttribute("href", "#dl2-" + item.dataset.item);
      if (item.dataset.item === "none") {
        window.dressLabWardrobe?.unequipAll();
        selectionStatus.textContent = "상의와 하의 착용 해제";
      } else {
        const wearable = wearables[item.dataset.item];
        selectionStatus.textContent = wearable
          ? wearable.name + " · 체크 버튼으로 착용 변경"
          : item.getAttribute("aria-label") + " · 신규 의상 준비 중";
      }
      syncOutfitStatus();
      return;
    }

    const check = event.target.closest("#ui-preview-check");
    if (check) {
      const selected = overlay.querySelector(".ui-outfit-item[aria-pressed='true']")?.dataset.item;
      const wearable = wearables[selected];
      if (!wearable) return;
      const wardrobe = window.dressLabWardrobe;
      const state = wardrobe?.getItemState(wearable.id);
      if (!state?.ready) {
        selectionStatus.textContent = state?.error || "의상 이미지 로딩 중";
        return;
      }
      const next = !state.equipped;
      wardrobe.setEquipped(next, wearable.id);
      selectionStatus.textContent = wearable.name + (next ? " 착용" : " 벗기");
      return;
    }

    if (event.target.closest("#ui-action-dialog")) {
      bubble.textContent = bubble.textContent === "대화 옵션 영역 (준비 중)" ?
        "대화창" : "대화 옵션 영역 (준비 중)";
      return;
    }
    if (event.target.closest("#ui-action-next")) {
      bubble.textContent = "완료 기능은 아직 연결되지 않았어.";
      return;
    }

    const stepper = event.target.closest(".ui-slider-step");
    if (stepper) {
      const input = stepper.closest(".ui-slider-row").querySelector(".ui-slider-input");
      input.value = String(Math.max(Number(input.min), Math.min(Number(input.max),
        Number(input.value) + Number(stepper.dataset.adjust) * Number(input.step))));
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
  });

  // Stay in sync when the outfit becomes available after the base doll loads.
  function syncOutfitStatus() {
    const selected = overlay.querySelector(".ui-outfit-item[aria-pressed='true']")?.dataset.item;
    const wearable = wearables[selected];
    const check = document.getElementById("ui-preview-check");
    const preview = document.getElementById("ui-garment-preview");
    const state = wearable && window.dressLabWardrobe?.getItemState(wearable.id);
    check.disabled = !state?.ready;
    check.setAttribute("aria-pressed", String(Boolean(state?.equipped)));
    check.setAttribute("aria-label", wearable
      ? wearable.name + (state?.error ? " 로드 실패" : !state?.ready ? " 불러오는 중" : " 착용 전환")
      : "착용할 의상 없음");
    preview.hidden = !wearable;
    if (wearable && preview.dataset.item !== wearable.id) {
      preview.src = "./clothes/" + wearable.id + "/preview.svg?v=separates-pants-v1";
      preview.dataset.item = wearable.id;
    }
  }
  syncOutfitStatus();
  window.addEventListener("dresslab:wardrobe-ready", syncOutfitStatus);
  window.addEventListener("dresslab:wardrobe-change", syncOutfitStatus);
  window.addEventListener("dresslab:wardrobe-error", event => {
    selectionStatus.textContent = event.detail?.message || "의상 로드 실패";
    syncOutfitStatus();
  });

  // Interactive HSB handling lives in ui/color-wheel.js.
  // The picker emits dresslab:color-change for future outfit renderers.
})();
