/* Dress Lab V2 — small elastic character animations.
 * Per-joint rotations, a whole-character bounce and a very slight 0.5–1%
 * squash/stretch. No pixel/mesh distortion of individual body parts.
 * Designed for a single render loop (<=30 fps), with reduced-motion support.
 */
(() => {
  "use strict";

  const TAU = Math.PI * 2;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const smooth = (a, b, t) => {
    const x = clamp((t - a) / (b - a), 0, 1);
    return x * x * (3 - 2 * x);
  };

  // Source: rig/poses/user-reference.json, preserved from the user's exported
  // pose. This is deliberately an exact copy of all eleven joint angles.
  const USER_REFERENCE_POSE = Object.freeze({
    torso: -6, shoulderL: -5, elbowL: 21, wristL: -19,
    shoulderR: -21, elbowR: 72, wristR: -27,
    hipL: -9, kneeL: 37, hipR: -7, kneeR: -3
  });
  const JOINTS = Object.freeze(Object.keys(USER_REFERENCE_POSE));
  const ZERO_ROOT = Object.freeze({ x: 0, y: 0, scaleX: 1, scaleY: 1 });

  const POSES = Object.freeze({
    reference: USER_REFERENCE_POSE,
    neutral: Object.freeze({}),
    relaxed: Object.freeze({
      torso: -1.8, shoulderL: 3, shoulderR: -3,
      elbowL: 3, elbowR: -3, wristL: -5, wristR: 5
    }),
    shy: Object.freeze({
      torso: 3, shoulderL: -14, shoulderR: 13,
      elbowL: -15, elbowR: 16, wristL: 8, wristR: -8
    }),
    greeting: Object.freeze({
      torso: -2.5, shoulderR: -60, elbowR: -37, wristR: 10,
      shoulderL: 3
    }),
    cheer: Object.freeze({
      torso: 2, shoulderL: 70, shoulderR: -70,
      elbowL: 12, elbowR: -12, wristL: 8, wristR: -8
    }),
    sway: Object.freeze({
      torso: 6, shoulderL: -6, shoulderR: -2,
      elbowL: 6, elbowR: -8, hipL: -2, hipR: 2
    })
  });

  const DURATIONS = Object.freeze({
    wave: 2.6, boing: 1.6, hello: 2.2,
    showPose: 3.5, bigWave: 3.2, hop: 2.8, dance: 4.0, stretch: 3.2
  });

  // Dramatic, individually keyframed 2D actions. Each one starts and ends
  // neutral so it can transition back into the existing quiet idle.
  // Poses use absolute local joint degrees, not hard-coded pixel offsets.
  const LARGE_ACTIONS = Object.freeze({
    showPose: [
      { at:0, pose:{}, root:{} },
      { at:.15, pose:{ torso:3, shoulderL:8, shoulderR:-8, kneeL:9 },
        root:{ y:9, scaleX:1.008, scaleY:.990 } },
      { at:.36, pose:USER_REFERENCE_POSE,
        root:{ x:-7, y:-25, scaleX:.993, scaleY:1.010 } },
      { at:.53, pose:USER_REFERENCE_POSE,
        root:{ x:-7, y:-21, scaleX:.994, scaleY:1.008 } },
      { at:.72, pose:{ torso:-2, shoulderL:15, elbowL:8,
        shoulderR:-10, elbowR:29, wristR:-8, hipL:-3, kneeL:16 },
        root:{ x:5, y:7, scaleX:1.012, scaleY:.987 } },
      { at:.89, pose:{ torso:2, shoulderR:6, elbowR:5, kneeL:-4 },
        root:{ y:-9, scaleX:.995, scaleY:1.007 } },
      { at:1, pose:{}, root:{} }
    ],
    bigWave: [
      { at:0, pose:{}, root:{} },
      { at:.16, pose:{ torso:-3, shoulderR:-40, elbowR:35, wristR:-15,
        shoulderL:8, elbowL:12, hipL:-7, kneeL:14 },
        root:{ y:7, scaleY:.992 } },
      { at:.31, pose:{ torso:-6, shoulderR:-75, elbowR:75, wristR:-38,
        shoulderL:18, elbowL:23, hipL:-10, kneeL:28 },
        root:{ x:-8, y:-23, scaleX:.995, scaleY:1.009 } },
      { at:.44, pose:{ torso:-6, shoulderR:-72, elbowR:28, wristR:12,
        shoulderL:13, elbowL:21, hipL:-10, kneeL:29 },
        root:{ x:-7, y:-17 } },
      { at:.56, pose:{ torso:-5, shoulderR:-75, elbowR:80, wristR:-35,
        shoulderL:17, elbowL:22, hipL:-10, kneeL:30 },
        root:{ x:-6, y:-24, scaleY:1.008 } },
      { at:.70, pose:{ torso:-5, shoulderR:-68, elbowR:34, wristR:10,
        shoulderL:12, hipL:-7, kneeL:21 },
        root:{ y:-12 } },
      { at:.84, pose:{ torso:3, shoulderR:-19, elbowR:16, kneeL:7 },
        root:{ y:10, scaleX:1.010, scaleY:.989 } },
      { at:1, pose:{}, root:{} }
    ],
    hop: [
      { at:0, pose:{}, root:{} },
      { at:.15, pose:{ torso:3, shoulderL:15, shoulderR:-15,
        hipL:-12, kneeL:25, hipR:8, kneeR:13 },
        root:{ y:12, scaleX:1.012, scaleY:.985 } },
      { at:.34, pose:{ torso:-5, shoulderL:54, shoulderR:-49,
        elbowL:15, elbowR:-14, hipL:-22, kneeL:56,
        hipR:6, kneeR:8 }, root:{ x:-5, y:-45, scaleX:.989, scaleY:1.017 } },
      { at:.48, pose:{ torso:-4, shoulderL:46, shoulderR:-43,
        elbowL:11, elbowR:-11, hipL:-21, kneeL:53,
        hipR:7, kneeR:9 }, root:{ x:-3, y:-32, scaleX:.994, scaleY:1.011 } },
      { at:.64, pose:{ torso:2, shoulderL:11, shoulderR:-14,
        hipL:-13, kneeL:34, hipR:9, kneeR:20 },
        root:{ y:15, scaleX:1.017, scaleY:.979 } },
      { at:.78, pose:{ torso:-2, shoulderL:26, shoulderR:-23,
        hipL:-12, kneeL:39, hipR:5, kneeR:8 },
        root:{ y:-26, scaleX:.993, scaleY:1.011 } },
      { at:.9, pose:{ torso:2, shoulderL:7, shoulderR:-8,
        hipL:-3, kneeL:12 }, root:{ y:8, scaleX:1.008, scaleY:.991 } },
      { at:1, pose:{}, root:{} }
    ],
    dance: [
      { at:0, pose:{}, root:{} },
      { at:.14, pose:{ torso:-8, shoulderL:48, elbowL:35, wristL:-20,
        shoulderR:-9, elbowR:24, hipL:-17, kneeL:35,
        hipR:9, kneeR:12 }, root:{ x:-18, y:-14, scaleY:1.006 } },
      { at:.30, pose:{ torso:8, shoulderL:5, elbowL:-8,
        shoulderR:-48, elbowR:60, wristR:-28,
        hipL:8, kneeL:10, hipR:-18, kneeR:38 },
        root:{ x:18, y:5, scaleX:1.008, scaleY:.992 } },
      { at:.46, pose:{ torso:-7, shoulderL:53, elbowL:43, wristL:-26,
        shoulderR:-13, elbowR:10, hipL:-20, kneeL:43,
        hipR:5, kneeR:5 }, root:{ x:-18, y:-19, scaleY:1.008 } },
      { at:.62, pose:{ torso:7, shoulderL:3, elbowL:-10,
        shoulderR:-54, elbowR:67, wristR:-26,
        hipL:7, kneeL:10, hipR:-21, kneeR:44 },
        root:{ x:19, y:2, scaleX:1.010, scaleY:.990 } },
      { at:.77, pose:{ torso:-5, shoulderL:33, elbowL:20,
        shoulderR:-23, elbowR:39, wristR:-12, hipL:-12, kneeL:25 },
        root:{ x:-10, y:-21, scaleY:1.009 } },
      { at:.9, pose:{ torso:2, shoulderL:7, shoulderR:-6, kneeR:6 },
        root:{ x:4, y:8, scaleX:1.008, scaleY:.990 } },
      { at:1, pose:{}, root:{} }
    ],
    stretch: [
      { at:0, pose:{}, root:{} },
      { at:.16, pose:{ torso:3, shoulderL:9, shoulderR:-10,
        elbowL:12, elbowR:-13, kneeL:9, kneeR:-8 },
        root:{ y:12, scaleX:1.011, scaleY:.987 } },
      { at:.37, pose:{ torso:-3, shoulderL:78, shoulderR:-78,
        elbowL:-19, elbowR:19, wristL:12, wristR:-12,
        hipL:-6, hipR:6 }, root:{ y:-24, scaleX:.990, scaleY:1.014 } },
      { at:.59, pose:{ torso:-3, shoulderL:77, shoulderR:-77,
        elbowL:-22, elbowR:22, wristL:9, wristR:-9,
        hipL:-5, hipR:5 }, root:{ y:-19, scaleY:1.012 } },
      { at:.76, pose:{ torso:4, shoulderL:20, shoulderR:-20,
        elbowL:10, elbowR:-10 }, root:{ y:11, scaleX:1.013, scaleY:.985 } },
      { at:.88, pose:{ torso:-2, shoulderL:6, shoulderR:-6 },
        root:{ y:-10, scaleY:1.006 } },
      { at:1, pose:{}, root:{} }
    ]
  });

  function sampleLargeAction(name, t, intensity) {
    const frames = LARGE_ACTIONS[name];
    const position = clamp(t / DURATIONS[name], 0, 1);
    let lo = frames[0], hi = frames[frames.length - 1];
    for (let i = 1; i < frames.length; i++) {
      if (position <= frames[i].at) {
        lo = frames[i - 1];
        hi = frames[i];
        break;
      }
    }
    const mix = smooth(lo.at, hi.at, position);
    const lerp = (a, b) => a + (b - a) * mix;
    const angles = {};
    for (const id of JOINTS) {
      angles[id] = lerp(lo.pose[id] ?? 0, hi.pose[id] ?? 0) * intensity;
    }
    const root = {
      x: lerp(lo.root.x ?? 0, hi.root.x ?? 0) * intensity,
      y: lerp(lo.root.y ?? 0, hi.root.y ?? 0) * intensity,
      scaleX: 1 + (lerp(lo.root.scaleX ?? 1, hi.root.scaleX ?? 1) - 1) * intensity,
      scaleY: 1 + (lerp(lo.root.scaleY ?? 1, hi.root.scaleY ?? 1) - 1) * intensity
    };
    return { angles, root };
  }

  // A spring overshoots the requested angle and settles, so the doll feels
  // light and soft rather than moving like a mechanical hinge.
  function spring(position, velocity, target, dt, frequency, damping) {
    const acceleration = (frequency * frequency) * (target - position) -
      2 * damping * frequency * velocity;
    const nextVelocity = velocity + acceleration * dt;
    return [position + nextVelocity * dt, nextVelocity];
  }

  function keys(frames, t) {
    if (t <= frames[0][0]) return frames[0][1];
    for (let i = 1; i < frames.length; i++) {
      if (t <= frames[i][0]) {
        const [ta, va] = frames[i - 1];
        const [tb, vb] = frames[i];
        const f = smooth(ta, tb, t);
        return va + (vb - va) * f;
      }
    }
    return frames[frames.length - 1][1];
  }

  function idleSample(t, intensity) {
    const inhale = (1 - Math.cos((t / 3.7) * TAU)) / 2;
    const slowSway = Math.sin((t / 5.5) * TAU);
    const phase = t % 7.6;
    const bounceTime = phase - 6.0;
    const miniBoing = bounceTime >= 0 && bounceTime < 1.5 ?
      -12 * Math.exp(-3.0 * bounceTime) * Math.sin(11.2 * bounceTime) : 0;
    const v = intensity;
    const expand = (inhale - 0.5) * v;
    return {
      angles: {
        torso: 0.65 * slowSway * v,
        shoulderL: (1.6 * inhale + 0.4 * slowSway) * v,
        shoulderR: (-1.6 * inhale + 0.4 * slowSway) * v,
        elbowL: 0.6 * slowSway * v,
        elbowR: -0.6 * slowSway * v,
        wristL: 0.6 * Math.sin(t * 1.8) * v,
        wristR: -0.6 * Math.sin(t * 1.8) * v
      },
      root: {
        x: 1.6 * slowSway * v,
        y: (-5 * inhale + 1.2 * slowSway) * v + miniBoing * v,
        scaleX: 1 - 0.0021 * expand,
        scaleY: 1 + 0.0029 * expand - miniBoing * 0.00025 * v
      }
    };
  }

  function actionSample(name, t, intensity) {
    if (Object.prototype.hasOwnProperty.call(LARGE_ACTIONS, name)) {
      return sampleLargeAction(name, t, intensity);
    }
    const u = clamp(t / DURATIONS[name], 0, 1);
    const envelope = smooth(0, 0.18, u) * (1 - smooth(0.75, 1, u));
    const v = intensity;
    if (name === "wave" || name === "hello") {
      const swing = Math.sin(t * 14.5);
      return {
        angles: {
          torso: -2.5 * envelope * v,
          shoulderR: -65 * envelope * v,
          elbowR: (-45 + 18 * swing) * envelope * v,
          wristR: (12 + 15 * Math.sin(t * 14.5 + 0.75)) * envelope * v,
          shoulderL: 2 * envelope * v
        },
        root: { y: -4 * envelope * v, scaleX: 1, scaleY: 1 }
      };
    }

    // Anticipation -> leap -> landing -> damped recoil.
    const rise = keys([
      [0, 0], [0.14, 7], [0.36, -32], [0.58, -25],
      [0.72, 9], [0.84, -5], [0.93, 2], [1, 0]
    ], u) * v;
    const stretch = keys([
      [0, 1], [0.14, 0.988], [0.36, 1.012],
      [0.58, 1.008], [0.72, 0.988],
      [0.84, 1.004], [0.93, 0.998], [1, 1]
    ], u);
    const squash = (stretch - 1) * v;
    const legs = keys([
      [0, 0], [0.14, 4], [0.36, -3],
      [0.68, 2], [1, 0]
    ], u) * v;

    return {
      angles: {
        torso: keys([[0, 0], [0.14, 3], [0.42, -3],
          [0.78, 2], [1, 0]], u) * v,
        shoulderL: keys([[0, 0], [0.32, -8], [0.62, 5],
          [1, 0]], u) * v,
        shoulderR: keys([[0, 0], [0.32, 8], [0.62, -5],
          [1, 0]], u) * v,
        kneeL: legs,
        kneeR: -legs
      },
      root: {
        y: rise,
        x: 0,
        scaleX: 1 - 0.7 * squash,
        scaleY: 1 + squash
      }
    };
  }

  class DressLabMotion {
    constructor(rig, options = {}) {
      if (!rig || typeof rig.setFrame !== "function") {
        throw new Error("DressLabMotion needs a DressLabRig with setFrame()");
      }
      this.rig = rig;
      this.intensity = clamp(Number(options.intensity) || 1, 0.35, 1.6);
      this.poseName = "neutral";
      this.targetPose = POSES.neutral;
      this.action = null;
      this.time = 0;
      this.enabled = false;
      this.poseState = Object.fromEntries(
        Object.keys(rig.config.pivots).map(id => [id, rig.getAngle(id)])
      );
      this.poseVelocity = Object.fromEntries(Object.keys(this.poseState).map(id => [id, 0]));
      this.root = { x: 0, y: 0, scaleX: 1, scaleY: 1 };
      this.rootVelocity = { x: 0, y: 0, scaleX: 0, scaleY: 0 };
      this.frameId = 0;
      this.lastFrame = null;
      this.lastPaint = null;
      this.listeners = new Set();
      this.reduced = Boolean(
        typeof window.matchMedia === "function" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches
      );
      this.visible = document.visibilityState !== "hidden";
      this.onVisibility = () => {
        this.visible = document.visibilityState !== "hidden";
        this.lastFrame = null;
        if (!this.visible && this.frameId) {
          cancelAnimationFrame(this.frameId);
          this.frameId = 0;
        } else if (this.visible) {
          this.schedule();
        }
      };
      document.addEventListener("visibilitychange", this.onVisibility);

      if (options.autoStart !== false && !this.reduced) this.resumeIdle();
    }

    subscribe(callback) {
      if (typeof callback !== "function") return () => {};
      this.listeners.add(callback);
      return () => this.listeners.delete(callback);
    }

    notify() {
      for (const callback of this.listeners) {
        try { callback(this); }
        catch (e) { console.error("Rig motion subscriber failed", e); }
      }
    }

    schedule() {
      if (!this.enabled || !this.visible || this.reduced || this.frameId) return;
      this.frameId = requestAnimationFrame(time => {
        this.frameId = 0;
        this.tick(time);
        this.schedule();
      });
    }

    tick(now) {
      if (this.lastFrame === null) this.lastFrame = now;
      // Cap 30fps to avoid repeatedly compositing 17 original PNGs at 60fps.
      if (this.lastPaint !== null && now - this.lastPaint < 1000 / 30) return;
      const dt = clamp((now - this.lastFrame) / 1000, 0, 0.05);
      this.lastFrame = now;
      this.lastPaint = now;
      this.time += dt;

      const base = { ...this.targetPose };
      const idle = idleSample(this.time, this.intensity);
      const goal = {};
      const rootGoal = { ...idle.root };
      for (const id of Object.keys(this.poseState)) {
        goal[id] = (base[id] || 0) + (idle.angles[id] || 0);
      }

      if (this.action) {
        this.action.elapsed += dt;
        const sample = actionSample(this.action.name, this.action.elapsed, this.intensity);
        const fade = this.action.name === "boing" ? 0.25 : 0.5;
        for (const id of Object.keys(goal)) {
          goal[id] += sample.angles[id] || 0;
        }
        for (const key of Object.keys(rootGoal)) {
          rootGoal[key] = key.startsWith("scale") ?
            1 + (rootGoal[key] - 1) * fade + ((sample.root[key] ?? 1) - 1) :
            rootGoal[key] * fade + (sample.root[key] || 0);
        }
        if (this.action.elapsed >= DURATIONS[this.action.name]) {
          this.action = null;
        }
      }

      // Elastic spring motion with deliberately limited overshoot.
      for (const id of Object.keys(this.poseState)) {
        const [p, v] = spring(this.poseState[id], this.poseVelocity[id], goal[id],
          dt, 11.5, 0.73);
        this.poseState[id] = p;
        this.poseVelocity[id] = v;
      }
      for (const key of Object.keys(this.root)) {
        const [p, v] = spring(this.root[key], this.rootVelocity[key], rootGoal[key],
          dt, 18, 0.66);
        this.root[key] = p;
        this.rootVelocity[key] = v;
      }
      this.rig.setFrame(this.poseState, this.root);
      this.notify();
    }

    resumeIdle() {
      this.targetPose = POSES.neutral;
      this.poseName = "neutral";
      this.action = null;
      this.enabled = !this.reduced;
      if (this.reduced) {
        this.pause(true);
        return;
      }
      this.lastFrame = null;
      this.lastPaint = null;
      this.schedule();
      this.notify();
    }

    setPose(name) {
      if (!Object.prototype.hasOwnProperty.call(POSES, name)) return false;
      this.poseName = name;
      this.targetPose = POSES[name];
      this.action = null;
      if (this.reduced) {
        this.pause(true);
        this.rig.setFrame(this.targetPose, {});
        this.poseState = { ...this.rig.angles };
        this.notify();
        return true;
      }
      this.enabled = true;
      this.schedule();
      this.notify();
      return true;
    }

    play(name) {
      if (!Object.prototype.hasOwnProperty.call(DURATIONS, name)) return false;
      if (this.reduced) return false;
      this.action = { name, elapsed: 0 };
      this.targetPose = POSES.neutral;
      this.poseName = "neutral";
      this.enabled = true;
      this.schedule();
      this.notify();
      return true;
    }

    setIntensity(value) {
      const n = Number(value);
      if (!Number.isFinite(n)) return false;
      this.intensity = clamp(n, 0.35, 1.6);
      this.notify();
      return true;
    }

    // Allow a developer to edit a joint manually, without a second rAF loop
    // overwriting the slider position. Root deformation is cleared on pause.
    pause(reset = false) {
      this.enabled = false;
      this.action = null;
      if (this.frameId) cancelAnimationFrame(this.frameId);
      this.frameId = 0;
      this.lastFrame = null;
      this.lastPaint = null;
      const pose = reset ? {} : { ...this.rig.angles };
      this.rig.setFrame(pose, {});
      this.poseState = { ...this.rig.angles };
      this.poseVelocity = Object.fromEntries(Object.keys(this.poseState).map(id => [id, 0]));
      this.root = { x: 0, y: 0, scaleX: 1, scaleY: 1 };
      this.rootVelocity = { x: 0, y: 0, scaleX: 0, scaleY: 0 };
      this.notify();
    }

    dispose() {
      this.pause();
      document.removeEventListener("visibilitychange", this.onVisibility);
      this.listeners.clear();
    }
  }

  window.DressLabMotion = DressLabMotion;
  window.DressLabMotionPoses = POSES;
  window.DressLabMotionActions = Object.freeze(Object.keys(DURATIONS));
  // Available to the rig tester and future dialogue/gesture triggers.
  window.DressLabMotionLargeActions = Object.freeze(Object.keys(LARGE_ACTIONS));
})();