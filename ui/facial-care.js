/* Facial care: source-coordinate coverage, reversible paint, local progress.
 * Input and effects follow the exact root -> torso -> head transform used by
 * the doll. Nothing is painted into the source PNGs or skin-tone cache.
 */
(() => {
  "use strict";

  const canvas = document.getElementById("character");
  if (!canvas) return;
  const STORAGE_KEY = "dresslab-v2:facial-care:v1";
  const STEPS = [
    { id: "cleanser", label: "클렌저", hint: "클렌저로 얼굴을 살살 문질러\n거품을 내 줘.", radius: 53 },
    { id: "towel", label: "물수건", hint: "물수건으로 거품을\n깨끗하게 닦아 줘.", radius: 56 },
    { id: "serum", label: "세럼", hint: "세럼을 톡톡 바르고\n얼굴에 고르게 펴 줘.", radius: 51 },
    { id: "cream", label: "크림", hint: "크림을 부드럽게 펴 발라\n촉촉함을 더해 줘.", radius: 53 },
    { id: "roller", label: "롤러", hint: "롤러를 얼굴 위로 움직여\n마사지를 마무리해 줘.", radius: 55 }
  ];
  const FACE = Object.freeze({ x: 329, y: 719, rx: 190, ry: 200 });
  const EYES = [{ x: 237, y: 800 }, { x: 422, y: 800 }];
  const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));
  const inEllipse = (x, y, cx, cy, rx, ry) =>
    ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;
  const isFace = (x, y) => Number.isFinite(x) && Number.isFinite(y) &&
    inEllipse(x, y, FACE.x, FACE.y, FACE.rx, FACE.ry) &&
    !EYES.some(eye => inEllipse(x, y, eye.x, eye.y, 70, 55));

  // Shared sampling cells make fast and slow pointers cover the same area.
  // Excluding eyelids also prevents the player from needing to rub the eyes.
  const CELLS = [];
  for (let y = 547; y <= 903; y += 36) {
    for (let x = 157; x <= 517; x += 36) {
      if (isFace(x, y)) CELLS.push(Object.freeze({ x, y }));
    }
  }
  const COMPLETE_AT = Math.ceil(CELLS.length * 0.9);
  const blankCoverage = () => STEPS.map(() => Array(CELLS.length).fill(0));
  const fraction = row => Math.min(1, row.reduce((sum, value) => sum + value, 0) / COMPLETE_AT);

  class FacialCare {
    constructor() {
      this.canvas = canvas;
      this.rig = null;
      this.bodyShape = null;
      this.coverage = blankCoverage();
      this.stageIndex = 0;
      this.selectedTool = STEPS[0].id;
      this.active = false;
      this.pointerId = null;
      this.lastPoint = null;
      this.frame = 0;
      this.pulseFrame = 0;
      this.pulseUntil = 0;
      this.pulsePoint = null;
      this.lastNotice = "";
      this.reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches || false;
      this.originalLabel = canvas.getAttribute("aria-label");
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
      canvas.addEventListener("pointerup", event => this.pointerUp(event));
      canvas.addEventListener("pointercancel", event => this.pointerUp(event));
      canvas.addEventListener("lostpointercapture", event => this.pointerUp(event));
      canvas.addEventListener("keydown", event => this.keyDown(event));
      window.addEventListener("blur", () => this.endStroke());
      window.addEventListener("pagehide", () => { this.endStroke(); this.save(); });
      document.addEventListener("visibilitychange", () => {
        if (document.hidden) { this.endStroke(); this.save(); }
      });
      window.addEventListener("dresslab:room-change", () => this.syncActive());
      window.addEventListener("dresslab:care-tab-change", () => this.syncActive());
      window.addEventListener("dresslab:care-tool-select", event => {
        if (event.detail?.tab !== "facial") return;
        this.endStroke();
        this.selectedTool = event.detail.tool;
        this.publish(this.toolMessage());
      });
      window.addEventListener("dresslab:facial-reset", () => this.reset());
    }

    bind(rig, bodyShape) {
      if (this.rig && this.rig !== rig) this.rig.facialCare = null;
      this.rig = rig;
      this.bodyShape = bodyShape;
      rig.facialCare = this;
      this.syncActive();
      this.requestRender();
      return this;
    }

    restore() {
      try {
        const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
        if (saved?.version !== 1 || !Array.isArray(saved.coverage) ||
            saved.coverage.length !== STEPS.length) return;
        const valid = saved.coverage.every(row => Array.isArray(row) &&
          row.length === CELLS.length && row.every(value => value === 0 || value === 1));
        if (!valid) return;
        // Re-derive stage order from coverage; never trust a stored stage index.
        for (let i = 0; i < STEPS.length; i++) {
          this.coverage[i] = saved.coverage[i].slice();
          if (fraction(this.coverage[i]) < 1) break;
          this.coverage[i].fill(1);
          this.stageIndex = i + 1;
        }
      } catch (_) { /* Storage can be blocked or contain an older schema. */ }
      this.selectedTool = STEPS[this.stageIndex]?.id || STEPS.at(-1).id;
    }

    save() {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, coverage: this.coverage }));
      } catch (_) { /* The current session remains playable without storage. */ }
    }

    getState() {
      const completed = this.stageIndex >= STEPS.length;
      return {
        active: this.active,
        ready: Boolean(this.rig),
        stage: STEPS[this.stageIndex]?.id || null,
        stageIndex: this.stageIndex,
        selectedTool: this.selectedTool,
        progress: completed ? 1 : fraction(this.coverage[this.stageIndex]),
        completed,
        stages: STEPS.map((step, index) => ({
          id: step.id, progress: fraction(this.coverage[index]), complete: index < this.stageIndex
        })),
        message: this.lastNotice || this.toolMessage()
      };
    }

    toolMessage() {
      if (!this.rig) return "얼굴을 준비하고 있어.\n잠깐만 기다려 줘.";
      if (this.stageIndex >= STEPS.length) return "페이셜 케어 완료!\n촉촉하게 마무리됐어.";
      const next = STEPS[this.stageIndex];
      if (this.selectedTool !== next.id) return next.label + " 차례야.\n선반에서 해당 도구를 골라 줘.";
      return next.hint;
    }

    publish(message) {
      this.lastNotice = message || this.toolMessage();
      window.dispatchEvent(new CustomEvent("dresslab:facial-progress", { detail: this.getState() }));
    }

    syncActive() {
      this.endStroke();
      const wasActive = this.active;
      this.active = Boolean(this.rig) && window.DressLabRooms?.current === "care" &&
        window.DressLabCareRoom?.currentTab === "facial";
      canvas.dataset.facialActive = String(this.active);
      if (this.active) {
        canvas.tabIndex = 0;
        canvas.setAttribute("role", "button");
        canvas.setAttribute("aria-label", "페이셜 케어 얼굴. 도구를 고른 뒤 얼굴을 문지르거나, Enter 또는 스페이스 키로 조금씩 케어한다.");
        if (!wasActive) this.selectCurrentTool();
      } else {
        canvas.removeAttribute("tabindex");
        canvas.setAttribute("role", "img");
        canvas.setAttribute("aria-label", this.originalLabel || "기본 캐릭터");
      }
      this.publish();
      this.requestRender();
    }

    selectCurrentTool() {
      const id = STEPS[this.stageIndex]?.id || STEPS.at(-1).id;
      this.selectedTool = id;
      window.DressLabCareRoom?.setTool(id);
    }

    reset() {
      this.endStroke();
      this.coverage = blankCoverage();
      this.stageIndex = 0;
      this.pulseUntil = 0;
      this.selectCurrentTool();
      this.save();
      this.publish();
      this.requestRender();
    }

    // getBoundingClientRect includes CSS close-up, artboard scale and resize.
    // The remaining inverses undo the rig transforms in reverse draw order.
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

    canTreat() {
      return this.active && this.stageIndex < STEPS.length &&
        this.selectedTool === STEPS[this.stageIndex].id;
    }

    pointerDown(event) {
      if (!this.active || event.isPrimary === false ||
          (event.button !== undefined && event.button !== 0) || this.pointerId !== null) return;
      const point = this.clientToFace(event.clientX, event.clientY);
      if (!point || !isFace(point.x, point.y)) return;
      if (!this.canTreat()) { this.publish(); return; }
      event.preventDefault();
      this.pointerId = event.pointerId;
      this.lastPoint = point;
      try { canvas.setPointerCapture(event.pointerId); } catch (_) { /* optional */ }
      this.moveCursor(event);
      this.applyPoint(point);
    }

    pointerMove(event) {
      if (!this.active || this.pointerId !== event.pointerId || !this.canTreat()) return;
      event.preventDefault();
      const point = this.clientToFace(event.clientX, event.clientY);
      if (!point || !isFace(point.x, point.y)) {
        this.lastPoint = null;
        this.cursor.hidden = true;
        return;
      }
      this.moveCursor(event);
      const previous = this.lastPoint || point;
      const count = Math.min(40, Math.max(1, Math.ceil(Math.hypot(point.x - previous.x, point.y - previous.y) / 16)));
      // Interpolation prevents fast strokes from leaving gaps between events.
      // Each stage finishes the stroke, so one drag cannot skip ahead.
      for (let i = 1; i <= count && this.pointerId !== null; i++) {
        this.applyPoint({
          x: previous.x + (point.x - previous.x) * i / count,
          y: previous.y + (point.y - previous.y) * i / count
        });
      }
      if (this.pointerId !== null) this.lastPoint = point;
    }

    pointerUp(event) {
      if (this.pointerId !== event.pointerId) return;
      this.endStroke();
      this.save();
    }

    endStroke() {
      if (this.pointerId !== null) this.save();
      this.pointerId = null;
      this.lastPoint = null;
      this.cursor.hidden = true;
      // Eyes share this canvas's pointer capture; let pointerup release it.
    }

    moveCursor(event) {
      const rect = document.getElementById("artboard").getBoundingClientRect();
      const src = "./assets/care/facial/" + this.selectedTool + ".png";
      if (this.cursor.getAttribute("src") !== src) this.cursor.src = src;
      this.cursor.style.left = (event.clientX - rect.left) + "px";
      this.cursor.style.top = (event.clientY - rect.top) + "px";
      this.cursor.hidden = false;
    }

    keyDown(event) {
      if (!this.active || !["Enter", " "].includes(event.key)) return;
      event.preventDefault();
      if (event.repeat) return;
      if (!this.canTreat()) { this.publish(); return; }
      const row = this.coverage[this.stageIndex];
      const index = row.findIndex(value => !value);
      if (index >= 0) {
        this.applyPoint(CELLS[index]);
        this.save();
      }
    }

    applyPoint(point) {
      if (!this.canTreat() || !isFace(point.x, point.y)) return false;
      const row = this.coverage[this.stageIndex];
      const radius = STEPS[this.stageIndex].radius;
      let changed = false;
      CELLS.forEach((cell, index) => {
        if (!row[index] && Math.hypot(cell.x - point.x, cell.y - point.y) <= radius) {
          row[index] = 1;
          changed = true;
        }
      });
      if (!changed) return false;
      this.pulsePoint = point;
      this.pulseUntil = performance.now() + (this.reducedMotion ? 0 : 360);
      if (fraction(row) >= 1) {
        row.fill(1);
        this.stageIndex++;
        this.endStroke();
        this.selectCurrentTool();
        this.save();
        if (this.stageIndex === STEPS.length) {
          window.dispatchEvent(new CustomEvent("dresslab:facial-complete", { detail: this.getState() }));
        }
      }
      this.publish();
      this.requestRender();
      this.animatePulse();
      return true;
    }

    requestRender() {
      if (!this.rig || this.frame) return;
      this.frame = requestAnimationFrame(() => {
        this.frame = 0;
        this.rig?.render();
      });
    }

    animatePulse() {
      if (this.reducedMotion || this.pulseFrame || !this.active || document.hidden) return;
      const tick = () => {
        this.pulseFrame = 0;
        this.requestRender();
        if (this.active && !document.hidden && performance.now() < this.pulseUntil) {
          this.pulseFrame = requestAnimationFrame(tick);
        }
      };
      this.pulseFrame = requestAnimationFrame(tick);
    }

    clipFace(ctx) {
      ctx.beginPath();
      ctx.ellipse(FACE.x, FACE.y, FACE.rx, FACE.ry, 0, 0, Math.PI * 2);
      // evenodd cuts holes out for the eyes without changing face geometry.
      EYES.forEach(eye => {
        ctx.moveTo(eye.x + 70, eye.y);
        ctx.ellipse(eye.x, eye.y, 70, 55, 0, 0, Math.PI * 2);
      });
      ctx.clip("evenodd");
    }

    draw(ctx) {
      const hydration = fraction(this.coverage[2]);
      if (!this.active && hydration <= 0) return;
      ctx.save();
      const shape = this.bodyShape;
      if (shape?.headNeckAnchors) {
        const { x, jawY } = shape.headNeckAnchors;
        const scale = shape.head / 100;
        ctx.translate(x, jawY + shape.neckOffsetY());
        ctx.scale(scale, scale);
        ctx.translate(-x, -jawY);
      }
      this.clipFace(ctx);

      if (this.active) {
        // Cosmetic dust is local to the care view and disappears with rinsing.
        CELLS.forEach((cell, i) => {
          if (i % 7 !== 2 || this.coverage[1][i]) return;
          ctx.fillStyle = "rgba(171, 130, 124, .22)";
          ctx.beginPath();
          ctx.ellipse(cell.x + 3, cell.y - 2, 9, 6, .3, 0, Math.PI * 2);
          ctx.fill();
        });
        // Overlapping foam clusters follow the touched cells and are removed
        // locally by the towel rather than fading the entire face at once.
        CELLS.forEach((cell, i) => {
          if (!this.coverage[0][i] || this.coverage[1][i]) return;
          ctx.fillStyle = "rgba(248, 255, 253, .9)";
          ctx.strokeStyle = "rgba(161, 197, 193, .6)";
          ctx.lineWidth = 1.1;
          const bubbles = [[-10, 0, 17], [10, 3, 16], [0, -10, 18]];
          bubbles.forEach(([dx, dy, r]) => {
            ctx.beginPath();
            ctx.arc(cell.x + dx, cell.y + dy, r + i % 3, 0, Math.PI * 2);
            ctx.fill();
          });
          ctx.beginPath();
          ctx.arc(cell.x + 10, cell.y - 10, 7, Math.PI, Math.PI * 1.65);
          ctx.stroke();
        });
        CELLS.forEach((cell, i) => {
          if (this.coverage[2][i] && !this.coverage[3][i] && i % 3 === 0) {
            ctx.fillStyle = "rgba(195, 228, 232, .42)";
            ctx.beginPath();
            ctx.ellipse(cell.x, cell.y, 10, 15, .35, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = "rgba(255, 255, 255, .65)";
            ctx.beginPath(); ctx.arc(cell.x - 3, cell.y - 5, 2.7, 0, Math.PI * 2); ctx.fill();
          }
          if (this.coverage[3][i] && !this.coverage[4][i] && i % 2 === 0) {
            ctx.fillStyle = "rgba(255, 249, 242, .61)";
            ctx.beginPath();
            ctx.ellipse(cell.x, cell.y, 18, 6, -.35, 0, Math.PI * 2);
            ctx.fill();
          }
        });
      }

      if (hydration > 0) {
        // A subtle transparent sheen keeps the user's chosen skin color.
        [[178, 855], [480, 855], [330, 590]].forEach(([x, y], i) => {
          const glow = ctx.createRadialGradient(x, y, 1, x, y, i === 2 ? 54 : 32);
          glow.addColorStop(0, "rgba(255, 255, 255, " + (0.2 * hydration) + ")");
          glow.addColorStop(1, "rgba(255, 255, 255, 0)");
          ctx.fillStyle = glow;
          ctx.beginPath(); ctx.arc(x, y, i === 2 ? 54 : 32, 0, Math.PI * 2); ctx.fill();
        });
      }

      if (this.active && this.stageIndex >= STEPS.length) {
        [[210, 650, 7], [437, 675, 6], [332, 867, 5]].forEach(([x, y, size]) => {
          ctx.strokeStyle = "rgba(255,255,255,.85)";
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(x - size, y); ctx.lineTo(x + size, y);
          ctx.moveTo(x, y - size); ctx.lineTo(x, y + size);
          ctx.stroke();
        });
      }

      const remaining = this.pulseUntil - performance.now();
      if (this.active && !this.reducedMotion && remaining > 0 && this.pulsePoint) {
        ctx.strokeStyle = "rgba(149, 192, 181, " + (remaining / 360 * 0.55) + ")";
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(this.pulsePoint.x, this.pulsePoint.y, 23 + (1 - remaining / 360) * 24, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  window.DressLabFacialCare = new FacialCare();
})();
