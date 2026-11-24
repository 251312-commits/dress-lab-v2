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
  ].map(([id, label]) => ({ id, label, image: "./assets/care/facial/" + id + ".png" }));
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
  const dialogBubble = careRoom.querySelector(".ui-care-dialog");
  const dialog = careRoom.querySelector("#ui-care-dialog-text");
  const talk = careRoom.querySelector("#ui-care-talk");
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
  }
  function syncDialog() {
    const isFacial = selectedTab === "facial";
    careRoom.dataset.careTab = selectedTab;
    dialogBubble.hidden = isFacial;
    talk.textContent = isFacial ? "다시 케어" : "대화";
    talk.setAttribute("aria-label", isFacial ? "페이셜 케어 다시 시작" : "케어 안내 보기");
    const message = isFacial ? "" : dialogueOpen ? "대화 기능 준비 중" : "대화창";
    if (dialog.textContent !== message) dialog.textContent = message;
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
  viewport.addEventListener("focusin", event => revealTool(event.target.closest(".ui-care-tool")));
  viewport.addEventListener("keydown", event => {
    const buttons = Array.from(viewport.querySelectorAll(".ui-care-tool"));
    const index = buttons.indexOf(event.target);
    if (index < 0) return;
    let target;
    if (event.key === "ArrowRight") target = Math.min(buttons.length - 1, index + 1);
    else if (event.key === "ArrowLeft") target = Math.max(0, index - 1);
    else if (event.key === "Home") target = 0;
    else if (event.key === "End") target = buttons.length - 1;
    else return;
    event.preventDefault();
    buttons[target].focus({ preventScroll: true });
    revealTool(buttons[target]);
  });
  // Touch uses native momentum scrolling. Mouse dragging needs coordinates
  // converted back through the artboard scale (client pixels ≠ shelf pixels).
  viewport.addEventListener("pointerdown", event => {
    if (event.pointerType !== "mouse" || event.button !== 0 || maxScroll() <= 1) return;
    drag = { id: event.pointerId, x: event.clientX, left: viewport.scrollLeft, moved: false,
      scale: viewport.getBoundingClientRect().width / viewport.clientWidth || 1 };
  });
  viewport.addEventListener("pointermove", event => {
    if (!drag || drag.id !== event.pointerId) return;
    const delta = event.clientX - drag.x;
    if (!drag.moved && Math.abs(delta) < 6) return;
    if (!drag.moved) {
      drag.moved = true;
      viewport.classList.add("is-dragging");
      viewport.setPointerCapture(event.pointerId);
    }
    event.preventDefault();
    viewport.scrollLeft = drag.left - delta / drag.scale;
  });
  function finishDrag(event) {
    if (!drag || drag.id !== event.pointerId) return;
    const moved = drag.moved;
    drag = null;
    viewport.classList.remove("is-dragging");
    if (viewport.hasPointerCapture(event.pointerId)) viewport.releasePointerCapture(event.pointerId);
    if (moved) {
      suppressClickUntil = performance.now() + 350;
      const slotWidth = viewport.clientWidth / 3;
      scrollShelf(Math.round(viewport.scrollLeft / slotWidth) * slotWidth);
    }
  }
  viewport.addEventListener("pointerup", finishDrag);
  viewport.addEventListener("pointercancel", finishDrag);
  viewport.addEventListener("lostpointercapture", finishDrag);
  viewport.addEventListener("pointerleave", event => { if (drag && !drag.moved) finishDrag(event); });
  viewport.addEventListener("click", event => {
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
      const offsets = pageOffsets();
      const index = Math.max(0, Math.min(offsets.length - 1,
        currentPage() + Number(arrow.dataset.shelfDirection)));
      return void scrollShelf(offsets[index]);
    }
    const tool = event.target.closest(".ui-care-tool");
    if (tool) {
      const id = tool.dataset.careTool;
      setCareTool(selectedTab !== "facial" && selectionByTab.get(selectedTab) === id ? null : id);
      return;
    }
    if (event.target.closest("#ui-care-talk")) {
      if (selectedTab === "facial") {
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
    }
  });
  window.addEventListener("dresslab:room-change", () => requestAnimationFrame(updateShelfControls));
  window.addEventListener("resize", updateShelfControls);
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
