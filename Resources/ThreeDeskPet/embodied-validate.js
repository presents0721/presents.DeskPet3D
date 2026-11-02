/* ============================================================================
 * 具身动作「校验器 + 退化阶梯」（纯函数，可离线自测）
 *
 * 为什么需要它：AI 用 <bodyact> 手写关键帧时，**没人能保证它写对** ——
 *   作者看不见画面、也没有三维直觉（历史教训：连人手写都踩过"把连续动作拆成两段"、
 *   "收尾停在半空"、"通道名写错静默无效"）。所以不靠"相信 AI"，靠"校验不过就降级"。
 *
 * 退化阶梯（level 越小越好）：
 *   0 = 原样可播
 *   1 = 已自动修正后播放（改的是**结构性**问题：非法通道名 / 超范围数值 / 过长时长 / 顺序断点）
 *   2 = 修不动 ⇒ 退回预置动作（调用方负责播 fallbackPreset）
 *   3 = 连预置都不可用（调用方兜底）
 *
 * 顺序断点（"先动 → 停 → 同向再动"）：这是最容易犯、观感最差的错 ——
 *   它让"一次连续动作"变成"刹一下再起步"。修法（局部、保终值）：
 *   把后面那段的终值**提前写进前一段**，并把后面那段的该通道删掉 ⇒ 一次走完、终值不变。
 * ========================================================================== */
(function (global) {
  'use strict';

  var ABS_MAX = 180;          // 单通道角度上限（度）：超过基本是 AI 写错量级
  // ★ 关节生理范围（硬约束，与 embodied-compose.js 的 JOINT_LIMITS 同步）：
  //   ABS_MAX 只挡"量级明显写错"，挡不住"负的肘 = 反折、90° 肘外摆 = 横着掰断、180° 转掌 = 手背朝前"。
  //   这里是**进入合成前**的最后一道体检：超范围就夹住（level=1），并把"哪一段哪个通道写错"报出来。
  var ANATOMY_FALLBACK = {
    lElbow: [0, 145], rElbow: [0, 145],
    lKnee: [0, 150], rKnee: [0, 150],
    lElbowSide: [-35, 35], rElbowSide: [-35, 35],
    lElbowTwist: [-85, 85], rElbowTwist: [-85, 85],
    lHandTurn: [-85, 85], rHandTurn: [-85, 85],
    lHandBend: [-55, 70], rHandBend: [-55, 70],
    lHandSide: [-25, 25], rHandSide: [-25, 25],
    lArmUp: [-40, 175], rArmUp: [-40, 175],
    lArmFwd: [-65, 110], rArmFwd: [-65, 110],
    lArmIn: [-80, 80], rArmIn: [-80, 80],
    lLegFwd: [-55, 120], rLegFwd: [-55, 120],
    lLegSide: [-75, 75], rLegSide: [-75, 75],
    lLegTwist: [-60, 60], rLegTwist: [-60, 60],
    lAnkle: [-40, 55], rAnkle: [-40, 55],
    lAnkleSide: [-30, 30], rAnkleSide: [-30, 30],
    lToes: [-20, 60], rToes: [-20, 60]
  };
  function anatomyLimit(ch) {
    var C = global.EmbodiedCompose;
    return ((C && C.JOINT_LIMITS) || ANATOMY_FALLBACK)[ch] || null;
  }

  // ★ 兼容旧版 `<Motion>` 的 channels 规格（AI 常把两种格式混用）：
  //   { duration, loop, channels:[{bone:'head', axis:'y', from:0, to:-12}, …] }
  //   旧逻辑只认 `steps` ⇒ 直接判"没有 steps"、退回 hands_up（日志实证：角色做了 hands_up，
  //   而 AI 本意只是点头/微躬身）。这里把**头/脊柱/胸/胯**三轴映射成 bodyact 的语义通道。
  //   映射不了的部分（四肢等）丢弃并报出来；只要有一个能映射，就按 level=1 自动修正播放。
  var LEGACY_TORSO = {
    head: { x: 'headPitch', y: 'headYaw', z: 'headRoll' },
    spine: { x: 'spinePitch', y: 'spineYaw', z: 'spineRoll' },
    chest: { x: 'chestPitch', y: 'chestYaw', z: 'chestRoll' },
    hips: { x: 'hipsPitch', y: 'hipsYaw', z: 'hipsRoll' }
  };
  function legacyBoneKey(raw) {
    var s = String(raw || '');
    var last = s.split(/[._/]/).pop() || s;
    last = last.replace(/^J_Bip_/i, '').replace(/^C_/i, '');
    return last ? last.charAt(0).toLowerCase() + last.slice(1) : '';
  }
  function legacyChannels(spec) {
    var pose = {}, skipped = [];
    for (var i = 0; i < spec.channels.length; i++) {
      var ch = spec.channels[i] || {};
      var map = LEGACY_TORSO[legacyBoneKey(ch.bone)];
      var name = map && map[String(ch.axis || '').toLowerCase()];
      var to = isNum(+ch.to) ? +ch.to : (isNum(+ch.from) ? +ch.from : 0);
      if (name) pose[name] = to;
      else skipped.push(String(ch.bone || '?') + '.' + String(ch.axis || '?'));
    }
    if (!Object.keys(pose).length) return null;
    var dur = Math.max(DUR_MIN, Math.min(DUR_MAX, (+spec.duration) || 0.8));
    var fixed = { fps: 20, steps: [{ pose: pose, dur: dur, ease: 'inout' }] };
    if (spec.loop) fixed.repeat = 2;       // 旧 loop:true 近似成两遍
    return { spec: fixed, skipped: skipped };
  }
  var DUR_MIN = 0.05, DUR_MAX = 4.0;   // 一段太短=瞬跳；太长=会堵住后续动作（40 秒那种是"保持预览"，不该由 AI 下发）
  var MAX_STEPS = 16;
  var DEFAULT_FALLBACK = 'hands_up';

  function isNum(v) { return typeof v === 'number' && isFinite(v); }

  function channelSet(channels) {
    var set = {};
    if (channels && channels.length) { for (var i = 0; i < channels.length; i++) set[channels[i]] = 1; }
    return set;
  }

  /** 折叠：每个通道在"每一段结束时"的值（长度 = 段数） */
  function foldSeries(steps, set) {
    var cur = {}, out = [];
    for (var k in set) cur[k] = 0;
    for (var s = 0; s < steps.length; s++) {
      var p = (steps[s] && steps[s].pose) || {};
      for (var c in p) if (set[c]) cur[c] = isNum(+p[c]) ? +p[c] : 0;
      var snap = {}; for (var c2 in cur) snap[c2] = cur[c2];
      out.push(snap);
    }
    return out;
  }

  /**
   * check(spec, opts) → { ok, level, issues:[{code,msg}], fixed, fallbackPreset }
   *   opts = { channels: ['rArmUp', ...], autoFix: true }  （channels 缺省时跳过"通道名合法性"检查）
   */
  function check(spec, opts) {
    opts = opts || {};
    var issues = [];
    var set = channelSet(opts.channels);
    if (!spec || typeof spec !== 'object') return done(3, issues, null);

    // 预设模式：本身是白名单，直接放行（不需要写数值）
    if (spec.preset) return done(0, issues, spec);

    // ★ 旧版 channels 规格（不是 steps）⇒ 先尝试转换，别直接判"无内容"
    if (!Array.isArray(spec.steps) && Array.isArray(spec.channels) && spec.channels.length) {
      var legacy = legacyChannels(spec);
      if (legacy) {
        issues.push({ code: 'legacy-channels', msg: '收到旧版 channels 规格（bone/axis/from/to）⇒ 已自动转成 bodyact steps' });
        if (legacy.skipped.length) issues.push({ code: 'legacy-skipped', msg: '旧格式里无法映射的通道（已丢弃）：' + legacy.skipped.join(',') });
        return done(1, issues, legacy.spec);
      }
    }

    // overlay（base + add）是 compose 正式支持的格式；旧校验器只认 steps ⇒ 误判无内容、退回 hands_up。
    if (spec.overlay && typeof spec.overlay === 'object') {
      var ov = spec.overlay;
      var C = global.EmbodiedCompose;
      var baseOk = false;
      if (typeof ov.base === 'string') baseOk = !!(C && C.PRESETS && C.PRESETS[ov.base]);
      else if (ov.base && typeof ov.base === 'object') baseOk = !!(Array.isArray(ov.base.steps) || ov.base.overlay);
      if (!baseOk) { issues.push({ code: 'overlay-base', msg: 'overlay.base 不存在或没有内容 ⇒ 无法叠加' }); return done(2, issues, null); }
      var addSpec = ov.add;
      if (addSpec && Array.isArray(addSpec.steps) && addSpec.steps.length) {
        var addRep = check(Object.assign({}, addSpec, { overlay: null }), { channels: opts.channels, autoFix: opts.autoFix });
        for (var oi = 0; oi < addRep.issues.length; oi++) issues.push(addRep.issues[oi]);
        if (addRep.level >= 2) return done(2, issues, null);
        if (addRep.level === 1) {
          var fixedOv = Object.assign({}, spec, { overlay: Object.assign({}, ov, { add: addRep.fixed }) });
          return done(1, issues, fixedOv);
        }
      }
      return done(0, issues, spec);
    }

    var steps = Array.isArray(spec.steps) ? spec.steps : null;
    if (!steps || !steps.length) { issues.push({ code: 'no-steps', msg: '没有 steps（也没有 preset）⇒ 无内容可播' }); return done(2, issues, null); }

    var fixed = { fps: spec.fps, rootY: spec.rootY, turn: spec.turn, crouch: spec.crouch, kneel: spec.kneel, fingers: spec.fingers, smooth: spec.smooth, repeat: spec.repeat, overlay: spec.overlay, steps: [] };
    var droppedAll = true, fixedAny = false;

    // ① 段数
    if (steps.length > MAX_STEPS) { issues.push({ code: 'too-many-steps', msg: 'steps 过多（' + steps.length + ' > ' + MAX_STEPS + '），已截断' }); steps = steps.slice(0, MAX_STEPS); fixedAny = true; }

    // ② 逐段：时长 clamp、通道名合法性、数值范围
    for (var i = 0; i < steps.length; i++) {
      var st = steps[i] || {};
      var ns = {};
      var dur = isNum(+st.dur) ? +st.dur : 0.4;
      if (dur < DUR_MIN) { issues.push({ code: 'dur-short', msg: '第' + i + '段 dur=' + dur + ' 太短，已提到 ' + DUR_MIN + 's' }); dur = DUR_MIN; fixedAny = true; }
      if (dur > DUR_MAX) { issues.push({ code: 'dur-long', msg: '第' + i + '段 dur=' + dur + ' 太长（会挡住后续动作），已压到 ' + DUR_MAX + 's' }); dur = DUR_MAX; fixedAny = true; }
      ns.dur = dur; ns.ease = st.ease || 'inout';
      if (st.fingers !== undefined) ns.fingers = st.fingers;
      var pose = {};
      var p = st.pose || {};
      // ★ 容错：AI 经常把通道直接写在 step 层（`{"lArmUp":90,"dur":0.5}`），漏掉 `pose` 包一层。
      //   旧逻辑会在"pose 为空"时把所有通道判成无效 ⇒ 整段退回 hands_up（用户看到的"动作爆了"）。
      //   这里把 step 层的数字键收进 pose（仍是 level=1 自动修正，不是静默放行）。
      if (!Object.keys(p).length) {
        for (var fk in st) {
          if (fk === 'dur' || fk === 'ease' || fk === 'pose' || fk === 'fingers' || fk === 'rootY' || fk === 'crouch' || fk === 'kneel') continue;
          if (set && Object.keys(set).length && !set[fk]) continue;
          if (isNum(+st[fk])) { p[fk] = +st[fk]; fixedAny = true; }
        }
        if (Object.keys(p).length) issues.push({ code: 'pose-flat', msg: '第' + i + '段通道写在 step 层（缺 pose 包装）⇒ 已自动收进 pose' });
      }
      // ★ 容错：少数模型会多包一层 `"pose":{"channels":{...}}`
      if (p && p.channels && typeof p.channels === 'object') {
        for (var ck in p.channels) {
          if (set && Object.keys(set).length && !set[ck]) continue;
          if (isNum(+p.channels[ck])) { p[ck] = +p.channels[ck]; fixedAny = true; }
        }
        delete p.channels;
        issues.push({ code: 'pose-channels', msg: '第' + i + '段的 pose 多包了一层 channels ⇒ 已摊平' });
      }
      for (var c in p) {
        // ★ 容错：AI 常把「段参数」crouch / rootY / kneel / turn 塞进 pose（它们不是通道）。
        //   旧逻辑会把它们当非法通道丢掉 ⇒ 整段只剩一点点动作甚至空段（用户："动作一点没做出来"）。
        //   这里提到段层（crouch/rootY）或顶层（kneel/turn），仍是 level=1 修正。
        if (c === 'crouch' || c === 'rootY' || c === 'kneel' || c === 'turn') {
          var hv = +p[c];
          if (isNum(hv)) {
            if (c === 'kneel') fixed.kneel = Math.max(0, Math.min(1, hv));
            else if (c === 'turn') fixed.turn = hv;
            else if (c === 'crouch') ns.crouch = Math.max(0, Math.min(1, hv));
            else ns.rootY = Math.max(-0.6, Math.min(0.6, hv));
            issues.push({ code: 'lift-' + c, msg: '第' + i + '段 "' + c + '" 写在 pose 里 ⇒ 已提到段参数（它不是通道）' });
            fixedAny = true; droppedAll = false;
          }
          continue;
        }
        if (set && Object.keys(set).length && !set[c]) { issues.push({ code: 'unknown-channel', msg: '第' + i + '段通道名 "' + c + '" 不存在，已丢弃' }); fixedAny = true; continue; }
        var v = +p[c];
        if (!isNum(v)) { issues.push({ code: 'bad-value', msg: '第' + i + '段 "' + c + '" 不是数字，已丢弃' }); fixedAny = true; continue; }
        if (Math.abs(v) > ABS_MAX) { issues.push({ code: 'range', msg: '第' + i + '段 "' + c + '" = ' + v + '° 超范围，已夹到 ±' + ABS_MAX }); v = Math.max(-ABS_MAX, Math.min(ABS_MAX, v)); fixedAny = true; }
        // ★ 关节生理硬约束：负肘/反膝/横掰/翻掌在合成前就夹住，并明确告诉 AI 是哪一段写错
        var lim = anatomyLimit(c);
        if (lim) {
          var cv = Math.max(lim[0], Math.min(lim[1], v));
          if (cv !== v) {
            issues.push({ code: 'anatomy', msg: '第' + i + '段 "' + c + '" = ' + v + '° 超出生理范围 [' + lim[0] + ',' + lim[1] + ']' + (v < lim[0] && /Elbow|Knee/.test(c) ? '（反关节）' : '') + '，已夹到 ' + cv + '°' });
            v = cv; fixedAny = true;
          }
        }
        pose[c] = v; droppedAll = false;
      }
      ns.pose = pose;
      fixed.steps.push(ns);
    }
    if (droppedAll && set && Object.keys(set).length) { issues.push({ code: 'no-valid-channel', msg: '所有通道都无效 ⇒ 无有效内容' }); return done(2, issues, null); }

    // ★ 4A 修复：**不再合并"先动→停→同向再动"**。旧合并把终值提前写进前一段、删掉后一段，
    //   等于把后面的动作整段吞掉（长动作只剩一小部分）。保留分段；小停顿由 compose 的
    //   跨段平滑/惯性吸收，宁可稍微软一点，也不能丢动作。

    if (!fixedAny) return done(0, issues, spec);
    return done(1, issues, fixed);
  }

  function allKeys(steps) { var s = {}; for (var i = 0; i < steps.length; i++) { var p = steps[i].pose || {}; for (var c in p) s[c] = 1; } return s; }

  function done(level, issues, fixed) {
    return { ok: level === 0, level: level, issues: issues, fixed: fixed, fallbackPreset: DEFAULT_FALLBACK };
  }

  global.EmbodiedValidate = {
    check: check, LIMITS: { ABS_MAX: ABS_MAX, DUR_MIN: DUR_MIN, DUR_MAX: DUR_MAX, MAX_STEPS: MAX_STEPS, ANATOMY: ANATOMY_FALLBACK },
    DEFAULT_FALLBACK: DEFAULT_FALLBACK,
  };
})(typeof window !== 'undefined' ? window : globalThis);
