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
  const BLINK_DEPTH = 0.8;
  const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));
  const easeOut = t => 1 - Math.pow(1 - clamp(t, 0, 1), 3);

  // Exact underdamped spring step: consistent overshoot on both 60 Hz and
  // slower mobile displays, without unstable Euler integration.
  function spring(value, velocity, target, dt, speed, damping) {
    const displacement = value - target;
    const decay = speed * damping;
    const frequency = speed * Math.sqrt(1 - damping * damping);
    const phase = frequency * dt;
    const c = Math.cos(phase), s = Math.sin(phase);
    const envelope = Math.exp(-decay * dt);
    const b = (velocity + decay * displacement) / frequency;
    const offset = displacement * c + b * s;
    return [target + envelope * offset,
      envelope * (frequency * (-displacement * s + b * c) - decay * offset)];
  }

  // Read each registered PNG's alpha once at load time. No pixel readbacks
  // occur during gaze animation.
  function readAlpha(sprite) {
    const data = sprite.getContext("2d").getImageData(0, 0, BOX.w, BOX.h).data;
    const alpha = new Uint8Array(BOX.w * BOX.h);
    for (let i = 0; i < alpha.length; i++) alpha[i] = data[i * 4 + 3];
    return alpha;
  }

  function alphaBounds(alpha, from, to) {
    let x0 = to, x1 = from, y0 = BOX.h, y1 = 0;
    for (let y = 0; y < BOX.h; y++) {
      for (let x = from; x < to; x++) {
        if (alpha[y * BOX.w + x] < 8) continue;
        x0 = Math.min(x0, x); x1 = Math.max(x1, x + 1);
        y0 = Math.min(y0, y); y1 = Math.max(y1, y + 1);
      }
    }
    if (x1 <= x0 || y1 <= y0) return null;
    return { x0, x1, y0, y1, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2,
      w: x1 - x0, h: y1 - y0 };
  }

  // Two-pass chamfer distance to the non-opaque interior boundary.
  // A conservative factor and pixel margin below correct diagonal error.
  function distanceField(alpha) {
    const w = BOX.w, h = BOX.h, d = new Float32Array(w * h), diag = Math.SQRT2;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        d[i] = x && y && x < w - 1 && y < h - 1 && alpha[i] >= 160 ? w + h : 0;
      }
    }
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        d[i] = Math.min(d[i], d[i - 1] + 1, d[i - w] + 1,
          d[i - w - 1] + diag, d[i - w + 1] + diag);
      }
    }
    for (let y = h - 2; y >= 1; y--) {
      for (let x = w - 2; x >= 1; x--) {
        const i = y * w + x;
        d[i] = Math.min(d[i], d[i + 1] + 1, d[i + w] + 1,
          d[i + w - 1] + diag, d[i + w + 1] + diag);
      }
    }
    return d;
  }

  function clearance(field, x, y) {
    // Bilinear sampling in pixel-centre coordinates.
    const u = x - 0.5, v = y - 0.5;
    const ix = Math.floor(u), iy = Math.floor(v);
    if (ix < 0 || iy < 0 || ix >= BOX.w - 1 || iy >= BOX.h - 1) return 0;
    const fx = u - ix, fy = v - iy, i = iy * BOX.w + ix;
    const a = field[i] * (1 - fx) + field[i + 1] * fx;
    const b = field[i + BOX.w] * (1 - fx) + field[i + BOX.w + 1] * fx;
    return Math.max(0, (a * (1 - fy) + b * fy) * 0.9 - 1);
  }

  function visibleClearance(eye, masks, x, y, dx, dy, sx, sy) {
    // Inverse of the exact drawing transform of this eye's pupil.
    const px = eye.pupil.cx + (x - eye.pupil.cx - dx) / sx;
    const py = eye.pupil.cy + (y - eye.pupil.cy - dy) / sy;
    return Math.min(clearance(masks.sclera, x, y),
      clearance(masks.pupil, px, py) * Math.min(sx, sy));
  }

  function fitHighlight(eye, masks, preferredX, preferredY, dx, dy, sx, sy, size) {
    const h = eye.highlight, baseRadius = Math.hypot(h.w, h.h) / 2;
    // Keep the whole glint visible, not just its centre. Slide it into
    // sclera ∩ moving pupil before resorting to shrinking.
    const safe = (x, y, r) => visibleClearance(eye, masks, x, y, dx, dy, sx, sy) >= r;
    for (const factor of [1, 0.85, 0.65, 0.45, 0.25]) {
      const scale = size * factor, radius = baseRadius * scale;
      if (safe(preferredX, preferredY, radius)) {
        return { x: preferredX, y: preferredY, scale, radius };
      }
      let best = null, min = Infinity;
      const b = eye.sclera;
      // Each eye is constrained independently; the two apertures differ.
      for (let y = b.y0 + 0.5; y < b.y1; y++) {
        for (let x = b.x0 + 0.5; x < b.x1; x++) {
          const cost = (x - preferredX) ** 2 + (y - preferredY) ** 2;
          if (cost >= min || !safe(x, y, radius)) continue;
          min = cost; best = { x, y };
        }
      }
      if (!best) continue;
      // Recover subpixel motion instead of snapping to the pixel grid.
      let lo = 0, hi = 1;
      for (let i = 0; i < 8; i++) {
        const t = (lo + hi) / 2;
        const x = best.x + (preferredX - best.x) * t;
        const y = best.y + (preferredY - best.y) * t;
        if (safe(x, y, radius)) lo = t; else hi = t;
      }
      return { x: best.x + (preferredX - best.x) * lo,
        y: best.y + (preferredY - best.y) * lo, scale, radius };
    }
    return null;
  }

  function blinkAmount(elapsed) {
    if (elapsed < 95) return BLINK_DEPTH * easeOut(elapsed / 95);
    if (elapsed < 142) return BLINK_DEPTH;
    if (elapsed < 292) return BLINK_DEPTH * (1 - easeOut((elapsed - 142) / 150));
    if (elapsed < 570) {
      const t = elapsed - 292;
      // Reopen past the neutral height, then settle smoothly: a soft boing.
      return -0.16 * Math.exp(-t / 115) * Math.sin(t * 0.039) * (1 - t / 278);
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
      this.highlightBuffer = null;
      this.highlightContext = null;
      this.eyeParts = null;
      this.eyeMasks = null;
      this.highlightPlacements = [];
      this.layerKey = null;
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
      this.highlightBuffer = document.createElement("canvas");
      this.highlightBuffer.width = BOX.w;
      this.highlightBuffer.height = BOX.h;
      this.highlightContext = this.highlightBuffer.getContext("2d");
      if (!this.irisContext || !this.highlightContext) throw new Error("눈 합성용 Canvas를 사용할 수 없어");
      const alpha = Object.fromEntries(["sclera", "pupil", "highlights"].map(
        name => [name, readAlpha(this.sprites[name])]));
      const middle = Math.round(EYE.x - BOX.x);
      this.eyeParts = [[0, middle], [middle, BOX.w]].map(([from, to]) => {
        const sclera = alphaBounds(alpha.sclera, from, to);
        const pupil = alphaBounds(alpha.pupil, from, to);
        const highlight = alphaBounds(alpha.highlights, from, to);
        if (!sclera || !pupil || !highlight) throw new Error("눈 파츠의 좌우 알파 영역을 찾을 수 없어");
        return { from, to, sclera, pupil, highlight };
      });
      this.eyeMasks = { sclera: distanceField(alpha.sclera), pupil: distanceField(alpha.pupil) };
      this.rig.eyes = this;
      this.canvas.addEventListener("pointerdown", this.onDown);
      this.canvas.addEventListener("pointermove", this.onMove);
      this.canvas.addEventListener("pointerup", this.onUp);
      this.canvas.addEventListener("pointercancel", this.onUp);
      document.addEventListener("visibilitychange", this.onVisibility);
      this.scheduleBlink();
      this.rig.render();
      return this;
    }

    prepareEyeLayers() {
      const key = [this.x, this.y, this.vx, this.vy, this.targetX,
        this.hx, this.hy, this.hvx, this.hvy].join(",");
      if (this.layerKey === key) return;
      this.layerKey = key;
      const iris = this.irisContext, glint = this.highlightContext;
      for (const buffer of [iris, glint]) {
        buffer.setTransform(1, 0, 0, 1, 0, 0);
        buffer.globalCompositeOperation = "source-over";
        buffer.clearRect(0, 0, BOX.w, BOX.h);
      }

      // Horizontal boing: stretch in the direction of travel, compress as
      // the iris overshoots, then rebound. Separate pivots preserve eye spacing.
      const travel = clamp(Math.abs(this.vx) / 280, 0, 1);
      const recoil = clamp((this.x - this.targetX) * this.vx / 700, 0, 1);
      const sx = 1 + travel * 0.14 - recoil * 0.21;
      const sy = 1 - (sx - 1) * 0.55;
      const size = 1 + 0.13 * clamp(Math.hypot(this.hvx - this.vx, this.hvy - this.vy) / 330, 0, 1);
      this.highlightPlacements = [];

      for (const eye of this.eyeParts) {
        const p = eye.pupil, h = eye.highlight;
        iris.drawImage(this.sprites.pupil, eye.from, 0, eye.to - eye.from, BOX.h,
          p.cx + this.x + (eye.from - p.cx) * sx, p.cy + this.y - p.cy * sy,
          (eye.to - eye.from) * sx, BOX.h * sy);
        const desiredX = p.cx + this.x + (h.cx - p.cx) * sx +
          clamp(this.hx - this.x, -11, 11);
        const desiredY = p.cy + this.y + (h.cy - p.cy) * sy +
          clamp(this.hy - this.y, -9, 9);
        const place = fitHighlight(eye, this.eyeMasks, desiredX, desiredY,
          this.x, this.y, sx, sy, size);
        this.highlightPlacements.push(place);
        if (place) {
          glint.drawImage(this.sprites.highlights, h.x0, h.y0, h.w, h.h,
            place.x - h.w * place.scale / 2, place.y - h.h * place.scale / 2,
            h.w * place.scale, h.h * place.scale);
        }
      }

      // The final pixel mask is the *visible pupil*, not the sclera alone.
      // This guarantees no highlight can appear on the eye white.
      iris.globalCompositeOperation = "destination-in";
      iris.drawImage(this.sprites.sclera, 0, 0);
      iris.globalCompositeOperation = "source-over";
      glint.globalCompositeOperation = "destination-in";
      glint.drawImage(this.irisBuffer, 0, 0);
      glint.globalCompositeOperation = "source-over";
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
      const closed = clamp(this.blinkValue, -0.12, BLINK_DEPTH);
      const openness = 1 - closed; // 20% of the original aperture remains at peak blink.
      ctx.translate(EYE.x, EYE.lidBottom);
      ctx.scale(1 + Math.max(0, closed) * 0.015, openness);
      ctx.translate(-EYE.x, -EYE.lidBottom);

      // All composited layers share the partial-blink transform.
      this.prepareEyeLayers();
      ctx.drawImage(this.sprites.sclera, BOX.x, BOX.y);
      ctx.drawImage(this.irisBuffer, BOX.x, BOX.y);
      ctx.drawImage(this.highlightBuffer, BOX.x, BOX.y);
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
      if (this.pointerId !== null && this.pointerId !== event.pointerId) return;
      this.pointerId = event.pointerId;
      const previousX = this.targetX;
      this.pointTo(event);
      if (!this.reduced) {
        // Inertial kick against the turn; the glint then catches up elastically.
        const turn = this.targetX - previousX;
        this.hvx = clamp(this.hvx - (Math.abs(turn) > 0.5 ? clamp(turn * 3.2, -110, 110) :
          (this.targetX < 0 ? -32 : 32)), -230, 230);
        this.hvy = clamp(this.hvy - 48, -180, 180);
      }
      try { this.canvas.setPointerCapture(event.pointerId); } catch (_) { /* optional */ }
    }

    pointerMove(event) {
      // Only a deliberate press/drag changes gaze; mouse hover does not.
      if (this.pointerId !== null && this.pointerId === event.pointerId) this.pointTo(event);
    }

    pointerUp(event) {
      if (this.pointerId !== event.pointerId) return;
      this.pointerId = null;
      try { this.canvas.releasePointerCapture(event.pointerId); } catch (_) { /* optional */ }
      // Keep the last target after release or cancellation, as in Dress Lab V1.
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
      [this.x, this.vx] = spring(this.x, this.vx, this.targetX, dt, 25, 0.31);
      [this.y, this.vy] = spring(this.y, this.vy, this.targetY, dt, 23, 0.44);
      // Leave room for a visible overshoot while keeping extreme flicks bounded.
      const x = clamp(this.x, -EYE.maxX - 7.5, EYE.maxX + 7.5);
      const y = clamp(this.y, -EYE.maxY - 3.5, EYE.maxY + 3.5);
      if (x !== this.x) this.vx = 0;
      if (y !== this.y) this.vy = 0;
      this.x = x;
      this.y = y;
      [this.hx, this.hvx] = spring(this.hx, this.hvx, this.x, dt, 18, 0.36);
      [this.hy, this.hvy] = spring(this.hy, this.hvy, this.y, dt, 18, 0.39);

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
      if (!active) {
        this.x = this.hx = this.targetX;
        this.y = this.hy = this.targetY;
        this.vx = this.vy = this.hvx = this.hvy = 0;
      }
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
      document.removeEventListener("visibilitychange", this.onVisibility);
      if (this.rig.eyes === this) this.rig.eyes = null;
    }
  }

  window.DressLabEyes = DressLabEyes;
  window.DressLabEyesConfig = { BOX, EYE, SOURCES };
})();