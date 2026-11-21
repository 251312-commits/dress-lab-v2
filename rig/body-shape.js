/* Dress Lab V2 — independent leg-silhouette deformation.
 *
 * This is deliberately NOT the v1 whole-image warp. Only four leg PNG layers
 * are resampled, one horizontal image row at a time. The hip boundary
 * follows 30% of thigh change; the top and bottom knee pieces both receive
 * exactly 30% of EACH thigh and calf change, so the seam uses one shared
 * scale. The foot returns to its original width.
 *
 * Source PNGs and joint coordinates remain untouched. The output sprites
 * retain their source-pixel coordinates and work with the existing rig,
 * idle animation and large joint poses.
 */
(() => {
  "use strict";

  const clamp = (n, low, high) => Math.max(low, Math.min(high, n));
  const smoothstep = (a, b, t) => {
    const q = clamp((t - a) / (b - a), 0, 1);
    return q * q * (3 - 2 * q);
  };

  const PARTS = Object.freeze({
    "08-UpperLeg(L).PNG": ["upper", "L"],
    "09-UpperLeg(R).PNG": ["upper", "R"],
    "10-LowerLeg(L).PNG": ["lower", "L"],
    "11-LowerLeg(R).PNG": ["lower", "R"]
  });

  class DressLabBodyShape {
    constructor(rig) {
      if (!rig || !rig.layers || !rig.config?.pivots) {
        throw new Error("DressLabBodyShape requires an initialized DressLabRig");
      }
      this.rig = rig;
      this.thighs = 100;
      this.calves = 100;
      this.hipInfluence = 0.30;
      this.kneeInfluence = 0.30;
      this.sources = new Map();
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
        if (!context) throw new Error("Cannot prepare leg image: " + layer.filename);
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
        if (!any) throw new Error("Empty leg image: " + layer.filename);
        this.sources.set(layer.filename, source);
      }
      if (this.sources.size !== 4) {
        throw new Error("Leg part set is incomplete: expected four separate PNGs");
      }
    }

    getState() {
      return {
        thighs: this.thighs,
        calves: this.calves,
        hipInfluence: this.hipInfluence,
        hipScale: Number(this.hipScale().toFixed(4)),
        kneeInfluence: this.kneeInfluence,
        kneeScale: Number(this.kneeScale().toFixed(4))
      };
    }

    hipScale() {
      return 1 + this.hipInfluence * (this.thighs / 100 - 1);
    }

    kneeScale() {
      const dThigh = this.thighs / 100 - 1;
      const dCalf = this.calves / 100 - 1;
      // One shared value for BOTH upper-leg and lower-leg knee boundaries.
      return 1 + this.kneeInfluence * dThigh + this.kneeInfluence * dCalf;
    }

    // All widths are relative to the ORIGINAL local outline, never to a
    // previously changed sprite. This prevents cumulative deformation.
    factor(kind, side, y, source) {
      const upper = kind === "upper";
      const hip = this.rig.config.pivots["hip" + side].y;
      const knee = this.rig.config.pivots["knee" + side].y;
      const dThigh = this.thighs / 100 - 1;
      const dCalf = this.calves / 100 - 1;
      const hipDelta = this.hipInfluence * dThigh;
      const kneeDelta = this.kneeScale() - 1;

      if (upper) {
        const t = clamp((y - hip) / Math.max(1, knee - hip), 0, 1);
        // Keep a small stable zone around the upper hip attachment.
        // Move smoothly from its 30% influence to the full thigh width.
        const thighRise = smoothstep(0.06, 0.36, t);
        // Reach the SAME knee scale as the lower-leg piece before the seam.
        const kneeBlend = smoothstep(0.70, 0.90, t);
        return 1 + (hipDelta * (1 - thighRise) + dThigh * thighRise) *
          (1 - kneeBlend) + kneeDelta * kneeBlend;
      }

      // The lower-leg PNG includes the foot. Its bottom ~16% must remain
      // fixed to avoid flattening/recoloring the toes/foot contours.
      const footBottom = source.y + source.h - 1;
      const ankle = knee + (footBottom - knee) * 0.84;
      const t = clamp((y - knee) / Math.max(1, ankle - knee), 0, 1);
      // Knee-side rows start at exactly the upper-leg knee scale; the
      // shared width holds briefly before fading into the calf contour.
      const kneeWeight = 1 - smoothstep(0.10, 0.36, t);
      const calfBulge = smoothstep(0.18, 0.43, t) *
        (1 - smoothstep(0.52, 0.95, t));
      return 1 + kneeDelta * kneeWeight + dCalf * calfBulge;
    }

    // A row-based, smoothly interpolated horizontal mesh: one source image
    // row maps to a stretched/shrunk output row. Vertical coordinates do not
    // change, so hip/knee pivots and animations stay in the same coordinate
    // system. No new seams are introduced by resampling in the Y direction.
    deform(source, kind, side) {
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
        image: source.image, x: source.x, y: source.y };

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
        x: originX, y: source.y };
    }

    setShape(values = {}) {
      const nextThighs = values.thighs === undefined ? this.thighs : Number(values.thighs);
      const nextCalves = values.calves === undefined ? this.calves : Number(values.calves);
      if (!Number.isFinite(nextThighs) || !Number.isFinite(nextCalves)) {
        return false;
      }
      const thighs = clamp(nextThighs, 85, 135);
      const calves = clamp(nextCalves, 85, 135);
      if (this.thighs === thighs && this.calves === calves) return true;

      this.thighs = thighs;
      this.calves = calves;
      const output = new Map();
      for (const [filename, source] of this.sources) {
        const [kind, side] = PARTS[filename];
        output.set(filename, this.deform(source, kind, side));
      }
      // Replace only the four leg sprites atomically; the other 13 originals
      // keep their identity and are never deformed by this controller.
      this.rig.layers = this.rig.layers.map(layer => output.get(layer.filename) || layer);
      this.rig.render();
      return true;
    }

    reset() {
      return this.setShape({ thighs: 100, calves: 100 });
    }
  }

  window.DressLabBodyShape = DressLabBodyShape;
})();