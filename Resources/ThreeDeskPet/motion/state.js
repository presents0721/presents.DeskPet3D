/* motion/state.js — Motion Core v2 的动作状态机（纯 JS）
 *
 * 目的：把“谁现在拥有骨骼”从一堆布尔标志（embodiedWroteFrame / embodiedQueueIsHold /
 * dancingNow / currentMotionAction / gestureAction）变成一个显式的状态 + 优先级。
 *
 * 状态不是“动画类型”，而是“谁在驾驶身体”：
 *   IDLE       待机（基础姿势 + 待机微动/待机 clip）
 *   LISTENING  听（光标追踪/轻微微动，不说话）
 *   SPEAKING   说（口型/轻手势，可与 IDLE 共存）
 *   GESTURE    一次性小动作（点头/挥手/耸肩…）
 *   ACTION     明确动作（预置/自定义造型/舞蹈/点播 clip）
 *   GENERATIVE 生成式全身动作（可选后端）
 *   POSE_EDIT  造型面板的保持预览（最低优先级，任何真动作都能让它淡出）
 *
 * Phase 1A 只做“观察/决策”，不接管写骨；Phase 1B 再由 runtime 用同一套状态做混合。
 */
(function (root) {
  'use strict';

  const STATES = {
    IDLE: { id: 'IDLE', priority: 0, interruptible: true },
    LISTENING: { id: 'LISTENING', priority: 1, interruptible: true },
    SPEAKING: { id: 'SPEAKING', priority: 2, interruptible: true },
    POSE_EDIT: { id: 'POSE_EDIT', priority: 2, interruptible: true, hold: true },
    GESTURE: { id: 'GESTURE', priority: 3, interruptible: true, oneShot: true },
    ACTION: { id: 'ACTION', priority: 4, interruptible: true },
    GENERATIVE: { id: 'GENERATIVE', priority: 5, interruptible: true },
  };

  class MotionStateMachine {
    constructor(opts) {
      this.opts = opts || {};
      this.current = STATES.IDLE;
      this.enteredAt = 0;
      this.reason = 'boot';
      this.history = [];
      this.listeners = [];
    }

    on(fn) { this.listeners.push(fn); return () => { const i = this.listeners.indexOf(fn); if (i >= 0) this.listeners.splice(i, 1); }; }

    /** 请求进入某状态。默认：高优先级可打断低优先级；同优先级按“最新请求赢”。 */
    request(id, opts) {
      const next = STATES[id];
      if (!next) return false;
      const o = opts || {};
      if (this.current && next.priority < this.current.priority && !o.force) return false;
      if (this.current && next.priority === this.current.priority && o.samePriorityReject) return false;
      const prev = this.current;
      this.current = next;
      this.enteredAt = (typeof performance !== 'undefined' ? performance.now() : Date.now());
      this.reason = o.reason || '';
      const ev = { from: prev && prev.id, to: next.id, reason: this.reason, at: this.enteredAt };
      this.history.push(ev);
      if (this.history.length > 64) this.history.shift();
      for (const fn of this.listeners) { try { fn(ev); } catch (e) { } }
      return true;
    }

    /** 动作结束/被打断后回到“下面一层”。Phase 1A 用简单规则：回到 IDLE。 */
    release(reason) {
      if (this.current && this.current.id !== 'IDLE') {
        this.request('IDLE', { reason: reason || 'release', force: true });
      }
    }

    is(id) { return this.current && this.current.id === id; }
    priority() { return this.current ? this.current.priority : 0; }
    snapshot() {
      return {
        state: this.current ? this.current.id : 'IDLE',
        priority: this.priority(),
        reason: this.reason,
        history: this.history.slice(-8),
      };
    }
  }

  root.MotionCoreState = { STATES, MotionStateMachine };
})(typeof window !== 'undefined' ? window : globalThis);
