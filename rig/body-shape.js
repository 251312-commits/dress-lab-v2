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
  // Quintic interpolation has zero first AND second derivatives at the
  // endpoints: adjacent leg segments join without a visible curvature kink.
  const smootherstep = (a, b, t) => {
    const q = clamp((t - a) / (b - a), 0, 1);
    return q * q * q * (q * (q * 6 - 15) + 10);
  };

  const PARTS = Object.freeze({
    "01-Head.PNG": ["head", null],
    "02-Neck.PNG": ["neck", null],
    "03-Bust.PNG": ["bust", null],
    "06-UpperTorso.PNG": ["upperTorso", null],
    "07-LowerTorso.PNG": ["lowerTorso", null],
    "08-TorsoJoint.PNG": ["waistJoint", null],
    "09-Hips.PNG": ["pelvis", null],
    "10-UpperLeg(L).PNG": ["upper", "L"],
    "11-UpperLeg(R).PNG": ["upper", "R"],
    "12-LowerLeg(L).PNG": ["lower", "L"],
    "13-LowerLeg(R).PNG": ["lower", "R"]
  });
  const LIMITS = Object.freeze({
    head: Object.freeze([70, 113]),
    neck: Object.freeze([78, 127]),
    neckWidth: Object.freeze([80, 120]),
    upperTorso: Object.freeze([90, 118]),
    bust: Object.freeze([89, 119]),
    ratio: Object.freeze([82, 118]),
    armWidth: Object.freeze([80, 125]),
    armLength: Object.freeze([85, 120]),
    handSize: Object.freeze([80, 125]),
    waist: Object.freeze([85, 120]),
    hips: Object.freeze([90, 120]),
    thighs: Object.freeze([90, 125]),
    calves: Object.freeze([92, 112])
  });

  class DressLabBodyShape {
    constructor(rig) {
      if (!rig || !rig.layers || !rig.config?.pivots) {
        throw new Error("DressLabBodyShape requires an initialized DressLabRig");
      }
      this.rig = rig;
      this.head = 100;
      this.neck = 100;
      this.neckWidth = 100;
      this.upperTorso = 100;
      this.bust = 100;
      this.ratio = 100;
      this.armWidth = 100;
      this.armLength = 100;
      this.handSize = 100;
      this.waist = 100;
      this.hips = 100;
      this.thighs = 100;
      this.calves = 100;
      this.limits = LIMITS;
      // Recalibrated for bounded curvature at the new slider extremes.
      // Neutral pelvis + thigh 90–125% -> hip seam 96.5–108.75%.
      // Thigh 90–125% + calf 92–112% -> knee seam 95.5–109.25%.
      this.hipInfluence = 0.35;
      this.kneeInfluence = 0.25;
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

        // Legs are contiguous filled shapes. Ignore disconnected alpha
        // specks: they formerly dragged the per-row deformation axis and
        // produced sharp bumps when a leg was enlarged. Other part types
        // retain their original alpha-scan behavior.
        const kind = PARTS[layer.filename][0];
        const isLeg = kind === "upper" || kind === "lower";
        let any = false;
        for (let row = 0; row < h; row++) {
          let left = w, right = -1;
          const start = row * w * 4;
          if (isLeg) {
            let runStart = -1, lastSolid = -1, bestLength = 0;
            for (let x = 0; x <= w + 2; x++) {
              const filled = x < w && rgba[start + x * 4 + 3] > 4;
              if (filled) {
                if (runStart === -1) runStart = x;
                lastSolid = x;
              } else if (runStart !== -1 && x - lastSolid > 2) {
                const length = lastSolid - runStart + 1;
                if (length > bestLength) {
                  bestLength = length;
                  left = runStart;
                  right = lastSolid;
                }
                runStart = -1;
              }
            }
          } else {
            for (let x = 0; x < w; x++) {
              if (rgba[start + x * 4 + 3] > 12) {
                if (x < left) left = x;
                right = x;
              }
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
        // Preserve the original RGBA for a single continuous inverse-map
        // raster; the old 1px drawImage strips caused horizontal cracks.
        if (isLeg) source.pixels = rgba;
        // A small spatial filter is applied to the *deformation offset*, not
        // to the original pixels. Neutral 100% art stays pixel-identical.
        if (isLeg) {
          for (let row = 0; row < h; row++) {
            const current = source.rows[row];
            if (!current) continue;
            let weightedLeft = 0, weightedRight = 0, weightSum = 0;
            for (let offset = -10; offset <= 10; offset++) {
              const neighbour = source.rows[row + offset];
              if (!neighbour) continue;
              const weight = 11 - Math.abs(offset);
              weightedLeft += neighbour.left * weight;
              weightedRight += neighbour.right * weight;
              weightSum += weight;
            }
            current.smoothLeft = weightedLeft / weightSum;
            current.smoothRight = weightedRight / weightSum;
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
      const torsoSource = this.sources.get("06-UpperTorso.PNG");
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

      // Preserve the shoulder position and the bottom of the feet. The hip
      // seam is allowed to move up/down, trading torso length against leg
      // length without changing the artboard or creating a gap between parts.
      const lowerLegFiles = ["12-LowerLeg(L).PNG", "13-LowerLeg(R).PNG"];
      const footBottomY = Math.max(...lowerLegFiles.map(filename => {
        const part = this.sources.get(filename);
        const last = [...part.rows].reverse().find(Boolean);
        return last.y;
      }));
      const shoulderLineY =
        (this.basePivots.shoulderL.y + this.basePivots.shoulderR.y) / 2;
      const hipLineY =
        (this.basePivots.hipL.y + this.basePivots.hipR.y) / 2;
      if (!(shoulderLineY < hipLineY && hipLineY < footBottomY)) {
        throw new Error("Body-ratio reference anchors are out of order");
      }
      this.ratioAnchors = Object.freeze({
        top: shoulderLineY,
        hip: hipLineY,
        bottom: footBottomY
      });
      const bustPart = this.sources.get("03-Bust.PNG");
      this.bustTopY = bustPart.rows.find(Boolean).y;
      this.bustBottomY = [...bustPart.rows].reverse().find(Boolean).y;
    }

    getState() {
      return {
        head: this.head,
        neck: this.neck,
        neckWidth: this.neckWidth,
        upperTorso: this.upperTorso,
        bust: this.bust,
        ratio: this.ratio,
        armWidth: this.armWidth,
        armLength: this.armLength,
        handSize: this.handSize,
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

    // The pelvis and upper thighs share the same joint multiplier.
    // The hips slider contributes fully; the THIGH change contributes 35%.
    // Applying this same value to both images is essential at the seam.
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
        // Inspection of the source alpha contours shows that the wide
        // pelvis/upper-thigh edges meet near source y=1330. The hip pivot at
        // y≈1368 is near the narrow crotch tip, NOT the visible seam.
        // Match LowerTorso at y=1280 and reach the *shared* hip multiplier
        // by y=1330, where both outer contours line up.
        return pelvisScale + (hipConnection - pelvisScale) *
          smoothstep(1280, 1330, y);
      }

      // Shape factors are always computed from immutable source anchors.
      // Previously shaped pivots may already have a ratio-adjusted Y.
      const hip = this.basePivots["hip" + side].y;
      const knee = this.basePivots["knee" + side].y;
      if (kind === "upper") {
        // Smooth single thigh belly; identical factors at the hip and knee.
        const t = clamp((y - hip) / Math.max(1, knee - hip), 0, 1);
        return t <= 0.43
          ? hipConnection + (thighScale - hipConnection) *
              smootherstep(0, 0.43, t)
          : thighScale + (kneeConnection - thighScale) *
              smootherstep(0.43, 1, t);
      }

      // One calf curve, instead of independently blended knee and bulge
      // values. The ankle smoothly regains original foot thickness.
      const footBottom = source.y + source.h - 1;
      const ankle = knee + (footBottom - knee) * 0.84;
      const t = clamp((y - knee) / Math.max(1, ankle - knee), 0, 1);
      return t <= 0.43
        ? kneeConnection + (calfScale - kneeConnection) *
            smootherstep(0, 0.43, t)
        : calfScale + (1 - calfScale) * smootherstep(0.43, 0.96, t);
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
      if (this.neck === 100 && this.neckWidth === 100) {
        return { filename: source.filename,
          image: source.image, x: source.x, y: source.y };
      }
      const { neckBaseY, x: neckAxis } = this.headNeckAnchors;
      const lengthScale = this.neck / 100;
      const thicknessScale = this.neckWidth / 100;
      const cut = clamp(neckBaseY - source.y, 0, source.h);
      const topY = neckBaseY + (source.y - neckBaseY) * lengthScale;
      const originY = Math.floor(Math.min(topY, source.y)) - 2;
      const bottomY = source.y + source.h;

      // Expand about the centerline, NOT the left edge of the neck PNG.
      // This leaves its base centered inside the UpperTorso opening.
      const scaledLeft = neckAxis + (source.x - neckAxis) * thicknessScale;
      const scaledRight = scaledLeft + source.w * thicknessScale;
      const originX = Math.floor(scaledLeft) - 2;
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(scaledRight - originX) + 2;
      canvas.height = Math.ceil(bottomY - originY) + 2;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Could not resize neck sprite");
      ctx.imageSmoothingEnabled = true;
      const x = scaledLeft - originX;
      const w = source.w * thicknessScale;
      if (cut > 0) {
        ctx.drawImage(source.image,
          0, 0, source.w, cut,
          x, topY - originY, w, cut * lengthScale);
      }
      if (cut < source.h) {
        ctx.drawImage(source.image,
          0, cut, source.w, source.h - cut,
          x, source.y + cut - originY, w, source.h - cut);
      }
      this.canvasesBuilt++;
      return { filename: source.filename, image: canvas,
        x: originX, y: originY };
    }

    // Affine limb deformation, defined in bone coordinates. The arm is
    // lengthened ALONG the original shoulder-elbow/wrist axis and thickened
    // PERPENDICULAR to that axis. The source PNG and joint poses stay intact.
    // Position is the new start pivot after the parent's shoulder/arm motion.
    transformArm(base, start, end, position) {
      const { filename, image } = base;
      const sourceX = base.x || 0, sourceY = base.y || 0;
      const width = image.width || image.naturalWidth;
      const height = image.height || image.naturalHeight;
      const L = this.armLength / 100, W = this.armWidth / 100;

      if (L === 1 && W === 1) {
        const dx = position.x - start.x;
        const dy = position.y - start.y;
        return { ...base,
          x: Math.abs(dx) < 1e-8 ? sourceX : sourceX + dx,
          y: Math.abs(dy) < 1e-8 ? sourceY : sourceY + dy };
      }

      const dx = end.x - start.x, dy = end.y - start.y;
      const length = Math.hypot(dx, dy);
      if (!length) throw new Error("Cannot reshape a zero-length arm segment");
      const ux = dx / length, uy = dy / length;
      const vx = -uy, vy = ux;

      const a = L * ux * ux + W * vx * vx;
      const b = L * ux * uy + W * vx * vy;
      const c = L * uy * ux + W * vy * vx;
      const d = L * uy * uy + W * vy * vy;
      const tx = position.x + a * (sourceX - start.x) + c * (sourceY - start.y);
      const ty = position.y + b * (sourceX - start.x) + d * (sourceY - start.y);

      const corners = [
        [0, 0], [width, 0], [0, height], [width, height]
      ].map(([x, y]) => [a * x + c * y + tx, b * x + d * y + ty]);
      const left = Math.floor(Math.min(...corners.map(p => p[0]))) - 3;
      const top = Math.floor(Math.min(...corners.map(p => p[1]))) - 3;
      const right = Math.ceil(Math.max(...corners.map(p => p[0]))) + 3;
      const bottom = Math.ceil(Math.max(...corners.map(p => p[1]))) + 3;

      const canvas = document.createElement("canvas");
      canvas.width = right - left;
      canvas.height = bottom - top;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Could not transform an arm segment");
      ctx.imageSmoothingEnabled = true;
      ctx.setTransform(a, b, c, d, tx - left, ty - top);
      ctx.drawImage(image, 0, 0);
      this.canvasesBuilt++;
      return { filename, image: canvas, x: left, y: top };
    }

    // A hand is attached to the *end* of the transformed forearm, using the
    // same wrist pivot for drawing and the rig hierarchy. Close to the wrist,
    // its cuff inherits the arm-width scale. Beyond that narrow cuff, it
    // smoothly approaches the independent hand-size setting. This avoids a
    // visible gap when hands and forearms have different thickness settings.
    // Each row is mapped in the forearm's local bone axes; the hand is never
    // stretched along the arm length a second time.
    transformHand(base, wrist, movedWrist, elbow) {
      const { filename, image } = base;
      const sourceX = base.x || 0, sourceY = base.y || 0;
      const width = image.width || image.naturalWidth;
      const height = image.height || image.naturalHeight;
      const size = this.handSize / 100;
      const armWidth = this.armWidth / 100;
      const offsetX = movedWrist.x - wrist.x;
      const offsetY = movedWrist.y - wrist.y;

      // Preserve exact source artwork when both shape sliders are neutral.
      // This is important for image quality and the existing idle renderer.
      if (size === 1 && armWidth === 1) {
        return { ...base,
          x: Math.abs(offsetX) < 1e-8 ? sourceX : sourceX + offsetX,
          y: Math.abs(offsetY) < 1e-8 ? sourceY : sourceY + offsetY };
      }

      const dx = wrist.x - elbow.x, dy = wrist.y - elbow.y;
      const length = Math.hypot(dx, dy);
      if (!length) throw new Error("Cannot attach hand to zero-length forearm");
      const ux = dx / length, uy = dy / length;
      const vx = -uy, vy = ux;

      // Measure depth along the forearm extension rather than screen Y; the
      // two hands therefore stay symmetric even when forearms are slanted.
      const depthRange = Math.max(20, Math.min(75, height * 0.7));
      function transformRow(row) {
        const xmid = sourceX + width / 2;
        const ymid = sourceY + row + 0.5;
        const depth = (xmid - wrist.x) * ux + (ymid - wrist.y) * uy;
        const widthScale = armWidth + (size - armWidth) *
          smoothstep(0, depthRange, Math.max(0, depth));
        const a = size * ux * ux + widthScale * vx * vx;
        const b = size * ux * uy + widthScale * vx * vy;
        const c = size * uy * ux + widthScale * vx * vy;
        const d = size * uy * uy + widthScale * vy * vy;
        // The wrist source point maps exactly to the NEW wrist pivot.
        const tx = movedWrist.x + a * (sourceX - wrist.x) + c * (sourceY - wrist.y);
        const ty = movedWrist.y + b * (sourceX - wrist.x) + d * (sourceY - wrist.y);
        return { a, b, c, d, tx, ty, widthScale };
      }

      const transformed = [];
      let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
      for (let row = 0; row < height; row++) {
        const m = transformRow(row);
        transformed.push(m);
        for (const [x, y] of [
          [0, row], [width, row], [0, row + 1], [width, row + 1]
        ]) {
          const px = m.a * x + m.c * y + m.tx;
          const py = m.b * x + m.d * y + m.ty;
          left = Math.min(left, px);
          right = Math.max(right, px);
          top = Math.min(top, py);
          bottom = Math.max(bottom, py);
        }
      }
      left = Math.floor(left) - 3;
      top = Math.floor(top) - 3;
      right = Math.ceil(right) + 3;
      bottom = Math.ceil(bottom) + 3;
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, right - left);
      canvas.height = Math.max(1, bottom - top);
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Could not attach hand sprite");
      ctx.imageSmoothingEnabled = true;
      for (let row = 0; row < height; row++) {
        const m = transformed[row];
        ctx.setTransform(m.a, m.b, m.c, m.d, m.tx - left, m.ty - top);
        ctx.drawImage(image, 0, row, width, 1, 0, row, width, 1);
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      this.canvasesBuilt++;
      return { filename, image: canvas, x: left, y: top };
    }

    // Bust is an independent overlay above UpperTorso. Resizing at this
    // stage keeps its top contour fixed and grows the lower volume, while
    // preserving the current upper-torso width adjustment.
    resizeBust(layer) {
      if (this.bust === 100) return layer;
      const scale = this.bust / 100;
      const image = layer.image;
      const w = image.width || image.naturalWidth;
      const h = image.height || image.naturalHeight;
      const sourceX = layer.x || 0;
      const sourceY = layer.y || 0;
      const anchorX = this.basePivots.torso.x;
      const anchorY = this.bustTopY;
      const span = Math.max(1, this.bustBottomY - anchorY);
      // Preserve the ENTIRE top edge (position and width). Grow/shrink
      // horizontally on both sides from the center toward the lower bust.
      const widthAt = y => 1 + (scale - 1) *
        smoothstep(0, 0.80, clamp((y - anchorY) / span, 0, 1));
      let minX = Infinity, maxX = -Infinity;
      for (let row = 0; row < h; row++) {
        const sx = widthAt(sourceY + row);
        const left = anchorX + (sourceX - anchorX) * sx;
        minX = Math.min(minX, left);
        maxX = Math.max(maxX, left + w * sx);
      }
      const minY = anchorY + (sourceY - anchorY) * scale;
      const maxY = anchorY + (sourceY + h - anchorY) * scale;
      const originX = Math.floor(minX) - 3;
      const originY = Math.floor(minY) - 3;
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.ceil(maxX) - originX + 3);
      canvas.height = Math.max(1, Math.ceil(maxY) - originY + 3);
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Cannot resize the bust PNG");
      ctx.imageSmoothingEnabled = true;
      for (let row = 0; row < h; row++) {
        const sx = widthAt(sourceY + row);
        const x = anchorX + (sourceX - anchorX) * sx - originX;
        const y = anchorY + (sourceY + row - anchorY) * scale - originY;
        ctx.drawImage(image, 0, row, w, 1, x, y, w * sx, scale);
      }
      this.canvasesBuilt++;
      return { filename: layer.filename, image: canvas, x: originX, y: originY };
    }

    // Source-coordinate mapping for the torso-to-leg ratio:
    // - head/neck/shoulders stay fixed;
    // - upper body elongates while the lower body shortens, or vice versa;
    // - feet remain at their original Y;
    // - the same mapping is used for every part AND every joint pivot.
    mapRatioY(y) {
      if (this.ratio === 100) return y;
      const { top, hip, bottom } = this.ratioAnchors;
      const shift = (this.ratio / 100 - 1) * (hip - top);
      if (y <= top || y >= bottom) return y;
      if (y <= hip) return y + shift * (y - top) / (hip - top);
      return y + shift * (bottom - y) / (bottom - hip);
    }

    // Four or fewer vertical blits per sprite rather than hundreds of strips.
    // Both sides of the hip junction are mapped by the same continuous
    // function, and no distortion accumulates when the slider is moved.
    warpRatioLayer(layer) {
      if (this.ratio === 100) return layer;
      // Head and neck are above the shoulder anchor and must NEVER deform
      // when changing the relative torso/leg lengths. This explicit rule
      // also protects them when their sprite has sparse off-body pixels.
      if (layer.filename === "01-Head.PNG" || layer.filename === "02-Neck.PNG") {
        return layer;
      }
      const image = layer.image;
      const width = image.width || image.naturalWidth;
      const height = image.height || image.naturalHeight;
      const start = layer.y || 0, end = start + height;
      const { top, hip, bottom } = this.ratioAnchors;
      if (end <= top || start >= bottom) return layer;
      const destTop = this.mapRatioY(start);
      const destBottom = this.mapRatioY(end);
      const originY = Math.floor(Math.min(destTop, destBottom)) - 2;
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = Math.ceil(Math.max(destTop, destBottom) - originY) + 2;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Cannot resize the torso/leg ratio");
      ctx.imageSmoothingEnabled = true;
      const cuts = [start, top, hip, bottom, end]
        .filter(y => y >= start && y <= end)
        .sort((a, b) => a - b);
      for (let i = 1; i < cuts.length; i++) {
        const a = cuts[i - 1], b = cuts[i];
        if (b - a <= 1e-8) continue;
        ctx.drawImage(image, 0, a - start, width, b - a,
          0, this.mapRatioY(a) - originY, width,
          this.mapRatioY(b) - this.mapRatioY(a));
      }
      this.canvasesBuilt++;
      return { ...layer, image: canvas, y: originY };
    }

    // Draw the entire leg in one pixel image, never as individually blitted
    // 1px strips. This eliminates horizontal scanline cracks on mobile.
    // The original pixels/shadows remain authoritative. Only the mapped
    // centerline is smoothed; near-zero alpha-row width is NEVER a divisor.
    deformLeg(source, kind, side, offsetX = 0) {
      const knee = this.basePivots["knee" + side].y;
      const sampling = new Array(source.h);
      let minX = Infinity, maxX = -Infinity, changed = false;

      for (let y = 0; y < source.h; y++) {
        const row = source.rows[y];
        if (!row) continue;
        const scale = this.factor(kind, side, row.y, source);
        if (Math.abs(scale - 1) > 0.000001) changed = true;
        // At the pelvis attachment (y≈1330) and both sides of the knee,
        // keep the exact original centerline and shared joint width.
        const smoothedAxis = (row.smoothLeft + row.smoothRight) / 2;
        const distance = kind === "upper"
          ? Math.min(Math.abs(row.y - knee), Math.abs(row.y - 1330))
          : Math.abs(row.y - knee);
        const smoothing = smootherstep(0, 24, distance);
        const axis = row.axis + (smoothedAxis - row.axis) * smoothing;
        const paintedLeft = axis + (row.left - axis) * scale;
        const paintedRight = axis + (row.right - axis) * scale;
        minX = Math.min(minX, paintedLeft);
        maxX = Math.max(maxX, paintedRight);
        sampling[y] = { axis, scale, paintedLeft, paintedRight };
      }
      if (!changed) return { filename: source.filename,
        image: source.image, x: source.x + offsetX, y: source.y };
      if (!Number.isFinite(minX) || !Number.isFinite(maxX)) {
        throw new Error("Invalid continuous leg mesh: " + source.filename);
      }

      const originX = Math.floor(minX) - 4;
      const target = document.createElement("canvas");
      target.width = Math.max(1, Math.ceil(maxX) - originX + 5);
      target.height = source.h;
      const ctx = target.getContext("2d");
      if (!ctx) throw new Error("Could not create a continuous leg canvas");
      const imageData = ctx.createImageData(target.width, target.height);
      const pixels = imageData.data, src = source.pixels;
      if (!src) throw new Error("Missing original leg pixel data");
      for (let y = 0; y < source.h; y++) {
        const row = sampling[y];
        if (!row) continue;
        const start = Math.max(0, Math.floor(row.paintedLeft - originX) - 2);
        const end = Math.min(target.width - 1,
          Math.ceil(row.paintedRight - originX) + 2);
        const sourceRow = y * source.w * 4;
        const targetRow = y * target.width * 4;
        for (let x = start; x <= end; x++) {
          // Pixel-center inverse map; not a ratio of measured row widths.
          const srcX = (originX + x + 0.5 - row.axis) / row.scale +
            row.axis - source.x - 0.5;
          const a = Math.floor(srcX), b = a + 1;
          const wb = srcX - a, wa = 1 - wb;
          const ia = a >= 0 && a < source.w ? sourceRow + 4 * a : -1;
          const ib = b >= 0 && b < source.w ? sourceRow + 4 * b : -1;
          const aa = ia < 0 ? 0 : src[ia + 3];
          const ab = ib < 0 ? 0 : src[ib + 3];
          const alpha = aa * wa + ab * wb;
          if (alpha <= 0) continue;
          const out = targetRow + x * 4;
          pixels[out + 3] = Math.round(alpha);
          // Premultiplied-alpha interpolation avoids dark/white edge halos.
          for (let c = 0; c < 3; c++) {
            const ca = ia < 0 ? 0 : src[ia + c] * aa * wa;
            const cb = ib < 0 ? 0 : src[ib + c] * ab * wb;
            pixels[out + c] = Math.round((ca + cb) / alpha);
          }
        }
      }
      ctx.putImageData(imageData, 0, 0);
      this.canvasesBuilt++;
      return { filename: source.filename, image: target,
        x: originX + offsetX, y: source.y };
    }

    // Unchanged row deformation for head/torso/hip pieces. Leg images alone
    // use the new continuous inverse rasterizer above.
    deform(source, kind, side, offsetX = 0) {
      if (kind === "upper" || kind === "lower") {
        return this.deformLeg(source, kind, side, offsetX);
      }
      const rows = source.rows;
      let minX = Infinity, maxX = -Infinity, changed = false;
      const scales = new Float32Array(source.h);
      for (let y = 0; y < source.h; y++) {
        const row = rows[y];
        if (!row) continue;
        const scale = this.factor(kind, side, row.y, source);
        scales[y] = scale;
        if (Math.abs(scale - 1) > 0.000001) changed = true;
        const left = row.axis + (row.left - row.axis) * scale;
        const right = row.axis + (row.right - row.axis) * scale;
        minX = Math.min(minX, left);
        maxX = Math.max(maxX, right);
      }
      if (!changed) return { filename: source.filename,
        image: source.image, x: source.x + offsetX, y: source.y };
      const originX = Math.floor(minX) - 3;
      const target = document.createElement("canvas");
      target.width = Math.max(1, Math.ceil(maxX) - originX + 5);
      target.height = source.h;
      const ctx = target.getContext("2d");
      if (!ctx) throw new Error("Could not reshape body part");
      ctx.imageSmoothingEnabled = true;
      for (let y = 0; y < source.h; y++) {
        const row = rows[y];
        if (!row) continue;
        const scale = scales[y];
        const destX = row.axis + (source.x - row.axis) * scale - originX;
        ctx.drawImage(source.image,
          0, y, source.w, 1, destX, y, source.w * scale, 1);
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
        // Move the hip/knee joint and BOTH leg pieces along the same global
        // pelvis expansion used at the seam. Using only the hips slider here
        // would leave a gap when the thigh slider changes the shared width.
        hipOffsets[side] =
          (this.basePivots["hip" + side].x - centerX) *
          (this.hipScale() - 1);
      }

      const output = new Map();
      for (const [filename, source] of this.sources) {
        const [kind, side] = PARTS[filename];
        if (kind === "head") {
          output.set(filename, this.deformHead(source));
        } else if (kind === "neck") {
          output.set(filename, this.deformNeck(source));
        } else {
          const local = this.deform(source, kind, side,
            kind === "upper" || kind === "lower" ? hipOffsets[side] : 0);
          output.set(filename, kind === "bust" ? this.resizeBust(local) : local);
        }
      }

      // Keep the whole shoulder -> elbow -> wrist -> hand attachment chain.
      // Upper and lower arm share the same shape scale, while the hand has an
      // independent size parameter and a wrist cuff matched to arm thickness.
      for (const side of ["L", "R"]) {
        const shoulder = this.basePivots["shoulder" + side];
        const elbow = this.basePivots["elbow" + side];
        const wrist = this.basePivots["wrist" + side];
        const length = this.armLength / 100;
        const shiftedShoulder = {
          x: shoulder.x + shoulderOffsets[side],
          y: shoulder.y
        };
        const movedElbow = {
          x: shiftedShoulder.x + (elbow.x - shoulder.x) * length,
          y: shiftedShoulder.y + (elbow.y - shoulder.y) * length
        };
        const movedWrist = {
          x: shiftedShoulder.x + (wrist.x - shoulder.x) * length,
          y: shiftedShoulder.y + (wrist.y - shoulder.y) * length
        };

        const filenames = [
          "04-UpperArm(" + side + ").PNG",
          "05-UpperArm(" + side + ").PNG",
          "14-LowerArm(" + side + ").PNG",
          "15-LowerArm(" + side + ").PNG"
        ];
        const upperName = side === "L" ? filenames[0] : filenames[1];
        const lowerName = side === "L" ? filenames[2] : filenames[3];
        for (const [filename, begin, end, destination] of [
          [upperName, shoulder, elbow, shiftedShoulder],
          [lowerName, elbow, wrist, movedElbow]
        ]) {
          const base = this.baseLayers.get(filename);
          if (!base) throw new Error("Missing arm image: " + filename);
          output.set(filename, this.transformArm(base, begin, end, destination));
        }

        const handName = side === "L" ? "16-hand(L).PNG" : "17-Hand(R).PNG";
        const handBase = this.baseLayers.get(handName);
        if (!handBase) throw new Error("Missing hand image: " + handName);
        output.set(handName, this.transformHand(
          handBase, wrist, movedWrist, elbow
        ));
        for (const [id, point] of [
          ["shoulder", shiftedShoulder],
          ["elbow", movedElbow],
          ["wrist", movedWrist]
        ]) {
          this.rig.config.pivots[id + side].x = point.x;
          this.rig.config.pivots[id + side].y = point.y;
        }
        for (const id of ["hip", "knee"]) {
          this.rig.config.pivots[id + side].x =
            this.basePivots[id + side].x + hipOffsets[side];
          this.rig.config.pivots[id + side].y = this.basePivots[id + side].y;
        }
      }

      // Convert all the pre-ratio sprites and joint pivots through the SAME
      // vertical mapping. Shoulder and feet are anchored; the hip junction
      // remains seamless as its height changes.
      this.rig.config.pivots.torso.y =
        this.mapRatioY(this.basePivots.torso.y);
      for (const side of ["L", "R"]) {
        for (const id of ["shoulder", "elbow", "wrist", "hip", "knee"]) {
          const key = id + side;
          this.rig.config.pivots[key].y =
            this.mapRatioY(this.rig.config.pivots[key].y);
        }
      }

      this.rig.layers = this.rig.layers.map(layer => this.warpRatioLayer(
        output.get(layer.filename) || this.baseLayers.get(layer.filename) || layer
      ));
      // Cover radii share the same deformation parameters as the limb ends.
      this.rig.jointCapScale = {
        elbow: this.armWidth / 100,
        knee: this.kneeScale()
      };
      this.rig.render();
      return true;
    }

    reset() {
      return this.setShape({
        head: 100, neck: 100, neckWidth: 100,
        upperTorso: 100, bust: 100, ratio: 100,
        armWidth: 100, armLength: 100,
        handSize: 100, waist: 100, hips: 100,
        thighs: 100, calves: 100
      });
    }
  }

  window.DressLabBodyShape = DressLabBodyShape;
})();