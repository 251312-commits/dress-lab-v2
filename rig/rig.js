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
      this.jointCapsVisible = true;
      this.jointCapScale = { elbow: 1, knee: 1 };
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

    // Trim the transparent margins of each full-size source PNG once.
    // Drawing small sprites makes 30 fps animation much cheaper on phones.
    // Coordinates and the original part stacking order do not change.
    prepareFastSprites() {
      if (typeof document === "undefined" || typeof document.createElement !== "function") return false;
      const { width, height } = this.canvas;
      const scratch = document.createElement("canvas");
      scratch.width = width;
      scratch.height = height;
      const scratchCtx = scratch.getContext("2d", { willReadFrequently: true });
      if (!scratchCtx || typeof scratchCtx.getImageData !== "function") return false;

      const cropped = [];
      try {
        for (const layer of this.layers) {
          scratchCtx.clearRect(0, 0, width, height);
          scratchCtx.drawImage(layer.image, 0, 0);
          const rgba = scratchCtx.getImageData(0, 0, width, height).data;
          let left = width, top = height, right = -1, bottom = -1;
          for (let y = 0; y < height; y++) {
            const start = y * width * 4;
            for (let x = 0; x < width; x++) {
              if (rgba[start + x * 4 + 3] === 0) continue;
              left = Math.min(left, x);
              right = Math.max(right, x);
              top = Math.min(top, y);
              bottom = Math.max(bottom, y);
            }
          }
          if (right < left) continue;
          // Keep 1px transparent padding for antialiased edge preservation.
          left = Math.max(0, left - 1);
          top = Math.max(0, top - 1);
          right = Math.min(width - 1, right + 1);
          bottom = Math.min(height - 1, bottom + 1);
          const w = right - left + 1, h = bottom - top + 1;
          const sprite = document.createElement("canvas");
          sprite.width = w;
          sprite.height = h;
          const spriteCtx = sprite.getContext("2d");
          if (!spriteCtx) return false;
          spriteCtx.drawImage(layer.image, left, top, w, h, 0, 0, w, h);
          cropped.push({ filename: layer.filename, image: sprite, x: left, y: top });
        }
        if (cropped.length !== this.layers.length) return false;
        this.layers = cropped;
        this.render();
        return true;
      } catch (error) {
        console.warn("Transparent sprite cropping failed; using original PNGs:", error);
        return false;
      } finally {
        // Release the large temporary image buffer.
        scratch.width = 0;
        scratch.height = 0;
      }
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
      let elbowCapsDrawn = false;
      let kneeCapsDrawn = false;
      for (const { filename, image, x = 0, y = 0 } of this.layers) {
        if (!image) continue;
        // These circles are drawn immediately before the FIRST foreground
        // forearm/shin so BOTH joint-connected segments cover them.
        if (this.jointCapsVisible && !elbowCapsDrawn && /-LowerArm\(/.test(filename)) {
          this.drawJointCaps("elbow");
          elbowCapsDrawn = true;
        }
        if (this.jointCapsVisible && !kneeCapsDrawn && /-LowerLeg\(/.test(filename)) {
          this.drawJointCaps("knee");
          kneeCapsDrawn = true;
        }
        ctx.save();
        const isBodyPart = Object.prototype.hasOwnProperty.call(this.config.parts, filename);
        const attached = isBodyPart ? this.config.parts[filename] : null;
        for (const id of this.ancestors(attached)) {
          const angle = this.angles[id];
          if (!angle) continue;
          const { x, y } = this.config.pivots[id];
          ctx.translate(x, y);
          ctx.rotate(angle * RAD);
          ctx.translate(-x, -y);
        }
        ctx.drawImage(this.skinTone && isBodyPart ? this.skinTone.getImage(image) : image, x, y);
        // Paint eyes above the head in the same root + torso coordinate space.
        // The eye controller also applies the jaw-anchored head-size transform.
        if (filename === "01-Head.PNG" && this.eyes) this.eyes.draw(ctx);
        ctx.restore();
      }
      // Draw equipped clothing within the same root bounce/translation space.
      // Clothing owns its material pixels, separate from skin-tone recoloring.
      if (this.wardrobe) this.wardrobe.draw(ctx);
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

    showJointCaps(visible) {
      this.jointCapsVisible = Boolean(visible);
      this.render();
    }

    // Test-only circle sprites behind elbows and knees, without modifying
    // any PNG. pointFor() includes all ancestor rotations.
    drawJointCaps(group) {
      if (!this.jointCapsVisible) return;
      const ctx = this.ctx;
      ctx.save();
      for (const [jointId, cap] of Object.entries(this.config.jointCaps || {})) {
        if (cap.group !== group) continue;
        const point = this.pointFor(jointId);
        if (!point) continue;
        const r = cap.radius * (this.jointCapScale[group] || 1);
        ctx.beginPath();
        ctx.arc(point.x, point.y, r, 0, 2 * Math.PI);
        ctx.fillStyle = this.skinTone ? this.skinTone.getJointCapFill() : "#F7E4E5";
        ctx.fill();
        ctx.strokeStyle = "rgba(143, 83, 96, 0.34)";
        ctx.lineWidth = 1.3;
        ctx.stroke();
      }
      ctx.restore();
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