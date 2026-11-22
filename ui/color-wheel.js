/* Dress Lab V2 – interactive HSB/HSV color wheel.
 * Pure color-selection UI. Future outfit/skin renderers can subscribe to
 * "dresslab:color-change"; source PNGs are deliberately not recolored here.
 */
(() => {
  "use strict";

  // Separate instances keep Dress Room clothing colors and Magic Room skin colors independent.
  function mount(container, source = "dress", initialHex = "#000000") {
    if (!container) return null;
    const wheel = container.querySelector(".ui-wheel");
  const hexOutput = container.querySelector(".ui-hex");
  const selectionStatus = document.getElementById("ui-selection-status");
  const ranges = {
    h: container.querySelector('.ui-slider-row[data-channel="h"] .ui-slider-input'),
    s: container.querySelector('.ui-slider-row[data-channel="s"] .ui-slider-input'),
    b: container.querySelector('.ui-slider-row[data-channel="b"] .ui-slider-input')
  };
  if (!wheel || !hexOutput || !ranges.h || !ranges.s || !ranges.b) return null;

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const value = { h: 0, s: 0, b: 0 };
  let pointerMode = null;
  let pointerId = null;

  function hsvToRgb(h, s, b) {
    const hue = ((h % 360) + 360) % 360;
    const sat = clamp(s, 0, 100) / 100;
    const brightness = clamp(b, 0, 100) / 100;
    const chroma = brightness * sat;
    const x = chroma * (1 - Math.abs((hue / 60) % 2 - 1));
    const offset = brightness - chroma;
    let channels;
    if (hue < 60) channels = [chroma, x, 0];
    else if (hue < 120) channels = [x, chroma, 0];
    else if (hue < 180) channels = [0, chroma, x];
    else if (hue < 240) channels = [0, x, chroma];
    else if (hue < 300) channels = [x, 0, chroma];
    else channels = [chroma, 0, x];
    return channels.map(channel => Math.round((channel + offset) * 255));
  }

  function rgbToHsv(r, g, b) {
    const [red, green, blue] = [r, g, b].map(channel => channel / 255);
    const high = Math.max(red, green, blue);
    const low = Math.min(red, green, blue);
    const delta = high - low;
    let hue = value.h; // Preserve hue when the chosen color is achromatic.
    if (delta) {
      if (high === red) hue = 60 * (((green - blue) / delta) % 6);
      else if (high === green) hue = 60 * ((blue - red) / delta + 2);
      else hue = 60 * ((red - green) / delta + 4);
    }
    return {
      h: Math.round((hue + 360) % 360),
      s: high ? Math.round(delta / high * 100) : 0,
      b: Math.round(high * 100)
    };
  }

  function toHex(rgb) {
    return "#" + rgb.map(channel => channel.toString(16).padStart(2, "0")).join("").toUpperCase();
  }

  wheel.removeAttribute("role");
  wheel.setAttribute("role", "group");
  wheel.setAttribute("tabindex", "0");
  wheel.setAttribute("aria-label", "색상환. 좌우 방향키: 색조, 상하 방향키: 밝기, Shift와 좌우 방향키: 채도");
  wheel.innerHTML = [
    '<div class="ui-wheel__inner" aria-hidden="true">',
      '<div class="ui-wheel__diamond"></div>',
    '</div>',
    '<span class="ui-wheel__hue-marker" aria-hidden="true"></span>',
    '<span class="ui-wheel__tone-marker" aria-hidden="true"></span>'
  ].join("");
  const hueMarker = wheel.querySelector(".ui-wheel__hue-marker");
  const toneMarker = wheel.querySelector(".ui-wheel__tone-marker");

  for (const channel of Object.keys(ranges)) {
    ranges[channel].min = "0";
    ranges[channel].max = channel === "h" ? "360" : "100";
    ranges[channel].step = "1";
  }

  function paint(announce = true) {
    const rgb = hsvToRgb(value.h, value.s, value.b);
    const hex = toHex(rgb);
    const pureHue = toHex(hsvToRgb(value.h, 100, 100));
    const satStart = toHex(hsvToRgb(value.h, 0, value.b));
    const satEnd = toHex(hsvToRgb(value.h, 100, value.b));
    const brightEnd = toHex(hsvToRgb(value.h, value.s, 100));

    wheel.style.setProperty("--picked-hue", pureHue);
    wheel.style.setProperty("--picked-color", hex);
    hexOutput.style.setProperty("--picked-color", hex);
    hexOutput.textContent = hex;
    ranges.h.style.setProperty("--slider-track",
      "linear-gradient(to right, #ff0000, #ffff00, #00ff00, #00ffff, #0000ff, #ff00ff, #ff0000)");
    ranges.s.style.setProperty("--slider-track",
      "linear-gradient(to right, " + satStart + ", " + satEnd + ")");
    ranges.b.style.setProperty("--slider-track",
      "linear-gradient(to right, #000000, " + brightEnd + ")");

    for (const channel of Object.keys(ranges)) {
      ranges[channel].value = String(value[channel]);
      const output = container.querySelector('.ui-slider-row[data-channel="' + channel + '"] .ui-slider-row__value');
      if (output) output.textContent = value[channel] + (channel === "h" ? "°" : "%");
    }

    // 0° (red) is at the right; positive hue progresses anticlockwise.
    const hueRadians = value.h * Math.PI / 180;
    const wheelSize = wheel.offsetWidth || 417;
    const hueRadius = wheelSize * (176 / 417);
    hueMarker.style.left = 50 + 100 * hueRadius * Math.cos(hueRadians) / wheelSize + "%";
    hueMarker.style.top = 50 - 100 * hueRadius * Math.sin(hueRadians) / wheelSize + "%";

    // The diamond is a square rotated 45°: top = white, right = hue,
    // bottom/left = black. Saturation grows right; brightness grows upward.
    const diamond = wheel.querySelector(".ui-wheel__diamond");
    const side = diamond.offsetWidth || 176;
    const localX = (value.s / 100 - 0.5) * side;
    const localY = (0.5 - value.b / 100) * side;
    const dx = (localX - localY) / Math.SQRT2;
    const dy = (localX + localY) / Math.SQRT2;
    toneMarker.style.left = 50 + 100 * dx / wheelSize + "%";
    toneMarker.style.top = 50 + 100 * dy / wheelSize + "%";
    toneMarker.style.backgroundColor = hex;

    if (announce) {
      window.dispatchEvent(new CustomEvent(source === "skin" ? "dresslab:skin-color-change" : "dresslab:color-change", {
        detail: { h: value.h, s: value.s, b: value.b, hex, rgb: rgb.slice(), source }
      }));
    }
  }

  function setColor(next) {
    if (!next || typeof next !== "object") return;
    for (const channel of Object.keys(ranges)) {
      if (next[channel] === undefined) continue;
      const number = Number(next[channel]);
      if (!Number.isFinite(number)) continue;
      value[channel] = Math.round(clamp(number, 0, channel === "h" ? 360 : 100));
    }
    if (value.h === 360) value.h = 0;
    paint();
  }

  function setHex(hex) {
    const match = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
    if (!match) return false;
    const n = parseInt(match[1], 16);
    setColor(rgbToHsv((n >> 16) & 255, (n >> 8) & 255, n & 255));
    return true;
  }

  function pointOnWheel(event) {
    const rect = wheel.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    return { x: event.clientX - cx, y: event.clientY - cy,
      radius: rect.width / 2, scale: rect.width / (wheel.offsetWidth || 417) };
  }

  function applyPointer(event, mode) {
    const { x, y, scale } = pointOnWheel(event);
    if (mode === "hue") {
      setColor({ h: Math.round((Math.atan2(-y, x) * 180 / Math.PI + 360) % 360) });
      return;
    }
    const side = (wheel.querySelector(".ui-wheel__diamond").offsetWidth || 176) * scale;
    const squareX = (x + y) / Math.SQRT2;
    const squareY = (y - x) / Math.SQRT2;
    setColor({
      s: Math.round(100 * clamp(squareX / side + 0.5, 0, 1)),
      b: Math.round(100 * (1 - clamp(squareY / side + 0.5, 0, 1)))
    });
  }

  wheel.addEventListener("pointerdown", event => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const point = pointOnWheel(event);
    const distance = Math.hypot(point.x, point.y);
    if (distance > point.radius * 1.05) return;
    pointerMode = distance >= point.radius * 0.68 ? "hue" : "tone";
    pointerId = event.pointerId;
    wheel.setPointerCapture(pointerId);
    applyPointer(event, pointerMode);
    event.preventDefault();
  });
  wheel.addEventListener("pointermove", event => {
    if (pointerMode === null || event.pointerId !== pointerId) return;
    applyPointer(event, pointerMode);
    event.preventDefault();
  });
  const stopDrag = event => {
    if (event.pointerId !== pointerId) return;
    pointerMode = null;
    pointerId = null;
    if (wheel.hasPointerCapture(event.pointerId)) wheel.releasePointerCapture(event.pointerId);
  };
  wheel.addEventListener("pointerup", stopDrag);
  wheel.addEventListener("pointercancel", stopDrag);
  wheel.addEventListener("lostpointercapture", () => {
    pointerMode = null;
    pointerId = null;
  });

  wheel.addEventListener("keydown", event => {
    const amount = event.ctrlKey ? 10 : 1;
    if (event.shiftKey && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
      setColor({ s: value.s + (event.key === "ArrowRight" ? amount : -amount) });
    } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      setColor({ h: (value.h + (event.key === "ArrowRight" ? amount : -amount) + 360) % 360 });
    } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      setColor({ b: value.b + (event.key === "ArrowUp" ? amount : -amount) });
    } else {
      return;
    }
    event.preventDefault();
  });

  // Existing sidebar +/- buttons already dispatch bubbling input events.
  for (const channel of Object.keys(ranges)) {
    ranges[channel].addEventListener("input", event => {
      setColor({ [channel]: Number(event.currentTarget.value) });
    });
  }

  // Show the exact selected HEX value; tapping it copies to clipboard.
  hexOutput.setAttribute("role", "button");
  hexOutput.tabIndex = 0;
  hexOutput.setAttribute("title", "HEX 코드 복사");
  async function copyHex() {
    if (!navigator.clipboard || !navigator.clipboard.writeText) {
      if (selectionStatus) selectionStatus.textContent = "HEX 코드: " + hexOutput.textContent;
      return;
    }
    try {
      await navigator.clipboard.writeText(hexOutput.textContent);
      if (selectionStatus) selectionStatus.textContent = hexOutput.textContent + " 복사됨";
    } catch (error) {
      if (selectionStatus) selectionStatus.textContent = "HEX 코드: " + hexOutput.textContent;
    }
  }
  hexOutput.addEventListener("click", copyHex);
  hexOutput.addEventListener("keydown", event => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      copyHex();
    }
  });

  const api = {
    getColor: () => ({ ...value, hex: toHex(hsvToRgb(value.h, value.s, value.b)) }),
    setColor,
    setHex
  };
  if (!setHex(initialHex)) paint();
  return api;
  }

  // Backward compatible clothing-color interface, plus a reusable skin picker.
  window.DressLabColorPicker = { mount };
  window.DressLabColorWheel = mount(document.querySelector(".ui-colors"), "dress", "#000000");
})();
