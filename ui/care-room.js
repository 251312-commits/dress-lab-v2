/* Care Room sketch UI for Dress Lab V2.
   Visual and selection-state scaffold only: no hair, facial or
   relaxation treatment is applied to the existing character. */
(() => {
  "use strict";

  const scene = document.getElementById("ui-scene");
  if (!scene) return;

  const tabs = [
    ["hair", "헤어"],
    ["facial", "페이셜"],
    ["relaxation", "릴랙세이션"]
  ];
  const toolIds = ["1", "2", "3"];
  const selectionByTab = new Map(tabs.map(([key]) => [key, null]));
  let selectedTab = "hair";
  let dialogueOpen = false;

  const careRoom = document.createElement("section");
  careRoom.className = "ui-care-room";
  careRoom.setAttribute("aria-label", "케어룸 작업 화면");
  careRoom.innerHTML = [
    '<nav class="ui-care-tabs" aria-label="케어 종류">',
      tabs.map(([key, label], index) => [
        '<button type="button" class="ui-care-tab" data-care-tab="', key,
          '" aria-pressed="', index === 0, '">', label, '</button>'
      ].join("")).join(""),
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
      '<div class="ui-care-tools" role="group" aria-label="케어 도구 세 개">',
        toolIds.map(id => [
          '<button type="button" class="ui-care-tool" data-care-tool="', id,
          '" aria-pressed="false" aria-label="도구 ', id, '">도구', id, '</button>'
        ].join("")).join(""),
      '</div>',
    '</div>'
  ].join("");
  scene.appendChild(careRoom);

  const status = document.getElementById("ui-selection-status");
  const dialog = careRoom.querySelector("#ui-care-dialog-text");

  function syncToolSelection() {
    const selected = selectionByTab.get(selectedTab);
    careRoom.querySelectorAll(".ui-care-tool").forEach(button => {
      button.setAttribute("aria-pressed",
        String(button.dataset.careTool === selected));
    });
  }
  function setCareTab(key) {
    if (!tabs.some(([id]) => id === key)) return false;
    selectedTab = key;
    careRoom.querySelectorAll(".ui-care-tab").forEach(button => {
      button.setAttribute("aria-pressed",
        String(button.dataset.careTab === selectedTab));
    });
    syncToolSelection();
    if (status) {
      status.textContent = tabs.find(([id]) => id === key)[1] + " 탭 선택";
    }
    window.dispatchEvent(new CustomEvent("dresslab:care-tab-change", {
      detail: { tab: key }
    }));
    return true;
  }

  careRoom.addEventListener("click", event => {
    const tab = event.target.closest(".ui-care-tab");
    if (tab) {
      setCareTab(tab.dataset.careTab);
      return;
    }

    const tool = event.target.closest(".ui-care-tool");
    if (tool) {
      // Only a selection indication: real care steps need their own assets
      // and game-state implementation.
      const next = selectionByTab.get(selectedTab) === tool.dataset.careTool
        ? null : tool.dataset.careTool;
      selectionByTab.set(selectedTab, next);
      syncToolSelection();
      const label = tabs.find(([id]) => id === selectedTab)[1];
      if (status) status.textContent = label + " · 도구 " +
        (next || "선택 해제") + " (도구 기능 준비 중)";
      window.dispatchEvent(new CustomEvent("dresslab:care-tool-select", {
        detail: { tab: selectedTab, tool: next, previewOnly: true }
      }));
      return;
    }

    if (event.target.closest("#ui-care-talk")) {
      dialogueOpen = !dialogueOpen;
      dialog.textContent = dialogueOpen
        ? "대화 기능 준비 중"
        : "대화창";
    }
  });

  // Room navigation owns this state; the Care Room only follows it.
  // The artboard flag is set in layout.js, including for ?room=care.
  window.DressLabCareRoom = {
    setTab: setCareTab,
    get currentTab() { return selectedTab; },
    get selectedTool() { return selectionByTab.get(selectedTab); }
  };
})();
