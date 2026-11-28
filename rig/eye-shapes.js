/* Dress Lab V2 — image-based eye shape catalog.
 *
 * To add an option, append an entry below with a unique stable id and label.
 * All four transparent PNGs must use the full 1206 × 2622 base artboard;
 * never crop or rescale the exported files. The renderer crops `box` only
 * after loading. `box` encloses both eyes including lashes and highlights.
 * `eye.x` divides the left/right halves; `eye.y` is the gaze origin,
 * `lidBottom` the blink hinge, and maxX/maxY the iris travel in source pixels.
 * `faceBounds` limits horizontal placement so large/wide eyes stay on the head.
 * `defaultColor` is only the UI swatch for the unmodified iris artwork.
 * An optional `preview` image can be supplied for a future thumbnail picker.
 * Register actual artwork only: the game does not show unimplemented options.
 */
(() => {
  "use strict";

  window.DressLabEyeShapes = [
    {
      id: "eyes01",
      label: "기본",
      defaultColor: "#9F2C3E",
      faceBounds: { left: 135, right: 523 },
      box: { x: 146, y: 729, w: 368, h: 130 },
      eye: { x: 329, y: 796, lidBottom: 844, maxX: 19, maxY: 14 },
      sources: {
        sclera: "./assets/eyes/Eyes01_Sclera.PNG",
        pupil: "./assets/eyes/Eyes01_Pupil.PNG",
        highlights: "./assets/eyes/Eyes01_Highlights.PNG",
        eyelashes: "./assets/eyes/Eyes01_Eyelashes.PNG"
      }
    }
  ];
})();
