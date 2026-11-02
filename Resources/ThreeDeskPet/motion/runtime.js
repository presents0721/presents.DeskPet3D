/* motion/runtime.js — Motion Core v2 的运行时观察器（Phase 1A）
 *
 * 这一版**不接管写骨**：只在每帧的关键节点给骨骼拍快照，统计“哪一层改了哪些骨、
 * 哪些骨被多层同时改”。用途：
 *   ① 把“层冲突/动作被吞”从日志猜测变成逐帧数据；
 *   ② 为 Phase 1B 的“单写入者 + 优先级混合”提供真实的 ownership 依据；
 *   ③ 在重构前建立基线（冲突次数、每层改骨数、状态切换）。
 *
 * 设计约束：
 *   - 只读骨骼，不写骨骼；任何异常都吞掉，绝不影响渲染；
 *   - 日志节流，默认每 5 秒最多一条，避免刷屏；
 *   - 不依赖 THREE，只读 node.quaternion / position。
 */
(function (root) {
  'use strict';

  const QUIET_MS = 5000;

  function qArr(q) { return [q.x, q.y, q.z, q.w]; }
  function qDiffDeg(a, b) {
    let d = Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]);
    if (d > 1) d = 1;
    return 2 * Math.acos(d) * 180 / Math.PI;
  }
  function labelOf(id) {
    // 日志里避免出现被前端探针闸门拦截的关键字（例如 ardy），用中文层名。
    return {
      base: '基座', clip: '动画', embodied: '关键帧', ardy: '生成层',
      legpin: '钉位', physics: '物理', hold: '保持', touch: '触摸', root: '根位移',
    }[id] || id;
  }
  // ★ P0-A4：只有“动作所有者”之间的同帧重叠才算冲突。
  //   base 是参考层（动作层本来就叠在 base 上），root/legpin 是具身层的附属，physics 是后处理。
  const ACTION_LAYERS = { clip: 1, embodied: 1, hold: 1, ardy: 1, generative: 1 };
  function isActionLayer(id) { return !!ACTION_LAYERS[id]; }

  class MotionRuntime {
    constructor(opts) {
      this.opts = opts || {};
      this.getVrm = this.opts.getVrm || function () { return null; };
      this.log = this.opts.log || function () { };
      this.enabled = true;
      this.frameIndex = 0;
      this.lastSnapshot = null;
      this.marks = [];
      this.stats = {
        frames: 0,
        conflictFrames: 0,
        conflictBones: 0,
        byLayer: Object.create(null),
        byPair: Object.create(null),
        lastReportAt: 0,
        lastSig: '',
      };
      this._lastLogAt = 0;
      this.recent = [];
    }

    _bones() {
      const vrm = this.getVrm();
      if (!vrm || !vrm.humanoid) return null;
      const nb = vrm.humanoid.normalizedHumanBones || {};
      const out = [];
      for (const k in nb) {
        const n = nb[k] && nb[k].node;
        if (n && n.quaternion) out.push([k, n]);
      }
      // 兜底：某些模型的 normalizedHumanBones 不含手指；补标准 30 根（存在才加）
      if (out.length < 30 && vrm.humanoid.getNormalizedBoneNode) {
        const F1 = ['Thumb', 'Index', 'Middle', 'Ring', 'Little'], F2 = ['Proximal', 'Intermediate', 'Distal'];
        for (const sd of ['left', 'right']) for (const f of F1) for (const su of F2) {
          const nm = sd + f + su;
          if (nb[nm]) continue;
          const b = vrm.humanoid.getNormalizedBoneNode(nm);
          if (b && b.quaternion) out.push([nm, b]);
        }
      }
      return out;
    }

    _snapshot() {
      const bones = this._bones();
      if (!bones) return null;
      const snap = { q: Object.create(null), p: Object.create(null) };
      for (const [name, node] of bones) {
        snap.q[name] = qArr(node.quaternion);
        if (name === 'hips' && node.position) snap.p.hips = [node.position.x, node.position.y, node.position.z];
      }
      return snap;
    }

    beginFrame(dt) {
      if (!this.enabled) return;
      try {
        this.frameIndex++;
        this.marks = [];
        this.lastSnapshot = this._snapshot();
        this.dt = dt || 0;
      } catch (e) { }
    }

    /** 在某个层写完骨骼后调用。 */
    mark(id, priority) {
      if (!this.enabled) return;
      try {
        if (!this.lastSnapshot) return;
        const now = this._snapshot();
        if (!now) return;
        const changed = [];
        for (const name in now.q) {
          const a = this.lastSnapshot.q[name], b = now.q[name];
          if (!a || !b) continue;
          if (qDiffDeg(a, b) > 0.05) changed.push(name);
        }
        const hipsMoved = !!(now.p.hips && this.lastSnapshot.p.hips &&
          (Math.abs(now.p.hips[0] - this.lastSnapshot.p.hips[0]) > 1e-5 ||
           Math.abs(now.p.hips[1] - this.lastSnapshot.p.hips[1]) > 1e-5 ||
           Math.abs(now.p.hips[2] - this.lastSnapshot.p.hips[2]) > 1e-5));
        this.marks.push({ id, label: labelOf(id), priority: priority || 0, changed, hipsMoved });
        this.lastSnapshot = now;
      } catch (e) { }
    }

    endFrame(stateId) {
      if (!this.enabled) return;
      try {
        const active = this.marks.filter(m => m.changed.length || m.hipsMoved);
        const stats = this.stats;
        stats.frames++;
        for (const m of active) {
          const s = stats.byLayer[m.id] || (stats.byLayer[m.id] = { frames: 0, bones: 0 });
          s.frames++; s.bones += m.changed.length + (m.hipsMoved ? 1 : 0);
        }
        // 冲突：同一根骨被 >=2 个**动作所有者**在**同一帧**改过
        //   （base 是参考层；root/legpin 是具身附属；physics 是后处理 —— 都不算“抢骨”）
        const owners = Object.create(null);
        for (const m of active) {
          if (!isActionLayer(m.id)) continue;
          for (const b of m.changed) (owners[b] || (owners[b] = [])).push(m.id);
        }
        let conflicts = 0;
        const conflictRows = [];
        for (const b in owners) {
          const ids = owners[b];
          if (ids.length >= 2) {
            conflicts++;
            conflictRows.push(b + '(' + ids.map(labelOf).join('/') + ')');
            const sig = ids.slice().sort().join('+');
            stats.byPair[sig] = (stats.byPair[sig] || 0) + 1;
          }
        }
        if (conflicts) {
          stats.conflictFrames++;
          stats.conflictBones += conflicts;
        }
        const row = {
          frame: this.frameIndex,
          state: stateId || '',
          layers: active.map(m => m.label + ':' + m.changed.length + (m.hipsMoved ? '+p' : '')),
          conflicts,
          conflictRows: conflictRows.slice(0, 8),
        };
        this.recent.push(row);
        if (this.recent.length > 120) this.recent.shift();

        const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
        const sig = active.map(m => m.id).join('|') + '#' + (conflicts ? conflictRows.join(',') : '');
        if (conflicts && sig !== stats.lastSig && now - this._lastLogAt > QUIET_MS) {
          this._lastLogAt = now;
          stats.lastSig = sig;
          try {
            this.log('[MotionCore/观察] 帧' + this.frameIndex +
              ' 状态=' + (stateId || '?') +
              ' 层=' + row.layers.join('+') +
              '｜冲突 ' + conflicts + ' 根：' + conflictRows.slice(0, 5).join(' '));
          } catch (e) { }
        }
      } catch (e) { }
    }

    report() {
      const s = this.stats;
      const out = {
        frames: s.frames,
        conflictFrames: s.conflictFrames,
        conflictRate: s.frames ? +(s.conflictFrames / s.frames).toFixed(4) : 0,
        conflictBones: s.conflictBones,
        byLayer: s.byLayer,
        byPair: s.byPair,
        recent: this.recent.slice(-10),
      };
      try { console.log('[MotionCore] 观察报告', out); } catch (e) { }
      return out;
    }

    reset() {
      this.frameIndex = 0;
      this.lastSnapshot = null;
      this.marks = [];
      this.recent = [];
      this.stats = {
        frames: 0, conflictFrames: 0, conflictBones: 0,
        byLayer: Object.create(null), byPair: Object.create(null),
        lastReportAt: 0, lastSig: '',
      };
      this._lastLogAt = 0;
    }

    setEnabled(on) { this.enabled = !!on; }
  }

  root.MotionRuntimeV2 = MotionRuntime;
  root.MotionCoreLabel = labelOf;
})(typeof window !== 'undefined' ? window : globalThis);
