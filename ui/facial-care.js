/* Free facial care. Products are deposited, moved and wiped in source-face
 * coordinates; no global stage, completion flag or automatic tool selection.
 * The original doll, skin color, body shape, eyes and clothing stay independent.
 */
(() => {
  "use strict";
  const canvas = document.getElementById("character");
  if (!canvas) return;
  const STORAGE_KEY = "dresslab-v2:facial-care:v2";
  const TOOLS = ["cleanser", "towel", "serum", "cream", "roller"];
  const PRODUCTS = ["cleanser", "serum", "cream"];
  const DOSES = 3;
  const FACE = { x: 329, y: 719, rx: 190, ry: 200 };
  const EYES = [{ x: 237, y: 800 }, { x: 422, y: 800 }];
  const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));
  const sum = values => values.reduce((total, value) => total + value, 0);
  const inEllipse = (x, y, cx, cy, rx, ry) =>
    ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;
  const isFace = (x, y) => Number.isFinite(x) && Number.isFinite(y) &&
    inEllipse(x, y, FACE.x, FACE.y, FACE.rx, FACE.ry) &&
    !EYES.some(eye => inEllipse(x, y, eye.x, eye.y, 70, 55));
  const CELLS = [];
  for (let y = 547; y <= 903; y += 28) {
    for (let x = 157; x <= 517; x += 28) {
      if (isFace(x, y)) CELLS.push({ x, y });
    }
  }
  const blankField = () => Array(CELLS.length).fill(0);
  const blankProducts = () => Object.fromEntries(PRODUCTS.map(id =>
    [id, { dots: [], film: blankField(), work: 0 }]));
  const materialAmount = product => sum(product.film) + sum(product.dots.map(dot => dot.amount));
  const productPhase = product => product.dots.length < DOSES || materialAmount(product) < 0.03
    ? "apply" : "spread";
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
        this.selectedTool = event.detail.tool;
        this.keyboardIndex = 0;
        this.save();
        this.publish();
      });
      window.addEventListener("dresslab:facial-reset", () => this.reset());
    }

    clearMaterials() {
      this.products = blankProducts();
      this.paintOrder = PRODUCTS.slice();
      this.dirt = CELLS.map((_, index) => index % 11 === 3 ? 0.7 : 0);
      this.hydration = blankField();
      this.massage = blankField();
      this.lastUsed = null;
      this.rollerWork = 0;
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
        // The old automatic-stage save is deliberately not read into free care.
        const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
        if (saved?.version !== 2 || !saved.products || !validField(saved.dirt) ||
            !validField(saved.hydration) || !validField(saved.massage)) return;
        for (const id of PRODUCTS) {
          const product = saved.products[id];
          if (!product || !Array.isArray(product.dots) || product.dots.length > DOSES ||
              !validField(product.film, DOSES) || !Number.isFinite(product.work) ||
              product.work < 0 || product.work > 120) return;
          if (!product.dots.every(dot => dot && isFace(dot.x, dot.y) &&
              Number.isFinite(dot.amount) && dot.amount >= 0 && dot.amount <= 1)) return;
          if (materialAmount(product) > DOSES + 0.001) return;
        }
        for (const id of PRODUCTS) {
          const product = saved.products[id];
          this.products[id] = { dots: product.dots.map(dot => ({ x: dot.x, y: dot.y, amount: dot.amount })),
            film: product.film.slice(), work: product.work };
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
      } catch (_) { /* Corrupt/blocked storage must not prevent care. */ }
    }

    save() {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 2,
          selectedTool: this.selectedTool, lastUsed: this.lastUsed, rollerWork: this.rollerWork,
          products: this.products, paintOrder: this.paintOrder, dirt: this.dirt,
          hydration: this.hydration, massage: this.massage }));
      } catch (_) { /* Play remains available for this session. */ }
    }

    recommend() {
      const id = this.lastUsed;
      if (!id) return "cleanser";
      if (PRODUCTS.includes(id)) {
        const product = this.products[id];
        if (product.dots.length < DOSES || product.work < 8 ||
            sum(product.dots.map(dot => dot.amount)) > 1.1) return id;
        return { cleanser: "towel", serum: "cream", cream: "roller" }[id];
      }
      if (id === "towel") {
        const residue = PRODUCTS.reduce((total, key) => total + materialAmount(this.products[key]), 0);
        return residue > 0.15 || sum(this.dirt) > 0.4 ? "towel" : "serum";
      }
      return this.rollerWork < 8 ? "roller" : null;
    }

    // Detailed copies are for save/debug/tests, not percentages or UI badges.
    getState() {
      return { active: this.active, ready: Boolean(this.rig), selectedTool: this.selectedTool,
        recommendedTool: this.recommend(), lastUsed: this.lastUsed,
        paintOrder: this.paintOrder.slice(),
        products: Object.fromEntries(PRODUCTS.map(id => [id, {
          phase: productPhase(this.products[id]),
          dots: this.products[id].dots.map(dot => ({ ...dot })),
          film: this.products[id].film.slice(), work: this.products[id].work
        }])), dirt: this.dirt.slice(), hydration: this.hydration.slice(), massage: this.massage.slice() };
    }

    publish() {
      window.dispatchEvent(new CustomEvent("dresslab:facial-state", { detail: {
        active: this.active, ready: Boolean(this.rig), selectedTool: this.selectedTool,
        recommendedTool: this.recommend()
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
        if (TOOLS.includes(chosen)) this.selectedTool = chosen;
        canvas.tabIndex = 0;
        canvas.setAttribute("role", "button");
        canvas.setAttribute("aria-label", "페이셜 케어 얼굴. 도구는 자유롭게 선택한다. 클렌저, 세럼, 크림은 세 번 도포한 뒤 문질러 펴 바른다. Enter 또는 스페이스 키로도 케어할 수 있다.");
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
      let product = this.products[id];
      if (materialAmount(product) < 0.03 && product.dots.length) {
        product = this.products[id] = { dots: [], film: blankField(), work: 0 };
      }
      if (product.dots.length >= DOSES) return;
      product.dots.push({ x: point.x, y: point.y, amount: 1 });
      this.paintOrder = this.paintOrder.filter(key => key !== id).concat(id);
      this.lastUsed = id;
      this.save();
      this.publish();
      this.requestRender();
    }

    pointerDown(event) {
      if (!this.active || event.isPrimary === false || this.pointerId !== null ||
          (event.button !== undefined && event.button !== 0)) return;
      const point = this.clientToFace(event.clientX, event.clientY);
      if (!point || !isFace(point.x, point.y)) return;
      event.preventDefault();
      const id = this.selectedTool;
      const applying = PRODUCTS.includes(id) && productPhase(this.products[id]) === "apply";
      this.pointerId = event.pointerId;
      // Snapshot contact mode BEFORE depositing: even the third tap stays an
      // application contact until release, rather than spreading accidentally.
      this.stroke = { tool: id, mode: applying ? "apply" : "rub", carry: 0,
        clientX: event.clientX, clientY: event.clientY, time: performance.now(), point };
      try { canvas.setPointerCapture(event.pointerId); } catch (_) { /* optional */ }
      if (applying) this.deposit(id, point);
      this.moveCursor(event);
    }

    pointerMove(event) {
      if (!this.active || this.pointerId !== event.pointerId || !this.stroke) return;
      event.preventDefault();
      const stroke = this.stroke, now = performance.now();
      const point = this.clientToFace(event.clientX, event.clientY);
      // Map BOTH positions through the current rig so idle head movement is
      // not counted as finger movement. Stationary contacts never do work.
      const previous = this.clientToFace(stroke.clientX, stroke.clientY);
      const pixelsMoved = Math.hypot(event.clientX - stroke.clientX, event.clientY - stroke.clientY);
      const elapsed = clamp(now - stroke.time, 0, 80) / 1000;
      stroke.clientX = event.clientX;
      stroke.clientY = event.clientY;
      stroke.time = now;
      if (!point || !previous || !isFace(point.x, point.y)) {
        this.cursor.hidden = true;
        return;
      }
      this.moveCursor(event);
      if (stroke.mode === "apply" || pixelsMoved < 0.000001 || elapsed <= 0) return;
      const distance = Math.hypot(point.x - previous.x, point.y - previous.y);
      const work = Math.min(elapsed, distance / 120);
      if (work <= 0) return;
      // Budget is computed once per real event and split among samples.
      // Pointer frequency and interpolation cannot multiply its effect.
      const samples = Math.max(1, Math.min(32, Math.ceil(distance / 12)));
      for (let i = 1; i <= samples; i++) {
        const sample = { x: previous.x + (point.x - previous.x) * i / samples,
          y: previous.y + (point.y - previous.y) * i / samples };
        if (isFace(sample.x, sample.y)) this.workAt(stroke, sample, work / samples);
      }
      stroke.point = point;
      this.publish();
      this.requestRender();
    }

    pointerUp(event) {
      if (this.pointerId === event.pointerId) this.endStroke();
    }

    endStroke() {
      if (this.stroke) {
        this.flushCarry(this.stroke);
        this.save();
        this.publish();
        this.requestRender();
      }
      this.pointerId = null;
      this.stroke = null;
      if (this.cursor) this.cursor.hidden = true;
      // The eye controller shares canvas capture and releases it on pointerup.
    }

    moveCursor(event) {
      const rect = document.getElementById("artboard").getBoundingClientRect();
      const src = "./assets/care/facial/" + this.selectedTool + ".png";
      if (this.cursor.getAttribute("src") !== src) this.cursor.src = src;
      this.cursor.style.left = (event.clientX - rect.left) + "px";
      this.cursor.style.top = (event.clientY - rect.top) + "px";
      this.cursor.hidden = false;
    }

    putFilm(product, point, amount) {
      if (!(amount > 0)) return;
      const nearby = neighbors(point, 43), total = sum(nearby.map(cell => cell.weight));
      if (!total) return;
      nearby.forEach(cell => { product.film[cell.index] += amount * cell.weight / total; });
    }

    flushCarry(stroke) {
      if (stroke.carry > 0 && this.products[stroke.tool]) {
        this.putFilm(this.products[stroke.tool], stroke.point, stroke.carry);
        stroke.carry = 0;
      }
    }

    spread(stroke, point, work) {
      const product = this.products[stroke.tool];
      const dots = product.dots.map(dot => ({ dot,
        weight: Math.max(0, 1 - Math.hypot(dot.x - point.x, dot.y - point.y) / 50) }))
        .filter(item => item.weight > 0 && item.dot.amount > 0);
      const dotWeight = sum(dots.map(item => item.weight));
      // One three-dose batch takes sustained rubbing, not one broad swipe.
      dots.forEach(({ dot, weight }) => {
        const take = Math.min(dot.amount, work * 0.36 * weight / dotWeight);
        dot.amount -= take;
        stroke.carry += take;
      });
      const nearby = neighbors(point, 43), totalWeight = sum(nearby.map(cell => cell.weight));
      let contact = dots.length > 0 || stroke.carry > 0;
      nearby.forEach(cell => {
        const amount = product.film[cell.index];
        if (amount <= 0) return;
        contact = true;
        const take = Math.min(amount, work * 0.18 * cell.weight / totalWeight);
        product.film[cell.index] -= take;
        stroke.carry += take;
        // Serum and cream absorb gradually only where they are rubbed.
        const rate = stroke.tool === "serum" ? 0.14 : stroke.tool === "cream" ? 0.055 : 0;
        const absorbed = Math.min(product.film[cell.index], work * rate * cell.weight / totalWeight);
        product.film[cell.index] -= absorbed;
        this.hydration[cell.index] = clamp(this.hydration[cell.index] + absorbed * 2.2, 0, 1);
      });
      const release = Math.min(stroke.carry, work * 0.31);
      this.putFilm(product, point, release);
      stroke.carry -= release;
      if (contact) {
        product.work = Math.min(120, product.work + work);
        this.paintOrder = this.paintOrder.filter(key => key !== stroke.tool).concat(stroke.tool);
        this.lastUsed = stroke.tool;
      }
    }

    wipe(point, work) {
      const nearby = neighbors(point, 55);
      for (const id of PRODUCTS) {
        const product = this.products[id];
        product.dots.forEach(dot => {
          const weight = Math.max(0, 1 - Math.hypot(dot.x - point.x, dot.y - point.y) / 55);
          dot.amount *= Math.exp(-work * 1.4 * weight);
          if (dot.amount < 0.001) dot.amount = 0;
        });
        nearby.forEach(cell => {
          product.film[cell.index] *= Math.exp(-work * 1.6 * cell.weight);
          if (product.film[cell.index] < 0.0001) product.film[cell.index] = 0;
        });
      }
      nearby.forEach(cell => {
        this.dirt[cell.index] *= Math.exp(-work * 1.3 * cell.weight);
        if (this.dirt[cell.index] < 0.001) this.dirt[cell.index] = 0;
      });
      this.lastUsed = "towel";
    }

    roll(point, work) {
      const nearby = neighbors(point, 45);
      nearby.forEach(cell => {
        this.massage[cell.index] = clamp(this.massage[cell.index] + work * 0.16 * cell.weight, 0, 1);
        for (const id of ["serum", "cream"]) {
          const film = this.products[id].film;
          const absorbed = Math.min(film[cell.index], work * 0.15 * cell.weight);
          film[cell.index] -= absorbed;
          this.hydration[cell.index] = clamp(this.hydration[cell.index] + absorbed, 0, 1);
        }
      });
      this.rollerWork = Math.min(120, this.rollerWork + work);
      this.lastUsed = "roller";
    }

    workAt(stroke, point, work) {
      if (PRODUCTS.includes(stroke.tool)) this.spread(stroke, point, work);
      else if (stroke.tool === "towel") this.wipe(point, work);
      else if (stroke.tool === "roller") this.roll(point, work);
    }

    keyDown(event) {
      if (!this.active || event.repeat || !["Enter", " "].includes(event.key)) return;
      event.preventDefault();
      const id = this.selectedTool, product = this.products[id];
      const spots = [{ x: 255, y: 620 }, { x: 405, y: 640 }, { x: 329, y: 884 }];
      if (product && productPhase(product) === "apply") {
        const index = materialAmount(product) < 0.03 ? 0 : product.dots.length;
        this.deposit(id, spots[index % spots.length]);
        return;
      }
      // Keyboard action is a short physical pass, not a completion shortcut.
      const points = product?.dots.length ? product.dots : spots;
      const point = points[this.keyboardIndex % points.length];
      const destination = { x: point.x + (this.keyboardIndex % 2 ? -22 : 22), y: point.y };
      const stroke = { tool: id, point: destination, carry: 0 };
      for (let i = 0; i < 4; i++) {
        const sample = { x: point.x + (destination.x - point.x) * i / 3, y: point.y };
        if (isFace(sample.x, sample.y)) this.workAt(stroke, sample, 0.04);
      }
      this.flushCarry(stroke);
      this.keyboardIndex++;
      this.save();
      this.publish();
      this.requestRender();
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
      if (dot.amount < 0.003) return;
      const radius = (id === "serum" ? 11 : 16) * Math.pow(dot.amount, 0.36);
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
      if (!this.active && sum(this.hydration) + sum(this.massage) <= 0) return;
      ctx.save();
      const shape = this.bodyShape;
      if (shape?.headNeckAnchors) {
        const { x, jawY } = shape.headNeckAnchors, scale = shape.head / 100;
        ctx.translate(x, jawY + shape.neckOffsetY());
        ctx.scale(scale, scale); ctx.translate(-x, -jawY);
      }
      this.clipFace(ctx);
      CELLS.forEach((cell, index) => {
        if (this.active && this.dirt[index] > 0.01) {
          ctx.fillStyle = "rgba(166,127,119," + this.dirt[index] * .3 + ")";
          ctx.beginPath(); ctx.ellipse(cell.x + 3, cell.y - 2, 9, 6, .3, 0, Math.PI * 2); ctx.fill();
        }
        const sheen = this.hydration[index] * .21 + this.massage[index] * .07;
        if (sheen > .001) {
          const glow = ctx.createRadialGradient(cell.x, cell.y, 0, cell.x, cell.y, 26);
          glow.addColorStop(0, "rgba(255,255,255," + sheen + ")");
          glow.addColorStop(1, "rgba(255,255,255,0)");
          ctx.fillStyle = glow;
          ctx.beginPath(); ctx.arc(cell.x, cell.y, 26, 0, Math.PI * 2); ctx.fill();
        }
      });
      if (this.active) {
        for (const id of this.paintOrder) {
          const product = this.products[id];
          product.film.forEach((amount, index) => {
            if (amount < .0001) return;
            const cell = CELLS[index];
            ctx.save();
            ctx.globalAlpha = clamp(amount * (id === "cleanser" ? 12 : 7), 0, .85);
            ctx.fillStyle = id === "cleanser" ? "#f5fffc" : id === "serum" ? "#e8bfce" : "#fff2df";
            ctx.beginPath();
            if (id === "cleanser") {
              ctx.arc(cell.x - 7, cell.y, 16, 0, Math.PI * 2);
              ctx.arc(cell.x + 7, cell.y + 3, 15, 0, Math.PI * 2);
              ctx.arc(cell.x, cell.y - 8, 17, 0, Math.PI * 2);
            } else ctx.ellipse(cell.x, cell.y, 25, 18, -.25, 0, Math.PI * 2);
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
