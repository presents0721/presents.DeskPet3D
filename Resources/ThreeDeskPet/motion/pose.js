/* motion/pose.js — Motion Core v2 的姿势表达与混合（纯 JS，零依赖）
 *
 * 这一层只做“数据”，不写 Three 骨骼。目的：让所有动作来源都提交同一种 PoseFrame，
 * 由 runtime 统一混合、约束、写入 —— 从根上消灭“多层直接写 bone.quaternion、谁后写谁赢”。
 *
 * 约定：
 *   - 四元数格式 [x,y,z,w]，与 three.js 一致；
 *   - bones 里的值是**相对 rest 的局部增量**（与 embodied-compose 的输出语义一致）；
 *   - root 是模型根（petRoot）的位移/旋转；hips 位置单独放 root.pos；
 *   - contacts 只声明“哪只脚落地/目标点”，由约束层消费。
 */
(function (root) {
  'use strict';

  const QI = [0, 0, 0, 1];

  function qMul(a, b) {
    return [
      a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
      a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
      a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
      a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
    ];
  }

  function qInv(q) { return [-q[0], -q[1], -q[2], q[3]]; }

  function qNorm(q) {
    const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
    return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
  }

  function qSlerp(a, b, t) {
    let ax = a[0], ay = a[1], az = a[2], aw = a[3];
    let bx = b[0], by = b[1], bz = b[2], bw = b[3];
    let dot = ax * bx + ay * by + az * bz + aw * bw;
    if (dot < 0) { bx = -bx; by = -by; bz = -bz; bw = -bw; dot = -dot; }
    if (dot > 0.9995) {
      const rx = ax + (bx - ax) * t, ry = ay + (by - ay) * t;
      const rz = az + (bz - az) * t, rw = aw + (bw - aw) * t;
      return qNorm([rx, ry, rz, rw]);
    }
    const th0 = Math.acos(Math.max(-1, Math.min(1, dot)));
    const s0 = Math.sin(th0), s1 = Math.sin(th0 * t), s2 = Math.sin(th0 * (1 - t));
    return [
      ax * s2 / s0 + bx * s1 / s0, ay * s2 / s0 + by * s1 / s0,
      az * s2 / s0 + bz * s1 / s0, aw * s2 / s0 + bw * s1 / s0,
    ];
  }

  function qAngle(a, b) {
    let d = Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]);
    if (d > 1) d = 1;
    return 2 * Math.acos(d) * 180 / Math.PI;
  }

  /** 新建一个空 PoseFrame。 */
  function frame(meta) {
    return {
      bones: Object.create(null),
      root: { pos: [0, 0, 0], quat: QI.slice() },
      contacts: Object.create(null),
      meta: Object.assign({ source: '', priority: 0, weight: 1, mask: null }, meta || {}),
    };
  }

  /** 把 mask（数组或对象）规范成对象；null = 全部。 */
  function maskOf(mask) {
    if (!mask) return null;
    if (Array.isArray(mask)) {
      const m = Object.create(null);
      for (const b of mask) m[b] = 1;
      return m;
    }
    return mask;
  }

  function masked(mask, bone) { return !mask || mask[bone] === 1; }

  /** 绝对层混合：a 是当前结果，b 是更高优先级的目标，w 是 b 的权重。
   *  只对“两者都有的骨”做 slerp；b 有、a 没有 ⇒ 直接取 b；a 有、b 没有 ⇒ 保持 a。
   *  这样“上层只动上半身”的 mask 语义才成立。 */
  function blendAbsolute(a, b, w, maskObj) {
    if (!b) return a;
    const out = frame();
    out.root = {
      pos: [
        a.root.pos[0] + (b.root.pos[0] - a.root.pos[0]) * w,
        a.root.pos[1] + (b.root.pos[1] - a.root.pos[1]) * w,
        a.root.pos[2] + (b.root.pos[2] - a.root.pos[2]) * w,
      ],
      quat: qSlerp(a.root.quat, b.root.quat, w),
    };
    out.contacts = Object.assign({}, a.contacts, b.contacts);
    out.meta = b.meta;
    const names = new Set(Object.keys(a.bones).concat(Object.keys(b.bones)));
    for (const n of names) {
      if (!masked(maskObj, n)) { if (a.bones[n]) out.bones[n] = a.bones[n].slice(); continue; }
      const qa = a.bones[n], qb = b.bones[n];
      if (qa && qb) out.bones[n] = qSlerp(qa, qb, w);
      else if (qb) out.bones[n] = qb.slice();
      else if (qa) out.bones[n] = qa.slice();
    }
    return out;
  }

  /** 叠加层：add 左乘到 base（世界增量语义，顺序无关）。 */
  function addAdditive(base, add, maskObj) {
    if (!add) return base;
    const out = frame();
    out.root = base.root;
    out.contacts = Object.assign({}, base.contacts, add.contacts);
    out.meta = add.meta;
    for (const n in base.bones) out.bones[n] = base.bones[n].slice();
    for (const n in add.bones) {
      if (!masked(maskObj, n)) continue;
      out.bones[n] = base.bones[n] ? qMul(add.bones[n], base.bones[n]) : add.bones[n].slice();
    }
    return out;
  }

  /** 把“局部增量”应用到 rest 四元数，得到局部绝对四元数。 */
  function applyDelta(restQ, delta) {
    return qMul(restQ || QI, delta);
  }

  /** 把一帧的 bones 写成 VRM 归一化骨骼（只在未来由 runtime 调用；当前 Phase 1A 不使用）。 */
  function writeToVrm(vrm, f, restQ, opts) {
    if (!vrm || !vrm.humanoid || !f) return 0;
    const o = opts || {};
    let n = 0;
    for (const name in f.bones) {
      if (o.mask && !masked(o.mask, name)) continue;
      const bone = vrm.humanoid.getNormalizedBoneNode(name);
      if (!bone) continue;
      const q = f.bones[name];
      if (!Array.isArray(q) || q.length !== 4) continue;
      const base = (restQ && restQ[name]) || bone.quaternion;
      const target = applyDelta(base, qNorm(q));
      bone.quaternion.copy(target);
      n++;
    }
    return n;
  }

  root.MotionCorePose = {
    QI, qMul, qInv, qNorm, qSlerp, qAngle,
    frame, maskOf, masked, blendAbsolute, addAdditive, applyDelta, writeToVrm,
  };
})(typeof window !== 'undefined' ? window : globalThis);
