/* Dress Lab V2 - independent, image-preserving 2D joint renderer.
 * Neutral pose draws the original full-canvas PNGs at (0,0) with their existing
 * number-based stacking order. Rotations are rigid transforms; no pixel warping.
 */
(() => {
  "use strict";

  const RAD = Math.PI / 180;
  const numberOf = filename => Number((filename.match(/^\d+/) || ["9999"])[0]);
  const limit = (value, low, high) => Math.min(high, Math.max(low, value));

  class DressLabRig {
    constructor({ canvas, layers, config }) {
      if (!canvas || !Array.isArray(layers) || !config || !config.pivots || !config.parts) {
        throw new Error("Rig requires canvas, layers and rig configuration");
      }
      this.canvas = canvas;
      this.ctx = canvas.getContext("2d");
      if (!this.ctx) throw new Error("Canvas 2D is unavailable");
      if (canvas.width !== config.canvas.width || canvas.height !== config.canvas.height) {
        throw new Error("Rig canvas dimensions do not match base PNG dimensions");
      }

      this.config = config;
      this.layers = [...layers].sort((a, b) => numberOf(b.filename) - numberOf(a.filename) ||
        a.filename.localeCompare(b.filename));
      this.angles = {};
      // A tiny whole-character squash/stretch is applied only to the assembled
      // image. Individual limbs remain rigid; the regular zero pose is exact.
      this.root = { x: 0, y: 0, scaleX: 1, scaleY: 1 };
      this.rootAnchor = { x: 328.6, y: 2050 };
      this.markersVisible = false;
      this.referenceImage = null;
      this.referenceVisible = false;

      for (const [id, joint] of Object.entries(config.pivots)) {
        if (!Number.isFinite(joint.x) || !Number.isFinite(joint.y) ||
            !Number.isFinite(joint.min) || !Number.isFinite(joint.max)) {
          throw new Error("Invalid joint definition: " + id);
        }
        const visited = new Set([id]);
        let parent = joint.parent;
        while (parent !== null && parent !== undefined) {
          if (!config.pivots[parent] || visited.has(parent)) {
            throw new Error("Missing or cyclic joint parent at " + id);
          }
          visited.add(parent);
          parent = config.pivots[parent].parent;
        }
        this.angles[id] = 0;
      }
      this.render();
    }

    getAngle(id) {
      return this.angles[id] ?? 0;
    }

    // All joints are stored in original (not display-scaled) PNG coordinates.
    ancestors(id) {
      const chain = [];
      while (id) {
        const joint = this.config.pivots[id];
        if (!joint) break;
        chain.push(id);
        id = joint.parent;
      }
      return chain.reverse();
    }

    applyRootTransform(ctx) {
      const { x, y, scaleX, scaleY } = this.root;
      if (x !== 0 || y !== 0) ctx.translate(x, y);
      if (scaleX !== 1 || scaleY !== 1) {
        const { x: px, y: py } = this.rootAnchor;
        ctx.translate(px, py);
        ctx.scale(scaleX, scaleY);
        ctx.translate(-px, -py);
      }
    }

    // Apply local joint rotations in parent -> child order to a single part.
    render() {
      const { ctx, canvas } = this;
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      ctx.save();
      this.applyRootTransform(ctx);
      for (const { filename, image } of this.layers) {
        if (!image) continue;
        ctx.save();
        const attached = Object.prototype.hasOwnProperty.call(this.config.parts, filename)
          ? this.config.parts[filename] : null;
        for (const id of this.ancestors(attached)) {
          const angle = this.angles[id];
          if (!angle) continue;
          const { x, y } = this.config.pivots[id];
          ctx.translate(x, y);
          ctx.rotate(angle * RAD);
          ctx.translate(-x, -y);
        }
        ctx.drawImage(image, 0, 0);
        ctx.restore();
      }
      ctx.restore();

      // Full.PNG is never part of the character. It can only be shown in debug mode.
      if (this.referenceVisible && this.referenceImage) {
        ctx.save();
        ctx.globalAlpha = 0.35;
        ctx.drawImage(this.referenceImage, 0, 0);
        ctx.restore();
      }

      if (this.markersVisible) {
        ctx.save();
        this.applyRootTransform(ctx);
        this.drawMarkers();
        ctx.restore();
      }
      ctx.restore();
    }

    // Update every angle + the cartoon bounce transform with one canvas redraw.
    // Root values are in source-image pixels; limits prevent accidental warping.
    setFrame(pose = {}, root = {}) {
      for (const [id, joint] of Object.entries(this.config.pivots)) {
        const value = Object.prototype.hasOwnProperty.call(pose, id) ? Number(pose[id]) : 0;
        this.angles[id] = Number.isFinite(value) ? limit(value, joint.min, joint.max) : 0;
      }
      const safe = (value, fallback, lo, hi) =>
        Number.isFinite(Number(value)) ? limit(Number(value), lo, hi) : fallback;
      this.root = {
        x: safe(root.x ?? 0, 0, -50, 50),
        y: safe(root.y ?? 0, 0, -60, 60),
        scaleX: safe(root.scaleX ?? 1, 1, 0.97, 1.03),
        scaleY: safe(root.scaleY ?? 1, 1, 0.97, 1.03)
      };
      this.render();
    }

    setAngle(id, angle) {
      const joint = this.config.pivots[id];
      if (!joint || !Number.isFinite(Number(angle))) return false;
      this.angles[id] = limit(Number(angle), joint.min, joint.max);
      this.render();
      return true;
    }

    setPose(pose = {}, replace = true) {
      if (replace) for (const id of Object.keys(this.angles)) this.angles[id] = 0;
      for (const [id, angle] of Object.entries(pose)) {
        const joint = this.config.pivots[id];
        if (!joint || !Number.isFinite(Number(angle))) continue;
        this.angles[id] = limit(Number(angle), joint.min, joint.max);
      }
      this.render();
    }

    reset() { this.setFrame({}, {}); }

    showMarkers(visible) {
      this.markersVisible = Boolean(visible);
      this.render();
    }

    showReference(image, visible) {
      if (image) this.referenceImage = image;
      this.referenceVisible = Boolean(visible);
      this.render();
    }

    // Marker world positions use the same hierarchical transforms as the sprites.
    pointFor(id) {
      const joint = this.config.pivots[id];
      if (!joint) return null;
      let x = joint.x, y = joint.y;
      let parent = joint.parent;
      while (parent) {
        const p = this.config.pivots[parent];
        const a = this.angles[parent] * RAD;
        const dx = x - p.x, dy = y - p.y;
        x = p.x + dx * Math.cos(a) - dy * Math.sin(a);
        y = p.y + dx * Math.sin(a) + dy * Math.cos(a);
        parent = p.parent;
      }
      return { x, y };
    }

    drawMarkers() {
      const ctx = this.ctx;
      ctx.save();
      // Keep the active root translation/scale so markers follow the character.
      for (const id of Object.keys(this.config.pivots)) {
        const p = this.pointFor(id);
        if (!p) continue;
        ctx.beginPath();
        ctx.arc(p.x, p.y, id === "torso" ? 11 : 9, 0, 2 * Math.PI);
        ctx.fillStyle = "#fff";
        ctx.fill();
        ctx.lineWidth = 4;
        ctx.strokeStyle = "#2262ab";
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(p.x - 15, p.y);
        ctx.lineTo(p.x + 15, p.y);
        ctx.moveTo(p.x, p.y - 15);
        ctx.lineTo(p.x, p.y + 15);
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  window.DressLabRig = DressLabRig;
})();