/* ardy-retarget.js — 把 ardy-mini 的输出（CSkel27 / Mixamo 骨架）重定向到 VRM humanoid。
 *
 * 设计原则（与 embodied-compose.js 一脉相承）：**不手调坐标轴、不手调符号**。
 *   · ardy 侧：坐标基由数据自己量出来 —— up = 髋→头，left = 右臂→左臂，fwd = 脚→脚趾。
 *   · VRM 侧：同一个量法（由 pet.js 在加载模型时量好，见 embodiedMeasureRig）。
 *   · 于是 "ardy 的 +X 到底是哪边" 这种问题不存在：基一量，方向自动对齐；
 *     换模型、换朝向、T-pose/A-pose 全部自动适配，无需重测。
 *
 * 为什么用“关节位置”而不是“关节旋转”：
 *   manifest.motion_layout 给出每帧 81 个数 = [根位置(3)] + [26 关节 × 3]，
 *   全在同一坐标系 → 取“父关节→子关节”的方向就能定骨骼朝向。
 *   位置驱动天然与骨骼长度/模型比例无关，也不需要每根骨骼的 rest 偏移（旋转驱动才需要）。
 *
 * 输出（每帧）：{ aims: [{ bone, dir:[x,y,z] }], rootDelta:[x,y,z], heading }
 *   dir 是 **VRM 世界系里的单位方向**；由 pet.js 把 "当前骨骼方向 → dir" 转成四元数写入。
 *   v1 只做朝向（rootDelta 先算出来但默认不应用：桌宠站着不滑动）。
 */
(function (global) {
  'use strict';

  // ── ardy 关节 → VRM humanoid 骨骼（null = 不单独驱动）────────────────────────
  var JOINT_TO_BONE = {
    Hips: 'hips', Spine: 'spine', Spine1: 'chest', Spine2: 'upperChest', Spine3: null,
    Neck: 'neck', Head: 'head',
    RightShoulder: 'rightShoulder', RightArm: 'rightUpperArm',
    RightForeArm: 'rightLowerArm', RightHand: 'rightHand',
    RightHandEnd: null, RightHandThumb1: null,
    LeftShoulder: 'leftShoulder', LeftArm: 'leftUpperArm',
    LeftForeArm: 'leftLowerArm', LeftHand: 'leftHand',
    LeftHandEnd: null, LeftHandThumb1: null,
    RightUpLeg: 'rightUpperLeg', RightLeg: 'rightLowerLeg', RightFoot: 'rightFoot', RightToeBase: 'rightToes',
    LeftUpLeg: 'leftUpperLeg', LeftLeg: 'leftLowerLeg', LeftFoot: 'leftFoot', LeftToeBase: 'leftToes'
  };

  // ── aim 表：[VRM 骨骼, ardy 起点关节, ardy 终点关节, VRM 子骨（用来量"当前方向"）]──
  //    VRM 骨骼要转到 “ardy 终点 − ardy 起点” 这个方向上。
  //    终端的头/手/脚趾没有可量方向的子节点 → 不列（手骨会被前臂带着走，头随脖子）。
  var AIMS = [
    ['spine',         'Spine',        'Spine2',       'chest'],
    ['chest',         'Spine1',       'Spine3',       'upperChest'],
    ['upperChest',    'Spine2',       'Neck',         'neck'],
    ['neck',          'Spine3',       'Head',         'head'],
    ['rightShoulder', 'RightShoulder', 'RightArm',    'rightUpperArm'],
    ['rightUpperArm', 'RightArm',     'RightForeArm', 'rightLowerArm'],
    ['rightLowerArm', 'RightForeArm', 'RightHand',    'rightHand'],
    ['leftShoulder',  'LeftShoulder', 'LeftArm',      'leftUpperArm'],
    ['leftUpperArm',  'LeftArm',      'LeftForeArm',  'leftLowerArm'],
    ['leftLowerArm',  'LeftForeArm',  'LeftHand',     'leftHand'],
    ['rightUpperLeg', 'RightUpLeg',   'RightLeg',     'rightLowerLeg'],
    ['rightLowerLeg', 'RightLeg',     'RightFoot',    'rightFoot'],
    ['rightFoot',     'RightFoot',    'RightToeBase', 'rightToes'],
    ['leftUpperLeg',  'LeftUpLeg',    'LeftLeg',      'leftLowerLeg'],
    ['leftLowerLeg',  'LeftLeg',      'LeftFoot',     'leftFoot'],
    ['leftFoot',      'LeftFoot',     'LeftToeBase',  'leftToes']
  ];

  // ── 向量小工具 ───────────────────────────────────────────────────────────────
  function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function norm(v) { var l = Math.hypot(v[0], v[1], v[2]); return l > 1e-9 ? [v[0] / l, v[1] / l, v[2] / l] : [0, 0, 0]; }
  function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function ortho(v, up) { var p = dot(v, up); return norm([v[0] - up[0] * p, v[1] - up[1] * p, v[2] - up[2] * p]); }
  function finite(v) { return v && v.every(function (x) { return typeof x === 'number' && isFinite(x); }); }

  // 3×3 基（行 = left / up / fwd）
  function basisOf(frame) {
    return [frame.left.slice(), frame.up.slice(), frame.fwd.slice()];
  }
  function applyBasis(B, v) { return [dot(B[0], v), dot(B[1], v), dot(B[2], v)]; }
  function transpose(B) { return [[B[0][0], B[1][0], B[2][0]], [B[0][1], B[1][1], B[2][1]], [B[0][2], B[1][2], B[2][2]]]; }
  function matMul(A, B) {
    var out = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (var i = 0; i < 3; i++) for (var j = 0; j < 3; j++) {
      out[i][j] = A[i][0] * B[0][j] + A[i][1] * B[1][j] + A[i][2] * B[2][j];
    }
    return out;
  }

  /* 建立映射：输入模型 manifest 的 skeleton（joint_names / parents / neutral_joints）。
     返回 { index, aims, neutralFrame, boneCount, skipped } —— 供 pet.js 复用。 */
  function build(skeleton) {
    var names = skeleton.joint_names.slice();
    var index = {};
    names.forEach(function (n, i) { index[n] = i; });
    var aims = AIMS
      .filter(function (a) { return index[a[1]] !== undefined && index[a[2]] !== undefined; })
      .map(function (a) {
        var i0 = index[a[1]], i1 = index[a[2]];
        // 该骨骼在**中性姿态**下的骨轴 a0，以及一个与它正交的参考向量 ref0。
        // 扭转(twist)就是相对这"骨轴 + 参考"量出来的：aim 只管方向，扭转必须另外补（否则关节像木偶）。
        var p0 = skeleton.neutral_joints[i0], p1 = skeleton.neutral_joints[i1];
        var a0 = norm(sub(p1, p0));
        var ref0 = norm(cross(a0, [0, 1, 0]));
        if (ref0[0] === 0 && ref0[1] === 0 && ref0[2] === 0) ref0 = norm(cross(a0, [0, 0, 1]));
        return { bone: a[0], from: i0, to: i1, fromName: a[1], toName: a[2], childBone: a[3], a0: a0, ref0: ref0 };
      });
    var unmapped = names.filter(function (n) { return JOINT_TO_BONE[n] === undefined; });
    var skipped = names.filter(function (n) { return JOINT_TO_BONE[n] === null; });
    return {
      names: names, parents: skeleton.parents.slice(), index: index, aims: aims,
      neutralJoints: skeleton.neutral_joints.map(function (p) { return p.slice(); }),
      jointToBone: JOINT_TO_BONE, unmapped: unmapped, skipped: skipped
    };
  }

  /* 每帧 81 个数 = [根位置(3)] + [26 关节 × 3]（manifest.motion_layout: root_pos[0,3] +
     local_joints_positions[5,83]）。关节 j 的偏移：j===0 → 0；j>=1 → 3+(j-1)*3。 */
  function jointOffset(j) { return j === 0 ? 0 : 3 + (j - 1) * 3; }
  function jointPos(frame, j) {
    var o = jointOffset(j);
    return [frame[o], frame[o + 1], frame[o + 2]];
  }

  /* 从一帧（或中性姿势）量出 ardy 自己的坐标基。
     为什么用脚趾定 fwd：T-pose 从正面/背面看，位置数据完全一样，只有**脚趾朝前**能区分朝向。 */
  function deriveFrame(state, joints27) {
    // joints27 传 null/undefined = 用 manifest 的规范静止姿势（标准 T-pose）定基 —— 推荐用法：
    // 它才是与动作/种子无关的稳定参考（用某帧定基会把整段动作系统性转歪，实测如此）。
    var pos = (joints27 && joints27.length === 81)
      ? function (name) { return jointPos(joints27, state.index[name]); }
      : function (name) { return state.neutralJoints[state.index[name]].slice(); };
    var idx = state.index;
    if (idx.Head === undefined || idx.Hips === undefined || idx.LeftArm === undefined ||
        idx.RightArm === undefined || idx.LeftFoot === undefined || idx.LeftToeBase === undefined) return null;
    var up = norm(sub(pos('Head'), pos('Hips')));
    if (!finite(up) || Math.hypot(up[0], up[1], up[2]) < 1e-6) return null;
    var left = ortho(sub(pos('LeftArm'), pos('RightArm')), up);        // 角色自己的左
    if (Math.hypot(left[0], left[1], left[2]) < 1e-6) return null;
    var toe = ortho(sub(pos('LeftToeBase'), pos('LeftFoot')), up);     // 脚→脚趾 ≈ 前方
    var fwd;
    if (Math.hypot(toe[0], toe[1], toe[2]) > 1e-6) {
      fwd = norm(cross(left, up));
      if (dot(fwd, toe) < 0) fwd = [-fwd[0], -fwd[1], -fwd[2]];        // 用脚趾定正负，不靠猜
    } else { fwd = norm(cross(left, up)); }
    return { left: left, up: up, fwd: fwd, origin: pos('Hips') };
  }

  /* rig 归一化：**同时接受 left 与 lateral**。
     pet.js 量出的字段名是 lateral（历史原因），本模块原先是 left —— 字段名不一致会让每帧静默返回 null，
     查起来极费劲（实测踩过）。这里统一，并在缺字段时给出可诊断的原因。 */
  function normalizeRig(rig) {
    if (!rig) return null;
    var left = rig.left || rig.lateral;
    if (!left || !rig.up || !rig.fwd) return null;
    return { left: left, up: rig.up, fwd: rig.fwd };
  }

  /* 把 ardy 坐标基映射到 VRM 坐标基：dirVrm = M · dirArdy。
     rig 由 pet.js 量出：{ lateral|left:[..], up:[..], fwd:[..] }（VRM 世界系）。 */
  function frameMatrix(ardyFrame, vrmFrame) {
    var Ma = basisOf(ardyFrame), Mv = basisOf(normalizeRig(vrmFrame) || vrmFrame);
    return matMul(Mv, transpose(Ma));   // M = Bv · Baᵀ（B 行 = left/up/fwd，行是正交基）
  }

  /* 比率：VRM 髋→头 距离 / ardy 髋→头 距离（用于把根位移换算成模型尺度）。 */
  function scaleHint(state, vrmHipToHead) {
    if (!vrmHipToHead) return 1;
    var a = state.neutralJoints[state.index.Head], h = state.neutralJoints[state.index.Hips];
    var d = Math.hypot(a[0] - h[0], a[1] - h[1], a[2] - h[2]);
    return d > 1e-6 ? vrmHipToHead / d : 1;
  }

  /* 3×3 矩阵（globalRotations 里每关节 9 个数）乘向量。
     行/列主序由 colMajor 决定 —— 这是唯一"约定性"的东西，所以由数据自检来判定（见 matCheck）。 */
  function matMulVec(mat, j, v, colMajor) {
    var b = j * 9, out = [0, 0, 0];
    if (colMajor) {
      for (var c = 0; c < 3; c++) out[c] = mat[b + c] * v[0] + mat[b + 3 + c] * v[1] + mat[b + 6 + c] * v[2];
    } else {
      for (var r = 0; r < 3; r++) out[r] = mat[b + r * 3] * v[0] + mat[b + r * 3 + 1] * v[1] + mat[b + r * 3 + 2] * v[2];
    }
    return out;
  }

  /* 扭转角（rad）：把中性参考向量 ref0 按矩阵转过去，量它绕"当前骨轴"转了多少。
     aim 只保证方向，绕骨轴的那一圈是它丢掉的 —— 这正是"手臂横在胸前像交叉 / 关节像木偶"的根源。 */
  function twistOf(mat, j, a0, ref0, colMajor) {
    var aNow = norm(matMulVec(mat, j, a0, colMajor));
    if (Math.hypot(aNow[0], aNow[1], aNow[2]) < 1e-6) return null;
    var r = matMulVec(mat, j, ref0, colMajor);
    var p0 = ortho(ref0, aNow), p1 = ortho(r, aNow);
    if (Math.hypot(p0[0], p0[1], p0[2]) < 1e-6 || Math.hypot(p1[0], p1[1], p1[2]) < 1e-6) return null;
    var ang = Math.atan2(dot(cross(p0, p1), aNow), dot(p0, p1));
    return isFinite(ang) ? ang : null;
  }

  /* 一帧 → VRM 目标方向。
     state: build() 的结果；frame: Float32Array(81)；rig: {left,up,fwd}（VRM 侧量的）
     opts : { frame? 覆盖 ardy 基（省重复计算）, applyRoot?, mat?（该帧的 globalRotations 切片）, matColMajor? } */
  function retargetFrame(state, frame, rig, opts) {
    opts = opts || {};
    var aFrame = opts.frame || deriveFrame(state, frame);
    var vf = normalizeRig(rig);
    if (!aFrame || !vf) return null;
    var M = frameMatrix(aFrame, vf);
    var pos = function (j) { return jointPos(frame, j); };
    var mat = opts.mat || null, colMajor = !!opts.matColMajor;
    var aims = [], matCheckWorst = 1;
    for (var i = 0; i < state.aims.length; i++) {
      var a = state.aims[i];
      var d = norm(sub(pos(a.to), pos(a.from)));
      if (Math.hypot(d[0], d[1], d[2]) < 1e-6) continue;      // 退化（关节重合）→ 跳过，保持原样
      var dir = norm(applyBasis(M, d));
      if (mat) {
        // ① 布局自检：矩阵给出的骨轴方向 vs **当前帧**位置推出的骨轴方向，应当一致
        //    （不一致 = 行/列主序猜反）。
        //    ★ 上一版这里拿"中性骨轴 a0"作基准 —— 那是"静止姿势"，与"当前姿势"差得越远越为负，
        //      于是自检恒报 -0.9，把我引到"翻主序"的错方向。基准必须是当前帧的方向 d。
        var axisByMatRaw = matMulVec(mat, a.from, a.a0, colMajor);
        var dotA = dot(norm(axisByMatRaw), d);   // 都在 ardy 自身坐标系里比，与 M 无关
        if (dotA < matCheckWorst) matCheckWorst = dotA;
        // ② 扭转：dir[3] 就是补回去的 roll（pet.js 在 aim 之后绕新骨轴滚转这个角度）
        var tw = twistOf(mat, a.from, a.a0, a.ref0, colMajor);
        dir[3] = (typeof tw === 'number') ? tw : 0;
      }
      aims.push({ bone: a.bone, childBone: a.childBone, dir: dir });
    }
    // 骨盆：**只取 yaw**（左右髋轴的水平角），不做俯仰/翻滚。
    // 为什么不能用方向 aim：髋→脊方向是"上下"的，拿它当骨盆朝向会把后仰/侧倾一起转过去（实测：身体倾斜）。
    // 髋轴的差别只用"水平面上的夹角"表达，转多少、往哪边转都是量出来的。
    var hipsYaw = null;
    if (state.index.LeftUpLeg !== undefined && state.index.RightUpLeg !== undefined) {
      var nowAxis = applyBasis(M, sub(pos(state.index.LeftUpLeg), pos(state.index.RightUpLeg)));
      var nL = state.neutralJoints[state.index.LeftUpLeg], nR = state.neutralJoints[state.index.RightUpLeg];
      var restAxis = applyBasis(M, [nL[0] - nR[0], nL[1] - nR[1], nL[2] - nR[2]]);
      // 约定：yaw = 绕世界 +Y 的**有符号角**，与 three.js `setFromAxisAngle(new Vector3(0,1,0), yaw)` 一致。
      // 注意 atan2(z,x) 相对"绕 +Y 旋转"差一个负号 → 所以这里用 aRest − aNow，否则转向会反。
      var aNow = Math.atan2(nowAxis[2], nowAxis[0]), aRest = Math.atan2(restAxis[2], restAxis[0]);
      var d = aRest - aNow;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      if (isFinite(d)) { hipsYaw = d; aims.push({ bone: 'hips', yaw: d, childBone: null }); }
    }
    var out = { aims: aims, ardyFrame: aFrame, matrix: M, heading: null, rootDelta: null,
      matCheck: mat ? matCheckWorst : null };
    if (frame.length >= 4) {   // heading = (cos, sin) 绕 up
      out.heading = Math.atan2(frame[4], frame[3]);
    }
    if (opts.applyRoot) {
      // ★ 三个分量都要：X/Z 是水平位移，**Y 是髋的高度** —— manifest.recenter.root_mean[1] ≈ 0.885
      //   就是"站立时的髋高"（单位 = ardy 骨架尺度）。上一版把 Y 零掉是判断错误：那样髋永不下降，
      //   "蹲下"就永远做不出来（腿只能被拉长/滑步）。客户端以首帧为原点做差 → 蹲下 = 负的 Y。
      var root = [frame[0], frame[1], frame[2]];
      var s = opts.scale || 1;
      out.rootDelta = applyBasis(M, root).map(function (v) { return v * s; });
      // 顺带给出两脚踝的"髋相对目标"（给腿部 IK 用，同一坐标基、同一比例）
      if (state.index.LeftFoot !== undefined && state.index.RightFoot !== undefined && state.index.Hips !== undefined) {
        var h = pos(state.index.Hips);
        var ankle = function (n) {
          var f2 = pos(state.index[n]);
          return applyBasis(M, [f2[0] - h[0], f2[1] - h[1], f2[2] - h[2]]).map(function (v) { return v * s; });
        };
        out.ik = { left: ankle('LeftFoot'), right: ankle('RightFoot') };
      }
    }
    return out;
  }

  /* 自检用：跨帧骨骼长度应近似恒定（检验“每帧 81 个数”的布局是否读对）。
     若偏移读错，长度会在帧间乱跳 —— 这是无需眼睛、当场可判的自校验。 */
  function rigidityCheck(state, frames) {
    var rows = [];
    state.aims.forEach(function (a) {
      var min = Infinity, max = -Infinity;
      for (var f = 0; f < frames.length; f++) {
        var p = jointPos(frames[f], a.from), q = jointPos(frames[f], a.to);
        var d = Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]);
        if (d < min) min = d;
        if (d > max) max = d;
      }
      var mid = (min + max) / 2;
      rows.push({ pair: a.fromName + '→' + a.toName, min: min, max: max, relSpread: mid > 1e-6 ? (max - min) / mid : 0 });
    });
    return rows;
  }

  var api = {
    JOINT_TO_BONE: JOINT_TO_BONE, AIMS: AIMS,
    build: build, deriveFrame: deriveFrame, frameMatrix: frameMatrix, normalizeRig: normalizeRig,
    retargetFrame: retargetFrame, rigidityCheck: rigidityCheck, scaleHint: scaleHint,
    jointPos: jointPos, jointOffset: jointOffset,
    _internals: { sub: sub, norm: norm, cross: cross, dot: dot, ortho: ortho, basisOf: basisOf, applyBasis: applyBasis, transpose: transpose, matMul: matMul }
  };
  global.ArdyRetarget = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
