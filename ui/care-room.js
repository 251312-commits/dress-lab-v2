/* Care Room controls. Facial treatment is owned by facial-care.js;
   this module owns tabs, tool selection and the three-slot sliding shelf. */
(() => {
  "use strict";
  const scene = document.getElementById("ui-scene");
  if (!scene) return;
  const tabs = [["hair", "헤어"], ["facial", "페이셜"], ["relaxation", "릴랙세이션"]];
  const facialTools = [
    ["cleanser", "클렌저"], ["towel", "물수건"], ["serum", "세럼"],
    ["cream", "크림"], ["roller", "롤러"]
  ].map(([id, label]) => ({ id, label,
    image: "./assets/care/facial/" + (id === "roller" ? "roller-v2" : id) + ".png" }));
  const placeholders = ["1", "2", "3"].map(id => ({ id, label: "도구 " + id }));
  const initialFacialState = window.DressLabFacialCare?.getState?.() || null;
  const initialFacialTool = facialTools.some(tool => tool.id === initialFacialState?.selectedTool)
    ? initialFacialState.selectedTool : "cleanser";
  const selectionByTab = new Map([["hair", null], ["facial", initialFacialTool], ["relaxation", null]]);
  const scrollByTab = new Map(tabs.map(([key]) => [key, 0]));
  let selectedTab = "hair";
  let dialogueOpen = false;
  let facialState = initialFacialState;
  let drag = null;
  let suppressClickUntil = 0;

  const careRoom = document.createElement("section");
  careRoom.className = "ui-care-room";
  careRoom.setAttribute("aria-label", "케어룸 작업 화면");
  careRoom.innerHTML = [
    '<div class="ui-facial-overall" role="progressbar" aria-label="페이셜 전체 케어" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" aria-valuetext="0%" hidden>',
      '<span class="ui-facial-overall__track" aria-hidden="true"><span class="ui-facial-overall__fill"></span></span>',
      '<span class="ui-facial-overall__value" aria-hidden="true">0%</span>',
    '</div>',
    '<nav class="ui-care-tabs" aria-label="케어 종류">',
      tabs.map(([key, label], index) => '<button type="button" class="ui-care-tab" data-care-tab="' + key +
        '" aria-pressed="' + (index === 0) + '">' + label + '</button>').join(""),
    '</nav>',
    '<section class="ui-care-dialog" aria-label="케어룸 대화창">',
      '<svg viewBox="0 0 1129 420" preserveAspectRatio="none" aria-hidden="true">',
        '<path d="M4 4 H1125 V373 H648 L565 417 L481 373 H4 Z"></path>',
      '</svg>',
      '<div class="ui-care-dialog__text" id="ui-care-dialog-text" aria-live="polite">대화창</div>',
    '</section>',
    '<button class="ui-care-talk" id="ui-care-talk" type="button">대화</button>',
    '<button class="ui-care-basin" type="button" aria-label="물수건 적시기" hidden>',
      '<img src="./assets/care/facial/basin.png" alt="" draggable="false">',
      '<span class="ui-care-basin__water" aria-hidden="true"></span>',
    '</button>',
    '<div class="ui-care-shelf" aria-label="케어 도구 선반">',
      '<div class="ui-care-shelf__line" aria-hidden="true"></div>',
      '<div class="ui-care-tools" id="ui-care-tools" role="group" aria-label="케어 도구"></div>',
      '<button type="button" class="ui-care-shelf-arrow ui-care-shelf-arrow--previous" data-shelf-direction="-1" aria-label="이전 도구 보기" aria-controls="ui-care-tools" hidden><span aria-hidden="true">‹</span></button>',
      '<button type="button" class="ui-care-shelf-arrow ui-care-shelf-arrow--next" data-shelf-direction="1" aria-label="다음 도구 보기" aria-controls="ui-care-tools" hidden><span aria-hidden="true">›</span></button>',
      '<div class="ui-care-shelf-pages" aria-hidden="true" hidden></div>',
    '</div>'
  ].join("");
  scene.appendChild(careRoom);

  const status = document.getElementById("ui-selection-status");
  const overall = careRoom.querySelector(".ui-facial-overall");
  const overallValue = careRoom.querySelector(".ui-facial-overall__value");
  const dialogBubble = careRoom.querySelector(".ui-care-dialog");
  const dialog = careRoom.querySelector("#ui-care-dialog-text");
  const talk = careRoom.querySelector("#ui-care-talk");
  const basin = careRoom.querySelector(".ui-care-basin");
  const shelf = careRoom.querySelector(".ui-care-shelf");
  const viewport = careRoom.querySelector(".ui-care-tools");
  const previous = careRoom.querySelector('[data-shelf-direction="-1"]');
  const next = careRoom.querySelector('[data-shelf-direction="1"]');
  const pages = careRoom.querySelector(".ui-care-shelf-pages");
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const currentTools = () => selectedTab === "facial" ? facialTools : placeholders;
  const maxScroll = () => Math.max(0, viewport.scrollWidth - viewport.clientWidth);
  const pageOffsets = () => Array.from({ length: Math.ceil(currentTools().length / 3) },
    (_, index) => Math.min(maxScroll(), index * viewport.clientWidth));
  function currentPage() {
    return pageOffsets().reduce((nearest, offset, index, offsets) =>
      Math.abs(offset - viewport.scrollLeft) < Math.abs(offsets[nearest] - viewport.scrollLeft)
        ? index : nearest, 0);
  }

  function scrollShelf(left, smooth = true) {
    viewport.scrollTo({ left: Math.max(0, Math.min(maxScroll(), left)),
      behavior: smooth && !reducedMotion.matches ? "smooth" : "auto" });
  }
  function revealTool(button, smooth = true) {
    if (!button) return;
    const slot = button.parentElement;
    const start = slot.offsetLeft;
    const end = start + slot.offsetWidth;
    if (start < viewport.scrollLeft - 1) scrollShelf(start, smooth);
    else if (end > viewport.scrollLeft + viewport.clientWidth + 1) {
      scrollShelf(end - viewport.clientWidth, smooth);
    }
  }
  function updateShelfControls() {
    const maximum = maxScroll();
    const overflow = currentTools().length > 3 && maximum > 1;
    previous.hidden = next.hidden = pages.hidden = !overflow;
    previous.disabled = viewport.scrollLeft <= 2;
    next.disabled = viewport.scrollLeft >= maximum - 2;
    const active = currentPage();
    pages.querySelectorAll(".ui-care-shelf-page").forEach((dot, index) => {
      dot.dataset.active = String(index === active);
    });
    // A hidden room has zero dimensions; keep its last usable shelf position.
    if (viewport.clientWidth > 0) scrollByTab.set(selectedTab, viewport.scrollLeft);
  }
  function syncToolSelection() {
    const selected = selectionByTab.get(selectedTab);
    viewport.querySelectorAll(".ui-care-tool").forEach(button => {
      const id = button.dataset.careTool;
      const tool = currentTools().find(item => item.id === id);
      button.setAttribute("aria-pressed", String(id === selected));
      button.dataset.recommended = String(selectedTab === "facial" && id === facialState?.recommendedTool);
      button.setAttribute("aria-label", tool.label + (selectedTab === "facial" ? "" : " · 준비 중"));
    });
    syncBasin();
  }
  function syncBasin() {
    basin.hidden = scene.dataset.room !== "care" || selectedTab !== "facial" ||
      selectionByTab.get("facial") !== "towel";
    basin.dataset.wet = String(Boolean(facialState?.towelWet));
  }
  function wetTowel() {
    if (basin.hidden || scene.dataset.room !== "care" || selectedTab !== "facial" ||
        selectionByTab.get("facial") !== "towel" || facialState?.towelWet) return false;
    window.dispatchEvent(new CustomEvent("dresslab:facial-towel-wet"));
    return true;
  }
  function wetTowelAlongDrag(gesture, x, y) {
    if (basin.hidden || gesture.tool !== "towel") return false;
    const rect = basin.getBoundingClientRect();
    if (!(rect.width > 0 && rect.height > 0)) return false;
    const cx = rect.left + rect.width * .495, cy = rect.top + rect.height * .425;
    const rx = rect.width * .39, ry = rect.height * .17;
    const ax = ((gesture.waterX ?? gesture.x) - cx) / rx;
    const ay = ((gesture.waterY ?? gesture.y) - cy) / ry;
    const dx = (x - cx) / rx - ax, dy = (y - cy) / ry - ay;
    const length = dx * dx + dy * dy;
    const t = length ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / length)) : 0;
    // Check the segment too: a fast captured stroke can cross the water
    // between pointer events without ever targeting the basin DOM node.
    if ((ax + dx * t) ** 2 + (ay + dy * t) ** 2 <= 1) wetTowel();
    gesture.waterX = x;
    gesture.waterY = y;
    return ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;
  }
  function syncOverall() {
    const value = Number.isFinite(facialState?.overallProgress)
      ? Math.max(0, Math.min(1, facialState.overallProgress)) : 0;
    const percent = value >= 1 ? 100 : Math.min(99, Math.floor(value * 100 + 1e-8));
    overall.style.setProperty("--facial-progress", value);
    overall.setAttribute("aria-valuenow", String(percent));
    overall.setAttribute("aria-valuetext", percent + "%");
    overallValue.textContent = percent + "%";
    overall.hidden = selectedTab !== "facial";
  }
  function syncDialog() {
    const isFacial = selectedTab === "facial";
    careRoom.dataset.careTab = selectedTab;
    dialogBubble.hidden = isFacial;
    talk.textContent = isFacial ? "다시 케어" : "대화";
    talk.setAttribute("aria-label", isFacial ? "페이셜 케어 다시 시작" : "케어 안내 보기");
    const message = isFacial ? "" : dialogueOpen ? "대화 기능 준비 중" : "대화창";
    if (dialog.textContent !== message) dialog.textContent = message;
    syncOverall();
    syncBasin();
  }
  function renderTools() {
    const tools = currentTools();
    shelf.dataset.sliding = String(tools.length > 3);
    viewport.setAttribute("aria-label", tabs.find(([id]) => id === selectedTab)[1] + " 도구");
    viewport.innerHTML = tools.map(tool => [
      '<div class="ui-care-tool-slot">',
        '<button type="button" class="ui-care-tool', tool.image ? ' ui-care-tool--illustrated' : '',
          '" data-care-tool="', tool.id, '" aria-pressed="false">',
          tool.image
            ? '<span class="ui-care-tool__art"><img src="' + tool.image + '" alt="" draggable="false"></span><span class="ui-care-tool__label">' + tool.label + '</span>'
            : tool.label,
        '</button>',
      '</div>'
    ].join("")).join("");
    const pageCount = Math.ceil(tools.length / 3);
    pages.innerHTML = tools.length > 3
      ? '<span class="ui-care-shelf-page"></span>'.repeat(pageCount) : "";
    viewport.scrollLeft = scrollByTab.get(selectedTab) || 0;
    syncToolSelection();
    updateShelfControls();
  }
  function setCareTool(id, options = {}) {
    if (id !== null && !currentTools().some(tool => tool.id === id)) return false;
    const changed = selectionByTab.get(selectedTab) !== id;
    selectionByTab.set(selectedTab, id);
    syncToolSelection();
    const button = Array.from(viewport.querySelectorAll(".ui-care-tool")).find(item => item.dataset.careTool === id);
    if (options.reveal !== false) revealTool(button);
    if (!changed) return true;
    if (status) status.textContent = id
      ? currentTools().find(tool => tool.id === id).label + " 선택" + (selectedTab === "facial" ? "" : " · 기능 준비 중")
      : "도구 선택 해제";
    if (options.emit !== false) {
      window.dispatchEvent(new CustomEvent("dresslab:care-tool-select", {
        detail: { tab: selectedTab, tool: id, previewOnly: selectedTab !== "facial" }
      }));
    }
    return true;
  }
  function setCareTab(key) {
    if (!tabs.some(([id]) => id === key)) return false;
    finishGesture(null, true);
    if (selectedTab !== key) {
      if (viewport.clientWidth > 0) scrollByTab.set(selectedTab, viewport.scrollLeft);
      selectedTab = key;
      renderTools();
    }
    careRoom.querySelectorAll(".ui-care-tab").forEach(button => {
      button.setAttribute("aria-pressed", String(button.dataset.careTab === selectedTab));
    });
    syncDialog();
    if (status) status.textContent = tabs.find(([id]) => id === key)[1] + " 탭 선택";
    window.dispatchEvent(new CustomEvent("dresslab:care-tab-change", { detail: { tab: key } }));
    return true;
  }

  viewport.addEventListener("scroll", updateShelfControls, { passive: true });
  viewport.addEventListener("focusin", event => {
    if (!drag) revealTool(event.target.closest(".ui-care-tool"));
  });
  viewport.addEventListener("keydown", event => {
    const buttons = Array.from(viewport.querySelectorAll(".ui-care-tool"));
    const index = buttons.indexOf(event.target);
    if (index < 0) return;
    if (selectedTab === "facial" && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      if (!event.repeat) {
        finishGesture(null, true);
        const tool = buttons[index].dataset.careTool;
        setCareTool(tool, { reveal: false });
        window.dispatchEvent(new CustomEvent("dresslab:facial-tool-key", { detail: { tool } }));
      }
      return;
    }
    let target;
    if (event.key === "ArrowRight") target = Math.min(buttons.length - 1, index + 1);
    else if (event.key === "ArrowLeft") target = Math.max(0, index - 1);
    else if (event.key === "Home") target = 0;
    else if (event.key === "End") target = buttons.length - 1;
    else return;
    event.preventDefault();
    finishGesture(null, true);
    buttons[target].focus({ preventScroll: true });
    revealTool(buttons[target]);
  });
  viewport.addEventListener("keyup", event => {
    if (selectedTab === "facial" && (event.key === "Enter" || event.key === " ") &&
        event.target.closest(".ui-care-tool")) event.preventDefault();
  });
  viewport.addEventListener("dragstart", event => event.preventDefault());
  basin.addEventListener("dragstart", event => event.preventDefault());
  basin.addEventListener("keydown", event => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    if (!event.repeat) { finishGesture(null, true); wetTowel(); }
  });
  basin.addEventListener("keyup", event => {
    if (event.key === "Enter" || event.key === " ") event.preventDefault();
  });
  careRoom.addEventListener("pointerdown", () => { suppressClickUntil = 0; }, true);

  function emitToolDrag(gesture, phase, event) {
    const clientX = Number.isFinite(event?.clientX) ? event.clientX : gesture.lastX;
    const clientY = Number.isFinite(event?.clientY) ? event.clientY : gesture.lastY;
    const overBasin = phase !== "cancel" && wetTowelAlongDrag(gesture, clientX, clientY);
    window.dispatchEvent(new CustomEvent("dresslab:facial-tool-drag", {
      detail: { phase, tool: gesture.tool, pointerId: gesture.id, clientX, clientY, overBasin }
    }));
  }
  function capturePointer(pointerId) {
    try { viewport.setPointerCapture(pointerId); } catch (_) { /* Window listeners remain available. */ }
  }
  // A facial gesture chooses one axis after 8 screen pixels. Horizontal pans
  // never become treatment strokes; vertical tool drags stay captured to us.
  viewport.addEventListener("pointerdown", event => {
    if (drag || event.isPrimary === false || (event.button !== undefined && event.button !== 0)) return;
    const facial = selectedTab === "facial";
    if (!facial && (event.pointerType !== "mouse" || maxScroll() <= 1)) return;
    const button = event.target.closest(".ui-care-tool");
    drag = { id: event.pointerId, facial, tool: facial ? button?.dataset.careTool : null,
      x: event.clientX, y: event.clientY, lastX: event.clientX, lastY: event.clientY,
      left: viewport.scrollLeft, axis: null,
      scale: viewport.getBoundingClientRect().width / viewport.clientWidth || 1 };
    if (facial) {
      viewport.classList.add("is-gesturing");
      capturePointer(event.pointerId);
    }
  });
  window.addEventListener("pointermove", event => {
    if (!drag || drag.id !== event.pointerId) return;
    drag.lastX = event.clientX;
    drag.lastY = event.clientY;
    const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
    if (!drag.axis) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) < (drag.facial ? 8 : 6)) return;
      // The basin sits diagonally above the towel. Treat a deliberate upward
      // diagonal as pickup, while a mostly horizontal swipe remains a pan.
      const upwardPickup = drag.facial && drag.tool && dy <= -6 && Math.abs(dy) >= Math.abs(dx) * .55;
      drag.axis = upwardPickup ? "tool" : !drag.facial || Math.abs(dx) >= Math.abs(dy)
        ? "pan" : drag.tool ? "tool" : "ignore";
      if (drag.axis === "pan") {
        viewport.classList.add("is-dragging");
        capturePointer(event.pointerId);
      } else if (drag.axis === "tool") {
        viewport.classList.add("is-tool-dragging");
        setCareTool(drag.tool, { reveal: false });
        event.preventDefault();
        emitToolDrag(drag, "start", event);
        return;
      }
    }
    event.preventDefault();
    if (drag.axis === "pan") viewport.scrollLeft = drag.left - dx / drag.scale;
    else if (drag.axis === "tool") emitToolDrag(drag, "move", event);
  }, { passive: false });
  function finishGesture(event, cancelled = false) {
    if (!drag || (event && drag.id !== event.pointerId)) return;
    const gesture = drag;
    drag = null;
    viewport.classList.remove("is-gesturing", "is-dragging", "is-tool-dragging");
    try {
      if (viewport.hasPointerCapture(gesture.id)) viewport.releasePointerCapture(gesture.id);
    } catch (_) { /* A browser may already have cancelled the capture. */ }
    if (gesture.axis === "tool") emitToolDrag(gesture, cancelled ? "cancel" : "end", event);
    else if (!cancelled && gesture.facial && !gesture.axis && gesture.tool &&
        Math.hypot((event?.clientX ?? gesture.lastX) - gesture.x,
          (event?.clientY ?? gesture.lastY) - gesture.y) < 8) {
      // Captured pointer taps may target the shelf instead of its button.
      setCareTool(gesture.tool, { reveal: false });
    }
    if (gesture.facial || gesture.axis || cancelled) suppressClickUntil = performance.now() + 400;
    if (gesture.axis === "pan" && viewport.clientWidth > 0) {
      const slotWidth = viewport.clientWidth / 3;
      scrollShelf(Math.round(viewport.scrollLeft / slotWidth) * slotWidth, !cancelled);
    }
  }
  window.addEventListener("pointerup", event => finishGesture(event));
  window.addEventListener("pointercancel", event => finishGesture(event, true));
  viewport.addEventListener("lostpointercapture", event => {
    if (event.target === viewport) finishGesture(event, true);
  });
  viewport.addEventListener("pointerleave", event => {
    if (drag && !drag.facial && !drag.axis) finishGesture(event, true);
  });
  window.addEventListener("blur", () => finishGesture(null, true));
  window.addEventListener("pagehide", () => finishGesture(null, true));
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) finishGesture(null, true);
  });
  careRoom.addEventListener("click", event => {
    if (performance.now() < suppressClickUntil && event.detail !== 0) {
      event.preventDefault();
      event.stopPropagation();
    }
  }, true);

  careRoom.addEventListener("click", event => {
    const tab = event.target.closest(".ui-care-tab");
    if (tab) return void setCareTab(tab.dataset.careTab);
    const arrow = event.target.closest("[data-shelf-direction]");
    if (arrow) {
      finishGesture(null, true);
      const offsets = pageOffsets();
      const index = Math.max(0, Math.min(offsets.length - 1,
        currentPage() + Number(arrow.dataset.shelfDirection)));
      return void scrollShelf(offsets[index]);
    }
    const tool = event.target.closest(".ui-care-tool");
    if (tool) {
      finishGesture(null, true);
      const id = tool.dataset.careTool;
      setCareTool(selectedTab !== "facial" && selectionByTab.get(selectedTab) === id ? null : id);
      return;
    }
    if (event.target.closest(".ui-care-basin")) {
      finishGesture(null, true);
      wetTowel();
      return;
    }
    if (event.target.closest("#ui-care-talk")) {
      if (selectedTab === "facial") {
        finishGesture(null, true);
        window.dispatchEvent(new CustomEvent("dresslab:facial-reset"));
      } else {
        dialogueOpen = !dialogueOpen;
        syncDialog();
      }
    }
  });
  window.addEventListener("dresslab:facial-state", event => {
    facialState = event.detail || null;
    // Recommendations are visual hints only. Never change or reveal a tool
    // in response to treatment state; the user's selection stays in place.
    if (selectedTab === "facial") {
      syncToolSelection();
      syncOverall();
    }
  });
  window.addEventListener("dresslab:room-change", () => {
    finishGesture(null, true);
    syncBasin();
    requestAnimationFrame(updateShelfControls);
  });
  window.addEventListener("resize", () => {
    finishGesture(null, true);
    updateShelfControls();
  });
  if ("ResizeObserver" in window) new ResizeObserver(updateShelfControls).observe(viewport);
  renderTools();
  syncDialog();

  window.DressLabCareRoom = {
    setTab: setCareTab,
    setTool: setCareTool,
    get currentTab() { return selectedTab; },
    get selectedTool() { return selectionByTab.get(selectedTab); }
  };
})();
