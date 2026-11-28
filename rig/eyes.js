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
  const FACE_BOUNDS = Object.freeze({ left: 135, right: 523 });
  const DEFAULT_SHAPE = Object.freeze({ id: "eyes01", label: "기본", box: BOX, eye: EYE,
    sources: SOURCES, faceBounds: FACE_BOUNDS, defaultColor: "#9F2C3E" });
  const APPEARANCE_LIMITS = Object.freeze({ eyeSize: [75, 125], eyeSpacing: [75, 125] });
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
    const data = sprite.getContext("2d").getImageData(0, 0, sprite.width, sprite.height).data;
    const alpha = new Uint8Array(sprite.width * sprite.height);
    for (let i = 0; i < alpha.length; i++) alpha[i] = data[i * 4 + 3];
    return alpha;
  }

  function alphaBounds(alpha, from, to, box) {
    let x0 = to, x1 = from, y0 = box.h, y1 = 0;
    for (let y = 0; y < box.h; y++) {
      for (let x = from; x < to; x++) {
        if (alpha[y * box.w + x] < 8) continue;
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
  function distanceField(alpha, box) {
    const w = box.w, h = box.h, d = new Float32Array(w * h), diag = Math.SQRT2;
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

  function clearance(field, x, y, box) {
    // Bilinear sampling in pixel-centre coordinates.
    const u = x - 0.5, v = y - 0.5;
    const ix = Math.floor(u), iy = Math.floor(v);
    if (ix < 0 || iy < 0 || ix >= box.w - 1 || iy >= box.h - 1) return 0;
    const fx = u - ix, fy = v - iy, i = iy * box.w + ix;
    const a = field[i] * (1 - fx) + field[i + 1] * fx;
    const b = field[i + box.w] * (1 - fx) + field[i + box.w + 1] * fx;
    return Math.max(0, (a * (1 - fy) + b * fy) * 0.9 - 1);
  }

  function visibleClearance(eye, masks, x, y, dx, dy, sx, sy) {
    // Inverse of the exact drawing transform of this eye's pupil.
    const px = eye.pupil.cx + (x - eye.pupil.cx - dx) / sx;
    const py = eye.pupil.cy + (y - eye.pupil.cy - dy) / sy;
    return Math.min(clearance(masks.sclera, x, y, masks.box),
      clearance(masks.pupil, px, py, masks.box) * Math.min(sx, sy));
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
      this.box = { ...BOX };
      this.eye = { ...EYE };
      this.faceBounds = { ...FACE_BOUNDS };
      this.appearance = { eyeSize: 100, eyeSpacing: 100, eyeColor: null, eyeShape: "eyes01" };
      this.limits = APPEARANCE_LIMITS;
      this.shapeRequest = 0;
      this.disposed = false;
      this.sourcePupil = null;
      this.pupilPixels = null;
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

    getAppearance() { return { ...this.appearance }; }

    getShapes() {
      const entries = window.DressLabEyeShapes;
      const seen = new Set();
      const shapes = Array.isArray(entries) ? entries.filter(shape => {
        if (!shape || typeof shape !== "object" || typeof shape.id !== "string" ||
            !shape.id.trim() || typeof shape.label !== "string" || !shape.label.trim() ||
            seen.has(shape.id)) return false;
        seen.add(shape.id);
        return true;
      }) : [];
      return shapes.length ? shapes : [DEFAULT_SHAPE];
    }

    setAppearance(patch) {
      if (!patch || typeof patch !== "object" || this.disposed) return false;
      const next = { ...this.appearance };
      for (const [key, [min, max]] of Object.entries(APPEARANCE_LIMITS)) {
        if (patch[key] === undefined) continue;
        const value = Number(patch[key]);
        if (!Number.isFinite(value)) return false;
        next[key] = Math.round(clamp(value, min, max));
      }
      if (Object.prototype.hasOwnProperty.call(patch, "eyeColor")) {
        if (patch.eyeColor === null) next.eyeColor = null;
        else {
          const match = /^#([0-9a-f]{6})$/i.exec(String(patch.eyeColor));
          if (!match) return false;
          next.eyeColor = "#" + match[1].toUpperCase();
        }
      }
      const colorChanged = next.eyeColor !== this.appearance.eyeColor;
      let tinted = null;
      try {
        if (this.eyeParts) this.constrainSpacing(next, this.eyeParts, this.box, this.faceBounds);
        if (colorChanged && this.sprites) {
          tinted = this.tintPupil(this.sourcePupil, this.box, next.eyeColor, this.pupilPixels);
        }
      } catch (error) {
        console.warn("눈 색을 적용하지 못했어:", error);
        return false;
      }
      this.appearance = next;
      if (tinted) {
        this.sprites.pupil = tinted.sprite;
        this.pupilPixels = tinted.pixels;
      }
      this.layerKey = null;
      this.rig.render();
      return true;
    }

    constrainSpacing(appearance, parts, box, bounds) {
      const size = appearance.eyeSize / 100;
      const left = parts[0], right = parts[1];
      const centre = box.x + (left.sclera.cx + right.sclera.cx) / 2;
      const halfDistance = (right.sclera.cx - left.sclera.cx) / 2;
      const leftInner = Math.max(left.sclera.x1, left.eyelashes.x1) - left.sclera.cx;
      const rightInner = right.sclera.cx - Math.min(right.sclera.x0, right.eyelashes.x0);
      const leftOuter = left.sclera.cx - Math.min(left.sclera.x0, left.eyelashes.x0);
      const rightOuter = Math.max(right.sclera.x1, right.eyelashes.x1) - right.sclera.cx;
      const nearest = ((leftInner + rightInner) * size / 2 + 6) / halfDistance * 100;
      const farthest = Math.min(centre - bounds.left - leftOuter * size,
        bounds.right - centre - rightOuter * size) / halfDistance * 100;
      const low = Math.max(APPEARANCE_LIMITS.eyeSpacing[0], Math.ceil(nearest));
      const high = Math.min(APPEARANCE_LIMITS.eyeSpacing[1], Math.floor(farthest));
      if (high < low) throw new Error("이 눈 모양은 현재 크기로 얼굴 안에 배치할 수 없어");
      appearance.eyeSpacing = clamp(appearance.eyeSpacing, low, high);
      return appearance;
    }

    // Tint only the iris layer. Original alpha and the source light/dark
    // pattern survive every edit, and null restores the exact source canvas.
    tintPupil(sourcePupil, box, color, cachedPixels) {
      if (color === null) return { sprite: sourcePupil, pixels: cachedPixels };
      const { w, h } = box;
      const pupilPixels = cachedPixels || sourcePupil.getContext("2d").getImageData(0, 0, w, h);
      const tinted = document.createElement("canvas");
      tinted.width = w; tinted.height = h;
      const ctx = tinted.getContext("2d");
      if (!ctx) throw new Error("눈 색상용 Canvas를 사용할 수 없어");
      const data = ctx.createImageData(w, h);
      data.data.set(pupilPixels.data);
      const pixels = data.data, source = pupilPixels.data;
      const histogram = new Uint32Array(256);
      let count = 0;
      for (let i = 0; i < source.length; i += 4) {
        if (source[i + 3] < 160) continue;
        histogram[Math.max(source[i], source[i + 1], source[i + 2])]++;
        count++;
      }
      let reference = 159, cumulative = 0;
      for (let i = 0; i < 256 && count; i++) {
        cumulative += histogram[i];
        if (cumulative >= count * 0.6) { reference = clamp(i, 48, 224); break; }
      }
      const rgb = [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16));
      for (let i = 0; i < pixels.length; i += 4) {
        if (!source[i + 3]) continue;
        const high = Math.max(source[i], source[i + 1], source[i + 2]);
        const low = Math.min(source[i], source[i + 1], source[i + 2]);
        // Neutral dark pupils/linework remain neutral and dark.
        if (high < 72 && high - low < 15) continue;
        const shade = high / reference;
        const light = clamp((high - reference) / (255 - reference), 0, 1) * 0.65;
        for (let channel = 0; channel < 3; channel++) {
          pixels[i + channel] = Math.round(shade <= 1 ? rgb[channel] * shade :
            rgb[channel] + (255 - rgb[channel]) * light);
        }
      }
      ctx.putImageData(data, 0, 0);
      return { sprite: tinted, pixels: pupilPixels };
    }

    async loadShapeAssets(definition) {
      const box = { ...definition.box }, eye = { ...definition.eye };
      const faceBounds = { ...FACE_BOUNDS, ...definition.faceBounds };
      if (!Number.isFinite(faceBounds.left) || !Number.isFinite(faceBounds.right) ||
        faceBounds.left < 0 || faceBounds.right > this.canvas.width || faceBounds.left >= faceBounds.right) {
        throw new Error("눈을 배치할 얼굴 범위를 확인해 줘");
      }
      for (const key of ["x", "y", "w", "h"]) {
        if (!Number.isInteger(box[key])) throw new Error("눈 모양 영역은 정수 좌표여야 해");
      }
      if (box.w <= 0 || box.h <= 0 || box.x < 0 || box.y < 0 ||
        box.x + box.w > this.canvas.width || box.y + box.h > this.canvas.height) {
        throw new Error("눈 모양 영역이 기본 캔버스 밖에 있어");
      }
      if (!["x", "y", "lidBottom", "maxX", "maxY"].every(key => Number.isFinite(eye[key])) ||
        eye.x <= box.x || eye.x >= box.x + box.w || eye.maxX <= 0 || eye.maxY <= 0) {
        throw new Error("눈 모양의 중심과 이동 범위를 확인해 줘");
      }
      const entries = await Promise.all(["sclera", "pupil", "highlights", "eyelashes"].map(async name => {
        const src = definition.sources?.[name];
        if (typeof src !== "string" || !src) throw new Error("눈 파츠 경로가 없어: " + name);
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
        trimmed.width = box.w; trimmed.height = box.h;
        const ctx = trimmed.getContext("2d");
        if (!ctx) throw new Error("눈 합성용 Canvas를 사용할 수 없어");
        ctx.drawImage(image, box.x, box.y, box.w, box.h, 0, 0, box.w, box.h);
        return [name, trimmed];
      }));
      const sprites = Object.fromEntries(entries);
      const alpha = Object.fromEntries(["sclera", "pupil", "highlights", "eyelashes"].map(
        name => [name, readAlpha(sprites[name])]));
      const middle = Math.round(eye.x - box.x);
      const eyeParts = [[0, middle], [middle, box.w]].map(([from, to]) => {
        const sclera = alphaBounds(alpha.sclera, from, to, box);
        const pupil = alphaBounds(alpha.pupil, from, to, box);
        const highlight = alphaBounds(alpha.highlights, from, to, box);
        const eyelashes = alphaBounds(alpha.eyelashes, from, to, box);
        if (!sclera || !pupil || !highlight) throw new Error("눈 파츠의 좌우 알파 영역을 찾을 수 없어");
        return { from, to, sclera, pupil, highlight, eyelashes: eyelashes || sclera };
      });
      const eyeMasks = { box, sclera: distanceField(alpha.sclera, box), pupil: distanceField(alpha.pupil, box) };
      return { box, eye, sprites, eyeParts, eyeMasks, faceBounds };
    }

    async setShape(id) {
      const request = ++this.shapeRequest;
      if (this.disposed) return false;
      const definition = this.getShapes().find(shape => shape.id === id);
      if (!definition) return false;
      // Even reselecting the active set cancels an older pending request.
      if (this.sprites && this.appearance.eyeShape === id) return true;
      try {
        const loaded = await this.loadShapeAssets(definition);
        if (request !== this.shapeRequest || this.disposed) return false;
        // Stage every allocation/tint before publishing the new shape. A bad
        // asset, tainted canvas or unavailable context leaves the old eyes intact.
        const appearance = this.constrainSpacing({ ...this.appearance, eyeShape: id },
          loaded.eyeParts, loaded.box, loaded.faceBounds);
        loaded.sourcePupil = loaded.sprites.pupil;
        const tinted = this.tintPupil(loaded.sourcePupil, loaded.box, this.appearance.eyeColor, null);
        loaded.sprites.pupil = tinted.sprite;
        loaded.pupilPixels = tinted.pixels;
        loaded.irisBuffer = document.createElement("canvas");
        loaded.irisBuffer.width = loaded.box.w; loaded.irisBuffer.height = loaded.box.h;
        loaded.irisContext = loaded.irisBuffer.getContext("2d");
        loaded.highlightBuffer = document.createElement("canvas");
        loaded.highlightBuffer.width = loaded.box.w; loaded.highlightBuffer.height = loaded.box.h;
        loaded.highlightContext = loaded.highlightBuffer.getContext("2d");
        if (!loaded.irisContext || !loaded.highlightContext) throw new Error("눈 합성용 Canvas를 사용할 수 없어");
        const oldEye = this.eye;
        Object.assign(this, loaded);
        this.appearance = appearance;
        // Retain gaze direction when the selected artwork has a new range.
        const rx = this.eye.maxX / oldEye.maxX, ry = this.eye.maxY / oldEye.maxY;
        for (const key of ["x", "hx", "targetX", "vx", "hvx"]) this[key] *= rx;
        for (const key of ["y", "hy", "targetY", "vy", "hvy"]) this[key] *= ry;
        this.layerKey = null;
        this.rig.render();
        return true;
      } catch (error) {
        if (request === this.shapeRequest && !this.disposed) console.warn("눈 모양을 불러오지 못했어:", error);
        return false;
      }
    }

    async load() {
      const first = this.getShapes()[0];
      if (!first || !await this.setShape(first.id)) throw new Error("기본 눈을 불러오지 못했어");
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
      const BOX = this.box;
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
      const BOX = this.box, EYE = this.eye;
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
      this.prepareEyeLayers();
      const size = this.appearance.eyeSize / 100;
      const spacing = this.appearance.eyeSpacing / 100;
      const middle = (this.eyeParts[0].sclera.cx + this.eyeParts[1].sclera.cx) / 2;
      const halfDistance = (this.eyeParts[1].sclera.cx - this.eyeParts[0].sclera.cx) / 2;
      // setAppearance stores the actual constrained spacing, keeping lashes
      // separated and inside the face at every supported size.
      const safeDistance = halfDistance * spacing;
      const closed = clamp(this.blinkValue, -0.12, BLINK_DEPTH);
      const openness = 1 - closed;
      for (let i = 0; i < this.eyeParts.length; i++) {
        const part = this.eyeParts[i];
        const cx = BOX.x + part.sclera.cx, cy = BOX.y + part.sclera.cy;
        const targetX = BOX.x + middle + (i ? 1 : -1) * safeDistance;
        ctx.save();
        ctx.translate(targetX, cy);
        ctx.scale(size, size);
        ctx.translate(-cx, -cy);
        // Size and separation affect every layer together; blinking remains
        // inside each eye, so its aperture and highlight mask cannot diverge.
        ctx.translate(cx, EYE.lidBottom);
        ctx.scale(1 + Math.max(0, closed) * 0.015, openness);
        ctx.translate(-cx, -EYE.lidBottom);
        for (const layer of [this.sprites.sclera, this.irisBuffer,
          this.highlightBuffer, this.sprites.eyelashes]) {
          ctx.drawImage(layer, part.from, 0, part.to - part.from, BOX.h,
            BOX.x + part.from, BOX.y, part.to - part.from, BOX.h);
        }
        ctx.restore();
      }
      ctx.restore();
    }

    // Return eye centre in the displayed artboard while respecting idle
    // root bob, torso angle, head size and neck length.
    eyeInCanvas() {
      let { x, y } = this.eye;
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
      const EYE = this.eye;
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
      const EYE = this.eye;
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
      this.disposed = true;
      this.shapeRequest++;
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
  window.DressLabEyesConfig = { BOX, EYE, SOURCES, APPEARANCE_LIMITS };
})();
