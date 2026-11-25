/* V2 wearable separates: original SVG art in native 1206x2622 coordinates.
 * Garments keep their own pixels and follow the body's shape and joint maps.
 */
(() => {
  "use strict";
  const BASE = "./clothes/basic-white-tee/";
  const PANTS_BASE = "./clothes/basic-charcoal-pants/";
  const TEE_ID = "basic-white-tee";
  const PANTS_ID = "basic-charcoal-pants";
  const VERSION = "separates-pants-v1";
  const TORSO_FILES = new Set([
    "03-Bust.PNG", "06-UpperTorso.PNG", "07-LowerTorso.PNG", "08-TorsoJoint.PNG"
  ]);
  const SHAPE_KEYS = ["upperTorso", "bust", "waist", "hips", "armWidth", "armLength", "ratio"];
  const PANTS_SHAPE_KEYS = ["waist", "hips", "thighs", "calves", "ratio"];
  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
  const smootherstep = value => {
    const t = clamp(value, 0, 1);
    return t * t * t * (t * (t * 6 - 15) + 10);
  };

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
      this.pants = { ready: false, equipped: false, item: null, parts: [],
        fitKey: null, fittedParts: [] };
      this.loadErrors = {};
      rig.wardrobe = this;
    }

    async loadGarment(base, id, joints, count) {
      const response = await fetch(base + "item.json?v=" + VERSION);
      if (!response.ok) throw new Error("의상 데이터 로드 실패: HTTP " + response.status);
      const item = await response.json();
      if (item.id !== id || item.canvas?.width !== this.rig.canvas.width ||
          item.canvas?.height !== this.rig.canvas.height ||
          !Array.isArray(item.parts) || item.parts.length !== count) {
        throw new Error("의상 파츠 데이터가 V2 리그와 맞지 않음");
      }
      const parts = await Promise.all(item.parts.map(async (part) => {
        if (!joints.includes(part.joint) || !Number.isFinite(part.x) ||
            !Number.isFinite(part.y) || !/^[a-z0-9-]+\.(svg|png)$/i.test(part.src)) {
          throw new Error("Invalid clothing part: " + part.id);
        }
        const image = new Image();
        image.decoding = "async";
        const path = base + encodeURIComponent(part.src) + "?v=" + VERSION;
        await new Promise((resolve,reject) => {
          image.onload = resolve;
          image.onerror = () => reject(new Error("의상 이미지 로드 실패: " + part.src));
          image.src = path;
        });
        if (!image.naturalWidth || !image.naturalHeight) throw new Error("Empty outfit image");
        return { ...part, image };
      }));
      return { item, parts };
    }

    async load() {
      // One failed garment must not hide the other garment or the base doll.
      const definitions = [
        [TEE_ID, BASE, ["shoulderL", "shoulderR", "torso"], 3, this],
        [PANTS_ID, PANTS_BASE, [null, "hipL", "hipR", "kneeL", "kneeR"], 5, this.pants]
      ];
      const results = await Promise.allSettled(definitions.map(([id, base, joints, count]) =>
        this.loadGarment(base, id, joints, count)));
      results.forEach((result, index) => {
        const [id, , , , garment] = definitions[index];
        if (result.status === "fulfilled") {
          Object.assign(garment, result.value, { fitKey: null, ready: true, equipped: true });
          delete this.loadErrors[id];
          window.dispatchEvent(new CustomEvent("dresslab:wardrobe-ready", {
            detail: { equipped: true, id }
          }));
        } else {
          this.loadErrors[id] = result.reason?.message || "의상 이미지 로드 실패";
          window.dispatchEvent(new CustomEvent("dresslab:wardrobe-error", {
            detail: { id, message: this.loadErrors[id] }
          }));
        }
      });
      this.rig.render();
      return this.ready || this.pants.ready;
    }

    getItemState(id = TEE_ID) {
      const garment = id === TEE_ID ? this : id === PANTS_ID ? this.pants : null;
      if (!garment) return null;
      return { id, ready: garment.ready, equipped: garment.equipped,
        name: garment.item?.name || (id === TEE_ID ? "베이직 화이트 반팔 티셔츠" : "베이직 차콜 긴바지"),
        error: this.loadErrors[id] || null };
    }

    // Calling without an ID keeps the original shirt-only public API.
    setEquipped(value, id = TEE_ID) {
      const garment = id === TEE_ID ? this : id === PANTS_ID ? this.pants : null;
      if (!garment?.ready) return false;
      const next = Boolean(value);
      if (next === garment.equipped) return true;
      garment.equipped = next;
      this.rig.render();
      window.dispatchEvent(new CustomEvent("dresslab:wardrobe-change", {
        detail: { equipped: next, id }
      }));
      return true;
    }

    unequipAll() {
      this.setEquipped(false, TEE_ID);
      this.setEquipped(false, PANTS_ID);
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
          typeof shape.transformUpperArm !== "function" ||
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
          // Share the body's anchored shoulder-cap map. A full affine stretch
          // also lengthens pixels above the pivot and detaches the seam.
          // Apply the torso/leg ratio only after the shared arm mapping.
          const position = { x: this.rig.config.pivots[part.joint].x, y: start.y };
          fitted = { ...part, ...shape.transformUpperArm(part, start, end, position) };
        }
        return { ...part, ...shape.warpRatioLayer(fitted) };
      });
      this.fitKey = key;
      return this.fittedParts;
    }

    // The garment follows the BODY's row axes, not its own loose silhouette.
    // In particular, calf factors use the original foot endpoint even though
    // trousers stop at the ankle. Blend width and ratio in one inverse raster.
    pantsMapping(part, shape) {
      const body = shape.sources.get(part.bodyPart);
      if (!body) throw new Error("Missing pants body reference: " + part.bodyPart);
      const lowerTorso = shape.sources.get("07-LowerTorso.PNG");
      const first = source => source.rows.find(Boolean);
      const last = source => [...source.rows].reverse().find(Boolean);
      const endpoints = new Map([body, lowerTorso].filter(Boolean)
        .map(source => [source, [first(source), last(source)]]));
      const bodyRow = (source, y) => {
        const [start, end] = endpoints.get(source);
        if (y <= start.y) return start;
        if (y >= end.y) return end;
        const index = Math.round(y - source.y);
        if (source.rows[index]) return source.rows[index];
        for (let delta = 1; delta < source.h; delta++) {
          const row = source.rows[index - delta] || source.rows[index + delta];
          if (row) return row;
        }
        return start;
      };
      const isPelvis = part.fit === "pelvis";
      const side = part.side;
      const kneeY = isPelvis ? 0 : shape.basePivots["knee" + side].y;
      const hipOffset = isPelvis ? 0 :
        (shape.basePivots["hip" + side].x - shape.basePivots.torso.x) * (shape.hipScale() - 1);
      const height = part.image.height;
      const rows = [];
      for (let index = 0; index <= height; index++) {
        const y = part.y + index;
        const source = isPelvis && y < 1280 ? lowerTorso : body;
        const kind = isPelvis && y < 1280 ? "lowerTorso" : part.fit;
        const row = bodyRow(source, y);
        let axis = row.axis;
        if (!isPelvis) {
          const distance = part.fit === "upper"
            ? Math.min(Math.abs(y - kneeY), Math.abs(y - 1330))
            : Math.abs(y - kneeY);
          const smoothAxis = (row.smoothLeft + row.smoothRight) / 2;
          axis += (smoothAxis - axis) * smootherstep(distance / 24);
        }
        rows.push({ axis, scale: shape.factor(kind, side, y, source) });
      }
      const at = y => {
        const p = clamp(y - part.y, 0, height);
        const index = Math.floor(p), t = p - index;
        const a = rows[index], b = rows[Math.min(height, index + 1)];
        return { axis: a.axis + (b.axis - a.axis) * t,
          scale: a.scale + (b.scale - a.scale) * t };
      };
      return {
        forward(x, y) {
          const { axis, scale } = at(y);
          return [axis + (x - axis) * scale + hipOffset, shape.mapRatioY(y)];
        },
        inverse(x, y) {
          const sourceY = shape.unmapRatioY(y);
          const { axis, scale } = at(sourceY);
          return [axis + (x - hipOffset - axis) / scale, sourceY];
        }
      };
    }

    fitPantsParts() {
      const garment = this.pants;
      const shape = window.dressLabBodyShape;
      if (!shape?.sources || typeof shape.inverseSprite !== "function") return garment.parts;
      const state = shape.getState();
      const key = PANTS_SHAPE_KEYS.map(key => state[key]).join(",");
      if (garment.fitShape === shape && garment.fitKey === key) return garment.fittedParts;
      garment.fitShape = shape;
      garment.fittedParts = PANTS_SHAPE_KEYS.every(key => state[key] === 100)
        ? garment.parts
        : garment.parts.map(part => {
          const map = this.pantsMapping(part, shape);
          return shape.inverseSprite(part, shape.mappedSpriteBounds(part, map.forward), map.inverse);
        });
      garment.fitKey = key;
      return garment.fittedParts;
    }

    draw(ctx) {
      // Lower separates precede the shirt, whose hem overlaps the waistband.
      if (this.pants.ready && this.pants.equipped) {
        this.drawParts(ctx, this.fitPantsParts());
      }
      if (!this.ready || !this.equipped) return;

      // Draw sleeves behind the garment's torso so the shoulder join is hidden.
      this.drawParts(ctx, this.fitParts());
    }

    drawParts(ctx, parts) {
      for (const part of parts) {
        ctx.save();
        this.rotateWith(ctx, part.joint);
        ctx.drawImage(part.image, part.x, part.y);
        ctx.restore();
      }
    }
  }
  window.DressLabWardrobe = DressLabWardrobe;
})();
