var SoullinkFace = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
  var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

  // src/alife-face.ts
  var alife_face_exports = {};
  __export(alife_face_exports, {
    AlifeFace: () => AlifeFace,
    FaceEngine: () => FaceEngine,
    LABEL_MAP: () => LABEL_MAP,
    computeMorphWeights: () => computeMorphWeights,
    defaultSettings: () => defaultSettings,
    resolveProfile: () => resolveProfile,
    vroidProfile: () => vroidProfile
  });

  // vendor/soullink/utils/clamp.ts
  function clamp(value, min = -Infinity, max = Infinity) {
    return Math.min(max, Math.max(min, value));
  }

  // vendor/soullink/utils/lerp.ts
  function lerp(from, to, t) {
    return from + (to - from) * t;
  }

  // vendor/soullink/utils/seededRandom.ts
  function seededRandom(seed) {
    let value = Math.abs(Math.floor(seed)) || 1;
    return () => {
      value = (value * 9301 + 49297) % 233280;
      return value / 233280;
    };
  }

  // vendor/soullink/emotion/EmotionPresetRegistry.ts
  var neutralVAD = {
    valence: 0,
    arousal: 0,
    dominance: 0
  };
  var emotionVADPresets = {
    neutral: neutralVAD,
    calm: { valence: 0.25, arousal: -0.45, dominance: 0.2 },
    happy: { valence: 0.75, arousal: 0.45, dominance: 0.35 },
    excited: { valence: 0.85, arousal: 0.85, dominance: 0.45 },
    shy: { valence: 0.35, arousal: 0.6, dominance: -0.45 },
    affectionate: { valence: 0.65, arousal: 0.1, dominance: 0.1 },
    curious: { valence: 0.35, arousal: 0.55, dominance: 0.2 },
    confused: { valence: -0.1, arousal: 0.35, dominance: -0.3 },
    tired: { valence: -0.25, arousal: -0.7, dominance: -0.3 },
    sad: { valence: -0.65, arousal: -0.45, dominance: -0.5 },
    anxiety: { valence: -0.6, arousal: 0.7, dominance: -0.55 },
    anger: { valence: -0.7, arousal: 0.75, dominance: 0.55 },
    angry: { valence: -0.7, arousal: 0.75, dominance: 0.55 },
    concerned: { valence: -0.18, arousal: 0.28, dominance: -0.2 },
    surprised: { valence: 0.18, arousal: 0.78, dominance: -0.08 }
  };
  function getVADPreset(emotion, variant) {
    if (variant?.includes("shy")) return emotionVADPresets.shy;
    if (variant?.includes("comfort")) return emotion === "concerned" ? emotionVADPresets.concerned : emotionVADPresets.affectionate;
    if (variant?.includes("startled")) return emotionVADPresets.surprised;
    return emotionVADPresets[emotion] ?? neutralVAD;
  }

  // vendor/soullink/emotion/EmotionStateController.ts
  function clampVAD(vector) {
    return {
      valence: clamp(vector.valence, -1, 1),
      arousal: clamp(vector.arousal, -1, 1),
      dominance: clamp(vector.dominance, -1, 1)
    };
  }
  function lerpVAD(from, to, amount) {
    return clampVAD({
      valence: lerp(from.valence, to.valence, amount),
      arousal: lerp(from.arousal, to.arousal, amount),
      dominance: lerp(from.dominance, to.dominance, amount)
    });
  }
  function magnitude(vector) {
    return clamp(
      (Math.abs(vector.valence) + Math.abs(vector.arousal) * 0.82 + Math.abs(vector.dominance) * 0.64) / 2.46,
      0,
      1
    );
  }
  function nearestVADPreset(vad) {
    const candidates = Object.entries(emotionVADPresets).filter(([emotion]) => emotion !== "neutral" && emotion !== "angry");
    let bestEmotion = "neutral";
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const [emotion, preset] of candidates) {
      const distance2 = weightedVADDistance(vad, preset);
      if (distance2 < bestDistance) {
        bestDistance = distance2;
        bestEmotion = emotion;
      }
    }
    return bestDistance < 0.92 ? bestEmotion : "neutral";
  }
  function weightedVADDistance(a, b3) {
    const valence = a.valence - b3.valence;
    const arousal = a.arousal - b3.arousal;
    const dominance = a.dominance - b3.dominance;
    return valence * valence * 1.08 + arousal * arousal * 0.88 + dominance * dominance * 1.28;
  }
  var EmotionStateController = class {
    constructor(personality = {}) {
      __publicField(this, "current", { ...neutralVAD });
      __publicField(this, "target", { ...neutralVAD });
      __publicField(this, "baseline", { ...neutralVAD });
      __publicField(this, "ambientDrift", { ...neutralVAD });
      __publicField(this, "ambientTarget", { valence: 0.018, arousal: -0.012, dominance: 0.01 });
      __publicField(this, "ambientDriftStrength", 0.034);
      __publicField(this, "driftClock", 0);
      __publicField(this, "nextDriftAt", 0);
      __publicField(this, "random", seededRandom(9137));
      __publicField(this, "reactivity", 1);
      __publicField(this, "targetApproachRate", 1.35);
      __publicField(this, "decayRate", 0.018);
      __publicField(this, "emotionHoldSeconds", 18);
      __publicField(this, "holdRemainingSeconds", 0);
      __publicField(this, "emotionBias", {});
      __publicField(this, "dominantEmotion", "neutral");
      this.configure(personality);
      this.reset();
    }
    configure(personality) {
      if (personality.baseline) {
        this.setBaseline(personality.baseline);
      }
      if (typeof personality.reactivity === "number") {
        this.reactivity = clamp(personality.reactivity, 0.2, 2.5);
      }
      if (typeof personality.targetApproachRate === "number") {
        this.targetApproachRate = clamp(personality.targetApproachRate, 0.2, 4);
      }
      if (typeof personality.decayRate === "number") {
        this.decayRate = clamp(personality.decayRate, 2e-3, 0.4);
      }
      if (typeof personality.emotionHoldSeconds === "number") {
        this.emotionHoldSeconds = clamp(personality.emotionHoldSeconds, 0, 90);
      }
      if (personality.emotionBias) {
        this.emotionBias = { ...this.emotionBias, ...personality.emotionBias };
      }
      if (typeof personality.ambientDriftStrength === "number") {
        this.ambientDriftStrength = clamp(personality.ambientDriftStrength, 0, 0.09);
      }
    }
    getDecayRate() {
      return this.decayRate;
    }
    setBaseline(baseline) {
      this.baseline = clampVAD({
        ...this.baseline,
        ...this.completeVAD(baseline, this.baseline)
      });
    }
    nudge(intent) {
      const naturalEmotion = intent.naturalEmotion ?? intent.emotion;
      const naturalVariant = intent.naturalVariant ?? intent.variant;
      const preset = intent.naturalVAD ? this.completeVAD(intent.naturalVAD, getVADPreset(naturalEmotion, naturalVariant)) : getVADPreset(naturalEmotion, naturalVariant);
      const bias = this.emotionBias[naturalEmotion] ?? this.emotionBias[naturalVariant ?? ""] ?? 1;
      const amount = clamp((0.28 + intent.intensity * 0.58) * this.reactivity * bias, 0, 0.96);
      this.target = lerpVAD(this.target, preset, amount);
      this.extendHold(6 + intent.intensity * this.emotionHoldSeconds);
      this.dominantEmotion = naturalVariant?.includes("shy") ? "shy" : naturalEmotion;
    }
    blendTo(target, amount = 0.65) {
      const clampedAmount = clamp(amount, 0, 1);
      this.target = lerpVAD(this.target, this.completeVAD(target, this.target), clampedAmount);
      this.extendHold(4 + clampedAmount * this.emotionHoldSeconds);
    }
    nudgeVAD(delta, amount = 1) {
      const gain = clamp(amount * this.reactivity, 0, 2);
      this.target = clampVAD({
        valence: this.target.valence + (delta.valence ?? 0) * gain,
        arousal: this.target.arousal + (delta.arousal ?? 0) * gain,
        dominance: this.target.dominance + (delta.dominance ?? 0) * gain
      });
      this.extendHold(3 + clamp(amount, 0, 1.5) * this.emotionHoldSeconds * 0.55);
    }
    reset() {
      this.current = { ...this.baseline };
      this.target = { ...this.baseline };
      this.ambientDrift = { ...neutralVAD };
      this.ambientTarget = this.pickAmbientTarget();
      this.driftClock = 0;
      this.nextDriftAt = 0.8 + this.random() * 2.1;
      this.holdRemainingSeconds = 0;
      this.dominantEmotion = "neutral";
    }
    update(deltaSeconds) {
      const approach = 1 - Math.exp(-deltaSeconds * this.targetApproachRate);
      const decay = this.holdRemainingSeconds > 0 ? 0 : 1 - Math.exp(-deltaSeconds * this.decayRate);
      this.updateAmbientDrift(deltaSeconds);
      this.holdRemainingSeconds = Math.max(0, this.holdRemainingSeconds - deltaSeconds);
      this.current = lerpVAD(this.current, this.withAmbientDrift(this.target), approach);
      this.target = lerpVAD(this.target, this.baseline, decay);
      const currentMagnitude = magnitude(this.current);
      if (currentMagnitude < 18e-4) {
        this.dominantEmotion = "neutral";
      } else if (currentMagnitude < 0.08) {
        this.dominantEmotion = this.inferSubtleEmotion(this.current);
      } else {
        this.dominantEmotion = this.inferDominantEmotion(this.current);
      }
      return {
        current: this.current,
        target: this.target,
        dominantEmotion: this.dominantEmotion,
        intensity: currentMagnitude,
        ambient: this.ambientDrift,
        holdSeconds: this.holdRemainingSeconds,
        decayRate: this.decayRate
      };
    }
    inferDominantEmotion(vad) {
      const valence = vad.valence;
      const arousal = vad.arousal;
      const dominance = vad.dominance;
      if (valence > 0.12 && dominance < -0.22) return "shy";
      if (valence < -0.34 && arousal > 0.38 && dominance < -0.12) return "anxiety";
      if (valence < -0.42 && arousal > 0.42 && dominance > 0.18) return "anger";
      if (valence > 0.58 && arousal > 0.62) return "excited";
      if (valence > 0.2 && arousal < -0.24) return "calm";
      return nearestVADPreset(vad);
    }
    inferSubtleEmotion(vad) {
      if (vad.valence > 4e-3 && vad.arousal > 4e-3) return "soft-happy";
      if (vad.valence > 4e-3 && vad.arousal < -4e-3) return "soft-calm";
      if (vad.valence > 4e-3) return "soft-positive";
      if (vad.valence < -4e-3 && vad.arousal > 4e-3) return "soft-uneasy";
      if (vad.valence < -4e-3) return "soft-low";
      if (vad.arousal > 4e-3) return "soft-curious";
      if (vad.arousal < -4e-3) return "soft-calm";
      if (vad.dominance < -4e-3) return "soft-shy";
      if (vad.dominance > 4e-3) return "soft-steady";
      return "neutral";
    }
    updateAmbientDrift(deltaSeconds) {
      if (this.ambientDriftStrength <= 0) return;
      this.driftClock += deltaSeconds;
      if (this.driftClock >= this.nextDriftAt) {
        this.ambientTarget = this.pickAmbientTarget();
        this.nextDriftAt = this.driftClock + 1.7 + this.random() * 4.2;
      }
      const approach = 1 - Math.exp(-deltaSeconds * 0.62);
      this.ambientDrift = lerpVAD(this.ambientDrift, this.ambientTarget, approach);
    }
    pickAmbientTarget() {
      const strength = this.ambientDriftStrength;
      const centerBias = this.random() < 0.26 ? 0.42 : 1;
      const pick = (axisScale) => {
        const half = strength * axisScale * centerBias;
        return -half + this.random() * half * 2;
      };
      return clampVAD({
        valence: pick(1),
        arousal: pick(0.82),
        dominance: pick(0.68)
      });
    }
    withAmbientDrift(vector) {
      return clampVAD({
        valence: vector.valence + this.ambientDrift.valence,
        arousal: vector.arousal + this.ambientDrift.arousal,
        dominance: vector.dominance + this.ambientDrift.dominance
      });
    }
    extendHold(durationSeconds) {
      this.holdRemainingSeconds = Math.max(this.holdRemainingSeconds, durationSeconds);
    }
    completeVAD(value, fallback) {
      return clampVAD({
        valence: value.valence ?? fallback.valence,
        arousal: value.arousal ?? fallback.arousal,
        dominance: value.dominance ?? fallback.dominance
      });
    }
  };

  // vendor/soullink/facs/defaultActionUnitState.ts
  function createDefaultActionUnitState(overrides = {}) {
    return {
      au01InnerBrowRaiser: 0,
      au02OuterBrowRaiser: 0,
      au04BrowLowerer: 0,
      au05UpperLidRaiser: 0,
      au06CheekRaiser: 0,
      au07LidTightener: 0,
      au09NoseWrinkler: 0,
      au10UpperLipRaiser: 0,
      au12LipCornerPuller: 0,
      au14Dimpler: 0,
      au15LipCornerDepressor: 0,
      au17ChinRaiser: 0,
      au18LipPucker: 0,
      au20LipStretcher: 0,
      au23LipTightener: 0,
      au24LipPressor: 0,
      au25LipsPart: 0,
      au26JawDrop: 0,
      au27MouthStretch: 0,
      au45Blink: 0,
      gazeX: 0,
      gazeY: 0,
      headX: 0,
      headY: 0,
      headZ: 0,
      bodyX: 0,
      bodyY: 0,
      bodyZ: 0,
      blush: 0,
      tear: 0,
      sweat: 0,
      breath: 0.5,
      ...overrides
    };
  }
  var defaultActionUnitState = createDefaultActionUnitState();

  // vendor/soullink/facs/FACSActionUnitState.ts
  var actionUnitDefinitions = [
    { key: "au01InnerBrowRaiser", code: "AU01", label: "Inner Brow Raiser", group: "brow", min: 0, max: 1 },
    { key: "au02OuterBrowRaiser", code: "AU02", label: "Outer Brow Raiser", group: "brow", min: 0, max: 1 },
    { key: "au04BrowLowerer", code: "AU04", label: "Brow Lowerer", group: "brow", min: 0, max: 1 },
    { key: "au05UpperLidRaiser", code: "AU05", label: "Upper Lid Raiser", group: "eye", min: 0, max: 1 },
    { key: "au06CheekRaiser", code: "AU06", label: "Cheek Raiser", group: "eye", min: 0, max: 1 },
    { key: "au07LidTightener", code: "AU07", label: "Lid Tightener", group: "eye", min: 0, max: 1 },
    { key: "au09NoseWrinkler", code: "AU09", label: "Nose Wrinkler", group: "midface", min: 0, max: 1 },
    { key: "au10UpperLipRaiser", code: "AU10", label: "Upper Lip Raiser", group: "mouth", min: 0, max: 1 },
    { key: "au12LipCornerPuller", code: "AU12", label: "Lip Corner Puller", group: "mouth", min: 0, max: 1 },
    { key: "au14Dimpler", code: "AU14", label: "Dimpler", group: "mouth", min: 0, max: 1 },
    { key: "au15LipCornerDepressor", code: "AU15", label: "Lip Corner Depressor", group: "mouth", min: 0, max: 1 },
    { key: "au17ChinRaiser", code: "AU17", label: "Chin Raiser", group: "mouth", min: 0, max: 1 },
    { key: "au18LipPucker", code: "AU18", label: "Lip Pucker", group: "mouth", min: 0, max: 1 },
    { key: "au20LipStretcher", code: "AU20", label: "Lip Stretcher", group: "mouth", min: 0, max: 1 },
    { key: "au23LipTightener", code: "AU23", label: "Lip Tightener", group: "mouth", min: 0, max: 1 },
    { key: "au24LipPressor", code: "AU24", label: "Lip Pressor", group: "mouth", min: 0, max: 1 },
    { key: "au25LipsPart", code: "AU25", label: "Lips Part", group: "mouth", min: 0, max: 1 },
    { key: "au26JawDrop", code: "AU26", label: "Jaw Drop", group: "mouth", min: 0, max: 1 },
    { key: "au27MouthStretch", code: "AU27", label: "Mouth Stretch", group: "mouth", min: 0, max: 1 },
    { key: "au45Blink", code: "AU45", label: "Blink", group: "eye", min: 0, max: 1 },
    { key: "gazeX", code: "GazeX", label: "Gaze X", group: "extension", min: -1, max: 1 },
    { key: "gazeY", code: "GazeY", label: "Gaze Y", group: "extension", min: -1, max: 1 },
    { key: "headX", code: "HeadX", label: "Head X", group: "extension", min: -1, max: 1 },
    { key: "headY", code: "HeadY", label: "Head Y", group: "extension", min: -1, max: 1 },
    { key: "headZ", code: "HeadZ", label: "Head Z", group: "extension", min: -1, max: 1 },
    { key: "bodyX", code: "BodyX", label: "Body X", group: "extension", min: -1, max: 1 },
    { key: "bodyY", code: "BodyY", label: "Body Y", group: "extension", min: -1, max: 1 },
    { key: "bodyZ", code: "BodyZ", label: "Body Z", group: "extension", min: -1, max: 1 },
    { key: "blush", code: "Blush", label: "Blush", group: "extension", min: 0, max: 1 },
    { key: "tear", code: "Tear", label: "Tear", group: "extension", min: 0, max: 1 },
    { key: "sweat", code: "Sweat", label: "Sweat", group: "extension", min: 0, max: 1 },
    { key: "breath", code: "Breath", label: "Breath", group: "extension", min: 0, max: 1 }
  ];
  var actionUnitKeys = actionUnitDefinitions.map((definition) => definition.key);

  // vendor/soullink/facs/defaultFACSState.ts
  function createDefaultFACSState(overrides = {}) {
    return {
      browInnerUp: 0,
      browOuterUp: 0,
      browDown: 0,
      eyeOpen: 1,
      eyeSmile: 0,
      eyeSquint: 0,
      eyeBlinkL: 0,
      eyeBlinkR: 0,
      mouthSmile: 0.04,
      mouthFrown: 0,
      mouthOpen: 0,
      mouthPucker: 0,
      gazeX: 0,
      gazeY: 0,
      headX: 0,
      headY: 0,
      headZ: 0,
      bodyX: 0,
      bodyY: 0,
      bodyZ: 0,
      blush: 0,
      tear: 0,
      sweat: 0,
      breath: 0.5,
      ...overrides
    };
  }
  var defaultFACSState = createDefaultFACSState();

  // vendor/soullink/facs/FACSUtils.ts
  var directionalKeys = /* @__PURE__ */ new Set([
    "gazeX",
    "gazeY",
    "headX",
    "headY",
    "headZ",
    "bodyX",
    "bodyY",
    "bodyZ"
  ]);
  var facsKeys = Object.keys(createDefaultFACSState());
  function facsRangeForKey(key) {
    if (directionalKeys.has(key)) return [-1, 1];
    if (key === "eyeOpen") return [0, 1.25];
    return [0, 1];
  }
  function clampFACSValue(key, value) {
    const [min, max] = facsRangeForKey(key);
    return clamp(value, min, max);
  }
  function clampFACSState(state) {
    const result = { ...state };
    for (const key of Object.keys(result)) {
      const value = result[key];
      if (typeof value === "number") {
        result[key] = clampFACSValue(key, value);
      }
    }
    return result;
  }

  // vendor/soullink/expression/EmotionArchetypeRegistry.ts
  var emotionArchetypes = {
    neutral: {
      emotion: "neutral",
      baseTendency: {
        mouthSmile: [0.02, 0.12],
        eyeOpen: [0.9, 1],
        eyeSmile: [0, 0.12],
        browInnerUp: [0, 0.06],
        gazeX: [-0.06, 0.06],
        gazeY: [-0.03, 0.04],
        headZ: [-0.03, 0.03]
      },
      variants: {
        neutral_ack: {
          ranges: {
            mouthSmile: [0.04, 0.16],
            eyeSmile: [0, 0.1],
            headY: [-0.03, 0.03]
          }
        },
        attentive: {
          ranges: {
            eyeOpen: [0.96, 1.06],
            browInnerUp: [0.04, 0.12],
            gazeX: [-0.02, 0.02],
            gazeY: [-0.02, 0.02]
          }
        }
      }
    },
    happy: {
      emotion: "happy",
      baseTendency: {
        mouthSmile: [0.35, 0.85],
        eyeSmile: [0.15, 0.55],
        eyeOpen: [0.88, 1.08],
        browInnerUp: [0, 0.18],
        headZ: [-0.08, 0.08],
        gazeX: [-0.12, 0.12],
        gazeY: [-0.04, 0.08]
      },
      variants: {
        soft_smile: {
          ranges: {
            mouthSmile: [0.3, 0.55],
            eyeSmile: [0.1, 0.3],
            headZ: [-0.04, 0.04]
          }
        },
        bright_smile: {
          ranges: {
            mouthSmile: [0.6, 0.9],
            eyeSmile: [0.35, 0.65],
            browInnerUp: [0.05, 0.18],
            headY: [-0.03, 0.06]
          }
        },
        surprised_happy: {
          ranges: {
            eyeOpen: [1.05, 1.2],
            browOuterUp: [0.2, 0.45],
            mouthOpen: [0.12, 0.35],
            mouthSmile: [0.55, 0.85],
            headX: [-0.04, 0.04]
          }
        },
        shy_happy: {
          ranges: {
            mouthSmile: [0.35, 0.65],
            eyeSmile: [0.2, 0.45],
            gazeX: [-0.35, -0.12],
            gazeY: [-0.18, 0.02],
            blush: [0.35, 0.85],
            headZ: [-0.12, -0.03]
          },
          tags: ["shy"]
        }
      }
    },
    calm: {
      emotion: "calm",
      baseTendency: {
        mouthSmile: [0.08, 0.24],
        eyeOpen: [0.82, 0.98],
        eyeSmile: [0.08, 0.28],
        browInnerUp: [0, 0.08],
        gazeX: [-0.04, 0.04],
        gazeY: [-0.04, 0.02],
        headZ: [-0.04, 0.04],
        bodyY: [-0.03, 0.03]
      },
      variants: {
        soft_calm: {
          ranges: {
            mouthSmile: [0.1, 0.22],
            eyeSmile: [0.08, 0.22],
            eyeOpen: [0.82, 0.94]
          }
        },
        quiet_listen: {
          ranges: {
            eyeOpen: [0.86, 1],
            browInnerUp: [0.03, 0.1],
            headY: [-0.02, 0.05]
          }
        }
      }
    },
    excited: {
      emotion: "excited",
      baseTendency: {
        mouthSmile: [0.58, 0.95],
        mouthOpen: [0.14, 0.42],
        eyeOpen: [1.04, 1.24],
        eyeSmile: [0.22, 0.56],
        browOuterUp: [0.18, 0.48],
        headX: [-0.08, 0.08],
        headY: [-0.05, 0.08],
        bodyY: [-0.06, 0.08]
      },
      variants: {
        sparkle: {
          ranges: {
            mouthSmile: [0.68, 0.95],
            eyeOpen: [1.08, 1.24],
            browOuterUp: [0.24, 0.56]
          }
        },
        bounce: {
          ranges: {
            mouthOpen: [0.22, 0.48],
            headY: [-0.08, 0.1],
            bodyY: [-0.08, 0.1]
          }
        }
      }
    },
    shy: {
      emotion: "shy",
      baseTendency: {
        mouthSmile: [0.2, 0.55],
        eyeOpen: [0.82, 1],
        eyeSmile: [0.16, 0.42],
        browInnerUp: [0.04, 0.18],
        gazeX: [-0.38, -0.1],
        gazeY: [-0.2, 0.02],
        headZ: [-0.14, -0.03],
        blush: [0.35, 0.9]
      },
      variants: {
        bashful: {
          ranges: {
            mouthSmile: [0.28, 0.58],
            eyeSmile: [0.22, 0.46],
            blush: [0.52, 0.95]
          }
        },
        embarrassed: {
          ranges: {
            mouthSmile: [0.08, 0.32],
            mouthOpen: [0.02, 0.16],
            browInnerUp: [0.12, 0.32],
            sweat: [0.04, 0.22]
          }
        }
      }
    },
    affectionate: {
      emotion: "affectionate",
      baseTendency: {
        mouthSmile: [0.22, 0.62],
        eyeSmile: [0.18, 0.5],
        eyeOpen: [0.82, 1.02],
        browInnerUp: [0.06, 0.22],
        gazeX: [-0.05, 0.05],
        gazeY: [-0.02, 0.06],
        headZ: [-0.08, 0.08],
        blush: [0.08, 0.42]
      },
      variants: {
        warm: {
          ranges: {
            mouthSmile: [0.28, 0.6],
            eyeSmile: [0.22, 0.48],
            browInnerUp: [0.08, 0.24]
          }
        },
        close: {
          ranges: {
            mouthSmile: [0.18, 0.46],
            gazeY: [0.02, 0.08],
            blush: [0.2, 0.5]
          }
        }
      }
    },
    curious: {
      emotion: "curious",
      baseTendency: {
        browOuterUp: [0.1, 0.34],
        browInnerUp: [0.02, 0.18],
        eyeOpen: [0.98, 1.16],
        mouthOpen: [0.02, 0.18],
        mouthSmile: [0.08, 0.28],
        gazeX: [-0.16, 0.16],
        headZ: [-0.16, 0.16],
        headY: [-0.04, 0.06]
      },
      variants: {
        tilt: {
          ranges: {
            browOuterUp: [0.16, 0.38],
            headZ: [-0.18, 0.18],
            mouthOpen: [0.04, 0.18]
          }
        },
        attentive_question: {
          ranges: {
            eyeOpen: [1, 1.18],
            browInnerUp: [0.08, 0.22],
            gazeX: [-0.04, 0.04]
          }
        }
      }
    },
    concerned: {
      emotion: "concerned",
      baseTendency: {
        browInnerUp: [0.22, 0.55],
        eyeOpen: [0.78, 0.98],
        mouthSmile: [0.04, 0.22],
        mouthFrown: [0.05, 0.25],
        headZ: [-0.08, 0.08],
        gazeX: [-0.05, 0.05],
        gazeY: [-0.05, 0.05]
      },
      variants: {
        soft_concern: {
          ranges: {
            browInnerUp: [0.2, 0.4],
            mouthSmile: [0.08, 0.22],
            eyeOpen: [0.82, 0.95]
          }
        },
        worried: {
          ranges: {
            browInnerUp: [0.4, 0.65],
            mouthFrown: [0.18, 0.35],
            eyeOpen: [0.88, 1.05],
            sweat: [0.05, 0.25]
          }
        },
        comfort: {
          ranges: {
            browInnerUp: [0.25, 0.45],
            mouthSmile: [0.12, 0.32],
            eyeSmile: [0.05, 0.2],
            headZ: [-0.06, 0.06]
          },
          tags: ["warm"]
        }
      }
    },
    tired: {
      emotion: "tired",
      baseTendency: {
        eyeOpen: [0.58, 0.84],
        eyeSquint: [0.08, 0.28],
        browInnerUp: [0.06, 0.22],
        mouthFrown: [0.04, 0.2],
        mouthSmile: [0, 0.1],
        gazeY: [-0.2, -0.04],
        headY: [-0.1, -0.02],
        bodyY: [-0.08, -0.02]
      },
      variants: {
        sleepy: {
          ranges: {
            eyeOpen: [0.52, 0.76],
            mouthOpen: [0.02, 0.14],
            headY: [-0.12, -0.04]
          }
        },
        drained: {
          ranges: {
            eyeOpen: [0.62, 0.84],
            browInnerUp: [0.12, 0.3],
            mouthFrown: [0.1, 0.24]
          }
        }
      }
    },
    sad: {
      emotion: "sad",
      baseTendency: {
        browInnerUp: [0.28, 0.6],
        eyeOpen: [0.64, 0.92],
        eyeSquint: [0.04, 0.2],
        mouthFrown: [0.18, 0.5],
        mouthSmile: [0, 0.08],
        gazeY: [-0.24, -0.06],
        headY: [-0.12, -0.02],
        tear: [0, 0.32]
      },
      variants: {
        downcast: {
          ranges: {
            browInnerUp: [0.3, 0.56],
            mouthFrown: [0.22, 0.48],
            gazeY: [-0.26, -0.08]
          }
        },
        teary: {
          ranges: {
            browInnerUp: [0.38, 0.68],
            eyeOpen: [0.68, 0.95],
            tear: [0.22, 0.58]
          }
        }
      }
    },
    anxiety: {
      emotion: "anxiety",
      baseTendency: {
        browInnerUp: [0.24, 0.58],
        browOuterUp: [0.08, 0.32],
        eyeOpen: [1.02, 1.22],
        mouthFrown: [0.12, 0.36],
        mouthOpen: [0.02, 0.18],
        gazeX: [-0.22, 0.22],
        headZ: [-0.12, 0.12],
        sweat: [0.12, 0.46]
      },
      variants: {
        nervous: {
          ranges: {
            eyeOpen: [1.04, 1.22],
            browInnerUp: [0.32, 0.62],
            sweat: [0.18, 0.52]
          }
        },
        uneasy: {
          ranges: {
            gazeX: [-0.28, 0.28],
            mouthFrown: [0.16, 0.38],
            headZ: [-0.16, 0.16]
          }
        }
      }
    },
    confused: {
      emotion: "confused",
      baseTendency: {
        browInnerUp: [0.08, 0.28],
        browDown: [0.08, 0.25],
        eyeOpen: [0.92, 1.1],
        mouthOpen: [0.02, 0.16],
        mouthFrown: [0.04, 0.18],
        gazeX: [-0.18, 0.18],
        headZ: [-0.14, 0.14]
      },
      variants: {
        confused: {
          ranges: {
            browInnerUp: [0.12, 0.3],
            browDown: [0.08, 0.24],
            mouthOpen: [0.04, 0.18],
            headZ: [-0.16, 0.16]
          }
        }
      }
    },
    surprised: {
      emotion: "surprised",
      baseTendency: {
        eyeOpen: [1.08, 1.22],
        browOuterUp: [0.28, 0.55],
        mouthOpen: [0.18, 0.42],
        mouthSmile: [0, 0.18],
        gazeX: [-0.03, 0.03],
        gazeY: [-0.02, 0.04],
        headX: [-0.05, 0.05]
      },
      variants: {
        startled: {
          ranges: {
            eyeOpen: [1.12, 1.24],
            browOuterUp: [0.34, 0.6],
            mouthOpen: [0.2, 0.45],
            headY: [-0.05, 0.02]
          }
        }
      }
    },
    anger: {
      emotion: "anger",
      baseTendency: {
        browDown: [0.28, 0.6],
        eyeOpen: [0.76, 0.98],
        eyeSquint: [0.12, 0.38],
        mouthFrown: [0.18, 0.46],
        mouthOpen: [0, 0.16],
        gazeX: [-0.04, 0.04],
        headZ: [-0.08, 0.08],
        sweat: [0, 0.18]
      },
      variants: {
        annoyed: {
          ranges: {
            browDown: [0.22, 0.44],
            eyeSquint: [0.08, 0.26],
            mouthFrown: [0.12, 0.34]
          }
        },
        firm: {
          ranges: {
            browDown: [0.36, 0.62],
            eyeSquint: [0.18, 0.42],
            mouthFrown: [0.24, 0.48],
            headY: [0.02, 0.08]
          }
        }
      }
    },
    angry: {
      emotion: "angry",
      baseTendency: {
        browDown: [0.28, 0.58],
        eyeOpen: [0.78, 0.96],
        eyeSquint: [0.1, 0.35],
        mouthFrown: [0.18, 0.42],
        mouthOpen: [0, 0.12],
        gazeX: [-0.04, 0.04],
        headZ: [-0.08, 0.08],
        sweat: [0, 0.16]
      },
      variants: {
        annoyed: {
          ranges: {
            browDown: [0.22, 0.42],
            eyeSquint: [0.08, 0.24],
            mouthFrown: [0.12, 0.32]
          }
        }
      }
    }
  };
  function getEmotionArchetype(emotion) {
    return emotionArchetypes[emotion] ?? emotionArchetypes.neutral;
  }

  // vendor/soullink/emotion/VADExpressionMapper.ts
  var directionalKeys2 = /* @__PURE__ */ new Set([
    "gazeX",
    "gazeY",
    "headX",
    "headY",
    "headZ",
    "bodyX",
    "bodyY",
    "bodyZ"
  ]);
  var VADExpressionMapper = class {
    toFACS(vad, weight = 1, options = {}) {
      const positive = Math.max(0, vad.valence);
      const negative = Math.max(0, -vad.valence);
      const aroused = Math.max(0, vad.arousal);
      const calm = Math.max(0, -vad.arousal);
      const submissive = Math.max(0, -vad.dominance);
      const dominant = Math.max(0, vad.dominance);
      const mouthSmile = positive * 0.13 + calm * positive * 0.05;
      const mouthFrown = negative * 0.1 + calm * negative * 0.04;
      const browInnerUp = negative * 0.08 + submissive * 0.055;
      const browOuterUp = aroused * 0.08 + positive * aroused * 0.035;
      const browDown = dominant * negative * 0.11;
      const eyeSmile = positive * 0.08 + calm * positive * 0.035;
      const eyeSquint = negative * dominant * 0.08 + calm * 0.035;
      const eyeOpen = clamp(1 + aroused * 0.08 - calm * 0.07 - negative * 0.035, 0.86, 1.12);
      const base = {
        mouthSmile: mouthSmile * weight,
        mouthFrown: mouthFrown * weight,
        browInnerUp: browInnerUp * weight,
        browOuterUp: browOuterUp * weight,
        browDown: browDown * weight,
        eyeSmile: eyeSmile * weight,
        eyeSquint: eyeSquint * weight,
        eyeOpen: 1 + (eyeOpen - 1) * weight,
        gazeY: (-submissive * 0.05 + dominant * 0.025) * weight,
        headY: (-submissive * 0.035 + dominant * 0.025 + aroused * 0.012) * weight,
        headZ: (positive * submissive * -0.025 + negative * dominant * 0.018) * weight,
        blush: positive * submissive * 0.16 * weight,
        sweat: negative * aroused * 0.1 * weight
      };
      const emotion = normalizeEmotionName(options.dominantEmotion);
      const intensity = vadMagnitude(vad);
      const styleGain = clamp(options.styleGain ?? 1, 0, 2.4);
      let result = this.applyStyle(
        base,
        this.getArchetypeStyle(emotion),
        emotion === "neutral" ? 0 : clamp((0.1 + intensity * 0.76) * weight * styleGain, 0, 0.46)
      );
      if (options.residue && isRelatedEmotion(emotion, normalizeEmotionName(options.residue.emotion))) {
        result = this.applyStyle(
          result,
          options.residue.facs,
          clamp((0.14 + intensity * 0.62) * weight * styleGain, 0, 0.58)
        );
      }
      return clampFACSState(result);
    }
    getArchetypeStyle(emotion) {
      if (emotion === "neutral") return {};
      const archetype = getEmotionArchetype(emotion);
      const result = {};
      for (const [key, range] of Object.entries(archetype.baseTendency)) {
        result[key] = (range[0] + range[1]) / 2;
      }
      return clampFACSState(result);
    }
    applyStyle(base, style, amount) {
      if (amount <= 0) return base;
      const result = { ...base };
      for (const key of Object.keys(style)) {
        const target = style[key];
        if (typeof target !== "number") continue;
        const neutral = defaultFACSState[key];
        const current = result[key] ?? neutral;
        const styled = lerp(neutral, target, amount);
        if (directionalKeys2.has(key) || key === "eyeOpen") {
          result[key] = current + (styled - neutral);
        } else {
          result[key] = Math.max(current, styled);
        }
      }
      return clampFACSState(result);
    }
  };
  function vadMagnitude(vad) {
    return clamp(
      (Math.abs(vad.valence) + Math.abs(vad.arousal) * 0.82 + Math.abs(vad.dominance) * 0.64) / 2.46,
      0,
      1
    );
  }
  function normalizeEmotionName(value) {
    const emotion = value?.trim() ?? "neutral";
    if (emotion === "soft-happy" || emotion === "soft-positive") return "happy";
    if (emotion === "soft-calm") return "calm";
    if (emotion === "soft-curious") return "curious";
    if (emotion === "soft-shy") return "shy";
    if (emotion === "soft-uneasy") return "anxiety";
    if (emotion === "soft-low") return "sad";
    if (emotion === "soft-steady") return "neutral";
    if (emotion === "angry") return "anger";
    return emotion;
  }
  function isRelatedEmotion(a, b3) {
    if (a === b3) return true;
    if (a === "happy" && b3 === "excited" || a === "excited" && b3 === "happy") return true;
    if (a === "happy" && b3 === "affectionate" || a === "affectionate" && b3 === "happy") return true;
    if (a === "sad" && b3 === "concerned" || a === "concerned" && b3 === "sad") return true;
    return false;
  }

  // vendor/soullink/facs/ActionUnitUtils.ts
  var directionalKeys3 = /* @__PURE__ */ new Set([
    "gazeX",
    "gazeY",
    "headX",
    "headY",
    "headZ",
    "bodyX",
    "bodyY",
    "bodyZ"
  ]);
  var rangeByKey = Object.fromEntries(
    actionUnitDefinitions.map((definition) => [definition.key, [definition.min, definition.max]])
  );
  function actionUnitRangeForKey(key) {
    return rangeByKey[key] ?? (directionalKeys3.has(key) ? [-1, 1] : [0, 1]);
  }
  function clampActionUnitValue(key, value) {
    const [min, max] = actionUnitRangeForKey(key);
    return clamp(value, min, max);
  }
  function normalizeActionUnits(partial) {
    const result = createDefaultActionUnitState();
    for (const key of actionUnitKeys) {
      const value = partial[key];
      result[key] = clampActionUnitValue(key, value ?? result[key]);
    }
    return result;
  }

  // vendor/soullink/expression/ActionUnitSolver.ts
  var ActionUnitSolver = class {
    solve(actionUnits) {
      const au = normalizeActionUnits(actionUnits);
      const browInnerUp = au.au01InnerBrowRaiser * 0.92;
      const browOuterUp = au.au02OuterBrowRaiser * 0.9 + au.au05UpperLidRaiser * 0.18;
      const browDown = Math.max(au.au04BrowLowerer, au.au09NoseWrinkler * 0.45);
      const eyeSmile = clamp(au.au06CheekRaiser * 0.78 + au.au12LipCornerPuller * 0.12, 0, 1);
      const eyeSquint = clamp(au.au07LidTightener * 0.85 + au.au06CheekRaiser * 0.28, 0, 1);
      const upperLid = au.au05UpperLidRaiser * 0.24;
      const squintClose = au.au07LidTightener * 0.22 + au.au06CheekRaiser * 0.16;
      const eyeOpen = clamp(1 + upperLid - squintClose, 0.45, 1.24);
      const mouthSmile = clamp(au.au12LipCornerPuller * 0.88 + au.au14Dimpler * 0.22, 0, 1);
      const mouthFrown = clamp(au.au15LipCornerDepressor * 0.86 + au.au17ChinRaiser * 0.2, 0, 1);
      const mouthPucker = clamp(au.au18LipPucker * 0.9 + au.au23LipTightener * 0.22 + au.au24LipPressor * 0.18, 0, 1);
      const mouthOpen = clamp(
        au.au25LipsPart * 0.42 + au.au26JawDrop * 0.72 + au.au27MouthStretch * 0.86 + au.au10UpperLipRaiser * 0.16,
        0,
        1
      );
      return clampFACSState({
        browInnerUp,
        browOuterUp,
        browDown,
        eyeOpen,
        eyeSmile,
        eyeSquint,
        eyeBlinkL: au.au45Blink,
        eyeBlinkR: au.au45Blink,
        mouthSmile,
        mouthFrown,
        mouthOpen,
        mouthPucker,
        gazeX: au.gazeX,
        gazeY: au.gazeY,
        headX: au.headX,
        headY: au.headY,
        headZ: au.headZ,
        bodyX: au.bodyX,
        bodyY: au.bodyY,
        bodyZ: au.bodyZ,
        blush: au.blush,
        tear: au.tear,
        sweat: au.sweat,
        breath: au.breath
      });
    }
    solvePartial(actionUnits) {
      const solved = this.solve(actionUnits);
      const result = {};
      const keys = new Set(Object.keys(actionUnits));
      if (["au01InnerBrowRaiser", "au02OuterBrowRaiser", "au04BrowLowerer", "au05UpperLidRaiser", "au09NoseWrinkler"].some((key) => keys.has(key))) {
        result.browInnerUp = solved.browInnerUp;
        result.browOuterUp = solved.browOuterUp;
        result.browDown = solved.browDown;
      }
      if (["au05UpperLidRaiser", "au06CheekRaiser", "au07LidTightener"].some((key) => keys.has(key))) {
        result.eyeOpen = solved.eyeOpen;
        result.eyeSmile = solved.eyeSmile;
        result.eyeSquint = solved.eyeSquint;
      }
      if (keys.has("au45Blink")) {
        result.eyeBlinkL = solved.eyeBlinkL;
        result.eyeBlinkR = solved.eyeBlinkR;
      }
      if ([
        "au10UpperLipRaiser",
        "au12LipCornerPuller",
        "au14Dimpler",
        "au15LipCornerDepressor",
        "au17ChinRaiser",
        "au18LipPucker",
        "au20LipStretcher",
        "au23LipTightener",
        "au24LipPressor",
        "au25LipsPart",
        "au26JawDrop",
        "au27MouthStretch"
      ].some((key) => keys.has(key))) {
        result.mouthSmile = solved.mouthSmile;
        result.mouthFrown = solved.mouthFrown;
        result.mouthOpen = solved.mouthOpen;
        result.mouthPucker = solved.mouthPucker;
      }
      for (const key of ["gazeX", "gazeY", "headX", "headY", "headZ", "bodyX", "bodyY", "bodyZ", "blush", "tear", "sweat", "breath"]) {
        if (keys.has(key)) result[key] = solved[key];
      }
      return result;
    }
    project(facs) {
      const state = facs;
      return normalizeActionUnits({
        au01InnerBrowRaiser: state.browInnerUp ?? 0,
        au02OuterBrowRaiser: state.browOuterUp ?? 0,
        au04BrowLowerer: state.browDown ?? 0,
        au05UpperLidRaiser: Math.max(0, (state.eyeOpen ?? 1) - 1) * 3.2,
        au06CheekRaiser: state.eyeSmile ?? 0,
        au07LidTightener: state.eyeSquint ?? 0,
        au12LipCornerPuller: state.mouthSmile ?? 0,
        au15LipCornerDepressor: state.mouthFrown ?? 0,
        au18LipPucker: state.mouthPucker ?? 0,
        au25LipsPart: Math.min(1, (state.mouthOpen ?? 0) * 0.55),
        au26JawDrop: Math.min(1, (state.mouthOpen ?? 0) * 0.8),
        au45Blink: Math.max(state.eyeBlinkL ?? 0, state.eyeBlinkR ?? 0),
        gazeX: state.gazeX ?? 0,
        gazeY: state.gazeY ?? 0,
        headX: state.headX ?? 0,
        headY: state.headY ?? 0,
        headZ: state.headZ ?? 0,
        bodyX: state.bodyX ?? 0,
        bodyY: state.bodyY ?? 0,
        bodyZ: state.bodyZ ?? 0,
        blush: state.blush ?? 0,
        tear: state.tear ?? 0,
        sweat: state.sweat ?? 0,
        breath: state.breath ?? 0.5
      });
    }
  };

  // src/emotions.ts
  var p = (name, label, icon, group, vad, au, description) => ({ name, label, icon, group, vad, au, description });
  var emotionCatalog = [
    p("neutral", "\u4E2D\u6027", "\u25CC", "low", emotionVADPresets.neutral, {}, "\u56DE\u5230\u81EA\u7136\u57FA\u7EBF"),
    p("happy", "\u5F00\u5FC3", "\u2323", "positive", emotionVADPresets.happy, { au12LipCornerPuller: 0.65, au06CheekRaiser: 0.34, au02OuterBrowRaiser: 0.09 }, "\u5634\u89D2\u4E0A\u626C\uFF0C\u773C\u5468\u8F7B\u8F7B\u6536\u7D27"),
    p("excited", "\u5174\u594B", "\u2727", "positive", emotionVADPresets.excited, { au12LipCornerPuller: 0.75, au06CheekRaiser: 0.26, au02OuterBrowRaiser: 0.32, au05UpperLidRaiser: 0.28, au25LipsPart: 0.2, au26JawDrop: 0.18 }, "\u66F4\u5927\u7684\u7B11\u5BB9\u3001\u5916\u7709\u4E0A\u63D0\u4E0E\u8F7B\u5FAE\u5F20\u5634"),
    p("amused", "\u5FCD\u4FCA", "\u2312", "positive", { valence: 0.72, arousal: 0.33, dominance: 0.1 }, { au12LipCornerPuller: 0.57, au06CheekRaiser: 0.56, au07LidTightener: 0.18, au14Dimpler: 0.15 }, "\u7B11\u773C\u6BD4\u5F20\u5634\u66F4\u660E\u663E"),
    p("proud", "\u5F97\u610F", "\u02D8", "positive", { valence: 0.68, arousal: 0.32, dominance: 0.8 }, { au12LipCornerPuller: 0.28, au14Dimpler: 0.35, au07LidTightener: 0.13, headY: 0.09, gazeY: 0.08 }, "\u514B\u5236\u5FAE\u7B11\u3001\u8F7B\u5FAE\u6536\u773C\u4E0E\u62AC\u5934"),
    p("confident", "\u81EA\u4FE1", "\u25C7", "positive", { valence: 0.4, arousal: 0.12, dominance: 0.85 }, { au12LipCornerPuller: 0.21, au14Dimpler: 0.19, au23LipTightener: 0.13, headY: 0.1, gazeY: 0.04 }, "\u7A33\u4F4F\u5634\u89D2\u4E0E\u5934\u90E8\u59FF\u6001"),
    p("calm", "\u5B89\u5FC3", "\u2248", "low", emotionVADPresets.calm, { au12LipCornerPuller: 0.21, au06CheekRaiser: 0.12, au07LidTightener: 0.1 }, "\u8212\u7F13\u773C\u7751\uFF0C\u5FAE\u5F31\u800C\u5B89\u5B9A\u7684\u7B11\u5BB9"),
    p("relieved", "\u91CA\u7136", "\uFF5E", "low", { valence: 0.52, arousal: -0.48, dominance: 0.15 }, { au12LipCornerPuller: 0.31, au06CheekRaiser: 0.22, au25LipsPart: 0.035, headY: -0.025 }, "\u7D27\u7EF7\u91CA\u653E\uFF0C\u7B11\u5BB9\u8212\u5C55"),
    p("affectionate", "\u6E29\u67D4", "\u2661", "connection", emotionVADPresets.affectionate, { au12LipCornerPuller: 0.38, au06CheekRaiser: 0.24, au01InnerBrowRaiser: 0.12, headZ: -0.045 }, "\u67D4\u548C\u5185\u7709\u4E0E\u5FAE\u7B11\u5171\u540C\u51FA\u73B0"),
    p("shy", "\u5BB3\u7F9E", "\u3003", "connection", emotionVADPresets.shy, { au12LipCornerPuller: 0.32, au06CheekRaiser: 0.29, au01InnerBrowRaiser: 0.15, au24LipPressor: 0.08, gazeY: -0.13, headY: -0.07, headZ: -0.09, blush: 0.4 }, "\u773C\u795E\u4E0B\u79FB\uFF0C\u5FAE\u7B11\u5E26\u7740\u9000\u8BA9"),
    p("embarrassed", "\u7A98\u8FEB", "\u2044", "connection", { valence: 0.08, arousal: 0.66, dominance: -0.7 }, { au01InnerBrowRaiser: 0.32, au12LipCornerPuller: 0.15, au20LipStretcher: 0.18, au24LipPressor: 0.2, gazeY: -0.2, headY: -0.1, blush: 0.5 }, "\u62D8\u8C28\u5634\u5507\u4E0E\u66F4\u660E\u663E\u7684\u56DE\u907F\u89C6\u7EBF"),
    p("curious", "\u597D\u5947", "?", "connection", emotionVADPresets.curious, { au02OuterBrowRaiser: 0.38, au05UpperLidRaiser: 0.2, au12LipCornerPuller: 0.09, headZ: 0.065 }, "\u7709\u4E0E\u773C\u5C55\u5F00\uFF0C\u8F7B\u5FAE\u6B6A\u5934"),
    p("concerned", "\u5173\u5207", "\xB7", "connection", emotionVADPresets.concerned, { au01InnerBrowRaiser: 0.38, au04BrowLowerer: 0.15, au15LipCornerDepressor: 0.08, au24LipPressor: 0.06 }, "\u5185\u7709\u4E0A\u63D0\u4E0E\u7709\u5FC3\u6536\u7D27"),
    p("confused", "\u56F0\u60D1", "\u223F", "connection", emotionVADPresets.confused, { au01InnerBrowRaiser: 0.22, au02OuterBrowRaiser: 0.18, au04BrowLowerer: 0.18, au18LipPucker: 0.08, headZ: 0.1 }, "\u7709\u773C\u4E0D\u786E\u5B9A\uFF0C\u5634\u5507\u8F7B\u5FAE\u6536\u62E2"),
    p("tired", "\u75B2\u60EB", "\u2212", "low", emotionVADPresets.tired, { au07LidTightener: 0.14, au15LipCornerDepressor: 0.08, headY: -0.08, gazeY: -0.06 }, "\u4F4E\u5524\u9192\u5EA6\u964D\u4F4E\u773C\u7751\u4E0E\u5934\u90E8\u6D3B\u529B"),
    p("sad", "\u4F4E\u843D", "\u2322", "low", emotionVADPresets.sad, { au01InnerBrowRaiser: 0.6, au15LipCornerDepressor: 0.45, au17ChinRaiser: 0.15, headY: -0.08, gazeY: -0.12 }, "\u5185\u7709\u4E0E\u4E0B\u5782\u5634\u89D2\u5171\u540C\u8868\u8FBE\u60B2\u4F24"),
    p("lonely", "\u843D\u5BDE", "\u22C5", "low", { valence: -0.55, arousal: -0.55, dominance: -0.65 }, { au01InnerBrowRaiser: 0.36, au15LipCornerDepressor: 0.27, au07LidTightener: 0.09, gazeY: -0.18, headY: -0.12 }, "\u8F83\u5B89\u9759\u7684\u60B2\u4F24\u4E0E\u56DE\u907F\u89C6\u7EBF"),
    p("disappointed", "\u5931\u671B", "\u2935", "low", { valence: -0.62, arousal: -0.18, dominance: -0.12 }, { au01InnerBrowRaiser: 0.3, au15LipCornerDepressor: 0.32, au24LipPressor: 0.3, au04BrowLowerer: 0.15 }, "\u60B2\u4F24\u4E2D\u4FDD\u7559\u7EF7\u7D27\u7684\u5634\u5507"),
    p("anxiety", "\u7D27\u5F20", "\u22EF", "pressure", emotionVADPresets.anxiety, { au01InnerBrowRaiser: 0.5, au04BrowLowerer: 0.21, au05UpperLidRaiser: 0.22, au20LipStretcher: 0.34, au24LipPressor: 0.16 }, "\u5185\u7709\u3001\u773C\u7751\u4E0E\u6A2A\u5411\u5634\u90E8\u5F20\u529B"),
    p("fear", "\u5BB3\u6015", "!", "pressure", { valence: -0.78, arousal: 0.85, dominance: -0.8 }, { au01InnerBrowRaiser: 0.56, au02OuterBrowRaiser: 0.46, au05UpperLidRaiser: 0.64, au20LipStretcher: 0.43, au25LipsPart: 0.16, au26JawDrop: 0.17, gazeY: -0.08 }, "\u7741\u5927\u773C\u775B\uFF0C\u4E0A\u63D0\u7709\u6BDB\u4E0E\u9000\u7F29\u59FF\u6001"),
    p("anger", "\u751F\u6C14", "\u2301", "pressure", emotionVADPresets.anger, { au04BrowLowerer: 0.74, au07LidTightener: 0.5, au23LipTightener: 0.44, au24LipPressor: 0.34, headY: 0.04 }, "\u9AD8\u652F\u914D\u5EA6\u4E0B\u538B\u7709\u6BDB\u5E76\u6536\u7D27\u5634\u5507"),
    p("frustrated", "\u70E6\u8E81", "\u224B", "pressure", { valence: -0.63, arousal: 0.58, dominance: 0.05 }, { au04BrowLowerer: 0.51, au07LidTightener: 0.28, au15LipCornerDepressor: 0.23, au24LipPressor: 0.34, au23LipTightener: 0.2 }, "\u8F83\u5F31\u4E3B\u5BFC\u611F\uFF0C\u76B1\u7709\u4E2D\u6DF7\u5165\u4E0B\u5782\u5634\u89D2"),
    p("disgust", "\u5ACC\u5F03", "\u231C", "pressure", { valence: -0.7, arousal: 0.28, dominance: 0.45 }, { au04BrowLowerer: 0.35, au07LidTightener: 0.37, au09NoseWrinkler: 0.6, au10UpperLipRaiser: 0.42, au23LipTightener: 0.3, au15LipCornerDepressor: 0.18 }, "\u6536\u773C\u3001\u76B1\u7709\u4E0E\u4E2D\u9762\u90E8\u5F20\u529B\uFF1B\u672A\u652F\u6301\u5F62\u53D8\u4FDD\u6301\u7F3A\u5931"),
    p("surprised", "\u60CA\u8BB6", "\u25CB", "pressure", emotionVADPresets.surprised, { au01InnerBrowRaiser: 0.2, au02OuterBrowRaiser: 0.65, au05UpperLidRaiser: 0.63, au25LipsPart: 0.26, au26JawDrop: 0.36, au27MouthStretch: 0.12 }, "\u4E0A\u63D0\u5916\u7709\u3001\u5C55\u5F00\u773C\u775B\u4E0E\u5634\u5DF4")
  ];
  var emotionByName = new Map(emotionCatalog.map((p2) => [p2.name, p2]));

  // src/detailed-vad.ts
  var clamp2 = (v, min = 0, max = 1) => Math.min(max, Math.max(min, Number.isFinite(v) ? v : 0));
  var magnitude2 = (v) => Math.hypot(v.valence, v.arousal * 0.85, v.dominance * 0.7);
  var distance = (a, b3) => (a.valence - b3.valence) ** 2 * 1.1 + (a.arousal - b3.arousal) ** 2 * 0.95 + (a.dominance - b3.dominance) ** 2 * 1.35;
  var DetailedVADMapper = class {
    constructor() {
      __publicField(this, "original", new VADExpressionMapper());
      __publicField(this, "solver", new ActionUnitSolver());
    }
    map(input, settings, intent) {
      const vad = { valence: clamp2(input.valence, -1, 1), arousal: clamp2(input.arousal, -1, 1), dominance: clamp2(input.dominance, -1, 1) };
      const p2 = Math.max(0, vad.valence), n = Math.max(0, -vad.valence), a = Math.max(0, vad.arousal), c = Math.max(0, -vad.arousal), d = Math.max(0, vad.dominance), s = Math.max(0, -vad.dominance);
      const activation = 1 - Math.exp(-magnitude2(vad) * 2.5);
      const scores = emotionCatalog.filter((p3) => p3.name !== "neutral").map((p3) => ({ preset: p3, score: Math.exp(-distance(vad, p3.vad) / (2 * 0.24 ** 2)) }));
      const sum = scores.reduce((v, x) => v + x.score, 0) || 1;
      const prototype = createDefaultActionUnitState({ breath: 0 });
      for (const { preset, score } of scores) for (const [key, value] of Object.entries(preset.au)) prototype[key] += (value ?? 0) * score / sum;
      const style = emotionByName.get(intent?.name ?? "");
      const residue = style ? clamp2(intent?.strength ?? 0) * 0.48 : 0;
      if (style) for (const definition of actionUnitDefinitions) prototype[definition.key] = prototype[definition.key] * (1 - residue) + (style.au[definition.key] ?? 0) * residue;
      const base = this.solver.project(this.original.toFACS(vad, 1, { dominantEmotion: "neutral" }));
      const rules = {
        ...createDefaultActionUnitState({ breath: 0 }),
        ...base,
        au01InnerBrowRaiser: 0.28 * n * (0.4 + 0.6 * s) + 0.12 * s * (0.3 + 0.7 * a),
        au02OuterBrowRaiser: 0.3 * a * (0.4 + 0.6 * p2) + 0.21 * n * a * s,
        au04BrowLowerer: 0.65 * n * d + 0.1 * n * a * (1 - s),
        au05UpperLidRaiser: 0.27 * a + 0.23 * n * a * s,
        au06CheekRaiser: 0.28 * p2 * (0.55 + 0.45 * c),
        au07LidTightener: 0.38 * n * d + 0.1 * c,
        au12LipCornerPuller: 0.5 * p2 * (0.55 + 0.45 * Math.max(a, c)),
        au14Dimpler: 0.2 * p2 * d,
        au15LipCornerDepressor: 0.32 * n * (0.4 + 0.6 * Math.max(c, s)),
        au17ChinRaiser: 0.16 * n * s,
        au20LipStretcher: 0.3 * n * a * s,
        au23LipTightener: 0.32 * n * d + 0.07 * d,
        au24LipPressor: 0.24 * n * (d + 0.5 * a),
        au25LipsPart: 0.05 * a,
        au26JawDrop: 0.05 * a * (0.4 + 0.6 * s),
        gazeY: -0.1 * s + 0.035 * d,
        headY: -0.065 * s + 0.065 * d,
        headZ: -0.03 * p2 * s
      };
      const mix = clamp2(settings.detailMix);
      const aus = createDefaultActionUnitState();
      for (const definition of actionUnitDefinitions) {
        const key = definition.key;
        if (key === "breath") continue;
        const region = definition.group === "brow" ? settings.browGain : definition.group === "eye" ? settings.eyeGain : definition.group === "mouth" || definition.group === "midface" ? settings.mouthGain : 1;
        const value = (rules[key] * (1 - mix) + prototype[key] * activation * mix) * settings.gain * region;
        aus[key] = clamp2(value, definition.min, definition.max);
      }
      aus.au45Blink = 0;
      const blend = scores.map(({ preset, score }) => ({ name: preset.name, label: preset.label, weight: score / sum })).sort((a2, b3) => b3.weight - a2.weight);
      return { aus, details: { blend: activation > 0.025 ? blend.slice(0, 3) : [], dominant: activation > 0.025 ? residue > 0.15 ? style.name : blend[0].name : "neutral", eyelidRelaxation: clamp2(c * 0.2 + Math.max(0, s) * c * 0.08, 0, 0.3), regions: { brow: Math.max(aus.au01InnerBrowRaiser, aus.au02OuterBrowRaiser, aus.au04BrowLowerer), eyes: Math.max(aus.au05UpperLidRaiser, aus.au06CheekRaiser, aus.au07LidTightener), mouth: Math.max(aus.au12LipCornerPuller, aus.au15LipCornerDepressor, aus.au26JawDrop, aus.au24LipPressor) }, sourceStrength: residue } };
    }
  };

  // src/arkit.ts
  var arkitKeys = [
    "browDownLeft",
    "browDownRight",
    "browInnerUp",
    "browOuterUpLeft",
    "browOuterUpRight",
    "cheekPuff",
    "cheekSquintLeft",
    "cheekSquintRight",
    "eyeBlinkLeft",
    "eyeBlinkRight",
    "eyeLookDownLeft",
    "eyeLookDownRight",
    "eyeLookInLeft",
    "eyeLookInRight",
    "eyeLookOutLeft",
    "eyeLookOutRight",
    "eyeLookUpLeft",
    "eyeLookUpRight",
    "eyeSquintLeft",
    "eyeSquintRight",
    "eyeWideLeft",
    "eyeWideRight",
    "jawForward",
    "jawLeft",
    "jawOpen",
    "jawRight",
    "mouthClose",
    "mouthDimpleLeft",
    "mouthDimpleRight",
    "mouthFrownLeft",
    "mouthFrownRight",
    "mouthFunnel",
    "mouthLeft",
    "mouthLowerDownLeft",
    "mouthLowerDownRight",
    "mouthPressLeft",
    "mouthPressRight",
    "mouthPucker",
    "mouthRight",
    "mouthRollLower",
    "mouthRollUpper",
    "mouthShrugLower",
    "mouthShrugUpper",
    "mouthSmileLeft",
    "mouthSmileRight",
    "mouthStretchLeft",
    "mouthStretchRight",
    "mouthUpperUpLeft",
    "mouthUpperUpRight",
    "noseSneerLeft",
    "noseSneerRight",
    "tongueOut"
  ];
  var clamp3 = (v) => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));
  var auChannels = {
    au01InnerBrowRaiser: ["browInnerUp"],
    au02OuterBrowRaiser: ["browOuterUpLeft", "browOuterUpRight"],
    au04BrowLowerer: ["browDownLeft", "browDownRight"],
    au05UpperLidRaiser: ["eyeWideLeft", "eyeWideRight"],
    au06CheekRaiser: ["cheekSquintLeft", "cheekSquintRight"],
    au07LidTightener: ["eyeSquintLeft", "eyeSquintRight"],
    au09NoseWrinkler: ["noseSneerLeft", "noseSneerRight"],
    au10UpperLipRaiser: ["mouthShrugUpper"],
    au12LipCornerPuller: ["mouthSmileLeft", "mouthSmileRight"],
    au14Dimpler: ["mouthDimpleLeft", "mouthDimpleRight"],
    au15LipCornerDepressor: ["mouthFrownLeft", "mouthFrownRight"],
    au17ChinRaiser: ["mouthShrugLower"],
    au18LipPucker: ["mouthPucker"],
    au20LipStretcher: ["mouthStretchLeft", "mouthStretchRight"],
    au23LipTightener: ["mouthPressLeft", "mouthPressRight"],
    au24LipPressor: ["mouthPressLeft", "mouthPressRight"],
    au25LipsPart: ["jawOpen"],
    au26JawDrop: ["jawOpen"],
    au27MouthStretch: ["jawOpen"],
    au45Blink: ["eyeBlinkLeft", "eyeBlinkRight"]
  };
  function ausToARKit(au) {
    const result = Object.fromEntries(arkitKeys.map((key) => [key, 0]));
    for (const [key, channels] of Object.entries(auChannels)) for (const channel of channels) result[channel] = Math.max(result[channel], clamp3(au[key]));
    result.jawOpen = clamp3(au.au25LipsPart * 0.2 + au.au26JawDrop * 0.75 + au.au27MouthStretch);
    result.mouthPressLeft = result.mouthPressRight = clamp3(Math.max(au.au24LipPressor, au.au23LipTightener * 0.7));
    const x = Math.max(-1, Math.min(1, au.gazeX)), y = Math.max(-1, Math.min(1, au.gazeY));
    result.eyeLookOutLeft = result.eyeLookInRight = Math.max(0, x);
    result.eyeLookOutRight = result.eyeLookInLeft = Math.max(0, -x);
    result.eyeLookUpLeft = result.eyeLookUpRight = Math.max(0, y);
    result.eyeLookDownLeft = result.eyeLookDownRight = Math.max(0, -y);
    return result;
  }
  function arkitToAUs(state) {
    const au = createDefaultActionUnitState();
    for (const [key, channels] of Object.entries(auChannels)) au[key] = Math.max(...channels.map((channel) => state[channel]));
    au.au25LipsPart = state.jawOpen * 0.35;
    au.au26JawDrop = state.jawOpen;
    au.au27MouthStretch = state.jawOpen * 0.25;
    au.au23LipTightener = 0;
    au.gazeX = Math.max(state.eyeLookOutLeft, state.eyeLookInRight) - Math.max(state.eyeLookOutRight, state.eyeLookInLeft);
    au.gazeY = Math.max(state.eyeLookUpLeft, state.eyeLookUpRight) - Math.max(state.eyeLookDownLeft, state.eyeLookDownRight);
    return au;
  }
  function normalizeARKit(input) {
    const result = Object.fromEntries(arkitKeys.map((key) => [key, 0]));
    const allowed = new Set(arkitKeys);
    for (const [name, value] of Object.entries(input)) {
      if (name === "_neutral") continue;
      if (!allowed.has(name)) throw new Error(`\u672A\u77E5 ARKit \u901A\u9053\uFF1A${name}`);
      if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${name} \u5FC5\u987B\u662F\u6709\u9650\u6570\u503C`);
      result[name] = clamp3(value);
    }
    return result;
  }
  function directShapeChannel(name) {
    if (arkitKeys.includes(name)) return name;
    const normalized = name.replace(/_L$/, "Left").replace(/_R$/, "Right");
    if (normalized === "browInnerUpLeft" || normalized === "browInnerUpRight") return "browInnerUp";
    if (normalized === "cheekPuffLeft" || normalized === "cheekPuffRight") return "cheekPuff";
    return arkitKeys.includes(normalized) ? normalized : null;
  }

  // src/motion.ts
  var bound = (n, lo, hi, fallback) => Math.min(hi, Math.max(lo, Number.isFinite(n) ? n : fallback));
  function emotionMotionFactors(vad) {
    const a = bound(vad.arousal, -1, 1, 0), d = bound(vad.dominance, -1, 1, 0);
    const strength = Math.min(1, Math.hypot(vad.valence, a, d) / Math.sqrt(3));
    return { amplitude: bound(1 + 0.3 * a + 0.15 * d + 0.1 * strength, 0.45, 1.55, 1), speed: bound(1 + 0.25 * a + 0.1 * d, 0.5, 1.5, 1) };
  }
  function resolveAction(name, options, settings, vad) {
    if (!["nod", "shake", "blink"].includes(name)) throw new Error(`Unknown action: ${name}`);
    const linked = options.emotion ?? settings.emotionMotion;
    const factors = linked ? emotionMotionFactors(vad) : { amplitude: 1, speed: 1 };
    const amplitude = bound(options.amplitude ?? (name === "blink" && linked ? 1 : settings.motionAmplitude) * factors.amplitude, 0, 1, 0);
    const speed = bound(options.speed ?? (options.duration !== void 0 ? 1 : settings.motionSpeed * factors.speed), 0.25, 3, 1);
    const duration = bound(options.duration ?? (name === "blink" ? 0.23 : settings.motionDuration), name === "blink" ? 0.08 : 0.25, 8, 1.1);
    const cycleDuration = bound(duration / speed, name === "blink" ? 0.06 : 0.15, 12, 1.1);
    const repetitions = Math.round(bound(options.repetitions ?? settings.motionRepetitions, 1, 6, 1));
    return { name, amplitude, cycleDuration, repetitions, totalDuration: cycleDuration * repetitions, emotionLinked: linked && (options.amplitude === void 0 || options.duration === void 0 && options.speed === void 0) };
  }
  function damp(value, velocity, target, seconds, dt) {
    const omega = 4.75 / Math.max(0.04, seconds), offset = value - target;
    const c = velocity + omega * offset, e = Math.exp(-omega * dt);
    return { value: target + (offset + c * dt) * e, velocity: (velocity - omega * c * dt) * e };
  }
  function ease(t) {
    return t * t * t * (10 + t * (-15 + t * 6));
  }
  function easeDerivative(t) {
    return 30 * t * t * (1 - t) * (1 - t);
  }
  function wave(name, phase) {
    const points = name === "shake" ? [[0, 0], [0.25, -1], [0.75, 1], [1, 0]] : [[0, 0], [name === "blink" ? 0.4 : 0.5, 1], [1, 0]];
    for (let i = 1; i < points.length; i++) {
      const [left, from] = points[i - 1], [right, to] = points[i];
      if (phase <= right) {
        const t = bound((phase - left) / (right - left), 0, 1, 0);
        return { value: from + (to - from) * ease(t), velocity: (to - from) * easeDerivative(t) / (right - left) };
      }
    }
    return { value: 0, velocity: 0 };
  }
  var MotionTimeline = class {
    constructor() {
      __publicField(this, "clips", /* @__PURE__ */ new Map());
    }
    sampleClip(clip, now) {
      const elapsed = Math.max(0, now - clip.start), { resolved } = clip;
      let value = 0, velocity = 0;
      if (!clip.stop && elapsed < resolved.totalDuration) {
        const phase = elapsed / resolved.cycleDuration % 1, w = wave(resolved.name, phase);
        value = w.value * resolved.amplitude;
        velocity = w.velocity * resolved.amplitude / resolved.cycleDuration;
      }
      if (elapsed < clip.blend) {
        const t = elapsed / clip.blend;
        value += (2 * t ** 3 - 3 * t ** 2 + 1) * clip.from + (t ** 3 - 2 * t ** 2 + t) * clip.blend * clip.velocity;
        velocity += (6 * t ** 2 - 6 * t) * clip.from / clip.blend + (3 * t ** 2 - 4 * t + 1) * clip.velocity;
      }
      const limited = bound(value, resolved.name === "blink" ? 0 : -1, 1, 0);
      return { value: limited, velocity: limited === value ? velocity : 0 };
    }
    play(resolved, now) {
      const previous = this.clips.get(resolved.name);
      const from = previous ? this.sampleClip(previous, now) : { value: 0, velocity: 0 };
      this.clips.set(resolved.name, { resolved, start: now, from: from.value, velocity: from.velocity, blend: Math.min(0.25, resolved.cycleDuration * 0.35) });
      return { ...resolved };
    }
    stop(now) {
      for (const [name, clip] of this.clips) {
        const from = this.sampleClip(clip, now);
        this.clips.set(name, { resolved: { ...clip.resolved, amplitude: 0, totalDuration: 0.25 }, start: now, from: from.value, velocity: from.velocity, blend: 0.25, stop: true });
      }
    }
    reset() {
      this.clips.clear();
    }
    clear(name) {
      this.clips.delete(name);
    }
    sample(now) {
      const state = [];
      for (const [name, clip] of this.clips) {
        const duration = Math.max(clip.resolved.totalDuration, clip.blend);
        if (now - clip.start >= duration - 1e-9) {
          this.clips.delete(name);
          continue;
        }
        state.push({ ...clip.resolved, progress: bound((now - clip.start) / duration, 0, 1, 0), ...this.sampleClip(clip, now) });
      }
      return state;
    }
  };

  // src/directions.ts
  var headLimits = { yaw: 60, pitch: 40, roll: 45 };
  var eyeLimits = { yaw: 30, pitch: 25 };
  var legacyHeadScale = { pitch: 0.25 * 180 / Math.PI, yaw: 0.32 * 180 / Math.PI, roll: 0.21 * 180 / Math.PI };
  var directionGrid = [
    { name: "up-left", label: "\u5DE6\u4E0A", arrow: "\u2196", x: 1, y: 1 },
    { name: "up", label: "\u4E0A", arrow: "\u2191", x: 0, y: 1 },
    { name: "up-right", label: "\u53F3\u4E0A", arrow: "\u2197", x: -1, y: 1 },
    { name: "left", label: "\u5DE6", arrow: "\u2190", x: 1, y: 0 },
    { name: "center", label: "\u56DE\u6B63", arrow: "\u2022", x: 0, y: 0 },
    { name: "right", label: "\u53F3", arrow: "\u2192", x: -1, y: 0 },
    { name: "down-left", label: "\u5DE6\u4E0B", arrow: "\u2199", x: 1, y: -1 },
    { name: "down", label: "\u4E0B", arrow: "\u2193", x: 0, y: -1 },
    { name: "down-right", label: "\u53F3\u4E0B", arrow: "\u2198", x: -1, y: -1 }
  ];
  function directionAngles(direction, degrees) {
    const entry = directionGrid.find((d) => d.name === direction);
    if (!entry) throw new Error(`Unknown direction: ${direction}`);
    if (!Number.isFinite(degrees) || degrees < 0) throw new Error("\u65B9\u5411\u89D2\u5EA6\u5FC5\u987B\u662F\u975E\u8D1F\u6709\u9650\u6570\u503C");
    return { yaw: entry.x * degrees, pitch: entry.y * degrees };
  }
  function poseToDegrees(pose) {
    return { yaw: pose.y * legacyHeadScale.yaw || 0, pitch: pose.x * legacyHeadScale.pitch || 0, roll: -pose.z * legacyHeadScale.roll || 0 };
  }
  function gazeToDegrees(gaze) {
    return { yaw: gaze.x * eyeLimits.yaw, pitch: gaze.y * eyeLimits.pitch };
  }

  // src/engine.ts
  var clamp4 = (n, min = 0, max = 1) => Math.min(max, Math.max(min, Number.isFinite(n) ? n : 0));
  var defaultSettings = { halfLife: 8, hold: 8, approach: 2.4, gain: 1.4, detailMix: 0.65, browGain: 1, eyeGain: 1, mouthGain: 1, autoDecay: true, autoBlink: true, idle: true, ambient: false, speed: 1, emotionMotion: true, motionAmplitude: 0.65, motionDuration: 1.1, motionSpeed: 1, motionRepetitions: 1, faceSmoothing: 0.28, gazeResponse: 0.22, gazeHold: 3 };
  var FaceEngine = class {
    constructor(settings = {}) {
      __publicField(this, "settings", { ...defaultSettings });
      __publicField(this, "controller", new EmotionStateController());
      __publicField(this, "mapper", new DetailedVADMapper());
      __publicField(this, "details", { blend: [], dominant: "neutral", eyelidRelaxation: 0, regions: { brow: 0, eyes: 0, mouth: 0 }, sourceStrength: 0 });
      __publicField(this, "intent");
      __publicField(this, "au", createDefaultActionUnitState());
      __publicField(this, "auVelocity", createDefaultActionUnitState());
      __publicField(this, "eyelidVelocity", 0);
      __publicField(this, "accumulator", 0);
      __publicField(this, "clock", 0);
      __publicField(this, "manual", {});
      __publicField(this, "incoming", null);
      __publicField(this, "incomingAUs", {});
      __publicField(this, "lockedTarget", null);
      __publicField(this, "nextBlink", 3.2);
      __publicField(this, "motions", new MotionTimeline());
      __publicField(this, "gaze", { x: 0, y: 0 });
      __publicField(this, "gazePrecision", false);
      __publicField(this, "gazeCurrent", { x: 0, y: 0 });
      __publicField(this, "gazeVelocity", { x: 0, y: 0 });
      __publicField(this, "gazePulse", null);
      __publicField(this, "pose", { x: 0, y: 0, z: 0 });
      __publicField(this, "poseCurrent", { x: 0, y: 0, z: 0 });
      __publicField(this, "poseVelocity", { x: 0, y: 0, z: 0 });
      __publicField(this, "headPrecision", false);
      __publicField(this, "headFollow", 1);
      __publicField(this, "headFollowVelocity", 0);
      __publicField(this, "latest");
      this.configure(settings);
      this.latest = this.controller.update(0);
    }
    configure(patch) {
      this.settings = { ...this.settings, ...patch };
      this.settings.halfLife = clamp4(this.settings.halfLife, 1.74, 300);
      this.settings.hold = clamp4(this.settings.hold, 0, 90);
      this.settings.approach = clamp4(this.settings.approach, 0.2, 4);
      this.settings.gain = clamp4(this.settings.gain, 0, 4);
      this.settings.detailMix = clamp4(this.settings.detailMix);
      for (const key of ["browGain", "eyeGain", "mouthGain"]) this.settings[key] = clamp4(this.settings[key], 0, 2);
      this.settings.speed = clamp4(this.settings.speed, 0.1, 8);
      this.settings.motionAmplitude = clamp4(this.settings.motionAmplitude);
      this.settings.motionDuration = clamp4(this.settings.motionDuration, 0.25, 8);
      this.settings.motionSpeed = clamp4(this.settings.motionSpeed, 0.25, 3);
      this.settings.motionRepetitions = Math.round(clamp4(this.settings.motionRepetitions, 1, 6));
      this.settings.faceSmoothing = clamp4(this.settings.faceSmoothing, 0.08, 1.5);
      this.settings.gazeResponse = clamp4(this.settings.gazeResponse, 0.08, 1.5);
      this.settings.gazeHold = clamp4(this.settings.gazeHold, 0.2, 10);
      this.controller.configure({ decayRate: Math.LN2 / this.settings.halfLife, emotionHoldSeconds: this.settings.hold, targetApproachRate: this.settings.approach, ambientDriftStrength: this.settings.ambient ? 0.034 : 0 });
      if (patch.autoDecay === false && this.latest) this.lockedTarget = { ...this.latest.target };
    }
    triggerEmotion(emotion, intensity = 1) {
      const preset = emotionByName.get(emotion === "angry" ? "anger" : emotion);
      if (!preset) throw new Error(`Unknown emotion: ${emotion}`);
      const strength = clamp4(intensity);
      if (strength === 0) return { ...preset.vad };
      this.incoming = null;
      this.incomingAUs = {};
      this.controller.nudge({ emotion: preset.name, naturalVAD: preset.vad, intensity: strength, contextTags: [] });
      this.intent = { name: preset.name, strength };
      this.latest = this.controller.update(0);
      this.lockedTarget = { ...this.latest.target };
      return { ...preset.vad };
    }
    setVAD(vad) {
      this.incoming = null;
      this.incomingAUs = {};
      const next = { ...this.latest.target };
      for (const key of ["valence", "arousal", "dominance"]) {
        if (vad[key] !== void 0) next[key] = clamp4(vad[key], -1, 1);
      }
      this.controller.blendTo(next, 1);
      this.intent = void 0;
      this.lockedTarget = next;
      this.latest = this.controller.update(0);
    }
    /** Semantic impact controls movement toward the target; confidence never becomes facial gain. */
    applySemanticEmotion(vad, impact, emotion) {
      if (!Number.isFinite(impact)) throw new Error("\u60C5\u7EEA\u5F71\u54CD\u5F3A\u5EA6\u5FC5\u987B\u662F\u6709\u9650\u6570\u503C");
      const strength = clamp4(impact);
      if (strength === 0) return false;
      const next = { ...this.latest.target };
      for (const key of ["valence", "arousal", "dominance"]) {
        const n = vad[key];
        if (n !== void 0) {
          if (!Number.isFinite(n)) throw new Error("\u8BED\u4E49 VAD \u5FC5\u987B\u662F\u6709\u9650\u6570\u503C");
          next[key] = clamp4(n, -1, 1);
        }
      }
      this.incoming = null;
      this.incomingAUs = {};
      this.controller.blendTo(next, strength);
      const style = emotion && emotion !== "neutral" ? emotionByName.get(emotion) : void 0;
      this.intent = style ? { name: style.name, strength } : void 0;
      this.latest = this.controller.update(0);
      this.lockedTarget = { ...this.latest.target };
      return true;
    }
    setAU(key, value) {
      const definition = actionUnitDefinitions.find((d) => d.key === key);
      if (!definition) throw new Error(`Unknown AU: ${key}`);
      if (key === "au45Blink" && value !== null && !this.isPinned(key) && !this.incoming) {
        const blink = this.motions.sample(this.clock).find((a) => a.name === "blink");
        if (blink && blink.value > this.au.au45Blink) {
          this.au.au45Blink = blink.value;
          this.auVelocity.au45Blink = blink.velocity;
        }
        this.motions.clear("blink");
      }
      if (value === null) delete this.manual[key];
      else this.manual[key] = clamp4(value, definition.min, definition.max);
    }
    isPinned(key) {
      return this.manual[key] !== void 0;
    }
    clearAU() {
      this.manual = {};
      this.incoming = null;
      this.incomingAUs = {};
    }
    setBlendshapes(state) {
      this.incoming = state ? normalizeARKit(state) : null;
      this.incomingAUs = this.incoming ? arkitToAUs(this.incoming) : {};
    }
    setGaze(x, y) {
      this.gazePulse = null;
      this.gazePrecision = true;
      this.gaze = { x: clamp4(x, -1, 1), y: clamp4(y, -1, 1) };
    }
    setGazeDegrees(angles) {
      this.setGaze(angles.yaw === void 0 ? this.gaze.x : clamp4(angles.yaw, -eyeLimits.yaw, eyeLimits.yaw) / eyeLimits.yaw, angles.pitch === void 0 ? this.gaze.y : clamp4(angles.pitch, -eyeLimits.pitch, eyeLimits.pitch) / eyeLimits.pitch);
      return gazeToDegrees(this.gaze);
    }
    gazeDirection(direction, degrees = 15) {
      return this.setGazeDegrees(directionAngles(direction, degrees));
    }
    glanceDegrees(angles, seconds = this.settings.gazeHold, response = this.settings.gazeResponse) {
      this.glance(clamp4(angles.yaw, -eyeLimits.yaw, eyeLimits.yaw) / eyeLimits.yaw, clamp4(angles.pitch, -eyeLimits.pitch, eyeLimits.pitch) / eyeLimits.pitch, seconds, { amplitude: 1, emotion: false, response });
    }
    releaseGazeControl() {
      this.gazePulse = null;
      this.gaze = { x: 0, y: 0 };
      this.gazePrecision = false;
    }
    glance(x, y, seconds = this.settings.gazeHold, options = {}) {
      const linked = options.emotion ?? this.settings.emotionMotion;
      const factors = linked ? emotionMotionFactors(this.latest.target) : { amplitude: 1, speed: 1 };
      const amplitude = clamp4(options.amplitude ?? this.settings.motionAmplitude * factors.amplitude);
      const response = clamp4(options.response ?? this.settings.gazeResponse / factors.speed, 0.08, 1.5);
      this.gazePulse = { x: clamp4(x, -1, 1) * amplitude, y: clamp4(y, -1, 1) * amplitude, until: this.clock + clamp4(seconds, 0.2, 10), response };
    }
    setPose(x, y, z) {
      this.setHeadAngles(poseToDegrees({ x: clamp4(x, -1, 1), y: clamp4(y, -1, 1), z: clamp4(z, -1, 1) }));
    }
    setHeadAngles(angles) {
      const actions = this.motions.sample(this.clock);
      if (!this.headPrecision || actions.some((a) => a.name === "nod" || a.name === "shake")) {
        this.poseCurrent = { ...this.snapshot().pose };
        this.poseVelocity.x -= actions.find((a) => a.name === "nod")?.velocity ?? 0;
        this.poseVelocity.y += actions.find((a) => a.name === "shake")?.velocity ?? 0;
        if (!this.headPrecision) {
          this.poseVelocity.x += this.auVelocity.headY * this.headFollow + (this.settings.idle ? Math.cos(this.clock * 0.79) * 0.045 * 0.79 * this.headFollow : 0);
          this.poseVelocity.y += this.auVelocity.headX * this.headFollow + (this.settings.idle ? Math.cos(this.clock * 0.49) * 0.06 * 0.49 * this.headFollow : 0);
          this.poseVelocity.z += this.auVelocity.headZ * this.headFollow + (this.settings.idle ? Math.cos(this.clock * 0.67) * 0.055 * 0.67 * this.headFollow : 0);
        }
      }
      this.motions.clear("nod");
      this.motions.clear("shake");
      this.headPrecision = true;
      this.headFollow = 0;
      this.headFollowVelocity = 0;
      if (angles.pitch !== void 0) this.pose.x = clamp4(angles.pitch, -headLimits.pitch, headLimits.pitch) / legacyHeadScale.pitch;
      if (angles.yaw !== void 0) this.pose.y = clamp4(angles.yaw, -headLimits.yaw, headLimits.yaw) / legacyHeadScale.yaw;
      if (angles.roll !== void 0) this.pose.z = -clamp4(angles.roll, -headLimits.roll, headLimits.roll) / legacyHeadScale.roll;
      return poseToDegrees(this.pose);
    }
    headDirection(direction, degrees = 20) {
      return this.setHeadAngles({ ...directionAngles(direction, degrees), roll: 0 });
    }
    releaseHeadControl() {
      this.headPrecision = false;
      this.pose = { x: 0, y: 0, z: 0 };
    }
    playAction(name, options = {}) {
      return this.motions.play(resolveAction(name, options, this.settings, this.latest.target), this.clock);
    }
    stopActions() {
      this.motions.stop(this.clock);
      this.gazePulse = null;
    }
    reset() {
      this.controller.reset();
      this.latest = this.controller.update(0);
      this.clearAU();
      this.lockedTarget = null;
      this.au = createDefaultActionUnitState();
      this.auVelocity = createDefaultActionUnitState();
      this.clock = 0;
      this.accumulator = 0;
      this.nextBlink = 3.2;
      this.motions.reset();
      this.gaze = { x: 0, y: 0 };
      this.gazeCurrent = { x: 0, y: 0 };
      this.gazeVelocity = { x: 0, y: 0 };
      this.gazePulse = null;
      this.pose = { x: 0, y: 0, z: 0 };
      this.poseCurrent = { x: 0, y: 0, z: 0 };
      this.poseVelocity = { x: 0, y: 0, z: 0 };
      this.headPrecision = false;
      this.gazePrecision = false;
      this.headFollow = 1;
      this.headFollowVelocity = 0;
      this.intent = void 0;
      this.eyelidVelocity = 0;
      this.details = { blend: [], dominant: "neutral", eyelidRelaxation: 0, regions: { brow: 0, eyes: 0, mouth: 0 }, sourceStrength: 0 };
    }
    /** Fixed 120 Hz avoids hold-boundary and decay differences between render rates. */
    update(deltaSeconds) {
      if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) return this.snapshot();
      this.accumulator += Math.min(deltaSeconds, 1) * this.settings.speed;
      const step = 1 / 120;
      while (this.accumulator + 1e-10 >= step) {
        this.accumulator -= step;
        this.clock += step;
        if (!this.settings.autoDecay && this.lockedTarget) this.controller.blendTo(this.lockedTarget, 1);
        this.latest = this.controller.update(step);
        if (this.intent && this.settings.autoDecay && (this.latest.holdSeconds ?? 0) <= 0) this.intent.strength *= Math.exp(-step * Math.LN2 / this.settings.halfLife);
        const mapped = this.mapper.map(this.latest.current, this.settings, this.intent);
        const target = mapped.aus;
        const eyelid = damp(this.details.eyelidRelaxation, this.eyelidVelocity, mapped.details.eyelidRelaxation, this.settings.faceSmoothing * 0.72, step);
        this.details = { ...mapped.details, eyelidRelaxation: clamp4(eyelid.value, 0, 0.3) };
        this.eyelidVelocity = eyelid.value === this.details.eyelidRelaxation ? eyelid.velocity : 0;
        for (const d of actionUnitDefinitions) {
          const value = this.manual[d.key] ?? this.incomingAUs[d.key] ?? target[d.key] ?? 0;
          const response = this.settings.faceSmoothing * (d.group === "brow" ? 1.15 : d.group === "eye" ? 0.72 : 0.9);
          const next = damp(this.au[d.key], this.auVelocity[d.key], value, response, step);
          this.au[d.key] = clamp4(next.value, d.min, d.max);
          this.auVelocity[d.key] = next.value === this.au[d.key] ? next.velocity : 0;
        }
        if (this.gazePulse && this.clock >= this.gazePulse.until) this.gazePulse = null;
        const gazeTarget = this.gazePulse ?? this.gaze;
        for (const axis of ["x", "y"]) {
          const emotionOffset = this.gazePulse || this.gazePrecision ? 0 : this.au[axis === "x" ? "gazeX" : "gazeY"];
          const next = damp(this.gazeCurrent[axis], this.gazeVelocity[axis], clamp4(gazeTarget[axis] + emotionOffset, -1, 1), this.gazePulse?.response ?? this.settings.gazeResponse, step);
          this.gazeCurrent[axis] = clamp4(next.value, -1, 1);
          this.gazeVelocity[axis] = this.gazeCurrent[axis] === next.value ? next.velocity : 0;
        }
        for (const axis of ["x", "y", "z"]) {
          const next = damp(this.poseCurrent[axis], this.poseVelocity[axis], this.pose[axis], this.settings.faceSmoothing, step);
          const limit = axis === "x" ? headLimits.pitch / legacyHeadScale.pitch : axis === "y" ? headLimits.yaw / legacyHeadScale.yaw : headLimits.roll / legacyHeadScale.roll;
          this.poseCurrent[axis] = clamp4(next.value, -limit, limit);
          this.poseVelocity[axis] = this.poseCurrent[axis] === next.value ? next.velocity : 0;
        }
        const follow = damp(this.headFollow, this.headFollowVelocity, this.headPrecision ? 0 : 1, this.settings.faceSmoothing, step);
        this.headFollow = clamp4(follow.value);
        this.headFollowVelocity = follow.velocity;
        if (this.settings.autoBlink && this.clock >= this.nextBlink) {
          if (!this.isPinned("au45Blink") && !this.incoming && !this.motions.sample(this.clock).some((a) => a.name === "blink")) this.playAction("blink", { amplitude: 1, duration: 0.23, repetitions: 1, emotion: false });
          this.nextBlink = this.clock + 3.5 + Math.sin(this.clock * 1.79) * 0.95;
        }
      }
      return this.snapshot();
    }
    snapshot() {
      const gaze = this.gazeCurrent;
      const actions = this.motions.sample(this.clock);
      const blink = actions.find((a) => a.name === "blink")?.value ?? 0;
      const au = { ...this.au };
      if (!this.isPinned("au45Blink") && !this.incoming) au.au45Blink = Math.max(au.au45Blink, blink);
      const generated = ausToARKit(au);
      const blendshapes = this.incoming ? { ...this.incoming } : generated;
      if (this.incoming) for (const key of Object.keys(this.manual)) for (const channel of auChannels[key] ?? []) blendshapes[channel] = generated[channel];
      const pose = { ...this.poseCurrent };
      pose.x -= actions.find((a) => a.name === "nod")?.value ?? 0;
      pose.y += actions.find((a) => a.name === "shake")?.value ?? 0;
      if (this.settings.idle) {
        pose.x += Math.sin(this.clock * 0.79) * 0.045 * this.headFollow;
        pose.y += Math.sin(this.clock * 0.49) * 0.06 * this.headFollow;
        pose.z += Math.sin(this.clock * 0.67) * 0.055 * this.headFollow;
      }
      const finalPose = { x: clamp4(pose.x + au.headY * this.headFollow, -headLimits.pitch / legacyHeadScale.pitch, headLimits.pitch / legacyHeadScale.pitch), y: clamp4(pose.y + au.headX * this.headFollow, -headLimits.yaw / legacyHeadScale.yaw, headLimits.yaw / legacyHeadScale.yaw), z: clamp4(pose.z + au.headZ * this.headFollow, -headLimits.roll / legacyHeadScale.roll, headLimits.roll / legacyHeadScale.roll) };
      const finalGaze = { x: clamp4(gaze.x, -1, 1), y: clamp4(gaze.y, -1, 1) };
      return { time: this.clock, vad: { ...this.latest, dominantEmotion: this.details.dominant, current: { ...this.latest.current }, target: { ...this.latest.target }, ambient: { ...this.latest.ambient } }, aus: au, blink, gaze: finalGaze, pose: finalPose, details: structuredClone(this.details), blendshapes, source: this.incoming ? "arkit52" : "emotion", settings: { ...this.settings }, pinnedAUs: Object.keys(this.manual), motion: { actions, gazeTarget: { x: (this.gazePulse ?? this.gaze).x, y: (this.gazePulse ?? this.gaze).y }, emotionLinked: this.settings.emotionMotion }, angles: { head: poseToDegrees(finalPose), eyes: gazeToDegrees(finalGaze), headTarget: poseToDegrees(this.pose), eyeTarget: gazeToDegrees(this.gazePulse ?? this.gaze), headManual: this.headPrecision, eyesManual: this.gazePrecision || Boolean(this.gazePulse) } };
    }
  };

  // src/model-utils.ts
  function canonicalMorphName(name) {
    const match = name.match(/Fcl_(.+)$/i);
    if (!match) return name;
    const [region, ...rest] = match[1].split("_");
    return `Fcl_${region.toUpperCase()}_${rest.join("_")}`;
  }

  // src/profile.ts
  var vr = (suffix) => [`Fcl_${suffix}`, `Face.M_F00_000_Fcl_${suffix}`];
  var b = (au, label, targets, kind = "proxy") => ({ au, label, targets, kind });
  var vroidProfile = { schema: 1, name: "VRoid \xB7 Anime AU Profile", bindings: [
    b("au01InnerBrowRaiser", "\u5185\u7709\u4E0A\u63D0", [{ names: ["browInnerUp", ...vr("BRW_Sorrow")], weight: 1 }]),
    b("au02OuterBrowRaiser", "\u5916\u7709\u4E0A\u63D0", [{ names: ["browOuterUpLeft", ...vr("BRW_Surprised")], weight: 1 }]),
    b("au04BrowLowerer", "\u7709\u6BDB\u4E0B\u538B", [{ names: ["browDownLeft", ...vr("BRW_Angry")], weight: 1 }]),
    b("au05UpperLidRaiser", "\u7741\u5927\u773C\u775B", [{ names: ["eyeWideLeft", ...vr("EYE_Surprised")], weight: 1 }]),
    b("au06CheekRaiser", "\u7B11\u773C / \u8138\u988A\u4E0A\u63D0", [{ names: ["cheekSquintLeft", ...vr("EYE_Joy")], weight: 1 }]),
    b("au07LidTightener", "\u773C\u7751\u6536\u7D27", [{ names: ["eyeSquintLeft", ...vr("EYE_Angry")], weight: 1 }]),
    b("au09NoseWrinkler", "\u9F3B\u90E8\u76B1\u7F29", [{ names: ["noseSneerLeft"], weight: 1 }], "direct"),
    b("au10UpperLipRaiser", "\u4E0A\u5507\u4E0A\u63D0", [{ names: ["mouthShrugUpper"], weight: 1 }], "direct"),
    b("au12LipCornerPuller", "\u5634\u89D2\u4E0A\u626C", [{ names: ["mouthSmileLeft", ...vr("MTH_Fun")], weight: 1 }]),
    b("au14Dimpler", "\u9152\u7A9D / \u5634\u89D2\u6536\u7D27", [{ names: ["mouthDimpleLeft", ...vr("MTH_Joy")], weight: 0.28 }]),
    b("au15LipCornerDepressor", "\u5634\u89D2\u4E0B\u5782", [{ names: ["mouthFrownLeft", ...vr("MTH_Sorrow")], weight: 1 }]),
    b("au17ChinRaiser", "\u4E0B\u5DF4\u4E0A\u63D0", [{ names: ["mouthShrugLower"], weight: 1 }], "direct"),
    b("au18LipPucker", "\u561F\u5634", [{ names: ["mouthPucker", ...vr("MTH_U")], weight: 0.8 }]),
    b("au20LipStretcher", "\u5634\u5507\u6A2A\u5411\u62C9\u4F38", [{ names: ["mouthStretchLeft", ...vr("MTH_I")], weight: 0.65 }]),
    b("au23LipTightener", "\u5634\u5507\u7EF7\u7D27", [{ names: ["mouthPressLeft", ...vr("MTH_Angry")], weight: 1 }]),
    b("au24LipPressor", "\u5634\u5507\u538B\u7D27", [{ names: ["mouthPressLeft", ...vr("MTH_Close")], weight: 0.8 }]),
    b("au25LipsPart", "\u5634\u5507\u5206\u5F00", [{ names: ["mouthOpen", ...vr("MTH_A")], weight: 0.45 }]),
    b("au26JawDrop", "\u4E0B\u988C\u5F20\u5F00", [{ names: ["jawOpen", ...vr("MTH_A")], weight: 0.9 }]),
    b("au27MouthStretch", "\u5634\u5DF4\u5927\u5F20", [{ names: ["mouthOpen", ...vr("MTH_Surprised")], weight: 0.8 }]),
    b("au45Blink", "\u53CC\u773C\u7728\u773C", [{ names: ["eyeBlinkLeft", ...vr("EYE_Close")], weight: 1 }], "direct")
  ] };
  function resolveProfile(profile, available) {
    const names = new Set(available);
    const canonical = new Map([...names].map((name) => [canonicalMorphName(name), name]));
    return profile.bindings.map((binding) => {
      const resolved = [];
      for (const t of binding.targets) {
        const found = t.names.map((n) => names.has(n) ? n : canonical.get(canonicalMorphName(n)) ?? [...names].find((a) => directShapeChannel(n) !== null && directShapeChannel(a) === directShapeChannel(n))).find((n) => !!n);
        if (found) {
          resolved.push({ name: found, weight: t.weight });
          const right = found.endsWith("Left") ? found.replace(/Left$/, "Right") : found.endsWith("_L") ? found.replace(/_L$/, "_R") : null;
          if (right && names.has(right)) resolved.push({ name: right, weight: t.weight });
        }
      }
      return { ...binding, resolved, supported: resolved.length > 0 };
    });
  }
  function computeMorphWeights(aus, bindings, gains = {}, options = {}) {
    const result = {};
    for (const binding of bindings) for (const target of binding.resolved) {
      result[target.name] = (result[target.name] ?? 0) + clamp4(aus[binding.au]) * target.weight * clamp4(gains[binding.au] ?? 1, 0, 3);
    }
    const contrast = clamp4(options.contrast ?? 0, 0, 2);
    const pinned = options.pinned ?? /* @__PURE__ */ new Set();
    const sharpen = (predicate, protectedAUs) => {
      if (!contrast || protectedAUs.some((key) => pinned.has(key))) return;
      const group = Object.keys(result).filter(predicate), peak = Math.max(0, ...group.map((key) => result[key]));
      if (peak > 0) for (const key of group) result[key] *= (result[key] / peak) ** contrast;
    };
    sharpen((n) => /Fcl_BRW_/.test(n), ["au01InnerBrowRaiser", "au02OuterBrowRaiser", "au04BrowLowerer"]);
    sharpen((n) => /Fcl_EYE_/.test(n) && !/Close/.test(n), ["au05UpperLidRaiser", "au06CheekRaiser", "au07LidTightener"]);
    const mouthAUs = bindings.filter((b3) => /au(09|10|12|14|15|17|18|20|23|24|25|26|27)/.test(b3.au)).map((b3) => b3.au);
    if (contrast && !mouthAUs.some((key) => pinned.has(key))) {
      const expression = Math.max(aus.au12LipCornerPuller, aus.au15LipCornerDepressor, aus.au18LipPucker, aus.au20LipStretcher, aus.au23LipTightener, aus.au26JawDrop, aus.au27MouthStretch);
      for (const key of Object.keys(result)) if (/Fcl_MTH_Close(?:$|[_.])/.test(key)) result[key] *= 1 - clamp4(expression) * clamp4(contrast / 1.5);
      sharpen((n) => /Fcl_MTH_/.test(n) && !/Close/.test(n), mouthAUs);
    }
    const normalize = (predicate, budget) => {
      const group = Object.keys(result).filter(predicate);
      const sum = group.reduce((s, key) => s + result[key], 0);
      if (sum > budget) for (const key of group) result[key] *= budget / sum;
    };
    normalize((n) => /Fcl_BRW_/.test(n), 1);
    normalize((n) => /Fcl_EYE_/.test(n) && !/Close/.test(n), 1);
    normalize((n) => /Fcl_MTH_/.test(n), 1.1);
    const blink = Math.max(aus.au45Blink, 0);
    for (const key of Object.keys(result)) {
      if (/Fcl_EYE_/.test(key) && !/Close/.test(key)) result[key] *= 1 - clamp4(blink);
      result[key] = clamp4(result[key]);
    }
    return result;
  }

  // src/alife-face.ts
  var LABEL_MAP = {
    neutral: "neutral",
    happy: "happy",
    excited: "excited",
    amused: "amused",
    proud: "proud",
    confident: "confident",
    calm: "calm",
    relaxed: "calm",
    relieved: "relieved",
    affectionate: "affectionate",
    shy: "shy",
    embarrassed: "embarrassed",
    curious: "curious",
    thinking: "curious",
    concerned: "concerned",
    confused: "confused",
    tired: "tired",
    sad: "sad",
    lonely: "lonely",
    disappointed: "disappointed",
    anxiety: "anxiety",
    fear: "fear",
    angry: "anger",
    frustrated: "frustrated",
    disgust: "disgust",
    surprised: "surprised"
  };
  var AU_TWEAK = {
    // 思考：别笑，抬内眉 + 压一点眉 + 收眼（"皱眉想事情"，而不是"好奇地睁大眼"）
    thinking: { au12LipCornerPuller: -0.45, au01InnerBrowRaiser: 0.3, au04BrowLowerer: 0.18, au07LidTightener: 0.15 },
    // 害羞：笑压小、抿嘴（au24）、颊部提一点 —— 配合垂眼才是"不好意思"而不是"温柔"
    shy: { au12LipCornerPuller: -0.25, au24LipPressor: 0.3, au06CheekRaiser: 0.18, au01InnerBrowRaiser: 0.1 },
    // 放松：更淡的笑 + 眼睑放松（au07 收一点），避免和"开心"同脸
    relaxed: { au12LipCornerPuller: -0.3, au07LidTightener: 0.22, au06CheekRaiser: 0.1 },
    // 惊讶：睁眼、张嘴更明确，别混到"思考"
    surprised: { au05UpperLidRaiser: 0.35, au26JawDrop: 0.2, au02OuterBrowRaiser: 0.15 }
  };
  var GAZE_BY_EMOTION = {
    shy: { x: -0.28, y: -0.55, sec: 2.6 },
    // 垂眼 + 偏开
    sad: { x: 0, y: -0.35, sec: 2.4 },
    // 垂下
    thinking: { x: 0.45, y: -0.12, sec: 2.4 },
    // 瞟向一边
    angry: { x: 0, y: 0.1, sec: 1.4 },
    // 直视（略微抬起下巴）
    surprised: { x: 0, y: 0.06, sec: 0.9 }
  };
  var b2 = (au, names, weight) => ({ au, label: "", kind: "direct", targets: [{ names, weight }] });
  var VRM_PRESET_BINDINGS = [
    b2("au01InnerBrowRaiser", ["browInnerUp", "sorrow", "sad"], 0.6),
    b2("au02OuterBrowRaiser", ["browOuterUpLeft", "surprised"], 0.55),
    b2("au04BrowLowerer", ["browDownLeft", "angry"], 0.55),
    b2("au05UpperLidRaiser", ["eyeWideLeft", "surprised"], 0.55),
    b2("au06CheekRaiser", ["cheekSquintLeft", "relaxed", "fun"], 0.5),
    b2("au07LidTightener", ["eyeSquintLeft"], 0.4),
    b2("au09NoseWrinkler", ["noseSneerLeft"], 0.6),
    b2("au10UpperLipRaiser", ["mouthShrugUpper"], 0.45),
    b2("au12LipCornerPuller", ["mouthSmileLeft", "happy", "joy", "fun"], 0.8),
    b2("au15LipCornerDepressor", ["mouthFrownLeft", "sad", "sorrow"], 0.8),
    b2("au17ChinRaiser", ["mouthShrugLower"], 0.45),
    b2("au18LipPucker", ["mouthPucker", "ou", "u", "o"], 0.55),
    b2("au20LipStretcher", ["mouthStretchLeft", "ih", "i"], 0.45),
    b2("au23LipTightener", ["mouthPressLeft", "angry"], 0.6),
    b2("au24LipPressor", ["mouthPressLeft"], 0.5),
    b2("au25LipsPart", ["mouthOpen", "aa", "a"], 0.45),
    b2("au26JawDrop", ["jawOpen", "aa", "a", "o"], 0.85),
    b2("au27MouthStretch", ["mouthOpen", "aa", "a", "e"], 0.6),
    b2("au45Blink", ["eyeBlinkLeft", "blink", "Blink"], 1)
  ];
  var MMD_BINDINGS = [
    b2("au01InnerBrowRaiser", ["\u56F0\u308B", "\u56F0\u308BA", "\u56F0\u308BB", "\u56F0\u308B2"], 0.55),
    b2("au02OuterBrowRaiser", ["\u898B\u958B\u304F", "\u3073\u3063\u304F\u308A"], 0.5),
    b2("au04BrowLowerer", ["\u6012\u308A", "\u6012\u308AA", "\u6012\u308AB"], 0.6),
    b2("au05UpperLidRaiser", ["\u898B\u958B\u304F", "\u3073\u3063\u304F\u308A"], 0.6),
    b2("au06CheekRaiser", ["\u7B11\u3044\u76EE", "\u306B\u3053\u308A", "\u306B\u3053\u308AA", "\u306B\u3053\u308AB"], 0.5),
    b2("au07LidTightener", ["\u3058\u3068\u76EE", "+\u76EE\u4E0B"], 0.45),
    b2("au09NoseWrinkler", ["\u5ACC", "\u5ACC\u60AA"], 0.55),
    b2("au10UpperLipRaiser", ["\u53E3\u89D2\u4E0A\u3052", "\u306B\u3084\u308A"], 0.4),
    b2("au12LipCornerPuller", ["\u306B\u3053\u308A", "\u306B\u3053\u308AA", "\u7B11\u3044", "\u7B11\u3044A", "\u306B\u3084\u308A", "\u53E3\u89D2\u4E0A\u3052"], 0.75),
    b2("au15LipCornerDepressor", ["\u53E3\u89D2\u4E0B\u3052", "\u56F0\u308B", "\u56F0\u308BA", "\u60B2\u3057\u3044"], 0.7),
    b2("au17ChinRaiser", ["\u53E3"], 0.35),
    b2("au18LipPucker", ["\u3046", "\u304A", "\u304A2"], 0.55),
    b2("au20LipStretcher", ["\u3044", "\u30442", "\u30443", "\u3048"], 0.45),
    b2("au23LipTightener", ["\u771F\u9762\u76EEA", "\u53E3"], 0.45),
    b2("au24LipPressor", ["\u771F\u9762\u76EEA", "\u53E3"], 0.45),
    b2("au25LipsPart", ["\u3042", "\u3042\uFF12", "\u30423"], 0.4),
    b2("au26JawDrop", ["\u3042", "\u3042\uFF12", "\u30423", "\u304A", "\u304A2"], 0.8),
    b2("au27MouthStretch", ["\u3042", "\u3048"], 0.5),
    b2("au45Blink", ["\u307E\u3070\u305F\u304D", "\u307E\u3070\u305F\u304DA", "\u77AC\u304D"], 1)
  ];
  var AlifeFace = class {
    constructor(opts = {}) {
      __publicField(this, "engine");
      __publicField(this, "bindings", []);
      __publicField(this, "supported", 0);
      __publicField(this, "total", 0);
      __publicField(this, "lastEmotion", "neutral");
      __publicField(this, "lastIntensity", 0.8);
      this.engine = new FaceEngine({ autoBlink: false, ...opts.settings || {} });
    }
    /** 用模型实际可用的表情名构建映射（换模型时重新调一次） */
    setAvailable(names) {
      const profile = {
        schema: 1,
        name: "alife",
        bindings: [...vroidProfile.bindings, ...VRM_PRESET_BINDINGS, ...MMD_BINDINGS]
      };
      const list = Array.isArray(names) ? names.filter(Boolean) : [];
      const all = resolveProfile(profile, list);
      const seenAu = /* @__PURE__ */ new Set();
      this.bindings = all.filter((x) => {
        if (!x.supported) return true;
        if (seenAu.has(x.au)) return false;
        seenAu.add(x.au);
        return true;
      });
      this.total = this.bindings.length;
      this.supported = this.bindings.filter((x) => x.supported).length;
      return {
        total: this.total,
        supported: this.supported,
        aus: this.bindings.filter((x) => x.supported).map((x) => x.au)
      };
    }
    /** 情绪标签 + 强度（0..1）；未知标签不抛（退回 neutral），免得一层坏数据打断整帧 */
    setEmotion(label, intensity = 1) {
      const key = String(label || "neutral").toLowerCase();
      this.lastEmotion = key;
      const _iv = Number(intensity);
      this.lastIntensity = isFinite(_iv) ? Math.max(0, Math.min(1, _iv)) : 0.8;
      const name = LABEL_MAP[key] || key;
      try {
        this.engine.triggerEmotion(name, intensity);
      } catch (e) {
        try {
          this.engine.triggerEmotion("neutral", 0);
        } catch (e2) {
        }
      }
      const g = GAZE_BY_EMOTION[key];
      if (g) {
        try {
          this.engine.glance(g.x, g.y, g.sec, { amplitude: Math.max(0.5, intensity), emotion: true });
        } catch (e) {
        }
      }
    }
    /** 直接给 VAD：愉悦度 / 唤醒度 / 支配度，各 -1..1 */
    setVAD(v, a, d) {
      this.engine.setVAD({ valence: v, arousal: a, dominance: d });
    }
    /** 单个 AU 覆盖（0..1，null = 归还给引擎） */
    setAU(key, value) {
      this.engine.setAU(key, value);
    }
    clearAU() {
      this.engine.clearAU();
    }
    /** 每帧推进，返回要写入的权重 */
    update(dt) {
      const frame = this.engine.update(dt);
      const weights = computeMorphWeights(this.tweakAUs(frame.aus), this.bindings, {}, {});
      return { weights, frame };
    }
    /** 按当前情绪对 AU 做语义微调（不改引擎状态，只改这一帧拿去映射的副本） */
    tweakAUs(aus) {
      const tw = AU_TWEAK[this.lastEmotion];
      if (!tw) return aus;
      const out = { ...aus };
      const s = 0.4 + 0.6 * this.lastIntensity;
      for (const k in tw) out[k] = Math.max(0, Math.min(1, (out[k] || 0) + tw[k] * s));
      return out;
    }
    snapshot() {
      const frame = this.engine.snapshot();
      return computeMorphWeights(frame.aus, this.bindings, {}, {});
    }
  };
  return __toCommonJS(alife_face_exports);
})();
