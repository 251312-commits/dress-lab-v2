# Facial care artwork

Created for Dress Lab V2 with the built-in image generation tool: the five facial tools on 2026-11-24, and the washbasin on 2026-11-25. Each original file is a separate generated PNG with an alpha channel. No external artwork or third-party brands are included. Source images were copied without altering their pixels.

## Files

- `cleanser.png`
- `towel.png`
- `serum.png`
- `cream.png`
- `roller.png`
- `basin.png`

## Roller delivery revision

`roller-v2.png` is a lossless delivery copy of `roller.png`, re-encoded as a conventional RGBA PNG under a new URL. Dimensions (1254 × 1254), decoded RGB pixels and alpha are exactly identical to the generated original. The original file is retained above with its generation metadata. The delivery copy contains only standard image chunks; it does not change the artwork.

The original local and GitHub-main files were byte-identical, passed PNG chunk CRC validation, and decoded successfully. No truncated upload was found. The revised filename allows the shelf and pointer tool to request fresh image bytes; the user's previous browser-side image failure could not be reproduced from the file alone.

## Basin artwork

`basin.png` is the original transparent PNG produced by the built-in image generation tool on 2026-11-25. It was copied byte-for-byte into this project; no cropping, repainting, resampling, background removal, or alpha changes were applied.

- Dimensions: 1514 × 1039, RGBA; alpha spans 0–255.
- File size: 1,363,634 bytes.
- SHA-256: `7e0f3e5d687c9fc3d249ac608de7855148a2fc370b12f96d6cc3cff3a11a54e3`.
- Git blob SHA: `e0350b521c8f88b756089d181f650e093d2a604d`.
- PNG signature, all chunk CRCs, final IEND, and full image decoding passed validation.
- Visible silhouette bounds at alpha ≥ 16: `(50, 125)` to `(1451, 957)`; the right and bottom bounds are exclusive.
- Approximate visible water ellipse: center `(749, 442)`, radii `(624, 196)` in source-image pixels. This is an artwork estimate for placement, not an exact clipping mask. A slightly inset ellipse is appropriate for the washing hit region.
- With `object-fit: contain` in a 410 × 280 slot, the water ellipse is approximately centered at `(203, 119)` with radii `(168, 53)`, relative to the slot.

## Prompts

### cleanser

Use case: stylized-concept. Asset type: transparent PNG tool sprite for a mobile makeover game. Style: clean, soft 2D hand-drawn anime-inspired game illustration, delicate muted dark-mauve outline, simple rounded shapes, very gentle cel-like shading, pastel colors, recognizable at 64 pixels. Composition: one centered isolated object, front/slight three-quarter view, fills about 80% of square image, generous clear transparent margins, no floor or background, no cast ground shadow. No people, no hands, no scenery, no words, lettering, logos, watermark, border, checkerboard, backdrop, or UI. Actual alpha transparency. Primary request: a pastel mint facial foam cleanser pump bottle, ivory pump with short nozzle, pale mint rounded bottle, small fluffy ivory foam dollop sitting on its pump shoulder. Bottle has only a tiny simple embossed waterdrop symbol, no label or text.

### towel

Use case: stylized-concept. Asset type: transparent PNG tool sprite for a mobile makeover game. Style: clean, soft 2D hand-drawn anime-inspired game illustration, delicate muted dark-mauve outline, simple rounded shapes, very gentle cel-like shading, pastel colors, recognizable at 64 pixels. Composition: one centered isolated object, front/slight three-quarter view, fills about 80% of square image, generous clear transparent margins, no floor or background, no cast ground shadow. No people, no hands, no scenery, no words, lettering, logos, watermark, border, checkerboard, backdrop, or UI. Actual alpha transparency. Primary request: a soft ivory-white washcloth folded in a fluffy little rectangle, lightly draped front corner, simple very pale icy-blue edge piping. Readable rounded folds and cozy fabric; isolated single folded cloth, no basket or other objects.

### serum

Use case: stylized-concept. Asset type: transparent PNG tool sprite for a mobile makeover game. Style: clean, soft 2D hand-drawn anime-inspired game illustration, delicate muted dark-mauve outline, simple rounded shapes, very gentle cel-like shading, pastel colors, recognizable at 64 pixels. Composition: one centered isolated object, front/slight three-quarter view, fills about 80% of square image, generous clear transparent margins, no floor or background, no cast ground shadow. No people, no hands, no scenery, no words, lettering, logos, watermark, border, checkerboard, backdrop, or UI. Actual alpha transparency. Primary request: a small blush-pink glass skincare serum dropper bottle, ivory squeeze-bulb cap, rose-gold thin collar. One little luminous pink liquid droplet floating close to bottle shoulder. Rounded charming silhouette; no text or brand labels.

### cream

Use case: stylized-concept. Asset type: transparent PNG tool sprite for a mobile makeover game. Style: clean, soft 2D hand-drawn anime-inspired game illustration, delicate muted dark-mauve outline, simple rounded shapes, very gentle cel-like shading, pastel colors, recognizable at 64 pixels. Composition: one centered isolated object, front/slight three-quarter view, fills about 80% of square image, generous clear transparent margins, no floor or background, no cast ground shadow. No people, no hands, no scenery, no words, lettering, logos, watermark, border, checkerboard, backdrop, or UI. Actual alpha transparency. Primary request: an open low rounded pale-lavender moisturizing cream jar with an ivory cream swirl visible at top, ivory lid leaning neatly beside and overlapping jar, one unified object silhouette. No labels or lettering.

### roller

Use case: stylized-concept. Asset type: transparent PNG tool sprite for a mobile makeover game. Style: clean, soft 2D hand-drawn anime-inspired game illustration, delicate muted dark-mauve outline, simple rounded shapes, very gentle cel-like shading, pastel colors, recognizable at 64 pixels. Composition: one centered isolated object, front/slight three-quarter view, fills about 80% of square image, generous clear transparent margins, no floor or background, no cast ground shadow. No people, no hands, no scenery, no words, lettering, logos, watermark, border, checkerboard, backdrop, or UI. Actual alpha transparency. Primary request: a mint jade double-ended facial massage roller with a pale blush and rose-gold handle, large smooth mint oval stone roller at top and smaller mint roller at bottom. Subtly diagonal, tidy simple symmetrical metal forks. One isolated tool, no detached pieces.

### basin

Use case: stylized-concept.
Asset type: one transparent PNG washbasin sprite for the pastel mobile makeover game Dress Lab V2.
Primary request: a single shallow rounded ivory and very pale mint ceramic washbasin filled with clear, very pale blue water. The opening is a broad visible ellipse, viewed from the front and slightly above in a gentle three-quarter view. Keep the basin simple and immediately recognizable as a little washing bowl.
Style/medium: clean soft hand-drawn 2D anime-inspired game illustration, delicate muted dark-mauve contour, rounded forms, gentle pastel cel-like shading and a touch of soft painterly texture. Match a cozy ivory washcloth with icy-blue piping and a mint jade roller with blush-pink/rose-gold details. Do not include either reference object.
Composition/framing: landscape canvas, approximately 1.46:1 aspect ratio. One centered isolated wide basin, the entire silhouette visible with clear transparent margin, occupying roughly 90% of the width and 82% of the height. Place the water-opening center near 50% of image width and 38% of image height; its approximate horizontal radius is 38% of image width and vertical radius is 23% of image height. A broad open unobstructed water surface is needed so the game can place a washing gesture over it. The smooth low front wall extends below the water ellipse.
Materials/textures: warm ivory ceramic body, faint pale-mint shading near the lower rim, clean pale-blue water with only two or three delicate white curved highlights and soft watery shading. The water stays entirely inside the bowl.
Scene/backdrop: genuinely transparent alpha background. No floor, no cast ground shadow, no backdrop.
Constraints: exactly one basin with water; no towel, hands, people, faucet, soap, droplets floating outside the bowl, extra objects, text, letters, logos, icons, symbols, border, checkerboard, watermark, photorealism, or 3D render. Preserve actual transparent alpha around the complete object.

