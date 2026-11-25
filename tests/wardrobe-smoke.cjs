// Static smoke check for the first V2 garment. Run: node tests/wardrobe-smoke.cjs
const fs = require("node:fs");
const assert = require("node:assert/strict");
const path = require("node:path");
const root = path.join(__dirname, "..");
const dir = path.join(root, "clothes/basic-white-tee");
const item = JSON.parse(fs.readFileSync(path.join(dir,"item.json"),"utf8"));
assert.deepEqual(item.canvas, {width:1206,height:2622});
assert.deepEqual(item.parts.map(p=>p.joint), ["shoulderL","shoulderR","torso"]);
for (const part of item.parts) {
  const svg=fs.readFileSync(path.join(dir,part.src),"utf8");
  assert.match(svg,/<svg\b/);
  assert.match(svg,/viewBox=/);
  const width = /width="(\d+)"/.exec(svg);
  const height = /height="(\d+)"/.exec(svg);
  const box = /viewBox="(\d+) (\d+) (\d+) (\d+)"/.exec(svg);
  assert.ok(width && height && box, "Explicit SVG sprite dimensions required");
  assert.equal(Number(box[1]), part.x, "Sprite left must match manifest");
  assert.equal(Number(box[2]), part.y, "Sprite top must match manifest");
  assert.equal(Number(box[3]), Number(width[1]), "Sprite width and viewBox mismatch");
  assert.equal(Number(box[4]), Number(height[1]), "Sprite height and viewBox mismatch");
  assert.doesNotMatch(svg,/<rect[^>]+(?:fill="white"|fill="#fff")/i, "No opaque background");
}
const index=fs.readFileSync(path.join(root,"index.html"),"utf8");
const rig=fs.readFileSync(path.join(root,"rig/rig.js"),"utf8");
assert.match(index,/clothes\/wardrobe\.js/);
assert.match(index,/wardrobe\.load\(\)/);
assert.match(rig,/this\.wardrobe\.draw\(ctx\)/);
assert.match(fs.readFileSync(path.join(root,"ui/layout.js"),"utf8"),/wardrobe\.setEquipped\(next, wearable\.id\)/);
console.log("Wardrobe smoke checks passed.");
