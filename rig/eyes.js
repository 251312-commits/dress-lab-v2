/* Dress Lab V2 — transparent, registered eye sprites with elastic blinking
 * and touch/pointer gaze. No changes to the original PNG pixels or body rig.
 * The four assets share the 1206 × 2622 base-canvas coordinates.
 */
(() => {
  "use strict";

  const BOX = Object.freeze({ x: 146, y: 729, w: 368, h: 130 });
  const EYE = Object.freeze({ x: 329, y: 796, lidBottom: 844, maxX: 19, maxY: 14 });
  const SOURCES = Object.freeze({
    sclera: "./assets/eyes/Eyes01_Sclera.PNG",
    pupil: "./assets/eyes/Eyes01_Pupil.PNG",
    highlights: "./assets/eyes/Eyes01_Highlights.PNG",
    eyelashes: "./assets/eyes/Eyes01_Eyelashes.PNG"
  });
  const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));
  const easeOut = t => 1 - Math.pow(1 - clamp(t, 0, 1), 3);

  // Frame-rate-independent, underdamped-ish gaze spring; one position per axis.
  function spring(value, velocity, target, dt, speed, damping) {
    const a = speed * speed * (target - value) - 2 * damping * speed * velocity;
    const v = velocity + a * dt;
    return [value + v * dt, v];
  }

  function blinkAmount(elapsed) {
    if (elapsed < 95) return easeOut(elapsed / 95);
    if (elapsed < 142) return 1;
    if (elapsed < 292) return 1 - easeOut((elapsed - 142) / 150);
    if (elapsed < 570) {
      const t = elapsed - 292;
      // Slight overshoot after opening: 'boing', not a mechanical cut.
      return -0.065 * Math.exp(-t / 105) * Math.sin(t * 0.047 + 1.2);
    }
    return 0;
  }

  class DressLabEyes {
    constructor(rig, canvas) {
      if (!rig || !canvas || typeof rig.render !== "function") {
        throw new Error("DressLabEyes requires an initialized character rig");
      }
      this.rig = rig;
      this.canvas = canvas;
      this.bodyShape = null;
      this.motion = null;
      this.sprites = null;
      this.irisBuffer = null;
      this.irisContext = null;
      this.enabled = true;
      this.reduced = Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
      this.pointerId = null;
      this.targetX = 0;
      this.targetY = 0;
      this.x = 0;
      this.y = 0;
      this.vx = 0;
      this.vy = 0;
      this.hx = 0;
      this.hy = 0;
      this.hvx = 0;
      this.hvy = 0;
      this.blinkStart = null;
      this.blinkValue = 0;
      this.blinkTimer = 0;
      this.frameId = 0;
      this.lastFrame = null;
      this.lastPaint = 0;
      this.onFrame = time => this.step(time);
      this.onDown = event => this.pointerDown(event);
      this.onMove = event => this.pointerMove(event);
      this.onUp = event => this.pointerUp(event);
      this.onLeave = event => {
        if (event.pointerType === "mouse" && this.pointerId === null) this.centerGaze();
      };
      this.onVisibility = () => {
        if (document.hidden) {
          clearTimeout(this.blinkTimer);
          this.blinkTimer = 0;
          if (this.frameId) cancelAnimationFrame(this.frameId);
          this.frameId = 0;
          this.lastFrame = null;
          this.blinkStart = null;
          this.blinkValue = 0;
        } else {
          this.scheduleBlink();
          this.ensureFrame();
        }
      };
    }

    async load() {
      const entries = await Promise.all(Object.entries(SOURCES).map(async ([name, src]) => {
        const image = new Image();
        image.decoding = "async";
        await new Promise((resolve, reject) => {
          image.onload = resolve;
          image.onerror = () => reject(new Error("눈 에셋 로딩 실패: " + src));
          image.src = src;
        });
        if (image.naturalWidth !== this.canvas.width || image.naturalHeight !== this.canvas.height) {
          throw new Error("눈 파츠는 몸체와 동일한 1206×2622 좌표를 사용해야 해: " + src);
        }
        const trimmed = document.createElement("canvas");
        trimmed.width = BOX.w;
        trimmed.height = BOX.h;
        trimmed.getContext("2d").drawImage(image, BOX.x, BOX.y,
          BOX.w, BOX.h, 0, 0, BOX.w, BOX.h);
        return [name, trimmed];
      }));
      this.sprites = Object.fromEntries(entries);
      this.irisBuffer = document.createElement("canvas");
      this.irisBuffer.width = BOX.w;
      this.irisBuffer.height = BOX.h;
      this.irisContext = this.irisBuffer.getContext("2d");
      if (!this.irisContext) throw new Error("눈 합성용 Canvas를 사용할 수 없어");
      this.rig.eyes = this;
      this.canvas.addEventListener("pointerdown", this.onDown);
      this.canvas.addEventListener("pointermove", this.onMove);
      this.canvas.addEventListener("pointerup", this.onUp);
      this.canvas.addEventListener("pointercancel", this.onUp);
      this.canvas.addEventListener("pointerleave", this.onLeave);
      document.addEventListener("visibilitychange", this.onVisibility);
      this.scheduleBlink();
      this.rig.render();
      return this;
    }

    draw(ctx) {
      if (!this.sprites) return;
      ctx.save();
      // BodyShape deforms the Head PNG in jaw-centred coordinates. Apply the
      // identical transform to eyes INSIDE the rig's torso rotation.
      const shape = this.bodyShape;
      if (shape?.headNeckAnchors) {
        const { x, jawY } = shape.headNeckAnchors;
        const scale = shape.head / 100;
        const shift = shape.neckOffsetY();
        ctx.translate(x, jawY + shift);
        ctx.scale(scale, scale);
        ctx.translate(-x, -jawY);
      }

      // The lower eyelash stays nearly anchored while the upper eyelid folds
      // toward it. On release, the lid briefly overshoots before settling.
      const closed = clamp(this.blinkValue, -0.075, 1);
      const openness = clamp(1 - closed * 0.95, 0.05, 1.075);
      ctx.translate(EYE.x, EYE.lidBottom);
      ctx.scale(1 + Math.max(0, closed) * 0.015, openness);
      ctx.translate(-EYE.x, -EYE.lidBottom);

      if (openness > 0.16) {
        ctx.save();
        // All pupil and catchlight offsets are clipped to the real sclera
        // alpha, so looking aside never makes a detached floating iris.
        const visibility = clamp((openness - 0.16) / 0.27, 0, 1);
        ctx.globalAlpha = visibility;
        ctx.drawImage(this.sprites.sclera, BOX.x, BOX.y);
        const buffer = this.irisContext;
        buffer.setTransform(1, 0, 0, 1, 0, 0);
        buffer.globalCompositeOperation = "source-over";
        buffer.clearRect(0, 0, BOX.w, BOX.h);
        buffer.drawImage(this.sprites.pupil, this.x, this.y);
        // Catchlights follow the pupil by a few frames instead of teleporting.
        buffer.drawImage(this.sprites.highlights,
          clamp(this.hx, this.x - 2, this.x + 2),
          clamp(this.hy, this.y - 1.8, this.y + 1.8));
        buffer.globalCompositeOperation = "destination-in";
        buffer.drawImage(this.sprites.sclera, 0, 0);
        buffer.globalCompositeOperation = "source-over";
        ctx.drawImage(this.irisBuffer, BOX.x, BOX.y);
        ctx.restore();
      }
      // Original eyelash linework always remains in front of the eye whites.
      ctx.drawImage(this.sprites.eyelashes, BOX.x, BOX.y);
      ctx.restore();
    }

    // Return eye centre in the displayed artboard while respecting idle
    // root bob, torso angle, head size and neck length.
    eyeInCanvas() {
      let { x, y } = EYE;
      const shape = this.bodyShape;
      if (shape?.headNeckAnchors) {
        const anchor = shape.headNeckAnchors;
        const scale = shape.head / 100;
        x = anchor.x + (x - anchor.x) * scale;
        y = anchor.jawY + (y - anchor.jawY) * scale + shape.neckOffsetY();
      }
      const pivot = this.rig.config.pivots.torso;
      const angle = (this.rig.angles.torso || 0) * Math.PI / 180;
      const dx = x - pivot.x, dy = y - pivot.y;
      x = pivot.x + dx * Math.cos(angle) - dy * Math.sin(angle);
      y = pivot.y + dx * Math.sin(angle) + dy * Math.cos(angle);
      const root = this.rig.root;
      const anchor = this.rig.rootAnchor;
      return {
        x: (root.x || 0) + anchor.x + (x - anchor.x) * root.scaleX,
        y: (root.y || 0) + anchor.y + (y - anchor.y) * root.scaleY
      };
    }

    pointTo(event) {
      const rect = this.canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const eye = this.eyeInCanvas();
      const cx = rect.left + eye.x * rect.width / this.canvas.width;
      const cy = rect.top + eye.y * rect.height / this.canvas.height;
      let nx = clamp((event.clientX - cx) / (rect.width * 0.24), -1, 1);
      let ny = clamp((event.clientY - cy) / (rect.height * 0.16), -1, 1);
      const length = Math.hypot(nx, ny);
      if (length > 1) { nx /= length; ny /= length; }
      this.setGaze(nx, ny);
    }

    setGaze(nx, ny) {
      this.targetX = clamp(Number(nx) || 0, -1, 1) * EYE.maxX;
      this.targetY = clamp(Number(ny) || 0, -1, 1) * EYE.maxY;
      if (this.reduced) {
        this.x = this.targetX;
        this.y = this.targetY;
        this.hx = this.x;
        this.hy = this.y;
        this.rig.render();
      } else this.ensureFrame();
    }

    centerGaze() { this.setGaze(0, 0); }

    pointerDown(event) {
      if (event.button != null && event.button !== 0) return;
      this.pointerId = event.pointerId;
      this.pointTo(event);
      try { this.canvas.setPointerCapture(event.pointerId); } catch (_) { /* optional */ }
    }

    pointerMove(event) {
      if (this.pointerId === event.pointerId ||
          (this.pointerId === null && event.pointerType === "mouse")) this.pointTo(event);
    }

    pointerUp(event) {
      if (this.pointerId !== event.pointerId) return;
      this.pointerId = null;
      try { this.canvas.releasePointerCapture(event.pointerId); } catch (_) { /* optional */ }
      this.centerGaze();
    }

    blink() {
      if (!this.sprites || this.reduced || document.hidden || this.blinkStart !== null) return false;
      this.blinkStart = performance.now();
      this.ensureFrame();
      return true;
    }

    setEnabled(value) {
      this.enabled = Boolean(value);
      this.scheduleBlink();
      if (!this.enabled) { this.blinkStart = null; this.blinkValue = 0; this.rig.render(); }
    }

    scheduleBlink() {
      clearTimeout(this.blinkTimer);
      this.blinkTimer = 0;
      if (!this.enabled || this.reduced || document.hidden || !this.sprites) return;
      this.blinkTimer = setTimeout(() => {
        this.blink();
        this.scheduleBlink();
      }, 2800 + Math.random() * 2400);
    }

    ensureFrame() {
      if (this.frameId || document.hidden || this.reduced || !this.sprites) return;
      this.frameId = requestAnimationFrame(this.onFrame);
    }

    step(now) {
      this.frameId = 0;
      const dt = this.lastFrame === null ? 1 / 60 : clamp((now - this.lastFrame) / 1000, 1 / 240, 0.035);
      this.lastFrame = now;
      // The iris reacts before the highlight; damped recoil is kept inside
      // the available eye-white aperture.
      [this.x, this.vx] = spring(this.x, this.vx, this.targetX, dt, 19, 0.78);
      [this.y, this.vy] = spring(this.y, this.vy, this.targetY, dt, 19, 0.78);
      this.x = clamp(this.x, -EYE.maxX - 2, EYE.maxX + 2);
      this.y = clamp(this.y, -EYE.maxY - 2, EYE.maxY + 2);
      [this.hx, this.hvx] = spring(this.hx, this.hvx, this.x, dt, 13, 0.88);
      [this.hy, this.hvy] = spring(this.hy, this.hvy, this.y, dt, 13, 0.88);

      if (this.blinkStart !== null) {
        const elapsed = now - this.blinkStart;
        this.blinkValue = blinkAmount(elapsed);
        if (elapsed >= 570) { this.blinkStart = null; this.blinkValue = 0; }
      }
      const moving = Math.abs(this.x - this.targetX) > 0.025 ||
        Math.abs(this.y - this.targetY) > 0.025 ||
        Math.abs(this.vx) > 0.03 || Math.abs(this.vy) > 0.03 ||
        Math.abs(this.hx - this.x) > 0.03 || Math.abs(this.hy - this.y) > 0.03 ||
        Math.abs(this.hvx) > 0.04 || Math.abs(this.hvy) > 0.04;
      const active = moving || this.blinkStart !== null;
      // Existing idle/gesture motion owns the body's 30 fps renderer. If that
      // loop is paused, eyes repaint at 30 fps without starting body motion.
      if (!this.motion?.enabled && (!this.lastPaint || now - this.lastPaint >= 33 || !active)) {
        this.rig.render();
        this.lastPaint = now;
      }
      if (active) this.ensureFrame();
      else this.lastFrame = null;
    }

    dispose() {
      clearTimeout(this.blinkTimer);
      if (this.frameId) cancelAnimationFrame(this.frameId);
      this.canvas.removeEventListener("pointerdown", this.onDown);
      this.canvas.removeEventListener("pointermove", this.onMove);
      this.canvas.removeEventListener("pointerup", this.onUp);
      this.canvas.removeEventListener("pointercancel", this.onUp);
      this.canvas.removeEventListener("pointerleave", this.onLeave);
      document.removeEventListener("visibilitychange", this.onVisibility);
      if (this.rig.eyes === this) this.rig.eyes = null;
    }
  }

  window.DressLabEyes = DressLabEyes;
  window.DressLabEyesConfig = { BOX, EYE, SOURCES };
})();