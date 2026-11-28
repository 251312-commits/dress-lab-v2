/* Dress Lab V2 — face appearance and independent nose/mouth linework.
 * Coordinates match the original 1206 × 2622 Head art. The rig supplies root
 * and torso motion; this layer applies the same jaw-anchored head transform
 * as the eyes. Blinking belongs to the eyes and never deforms the nose/mouth.
 */
(() => {
  "use strict";

  const DEFAULTS = Object.freeze({
    eyeSize: 100, eyeSpacing: 100, eyeColor: null, eyeShape: "eyes01",
    noseSize: 100, mouthSize: 100
  });
  const LIMITS = Object.freeze(Object.fromEntries(
    ["eyeSize", "eyeSpacing", "noseSize", "mouthSize"].map(key =>
      [key, Object.freeze([75, 125])])));
  const EYE_KEYS = ["eyeSize", "eyeSpacing", "eyeColor"];
  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

  class DressLabFace {
    constructor(rig, bodyShape = null, eyes = null) {
      if (!rig || typeof rig.render !== "function") {
        throw new Error("DressLabFace requires an initialized character rig");
      }
      this.rig = rig;
      this.bodyShape = bodyShape;
      this.eyes = eyes;
      this.limits = LIMITS;
      this.state = { ...DEFAULTS };
      this.shapeRequest = 0;
      this.disposed = false;
      this.syncEyes();
      rig.face = this;
      rig.render();
    }

    get eyesAvailable() { return Boolean(this.eyes?.sprites); }

    get eyeShapes() {
      // Use the same fallback catalog as the renderer if its catalog script
      // is unavailable, so the default choice and reset remain functional.
      if (this.eyes?.getShapes) return this.eyes.getShapes();
      return Array.isArray(window.DressLabEyeShapes)
        ? window.DressLabEyeShapes.filter(shape => shape && typeof shape.id === "string" &&
          typeof shape.label === "string") : [];
    }

    syncEyes() {
      if (!this.eyes?.getAppearance) return;
      const appearance = this.eyes.getAppearance();
      for (const key of [...EYE_KEYS, "eyeShape"]) {
        if (appearance[key] !== undefined) this.state[key] = appearance[key];
      }
    }

    getState() {
      this.syncEyes();
      return { ...this.state };
    }

    changed() {
      window.dispatchEvent(new CustomEvent("dresslab:face-change", {
        detail: { state: this.getState() }
      }));
    }

    reportError(message) {
      window.dispatchEvent(new CustomEvent("dresslab:face-error", {
        detail: { message }
      }));
    }

    setState(patch) {
      if (this.disposed || !patch || typeof patch !== "object" || Array.isArray(patch)) return false;
      const next = this.getState();
      const eyesPatch = {};
      for (const [key, value] of Object.entries(patch)) {
        if (Object.prototype.hasOwnProperty.call(LIMITS, key)) {
          if (typeof value !== "number" || !Number.isFinite(value)) return false;
          next[key] = Math.round(clamp(value, ...LIMITS[key]));
        } else if (key === "eyeColor") {
          if (value !== null && (typeof value !== "string" || !/^#[0-9a-f]{6}$/i.test(value))) return false;
          next.eyeColor = value === null ? null : value.toUpperCase();
        } else return false;
        if (EYE_KEYS.includes(key)) eyesPatch[key] = next[key];
      }
      if (Object.keys(eyesPatch).length &&
          (!this.eyesAvailable || !this.eyes.setAppearance(eyesPatch))) return false;
      this.state = next;
      this.syncEyes(); // The eye renderer may enforce a safe gap for a wide shape.
      this.rig.render();
      this.changed();
      return true;
    }

    async selectEyeShape(id) {
      if (this.disposed || !this.eyesAvailable || !this.eyeShapes.some(shape => shape.id === id)) return false;
      const request = ++this.shapeRequest;
      try {
        const applied = await this.eyes.setShape(id);
        if (this.disposed || request !== this.shapeRequest) return false;
        this.syncEyes();
        this.changed();
        if (!applied) this.reportError("눈 모양을 불러오지 못했어. 다시 선택해 줘.");
        return applied;
      } catch (error) {
        if (!this.disposed && request === this.shapeRequest) {
          this.reportError("눈 모양을 불러오지 못했어. 다시 선택해 줘.");
          this.changed();
        }
        return false;
      }
    }

    async reset() {
      if (this.disposed) return false;
      // Reset scalar controls before awaiting a shape image. Edits made while
      // that image loads must survive its eventual completion.
      const patch = { noseSize: DEFAULTS.noseSize, mouthSize: DEFAULTS.mouthSize };
      if (this.eyesAvailable) {
        for (const key of EYE_KEYS) patch[key] = DEFAULTS[key];
      }
      if (!this.setState(patch)) return false;
      if (!this.eyesAvailable) return true;
      const defaultShape = this.eyeShapes.find(shape => shape.id === DEFAULTS.eyeShape) || this.eyeShapes[0];
      return defaultShape ? this.selectEyeShape(defaultShape.id) : false;
    }

    draw(ctx) {
      if (this.disposed) return;
      ctx.save();
      const shape = this.bodyShape;
      if (shape?.headNeckAnchors) {
        const { x, jawY } = shape.headNeckAnchors;
        const scale = shape.head / 100;
        ctx.translate(x, jawY + shape.neckOffsetY());
        ctx.scale(scale, scale);
        ctx.translate(-x, -jawY);
      }
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      // A small curved nose, using the base doll's warm rose linework.
      ctx.save();
      ctx.translate(328.6, 855);
      ctx.scale(this.state.noseSize / 100, this.state.noseSize / 100);
      ctx.beginPath();
      ctx.moveTo(1, -12);
      ctx.quadraticCurveTo(-1, -5, -5, 0);
      ctx.quadraticCurveTo(-8, 6, -1, 6);
      ctx.quadraticCurveTo(3, 7, 7, 3);
      ctx.strokeStyle = "#B27880";
      ctx.lineWidth = 2.6;
      ctx.stroke();
      ctx.restore();

      // Independent lips keep their shape during eye movement and blinking.
      ctx.save();
      ctx.translate(328.6, 888);
      ctx.scale(this.state.mouthSize / 100, this.state.mouthSize / 100);
      ctx.beginPath();
      ctx.moveTo(-25, -1);
      ctx.quadraticCurveTo(-11, -8, 0, -3);
      ctx.quadraticCurveTo(11, -8, 25, -1);
      ctx.quadraticCurveTo(12, 10, 0, 10);
      ctx.quadraticCurveTo(-12, 10, -25, -1);
      ctx.fillStyle = "#D498A1";
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-25, -1);
      ctx.quadraticCurveTo(0, 4, 25, -1);
      ctx.strokeStyle = "#9E616C";
      ctx.lineWidth = 2.4;
      ctx.stroke();
      ctx.restore();
      ctx.restore();
    }

    dispose() {
      this.disposed = true;
      this.shapeRequest++;
      if (this.rig.face === this) this.rig.face = null;
    }
  }

  window.DressLabFace = DressLabFace;
  window.DressLabFaceDefaults = DEFAULTS;
})();
