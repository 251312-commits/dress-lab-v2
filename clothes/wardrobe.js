/* V2 first wearable outfit: original lightweight SVG art in native 1206x2622 coordinates.
 * Three transparent files; no skin-tone transformation; no modifications to base PNGs.
 */
(() => {
  "use strict";
  const BASE = "./clothes/basic-white-tee/";
  const ORIGINAL_SHOULDERS = {
    shoulderL: { x: 244.3, y: 1013.2 },
    shoulderR: { x: 412.8, y: 1013.3 }
  };
  const clamp = (x,a,b) => Math.min(b,Math.max(a,x));

  class DressLabWardrobe {
    constructor(rig) {
      if (!rig || typeof rig.render !== "function") throw new Error("A working V2 rig is required");
      this.rig = rig;
      this.ready = false;
      this.equipped = false;
      this.parts = [];
      this.item = null;
      rig.wardrobe = this;
    }

    async load() {
      const response = await fetch(BASE + "item.json?v=white-tee-fit-v2");
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
        const path = BASE + encodeURIComponent(part.src) + "?v=white-tee-fit-v2";
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

    draw(ctx) {
      if (!this.ready || !this.equipped) return;
      const state = window.dressLabBodyShape?.getState() || {};
      const ratioMap = window.dressLabBodyShape?.mapRatioY?.bind(window.dressLabBodyShape);
      const ratioStretch = ratioMap
        ? (ratioMap(1296) - ratioMap(1013.2)) / (1296 - 1013.2) : 1;
      const torsoScaleX = clamp(1 +
        (Number(state.upperTorso ?? 100) - 100) / 100 * .75 +
        (Number(state.waist ?? 100) - 100) / 100 * .20 +
        (Number(state.bust ?? 100) - 100) / 100 * .12, .82, 1.32);
      const sleeveWidth = clamp(1 + (Number(state.armWidth ?? 100) - 100) / 100 * .55, .85, 1.18);
      const sleeveLength = clamp(Number(state.armLength ?? 100) / 100, .85, 1.2);

      // Draw sleeves behind the garment's torso so the shoulder join is hidden.
      for (const part of this.parts) {
        ctx.save();
        this.rotateWith(ctx, part.joint);
        if (part.joint === "torso") {
          ctx.translate(328.6, 1013.2);
          ctx.scale(torsoScaleX, ratioStretch);
          ctx.translate(-328.6, -1013.2);
        } else {
          const base = ORIGINAL_SHOULDERS[part.joint];
          const joint = this.rig.config.pivots[part.joint];
          ctx.translate(joint.x - base.x, joint.y - base.y);
          ctx.translate(base.x, base.y);
          ctx.scale(sleeveWidth, sleeveLength * ratioStretch);
          ctx.translate(-base.x, -base.y);
        }
        ctx.drawImage(part.image, part.x, part.y);
        ctx.restore();
      }
    }
  }
  window.DressLabWardrobe = DressLabWardrobe;
})();
