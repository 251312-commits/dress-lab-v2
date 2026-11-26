/* Clothes are equipped in the Clothes tab. The lower slots show only the
 * current outfit and select a dye target without changing what the doll wears.
 */
(() => {
  "use strict";
  const scene = document.getElementById("ui-scene");
  const panel = scene?.querySelector(".ui-wardrobe-panel");
  const slots = scene?.querySelector(".ui-outfit-grid");
  const status = document.getElementById("ui-selection-status");
  if (!panel || !slots) return;

  const garments = [
    { id: "basic-white-tee", slot: "upper", label: "반팔 티셔츠", name: "베이직 화이트 반팔 티셔츠" },
    { id: "basic-charcoal-pants", slot: "lower", label: "긴바지", name: "베이직 차콜 긴바지" }
  ];
  const slotNames = { upper: "상의", accessory: "장식", belt: "벨트", lower: "하의", shoes: "신발", extra: "기타" };
  let selectedId = null;
  let thumbnails = new WeakMap();

  panel.innerHTML = [
    '<div class="ui-wardrobe-heading"><h2>옷</h2>',
      '<button type="button" id="ui-wardrobe-clear" aria-label="현재 착용한 옷 모두 벗기" disabled>모두 벗기</button></div>',
    '<div class="ui-wardrobe-catalog" role="group" aria-label="입거나 벗을 옷 선택">',
      garments.map(item => [
        '<button type="button" class="ui-wardrobe-card" data-wardrobe-item="', item.id,
          '" aria-label="', item.name, ' 불러오는 중" aria-pressed="false" disabled>',
          '<canvas class="ui-wardrobe-card__art" width="210" height="320" aria-hidden="true" hidden></canvas>',
          '<span class="ui-wardrobe-card__check" aria-hidden="true">',
            '<svg viewBox="0 0 24 24"><path d="M4 12 L10 18 L20 5"/></svg></span>',
          '<span class="ui-wardrobe-card__name">', item.label, '</span>',
          '<small class="ui-wardrobe-card__state">불러오는 중</small>',
        '</button>'
      ].join("")).join(""),
    '</div>'
  ].join("");

  const cards = new Map(garments.map(item =>
    [item.id, panel.querySelector('[data-wardrobe-item="' + item.id + '"]')]));
  const slotButtons = [...slots.querySelectorAll("[data-outfit-slot]")];
  const clearButton = panel.querySelector("#ui-wardrobe-clear");
  const announce = text => { if (status) status.textContent = text; };
  const stateFor = id => window.dressLabWardrobe?.getItemState(id);
  const isEquipped = id => {
    const state = id && stateFor(id);
    return Boolean(state?.ready && state.equipped);
  };

  function clearThumbnail(canvas) {
    if (!canvas.hidden) canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
    canvas.hidden = true;
    thumbnails.delete(canvas);
  }

  function paintThumbnail(canvas, state) {
    const key = state.id + ":" + state.color;
    if (thumbnails.get(canvas) === key) return;
    if (window.dressLabWardrobe.renderPreview(canvas, state.id, state.color)) {
      canvas.hidden = false;
      thumbnails.set(canvas, key);
    } else clearThumbnail(canvas);
  }

  function markSelection() {
    for (const button of slotButtons) {
      button.setAttribute("aria-pressed", String(Boolean(selectedId) && button.dataset.equippedItem === selectedId));
    }
  }

  function publishSelection(previous) {
    markSelection();
    if (selectedId !== previous) {
      window.dispatchEvent(new CustomEvent("dresslab:outfit-selection-change", {
        detail: { id: selectedId }
      }));
    }
  }

  function select(id) {
    if (!garments.some(item => item.id === id) || !isEquipped(id)) return false;
    const previous = selectedId;
    selectedId = id;
    publishSelection(previous);
    return true;
  }

  function sync() {
    const previous = selectedId;
    if (!isEquipped(selectedId)) selectedId = garments.find(item => isEquipped(item.id))?.id || null;
    let equippedCount = 0;
    for (const item of garments) {
      const state = stateFor(item.id);
      const card = cards.get(item.id);
      const canvas = card.querySelector(".ui-wardrobe-card__art");
      const ready = Boolean(state?.ready);
      card.disabled = !ready;
      card.setAttribute("aria-pressed", String(Boolean(state?.equipped && ready)));
      card.setAttribute("aria-label", item.name + (state?.error ? " 로드 실패" : !ready
        ? " 불러오는 중" : state.equipped ? " 벗기" : " 입기"));
      card.querySelector(".ui-wardrobe-card__state").textContent = state?.error ? "로드 실패" : !ready ? "불러오는 중" : "";
      if (ready) paintThumbnail(canvas, state);
      else clearThumbnail(canvas);
      if (ready && state.equipped) equippedCount++;
    }
    for (const button of slotButtons) {
      const slot = button.dataset.outfitSlot;
      const item = garments.find(garment => garment.slot === slot && isEquipped(garment.id));
      const canvas = button.querySelector(".ui-outfit-item__art");
      button.disabled = !item;
      if (item) {
        const state = stateFor(item.id);
        button.dataset.equippedItem = item.id;
        button.setAttribute("aria-label", item.name + " · 염색할 옷 선택");
        paintThumbnail(canvas, state);
      } else {
        delete button.dataset.equippedItem;
        button.setAttribute("aria-label", (slotNames[slot] || "의상") + " 비어 있음");
        clearThumbnail(canvas);
      }
    }
    clearButton.disabled = equippedCount === 0;
    publishSelection(previous);
  }

  panel.addEventListener("click", event => {
    if (scene.dataset.room !== "dress" || scene.dataset.dressTab !== "clothes") return;
    const card = event.target.closest("[data-wardrobe-item]");
    if (card) {
      const id = card.dataset.wardrobeItem;
      const state = stateFor(id);
      if (!state?.ready) return;
      const next = !state.equipped;
      if (!window.dressLabWardrobe.setEquipped(next, id)) return;
      if (next) select(id);
      sync();
      announce(state.name + (next ? " 착용" : " 벗기"));
    } else if (event.target.closest("#ui-wardrobe-clear")) {
      window.dressLabWardrobe?.unequipAll();
      sync();
      announce("상의와 하의 착용 해제");
    }
  });
  slots.addEventListener("click", event => {
    if (scene.dataset.room !== "dress") return;
    const button = event.target.closest("[data-outfit-slot]");
    if (!button || button.disabled || !select(button.dataset.equippedItem)) return;
    announce(stateFor(selectedId).name + " 염색 선택");
  });
  window.addEventListener("dresslab:wardrobe-ready", () => {
    thumbnails = new WeakMap();
    sync();
  });
  window.addEventListener("dresslab:wardrobe-change", sync);
  window.addEventListener("dresslab:wardrobe-error", sync);
  window.DressLabOutfits = { get selectedId() { return selectedId; }, select, sync };
  sync();
})();
