/* Dress Lab V2 — locally linked body-shape deformation.
 *
 * Each isolated PNG piece is resampled in horizontal rows, never warped as a
 * whole character. Head and neck are separate: head size scales uniformly
 * around the jaw/neck attachment, while neck length stretches only the
 * neck region above the shoulders and carries the head vertically.
 * UpperTorso/Bust -> TorsoJoint (waist) -> LowerTorso -> Hips -> both
 * upper legs -> both lower legs still share smooth boundary values.
 *
 * Hip/shoulder positions follow the silhouette width (and carry their child
 * joints + sprite placements); the neutral 100% shape stays pixel identical.
 * Existing animation rig, sprites and skin-color data are retained.
 */
(() => {
  "use strict";

  const clamp = (n, low, high) => Math.max(low, Math.min(high, n));
  const smoothstep = (a, b, t) => {
    const q = clamp((t - a) / (b - a), 0, 1);
    return q * q * (3 - 2 * q);
  };

  const PARTS = Object.freeze({
    "01-Head.PNG": ["head", null],
    "02-Neck.PNG": ["neck", null],
    "03-Bust.PNG": ["bust", null],
    "04-UpperTorso.PNG": ["upperTorso", null],
    "05-LowerTorso.PNG": ["lowerTorso", null],
    "06-TorsoJoint.PNG": ["waistJoint", null],
    "07-Hips.PNG": ["pelvis", null],
    "08-UpperLeg(L).PNG": ["upper", "L"],
    "09-UpperLeg(R).PNG": ["upper", "R"],
    "10-LowerLeg(L).PNG": ["lower", "L"],
    "11-LowerLeg(R).PNG": ["lower", "R"]
  });
  const LIMITS = Object.freeze({
    head: Object.freeze([90, 113]),
    neck: Object.freeze([78, 127]),
    upperTorso: Object.freeze([90, 118]),
    waist: Object.freeze([85, 120]),
    hips: Object.freeze([90, 120]),
    thighs: Object.freeze([85, 135]),
    calves: Object.freeze([85, 115])
  });

  class DressLabBodyShape {
    constructor(rig) {
      if (!rig || !rig.layers || !rig.config?.pivots) {
        throw new Error("DressLabBodyShape requires an initialized DressLabRig");
      }
      this.rig = rig;
      this.head = 100;
      this.neck = 100;
      this.upperTorso = 100;
      this.waist = 100;
      this.hips = 100;
      this.thighs = 100;
      this.calves = 100;
      this.limits = LIMITS;
      this.hipInfluence = 1.00;
      this.kneeInfluence = 0.30;
      this.sources = new Map();
      this.baseLayers = new Map(rig.layers.map(layer => [layer.filename, { ...layer }]));
      this.basePivots = Object.fromEntries(
        Object.entries(rig.config.pivots).map(([id, pivot]) => [id, { x: pivot.x, y: pivot.y }])
      );
      this.canvasesBuilt = 0;

      for (const layer of rig.layers) {
        if (!PARTS[layer.filename]) continue;
        const w = layer.image?.width ?? layer.image?.naturalWidth;
        const h = layer.image?.height ?? layer.image?.naturalHeight;
        if (!w || !h) throw new Error("Missing raster: " + layer.filename);
        const source = { filename: layer.filename, image: layer.image,
          x: layer.x || 0, y: layer.y || 0, w, h, rows: [] };

        const sample = document.createElement("canvas");
        sample.width = w;
        sample.height = h;
        const context = sample.getContext("2d", { willReadFrequently: true });
        if (!context) throw new Error("Cannot prepare body image: " + layer.filename);
        context.drawImage(source.image, 0, 0);
        const rgba = context.getImageData(0, 0, w, h).data;

        // The per-row transparency contour gives a better deformation axis
        // than one straight line through an anatomically curved leg.
        let any = false;
        for (let row = 0; row < h; row++) {
          let left = w, right = -1;
          const start = row * w * 4;
          for (let x = 0; x < w; x++) {
            if (rgba[start + x * 4 + 3] > 12) {
              if (x < left) left = x;
              right = x;
            }
          }
          if (right >= left) {
            any = true;
            source.rows[row] = {
              y: source.y + row,
              left: source.x + left,
              right: source.x + right,
              axis: source.x + (left + right) / 2
            };
          } else {
            source.rows[row] = null;
          }
        }
        sample.width = sample.height = 0;
        if (!any) throw new Error("Empty body image: " + layer.filename);
        this.sources.set(layer.filename, source);
      }
      if (this.sources.size !== Object.keys(PARTS).length) {
        throw new Error("Body part set is incomplete: expected eleven separate PNGs");
      }

      // The neck PNG (around y=895..978) overlaps UpperTorso (from y=961),
      // while the shoulder rotation pivots are lower (y=1013). The old
      // shoulder-pivot stretch moved even the neck's lower edge, opening a gap.
      // Use the actual PNG overlap to keep the lower attachment stationary.
      const neckSource = this.sources.get("02-Neck.PNG");
      const torsoSource = this.sources.get("04-UpperTorso.PNG");
      const firstNeckRow = neckSource.rows.find(row => row);
      const lastNeckRow = [...neckSource.rows].reverse().find(row => row);
      const firstTorsoRow = torsoSource.rows.find(row => row);
      const neckTopY = firstNeckRow.y;
      const neckBottomY = lastNeckRow.y;
      const torsoTopY = firstTorsoRow.y;
      const overlap = Math.max(0, neckBottomY - torsoTopY);
      const neckBaseY = Math.max(torsoTopY, neckBottomY - Math.min(8, overlap * 0.5));
      const span = Math.max(1, neckBaseY - neckTopY);
      this.headNeckAnchors = Object.freeze({
        x: this.basePivots.torso.x,
        neckTopY,
        neckBottomY,
        torsoTopY,
        neckBaseY,
        span,
        jawY: neckTopY + Math.min(31, span * 0.45)
      });
    }

    getState() {
      return {
        head: this.head,
        neck: this.neck,
        upperTorso: this.upperTorso,
        waist: this.waist,
        hips: this.hips,
        thighs: this.thighs,
        calves: this.calves,
        hipInfluence: this.hipInfluence,
        hipScale: Number(this.hipScale().toFixed(4)),
        kneeInfluence: this.kneeInfluence,
        kneeScale: Number(this.kneeScale().toFixed(4))
      };
    }

    // The pelvis and thigh multipliers share the same hip attachment width.
    // If hips is neutral, this is exactly the former thigh-only hip rule.
    hipScale() {
      return (this.hips / 100) * (1 + this.hipInfluence * (this.thighs / 100 - 1));
    }

    kneeScale() {
      const dThigh = this.thighs / 100 - 1;
      const dCalf = this.calves / 100 - 1;
      // One shared value for BOTH upper-leg and lower-leg knee boundaries.
      return 1 + this.kneeInfluence * dThigh + this.kneeInfluence * dCalf;
    }

    // Each joined piece uses the same boundary scale as its neighbor.
    // Y coordinates remain unchanged; the existing torso rotation pivot
    // and hip/knee angles continue to work on all shaped sprites.
    factor(kind, side, y, source) {
      const upperScale = this.upperTorso / 100;
      const waistScale = this.waist / 100;
      const pelvisScale = this.hips / 100;
      const hipConnection = this.hipScale();
      const thighScale = this.thighs / 100;
      const calfScale = this.calves / 100;
      const kneeConnection = this.kneeScale();

      if (kind === "bust" || kind === "upperTorso") {
        // Wide shoulders/chest -> the waist connector's exact multiplier.
        return upperScale + (waistScale - upperScale) *
          smoothstep(1055, 1166.5, y);
      }
      if (kind === "waistJoint") return waistScale;
      if (kind === "lowerTorso") {
        // The lower torso's top is waist-sized; its bottom follows the hips.
        return waistScale + (pelvisScale - waistScale) *
          smoothstep(1166.5, 1280, y);
      }
      if (kind === "pelvis") {
        // At the pelvis top match LowerTorso. At the hip attachment match
        // UpperLeg, even when both hip and thigh controls are changed.
        return pelvisScale + (hipConnection - pelvisScale) *
          smoothstep(1260, 1367.8, y);
      }

      const hip = this.rig.config.pivots["hip" + side].y;
      const knee = this.rig.config.pivots["knee" + side].y;
      if (kind === "upper") {
        const t = clamp((y - hip) / Math.max(1, knee - hip), 0, 1);
        const toThigh = smoothstep(0.04, 0.32, t);
        const toKnee = smoothstep(0.70, 0.90, t);
        const upperMiddle = hipConnection + (thighScale - hipConnection) * toThigh;
        return upperMiddle + (kneeConnection - upperMiddle) * toKnee;
      }

      // Keep the existing knee-coupling formula and protect the foot.
      const footBottom = source.y + source.h - 1;
      const ankle = knee + (footBottom - knee) * 0.84;
      const t = clamp((y - knee) / Math.max(1, ankle - knee), 0, 1);
      const kneeWeight = 1 - smoothstep(0.10, 0.36, t);
      const calfBulge = smoothstep(0.18, 0.43, t) *
        (1 - smoothstep(0.52, 0.95, t));
      return 1 + (kneeConnection - 1) * kneeWeight +
        (calfScale - 1) * calfBulge;
    }

    // Change length without moving the physical neck/torso overlap.
    // Shoulder rotation pivots are NOT the neck attachment line.
    // Lower overlapping pixels remain fixed while the exposed top stretches.
    neckOffsetY() {
      return (1 - this.neck / 100) * this.headNeckAnchors.span;
    }

    deformHead(source) {
      const scale = this.head / 100;
      const neckShift = this.neckOffsetY();
      if (this.head === 100) {
        return { filename: source.filename, image: source.image,
          x: source.x, y: source.y + neckShift };
      }
      const { x: cx, jawY } = this.headNeckAnchors;
      const x = cx + (source.x - cx) * scale;
      const y = jawY + (source.y - jawY) * scale + neckShift;
      const scaledWidth = source.w * scale, scaledHeight = source.h * scale;
      const x0 = Math.floor(x) - 2, y0 = Math.floor(y) - 2;
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(x + scaledWidth - x0) + 2;
      canvas.height = Math.ceil(y + scaledHeight - y0) + 2;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Could not resize head sprite");
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(source.image, x - x0, y - y0, scaledWidth, scaledHeight);
      this.canvasesBuilt++;
      return { filename: source.filename, image: canvas, x: x0, y: y0 };
    }

    deformNeck(source) {
      if (this.neck === 100) return { filename: source.filename,
        image: source.image, x: source.x, y: source.y };
      const { neckBaseY } = this.headNeckAnchors;
      const scale = this.neck / 100;
      const cut = clamp(neckBaseY - source.y, 0, source.h);
      const topY = neckBaseY + (source.y - neckBaseY) * scale;
      const originY = Math.floor(Math.min(topY, source.y)) - 2;
      const bottomY = source.y + source.h;
      const canvas = document.createElement("canvas");
      canvas.width = source.w;
      canvas.height = Math.ceil(bottomY - originY) + 2;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Could not resize neck sprite");
      ctx.imageSmoothingEnabled = true;
      if (cut > 0) {
        ctx.drawImage(source.image,
          0, 0, source.w, cut,
          0, topY - originY, source.w, cut * scale);
      }
      if (cut < source.h) {
        ctx.drawImage(source.image,
          0, cut, source.w, source.h - cut,
          0, source.y + cut - originY, source.w, source.h - cut);
      }
      this.canvasesBuilt++;
      return { filename: source.filename, image: canvas,
        x: source.x, y: originY };
    }

    // A row-based, smoothly interpolated horizontal mesh: one source image
    // row maps to a stretched/shrunk output row. Vertical coordinates do not
    // change, so hip/knee pivots and animations stay in the same coordinate
    // system. No new seams are introduced by resampling in the Y direction.
    deform(source, kind, side, offsetX = 0) {
      const rows = source.rows;
      let minX = Infinity, maxX = -Infinity, changed = false;
      const scales = new Float32Array(source.h);
      for (let y = 0; y < source.h; y++) {
        const row = rows[y];
        if (!row) continue;
        const scale = this.factor(kind, side, row.y, source);
        scales[y] = scale;
        if (Math.abs(scale - 1) > 0.000001) changed = true;
        const a = row.axis + (row.left - row.axis) * scale;
        const b = row.axis + (row.right - row.axis) * scale;
        minX = Math.min(minX, a);
        maxX = Math.max(maxX, b);
      }
      if (!changed) return { filename: source.filename,
        image: source.image, x: source.x + offsetX, y: source.y };

      // Expand by 3 pixels to preserve antialiased silhouette edges.
      const originX = Math.floor(minX) - 3;
      const destWidth = Math.ceil(maxX) - originX + 5;
      const target = document.createElement("canvas");
      target.width = destWidth;
      target.height = source.h;
      const ctx = target.getContext("2d");
      if (!ctx) throw new Error("Could not create body-shape canvas");
      ctx.imageSmoothingEnabled = true;

      for (let rowY = 0; rowY < source.h; rowY++) {
        const row = rows[rowY];
        if (!row) continue;
        const scale = scales[rowY];
        const left = row.axis + (source.x - row.axis) * scale - originX;
        ctx.drawImage(
          source.image,
          0, rowY, source.w, 1,
          left, rowY, source.w * scale, 1
        );
      }
      this.canvasesBuilt++;
      return { filename: source.filename, image: target,
        x: originX + offsetX, y: source.y };
    }

    setShape(values = {}) {
      const changes = {};
      for (const [key, [min, max]] of Object.entries(LIMITS)) {
        const n = values[key] === undefined ? this[key] : Number(values[key]);
        if (!Number.isFinite(n)) return false;
        changes[key] = clamp(n, min, max);
      }
      if (Object.keys(changes).every(key => changes[key] === this[key])) return true;
      Object.assign(this, changes);

      // A widened upper torso carries its corresponding shoulder, elbow,
      // wrist and the three arm sprites together. Hips carry both legs in
      // the same way. This avoids gaps caused by moving only the torso edge.
      const shoulderOffsets = {};
      const hipOffsets = {};
      const centerX = this.basePivots.torso.x;
      for (const side of ["L", "R"]) {
        shoulderOffsets[side] =
          (this.basePivots["shoulder" + side].x - centerX) *
          (this.upperTorso / 100 - 1);
        hipOffsets[side] =
          (this.basePivots["hip" + side].x - centerX) *
          (this.hips / 100 - 1);
      }

      const output = new Map();
      for (const [filename, source] of this.sources) {
        const [kind, side] = PARTS[filename];
        if (kind === "head") {
          output.set(filename, this.deformHead(source));
        } else if (kind === "neck") {
          output.set(filename, this.deformNeck(source));
        } else {
          output.set(filename, this.deform(source, kind, side,
            kind === "upper" || kind === "lower" ? hipOffsets[side] : 0));
        }
      }

      // Preserve source pixels for arms and apply only a rigid translation.
      for (const [filename, base] of this.baseLayers) {
        const match = filename.match(/(?:UpperArm|LowerArm|hand|Hand)\((L|R)\)/);
        if (match) {
          output.set(filename, { ...base, x: (base.x || 0) + shoulderOffsets[match[1]] });
        }
      }

      for (const side of ["L", "R"]) {
        for (const id of ["shoulder", "elbow", "wrist"]) {
          this.rig.config.pivots[id + side].x =
            this.basePivots[id + side].x + shoulderOffsets[side];
        }
        for (const id of ["hip", "knee"]) {
          this.rig.config.pivots[id + side].x =
            this.basePivots[id + side].x + hipOffsets[side];
        }
      }

      this.rig.layers = this.rig.layers.map(layer =>
        output.get(layer.filename) || this.baseLayers.get(layer.filename) || layer
      );
      this.rig.render();
      return true;
    }

    reset() {
      return this.setShape({
        head: 100, neck: 100,
        upperTorso: 100, waist: 100, hips: 100,
        thighs: 100, calves: 100
      });
    }
  }

  window.DressLabBodyShape = DressLabBodyShape;
})();