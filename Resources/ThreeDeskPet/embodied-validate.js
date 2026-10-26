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
      for (var c in p) {
        if (set && Object.keys(set).length && !set[c]) { issues.push({ code: 'unknown-channel', msg: '第' + i + '段通道名 " ' + c + '" 不存在，已丢弃' }); fixedAny = true; continue; }
        var v = +p[c];
        if (!isNum(v)) { issues.push({ code: 'bad-value', msg: '第' + i + '段 "' + c + '" 不是数字，已丢弃' }); fixedAny = true; continue; }
        if (Math.abs(v) > ABS_MAX) { issues.push({ code: 'range', msg: '第' + i + '段 "' + c + '" = ' + v + '° 超范围，已夹到 ±' + ABS_MAX }); v = Math.max(-ABS_MAX, Math.min(ABS_MAX, v)); fixedAny = true; }
        pose[c] = v; droppedAll = false;
      }
      ns.pose = pose;
      fixed.steps.push(ns);
    }
    if (droppedAll && set && Object.keys(set).length) { issues.push({ code: 'no-valid-channel', msg: '所有通道都无效 ⇒ 无有效内容' }); return done(2, issues, null); }

    // ③ 顺序断点（"先动 → 停 → 同向再动"）
    var keyset = (set && Object.keys(set).length) ? set : allKeys(fixed.steps);   // 必须先定"全通道"再折叠，否则晚出现的通道会取到 undefined
    var series = foldSeries(fixed.steps, keyset);
    var orderHits = 0;
    for (var ch in keyset) {
      var v = [0];
      for (var s2 = 0; s2 < fixed.steps.length; s2++) v.push(series[s2][ch]);
      for (var a = 1; a < v.length; a++) {
        var d = v[a] - v[a - 1];
        if (Math.abs(d) < 1e-6) continue;
        var b = a + 1; while (b < v.length && Math.abs(v[b] - v[b - 1]) < 1e-6) b++;
        if (b < v.length && Math.sign(v[b] - v[b - 1]) === Math.sign(d) && b > a + 1) {
          orderHits++;
          issues.push({ code: 'order-gap', msg: '通道 "' + ch + '" 先动→停→再动（第' + (a - 1) + '段到第' + (b - 1) + '段）⇒ 会"刹一下再起步"，已合并为一次连续动作' });
          if (opts.autoFix !== false) {
            var last = v[b];                       // 终值
            fixed.steps[a - 1].pose[ch] = last;    // 提前写进前一段
            delete fixed.steps[b - 1].pose[ch];    // 后面那段不再重复动它
            fixedAny = true;
            v[a] = last;                           // 就地更新，继续往后扫
            for (var q = a + 1; q <= b; q++) v[q] = last;
          }
        }
      }
    }

    if (!fixedAny && !orderHits) return done(0, issues, spec);
    return done(1, issues, fixed);
  }

  function allKeys(steps) { var s = {}; for (var i = 0; i < steps.length; i++) { var p = steps[i].pose || {}; for (var c in p) s[c] = 1; } return s; }

  function done(level, issues, fixed) {
    return { ok: level === 0, level: level, issues: issues, fixed: fixed, fallbackPreset: DEFAULT_FALLBACK };
  }

  global.EmbodiedValidate = {
    check: check, LIMITS: { ABS_MAX: ABS_MAX, DUR_MIN: DUR_MIN, DUR_MAX: DUR_MAX, MAX_STEPS: MAX_STEPS },
    DEFAULT_FALLBACK: DEFAULT_FALLBACK,
  };
})(typeof window !== 'undefined' ? window : globalThis);
