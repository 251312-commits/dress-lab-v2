/* Free facial care. Drag tools from the shelf to apply; rub the face directly
 * to spread existing products. No dose quota, stage lock or automatic selection.
 * The original doll, skin color, body shape, eyes and clothing stay independent.
 */
(() => {
  "use strict";
  const canvas = document.getElementById("character");
  if (!canvas) return;
  const STORAGE_KEY = "dresslab-v2:facial-care:v4";
  const PREVIOUS_STORAGE_KEYS = ["dresslab-v2:facial-care:v3", "dresslab-v2:facial-care:v2"];
  const TOOLS = ["cleanser", "towel", "serum", "cream", "roller"];
  const PRODUCTS = ["cleanser", "serum", "cream"];
  const DROP_INTERVAL_MS = 300;
  // Sprite size is visual only. Every dose still has mass 1 and the same
  // spreading, absorption, wiping and treatment rates as before.
  const DROP_RADIUS = { cleanser: 26, serum: 18, cream: 26 };
  const WORK_TARGETS = { cleanser: 2.5, towel: 2, serum: 2.5, cream: 2.5, roller: 3 };
  // The finish check and renderer share the same visibility thresholds.
  const VISIBLE = { dot: 0.003, film: 0.0005, dirt: 0.005 };
  const FACE = { x: 329, y: 719, rx: 190, ry: 200 };
  const EYES = [{ x: 237, y: 800 }, { x: 422, y: 800 }];
  const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));
  const sum = values => values.reduce((total, value) => total + value, 0);
  const inEllipse = (x, y, cx, cy, rx, ry) =>
    ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;
  const isFace = (x, y) => Number.isFinite(x) && Number.isFinite(y) &&
    inEllipse(x, y, FACE.x, FACE.y, FACE.rx, FACE.ry) &&
    !EYES.some(eye => inEllipse(x, y, eye.x, eye.y, 70, 55));
  // A cloth is wider than its pointer. Its centre may pass an eye or the face
  // outline while its edge still wipes valid skin; eye pixels are never drawn.
  const isTowelContact = (x, y) => Number.isFinite(x) && Number.isFinite(y) &&
    inEllipse(x, y, FACE.x, FACE.y, FACE.rx + 85, FACE.ry + 85);
  const brushWeight = (distance, inner, outer) =>
    clamp((outer - distance) / (outer - inner), 0, 1);
  const CELLS = [];
  for (let y = 547; y <= 903; y += 28) {
    for (let x = 157; x <= 517; x += 28) {
      if (isFace(x, y)) CELLS.push({ x, y });
    }
  }
  const blankField = () => Array(CELLS.length).fill(0);
  const blankProducts = () => Object.fromEntries(PRODUCTS.map(id =>
    [id, { dots: [], film: blankField(), work: 0, absorbed: 0 }]));
  const materialAmount = product => sum(product.film) + sum(product.dots.map(dot => dot.amount));
  const INITIAL_DIRT = CELLS.filter((_, index) => index % 11 === 3).length * 0.7;
  const validField = (field, max = 1) => Array.isArray(field) && field.length === CELLS.length &&
    field.every(value => Number.isFinite(value) && value >= 0 && value <= max);
  function neighbors(point, radius) {
    return CELLS.map((cell, index) => ({ index,
      weight: Math.max(0, 1 - Math.hypot(cell.x - point.x, cell.y - point.y) / radius) }))
      .filter(cell => cell.weight > 0);
  }

  class FacialCare {
    constructor() {
      this.rig = null;
      this.bodyShape = null;
      this.selectedTool = "cleanser";
      this.active = false;
      this.pointerId = null;
      this.stroke = null;
      this.frame = 0;
      this.keyboardIndex = 0;
      this.originalLabel = canvas.getAttribute("aria-label");
      this.clearMaterials();
      this.restore();
      this.cursor = document.createElement("img");
      this.cursor.className = "ui-facial-cursor";
      this.cursor.alt = "";
      this.cursor.hidden = true;
      this.cursor.draggable = false;
      this.cursor.setAttribute("aria-hidden", "true");
      document.getElementById("artboard")?.appendChild(this.cursor);

      canvas.addEventListener("pointerdown", event => this.pointerDown(event));
      canvas.addEventListener("pointermove", event => this.pointerMove(event));
      ["pointerup", "pointercancel", "lostpointercapture"].forEach(type =>
        canvas.addEventListener(type, event => this.pointerUp(event)));
      canvas.addEventListener("keydown", event => this.keyDown(event));
      window.addEventListener("blur", () => this.endStroke());
      window.addEventListener("pagehide", () => { this.endStroke(); this.save(); });
      document.addEventListener("visibilitychange", () => {
        if (document.hidden) { this.endStroke(); this.save(); }
      });
      window.addEventListener("dresslab:room-change", () => this.syncActive());
      window.addEventListener("dresslab:care-tab-change", () => this.syncActive());
      window.addEventListener("dresslab:care-tool-select", event => {
        if (event.detail?.tab !== "facial" || !TOOLS.includes(event.detail.tool)) return;
        this.endStroke();
        this.chooseTool(event.detail.tool);
        this.keyboardIndex = 0;
        this.save();
        this.publish();
      });
      window.addEventListener("dresslab:facial-reset", () => this.reset());
      window.addEventListener("dresslab:facial-tool-drag", event => this.toolDrag(event.detail));
      window.addEventListener("dresslab:facial-tool-key", event => this.toolKey(event.detail?.tool));
      window.addEventListener("dresslab:facial-towel-wet", () => this.wetTowel());
    }

    clearMaterials() {
      this.products = blankProducts();
      this.paintOrder = PRODUCTS.slice();
      this.dirt = CELLS.map((_, index) => index % 11 === 3 ? 0.7 : 0);
      this.hydration = blankField();
      this.massage = blankField();
      this.lastUsed = null;
      this.rollerWork = 0;
      this.careWork = Object.fromEntries(TOOLS.map(id => [id, 0]));
      this.towelWet = false;
    }

    bind(rig, bodyShape) {
      if (this.rig && this.rig !== rig) this.rig.facialCare = null;
      this.rig = rig;
      this.bodyShape = bodyShape;
      rig.facialCare = this;
      this.syncActive();
      return this;
    }

    restore() {
      try {
        const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ||
          PREVIOUS_STORAGE_KEYS.map(key => localStorage.getItem(key)).find(Boolean));
        if (![2, 3, 4].includes(saved?.version) || !saved.products || !validField(saved.dirt) ||
            !validField(saved.hydration) || !validField(saved.massage)) return;
        for (const id of PRODUCTS) {
          const product = saved.products[id];
          if (!product || !Array.isArray(product.dots) || product.dots.length > 4096 ||
              !validField(product.film, Infinity) || !Number.isFinite(product.work) ||
              product.work < 0 || product.work > 120) return;
          if (!product.dots.every(dot => dot && isFace(dot.x, dot.y) &&
              Number.isFinite(dot.amount) && dot.amount >= 0)) return;
          if (!Number.isFinite(materialAmount(product))) return;
          if (saved.version >= 3 && (!Number.isFinite(product.absorbed) || product.absorbed < 0)) return;
        }
        if (saved.version >= 3 && (!saved.careWork || !TOOLS.every(id =>
          Number.isFinite(saved.careWork[id]) && saved.careWork[id] >= 0 && saved.careWork[id] <= 120))) return;
        if (saved.version === 4 && typeof saved.towelWet !== "boolean") return;
        for (const id of PRODUCTS) {
          const product = saved.products[id];
          this.products[id] = { dots: product.dots.map(dot => ({ x: dot.x, y: dot.y, amount: dot.amount })),
            film: product.film.slice(), work: product.work, absorbed: Number.isFinite(product.absorbed) && product.absorbed >= 0 ? product.absorbed : 0 };
        }
        this.dirt = saved.dirt.slice();
        this.hydration = saved.hydration.slice();
        this.massage = saved.massage.slice();
        if (Array.isArray(saved.paintOrder) && saved.paintOrder.length === PRODUCTS.length &&
            new Set(saved.paintOrder).size === PRODUCTS.length &&
            saved.paintOrder.every(id => PRODUCTS.includes(id))) this.paintOrder = saved.paintOrder.slice();
        this.lastUsed = TOOLS.includes(saved.lastUsed) ? saved.lastUsed : null;
        this.rollerWork = Number.isFinite(saved.rollerWork) ? clamp(saved.rollerWork, 0, 120) : 0;
        this.selectedTool = TOOLS.includes(saved.selectedTool) ? saved.selectedTool : "cleanser";
        if (saved.version >= 3) {
          this.careWork = Object.fromEntries(TOOLS.map(id => [id, saved.careWork[id]]));
        } else {
          // Preserve v2 materials and user selection; the removed three-dose
          // phase is not restored. Existing treatment contributes to the bar.
          PRODUCTS.forEach(id => { this.careWork[id] = this.products[id].work; });
          this.careWork.towel = clamp(1 - sum(this.dirt) / INITIAL_DIRT, 0, 1) * WORK_TARGETS.towel;
          this.careWork.roller = this.rollerWork;
        }
        this.towelWet = this.selectedTool === "towel" &&
          (saved.version === 4 ? saved.towelWet : this.careWork.towel > 0);
      } catch (_) { /* Corrupt/blocked storage must not prevent care. */ }
    }

    save() {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 4,
          selectedTool: this.selectedTool, lastUsed: this.lastUsed, rollerWork: this.rollerWork,
          products: this.products, paintOrder: this.paintOrder, dirt: this.dirt,
          hydration: this.hydration, massage: this.massage, careWork: this.careWork, towelWet: this.towelWet }));
      } catch (_) { /* Play remains available for this session. */ }
    }

    recommend() {
      const id = this.lastUsed;
      if (!id) return "cleanser";
      const credits = this.treatmentCredits();
      if (TOOLS.every(tool => credits[tool] >= 1)) {
        const cleanser = this.products.cleanser;
        if (this.dirt.some(value => value > VISIBLE.dirt) ||
            cleanser.dots.some(dot => dot.amount > VISIBLE.dot) ||
            cleanser.film.some(value => value > VISIBLE.film)) return "towel";
        return null; // Remaining serum/cream needs a hand, not another dose.
      }
      if (credits[id] < 1) return id;
      return TOOLS.find(tool => credits[tool] < 1) || null;
    }

    surfaceState() {
      const dirt = sum(this.dirt.filter(value => value > VISIBLE.dirt));
      let material = 0;
      for (const id of PRODUCTS) {
        const product = this.products[id];
        material += sum(product.dots.filter(dot => dot.amount > VISIBLE.dot).map(dot => dot.amount));
        material += sum(product.film.filter(value => value > VISIBLE.film));
        const carry = this.stroke?.carries[id] || 0;
        if (carry > VISIBLE.film) material += carry;
      }
      const clear = dirt === 0 && material === 0;
      return { dirt, material, clear,
        cleanliness: clear ? 1 : clamp(1 - dirt / INITIAL_DIRT, 0, 1) / (1 + material * 2) };
    }

    treatmentCredits(surface = this.surfaceState()) {
      return Object.fromEntries(TOOLS.map(id => {
        let credit = this.careWork[id] / WORK_TARGETS[id];
        // An absorbed dose earns its treatment credit even if it became clear
        // before an arbitrary rubbing timer. No need to apply more to finish.
        if (id === "serum" || id === "cream") credit = Math.max(credit, this.products[id].absorbed / 0.95);
        if (id === "towel" && surface.dirt === 0 && this.careWork.towel > 0) credit = 1;
        return [id, clamp(credit, 0, 1)];
      }));
    }

    overallProgress() {
      const surface = this.surfaceState();
      const treatment = sum(Object.values(this.treatmentCredits(surface))) / TOOLS.length;
      const progress = treatment * 0.9 + surface.cleanliness * 0.1;
      return surface.clear ? progress : Math.min(0.99, progress);
    }

    wetTowel() {
      if (!this.active || this.selectedTool !== "towel") return;
      this.towelWet = true;
      this.updateCursorArtwork("towel");
      this.save();
      this.publish();
    }

    chooseTool(tool) {
      // Wetness belongs to the currently used towel. Picking it up again or
      // reselecting it keeps the water; choosing another tool dries it.
      if (this.selectedTool !== tool) this.towelWet = false;
      this.selectedTool = tool;
      this.updateCursorArtwork(tool);
    }

    // Detailed copies are for save/debug/tests, not percentages or UI badges.
    getState() {
      return { active: this.active, ready: Boolean(this.rig), selectedTool: this.selectedTool,
        recommendedTool: this.recommend(), lastUsed: this.lastUsed,
        overallProgress: this.overallProgress(), careWork: { ...this.careWork }, towelWet: this.towelWet,
        paintOrder: this.paintOrder.slice(),
        products: Object.fromEntries(PRODUCTS.map(id => [id, {
          dots: this.products[id].dots.map(dot => ({ ...dot })),
          film: this.products[id].film.slice(), work: this.products[id].work, absorbed: this.products[id].absorbed
        }])), dirt: this.dirt.slice(), hydration: this.hydration.slice(), massage: this.massage.slice() };
    }

    publish() {
      window.dispatchEvent(new CustomEvent("dresslab:facial-state", { detail: {
        active: this.active, ready: Boolean(this.rig), selectedTool: this.selectedTool,
        recommendedTool: this.recommend(), overallProgress: this.overallProgress(), towelWet: this.towelWet
      } }));
    }

    syncActive() {
      this.endStroke();
      this.active = Boolean(this.rig) && window.DressLabRooms?.current === "care" &&
        window.DressLabCareRoom?.currentTab === "facial";
      canvas.dataset.facialActive = String(this.active);
      if (this.active) {
        // Only read the user's tab selection. Never advance or reveal a tool.
        const chosen = window.DressLabCareRoom.selectedTool;
        if (TOOLS.includes(chosen)) this.chooseTool(chosen);
        canvas.tabIndex = 0;
        canvas.setAttribute("role", "button");
        canvas.setAttribute("aria-label", "페이셜 케어 얼굴. 선반의 도구를 얼굴로 끌어 도포하고, 얼굴을 직접 문질러 펴 바른다. 수건은 대야의 물에 적신 뒤 얼굴을 닦는다. 도포 횟수와 도구 순서는 자유롭다. 도구에 초점을 맞춘 Enter 또는 스페이스는 도구 사용, 얼굴에서 같은 키는 문지르기이다.");
      } else {
        canvas.removeAttribute("tabindex");
        canvas.setAttribute("role", "img");
        canvas.setAttribute("aria-label", this.originalLabel || "기본 캐릭터");
      }
      this.publish();
      this.requestRender();
    }

    reset() {
      this.endStroke();
      this.clearMaterials();
      this.updateCursorArtwork(this.selectedTool);
      this.keyboardIndex = 0;
      this.save();
      this.publish();
      this.requestRender();
    }

    clientToFace(clientX, clientY) {
      const rect = canvas.getBoundingClientRect();
      if (!this.rig || !rect.width || !rect.height) return null;
      let x = (clientX - rect.left) * canvas.width / rect.width;
      let y = (clientY - rect.top) * canvas.height / rect.height;
      const { root, rootAnchor, config, angles } = this.rig;
      x = rootAnchor.x + (x - root.x - rootAnchor.x) / root.scaleX;
      y = rootAnchor.y + (y - root.y - rootAnchor.y) / root.scaleY;
      const pivot = config.pivots.torso;
      const angle = -(angles.torso || 0) * Math.PI / 180;
      const dx = x - pivot.x, dy = y - pivot.y;
      x = pivot.x + dx * Math.cos(angle) - dy * Math.sin(angle);
      y = pivot.y + dx * Math.sin(angle) + dy * Math.cos(angle);
      const shape = this.bodyShape;
      if (shape?.headNeckAnchors) {
        const { x: cx, jawY } = shape.headNeckAnchors;
        const scale = shape.head / 100;
        x = cx + (x - cx) / scale;
        y = jawY + (y - jawY - shape.neckOffsetY()) / scale;
      }
      return { x, y };
    }

    deposit(id, point) {
      const product = this.products[id];
      // Nearby drops share a puddle, keeping the drawing compact without a
      // dose quota. Every application adds another full dose, even here.
      const dot = product.dots.find(item => Math.hypot(item.x - point.x, item.y - point.y) < 22);
      if (dot) dot.amount += 1;
      else product.dots.push({ x: point.x, y: point.y, amount: 1 });
      this.paintOrder = this.paintOrder.filter(key => key !== id).concat(id);
      this.lastUsed = id;
      this.save();
      this.publish();
      this.requestRender();
    }

    makeStroke(kind, tool, event, point = null) {
      return { kind, tool, carries: {}, clientX: event.clientX, clientY: event.clientY,
        time: performance.now(), point, onFace: false, lastDeposit: null, lastDepositTime: -Infinity };
    }

    pointerDown(event) {
      if (!this.active || event.isPrimary === false || this.pointerId !== null ||
          (event.button !== undefined && event.button !== 0)) return;
      const point = this.clientToFace(event.clientX, event.clientY);
      if (!point || !isFace(point.x, point.y)) return;
      event.preventDefault();
      this.pointerId = event.pointerId;
      // A contact beginning on the face is always a bare hand. Merely selecting
      // a bottle, towel or roller never turns that hand into the selected tool.
      this.stroke = this.makeStroke("hand", null, event, point);
      this.cursor.hidden = true;
      try { canvas.setPointerCapture(event.pointerId); } catch (_) { /* optional */ }
    }

    toolDrag(detail) {
      if (!detail || !TOOLS.includes(detail.tool)) return;
      if (detail.phase === "start") {
        if (!this.active || this.pointerId !== null || !Number.isFinite(detail.clientX) ||
            !Number.isFinite(detail.clientY)) return;
        this.chooseTool(detail.tool); // An explicit pickup by the user.
        this.pointerId = detail.pointerId;
        this.stroke = this.makeStroke("tool", detail.tool, detail);
        this.advanceStroke(detail);
        this.save();
        this.publish();
        return;
      }
      if (this.pointerId !== detail.pointerId || this.stroke?.kind !== "tool" ||
          this.stroke.tool !== detail.tool) return;
      if (detail.phase === "move" || detail.phase === "end") this.advanceStroke(detail);
      if (detail.phase === "end" || detail.phase === "cancel") this.endStroke();
    }

    pointerMove(event) {
      if (!this.active || this.pointerId !== event.pointerId || this.stroke?.kind !== "hand") return;
      event.preventDefault();
      this.advanceStroke(event);
    }

    advanceStroke(event) {
      const stroke = this.stroke;
      if (!this.active || !stroke || !Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return;
      const now = performance.now();
      const point = this.clientToFace(event.clientX, event.clientY);
      // Both positions use the current rig transform. Idle head animation does
      // not become an extra rubbing gesture beneath a stationary finger.
      const previous = this.clientToFace(stroke.clientX, stroke.clientY);
      const pixelsMoved = Math.hypot(event.clientX - stroke.clientX, event.clientY - stroke.clientY);
      const elapsed = clamp(now - stroke.time, 0, 80) / 1000;
      stroke.clientX = event.clientX;
      stroke.clientY = event.clientY;
      stroke.time = now;
      if (stroke.kind === "tool") this.moveCursor(event, stroke.tool);
      const towel = stroke.kind === "tool" && stroke.tool === "towel";
      const accepts = towel ? isTowelContact : isFace;
      // A captured cloth can cross the whole face between input events and
      // finish beyond its outline. Sample that path before judging contact.
      if (event.overBasin || !point || !previous || (!towel && !accepts(point.x, point.y))) {
        stroke.onFace = false;
        return;
      }
      if (stroke.kind === "tool" && PRODUCTS.includes(stroke.tool)) {
        const movedFromDose = !stroke.lastDeposit ||
          Math.hypot(point.x - stroke.lastDeposit.x, point.y - stroke.lastDeposit.y) >= 48;
        const cooledDown = now - stroke.lastDepositTime >= DROP_INTERVAL_MS;
        // First contact is immediate. Later drops in this same drag also
        // respect the time gap when leaving and re-entering the face.
        if (!stroke.lastDeposit || (cooledDown && pixelsMoved > 0.000001 &&
            (!stroke.onFace || movedFromDose))) {
          this.deposit(stroke.tool, point);
          stroke.lastDeposit = point;
          stroke.lastDepositTime = now;
        }
        stroke.onFace = true;
        stroke.point = point;
        return; // A dragged bottle applies only; it never rubs its own dose.
      }
      stroke.onFace = true;
      if (pixelsMoved < 0.000001 || elapsed <= 0) return;
      const distance = Math.hypot(point.x - previous.x, point.y - previous.y);
      const work = Math.min(elapsed, distance / 90);
      if (work <= 0) return;
      const samples = Math.max(1, Math.min(32, Math.ceil(distance / 12)));
      for (let i = 1; i <= samples; i++) {
        const sample = { x: previous.x + (point.x - previous.x) * i / samples,
          y: previous.y + (point.y - previous.y) * i / samples };
        if (accepts(sample.x, sample.y)) this.workAt(stroke, sample, work / samples);
      }
      stroke.point = point;
      this.publish();
      this.requestRender();
    }

    pointerUp(event) {
      if (this.pointerId === event.pointerId && this.stroke?.kind === "hand") this.endStroke();
    }

    endStroke() {
      const stroke = this.stroke, pointer = this.pointerId;
      this.pointerId = null;
      this.stroke = null;
      if (stroke) {
        this.flushCarry(stroke);
        this.save();
        this.publish();
        this.requestRender();
      }
      if (this.cursor) this.cursor.hidden = true;
      if (pointer !== null && canvas.hasPointerCapture?.(pointer)) {
        try { canvas.releasePointerCapture(pointer); } catch (_) { /* Already released. */ }
      }
    }

    updateCursorArtwork(tool) {
      if (!this.cursor) return;
      const name = tool === "roller" ? "roller-v2" :
        tool === "towel" && this.towelWet ? "towel-wet" : tool;
      const src = "./assets/care/facial/" + name + ".png";
      if (this.cursor.getAttribute("src") !== src) this.cursor.src = src;
      this.cursor.dataset.tool = tool;
      this.cursor.dataset.wet = String(tool === "towel" && this.towelWet);
    }

    moveCursor(event, tool) {
      const rect = document.getElementById("artboard").getBoundingClientRect();
      this.updateCursorArtwork(tool);
      this.cursor.style.left = (event.clientX - rect.left) + "px";
      this.cursor.style.top = (event.clientY - rect.top) + "px";
      this.cursor.hidden = false;
    }

    putFilm(product, point, amount, radius = 43) {
      if (!(amount > 0) || !point) return;
      const nearby = neighbors(point, radius), total = sum(nearby.map(cell => cell.weight));
      if (!total) return;
      nearby.forEach(cell => { product.film[cell.index] += amount * cell.weight / total; });
    }

    flushCarry(stroke) {
      for (const id of PRODUCTS) {
        const carry = stroke.carries[id] || 0;
        if (carry > 0) this.putFilm(this.products[id], stroke.point, carry, id === "cleanser" ? 43 : 60);
        stroke.carries[id] = 0;
      }
    }

    recordAbsorption(product, point, amount) {
      if (!(amount > 0)) return;
      product.absorbed += amount;
      const nearby = neighbors(point, 60), total = sum(nearby.map(cell => cell.weight));
      if (!total) return;
      nearby.forEach(cell => {
        this.hydration[cell.index] = clamp(this.hydration[cell.index] + amount * 2.2 * cell.weight / total, 0, 1);
      });
    }

    absorbLocal(id, stroke, point, work) {
      if (id === "cleanser") return 0;
      const product = this.products[id], rate = id === "serum" ? 3.6 : 2.8;
      let absorbed = 0;
      const carry = stroke.carries[id] || 0;
      let remaining = carry * Math.exp(-work * rate);
      if (remaining <= VISIBLE.film) remaining = 0;
      absorbed += carry - remaining;
      stroke.carries[id] = remaining;
      // Absorption follows a broad fingertip footprint, including the softly
      // spread fringe. Work fades the existing film instead of painting a fresh
      // opaque tint every time the hand picks it up and puts it down again.
      CELLS.forEach((cell, index) => {
        const weight = brushWeight(Math.hypot(cell.x - point.x, cell.y - point.y), 50, 82);
        if (!weight || product.film[index] <= 0) return;
        const before = product.film[index];
        let after = before * Math.exp(-work * rate * weight);
        if (after <= VISIBLE.film) after = 0;
        product.film[index] = after;
        absorbed += before - after;
      });
      this.recordAbsorption(product, point, absorbed);
      return absorbed;
    }

    spread(id, stroke, point, work) {
      const product = this.products[id];
      let carry = stroke.carries[id] || 0;
      const dots = product.dots.map(dot => ({ dot,
        weight: Math.max(0, 1 - Math.hypot(dot.x - point.x, dot.y - point.y) / 50) }))
        .filter(item => item.weight > 0 && item.dot.amount > 0);
      const dotWeight = sum(dots.map(item => item.weight));
      dots.forEach(({ dot, weight }) => {
        const rate = id === "cleanser" ? 1.4 : 1.4 + dot.amount * 3.2;
        const take = Math.min(dot.amount, work * rate * weight / dotWeight);
        dot.amount -= take;
        carry += take;
        if (id !== "cleanser" && dot.amount <= VISIBLE.dot) {
          carry += dot.amount;
          dot.amount = 0;
        }
      });
      const radius = id === "cleanser" ? 43 : 60;
      const nearby = neighbors(point, radius), totalWeight = sum(nearby.map(cell => cell.weight));
      let contact = dots.length > 0 || carry > 0;
      nearby.forEach(cell => {
        const amount = product.film[cell.index];
        if (amount <= 0) return;
        contact = true;
        const take = Math.min(amount, work * 0.65 * cell.weight / totalWeight);
        product.film[cell.index] -= take;
        carry += take;
      });
      const release = Math.min(carry, work * (id === "cleanser" ? 1.2 : 2.2));
      this.putFilm(product, point, release, radius);
      stroke.carries[id] = carry - release;
      if (this.absorbLocal(id, stroke, point, work) > 0) contact = true;
      if (contact) {
        product.work = Math.min(120, product.work + work);
        this.careWork[id] = Math.min(120, this.careWork[id] + work);
        this.paintOrder = this.paintOrder.filter(key => key !== id).concat(id);
        this.lastUsed = id;
      }
    }

    wipe(point, work) {
      if (!this.towelWet) return;
      const nearby = CELLS.map((cell, index) => ({ index,
        weight: brushWeight(Math.hypot(cell.x - point.x, cell.y - point.y), 55, 85) }))
        .filter(cell => cell.weight > 0);
      const clean = (amount, weight, threshold) => {
        if (!weight || !(amount > 0)) return amount;
        // A finite cleanup term removes the last trace, rather than leaving
        // exponential residue that never quite reaches zero.
        const remaining = Math.max(0, amount * Math.exp(-work * 12 * weight) - work * 0.12 * weight);
        return remaining <= threshold ? 0 : remaining;
      };
      let removed = 0;
      for (const id of PRODUCTS) {
        const product = this.products[id];
        product.dots.forEach(dot => {
          const weight = brushWeight(Math.hypot(dot.x - point.x, dot.y - point.y), 55, 85);
          const before = dot.amount;
          dot.amount = clean(dot.amount, weight, VISIBLE.dot);
          removed += before - dot.amount;
        });
        nearby.forEach(cell => {
          const before = product.film[cell.index];
          product.film[cell.index] = clean(before, cell.weight, VISIBLE.film);
          removed += before - product.film[cell.index];
        });
      }
      nearby.forEach(cell => {
        const before = this.dirt[cell.index];
        this.dirt[cell.index] = clean(before, cell.weight, VISIBLE.dirt);
        removed += before - this.dirt[cell.index];
      });
      if (removed > 0.000000001) this.careWork.towel = Math.min(120, this.careWork.towel + work);
      this.lastUsed = "towel";
    }

    roll(point, work) {
      const nearby = neighbors(point, 45);
      nearby.forEach(cell => {
        this.massage[cell.index] = clamp(this.massage[cell.index] + work * 0.48 * cell.weight, 0, 1);
      });
      for (const id of ["serum", "cream"]) this.absorbLocal(id, { carries: {} }, point, work * 0.7);
      this.rollerWork = Math.min(120, this.rollerWork + work);
      this.careWork.roller = Math.min(120, this.careWork.roller + work);
      this.lastUsed = "roller";
    }

    workAt(stroke, point, work) {
      if (stroke.kind === "hand") {
        // The hand spreads everything underneath it, independently of which
        // shelf tool is highlighted. Each product retains its own material.
        this.paintOrder.slice().forEach(id => this.spread(id, stroke, point, work));
      } else if (stroke.tool === "towel") this.wipe(point, work);
      else if (stroke.tool === "roller") this.roll(point, work);
    }

    keyboardSpots() {
      return [{ x: 255, y: 620 }, { x: 405, y: 640 }, { x: 329, y: 884 }];
    }

    keyboardPass(kind, tool, point) {
      const destination = { x: point.x + (this.keyboardIndex % 2 ? -22 : 22), y: point.y };
      const stroke = { kind, tool, point, carries: {} };
      for (let i = 0; i < 4; i++) {
        const sample = { x: point.x + (destination.x - point.x) * i / 3, y: point.y };
        if ((tool === "towel" ? isTowelContact : isFace)(sample.x, sample.y)) {
          this.workAt(stroke, sample, 0.04);
          stroke.point = sample;
        }
      }
      this.flushCarry(stroke);
      this.keyboardIndex++;
      this.save();
      this.publish();
      this.requestRender();
    }

    toolKey(id) {
      if (!this.active || this.pointerId !== null || !TOOLS.includes(id)) return;
      this.chooseTool(id);
      const spots = this.keyboardSpots();
      if (PRODUCTS.includes(id)) {
        this.deposit(id, spots[this.keyboardIndex++ % spots.length]);
      } else {
        const remaining = id === "towel" ? CELLS.filter((_, index) => this.dirt[index] > VISIBLE.dirt ||
          PRODUCTS.some(key => this.products[key].film[index] > VISIBLE.film)) : [];
        const dots = id === "towel" ? PRODUCTS.flatMap(key =>
          this.products[key].dots.filter(dot => dot.amount > VISIBLE.dot)) : [];
        const targets = dots.concat(remaining);
        const points = targets.length ? targets : spots;
        this.keyboardPass("tool", id, points[this.keyboardIndex % points.length]);
      }
    }

    keyDown(event) {
      if (!this.active || this.pointerId !== null || event.repeat || !["Enter", " "].includes(event.key)) return;
      event.preventDefault();
      const dots = PRODUCTS.flatMap(id => this.products[id].dots.filter(dot => dot.amount > VISIBLE.dot));
      const film = CELLS.filter((_, index) => PRODUCTS.some(id => this.products[id].film[index] > VISIBLE.film));
      const points = dots.length ? dots : film.length ? film : this.keyboardSpots();
      this.keyboardPass("hand", null, points[this.keyboardIndex % points.length]);
    }

    requestRender() {
      if (!this.rig || this.frame) return;
      this.frame = requestAnimationFrame(() => { this.frame = 0; this.rig?.render(); });
    }

    clipFace(ctx) {
      ctx.beginPath();
      ctx.ellipse(FACE.x, FACE.y, FACE.rx, FACE.ry, 0, 0, Math.PI * 2);
      EYES.forEach(eye => {
        ctx.moveTo(eye.x + 70, eye.y);
        ctx.ellipse(eye.x, eye.y, 70, 55, 0, 0, Math.PI * 2);
      });
      ctx.clip("evenodd");
    }

    drawDot(ctx, id, dot) {
      if (dot.amount <= VISIBLE.dot) return;
      const radius = DROP_RADIUS[id] * Math.pow(Math.min(dot.amount, 3), 0.36);
      ctx.save();
      ctx.translate(dot.x, dot.y);
      ctx.fillStyle = id === "serum" ? "rgba(229,165,185,.8)" : id === "cream" ? "#fff4e5" : "#f7fffd";
      ctx.strokeStyle = id === "serum" ? "rgba(186,123,147,.4)" : "rgba(168,162,151,.36)";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.ellipse(0, 0, radius * 1.13, radius, -.2, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
      ctx.strokeStyle = "rgba(255,255,255,.8)";
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(-2, -2, radius * .55, Math.PI, Math.PI * 1.7); ctx.stroke();
      if (id === "cream") {
        ctx.strokeStyle = "rgba(218,192,170,.45)";
        ctx.beginPath(); ctx.ellipse(1, 2, radius * .56, radius * .28, -.2, 0, Math.PI * 1.6); ctx.stroke();
      }
      ctx.restore();
    }

    draw(ctx) {
      if (!this.active) return;
      ctx.save();
      const shape = this.bodyShape;
      if (shape?.headNeckAnchors) {
        const { x, jawY } = shape.headNeckAnchors, scale = shape.head / 100;
        ctx.translate(x, jawY + shape.neckOffsetY());
        ctx.scale(scale, scale); ctx.translate(-x, -jawY);
      }
      this.clipFace(ctx);
      CELLS.forEach((cell, index) => {
        if (this.dirt[index] > VISIBLE.dirt) {
          ctx.fillStyle = "rgba(166,127,119," + this.dirt[index] * .3 + ")";
          ctx.beginPath(); ctx.ellipse(cell.x + 3, cell.y - 2, 9, 6, .3, 0, Math.PI * 2); ctx.fill();
        }
        // Hydration and massage are care state, not permanent white paint.
        // Once a product is absorbed, the original selected skin tone shows.
      });
      if (this.active) {
        for (const id of this.paintOrder) {
          const product = this.products[id];
          product.film.forEach((amount, index) => {
            if (amount <= VISIBLE.film) return;
            const cell = CELLS[index];
            ctx.save();
            ctx.beginPath();
            if (id === "cleanser") {
              ctx.globalAlpha = clamp(amount * 12, 0, .85);
              ctx.fillStyle = "#f5fffc";
              ctx.arc(cell.x - 7, cell.y, 16, 0, Math.PI * 2);
              ctx.arc(cell.x + 7, cell.y + 3, 15, 0, Math.PI * 2);
              ctx.arc(cell.x, cell.y - 8, 17, 0, Math.PI * 2);
            } else {
              // A thin film spreads softly and becomes transparent as its
              // local material is absorbed. It never stains the base image.
              const radius = 32 + 12 * (1 - clamp(amount / 0.15, 0, 1));
              const alpha = clamp(amount * 6, 0, id === "serum" ? 0.5 : 0.65);
              const color = id === "serum" ? "235,194,208" : "255,246,233";
              const film = ctx.createRadialGradient(cell.x, cell.y, 0, cell.x, cell.y, radius);
              film.addColorStop(0, "rgba(" + color + "," + alpha + ")");
              film.addColorStop(1, "rgba(" + color + ",0)");
              ctx.fillStyle = film;
              ctx.arc(cell.x, cell.y, radius, 0, Math.PI * 2);
            }
            ctx.fill();
            ctx.restore();
          });
          product.dots.forEach(dot => this.drawDot(ctx, id, dot));
        }
      }
      ctx.restore();
    }
  }
  window.DressLabFacialCare = new FacialCare();
})();
