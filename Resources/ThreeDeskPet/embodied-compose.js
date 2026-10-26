/* 具身动作合成器（纯 JS，零依赖）
 *
 * 把"关键帧 spec(角度/秒)"合成成 pet.js 需要的数据：
 *   { fps, frames: [ { joints: { "<VRM骨骼名>": [x,y,z,w] } }, ... ] }
 * 数值是【绕世界轴的增量四元数】，由 pet.js 的世界空间重定向叠加到中性姿势上。
 *
 * ★ 通道 = 解剖学语义，轴 = 运行时按模型的真实骨骼朝向自动推导（rig）。这是核心设计：
 *     lift(抬)  = 绕 cross(骨骼当前朝向, 世界上方)      → 正数一律"抬起来"
 *     fwd(前)   = 绕 cross(骨骼当前朝向, 角色面朝方向)   → 正数一律"往身前摆"
 *     out(外)   = 绕 cross(骨骼当前朝向, 角色同侧方向)   → 正数一律"往身体外侧摆"
 *     twist(旋) = 绕骨骼自身长轴                        → 正/负 = 两个方向的转掌（唯一带审美取舍的通道）
 *   于是：无论模型是 T-pose 还是 A-pose 静止姿势、无论角色站在哪个朝向，
 *   **左右正负号永远自动正确，不需要人工校准**，AI 也不需要去猜世界 X/Y/Z。
 *   rig 由 pet.js 在加载模型时量好（window.EmbodiedRig）；拿不到 rig 时退回标准 T-pose 假设
 *   （方向仍正确，只是幅度略偏），因此本模块在 Node 里也能离线自测。
 *   骨骼朝向取【父级旋转之后】的当前方向，所以挥手时上臂一抬起，小臂的"外摆"轴会自动跟着转过去。
 *
 * 语义：
 *   - 通道值单位是【度】；某步只写要改的通道，**未写的通道保持上一步的值**（局部关键帧）。
 *   - 序列播完若不在中性，自动补一段"回到中性"（避免收尾瞬跳）。
 *   - spec.repeat：整段序列重复几次（接着上一轮的姿势继续）。
 *
 * 同时挂到 window（页面用）与 globalThis（Node 测试用）。
 */
(function (root) {
  'use strict';

  // ==================== 向量/四元数小工具（四元数格式与 three.js 一致：[x,y,z,w]） ====================
  function vlen(a) { return Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]); }
  /** 叉积：拇指的"转"轴要用「屈曲轴 × 掌心法线」现算（≈ 拇指自身长轴）—— 两个输入都已换算到同一父骨局部空间，叉积才有意义 */
  function vcross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  function vnorm(a) { var l = vlen(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }
  function vcross(a, b) {
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  }
  function vscale(a, s) { return [a[0] * s, a[1] * s, a[2] * s]; }

  var QI = [0, 0, 0, 1];
  function qMul(A, B) {            // A·B：先作用 B，再作用 A（均为世界坐标下的旋转）
    return [
      A[3] * B[0] + A[0] * B[3] + A[1] * B[2] - A[2] * B[1],
      A[3] * B[1] - A[0] * B[2] + A[1] * B[3] + A[2] * B[0],
      A[3] * B[2] + A[0] * B[1] - A[1] * B[0] + A[2] * B[3],
      A[3] * B[3] - A[0] * B[0] - A[1] * B[1] - A[2] * B[2]
    ];
  }
  function qAxis(a, rad) {         // 轴角 → 四元数（a 需已归一化）
    var h = rad / 2, s = Math.sin(h);
    return [a[0] * s, a[1] * s, a[2] * s, Math.cos(h)];
  }
  function qRotate(q, v) {         // 用四元数旋转向量
    var x = q[0], y = q[1], z = q[2], w = q[3];
    var tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0]);
    return [
      v[0] + w * tx + (y * tz - z * ty),
      v[1] + w * ty + (z * tx - x * tz),
      v[2] + w * tz + (x * ty - y * tx)
    ];
  }

  // ==================== 通道表：通道 → { 骨骼, 语义 } ====================
  // kind: lift(抬) | fwd(前/折) | out(外) | twist(自转) | 'x'|'y'|'z'（躯干/头这类基本竖直的骨骼直接用世界轴）
  //
  // **设计原则：每个关节都给满三个自由度**（自转 + 两个方向的摆动）。
  // 人身关节本来就是球窝式的；只给一两个方向必然僵硬 —— 拧不了手腕、抬不起腿、开不了胯，
  // 拼出来的姿势就是"几根轴硬凑"。所以下面每块肢体都有 twist + 两个 swing。
  // 轴的推导见 axisFor：一律按**静止姿势**定一次、再随父级旋转带走；
  // 而不是拿"当前方向"去叉世界轴（那样一叠加就退化/翻向，这正是"僵硬"的技术来源）。
  var CHANNELS = {
    // ── 肩：耸肩 / 含胸展肩（幅度小，但少上半身就死板）──
    lShoulderUp: { bone: 'leftShoulder', kind: 'lift' },
    rShoulderUp: { bone: 'rightShoulder', kind: 'lift' },
    lShoulderFwd: { bone: 'leftShoulder', kind: 'fwd' },
    rShoulderFwd: { bone: 'rightShoulder', kind: 'fwd' },

    // ── 上臂：抬 / 前摆 / **自转**（自转决定掌心朝里还是朝外）──
    lArmUp: { bone: 'leftUpperArm', kind: 'lift' },
    rArmUp: { bone: 'rightUpperArm', kind: 'lift' },
    lArmFwd: { bone: 'leftUpperArm', kind: 'fwd' },
    rArmFwd: { bone: 'rightUpperArm', kind: 'fwd' },
    // ⚠ **实测无效（2026-10-16）**：`ArmTwist`（上臂自转）在 VRM 的 normalized humanoid bone 上
    //   **不起作用** —— 自转是"绕骨骼自身轴"，而归一化骨只保证**骨骼方向**，自转分量被丢弃。
    //   证据：给 `salute` 加了 `rArmTwist: -52`（想拧出"肘尖朝外"），日志确认新参数已加载（通道 9），
    //   但用户看到"一点都没变"。
    //   ⇒ 要表达"肘尖朝向 / 掌心朝向"，请用 **`ElbowSide`（小臂外摆）/ `ElbowTwist` / `HandTurn`**
    //   （out / twist 轴写在**骨骼**上，其中 out 轴可靠；`HandTurn` 在手上实测可用）。
    //   这里保留通道定义（不删）—— 万一将来给 raw bone 用得上，但**别依赖它**。
    lArmTwist: { bone: 'leftUpperArm', kind: 'twist' },
    rArmTwist: { bone: 'rightUpperArm', kind: 'twist' },

    // ── 小臂：屈肘 / 外摆 / **前臂旋转**（旋前旋后＝掌心翻转）──
    // ★ v11.45：`hingeMeasured` = 这条**用实测的骨骼局部轴当铰链**（见 axisFor）。
    //   只给肘开：**膝现在是对的，不给它加无谓风险**；肘则必须用 —— 旧公式在手臂举起后会
    //   把肘轴变成竖直轴 ⇒ "屈肘"变成整条小臂横甩（用户："手臂会掰折，正常人做不到"）。
    lElbow: { bone: 'leftLowerArm', kind: 'fwd', hinge: true, hingeMeasured: true },    // 单轴关节（轴按静止定，见 axisFor）
    rElbow: { bone: 'rightLowerArm', kind: 'fwd', hinge: true, hingeMeasured: true },
    lElbowSide: { bone: 'leftLowerArm', kind: 'out' },      // 挥手/摆手主要靠它
    rElbowSide: { bone: 'rightLowerArm', kind: 'out' },
    lElbowTwist: { bone: 'leftLowerArm', kind: 'twist' },
    rElbowTwist: { bone: 'rightLowerArm', kind: 'twist' },

    // ── 手腕：转掌 / 压翘 / 左右偏（原来只有"转掌"一根轴）──
    lHandTurn: { bone: 'leftHand', kind: 'twist' },
    rHandTurn: { bone: 'rightHand', kind: 'twist' },
    lHandBend: { bone: 'leftHand', kind: 'fwd' },
    rHandBend: { bone: 'rightHand', kind: 'fwd' },
    lHandSide: { bone: 'leftHand', kind: 'out' },
    rHandSide: { bone: 'rightHand', kind: 'out' },

    headPitch: { bone: 'head', kind: 'x' }, headYaw: { bone: 'head', kind: 'y' }, headRoll: { bone: 'head', kind: 'z' },
    spinePitch: { bone: 'spine', kind: 'x' }, spineYaw: { bone: 'spine', kind: 'y' }, spineRoll: { bone: 'spine', kind: 'z' },
    chestPitch: { bone: 'chest', kind: 'x' }, chestYaw: { bone: 'chest', kind: 'y' }, chestRoll: { bone: 'chest', kind: 'z' },
    // 胯 = **骨盆相对腿**：上身（脊柱/胸/头/手臂）跟着倾/转，**腿脚留在原地**。
    // 实现：hips 是根节点，它的旋转本来会传给所有子骨（= 把整个角色当一个整体转，用户实测"像选中人物整体旋转"），
    // 所以 compose 在给腿根（leftUpperLeg/rightUpperLeg）时补一个反向旋转把骨盆这一份抵消掉。
    // 语义上这**不是**"转人物整体"——整身旋转属于模型根节点，不在本通道表里。
    hipsPitch: { bone: 'hips', kind: 'x' }, hipsYaw: { bone: 'hips', kind: 'y' }, hipsRoll: { bone: 'hips', kind: 'z' },

    // ── 腿：**之前一根通道都没有**（走两步 / 蹲下 / 开胯全做不了）──
    // fwd = 抬腿向前（负=向后）；out = 侧开（劈叉方向）；twist = 大腿自转（脚尖朝里/朝外）
    lLegFwd: { bone: 'leftUpperLeg', kind: 'fwd' },
    rLegFwd: { bone: 'rightUpperLeg', kind: 'fwd' },
    lLegSide: { bone: 'leftUpperLeg', kind: 'out' },
    rLegSide: { bone: 'rightUpperLeg', kind: 'out' },
    lLegTwist: { bone: 'leftUpperLeg', kind: 'twist' },
    rLegTwist: { bone: 'rightUpperLeg', kind: 'twist' },
    // 膝：单轴；**正数 = 小腿往后折**（真人方向，不是反关节）→ 用 sign 翻轴
    lKnee: { bone: 'leftLowerLeg', kind: 'fwd', hinge: true, sign: -1 },
    rKnee: { bone: 'rightLowerLeg', kind: 'fwd', hinge: true, sign: -1 },
    // 踝：勾/绷脚尖 + 内外翻；脚趾
    lAnkle: { bone: 'leftFoot', kind: 'fwd' },
    rAnkle: { bone: 'rightFoot', kind: 'fwd' },
    lAnkleSide: { bone: 'leftFoot', kind: 'out' },
    rAnkleSide: { bone: 'rightFoot', kind: 'out' },
    lToes: { bone: 'leftToes', kind: 'fwd' },
    rToes: { bone: 'rightToes', kind: 'fwd' },

    // ── 内部联动通道（v11.17「活人感联动层」用；AI / 面板**看不到** —— channelNames() 会过滤 `_` 开头）──
    //   为什么需要：真实人体的头/脊柱转动是**分散在多节骨骼**上的（颈椎 7 节 / 胸椎 12 节 / 腰椎 5 节），
    //   而通道表里 `headYaw` 只落在 head 一根骨、`neck`/`upperChest` **一根通道都没有** ⇒
    //   `headYaw: 30` 就成了"头焊在胸口上转 30°" —— 用户说的"只动必须动的、太僵硬、没活人感"正是它。
    //   给这两根骨补上通道后，compose 的联动层就能把 head/chest/spine 的值**分摊**下来（骨骼链是累加的，
    //   所以分散后头部朝向几乎不变、但形态从"折刀"变成"整条脊柱在参与"）。
    _neckX: { bone: 'neck', kind: 'x' }, _neckY: { bone: 'neck', kind: 'y' }, _neckZ: { bone: 'neck', kind: 'z' },
    _uchX: { bone: 'upperChest', kind: 'x' }, _uchY: { bone: 'upperChest', kind: 'y' }, _uchZ: { bone: 'upperChest', kind: 'z' }
  };

  // 骨骼层级（父在子前）。用于把"父级旋转后的当前朝向"传给子骨骼推轴。
  var BONE_CHAIN = {
    spine: 'hips', chest: 'spine', upperChest: 'chest', neck: 'upperChest', head: 'neck',
    leftShoulder: 'upperChest', leftUpperArm: 'leftShoulder', leftLowerArm: 'leftUpperArm', leftHand: 'leftLowerArm',
    rightShoulder: 'upperChest', rightUpperArm: 'rightShoulder', rightLowerArm: 'rightUpperArm', rightHand: 'rightLowerArm',
    leftUpperLeg: 'hips', leftLowerLeg: 'leftUpperLeg', leftFoot: 'leftLowerLeg', leftToes: 'leftFoot',
    rightUpperLeg: 'hips', rightLowerLeg: 'rightUpperLeg', rightFoot: 'rightLowerLeg', rightToes: 'rightFoot'
  };
  var BONE_ORDER = [
    'hips', 'spine', 'chest', 'upperChest', 'neck', 'head',
    'leftShoulder', 'leftUpperArm', 'leftLowerArm', 'leftHand',
    'rightShoulder', 'rightUpperArm', 'rightLowerArm', 'rightHand',
    'leftUpperLeg', 'leftLowerLeg', 'leftFoot', 'leftToes',
    'rightUpperLeg', 'rightLowerLeg', 'rightFoot', 'rightToes'
  ];

  // 标准 T-pose 兜底 rig（真实运行时由 window.EmbodiedRig 覆盖；方向语义与真机一致）
  var DEFAULT_RIG = {
    up: [0, 1, 0], lateral: [1, 0, 0], fwd: [0, 0, 1], dir: {
      hips: [0, 1, 0], spine: [0, 1, 0], chest: [0, 1, 0], upperChest: [0, 1, 0], neck: [0, 1, 0], head: [0, 1, 0],
      leftShoulder: [1, 0, 0], leftUpperArm: [1, 0, 0], leftLowerArm: [1, 0, 0], leftHand: [1, 0, 0],
      rightShoulder: [-1, 0, 0], rightUpperArm: [-1, 0, 0], rightLowerArm: [-1, 0, 0], rightHand: [-1, 0, 0],
      leftUpperLeg: [0, -1, 0], leftLowerLeg: [0, -1, 0], leftFoot: [0, 0, 1], leftToes: [0, 0, 1],
      rightUpperLeg: [0, -1, 0], rightLowerLeg: [0, -1, 0], rightFoot: [0, 0, 1], rightToes: [0, 0, 1]
    },
    // ★★ v11.22（2026-10-16，离线盲区修正）：兜底 rig **必须**带腿部尺寸 —— 否则 `legPlan()` 直接
    //   返回 null ⇒ 所有 `crouch`（蹲 / 跳的蓄力与落地缓冲）在**离线自测里静默失效**。
    //   后果是"测出来的数据与真机不是一回事"（我就是因此把"落地后腿不直"量错了位置）。
    //   取值按本机模型量测：大腿 0.42 / 小腿 0.40 / 髋→踝 0.80 / 髋离地 0.85。
    //   真机不受影响：`normaliseRig` 用 `rig.legs`（模型实测值），这个只作离线兜底。
    legs: { a: 0.42, b: 0.40, L0: 0.80, h0: 0.85 },
    hipToHead: 1.30
  };

  function normaliseRig(rig) {
    if (!rig || !rig.dir) return DEFAULT_RIG;
    return {
      up: vnorm(rig.up || DEFAULT_RIG.up),
      lateral: vnorm(rig.lateral || DEFAULT_RIG.lateral),
      fwd: vnorm(rig.fwd || DEFAULT_RIG.fwd),
      dir: rig.dir,
      legs: rig.legs || null,        // ★ 腿部尺寸要**原样带过来**：漏了它 → 蹲/跪 IK 静默失效
      hand: rig.hand || null,        // ★ 同理：手指的弯曲轴/法线/正负号也从这里过来，漏了 → 手指退化成"世界左右轴"
      hipToHead: rig.hipToHead,      //   （离线自测就是抓这个的：compose 的 rootY 一直是 0）
      // ★★ 手指的「父骨局部弯曲轴」也必须**原样带过来**。踩过的坑：这个函数是白名单，
      //   漏了 fingerAxes ⇒ compose 退回**世界轴**，而 pet.js 的应用层按"父骨局部"处理（它读的是全局
      //   EmbodiedRig.fingerAxes）⇒ 世界轴被当局部轴用 ⇒ **手指弯的方向反了**（用户实测）。
      fingerAxes: rig.fingerAxes || null,
      // ★★ v11.45：骨骼的**实测局部轴**（pet.js 量出来的"绕哪根局部轴、往哪个号转 = 抬/前/自转"）。
      //   和白名单里其它字段一个道理：**漏了它 ⇒ 下面 axisFor 拿不到 ⇒ 静默退回旧公式**
      //   （真铰链等于没接上，还查不出原因 —— fingerAxes 当年就是这么栽的）。
      axes: rig.axes || null
    };
  }

  /** 单位四元数的逆（= 共轭）。用于"抵消父级旋转"（见 compose 里腿根的骨盆抵消） */
  function qInv(q) { return [-q[0], -q[1], -q[2], q[3]]; }

  /** 是否近似恒等（只看 xyz 分量；w≈±1 即无旋转） */
  function qIsIdentity(q) { return Math.abs(q[0]) < 1e-9 && Math.abs(q[1]) < 1e-9 && Math.abs(q[2]) < 1e-9; }

  /** 四元数球面插值 a→b（t∈[0,1]）。手指的"蜷曲程度"必须走四元数插值，不能对角插值 */
  function qSlerp(a, b, t) {
    var ax = a[0], ay = a[1], az = a[2], aw = a[3];
    var bx = b[0], by = b[1], bz = b[2], bw = b[3];
    var dot = ax * bx + ay * by + az * bz + aw * bw;
    if (dot < 0) { bx = -bx; by = -by; bz = -bz; bw = -bw; dot = -dot; }   // 取短弧
    if (dot > 0.9995) {                                                   // 近乎同向 ⇒ 线性插值再归一化
      var rx = ax + (bx - ax) * t, ry = ay + (by - ay) * t, rz = az + (bz - az) * t, rw = aw + (bw - aw) * t;
      var nn = Math.sqrt(rx * rx + ry * ry + rz * rz + rw * rw) || 1;
      return [rx / nn, ry / nn, rz / nn, rw / nn];
    }
    var th0 = Math.acos(Math.max(-1, Math.min(1, dot)));
    var s0 = Math.sin(th0), s1 = Math.sin(th0 * t), s2 = Math.sin(th0 * (1 - t));
    return [ax * s2 / s0 + bx * s1 / s0, ay * s2 / s0 + by * s1 / s0,
      az * s2 / s0 + bz * s1 / s0, aw * s2 / s0 + bw * s1 / s0];
  }

  /** 求某通道此时应绕的世界轴（已归一化；返回 null 表示该通道此刻无意义） */
  function axisFor(ch, rig, bone, parentQ) {
    var def = CHANNELS[ch];
    if (!def) return null;
    var k = def.kind;

    if (k === 'x') return [1, 0, 0];
    if (k === 'y') return [0, 1, 0];
    if (k === 'z') return [0, 0, 1];

    var dRest = vnorm(rig.dir[def.bone] || DEFAULT_RIG.dir[def.bone] || [0, 1, 0]);
    var side = def.bone.indexOf('left') === 0 ? 1 : -1;     // 该骨骼属于角色哪一侧
    var flip = def.sign === -1 ? -1 : 1;                    // 少数关节（膝）正方向与默认约定相反
    var a;

    // ★★ v11.45「真铰链轴」—— 只对标了 `hingeMeasured` 的通道生效（目前**只有肘**）：
    //   用 pet.js **实测**的骨骼局部轴当铰链，而不是按静止姿势叉乘猜。
    //     旧公式 a = cross(骨骼朝向, 面朝)：手臂下垂时它 ≈ 左右轴（恰好是对的）；
    //     可一旦手臂举起来（或模型轴向不同），叉乘出来的轴会歪 ⇒ "屈肘"变成整条小臂横甩
    //     —— 用户原话："小臂直接没转，从伸直状态往上反弯折，正常人做不到，手臂会掰折"。
    //   实测轴的语义就是"绕这根局部轴往这个号转 ⇒ 子骨往抬起方向走" ⇒ 正是屈肘，
    //   且它活在**骨骼自己的局部系**里，随父级一起搬 ⇒ 手臂摆到任何角度都是真铰链 ✓
    //   拿不到实测轴（老日志/量测失败）⇒ **静默退回旧公式**，行为与以前完全一致（不会更坏）。
    if (def.hingeMeasured && rig.axes && rig.axes[def.bone] && rig.axes[def.bone].up) {
      var _ax = rig.axes[def.bone].up;
      var _av = _ax.v || null;
      if (_av && (Math.abs(_av[0]) + Math.abs(_av[1]) + Math.abs(_av[2])) > 1e-6) {
        var _as = (_ax.s < 0) ? -1 : 1;
        var _aa = qRotate(parentQ, vnorm([_av[0] * _as, _av[1] * _as, _av[2] * _as]));
        if (vlen(_aa) > 1e-6) return vnorm(_aa);          // ★ 不再乘 flip：实测轴已含正负号
      }
    }

    if (k === 'twist') {
      // 自转：绕骨骼自身长轴（用"当前方向"，父级旋转已经带上）
      a = qRotate(parentQ, dRest);
    } else {
      // 摆动 / 单轴关节（肘、膝）：**轴只在静止姿势里定一次**，再随父级一起搬走。
      // 数学上 qRotate(parent, cross(dRest, ref)) ≡ cross(qRotate(parent,dRest), qRotate(parent,ref))，
      // 所以等价于"把这根骨骼的整个参考系跟着父级搬过去" —— 父级怎么转，轴都还是那根轴。
      // 旧写法是拿"当前方向"去叉世界轴：一到特定朝向就退化、翻向（手臂抬起来以后肘就弯不对、
      // 腿一旦旋转后"抬腿"变成横向甩），**这正是"拼法很僵硬"的技术来源**。
      if (k === 'lift') { a = vcross(dRest, rig.up); if (vlen(a) < 0.25) a = vcross(dRest, vscale(rig.lateral, side)); }
      else if (k === 'fwd') { a = vcross(dRest, rig.fwd); if (vlen(a) < 0.25) a = vcross(dRest, rig.up); }
      else if (k === 'out') { a = vcross(dRest, vscale(rig.lateral, side)); if (vlen(a) < 0.25) a = vcross(dRest, rig.up); }
      else a = dRest;                                       // 兜底：当自转处理
      if (vlen(a) < 1e-6) return null;
      a = qRotate(parentQ, vnorm(a));
    }
    if (vlen(a) < 1e-6) return null;
    var axis = vnorm(a);
    return flip === 1 ? axis : vscale(axis, -1);
  }

  // ==================== 预设动作 ====================
  var PRESETS = {
    wave: { steps: [
      // ① 抬臂：整条手臂侧举到头侧（上臂 96°），肘微屈、掌心转向正面（rHandTurn 把掌面立起来）
      { pose: { rArmUp: 96, rElbowSide: -12, rHandTurn: -35, headYaw: -6 }, dur: 0.45, ease: 'out' },
      // ② 挥手：上臂也一起小摆（整条手臂在动，不是只有手腕）＋前臂主导左右摆，4 个来回
      { pose: { rArmUp: 106, rElbowSide: 30, rHandTurn: -35 }, dur: 0.20, ease: 'inout' },
      { pose: { rArmUp: 96, rElbowSide: -24, rHandTurn: -35 }, dur: 0.20, ease: 'inout' },
      { pose: { rArmUp: 106, rElbowSide: 30, rHandTurn: -35 }, dur: 0.20, ease: 'inout' },
      { pose: { rArmUp: 96, rElbowSide: -24, rHandTurn: -35 }, dur: 0.20, ease: 'inout' }
      // ③ 收尾由 compose 自动补一段"回到中性"，不会瞬跳
    ] },
    nod: { steps: [
      { pose: { headPitch: 18 }, dur: 0.25, ease: 'inout' },
      { pose: { headPitch: -4 }, dur: 0.25, ease: 'inout' },
      { pose: { headPitch: 18 }, dur: 0.25, ease: 'inout' },
      { pose: { headPitch: 0 }, dur: 0.25, ease: 'inout' }
    ] },
    // 【已移除 hands_back / heart】——"造型类"姿势（背手、比心）用角度硬凑是**做不出来的**：
    //   - 我们的肘部通道是"小臂往身前折"的启发式，手臂举起来后它就不是真正的肘铰链了（所以"大臂小臂都没弯曲好"）；
    //   - 造型需要"看着画面调"，而作者看不见画面，AI 也没有三维直觉。
    // 结论：造型类姿势走**动作资产**(VRMA/VMD，自带手指)，程序化通道只留给点头/挥手/耸肩这类单轴小动作。
    shake: { repeat: 2, steps: [
      { pose: { headYaw: 20 }, dur: 0.22, ease: 'inout' },
      { pose: { headYaw: -20 }, dur: 0.22, ease: 'inout' }
    ] },
    bow: { smooth: 0.3, steps: [
      // ★ 2026-10-16：补上手臂（原来鞠躬时手臂**全程不动** = 焊在身侧）。真人鞠躬手会随身体前倾
      //   自然向下/向前让，并有一点屈肘；起身时再回正。
      { pose: { spinePitch: 35, chestPitch: 12, headPitch: 12, lArmUp: 10, rArmUp: 10, lArmFwd: 8, rArmFwd: 8, lElbow: 14, rElbow: 14, lHandBend: 6, rHandBend: 6 }, dur: 0.55, ease: 'inout' },
      { pose: { spinePitch: 0, chestPitch: 0, headPitch: 0, lArmUp: 0, rArmUp: 0, lArmFwd: 0, rArmFwd: 0, lElbow: 0, rElbow: 0, lHandBend: 0, rHandBend: 0 }, dur: 0.55, ease: 'inout' }
    ] },
    hands_up: { smooth: 0.25, steps: [
      // ★ 2026-10-16 重做（用户："举手的时候双手跟个棍一样笔直抬上去不带动的"）：
      //   旧版只有 `lArmUp: 150`——整条手臂绕肩**刚性旋转**，肘永远是 0° ⇒ 看上去就是一根棍直上直下。
      //   真人举手有三段形态：① 起手先向外前**甩开**（肘屈得多）② 举过头（肘略伸、肩耸起、上身微后仰）
      //   ③ 到位的**余势**（肘再收一点、手臂微回）——"到位后还动一下"才是活人的样子。
      { pose: { lArmUp: 58, rArmUp: 58, lArmFwd: 14, rArmFwd: 14, lElbow: 42, rElbow: 42, lShoulderUp: 5, rShoulderUp: 5, headPitch: -4, spinePitch: -2 }, dur: 0.34, ease: 'out' },
      { pose: { lArmUp: 146, rArmUp: 146, lArmFwd: 6, rArmFwd: 6, lElbow: 22, rElbow: 22, lElbowSide: 8, rElbowSide: 8, lShoulderUp: 8, rShoulderUp: 8, headPitch: -10, spinePitch: -5 }, dur: 0.32, ease: 'out' },
      { pose: { lArmUp: 152, rArmUp: 152, lArmFwd: 2, rArmFwd: 2, lElbow: 32, rElbow: 32, headPitch: -7 }, dur: 0.18, ease: 'inout' },
      { dur: 0.26, ease: 'linear' }
    ] },
    stretch: { steps: [
      { pose: { lArmUp: 120, rArmUp: 120, lElbow: 25, rElbow: 25, spinePitch: -8, headPitch: -10 }, dur: 0.8, ease: 'inout' },
      { pose: { lArmUp: 140, rArmUp: 140, spinePitch: -12, headPitch: -12 }, dur: 0.5, ease: 'inout' },
      { pose: { lArmUp: 120, rArmUp: 120, spinePitch: -8, headPitch: -10 }, dur: 0.5, ease: 'inout' }
    ] },
    // ── 手型（手指通道落地后才有）──
    // 只动手，不动手臂 ⇒ 想"举拳呐喊"就 overlay 到 hands_up 上：
    //   { overlay: { base: 'hands_up', add: { fingers: { l:'fist', r:'fist' } } } }
    fist:       { fingers: { l: 'fist', r: 'fist' }, steps: [{ pose: {}, dur: 0.25, ease: 'out' }] },
    open_hands: { fingers: { l: 'spread', r: 'spread' }, steps: [{ pose: {}, dur: 0.25, ease: 'out' }] },
    point:      { fingers: { l: 'relaxed', r: 'point' }, steps: [{ pose: {}, dur: 0.25, ease: 'out' }] },
    thumb_up:   { fingers: { l: 'relaxed', r: 'thumb_up' }, steps: [{ pose: {}, dur: 0.25, ease: 'out' }] },
    victory:    { fingers: { l: 'relaxed', r: 'victory' },
      steps: [{ pose: { rArmUp: 46, rElbow: 66, rHandTurn: -20 }, dur: 0.4, ease: 'out' }] },
    // ★「身体 + 手指」组合演示：**抬到位 → 握拳 → 停一拍 → 松开+放下**（手指走 step.fingers + qSlerp 过渡）。
    //   触发：右键桌宠 →「动作」→「✊ 试做:伸手→握拳」，或设置面板「试做动作 → ✊ 伸手→握拳」，
    //   或控制台 window.embodiedBodyAct({ preset: 'reach_fist' })（需「具身动作」开关为开）。
    // ★★ 写"顺畅动作"的三条经验（都踩过）：
    //   ① **一个连续动作写成一段**。别把"抬一半 → 做别的 → 继续抬"拆成两段：每段各自"加速→减速到 0"，
    //      两段之间必然"刹一下再起步"（实测：抬到 63° 停一下再抬到 84°，观感很怪）。要连续就一段走完。
    //   ② 需要"停"的地方，用**空段**（只有 `dur`、不写 pose/fingers）明确表达，而不是靠相邻两段都减速。
    //   ③ 相邻段用 `ease:'inout'`；引擎另有默认 `smooth: 0.3` 的**跨段低通**兜底（`smooth: 0` 可关）。
    reach_fist: { smooth: 0.3, steps: [
      { pose: { rArmUp: 84, rArmFwd: 10, rElbow: 26, rElbowSide: 4, rHandTurn: -16, headYaw: -6, chestYaw: -5 }, dur: 0.62, ease: 'inout' },
      { fingers: { r: 'fist' }, dur: 0.30, ease: 'inout' },
      { dur: 2.00, ease: 'linear' },
      { pose: { rArmUp: 0, rArmFwd: 0, rElbow: 0, rElbowSide: 0, rHandTurn: 0, headYaw: 0, chestYaw: 0 }, fingers: {}, dur: 0.60, ease: 'inout' }
    ] },
    shrug: { steps: [
      { pose: { lArmUp: 30, rArmUp: 30, lElbow: 45, rElbow: 45, headRoll: 8 }, dur: 0.35, ease: 'out' },
      { pose: { headRoll: -8 }, dur: 0.35, ease: 'inout' },
      { pose: { headRoll: 8 }, dur: 0.35, ease: 'inout' }
    ] },
    // ★★ v11.23「敬礼」—— 示范"**大臂前抬 + 肘大幅弯曲 + 手贴额侧**"这类**接触型**姿势（约 1.1s）：
    //   ① 大臂抬到肩高并**往前 28°**（不然手够不到额头）、**肘弯到 122°**（大幅屈肘是敬礼的核心）；
    //   ② 肘弯过 95° 后，引擎会**自动把手/小臂的惯性偏移压到 60%**（防"甩过头、手穿进脸"）；
    //   ③ 末段是**空段保持**（`{ dur: 0.34 }`）：停住 ⇒ 速度/加速度项同时归零 ⇒ 手稳稳贴住。
    //   想要更精确：`{"preset":"salute","inertia":0.3}`（0=完全不用惯性）；想更潇洒（甩上去再收住）：默认即可。
    salute: { smooth: 0.15, steps: [
      // ★ v11.24：补上 `rArmTwist`（**上臂自转**）—— 这是上一版"像投降/挠头"的根因：
      //   敬礼时**肘尖要朝外（侧前方）**，而肘尖朝向由"上臂自转"决定；漏掉它 ⇒ 肘尖朝前/朝下 = 像投降。
      //   另外加了 `rShoulderUp`（抬肩）帮忙把手送到额侧。若方向反了（肘尖朝身体内侧），把 -45/-52 改成 +45/+52 即可。
      // ★ v11.26（用户："手腕弯曲方向不对（掌心向前不是向下）、大拇指也没调"）：
      //   ① **手型**：第一段带上"敬礼手" = 四指**并拢伸直**（curl 6 / spread −6）+ 拇指**内收贴掌**
      //      （thumb 60 + thumbSide −60）；末段用 `relaxed` 松回自然。段级 fingers 有黏性 ⇒ 中间段不用重写。
      //   ② **掌心朝向**：`ArmTwist` 已证实在 normalized bone 上无效（见通道表注释），这里改试
      //      **`rElbowTwist`（小臂自转）** —— 若这次仍然"没变化"，就说明小臂同样丢自转，那就只能靠
      //      造型面板里手/腕的滑条定值（`rHandBend`/`rHandSide` 是"方向"轴，可靠但那会让手腕"翘/摆"而不是"转"）。
      // ★ v11.27：举起段 `ease` 从 'out' 改 'inout'（'out' 会让**首帧**走完 ~30% 幅度 ⇒ 单帧 30°/帧，
      //   量化对照里它是"动作曲线本身"的最大跳变；inout 首帧只走 ~15% ⇒ 起手更"抬手"而不是"弹手"）。
      // ★★ v11.40（用户："手臂位置不对、幅度偏小；照着图看根本不像敬礼"）—— 用**实测**定位后
      //   发现根本不是我调的幅度问题，而是**屈肘用错了轴**：
      //   `rElbow` 的 kind 是 `fwd` = cross(骨骼朝向, 面朝)。对**侧举**的手臂这根轴是"垂直轴"
      //   ⇒ 所谓"屈肘"其实把**小臂横着往前甩**：日志实测（v11.39）敬礼保持段
      //   `右上臂 50° 右肘 145°｜手 偏外 0.82 偏前 0.68` —— 肘是折了 145°，可手跑到脸的前外侧去了。
      //   能把手往**上**折的是 `out` 轴（对左右臂它退化后会回退成 cross(朝向, 上) = 正面内折轴）⇒
      //   改用 `rElbowSide`（正数 = 小臂在正面内往上折，左右臂一致）。
      //   几何解算（上臂 L1≈0.45、小臂 L2≈0.35，太阳穴在肩上内 0.12、上 0.30）：
      //   外展 55° + 内折 135° ⇒ 手落点 (0.087, 0.308) vs 目标 (0.118, 0.298) —— 基本吻合。
      //   （若这次小臂是往**下**折的，说明这台模型的侧向约定相反 ⇒ 把 rElbowSide 的符号整体翻过来即可。）
      // ★★ v11.42（用户："小臂直接没转，而是从伸直状态往上反弯折 —— 正常人做不到，手臂会掰折"）：
      //   v11.40 我把屈肘改用 `rElbowSide`（'out' 轴）是**错的**——在手臂下垂的真实骨架上，
      //   'out' 轴会退化回 `cross(朝向, 上)` ⇒ 变成"绕前后轴翻折"＝**反关节**。
      //   真正的屈肘铰链是 `rElbow`（'fwd' 轴）：朝向≈(0,−1,0) 时它 = ±左右轴 ⇒ 小臂自然往前上方折 ✓
      //   所以回到 `rElbow` 当主屈肘，`rElbowSide` 归 0（留着只作微调用）。
      //   腕转同样归 0：规范 T-pose 下手掌本来就朝下，小臂折上去时掌心自然朝下（正是敬礼要的）。
      // ★ v11.43（用户："手指在嘴前，不在太阳穴"）：v11.42 那组的实测是
      //   `右手距头中心 0.322｜dy=-0.05 dx=0.200 dz=0.247` ⇒ 手**偏前 0.25**＝在脸前面。
      //   偏前的主要来源是 `rArmFwd`（前送 34°）：手臂长约 0.55 ⇒ 前移 ≈0.55·sin34°≈0.31。
      //   所以：前送 34 → **10**（dz 预期 0.25 → 0.07）；外展 30 → **56**（肘抬高 ⇒ dy 预期 −0.05 → +0.13）；
      //   屈肘 142 → **126**（外展已经把手送高了，再折会折过头）。
      { fingers: { r: { curl: 6, spread: -6, thumb: 60, thumbSide: -60 } }, pose: { rArmUp: 46, rArmFwd: 8, rElbow: 104, rElbowSide: 0, rHandTurn: 0, spinePitch: -2, headPitch: -3 }, dur: 0.30, ease: 'inout' },
      { pose: { rArmUp: 56, rArmFwd: 10, rElbow: 126, rElbowSide: 0, rHandTurn: 0, headPitch: -6 }, dur: 0.24, ease: 'inout' },
      { dur: 2.00, ease: 'linear' },
      // ★ v11.25 放下拆成**两段**（原来一段 0.20s 走完 96° = 4 帧 ⇒ 看着像"跳过去"）：96 → 76 → ... → 0
      // ★ v11.40：放下同样要跟着改 —— 折肘现在由 `rElbowSide` 负责（rElbow 只留一点点"往前送"）。
      { pose: { rArmUp: 30, rArmFwd: 6, rElbow: 70, rElbowSide: 0, rHandTurn: 0, headPitch: -2 }, dur: 0.20, ease: 'inout' },
      { pose: { rArmUp: 12, rArmFwd: 2, rElbow: 26, rElbowSide: 0, rHandTurn: 0, headPitch: -1 }, dur: 0.22, ease: 'inout' },
      { fingers: { r: 'relaxed' }, pose: { rShoulderUp: 0, rArmUp: 0, rArmFwd: 0, rElbow: 0, rElbowSide: 0, rHandTurn: 0, headPitch: 0, spinePitch: 0 }, dur: 0.26, ease: 'out' }
    ] },
    // ★★ v11.10/v11.11「跳」三档（2026-10-15 实测量腿长后定稿）：
    //   ① 为什么以前只能"上下浮动"：rootY / crouch 曾是**整段常量**；现在两者都**逐段**给。
    //   ② 为什么"屈膝幅度小、没用力"：只写 crouch 不给 rootY 时，v11.11 起**胯会跟着腿部解算一起下沉**
    //      （不然就是"腿按深蹲角度弯、胯只降几厘米"= 被吊着弯腿）。
    //   本机实测（大腿 0.42 / 小腿 0.40 / 髋→踝 0.80）：
    //     crouch 0.35 → 膝屈 ~66°、下沉 ~24cm ｜ 0.6 → 膝 ~100°、下沉 42cm
    //     0.8 → 膝 ~121°、下沉 56cm        ｜ 1.0 → 膝 ~141°、下沉 70cm（动漫式深蹲：脚跟贴屁股）
    //   调参：跳更高 ⇒ 加腾空段的 rootY（±0.6 内；本机 0.3 ≈ 30cm 已很夸张）；跳更慢 ⇒ 所有 dur × 1.3。
    // ★★ v11.13「真实跳的曲线」重做（用户："用力跳跟个弹簧一样，起跳加落地都太不自然"）：
    //   旧版的病根有三条，全部对症改掉 ——
    //   ① **平顶悬停**：我把"上升"和"滞空"写成两段等高位（0.22s 停在空中）＝ 反重力，看着就像被吊着；
    //      真实抛物线只有**一瞬**的顶点。现在改成 上升(ease out 减速) → 顶点只留 0.07~0.08s → 下落单段(ease in 加速)。
    //   ② **幅度过大**：旧版胯从 -0.666 冲到 +0.34（1.0m ≈ 43% 身高）在 0.18s 内完成 ⇒ 弹射感。
    //      现在峰值 0.22（≈10% 身高），用时 0.13s，仍够醒目但不像弹簧。
    //   ③ **落地太深太慢**：旧版 crouch 0.78 / 0.26s（像弹簧压缩）。现在触地只到 0.52、0.12s，然后**慢慢**站起。
    //   另外把 smooth 降到 0.08（跨段低通会把"蹬地"抹圆）并给 tau=0.025（输出平滑更跟手，保住爆发力）。
    jump: { smooth: 0.12, tau: 0.04, steps: [
      // ★★ v11.17 手臂重做（用户："小臂完全跟大臂黏一块，没有正常的摆动惯性"）：
      //   旧版只写 `ArmUp`（6→40°）+ 很小的 `Elbow`（14~26°）与 `ArmFwd`（-16→+10）⇒
      //   整条手臂只在**侧向抬起**、小臂相对大臂几乎不动 = 棍。真人跳跃的手臂是**大幅前后摆 + 大幅屈肘**：
      //   蓄力时手往后下方收（后摆 45°、肘屈 70°）→ 蹬地时向前上**甩开**（前摆 32°、肘甩到 22°）
      //   → 腾空微屈 → 下落肘再屈起来 → 落地屈到 65° 吸收冲击。范围 22~70°（旧版 14~26°）。
      // 轻快蹦 ≈ 1.0s：浅蓄力 → 蹬直+手前甩 → 空中轻收腿 → 顶点一瞬 → 伸腿下落 → 浅缓冲 → 回站
      { pose: { spinePitch: 10, headPitch: 6, lArmUp: 8, rArmUp: 8, lArmFwd: -45, rArmFwd: -45, lElbow: 70, rElbow: 70 }, crouch: 0.6, dur: 0.22, ease: 'out' },
      { pose: { spinePitch: 13, headPitch: 8 }, dur: 0.04, ease: 'linear' },
      { pose: { spinePitch: -5, headPitch: -8, lArmUp: 34, rArmUp: 34, lArmFwd: 32, rArmFwd: 32, lElbow: 22, rElbow: 22, lLegFwd: 0, rLegFwd: 0, lKnee: 0, rKnee: 0 }, rootY: 0.09, crouch: 0.02, dur: 0.15, ease: 'in' },
      { pose: { lArmUp: 48, rArmUp: 48, lArmFwd: 18, rArmFwd: 18, lElbow: 30, rElbow: 30, lLegFwd: 46, rLegFwd: 44, lKnee: 88, rKnee: 84, lAnkle: 20, rAnkle: 20 }, rootY: 0.16, crouch: 0, dur: 0.18, ease: 'in' },
      { pose: { lLegFwd: 40, rLegFwd: 38, lKnee: 76, rKnee: 72 }, rootY: 0.18, crouch: 0, dur: 0.05, ease: 'inout' },
      { pose: { spinePitch: 6, lArmUp: 22, rArmUp: 22, lArmFwd: -2, rArmFwd: -2, lElbow: 48, rElbow: 48, lLegFwd: 10, rLegFwd: 10, lKnee: 22, rKnee: 22, lAnkle: 8, rAnkle: 8 }, rootY: 0.03, crouch: 0, dur: 0.16, ease: 'in' },
      { pose: { spinePitch: 8, lArmUp: 12, rArmUp: 12, lArmFwd: -22, rArmFwd: -22, lElbow: 65, rElbow: 65 }, crouch: 0.40, dur: 0.12, ease: 'out' },
      { pose: { spinePitch: 0, headPitch: 0, lArmUp: 0, rArmUp: 0, lArmFwd: 0, rArmFwd: 0, lElbow: 0, rElbow: 0, lLegFwd: 0, rLegFwd: 0, lKnee: 0, rKnee: 0, lAnkle: 0, rAnkle: 0 }, crouch: 0, dur: 0.16, ease: 'out' }
    ] },
    // 全力深蹲跳（动漫里那种"脚跟贴屁股"的蓄力）：膝屈 ~135°、自动下沉 ~66cm；手臂后收 → 上甩；落地深缓冲 ≈ 1.6s
    // 全力深蹲跳 ≈ 1.36s（动漫式蓄力）：慢蹲到底(0.42s) → **在最低点顿一下**(0.07s，真实的蓄势) →
    // 蹬地快速加速上升(0.13s, ease in) → 顶点只是一瞬(0.08s) → 加速下落(0.12s) → 触地浅快缓冲(0.12s, crouch 0.52)
    // → 缓慢站起(0.42s，有分量)。peak 只到 0.22（≈10% 身高）：够醒目，但不像弹簧。
    jump_power: { smooth: 0.06, tau: 0.04, steps: [
      // ① 蓄力：蹲到"踝允许的最深"（膝 ~58°、下沉 ~18cm）＋**手臂大幅后摆 + 大幅屈肘**（真人下蹲时手往后下方收）
      { pose: { spinePitch: 20, headPitch: 12, lArmUp: 4, rArmUp: 4, lArmFwd: -55, rArmFwd: -55, lElbow: 80, rElbow: 80, lShoulderUp: -4, rShoulderUp: -4 }, crouch: 0.85, dur: 0.34, ease: 'inout' },
      { pose: { spinePitch: 24, headPitch: 15, lElbow: 84, rElbow: 84 }, dur: 0.06, ease: 'linear' },
      // ③ 蹬地：腿蹬直 + **手臂向前上甩**（肘略伸、肩略提）—— 0.16s（别再 2 帧搞定，20fps 下那叫"弹"）
      { pose: { spinePitch: -8, headPitch: -10, lArmUp: 52, rArmUp: 52, lArmFwd: 38, rArmFwd: 38, lElbow: 24, rElbow: 24, lShoulderUp: 6, rShoulderUp: 6, lLegFwd: 0, rLegFwd: 0, lKnee: 0, rKnee: 0, lAnkle: 0, rAnkle: 0 }, rootY: 0.11, crouch: 0.02, dur: 0.18, ease: 'in' },
      // ④ 腾空**收腿**（提膝 + 小腿折叠）：`ease:'inout'` 很关键 —— 用 'out' 的话首帧就吃掉 48% 幅度
      //   （实测首帧 3°→44° = 41°/帧，看着就是"腿弹一下"）。改 inout + 0.22s 后首帧只走 20%。
      { pose: { spinePitch: -4, lArmUp: 76, rArmUp: 76, lArmFwd: 20, rArmFwd: 20, lElbow: 34, rElbow: 34, lLegFwd: 54, rLegFwd: 50, lKnee: 100, rKnee: 96, lAnkle: 24, rAnkle: 24 }, rootY: 0.22, crouch: 0, dur: 0.22, ease: 'in' },
      { pose: { lLegFwd: 50, rLegFwd: 46, lKnee: 94, rKnee: 90 }, rootY: 0.24, crouch: 0, dur: 0.06, ease: 'inout' },
      // ⑥ 下落：腿伸出去（0.20s、膝只回到 30°）+ 手臂下放、肘屈起来准备缓冲
      { pose: { spinePitch: 6, lArmUp: 34, rArmUp: 34, lArmFwd: -4, rArmFwd: -4, lElbow: 54, rElbow: 54, lLegFwd: 18, rLegFwd: 18, lKnee: 30, rKnee: 30, lAnkle: 12, rAnkle: 12 }, rootY: 0.06, crouch: 0, dur: 0.20, ease: 'in' },
      // ⑦ 触地缓冲（浅：crouch 0.42；手臂到前下方）
      { pose: { spinePitch: 14, lArmUp: 16, rArmUp: 16, lArmFwd: -26, rArmFwd: -26, lElbow: 75, rElbow: 75 }, crouch: 0.42, dur: 0.14, ease: 'out' },
      // ⑧ 缓慢站起（两段，更"沉"、不像弹簧）
      { pose: { spinePitch: 5, lArmUp: 8, rArmUp: 8, lArmFwd: -6, rArmFwd: -6, lElbow: 20, rElbow: 20 }, crouch: 0.16, dur: 0.22, ease: 'inout' },
      { pose: { spinePitch: 0, headPitch: 0, lArmUp: 0, rArmUp: 0, lArmFwd: 0, rArmFwd: 0, lElbow: 0, rElbow: 0, lShoulderUp: 0, rShoulderUp: 0, lLegFwd: 0, rLegFwd: 0, lKnee: 0, rKnee: 0, lAnkle: 0, rAnkle: 0 }, crouch: 0, dur: 0.20, ease: 'out' }
    ] },
    // 连蹦两下（≈1.6s）：第一跳 → 落地**只做浅缓冲、不回中性** → 直接接第二跳（略高）→ 最后才落地回站。
    //   这就是"多次跳的流畅衔接"的现成答案：不用 chain，内部一段写完，中间不经过"站定"。
    jump_x2: { smooth: 0.12, tau: 0.03, steps: [
      // 第一跳（蓄力 ~12cm、空中轻收腿）
      // ★ v11.17：连蹦的手臂同样要有"大幅后摆 + 甩开 + 屈肘缓冲"，否则两跳都像棍
      { pose: { spinePitch: 12, headPitch: 6, lArmUp: 6, rArmUp: 6, lArmFwd: -40, rArmFwd: -40, lElbow: 65, rElbow: 65 }, crouch: 0.6, dur: 0.20, ease: 'out' },
      { pose: { spinePitch: -5, headPitch: -8, lArmUp: 30, rArmUp: 30, lArmFwd: 28, rArmFwd: 28, lElbow: 22, rElbow: 22, lLegFwd: 0, rLegFwd: 0, lKnee: 0, rKnee: 0 }, rootY: 0.10, crouch: 0.02, dur: 0.09, ease: 'in' },
      { pose: { lArmUp: 40, rArmUp: 40, lArmFwd: 16, rArmFwd: 16, lElbow: 30, rElbow: 30, lLegFwd: 46, rLegFwd: 44, lKnee: 88, rKnee: 84, lAnkle: 20, rAnkle: 20 }, rootY: 0.15, crouch: 0, dur: 0.11, ease: 'out' },
      { pose: { spinePitch: 6, lArmUp: 18, rArmUp: 18, lElbow: 44, rElbow: 44, lLegFwd: 10, rLegFwd: 10, lKnee: 20, rKnee: 20 }, rootY: 0.03, crouch: 0, dur: 0.08, ease: 'in' },
      { pose: { spinePitch: 9, lArmUp: 10, rArmUp: 10, lArmFwd: -20, rArmFwd: -20, lElbow: 58, rElbow: 58 }, crouch: 0.42, dur: 0.08, ease: 'out' },
      // 第二跳（略高，蓄力也略深）
      { pose: { spinePitch: 10, headPitch: 5, lArmFwd: -42, rArmFwd: -42, lElbow: 70, rElbow: 70 }, crouch: 0.66, dur: 0.13, ease: 'out' },
      { pose: { spinePitch: -6, headPitch: -9, lArmUp: 34, rArmUp: 34, lArmFwd: 30, rArmFwd: 30, lElbow: 22, rElbow: 22, lLegFwd: 0, rLegFwd: 0, lKnee: 0, rKnee: 0 }, rootY: 0.12, crouch: 0.02, dur: 0.09, ease: 'in' },
      { pose: { lArmUp: 46, rArmUp: 46, lArmFwd: 18, rArmFwd: 18, lElbow: 32, rElbow: 32, lLegFwd: 50, rLegFwd: 48, lKnee: 96, rKnee: 92, lAnkle: 22, rAnkle: 22 }, rootY: 0.17, crouch: 0, dur: 0.11, ease: 'out' },
      { pose: { spinePitch: 6, lArmUp: 20, rArmUp: 20, lElbow: 46, rElbow: 46, lLegFwd: 10, rLegFwd: 10, lKnee: 20, rKnee: 20 }, rootY: 0.03, crouch: 0, dur: 0.08, ease: 'in' },
      { pose: { spinePitch: 9, lArmUp: 12, rArmUp: 12, lArmFwd: -22, rArmFwd: -22, lElbow: 60, rElbow: 60 }, crouch: 0.45, dur: 0.09, ease: 'out' },
      { pose: { spinePitch: 0, headPitch: 0, lArmUp: 0, rArmUp: 0, lArmFwd: 0, rArmFwd: 0, lElbow: 0, rElbow: 0, lLegFwd: 0, rLegFwd: 0, lKnee: 0, rKnee: 0, lAnkle: 0, rAnkle: 0 }, crouch: 0, dur: 0.16, ease: 'out' }
    ] },
    // 欢呼跳（被夸 / 加油时）：双臂高举着跳，蓄力浅、滞空久一点；v11.35 落地补"缓冲+反弹" ≈ 1.63s
    // ★ v11.36（用户："后半部分依旧没有闪到、直接放下了"）：落地三段其实都在（日志 #7/#8/#9 可证），
    //   但 `smooth 0.12` 的**段间平滑**比反弹段（0.13s）还宽 ⇒ 三段被平均成一团糊 ⇒ 视觉上"直接放下"。
    //   对照组 jump_power（能看清蹲）平滑只有 0.06。现在：平滑降到 0.05 + 反弹段加长到 0.16/0.15s。
    jump_joy: { smooth: 0.05, tau: 0.03, steps: [
      // ★ v11.17：欢呼跳的手也补上前后摆与屈肘起伏（手举着不动同样是"棍"）
      // ★★ v11.40（用户："两个动作都更差了，举手也太夸张"）：轴修好之前，`ArmUp` 的"度数"是被
      //   退化轴打折的（实测请求 88° 只得到 ~50° 的效果）⇒ 轴一修好，同一组数字就变成了
      //   "手臂举过头顶"（截图里双手在头顶交叉）。所以整体**收回 15~22°**，`ArmFwd` 也同步收。
      { pose: { spinePitch: 6, headPitch: -4, lArmUp: 84, rArmUp: 84, lArmFwd: -12, rArmFwd: -12, lArmTwist: -20, rArmTwist: -20, lElbow: 50, rElbow: 50 }, crouch: 0.6, dur: 0.24, ease: 'out' },
      { pose: { lArmUp: 94, rArmUp: 94, lArmFwd: 20, rArmFwd: 20, lArmTwist: -32, rArmTwist: -32, lElbow: 32, rElbow: 32 }, dur: 0.05, ease: 'linear' },
      // ★ v11.24 修（用户截图：举手时"双手在头两侧、肘朝外"像投降）—— 改成**前上方**举：
      //   `ArmUp` 118~126（不再 140~158 的侧向高举）+ `ArmFwd` 36~42（明确往身前送）
      //   + `ArmTwist` −38~−42（掌心朝前、肘尖朝前下）。放下时这两项**一起递减** ⇒ 手臂是
      //   "先前下、再侧下"地放回，而不是贴着侧面划下来（那一路都是"肘朝外"）。
      { pose: { lArmUp: 98, rArmUp: 98, lArmFwd: 24, rArmFwd: 24, lArmTwist: -38, rArmTwist: -38, headPitch: -8, lElbow: 30, rElbow: 30, lLegFwd: 0, rLegFwd: 0, lKnee: 0, rKnee: 0 }, rootY: 0.11, crouch: 0.02, dur: 0.11, ease: 'in' },
      // ★ v11.41（用户："落地的时候腿还往前踢"）：空中收腿原本是"大腿前摆 48° + 屈膝 94°"，
      //   落地时腿要从这个姿势跨回伸直状态，再叠上 22°/帧的腿部限速 ⇒ 那一下看着就是"踢一脚"。
      //   收到"前摆 26° + 屈膝 56°"：腿只是轻轻收，落地前后都自然，也不会再顶到限速。
      { pose: { lArmUp: 104, rArmUp: 104, lArmFwd: 26, rArmFwd: 26, lArmTwist: -42, rArmTwist: -42, lElbow: 26, rElbow: 26, lLegFwd: 26, rLegFwd: 24, lKnee: 56, rKnee: 52, lAnkle: 12, rAnkle: 12 }, rootY: 0.19, crouch: 0, dur: 0.12, ease: 'out' },
      { pose: { lArmUp: 100, rArmUp: 100, lArmFwd: 22, rArmFwd: 22, lArmTwist: -40, rArmTwist: -40, lElbow: 30, rElbow: 30, lLegFwd: 20, rLegFwd: 18, lKnee: 44, rKnee: 40 }, rootY: 0.21, crouch: 0, dur: 0.05, ease: 'inout' },
      { pose: { lArmUp: 88, rArmUp: 88, lArmFwd: 10, rArmFwd: 10, lArmTwist: -30, rArmTwist: -30, lElbow: 38, rElbow: 38, lLegFwd: 6, rLegFwd: 6, lKnee: 12, rKnee: 12 }, rootY: 0.04, crouch: 0, dur: 0.10, ease: 'in' },
      // ★★ v11.35 修（用户："跳的后半部分没有闪到、直接放下了"）—— 病根是**落地只有 2 帧**：
      //   原来落地缓冲 crouch 0.45 / dur 0.10s（20fps 下仅 2 帧）⇒ 视觉上"落地瞬间就站好"，
      //   手臂紧接着就往下放 = "闪一下直接放下"。现在按 squash & stretch 补全落地三段：
      //   ① 深蹲缓冲（squash，看得见的"咚"）：加深 0.55、加长到 0.13s；
      //   ② **落地反弹**（stretch，之前整段缺失）：蓄下去弹回来一次，手还举着；
      //   ③ 二次小幅沉降（能量衰减）：比①浅，让落地有"弹两下"的物理感，之后才收手。
      // ★★ v11.43（用户："不是把屈膝回到站直的状态不就完事了吗？非得往前踢干什么"）——
      //   "踢腿"的根源是**蹲的解析 IK**：`crouch 0.55` 会顺带把**大腿前摆 ~35°**（真深蹲本该这样），
      //   可跳跃落地时大腿往前摆，看起来就是踢一脚。所以落地**彻底不用 crouch**，改成三样手写：
      //     ① 屈膝用 `lKnee/rKnee` 直接给（crouch=0 ⇒ 混合权重 w=cNow×1.6=0 ⇒ 手写值 100% 生效）；
      //     ② 胯的下沉用 `rootY` 手写（蹲多深我给，不再由 IK 决定）；
      //     ③ 脚掌贴地靠 `lAnkle`。
      //   ⇒ 大腿全程停在落地前的 6°，只有"屈膝缓冲 → 站直"，正是你要的效果；收膝快慢也完全可控。
      { pose: { lArmUp: 82, rArmUp: 82, lArmFwd: 8, rArmFwd: 8, lArmTwist: -24, rArmTwist: -24, lElbow: 50, rElbow: 50, lKnee: 68, rKnee: 64, lAnkle: 24, rAnkle: 24 }, rootY: -0.26, crouch: 0, dur: 0.12, ease: 'out' },
      { pose: { lArmUp: 86, rArmUp: 86, lArmFwd: 12, rArmFwd: 12, lArmTwist: -28, rArmTwist: -28, lElbow: 42, rElbow: 42, lKnee: 24, rKnee: 22, lAnkle: 8, rAnkle: 8 }, rootY: -0.06, crouch: 0, dur: 0.09, ease: 'out' },
      { pose: { lArmUp: 80, rArmUp: 80, lArmFwd: 6, rArmFwd: 6, lArmTwist: -22, rArmTwist: -22, lElbow: 48, rElbow: 48, lKnee: 0, rKnee: 0, lAnkle: 0, rAnkle: 0 }, rootY: 0, crouch: 0, dur: 0.09, ease: 'inout' },
      // ★ v11.24 修（用户："放下时小臂扭曲弯曲幅度不自然，相比大臂很不自然"）：
      //   ① 这一段原来**没写肘** ⇒ 黏性保持 62° ⇒ 大臂放到 60° 了、肘还是 62° = 两者不同步；
      //   ② 末段也**没写肘** ⇒ 动作结束时肘停在 44° 左右（手臂放下了、肘还弯着 = 看着"扭"）。
      //   现在肘跟随大臂一起放（62 → 42 → 0），且与 `lArmFwd` 一起回正。
      // ★★ v11.38（用户："换了个模型后，落地之后还是等了一小会才把弯曲的膝盖放平"）——
      //   反弹看得见了，代价是**弯膝时间变长**：落地后 0.44s 才放平 + 22°/帧的腿部限速 ⇒ 合计 0.85s
      //   膝盖一直是弯的（真人落地后 ~0.2s 就站直了）。现在两件事一起做：
      //   ① 沉降段收短（0.30/0.10s → 0.20/0.10s）、收尾段 0.24+0.20s → **0.12+0.14s**；
      //   ② 收尾两段**显式写膝值**（22 → 0）—— 不写的话膝只能靠 crouch 解算拖着走，
      //      黏性值会让它赖在弯着的角度上（v11.22 就栽在这：末帧膝停在 43~55°）。
      // ★★ v11.40「膝与手解耦」（用户："还有大半过程没放下去呢，直接就闪到放下去的状态了"）：
      //   v11.38 为了治"膝放平慢"把收尾压到 0.12+0.14s ⇒ **手臂也只用了 0.26s 落下来** ⇒
      //   视觉上就是"闪一下直接放下"。膝盖与手臂本来就该分开走：
      //   ① 收尾A（0.12s）：**先把膝放平**（22→0 在下一段完成），手臂几乎不动（还举着 76°）；
      //   ② 收尾B（0.20s）：膝已平，手臂从 76 → 58（crouch 已归零）；
      //   ③ 收尾C（0.22s）：手臂 58 → 0 —— 合计 **0.42s 放手臂**，够看清"放下去"的过程。
      { pose: { lArmUp: 76, rArmUp: 76, lArmFwd: 4, rArmFwd: 4, lArmTwist: -20, rArmTwist: -20, lElbow: 46, rElbow: 46 }, crouch: 0, dur: 0.09, ease: 'out' },
      { pose: { lArmUp: 58, rArmUp: 58, lArmFwd: -6, rArmFwd: -6, lArmTwist: -14, rArmTwist: -14, lElbow: 34, rElbow: 34, lKnee: 0, rKnee: 0 }, crouch: 0, dur: 0.20, ease: 'inout' },
      { pose: { lArmUp: 0, rArmUp: 0, lArmFwd: 0, rArmFwd: 0, lArmTwist: 0, rArmTwist: 0, lElbow: 0, rElbow: 0, headPitch: 0, spinePitch: 0, lLegFwd: 0, rLegFwd: 0, lKnee: 0, rKnee: 0, lAnkle: 0, rAnkle: 0 }, crouch: 0, dur: 0.22, ease: 'out' }
    ] }
  };

  function deg2rad(d) { return d * Math.PI / 180; }

  function ease(t, kind) {
    if (kind === 'linear') return t;
    if (kind === 'in') return t * t;
    if (kind === 'out') return 1 - (1 - t) * (1 - t);
    return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;   // inout（默认）
  }

  // 对外可见的通道名（面板滑块、给 AI 的通道清单、spec 校验器都用它）
  //   ★ v11.17：过滤 `_` 开头的**内部联动通道** —— 那些由 compose 自己写，AI/用户不该看见、更不该传。
  function channelNames() { return Object.keys(CHANNELS).filter(function (k) { return k.charAt(0) !== '_'; }); }

  // 骨骼 → 落在它身上的通道（顺序稳定 = CHANNELS 声明顺序）
  var BY_BONE = (function () {
    var m = {};
    for (var ch in CHANNELS) { var b = CHANNELS[ch].bone; (m[b] || (m[b] = [])).push(ch); }
    return m;
  })();

  // ── 蹲 / 跪：腿部解析 IK（矢状面两连杆）────────────────────────────────────
  // 为什么非要"联立解"：单弯膝 → 脚离地；单降骨盆 → 悬空反关节。
  // 「骨盆降到哪」和「膝屈多少」是同一个三角形的两个量，手调三个滑块永远对不上 ——
  // 这就是"调节不了膝盖、做不到蹲"的真正原因（不是缺膝盖通道）。
  //
  // 侧视几何（脚尖朝前）：
  //      髋窝 O
  //        │ a（大腿）
  //        K ← 膝往前
  //        │ b（小腿）
  //      踝 A（保持在 O 正下方；脚掌保持水平）
  //   L = O 到 A 的竖直距离（骨盆下沉 d 后 = L0 - d）
  //   cos α = (a²+L²-b²)/(2aL)  → 大腿前摆 α
  //   cos θ = (a²+b²-L²)/(2ab)  → 膝屈 fold = π - θ
  //   小腿在世界里的前倾角 shin = α - fold（负 = 向后倾）
  //   → 腿前摆 = α、膝屈 = fold、脚踝勾 = -shin（抵消小腿转动，脚掌保持水平）
  /** 两连杆解：给定 a、b 与髋→踝竖直距离 L，返回大腿角/膝屈角/小腿世界角（弧度） */
  function solveKnee(a, b, L) {
    L = Math.max(Math.abs(a - b) + 1e-4, Math.min(a + b - 1e-4, L));
    var cosA = Math.max(-1, Math.min(1, (a * a + L * L - b * b) / (2 * a * L)));
    var cosT = Math.max(-1, Math.min(1, (a * a + b * b - L * L) / (2 * a * b)));
    var alpha = Math.acos(cosA);
    var fold = Math.PI - Math.acos(cosT);
    return { alpha: alpha, fold: fold, shin: alpha - fold };
  }

  /**
   * 「蹲 / 跪」→ { rootY, legs }。legs 是腿部通道值（度），rootY 是骨盆下沉量（世界单位）。
   *   spec.crouch 0~1：下蹲深度（**脚原地不动**，膝盖自己弯到对应的角度）
   *   spec.kneel  0~1：跪姿（骨盆降到"膝刚好触地"，小腿向后放平；脚保持站立朝向 = 脚尖点地的跪姿）
   *   rig.legs = { a, b, L0, h0 }（由 pet.js 加载时实测；量不到 → 返回 null，退回旧的"裸降骨盆"行为）
   * 以"站立解（d=0）"为零位基准再相减 ⇒ **0 蹲 = 完全等于原本站姿**，不会写乱基准。
   */
  function legPlan(spec, rig) {
    var lg = rig && rig.legs;
    if (!lg || !(lg.a > 0.01) || !(lg.b > 0.01) || !(lg.L0 > 0.01)) return null;
    var crouch = Math.max(0, Math.min(1, +(spec.crouch || 0)));
    // ★ v11.10：逐段 crouch（跳跃的"蓄力弯腿 / 腾空伸直 / 落地缓冲"）也要能触发腿部解算。
    // ★★ v11.11 修正（实测抓到的 bug）：逐段模式下 plan 必须按**满值 crouch=1** 解算 ——
    //   因为帧循环里还会再乘该段的 crouch 比例（`plan.rootY × cTarget` / `plan.legs × cNow`）。
    //   旧写法在这里取"最深的那一段"生成 plan ⇒ **双重缩放**：蓄力段 crouch 0.35 实际只降了 8.6cm
    //   （应为 24.5cm），观感就是"屈膝幅度小、没使劲" —— 正是用户报的那个。
    var perStepCrouch = false;
    if (crouch <= 0.001 && Array.isArray(spec.steps)) {
      for (var csI = 0; csI < spec.steps.length; csI++) {
        if (spec.steps[csI] && spec.steps[csI].crouch !== undefined) { perStepCrouch = true; break; }
      }
      if (perStepCrouch) crouch = 1;
    }
    var kneel = Math.max(0, Math.min(1, +(spec.kneel || 0)));
    if (!(crouch > 0.001) && !(kneel > 0.001)) return null;
    var a = lg.a, b = lg.b, L0 = lg.L0;
    var h0 = (lg.h0 > 0.05) ? lg.h0 : L0;                 // 髋窝离地高（用于跪姿目标高度）
    var rest = solveKnee(a, b, L0);                       // 站立解 = 零位基准
    var drop = 0, pos = rest;
    if (kneel > 0.001) {
      // 跪：把髋降到"膝刚好触地"的高度（大腿近乎竖直、略前倾），小腿从竖直转到水平向后。
      // 角度一律**从站姿解插值到全跪解**（而不是"从 0 起算的绝对角"）：
      //   站姿本身就带一点微屈，用绝对角会在 kneel 很小时把膝盖**反向掰直**（实测 -20.9°）。
      var phiK = deg2rad(10);                                     // 全跪时大腿前倾角
      var hsKneel = Math.min(h0, a * Math.cos(phiK));             // 全跪时髋离地高（膝触地）
      var hsNow = h0 - kneel * Math.max(0, h0 - hsKneel);
      // ★ 下沉量**必须**来自插值后的髋高 hs；绝不能用 a·cos(phi) 反推 —— 站立时髋高(1.4)比大腿长(0.6)大，
      //   acos(hs/a) 超范围被夹成 0 ⇒ 一拨滑杆就"髋降到 a"= 直接栽下去、腿还是直的（实测 83.3cm / 膝屈 0°）。
      drop = Math.max(0, h0 - hsNow);
      var foldAll = phiK + Math.PI / 2;                           // 全跪时膝屈（小腿放平）
      var alphaK = rest.alpha + (phiK - rest.alpha) * kneel;
      var foldK = rest.fold + (foldAll - rest.fold) * kneel;
      pos = { alpha: alphaK, fold: foldK, shin: alphaK - foldK };
    } else {
      // 蹲：按深度缩短"髋→踝"距离，脚不动；留 10% 余量，避免解到完全折叠（那里腿朝向会翻）
      var maxDrop = Math.max(0, L0 - Math.abs(a - b) - 1e-3);
      var dropWanted = crouch * maxDrop * 0.9;
      // ★★ v11.14「踝背屈极限」——治用户 2026-10-15 报的"蓄力像踩棉花、整个人往下陷"：
      //   脚贴地时蹲越深，小腿越向后倾 ⇒ 踝背屈越大；crouch=0.95 会解出 **lAnkle 78°**，
      //   而正常人踝背屈只有 ~30°。超过它就不是"蹲"，而是"把脚折进腿里"（髋几乎贴地 = 陷下去）。
      //   这里按"踝不超限"反推真正能用的最大下沉量（二分 24 次，一次性开销可忽略）。
      //   想要更深的蹲，只能用别的手段表达（提踵 / 空中收腿），不能靠把踝掰过去。
      var ANKLE_MAX = deg2rad(32);
      var dLo = 0, dHi = Math.max(dropWanted, maxDrop * 0.9);
      for (var bci = 0; bci < 24; bci++) {
        var dMid = (dLo + dHi) / 2;
        var psMid = solveKnee(a, b, L0 - dMid);
        if (Math.abs(psMid.shin - rest.shin) <= ANKLE_MAX) dLo = dMid; else dHi = dMid;
      }
      // ★★ 用"踝允许的最大深度"**重新标定 crouch 的 0~1 刻度**：crouch=1 就是"脚不离地能蹲到的最深"。
      //   否则所有 ≥0.3 的取值都会顶到同一个上限（实测：0.3/0.45/0.6/0.8/1.0 全变成 0.207m），
      //   浅蹲就再也表达不出来了。
      drop = crouch * dLo;
      pos = solveKnee(a, b, L0 - drop);
    }
    var R = 180 / Math.PI;
    var legFwd = (pos.alpha - rest.alpha) * R;
    var knee = (pos.fold - rest.fold) * R;
    var ankle = -(pos.shin - rest.shin) * R;              // 抵消小腿转动 ⇒ 脚掌保持水平
    return {
      rootY: -drop,
      legs: {
        lLegFwd: legFwd, rLegFwd: legFwd,
        lKnee: knee, rKnee: knee,
        lAnkle: ankle, rAnkle: ankle
      },
      info: { drop: drop, legFwd: legFwd, knee: knee, ankle: ankle }
    };
  }

  // ==================== 手指（VRM 标准 15 骨/手）====================
  // 设计取舍：**不给 30 个通道**。通道表会直接变成面板上一长条滑块，把可用性毁掉。
  // 只暴露"整体握/张 + 逐指微调"这几个数，由引擎展开成每根手指三节的旋转：
  //   spec.fingers = { l: 'fist' | { curl:100, index:0, spread:20 }, r: 'open' }   ← 起始/整段手型
  //   step.fingers = 同上（逐段覆盖）⇒ 支持"先伸手、再握拳"这类**先后顺序**，且手指有**过渡**（slerp）。
  //   例：steps:[{pose:{rArmUp:60},dur:0.4,ease:'out'}, {fingers:{r:'fist'},dur:0.3,ease:'out'}]
  // 轴向**不手工校准**：由 pet.js 加载时量出「弯曲轴 + 正方向」（rig.hand），换模型自动适配，
  // 和手臂/腿一样的路子（人工校准过一次，结果是左右手反着弯）。
  var FINGER_NAMES = ['thumb', 'index', 'middle', 'ring', 'little'];
  var FINGER_SUF = ['Proximal', 'Intermediate', 'Distal'];
  var FINGER_BONES = {};                 // side → [ [thumb3], [index3], ... ]
  (function () {
    ['left', 'right'].forEach(function (side) {
      FINGER_BONES[side] = FINGER_NAMES.map(function (f) {
        var cap = f.charAt(0).toUpperCase() + f.slice(1);
        return FINGER_SUF.map(function (s) { return side + cap + s; });
      });
    });
  })();
  // 三节分摊比例 ≈ 真人 MCP 90° / PIP 95° / DIP 65° 的占比（合起来 1.00）。
  // ★ 旧值 [0.45,0.35,0.20] 太偏"近节"，指尖那节几乎不弯 ⇒ 握拳看着像"龙抓手"。
  var FINGER_SEG = [0.36, 0.38, 0.26];

  // 手型库。curl = 该指**三节总弯曲度数**（真人：MCP≈90 + PIP≈95 + DIP≈65 ⇒ 握拳约 250~260）；
  //   spread = 张开 0~40；逐指键名（thumb/index/...）= 该指的**总弯曲**，优先于 curl。
  //   ⚠ 缺骨的手指会自动把弯曲**重新分摊**到存在的节上（见 fingerJoints），不丢角度。
  // ⚠ 比心 / OK 这类**造型**故意不放进来：它们要逐指的精细角度，手写必然走形（历史教训：
  //   「造型类姿势用角度硬凑是做不出来的」）。请让用户在造型面板里摆好 → 存成预设 →
  //   AI 之后用 <bodyact preset="比心"/> 就行。
  var HAND_SHAPES = {
    open:     { curl: 0 },
    relaxed:  { curl: 30 },
    half:     { curl: 130, thumbSide: -20 },
    // ★★ 拇指：值只是"三节合计的弯曲量"，真正决定观感的是**轴**。2026-10-13 修好了拇指轴
    //   （原代码让拇指沿用四指的"指根连线"= 内收/外展 ⇒ 用户实测"只能横向移动、不像四指那样卷，
    //     而且越转越远离掌心"）。**轴一改，按旧轴调出来的 120/125/130 就过头了**：
    //   离线按几何判据（绕轴转到多少度时"拇指尖↔食指根"最近）算：30~60° 在最近区，90° 起翻过头。
    //   ⇒ 三个"拇指收拢"的手型统一取 **60**（fist 原 120 / point 原 130 / victory 原 125）。
    //   ⚠ 若真机上仍嫌不够或过头：用**造型面板的拇指滑块**（0~130）找到合适值告诉我，
    //     判据看日志那行 `拇指方向核对：指尖↔中指根距离 …（握拳应变小）`，我一次性把库里的值定死。
    // ★ 拇指有 **3 个自由度**（手指里唯一多出来的）：`thumb` 是**语义比例** 0~250（0~满卷，
    //   满卷角度由本模型自标定）；而 `thumbSide`（内收/外展 ±150）与 `thumbRoll`（对掌/自转 ±180）
    //   是**真实角度** —— 这两个不需要按模型缩放，所以不做语义化。四指仍是"卷 + 张开"。
    fist:     { curl: 250, thumb: 250, thumbSide: -60 },      // 拇指：卷满 + 往掌心里收（内收）
    spread:   { curl: 0, spread: 30 },
    point:    { thumb: 210, thumbSide: -35, index: 0, middle: 250, ring: 256, little: 260 },
    thumb_up: { thumb: 0, index: 250, middle: 255, ring: 258, little: 262 },
    // 剪刀手：食指+中指伸直，其余弯曲（V 手势）
    victory:  { thumb: 220, thumbSide: -25, index: 0, middle: 0, ring: 255, little: 260, spread: 22 }
  };

  /** spec.fingers → { 骨骼名: 世界空间增量四元数 }（世界增量语义与其它层一致，见 pet.js） */
  function fingerJoints(fingers, rig) {
    if (!fingers || typeof fingers !== 'object') return null;
    var out = null;
    ['left', 'right'].forEach(function (side) {
      var raw = fingers[side === 'left' ? 'l' : 'r'];
      if (raw == null) return;
      var f = (typeof raw === 'string') ? HAND_SHAPES[raw] : raw;
      if (!f) return;
      var baseCurl = isFinite(+f.curl) ? +f.curl : 0;
      var spreadV = isFinite(+f.spread) ? +f.spread : 0;
      // ★ 拇指的另外两个自由度（球窝关节，四指没有）：摆 = 内收/外展（正 = 离开掌心张开）、转 = 绕自身长轴（对掌）
      var sideV = isFinite(+f.thumbSide) ? +f.thumbSide : 0;
      var rollV = isFinite(+f.thumbRoll) ? +f.thumbRoll : 0;
      var info = (rig && rig.hand && rig.hand[side]) || null;
      // 弯曲轴：量不到就退回世界左右轴（不保证完美，但绝不会"拖了没反应"）
      var ax = info ? vnorm(info.axis) : [side === 'left' ? -1 : 1, 0, 0];
      var sgn = info ? (info.sign || 1) : 1;
      var nrm = (info && info.normal) ? vnorm(info.normal) : (rig && rig.up ? rig.up : [0, 1, 0]);
      for (var i = 0; i < FINGER_NAMES.length; i++) {
        var nm = FINGER_NAMES[i];
        var curl = (f[nm] != null && isFinite(+f[nm])) ? +f[nm] : baseCurl;
        // ★★ 拇指（球窝 + 两个铰链关节）：**近节与末节各自可控**，不再"整根按固定比例分摊"。
        //   用户原话："这个对掌是什么玩意…我的弯曲呢…**大拇指关节没有吗**" ⇒ 关节必须能单独调。
        //     根节弯 `thumbBase` / 指尖弯 `thumbTip`：0~250 语义（250 = **该节满屈**，尺度取本模型自标定的
        //     「整根满卷角」——见 pet.js mkHand / 日志 `满卷 XX°`）。两节都满 ≈ 2×满卷角，
        //     这才接近真人拇指（MCP≈50~60° + IP≈80~90°）：旧的"整根只卷 55°"其实是**弯得不够**。
        //   只写 `thumb`（老写法 / 手型库）⇒ 两节都取 `thumb`（向后兼容，且与面板种子的行为一致）。
        var thumbFull = (info && info.thumb && isFinite(+info.thumb.full) && +info.thumb.full > 0) ? +info.thumb.full : 60;
        var isThumb = (nm === 'thumb');
        var tbV = null, ttV = null;
        if (isThumb) {
          var tLegacy = isFinite(+f.thumb) ? +f.thumb
            : ((f.thumbBase == null && f.thumbTip == null) ? baseCurl : null);
          tbV = isFinite(+f.thumbBase) ? +f.thumbBase : tLegacy;
          ttV = isFinite(+f.thumbTip) ? +f.thumbTip : tLegacy;
        }
        var thumbJointDeg = function (seg) {                   // 该节的弯曲角（度）
          var v = (seg === 2) ? ttV : tbV;                     // 中节（多数 VRM 缺）跟近节
          return Math.max(0, Math.min(1, (v || 0) / 250)) * thumbFull;
        };
        // ★ 有效节：缺骨的手指要把弯曲**重新分摊到存在的节**上（典型：拇指缺 ThumbIntermediate）。
        //   否则那一节的分摊凭空丢失 ⇒ 拇指伸不进去、握不成拳。规则：按原比例**归一化到存在的节**。
        var segNames = FINGER_BONES[side][i];
        var actIdx = [], wSum = 0;
        for (var s0 = 0; s0 < 3; s0++) {
          if (rig && rig.fingerAxes && !rig.fingerAxes[segNames[s0]]) continue;   // 该节不存在
          actIdx.push(s0); wSum += FINGER_SEG[s0];
        }
        if (!actIdx.length || wSum <= 0) continue;   // 一根骨都没有 ⇒ 跳过
        for (var t0 = 0; t0 < actIdx.length; t0++) {
          var s = actIdx[t0];
          var boneName = segNames[s];
          // ★ 优先用 pet.js 量出的「父骨局部轴」(fa)：它把静止世界轴换算进了"手 / 上一节手指"的局部空间，
          //   配合 pet.js 的 embodiedApplyJoints（手指骨不做世界共轭、直接叠加）⇒ 上臂自旋时手指仍绕"手"蜷曲，
          //   不会被掰直/扭曲（用户实测症状）。量不到才退回世界轴（仅在不支持量测的模型上出现）。
          var fa = (rig && rig.fingerAxes && rig.fingerAxes[boneName]) || null;
          var axU = fa ? vnorm(fa.ax) : ax;
          var sgnU = fa ? (fa.sign || 1) : sgn;
          var nrmU = fa ? vnorm(fa.nrm) : nrm;
          // 拇指：用**该关节自己的值**（根节 / 指尖各自）；四指：按比例分摊（老行为不变）
          var curlDeg = isThumb ? thumbJointDeg(s) : (curl * FINGER_SEG[s] / wSum);
          var q = qAxis(axU, sgnU * deg2rad(curlDeg));
          if (spreadV && i > 0) {                 // ★ 拇指不再蹭"张开"：它有自己独立的「摆」滑块
            // 张开：绕"掌心法线"转，越靠外侧的手指分得越开
            var k = (i - 2) / 2 * spreadV * 0.6;
            q = qMul(qAxis(nrmU, deg2rad(k)), q);
          }
          // ★★ 拇指的另外两个自由度：只加在**近节**（解剖上内收/外展与对掌都发生在根部；
          //    加在近节整根拇指会跟着走，加在末节就变成"指尖乱扭"）。
          if (nm === 'thumb' && s === 0 && (sideV || rollV)) {
            // 摆：绕掌心法线 —— **正 = 离开掌心张开(外展)**，与"张开"同一套观感方向，故取负号
            if (sideV) q = qMul(qAxis(nrmU, deg2rad(-sideV)), q);
            // 转：绕拇指自身长轴 ≈ 屈曲轴 × 掌心法线
            if (rollV) {
              var axR = vcross(vnorm(axU), vnorm(nrmU));
              if (vlen(axR) > 1e-6) q = qMul(qAxis(vnorm(axR), deg2rad(rollV)), q);
            }
          }
          if (!out) out = {};
          out[boneName] = q;
        }
      }
    });
    return out;
  }

  // ==================== overlay：把两段动作叠起来 ====================
  // 语义：**base 打底，add 在它之上叠加**（世界空间左乘 ⇒ 顺序无关、互不摧毁）。
  //   spec.overlay = { base: 'wave' | <spec>, add: <spec>, amp: 1.2, tempo: 0.8 }
  // 用途：同一个预置挥手，叠上"歪头 + 抬肩 + 慢半拍"就是另一个人格（组合爆炸的开关）。
  /** 按比例缩放四元数的旋转角度（amp：>1 放大、<1 变小） */
  function qScaleAngle(q, t) {
    var w = Math.max(-1, Math.min(1, q[3]));
    var ang = 2 * Math.acos(w);
    if (!(ang > 1e-6) || !isFinite(t) || Math.abs(t - 1) < 1e-9) return [q[0], q[1], q[2], q[3]];
    var s = Math.sqrt(Math.max(1e-12, 1 - w * w));      // = sin(ang/2)
    var k = Math.sin(ang * t / 2) / s;
    return [q[0] * k, q[1] * k, q[2] * k, Math.cos(ang * t / 2)];
  }
  /** 叠加合成（被 compose 内部调用；也导出便于离线自测） */
  function overlayCompose(spec, rig) {
    var ov = (spec && spec.overlay) || {};
    var baseSpec = (typeof ov.base === 'string') ? preset(ov.base) : ov.base;
    if (!baseSpec) return null;
    var addSpec = ov.add || {};
    var amp = isFinite(+ov.amp) ? +ov.amp : 1;
    var tempo = isFinite(+ov.tempo) ? +ov.tempo : 1;
    if (tempo > 0 && Math.abs(tempo - 1) > 1e-6 && Array.isArray(addSpec.steps)) {
      addSpec = Object.assign({}, addSpec, { steps: addSpec.steps.map(function (s) {
        return Object.assign({}, s, { dur: Math.max(0.02, (+s.dur || 0.4) / tempo) }); }) });
    }
    var B = compose(baseSpec, rig);
    if (!B || !B.frames.length) return null;
    var A = compose(Object.assign({}, addSpec, { overlay: null }), rig);
    if (!A || !A.frames.length) {
      // ★ add 只给了"剪辑级参数"（手指 / 下沉 / 转身）而没有任何 steps 时没有帧可叠 ——
      //   但这些参数**必须照样生效**（例：举拳 = hands_up 叠 fingers）。
      //   以前这里直接return base ⇒ 参数被丢掉，表现就是"我说了做手势，画面没动"。
      var addFJ = fingerJoints(addSpec.fingers, rig);
      var framesB = B.frames;
      if (addFJ) {
        framesB = B.frames.map(function (f) {
          var j = {}, k, src = f.joints || {};
          for (k in src) j[k] = src[k];
          for (k in addFJ) j[k] = addFJ[k];
          return { joints: j };
        });
      }
      return {
        fps: B.fps, frames: framesB,
        rootY: B.rootY + (A ? (A.rootY || 0) : (+addSpec.rootY || 0)) * amp,
        turn: B.turn + (A ? (A.turn || 0) : (+addSpec.turn || 0)),
        plan: B.plan, askedCrouch: B.askedCrouch, askedKneel: B.askedKneel,
        askedFingers: (A && A.askedFingers) ? 1 : (addFJ ? 1 : B.askedFingers)
      };
    }
    var n = B.frames.length, an = A.frames.length, out = [];
    for (var i = 0; i < n; i++) {
      var jb = B.frames[i].joints || {};
      var ja = (A.frames[Math.min(an - 1, Math.round(i * an / n))] || {}).joints || {};
      var j = {}, k;
      for (k in jb) j[k] = jb[k];
      for (k in ja) {
        var q = (Math.abs(amp - 1) < 1e-9) ? ja[k] : qScaleAngle(ja[k], amp);
        j[k] = jb[k] ? qMul(q, jb[k]) : q;                 // add 叠在 base 之上
      }
      out.push({ joints: j });
    }
    return { fps: B.fps, frames: out, rootY: B.rootY + (A.rootY || 0) * amp, turn: B.turn + (A.turn || 0),
      plan: B.plan, askedCrouch: B.askedCrouch, askedKneel: B.askedKneel, askedFingers: B.askedFingers };
  }

  /** spec → { fps, frames }；rig 可选（缺省用标准 T-pose 兜底） */
  function compose(spec, rig) {
    spec = spec || {};
    rig = normaliseRig(rig);
    // overlay：base 打底 + add 叠加。放在最前面，普通路径完全不受影响。
    if (spec.overlay) { var oc = overlayCompose(spec, rig); if (oc) return oc; }
    var fps = Math.max(5, Math.min(60, Math.round(+(spec.fps || 20))));
    var repeat = Math.max(1, Math.min(20, Math.floor(+(spec.repeat || 1))));
    // ★ v11.17：这里必须用**全部**通道（含 `_` 内部联动通道）—— 它们要参与逐帧插值、`cur` 状态与
    //   "末帧回中性"的判断；对外可见性由 channelNames() 负责（它已过滤 `_`）。
    var chans = Object.keys(CHANNELS);
    var steps = Array.isArray(spec.steps) ? spec.steps.slice() : [];
    // 蹲/跪：一次解好双腿通道值，之后**每一帧都用它**（含末尾"回到中性"那段 ——
    // 否则收尾会把腿伸直、骨盆却还沉在下边，变成悬空反关节）。
    var plan = legPlan(spec, rig);

    var cur = {};                                  // 当前姿势（度）
    for (var i = 0; i < chans.length; i++) cur[chans[i]] = 0;
    // ★★ 起始姿势（可选）：`spec.start` = { 通道名: 度数 }。**不传就与旧行为完全一致**（全 0 = 中性）。
    //   为什么要它：下面的插值是"从 cur 的当前值 → 本 step 的值"，而 cur 初值恒为全 0
    //   ⇒ **每一段剪辑的第 0 帧都从"中性"起步**。于是任何"重发同一姿势"（拖手指滑条、每 15s 续持、
    //   每次点播）都会先往中性沉一下再回来 —— 那正是用户报的**胳膊抽搐 / 每隔一段时间闪烁抽**
    //   （实测证据：加载时 `瞬跳捕获：leftUpperArm 单帧跳 46°`）。
    //   面板把"正在发送的姿势"当 start 传进来 ⇒ 首段从同一姿势到同一姿势 ⇒ **零位移**，抽搐消失。
    if (spec.start && typeof spec.start === 'object') {
      for (var si = 0; si < chans.length; si++) {
        var sv = +spec.start[chans[si]];
        if (isFinite(sv)) cur[chans[si]] = sv;
      }
    }

    var seq = [];                                  // 展开 repeat
    for (var r = 0; r < repeat; r++) seq = seq.concat(steps);

    // 末尾若不是中性，自动补一段回到中性（防止收尾瞬跳）
    // ★ 必须把**整条 seq 的 pose 依次折叠**再判中性，不能只看最后一段的 pose：
    //   最后一段常常"只写了 fingers、没写 pose"⇒ 旧写法误判为已中性、不补收尾，
    //   结果人停在"举着手"的姿势上（实测：预置 reach_fist 的手臂末帧停在 84° 放不下来）。
    var finalPose = {}; for (var z0 = 0; z0 < chans.length; z0++) finalPose[chans[z0]] = 0;
    for (var s0 = 0; s0 < seq.length; s0++) {
      var pp0 = seq[s0].pose || {};
      for (var c0 in pp0) { if (CHANNELS[c0]) finalPose[c0] = +pp0[c0] || 0; }
    }
    var notNeutral = false;
    for (var j = 0; j < chans.length; j++) { if (Math.abs(finalPose[chans[j]]) > 1e-6) { notNeutral = true; break; } }
    // ★★ v11.22（用户："跳起来落地之后腿还是弯的，延迟久才放直"）：
    //   上面只扫"pose 里写了的通道"，**看不见腿** —— 腿是"crouch 解算 + 手写黏性"混出来的：
    //   末尾 crouch 归零后腿会停在上一段的手写值（实测 43~55°），于是**动作结束时腿还是弯的**，
    //   只能等宠物端交还骨骼时才拉直（用户看到的就是"延迟很久才放直"）。补一条：腿没归零也要补尾段。
    if (!notNeutral && plan) {
      for (var lkz in plan.legs) { if (Math.abs(cur[lkz] || 0) > 1) { notNeutral = true; break; } }
    }
    // ★ v11.12 `spec.chain`（连招）：末尾**不补**"回到中性"段 —— 让这一段的结束姿势直接留给下一个动作接上。
    //   玩法：AI 连续下发动作用 `chain:true`，两段之间就不会"站定一下再动"（宠物端会把末帧保持住、
    //   并让下一段在 0.15s 内从上一段的结束姿势滑过去）。
    if (notNeutral && !spec.chain) {
      var zero = {}; for (var k = 0; k < chans.length; k++) zero[chans[k]] = 0;
      seq.push({ pose: zero, dur: 0.4, ease: 'inout', _tail: true });
    }

    var frames = [];
    // ★★ v11.16「腿部限速」——治"腿/脚像弹簧弹回、幅度大"（用户 2026-10-16 反馈，日志实证
    //   `瞬跳捕获：leftLowerLeg 单帧跳 29°`）：不管是预置写得急、还是 AI 临时生成的动作，
    //   腿（大质量部位）单帧转角都**封顶 22°**（20fps ⇒ 440°/s，比真人快速收腿略慢，看着是"发力"不是"弹"）。
    //   只限腿；手臂/手指/头照旧（它们轻，快才自然）。
    var prevLegAng = {};
    var LEG_LIMIT_CH = ['lLegFwd', 'rLegFwd', 'lKnee', 'rKnee', 'lAnkle', 'rAnkle'];
    var LEG_MAX_STEP = 22;
    // ★★ v11.23「运动学惯性偏移」—— 让**任何**动作（含 AI 现场写的朴素 linear 动作）都有"甩"。
    //   原理：真人四肢有质量 ⇒ **加速时落后于意图、减速/停住时冲过头**（follow-through）。
    //   做法：对每个通道取**二阶差分**（加速度），把 `-k × 加速度` 叠加到这一帧的目标上（限幅）。
    //   为什么不用"二阶弹簧"（上一版做法）—— 实测对照（20fps 的插值轨迹）：
    //     · 二阶弹簧：峰值 98°→92°（**幅度缩水**）、几乎不过冲、只是整体变慢 ✗
    //     · 加速度偏移：峰值 100°→**107°**（过冲 ✓）且到位后仍是 100°（**不缩幅度**）✓
    //   关键：偏移**只用于写这一帧的 joints**，不写回 `cur`/`lastAng`（否则会逐帧累积漂移）。
    var inertiaPrev = {}, inertiaPrev2 = {}, offMap = null, _offSm = {};
    var INERTIA_K = {}, INERTIA_KV = {}, INERTIA_LIMIT = {};
    // ★★ v11.23c「惯性强度开关」`spec.inertia`（0~1，默认 1）—— 治"末端要精确贴住"的动作（敬礼/扶帽/摸脸/捏东西）：
    //   惯性会给末端一个幅度相关的偏移（这是"活人感"的来源），但**末端贴近身体/头部**时，
    //   同样的角度偏移在手上会放大成几厘米的位移 ⇒ 手会"甩过头/穿进脸里"。
    //   这类动作把惯性调小即可：`{"preset":"salute","inertia":0.3}`；要完全精确就 `0`。
    var INERTIA_GAIN = (spec.inertia === undefined) ? 1 : Math.max(0, Math.min(1, +spec.inertia || 0));
    // ★ v11.32 总开关：控制台 window.__petLink = 0 ⇒ 关掉这一整套"活人感"（延迟/惯性/联动/惯性偏移），
    //   回到这几轮之前的运动形态（用户要能一键回退，而我之前没做备份 —— 这是我的失职）。
    try { if (typeof window !== 'undefined' && window.__petLink === 0) INERTIA_GAIN = 0; } catch (e) { }
    function inertiaKFor(ch) {
      if (/^(l|r)Hand/.test(ch)) return 0.55;         // 手：甩得最明显
      if (/^(l|r)Elbow/.test(ch)) return 0.45;        // 小臂
      if (/^(l|r)(Arm|Shoulder)/.test(ch)) return 0.40; // 大臂 / 肩
      if (/^(l|r)(Knee|Leg|Ankle)/.test(ch)) return 0.22; // 腿：轻一点（避免又出"弹簧感"）
      if (/^(head|neck)/.test(ch)) return 0.30;
      return 0;
    }
    // ★★ v11.23b「**速度项**（逐级滞后）」—— 用户："起码得让大臂小臂分开都要动，不能跟个棍一样甩"。
    //   只靠"加速度项"时：大臂和小臂的目标轨迹出自**同一段、同一个 ease** ⇒ 两者偏移只差一个系数
    //   （0.40 vs 0.45），误差不到 1°，视觉上就是"整条手臂同步"= 棍。
    //   加上速度项（`偏移 = −kV × 本帧速度`）后：运动过程中**远端持续落后于近端**
    //   （大臂 kV 0.35 → 小臂 0.95 → 手 1.30）⇒ 大臂带小臂、小臂带手，出现真正的**相位差**；
    //   停下时速度归零 ⇒ 偏移也归零 ⇒ **不改变最终姿势**（不会"没到位"）。
    function inertiaKVFor(ch) {
      // ★ v11.24 下调（用户："放下时小臂扭曲弯曲幅度不自然，相比大臂很不自然"）：
      //   原来是手 1.30 / 小臂 0.95 —— 是小臂的 kV 是大臂（0.35）的 2.7 倍，放下手臂时小臂的滞后
      //   明显到"像自己在动"（尤其叠加"肘反向缓冲"时）。现在改成 0.75 / 0.55（约 2.1×/1.6×）：
      //   相位差还在（大臂带小臂），但不会各动各的。
      if (/^(l|r)Hand/.test(ch)) return 0.75;          // 手：略落后于小臂
      if (/^(l|r)Elbow/.test(ch)) return 0.55;         // 小臂：跟在大臂后面
      if (/^(l|r)(Arm|Shoulder)/.test(ch)) return 0.35; // 大臂：接近"意图"
      if (/^(l|r)(Knee|Leg|Ankle)/.test(ch)) return 0.30;
      if (/^(head|neck)/.test(ch)) return 0.35;
      return 0;
    }
    // ★★ v11.23b「**幅度自适应限幅**」—— 用户问："对于动作幅度不同的动作，会有相应的判定吗？"
    //   原先是**死值**限幅（手 10°、小臂 9°…）：小动作（摆 10°）被限到 10°=过头，大动作（抡 150°）又显不出惯性。
    //   现在按"这条动作里该通道的实际幅度"定：`limit = clamp(幅度 × 9%, 2.5°, 12°)`
    //   —— 幅度 30° ⇒ 2.7°、100° ⇒ 9°、≥133° ⇒ 封顶 12°。幅度从 spec 的 steps 扫一遍即可（离线生成，成本可忽略）。
    (function () {
      var amp = {};
      for (var si = 0; si < seq.length; si++) {
        var p = seq[si] && seq[si].pose; if (!p) continue;
        for (var c in p) {
          if (!CHANNELS[c]) continue;
          var v = +p[c] || 0, o = amp[c] || (amp[c] = { mn: 0, mx: 0 });
          if (v < o.mn) o.mn = v;
          if (v > o.mx) o.mx = v;
        }
      }
      for (var c2 in CHANNELS) {
        var k = inertiaKFor(c2);
        if (k > 0) {
          INERTIA_K[c2] = k;
          INERTIA_KV[c2] = inertiaKVFor(c2);
          var a = amp[c2] ? (amp[c2].mx - amp[c2].mn) : 0;
          INERTIA_LIMIT[c2] = Math.max(2.5, Math.min(12, a * 0.09));   // ★ 按幅度缩放（有下限/上限）
        }
      }
    })();
    // ★★ v11.10「可逐段的根位移 / 蹲深」—— 治"跳跃做不出来"（用户报："想跳，结果像在空中上下浮动"）：
    //   旧实现里 rootY / crouch 是**整段常量** ⇒ 只能"一直蹲着 / 一直升着"，永远做不出时间曲线。
    //   现在：每段可写 `rootY`（胯的实际升降，±0.6 世界单位）与 `crouch`（0~1，腿按比例弯/伸），
    //   沿段内 ease 插值；没写的段**沿用上一段终值**（黏性，与 pose 通道同规则）。
    //   两者配合就是跳跃：rootY 给升降曲线，crouch 给"蓄力下压弯腿 → 腾空伸直 → 落地缓冲"。
    var perStepLeg = false;
    for (var psI = 0; psI < seq.length; psI++) {
      var psS = seq[psI];
      if (psS && (psS.rootY !== undefined || psS.crouch !== undefined)) { perStepLeg = true; break; }
    }
    var yCur = perStepLeg ? 0 : ((typeof spec.rootY === 'number' && isFinite(spec.rootY)) ? Math.max(-0.6, Math.min(0.6, spec.rootY)) : 0);
    var cCur = perStepLeg ? 0 : (plan ? 1 : 0);
    // ★ 手指初值：剪辑级 `spec.fingers` 只作**起始**手型（不写 = 从"不弯"开始）。
    //   每段可由 `step.fingers` 改写 ⇒ 手指也能"有先后顺序 + 有过渡"（见下面逐段插值）。
    var fingerState = fingerJoints(spec.fingers, rig) || {};
    for (var s = 0; s < seq.length; s++) {
      var step = seq[s] || {};
      var dur = Math.max(0.05, +(step.dur || 0.4));
      var n = Math.max(1, Math.round(dur * fps));
      var start = {}; for (var a = 0; a < chans.length; a++) start[chans[a]] = cur[chans[a]];
      var lastAng = null;                  // ★ v11.16：本段实际末帧角度（见段末 cur 的更新）
      var target = {}; for (var b = 0; b < chans.length; b++) target[chans[b]] = cur[chans[b]];
      var poseIn = step.pose || {};
      for (var c in poseIn) { if (CHANNELS[c]) target[c] = +poseIn[c] || 0; }   // 只改写了的通道
      // 蹲/跪：腿部六通道由 IK 决定（"配套算出来"的，手写值无意义）——★ v11.10 起改为**逐帧**按当帧 crouch
      //   比例写入（见帧循环里的 `plan.legs[lkN] * cNow`），于是"蓄力弯腿 → 腾空伸直"才成立。
      // ★ 手指目标：本段写 `step.fingers` 就用它（且 `{}` = 明确"松开"）；没写就沿用上一段终值（黏性）。
      var targetFinger = (step.fingers !== undefined) ? (fingerJoints(step.fingers, rig) || {}) : fingerState;

      var cStart = cCur, cTarget = (step.crouch !== undefined) ? Math.max(0, Math.min(1, +step.crouch || 0)) : cCur;
      var yStart = yCur, yTarget;
      if (step.rootY !== undefined) {
        yTarget = Math.max(-0.6, Math.min(0.6, +step.rootY || 0));   // 手写优先（腾空/离地必须手写）
      } else if (plan) {
        // ★★ v11.11「关键修正」：只给 crouch、没给 rootY 的段，rootY 必须**跟着腿部解算走**
        //   （= plan.rootY × 本段 crouch）。否则就是"腿按 42cm 深蹲的角度弯、胯只降了 6cm"
        //   —— 被吊着弯腿，观感正是用户说的"没用力的轻蹦 / 屈膝幅度小"。蹲姿要让胯和腿**一起**下去。
        yTarget = plan.rootY * cTarget;
      } else {
        yTarget = yCur;
      }
      for (var f = 1; f <= n; f++) {
        var t = ease(f / n, step.ease || 'inout');
        var ang = {}; for (var ai = 0; ai < chans.length; ai++) { var cc = chans[ai]; ang[cc] = start[cc] + (target[cc] - start[cc]) * t; }
        // ★ v11.10：本帧的根位移与蹲深（腿按 cNow 比例弯/伸；plan.legs = 满蹲时的腿部角度）
        var ry = yStart + (yTarget - yStart) * t;
        var cNow = cStart + (cTarget - cStart) * t;
        // ★★ v11.15：腿通道 = **手写值与解算值按 cNow 混合**（不是二选一！）。
        //   旧写法在 cNow 刚过 0 的那一帧，把腿从"手写的收腿/伸腿"瞬间换成"plan×0.001≈0"
        //   ⇒ 单帧跳 29°（日志实证：`瞬跳捕获：leftLowerLeg 单帧跳 29°，0.15s 内又回到 7° 内`）
        //   —— 用户看到的就是"腿/脚像弹簧弹回"。混合后：腾空(cNow=0)全手写、落地(cNow=1)全解算，
        //   中间连续过渡，那一下跳变就不存在了。
        // ★★ v11.22 权重修正（用户："跳起来落地之后腿还是弯的，延迟久才放直"）：
        //   混合是"手写值 × (1-w) + 解算值 × w"，原来 `w = cNow` 是**线性**的 ⇒
        //   落地缓冲（crouch 0.42）时手写还占 58%：下落段手写的收腿（`lKnee: 30`）会一路黏到结束，
        //   crouch 归零后腿**停在 30° 不直**（实测落地后膝角 43~55° 且一大段不动）。
        //   改成 `w = min(1, cNow × 1.6)`：蹲得越深、解算占比越高（crouch 0.42 → 67%，0.6 → 96%）；
        //   腾空收腿（crouch=0）仍是纯手写 —— 两边都保住，且权重随 cNow 连续（不会有跳变）。
        if (plan) {
          var _wLeg = Math.min(1, Math.max(0, cNow * 1.6));
          for (var lkN in plan.legs) {
            var hv = (typeof ang[lkN] === 'number') ? ang[lkN] : 0;
            ang[lkN] = hv * (1 - _wLeg) + plan.legs[lkN] * _wLeg;
          }
        }
        // 自顶向下逐骨骼：own = 本骨世界增量（给 pet.js 用），total = own·父链累计（传给子骨推轴）
        // ★★ v11.17「活人感联动层」（用户：\"只动必须动的，其他部分太僵硬，没活人感\"）：
        //   把主通道的值按**真人比例分摊到相邻骨**。骨骼链是累加的 ⇒ 分散后头部/躯干朝向几乎不变，
        //   但形态从"单关节折刀"变成"整条脊柱在参与"。原则：**只补没写过的目标通道**（避免叠加过头），
        //   AI / 预置的表达方式一个字都不用改。
        //   `spec.link: 0` = **显式关掉联动**（想做"机械/僵直/木偶"效果时用）。
        var _linkOn = (spec.link !== 0);
        // ★ v11.32 总开关（同上）：window.__petLink = 0 时联动层也关。
        try { if (typeof window !== 'undefined' && window.__petLink === 0) _linkOn = false; } catch (e) { }
        //   ① 头三轴：head 45% + neck 40% + upperChest 15%
        var _hp = _linkOn ? (+ang.headPitch || 0) : 0, _hy = _linkOn ? (+ang.headYaw || 0) : 0, _hr = _linkOn ? (+ang.headRoll || 0) : 0;
        if (_hp) { ang.headPitch = _hp * 0.45; ang._neckX = (+ang._neckX || 0) + _hp * 0.40; ang._uchX = (+ang._uchX || 0) + _hp * 0.15; }
        if (_hy) { ang.headYaw = _hy * 0.45; ang._neckY = (+ang._neckY || 0) + _hy * 0.40; ang._uchY = (+ang._uchY || 0) + _hy * 0.15; }
        if (_hr) { ang.headRoll = _hr * 0.45; ang._neckZ = (+ang._neckZ || 0) + _hr * 0.40; ang._uchZ = (+ang._uchZ || 0) + _hr * 0.15; }
        //   ② 胸 → 上胸（写过的才下传；上胸已被头部分配过就不再叠加）
        var _cp = _linkOn ? (+ang.chestPitch || 0) : 0, _cy = _linkOn ? (+ang.chestYaw || 0) : 0, _cr = _linkOn ? (+ang.chestRoll || 0) : 0;
        if (_cp && Math.abs(+ang._uchX || 0) < 0.5) ang._uchX = (+ang._uchX || 0) + _cp * 0.35;
        if (_cy && Math.abs(+ang._uchY || 0) < 0.5) ang._uchY = (+ang._uchY || 0) + _cy * 0.35;
        if (_cr && Math.abs(+ang._uchZ || 0) < 0.5) ang._uchZ = (+ang._uchZ || 0) + _cr * 0.35;
        //   ③ 腰 → 胸 / 上胸（"弯腰"本来就不该只有腰一节在折；目标没写过才补）
        var _sp2 = _linkOn ? (+ang.spinePitch || 0) : 0, _sy2 = _linkOn ? (+ang.spineYaw || 0) : 0, _sr2 = _linkOn ? (+ang.spineRoll || 0) : 0;
        if (_sp2) {
          if (Math.abs(_cp) < 0.5) ang.chestPitch = _cp + _sp2 * 0.30;
          if (Math.abs(+ang._uchX || 0) < 0.5) ang._uchX = (+ang._uchX || 0) + _sp2 * 0.15;
        }
        if (_sy2) {
          if (Math.abs(_cy) < 0.5) ang.chestYaw = _cy + _sy2 * 0.30;
          if (Math.abs(+ang._uchY || 0) < 0.5) ang._uchY = (+ang._uchY || 0) + _sy2 * 0.15;
        }
        if (_sr2) {
          if (Math.abs(_cr) < 0.5) ang.chestRoll = _cr + _sr2 * 0.30;
          if (Math.abs(+ang._uchZ || 0) < 0.5) ang._uchZ = (+ang._uchZ || 0) + _sr2 * 0.15;
        }
        //   ④ 肩：手臂抬得高时肩跟着抬（超过 55° 的部分 × 22%）—— 消除"手臂从躯干直接长出来"的僵硬
        var _lu2 = _linkOn ? (+ang.lArmUp || 0) : 0;
        var _shL = Math.max(0, (_lu2 - 55) * 0.22);
        if (_shL > (+ang.lShoulderUp || 0)) ang.lShoulderUp = _shL;   // 只增不减（避开通道黏性锁死，见⑤的注释）
        var _ru2 = _linkOn ? (+ang.rArmUp || 0) : 0;
        var _shR = Math.max(0, (_ru2 - 55) * 0.22);
        if (_shR > (+ang.rShoulderUp || 0)) ang.rShoulderUp = _shR;
        //   ⑤ 抬臂自动带**肘**（治"双手像一根棍笔直抬上去、不带动的"，用户 2026-10-16）：
        //      整条手臂只有肩在转 = 刚性棍；真人抬手时肘是参与进来的（起手屈得多、举到位略伸）。
        //      这里给"没写肘的"抬臂动作自动补一个屈肘量：抬过 35° 起，随高度线性加，封顶 26°。
        //      —— 于是 `hands_up`（只写 ArmUp）也会自带"肘部弧线"，不再是棍。
        var _lu3 = _linkOn ? (+ang.lArmUp || 0) : 0;
        //   ★ 判据用"**只增不减**"而不是"≈0 才写"：后者会被**通道黏性**锁死 —— 首段 armUp=58 给出 1.8°，
        //     于是后续 armUp=146 时 `ang.lElbow` 已是 1.8（≠0）⇒ 判据不成立 ⇒ 永远长不到 26°（实测踩到）。
        //   ★ v11.17：驱动从"只看抬臂"改成"**抬臂 + 前后摆**取大者" —— 跳跃/摆臂类动作主要是**前后甩**，
        //     只看 ArmUp 会给 0（用户："小臂完全跟大臂黏一块"）；上限也从 26° 提到 45°（真人摆动肘弯得更多）。
        var _drvL = Math.max(Math.abs(_lu3), Math.abs((_linkOn ? (+ang.lArmFwd || 0) : 0)) * 1.5);
        var _ebL = Math.min(45, Math.max(0, (_drvL - 20) * 0.35));
        if (_ebL > (+ang.lElbow || 0)) ang.lElbow = _ebL;
        var _ru3 = _linkOn ? (+ang.rArmUp || 0) : 0;
        var _drvR = Math.max(Math.abs(_ru3), Math.abs((_linkOn ? (+ang.rArmFwd || 0) : 0)) * 1.5);
        var _ebR = Math.min(45, Math.max(0, (_drvR - 20) * 0.35));
        if (_ebR > (+ang.rElbow || 0)) ang.rElbow = _ebR;
        //   ⑥ 抬臂自动带**腕**（体检发现：所有预置里手腕几乎全程是死的，只有"转掌"在动 ⇒ 手腕焊死）：
        //      抬过 45° 时手腕略翘（封顶 14°）—— 真人举臂时手腕不会僵直，总有个自然角度。
        //      只在没写 `HandBend` 时补（写了就以作者/AI 的为准）。
        var _lu4 = _linkOn ? (+ang.lArmUp || 0) : 0;
        var _wbL = Math.min(14, Math.max(0, (_lu4 - 45) * 0.14));
        if (_wbL > (+ang.lHandBend || 0)) ang.lHandBend = _wbL;
        var _ru4 = _linkOn ? (+ang.rArmUp || 0) : 0;
        var _wbR = Math.min(14, Math.max(0, (_ru4 - 45) * 0.14));
        if (_wbR > (+ang.rHandBend || 0)) ang.rHandBend = _wbR;
        //   ⑦ 身体前倾时手臂**被动微摆**（体检发现：`bow` 鞠躬时手臂全程 0 档 = 焊在身侧）：
        //      前倾超过 15° 时手臂相对躯干向后让一点点（封顶 8°）—— 世界坐标下手更自然地下垂/轻晃。
        var _spF = _linkOn ? (+ang.spinePitch || 0) : 0;
        if (_spF > 15) {
          var _abk = -Math.min(8, (_spF - 15) * 0.25);
          if (_abk < (+ang.lArmFwd || 0)) ang.lArmFwd = _abk;   // 只往"更后摆"的方向补
          if (_abk < (+ang.rArmFwd || 0)) ang.rArmFwd = _abk;
        }

        // ★ v11.16 腿限速（见上面 LEG_MAX_STEP 的注释）
        for (var lci = 0; lci < LEG_LIMIT_CH.length; lci++) {
          var lc = LEG_LIMIT_CH[lci];
          if (typeof ang[lc] !== 'number') continue;
          var prevLv = prevLegAng[lc];
          if (typeof prevLv === 'number') {
            if (ang[lc] > prevLv + LEG_MAX_STEP) ang[lc] = prevLv + LEG_MAX_STEP;
            else if (ang[lc] < prevLv - LEG_MAX_STEP) ang[lc] = prevLv - LEG_MAX_STEP;
          }
          prevLegAng[lc] = ang[lc];
        }
        // ★★ v11.23 惯性偏移计算（每帧）：用**未偏移**的 ang 做二阶差分 ⇒ `-k × 加速度`（限幅）。
        //   加速时落后（off 为负）、减速/停住时冲前（off 为正）—— 就是"甩"。offMap 只喂给下面的
        //   BONE_ORDER 循环，**不写回 ang/cur/lastAng**，所以不会逐帧累积。
        offMap = null;
        for (var ici = 0; ici < chans.length; ici++) {
          var ich = chans[ici];
          var iNow = ang[ich], iP = inertiaPrev[ich], iP2 = inertiaPrev2[ich];
          inertiaPrev2[ich] = iP; inertiaPrev[ich] = iNow;
          if (!INERTIA_K[ich] || iP === undefined || iP2 === undefined) continue;
          var iVel = iNow - iP;                    // ★ 本帧速度（用于"逐级滞后"）
          var iAcc = iVel - (iP - iP2);            // ★ 本帧加速度（用于"过冲/冲过头"）
          var moI = INERTIA_LIMIT[ich] || 6;       // ★ 幅度自适应限幅（见上）
          // ★ 两个分量**分开限幅**：滞后（速度项）可以比过冲（加速度项）更明显 ——
          //   滞后只是"晚到"（到位后必然归零，观感安全）；过冲是"冲过头"（要克制，否则像橡皮）。
          var offAcc = -INERTIA_K[ich] * iAcc, offVel = -INERTIA_KV[ich] * iVel;
          // ★ v11.23c「深屈肘保护」：肘弯过 95° 时手腕离身体/头很近 ⇒ 把**手/小臂**的偏移压到 60%。
          //   原理：角偏移在末端会放大成线位移（小臂 0.25m × 10° ≈ 4.4cm）；敬礼时那 4cm 就是"手穿进脸"。
          //   顺手把 gain 乘进来（`spec.inertia` 的总开关）。
          if (/^(l|r)(Hand|Elbow)/.test(ich)) {
            var _side = ich.charAt(0) === 'r' ? 'r' : 'l';
            if (Math.abs(+ang[_side + 'Elbow'] || 0) > 95) { offAcc *= 0.6; offVel *= 0.6; }
          }
          offAcc *= INERTIA_GAIN; offVel *= INERTIA_GAIN;
          if (offAcc > moI) offAcc = moI; else if (offAcc < -moI) offAcc = -moI;
          var moV = moI * 1.6;
          if (offVel > moV) offVel = moV; else if (offVel < -moV) offVel = -moV;
          var offI = offAcc + offVel;
          // ★★ v11.27 关键修（用户："后半部分没有过程，直接抽帧闪烁放下了"）：
          //   偏移与"目标幅度"成正比后再乘一个**淡出系数** —— 目标接近中性（|角度| < 20°）时偏移按比例缩到 0。
          //   为什么必须加：动作**停止的那一帧**，速度从 −20°/帧 突变为 0 ⇒ 滞后偏移（可达 11°）在同一帧
          //   消失 ⇒ 骨骼单帧跳 5~14° = "抽一下 / 闪一下"。乘上 |目标|/20 后，偏移在最后 20° 内**连续淡出**，
          //   归零过程是平滑的；而大幅动作（>20°）系数 = 1，惯性一点不少。
          offI *= Math.min(1, Math.abs(iNow) / 20);
          // ★★ v11.27 第二修（量化证据：跳变 23~34°/帧，而目标曲线本身只有 ~19°/帧）：
          //   二阶差分（加速度）在**段与段的交界**会突变（ease 换段的那一帧），偏移因此出现尖峰
          //   ⇒ 单帧跳十几度 = "后半段抽帧"。这里给偏移加**一阶低通**（≈2 帧时间常数）把尖峰摊平；
          //   代价只是惯性"起效慢了 2 帧"，换来的是连续（人体本来也不会一帧内改变惯性方向）。
          var _prevOff = _offSm[ich] || 0;
          offI = _prevOff * 0.6 + offI * 0.4;
          _offSm[ich] = offI;
          if (Math.abs(offI) < 1e-6) continue;
          if (!offMap) offMap = {};
          offMap[ich] = offI;
        }
        var total = {}, joints = {};
        var pelvicQ = QI;                       // 骨盆自身的旋转（hips 三通道）—— 上身要跟，腿要抵消
        for (var bi = 0; bi < BONE_ORDER.length; bi++) {
          var bone = BONE_ORDER[bi];
          var pq = total[BONE_CHAIN[bone]] || QI;
          var isLegRoot = bone === 'leftUpperLeg' || bone === 'rightUpperLeg';
          // 腿根：按"去掉骨盆"的朝向推轴 —— 骨盆转了之后腿依然竖直，而不是跟着一起倾斜
          var pqAxis = isLegRoot ? qMul(pq, qInv(pelvicQ)) : pq;
          var own = QI;
          var list = BY_BONE[bone];
          if (list) {
            own = QI.slice();
            for (var li = 0; li < list.length; li++) {
              var ch = list[li], v = ang[ch] + (offMap && offMap[ch] ? offMap[ch] : 0);   // ★ v11.23 叠加惯性偏移（见 offMap 的说明）
              if (Math.abs(v) < 1e-6) continue;
              var ax = axisFor(ch, rig, bone, pqAxis);
              if (!ax) continue;
              own = qMul(qAxis(ax, deg2rad(v)), own);     // 后声明的通道作用在更外层
            }
          }
          if (isLegRoot) {
            // 「动胯」而不是「整个人转」：骨盆转了 H → 给腿补 H⁻¹，腿脚留在原地，只有上身跟着倾/转。
            // 骨盆没转时**完全不写**腿（与原行为一致的帧内容，不做无意义的恒等写入）。
            if (qIsIdentity(pelvicQ)) { if (list) joints[bone] = own; }
            else joints[bone] = qMul(qInv(pelvicQ), own);
            total[bone] = qMul(own, pqAxis);                // 供小腿/脚推轴用（"已站定"的朝向）
          } else {
            if (list) joints[bone] = own;                   // 只输出"有通道的骨骼"，零值=恒等（用于回到中性）
            total[bone] = qMul(own, pq);
          }
          if (bone === 'hips') pelvicQ = own;               // hips 是根：它的 own 就是骨盆旋转
        }
        // ★ 手指：**逐段插值**（不再"整段常量、第 0 帧瞬到位"）。
        //   ① 有过渡：和身体同为 dur/ease 驱动；② 支持先后顺序："先伸手、再握拳" = 分两个 step。
        //   走四元数 slerp（不能对角插值）。本段要"松开"的骨（在上一段、不在本段）插回恒等。
        var fkSet = {};
        for (var fb1 in fingerState) fkSet[fb1] = 1;
        for (var fb2 in targetFinger) fkSet[fb2] = 1;
        for (var fb in fkSet) {
          var f0 = fingerState[fb] || QI, f1 = targetFinger[fb] || QI;
          joints[fb] = (t >= 1) ? f1.slice() : qSlerp(f0, f1, t);
        }
        frames.push({ joints: joints, rootY: ry });
        lastAng = ang;                     // ★ v11.16：记住本段最后一帧的**实际**角度（限速可能没追上目标）
      }
      cur = lastAng || target;             // ★ v11.16：用实际值续接 —— 否则限速造成的偏差会在下一段开头补跳一下
      yCur = yTarget; cCur = cTarget;      // ★ v11.10：本段终值成为下一段起点（黏性）
      fingerState = targetFinger;    // 本段终值成为下一段的起点（不写手指的后续 step 会保持它）
    }

    // ---- 跨段平滑（默认开，`spec.smooth: 0` 可关）----
    // 为什么需要：每段动画都是**独立插值**，`ease` 让速度在段末减到 0、下一段再从 0 加速
    //   ⇒ 两段之间会"刹一下再起步"，看上去就是"衔接不顺、一顿一顿"。
    // 做法：逐骨对四元数做一次**轻量低通**（本帧与"前后帧中点"之间 slerp 一小步）。
    //   首末帧**不动** ⇒ "起点=起始手型、终点=中性"仍精确成立。只处理**前后帧都有该骨**的帧。
    var smoothW = (spec.smooth === undefined) ? 0.30 : Math.max(0, Math.min(1, +spec.smooth || 0));
    if (smoothW > 0 && frames.length > 2) {
      var allNames = {}, nk;
      for (var sfi = 0; sfi < frames.length; sfi++) { var sj = frames[sfi].joints; for (nk in sj) allNames[nk] = 1; }
      for (nk in allNames) {
        var arr = [];
        for (var afi = 0; afi < frames.length; afi++) arr.push(frames[afi].joints[nk] || null);
        var outArr = arr.slice();
        for (var mfi = 1; mfi < arr.length - 1; mfi++) {
          if (!arr[mfi - 1] || !arr[mfi] || !arr[mfi + 1]) continue;
          outArr[mfi] = qSlerp(arr[mfi], qSlerp(arr[mfi - 1], arr[mfi + 1], 0.5), smoothW);
        }
        for (var wfi = 0; wfi < frames.length; wfi++) if (outArr[wfi]) frames[wfi].joints[nk] = outArr[wfi];
      }
    }
    // 根位移（下蹲/降低重心）：旋转通道表达不了"整体上下"，所以单独给一个剪辑级参数。
    // 注意它**不是**通道：应用的骨骼位置（胯骨）平移，腿跟着下去，配合屈膝就是蹲姿。
    // ★ v11.10：有逐段 rootY ⇒ 剪辑级归 0（实际升降由每帧的 `frame.rootY` 承载；宠物端优先用帧级）。
    var rootY = perStepLeg ? 0
      : ((typeof spec.rootY === 'number' && isFinite(spec.rootY)) ? Math.max(-0.6, Math.min(0.6, spec.rootY)) : 0);
    // 蹲/跪：下沉量由腿部 IK 算出来（与膝屈配套），覆盖手写的 rootY。
    // ★ 这里**绝不能再夹到 ±0.6**：那个范围是给"手写裸降骨盆"设的，而深蹲/跪姿按腿部几何
    //   本来就要降到 1.0~1.2。一旦夹住，就得到"膝屈 124°、骨盆只降 60cm"的**不自洽**姿态 ——
    //   脚被折进身体里、腿看不见、人像往上飘（用户实测就是这么翻车的）。计划值由腿长界住，天然安全。
    if (plan) rootY = Math.max(-1.6, Math.min(0, plan.rootY));
    // 整体转身（度，正的=往角色自己的左边转）：绕"角色竖直轴"转**整个模型**。
    // 为什么必须单独有它：hipsYaw 的语义是"骨盆相对腿"（腿钉在原地，只能小角度；
    // 拧到 90° 以上就是把胯相对腿拧死 = 反关节）。要大幅转身 / 背对观众，必须转整体。
    var turn = (typeof spec.turn === 'number' && isFinite(spec.turn)) ? Math.max(-180, Math.min(180, spec.turn)) : 0;
    // 手指已在上面**逐段**写入每一帧（含自动补的那段"回到中性"：它没写 fingers ⇒ 手指保持不变，
    // 与原"整段常量"行为一致）。旧版这里是把整段常量一次性写进所有帧，已废弃。
    // 把"这次到底做了什么"一并交出去：调用方据此打日志/告警。
    // 教训：蹲/跪这种"配套解算"一旦因为缺数据没生效，**必须有人喊出来**，不能再静默。
    return {
      fps: fps, frames: frames, rootY: rootY, turn: turn,
      chain: !!spec.chain,                       // ★ v11.12：连招标记（末尾不回中性，见上）
      askedCrouch: Math.max(0, Math.min(1, +(spec.crouch || 0))),
      askedKneel: Math.max(0, Math.min(1, +(spec.kneel || 0))),
      // ★ 必须判"真的有左右手型"再算数：空对象 {} 在 JS 里是 truthy，
      //   旧写法会把"没选任何手型"也标成 askedFingers=1 ⇒ 日志刷出一堆"手型已应用：{}"，
      //   让人误以为手型已经生效（实际什么都没应用）。逐段 fingers 也算。
      askedFingers: (function () {
        var fs = spec.fingers;
        if (fs && (fs.l != null || fs.r != null)) return 1;
        if (Array.isArray(spec.steps)) for (var si = 0; si < spec.steps.length; si++) {
          var sf = spec.steps[si] && spec.steps[si].fingers;
          if (sf && (sf.l != null || sf.r != null)) return 1;
        }
        return 0;
      })(),
      plan: plan ? plan.info : null
    };
  }

  /** 预设 → spec（不存在则返回 null） */
  function preset(name) {
    var p = PRESETS[name];
    return p ? JSON.parse(JSON.stringify(p)) : null;
  }

  /** 注册一个自定义预设（用户在面板里摆好的造型）。同名覆盖。 */
  function registerPreset(name, spec) {
    if (!name || !spec) return false;
    PRESETS[name] = spec;
    return true;
  }

  var api = {
    CHANNELS: CHANNELS, PRESETS: PRESETS, BONE_ORDER: BONE_ORDER, BONE_CHAIN: BONE_CHAIN,
    DEFAULT_RIG: DEFAULT_RIG, channelNames: channelNames, compose: compose, preset: preset,
    registerPreset: registerPreset,
    solveKnee: solveKnee, legPlan: legPlan,                                                 // 腿部解析 IK（便于离线自测）
    fingerJoints: fingerJoints, HAND_SHAPES: HAND_SHAPES, FINGER_BONES: FINGER_BONES,       // 手指展开（自测）
    overlayCompose: overlayCompose, qScaleAngle: qScaleAngle,                               // 叠加合成（自测）
    axisFor: axisFor, qRotate: qRotate, qMul: qMul, qInv: qInv, qIsIdentity: qIsIdentity, qSlerp: qSlerp   // 便于离线自测
  };
  root.EmbodiedCompose = api;
})(typeof window !== 'undefined' ? window : globalThis);
