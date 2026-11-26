/* Temporary outfit inspection; not a client rating or scoring system. */
(() => {
  "use strict";
  const AXES = [["formality","격식성"],["flamboyance","장식성"],["comfort","편안함"],["novelty","파격성"],["exposure","노출도"]];
  function classifyColor(hex) {
  if (!/^#[0-9a-f]{6}$/i.test(hex || "")) return null;
  const [r,g,b]=hex.slice(1).match(/../g).map(x=>parseInt(x,16)/255);
  const v=Math.max(r,g,b), min=Math.min(r,g,b), d=v-min, s=v ? d/v : 0;
  let h=0;
  if(d) {
    h=v===r ? (g-b)/d : v===g ? (b-r)/d+2 : (r-g)/d+4;
    h=(h*60+360)%360;
  }
  let family;
  if(v<=.13) family="블랙";
  else if(s<=.16) family=v>=.90?"화이트":"그레이";
  else if(h>=15 && h<65 && s<=.48 && v>=.65) family="베이지";
  else if(h>=10 && h<55 && v<.68) family="브라운";
  else if(h>=345 || h<15) family=v>=.72 && s<.58?"핑크":"레드";
  else if(h<43) family="오렌지";
  else if(h<70) family="옐로";
  else if(h<160) family="그린";
  else if(h<200) family="민트·시안";
  else if(h<265) family="블루";
  else if(h<315) family="퍼플";
  else family="핑크";
  const neutral=["블랙","화이트","그레이"].includes(family);
  const tone=neutral?"무채색":v<.38?"다크":v<.68 && s>=.5?"딥":v>=.92 && s<.20?"라이트":v>=.80 && s<.48?"파스텔":s<.55?"뮤트":v<.82?"딥":"비비드";
  return {family,tone};
}
  function summarize(items) {
  const equipped=items.filter(x=>x.ready && x.equipped);
  const totals=Object.fromEntries(AXES.map(([key])=>[key,0]));
  const missing=new Set(), tags=new Set();
  for(const item of equipped) {
    for(const [key] of AXES) {
      if(Number.isInteger(item.params?.[key])) totals[key]+=item.params[key];
      else missing.add(key);
    }
    for(const tag of item.tags || []) tags.add(tag);
  }
  for(const key of missing) totals[key]=null;
  return {equipped,totals,tags:[...tags]};
}
  if (typeof module !== "undefined" && module.exports) {
    module.exports = { classifyColor, summarize };
  }
  if (typeof document === "undefined") return;
  const scene = document.getElementById("ui-scene");
  const editor = scene?.querySelector(".ui-editor");
  const heading = editor?.querySelector(".ui-outfit-heading");
  if (!heading) return;
  const panel = document.createElement("section");
  panel.className = "ui-review-panel";
  panel.setAttribute("aria-label", "임시 의상 정보");
  editor.insertBefore(panel, heading);
  const add = (parent, tag, value, className) => {
    const el = document.createElement(tag);
    if (value != null) el.textContent = value;
    if (className) el.className = className;
    parent.appendChild(el);
    return el;
  };
  const signed = value => Number.isInteger(value) ? (value > 0 ? "+" : "") + value : "—";
  function values(parent, params) {
    const grid = add(parent, "dl", null, "ui-review-values");
    for (const [key, label] of AXES) {
      add(grid, "dt", label);
      add(grid, "dd", signed(params?.[key]));
    }
  }
  function render() {
    if (scene.dataset.room !== "dress" || scene.dataset.dressTab !== "review") return;
    const all = window.dressLabWardrobe?.getReviewItems() || [];
    const { equipped, totals, tags } = summarize(all);
    panel.replaceChildren();
    add(panel, "h2", "코디 정보");
    add(panel, "p", "임시 확인용 · 착용 의상 " + equipped.length + "벌", "ui-review-note");
    if (!equipped.length) {
      add(panel, "p", !all.length || all.some(x => !x.ready && !x.error)
        ? "의상을 불러오는 중" : all.some(x => x.error) ? "착용 가능한 의상을 확인할 수 없음" : "착용 중인 옷이 없음");
      return;
    }
    add(panel, "h3", "파라미터 합계");
    values(panel, totals);
    add(panel, "p", tags.join(" ") || "등록된 태그 없음", "ui-review-tags");
    for (const item of equipped) {
      const card = add(panel, "article", null, "ui-review-item");
      add(card, "h3", item.name);
      const color = add(card, "div", null, "ui-review-color");
      const swatch = add(color, "span", null, "ui-review-swatch");
      const classified = classifyColor(item.color);
      if (classified) swatch.style.backgroundColor = item.color;
      swatch.setAttribute("aria-hidden", "true");
      add(color, "span", classified ? item.color + " · " + classified.family + " / " + classified.tone : "색상 미확인");
      values(card, item.params);
      add(card, "p", (item.tags || []).join(" ") || "등록된 태그 없음", "ui-review-tags");
    }
    if (all.some(x => x.error)) add(panel, "p", "일부 의상 로드 실패", "ui-review-note");
  }
  for (const event of ["dresslab:wardrobe-ready", "dresslab:wardrobe-error", "dresslab:wardrobe-change", "dresslab:dress-tab-change", "dresslab:room-change"]) {
    window.addEventListener(event, render);
  }
  render();
})();
