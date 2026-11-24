/* V2 first wearable outfit: original lightweight SVG art in native 1206x2622 coordinates.
 * Three transparent files; no skin-tone transformation; no modifications to base PNGs.
 */
(() => {
  "use strict";
  const BASE = "./clothes/basic-white-tee/";
  const VERSION = "white-tee-contour-v3";
  const TORSO_FILES = new Set([
    "03-Bust.PNG", "06-UpperTorso.PNG", "07-LowerTorso.PNG", "08-TorsoJoint.PNG"
  ]);
  const SHAPE_KEYS = ["upperTorso", "bust", "waist", "hips", "armWidth", "armLength", "ratio"];

  class DressLabWardrobe {
    constructor(rig) {
      if (!rig || typeof rig.render !== "function") throw new Error("A working V2 rig is required");
      this.rig = rig;
      this.ready = false;
      this.equipped = false;
      this.parts = [];
      this.item = null;
      this.fitKey = null;
      this.fittedParts = [];
      rig.wardrobe = this;
    }

    async load() {
      const response = await fetch(BASE + "item.json?v=" + VERSION);
      if (!response.ok) throw new Error("의상 데이터 로드 실패: HTTP " + response.status);
      const item = await response.json();
      if (item.canvas?.width !== this.rig.canvas.width ||
          item.canvas?.height !== this.rig.canvas.height ||
          !Array.isArray(item.parts) || item.parts.length !== 3) {
        throw new Error("의상 파츠 데이터가 V2 리그와 맞지 않음");
      }
      const parts = await Promise.all(item.parts.map(async (part) => {
        if (!["shoulderL","shoulderR","torso"].includes(part.joint)) throw new Error("Unknown clothing joint");
        const image = new Image();
        image.decoding = "async";
        const path = BASE + encodeURIComponent(part.src) + "?v=" + VERSION;
        await new Promise((resolve,reject) => {
          image.onload = resolve;
          image.onerror = () => reject(new Error("의상 이미지 로드 실패: " + part.src));
          image.src = path;
        });
        if (!image.naturalWidth || !image.naturalHeight) throw new Error("Empty outfit image");
        return { ...part, image };
      }));
      this.parts = parts;
      this.item = item;
      this.fitKey = null;
      this.ready = true;
      this.equipped = true; // Show the first new garment when visiting the game.
      this.rig.render();
      window.dispatchEvent(new CustomEvent("dresslab:wardrobe-ready", {
        detail: { equipped: this.equipped, id: item.id }
      }));
      return true;
    }

    setEquipped(value) {
      if (!this.ready) return false;
      const next = Boolean(value);
      if (next === this.equipped) return true;
      this.equipped = next;
      this.rig.render();
      window.dispatchEvent(new CustomEvent("dresslab:wardrobe-change", {
        detail: { equipped: next, id: this.item.id }
      }));
      return true;
    }

    // Same ancestor rotations as the body, including torso idle/gesture rotation.
    rotateWith(ctx, joint) {
      for (const id of this.rig.ancestors(joint)) {
        const angle = this.rig.angles[id] || 0;
        if (!angle) continue;
        const point = this.rig.config.pivots[id];
        ctx.translate(point.x, point.y);
        ctx.rotate(angle * Math.PI / 180);
        ctx.translate(-point.x, -point.y);
      }
    }

    // Trace the actual torso silhouette, including the independently resized
    // bust. Work only when sliders change, never during an animation frame.
    torsoContour(layers) {
      const selected = layers.filter(layer => TORSO_FILES.has(layer.filename));
      const left = Math.floor(Math.min(...selected.map(layer => layer.x || 0)));
      const top = Math.floor(Math.min(...selected.map(layer => layer.y || 0)));
      const right = Math.ceil(Math.max(...selected.map(layer =>
        (layer.x || 0) + layer.image.width)));
      const bottom = Math.ceil(Math.max(...selected.map(layer =>
        (layer.y || 0) + layer.image.height)));
      const canvas = document.createElement("canvas");
      canvas.width = right - left;
      canvas.height = bottom - top;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) throw new Error("Cannot measure garment fit");
      for (const layer of selected) {
        ctx.drawImage(layer.image, (layer.x || 0) - left, (layer.y || 0) - top);
      }
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      const rows = new Map();
      for (let y = 0; y < canvas.height; y++) {
        let first = canvas.width, last = -1;
        for (let x = 0; x < canvas.width; x++) {
          if (pixels[(y * canvas.width + x) * 4 + 3] <= 12) continue;
          first = Math.min(first, x);
          last = x;
        }
        if (last > first) rows.set(top + y, { left: left + first, right: left + last });
      }
      return rows;
    }

    fitTorso(part, shape, currentContour) {
      const width = part.image.width, height = part.image.height;
      const rows = [];
      for (let row = 0; row < height; row++) {
        const y = part.y + row;
        const source = this.baseContour.get(y);
        const mappedY = shape.mapRatioY(y);
        const a = currentContour.get(Math.floor(mappedY));
        const b = currentContour.get(Math.ceil(mappedY)) || a;
        let scale = 1, x = part.x;
        if (source && a && b) {
          const t = mappedY - Math.floor(mappedY);
          const left = a.left + (b.left - a.left) * t;
          const right = a.right + (b.right - a.right) * t;
          scale = (right - left) / (source.right - source.left);
          x = left + (part.x - source.left) * scale;
        }
        rows.push({ x, scale });
      }
      // Alpha boundaries move in whole pixels. Smooth only their deformation
      // offsets so a resized shirt keeps its continuous original SVG outline.
      const smoothRows = rows.map((_, row) => {
        let offset = 0, stretch = 0, total = 0;
        for (let delta = -10; delta <= 10; delta++) {
          const sample = rows[row + delta];
          if (!sample) continue;
          const weight = 11 - Math.abs(delta);
          offset += (sample.x - part.x) * weight;
          stretch += (sample.scale - 1) * weight;
          total += weight;
        }
        return { x: part.x + offset / total, scale: 1 + stretch / total };
      });
      const minX = Math.min(part.x, ...smoothRows.map(row => row.x));
      const maxX = Math.max(part.x + width, ...smoothRows.map(row => row.x + width * row.scale));
      const originX = Math.floor(minX) - 2;
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(maxX) - originX + 2;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Cannot fit garment torso");
      for (let row = 0; row < height; row++) {
        const { x, scale } = smoothRows[row];
        ctx.drawImage(part.image, 0, row, width, 1,
          x - originX, row, width * scale, 1);
      }
      return { ...part, image: canvas, x: originX };
    }

    fitParts() {
      const shape = window.dressLabBodyShape;
      if (!shape?.baseLayers || !shape.basePivots ||
          typeof shape.transformArm !== "function" ||
          typeof shape.warpRatioLayer !== "function") return this.parts;
      const state = shape.getState();
      const key = SHAPE_KEYS.map(key => state[key]).join(",");
      if (this.fitShape === shape && this.fitKey === key) return this.fittedParts;
      if (this.fitShape !== shape) this.baseContour = null;
      this.fitShape = shape;
      // A reset must reproduce the source art exactly, without resampling.
      if (SHAPE_KEYS.every(key => state[key] === 100)) {
        this.fittedParts = this.parts;
        this.fitKey = key;
        return this.fittedParts;
      }
      const torsoChanged = ["upperTorso", "bust", "waist", "hips"]
        .some(key => state[key] !== 100);
      if (torsoChanged && !this.baseContour) {
        this.baseContour = this.torsoContour([...shape.baseLayers.values()]);
      }
      const currentContour = torsoChanged ? this.torsoContour(this.rig.layers) : null;
      this.fittedParts = this.parts.map(part => {
        let fitted = part;
        if (part.joint === "torso") {
          if (torsoChanged) fitted = this.fitTorso(part, shape, currentContour);
        } else {
          const side = part.joint === "shoulderL" ? "L" : "R";
          const start = shape.basePivots[part.joint];
          const end = shape.basePivots["elbow" + side];
          // Body-shape first moves the shoulder horizontally, then stretches
          // along/across the bone, then applies the vertical ratio mapping.
          // Reuse those same two transforms, in that same order.
          const position = { x: this.rig.config.pivots[part.joint].x, y: start.y };
          fitted = { ...part, ...shape.transformArm(part, start, end, position) };
        }
        return { ...part, ...shape.warpRatioLayer(fitted) };
      });
      this.fitKey = key;
      return this.fittedParts;
    }

    draw(ctx) {
      if (!this.ready || !this.equipped) return;

      // Draw sleeves behind the garment's torso so the shoulder join is hidden.
      for (const part of this.fitParts()) {
        ctx.save();
        this.rotateWith(ctx, part.joint);
        ctx.drawImage(part.image, part.x, part.y);
        ctx.restore();
      }
    }
  }
  window.DressLabWardrobe = DressLabWardrobe;
})();
