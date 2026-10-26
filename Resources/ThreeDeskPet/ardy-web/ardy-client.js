/* ardy-mini 浏览器推理客户端（第 1 步：把运行时跑通，先不驱动模型）
 *
 * Worker = 官方打包产物 ardy-web/ardy-worker.js（Apache-2.0，见 ARDY_LICENSE.txt），
 * 协议（protocol.ts）：
 *   命令 { requestId, type: "loadModel"|"generate"|"resetSession"|"restoreContinuation"|"cancel"|"dispose"|"getStatus"|"getWebGpuCapabilities", ... }
 *   loadModel: { baseUrl }                    ← 目录 URL（含 model.json.gz 与各文件）
 *   generate : { prompt, seed, durationFrames|durationSeconds, cfgWeight?, historyFrames?, mode?, initialTranslation?, initialHeading? }
 *   事件: workerReady / progress / modelLoaded / generationChunk / generationComplete / generationResult(v1) / status / webGpuCapabilities / 错误
 *
 * 资产走向：模型 baseUrl = /ardy/fp32/（本地静态服务映射到 Storage/ThreeDeskPet/Ardy）。
 *   ★ 固定 fp32 是**有意**的，别为"省 32 MiB"改成 fp16：① fp16 变体要求 WebGPU 的 shader-f16（本机不支持）；
 *     ② 本机 Ardy/ 下只下了 fp32 权重。详见 Ardy/README.md「Files and browser selection」。
 *          ORT 的 wasm 由 worker 解析成 <同源>/ort/（正好是插件内的 Resources/ThreeDeskPet/ort/）。
 */
(function () {
  'use strict';

  // 关键坑：pet.js 用的发送通道是**宿主桥 window.alifeWindow**（Alife 5；旧版是 Electron 的 ipcRenderer），
  // 不是 DOM 的 window.postMessage；而 pet.js 是 module，它的 postLog 要等它执行完才存在。
  // 本脚本是普通 script、先执行 → 早期日志必须自己走一次宿主桥，否则会**静默丢失**
  // （这正是"日志里一条 ardy 都没有"的真正原因）。
  var ipcCache;
  function hostSend(obj) {
    try {
      if (ipcCache === undefined)
        ipcCache = (typeof window !== 'undefined' && window.alifeWindow) ? window.alifeWindow : null;
      if (!ipcCache || typeof ipcCache.postMessage !== 'function') return false;
      ipcCache.postMessage(obj);
      return true;
    } catch (e) { return false; }
  }
  function log(level, text) {
    try { if (typeof postLog === 'function') { postLog(level, text); return; } } catch (e) { }
    if (hostSend({ type: 'log', level: level, text: text })) return;
    try { console.log(text); } catch (e) { }
  }

  var worker = null, seq = 0, pending = new Map();

  function describePayload(c) {
    if (!c) return '(空)';
    var keys = ['motion', 'joints', 'hybridTokens', 'localRotations', 'globalRotations', 'rootPositions', 'footContacts', 'globalRootHeading'];
    var parts = [];
    for (var i = 0; i < keys.length; i++) {
      var v = c[keys[i]];
      if (v && typeof v.length === 'number') parts.push(keys[i] + '=' + v.length + '(' + (v.constructor ? v.constructor.name : '?') + ')');
    }
    if (typeof c.frameCount === 'number') parts.push('frameCount=' + c.frameCount);
    if (typeof c.startFrame === 'number') parts.push('startFrame=' + c.startFrame);
    if (typeof c.fps === 'number') parts.push('fps=' + c.fps);
    if (c.timingsMs) parts.push('timings=' + JSON.stringify(c.timingsMs));
    if (c.manifest) parts.push('manifest=有');
    return parts.length ? parts.join(', ') : ('字段: ' + Object.keys(c).join(','));
  }

  function post(type, extra) {
    var requestId = 'r' + (++seq);
    return new Promise(function (resolve, reject) {
      pending.set(requestId, { resolve: resolve, reject: reject });
      setTimeout(function () {   // 兜底超时，避免永久挂住（生成可能较慢，给足 5 分钟）
        if (pending.has(requestId)) { pending.delete(requestId); reject(new Error('超时: ' + type)); }
      }, 300000);
      var msg = { requestId: requestId, type: type };
      if (extra) for (var k in extra) msg[k] = extra[k];
      worker.postMessage(msg);
    });
  }

  function ensureWorker() {
    if (worker) return worker;
    var wurl = new URL('ardy-web/ardy-worker.js', location.href).href;
    log('info', '[ardy] 建 Worker: ' + wurl + '（mode=module）');
    try {
      worker = new Worker(wurl, { type: 'module' });
    } catch (e) {
      log('error', '[ardy] Worker 创建失败: ' + ((e && e.message) || e));
      throw e;
    }
    worker.onmessageerror = function (e) { log('error', '[ardy] worker 消息无法反序列化: ' + ((e && e.data) || '')); };
    worker.onmessage = function (ev) {
      var m = ev.data || {};
      if (m.type === 'progress') {
        log('info', '[ardy] ' + (m.completed || 0) + '/' + (m.total || 0) + ' ' + (m.message || ''));
        return;
      }
      if (m.type === 'generationChunk') {          // 流式推送（流式播放时用；这里只报形状）
        log('info', '[ardy] 收到一帧: ' + describePayload(m.chunk));
        var pc = pending.get(m.requestId);
        if (pc) { pending.delete(m.requestId); pc.resolve(m); }
        return;
      }
      if (m.type === 'workerReady') {
        log('info', '[ardy] worker 就绪（协议 v' + m.protocolVersion + '）');
        return;
      }
      var p = pending.get(m.requestId);
      if (!p) { log('info', '[ardy] 事件: ' + m.type); return; }
      pending.delete(m.requestId);
      if (m.type && /error/i.test(String(m.type))) p.reject(new Error(m.message || JSON.stringify(m)));
      else p.resolve(m);
    };
    worker.onerror = function (e) {
      log('error', '[ardy] worker 错误: ' + ((e && (e.message || e.filename)) || '未知'));
    };
    return worker;
  }

  // ---- 生成参数：**跟上游模型卡的默认值对齐**（别再自己拍脑袋）----
  // 依据 = 随模型下下来的 Storages/ThreeDeskPet/Ardy/README.md（模型卡《Llama 3 ARDY Mini Core40 Browser》）：
  //   浏览器运行时的 Text CFG = **3.5**（模型卡 "Text CFG 3.5" 一项）。
  // 而我们原先写的是 2.0 —— 比作者默认更"松"。CFG 越高越贴合 text prompt、越低越自然飘逸，
  // 所以"生成结果不太听描述"很可能就出在这个数上。先把默认对齐成 3.5；若要更奔放再往下调这一个数。
  // ⚠ 若 worker 其实忽略 cfgWeight，改了不会有任何变化 —— 那就说明它被上游写死在运行时里。
  var ARDY_CFG_WEIGHT = 3.5;

  /** 后台预热：**只加载模型**（不生成）—— 把 AI 第一次 gen: 词条要扛的 6~12 秒冷启动提前吃掉。
   *  由 pet.js 的 scheduleArdyWarmup 在窗口就绪后延迟调用；失败只记日志，绝不影响任何功能。 */
  window.ardyWarmup = async function () {
    try {
      if (!navigator.gpu) { log('info', '[ardy] 预热跳过：此窗口没有 WebGPU（生成式本来就用不了）'); return false; }
      ensureWorker();
      if (window.__ardyModelReadyFor === worker) { log('info', '[ardy] 预热跳过：模型已在内存'); return true; }
      var t0 = performance.now();
      log('info', '[ardy] 后台预热：开始加载模型（684MB，首次较慢）…');
      var loaded = await post('loadModel', { baseUrl: new URL('ardy/fp32/', location.href).href });
      window.__ardyModelReadyFor = worker;
      var info = (loaded && loaded.model) || {};
      log('info', '[ardy] 后台预热完成 ' + Math.round(performance.now() - t0) + 'ms  id=' + info.id
        + ' fps=' + info.fps + ' → 之后 gen: 词条可即时生成');
      return true;
    } catch (e) {
      log('warn', '[ardy] 后台预热失败（不影响使用，首次调用时会重试）：' + ((e && e.message) || e));
      return false;
    }
  };

  /** 第 1 步自检：加载模型 → 生成一段 → 打印形状与耗时（不驱动模型） */
  window.ardyTest = async function (prompt) {
    try {
      ensureWorker();
      var t0 = performance.now();
      log('info', '[ardy] 开始加载模型（baseUrl=/ardy/fp32/，首次要读 684MB 并建 WebGPU 会话，耐心等）…');
      var loaded = await post('loadModel', { baseUrl: new URL('ardy/fp32/', location.href).href });
      var msLoad = Math.round(performance.now() - t0);
      var info = loaded.model || {};
      log('info', '[ardy] 模型加载完成 ' + msLoad + 'ms  id=' + info.id + ' variant=' + info.variant +
        ' fps=' + info.fps + ' gen=' + info.generationFrames + ' min=' + info.minFrames + ' max=' + info.maxFrames +
        ' manifest=' + (info.manifest ? '有' : '无'));

      var p = prompt || 'a person waves hello with the right hand';
      var t1 = performance.now();
      log('info', '[ardy] 生成中… prompt="' + p + '"');
      var res = await post('generate', { mode: 'replace', prompt: p, seed: 1234, durationFrames: 40, cfgWeight: ARDY_CFG_WEIGHT });
      var ms = Math.round(performance.now() - t1);
      var payload = res.result || res.chunk || res;
      log('info', '[ardy] 生成完成 ' + ms + 'ms  ' + describePayload(payload));
      window.__ardyLast = res;
      return res;
    } catch (e) {
      log('error', '[ardy] 失败：' + ((e && e.message) ? e.message : e));
      return null;
    }
  };

  /** 骨架：直接 fetch manifest 自己解压（不依赖 worker 返回对象的字段形状）*/
  var _skelCache = null;
  async function loadSkeleton() {
    if (_skelCache) return _skelCache;
    if (typeof DecompressionStream !== 'function') { log('error', '[ardy] 环境不支持 DecompressionStream，无法解 manifest'); return null; }
    var url = new URL('ardy/fp32/model.json.gz', location.href).href;
    var r = await fetch(url);
    if (!r.ok) { log('error', '[ardy] 取 manifest 失败：HTTP ' + r.status + ' ' + url); return null; }
    var buf = await r.arrayBuffer();
    var text = await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
    var man = JSON.parse(text);
    if (!man || !man.skeleton) { log('error', '[ardy] manifest 里没有 skeleton'); return null; }
    _skelCache = man.skeleton;
    log('info', '[ardy] 骨架已读取：' + man.skeleton.name + '，' + man.skeleton.joint_names.length + ' 关节');
    return _skelCache;
  }

  /** 第 2 步自检：加载 → 生成 → 关节位置重定向到当前 VRM → 交 pet.js 播放
   *  opts.seed   ：指定种子（验收重试要换种子；不传 = 随机）
   *  opts.dryRun ：只生成 + 打签名，**不喂给桌宠播放**（验收用，避免"失败的姿势先闪一下"）
   */
  window.ardyPlay = async function (prompt, opts) {
    opts = opts || {};
    try {
      var R = window.ArdyRetarget;
      if (!R) { log('error', '[ardy] 重定向模块未加载（ardy-retarget.js）'); return null; }
      // 骨架基：现场要一次（VRM 可能还在加载）→ 最多等 20 秒，避免"点太早"直接失败
      var rig = null;
      for (var w = 0; w < 40; w++) {
        rig = window.embodiedRigEnsure ? window.embodiedRigEnsure() : window.EmbodiedRig;
        if (rig) break;
        if (w === 0) log('info', '[ardy] 等待桌宠载入 VRM 并量出骨架基（最多 20 秒）…');
        await new Promise(function (r) { setTimeout(r, 500); });
      }
      if (!rig) {
        log('error', '[ardy] 等不到 VRM 骨架基（20 秒超时）：桌宠模型还没加载完，或该模型没有 humanoid / 缺两侧上臂');
        return null;
      }
      if (!window.ardyFeed) { log('error', '[ardy] pet.js 未提供 ardyFeed（版本不匹配？）'); return null; }

      ensureWorker();
      var skel = await loadSkeleton();
      if (!skel) return null;
      var state = R.build(skel);

      // 模型只加载一次：worker 常驻内存，重复 loadModel 会重新下载 684MB + 重建会话（实测 6~12 秒）
      if (window.__ardyModelReadyFor === worker) {
        log('info', '[ardy] 模型已在内存，跳过加载');
      } else {
        var t0 = performance.now();
        log('info', '[ardy] 开始加载模型（第 2 步）…');
        await post('loadModel', { baseUrl: new URL('ardy/fp32/', location.href).href });
        window.__ardyModelReadyFor = worker;   // 绑到 worker 实例上：worker 重建后自动失效
        log('info', '[ardy] 模型就绪 ' + Math.round(performance.now() - t0) + 'ms，开始生成…');
      }

      // 提示词要写清"举高"：模型对 "waves hello" 的理解常是胸前伸手挥（实测如此）
      var p = prompt || 'a person raises the right hand high above the head and waves hello';
      log('info', '[ardy] 生成中… prompt="' + p + '"');
      var t1 = performance.now();
      // ★ 种子每次随机：写死种子会让"每次生成一模一样的动作"，于是任何管线修复都无法改变画面内容
      //   （排查时会被误判成"改了没用"）。随机 + 把种子打进日志 → 既能换动作，也能复现某一次。
      var seed = (opts.seed != null) ? (opts.seed | 0) : ((Math.random() * 1e9) | 0);
      log('info', '[ardy] seed=' + seed + (opts.dryRun ? '（dry-run：只生成不播放）' : ''));
      var res = await post('generate', { mode: 'replace', prompt: p, seed: seed, durationFrames: 40, cfgWeight: ARDY_CFG_WEIGHT });
      var payload = res.result || res.chunk || res;
      var joints = payload.joints, fc = payload.frameCount || 0, fps = payload.fps || 20;
      log('info', '[ardy] 生成完成 ' + Math.round(performance.now() - t1) + 'ms  frames=' + fc + ' fps=' + fps);
      if (!joints || !fc) { log('error', '[ardy] 返回值里没有 joints / frameCount'); return null; }

      // 每帧 81 个数 = [根位置(3)] + [26 关节 × 3]（manifest.motion_layout）
      var per = Math.round(joints.length / fc);
      if (per !== 81) log('warn', '[ardy] 每帧 ' + per + ' 个数（预期 81），仍按 81 切分');
      var raw = [];
      for (var i = 0; i < fc; i++) raw.push(joints.subarray ? joints.subarray(i * 81, i * 81 + 81) : joints.slice(i * 81, i * 81 + 81));

      // 布局自校验：骨骼长度跨帧应恒定（读错偏移会立刻暴露）
      var rigid = R.rigidityCheck(state, raw), spread = 0;
      for (var j = 0; j < rigid.length; j++) if (rigid[j].relSpread > spread) spread = rigid[j].relSpread;
      log('info', '[ardy] 布局自校验：骨骼长度跨帧抖动最大 ' + (spread * 100).toFixed(2) + '%（读错会 >50%）');

      var nf = R.deriveFrame(state, raw[0]);
      var fv = function (v) { return '[' + v.map(function (x) { return (+x).toFixed(2); }).join(',') + ']'; };
      if (nf) log('info', '[ardy] ardy 坐标基(从数据量出)：left=' + fv(nf.left) + ' up=' + fv(nf.up) + ' fwd=' + fv(nf.fwd));

      // 骨架基字段自检（pet.js 用的是 lateral 字段名；缺字段会静默 0 帧，所以先明确报出来）
      var nrig = R.normalizeRig ? R.normalizeRig(rig) : rig;
      if (!nrig) {
        log('error', '[ardy] 骨架基字段不全：keys=[' + Object.keys(rig || {}).join(',') + ']（需要 left/lateral + up + fwd）');
        return null;
      }
      // 根位移：模块按 "VRM髋到头 ÷ ardy髋到头" 换算比例；并以**首帧为原点**（片段从"无偏移"开始，不会瞬移）
      var rootScale = (R.scaleHint && rig.hipToHead) ? R.scaleHint(state, rig.hipToHead) : 1;
      var rootBase = null, rootMax = 0, rootMaxY = 0;
      // ★ 坐标基**每片段只算一次**（用首帧）。basis 里的 fwd 来自"脚→脚趾"，脚在小腿/踝转动时
      //   会跟着俯仰 → 逐帧重算 basis = **整个身体跟着脚一起转**（实测：蹲下变成"逐渐后仰"，
      //   而脚一直平放的"举手挥手"看不出来）。片段的真实转动由关节位置自身表达，basis 不该跟着动。
      // ★ 坐标基用 **manifest 的规范静止姿势（neutral_joints，标准 T-pose）** 定义，不用首帧：
      //   首帧可能是"手抬在胸前"这种本来就歪的姿势 → 拿它定基会让**整段动作系统性转过去**
      //   （实测表现："视角变了 + 上半身瞎动 + 抽象"）。规范静止姿势与动作无关、与 seed 无关，是稳定的北极星。
      var clipFrame = R.deriveFrame(state, null);
      // 扭转来源：payload.globalRotations = frameCount × 27关节 × 9（每关节 3×3，含 roll）
      var globalRot = payload.globalRotations || null;
      var matIdx = 0, matCheckWorst = 1;
      var retarget = function (fr) {
        var o = R.retargetFrame(state, fr, rig, {
          applyRoot: true, scale: rootScale, frame: clipFrame,
          // ★ 暂时关闭"矩阵扭转"：自检已判定这份 globalRotations 的语义与假设不符（点积 -0.94，
          //   行/列主序都不对）→ 算出的扭转角不可信，会把骨骼 roll 弄坏（方向校验能过、但画面怪异）。
          //   等语义确证后再启用；matCheck 自检保留，方便将来验证。
          mat: null,
          matColMajor: true
        });
        matIdx++;
        if (o && typeof o.matCheck === 'number' && o.matCheck < matCheckWorst) matCheckWorst = o.matCheck;
        if (!o) return null;
        if (o.rootDelta) {
          if (!rootBase) rootBase = o.rootDelta.slice();
          o.rootDelta = [o.rootDelta[0] - rootBase[0], o.rootDelta[1] - rootBase[1], o.rootDelta[2] - rootBase[2]];
          var m = Math.hypot(o.rootDelta[0], o.rootDelta[2]);
          if (m > rootMax) rootMax = m;
          var my = Math.abs(o.rootDelta[1]);
          if (my > rootMaxY) rootMaxY = my;
        }
        return o;
      };
      var first = retarget(raw[0]);
      if (!first) { log('error', '[ardy] 首帧算不出坐标基：骨架关节名或每帧布局与 manifest 不符'); return null; }
      // ★ 落地脚（footContacts）：给 pet.js 的"脚部 IK 防滑步"用（第 5 项）。
      //   形状兼容：长度 = fc 的 [左,右] 行 / 长度 = 2×fc 的扁平表 / 每项是对象 {left,right}。
      var fcArr = payload.footContacts || null, fcPer = 0;
      if (fcArr && fcArr.length) {
        fcPer = Math.round(fcArr.length / fc);
        if (!(fcPer >= 1)) fcPer = 0;
        log('info', '[ardy] 落地脚数据：' + fcArr.length + ' 项（每帧 ' + fcPer + ' 个）'
          + (fcPer >= 2 ? ' ⇒ 供脚部 IK 用' : '（认不出左右 ⇒ 脚部 IK 改按速度自判）'));
      }
      var contactOf = function (idx) {
        if (!fcPer) return null;
        if (fcPer >= 2) return { l: +fcArr[idx * fcPer] > 0.5, r: +fcArr[idx * fcPer + 1] > 0.5 };
        var v = fcArr[idx];
        if (v && typeof v === 'object') return { l: !!(v.left || v.l), r: !!(v.right || v.r) };
        return null;
      };
      var frames = [{ aims: first.aims, root: first.rootDelta, contact: contactOf(0) }];
      for (i = 1; i < fc; i++) {
        var out = retarget(raw[i]);
        if (out && out.aims.length) frames.push({ aims: out.aims, root: out.rootDelta, contact: contactOf(i) });
      }
      // 坐标基漂移自检：证明"逐帧重算 basis"到底会歪多少（也是这条 bug 的回归哨兵）
      var midFrame = R.deriveFrame(state, raw[Math.floor(fc / 2)]);
      if (clipFrame && midFrame) {
        var dU = clipFrame.up[0] * midFrame.up[0] + clipFrame.up[1] * midFrame.up[1] + clipFrame.up[2] * midFrame.up[2];
        var dF = clipFrame.fwd[0] * midFrame.fwd[0] + clipFrame.fwd[1] * midFrame.fwd[1] + clipFrame.fwd[2] * midFrame.fwd[2];
        log('info', '[ardy] 坐标基漂移自检：up·中帧=' + dU.toFixed(3) + ' fwd·中帧=' + dF.toFixed(3) +
          '（<0.99 = 脚/臂在动；已固定用首帧的基，否则身体会跟着歪）');
        // 扭转/矩阵布局自检：矩阵给的骨轴方向应 ≈ 位置推的骨轴方向（差很多 = 行/列主序要翻）
        log('info', '[ardy] 扭转自检：矩阵骨轴 vs 位置骨轴 最差点积=' + matCheckWorst.toFixed(3) +
          (matCheckWorst > 0.9 ? ' ✓（行主序正确）' : ' ← 需要把 matColMajor 改成 true'));
      }
      log('info', '[ardy] 根位移：比例 ' + rootScale.toFixed(3) + '，水平最大 ' + rootMax.toFixed(3) +
        '，竖向最大 ' + rootMaxY.toFixed(3) + '（模型单位；竖向 ≈0 说明这段动作没有起落/蹲下，水平 ≈0 说明是原地）');

      var mid = frames[Math.floor(frames.length / 2)];
      // 注意：骨盆那条 aim 只有 yaw、没有 dir —— 直接 fv(a.dir) 会抛 `undefined.map`，
      // 异常在 try 里被吞成"第2步失败"，看起来像"重定向失败"，其实只是日志格式化崩了。
      var pick = function (fr, bone) {
        var a = fr.aims.filter(function (x) { return x.bone === bone; })[0];
        if (!a) return '(无)';
        if (a.dir) return fv(a.dir);
        if (typeof a.yaw === 'number') return 'yaw ' + (a.yaw * 180 / Math.PI).toFixed(1) + '°';
        return '(无)';
      };
      log('info', '[ardy] 抽查朝向 首帧 右臂=' + pick(frames[0], 'rightUpperArm') + ' 左臂=' + pick(frames[0], 'leftUpperArm') +
        ' ｜中帧 右臂=' + pick(mid, 'rightUpperArm') + '（右臂变了说明动作被重定向，左臂不该乱动）');
      // 下肢单独报：用来判定"腿像两根棍"是模型本来就没屈膝，还是我们没驱动
      // 原始姿势地面真值：把 ardy **自己的关节位置**（髋为原点、ardY 骨架单位、已换基到 VRM 世界系）
      // 打出来。用途：判定"看到的怪姿势"到底是**数据本身**就这样，还是**我们的映射/写入**搞歪了。
      var gt = function (fr, tag) {
        var h = R.jointPos(fr, state.index.Hips);
        var P = function (n) {
          var p = R.jointPos(fr, state.index[n]);
          return [p[0] - h[0], p[1] - h[1], p[2] - h[2]];
        };
        var f3 = function (v) { return '(' + v.map(function (x) { return (+x).toFixed(2); }).join(',') + ')'; };
        log('info', '[ardy] 原始姿势[' + tag + '] 头=' + f3(P('Head')) + ' 左手=' + f3(P('LeftHand')) +
          ' 右手=' + f3(P('RightHand')) + ' 左足=' + f3(P('LeftFoot')) + ' ｜约定：+Y=上 −X=角色右 +Z=前');
      };
      gt(raw[0], '首帧'); gt(raw[Math.floor(fc / 2)], '中帧');
      // ★★ 动作签名 v2（2026-10-14 补齐 4 项）——这是"生成式语义层防线"的前置。
      //   为什么必须补：旧签名只量 **右手高于肩 + 右膝角** ⇒ 低头/抬头/环顾/走路/跳跃起落 打出来
      //   全是同一串 `手-0.53/膝12°`（等于没信息，用户实测原话"它们全打印 手−0.53/膝12°"）。
      //   新增：①左手 ②头部朝向（头相对髋的单位向量，上/前分量）③头部 yaw（环顾靠它）
      //        ④根位移（水平/竖直；走路/跳跃起落靠它）⑤（已有）骨盆 yaw
      //   ⇒ 词表里 verified 的 10 条 expect（rightHandAboveShoulder / bothHandsAboveShoulder /
      //     handAboveShoulder / handsDown / kneeBend / headPitchForward / headPitchUp / headYawChange /
      //     headPitchSmall / rightHandToHead / bodyYawSmall）**全部**有据可判。
      //   约定（和 gt 那行一致）：+Y=上 −X=角色右 +Z=前；膝角 0°=腿伸直（大小腿方向一致），越大越屈。
      var aimOf = function (fr, bone) {
        var a = (fr.aims || []).filter(function (x) { return x.bone === bone; })[0];
        return a || null;
      };
      var yawDeg = function (fr, bone) {
        var a = aimOf(fr, bone);
        return (a && typeof a.yaw === 'number') ? (a.yaw * 180 / Math.PI) : null;
      };
      var sigNums = function (fr, rootIdx) {
        var J = function (n) { return R.jointPos(fr, state.index[n]); };
        var sh = J('RightShoulder'), rh = J('RightHand'), lh = J('LeftHand'), hip = J('Hips'), hd = J('Head');
        var kn = J('RightLeg'), an = J('RightFoot');
        var d1 = [kn[0] - hip[0], kn[1] - hip[1], kn[2] - hip[2]];
        var d2 = [an[0] - kn[0], an[1] - kn[1], an[2] - kn[2]];
        var n1 = Math.hypot(d1[0], d1[1], d1[2]) || 1, n2 = Math.hypot(d2[0], d2[1], d2[2]) || 1;
        var c = (d1[0] * d2[0] + d1[1] * d2[1] + d1[2] * d2[2]) / (n1 * n2);
        var knee = Math.acos(Math.max(-1, Math.min(1, c))) * 180 / Math.PI;
        var hv = [hd[0] - hip[0], hd[1] - hip[1], hd[2] - hip[2]];
        var hn = Math.hypot(hv[0], hv[1], hv[2]) || 1;
        var rf = (frames && frames[rootIdx]) ? frames[rootIdx] : null;
        var root = rf && rf.root ? rf.root : null;
        return {
          rHand: rh[1] - sh[1], lHand: lh[1] - sh[1], knee: knee,
          headUp: hv[1] / hn, headFwd: hv[2] / hn,
          headYaw: yawDeg(fr, 'head'), pelvisYaw: yawDeg(fr, 'hips'),
          rootH: root ? Math.hypot(root[0], root[2]) : 0, rootV: root ? root[1] : 0,
          rHandP: [rh[0], rh[1], rh[2]], lHandP: [lh[0], lh[1], lh[2]], headP: [hd[0], hd[1], hd[2]], hipP: [hip[0], hip[1], hip[2]],
        };
      };
      var sig = function (o) {
        return '手' + (o.rHand >= 0 ? '+' : '') + o.rHand.toFixed(2)
          + '/左' + (o.lHand >= 0 ? '+' : '') + o.lHand.toFixed(2)
          + '/膝' + o.knee.toFixed(0) + '°'
          + '/头(上' + o.headUp.toFixed(2) + ' 前' + o.headFwd.toFixed(2) + ')'
          + (o.headYaw === null ? '' : '/头yaw' + o.headYaw.toFixed(0) + '°')
          + '/骨盆yaw' + (o.pelvisYaw === null ? '?' : o.pelvisYaw.toFixed(0) + '°')
          + '/根(横' + o.rootH.toFixed(3) + ' 竖' + o.rootV.toFixed(3) + ')';
      };
      var sigFirst = sigNums(raw[0], 0);
      var midIdxRaw = Math.floor(fc / 2), midIdxOut = Math.min(frames.length - 1, midIdxRaw);
      var sigMid = sigNums(raw[midIdxRaw], midIdxOut);
      var sigSamp = [];
      for (var si5 = 0; si5 < 6; si5++) {
        var rawI = Math.round((fc - 1) * si5 / 5);
        sigSamp.push(sigNums(raw[rawI], Math.min(frames.length - 1, rawI)));
      }
      log('info', '[ardy] 动作签名 首帧 ' + sig(sigFirst) + ' ｜中帧 ' + sig(sigMid) + '（验收用）');
      log('info', '[ardy] 动作签名 采样 ' + sigSamp.map(sig).join(' ｜ '));
      log('info', '[ardy] 下肢抽查 中帧 右大腿=' + pick(mid, 'rightUpperLeg') + ' 右小腿=' + pick(mid, 'rightLowerLeg') +
        ' 右足=' + pick(mid, 'rightFoot') + ' ｜骨盆=' + pick(mid, 'hips') + ' 脊柱=' + pick(mid, 'spine') +
        '（若大小腿方向几乎相同 = 该动作本来就没屈膝）');

      window.__ardyLastFrames = frames;
      // 把这次的成品与签名挂出来：验收函数（ardyPlayVerified）照着它判，不必重新生成
      window.__ardyLastGen = {
        phrase: p, seed: seed, fps: fps, frames: frames,
        sigFirst: sigFirst, sigMid: sigMid, sigSamp: sigSamp,
        rootMax: rootMax, rootMaxY: rootMaxY,
      };
      if (opts.dryRun) {
        log('info', '[ardy] dry-run：已生成 ' + frames.length + ' 帧但**不播放**（供验收判定）');
        return true;
      }
      window.ardyFeed({ fps: fps, frames: frames });
      log('info', '[ardy] 已交给桌宠播放：' + frames.length + ' 帧 @' + fps + 'fps');
      return true;
    } catch (e) {
      log('error', '[ardy] 第2步失败：' + ((e && e.message) ? e.message : e));
      return null;
    }
  };

  // ================= ★★ 生成式「语义层防线」：验收 → 换种子重试 → 退回预置 =================
  // 背景（2026-10-14）：词表分三档、签名已有，但**只有判定没有失败处理** —— 生成了一个不达标的动作照样播，
  //   AI 以为做成了。这里补闭环：
  //     生成(dry-run，不喂桌宠) → 按该词条的 expect 自动验收 → 不过 ⇒ 换 seed 重试一次
  //     → 仍不过 ⇒ **不播放**，交给 pet.js 退回预置动作（举手），并把"只是近似/已退回"写进 <bodystate>
  //   为什么 dry-run 是关键：失败的姿势**不会先闪一下**（否则重试就是"看得见的抖动"）。
  var _phrasesCache = null;
  async function loadPhrases() {
    if (_phrasesCache) return _phrasesCache;
    try {
      var r = await fetch('ardy-phrases.json', { cache: 'no-store' });
      _phrasesCache = await r.json();
    } catch (e) {
      log('warn', '[ardy] 读 ardy-phrases.json 失败（验收降级为"只生成不判定"）：' + e.message);
      _phrasesCache = null;
    }
    return _phrasesCache;
  }
  /** 按短语或标签取词条（含 expect / evidence） */
  window.ardyPhraseExpect = async function (phraseOrLabel) {
    var j = await loadPhrases();
    if (!j) return null;
    var all = [].concat(j.verified || [], j.candidates || []);
    for (var i = 0; i < all.length; i++) {
      var it = all[i];
      if (!it) continue;
      if (it.phrase === phraseOrLabel || (it.label && it.label === phraseOrLabel)) return it;
    }
    return null;
  };
  // 判据阈值**全部来自实测证据**（ardy-phrases.json 的 evidence），不是凭空设的：
  //   膝：站直 12~28°，开合跳中帧 65° ⇒ 屈膝阈值 45°
  //   骨盆 yaw：举手挥手 4.4°（用它判"身体没整体转"）⇒ bodyYawSmall 阈值 12°
  //   低头/抬头：头相对髋的"前"分量变化 ≥0.06（单位向量）
  //   环顾：头 yaw 跨帧变化 ≥12°；敬礼：手↔头 ≤ 0.8×（髋↔头）
  //   摆臂：手在 X（左右）方向跨帧变化 ≥0.05
  //   ★ slow / fast **暂无可靠阈值** ⇒ 标"未校准"，只记数字、**不参与判定**（绝不拿没校准的判据去拦动作）
  function verdictOf(expect, G) {
    var lines = [], bad = 0, checked = 0, uncal = [];
    var first = G.sigFirst, samp = (G.sigSamp && G.sigSamp.length) ? G.sigSamp : [G.sigFirst, G.sigMid];
    var mx = function (arr, f) { return Math.max.apply(null, arr.map(f)); };
    var mn = function (arr, f) { return Math.min.apply(null, arr.map(f)); };
    var maxR = mx(samp, function (s) { return s.rHand; });
    var maxL = mx(samp, function (s) { return s.lHand; });
    var maxKnee = mx(samp, function (s) { return s.knee; });
    var hFwdMax = mx(samp, function (s) { return s.headFwd; });
    var hFwdMin = mn(samp, function (s) { return s.headFwd; });
    var yaws = samp.map(function (s) { return s.headYaw; }).filter(function (x) { return typeof x === 'number'; });
    var yawRange = yaws.length ? (Math.max.apply(null, yaws) - Math.min.apply(null, yaws)) : null;
    var pelvisMax = mx(samp, function (s) { return Math.abs(s.pelvisYaw === null ? 0 : s.pelvisYaw); });
    var swing = 0;
    for (var i = 1; i < samp.length; i++) {
      swing = Math.max(swing,
        Math.abs(samp[i].rHandP[0] - samp[i - 1].rHandP[0]),
        Math.abs(samp[i].lHandP[0] - samp[i - 1].lHandP[0]));
    }
    var headMove = Math.max(Math.abs(hFwdMax - first.headFwd), Math.abs(hFwdMin - first.headFwd));
    var reachHead = 9;
    for (var i2 = 0; i2 < samp.length; i2++) {
      var s2 = samp[i2];
      var dh = Math.hypot(s2.rHandP[0] - s2.headP[0], s2.rHandP[1] - s2.headP[1], s2.rHandP[2] - s2.headP[2]);
      var hh = Math.hypot(s2.headP[0] - s2.hipP[0], s2.headP[1] - s2.hipP[1], s2.headP[2] - s2.hipP[2]) || 1;
      if (dh / hh < reachHead) reachHead = dh / hh;
    }
    var need = function (name, ok, human) {
      if (expect[name] === undefined) return;
      // ★★ expect 写 `false` = **必须不满足**（例：『双手过顶挥』的 `kneeBend:false` = 下肢不该动）。
      //   离线自测抓到过这个坑：当时把它当成"必须屈膝" ⇒ 合格的动作被判失败。
      if (expect[name] === false) ok = (ok === null) ? null : !ok;
      if (ok === null) { uncal.push(name); lines.push(name + '=未校准(' + human + ')'); return; }
      checked++;
      if (!ok) bad++;
      lines.push(name + '=' + (ok ? '✓' : '✗') + '(' + human + ')' + (expect[name] === false ? '[要求不满足]' : ''));
    };
    need('rightHandAboveShoulder', maxR > 0, '右手最高 ' + maxR.toFixed(2));
    need('handAboveShoulder', Math.max(maxR, maxL) > 0, '单手最高 ' + Math.max(maxR, maxL).toFixed(2));
    need('bothHandsAboveShoulder', (maxR > 0 && maxL > 0), '右' + maxR.toFixed(2) + ' 左' + maxL.toFixed(2));
    need('handsDown', (maxR < 0 && maxL < 0), '右' + maxR.toFixed(2) + ' 左' + maxL.toFixed(2));
    need('kneeBend', maxKnee >= 45, '最大膝角 ' + maxKnee.toFixed(0) + '°');
    need('armsSwing', swing >= 0.05, '手左右摆幅 ' + swing.toFixed(3));
    need('headPitchForward', (hFwdMax - first.headFwd) >= 0.06, '头前分量 ' + first.headFwd.toFixed(2) + '→' + hFwdMax.toFixed(2));
    need('headPitchUp', (first.headFwd - hFwdMin) >= 0.06, '头前分量 ' + first.headFwd.toFixed(2) + '→' + hFwdMin.toFixed(2));
    need('headPitchSmall', (headMove >= 0.02 && headMove < 0.12), '头变化 ' + headMove.toFixed(3));
    need('headYawChange', (yawRange === null ? null : (yawRange >= 12)), (yawRange === null ? '取不到 head 朝向' : ('头yaw 变化 ' + yawRange.toFixed(0) + '°')));
    need('rightHandToHead', reachHead <= 0.8, '手↔头/髋↔头 ' + reachHead.toFixed(2));
    need('bodyYawSmall', pelvisMax <= 12, '骨盆yaw 峰 ' + pelvisMax.toFixed(1) + '°');
    need('slow', null, '暂无阈值（要两次实测样本才能定）');
    need('fast', null, '暂无阈值（要两次实测样本才能定）');
    return { pass: (checked > 0 && bad === 0), checked: checked, bad: bad, lines: lines, uncalibrated: uncal };
  }
  /** ★ 生成 → 验收 → 换种子重试一次 → 仍不过就**放弃**（由 pet.js 退回预置动作） */
  window.ardyPlayVerified = async function (phraseOrLabel, opts) {
    opts = opts || {};
    var hit = await window.ardyPhraseExpect(phraseOrLabel);
    if (!hit) {
      log('info', '[ardy] 验收：「' + phraseOrLabel + '」不在词表 verified/candidates 里 ⇒ 不做判定，直接生成播放');
      var okPlain = await window.ardyPlay(phraseOrLabel);
      window.ardyLastVerdict = { phrase: phraseOrLabel, ok: !!okPlain, pass: null, skip: true };
      return { ok: !!okPlain, pass: null, skip: true };
    }
    var expect = hit.expect || {};
    var lastV = null, lastGen = null;
    for (var attempt = 1; attempt <= 2; attempt++) {
      var seed = (Math.random() * 1e9) | 0;
      var okGen = await window.ardyPlay(hit.phrase, { seed: seed, dryRun: true });
      if (!okGen) { log('warn', '[ardy] 验收：第 ' + attempt + ' 次生成失败（seed=' + seed + '）'); continue; }
      lastGen = window.__ardyLastGen || null;
      lastV = lastGen ? verdictOf(expect, lastGen) : null;
      log('info', '[ardy] 验收「' + (hit.label || hit.phrase) + '」第 ' + attempt + ' 次：'
        + (!lastV ? '无法判定' : (lastV.checked === 0 ? '判据未校准（不拦）' : (lastV.pass ? '通过 ✓' : '未过 ✗')))
        + (lastV ? (' ｜ ' + lastV.lines.join('　')) : ''));
      if (lastV && lastV.pass) {
        if (!opts.noPlay && lastGen && lastGen.frames) window.ardyFeed({ fps: lastGen.fps, frames: lastGen.frames });
        window.ardyLastVerdict = { phrase: hit.phrase, label: hit.label, ok: true, pass: true, attempt: attempt, approx: (lastV.checked === 0), lines: lastV.lines };
        log('info', '[ardy] 达标 ⇒ 播放（第 ' + attempt + ' 次生成）' + (lastV.checked === 0 ? '；注：本条判据未校准，"通过"只是不拦' : ''));
        return { ok: true, pass: true, attempt: attempt, approx: (lastV.checked === 0), verdict: lastV };
      }
    }
    window.ardyLastVerdict = {
      phrase: hit.phrase, label: hit.label, ok: false, pass: false, attempt: 2,
      lines: (lastV && lastV.lines) || [],
    };
    log('warn', '[ardy] 两次生成都没达自动验收 ⇒ **不播放这段生成结果**，交给上层退回预置动作（举手）');
    return { ok: false, pass: false, attempt: 2, verdict: lastV };
  };

  /** ★ 自检用：验收逻辑的**纯函数表驱动**测试（8 例，含反例）—— 不需要模型/网络，答案固定。
   *  用例数字直接取自 ardy-phrases.json 的 evidence（2026-10-14 实测）⇒ "判定对不对"是可证的。 */
  window.ardySelfTest = function () {
    var mk = function (o) {
      return {
        rHand: o[0], lHand: o[1], knee: o[2], headUp: 0.95, headFwd: o[3],
        headYaw: (o[4] === undefined ? 0 : o[4]), pelvisYaw: (o[5] === undefined ? 0 : o[5]),
        rootH: 0, rootV: 0,
        rHandP: [o[6] || 0, o[0], 0], lHandP: [0, o[1], 0],
        headP: [0, 1.0, o[3]], hipP: [0, 0.9, 0],
      };
    };
    var saluteMid = mk([0.2, -0.5, 12, 0.15, 0, 1, 0]);
    saluteMid.rHandP = [0, 1.08, 0.12];        // 手举到额头附近
    var cases = [
      ['开合跳', { rightHandAboveShoulder: true, kneeBend: true, armsSwing: true },
        [[-0.52, -0.5, 24, 0.12, 0, 2, 0], [0.3, 0.28, 40, 0.12, 0, 3, 0.25], [0.59, 0.5, 65, 0.13, 0, 4, -0.3], [0.4, 0.3, 50, 0.12, 0, 3, 0.2]], true],
      ['双手过顶挥（kneeBend:false=不许屈膝）', { bothHandsAboveShoulder: true, kneeBend: false },
        [[-0.48, -0.46, 18, 0.1, 0, 1, 0], [0.57, 0.55, 14, 0.1, 0, 2, 0.1], [0.5, 0.5, 16, 0.1, 0, 2, 0.05]], true],
      ['低头', { headPitchForward: true, handsDown: true },
        [[-0.53, -0.52, 12, 0.12, 0, 1, 0], [-0.54, -0.53, 12, 0.22, 0, 1, 0], [-0.54, -0.53, 12, 0.30, 0, 1, 0]], true],
      ['抬头', { headPitchUp: true, handsDown: true },
        [[-0.54, -0.54, 12, 0.28, 0, 1, 0], [-0.54, -0.54, 12, 0.18, 0, 1, 0], [-0.54, -0.54, 12, 0.09, 0, 1, 0]], true],
      ['抬头环顾', { headYawChange: true, handsDown: true },
        [[-0.56, -0.55, 12, 0.2, -15, 1, 0], [-0.57, -0.56, 12, 0.2, 5, 1, 0], [-0.56, -0.55, 12, 0.2, 15, 1, 0]], true],
      ['敬礼', { rightHandToHead: true },
        [[-0.5, -0.5, 12, 0.15, 0, 1, 0], saluteMid, [-0.5, -0.5, 12, 0.15, 0, 1, 0]], true],
      ['快速点头（fast 未校准⇒不参与判定）', { headPitchSmall: true, fast: true },
        [[-0.53, -0.52, 12, 0.15, 0, 1, 0], [-0.53, -0.52, 12, 0.20, 0, 1, 0], [-0.53, -0.52, 12, 0.14, 0, 1, 0]], true],
      ['反例·假举手（应判**不通过**）', { rightHandAboveShoulder: true, bodyYawSmall: true },
        [[-0.53, -0.52, 12, 0.15, 0, 2, 0], [-0.53, -0.52, 12, 0.15, 0, 2, 0], [-0.53, -0.52, 12, 0.15, 0, 2, 0]], false],
    ];
    var pass = 0, fail = 0, detail = [];
    for (var i = 0; i < cases.length; i++) {
      var c = cases[i];
      var samp = c[2].map(function (x) { return (x && x.rHandP) ? x : mk(x); });
      var v = verdictOf(c[1], { sigFirst: samp[0], sigSamp: samp, sigMid: samp[Math.floor(samp.length / 2)] });
      if (v.pass === !!c[3]) pass++;
      else { fail++; detail.push(c[0] + '（期望' + (c[3] ? '通过' : '不通过') + '，实际' + (v.pass ? '通过' : '不通过') + '）'); }
    }
    return { pass: pass, fail: fail, n: cases.length, note: detail.join('；') };
  };

  window.ardyChunkInfo = describePayload;
  // 立即上报（不等 timer）：这样"日志里有没有 ardy"就能直接判断脚本是否加载成功
  log('info', '[ardy] 客户端脚本已加载：等待点击「第1步自检」，或控制台执行 ardyTest("a person waves hello")');
  // 页面级兜底：脚本/模块加载失败、未捕获异常都写进日志
  try {
    window.addEventListener('error', function (e) {
      log('error', '[ardy] 页面错误: ' + ((e && (e.message || e.filename)) || '未知') + ' @' + ((e && e.filename) || '') + ':' + ((e && e.lineno) || 0));
    });
    window.addEventListener('unhandledrejection', function (e) {
      log('error', '[ardy] 未处理的 Promise 拒绝: ' + ((e && e.reason && (e.reason.message || e.reason)) || '未知'));
    });
  } catch (e) { }
})();
