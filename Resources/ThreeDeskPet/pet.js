// ---- 宿主桥（Alife 5：WebView2 + window.alifeWindow；没有 Electron，也没有 Node 的 require/fs）----
const petBridge = (typeof window !== 'undefined' && window.alifeWindow) ? window.alifeWindow : null;

const petChannel = new URLSearchParams(location.search).get('petChannel') || 'pet';

function postMessage(data) {
  try { if (petBridge) petBridge.postMessage(data); } catch (e) { /* ignore */ }
}

// ---- 本地磁盘文件（模型/动作/贴图常放在插件目录之外）----
// Alife 5 的前端没有 Node，读不了 fs；宿主给了本机回环静态服务 /disk/<绝对路径>（只读），统一走 fetch。
const PET_HTTP_BASE = (location.protocol === 'http:' || location.protocol === 'https:') ? location.origin : null;
/** file:///E:/a/b.vrm → http://127.0.0.1:PORT/disk/E%3A/a/b.vrm（保留 / 分段，供贴图相对路径解析） */
function diskUrl(u) {
  const s = String(u == null ? '' : u);
  if (!/^file:/i.test(s) || !PET_HTTP_BASE) return s;
  try {
    const p = decodeURIComponent(new URL(s).pathname).replace(/^\/+/, '');
    return PET_HTTP_BASE + '/disk/' + p.split('/').map(encodeURIComponent).join('/');
  } catch (e) { return s; }
}
function isLocalFile(u) { return /^file:/i.test(String(u == null ? '' : u)); }
/** 读取本地文件（返回 Uint8Array）；非 file:// 的地址原样 fetch。 */
async function readLocalFile(u) {
  const target = diskUrl(u);
  if (!/^https?:/i.test(target)) throw new Error('无法读取本地文件（宿主静态服务不可用）：' + u);
  const resp = await fetch(target);
  if (!resp.ok) throw new Error('读取本地文件失败 HTTP ' + resp.status + '：' + u);
  return new Uint8Array(await resp.arrayBuffer());
}

const messageBus = {
  _h: new Map(),
  on(t, h) { if (!this._h.has(t)) this._h.set(t, []); this._h.get(t).push(h); },
  _d(m) { (this._h.get(m.type) || []).forEach(h => h(m)); }
};
// ★★ 面板类消息的"注册自检"（针对"某些面板点了没反应"这类最难查的故障）：
//   顶层代码里一旦抛异常，它**之后**的所有 `messageBus.on(...)` 都不会执行 —— 症状正是
//   "某个面板点了完全没反应"，而且**静默**（日志里没有报错，只是没反应）。
//   这里把 5 个面板主题的注册登记下来，开机打一行 ⇒ 能一眼区分：
//     · 已注册 5/5        ⇒ 处理器都在（问题在面板构建/位置）
//     · 少了 xxx          ⇒ 它之前的顶层代码抛过异常（顺带会看到那条 error）
const PANEL_TOPICS = ['settings_open', 'model_parts_open', 'motions_open', 'expressions_open', 'models_open'];
const panelReg = [];
{
  const _on = messageBus.on.bind(messageBus);
  messageBus.on = function (t, h) { if (PANEL_TOPICS.indexOf(t) >= 0) panelReg.push(t); return _on(t, h); };
}
setTimeout(() => {   // 顶层代码此时已全部执行完（定时器在同步脚本之后）
  try {
    const missing = PANEL_TOPICS.filter(t => panelReg.indexOf(t) < 0);
    postLog('info', '面板处理器自检：已注册 ' + panelReg.length + '/' + PANEL_TOPICS.length + '［' + panelReg.join('、') + '］'
      + (missing.length ? '｜⚠ 缺失 ' + missing.join('、') + '（它之前的顶层代码抛过异常，请把日志里的报错发我）' : ''));
  } catch (e) { }
}, 1500);
if (petBridge && typeof petBridge.onMessage === 'function') {
  petBridge.onMessage((incoming) => {
    let msg = incoming;
    if (typeof msg === 'string') { try { msg = JSON.parse(msg); } catch { return; } }
    if (!msg || typeof msg.type !== 'string') return;
    messageBus._d(msg);
  });
} else {
  postLog('error', '宿主桥 window.alifeWindow 不可用：桌宠无法接收宿主消息（请在 Alife 5 客户端运行）');
}

// ---- 前端日志转发 ----
// ★★ 探针闸门（默认**静默**）—— 这是本文件唯一的日志出口，所以闸门装在这里，一处生效。
//   为什么必须有：为了排查我给这里加了大量自检/量测日志，而其中最"有用"的几条恰恰是**跟着鼠标/姿势动**的：
//   实时姿势包络、让位自检、取景自检、动胯自检…… 鼠标一动它们就刷新 ⇒ 日志被自己的探针刷屏、
//   把宿主与其它插件的日志全盖住（用户反馈："模型随鼠标动头/脊椎也弹一堆骨骼探针"）。
//   规则：**探针默认不打**；要排查时再开（设置面板最下方「诊断探针」／控制台 petProbes(true)／
//   localStorage 写 petProbes=1）。错误与异常（error / resource-error）**永不被静默** ⇒ 排障信息不会丢。
// 命中这些字的日志 = 探针 ⇒ 默认静默。
// ★ 例外（故意**不**在此列）：`前端构建：…` —— 它是每次启动只打一行的版本标记，
//   用来确认"跑的是不是新构建"（这个坑已经耗掉两轮排查），必须永远看得见。
const PROBE_HINTS = ['自检', '量测', '探针', '包络', '面板占宽', '面板加宽请求', '面板越界已夹回',
  '动胯', '骨架基', '位置基准', '中性基准', '落地校验', '接管骨骼', '释放骨骼', '占用骨骼', 'ardy', '浮层：点击'];
let probeOnMem = null;
function probeEnabled() {
  if (probeOnMem === null) {
    let v = false;
    try { v = localStorage.getItem('petProbes') === '1'; } catch (e) { }
    if (window.__petProbes === true) v = true;
    probeOnMem = v;
  }
  return probeOnMem;
}
function isProbeText(t) { if (!t) return false; for (const h of PROBE_HINTS) if (t.indexOf(h) >= 0) return true; return false; }
// 排查用开关：petProbes(true) 打开全部探针，petProbes(false) 关掉（设置面板最下方也有同一个开关）
window.petProbes = function (on) {
  probeOnMem = !!on;
  try { if (probeOnMem) localStorage.setItem('petProbes', '1'); else localStorage.removeItem('petProbes'); } catch (e) { }
  try { window.__petProbes = probeOnMem; } catch (e) { }
  postMessage({ type: 'log', level: 'info', text: '诊断探针已' + (probeOnMem ? '开启（会刷屏，排查完记得关掉）' : '关闭') });
  return probeOnMem;
};
function fmt(a) {
  if (a instanceof Error) return a.name + ': ' + a.message + '\n' + (a.stack || '');
  if (typeof a === 'object') { try { return JSON.stringify(a); } catch { return String(a); } }
  return String(a);
}
function postLog(level) {
  try {
    const args = Array.prototype.slice.call(arguments, 1);
    const text = args.map(fmt).join(' ');
    if (level !== 'error' && level !== 'resource-error' && !probeEnabled() && isProbeText(text)) return;   // 探针静默
    postMessage({ type: 'log', level: level, text: text });
  } catch { }
}
{
  const w = console.warn.bind(console), e = console.error.bind(console);
  console.warn = function () { postLog.apply(null, ['warn'].concat(Array.prototype.slice.call(arguments))); w.apply(console, arguments); };
  console.error = function () { postLog.apply(null, ['error'].concat(Array.prototype.slice.call(arguments))); e.apply(console, arguments); };
}
window.addEventListener('error', (e) => {
  const t = e.target;
  if (t && t !== window) { postLog('resource-error', t.tagName || 'unknown', t.src || t.href || ''); return; }
  postLog('error', e.message, e.filename + ':' + e.lineno);
});
window.addEventListener('unhandledrejection', (e) => postLog('unhandledrejection', e.reason));

// ---- 立刻完成主进程握手（不依赖 three.js，避免 CDN 失败导致握手超时）----
postMessage({ type: 'init' });

// ---- three.js 相关符号（动态加载后赋值）----
let THREE, GLTFLoader, MMDLoader, MMDAnimationHelper, CCDIKSolver, VRMLoaderPlugin, VRMUtils;
// ★ 鼠标"触摸"用的弹簧骨碰撞体类（Mate-Engine 的做法：把鼠标变成一个球形碰撞体塞进弹簧骨碰撞组）
let VRMSpringBoneCollider = null, VRMSpringBoneColliderGroup = null;
// VRMA（动作）支持在独立包 @pixiv/three-vrm-animation 里，不在 three-vrm 主包中
let VRMAnimationLoaderPlugin, createVRMAnimationClip;
let renderer = null, scene = null, camera = null, clock = null, canvas = null;
let lights = [];
let booted = false;
let bootPromise = null;

// ---- 模型状态 ----
let vrm = null;
let mmdMesh = null;
let currentModelType = 'vrm';   // 'vrm' | 'mmd'：PMX 需要不同的打光平衡（toon 材质怕环境光拍平）
let helper = null;
let vrmMixer = null;
let vrmClips = {};
let mmdClips = {};
// 动作 clips 懒加载 + 限量缓存：启动时不再一次性把 80 个 VRMA 全解析进内存
// （每个 clip 含几十根骨骼关键帧，80 个合起来是内存大头之一）。
// allMotions：全部动作清单（名字+url+kind），菜单/随机调度只用它，不依赖是否加载。
// vrmClips / mmdClips：已解析并缓存的 clip，最多保留 CLIP_CACHE_MAX 个，超出淘汰最久未用的；
// 正在播放的 clip 受保护（activeClipNames），不会被淘汰，避免动画引用失效导致动作定格。
let allMotions = [];          // [{ name, url, kind }] VRM 动作全集（菜单/调度用）
let allMmdMotions = [];       // VMD 动作全集
let clipLRU = [];             // 缓存淘汰顺序（name 列表）
const CLIP_CACHE_MAX = 16;    // 同时驻留的 clip 上限（VRM+PMX 共用计数）
let activeClipNames = new Set();   // 当前正被播放 action 引用的 clip 名，淘汰时跳过
let animLoader = null, mmdLoader = null;  // 懒加载用的 loader（首次确保时创建）
let dragClipName = null;      // 当前拖拽动画对应的 clip 名（用于活跃标记）
function touchClip(name) { const i = clipLRU.indexOf(name); if (i >= 0) clipLRU.splice(i, 1); clipLRU.push(name); }
function setClipActive(name, on) { if (!name) return; if (on) activeClipNames.add(name); else activeClipNames.delete(name); }
function evictClips() {
  let guard = 0;
  while (clipLRU.length > CLIP_CACHE_MAX && guard++ < 400) {
    const oldest = clipLRU[0];
    if (activeClipNames.has(oldest)) { clipLRU.shift(); clipLRU.push(oldest); continue; }   // 正在播放，移到末尾保护
    clipLRU.shift();
    if (vrmClips[oldest]) { try { if (vrmMixer) vrmMixer.uncacheClip(vrmClips[oldest]); } catch (e) { } delete vrmClips[oldest]; }
    else if (mmdClips[oldest]) { delete mmdClips[oldest]; }
  }
}
let expressionTimers = [];
let motionTimers = [];
let lastOpts = {};
let embodiedYielding = false;   // 具身动作是否已让 mixer 让位（见下方 applyEmbodiedRetarget）
let taskbarTop = 0;        // 任务栏顶（屏幕 CSS 像素），由 C# 下发，用于"坐到任务栏"判定

// ---- 姿势根节点：包裹 vrm.scene，统一做"整体旋转/竖直偏移"，让接触点(脚/臀/背)贴窗口底边 ----
let petRoot = null;
let modelFloorY = 0;      // 站立时脚底的世界 Y
let modelHipY = 0;        // 站立时胯部的世界 Y（用于坐姿把胯降到窗口底边）
let modelHeight = 1;      // 包围盒高度（世界单位）
let sitHalfBottomY = null;   // 坐姿"半身"取景的下切线（世界 Y）：落座时以它为接触线，任务栏以下的小腿被裁掉
let viewH = 2;               // 当前可视高度（世界单位）：头部/眼部追踪的偏移量按它换算，换姿势/缩放都保持同样的跟随角度
let lookTargetObj = null;    // 视线追踪目标（贴在相机位置附近 + 光标小幅偏移，驱动头/眼跟随）

// ---- 待机动画状态（让桌宠"活"起来，而不是梆硬站桩） ----
let idleT = 0, blinkT = 0, blinkNext = 3, blinking = false, blinkVal = 0;
// three-vrm 3.x 把 expressionManager 改名为 expression；用这个解析器同时兼容两种写法，
// 否则取不到表情管理器，所有表情赋值被守卫跳过 → 表情栏完全失效
function exprMgr() { const m = vrm && (vrm.expression || vrm['expressionManager']); return m || null; }
function setExpr(name, val) {
  const m = exprMgr(); if (m) { try { m.setValue(name, val); } catch (e) { } }
}

// ==== 具身表情（AI 驱动；默认关）====
// 理念：VRM 自带 blendshape 权重表 → 表情**不需要任何生成模型**。情绪=查表权重 + 交叉淡入，
// "活着"的连续感来自已有的眨眼 + 这里的微动/口型。表情名一律从模型里发现（见 EmbodiedExpression.resolve）。
// 让位规则与动作一致：同一时刻只允许一个"脸"的驱动者（静止/随机表情 vs 具身表情）。
let embExpr = null;        // { emotion, intensity, mouth, eyes, until }
let embExprW = {};         // 实际已写入的权重（回报真实状态用：不撒谎，报的是真值）
let embExprNoiseT = 0;

function embExprOn() { const v = lastOpts.embodiedExpression; return v === true || v === 1 || v === '1'; }
function embExprActive() { return !!(embExpr && embExprOn()); }
function embExprAvail() { try { return collectExpressions() || []; } catch (e) { return []; } }

// ---- 表情引擎（VAD 三维情绪 + FACS/AU → BlendShape）----
// 来源：SoullinkEmotion3D（Apache-2.0，已 vendor 成 face-engine.js）。
// 为什么要有：老链路是「情绪 → 查表」——happy 就整张脸切到 happy 通道，换情绪等于"啪一下换脸"；
// 而且 7 个粗标签表达不了"强势/退缩"这种差别。引擎把情绪拆成 20 个面部动作单元（提眉/收眼/嘴角上扬…），
// 用 VAD（愉悦/唤醒/支配）连续混合、保持、逐渐衰减 ⇒ 表情是"演出来"的，且换模型零配置（自动挑存在的通道）。
// 开关用 localStorage 记（不改 C# 配置）；引擎文件缺失 / 模型没有任何可用通道时**自动退回老链路**。
let faceEng = null, faceEngCoverage = null, faceEngSig = '';
let faceEngineOn = true;
// 粗粒度模型上"没有对应预设就别硬演"的情绪：这类情绪主要靠眉/眼，模型没有那些通道时
// 硬拉权重只会演成"莫名的笑"，宁可交给头部/视线姿态（EMB_POSE）。
const COARSE_POSE_ONLY = ['thinking'];

// ---- 表情引擎参数（对齐 SoullinkEmotion3D 的 LabSettings；作者默认值 + 三档预设）----
// 这些值直接改引擎内部行为：gain=整体强度、detailMix=细节占比、hold/halfLife=保持与衰减、
// approach=逼近速度（软/硬）、faceSmoothing=平滑、brow/eye/mouthGain=分区增益、gazeResponse/Hold=视线。
const FACE_PRESETS = {
  // 桌宠版默认：比作者的 8s 略快，因为表情常和动作/说话叠在一起，8s 会显得拖
  natural:    { hold: 6.0, halfLife: 6.5, approach: 2.6, gain: 1.2, detailMix: 0.60, browGain: 1.10, eyeGain: 1.00, mouthGain: 0.90, faceSmoothing: 0.26, gazeResponse: 0.28, gazeHold: 2.2, idle: true, ambient: false },
  exaggerated:{ hold: 9.0, halfLife: 9.0, approach: 3.2, gain: 1.8, detailMix: 0.75, browGain: 1.25, eyeGain: 1.15, mouthGain: 1.05, faceSmoothing: 0.30, gazeResponse: 0.35, gazeHold: 2.8, idle: true, ambient: false },
  restrained: { hold: 4.0, halfLife: 4.5, approach: 2.0, gain: 0.90, detailMix: 0.50, browGain: 1.20, eyeGain: 0.90, mouthGain: 0.80, faceSmoothing: 0.22, gazeResponse: 0.20, gazeHold: 1.8, idle: true, ambient: false },
  author:     { hold: 8.0, halfLife: 8.0, approach: 2.4, gain: 1.4, detailMix: 0.65, browGain: 1.00, eyeGain: 1.00, mouthGain: 1.00, faceSmoothing: 0.28, gazeResponse: 0.22, gazeHold: 3.0, idle: true, ambient: false }
};
const FACE_PARAM_KEYS = ['hold', 'halfLife', 'approach', 'gain', 'detailMix', 'browGain', 'eyeGain', 'mouthGain', 'faceSmoothing', 'gazeResponse', 'gazeHold'];
let facePresetName = 'natural';
let faceParams = Object.assign({}, FACE_PRESETS.natural);
try {
  const raw = localStorage.getItem('deskpet_faceParams');
  if (raw) {
    const o = JSON.parse(raw);
    if (o && typeof o === 'object') {
      if (o.preset && FACE_PRESETS[o.preset]) facePresetName = o.preset;
      for (const k of FACE_PARAM_KEYS) if (isFinite(+o[k])) faceParams[k] = +o[k];
      if (typeof o.idle === 'boolean') faceParams.idle = o.idle;
      if (typeof o.ambient === 'boolean') faceParams.ambient = o.ambient;
    }
  }
} catch (e) { }
function faceParamsSave() {
  try { localStorage.setItem('deskpet_faceParams', JSON.stringify(Object.assign({ preset: facePresetName }, faceParams))); } catch (e) { }
}
function faceParamsApply() {
  if (!faceEng || !faceEng.engine) return;
  const s = faceEng.engine.settings;
  for (const k of FACE_PARAM_KEYS) if (isFinite(+faceParams[k])) s[k] = +faceParams[k];
  if (typeof faceParams.idle === 'boolean') s.idle = faceParams.idle;
  if (typeof faceParams.ambient === 'boolean') s.ambient = faceParams.ambient;
}
function facePresetSet(name) {
  if (!FACE_PRESETS[name]) return;
  facePresetName = name;
  faceParams = Object.assign({}, FACE_PRESETS[name]);
  faceParamsApply(); faceParamsSave();
}
try { if (localStorage.getItem('deskpet_faceEngine') === '0') faceEngineOn = false; } catch (e) { }
function faceEngineSave(on) {
  faceEngineOn = !!on;
  try { localStorage.setItem('deskpet_faceEngine', on ? '1' : '0'); } catch (e) { }
}
function ensureFaceEngine() {
  const S = window.SoullinkFace;
  if (!S || !S.AlifeFace) { faceEng = null; return null; }        // 引擎没加载：静默退回老链路
  if (!faceEng) {
    try { faceEng = new S.AlifeFace(); }
    catch (e) { postLog('warn', '表情引擎初始化失败：' + (e && e.message)); faceEng = null; return null; }
    faceParamsApply();          // 把面板里的参数（预设/滑条）灌进引擎
  }
  const avail = embExprAvail();
  if (!avail.length) return faceEng;
  // ★ 只在"模型可用表情清单"变化时重建映射：这个函数每帧都会被调，
  //   不缓存的话既白算一遍、又会每帧打一行覆盖日志（刷屏）。
  const sig = avail.length + ':' + avail.join(',');
  if (sig === faceEngSig) return faceEng;
  faceEngSig = sig;
  try {
    const cov = faceEng.setAvailable(avail);
    faceEngCoverage = cov;
    postLog('info', '[表情引擎] 覆盖 ' + cov.supported + '/' + cov.total + ' 个 AU（模型可用表情 ' + avail.length + ' 个）');
  } catch (e) { postLog('warn', '表情引擎映射失败：' + (e && e.message)); }
  return faceEng;
}
// 调试入口（桌宠窗口 DevTools 里用）：
//   petFaceCov()                  → 当前模型覆盖率 {supported,total,aus}
//   petFaceVAD(v, a, d)           → 直接给 VAD（-1..1），保持 60s 供观察
//   petFaceAU('au12LipCornerPuller', .8) → 单通道覆盖（传 null 归还引擎）
//   embodiedExpress({emotion:'happy', intensity:.9, hold:8}) → 走正常情绪入口
window.petFaceCov = () => faceEngCoverage;
window.petFaceVAD = (v, a, d) => {
  const f = ensureFaceEngine();
  if (!f) return null;
  f.setVAD(+v || 0, +a || 0, +d || 0);
  embExpr = { emotion: 'neutral', intensity: 1, mouth: null, eyes: null, until: performance.now() / 1000 + 60 };
  return true;
};
window.petFaceAU = (k, v) => {
  const f = ensureFaceEngine();
  if (!f) return null;
  f.setAU(k, v === null || v === undefined ? null : +v);
  if (v !== null && v !== undefined) embExpr = { emotion: 'neutral', intensity: 1, mouth: null, eyes: null, until: performance.now() / 1000 + 60 };
  return true;
};
// 诊断：看"实际写进模型"的权重与视线（不是意图）。排查"没效果"时先看这个。
window.petFaceState = () => ({
  engine: !!faceEng, on: faceEngineOn, active: !!embExpr,
  emotion: embExpr ? embExpr.emotion : null,
  intensity: embExpr ? embExpr.intensity : 0,
  gaze: { x: +embGazeDeg.x.toFixed(1), y: +embGazeDeg.y.toFixed(1) },
  coverage: faceEngCoverage,
  weights: Object.fromEntries(Object.entries(embExprW).map(([k, v]) => [k, +v.toFixed(2)]))
});
// 一键演示：轮流播 7 个情绪（每个 3.2s），用来肉眼对比"哪些看得见、哪些看不见"
window.petFaceDemo = (list) => {
  const seq = (list && list.length) ? list : ['happy', 'sad', 'angry', 'surprised', 'shy', 'thinking', 'relaxed'];
  let i = 0;
  const tick = () => {
    if (i >= seq.length) { postLog('info', '[表情自检] 演示结束'); return; }
    const emo = seq[i++];
    embodiedExpress({ emotion: emo, intensity: 0.85, hold: 3.2 });
    postLog('info', '[表情自检] ' + i + '/' + seq.length + ' → ' + emo);
    setTimeout(tick, 3500);
  };
  tick();
  return seq.length * 3.5;
};
// 换模型/重载后：清空引擎内部状态并按新模型的表情清单重建映射（同一个引擎对象复用）
function faceEngineOnModelLoaded() {
  faceEngCoverage = null;
  faceEngSig = '';
  if (faceEng) { try { faceEng.engine.reset(); } catch (e) { } }
  ensureFaceEngine();
}

// 「情绪 → 表情」用户映射（设置面板里可改，存成 "happy=星星眼;angry=怒り"）。
// 为什么需要它：候选表只能靠**名字猜语义**——很多模型的 happy/joy 是"闭眼笑"(^_^)，
// 用户想要的"开心"可能是另一张脸（如本模型的 星星眼）。这是唯一无法自动化的部分，
// 所以做成一次性映射：自动挑 + 随时可改。
function embExprFaceMap() {
  const raw = String(lastOpts.embodiedFaceMap || '');
  const m = {};
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) { const k = part.slice(0, i).trim(), v = part.slice(i + 1).trim(); if (k && v) m[k] = v; }
  }
  return m;
}

// 该情绪这一帧要写哪些脸：用户指定的优先，否则用候选表自动挑
function embExprTargets(emo, intensity, avail) {
  const ov = embExprFaceMap()[emo];
  if (ov && avail.indexOf(ov) >= 0) { const o = {}; o[ov] = intensity; return o; }
  const E = window.EmbodiedExpression;
  return E ? E.resolve(emo, intensity, avail) : {};
}

// ---- 环境自检：生成式动作(ardy-mini)的前置条件 ----
// 生成式动作要求页面能开 **WebGPU**（fp16 版还要 shader-f16）。不猜版本，直接在这里探测真实环境。
// 结果会：① 写进 Alife 日志（[3D桌宠前端/info] [环境自检] ...）；② 显示在设置面板「环境自检」按钮上。
let petEnv = null;
async function petEnvProbe() {
  const out = { };
  try { const m = /Chrome\/([\d.]+)/.exec(navigator.userAgent); out.chromium = m ? m[1] : navigator.userAgent; } catch (e) { }
  try { out.secureContext = !!window.isSecureContext; } catch (e) { }
  try { out.protocol = location.protocol; } catch (e) { }
  try { out.node = (typeof require === 'function') ? '可用' : '不可用'; } catch (e) { out.node = '不可用'; }
  try {
    if (!navigator.gpu) { out.gpu = '不支持(无 navigator.gpu)'; out.note = '生成式动作跑不了：这个窗口的 Chromium 没开 WebGPU'; }
    else {
      const ad = await navigator.gpu.requestAdapter();
      if (!ad) { out.gpu = '有 API 但取不到适配器'; out.note = '可能被驱动/远程桌面/虚拟机限制'; }
      else {
        out.gpu = '可用';
        try { out.f16 = ad.features.has('shader-f16') ? '支持' : '不支持'; } catch (e) { out.f16 = '未知'; }
        try { const i = ad.info || {}; out.adapter = [i.vendor, i.architecture, i.description].filter(Boolean).join('/') || '未报告'; } catch (e) { out.adapter = '未报告'; }
        out.note = out.f16 === '支持' ? '可跑 fp16 版(652MiB)，也可跑 fp32 版' : '可跑 fp32 版(684MiB)；fp16 版需要 shader-f16';
      }
    }
  } catch (e) { out.gpu = '探测异常: ' + e.message; }
  petEnv = out;
  postLog('info', '[环境自检] ' + JSON.stringify(out));
  return out;
}
setTimeout(() => { petEnvProbe().catch(() => { }); }, 3000);   // 启动后自动探一次（结果进日志）

// ---- 情绪姿态兜底（**不吃 blendshape，任何模型都有头/颈/眼球**）----
// 触发条件：该情绪在这个模型上没有匹配的表情（有些模型只有 blink/aa，有些 PMX 压根没表情）。
// 做法：把情绪写进"注视目标"的偏移 → 头与眼睛自然会朝那个方向（低头=难过、上抬=惊讶、偏头躲开=害羞…）。
// 这样"AI 说了情绪、画面却完全没动"就不会发生，也不会因为缺表情而报错。
const EMB_POSE = {
  happy: { x: 0.00, y: 0.18 },   // 略上抬、精神一点
  sad: { x: 0.00, y: -0.35 },   // 低头
  angry: { x: 0.00, y: -0.10 },
  relaxed: { x: 0.12, y: 0.05 },
  surprised: { x: 0.00, y: 0.36 },   // 后仰/睁大
  shy: { x: 0.38, y: -0.20 },   // 偏头躲开
  thinking: { x: -0.32, y: -0.15 },
  neutral: { x: 0.00, y: 0.00 }
};
let embExprLook = { x: 0, y: 0 };   // 当前姿态偏移（平滑过渡）
// 情绪视线偏移（度）：表情引擎每帧给出 eyeTarget/headTarget（度），
// 这里把"眼为主、头为辅"合成一个偏移，叠到 lookAt 目标上 —— 这是唯一能真正带动头的通路：
// 直接改 head 骨骼会被 vrm.update 的 lookAt 覆盖（见渲染循环里的注释）。
let embGazeDeg = { x: 0, y: 0 };
let embExprNote = '';               // 回报给 AI 的说明（例如"该模型没有对应表情，已改用姿态"）

function embExprWrite(name, v) {
  const m = exprMgr(); if (!m || !name) return;
  try { m.setValue(name, Math.max(0, Math.min(1, v))); } catch (e) { }
}
function embExprClear() { for (const n in embExprW) embExprWrite(n, 0); embExprW = {}; }

// 回报"实际渲染"的状态给宿主（<bodystate> 用真实值，不是请求值）
// ★ genVerdictNote：生成式动作的**验收结论**（"已通过自动验收/只是近似/已退回预置"）——
//   为什么要给 AI 看：它只知道自己下发了 `gen:举手挥手`，不知道后端是"真做到了"还是"退回了举手"。
//   把这句放进 <bodystate>，它才不会对用户说"我举手啦"而画面其实是近似动作。
let genVerdictNote = '';
function embExprReport() {
  try {
    const w = {};
    for (const n in embExprW) w[n] = +embExprW[n].toFixed(2);
    postMessage({
      type: 'embodied_state', state: {
        enabled: embExprOn(),
        active: embExprActive(),
        emotion: embExpr ? embExpr.emotion : '',
        intensity: embExpr ? embExpr.intensity : 0,
        weights: w,
        note: embExprNote || '',
        genNote: genVerdictNote || '',
        motion: (typeof currentMotionName === 'string' ? currentMotionName : ''),
        dancing: !!dancingNow
      }
    });
  } catch (e) { }
}

// 启动/更新一次具身表情（AI 的 <bodyexpress> 与右键自检都走这里）
function embodiedExpress(spec) {
  if (typeof spec === 'string') {
    try { spec = JSON.parse(spec); } catch (e) { postLog('error', 'bodyexpress 参数不是合法 JSON：' + e.message); return false; }
  }
  if (!spec || typeof spec !== 'object') { postLog('info', 'bodyexpress 缺少参数'); return false; }
  if (!embExprOn()) { postLog('info', '「具身表情」未开启，已忽略 BodyExpress'); return false; }
  const E = window.EmbodiedExpression;
  if (!E) { postLog('error', '表情合成器未加载（embodied-expression.js）'); return false; }
  const emo = String(spec.emotion || 'neutral').trim().toLowerCase();
  if (E.EMOTIONS.indexOf(emo) < 0) { postLog('info', '未知情绪：' + emo + '（可用：' + E.EMOTIONS.join('/') + '）'); return false; }
  let hold = (spec.hold === undefined || spec.hold === null) ? 8 : +spec.hold;
  // 节奏控制：AI 若给很短的保持时间（1~2 秒），表情会"闪来闪去"显得很忙 → 抬到下限
  if (hold > 0 && hold < exprHoldMin) {
    postLog('info', '表情保持 ' + hold + 's → 抬到下限 ' + exprHoldMin + 's（节奏控制，可在面板调）');
    hold = exprHoldMin;
  }
  embExpr = {
    emotion: emo,
    intensity: (spec.intensity === undefined || spec.intensity === null) ? 0.8 : Math.max(0, Math.min(1, +spec.intensity)),
    mouth: (spec.mouth === undefined || spec.mouth === null || +spec.mouth < 0) ? null : Math.max(0, Math.min(1, +spec.mouth)),
    eyes: (spec.eyes === undefined || spec.eyes === null || +spec.eyes < 0) ? null : Math.max(0, Math.min(1, +spec.eyes)),
    attack: 0, decay: 0,
    until: hold > 0 ? (performance.now() / 1000 + hold) : Infinity   // hold<=0 = 一直保持
  };
  // 交给表情引擎：情绪名 → 引擎的 VAD 锚点（happy→happy、angry→anger、relaxed→calm…），
  // 之后的连续混合/保持/衰减都由引擎负责；老链路只在引擎关闭或无可用通道时生效。
  let extraNote = '';
  if (faceEngineOn) {
    const fe = ensureFaceEngine();
    if (fe) {
      try { fe.setEmotion(emo, embExpr.intensity); } catch (e) { postLog('warn', '表情引擎 setEmotion 失败：' + (e && e.message)); }
      try {
        // ★ vad="0.6,0.4,0.2"：直接给三维情绪坐标（愉悦/唤醒/支配），比标签更连续
        if (spec.vad !== undefined && spec.vad !== null && String(spec.vad).trim() !== '') {
          const vv = String(spec.vad).split(/[,，\s]+/).map(Number).filter(n => isFinite(n));
          if (vv.length === 3) { fe.setVAD(vv[0], vv[1], vv[2]); extraNote += ' VAD=' + vv.map(n => (+n).toFixed(2)).join('/'); }
          else postLog('warn', 'bodyexpress.vad 需要 3 个数（愉悦,唤醒,支配），已忽略：' + spec.vad);
        }
        // ★ au="au12LipCornerPuller:0.25,au06CheekRaiser:0.15"：局部微调（单通道上限 0.3，防止把脸拼坏）
        if (spec.au !== undefined && spec.au !== null && String(spec.au).trim() !== '') {
          let n = 0;
          for (const pair of String(spec.au).split(/[,，;]+/)) {
            const mm = /^\s*([A-Za-z0-9_]+)\s*[:=]\s*(-?[\d.]+)\s*$/.exec(pair);
            if (!mm) continue;
            fe.setAU(mm[1], Math.max(0, Math.min(0.3, +mm[2])));
            n++;
          }
          if (n) extraNote += ' AU×' + n;
          else postLog('warn', 'bodyexpress.au 格式应为 "通道名:权重,…"，已忽略：' + spec.au);
        }
        // ★ 包络：attack=到 90% 的时间(秒)，decay=衰减半衰期(秒)。同一情绪不同包络＝不同质感。
        const atk = +spec.attack, dec = +spec.decay;
        if (isFinite(atk) && atk > 0) { embExpr.attack = Math.max(0.05, Math.min(1.5, atk)); extraNote += ' attack=' + embExpr.attack; }
        if (isFinite(dec) && dec > 0) {
          embExpr.decay = Math.max(1, Math.min(30, dec));
          fe.engine.settings.halfLife = embExpr.decay;
          extraNote += ' decay=' + embExpr.decay;
        }
        if (hold > 0) fe.engine.settings.hold = hold;
      } catch (e) { postLog('warn', 'bodyexpress 扩展参数处理失败：' + (e && e.message)); }
    }
  }
  // 让位：先把静止/随机表情收回，否则两张脸叠加
  if (baseExprApplied) { embExprWrite(baseExprApplied, 0); baseExprApplied = ''; }
  const faceNames = Object.keys(embExprTargets(emo, embExpr.intensity, embExprAvail()));
  embExprNote = faceNames.length ? '' : ('该模型没有可用于「' + emo + '」的表情，已改用头部/注视姿态表达');
  postLog('info', '具身表情：' + emo + '（强度 ' + embExpr.intensity +
    (hold > 0 ? '，保持 ' + hold + 's）' : '，一直保持）') + extraNote +
    ' → ' + (faceNames.length ? ('实际用脸：' + faceNames.join('+')) : '该模型没有匹配的表情 → 改用姿态表达'));
  embExprReport();
  return true;
}
window.embodiedExpress = embodiedExpress;

// 每帧：权重交叉淡入到目标；到期自动收回，交回静止/随机表情
function applyEmbodiedExpression(dt) {
  if (!embExprOn()) {                       // 开关被关掉：立刻收回，别留一张怪脸
    if (embExpr) { embExpr = null; embExprClear(); embExprReport(); }
    return;
  }
  if (!embExpr) {                                   // 没有情绪：姿态偏移平滑回零
    const k0 = dt > 0 ? (1 - Math.exp(-dt / 0.35)) : 1;
    embExprLook.x *= (1 - k0); embExprLook.y *= (1 - k0);
    if (Math.abs(embExprLook.x) < 0.01) embExprLook.x = 0;
    if (Math.abs(embExprLook.y) < 0.01) embExprLook.y = 0;
    const g0 = dt > 0 ? (1 - Math.exp(-dt / 0.22)) : 1;   // 视线回正稍快（眼先回，头后回的感觉）
    embGazeDeg.x *= (1 - g0); embGazeDeg.y *= (1 - g0);
    if (Math.abs(embGazeDeg.x) < 0.05) embGazeDeg.x = 0;
    if (Math.abs(embGazeDeg.y) < 0.05) embGazeDeg.y = 0;
    return;
  }
  const now = performance.now() / 1000;
  if (now >= embExpr.until) {
    embExpr = null; embExprClear(); embExprNote = '';
    try { faceParamsApply(); } catch (e) { }        // 收回本次的 hold/decay 覆盖，恢复面板参数
    baseExprApplied = ''; applyBaseExpression();   // 交回静止/随机表情
    postLog('info', '具身表情保持结束，已收回表情');
    embExprReport();
    return;
  }
  const E = window.EmbodiedExpression, avail = embExprAvail();
  const intent = Math.max(0, Math.min(1, +embExpr.intensity || 0));
  const fb = embExprTargets(embExpr.emotion, intent, avail);   // 语义预设（老链路）：粗粒度模型只有这个
  // ★ 目标权重：引擎优先，但按**模型粒度**分流——这是"有的看得见有的看不见"的根因：
  //   粗粒度模型（只有 joy/angry/sorrow/fun 这种整脸预设）上，引擎把 20 个 AU 混出来的主通道
  //   通常只有 0.1~0.4（实测 shy=0.18、thinking=0.11）⇒ 肉眼几乎看不出。
  let target = null;
  if (faceEngineOn) {
    const fe = ensureFaceEngine();
    if (fe) {
      try {
        const out = fe.update(dt);
        if (out && out.weights && Object.keys(out.weights).length) target = out.weights;
        // ★ 情绪视线：引擎每帧给出 eyeTarget/headTarget（度）。眼 65% + 头 35%（真实人类是眼先动、头跟一点），
        //   限幅 ±30°，平滑后由渲染循环叠加到 lookAt 目标上 —— 这样"害羞别开视线/思考偏头"才真的看得见。
        if (out && out.frame && out.frame.angles) {
          const an = out.frame.angles;
          const ey = an.eyeTarget || an.eyes || {};
          const ht = an.headTarget || an.head || {};
          const yaw = (+ey.yaw || 0) * 0.65 + (+ht.yaw || 0) * 0.35;
          const pit = (+ey.pitch || 0) * 0.65 + (+ht.pitch || 0) * 0.35;
          const gk = dt > 0 ? (1 - Math.exp(-dt / 0.16)) : 1;
          embGazeDeg.x += (Math.max(-30, Math.min(30, yaw)) - embGazeDeg.x) * gk;
          embGazeDeg.y += (Math.max(-30, Math.min(30, pit)) - embGazeDeg.y) * gk;
        }
      } catch (e) { postLog('warn', '表情引擎 update 失败：' + (e && e.message)); }
    }
  }
  const maxOf = (o) => { let m = 0; for (const k in o) { const v = o[k] || 0; if (v > m) m = v; } return m; };
  const fineGrained = !!(faceEngCoverage && faceEngCoverage.supported >= 18);   // VRoid Fcl_* / ARKit 52 那一类
  if (!target) {
    target = Object.assign({}, fb);
  } else if (fineGrained) {
    // 细粒度模型：引擎本身就够强（实测 mouthSmileLeft=0.93），偏低时再拉一把
    const mx = maxOf(target);
    if (mx > 0.02 && mx < 0.35) {
      const k = Math.min(3, 0.5 / mx);
      for (const n in target) target[n] = Math.min(1, target[n] * k);
    }
  } else if (Object.keys(fb).length) {
    // 粗粒度 + 有语义预设：**预设打底**（保证看得见），引擎只叠 ≤0.25 的细节（保留"连续变化"）
    const base = Object.assign({}, fb);
    for (const n in target) base[n] = Math.min(1, (base[n] || 0) + target[n] * 0.25);
    target = base;
  } else if (COARSE_POSE_ONLY.indexOf(embExpr.emotion) >= 0 || maxOf(target) < 0.03) {
    // 模型没有对应预设、引擎也给不出像样的东西（如 thinking：需要眉/眼，这模型没有）
    // ⇒ 空权重，交给头部/视线姿态表达，**别硬演成别的情绪**
    target = {};
  } else {
    // 没有预设但引擎有料（如 shy）：把主通道拉到可见强度，相对比例不变
    const k = Math.min(3, (0.55 + 0.35 * intent) / Math.max(maxOf(target), 1e-6));
    for (const n in target) target[n] = Math.min(1, target[n] * k);
  }
  // 兜底：这个模型没有匹配的表情（或压根没表情）→ 改用姿态表达（任何模型都有效）
  const hasFace = Object.keys(target).length > 0;
  const pose = hasFace ? { x: 0, y: 0 } : (EMB_POSE[embExpr.emotion] || { x: 0, y: 0 });
  const pk = dt > 0 ? (1 - Math.exp(-dt / 0.35)) : 1;
  embExprLook.x += (pose.x * embExpr.intensity - embExprLook.x) * pk;
  embExprLook.y += (pose.y * embExpr.intensity - embExprLook.y) * pk;
  embExprNote = hasFace ? '' : ('该模型没有可用于「' + embExpr.emotion + '」的表情，已改用头部/注视姿态表达');
  // 微动：给主情绪叠一点点噪声，避免"定格脸"（幅度小到只显得自然）
  embExprNoiseT += dt;
  const micro = 1 + 0.05 * Math.sin(embExprNoiseT * 2.3) + 0.03 * Math.sin(embExprNoiseT * 5.7);
  for (const n in target) target[n] = Math.max(0, Math.min(1, target[n] * micro));
  // 眼嘴显式控制
  const mouthName = E.mouthName(avail);
  if (mouthName && embExpr.mouth !== null) target[mouthName] = Math.max(target[mouthName] || 0, embExpr.mouth);
  const blinkName = E.blinkName(avail);
  if (blinkName && embExpr.eyes !== null) target[blinkName] = Math.max(target[blinkName] || 0, embExpr.eyes);
  // 交叉淡入：默认 ≈0.18s；AI 给了 attack（到 90% 的秒数）就用它（tau = 时间 / 2.3）
  const tau = (embExpr.attack > 0) ? (embExpr.attack / 2.3) : 0.18;
  const k = dt > 0 ? (1 - Math.exp(-dt / tau)) : 1;
  const seen = {};
  for (const n in target) {
    const cur = embExprW[n] || 0;
    const next = cur + (target[n] - cur) * k;
    embExprW[n] = next; seen[n] = true;
    embExprWrite(n, next);
  }
  for (const n in embExprW) {                 // 不再需要的通道淡出
    if (seen[n]) continue;
    const next = embExprW[n] * (1 - k);
    if (next < 0.01) { embExprWrite(n, 0); delete embExprW[n]; }
    else { embExprW[n] = next; embExprWrite(n, next); }
  }
}

// 待机/追踪可调参数（由配置下发，可实时改）
let idleEnabled = true, idleIntensity = 1, idleSpeed = 1, idleGestureLevel = 2, idleGap = 1.5;
let headTrackStrength = 1, spineTrackStrength = 1, blinkEnabled = true;
let baseExpression = '', baseExpressionWeight = 0.6;   // 静止/待机时的基础表情
let randomExpr = false, randomExprInterval = 8;        // 随机表情：待机时每隔一段时间随机换一张脸
let randomExprCur = '', randomExprT = 0;
function applyIdleOpts(o) {
  if (!o) return;
  if (o.idleAnimation !== undefined) idleEnabled = !!o.idleAnimation;
  if (o.idleIntensity !== undefined) idleIntensity = +o.idleIntensity || 1;
  if (o.idleSpeed !== undefined) idleSpeed = +o.idleSpeed || 1;
  if (o.idleGesture !== undefined) idleGestureLevel = +o.idleGesture || 0;
  if (o.idleGap !== undefined) { const gv = +o.idleGap; idleGap = isFinite(gv) ? Math.max(0, gv) : 1.5; }
  if (o.headTrackStrength !== undefined) headTrackStrength = +o.headTrackStrength;
  if (o.spineTrackStrength !== undefined) spineTrackStrength = +o.spineTrackStrength;
  // 菜单/设置里的"头部追踪 / 脊椎追踪"开关（宿主下发 enableHeadTrack/enableSpineTrack）。
  // 之前这两个开关只存在于宿主，前端从没读过 → 关掉也不生效。
  if (o.enableHeadTrack !== undefined) headTrack = !!o.enableHeadTrack;
  if (o.enableSpineTrack !== undefined) spineTrack = !!o.enableSpineTrack;
  if (o.blink !== undefined) blinkEnabled = !!o.blink;
  if (o.baseExpression !== undefined) baseExpression = o.baseExpression || '';
  if (o.baseExpressionWeight !== undefined) baseExpressionWeight = Math.max(0, Math.min(1, +o.baseExpressionWeight || 0.6));
  if (o.randomExpr !== undefined) { randomExpr = !!o.randomExpr; if (!randomExpr) randomExprCur = ''; }
  if (o.randomExprInterval !== undefined) randomExprInterval = Math.max(1, +o.randomExprInterval || 8);
  if (o.showGroundLine !== undefined) showGroundLine = !!o.showGroundLine;
}
// 应用/收回基础表情：当前没在播动作(dance/动作)时，让桌宠保持一个静止表情；
// 播动作时让位给"舞蹈表情"或动作自带的表情轨道，避免脸被叠花。
// 开启“随机表情”时，待机表情改为每隔 randomExprInterval 秒随机抽一张脸（眨眼不受影响，独立通道）。
let baseExprApplied = '';
function applyBaseExpression() {
  if (embExprActive()) return;   // 具身表情接管中：静止/随机表情让位（否则两张脸叠加）
  // 不再因“正在播动作”而整体压制静态/随机表情——three-vrm 对多个表情是叠加混合的，
  // 播放动作时让表情照常生效，用户才看得到脸在变（之前有动作在播就跳过，自动跳舞开着时表情永远不显示）。
  // 优先级：静止表情(用户手动指定) > 随机表情。这样“自己调静止表情”始终生效，随机只在没指定静止表情时接管。
  let want = '';
  if (baseExpression && baseExpression !== 'blink') want = baseExpression;
  else if (randomExpr) want = randomExprCur;
  if (want === baseExprApplied) return;
  if (baseExprApplied && vrm && exprMgr()) { try { exprMgr().setValue(baseExprApplied, 0); } catch (e) { } }
  if (want && vrm && exprMgr()) { try { if (exprMgr().getExpression(want)) exprMgr().setValue(want, baseExpressionWeight); } catch (e) { } }
  baseExprApplied = want;
}
// 随机表情调度：待机时按随机间隔切换当前抽中的表情
function tickRandomExpr(dt) {
  if (!randomExpr || !vrm || !exprMgr()) return;
  randomExprT -= dt;
  if (randomExprT > 0) return;
  const list = collectExpressions().filter(n => n && n !== 'blink');
  if (list.length) {
    let pick = randomExprCur;
    if (list.length > 1) while (pick === randomExprCur) pick = list[Math.floor(Math.random() * list.length)];
    else pick = list[0];
    randomExprCur = pick;
    randomExprT = randomExprInterval * (0.7 + Math.random() * 0.6);
    applyBaseExpression();   // 用统一通道切换，自动收回上一张脸
  } else {
    randomExprT = 2;
  }
}
// 平滑伪噪声：多个不同频率正弦叠加，用来做自然轻微摆动（避免机械感）
function idleNoise(t, seed) {
  return Math.sin(t * 0.9 + seed) * 0.6 + Math.sin(t * 1.7 + seed * 1.9) * 0.4;
}
// 头部/胸部追踪（跟随光标，幅度刻意很小）：与"待机动画"开关相互独立，专治"杵在那儿像人棍"。
// 头部主体由视线目标偏移驱动（见主渲染循环），这里只补 neck/胸/脊的轻微扭转，
// 顺带把头发（弹簧骨）带动起来 → 上半身和头发一起小幅晃动。
function addTrackOffset(o, bn) {
  const trackOn = !(danceDisableTrack && dancingNow);   // 舞蹈时(开关开)暂停头部/脊椎追踪
  const tf = bodyTurnFade();                            // 整体转身后衰减（否则身体朝后、脖子还拧着看镜头）
  const hk = (headTrack && trackOn) ? Math.max(0, headTrackStrength) * tf : 0;
  const sk = (spineTrack && trackOn) ? Math.max(0, spineTrackStrength) * tf : 0;
  if (hk <= 0 && sk <= 0) return o;
  // 用主循环算好的平滑跟随量（已是存在度×阻尼），不再直接读 cursorNDC → 不再抽搐
  // 颈/胸/脊随动幅度（VRM 专用：PMX 走 applyMMDTracking 另一套）。略放大，让上半身跟头一起偏，
  // 方向：屏幕右(+X)→绕 +Y 转头，屏幕上(+Y)→绕 -X 抬头，与鼠标一致（模型朝 +Z 面向相机）。
  const hx = followNDC.x * 0.30 * hk;
  const hy = -followNDC.y * 0.17 * hk;
  const sx = followNDC.x * 0.07 * sk;
  const sy = -followNDC.y * 0.045 * sk;
  if (bn === 'neck') { o.y += hx * 0.7; o.x += hy * 0.6; }
  else if (bn === 'upperChest') { o.y += sx * 0.8; o.x += sy * 0.8; }
  else if (bn === 'chest') { o.y += sx * 1.2; o.x += sy * 1.2; }
  else if (bn === 'spine') { o.y += sx * 0.9; o.x += sy * 0.9; }
  else if (bn === 'hips') { o.y += sx * 0.4; }
  return o;
}
// 按骨骼返回待机微动偏移（叠加到姿势上）；MMD 无 VRM 骨骼，仅 VRM 生效
// 待机已改为“循环播放短 VRMA 动作”（见 scheduleIdleMotion），这里不再做程序化“晃动”，
// 只保留光标追踪（头/颈/胸轻微跟随），避免身体再被额外偏移晃得奇怪。
function idleBoneOffset(bn, t) {
  const o = { x: 0, y: 0, z: 0 };
  return addTrackOffset(o, bn);
}

// PMX(MMD) 头部/颈椎/脊柱光标追踪：VRM 走 lookAt + 人偶骨骼，PMX 没有那套，
// 因此在 helper.update 之后对 PMX 的日文骨骼做"附加旋转"（在动画/IK/物理覆盖之上叠加，每帧稳定不丢）。
// 头部跟手最明显、颈椎次之、上半身/上半身2 轻微扭转 → 上半身一起顺滑跟光标，不再是人棍。
function getMmdBone(names) {
  if (!mmdMesh || !mmdMesh.skeleton) return null;
  for (const n of names) { const b = mmdMesh.skeleton.getBoneByName(n); if (b) return b; }
  return null;
}
// 手臂骨骼查找：模型作者不同、命名差异很大（左腕/左腕捩/左うで/L_arm/arm_L…），
// 先试常见精确名，再在骨架里模糊找“含 腕/arm 且带左右标识”的骨骼（排除扭转骨/末端骨）。
let mmdArmBoneCache = {};
function findMmdArmBone(side) {   // side: 'L' | 'R'
  if (mmdArmBoneCache[side] !== undefined) return mmdArmBoneCache[side];
  const isL = side === 'L';
  let found = getMmdBone(isL
    ? ['左腕', '左腕捩', '左うで', '左腕01', 'left arm', 'LeftArm', 'L_arm', 'arm_L', 'Arm_L']
    : ['右腕', '右腕捩', '右うで', '右腕01', 'right arm', 'RightArm', 'R_arm', 'arm_R', 'Arm_R']);
  if (!found && mmdMesh && mmdMesh.skeleton) {
    const sideKw = isL ? ['左', 'l', 'L'] : ['右', 'r', 'R'];
    const armKw = ['腕', 'うで', 'arm', 'Arm', 'ARM'];
    const skip = ['捩', '扭', 'twist', 'Twist', '先', 'end', 'End', '指', 'hand', 'Hand'];
    for (const b of mmdMesh.skeleton.bones) {
      const n = b && b.name ? String(b.name) : '';
      if (!n) continue;
      if (sideKw.some(k => n.includes(k)) && armKw.some(k => n.includes(k)) && !skip.some(k => n.includes(k))) { found = b; break; }
    }
  }
  mmdArmBoneCache[side] = found;
  return found;
}

// 每根骨骼"无追踪偏移"时的基准旋转(由动画/IK/物理每帧写入)，与当前施加的偏移。
// 用"基准+偏移"绝对赋值，杜绝 += 在静止(无动画重置骨骼)时无限累加 → 上半身像陀螺疯狂旋转/穿模。
let mmdTrackNeutral = {};
let mmdTrackState = {};
let armDropWarned = false;   // “手臂收拢没匹配到骨骼”只提示一次，避免每帧刷屏
function applyMMDTracking() {
  const trackOn = !(danceDisableTrack && dancingNow);   // 舞蹈时(开关开)暂停头部/脊椎追踪
  const tf = bodyTurnFade();                            // 整体转身后同样要衰减（PMX 也走这条）
  const hk = (headTrack && trackOn) ? Math.max(0, headTrackStrength) * tf : 0;
  const sk = (spineTrack && trackOn) ? Math.max(0, spineTrackStrength) * tf : 0;
  // PMX 待机微动：VRM 那套 idleBoneOffset 走 vrm.humanoid，PMX 根本没有 → 不补就是纯站桩人棍。
  // 只叠加在已验证过轴向的 x/y 上（MMD 骨骼各自朝向不统一，动 z 容易扭出怪姿势）。
  // 跳舞中不叠加，免得和舞蹈动作打架。
  const idleOn = (idleEnabled && !dancingNow) ? Math.max(0, idleIntensity) : 0;
  // PMX 手臂收拢：MMD 标准静止姿势是 A-pose(双臂张开)，模型来源杂、骨骼轴向不统一，
  // 所以做成可配置角度(度)而非写死，正负哪个方向对就用哪个；0=保持模型原样。
  const armDrop = (+lastOpts.pmxArmDropDeg || 0) * Math.PI / 180;
  if (hk <= 0 && sk <= 0 && idleOn <= 0 && Math.abs(armDrop) < 1e-6) {   // 追踪/待机/收拢都关：还原骨骼到基准
    for (const k in mmdTrackState) { const s = mmdTrackState[k]; const n = mmdTrackNeutral[k]; if (s.bone && n) { s.bone.rotation.x = n.x; s.bone.rotation.y = n.y; s.bone.rotation.z = n.z; } }
    mmdTrackState = {};
    return;
  }
  if (!mmdMesh || !helper) return;
  const fx = followNDC.x, fy = followNDC.y;
  const it = idleT * (idleSpeed || 1);
  const breath = Math.sin(it * 1.15) * 0.030 * idleOn;   // 呼吸：上半身前后起伏（幅度过小会看成“完全没动”）
  // 模型朝 +Z 面向相机：屏幕右(+X)→绕 +Y 正向转头；屏幕上(+Y)→绕 +X 负向抬头（方向反了就把符号取反）。
  // 每项的待机分量：呼吸(前后 x) + 重心缓慢扭动(左右 y) + 头部自然微摆，能带动头发一起轻晃。
  const targets = [
    { key: 'head', b: getMmdBone(['頭', '头', 'head', 'Head']),     y: fx * 0.5 * hk + 0.045 * idleOn * idleNoise(it, 6.7),  x: -fy * 0.3 * hk + 0.022 * idleOn * idleNoise(it, 6.1) },
    { key: 'neck', b: getMmdBone(['首', '颈', 'neck', 'Neck']),     y: fx * 0.35 * hk + 0.032 * idleOn * idleNoise(it, 5.0), x: -fy * 0.2 * hk },
    { key: 'ub',   b: getMmdBone(['上半身', 'upper body', 'spine', 'Spine']), y: fx * 0.15 * sk + 0.038 * idleOn * idleNoise(it, 1.4), x: -fy * 0.09 * sk + breath },
    { key: 'ub2',  b: getMmdBone(['上半身2', 'upper body 2', 'chest', 'Chest']),  y: fx * 0.1 * sk + 0.026 * idleOn * idleNoise(it, 2.2),  x: -fy * 0.06 * sk + breath * 0.7 },
    // 手臂收拢（左右方向相反）：候选名覆盖常见写法，模型命名不统一也能尽量命中
    { key: 'larm', b: findMmdArmBone('L'), z: -armDrop },
    { key: 'rarm', b: findMmdArmBone('R'), z:  armDrop },
  ];
  for (const t of targets) {
    if (!t.b) {
      // 设了收拢角度却没匹配到骨骼 → 明确提示，免得以为滑块坏了（只提示一次，不刷屏）
      if ((t.key === 'larm' || t.key === 'rarm') && Math.abs(armDrop) > 1e-6 && !armDropWarned) {
        armDropWarned = true;
        console.warn('[3D桌宠] 手臂收拢：未匹配到该模型的手臂骨骼（骨骼名不常见），此设置对它无效');
      }
      continue;
    }
    // 首次观测即基准；z 也要记，手臂收拢走的就是 z 轴
    if (!mmdTrackNeutral[t.key]) mmdTrackNeutral[t.key] = { x: t.b.rotation.x, y: t.b.rotation.y, z: t.b.rotation.z };
    const n = mmdTrackNeutral[t.key];
    const ox = t.x || 0, oy = t.y || 0, oz = t.z || 0;
    t.b.rotation.x = n.x + ox;
    t.b.rotation.y = n.y + oy;
    t.b.rotation.z = n.z + oz;
    mmdTrackState[t.key] = { bone: t.b, x: ox, y: oy, z: oz };
  }
}

// ---- 待机小动作 / 手势：改为“播放 VRMA 动画”（与舞蹈同一条 vrmMixer 链路）----
// 不再手摆骨骼——mate engine 的待机/手势就是播动画驱动的，手摆骨骼容易穿模/僵硬。
// 手势名按已加载的 clip 名解析：精确命中 → 名称包含 → 反向中文关键词 → 否则不播（绝不回退到手摆骨骼）。
function resolveClip(name) {
  if (!name) return null;
  if (vrmClips[name]) return name;
  const lower = String(name).toLowerCase();
  // ★ 候选名也取**全集**（allMotions）：vrmClips 是懒加载缓存，启动时为空 ⇒
  //   只看它的话任何名字都解析不出来（与"浮层显示 0 个动作"同源）。
  //   这里只做**名字解析**；命中后 clip 未必已进内存，真正播放请走 resolveClipAsync（它会 ensure 加载）。
  const pName = playableMotionNames();     // ★ 只搜"当前模型能播的"：否则会命中山寨名字，落到 ensureVrmClip 里静默失败
  const keys = pName.length ? pName : Object.keys(vrmClips);
  let hit = keys.find(k => k.toLowerCase().includes(lower));
  if (hit) return hit;
  const map = { wave: '挥手', nod: '点头', bow: '鞠躬', sway: '摇摆', stretch: '伸展', twirl: '转',
    happyjump: '开心', heart: '比心', tsundere: '傲娇', shy: '害羞', yawn: '哈欠', lookaround: '张望' };
  const cn = map[name];
  if (cn) { hit = keys.find(k => k.toLowerCase().includes(cn)); if (hit) return hit; }
  return null;
}
// 异步解析动作名 → 已加载的 clip 名（找不到则按名字/中文关键词去 allMotions 里懒加载对应 clip）
async function resolveClipAsync(name) {
  if (!name) return null;
  if (vrmClips[name]) return name;
  const lower = String(name).toLowerCase();
  const cand = playableMotions();          // ★ 只在"当前模型能播的"里找，避免命中 .vmd 这类必然失败的候选
  let hit = cand.find(m => m.name.toLowerCase() === lower || m.name.toLowerCase().includes(lower));
  if (hit) { const c = await ensureVrmClip(hit.name); return c ? hit.name : null; }
  const map = { wave: '挥手', nod: '点头', bow: '鞠躬', sway: '摇摆', stretch: '伸展', twirl: '转', happyjump: '开心', heart: '比心', tsundere: '傲娇', shy: '害羞', yawn: '哈欠', lookaround: '张望' };
  const cn = map[name];
  if (cn) { hit = cand.find(m => m.name.toLowerCase().includes(cn.toLowerCase())); if (hit) { const c = await ensureVrmClip(hit.name); return c ? hit.name : null; } }
  return null;
}
let gestureAction = null, gestureExpr = '', dragAction = null;
let gestureTimers = [];
function clearGestureTimers() { gestureTimers.forEach(t => clearTimeout(t)); gestureTimers = []; }
const GESTURE_EXPR = { wave: 'happy', heart: 'happy', shy: 'surprised', yawn: 'relaxed',
  happyjump: 'happy', tsundere: 'angry', stretch: 'relaxed', sway: 'happy', twirl: 'happy', nod: 'happy' };
// 播放一段 VRMA 作为一次性手势（LoopOnce + 末帧保持 + 淡出收回）。无对应动画则不播。
async function playGesture(name) {
  if (!vrm || !vrmMixer) return false;
  if (embodiedYielding) return false;   // 具身动作接管时不让手势抢骨骼
  let cn = vrmClips[name] ? name : null;
  if (!cn) cn = await resolveClipAsync(name);
  if (!cn) {
    // 没有对应 VRMA 动作文件：仍作为“纯表情预览”播放，让“试试”按钮至少能变脸（不播身体动画）
    const en = GESTURE_EXPR[name];
    if (en && exprMgr()) { try { if (exprMgr().getExpression(en)) { exprMgr().setValue(en, 1); gestureExpr = en; clearGestureTimers(); gestureTimers.push(setTimeout(() => { try { exprMgr().setValue(en, 0); } catch (e) { } gestureExpr = ''; }, 1200)); } } catch (e) { } }
    return false;
  }
  const clip = vrmClips[cn];
  setClipActive(cn, true);
  const actionA = vrmMixer.clipAction(clip);
  actionA.reset();
  actionA.setLoop(THREE.LoopOnce, 1);
  actionA.clampWhenFinished = true;
  actionA.enabled = true;
  actionA.setEffectiveWeight(1);
  actionA.fadeIn(0.15);
  actionA.play();
  if (gestureAction && gestureAction !== actionA) { try { gestureAction.fadeOut(0.15); } catch (e) { } }
  gestureAction = actionA;
  if (!clipHasExpressionTrack(clip) && GESTURE_EXPR[name]) {
    const en = GESTURE_EXPR[name];
    if (exprMgr()) { try { if (exprMgr().getExpression(en)) { exprMgr().setValue(en, 1); gestureExpr = en; } } catch (e) { } }
  }
  const dur = (clip.duration && clip.duration > 0) ? clip.duration : 1.5;
  clearGestureTimers();
  gestureTimers.push(setTimeout(() => {
    try { actionA.fadeOut(0.25); } catch (e) { }
    gestureTimers.push(setTimeout(() => {
      try { actionA.stop(); } catch (e) { }
      if (gestureAction === actionA) gestureAction = null;
      setClipActive(cn, false);
      if (gestureExpr) { try { exprMgr().setValue(gestureExpr, 0); } catch (e) { } gestureExpr = ''; }
    }, 300));
  }, Math.max(0, dur - 0.25) * 1000));
  return true;
}
// 拖拽时播放的“被抓起/挥舞”动画：找名字含 drag/抱/拎… 的 VRMA 循环播放；松手淡出。无对应文件则不播（仅移动窗口）。
function startDragAnim() {
  if (!vrm || !vrmMixer || dragAction) return;
  if (embodiedYielding) return;   // 具身动作接管时不让拖拽动画抢骨骼（窗口移动不受影响）
  const m = playableMotions().find(k => /drag|抱|pick|lift|抓|拿|hang|拎|carry|举|hold/i.test(k.name));   // ★ 只挑能播的
  if (!m) return;
  ensureVrmClip(m.name).then(clip => {
    if (!clip || !vrmMixer || dragAction) return;
    setClipActive(m.name, true); dragClipName = m.name;
    const a = vrmMixer.clipAction(clip);
    a.reset(); a.setLoop(THREE.LoopRepeat, Infinity); a.enabled = true; a.setEffectiveWeight(1); a.fadeIn(0.2); a.play();
    dragAction = a;
  }).catch(() => {});
}
function stopDragAnim() {
  if (!dragAction) return;
  const a = dragAction; dragAction = null;
  setClipActive(dragClipName, false); dragClipName = null;
  try { a.fadeOut(0.25); } catch (e) { }
  gestureTimers.push(setTimeout(() => { try { a.stop(); } catch (e) { } }, 300));
}
function playAction(name) { return playGesture(name); }   // 兼容“试试”按钮与 messageBus('action')
// 自动小动作调度：待机时按频率随机播一段手势型 VRMA（即 mate engine 那种“播动画待机”），动作进行中不打断。
let gestureTimer = 9;
let gestureBusy = false, danceBusy = false;
async function scheduleGesture(dt) {
  if (gestureBusy) return;
  if (!idleEnabled || idleGestureLevel <= 0) return;
  if (lastOpts.autoDance && currentMotionAction) return;   // 跳舞中不叠加待机小动作
  // 仰躺下不触发（会穿模），靠待机表现
  if (currentPose === 'lieback') return;
  if (gestureAction || dragAction) return;                // 正在播手势/拖拽时不叠加
  gestureTimer -= dt;
  if (gestureTimer > 0) return;
  const all = playableMotionNames();   // ★ 只随机"能播的"，否则抽到 .vmd 就是空转一轮（人不动、无日志）
  if (!all.length) return;
  // 优先挑“像手势”的动画（名字命中手势关键词），没有就随机挑一支
  const gestureNames = all.filter(k => /wave|nod|bow|sway|stretch|twirl|happyjump|heart|tsundere|shy|yawn|lookaround|挥手|点头|鞠躬|摇摆|伸展|转|开心|比心|傲娇|害羞|哈欠|张望/i.test(k));
  const pool = gestureNames.length ? gestureNames : all;
  const pickName = pool[Math.floor(Math.random() * pool.length)];
  // 提前预取“下一个随机”的 clip，真正要播时已在缓存，避免每次都现场解析卡顿
  const nextName = pool[Math.floor(Math.random() * pool.length)];
  if (nextName && nextName !== pickName) ensureVrmClip(nextName).catch(() => {});
  gestureBusy = true;
  try {
    const cn = await ensureVrmClip(pickName);
    if (cn) playGesture(cn);
  } finally { gestureBusy = false; }
  const base = { 1: 24, 2: 14, 3: 7 }[idleGestureLevel] || 14;
  gestureTimer = base + Math.random() * base * 0.8;
}

// ---- 待机动画：用短 VRMA 动作循环驱动待机（取代原先的程序化“晃动”）----
// 指定这 9 支短动作当待机（文件名匹配即可）：
//   VRMA_01 ~ VRMA_07（VRMA_MotionPack）、001_motion_pose、004_hello_1（fm_vrma_motion_pack_01）
// 它们都很短，播完留一小段随机停顿再随机播下一支 → 自然、连续、不打架。
const IDLE_MOTION_RE = /^(VRMA_0[1-7]|001_motion_pose|004_hello_1)$/i;
function idleMotionPool() {
  let pool = allMotions.filter(m => m.kind === 'vrma' && IDLE_MOTION_RE.test(String(m.name || '').trim()));
  // 若这 9 支没被加载，退而用“任意 VRMA 动作”，至少别退回人棍站桩
  if (!pool.length) pool = allMotions.filter(m => m.kind === 'vrma');
  return pool.length ? pool : null;
}
let idleMotionTimer = 1.2;     // 首次待机动作延迟（秒）
let idleMotionBusy = false;

// ---- 「节奏」可调参数（面板最下面三个滑块；解决"动作+表情挤在一起太密集"）----
// 为什么需要：AI 会连续调用动作/表情，而各层原来都**没有冷却** → 观感上就是"一刻不停在动"。
let motionCooldown = 1.0;       // 两次动作之间至少间隔（秒）：太近则**延后**（不是丢掉）
let motionIdleGap = 0.6;        // 动作结束后 → 待机动作之间的交接空档（秒）
let exprHoldMin = 4;            // 表情最短保持（秒）：AI 给更短就抬到这个下限，避免"表情闪来闪去"
let lastBridgeMotionAt = -1e9;  // 上次经 bridge（AI/宿主）触发动作的时刻
let idleShuffleBag = [];        // 洗牌袋：把全部待机动作打散，逐个取完才重洗 → 9 支每支都跳到，不重复不遗漏
function idleNextFromBag(pool) {
  if (idleShuffleBag.length) {
    const n = idleShuffleBag.pop();
    if (pool.some(m => m.name === n)) return n;          // 名字仍存在才用
  }
  idleShuffleBag = pool.map(m => m.name);                // 重建并 Fisher–Yates 洗牌
  for (let i = idleShuffleBag.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = idleShuffleBag[i]; idleShuffleBag[i] = idleShuffleBag[j]; idleShuffleBag[j] = t;
  }
  return idleShuffleBag.pop();
}
async function scheduleIdleMotion(dt) {
  if (idleMotionBusy) return;
  if (!idleEnabled) return;
  if (currentPose !== 'stand') return;                 // 坐/躺不做（会穿模），让姿势本身表现
  if (dancingNow || currentMotionAction) return;        // 正在跳/选中动作：让位
  if (gestureAction || dragAction) return;              // 正在播（含上一支待机动作）：等它播完
  idleMotionTimer -= dt;
  if (idleMotionTimer > 0) return;
  const pool = idleMotionPool();
  if (!pool) { idleMotionTimer = 5; return; }
  const pick = pool.find(m => m.name === idleNextFromBag(pool)) || pool[0];
  const peek = idleShuffleBag.length ? idleShuffleBag[idleShuffleBag.length - 1] : null;  // 袋顶=下一支，先预取
  if (peek) ensureVrmClip(peek).catch(() => {});
  idleMotionBusy = true;
  try {
    const clip = await ensureVrmClip(pick.name);
    if (clip && !dancingNow && !gestureAction && !dragAction && currentPose === 'stand')
      await playGesture(pick.name);
  } finally {
    idleMotionBusy = false;
    // 支与支之间的间隔（设置“待机动作间隔”可调，0=无缝连播）；带点随机不机械
    const g = (idleGap > 0) ? idleGap : 0.4;
    idleMotionTimer = g * (0.7 + Math.random() * 0.6);
  }
}

// ---- 鼠标追踪 / 程序化姿势（让桌宠"自由动"，不是靶子） ----
let headTrack = true, spineTrack = true, windowTopState = true;
let danceDisableTrack = true;   // “舞蹈时关闭追踪”：开则播放动作期间暂停头部/脊椎光标追踪
let dancingNow = false;         // 当前是否有动作(舞蹈)正在播放：配合 danceDisableTrack，退出后恢复追踪
let cursorNDC = null;            // 任意来源的光标归一化坐标（**含宿主下发的全屏光标**：只用于"头跟着鼠标转"）
// ★★ 2026-10-14：必须把"**窗口内的真实光标**"单独存一份 —— 触摸判定只认它。
//   原因（用户实测："我没碰到人物就反馈了"）：宿主通过 messageBus.on('cursor') 持续下发**全屏**光标
//   位置，而旧代码把它和窗口内 mousemove 写进**同一个** cursorNDC ⇒ 鼠标在桌面任意位置，
//   只要射线方向碰巧对着模型，就会被判成"摸到了"（还会连带触发 bounce 反馈与 pet_touch）。
let cursorLocal = null;          // {x,y,t}：只在光标真处于本窗口内时非空（触摸/戳一下只认它）
let cursorSeenT = -10;           // 上次光标更新时刻（idleT，秒）：用于判断"光标是否还在附近"
let followNDC = { x: 0, y: 0 };  // 阻尼+存在度平滑后的光标偏移：头/脊椎跟随都用它，杜绝逐帧抽搐
let headPresence = 0;            // 光标"在场"程度 0~1：离场/超出范围 → 缓动回 0（回正脸）
let lookTarget = null;          // 视线目标（世界坐标）
let boneRest = {};              // 各骨骼静止旋转（加载时捕获）
let poseTarget = {};            // 当前姿势目标偏移
let poseCurrent = {};           // 当前姿势插值后的偏移
let currentPose = 'stand';
// 参与姿势插值的骨骼（整条手臂/腿/脊柱）。VRM 归一化骨骼：手臂沿 ±X、腿沿 -Y、人物朝 +Z。
const POSE_BONES = ['hips', 'spine', 'chest', 'upperChest', 'neck', 'head',
  'leftShoulder', 'rightShoulder',
  'leftUpperArm', 'leftLowerArm', 'leftHand', 'rightUpperArm', 'rightLowerArm', 'rightHand',
  'leftUpperLeg', 'leftLowerLeg', 'leftFoot', 'rightUpperLeg', 'rightLowerLeg', 'rightFoot'];
// 基础"放松"姿态（所有姿势共用）：把 T-pose 的手臂自然垂下，避免横着像靶子。
// 基础"放松"姿态（所有姿势共用）：把 T-pose 的手臂自然垂下，避免横着像靶子。
const RELAX = {
  leftUpperArm: { z: 1.35 }, rightUpperArm: { z: -1.35 },
  leftLowerArm: { x: 0.18 }, rightLowerArm: { x: 0.18 },
  leftHand: { x: 0.1 }, rightHand: { x: 0.1 },
};
// 姿势定义：
//   root: 整体旋转/竖直偏移（世界单位），让接触点贴窗口底边
//   bones: 在 RELAX 基础上再叠加的骨骼偏移
// sit/recline 的竖直偏移在 setPose 里按模型实测胯高计算。
const POSES = {
  stand: { root: { rx: 0, ry: 0, rz: 0, y: 0 }, bones: {} },
  // 坐姿：取景只保留"上半身"（下切线切在小腹/胯上方，腿全部裁在画面外，见 fitCamera 的 sit 分支），
  // 所以不再需要为了看清大腿而把身体转成 3/4 侧身 —— root.ry=0，正脸对着观众。
  // 腿的骨骼仍然保留（万一以后想看全身），但当前取景下看不见。
  sit: {
    root: { rx: 0, ry: 0, rz: 0, y: 0 },
    bones: {
      spine: { x: 0.14, y: 0.06 }, chest: { x: 0.10, y: 0.04 },
      // 大腿前伸坐下 + 膝盖外张 + 左右略有差异
      leftUpperLeg: { x: -1.48, z: 0.20 }, leftLowerLeg: { x: 1.50 }, leftFoot: { x: 0.30 },
      rightUpperLeg: { x: -1.56, z: -0.16 }, rightLowerLeg: { x: 1.62 }, rightFoot: { x: 0.28 },
      // 双手自然搭在大腿上
      leftUpperArm: { z: -0.22, x: -0.55 }, leftLowerArm: { x: 0.85 },
      rightUpperArm: { z: 0.22, x: -0.50 }, rightLowerArm: { x: 0.80 },
      head: { x: 0.04 },
    }
  },
  // 仰躺（原来的平躺）：绕 X 轴 -90° 仰面朝上，取景会强制俯视以避免"看裙底"
  lieback: {
    root: { rx: -Math.PI / 2, ry: 0, rz: 0, y: 0 },
    bones: { chest: { x: 0.05 }, leftUpperArm: { z: 0.15 }, rightUpperArm: { z: -0.15 } }
  },
};
let poseRootTarget = { rx: 0, ry: 0, rz: 0, y: 0 };
let poseRootCur = { rx: 0, ry: 0, rz: 0, y: 0 };

// ---- 接地（脚踩地面）：让当前动作的最低接触点钉在“站立地面线”上，消除跳舞脚悬空/软绵绵的鱼扑腾感 ----
let restFootRelY = 0;            // 站立姿态下最低脚相对 petRoot 原点的 Y（即“地面线”）
let clipGroundCache = new Map(); // clip -> (clip最低脚相对Y - restFootRelY)；播放时 petRoot.y 减去它
let groundInited = false, groundInitT = 0;
let showGroundLine = true;    // 是否显示“地面参考线”（屏幕空间极细两条线，不是阴影块）
let groundLineL = null, groundLineR = null;   // 地面参考线左右两段（中间留空，不盖人物）
let modelHalfWidth = 0.5;     // 模型半宽（固定地面线的宽度用）
let _gv = null;
function _gv3() { if (!_gv) _gv = new THREE.Vector3(); return _gv; }
function saveHumanoidState() {
  const st = [];
  const nb = vrm.humanoid.normalizedHumanBones;
  for (const k in nb) { const node = nb[k] && nb[k].node; if (node) st.push([node, node.position.clone(), node.quaternion.clone(), node.scale.clone()]); }
  return st;
}
function restoreHumanoidState(st, keepExpr) {
  for (const a of st) { const node = a[0]; node.position.copy(a[1]); node.quaternion.copy(a[2]); node.scale.copy(a[3]); }
  // keepExpr=true ⇒ **不动表情**。量测时用它：原来无条件清零 ⇒ 量测那一帧"脸被抹平"、
  //   下一帧才被基础/舞蹈表情补回来 —— 肉眼就是一次面部抽搐（量测会把当前表情一起吃掉）。
  if (keepExpr) return;
  if (exprMgr()) { for (const n of collectExpressions()) { try { exprMgr().setValue(n, 0); } catch (e) { } } }
}
function measureLowestFootRelY() {
  const fl = vrm.humanoid.getNormalizedBoneNode('leftFoot');
  const fr = vrm.humanoid.getNormalizedBoneNode('rightFoot');
  if (!fl && !fr) return 0;
  let m = Infinity;
  if (fl) { fl.getWorldPosition(_gv3()); const y = _gv.y - petRoot.position.y; if (y < m) m = y; }
  if (fr) { fr.getWorldPosition(_gv3()); const y = _gv.y - petRoot.position.y; if (y < m) m = y; }
  return m === Infinity ? 0 : m;
}
// 用临时 mixer 采样整段动作，求“最低脚相对Y”，再与站立地面线相减 → 接地偏移
function measureClipGround(clip) {
  const saved = saveHumanoidState();
  // 只有**动作自带表情轨道**时才需要清表情（采样会写表情）；否则一概不动 —— 见 restoreHumanoidState 的说明。
  const wipeExpr = clipHasExpressionTrack(clip);
  const tmp = new THREE.AnimationMixer(vrm.scene);
  const act = tmp.clipAction(clip);
  act.setLoop(THREE.LoopRepeat, Infinity); act.play();
  const samples = 16; let minRel = Infinity;
  for (let i = 0; i <= samples; i++) {
    tmp.setTime(clip.duration * (i / samples));
    vrm.update(0);
    const low = measureLowestFootRelY();
    if (low < minRel) minRel = low;
  }
  tmp.stopAllAction();
  try { tmp.uncacheRoot(vrm.scene); } catch (e) { }
  restoreHumanoidState(saved, !wipeExpr);
  // ★★ 必须补一次 vrm.update(0)：上面的采样循环每轮都 `vrm.update(0)`，已经把**原始骨骼**（蒙皮真正用的那套）
  //   改成了那支动作在采样点上的姿势；而 restoreHumanoidState 只还原**归一化骨骼** ⇒ 原始骨骼会**残留**到
  //   本帧结束。若本帧后面没人再传导（或顺序有变），画面上就是"抽到另一支动作的姿势一瞬间、然后回来"
  //   （用户实测："摆完姿势有时候会抽搐到另一个动作一瞬间"）。补这一步让它当帧就一致，不靠运气。
  try { vrm.update(0); } catch (e) { }
  return minRel - restFootRelY;
}
function getClipGroundOffset(clip) {
  if (!clip) return 0;
  if (clipGroundCache.has(clip)) return clipGroundCache.get(clip);
  // 诊断：**每支动作只量一次**（结果有缓存）⇒ 每行只打一次，不会刷屏。
  // 用途：如果"抽搐到另一个动作一瞬间"正好紧跟这行，那就是量测在那一帧留下的痕迹（用来对齐时间点）。
  // 措辞避开探针关键词（`量测` 在 PROBE_HINTS 里 ⇒ 会被静默），否则这行等于没加。
  try { postLog('info', '地面偏移（一次性，每支动作一次）：' + (clip.name || '?') + '（时长 ' + (+(clip.duration) || 0).toFixed(2) + 's）'); } catch (e) { }
  let off = 0; try { off = measureClipGround(clip); } catch (e) { off = 0; }
  clipGroundCache.set(clip, off);
  return off;
}
// 待机姿态稳定后做一次（采样所有动作的最低脚 + 站立地面线），结果缓存
function initGrounding() {
  const saved = saveHumanoidState();
  restFootRelY = measureLowestFootRelY();
  try { const box = new THREE.Box3().setFromObject(vrm.scene); modelHalfWidth = Math.max(0.2, (box.max.x - box.min.x) * 0.5); } catch (e) { }
  groundLineL = document.getElementById('ground-line-l');   // 屏幕空间地面线左右两段（每帧投影定位）
  groundLineR = document.getElementById('ground-line-r');
  for (const name in vrmClips) { try { getClipGroundOffset(vrmClips[name]); } catch (e) { } }
  restoreHumanoidState(saved);
  groundInited = true;
}
let poseReframeTimer = null;
let _lastPoseLogged = '';    // 「姿势切换」日志去重：只在姿势名真的变化时打一行
// 姿势目标 = 放松基准 + 姿势预设 + **用户在面板里的微调**（三者都是角度偏移，单位弧度）。
// 抽成独立函数有两个用处：① setPose 调用它；② 面板滑条拖动时**本地立即**重算
// （见 pushPoseOffsets —— 旧实现只发消息、等宿主回传才应用，那条链一出问题就是"看着能调、人不动"）。
// 微调轴向校正开关（设置面板「姿势」区；localStorage 持久化，默认开）。
// 只作用于**用户在面板里拖的微调值**，RELAX / 姿势预设一律不动 —— 理由见 measurePoseAxes 里的 REF 说明。
let _axisFixMem = null;
function poseAxisFixOn() {
  if (_axisFixMem === null) { let v = true; try { v = localStorage.getItem('petAxisFix') !== '0'; } catch (e) { } _axisFixMem = v; }
  return _axisFixMem;
}
function setPoseAxisFix(on) {
  _axisFixMem = !!on;
  try { if (on) localStorage.removeItem('petAxisFix'); else localStorage.setItem('petAxisFix', '0'); } catch (e) { }
}
// ★ 家族级手动覆盖：**不反转 / 反转** 每族一行下拉（原"自动实测"已停用 —— 它跨会话自相矛盾、误改基础姿势）。
//   不反转（含原"自动"）= 完全按你拖出来的数值原样施加；反转 = 整族取反（方向反了就用它）。
//   （measurePoseAxes 仍在**记录**实测结果，但只进日志、不再动骨头；判断交还给人。）
// ---- ★★ 每模型存档：轴向 / 手指方向的选择按**模型**记住（换模型互不干扰、重载后仍在）----
// 回答"为什么不能持久化"：以前只有**全局**开关 + 每次加载重算 —— 同一句"反转"在别的模型上可能正好是错的，
//   而这台模型上你摆好的结果又得靠手动再选一次。现在全部落到「以模型为键」的存档里：
//   ① 你手选的（自动/反转/不反转）② 以后自动量出来的结果（同一份结构，见 fam/flip）。
// 键 = 模型 URL 的"尾段 + 短哈希" ⇒ 同一模型换窗口/换路径都能命中同一条。
let currentModelUrl = '';
// ★★ 手指轴表提到**模块级**:以前它是 `embodiedMeasureRig` 的局部变量,而"手指方向"开关在模块作用域读它
//   ⇒ 每次量测都抛 `ReferenceError: fingerAxes is not defined` ⇒ rig 被置 null ⇒ 每次合成都重量测
//   （实测日志：13 秒刷了 600+ 次"量 rig 失败…fingerAxes is not defined"）—— 那既让胳膊被量测姿势抽，
//   又让手指轴在"已经弯着的手"上重测成垃圾 ⇒ **手指怎么调都没反应**。这就是那几轮的总病根。
//   现在：同一个对象模块级共享,量测时**清空复用**(不新建对象,避免旧引用指向废弃对象)。
let fingerAxes = {};
let _rigProfile = null, _rigProfileKey = '';
let _rigMigratedKeys = {};   // 已迁移过的键（避免每次重置都重迁 + 刷日志）
function rigModelKey() {
  const u = String(currentModelUrl || '');
  const tail = (u.split(/[\\/]/).pop() || '').replace(/[^A-Za-z0-9_.\-]/g, '').slice(0, 24);
  // ★★ 主键用**骨架签名**（量到的骨朝向条数 + 髋→头高），而不是"模型路径"：
  //   路径在换模型/换加载方式时可能为空或变形式（实测：不加签名时所有模型共用一条存档 ⇒
  //   用户看到"设置**继承给下一个模型**了，不是各模型各自保存"）。骨架签名正是"决定轴向要不要翻"
  //   的那件事，所以它天然按模型分开，且同一模型换路径仍命中。
  const rg = window.EmbodiedRig;
  if (rg && rg.dir && rg.hipToHead) {
    const n = Object.keys(rg.dir).length;
    const h = Math.round(rg.hipToHead * 100);
    return 's' + n + '_h' + h + (tail ? ('_' + tail) : '');
  }
  if (!u) return 'unknown';
  let hsh = 0;
  for (let i = 0; i < u.length; i++) hsh = (hsh * 31 + u.charCodeAt(i)) | 0;
  return (tail || 'model') + '_' + (hsh >>> 0).toString(36);
}
// 旧键（v7.2 之前用的是"路径哈希"）：迁移用 —— 换键后，用户之前在旧键下存的"反转/数值"要搬过来，
// 否则一换键就把他们的设置"弄丢"了（本次回归的另一半来源）。
function rigModelKeyLegacy() {
  const u = String(currentModelUrl || '');
  if (!u) return 'unknown';
  let h = 0;
  for (let i = 0; i < u.length; i++) h = (h * 31 + u.charCodeAt(i)) | 0;
  const tail = (u.split(/[\\/]/).pop() || '').replace(/[^A-Za-z0-9_.\-]/g, '').slice(0, 24);
  return (tail || 'model') + '_' + (h >>> 0).toString(36);
}
// ★★ 宿主副本：**跨"插件重载"唯一可靠的存储**（实测：插件重载后前端 localStorage 会整体重置 ⇒ 用户
//   "每次都得再调一遍反转"）。所以存档同时写两份：前端 localStorage（会话内快）+ 宿主配置（长存）。
//   宿主侧 = `Configuration.RigProfile`（JSON 字符串，按模型键分组），通路照抄 `pose_offsets`。
let _rigHostJson = '';
function rigHostLoad(json) { try { _rigHostJson = json || ''; _rigProfile = null; _rigProfileKey = ''; } catch (e) { } }
function rigHostGet(key) {
  try {
    const all = JSON.parse(_rigHostJson || 'null');
    const v = all && typeof all === 'object' ? all[key] : null;
    return (v && typeof v === 'object') ? v : null;
  } catch (e) { return null; }
}
function rigHostSet(key, obj) {
  if (!key) return;
  let all = {};
  try { all = JSON.parse(_rigHostJson || 'null') || {}; } catch (e) { all = {}; }
  all[key] = obj;
  const s = JSON.stringify(all);
  if (s.length > 200000) return;                 // 保守上限：别把插件配置撑爆
  _rigHostJson = s;
  try { sendMenu('rig_profile', { value: s }); } catch (e) { }
}
function rigProfile() {
  const k = rigModelKey();
  if (_rigProfile && _rigProfileKey === k) return _rigProfile;
  let o = null;
  try { o = JSON.parse(localStorage.getItem('petRig_' + k) || 'null'); } catch (e) { o = null; }
  if (!o || typeof o !== 'object') o = rigHostGet(k) || null;   // ★ 前端没了就用宿主副本（插件重载后就是这条）
  // ★ 迁移：新键（骨架签名）没存档，而**旧键（路径哈希）有** ⇒ 搬过来（否则换键 = 用户设置"被弄丢"）
  if (!o || typeof o !== 'object') {
    const lk = rigModelKeyLegacy();
    if (lk && lk !== k) {
      let lo = null;
      try { lo = JSON.parse(localStorage.getItem('petRig_' + lk) || 'null'); } catch (e) { lo = null; }
      if (!lo || typeof lo !== 'object') lo = rigHostGet(lk) || null;
      if (lo && typeof lo === 'object') {
        o = lo;
        // ★ 立刻落到新键（localStorage + 宿主）：否则下一次 rigProfileReset 又会重迁 + 日志刷屏（实测刷了几十行）
        try { localStorage.setItem('petRig_' + k, JSON.stringify(lo)); } catch (e) { }
        rigHostSet(k, lo);
        if (!_rigMigratedKeys[k]) { _rigMigratedKeys[k] = 1; try { postLog('info', '轴向存档：已从旧键 ' + lk + ' 迁移到 ' + k); } catch (e) { } }
      }
    }
  }
  if (!o || typeof o !== 'object') o = {};
  if (!o.fam) o.fam = {};
  if (!o.flip) o.flip = {};
  _rigProfile = o; _rigProfileKey = k;
  return o;
}
function rigSave() {
  if (!_rigProfileKey) return;
  try { localStorage.setItem('petRig_' + _rigProfileKey, JSON.stringify(_rigProfile || {})); } catch (e) { }
  rigHostSet(_rigProfileKey, _rigProfile || {});                 // ★ 同时写宿主（跨插件重载）
}
function rigGet(kind, name, dft) {
  const p = rigProfile(), v = p[kind] ? p[kind][name] : undefined;
  return (v === undefined || v === null) ? dft : v;
}
function rigSet(kind, name, v) {
  const p = rigProfile();
  if (!p[kind]) p[kind] = {};
  p[kind][name] = v; rigSave();
}
// 换模型时清掉内存缓存（存档本身按模型分开，不会串）
function rigProfileReset() { _rigProfile = null; _rigProfileKey = ''; _famMem = { arm: null, leg: null, hand: null, thumb: null }; }

const POSE_FAM = {
  arm: ['leftShoulder', 'rightShoulder', 'leftUpperArm', 'leftLowerArm', 'leftHand', 'rightUpperArm', 'rightLowerArm', 'rightHand'],
  leg: ['leftUpperLeg', 'leftLowerLeg', 'leftFoot', 'rightUpperLeg', 'rightLowerLeg', 'rightFoot'],
};
let _famMem = { arm: null, leg: null, hand: null, thumb: null };
function poseFamilyMode(fam) {
  if (_famMem[fam] === null) {
    let v = rigGet('fam', fam, null);
    if (v === null) {                       // 迁移：旧版全局键（你之前在旧版选过的话，第一次带过来）
      try { v = localStorage.getItem('petAxisFix_' + fam); } catch (e) { v = null; }
      if (v) rigSet('fam', fam, v);
    }
    if (v !== 'auto' && v !== 'flip' && v !== 'off') v = 'auto';
    _famMem[fam] = v;
  }
  return _famMem[fam];
}
function setPoseFamilyMode(fam, v) {
  _famMem[fam] = v;
  rigSet('fam', fam, v);                    // ★ 按模型存 ⇒ 重载/换模型后仍然记得
  try { if (v === 'auto') localStorage.removeItem('petAxisFix_' + fam); else localStorage.setItem('petAxisFix_' + fam, v); } catch (e) { }
  // 手指方向不走 Euler 微调那条路，它改的是 `fingerAxes[*].sign`（四指/拇指唯一来源）⇒ 立即重新套用
  if (fam === 'hand' || fam === 'thumb') { try { applyHandFlipModes(); } catch (e) { } }
  // ★ 让"当前正在播的那份造型剪辑"**立刻**用上新轴/新符号（否则要等下一次拖滑块或重载模型才生效 ——
  //   用户原话："跳完不马上生效，我都得重载模型一遍"）。造型面板打开时会挂上 `window.__poseResend`。
  try { if (typeof window.__poseResend === 'function') window.__poseResend(); } catch (e) { }
}
function axisFixFor(bn) {
  const fam = poseFamilyOf(bn);
  const mode = fam ? poseFamilyMode(fam) : 'auto';
  if (mode === 'off') return null;
  // ★★ 第 4 项「受验证的自动轴向检测」：`auto` = **用自证结论**（按模型存档 `famAuto`）。
  //   与过去那套"自动修正"的根本区别：①只在**能自证**的族上翻（抬臂应向上 / 前摆应向前，有明确判据）；
  //   ②量不出或两侧矛盾 ⇒ **不表态**（保持不动，交给人）；③**只作用于微调值**（scope 仍走 offset，
  //   绝不动基础姿势 —— 上次"误改基础姿势"就是这么翻车的）；④结论按模型存档，换模型各自量。
  if (fam) {
    let auto = null;
    try { auto = rigGet('famAuto', fam, null); } catch (e) { auto = null; }
    if (auto === 'flip') return { x: -1, y: -1, z: -1 };
  }
  if (mode === 'flip') return { x: -1, y: -1, z: -1 };      // 整族反转（手动兜底）
  // ★★ 'auto'（自动实测）已**停用**（2026-10-13 用户实测"手臂动作全乱套/穿模扭曲"）：
  //   自动量测在不同会话给出**自相矛盾**的结论（早先"手臂 z 取反"、这次又"腿+脊柱 x 取反"），
  //   还擅自把基础姿势一并改 ⇒ 越改越歪。现在"自动"等价于"不反转"：**只认你手动选的「反转」**，
  //   判断交还给人，不再让算法替你改。换模型也只在"选反转"时才生效，绝不自动动骨头。
  return null;
}
function poseFamilyOf(bn) {
  return (POSE_FAM.arm.indexOf(bn) >= 0) ? 'arm' : ((POSE_FAM.leg.indexOf(bn) >= 0) ? 'leg' : null);
}
// ---- ★ 手指方向的手动反向开关（你要的"笨办法"）----
// 手指不走上面那套 Euler 微调（它们由 compose 的 fingerJoints 按 `fingerAxes` 施加），所以单独一行控制：
//   `autoSign` = 加载时按**几何**量出来的基线（四指已按你的实测取反过 ⇒ "自动" = 现在这个行为）；
//   "反转" = 在基线之上再取反。
// **幂等**：反复切换不会累积（每次都从 autoSign 重新算），也只在内存里，按模型存档（见 setPoseFamilyMode）。
function applyHandFlipModes() {
  let n = 0;
  for (const k in fingerAxes) {
    const fa = fingerAxes[k];
    if (!fa || !fa.ax) continue;
    if (fa.autoSign === undefined) fa.autoSign = fa.sign || 1;
    const mode = poseFamilyMode((k.indexOf('Thumb') >= 0) ? 'thumb' : 'hand');
    fa.sign = (mode === 'flip') ? -fa.autoSign : fa.autoSign;
    n++;
  }
  return n;
}
// 作用范围：'all' = 基础姿势 / 姿势预设 / 微调值**全修**（自动结果通过了"手臂自然下垂"验证，或用户手选了"反转"）；
//           'offset' = 只修微调值（保守：自动结果没通过验证时用，绝不动基础姿势）。
function axisFixScope(bn) {
  const fam = poseFamilyOf(bn);
  if (fam && poseFamilyMode(fam) === 'flip') return 'all';
  return window.PoseAxisFixVerified ? 'all' : 'offset';
}
function refreshPoseTargets() {
  const name = currentPose || 'stand';
  const preset = POSES[name] || POSES.stand;
  const ov = poseOverrides[name] || {};
  for (const bn of POSE_BONES) {
    const base = RELAX[bn] || { x: 0, y: 0, z: 0 };
    const add = preset.bones[bn] || {};
    const o = ov[bn] || {};
    // ★ 每项都 `+` 强转数字：微调值若以**字符串**进来（老配置/手改 JSON），
    //   `0.1 + 0.2 + "0.05"` 会变成字符串拼接 ⇒ 角度 NaN ⇒ 骨骼写不进去，
    //   表现同样是"整块滑条看着能调、人一动不动"（这类静默最费时间，直接堵死）。
    // ★★ 用户微调值再乘上「实测轴向符号」（PMX→VRM 转换模型的骨骼局部轴可能与作者约定反号 ⇒
    //   拖"上"却往"下"）。**只**乘微调这一项：这样绝不会把当前看着正常的基础姿势改坏。
    const fx = axisFixFor(bn);
    const kx = (fx && fx.x) ? -1 : 1, ky = (fx && fx.y) ? -1 : 1, kz = (fx && fx.z) ? -1 : 1;
    // 作用范围：'all'（已通过"手臂自然下垂"验证，或用户手动选了"反转"）⇒ 基础姿势与预设**一起**修；
    //   否则只修微调值（保守，绝不动基础姿势）。
    const all = !!(fx && axisFixScope(bn) === 'all');
    const ax2 = all ? kx : 1, ay2 = all ? ky : 1, az2 = all ? kz : 1;
    poseTarget[bn] = {
      x: (base.x || 0) * ax2 + (add.x || 0) * ax2 + (+o.x || 0) * kx,
      y: (base.y || 0) * ay2 + (add.y || 0) * ay2 + (+o.y || 0) * ky,
      z: (base.z || 0) * az2 + (add.z || 0) * az2 + (+o.z || 0) * kz,
    };
  }
}
function setPose(name) {
  const preset = POSES[name] || POSES.stand;
  // 诊断：**只在姿势名真的变化时**打一行。用途：若"抽搐到另一个动作一瞬间"紧跟一行
  //   `姿势切换：xxx`，说明是某处**意外地切了姿势**（而不是被动作层覆盖）—— 这两种的修法完全不同。
  if (name !== _lastPoseLogged) { _lastPoseLogged = name; try { postLog('info', '姿势切换：' + name); } catch (e) { } }
  currentPose = name;          // ★ 先定 currentPose：refreshPoseTargets 正是按它取"用户微调"
  refreshPoseTargets();
  // 整体变换：坐姿把胯降到原来脚底的高度（臀部坐到窗口底边，腿垂在底边下方）
  const r = preset.root;
  poseRootTarget = { rx: r.rx, ry: r.ry, rz: r.rz, y: r.y };
  if (name === 'sit') poseRootTarget.y = -(modelHipY - modelFloorY);
  // （currentPose 已在函数开头赋值 —— refreshPoseTargets 依赖它）
  invalidateNaturalSize();   // 姿势变了 → 自然尺寸缓存失效，重新测量
  reframe();
  reportPetBounds();
  // 姿势插值在若干帧后才到位，稍后按稳定姿态重新取景/上报窗口贴合
  clearTimeout(poseReframeTimer);
  poseReframeTimer = setTimeout(() => { invalidateNaturalSize(); reframe(); reportPetBounds(); }, 400);
}
window.addEventListener('mousemove', (e) => {
  cursorNDC = { x: (e.clientX / window.innerWidth) * 2 - 1, y: -(e.clientY / window.innerHeight) * 2 + 1 };
  cursorSeenT = idleT;
});

async function boot() {
  if (booted) return;
  try {
    THREE = await import('three');
    ({ GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js'));
    ({ MMDLoader } = await import('three/addons/loaders/MMDLoader.js'));
    ({ MMDAnimationHelper } = await import('three/addons/animation/MMDAnimationHelper.js'));
    ({ CCDIKSolver } = await import('three/addons/animation/CCDIKSolver.js'));
    ({ VRMLoaderPlugin, VRMUtils } = await import('three-vrm'));
    // 触摸用的碰撞体类（拿不到就自动降级：功能置灰 + 日志说明，不硬猜版本）
    try {
      const _m = await import('three-vrm');
      VRMSpringBoneCollider = _m.VRMSpringBoneCollider || null;
      VRMSpringBoneColliderGroup = _m.VRMSpringBoneColliderGroup || null;
    } catch (e) { VRMSpringBoneCollider = VRMSpringBoneColliderGroup = null; }
    ({ VRMAnimationLoaderPlugin, createVRMAnimationClip } = await import('three-vrm-animation'));
  } catch (e) {
    console.error('[3D桌宠] 加载 three.js 失败（请检查网络/CDN 是否可达）：', e);
    const el = document.getElementById('subtitle');
    if (el) { el.textContent = '3D 引擎加载失败：请检查网络/CDN'; el.classList.remove('hidden'); }
    return;
  }
  try {
    canvas = document.getElementById('canvas');
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
    renderer.setClearColor(0x000000, 0);
    applyQuality();   // 画质(低/中/高) → 像素比（boot 时默认 high）
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(35, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 1, 6);
    clock = new THREE.Clock();

    applyLighting('studio', 1);

    // ★ 慢帧统计（v11.6）：把"不流畅"变成日志里的数字（见 renderer 循环末尾的看门狗）
    let _slowN = 0, _slowFrom = 0, _slowWorst = 0, _slowLogT = -1e9;
    function renderTick() {
      try {
      const dt = clock.getDelta();
      _frameN++;                                  // ★ v11.9：真帧计数（状态行的 fps 用它，不再用"光标在视口内的帧数"）
      idleT += dt;
      const it = idleT * (idleSpeed || 1);
      // 头部/胸部跟随的平滑（VRM 与 PMX 共用）：先做"存在度"判定再阻尼，杜绝逐帧抽搐、离场瞬间转正。
      //   · 在场(fresh)：光标最近 0.45s 内动过，且在宠物窗口范围内(near) → 跟；
      //   · 离场：光标很久没动 / 移出范围 → 存在度缓动回 0 → 自然回正脸（约 0.1s，不是一帧跳变）。
      {
        const cu = cursorNDC;
        const fresh = (idleT - cursorSeenT) < 0.6;     // 光标停下后多留 0.15s 再判定离场，避免一停就回正
        const near = cu && Math.hypot(cu.x, cu.y) < 1.4;
        const targetP = (fresh && near) ? 1 : 0;
        // 非对称缓动：进入跟随快(rate 12)，离开范围回正脸慢(rate 2.2) → 平滑延时回转，不瞬间弹回正视
        const enterRate = 12, leaveRate = 2.2;
        const rate = targetP > headPresence ? enterRate : leaveRate;
        headPresence += (targetP - headPresence) * (1 - Math.exp(-dt * rate));
        const desX = cu ? (cu.x || 0) * headPresence : 0;
        const desY = cu ? (cu.y || 0) * headPresence : 0;
        const kf = 1 - Math.exp(-dt * 14);                                    // 跟随平滑 ~0.07s（消除抖）
        followNDC.x += (desX - followNDC.x) * kf;
        followNDC.y += (desY - followNDC.y) * kf;
      }
      // 自动跳舞调度必须放在 if (vrm) 之外：PMX(MMD) 时 vrm 为 null，
      // 原先写在 vrm 块内导致 MMD 下根本不会调用 → “自动跳舞”只对手 VRM 生效。
      // 函数内部已按模型类型分派（VRM→vrmClips / PMX→mmdClips）。
      // 自动跳舞调度本身的异常也要兜住：否则一炸就是整帧渲染中断 → 画面卡死、跳舞不再推进
      updateDance(dt).catch(e => console.warn('[3D桌宠] 自动跳舞调度异常', e));
      if (vrm) {
        scheduleIdleMotion(dt).catch(e => console.warn('[3D桌宠] 待机动画调度异常', e));
        // 面板开着时每 ~1 秒重算一次取景：只用于"面板被拖动 / 内容变宽"这类缓慢变化。
        // 不去高频重算的原因：面板矩形自己会抖，算得越勤抖得越明显（实测"左右疯闪"）。
        // 拖动面板导致的滞后最多 1 秒，且目标有 2%/3px 死区 ⇒ 平时这一帧什么也不改。
        panelFitAcc += dt;
        if (panelFitAcc > 1.0) {
          panelFitAcc = 0;
          try { if (settingsOpen || modelPartsOpen || motFloatOpen || expFloatOpen || modelFloatOpen) fitCamera(); } catch (e) { }
        }
        // 实时姿势包络跟随（棘轮 + 慢衰减）：抬手/抬腿**立刻**收紧取景（手臂不出画），
        // 放下后以半衰期 ~4 秒回收（人物回到原大小）。变化超过 3% 才请求一次重取景（节流 250ms）⇒ 不抖。
        // ★★ 2026-10-14 修正（用户原话："怎么在跳着舞自动改变人物大小"）：
        //   跳舞/手势的四肢**每帧都在动** ⇒ 包络一路长大 ⇒ 相机被一路往后拉 ⇒ 看着就是"人物忽大忽小"。
        //   现在：**只要有动作在播，就完全不碰取景**（不收紧也不回收）—— 动作结束才恢复，
        //   届时包络自然缩回、人物回到原来大小。想恢复旧行为（动作中也实时收紧）：
        //   控制台执行 `petLiveEnvDuringMotion(true)`。
        liveEnvAcc += dt;
        if (liveEnvAcc > 0.15) {
          const leStep = liveEnvAcc; liveEnvAcc = 0;
          const motionPlaying = !!(currentMotionAction || gestureAction || dragAction || dancingNow);
          if (motionPlaying && !liveEnvDuringMotion) {
            /* 动作期间：取景冻结（这就是"跳舞时大小不再变"的开关） */
          } else {
            const le = embodiedLiveEnvelope();
            if (le) {
              const hw = (le.maxX - le.minX) * 0.5 * LIVE_ENV_PAD;
              const hh = (le.maxY - le.minY) * LIVE_ENV_PAD;
              const cx = (le.minX + le.maxX) * 0.5;
              if (!liveEnvOn) { liveEnvHalfW = hw; liveEnvH = hh; liveEnvCx = cx; liveEnvOn = true; }
              else {
                const d = Math.pow(0.5, leStep / 4);                       // 半衰期 4 秒
                const nw = Math.max(liveEnvHalfW * d, hw);                 // 先衰减、再被"当前值"托底 ⇒ 收敛无锯齿
                const nh = Math.max(liveEnvH * d, hh);
                const nc = liveEnvCx + (cx - liveEnvCx) * 0.25;
                const changed = Math.abs(nw - liveEnvHalfW) > liveEnvHalfW * 0.03 || Math.abs(nh - liveEnvH) > liveEnvH * 0.03;
                liveEnvHalfW = nw; liveEnvH = nh; liveEnvCx = nc;
                if (changed) {
                  const nowMs2 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
                  if (nowMs2 - liveEnvReframeT > 250) { liveEnvReframeT = nowMs2; try { reframe(); } catch (e2) { } }
                }
              }
            }
          }
        }
        // 呼吸/待机不再缩放整体、也不整体平移或旋转——那样看着就是"整块在 XY 方向晃"。
        // 改为在骨骼链上做：脊柱/胸轻微起伏 = 呼吸；骨盆侧倾 + 脊柱/胸/头反向补偿 = 重心转移。
        const s = lastOpts.scale || 1;
        vrm.scene.scale.set(s, s, s);
        // 眨眼：随机间隔自动眨一下（可关）
        if (blinkEnabled) {
          blinkT += dt;
          if (!blinking && blinkT > blinkNext) { blinking = true; blinkT = 0; }
          if (blinking) {
            const p = blinkT;
            if (p < 0.07) blinkVal = p / 0.07;
            else if (p < 0.17) blinkVal = 1 - (p - 0.07) / 0.10;
            else { blinkVal = 0; blinking = false; blinkT = 0; blinkNext = 2.5 + Math.random() * 3.5; }
            setExpr('blink', blinkVal);
          }
        } else if (blinkVal !== 0) { blinkVal = 0; setExpr('blink', 0); }
        tickRandomExpr(dt);      // 随机表情：待机时按间隔随机换脸
        applyBaseExpression();   // 静止表情：没在播动作时保持，播动作时让位
        applyEmbodiedExpression(dt);   // 具身表情（默认关：no-op）
        // 整体姿势变换（旋转/竖直偏移，让接触点贴窗口底边；在骨骼姿势前应用到 petRoot）
        if (petRoot) {
          const kr = 1 - Math.exp(-dt * 6);
          poseRootCur.rx += (poseRootTarget.rx - poseRootCur.rx) * kr;
          poseRootCur.ry += (poseRootTarget.ry - poseRootCur.ry) * kr;
          poseRootCur.rz += (poseRootTarget.rz - poseRootCur.rz) * kr;
          poseRootCur.y += (poseRootTarget.y - poseRootCur.y) * kr;
          // 接地初始化：待机姿态稳定后采样所有动作的最低脚，缓存接地偏移（只做一次）
          if (!groundInited) {
            groundInitT += dt;
            if (groundInitT > 0.5) initGrounding();
          }
          // 接地：让当前播放动作的最低接触点钉在“站立地面线”上，脚不悬空（跳舞不再像鱼扑腾）
          let groundOff = 0;
          const ga = currentMotionAction || gestureAction || dragAction;
          const gclip = ga && ga.getClip ? ga.getClip() : null;
          if (gclip) groundOff = getClipGroundOffset(gclip);
          // 播放动作/手势时，不再叠加待机整体上下浮动(poseRootCur.y)，否则脚会随呼吸忽沉忽浮、
          // 像地面在晃；只有纯待机时才保留轻微呼吸感。接地偏移已是常量，站立帧脚固定贴地面线。
          // 坐姿的下沉量（把胯降到落地线）必须无条件生效：
          // 站立时"有动作在播就清零整体位移"是为了让脚被动作的接地偏移钉住地面，
          // 但坐姿的位移是"坐下去"本身，被清零就会整个人弹起/掉下去 → 表现为"被种地里"。
          const rootY = (currentPose === 'sit') ? poseRootCur.y : ((ga ? 0 : poseRootCur.y) - groundOff);
          // 整体转身（具身动作的 turn）：叠加在姿势预设的 ry 之上 ⇒ "背过身去"这类大幅转身才成立。
          // 放在这里是有意的：petRoot 是所有接触点/取景的共同基准，转它 = 整个人（含脚）一起转。
          const turnYaw = applyEmbodiedTurn(dt);
          petRoot.rotation.set(poseRootCur.rx, poseRootCur.ry + turnYaw, poseRootCur.rz);
          petRoot.position.set(0, rootY, 0);
        }
        // 程序化姿势（待机微动 + 一次性小动作），在 vrm.update 之前设置骨骼基底。
        // 颈/胸/脊的追踪与头部慢摆都在 idleBoneOffset 里叠加（头由下面的视线目标驱动）。
        // 本循环每帧都跑（含跳舞时）作为骨骼基底；VRMA 的 mixer 在后面会覆盖它动画到的骨骼，
        // 没被动画到的骨骼就保持这里自然的静止姿态——这样绝不会退化成大字形人棍。
        if (vrm.humanoid) {
          const k = 1 - Math.exp(-dt * 6);
          for (const bn of POSE_BONES) {
            const bone = vrm.humanoid.getNormalizedBoneNode(bn);
            if (!bone || !boneRest[bn]) continue;
            const t = poseTarget[bn] || { x: 0, y: 0, z: 0 };
            const c = poseCurrent[bn] || (poseCurrent[bn] = { x: 0, y: 0, z: 0 });
            c.x += (t.x - c.x) * k; c.y += (t.y - c.y) * k; c.z += (t.z - c.z) * k;
            let rx = boneRest[bn].x + c.x;
            let ry = boneRest[bn].y + c.y;
            let rz = boneRest[bn].z + c.z;
            const io = idleBoneOffset(bn, it);
            if (io) { rx += io.x; ry += io.y; rz += io.z; }
            bone.rotation.set(rx, ry, rz);
          }
        }
        // 具身重定向中性基准：等基础姿态收敛（~0.4s）后采集一次。
        // 位置很关键：此刻基础姿态层已写入、而 mixer 还没跑 → 采到的才是“自然姿势”，不是 T-pose。
        if (embodiedNeedNeutral && vrm && vrm.humanoid) {
          embodiedNeutralT += dt;
          if (embodiedNeutralT >= 0.4) {
            // ★ 采集内容**只走 embodiedEnsureRest 这一条路**（它同时采位置类基准：骨盆朝向/髋窝/脚）。
            //   曾经的坑：这里自己复制了一份"只采四元数"的实现 → 位置基准永远为空 →
            //   髋窝钉位与根位移（下蹲）**静默失效**，症状就是"动胯时腿跟着骨盆转、脚一前一后地滑"，
            //   而且日志里毫无线索（因为补偿代码自己也没跑）。两份实现是这类 bug 的温床，合并成一份。
            embodiedReady = false;                      // 允许 embodiedEnsureRest 重新采（它在 ready 时直接返回）
            embodiedEnsureRest();
            embodiedNeedNeutral = !embodiedReady;       // 采失败（模型尚未就绪）就下帧再试，别把自己钉死
            if (embodiedReady)
              postLog('info', '具身动作中性基准已采集（' + Object.keys(embodiedRestQ).length + ' 骨，含位置基准）');
          }
        }
        // 头部/眼部 = 光标跟随 + 基础慢摆（两者叠加，幅度约 3~5°，看不出周期）：
        //   · 光标跟随：视线目标 = 相机位置 + 光标小幅偏移，偏移按 viewH 换算
        //     → 换姿势/换缩放的跟随角度一致（不然拉近后就成"翻白眼"）；
        //   · 基础慢摆：即使光标完全不动也持续微摆 → 头带着颈/胸/脊、头发（弹簧骨）一起小幅晃，
        //     这才是"活人感"；否则光标不在宠物上时它就是一具人棍。
        // 关键：头骨骼会被 vrm.update 里的 lookAt 覆盖，所以"头的晃动"必须走视线目标这条路，
        // 直接给 head 骨骼加偏移是无效的（这正是之前身体在动、头却钉死不动的原因）。
        // 头部视线目标 = 相机 + 阻尼后的光标偏移(followNDC，已含存在度与强度) + 基础慢摆。
        // followNDC 是平滑值：光标跳变/离场时头部是"缓动"而非一帧抽搐；离场后存在度归零 → 自然回正脸。
        if (lookTargetObj && camera) {
          // 视线目标偏移按“相机距离”放大（≈距离*0.7），而不是原来的 viewH*0.30（约0.6~1.1，太小）。
          // three-vrm 的 lookAt 只转头骨+眼睛（不靠整根骨骼硬扭），目标偏移太小时头只能转几度、还只有眼睛在动，
          // 于是看起来“不灵敏、方向对不上鼠标”；放大后整颗头能明显、准确地转向光标，手感对齐 PMX。
          const amp = Math.max(1.2, (camera.position.z || 6) * 0.7);
          const hk = (headTrack && !(danceDisableTrack && dancingNow)) ? Math.max(0, headTrackStrength) * bodyTurnFade() : 0;   // 舞蹈时(开关开)暂停头部跟随；整身转身后衰减
          const swx = 0, swy = 0;   // 待机改由 VRMA 动作驱动，去掉头部基础慢摆（原来的“晃”）
          // 情绪视线（度→世界偏移）：tan(角) 才是"看上去转了几度"的正确换算；
          // 只在头部跟随允许时叠加（用户关了头部追踪就别让表情偷转头）。
          const gazeK = (headTrack && !(danceDisableTrack && dancingNow)) ? 0.7 : 0;
          const gx = Math.tan(embGazeDeg.x * Math.PI / 180) * amp * gazeK;
          const gy = Math.tan(embGazeDeg.y * Math.PI / 180) * amp * gazeK;
          lookTargetObj.position.set(
            camera.position.x + followNDC.x * amp * hk + swx * amp * 0.16 + embExprLook.x * amp * 0.5 + gx,
            camera.position.y + followNDC.y * amp * 0.85 * hk + swy * amp * 0.07 + embExprLook.y * amp * 0.5 + gy,
            camera.position.z);
        }
        // three-vrm 官方推荐顺序：先让 mixer 把动画写到归一化骨骼，再 vrm.update 把归一化骨骼传导到原始骨骼（驱动蒙皮）。
        // 反过来的话原始骨骼会晚一帧才拿到动画值。
        if (vrmMixer) vrmMixer.update(dt);
        // 每帧开头清掉"其他层留下的状态"：骨盆增量/写标记必须只反映**本帧**的真实写入者，
        // 否则上一帧的值会让钉位/让位判定用到过期信息（曾导致 ardy 播放时腿被"钉"住）。
        // ★★ v11.33 版本戳：渲染循环第一次执行时打一行。以后"改了没生效？" 看这行就行 ——
        //   日志里没有这行 ⇒ 运行的是旧代码（需要真正重载：关掉桌宠窗口重开 / 重启插件）。
        // ★★ v11.34：改成**每 5 秒一条**（原来"只在首次打一次" —— 那一次若早于日志通道就绪就永远看不到，
        //   于是"有没有加载新代码"一直无法判断）。本行只要出现，就是"新代码在跑"的确证。
        if (!_verStamped) { _verStamped = true; postLog('info', '★ 前端代码版本 v11.33（含：接触自检心跳 / 具身异常探针 / 层冲突审计 / 放下实况）'); }
        if (typeof performance !== 'undefined' && performance.now() - _rtBeat > 5000) {
          _rtBeat = performance.now();
          postLog('info', '· 渲染心跳 v11.50（每 5s 一条；本行出现 ⇒ 新代码在跑｜具身接管=' + (!!embodiedYielding) + ' 队列=' + (embodiedQueue ? embodiedQueue.length : -1) + '｜生成层=' + (!!ardyActive) + '）');
        }
        // ★★ v11.36「动作实测」（放在所有具身层**之前** ⇒ 任何一层抛异常都杀不死它）。
        //   门控三连（缺一个就全是废数据，这三坑我都踩过）：
        //   ① v11.36：必须 `embodiedYielding`（本层真在拿骨骼）+ `!currentMotionAction`（有 VRMA 舞蹈时不报，
        //      否则采到的全是舞蹈姿势）；
        //   ② v11.38：**必须排除造型面板的 40s「保持预览」剪辑**（`!embodiedQueueIsHold`）——
        //      它也算"具身接管"，于是上一版日志里满屏「右肘 10°」= 手垂着的站立姿势，
        //      把敬礼那一条真数据淹没了（单日志 200+ 行废数据、只有 1 条肘 84° 有效）。
        //   ③ v11.39：**必须放在所有具身层之后**（见下方新位置）——
        //      放在层之前时读到的永远是"静止姿势"（骨骼每帧开头被清掉）⇒ 上一版日志里
        //      敬礼剪辑播了 64 帧、队列从 64 掉到 5，而"右肘"读数全程恒为 10°、手位置纹丝不动
        //      —— 全是假数据，白调了三轮参数。
        embodiedPelvicQ = null; embodiedWroteFrame = false; _embFingerDriven = false;
        applyEmbodiedRetarget(dt);          // 具身动作层（默认关：no-op）
        // ★★ v11.34b：这两层以前**没有** try —— 一旦抛异常，后面的 contactProbe / layerClashAudit /
        //   applyEmbodiedLegPin / syncSpringColliders **全部不执行**（症状：观测日志全无、腿钉位失效、
        //   弹簧碰撞球不更新）。现在各自隔离并上报，异常不再"静默吃掉半条渲染管线"。
        try { applyEmbodiedRoot(); } catch (e) {
          if (performance.now() - _embErrT > 3000) { _embErrT = performance.now(); postLog('info', '★ applyEmbodiedRoot 异常：' + (e && e.message ? e.message : e)); }
        }                // 根位移（下蹲）：每帧校正，让位时自动归零
        try { applyArdyRetarget(dt); } catch (e) {
          if (performance.now() - _embErrT > 3000) { _embErrT = performance.now(); postLog('info', '★ applyArdyRetarget 异常：' + (e && e.message ? e.message : e)); }
        }              // ardy 生成动作层（无队列时 no-op）
        contactProbe(dt);                   // ★ v11.24 接触自检（肘弯过 100° 时报"手距头多远/哪一侧偏"）
        layerClashAudit();                  // ★ v11.29 骨骼层冲突审计（动作播放中被别的层抢骨骼时点名）
        // ★ 放在最后一层之后：动胯时钉住髋窝。谁在我们之后又重置了骨骼位置，也得被它盖过。
        applyEmbodiedLegPin();              // 归一化层：保持内部一致（compose 语义 / 别的消费者读它）
        // ★★ v11.39「动作实测」—— 放在**所有具身层之后**（retarget/root/ardy/legPin 都写过骨了）
        //   ⇒ 读到的才是本帧真正摆出来的姿势（放前面读到的是静止姿势，数据全是假的）。
        //   门控：`embodiedYielding`（本层拿骨骼）+ `!currentMotionAction`（舞蹈时不报）
        //   + `!embodiedQueueIsHold`（排除造型面板 40s 保持预览，它会把日志刷爆）。
        if (embodiedYielding && !currentMotionAction && !embodiedQueueIsHold && typeof performance !== 'undefined'
          && vrm && vrm.humanoid && performance.now() - _saluteBeat > 250) {
          _saluteBeat = performance.now();
          try {
            const _hn = vrm.humanoid.getNormalizedBoneNode('rightHand');
            const _hd = vrm.humanoid.getNormalizedBoneNode('head');
            const _kn = vrm.humanoid.getNormalizedBoneNode('rightLowerArm');
            const _ua = vrm.humanoid.getNormalizedBoneNode('rightUpperArm');
            const _ll = vrm.humanoid.getNormalizedBoneNode('leftLowerLeg');
            const _rl = vrm.humanoid.getNormalizedBoneNode('rightLowerLeg');
            const _angOf = function (b) { return b ? (2 * Math.acos(Math.min(1, Math.abs(b.quaternion.w))) * 180 / Math.PI) : 0; };
            if (_hn && _hd) {
              const _p1 = _hn.getWorldPosition(new THREE.Vector3());
              const _p2 = _hd.getWorldPosition(new THREE.Vector3());
              postLog('info', '· 动作实测：右手距头中心 ' + _p1.distanceTo(_p2).toFixed(3) + 'm'
                + '｜dy=' + (_p1.y - _p2.y).toFixed(3) + '(正=手在头上方)'
                + ' dx=' + Math.abs(_p1.x - _p2.x).toFixed(3) + '(偏外)'
                + ' dz=' + (_p1.z - _p2.z).toFixed(3) + '(正=偏前)'
                + '｜右上臂 ' + (_ua ? _angOf(_ua) : 0).toFixed(0) + '° 右肘 ' + (_kn ? _angOf(_kn) : 0).toFixed(0) + '°'
                + '｜膝 左' + (_ll ? _angOf(_ll) : 0).toFixed(0) + '°/右' + (_rl ? _angOf(_rl) : 0).toFixed(0) + '°'
                + '｜队列=' + (embodiedQueue ? embodiedQueue.length : -1) + '帧');
            }
          } catch (_e) { }
        }
        syncSpringColliders();              // ★ 必须在 vrm.update 之前：让弹簧骨碰撞球跟上**当前**骨骼姿势
        // ★★ 2026-10-14 第四轮（用户："依旧有略微卡顿、不流畅丝滑"）：传给 VRM 的 dt **钳到 1/30 秒**。
        //   卡一帧时（ardy 后台预热抢 CPU 就是现场：日志那行 fps≈34、同帧弹簧骨跳 34°）原始 dt 可能
        //   0.1~0.25s，弹簧骨按它积分会大步猛跳、再被弹簧拉回 = 物理层面的"抽一下"。
        //   钳制后卡顿帧物理只走 33ms：视觉上最多"慢半拍"，不会抽。（只钳 VRM，不动动画/表情用的 dt）
        vrm.update(Math.min(dt, 1 / 30));
        // ★★ 「鼠标摸」保底：求解之后把光标球附近的弹簧骨**直接拨开**（借壳球在求解器里可能是空的，
        //    见 applyTouchPoke 注释）。必须放在**求解之后**：求解器每帧会把骨头四元数写成它算的绝对值，
        //    我们的偏移只有加在它后面才看得见。
        applyTouchPoke();
        // ★★ 必须放在 vrm.update 之后：把**原始骨骼**（蒙皮真正用的那套）的腿根也钉住。
        //    three-vrm 只把归一化骨骼的位置写给 hips，其余骨骼的位置不传导 —— 只在归一化层钉，画面上等于没钉。
        applyEmbodiedLegPinRaw();
        tickPoseJumpWatch(dt);              // 姿势"瞬跳"看门狗（自动抓抽搐现场，见函数注释）
        if (_embFingerDriven) thumbsCheck();   // 拇指方向核对（有手指骨被驱动时才量）
        ardyTraceSample('写入后');           // 采样点 2：本层写入之后 —— 交还的跳变只能在这里看到（采样点 1 在层入口）
        ardyAimCheck();                      // aim 落地校验：目标方向是否真的落到了骨骼上
        // 地面参考线（屏幕空间、固定不随角色动）：只投影“站立地面线”这个固定世界点。
        // 画成左右两段、中间留空——不盖在人物模型上（角色正下方不画线），两侧保留参考。
        if (groundLineL && groundLineR) {
          if (showGroundLine && groundInited) {
            const c = _gv3().set(0, restFootRelY, 0).project(camera);
            const W = renderer.domElement.clientWidth, H = renderer.domElement.clientHeight;
            const cx = (c.x * 0.5 + 0.5) * W, cy = (-c.y * 0.5 + 0.5) * H;
            const e = new THREE.Vector3(modelHalfWidth, restFootRelY, 0).project(camera);
            const ex = (e.x * 0.5 + 0.5) * W;
            const hwpx = Math.max(8, Math.abs(ex - cx));     // 模型半宽（屏幕像素，给下限防退化）
            const gapHalf = hwpx * 1.15;                     // 人物占用半宽 + 余量（中间留空，不盖模型）
            const sideLen = Math.max(30, hwpx * 0.9);        // 两侧参考线长度（至少 30px 看得清）
            groundLineL.style.left = (cx - gapHalf - sideLen) + 'px';
            groundLineL.style.top = cy + 'px';
            groundLineL.style.width = sideLen + 'px';
            groundLineL.classList.remove('hidden');
            groundLineR.style.left = (cx + gapHalf) + 'px';
            groundLineR.style.top = cy + 'px';
            groundLineR.style.width = sideLen + 'px';
            groundLineR.classList.remove('hidden');
          } else { groundLineL.classList.add('hidden'); groundLineR.classList.add('hidden'); }
        }
      }
      if (helper) { helper.update(dt); applyMMDTracking(); }
      renderer.render(scene, camera);
      capturePetMask(dt);            // 像素级命中遮罩：把模型轮廓上报给 C# 做穿透判定
      // ★ 慢帧看门狗（v11.6）：单帧 >50ms 就累计，卡顿段结束时记一条**带现场**的日志
      //   ⇒ 下次再说"卡"，日志里直接能看到"卡了多久、最慢多少 ms、当时在干什么"，不用再猜。
      try {
        const nowMs = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
        const frameMs = dt * 1000;
        if (frameMs > 50) { _slowN++; if (!_slowFrom) _slowFrom = nowMs; if (frameMs > _slowWorst) _slowWorst = frameMs; }
        else if (_slowN) {
          const span = nowMs - _slowFrom;
          if (nowMs - _slowLogT > 3000) {
            _slowLogT = nowMs;
            let panel = '';
            try { const p = document.getElementById('settings-panel'); panel = (p && !p.classList.contains('hidden')) ? '开' : '关'; } catch (e) { }
            const head = (_slowN === 1)
              ? ('慢帧：单帧 ' + _slowWorst.toFixed(0) + 'ms（一次性长任务）')
              : ('慢帧：近 ' + (span / 1000).toFixed(1) + 's 里有 ' + _slowN + ' 帧 >50ms（最慢 ' + _slowWorst.toFixed(0) + 'ms）');
            postLog('info', head + '｜触摸=' + (touchPhysicsOn ? (touchBallPos ? '摸着' : '待命') : '关')
              + '｜设置面板=' + panel + '｜物理=' + (vrmPhysicsOn ? '开' : '关') + '｜生成层=' + (ardyActive ? '在跑' : '闲'));
          }
          _slowN = 0; _slowWorst = 0; _slowFrom = 0;
        }
      } catch (e) { }
      } catch (e) {
        // three 0.160 的动画循环是"先跑回调、再申请下一帧"：本帧抛未捕获异常会导致
        // 下一帧不再申请 → 画面永久卡死（模型僵住）。这里兜住单帧异常并只打印一次，
        // 让渲染循环继续跑，避免"缩放/换姿势/播放动作后突然不动了"。
        if (!window.__deskpetLoopErr) { window.__deskpetLoopErr = true; console.error('[3D桌宠] 渲染循环异常（已兜住，循环继续）：', e); }
      }
    }
    renderer.setAnimationLoop(renderTick);
    // 隐藏（先躲起来/最小化/托盘隐藏）时暂停渲染循环：省 CPU/GPU；显示时恢复并丢弃隐藏期间 dt，动画不跳变。
    function setRenderPaused(paused) {
      if (!renderer) return;
      if (paused) { renderer.setAnimationLoop(null); }
      else { clock.getDelta(); renderer.setAnimationLoop(renderTick); }
    }
    document.addEventListener('visibilitychange', () => setRenderPaused(document.hidden));
    messageBus.on('pause', () => setRenderPaused(true));
    messageBus.on('resume', () => setRenderPaused(false));
    booted = true;
    postMessage({ type: 'booted' });
  } catch (e) {
    console.error('[3D桌宠] 初始化渲染器失败：', e);
  }
}
bootPromise = boot();

// 把十六进制颜色按"饱和度"倍数调整（1=原色，0=灰白，>1 更艳）
function satColor(hex, sat) {
  const c = new THREE.Color(hex || '#ffffff');
  if (sat === undefined || sat === null || Math.abs(sat - 1) < 1e-3) return c;
  const hsl = {}; c.getHSL(hsl);
  c.setHSL(hsl.h, Math.max(0, Math.min(1, hsl.s * sat)), hsl.l);
  return c;
}

// 光照：3 组氛围光(AMBI1/2/3，环境光/外部打光) + 全局灯光(关键光)，各自 强度/饱和度/颜色，可开关
function applyLighting(preset, intensity) {
  if (!scene) return;
  lights.forEach(l => scene.remove(l));
  lights = [];
  intensity = intensity || 1;
  // PMX/MMD 用 MeshToonMaterial：环境光占比过高会被"拍平"成灰蒙蒙，主光偏弱则没明暗。
  // 所以 MMD 下压低环境光、加强主光，并补一盏正面光，让 toon 的明暗层次出来（VRM 维持原平衡）。
  const isMMD = currentModelType === 'mmd';
  const ambScale = isMMD ? 0.4 : 1;   // MMD 环境光再压低：蓝调环境光是"发雾/不鲜艳"的主因
  const keyScale = isMMD ? 1.0 : 1;   // MMD 不再强制加亮：亮度完全交给"主光强度"滑块，用户自定义（之前 1.3 是隐藏倍率，拉滑块不跟手）

  if (lastOpts.enableAmbient !== false) {
    // 氛围光 1：基础环境光（主环境光）
    const c1 = satColor(lastOpts.lightAmbientColor || '#ffffff', lastOpts.ambientSaturation ?? 1);
    const a1 = new THREE.AmbientLight(c1, (lastOpts.lightAmbientIntensity ?? 1) * intensity * ambScale); scene.add(a1); lights.push(a1);
    // 氛围光 2：半球光（上亮下暗）。MMD 下去掉蓝调(降饱和度)，否则人物颜色发雾发灰
    const c2 = satColor(lastOpts.ambient2Color || '#dfe6ff', (lastOpts.ambient2Saturation ?? 1) * (isMMD ? 0.3 : 1));
    const hemi = new THREE.HemisphereLight(c2, new THREE.Color('#3a3a44'), (lastOpts.ambient2Intensity ?? 0.7) * intensity * ambScale);
    scene.add(hemi); lights.push(hemi);
    // 氛围光 3：冷色补光。MMD 下同样去蓝，避免蒙雾
    const c3 = satColor(lastOpts.ambient3Color || '#aab4ff', (lastOpts.ambient3Saturation ?? 1) * (isMMD ? 0.3 : 1));
    const a3 = new THREE.AmbientLight(c3, (lastOpts.ambient3Intensity ?? 0.35) * intensity * ambScale); scene.add(a3); lights.push(a3);
  }
  if (preset === 'flat') return; // 平光：只有氛围光
  if (lastOpts.enableKey !== false) {
    const keyColor = satColor(lastOpts.lightKeyColor || '#ffffff', lastOpts.keySaturation ?? 1);
    const keyI = (lastOpts.lightKeyIntensity ?? 1.1) * intensity * keyScale;
    // 全局灯光（关键光）
    const key = new THREE.DirectionalLight(keyColor, keyI);
    key.position.set(0.5, 1.2, 1.0); scene.add(key); lights.push(key);
    if (preset === 'soft') return; // 柔和：主光 + 氛围即可
    // studio：补光 + 轮廓光
    const fill = new THREE.DirectionalLight(keyColor, keyI * 0.35);
    fill.position.set(-1.0, 0.4, 0.6); scene.add(fill); lights.push(fill);
    const rim = new THREE.DirectionalLight(keyColor, keyI * 0.55);
    rim.position.set(0, 0.8, -1.2); scene.add(rim); lights.push(rim);
    if (isMMD) {
      // MMD 正面补光：从相机方向(+Z)打，保证脸/身体正面不被压进阴影（PMX 最缺的就是这盏"主体光"）
      const front = new THREE.DirectionalLight(keyColor, keyI * 0.3);
      front.position.set(0, 0.3, 1.2); scene.add(front); lights.push(front);
    }
  }
}

function applyBackground(bg) {
  if (!renderer) return;
  if (bg && /^[0-9a-fA-F]{6}$/.test(bg)) renderer.setClearColor(parseInt(bg, 16), 1);
  else renderer.setClearColor(0x000000, 0); // 透明
}

// 姿势骨骼偏移：从配置 JSON 解析为 { 姿势: { 骨骼: {x,y,z} } }
let poseOverrides = {};
function parsePoseOffsets(json) {
  // ★★ **原地更新**（清空 + 赋值），不要 `poseOverrides = {}` 整体换对象：
  //   任何已"抓住"它的引用（姿势微调滑条、姿势面板草稿）都必须继续指向同一份数据。
  //   整体替换的后果 = 那些引用写进孤儿对象 ⇒ 表现"滑条看着能调、人一动不动"（实测过一次）。
  for (const k in poseOverrides) delete poseOverrides[k];
  if (!json) return;
  try {
    const o = JSON.parse(json);
    if (o && typeof o === 'object') for (const k in o) poseOverrides[k] = o[k];
  } catch (e) { console.warn('姿势偏移解析失败', e); }
}

window.addEventListener('resize', () => {
  if (!renderer) return;
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  fitCamera();
  reportPetBounds();
});

// ---- 加载 ----
messageBus.on('load', (msg) => { loadModel(msg).catch(e => console.error('[3D桌宠] 加载异常', e)); });

async function loadModel(msg) {
  await bootPromise;
  invalidateNaturalSize();   // 换模型 → 自然尺寸缓存失效
  if (!booted || !THREE) { console.error('[3D桌宠] 引擎尚未就绪，无法加载模型'); return; }
  try {
    clearModel();
    lastOpts = Object.assign({}, lastOpts, msg.options || {});   // 合并而非整块替换：避免重载模型时把自动跳舞/追踪等开关冲掉
    currentModelType = msg.modelType || 'vrm';
    console.log('[3D桌宠] load: options.motions=' + ((lastOpts.motions || []).length) + ', msg.motions=' + ((msg.motions || []).length));
    applyIdleOpts(lastOpts);
    applyCustomPoses(lastOpts.customPoses);   // 用户摆好的造型 → 注册成可用预设
    applyLighting(lastOpts.lightingPreset || 'studio', lastOpts.lightingIntensity || 1);
    applyBackground(lastOpts.background || '');
    parsePoseOffsets(lastOpts.poseOffsets || '');
    rigHostLoad(lastOpts.rigProfile || '');        // ★ 宿主里的"按模型存档"（跨插件重载唯一可靠的那份）
    applyQuality();   // 套用画质(低/中/高)→像素比：加载选项里带的 quality 在此生效

    // ★ 换模型：记住 URL（"按模型存档"的键）并清掉内存缓存 —— 存档本身按模型分开，不会串。
    currentModelUrl = msg.url || '';
    rigProfileReset();
    if (msg.modelType === 'vrm') {
      await loadVRM(msg.url, lastOpts.motions || msg.motions || [], lastOpts);
    } else if (msg.modelType === 'mmd') {
      await loadMMD(msg.url, lastOpts.motions || msg.motions || [], lastOpts);
    }

    applyVrmPhysics(vrmPhysicsEnabled());   // 换模型/重载后套用「VRM 物理(弹簧骨)」开关（默认开）
    frameCamera(lastOpts.scale || 1, lastOpts.cameraDistance || 6);

    applyHiddenParts(lastOpts.hiddenParts || []);   // 恢复上次隐藏的模型部件
    // ★ 表情引擎：按**这个模型**的真实表情清单重建 AU→BlendShape 映射（换模型零配置）
    try { faceEngineOnModelLoaded(); } catch (e) { postLog('warn', '表情引擎装载失败：' + (e && e.message)); }
    postMessage({ type: 'model_info', expressions: collectExpressions(), motions: collectMotions(), parts: collectModelParts() });
    postMessage({ type: 'loaded' });
    // ★ 第 4 项：轴向自证（抬臂应向上 / 前摆应向前）—— 结论按模型存档，只在能自证时生效；
    //   跑在自检之前，这样自检与后续动作都吃同一份结论。
    setTimeout(() => { try { applyAutoAxisVerdict(false); } catch (e) { } }, 2200);
    stScheduleAuto('模型加载后');   // ★ 自动全量自检（默认开，可在「诊断」里关）⇒ 问题直接出现在日志里，不必人工逐个看
    // ★ 造型存档自动恢复（3.2s 后，等姿势/取景落定）：重载插件后不必打开面板就能回到上次摆好的姿势；
    //   草稿为空（你清空过）则只打一行日志说明，保持直立。
    setTimeout(() => { try { resumeStoredPose('模型加载后'); } catch (e) { } }, 3200);
    // 索取「动作人设」：重开窗口后手感也要能立刻恢复（宿主收到会把数值推回来）。
    // 用"前端主动要"而不是只靠宿主推，规避启动先后顺序问题。
    try { sendMenu('motion_idiom', { cmd: 'get' }); } catch (e) { }
    // 生成式动作后台预热（详见 scheduleArdyWarmup）：模型加载完成后 25 秒悄悄吃掉 684MB 冷启动
    scheduleArdyWarmup();
  } catch (err) {
    console.error('[3D桌宠] 模型加载失败:', err);
    postMessage({ type: 'loaded' });
  }
}

function clearModel() {
  // 换模型：弹簧骨基值缓存清掉（键是旧模型的 settings/shape 对象，留着只白占内存）。
  // 用 try 包住：这两个 const 声明在文件靠后的位置，万一将来有人把 clearModel 提前调用，
  // 这里只会静默跳过（TDZ 抛错可被 catch），不至于把"换模型"整个弄失败。
  try { _springJointBase.clear(); _springShapeBase.clear(); } catch (e) { }
  try { _vrmStyleBase = null; } catch (e) { }   // ★ v11.8：换模型 ⇒ 材质观感备份重采（新模型的材质不在旧 Map 里）
  try { applySpringScale._scaleAt = null; } catch (e) { }   // 换模型 ⇒ 下一次 applySpringScale 重设弹簧基准
  try { _petTriCount = -1; _rawHumanMap = null; _petLastPick = null; } catch (e) { }   // 换模型 ⇒ 面数/骨骼映射重算
  try { _springOrigUpdate = null; _springStepWrap = null; } catch (e) { }   // 弹簧骨包装重来（新 manager）
  _springPhysApplied = false;   // 换模型 ⇒ 允许下一次 applyVrmPhysics 真正重新应用一遍
  _chainMemFor = null; _chainMem = null;   // 弹簧骨链缓存同样失效（新模型的链不一样）
  // ★ 2026-10-14 第四轮：换模型时**必须**把「鼠标摸」的球摘掉 —— 它挂在**旧模型**各关节的
  //   `colliderGroups` 里，而 `ensureTouchCollider` 见 touchGroup 非空就直接 return true ⇒ 新模型的
  //   弹簧骨永远收不到球（表现："换了模型后摸不动了，日志也不报错"）。顺手把碰撞体体检状态复位。
  try { touchDropCollider(''); } catch (e) { }
  try { _springColliderChecked = false; _springColliderFast = true; } catch (e) { }
  try { _poseAxesLogged = false; } catch (e) { }   // 换模型 ⇒ 姿势轴向自检重新量、重新打
  try { _chanDirsDone = false; } catch (e) { }     // 换模型 ⇒ 通道方向核对也重来
  if (vrm) { if (petRoot) petRoot.remove(vrm.scene); else scene.remove(vrm.scene); vrm = null; }
  if (mmdMesh) { scene.remove(mmdMesh); mmdMesh = null; }
  if (petRoot) { scene.remove(petRoot); petRoot = null; }
  if (lookTargetObj) { scene.remove(lookTargetObj); lookTargetObj = null; }
  helper = null;
  mmdTrackNeutral = {}; mmdTrackState = {};   // 换模型清空 PMX 追踪基准/偏移，避免残留旧骨骼引用
  mmdArmBoneCache = {}; armDropWarned = false;   // 换模型清空手臂骨骼查找缓存，重新按新模型匹配
  lastMaskSig = '';                     // 换模型清空遮罩签名，强制重发新轮廓
  if (vrmMixer) { vrmMixer.stopAllAction(); vrmMixer = null; }
  vrmClips = {}; mmdClips = {}; dancingNow = false;
  expressionTimers.forEach(t => clearTimeout(t)); expressionTimers = [];
  motionTimers.forEach(t => clearTimeout(t)); motionTimers = [];
  naturalStandReady = false;   // 换模型后重新测量站立基准
}

// ---- 相机取景 ----
// 取景改为“固定窗口 + 自然度量(scale=1)”：
//   · 距离只由 scale=1 的自然包围盒决定，与窗口尺寸解耦 → 窗口不再随宠物收缩
//     （旧逻辑把窗口收紧贴合宠物，占比<1 时会收敛到 ~80px，就是"超级小一个"的根因）；
//   · "模型大小"(scale) 只改变屏幕占比，滚轮/滑条可实时放大缩小；
//   · 宠物最低点贴住窗口底边；坐/躺整体仍在窗口内，四周留白给右键菜单与设置面板。
const BASE_FILL = 0.62;   // scale=1、cameraDistance=6 时宠物约占窗口高度的比例

// 测量 scale=1 时的自然包围盒（临时把缩放归零再测，避免被逐帧贴合归一化掉）。
// 结果缓存：自然尺寸只与"模型 + 当前姿势"有关，与 scale 无关。
// 原实现每次滚轮都重测（切 scale + 两次 updateMatrixWorld + 全模型包围盒），
// 大模型上单次可达数十毫秒，高频滚轮会把主线程堵死 → 这里缓存，换模型/换姿势时失效。
let naturalSizeCache = null;
let lastFitBox = null;   // fitCamera 最近算出的包围盒，供 reportPetBounds 复用（省一次全模型测量）
function invalidateNaturalSize() { naturalSizeCache = null; }
function measureNatural() {
  if (naturalSizeCache) return naturalSizeCache;
  const ro = petRoot || (vrm ? vrm.scene : mmdMesh);
  if (!THREE || !ro) return null;
  const scaled = [];
  if (vrm) scaled.push(vrm.scene);
  if (mmdMesh) scaled.push(mmdMesh);
  const saved = scaled.map(o => o.scale.clone());
  scaled.forEach(o => o.scale.setScalar(1));
  ro.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(ro);
  scaled.forEach((o, i) => o.scale.copy(saved[i]));
  ro.updateMatrixWorld(true);
  if (box.isEmpty()) return null;
  naturalSizeCache = { size: box.getSize(new THREE.Vector3()) };
  return naturalSizeCache;
}

// 取景用的「最坏情况包络」系数 —— 这是"不调小人物就会被切掉"的根治办法。
// 为什么需要：包围盒是 `Box3.setFromObject` 量的，它按几何体的 **rest-pose** 算，
// **蒙皮变形不会进去** ⇒ 任何比静止姿势更高/更宽的动作都会超出它：
//   举手过头（更高）、展臂/劈叉（更宽）、蹲跪（更低 + 前后更长）、转身（进深变成宽度）。
// 以前只能靠用户手动把人物调小来避免被切；现在按包络留余量，任何姿势都在画内。
// 想紧凑看（接受偶尔切边）就把「相机·距离」或「大小」往回调，那是用户的自由。
// ★ 默认**不再预留静态包络**（这两项现在只在"实时姿势包络"不可用时兜底）：
//   实时包络（见 embodiedLiveEnvelope，按**当下**关节位置量）已经能保证抬手/抬腿/蹲跪不出画；
//   静态估算再叠一层，只会让人物白白变小（用户原话："取景余量调到 1 也比原来小很多，被连带了"）。
//   故取 1.00 = 观感等价于"没有静态包络"的旧行为；想额外留白用「取景余量」滑条（默认 1.06）。
const FIT_ENV_H = 1.00;   // 兜底：实时包络不可用时的高度包络
const FIT_ENV_W = 1.00;   // 兜底：实时包络不可用时的宽度包络
// ★ 实测包络（加载时按**该模型自己的骨架**算出，见 embodiedMeasureRig）：
//   拍脑袋的固定系数一定会在某些模型上被切（用户实测：开着 1.28，抬手依旧出画 —— 手臂偏长的模型
//   "肩高 + 臂长"轻松超过 1.28×身高）。所以和腿一样：**能实测的就不要写死**。
let envReachH = FIT_ENV_H, envReachW = FIT_ENV_W;
// 用户可调（面板「相机」区）= **在实测包络之上的额外余量**：1.00=刚好装下举手指尖，1.06=再留 6%；
// 调小开始切边（人物更大），调大更保险（更小）。
let fitEnvFactor = 1.06;
let fitPanelLogK = 0;          // 面板占宽导致的自动缩小倍数（只为日志去重，避免刷屏）
let fitAspect = 0;             // ★ "面板未开时"的宽高比：基础取景尺寸**只认它**，从而与画布加宽解耦
let fitBaseWinW = 0;           // 记录"面板未开"时的窗口宽度：用于判断当前窗口是否被面板加宽过
let fitLastWinW = -1;          // 上一次取景时的窗口宽度：宽度一变就"吸附"平移目标（消除逐帧爬行）
let fitPanelOpenSig = '';      // 面板取景诊断的签字（变才打日志）
let panelWidenReqT = 0;        // 上次"面板打开（即将请求加宽画布）"的时刻：宽限期内只平移、不缩人物
// 面板打开瞬间冻结的取景高度（姿势项 **和** 实时包络项）与当时的取景余量：面板开着时不再让姿势/包络改人物大小。
// ★ fitPanelLiveH = "实时包络那一项"的冻结值。只冻姿势项会漏掉 max 的另一半 ⇒ 人物被放大（见 fitCamera 里的注释）。
let fitPoseNeedH = 0, fitPoseNeedHMargin = 1, fitPanelLiveH = 0;
// ★ 面板自适应必须**绝对量算**，不能"量当前再改":
//   量当前相机 → 施加缩放/平移 → 下一帧量到的已经是改过的结果 → 两帧之间来回振荡
//   （实测症状：缩小百分比 13%↔3%、人物左右疯狂闪烁）。这里改成:测量值先折算回**基础取景**，
//   每次都由基础取景算目标值（不动点），再对"已应用的调整"做平滑逼近 + 死区 ⇒ 一次到位、不抖。
let panelK = 1, panelPan = 0;   // 当前已应用的面板缩放倍数 / 平移量（世界单位）
let panelFreeSmooth = 0;        // 可用宽度的低通值：面板矩形**自己会抖**（滚动条/换行/拖拽），
                                //   抖一次就改写目标 ⇒ 人物原地反复缩放（实测"左右疯闪"的第二个来源）
let panelFitAcc = 0;           // 面板打开期间的取景重算节流累加器
let fitDbgBox = null, fitDbgFree = null, fitDbgLast = '', fitDbgT = 0, _fitDbgV = null;  // 让位自检
let fitBuildLogged = false;    // 构建标记只打一次："跑的是不是新构建"这个坑已踩过两轮
let fitBaseSig = '', fitBaseT = 0;   // 基础取景自检（面板没开时也要能看出"人物为什么变小"）
let panelSpaceReq = -1;              // 已向宿主请求的"画布加宽"像素（0 = 未加宽）；只按状态变化发一次
// ---------------------------------------------------------------------------
// 实时"姿势包络"（取代加载时的静态包络 envReachH/W 作为取景依据）
//
// 为什么换：静态包络是**加载时量一次**的估算，在部分模型上量不准（实测"举手 1.01×身高/展臂 0.80×宽"），
// 而且它无法反映用户**当下**把手臂抬到哪 —— 于是"抬手被画布切掉 / 伸进面板被挡"和"为了留余量把人缩小"
// 同时成立（用户原话："被连带了，小了很多"）。
// 现在按**实时关节位置**取包络，并做"棘轮 + 慢衰减"：
//   · 变大（抬手/抬腿）→ **立刻**跟进并重取景 ⇒ 手臂永远不出画、不伸进面板；
//   · 变小（手放下）  → 以半衰期 ~4 秒缓慢回收 ⇒ 人物回到原大小，且不会一抖一抖。
let liveEnvHalfW = 0, liveEnvH = 0, liveEnvCx = 0, liveEnvOn = false;
// ★★ 「动作播放期间是否允许实时包络收紧取景」——默认**不允许**（= 跳舞时人物大小保持不变）。
//   用户 2026-10-14 实测："怎么在跳着舞自动改变人物大小"。
let liveEnvDuringMotion = false;
try { liveEnvDuringMotion = (localStorage.getItem('petLiveEnvDuringMotion') === '1'); } catch (e) { }
window.petLiveEnvDuringMotion = function (v) {
  liveEnvDuringMotion = !!v;
  try { localStorage.setItem('petLiveEnvDuringMotion', v ? '1' : '0'); } catch (e) { }
  return 'liveEnvDuringMotion=' + liveEnvDuringMotion + '（true = 动作播放期间也实时收紧取景）';
};
let liveEnvAcc = 0, liveEnvReframeT = 0, _liveEnvV = null;
const LIVE_ENV_PAD = 1.06;     // 关节包络外扩（含手掌/头发/裙摆等网格厚度）
function embodiedLiveEnvelope() {
  if (!vrm || !vrm.humanoid) return null;
  const names = ['head', 'hips', 'leftUpperArm', 'leftLowerArm', 'leftHand', 'rightUpperArm', 'rightLowerArm', 'rightHand',
    'leftUpperLeg', 'leftLowerLeg', 'leftFoot', 'rightUpperLeg', 'rightLowerLeg', 'rightFoot'];
  _liveEnvV = _liveEnvV || new THREE.Vector3();
  let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9, n = 0;
  for (const nm of names) {
    const node = (typeof embRawBone === 'function' ? embRawBone(nm) : null) || vrm.humanoid.getNormalizedBoneNode(nm);
    if (!node) continue;
    try { node.updateWorldMatrix(true, false); node.getWorldPosition(_liveEnvV); } catch (e) { continue; }
    if (!isFinite(_liveEnvV.x)) continue;
    minX = Math.min(minX, _liveEnvV.x); maxX = Math.max(maxX, _liveEnvV.x);
    minY = Math.min(minY, _liveEnvV.y); maxY = Math.max(maxY, _liveEnvV.y);
    n++;
  }
  return n >= 4 ? { minX, maxX, minY, maxY } : null;
}
function fitCamera() {
  if (!camera) return;
  // ★ 构建标记（每次启动只打一行）：判断"新构建到底有没有被加载"曾耗掉两轮排查
  //   （一次是采集路径打架导致静默失效，一次是窗口没重开）。有这行，一眼可判。
  if (!fitBuildLogged) {
    fitBuildLogged = true;
    // ★ 版本标记：**每次启动只打一行**，用来一眼确认"跑的是不是新构建"（这个坑已经耗掉两轮排查）。
    //   改到新构建时**记得改这里的版本号** —— 用户报"没效果"时，先看这行就能排除"根本没重载"。
    postLog('info', '前端构建：轴校 v11.3（★★ 修"鼠标碰撞球毫无作用"：不再猜字段名 —— 遍历关节自身/settings 上所有碰撞组列表（含 Set）逐个塞入我们的球，并把"塞进哪些列表"写进日志；审计新增探针：打印关节结构与"球是否真的在列表里"）');
  }
  const obj = petRoot || (vrm ? vrm.scene : mmdMesh);
  if (!obj) return;
  const nat = measureNatural();
  if (!nat) return;
  const box = new THREE.Box3().setFromObject(obj);   // 当前（含 scale + 姿势）实际包围盒，用于定位
  if (box.isEmpty()) return;
  lastFitBox = box;   // 复用给同帧的 reportPetBounds，避免重复全模型测量
  const center = box.getCenter(new THREE.Vector3());
  // ★ 取景**尺寸**必须与窗口宽度无关：面板打开时前端会请求宿主把画布加宽（panel_space），
  //   加宽 ⇒ aspect 变大；而基础取景里带 `× 1/aspect` 的横向项会随之变小 ⇒ 需要的高度变小 ⇒
  //   相机被拉近 ⇒ 人物**反被放大**（用户报的"占的画布少了就给我拉大"）。
  //   所以基础取景统一用"面板未开时"的 fitAspect；**只有** px↔世界 换算（visWidthWorld）用真实宽高比。
  const rawAspect = Math.max(0.2, window.innerWidth / window.innerHeight);
  const anyPanelOpen = !!(settingsOpen || modelPartsOpen || motFloatOpen || expFloatOpen || modelFloatOpen);
  // 只在"面板未开 且 窗口宽度已回到基准"时更新 fitAspect；否则面板加宽/还原的**过渡帧**
  // （面板标志已变、窗口还没缩回基准）会把基准污染成加宽后的宽高比 ⇒ 人物又被放大。
  const widened = fitBaseWinW > 0 && window.innerWidth > fitBaseWinW + 4;
  if ((!anyPanelOpen && !widened) || !(fitAspect > 0)) { fitAspect = rawAspect; fitBaseWinW = window.innerWidth; }
  const aspect = fitAspect;
  const fovR = camera.fov * Math.PI / 180;
  const tanHalf = Math.tan(fovR / 2);
  const zoom = 6 / Math.max(0.1, lastOpts.cameraDistance || 6);  // 4=拉近, 6=适配, 8=拉远
  // 距离只由自然包围盒决定 → 与窗口尺寸无关；scale 只改变屏幕占比
  // ★ 按**实测包络**算，而不是按 rest-pose 实际尺寸：这样举手/展臂/蹲跪/转身都不会被画布切掉。
  //   实测包络（envReachH/W）来自该模型自己的骨架；用户的「取景余量」是它之上的额外余量。
  // 余量上限放到 3.00：包络量测万一在某些模型上仍偏小，用户也能**自己**把手臂留进画内
  // （不必等改代码）。代价只是人物更小，随时可调回。
  const margin = Math.max(0.80, Math.min(3.00, isFinite(fitEnvFactor) ? fitEnvFactor : 1.06));
  const envH = Math.max(1.0, isFinite(envReachH) ? envReachH : FIT_ENV_H) * margin;
  const envW = Math.max(1.0, isFinite(envReachW) ? envReachW : FIT_ENV_W) * margin;
  // 取景高度 = 三者取最大：静态包络（加载时实测/兜底）、**实时姿势包络**（抬手/抬腿当下就要留出空间）。
  // 实时那一项是"抬手不再出画"的关键，也是"放下后能回到原大小"的关键（见 embodiedLiveEnvelope 的棘轮+衰减）。
  // 安全阀：实时包络最多只允许把取景推到"自身尺寸 ×1.6"。某个骨骼若取到异常坐标，
  // 包络会爆掉 ⇒ 人物永久变小、回不去（正是用户报的那个症状），这道限幅让它不可能发生。
  const liveCap = Math.max(nat.size.y, nat.size.x / aspect) * 1.6;
  // ★★ 面板打开时冻结取景高度（只保留用户量：取景余量 / 相机距离 / 大小 仍生效）。
  //   为什么：面板是给人"慢慢调"的，此时姿势一变、实时包络一动就改人物大小 ⇒ 用户看到的是
  //   "抽搐 + 被拉大"；更糟的是让位平移量 `visWidthWorld` 里含 V ⇒ V 一抖、平移目标跟着抖
  //   ⇒ "抽搐几下才挪到剩余区中间"。冻结后大小与平移都稳。对位仍用实时包络（见下面的 envBox）。
  const poseNeedNow = Math.max(nat.size.y * envH, nat.size.x * envW / aspect);
  // 实时包络项：**面板开着也照算**（它要参与"打开那一刻"的冻结值，见下）。旧代码在这里挂 `!anyPanelOpen`
  //   把它在面板打开时直接置 0 —— 这就是"打开设置面板人物突然放得很大"的病根（已修，别改回去）。
  const liveTerm = liveEnvOn
    ? Math.min(Math.max(liveEnvH, liveEnvHalfW * 2 / aspect), liveCap) : 0;
  let needH;
  if (anyPanelOpen) {
    // ★★ 冻结的必须是"打开那一刻的**整个**取景高度"：姿势项 **∪** 实时包络项，缺一不可。
    //   旧写法把实时项置 0 再取 max ⇒ needH 从 max(姿势,实时) 掉成 姿势；而取 max 只会变小、
    //   不会变大 ⇒ **面板一开，相机只可能被拉近 ⇒ 人物只可能被放大**（结构性地朝"变大"偏，不是偶发）。
    //   实测症状：一打开设置面板人物就"放的很大"，且一直保持到关面板（舞蹈/抬手时实时项更大、落差更明显）。
    //   现在两项一起冻、一起随「取景余量」等比缩放 ⇒ 面板开着时大小稳（不再抽搐）且**开关面板本身不改大小**；
    //   用户仍可用「取景余量」「距离」「大小」正常调，只是不再被姿势带着跳。
    if (!(fitPoseNeedH > 0)) {
      fitPoseNeedH = poseNeedNow; fitPoseNeedHMargin = margin; fitPanelLiveH = liveTerm;
      if (liveTerm > poseNeedNow * 1.01) {
        try { postLog('info', '面板打开冻结取景：姿势 ' + poseNeedNow.toFixed(2) + ' ／ 实时包络 ' + liveTerm.toFixed(2)
          + ' ⇒ 采用 ' + liveTerm.toFixed(2) + '（旧版会丢实时项，把人放大 ' + ((liveTerm / poseNeedNow - 1) * 100).toFixed(0) + '%）'); } catch (e) { }
      }
    }
    const kP = margin / fitPoseNeedHMargin;
    needH = Math.max(fitPoseNeedH * kP, fitPanelLiveH * kP);
  } else {
    fitPoseNeedH = 0; fitPanelLiveH = 0;
    needH = Math.max(poseNeedNow, liveTerm);
  }
  let r = (needH * 0.5 / tanHalf) / (zoom * BASE_FILL);
  let V = 2 * r * tanHalf;                // 模型平面上的可视高度
  viewH = V;                              // 供头部/眼部追踪换算偏移量（跟随角度与姿势/缩放无关）

  // 设置面板打开时：把宠物平移到面板另一侧空闲区域，避免面板挡住角色、看不到调整效果。
  // 做法为整体平移相机（连看向目标一起平移），宠物在屏幕上反向移动；渲染与鼠标穿透坐标都随之变化，无需改交互逻辑。
  let panX = 0;
  // 设置面板或“模型部件”浮层打开时，都把宠物平移到面板另一侧空闲区（两者都在右侧，故统一让到左边），
  // 避免面板挡住角色、看不到部件显隐调整效果（和设置面板同款行为）。
  const openPanels = [];
  if (settingsOpen && settingsEl && !settingsEl.classList.contains('hidden')) openPanels.push(settingsEl.getBoundingClientRect());
  if (modelPartsOpen && modelPartsEl && !modelPartsEl.classList.contains('hidden')) openPanels.push(modelPartsEl.getBoundingClientRect());
  if (motFloatOpen && motFloatEl && !motFloatEl.classList.contains('hidden')) openPanels.push(motFloatEl.getBoundingClientRect());
  if (expFloatOpen && expFloatEl && !expFloatEl.classList.contains('hidden')) openPanels.push(expFloatEl.getBoundingClientRect());
  if (modelFloatOpen && modelFloatEl && !modelFloatEl.classList.contains('hidden')) openPanels.push(modelFloatEl.getBoundingClientRect());
  if (openPanels.length) {
    const W = window.innerWidth;
    const pr = openPanels[openPanels.length - 1];   // 取最后一个（模型部件优先；二者同在右侧时结果一致）
    if (pr.width > 0 && pr.height > 0) {
      const panelOnRight = (pr.left + pr.right) / 2 > W / 2;
      const freeL = panelOnRight ? 0 : pr.right;
      const freeR = panelOnRight ? pr.left : W;
      // ★ 可用宽度先**低通**：面板的 getBoundingClientRect 会自己抖动（滚动条出现、内容换行、拖拽中），
      //   每抖一次都会改写目标 ⇒ 平滑逼近被迫重来 ⇒ 看上去就是"一直在缩、一直在晃"。低通吃掉这类噪声。
      const rawFreeW = Math.max(40, freeR - freeL);
      // ★ 窗口宽度刚变（面板加宽/还原是宿主的一次性 SetBounds）⇒ 直接**吸附**，不做低通；
      //   否则窗口已在变、低通还在慢慢追 ⇒ 目标一直在动 ⇒ 看上去就是"抽搐几帧挪到中间"。
      const winChanged = (window.innerWidth !== fitLastWinW);
      fitLastWinW = window.innerWidth;
      panelFreeSmooth = (!(panelFreeSmooth > 0) || winChanged) ? rawFreeW : panelFreeSmooth + (rawFreeW - panelFreeSmooth) * 0.25;
      const freeW = panelFreeSmooth;
      // ★ 用**实测**的"包络屏幕矩形"来避让（不再靠估算宽度 —— 估算的结果是"算出来够、眼睛看到被挡"）。
      //   做法：把"含抬手/展臂的包络盒"投到屏幕上拿到像素矩形，再据此
      //   ① 缩放：让它横向装进可用带宽；② 平移：让"包络中心"对齐可用区中心。
      //   （投影用的是当前相机，改动会在下一次 reframe 收敛；面板打开期间有 ~3Hz 的重算，所以会自己收敛。）
      // 让位用的包络 = 静态包络 ∪ **实时姿势包络**（含抬起的那只手臂，并按它的**实际中心**取 ——
      // 单臂伸向面板一侧时，这样才算得准：这正是"抬左手伸进面板被挡"的直接修复）。
      const staticX0 = center.x - nat.size.x * envW / 2, staticX1 = center.x + nat.size.x * envW / 2;
      const liveCapW = Math.max(nat.size.x, nat.size.y * aspect) * 0.8;      // 半宽上限
      const liveCapH = Math.max(nat.size.y, nat.size.x / aspect) * 1.6;
      const liveHW = Math.min(liveEnvHalfW, liveCapW), liveHH = Math.min(liveEnvH, liveCapH);
      const liveX0 = liveEnvOn ? (liveEnvCx - liveHW) : staticX0;
      const liveX1 = liveEnvOn ? (liveEnvCx + liveHW) : staticX1;
      const envBox = new THREE.Box3(
        new THREE.Vector3(Math.min(staticX0, liveX0), box.min.y, center.z - 0.45),
        new THREE.Vector3(Math.max(staticX1, liveX1), box.min.y + Math.max(nat.size.y * envH, liveEnvOn ? liveHH : 0), center.z + 0.45));
      const proj2 = (x, y, z) => {
        const p = new THREE.Vector3(x, y, z).project(camera);
        return { x: (p.x * 0.5 + 0.5) * W, y: (-p.y * 0.5 + 0.5) * window.innerHeight };
      };
      let e0 = 1e9, e1 = -1e9;
      for (const bx2 of [envBox.min.x, envBox.max.x]) for (const by2 of [envBox.min.y, envBox.max.y]) for (const bz2 of [envBox.min.z, envBox.max.z]) {
        const s = proj2(bx2, by2, bz2);
        e0 = Math.min(e0, s.x); e1 = Math.max(e1, s.x);
      }
      const envWpx = Math.max(1, e1 - e0);        // 包络横向占多少像素（含上次缩放的影响）
      // ① 扣掉上次缩放 ⇒ 得到"基础取景"下的包络宽度（投影宽度只受缩放影响，这一步是精确的）
      const Vbase = V, rbase = r;
      const baseEnvWpx = envWpx * Math.max(0.2, panelK);
      // 上限放到 2.6（≈缩到 38%）：面板占掉半个小窗口时，"真装得下"本来就需要缩这么多。
      // 原来卡在 1.35 的结果就是——算出来"该缩 2.4 倍"，却被截成 1.35，人物依旧压在面板下面
      // （现象：拖动面板时人物"跟着黏在面板后面"）。宁可小一点，也要真的看得见。
      // ★ 宽限期：面板刚打开、宿主"加宽画布"还没落地的那几帧里**先别缩人物**（只平移）。
      //   加宽是一次性 SetBounds，落地后可用宽 freeW 变大 ⇒ 正常逻辑本就会算回 K=1；
      //   宽限期只是把"先缩一下、再长回来"的那一帧闪动吃掉。
      //   若宿主加宽失败（窗口宽度没变），宽限期一过就**恢复原有的缩小避让兜底** —— 不影响其它场景。
      const nowP = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
      const widenGrace = panelWidenReqT > 0 && (nowP - panelWidenReqT) < 600;
      const kTarget = widenGrace ? 1 : Math.max(1, Math.min(2.6, baseEnvWpx / (freeW * 0.92)));
      // ② 中心**不测量**：基础取景下人物中心恒在屏幕中心（相机与看向目标被 panX 一起平移），
      //    所以"把中心对到可用区中心"可以解析求出。上一版还在晃就是坏在"去测中心"——
      //    测出来的中心已含上次的平移，等于把反馈又接了回去。
      const freeCx = (freeL + freeR) / 2;
      const visWidthWorld = Math.max(1e-6, Vbase * kTarget * rawAspect);   // 模型平面上的可视宽度（世界单位）—— 此处必须用**真实**宽高比做 px↔世界 换算
      const panTarget = -((freeCx - W / 2) / W) * visWidthWorld;
      // ③ 平滑逼近 + 死区（3px 以内不动）
      // ★★ px → 世界 的换算**别写反**（在你这台机器上踩得很实，症状极隐蔽）：
      //    正确：世界 = px × 可视宽 ÷ 窗宽；我上一版写成了 `3 × 窗宽 ÷ 可视宽`（倒数）。
      //    后果：panDead ≈ 490 世界单位 ≫ panTarget ≈ 0.83 ⇒ **每一次都判定"无需移动"** ⇒
      //    平移永不执行 —— 而缩放那条没有死区，于是"缩放生效、平移从来不生效"，
      //    人物始终待在屏幕正中，正好被面板压住（日志里宽度 164→148 ✓、中心恒为 210 ✗ 就是它）。
      const panDead = 3 * visWidthWorld / W;
      fitDbgBox = envBox; fitDbgFree = [freeL, freeR];   // 让位自检：最终投影在函数末尾统一打
      if (winChanged) {
        // 窗口刚变宽/还原 ⇒ **一次吸附**到目标。否则靠"1 秒一次重算 + 0.5 平滑"要爬好几秒，
        // 用户看到的就是"抽搐几帧、一点点挪到剩余空间中间"。
        panelK = kTarget; panelPan = panTarget;
      } else {
        panelK = (Math.abs(kTarget - panelK) < 0.02) ? panelK : panelK + (kTarget - panelK) * 0.5;
        panelPan = (Math.abs(panTarget - panelPan) < panDead) ? panelPan : panelPan + (panTarget - panelPan) * 0.5;
      }
      if (panelK > 1.002) {
        V = Vbase * panelK; r = rbase * panelK; viewH = V;          // 缩人物，换"抬手也完整"
        if (Math.abs(panelK - fitPanelLogK) > 0.05) {
          fitPanelLogK = panelK;
          postLog('info', '面板占宽 → 人物自动缩小 ' + ((panelK - 1) * 100).toFixed(0)
            + '%（包络实测 ' + Math.round(baseEnvWpx) + 'px ＞ 可用 ' + Math.round(freeW * 0.92) + 'px）');
        }
      } else fitPanelLogK = 0;
      panX = panelPan;
    }
  } else { panelK = 1; panelPan = 0; panelFreeSmooth = 0; fitDbgBox = null; fitDbgFree = null; }   // 面板关掉 ⇒ 清除调整（下次取景即恢复原状）

  // ---- 面板取景诊断（数值变才打）：一次性回答"面板开着时人物到底为什么变大/变小" ----
  //   窗(W×H) 决定 rawAspect；fitAspect 是取景实际用的基准；needH 是"需要的高度"；V 是可视高；K 是面板缩放倍率。
  if (anyPanelOpen) {
    const sigP = window.innerWidth + 'x' + window.innerHeight + '|fit' + fitAspect.toFixed(2)
      + '|V' + V.toFixed(1) + '|K' + panelK.toFixed(2) + '|pan' + panelPan.toFixed(1);
    if (sigP !== fitPanelOpenSig) { fitPanelOpenSig = sigP; postLog('info', '面板取景：' + sigP); }
  } else fitPanelOpenSig = '';

  // ★ 面板打开时**请求宿主把画布加宽**（用户要求："不如老老实实搞画布自动扩大"）：
  //   加宽后面板占新空间、人物保持原大 —— 不再靠缩小人物去避让（那样"太小了费眼看不清"）。
  //   只按状态变化发一次；宿主不支持时它会失败并记日志，此时下面的让位/缩小逻辑照常兜底（双保险）。
  {
    let wantPx = 0, panSide = 'right';
    for (const rr of openPanels) {
      wantPx = Math.max(wantPx, rr.width);
      // 面板在窗口哪一侧 ⇒ 画布只**朝那一侧**扩（对称扩没必要：那样窗口会向两侧各长一半，
      // 用户要的是"人物能完全站开就行"）。侧别由前端算，宿主照做。
      panSide = ((rr.left + rr.right) / 2 > window.innerWidth / 2) ? 'right' : 'left';
    }
    wantPx = wantPx > 0 ? Math.round(wantPx + 24) : 0;
    if (wantPx !== panelSpaceReq) {
      panelSpaceReq = wantPx;
      // extra 用**字符串**发：宿主那侧的其它设置也都走字符串（value: String(v)），
      // 用数字时实测被解析成了 0 —— 日志里表现为"面板加宽画布：706 → 706px"（等于没加）。
      try { sendMenu('panel_space', { extra: String(wantPx), open: wantPx > 0 ? '1' : '0', side: panSide }); } catch (e) { }
      try { postLog('info', '面板加宽请求：' + wantPx + 'px（朝' + panSide + '扩；0 = 请求还原）'); } catch (e2) { }
    }
  }

  const yaw = (lastOpts.cameraYaw || 0) * Math.PI / 180;
  // 面板让位的平移必须沿**相机的右方向**施加（不能只用世界 X）：相机一旦带偏航角（含"翻转朝向"180°），
  // 世界 X 就变成"离人物的远近"而不是"屏幕左右" ⇒ 平移被吃进深度、画面上毫无变化。
  // 右方向 = (cos yaw, 0, −sin yaw)：yaw=0 → +X ✓；yaw=180° → −X（翻转后仍指向"屏幕右"）✓。
  const panWx = panX * Math.cos(yaw), panWz = -panX * Math.sin(yaw);
  // 坐姿半身取景：平视、正脸对着观众（pitch=0，不再为看大腿而俯视）。
  // 用户的"俯仰"滑条仍然叠加在这个基础值上，想微微俯视自己拖。
  const sitPitch = 0;
  const pitch = (lastOpts.cameraPitch || 0) * Math.PI / 180 + sitPitch;
  const heightOff = lastOpts.cameraHeight || 0;
  // 底部留白：原先把模型最低点正好压在窗口底边（零边距），脚会被裁掉看不见。
  // 把取景中心往上抬一点，让脚与底边之间留出一段，脚就能完整露出来。
  // 蹲/跪期间临时加大底部留白：人沉下去时小腿/脚正处在最低处，不留白就会被窗口底边切掉。
  const bmBase = (fitBottomMarginOverride != null) ? fitBottomMarginOverride : +(lastOpts.bottomMargin ?? 0.07);
  const bottomMargin = V * Math.max(0, Math.min(0.25, bmBase));
  let camY0 = box.min.y + V * 0.5 - bottomMargin;
  // 坐姿只保留"上半身"：这个坐姿的腿结构本身就不自然（大腿被透视压扁、小腿外翻扭曲），
  // 与其硬修不如直接切掉不看 —— 取景区间 = "胯下方一点"到"头顶上方一点"，
  // 窗口底边正好落在下切线上；落座到任务栏时腿自动留在任务栏下方（看不见）。
  sitHalfBottomY = null;
  if (currentPose === 'sit') {
    // 取景只用"站立基准"里与当前姿势无关的量（captureNaturalStand 实测的 胯高/身高）。
    // 【绝不能再用实时包围盒 box】—— setPose 里的 reframe() 是在姿势插值还没到位时调用的，
    // 那一瞬间 box 还是站立/过渡姿态，于是：
    //   · 区间高度被算成"站立身高" → 相机距离算小 → 表现为"吸附到任务栏突然爆放大"；
    //   · 下切线落到脚踝附近 → 窗口底边切在脖子处 → 表现为"只露出来个头"。
    // 站立基准与姿势无关，所以坐姿取景在任何时机调用都得到同一个结果。
    const SIT_FILL = 0.66;   // 上半身占窗口高度的比例（与站立 BASE_FILL 同量级，切姿势不会"突然变大"）
    const s = Math.max(0.01, lastOpts.scale || 1);
    let botY, keepH;
    if (naturalStandReady && naturalHeight > 0.05) {
      const hipH1 = Math.max(0.02, naturalHipY - naturalFloorY);   // scale=1：胯 → 脚底
      const upH1 = Math.max(0.05, naturalHeight - hipH1);          // scale=1：胯 → 头顶（≈ 上半身长度）
      // 下切线（世界坐标）：下沉后胯部正好落在 modelFloorY，再往下压 6% 把大腿根一起裁掉
      botY = modelFloorY - upH1 * 0.06 * s;
      // 相机距离用 scale=1 的区间高度算 → 与"大小/滚轮"解耦，滚轮放大就是真的变大
      keepH = upH1 * 1.10;
    } else {
      // 兜底（没有 VRM 站立基准时）：退回实时包围盒，只取上半段
      const sh = Math.max(0.05, box.max.y - box.min.y);
      botY = box.min.y + sh * 0.05;
      keepH = Math.max(0.05, box.max.y - botY);
    }
    sitHalfBottomY = botY;
    const fill = Math.max(0.2, Math.min(1.0, zoom * SIT_FILL));   // 上半身占窗口高度的比例
    V = keepH / fill;
    r = V / (2 * tanHalf);
    viewH = V;
    camY0 = botY + V * 0.5;      // 下切线对齐窗口底边 → 腿整条落在窗口下方（看不见）
  }
  if (currentPose === 'lieback') {
    // 仰躺：强制一定俯角避免"看裙底"，仍可偏航/升降
    const lp = Math.max(pitch, 0.9);
    const cp = Math.cos(lp), sp = Math.sin(lp);
    camera.position.set(
      center.x + panWx + r * Math.sin(yaw) * cp,
      box.min.y + V * 0.2 + r * sp + heightOff,
      center.z + panWz + r * Math.cos(yaw) * cp);
    camera.lookAt(center.x + panWx, box.min.y + V * 0.2, center.z + panWz);
  } else {
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    camera.position.set(
      center.x + panWx + r * Math.sin(yaw) * cp,
      camY0 + r * sp + heightOff,
      center.z + panWz + r * Math.cos(yaw) * cp);
    camera.lookAt(center.x + panWx, camY0, center.z + panWz);
  }
  camera.updateProjectionMatrix();

  // ---- 基础取景自检（面板没开时也要看得见）----
  // 为什么需要：用户报"关掉界面人物依旧小了很多、回不去"，而所有取景日志都只在面板打开时打 ⇒ 无从判断。
  // 这行把"决定人物大小的三个量"直接摊开：余量、静态包络、实时包络（+ 可视高）。
  //   余量 ≠ 1.00   ⇒ 就是它把小了（滑条是本地设置，重开窗口才回默认 1.06）
  //   静态包络 > 1  ⇒ 旧版的静态预留还在占地方（新版默认 1.00）
  //   实时包络偏大  ⇒ 刚抬过手/腿，正在 4 秒半衰期里回收（属正常）
  if (!fitDbgBox) {
    const nowT2 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    if (nowT2 - fitBaseT > 2000) {
      fitBaseT = nowT2;
      const sig2 = fitEnvFactor.toFixed(2) + '/' + envReachH.toFixed(2) + '/' + envReachW.toFixed(2) + '/'
        + liveEnvHalfW.toFixed(2) + '/' + liveEnvH.toFixed(2) + '/' + V.toFixed(2) + '/'
        + (lastOpts.cameraDistance || 6) + '/' + (lastOpts.scale || 1);
      if (sig2 !== fitBaseSig) {
        fitBaseSig = sig2;
        // 把"决定人物大小"的三个用户量也打出来：距离(zoom)、大小(scale)、取景余量。
        // 踩过一次：距离被拉到 9（zoom 0.66）⇒ 人物只占窗口高 ~41%，却一直以为是"包络/让位"把人物压小了。
        postLog('info', '取景自检（面板未开）：距离 ' + (+(lastOpts.cameraDistance || 6)).toFixed(1)
          + '｜大小 ' + (+(lastOpts.scale || 1)).toFixed(2)
          + '｜余量 ' + fitEnvFactor.toFixed(2)
          + '｜静态包络 ' + envReachH.toFixed(2) + '×身高/' + envReachW.toFixed(2) + '×宽'
          + '｜实时 ±' + liveEnvHalfW.toFixed(2) + '/高 ' + liveEnvH.toFixed(2)
          + '｜可视高 ' + V.toFixed(2) + '（窗 ' + window.innerWidth + '×' + window.innerHeight + '）');
      }
    }
  }

  // ---- 让位自检（节流 1 秒 + 结果变化才打）----
  // 为什么非要有这条：面板让位"到底有没有生效"非常容易三个人三种看法（数字 / 眼睛 / 坐标系）。
  // 这条只回答一个问题：**把最终画出来的包络矩形投到屏幕上，它有没有整块落进可用区**。
  // 落在里面 ⇒ 数学上确实让开了，你还能看到被挡就是别的原因（窗口/坐标系），一次定位。
  if (fitDbgBox && fitDbgFree) {
    const nowT = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    if (nowT - fitDbgT > 1000) {
      fitDbgT = nowT;
      camera.updateMatrixWorld();
      _fitDbgV = _fitDbgV || new THREE.Vector3();
      let f0 = 1e9, f1 = -1e9;
      for (const bx2 of [fitDbgBox.min.x, fitDbgBox.max.x]) for (const by2 of [fitDbgBox.min.y, fitDbgBox.max.y]) for (const bz2 of [fitDbgBox.min.z, fitDbgBox.max.z]) {
        _fitDbgV.set(bx2, by2, bz2).project(camera);
        const px = (_fitDbgV.x * 0.5 + 0.5) * window.innerWidth;
        f0 = Math.min(f0, px); f1 = Math.max(f1, px);
      }
      const sig = Math.round(f0) + '/' + Math.round(f1) + '/' + Math.round(fitDbgFree[0]) + '/' + Math.round(fitDbgFree[1]);
      if (sig !== fitDbgLast) {
        fitDbgLast = sig;
        const inside = f0 >= fitDbgFree[0] - 2 && f1 <= fitDbgFree[1] + 2;
        postLog('info', '让位自检：人物包络 屏幕[' + Math.round(f0) + '..' + Math.round(f1) + ']｜可用区['
          + Math.round(fitDbgFree[0]) + '..' + Math.round(fitDbgFree[1]) + '] ⇒ ' + (inside ? '已完全让开 ✓' : '⚠ 未完全让开')
          + '（窗宽 ' + window.innerWidth + '｜自动缩放 ' + ((panelK - 1) * 100).toFixed(0) + '%｜平移量 '
          + (panX).toFixed(3) + ' 世界单位 ≈ ' + (-panX * window.innerHeight / Math.max(1e-6, V)).toFixed(0) + 'px'
          // 包络也打进每一行：日志开头（含"取景包络实测"那行）常被截掉，有它就能就地判断包络是否合理
          + '｜包络 ' + envReachH.toFixed(2) + '×身高/' + envReachW.toFixed(2) + '×宽·余量 ' + fitEnvFactor.toFixed(2)
          + '｜实时 ±' + liveEnvHalfW.toFixed(2) + '/高 ' + liveEnvH.toFixed(2) + '）');
      }
    }
  }
}

// 站立基准（scale=1 下测量一次并缓存）：坐姿下沉、落座接触线都以它为基准，换大小不会算歪
let naturalFloorY = 0, naturalHipY = 0, naturalHeight = 1, naturalStandReady = false;
function captureNaturalStand() {
  if (!vrm || naturalStandReady) return;
  try {
    const objs = [vrm.scene, mmdMesh].filter(Boolean);
    const saved = objs.map(o => o.scale.clone());
    objs.forEach(o => o.scale.setScalar(1));
    vrm.scene.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(vrm.scene);
    const hip = vrm.humanoid?.getNormalizedBoneNode('hips');
    const hp = new THREE.Vector3();
    if (hip) hip.getWorldPosition(hp);
    naturalFloorY = box.min.y;
    naturalHeight = box.getSize(new THREE.Vector3()).y || 1;
    naturalHipY = hip ? hp.y : naturalFloorY;
    objs.forEach((o, i) => o.scale.copy(saved[i]));
    vrm.scene.updateMatrixWorld(true);
    naturalStandReady = true;
  } catch (e) { console.warn('站立基准测量失败', e); }
}

// ---- 弹簧骨（头发/裙摆）随“大小”做等比补偿 ----
// three-vrm 的弹簧骨在**世界空间**里算：骨长 `_worldSpaceBoneLength` 由世界矩阵位置差得出 → 会随 vrm.scene.scale 一起变小；
// 但 settings 里的 stiffness / gravityPower / hitRadius 与碰撞球 shape.radius 是**绝对世界量、不随缩放变**
// （源码里除调试线框外，没有任何 worldScale 补偿）。于是模型放小（scale<1）时，这些量相对骨长被放大 →
// ① 腿部/身体的碰撞球相对巨大，把裙子**顶出去**（看起来“反重力/外炸”）；② 弹簧项盖过惯性 → 变成**刚性、卡住贴不回去**。
// 放大则相反（变软变飘）。这里按 scale 等比补偿，恢复缩放不变性（手感与 s=1 时一致）。
const _springJointBase = new Map();   // settings 对象 → {stiffness, gravityPower, hitRadius}（首次=作者值，即 scale=1）
const _springShapeBase = new Map();   // 碰撞 shape → radius（作者值）
let _springScaleWarned = false;
// ★ 改成"**逐个对象惰性记录**基值"，不再用一个全局 `_springBaseReady` 开关：
//   那个开关一旦置 true 就永不复位 ⇒ 会话里**换过一次模型之后**，新模型的 settings/shape 对象不在 map 里
//   ⇒ 补偿**静默失效**（碰撞球相对模型偏小、弹簧偏软 → 做动作更容易穿模）。惰性记录对每个对象只记一次
//   ⇒ 换模型 / 重载模型都自动正确，也不依赖谁记得复位（clearModel 里仍会清一次，纯粹为省内存）。
function _springCaptureJoint(st) {
  if (!st || _springJointBase.has(st)) return;
  // dragForce 也一起记：逐链「冻结」时把它拉满（吃掉惯性），解冻时要按作者原值还原
  _springJointBase.set(st, {
    stiffness: st.stiffness, gravityPower: st.gravityPower,
    hitRadius: st.hitRadius, dragForce: st.dragForce,
  });
}
function _springCaptureShape(sh) {
  if (!sh || typeof sh.radius !== 'number' || _springShapeBase.has(sh)) return;
  _springShapeBase.set(sh, sh.radius);
}
// ---- 「物理·碰撞体积」倍率（防穿模的**唯一直接旋钮**）----
// 为什么是旋钮而不是我写死一个值：日志已证明 ①物理**在跑**（瞬跳看门狗抓到头发单帧摆过 175°）、
//   ②碰撞矩阵**同步**（445/445，偏差 0.000）⇒ "穿模"只剩一种可能：**碰撞覆盖不足**
//   （腿/身体动得快，而碰撞体相对腿偏小）—— 这取决于模型数据 + 取景大小 + 动作幅度，
//   算不出唯一正确值，只能按手感调。所以给用户一个 ×0.5~×3 的旋钮（默认 1.0 = 模型原值）。
// 只放大 **hitRadius（关节半径）+ 碰撞体半径**，**不动** stiffness / gravityPower（那改的是软硬/垂感）。
function springHitScale() {
  try { const v = +(localStorage.getItem('petSpringHitScale') || '1'); return (v >= 0.5 && v <= 3) ? v : 1; } catch (e) { return 1; }
}
function setSpringHitScale(v) {
  try { localStorage.setItem('petSpringHitScale', String(v)); } catch (e) { }
}
// ---- ★★ 2026-10-14 拆分（用户实测：把旧旋钮推到 2.3 后**头发被撑炸**）----
// 旧实现把这**一个倍率同时乘到**"关节粗细(hitRadius)"和"所有碰撞体半径"⇒
//   ①头发关节变粗 ⇒ 发丝互相顶开；②头/身体碰撞体变大 ⇒ 头发被推离头 ⇒ 炸毛。
// 而"防穿模"真正需要放大的只是**躯干/腿上的碰撞体**（裙子/衣服被腿穿过，靠它们撑开）。
// 所以拆成两个，各管一件事：
//   · 碰撞体(治裙摆/衣服穿腿)：**只放大挂在躯干/腿骨上的碰撞体**（头/发上的保持原值 ⇒ 不会炸毛）
//   · 发丝粗细(治发丝互穿)：只动 hitRadius，默认 1.0（推大了就会炸毛，面板已写明）
// 迁移：老键 `petSpringHitScale` 的值搬到"碰撞体"（用户之前调的就是它），发丝回到 1.0。
function springVolumeScale() {
  try {
    if (localStorage.getItem('petSpringHitScaleMigrated') !== '1') {
      const old = +(localStorage.getItem('petSpringHitScale') || '');
      // ★ 旧值**夹到 ≤1.6**：用户实测 2.3 就把头发撑炸了（而且还会再叠上模型缩放 1.64 ⇒ 实际 ≈3.8×）。
      //   宁可保守（想更大自己再推），也不要一开面板就炸毛。
      const mv = (isFinite(old) && old > 0) ? Math.min(1.6, old) : 1;
      localStorage.setItem('petSpringVolumeScale', String(mv));
      localStorage.setItem('petSpringHitScale', '1');
      localStorage.setItem('petSpringHitScaleMigrated', '1');
      try {
        postLog('info', '弹簧骨旋钮已拆分：老的「碰撞体积 ×' + (isFinite(old) && old > 0 ? old : 1) + '」已搬到'
          + '「碰撞体(治裙摆穿腿)」' + (mv !== old && isFinite(old) && old > 0 ? ('，并**自动夹到 ×' + mv + '**（>1.6 会把头发/衣服明显顶开）') : '')
          + '；「发丝粗细」回到 ×1.0（旧版把两者一起乘上，才会炸毛）');
      } catch (e) { }
    }
    const v = +(localStorage.getItem('petSpringVolumeScale') || '1');
    return (v >= 0.5 && v <= 3) ? v : 1;
  } catch (e) { return 1; }
}
function setSpringVolumeScale(v) { try { localStorage.setItem('petSpringVolumeScale', String(v)); } catch (e) { } }
// 躯干/腿的骨名（中日英混排都认）：碰撞体挂在骨上，据此判断"该不该吃防穿模倍率"
const SPRING_BODY_BONE = /(Leg|Foot|Toe|Hips|Thigh|Knee|Ankle|Spine|Chest|腿|脚|足|股|膝|腰|胸|体)/i;
function _springColliderIsBody(c) {
  let o = c;
  for (let i = 0; i < 6 && o; i++) {
    const n = String(o.name || '');
    if (n && SPRING_BODY_BONE.test(n)) return true;
    o = o.parent;
  }
  return false;
}
function applySpringScale(s) {
  if (!vrm || !vrm.springBoneManager) return;
  const m = vrm.springBoneManager;
  try {
    const kv = springVolumeScale();   // ★ 防穿模：**只**作用于躯干/腿的碰撞体（头/发上的一律不动 ⇒ 不会炸毛）
    const kh = springHitScale();      // ★ 发丝粗细：只动关节半径（默认 1.0，推大了就会炸毛）
    for (const j of m.joints) {
      const st = j && j.settings;
      if (!st) continue;
      _springCaptureJoint(st);                                 // 首次见到 = 作者原值
      const b = _springJointBase.get(st);
      st.stiffness = b.stiffness * s;
      st.gravityPower = b.gravityPower * s;
      st.hitRadius = b.hitRadius * s * kh;
    }
    let nBody = 0, nAll = 0;
    for (const c of m.colliders) {
      if (c === touchCollider) continue;      // ★「鼠标摸」的球：半径由触摸逻辑自己渐进控制，别被"防穿模倍率"覆盖
      const sh = c && c.shape;
      if (!sh) continue;
      _springCaptureShape(sh);
      const r = _springShapeBase.get(sh);
      const body = _springColliderIsBody(c);       // 只有挂在躯干/腿上的才吃"防穿模"倍率
      nAll++; if (body) nBody++;
      if (r !== undefined) sh.radius = r * s * (body ? kv : 1);
    }
    if (!applySpringScale._logged && (kv !== 1 || kh !== 1)) {
      applySpringScale._logged = true;
      postLog('info', '弹簧骨旋钮：碰撞体 ×' + kv + '（只作用于躯干/腿 ' + nBody + '/' + nAll + ' 个碰撞体）'
        + '｜发丝粗细 ×' + kh + (kv >= 2 ? '　⚠ 碰撞体 ≥2 会把头发/裙摆明显顶开，建议 ≤1.6' : ''));
    }
    // ★★ 顺序很关键：上面是按"作者原值 × scale"统一写回的，会把**冻结链的 0** 覆盖掉
    //   ⇒ 必须在最后再压一次冻结态（先捕获基线 → 再统一写 → 最后压冻结）。
    applySpringChains(false);
    // ★ v11.8：模型尺寸变了 ⇒ 弹簧骨的**基准**（各关节 tail / 骨长 / 静止方向）要跟着重设 ——
    //   初始化是在旧尺寸下量的（Nyalume 那边也是在缩放后补一次 reset 才不飘）。
    //   只在 scale **真的变化**时做：否则每次 reframe（换姿势/窗口变化都会调到这里）都 reset，
    //   头发会反复"啪"一下。首次调用也走一次（= 给新模型设基准，无害）。
    const sNow = +s || 1;
    if (applySpringScale._scaleAt !== sNow) {
      applySpringScale._scaleAt = sNow;
      if (typeof m.reset === 'function') { m.reset(); }
    }
  } catch (e) {
    // ★ 不许静默：旧代码把"真异常"和"这模型没弹簧骨"一视同仁地吞掉，排查时全黑（这正是漏掉 bug 的地方）
    if (!_springScaleWarned) { _springScaleWarned = true; postLog('warn', '弹簧骨缩放补偿失败（已跳过）：' + ((e && e.message) || e)); }
  }
}

// ================= ★★ 弹簧骨**链**：怀表 / 发辫 / 裙×48 / 胸 / 带子 / 披风 / 飘带 … 逐条冻结 =================
// 为什么要单开一栏：这些是**物理链**，根本不在材质表里 —— 材质栏管不到它们
//   （用户原话："部件列表没有它们，控制它们要用弹簧骨开关，不是部件开关"）。
// 一条链 = 从"链根骨"往下那一串挂了弹簧骨的关节骨。**不依赖 three-vrm 的内部分组结构**：
//   用父骨关系自己归并（不管版本怎么改，父子关系不会骗人）。
// 「冻结」原理：把该链所有关节的 stiffness / gravityPower / hitRadius 归零 + dragForce 拉满
//   ⇒ 求解器算出的 nextTail == 当前 tail ⇒ 姿势不再变化（= 钉住）；再 `reset()` 一次回到静止姿势。
//   **解冻**用 `_springJointBase` 里的作者原值写回（与「物理·碰撞体积」共享同一份基线 ⇒ 无损）。
let _chainMemFor = null, _chainMem = null;
function springChains() {
  if (!vrm || !vrm.springBoneManager) return [];
  if (_chainMemFor === vrm && _chainMem) return _chainMem;
  let out = [];
  try {
    // ★★ 必须 `Array.from`：three-vrm v3 的 `springBoneManager.joints` 是 **Set**（不是数组），
    //   直接 `.filter` 会抛 TypeError，被下面的 catch 吞掉 ⇒ 面板显示"0 条"（用户 2026-10-14 实测就是它）。
    //   （`applySpringScale` 用的是 `for...of`，Set/数组都能吃 ⇒ 那边一直正常，所以这个坑很难一眼看出来。）
    const jt = Array.from(vrm.springBoneManager.joints || []).filter(j => j && j.bone && j.settings);
    const boneSet = new Set(jt.map(j => j.bone));
    const byRoot = new Map();
    for (const j of jt) {
      let root = j.bone;
      while (root.parent && boneSet.has(root.parent)) root = root.parent;   // 沿父骨上溯到链根
      const key = root.uuid || root.name || Math.random();
      let e = byRoot.get(key);
      if (!e) { e = { name: root.name || '(未命名)', root: root, joints: [] }; byRoot.set(key, e); }
      e.joints.push(j);
    }
    // ★ 稳健性：不同 three-vrm 版本里 `joints` 可能**只给链根**（也可能给全部关节）。
    //   这里再沿 `j.child` 往下补一遍（只在 child 本身也是"带 settings 的关节"时才补，带去重 + 上限）。
    for (const e of byRoot.values()) {
      let cur = e.joints[e.joints.length - 1];
      for (let guard = 0; guard < 64; guard++) {
        const nx = cur && cur.child;
        if (!nx || !nx.settings || !nx.bone) break;
        if (e.joints.indexOf(nx) >= 0) break;
        e.joints.push(nx); cur = nx;
      }
    }
    out = Array.from(byRoot.values());
    // 长链在前（裙×48 那种先出现），短的（怀表/胸）在后 —— 和用户描述的顺序一致
    out.sort((a, b) => (b.joints.length - a.joints.length) || String(a.name).localeCompare(String(b.name)));
  } catch (e) { out = []; }
  _chainMemFor = vrm; _chainMem = out;
  return out;
}
function springFrozenSet() {
  const arr = rigGet('spring', 'frozen', null);          // 按模型存档（本地 + 宿主双写）
  return new Set(Array.isArray(arr) ? arr : []);
}
function setSpringFrozen(name, frozen) {
  const s = springFrozenSet();
  if (frozen) s.add(name); else s.delete(name);
  rigSet('spring', 'frozen', Array.from(s));
  const n = applySpringChains(true);
  // 自检里会临时冻结/解冻做验证 ⇒ 那段时间别打这两行（日志要留给"失败项"）
  try { if (!_st.busy) postLog('info', '弹簧骨链「' + name + '」' + (frozen ? '已冻结' : '已解冻') + '｜当前冻结 ' + n + ' 条'); } catch (e) { }
}
// 把"冻结清单"压到关节参数上（解冻的按作者原值×缩放写回）。返回冻结的链数。
function applySpringChains(doReset) {
  if (!vrm || !vrm.springBoneManager) return 0;
  const chains = springChains();
  if (!chains.length) return 0;
  const frozen = springFrozenSet();
  const k = springHitScale(), s = lastOpts.scale || 1;
  let nf = 0;
  // ★ 先**统一捕获基线**（冻结前！），否则冻结链的 0 会被当成"作者原值"永久记下来
  for (const ch of chains) for (const j of ch.joints) _springCaptureJoint(j.settings);
  for (const ch of chains) {
    const fr = frozen.has(ch.name);
    if (fr) nf++;
    for (const j of ch.joints) {
      const st = j.settings; if (!st) continue;
      const b = _springJointBase.get(st) || st;
      if (fr) {                                            // 冻结：无弹簧、无重力、无碰撞、惯性吃满
        st.stiffness = 0; st.gravityPower = 0; st.hitRadius = 0;
        if (typeof st.dragForce === 'number') st.dragForce = 1;
      } else {                                             // 解冻 / 正常：按作者原值与缩放写回
        st.stiffness = b.stiffness * s;
        st.gravityPower = b.gravityPower * s;
        st.hitRadius = b.hitRadius * s * k;
        if (typeof st.dragForce === 'number' && typeof b.dragForce === 'number') st.dragForce = b.dragForce;
      }
    }
  }
  if (doReset && nf) { try { vrm.springBoneManager.reset(); } catch (e) { } }   // 冻住的链落到静止姿势
  return nf;
}
function springChainsSummary() {
  const ch = springChains();
  const cnt = {};
  for (const c of ch) { const n = c.name.replace(/[0-9_]+$/, '') || c.name; cnt[n] = (cnt[n] || 0) + 1; }
  return { n: ch.length, byName: cnt };
}
// 取不到链时**报出原始事实**（类型/数量/可用数），下次不用再猜 —— 就是这次的教训
function springDiag() {
  if (!vrm) return 'vrm=null';
  const m = vrm.springBoneManager;
  if (!m) return 'springBoneManager=null（PMX，或该模型没配 VRM 弹簧骨）';
  let jt = null;
  try { jt = m.joints; } catch (e) { return '读 joints 异常：' + e.message; }
  const kind = Object.prototype.toString.call(jt);
  const n = jt ? (typeof jt.size === 'number' ? jt.size : (jt.length || 0)) : 0;
  let usable = 0;
  try { for (const j of (jt || [])) if (j && j.bone && j.settings) usable++; } catch (e) { }
  let ng = 0;
  try { ng = ((m.colliderGroups && m.colliderGroups.length) || 0); } catch (e) { }
  return 'joints 类型=' + kind + '｜数量=' + n + '｜可用（带 bone+settings）=' + usable + '｜碰撞组=' + ng;
}

// ---- VRM 物理（弹簧骨：头发/裙摆/胸）开关 ----
// 现状：VRM 的物理由 `vrm.update(dt)` 内部每帧调用 springBoneManager.update(dt) 驱动 ⇒ **本来就是开着的**，
//   插件此前**没有开关**（MMD 那套走 ammo.js 刚体 = 另一个 EnablePhysics，两者别混）。这里补上开关。
// 关法：把"每帧积分"换成空操作。**不能**把 `vrm.springBoneManager` 置 null —— 不同 three-vrm 版本里
//   vrm.update 对它的解引用不一定带可选链，若是直接取属性就每帧抛异常（渲染循环兜一次＝整只冻住），代价太大。
//   保留 manager 与全部数据 ⇒ 随时可**无损**恢复，也不影响 applySpringScale / reset 那些调用点。
let vrmPhysicsOn = true;
let _springOrigUpdate = null;
let _springPhysApplied = false;   // 是否已经真正应用过一次（换模型时复位，见 clearModel）
// ★ v11.8 子步（声明提前到这里：applyVrmPhysics 会用到，避免"声明在调用点之后"的 TDZ 隐患）
// ★ v11.26：默认 2 → **3**（≈180 步/秒）—— 用户日志里"放下时头发单帧跳 94~154°"说明 2 步还不够
//   （手臂快速放下会带动发丝；子步是唯一有效杠杆，见 Nyalume 的量化：1/65→1/120 抖动 40.9%→20.2%）。
//   代价只是物理计算 ×1.5，可忽略；嫌费就在面板调回 2。
let _springSubSteps = 3;
let _springStepWrap = null;
function vrmPhysicsEnabled() {
  // lastOpts 里可能是布尔（宿主 options 回传），也可能是数字 1/0（面板 sendSetting 写回）—— 两种都要认，
  // 默认（还没收到过）算**开**。
  return (lastOpts.vrmPhysics === undefined) ? true : !!lastOpts.vrmPhysics;
}
function applyVrmPhysics(on) {
  const nv = !!on;
  // ★ 幂等 + 闭嘴：宿主会**反复**回传 options（实测：点一次「全隐」= 44 条 `part:名字` 设置，
  //   宿主每条都回一次 options_update）⇒ 旧写法每次都重新应用并打一行日志，
  //   结果一秒刷几百行 `VRM 物理(弹簧骨)：开`，还连带触发宿主配置写入竞争
  //   （日志里的 `IOException: json is being used by another process`）。
  //   状态没变就直接返回；只有真正变化（或换过模型）才走下面。
  if (vrmPhysicsOn === nv && _springPhysApplied) return;
  vrmPhysicsOn = nv;
  _springPhysApplied = true;
  if (!vrm || !vrm.springBoneManager) return;      // PMX / 没配弹簧骨的模型：直接跳过
  const m = vrm.springBoneManager;
  try {
    if (!_springOrigUpdate && typeof m.update === 'function') _springOrigUpdate = m.update.bind(m);
    if (vrmPhysicsOn) {
      // ★ v11.8：开 = **子步包装**（内层仍调原始 update；步数 = petSpringSubSteps，默认 2 ⇒ 等效 1/120）
      if (_springOrigUpdate) m.update = _springStepWrapped();
    } else {
      if (typeof m.reset === 'function') m.reset();   // 先落回静止姿势再冻住，免得停在半空摆着
      m.update = function () { };
    }
    // ★ 逐链冻结/解冻跟着物理开关一起重压（关物理时冻结清单仍保留，下次开自动生效）
    try { applySpringChains(true); } catch (e) { }
    postLog('info', 'VRM 物理(弹簧骨)：' + (vrmPhysicsOn ? '开' : '关'));
  } catch (e) { console.warn('[3D桌宠] 弹簧骨开关失败', e); }
}

// ---- ★★ 弹簧骨「子步」（v11.8）----
// 为什么（用户："不丝滑 / 抽"）：three-vrm 的弹簧骨是**位置型**积分，一步里做三件**怕大步**的事 ——
//   ① 弹簧/重力项 ∝ dt（惯性项不 ∝ dt）⇒ dt 变大"刚柔比"漂移（低帧率时头发突然变硬/变重）；
//   ② 每步末尾「归一化到骨长」是**硬约束** ⇒ 一步走过头 = 方向突变（就是日志里"单帧跳 N°"的形状）；
//   ③ 碰撞是**事后投影**（穿透了才推出来）⇒ 一步穿得深、推得远 = 往系统注入能量（越抖越抖、发丝互拍）。
//   拆成 n 个 dt/n ⇒ 三件都变小：比例更准、不过冲、浅穿浅推。
// 实证（Nyalume 在同类模型上的量化结论）：1/65 抖动 40.9% ⇒ 1/120 降到 20.2%，1/180 没有更好；
//   求解迭代次数与加阻尼**基本无效**，唯一有效的杠杆就是子步。
// 实现要点：**只包 `springBoneManager.update`**（不要整个 `vrm.update` 调两次 —— 那会把 humanoid 传导、
//   表情、lookAt 也跑两遍，视线跟随会翻倍快）。与「物理开关」共用同一条链：开关关 ⇒ noop；开关开 ⇒ 本包装。
// 调参：`petSpringSubSteps(1|2|3|4)`（控制台，持久化），默认 2（60fps 下等效 1/120）。
function springSubSteps() {
  try { const v = +(localStorage.getItem('petSpringSubSteps') || ''); if (v >= 1 && v <= 4) return v | 0; } catch (e) { }
  return _springSubSteps;
}
function _springStepWrapped() {
  if (_springStepWrap) return _springStepWrap;
  _springStepWrap = function (dt) {
    if (!_springOrigUpdate) return;
    const n = springSubSteps();
    if (n <= 1 || !(dt > 0)) return _springOrigUpdate(dt);
    const sub = dt / n;
    for (let i = 0; i < n; i++) _springOrigUpdate(sub);
  };
  return _springStepWrap;
}
function applySpringSubSteps(n, quiet) {
  if (n !== undefined) {
    _springSubSteps = Math.max(1, Math.min(4, +n || 1));
    try { localStorage.setItem('petSpringSubSteps', String(_springSubSteps)); } catch (e) { }
  }
  const m = vrm && vrm.springBoneManager;
  if (!m) return false;
  try {
    if (!_springOrigUpdate && typeof m.update === 'function') _springOrigUpdate = m.update.bind(m);
    if (vrmPhysicsOn) m.update = _springStepWrapped();
  } catch (e) { return false; }
  const nn = springSubSteps();
  if (!quiet) {
    postLog('info', '弹簧骨子步：' + nn + ' 步/帧'
      + (nn > 1
        ? ('（≈' + (60 * nn) + ' 步/秒等效）⇒ 头发/裙子更稳；用 petClothProbe() 复测抖动率对比')
        : '（关闭，原样）'));
  }
  return true;
}
window.petSpringSubSteps = function (n) { return applySpringSubSteps(n); };

// ---- ★★ 布料「抖动 / 下沉」探针（v11.8，思路借鉴 Nyalume 的 __probeJitter，实现自己写）----
// 为什么需要：头发/裙子的"不舒服"有**两种完全不同的病**，靠眼睛分不出来 ——
//   ① 抖（jitter）：位移方向反复、每帧来回 ⇒ 病在"碰撞投影注入能量 / 步长太大"（子步是对症药）；
//   ② 沉（sink）：位置单向下沉、回不去 ⇒ 病在"刚度/重力配错、或缩放后没 reset 基准"。
// 量化口径：`每帧位移` = ΣΔd/帧（大小）；`抖动率` = Σ|Δd−上次Δd| / ΣΔd（方向反复的程度）；
//   `下沉 top3` = 各骨相对起始高度掉多少（持续变负 = 一直在掉）；`单帧大跳` = > 阈值的跳（带时间与骨名）。
// 用法：`await petClothProbe(3000)`（默认 3 秒采样 + 2 秒热身不计分）。
let _clothProbeBusy = false;
window.petClothProbe = function (ms = 3000, warm = 2000) {
  return new Promise((resolve) => {
    if (_clothProbeBusy) { resolve('（探针正在跑，等它出结果）'); return; }
    const m = vrm && vrm.springBoneManager;
    if (!m || !THREE || typeof performance === 'undefined') { resolve('没有可采样的弹簧骨（PMX / 该模型没配弹簧骨）'); return; }
    const cloth = /hair|髪|发|髮|裙|スカート|skirt|袖|sleeve|披|cape|マント|尾|tail|布|cloth|リボン|帯|带|フリル|frill|裾|hem/i;
    const bones = [];
    try {
      for (const j of Array.from(m.joints || [])) {
        if (j && j.bone && cloth.test(String(j.bone.name || ''))) bones.push(j.bone);
      }
    } catch (e) { }
    if (!bones.length) { resolve('没找到布料骨（骨名里没有 hair/裙/袖/尾 等关键词）'); return; }
    _clothProbeBusy = true;
    const now = bones.map(() => new THREE.Vector3());
    const last = bones.map(() => new THREE.Vector3());
    const lastDelta = bones.map(() => 0);
    const startY = bones.map(() => null);
    bones.forEach((b, i) => { try { b.getWorldPosition(last[i]); } catch (e) { } });
    const jumps = [];
    const JUMP_M = 0.03;                 // 单帧位移 > 3cm 算"跳"（模型 ≈2.3m 高，发丝正常每帧 < 1cm）
    let frames = 0, sumDelta = 0, sumJitter = 0;
    const t0 = performance.now();
    const finish = () => {
      _clothProbeBusy = false;
      const sinkTxt = bones
        .map((b, i) => [startY[i] === null ? 0 : now[i].y - startY[i], String(b.name || i)])
        .sort((a, b) => a[0] - b[0]).slice(0, 3)
        .map(([dy, n]) => dy.toFixed(3) + ':' + n).join(' ');
      const topTxt = jumps.sort((a, b) => b[0] - a[0]).slice(0, 3)
        .map(([d, t, n]) => d.toFixed(3) + 'm@' + (t / 1000).toFixed(1) + 's:' + n).join(' ');
      const rate = sumJitter / Math.max(1e-9, sumDelta) * 100;
      const msg = '布料探针：骨 ' + bones.length + ' 根｜采样 ' + frames + ' 帧'
        + '｜每帧位移 ' + (sumDelta / Math.max(1, frames)).toFixed(4) + 'm'
        + '｜抖动率 ' + rate.toFixed(1) + '%（<15% 稳 / 15~30% 微抖 / >30% 明显抖）'
        + '｜下沉 top3 ' + (sinkTxt || '无') + '（持续变负 = 一直往下掉）'
        + '｜单帧大跳 ' + (topTxt || '无');
      try { postLog('info', msg); } catch (e) { }     // ★ 同时写进日志：跑完一次，日志里就有数据（不用去控制台抄）
      resolve(msg);
    };
    const step = () => {
      const elapsed = performance.now() - t0;
      if (elapsed > ms) { finish(); return; }
      requestAnimationFrame(step);
      if (elapsed < warm) {                            // 热身：只跟位置、不计分（等物理收敛）
        bones.forEach((b, i) => { try { b.getWorldPosition(last[i]); } catch (e) { } });
        return;
      }
      bones.forEach((b, i) => {
        try {
          b.getWorldPosition(now[i]);
          const d = now[i].distanceTo(last[i]);
          if (startY[i] === null) startY[i] = now[i].y;
          if (frames > 0) {
            sumJitter += Math.abs(d - lastDelta[i]);
            if (d > JUMP_M) jumps.push([d, elapsed, String(b.name || i)]);
          }
          sumDelta += d; lastDelta[i] = d; last[i].copy(now[i]);
        } catch (e) { }
      });
      frames++;
    };
    step();
  });
};

// ---- ★★ VRM 材质观感配方（v11.8，参数组借鉴 Nyalume 的 style(enhanced)，实现自己写）----
// 一组打磨过的 MToon 参数，按「脸 / 头发 / 其他」三组批量调：阴影更柔（shift 取负）、toony 略低、
// 阴影色朝本色 lerp（防死黑）、轮廓收细、非脸材质加一点暖边缘光（rim + rimMix 0.65）。
// **默认关**（保留你现在的观感，自己对比后再定）；持久化 petVrmStyle。控制台：petVrmStyle(true/false)。
let _vrmStyleBase = null;
function vrmStyleEnabled() { try { return localStorage.getItem('petVrmStyle') === '1'; } catch (e) { return false; } }
function _vrmStyleCapture() {
  if (_vrmStyleBase || !vrm || !vrm.scene) return;
  _vrmStyleBase = new Map();
  try {
    vrm.scene.traverse(o => {
      if (!o.isMesh) return;
      for (const mat of [].concat(o.material || [])) {
        if (!mat || !mat.isMToonMaterial || _vrmStyleBase.has(mat)) continue;
        _vrmStyleBase.set(mat, {
          shift: mat.shadingShiftFactor, toony: mat.shadingToonyFactor,
          shade: mat.shadeColorFactor ? mat.shadeColorFactor.clone() : null,
          outline: mat.outlineWidthFactor,
          rim: mat.parametricRimColorFactor ? mat.parametricRimColorFactor.clone() : null,
          rimMix: mat.rimLightingMixFactor,
        });
      }
    });
  } catch (e) { }
}
function applyVrmStyle(on, quiet) {
  const want = (on === undefined) ? vrmStyleEnabled() : !!on;
  try { localStorage.setItem('petVrmStyle', want ? '1' : '0'); } catch (e) { }
  if (!vrm || !vrm.scene) return want;
  _vrmStyleCapture();
  let n = 0;
  try {
    for (const [mat, base] of (_vrmStyleBase || [])) {
      const nm = String(mat.name || '');
      const face = /face|顔|脸/i.test(nm), hair = /hair|髪|发|髮/i.test(nm);
      if (base.shift !== undefined) mat.shadingShiftFactor = want ? (face ? -0.15 : hair ? -0.22 : -0.2) : base.shift;
      if (base.toony !== undefined) mat.shadingToonyFactor = want ? (face ? 0.72 : hair ? 0.82 : 0.8) : base.toony;
      if (base.shade && mat.shadeColorFactor && mat.color) {
        mat.shadeColorFactor.copy(base.shade);
        if (want) mat.shadeColorFactor.lerp(mat.color, face ? 0.2 : 0.08);
      }
      if (base.outline !== undefined) mat.outlineWidthFactor = want ? Math.min(base.outline, hair ? 0.0016 : 0.002) : base.outline;
      if (base.rim && mat.parametricRimColorFactor) {
        mat.parametricRimColorFactor.copy(base.rim);
        if (want && !face) mat.parametricRimColorFactor.setRGB(0.035, 0.028, 0.024);
      }
      if (base.rimMix !== undefined) mat.rimLightingMixFactor = want ? 0.65 : base.rimMix;
      mat.needsUpdate = true;
      n++;
    }
  } catch (e) { }
  if (!quiet) postLog('info', 'VRM 材质观感：' + (want ? '开' : '关') + '（' + n + ' 个 MToon 材质）'
    + (want ? '｜脸/发/其他三组：阴影更柔、阴影色不吃死、轮廓收细、非脸加暖边缘光（不喜欢就 petVrmStyle(false)）' : ''));
  return want;
}
window.petVrmStyle = function (on) { return applyVrmStyle(on); };

// ---- 弹簧骨碰撞体：每帧同步 + 一次性自检 ----
// 为什么必须自己做：three-vrm v3 里 `VRMSpringBoneCollider extends Object3D`，而**碰撞计算真正读的是
//   `colliderMatrix`**（不是 matrixWorld）——它只在碰撞体自己的 `updateWorldMatrix()` 里重算
//   （见 VRMSpringBoneCollider.updateWorldMatrix → updateColliderMatrix）。
//   而 `VRMSpringBoneManager.update()` 只对 `_ancestors` / 各弹簧骨 / 骨骼后代里"没挂弹簧骨的中间节点"
//   调 updateWorldMatrix，**并不逐个遍历 collider** ⇒ 碰撞球可能一直停在**加载那一刻**的姿势上。
//   症状正好是用户报的那样：站着不动看不出来（碰撞球刚好贴着腿），**一做动作腿动了、碰撞球没跟上
//   ⇒ 裙子/衣服直接穿过腿**（"物理好像不是开着的、做动作衣服会穿模"）。别的播放器看着正常，
//   是因为它们要么自己每帧同步、要么用的是带场景图同步的老版本 API。
// 做法：`updateWorldMatrix(true, false)` 是幂等的（重算自身与父级世界矩阵，再顺带重算 colliderMatrix），
//   重复调用**无害** ⇒ 就算将来 three-vrm 自己也会同步，这里多调一遍也不会有副作用。
let _springColliderChecked = false;
// ★ 2026-10-14 第四轮：碰撞体同步降开销 —— 实测"过期 0"⇒ 走"每 2 秒抽样体检"的快路径（详见 syncSpringColliders）
let _springColliderFast = true, _springColliderCheckT = -1e9;
let _springColliderStaleHits = 0;   // ★ v11.36c 连续判过期的次数（只有连续 2 次才切回每帧全量，防止单帧误判）
// ================= ★★ 鼠标"触摸"：把光标变成弹簧骨碰撞球（移植 Mate-Engine 的做法）=================
// 依据（它的真实源码 AvatarBigScreenTouchHandler.cs）：在鼠标位置生成一个**隐藏球碰撞体**，注册进
//   VRM 弹簧骨碰撞组、并逐个加到每根弹簧骨上 ⇒ **头发/裙摆真的被鼠标推开、揉动**；再把 Animator 的
//   `HairStroke` 置 true 触发"被摸"状态。★ 它**不做射线部位识别**（我上一轮猜错了，已按源码修正）。
// 我们的对应实现：
//   ① 用 three-vrm 的 VRMSpringBoneCollider(Group) 建一个球（半径可调）⇒ 物理上真的会推；
//   ② 每帧把球放到**光标射线**与"模型中心深度"的交点（光标 = 手指）；
//   ③ 光标在人物身上**移动**时发一条 `pet_touch` 给宿主 —— **是否让 AI 回应由宿主开关决定**
//      （复用「互动触发（省 token）」里的「摸到 → 触发回复（任意部位）」+「互动冷却」），我们只负责"摸到了"。
// 安全：默认 **关**；拿不到碰撞体类 ⇒ 跳过并记一行（不硬猜版本）；异常只记一行并自动停用。
let touchPhysicsOn = false, touchRadiusBase = 0.05;
let touchGroup = null, touchCollider = null, touchWarned = '';
// 物理球实测推不动时才会打开"直接拨骨"保底（见 ensureTouchCollider / _touchPhysicsSelfTest / applyTouchPoke）。
//   ★ 声明必须在这里：ensureTouchCollider 会在**模型就绪后**给它赋值，而 applyTouchPoke 每帧读它。
let touchPokeFallback = false;
let touchRig = null, touchMode = '';    // 载体（全局场景里的 Object3D）+ 构造方式（class/borrow/plain）
let touchLastFire = 0, touchInside = false, touchLastPt = null, touchLogT = -1e9;
let touchStreak = 0;             // 连续命中帧数（连续 2 帧才算"摸到" ⇒ 滤掉单帧噪声）
// ★★ 2026-10-14 平滑改造（v11.4）：球心不再"瞬移"到光标命中点（旧写法每帧 .copy ⇒ 手一快球就闪现，
//   头发被瞬间穿透/甩飞 = "碰撞很不流畅不自然"）。改为按时间常数阻尼跟随，
//   并记下这一帧球实际移动的距离（拨骨强度按它给 ⇒ 球不动就不拨，停手即停）。
//   ⚠ 这四个一起声明、一起用（parkTouchBall / applyTouchPoke / touchTick 的落位处）；
//     缺一个就 ReferenceError ⇒ 会被异常计数捕获 → 触摸功能自我停用（日志：touchBallPos is not defined）。
let touchBallPos = null, touchBallPrev = null, touchBallSweep = 0, touchPlaceT = 0;
// ★★ v11.5：球的**半径也要渐进**（0 → rMax → 0），理由见 touchTick：碰撞是硬约束，
//   半径瞬变 = 骨方向单帧剧变（27° 瞬跳的另一种来源）。touchBallR = 当前半径；touchBallMoveT = 最后一次"球在动"的时刻。
let touchBallR = 0, touchBallMoveT = -1e9;
// ★★ v11.6 锚点（治"鼠标不动也抽"）：定位锚点**只在光标真的移动时更新** —— 见 touchTick 里的长注释。
//   touchAnchorPx = 上次采样时的屏幕坐标；touchAnchorWp = 对应的世界点（球心由它 + 相机方向偏移算出）。
let touchAnchorPx = null, touchAnchorWp = null;
// ★★ v11.7：锚点更新看"**累积**屏幕位移"（慢滑也要算动）用 —— 这三个变量缺一个，`touchPxAcc` 的赋值
//   在严格模式下就会 ReferenceError（模块就是严格模式）：每帧抛一次 ⇒ 触摸 301 次异常后**自我停用**
//   ⇒ 表现就是"改完后一点反应没了"（日志：`鼠标触摸异常：touchPxAcc is not defined`）。
//   ※ 又踩了下面这条老坑（touchMissLogT 那次）：**新增变量必须和它的用法在同一个编辑里落地**。
let touchPxAcc = 0, touchPxLastX = null, touchPxLastY = 0;
// 抖动探针（治"按住不动也抽"的**验证器**）：光标不动时，累计"被摸那根骨"每 0.5s 转了多少度 —— 修复若生效应趋近 0。
let _jitNode = null, _jitQ = null, _jitAcc = 0, _jitT0 = 0, _jitLogT = -1e9;
// ★★ 2026-10-14 血泪：这一行（touchMissLogT 声明）在**批量编辑时丢过一次**，而下面"没打到模型"分支要用它 ⇒
//   一进那个分支就抛 ReferenceError ⇒ 被 catch 里"一次异常就自动停用"捕获 ⇒ **功能在第一秒把自己关掉了**，
//   表现就是用户看到的"开了完全没反应"（日志里那行 `touchMissLogT is not defined` 就是现场）。
let touchMissLogT = -1e9;        // "没打到模型"诊断的节流时间戳
let _touchErrN = 0, _touchErrT = -1e9, _touchErrLogged = false;   // 异常计数（不再一次就停用）
function touchPhysicsEnabled() { try { return localStorage.getItem('petTouchPhysics') === '1'; } catch (e) { return false; } }
function setTouchPhysics(on) {
  try { localStorage.setItem('petTouchPhysics', on ? '1' : '0'); } catch (e) { }
  touchPhysicsOn = !!on;
  if (!on) touchDropCollider('开关关闭');
}
function touchRadius() {
  let v = touchRadiusBase;
  try { const s = +(localStorage.getItem('petTouchRadius') || ''); if (isFinite(s) && s > 0) v = s; } catch (e) { }
  return v;
}
function setTouchRadius(v) { try { localStorage.setItem('petTouchRadius', String(v)); } catch (e) { } touchRadiusBase = +v || 0.05; }
// 历史（已作废，留作对照）：①要求 three-vrm **导出** VRMSpringBoneCollider/Group（本机版本没导出 ⇒ 开关等于没开）；
//   ②"向模型已有碰撞体借壳"（`new (sample.constructor)()`）—— 借来的结构只能猜（组里 colliders 是数组还是 Set、
//   shape 能不能 new、字段是不是私有 `#`），猜错一次就是"日志说挂上了、求解器眼里等于没有"。
// ★★ 2026-10-14 第三轮（用户："还是不丝滑很割裂抽搐"；日志抓到"弹簧骨单帧跳 27°、0.07s 又回到 5° 内"）：
//   两条老路都有问题：
//   ① "借壳球"（`new (sample.constructor)()`）有太多只能靠猜的结构（借来的组里 colliders 是数组还是 Set、
//      shape 能不能 new、字段是不是私有 `#`）—— 猜错一次就是"球挂上了、但求解器眼里等于没有"；
//   ② "直接拨骨"保底一定有反应，但它是**硬写姿态**：求解器下一帧就用自己的位置状态重算
//      ⇒ 视觉正是日志抓到的那条"单帧跳 27°、0.07s 又跳回来"（= 抽一下）。
//   ⇒ 不再猜：直接按 three-vrm 3.4.0 求解器**真正读的三个东西**造球（源码 VRMSpringBoneJoint._collision）：
//        for (const cg of joint.colliderGroups) for (const c of cg.colliders)
//          dist = c.shape.calculateCollision(c.colliderMatrix, tail, joint.settings.hitRadius, out)
//      只有三样要成立：joint.colliderGroups 是数组、组里 colliders 是数组、球对象有 colliderMatrix + shape.calculateCollision
//      —— 这三样**全在我们手里**（鸭子类型：不 import、不借壳、不猜版本）。
//      挂完再**用求解器自己的函数实测一次**（见 _touchPhysicsSelfTest）⇒ "推得动推不动"不再靠肉眼和运气。
function _makeTouchSphere() {
  const _v = new THREE.Vector3();
  const shape = {
    type: 'sphere', inside: false, offset: new THREE.Vector3(0, 0, 0),
    radius: touchRadius(),
    // 与 three-vrm VRMSpringBoneColliderShapeSphere.calculateCollision **同语义**：
    //   返回"还差多远才接触"（<0 = 已穿透），target 写成"从球心指向该点"的单位向量
    calculateCollision(colliderMatrix, objectPosition, objectRadius, target) {
      target.subVectors(objectPosition, _v.setFromMatrixPosition(colliderMatrix));
      const length = target.length();
      const distance = length - objectRadius - this.radius;
      if (distance < 0) { if (length > 1e-6) target.multiplyScalar(1 / length); else target.set(0, 1, 0); }
      return distance;
    },
  };
  const collider = new THREE.Object3D();
  collider.name = 'MouseTouchCollider';
  collider.shape = shape;
  collider.colliderMatrix = new THREE.Matrix4();
  // 与官方 VRMSpringBoneCollider.updateWorldMatrix 行为一致：更新完自身矩阵，把世界矩阵同步给 colliderMatrix
  //   （求解器读的就是 colliderMatrix；这样 syncSpringColliders / 落位处那句 updateWorldMatrix 就够）
  collider.updateWorldMatrix = function (up, down) {
    THREE.Object3D.prototype.updateWorldMatrix.call(this, up, down);
    this.colliderMatrix.copy(this.matrixWorld);
  };
  collider.updateColliderMatrix = function () { this.colliderMatrix.copy(this.matrixWorld); };
  const group = { name: 'MouseTouchColliderGroup', colliders: [collider] };
  return { group: group, collider: collider, shape: shape };
}
// ★★★ 只塞**求解器真正读的那个列表**：`joint.colliderGroups`（three-vrm 3.4.0 源码 5387 行 `_collision` 里
//   遍历的就是它；`settings.colliderGroups` 只是 VRM 文件里的定义数据，求解器**根本不读** —— 上一版就是塞错地方，
//   日志"settings.colliderGroups 174/174 根"看着很成功，实际等于没挂）。
//   返回值同时**回读校验**：确认列表里就是我们的组、组里第一颗就是我们的球 ⇒ 这行日志才有意义。
function touchMountIntoJoints(g) {
  const out = { set: 0, inner: 0, names: 'joint.colliderGroups', joints: 0, ok: 0 };
  try {
    const m = vrm && vrm.springBoneManager;
    if (!m) return out;
    const joints = Array.from(m.joints || []);
    out.joints = joints.length;
    for (const j of joints) {
      if (!j) continue;
      let arr = j.colliderGroups;
      if (!Array.isArray(arr)) { try { j.colliderGroups = arr = []; } catch (e) { arr = null; } }
      if (!arr) continue;
      try { if (arr.indexOf(g) < 0) arr.push(g); } catch (e) { }
      try {
        if (arr.indexOf(g) >= 0 && Array.isArray(g.colliders) && g.colliders[0] === touchCollider
          && typeof g.colliders[0].shape.calculateCollision === 'function') out.ok++;
      } catch (e) { }
    }
    out.set = out.ok; out.inner = out.ok;
  } catch (e) { }
  return out;
}
// ★ 用**求解器自己的碰撞函数**实测一次：把一根弹簧骨的 tail 放到球心附近，调 `joint._collision(tail)`，
//   看它有没有被推出来。这比"看日志猜"硬得多 —— 推得动，就说明这条链真的通了（且不需要"直接拨骨"）。
function _touchPhysicsSelfTest() {
  try {
    const m = vrm && vrm.springBoneManager;
    if (!m || !touchCollider || !THREE) return null;
    const joints = Array.from(m.joints || []);
    const wp = new THREE.Vector3(), tail = new THREE.Vector3();
    touchCollider.getWorldPosition(wp);
    const r = (touchCollider.shape && touchCollider.shape.radius) || 0.05;
    const probes = [0.25, 0.6, 0.95];              // 球心附近三个深度各试一次
    let tested = 0, moved = 0, maxMove = 0;
    for (const j of joints) {
      if (!j || typeof j._collision !== 'function') continue;
      const arr = j.colliderGroups;
      if (!Array.isArray(arr) || arr.indexOf(touchGroup) < 0) continue;
      for (const pr of probes) {
        tail.copy(wp); tail.x += r * pr;
        const bx = tail.x, by = tail.y, bz = tail.z;
        j._collision(tail);
        const d = Math.sqrt((tail.x - bx) * (tail.x - bx) + (tail.y - by) * (tail.y - by) + (tail.z - bz) * (tail.z - bz));
        tested++; if (d > 1e-4) { moved++; if (d > maxMove) maxMove = d; }
      }
      if (tested >= 3) break;                      // 3 根就够了（省时间，别每帧做）
    }
    if (!tested) return null;
    return { tested: tested, moved: moved, maxMove: maxMove };
  } catch (e) { return null; }
}
function ensureTouchCollider() {
  if (touchGroup && touchCollider) return true;
  if (!vrm || !vrm.springBoneManager || !THREE) return false;
  try {
    const built = _makeTouchSphere();
    const g = built.group, c = built.collider;
    // ★ 载体（球心的父）放在**全局场景**下：vrm.scene 带整体缩放（本模型 ≈1.64），挂那里会把光标世界坐标乘错
    if (!touchRig) { touchRig = new THREE.Object3D(); touchRig.name = 'MouseTouchRig'; try { scene.add(touchRig); } catch (e) { } }
    touchGroup = g; touchCollider = c; touchMode = 'self';
    try { touchRig.add(c); } catch (e) { }
    const ji = touchMountIntoJoints(g);          // 挂进 joint.colliderGroups（求解器唯一会读的那个列表）
    try { c.updateWorldMatrix(true, false); } catch (e) { }
    // ★ 实测一次：把 tail 放进球心，用**求解器自己的** `_collision` 看它会不会被推出来
    //   ⇒ 推得动 = 这条链真的通了 ⇒ **关掉"直接拨骨"**（它硬写姿态、会被求解器下一帧回弹 ——
    //     日志抓到的"弹簧骨单帧跳 27°、0.07s 又回到 5° 内"就是它的形状）
    const st = _touchPhysicsSelfTest();
    touchPokeFallback = !(st && st.moved > 0);
    postLog('info', '鼠标触摸：物理球已挂载（自造·直接按求解器接口，不借壳、不猜版本）'
      + '｜求解器读取自检：' + ji.ok + '/' + ji.joints + ' 根弹簧骨的 ' + ji.names + ' 里都读得到它'
      + (st
        ? ('｜推进实测：' + st.moved + '/' + st.tested + ' 次真的被推出去（最大 ' + st.maxMove.toFixed(3) + 'm）'
          + (st.moved > 0
            ? ' ⇒ 物理生效，"直接拨骨"保底已关闭（那是"抽一下"的来源）'
            : ' ⇒ **没推动**：暂时启用"直接拨骨"保底（请把这一行发我）'))
        : '｜推进实测：跳过（这版求解器没暴露 _collision）')
      + '｜类型 ' + ((c.shape && c.shape.type) || '?') + '，半径 ' + touchRadius().toFixed(3)
      + '｜AI 是否回应由「互动触发（省 token）」的「摸到 → 触发回复（任意部位）」+「互动冷却」控制');
    return true;
  } catch (e) {
    if (touchWarned !== 'mk') { touchWarned = 'mk'; postLog('warn', '鼠标触摸：建物理球失败（已跳过）：' + ((e && e.message) || e)); }
    touchGroup = null; touchCollider = null;
    return false;
  }
}
function touchDropCollider(reason) {
  if (!touchGroup) return;
  // 只需从**求解器读的那个列表**里摘掉（joint.colliderGroups）；球本身是我们自造的对象，随载体一起丢
  try {
    const m = vrm && vrm.springBoneManager;
    if (m) for (const j of Array.from(m.joints || [])) {
      const arr = j && j.colliderGroups;
      if (Array.isArray(arr)) { const i = arr.indexOf(touchGroup); if (i >= 0) arr.splice(i, 1); }
    }
    try { if (touchRig && scene) scene.remove(touchRig); } catch (e) { }
  } catch (e) { }
  touchGroup = null; touchCollider = null; touchRig = null; touchMode = '';
  touchPokeFallback = false;
  if (reason) postLog('info', '鼠标触摸：物理球已移除（' + reason + '）');
}
/** 每帧：定位碰撞球 + 触摸事件（由 syncSpringColliders 每帧调用） */
// ================= ★★ 摸到「哪个部位」：射线打模型表面 → 蒙皮权重找主导骨 → 骨名 → 部位 =================
// 为什么这么做：VRM/MMD 的骨名是可读的（J_Bip_C_Head / 頭 / 左腕 / J_Sec_Skirt_00_01…），而蒙皮权重
//   直接告诉我们"这一像素长在哪根骨上" ⇒ 比"按高度猜部位"准得多；权重拿不到再退回"最近的人形骨"。
//   用户诉求原话："而且没分摸到具体的部位"（部位要能跟着 pet_touch 报给 AI，它才知道是摸头还是抓手）。
const PART_RULES = [
  ['头发', /hair|髪|发|髮|ウィッグ|ヘア|ponytail|bangs|前髪|後髪|刘/i],
  ['脸', /face|顔|颜|目|眼|瞳|eye|眉|まゆ|brow|口|mouth|くち|歯|牙|nose|鼻|ear|耳|まつげ|睫毛|舌|tongue/i],
  ['头', /head|neck|首|くび|頭|あたま|脑|腦/i],
  ['手', /hand|wrist|手首|手指|指|finger|thumb|index|middle|ring|little|亲指|人差指|中指|薬指|小指/i],
  ['脚', /foot|toe|つま先|足首|足|脚|靴|ankle/i],
  ['腿', /leg|thigh|knee|もも|ひざ|すね|下腿|大腿|ふともも|腿/i],
  ['手臂', /arm|腕|肩|shoulder|肘|elbow|ひじ|上腕|前腕|clavicle|鎖骨|锁骨/i],
  ['胸背', /chest|breast|bust|spine|胸|背|体幹|upperchest|せなか|背中|腹| belly/i],
  ['腰胯', /hip|pelvis|腰|胯|骨盤|骨盆|下半身|waist/i],   // ★ 不能收「尻」：`尻尾`是尾巴，会被这里抢走（离线抽查抓到过）
  ['裙摆', /skirt|スカート|裙|dress|布|服|cloth|hem|裾|衣/i],
  ['尾巴/配件', /tail|尾|翼|wing|羽|角|horn|怀表|怀錶|watch|ネクタイ|領帯|带子|ベルト|リボン|アクセサリ|piao|飘|飄|披风|マント|cape|丝带|silk/i],
];
function partLabelFromBone(name) {
  const s = String(name || '');
  if (!s) return '';
  for (const [label, re] of PART_RULES) if (re.test(s)) return label;
  return '';
}
// 兜底（权重拿不到时）：按"离命中点最近的人形骨"给部位
const HUMANOID_PART_LABEL = {
  head: '头', neck: '脖子', hips: '腰胯', spine: '胸背', chest: '胸背', upperChest: '胸背',
  leftShoulder: '手臂', rightShoulder: '手臂',
  leftUpperArm: '手臂', rightUpperArm: '手臂', leftLowerArm: '手臂', rightLowerArm: '手臂',
  leftHand: '手', rightHand: '手',
  leftUpperLeg: '腿', rightUpperLeg: '腿', leftLowerLeg: '腿', rightLowerLeg: '腿',
  leftFoot: '脚', rightFoot: '脚', leftToes: '脚', rightToes: '脚',
};
const HUMANOID_PART_BONES = Object.keys(HUMANOID_PART_LABEL);
/**
 * 光标处是否真的打在模型表面；若打到，返回 {part, bone, point, dist}，否则 null。
 * ★ 与旧的 hitPet 有两点关键不同：①**只在窗口内真实光标**上判定（由调用方保证）；
 *   ②出错时返回 null（**不**判定为摸到）——旧 hitPet 在异常/引擎未就绪时 `return true`，会误触。
 */
// 表层命中的现场信息（给日志用）：表层骨名 / 网格名 / 材质名 / 跳过了几层覆盖物
const _touchInfo = { front: '', frontMesh: '', frontMat: '', skipped: 0 };
/** 只取"主导骨的名字"（与 touchHitPart 里的算法一致，但只返回名字，供"第几个命中算数"的筛选用） */
function _dominantBoneName(h) {
  try {
    const o = h && h.object, geo = o && o.geometry, f = h && h.face;
    if (!o || !geo || !f || !o.isSkinnedMesh || !o.skeleton) return '';
    const si = geo.attributes && geo.attributes.skinIndex, sw = geo.attributes && geo.attributes.skinWeight;
    if (!si || !sw) return '';
    const acc = Object.create(null);
    for (const vi of [f.a, f.b, f.c]) {
      for (let k = 0; k < 4; k++) {
        const idx = si.getComponent ? si.getComponent(vi, k) : si.array[vi * si.itemSize + k];
        const w = sw.getComponent ? sw.getComponent(vi, k) : sw.array[vi * sw.itemSize + k];
        if (!w || !(idx >= 0)) continue;
        acc[idx] = (acc[idx] || 0) + w;
      }
    }
    let best = -1, bw = -1;
    for (const k2 in acc) if (acc[k2] > bw) { bw = acc[k2]; best = +k2; }
    const b = (o.skeleton.bones || [])[best];
    return (b && b.name) ? String(b.name) : '';
  } catch (e) { return ''; }
}
// ★★ 「摸哪都是头发」的修法（2026-10-14 用户实测：部位总是头发）：
//   头发/衣服/裙摆/飘带/披风这些是**覆盖在身体外面的层**，射线最先打到的就是它们。
//   用户想知道的是"摸到身体哪里" ⇒ 表层落在覆盖物上时，**继续往后找第一个身体命中**（头/脸/手/手臂/胸/腿…）；
//   若整条射线全是覆盖物，才如实报覆盖物（并写明"表层"是什么）。
const COVER_RE = /hair|髪|发|髮|ウィッグ|ヘア|ponytail|前髪|後髪|skirt|スカート|裙|dress|ドレス|服|衣|cloth|裾|piao|飘|飄|带|帯|ベルト|リボン|ネクタイ|ribbon|cape|マント|披风|tail|尾|wing|翼|羽/i;
// ================= ★★ v11.0 命中判定：**骨头屏幕距离**（不再用三角射线）=================
// 为什么换掉射线：审计量出"单次射线 209 ms/次"（放大包围球后是逐三角全量测试）⇒ 一开鼠标摸就卡；
//   而"摸到哪"本来只需骨级精度：把人体骨 + 弹簧骨投到屏幕，取最近的一根（阈值随模型在屏幕上的大小自适应）
//   ⇒ 亚毫秒级、直接给出部位（骨名），并且完全不受"绑定姿势包围球/相机基准"那些坑影响。
let _bonePts = { t: -1e9, list: [] };
function boneScreenPoints() {
  const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  if (_bonePts.list.length && now - _bonePts.t < 60) return _bonePts.list;     // 60ms 内复用（省投影）
  const list = [];
  try {
    if (THREE && camera) {
      const cr = canvasRectCached();
      const add = (name, node) => {
        if (!node) return;
        try {
          const wp = node.getWorldPosition(new THREE.Vector3()).project(camera);
          if (!isFinite(wp.x) || !isFinite(wp.y) || wp.z > 1) return;          // 相机背后/无效点丢掉
          list.push({
            name: String(name || ''), node: node,
            x: cr.left + (wp.x * 0.5 + 0.5) * cr.w, y: cr.top + (-wp.y * 0.5 + 0.5) * cr.h
          });
        } catch (e) { }
      };
      if (vrm && vrm.humanoid) for (const bn of HUMANOID_PART_BONES) add(bn, vrm.humanoid.getNormalizedBoneNode(bn));
      try {
        for (const j of Array.from((vrm && vrm.springBoneManager && vrm.springBoneManager.joints) || [])) {
          if (j && j.bone) add(j.bone.name, j.bone);
        }
      } catch (e) { }
    }
  } catch (e) { }
  _bonePts = { t: now, list: list };
  return list;
}
// dry=true：只做判定，**不写** _touchInfo（状态行 / 审计 / 点按命中用；避免诊断动作污染"球该放哪"）
function touchHitBone(clientX, clientY, dry) {
  try {
    const list = boneScreenPoints();
    if (!list.length) return null;
    const rr = modelScreenRectCached();
    const lim = Math.max(14, (rr ? (rr.y1 - rr.y0) : 300) / 12);      // 命中半径：模型屏幕高的约 1/12
    let best = null, bestD = 1e9, bestBody = null, bestBodyD = 1e9;
    for (const p of list) {
      const d = Math.hypot(p.x - clientX, p.y - clientY);
      if (d > lim) continue;
      if (COVER_RE.test(p.name)) { if (d < bestD) { bestD = d; best = p; } }     // 头发/衣服/裙摆这类覆盖层
      else { if (d < bestBodyD) { bestBodyD = d; bestBody = p; } }                // 头/手/胸/腿…
    }
    const useP = bestBody || best;                                   // ★ 优先报"身体"，跳过覆盖层
    if (!useP) return null;
    let wp = null;
    if (!dry) {
      try { wp = useP.node.getWorldPosition(new THREE.Vector3()).clone(); } catch (e) { }
      _touchInfo.front = best ? best.name : '';
      _touchInfo.frontMesh = '(骨级判定，未用网格)';
      _touchInfo.frontMat = '';
      _touchInfo.skipped = (best && bestBody) ? 1 : 0;
      _touchInfo.frontPoint = wp;                                      // 球放在**表层那根骨**上
    }
    return {
      part: partLabelFromBone(useP.name) || '身体', bone: useP.name, point: wp,
      dist: (useP === bestBody ? bestBodyD : bestD), via: 'bone'
    };
  } catch (e) { return null; }
}
// ★★ 骨点插值定位（v11.7）：把"球心该放哪"从**离散的最近骨点**变成**连续的世界点** —— 取屏幕上最近的
//   3 根骨点做反距离加权。为什么需要（用户："滑动过程中，有一些部分没反应…得单独在那一块动才行"）：
//   骨级判定只在"离某根骨 ≤ lim"时给出点，两块布中间 / 发束中段 / 裙摆褶皱之间**没有骨头**，
//   光标扫过那里就没有定位点（旧逻辑还会把球缩回挪走）⇒ 那一段"划过去没反应"。
//   插值后：球心始终连续地跟着光标走，沿途的布/发都会被附近的骨带着推开。
//   返回 null = 离所有骨都太远（真的不在人物上）。
function touchBoneInterp(cx, cy) {
  try {
    if (!THREE) return null;
    const list = boneScreenPoints();
    if (!list.length) return null;
    let b1 = null, b2 = null, b3 = null, d1 = 1e9, d2 = 1e9, d3 = 1e9;
    for (const p of list) {
      const d = Math.hypot(p.x - cx, p.y - cy);
      if (d < d1) { d3 = d2; b3 = b2; d2 = d1; b2 = b1; d1 = d; b1 = p; }
      else if (d < d2) { d3 = d2; b3 = b2; d2 = d; b2 = p; }
      else if (d < d3) { d3 = d; b3 = p; }
    }
    if (!b1 || !b1.node) return null;
    const rr = modelScreenRectCached();
    const far = Math.max(36, (rr ? (rr.y1 - rr.y0) : 400) * 0.5);   // 离最近骨超过"模型屏幕高的一半"⇒ 不算在人物上
    if (d1 > far) return null;
    const w1 = 1 / ((d1 + 1) * (d1 + 1));
    const w2 = b2 ? 1 / ((d2 + 1) * (d2 + 1)) : 0;
    const w3 = b3 ? 1 / ((d3 + 1) * (d3 + 1)) : 0;
    const sum = w1 + w2 + w3;
    if (!(sum > 0)) return null;
    const out = new THREE.Vector3(), tmp = new THREE.Vector3();
    try { b1.node.getWorldPosition(tmp); out.addScaledVector(tmp, w1 / sum); } catch (e) { }
    try { if (b2) { b2.node.getWorldPosition(tmp); out.addScaledVector(tmp, w2 / sum); } } catch (e) { }
    try { if (b3) { b3.node.getWorldPosition(tmp); out.addScaledVector(tmp, w3 / sum); } } catch (e) { }
    return out;
  } catch (e) { return null; }
}
// ★★ 2026-10-14 关键修复（日志证据：视口内 252 帧、矩形内 18 帧、命中 **0** 帧）：
//   three.js 的 `Mesh.raycast` 会先用 **geometry.boundingSphere**（**绑定姿势**算出来的包围球）做快速排除：
//     `_sphere.copy(geometry.boundingSphere).applyMatrix4(matrixWorld); if (!ray.intersectsSphere(_sphere)) return;`
//   而蒙皮模型的顶点是被**骨骼**挪走的（VRM 的网格 matrixWorld 基本是单位矩阵）⇒ 绑定球还停在绑定姿势的位置，
//   往往**不在人物现在站的地方** ⇒ 球被排除 ⇒ **明明点在模型上也永远打不到**。
//   （这也解释了"偶尔能打到"：绑定球恰好罩住人物上半身那几帧才行；19:38 那几次命中就是这么来的。）
//   修法：把模型里所有网格的包围球**放大到一定罩住**，并关掉视锥剔除（宠物本来就一直可见 ⇒ 无视觉代价），
//   让 raycast 走到逐三角测试 —— 它用的是**蒙皮后**的顶点位置（`SkinnedMesh.getVertexPosition`）⇒ 结果正确。
let _rayPrepFor = null;
function prepRaycast() {
  try {
    const root = petRoot || (vrm && vrm.scene) || mmdMesh;
    if (!root || !THREE || _rayPrepFor === root) return;
    _rayPrepFor = root;
    const box = new THREE.Box3().setFromObject(root);
    const sz = box.isEmpty() ? 2 : Math.max(0.5, box.getSize(new THREE.Vector3()).length());
    let n = 0;
    root.traverse(o => {
      if (!o.isMesh && !o.isSkinnedMesh) return;
      o.frustumCulled = false;
      const g = o.geometry;
      if (!g) return;
      try {
        if (!g.boundingSphere) g.computeBoundingSphere();
        if (g.boundingSphere && g.boundingSphere.radius < sz * 4) { g.boundingSphere.radius = sz * 4; n++; }
      } catch (e) { }
    });
    if (n) postLog('info', '鼠标摸：已为射线放大 ' + n + ' 个网格的包围球（绑定姿势的球不在人物位置上，'
      + '会让"明明点在模型上却打不到"；放大后走逐三角测试，用蒙皮后的顶点 ⇒ 命中正确）');
  } catch (e) { }
}
// ★★ 已停用（2026-10-14 第四轮）：这是**射线**版命中（逐三角 + 蒙皮顶点，对十万面模型实测
//   **244.9 ms/次**）—— 生产路径早在 v11.0 就换成骨级判定了。保留实现仅供将来极端情况参考，
//   但**任何逐帧/周期性代码都不许再调它**（会直接卡住主线程）。
function touchHitPart(clientX, clientY) {
  try {
    const target = petRoot || mmdMesh;
    if (!THREE || !camera || !target) return null;
    prepRaycast();
    // ★ NDC 必须按**画布矩形**算（与渲染同一基准）。用 window.innerWidth 时，面板加宽画布后
    //   两者会错位 ⇒ "模型矩形"和射线一起偏 ⇒ 明明点在人物上却打不到（用户实测 矩形内 68 帧、命中 0）。
    const cr = canvasRectCached();
    const ndc = new THREE.Vector2(
      ((clientX - cr.left) / cr.w) * 2 - 1,
      -((clientY - cr.top) / cr.h) * 2 + 1);
    const rc = new THREE.Raycaster();
    rc.setFromCamera(ndc, camera);
    const hits = rc.intersectObject(target, true).filter(h => {
      const o = h.object;
      if (!o || o.visible === false) return false;                      // 隐形遮挡面片不算（有些模型带大号辅助面）
      const m = Array.isArray(o.material) ? o.material[0] : o.material;
      if (!m || m.visible === false) return false;
      if (m.transparent && (m.opacity || 0) <= 0.02) return false;      // 全透明材质不算
      return true;
    });
    if (!hits.length) return null;
    // ★ 从"表层命中"往后找**第一个身体命中**（跳过头发/衣服/裙摆/飘带这类覆盖层，见 COVER_RE 注释）。
    //   表层骨名/网格/材质也记进 _touchInfo ⇒ 日志里能核对"到底摸到了哪一层"。
    let h = hits[0], skipped = 0;
    _touchInfo.front = _dominantBoneName(h) || '';
    // ★ "部位"报身体，但**球要放在表层**（否则球埋进身体里，头发/裙子不会被顶开 ⇒ 手感全无）
    try { _touchInfo.frontPoint = hits[0].point ? hits[0].point.clone() : null; } catch (e) { _touchInfo.frontPoint = null; }
    try {
      const o0 = h.object, m0 = Array.isArray(o0.material) ? o0.material[0] : o0.material;
      _touchInfo.frontMesh = String(o0.name || '') || '(无名网格)';
      _touchInfo.frontMat = String((m0 && m0.name) || '') || '(无名材质)';
    } catch (e) { }
    if (_touchInfo.front && COVER_RE.test(_touchInfo.front)) {
      const lim = Math.min(hits.length, 24);
      for (let i = 1; i < lim; i++) {
        const nm = _dominantBoneName(hits[i]);
        if (nm && !COVER_RE.test(nm)) { h = hits[i]; skipped = i; break; }
      }
    }
    _touchInfo.skipped = skipped;
    let bone = '';
    try {                                                               // ① 蒙皮权重 → 主导骨
      const o = h.object, geo = o.geometry, f = h.face;
      if (o.isSkinnedMesh && geo && geo.attributes && geo.attributes.skinIndex && geo.attributes.skinWeight && f && o.skeleton) {
        const si = geo.attributes.skinIndex, sw = geo.attributes.skinWeight;
        const acc = Object.create(null);
        for (const vi of [f.a, f.b, f.c]) {
          for (let k = 0; k < 4; k++) {
            const idx = si.getComponent ? si.getComponent(vi, k) : si.array[vi * si.itemSize + k];
            const w = sw.getComponent ? sw.getComponent(vi, k) : sw.array[vi * sw.itemSize + k];
            if (!w || !(idx >= 0)) continue;
            acc[idx] = (acc[idx] || 0) + w;
          }
        }
        let best = -1, bw = -1;
        for (const k2 in acc) if (acc[k2] > bw) { bw = acc[k2]; best = +k2; }
        const b = (o.skeleton.bones || [])[best];
        if (b && b.name) bone = String(b.name);
      }
    } catch (e) { }
    let part = partLabelFromBone(bone);
    if (!part) {                                                        // ② 兜底：最近的人形骨
      try {
        let bestD = 1e9, bestName = '';
        if (vrm && vrm.humanoid && h.point) {
          const wp = new THREE.Vector3();
          for (const bn of HUMANOID_PART_BONES) {
            const n = vrm.humanoid.getNormalizedBoneNode(bn);
            if (!n) continue;
            n.getWorldPosition(wp);
            const d = wp.distanceToSquared(h.point);
            if (d < bestD) { bestD = d; bestName = bn; }
          }
        }
        // ★ 只有"确实离那根人形骨很近"才接受它 —— 否则会给出离谱部位（用户实测：飘带骨 `Bone_Piao112_R`
        //   被最近的"头"骨抢走 ⇒ 报「头」）。离得远就如实归「配件/其他」，不硬套。
        const _near = (modelHeight || 1) * 0.12;
        if (bestName && bestD <= _near * _near) { bone = bone || bestName; part = partLabelFromBone(bestName) || HUMANOID_PART_LABEL[bestName] || ''; }
      } catch (e) { }
    }
    if (!part) part = '身体';
    return { part: part, bone: bone, point: h.point ? h.point.clone() : null, dist: h.distance };
  } catch (e) { return null; }
}
// 没摸到时把碰撞球**挪到很远处**：物理上不再推任何东西
// （旧写法球一直浮在"模型中心深度"处 ⇒ 鼠标只是悬在窗口里，头发/裙子也会动 = 另一种"没碰就反应"）
function parkTouchBall() {
  if (!touchRig) return;
  touchBallPos = null; touchBallPrev = null; touchBallSweep = 0;   // 松手/离开：平滑状态一并清空，下次触摸从命中点重新落位
  touchBallR = 0;                                                  // 半径归零：下次进入时"从 0 长起来"，不会一进门就硬推一下
  touchAnchorPx = null; touchAnchorWp = null;                      // 锚点一并清空（下次触摸重新采点）
  touchPxAcc = 0; touchPxLastX = null;
  try { if (touchCollider && touchCollider.shape) touchCollider.shape.radius = 0; } catch (e) { }
  try { touchRig.position.set(1000, 1000, 1000); touchRig.updateWorldMatrix(true, false); } catch (e) { }
  if (touchCollider) {
    try { touchCollider.updateWorldMatrix(true, false); } catch (e) { }
    if (typeof touchCollider.updateColliderMatrix === 'function') { try { touchCollider.updateColliderMatrix(); } catch (e) { } }
  }
}
// ================= ★★ 「鼠标摸」的光标来源：窗口内事件 + 宿主全屏光标换算 =================
// 背景（2026-10-14 用户："依旧没反应"，日志里连一行诊断都没有）：
//   本机窗口是**按模型轮廓像素级穿透**的（见 C# 的 pet_mask / SetBodyMask）⇒ 光标落在人物上时
//   未必有 mousemove 进窗口 ⇒ `cursorLocal` 长期为空 ⇒ 摸这条链每一步都被**静默**挡掉。
//   而宿主**一直在下发全屏光标**（给"头跟着鼠标转"用）。两者一凑：只要知道**窗口在屏幕上的位置**，
//   就能把全屏坐标换算成窗口内坐标 ⇒ 完全不依赖 mousemove。
// 用法：窗口内事件优先（最准）；没有或过期(>1.2s) 就用换算值。两条都有时**互相校对**（诊断行写误差）。
let winRect = null;          // {x,y,w,h} 物理像素（宿主 need_rect 回包）
let cursorScreen = null;     // {x,y,w,h,t} 宿主下发的全屏光标（像素）
let _winReqT = -1e9;
// ★★ 「宿主光标 ↔ 窗口内坐标」的换算**用真实事件学出来**（2026-10-14：靠 window.screenX 猜、靠"物理还是
//   CSS 像素"猜都失败过 —— 日志里 4 个候选全不命中）。每当窗口里真的收到 mousemove（光标在设置面板上、
//   或按穿透规则停在模型轮廓上时都会有），它和宿主同一时刻下发的光标就构成**一对**
//   ⇒ 偏差 = 宿主坐标 − 本窗口坐标×dpr ⇒ 平均几次就定了，还能存下来复用。
let cursorOffset = null;     // {x,y,n}
let _lastLearnT = -1e9;
try {
  const _s = JSON.parse(localStorage.getItem('petCursorOffset') || 'null');
  if (_s && isFinite(_s.x) && isFinite(_s.y)) cursorOffset = { x: +_s.x, y: +_s.y, n: 3 };
} catch (e) { }
function learnCursorOffset() {
  try {
    if (!cursorLocal || !cursorScreen) return;
    const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    if (now - (cursorLocal.t || 0) > 250) return;          // 两个来源要"同时"才算一对
    if (now - (cursorScreen.t || 0) > 250) return;
    if (now - _lastLearnT < 150) return;                   // 别太密
    _lastLearnT = now;
    // ★ 同一套 CSS 基准（v11.0 审计定案）：宿主下发的是 **CSS 屏幕像素**，窗口事件是 **CSS 页面像素**
    //   ⇒ 偏移 = 直接相减。旧的实现乘了 dpr（差 1.5 倍），所以学出来的偏移也是错的。
    const ox = cursorScreen.x - cursorLocal.x;
    const oy = cursorScreen.y - cursorLocal.y;
    if (!cursorOffset) cursorOffset = { x: ox, y: oy, n: 1 };
    else { cursorOffset.x += (ox - cursorOffset.x) * 0.34; cursorOffset.y += (oy - cursorOffset.y) * 0.34; cursorOffset.n++; }
    if (cursorOffset.n === 1 || cursorOffset.n % 20 === 0) {
      postLog('info', '鼠标摸：已学到「宿主光标→窗口坐标」的换算（偏移 ' + Math.round(cursorOffset.x) + ',' + Math.round(cursorOffset.y)
        + '，样本 ' + cursorOffset.n + '）⇒ 之后用它定位');
      try { localStorage.setItem('petCursorOffset', JSON.stringify({ x: cursorOffset.x, y: cursorOffset.y })); } catch (e) { }
    }
  } catch (e) { }
}
/** 光标（页面 CSS 像素）是否落在**画布**范围内（带 2px 容差）—— 与渲染同一基准 */
function cursorInViewport(x, y) {
  const cr = canvasRectCached();
  return x >= cr.left - 2 && y >= cr.top - 2 && x <= cr.left + cr.w + 2 && y <= cr.top + cr.h + 2;
}
function requestWinRect() {
  const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  if (now - _winReqT < 3000) return;                 // 3 秒最多问一次
  _winReqT = now;
  try { sendMenu('need_rect', {}); } catch (e) { }
}
/** 窗口在屏幕上的矩形（物理像素）：优先宿主回包；**没有就用浏览器自己的 screenX/screenY 兜底**
 *  （这样即使 C# 那边没重载、need_rect 没人应答，换算照样成立）。 */
function curWinRect() {
  if (winRect) return winRect;
  try {
    const dpr = window.devicePixelRatio || 1;
    const sx = (typeof window.screenX === 'number') ? window.screenX : window.screenLeft;
    const sy = (typeof window.screenY === 'number') ? window.screenY : window.screenTop;
    if (typeof sx === 'number' && typeof sy === 'number' && (sx || sy))
      return { x: sx * dpr, y: sy * dpr, w: window.innerWidth * dpr, h: window.innerHeight * dpr, from: 'window.screenX' };
  } catch (e) { }
  return null;
}
let _curMode = '';               // 已被**命中证实**过的光标来源（'learn' / 'evt' / 'rect' / 'css' / 'win'）
/** 候选光标（窗口内 CSS 像素），按"上次证实过的来源"优先排序 */
function touchCursorCandidates() {
  const out = [];
  try {
    const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    if (cursorLocal && (now - (cursorLocal.t || 0)) < 1200) out.push({ x: cursorLocal.x, y: cursorLocal.y, src: '窗口事件', mode: 'evt' });
    if (cursorScreen && cursorScreen.w > 0) {
      const sx = (typeof window.screenX === 'number') ? window.screenX : window.screenLeft;
      const sy = (typeof window.screenY === 'number') ? window.screenY : window.screenTop;
      // ★★ 审计定案（v11.0）：宿主下发的是 **CSS 像素的屏幕坐标**（w=1707 = 2560/1.5），
      //    而 window.screenX/screenY 同样是 CSS 像素 ⇒ **直接相减**，绝不乘/除 dpr。
      //    旧实现乘了 dpr（差 1.5 倍）⇒ 候选永远碰不上 —— 这就是"摸不到"的最后一环
      //    （审计铁证：画布基准/window 基准 5/7 全中，而候选全 ✗）。
      if (typeof sx === 'number') {
        const lx = cursorScreen.x - sx, ly = cursorScreen.y - sy;
        if (cursorInViewport(lx, ly)) out.push({ x: lx, y: ly, src: '屏幕坐标−窗口位置(screenX)', mode: 'sx' });
      }
      // 学到的换算（同一套 CSS 基准，见 learnCursorOffset；样本足够多时它最准）
      if (cursorOffset) {
        const lx = cursorScreen.x - cursorOffset.x, ly = cursorScreen.y - cursorOffset.y;
        if (cursorInViewport(lx, ly)) out.push({ x: lx, y: ly, src: '已学到的换算', mode: 'learn' });
      }
      // 兜底：宿主 need_rect 回包是 Win32 **物理**像素 ⇒ 这里才需要 ÷dpr
      if (winRect) {
        const dpr = window.devicePixelRatio || 1;
        const lx = (cursorScreen.x - winRect.x) / dpr, ly = (cursorScreen.y - winRect.y) / dpr;
        if (cursorInViewport(lx, ly)) out.push({ x: lx, y: ly, src: '宿主窗口回包换算(÷dpr)', mode: 'rect' });
      }
      // 最后兜底：万一宿主下发的本来就是窗口内坐标
      out.push({ x: cursorScreen.x, y: cursorScreen.y, src: '宿主坐标直接用', mode: 'win' });
    }
  } catch (e) { }
  if (_curMode) out.sort((a, b) => (a.mode === _curMode ? -1 : 0) - (b.mode === _curMode ? -1 : 0));
  return out;
}
// 命中统计（给状态行用）：最近一次命中 / 5 秒内次数 / 命中时用的来源
let _hitStat = { n: 0, t0: -1e9, t: -1e9, part: '', src: '' };
let _hitLogT = -1e9;
/** 触摸判定用的光标（状态行 / 拨骨用：取首个候选） */
function touchCursor() { const c = touchCursorCandidates(); return c.length ? c[0] : null; }
// ★★ 射线节流：对十万面的蒙皮模型做 raycast 很贵（每帧做 = 卡顿，用户实测"开了还会有点卡顿"）。
//   90ms 内一律复用上次结果 ⇒ 上限 ≈11 次/秒，肉眼无差别。
let _hitCache = null;
function touchHitThrottled(x, y) {
  const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  // ★★ 2026-10-14 关键修复：缓存必须**按坐标**命中才算复用。原来只看"90ms 内"，
  //   于是同一帧里测试第 2、3 个候选时，直接返回第 1 个候选的 miss ⇒ **后面的候选永远没被真正测过**
  //   （日志现场：候选 (69,312) 明明落在"模型屏幕矩形 38,187→369,585"里，却报未命中，而其它候选连 ✗ 都没打出来）。
  if (_hitCache && now - _hitCache.t < 90 && Math.abs(_hitCache.x - x) < 2 && Math.abs(_hitCache.y - y) < 2) return _hitCache.hit;
  const hit = touchHitPart(x, y);
  _hitCache = { x: x, y: y, t: now, hit: hit };
  return hit;
}
// 状态行（5 秒一条，只在「鼠标摸」开着时）：把"为什么没反应"的每个门一次性写出来
let touchDiagT = -1e9;
// 每帧统计（状态行打印后清零）：光标落在视口内的帧数 / 落在模型矩形内的帧数 / 命中次数
//   三个数一起看就能判定卡在哪：视口内=0 ⇒ 光标根本没进窗口（或窗口矩形算错）；
//   矩形内>0 但命中=0 ⇒ 位置对了但射线打不到（网格/相机问题）；命中>0 ⇒ 功能在跑。
let _diagStat = { view: 0, rect: 0, hit: 0 };
// ★ v11.9 纠错：状态行曾经把"光标在视口内的帧数/5"当成 fps 显示 —— 那**不是帧率**！
//   光标一旦不在窗口里就会显示 fps≈0/8/10（日志里那几行全是这么来的），会把人往"掉帧"上带偏。
//   这里单独记**真实帧数**（renderTick 每帧 +1），由状态行读取并清零。
let _frameN = 0;
// 模型在屏幕上的矩形（CSS px），缓存 500ms —— 每帧 setFromObject 太贵（会卡）
// ★★ 2026-10-14 关键：**必须用"画布自己的矩形"当基准**，不能用 window.innerWidth/innerHeight。
//   渲染是按画布投的影；面板加宽后画布宽度与窗口宽度可以不同（面板一开，画布 420→744，窗口未必同步）
//   ⇒ 用窗口宽算 NDC，"模型矩形"和射线会**一起偏**（所以日志显示"在矩形里"却一次都打不到：
//   用户实测 矩形内 68 帧、命中 0 帧）。修法：矩形、NDC、视口判定全部改用画布矩形。
let _rectCache = { t: -1e9, r: null };
let _cvRect = { t: -1e9, r: null };
function canvasRectCached() {
  const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  if (_cvRect.r && now - _cvRect.t < 300) return _cvRect.r;
  let r = null;
  try {
    if (canvas && canvas.getBoundingClientRect) {
      const b = canvas.getBoundingClientRect();
      if (b && b.width > 1 && b.height > 1) r = { left: b.left, top: b.top, w: b.width, h: b.height };
    }
  } catch (e) { }
  if (!r) r = { left: 0, top: 0, w: window.innerWidth, h: window.innerHeight };
  _cvRect = { t: now, r: r };
  return r;
}
function modelScreenRectCached() {
  const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  if (_rectCache.r && now - _rectCache.t < 500) return _rectCache.r;
  let r = null;
  try {
    const obj = petRoot || (vrm && vrm.scene) || mmdMesh;
    if (obj && THREE && camera) {
      const box = new THREE.Box3().setFromObject(obj);
      if (!box.isEmpty()) {
        const cr = canvasRectCached();
        let a = 1e9, b = -1e9, d = 1e9, e2 = -1e9;
        const v = new THREE.Vector3();
        for (let i = 0; i < 8; i++) {
          v.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).project(camera);
          const px = cr.left + (v.x * 0.5 + 0.5) * cr.w, py = cr.top + (-v.y * 0.5 + 0.5) * cr.h;
          a = Math.min(a, px); b = Math.max(b, px); d = Math.min(d, py); e2 = Math.max(e2, py);
        }
        if (isFinite(a) && b > a) r = { x0: a, y0: d, x1: b, y1: e2 };
      }
    }
  } catch (e) { }
  _rectCache = { t: now, r: r };
  return r;
}
function pointInRect(r, x, y) {
  return !!(r && x >= r.x0 - 2 && x <= r.x1 + 2 && y >= r.y0 - 2 && y <= r.y1 + 2);
}
function touchDiagTick() {
  const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  if (now - touchDiagT < 5000) return;
  touchDiagT = now;
  try {
    const c = touchRig ? touchRig.position : (touchGroup && touchGroup.position);
    const parked = !c || c.x > 500;
    // ① 模型在屏幕上的矩形（CSS px，缓存 500ms）—— "光标到底在不在人物上"一眼可判
    const rr = modelScreenRectCached();
    const rectTxt = rr
      ? (Math.round(rr.x0) + ',' + Math.round(rr.y0) + '→' + Math.round(rr.x1) + ',' + Math.round(rr.y1))
      : '未知';
    // ② 每个候选各自命中情况（✓后面是识别到的部位）—— 哪条换算对，一目了然
    //   ★★ 2026-10-14 第四轮：这里原来调 `touchHitPart`（射线，**实测 244.9 ms/次**）⇒ 状态行每 5 秒
    //     卡 0.25~0.5 秒，正是用户说的"略微卡顿"。诊断工具绝不能拖慢正主 ⇒ 改用**骨级判定**（生产路径，μs 级）。
    const cands = touchCursorCandidates();
    const candTxt = cands.length ? cands.map(cc => {
      const h = touchHitBone(cc.x, cc.y, true);
      return '[' + cc.src + '(' + Math.round(cc.x) + ',' + Math.round(cc.y) + ')' + (h ? ('✓' + h.part) : '✗') + ']';
    }).join('') : '**无可用光标**';
    // ③ 最近 5 秒命中次数（区分"没摸着"与"摸着但推不动"）
    const since = (_hitStat.t > 0) ? ((now / 1000 - _hitStat.t).toFixed(1) + ' 秒前') : '—';
    const _crD = canvasRectCached();
    postLog('info', '鼠标摸状态：开关=' + (touchPhysicsOn ? '开' : '关')
      + '｜画布=' + Math.round(_crD.left) + ',' + Math.round(_crD.top) + ' ' + Math.round(_crD.w) + 'x' + Math.round(_crD.h)
      + '（window.innerWH=' + window.innerWidth + 'x' + window.innerHeight + '，dpr=' + (window.devicePixelRatio || 1) + '）'
      + '｜模型屏幕矩形=' + rectTxt + '（CSSpx）'
      + '｜候选=' + candTxt
      + '｜帧率 ' + (_frameN / 5).toFixed(0) + ' fps（最近 5 秒 ' + _frameN + ' 帧）'
      + '｜光标在视口内 ' + _diagStat.view + ' 帧、矩形内 ' + _diagStat.rect + ' 帧、命中 ' + _diagStat.hit + ' 帧'
      + (_hitStat.part ? ('（最后「' + _hitStat.part + '」来源「' + _hitStat.src + '」，' + since + '）') : '')
      + '｜球=' + (c ? (parked ? '已挪走' : ('光标处·半径 ' + (+(touchBallR || 0)).toFixed(3)
        + '｜锚点' + (touchAnchorWp ? ('(' + touchAnchorWp.x.toFixed(2) + ',' + touchAnchorWp.y.toFixed(2) + ',' + touchAnchorWp.z.toFixed(2) + ')') : '(未采)')
        + (touchPokeFallback ? '｜物理实测没推出去⇒走拨骨保底' : ''))) : '未挂载'));
    _hitStat.n = 0;                                  // 每 5 秒清零 ⇒ 这些数就是"最近 5 秒"的
    _diagStat.view = 0; _diagStat.rect = 0; _diagStat.hit = 0;
    _frameN = 0;
  } catch (e) { }
}

// ================= ★★ 「鼠标摸」的**保底**实现：直接拨骨（与 three-vrm 版本无关）=================
// 起因（用户实测 2026-10-14）："这个碰撞物开了还是没反应，完全无效"。
// 根因：本机 three-vrm **没导出**碰撞体类，只能"借壳"造球（`new (sample.constructor)()`）；
//   而借壳实例的私有字段（有的版本是 `#bone` / `#colliders`）**赋不上去** ⇒ 求解器眼里这个球是空的
//   （日志看着"挂上 174 根弹簧骨"，实际一次碰撞都没发生）。
// 与其继续猜各版本的内部结构，这里补一条**与版本无关**的路：
//   在 `vrm.update(dt)`（弹簧骨求解）**之后**，把光标球附近的关节**直接拧一点**。
// ★★ 2026-10-14 第三轮定性：这条路**只在物理球实测推不动时才允许跑**（touchPokeFallback）。
//   它是"硬写姿态"：求解器下一帧就用自己的位置状态重算 ⇒ 表现必然是"抽一下就回来"
//   （日志 22:26:49 抓到：`弹簧骨·Bone_Hair001_M 单帧跳 27°，0.07s 内又回到 5° 内`，同时无任何动作在播）
//   ⇒ 默认关；物理球一实测通过就永远不走这里。单帧角度也一并从 0.32rad 降到 0.10rad（≈5.7°）。
//   （touchPokeFallback 的声明在触摸变量区，那里 ensureTouchCollider 会写、这里每帧读）
let _tpV1 = null, _tpV2 = null, _tpV3 = null, _tpQ = null, _tpQ2 = null;
let touchPokeLogT = -1e9;
function applyTouchPoke() {
  try {
    if (!touchPokeFallback) return;                             // ★ 物理球能用 ⇒ 这条路不跑（抽搐来源）
    if (!touchPhysicsOn || !vrm || !vrm.springBoneManager || !THREE) return;
    if (!touchCursor()) return;                                  // 光标来源见 touchCursor（窗口事件优先，全屏换算兜底）
    const center = touchRig ? touchRig.position : (touchGroup && touchGroup.position);
    if (!center) return;
    if (center.x > 500 || center.y > 500) return;                // 被 parkTouchBall 挪远 = 没摸到
    if (!_tpV1) {
      _tpV1 = new THREE.Vector3(); _tpV2 = new THREE.Vector3(); _tpV3 = new THREE.Vector3();
      _tpQ = new THREE.Quaternion(); _tpQ2 = new THREE.Quaternion();
    }
    const sc = (lastOpts && lastOpts.scale) || 1;
    const R = Math.max(0.02, touchRadius() * sc * 1.8);           // 影响半径（略大于球 ⇒ 手感更"实"）
    const R2 = R * R;
    // ★ 拨动强度按"球这一帧扫过的距离"给：球不动 ⇒ 不拨。
    //   旧写法每帧固定拧 0.32rad（与光标速度无关）⇒ 光标停着也一直抽打头发 = "不自然"；
    //   现在：一次扫过 0.35R 即满力，慢移轻拨、快移重拨、停手不拨（求解器自己的回弹把头发拉回去）。
    const sweep = touchBallSweep || 0;
    if (sweep <= 1e-4) return;
    const power = Math.min(1, sweep / (R * 0.35));
    let n = 0;
    const joints = Array.from(vrm.springBoneManager.joints || []);
    for (const j of joints) {
      if (n >= 60) break;                                        // 上限：一帧最多拧 60 根
      const bone = j && j.bone;
      if (!bone || !bone.parent) continue;
      bone.getWorldPosition(_tpV1);
      const d2 = _tpV1.distanceToSquared(center);
      if (d2 > R2) continue;
      // 链的方向 ≈ 骨头 → 第一根子骨（没有子骨就按 +Y 近似）
      let haveDir = false;
      const ch = bone.children && bone.children[0];
      if (ch && ch.getWorldPosition) {
        ch.getWorldPosition(_tpV2);
        haveDir = _tpV2.distanceToSquared(_tpV1) > 1e-10;
      }
      if (!haveDir) { _tpV2.copy(_tpV1); _tpV2.y += 0.05; }
      const chainDir = _tpV3.copy(_tpV2).sub(_tpV1);
      if (chainDir.lengthSq() < 1e-12) continue;
      chainDir.normalize();
      const pushDir = new THREE.Vector3().copy(_tpV1).sub(center);
      if (pushDir.lengthSq() < 1e-12) pushDir.set(0, 0.001, 0);
      pushDir.normalize();
      const axis = new THREE.Vector3().crossVectors(chainDir, pushDir);   // 让链朝"被推离"的方向偏
      if (axis.lengthSq() < 1e-10) continue;
      axis.normalize();
      const fall = Math.max(0.2, 1 - Math.sqrt(d2) / R);          // 越近拨得越狠
      const pq = _tpQ;
      bone.parent.getWorldQuaternion(pq);                         // 轴转到"父空间"再 premultiply
      pq.invert();
      axis.applyQuaternion(pq);
      const dq = _tpQ2.setFromAxisAngle(axis, 0.10 * fall * power);   // ★ 0.32 → 0.10（保底路径也别抽）
      bone.quaternion.premultiply(dq);
      n++;
    }
    if (n > 0) {
      const now = nowS_();
      if (now - touchPokeLogT > 3) {
        touchPokeLogT = now;
        postLog('info', '鼠标摸：拨动 ' + n + ' 根弹簧骨（球心 ' + center.x.toFixed(2) + ',' + center.y.toFixed(2) + ',' + center.z.toFixed(2)
          + '｜半径 ' + R.toFixed(3) + '｜本帧扫过 ' + sweep.toFixed(3) + '（力度 ' + Math.round(power * 100) + '%）'
          + '）—— 看到这行说明"摸"真的作用到骨头上了');
      }
    }
  } catch (e) { }
}
// ▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼ 一次性触摸审计（验完后**删这一段 + touchTick 里那 3 行调用**即可）▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼
// 为什么要有（用户原话："多搞点探针一次性验完再删了算了，太费劲了"）：
//   "鼠标摸"这条链有 6 个环节（画布基准 → NDC → 相机 → 射线 → 命中筛选 → 拨骨），
//   每轮只靠一行状态行排查就要重载一次，太慢。这个审计**自带参照物**：
//   拿模型自己的骨头投影出屏幕坐标，再用**三种方式**去点它（点/拖用的 hitPet、画布基准、window 基准）
//   ⇒ 完全绕开光标/窗口坐标换算，一次判定"问题在基准、在射线、还是在光标来源"。
let _touchAuditDone = false, _touchAuditT0 = 0;
function petTouchAudit() {
  const out = [];
  const L = (k, v) => out.push('  · ' + k + '：' + v);
  try {
    const cr = canvasRectCached();
    let rsz = '(无)';
    try { const v2 = new THREE.Vector2(); renderer.getSize(v2); rsz = v2.x + 'x' + v2.y; } catch (e) { }
    const asp = camera ? camera.aspect : 0;
    L('画布矩形', Math.round(cr.left) + ',' + Math.round(cr.top) + ' ' + Math.round(cr.w) + 'x' + Math.round(cr.h));
    L('窗口 / dpr', window.innerWidth + 'x' + window.innerHeight + '｜dpr=' + (window.devicePixelRatio || 1));
    L('渲染器 / 相机', 'renderer=' + rsz + '｜camera.aspect=' + asp.toFixed(3) + '｜画布宽高比=' + (cr.w / cr.h).toFixed(3)
      + (Math.abs(asp - cr.w / cr.h) > 0.02 ? '  ⚠ 不一致 ⇒ 基准偏' : '  ✓ 一致'));
    // ① 参照物：用骨头当"已知点"，量"点它中不中"
    //   ★★ 2026-10-14 第四轮：这里原来跑三路点法（含两次**射线**，实测 244.9ms/次 × 21 次 ≈ 启动后卡 5 秒）。
    //     现在生产路径本来就是"骨级判定"（v11.0 起，见 touchHitBone）⇒ 审计跟着改成两条**便宜**的路：
    //     骨级判定（摸/拖/部位识别）与 hitPet（点击入口：骨级 + 模型屏幕矩形兜底）。
    const BONES = ['head', 'leftHand', 'rightHand', 'leftFoot', 'rightFoot', 'hips', 'chest'];
    let n = 0, hBone = 0, hPet = 0;
    for (const bn of BONES) {
      let node = null;
      try { node = vrm && vrm.humanoid && vrm.humanoid.getNormalizedBoneNode(bn); } catch (e) { }
      if (!node || !THREE || !camera) continue;
      n++;
      let sx = 0, sy = 0;
      try {
        const wp = node.getWorldPosition(new THREE.Vector3()).project(camera);
        sx = cr.left + (wp.x * 0.5 + 0.5) * cr.w;
        sy = cr.top + (-wp.y * 0.5 + 0.5) * cr.h;
      } catch (e) { }
      let a = '✗';                                  // ① 骨级判定（摸 / 拖 / 部位识别都走它）
      try { a = touchHitBone(sx, sy, true) ? '✓' : '✗'; if (a === '✓') hBone++; } catch (e) { a = '?'; }
      let b = '✗';                                  // ② hitPet（点击入口：骨级 + 模型矩形兜底）
      try { b = hitPet(sx, sy) ? '✓' : '✗'; if (b === '✓') hPet++; } catch (e) { b = '?'; }
      L('骨 ' + bn, '屏幕 ' + Math.round(sx) + ',' + Math.round(sy) + '｜骨级判定=' + a + '｜hitPet=' + b);
    }
    L('参照物统计', '共 ' + n + ' 根骨｜骨级判定 ' + hBone + '｜hitPet ' + hPet
      + (hBone === n ? '  ⇒ 命中这条链是通的（摸/点/拖全走骨级判定，不再用射线）'
        : (hBone >= 1 ? '  ⇒ 部分命中（临界情况，正常）' : '  ⇒ 一根都不中：把这几行发我')));
    // ② 光标来源与候选
    L('光标来源', '窗口事件=' + (cursorLocal ? Math.round(cursorLocal.x) + ',' + Math.round(cursorLocal.y) : '无')
      + '｜宿主下发=' + (cursorScreen ? Math.round(cursorScreen.x) + ',' + Math.round(cursorScreen.y) + '(w' + Math.round(cursorScreen.w) + ')' : '无')
      + '｜已学偏移=' + (cursorOffset ? (Math.round(cursorOffset.x) + ',' + Math.round(cursorOffset.y) + '(n=' + cursorOffset.n + ')') : '无'));
    let candTxt = '无候选';
    try {
      candTxt = touchCursorCandidates().map(cc => cc.src + '(' + Math.round(cc.x) + ',' + Math.round(cc.y) + ')'
        + (touchHitBone(cc.x, cc.y, true) ? '✓' : '✗')).join('、') || '无候选';
    } catch (e) { }
    L('候选与命中', candTxt);
    // ③ 弹簧骨 / 物理 / 球 与"球能影响几根"
    try {
      const js = Array.from((vrm && vrm.springBoneManager && vrm.springBoneManager.joints) || []);
      L('鼠标摸开关', ((touchPhysicsOn || touchPhysicsEnabled())
        ? ('开（物理球' + (touchPokeFallback ? ' + **拨骨保底**（物理实测没推出去）' : '，拨骨保底已关闭') + '）')
        : '**关**（球不会挂、也不会拨骨 ⇒ 位置再对也没反应）—— 请在设置面板「互动触发」里打开「鼠标摸（把光标当手指）」'));
      L('弹簧骨', js.length + ' 根｜链 ' + springChains().length + ' 条｜物理=' + (vrmPhysicsOn ? '开' : '关')
        + '｜球=' + (touchGroup ? (touchMode || '已挂') : '未挂') + '｜半径=' + touchRadius().toFixed(3));
      // ★ 决定性探针：关节到底有哪些属性、我们的球出现在哪几个列表里
      //   ⇒ "球没作用"时，这一行直接给出求解器读的是哪个结构（不用再猜、也不用再改一版试一版）。
      try {
        const j0 = js[0] || null;
        if (j0) {
          const keys = Object.keys(j0);
          const inside = [];
          for (const k of keys.concat(['settings'])) {
            const v = (k === 'settings') ? j0.settings : j0[k];
            if (!v) continue;
            if (Array.isArray(v) && v.indexOf(touchGroup) >= 0) inside.push(k);
            else if (typeof v.has === 'function' && v.has(touchGroup)) inside.push(k + '(Set)');
            else if (Array.isArray(v.items) && v.items.indexOf(touchGroup) >= 0) inside.push(k + '.items');
          }
          L('关节结构 / 球是否在内', '关节属性=[' + keys.join(',') + ']｜settings=[' + Object.keys(j0.settings || {}).join(',')
            + ']｜我们的球在=[' + (inside.join(',') || '无') + ']');
        }
      } catch (e) { L('关节结构探针异常', (e && e.message) || e); }
      let inR = 0, R = Math.max(0.02, touchRadius() * ((lastOpts && lastOpts.scale) || 1) * 1.8);
      const ctr = touchRig ? touchRig.position : null;
      if (ctr && ctr.x < 500) {
        const wp = new THREE.Vector3();
        for (const j of js) { if (!j || !j.bone) continue; j.bone.getWorldPosition(wp); if (wp.distanceToSquared(ctr) <= R * R) inR++; }
      }
      L('球的影响范围', '半径 ' + R.toFixed(3) + '｜当前球心' + (ctr ? ('(' + ctr.x.toFixed(2) + ',' + ctr.y.toFixed(2) + ',' + ctr.z.toFixed(2) + ')') : '(无)')
        + '｜范围内弹簧骨 ' + inR + ' 根' + (ctr && ctr.x > 500 ? '（球已被挪走 = 当前没摸到）' : ''));
    } catch (e) { }
    // ④ 性能：每帧触摸判定的真实开销（★ 这条决定"摸"会不会拖慢渲染）
    try {
      const t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
      for (let i = 0; i < 30; i++) touchHitBone(cr.left + cr.w * 0.3, cr.top + cr.h * 0.45, true);
      const t1 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
      const ms = (t1 - t0) / 30;
      L('每帧触摸判定耗时', ms.toFixed(3) + ' ms/次（骨级判定；这就是"摸"每帧的真实成本）'
        + (ms > 1 ? '　⚠ >1ms，该优化了' : ''));
    } catch (e) { }
  } catch (e) { L('审计异常', (e && e.message) || e); }
  postLog('info', '触摸审计（一次性，验完可删）');
  for (const s of out) postLog('info', s);
  return out;
}
window.petTouchAudit = petTouchAudit;   // 也可手动再跑：控制台执行 petTouchAudit()
// ▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲ 一次性触摸审计 结束 ▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲
function touchTick() {
  try {
    // ▼ 一次性审计：模型就绪后自动跑一遍 —— **与「鼠标摸」开关无关**。
    //   （上一版把它写在开关判断**之后**，而当时开关是关的 ⇒ 审计被一起挡掉，日志里什么都没有。
    //     诊断工具不该受功能开关影响：关着的时候恰恰更需要它。）
    if (!_touchAuditDone) {
      try {
        if (!_touchAuditT0) _touchAuditT0 = nowS_();
        if (vrm && vrm.humanoid && nowS_() - _touchAuditT0 > 4) { _touchAuditDone = true; petTouchAudit(); }
      } catch (e) { }
    }
    if (!touchPhysicsOn && touchPhysicsEnabled()) touchPhysicsOn = true;    // 重载后自动恢复偏好
    if (!touchPhysicsOn) { if (touchGroup) touchDropCollider('开关关闭'); touchInside = false; touchStreak = 0; return; }
    if (!vrm || !vrm.humanoid) return;
    // ★ 物理球建不出来（模型没有可借用的碰撞体）也**不整段退出**：
    //   "摸到发 pet_touch"不依赖物理 ⇒ 那部分照旧可用（下面用 phys 分别守）。
    const phys = ensureTouchCollider();
    requestWinRect();                          // ★ 3 秒问一次窗口位置（把全屏光标换算成窗口内坐标要用它）
    touchDiagTick();                           // ★ 5 秒一条状态行：开了没反应时，一问便知卡在哪一步
    // ★★ 光标来源（2026-10-14 改）：优先**窗口内事件**；没有/过期就用**宿主全屏光标 + 窗口位置**换算
    //   （本机窗口按模型轮廓像素级穿透，光标落在人物上时不一定有 mousemove ⇒ 旧写法整条链被静默挡掉）。
    //   仍然**绝不**直接用 cursorNDC：那样鼠标在桌面任意位置、只要方向对着模型就会被判成"摸到"
    //   （用户实测："我没碰到人物就反馈了"）。
    // ★ 候选逐个试：谁**真的打到模型**就用谁（并把它记为"已证实来源"）⇒ 宿主坐标到底是"窗口内"还是
    //   "全屏坐标"，不靠猜、靠命中判定；都没中 ⇒ 说明光标确实不在人物上（或被挡住）。
    const cands = touchCursorCandidates();
    let loc = null, hit = null, px0 = null, py0 = null;
    const _rectNow = modelScreenRectCached();
    for (const c of cands) {
      if (cursorInViewport(c.x, c.y)) _diagStat.view++;      // 统计：光标在视口内的帧数
      const _inRect = pointInRect(_rectNow, c.x, c.y);
      if (_inRect) _diagStat.rect++;                         // 统计：落在模型矩形内的帧数
      if (px0 === null) { px0 = c.x; py0 = c.y; }            // 首个候选 = 当前光标（定位要用，见下）
      // ★ v11.0：命中改用"骨头屏幕距离"（亚毫秒、直接给部位），不再走 209ms 的三角射线。
      //   骨级判定很便宜 ⇒ 不再需要"矩形预筛"（预筛反而可能因为矩形算偏而挡掉正确命中）。
      const h = touchHitBone(c.x, c.y);
      if (h) { loc = c; hit = h; break; }
    }
    // ★★ v11.7（用户："滑动过程中，有一些部分没反应…得单独在那一块动才行"）：判定分两层 ——
    //   ① **部位事件**要"骨够近"才算命中（touchHitBone 的 lim）；
    //   ② **球在不在场**只看"光标还在不在模型屏幕矩形里"。骨头之间有缝（两块布中间、发束中段、
    //      裙摆褶皱之间），原来一没命中就把球缩回挪走 ⇒ 划过去时那一段"没反应"；现在只要在矩形内，
    //      球就留在场，球心用**骨点插值**（touchBoneInterp，连续）算 ⇒ 一路划过去，沿途的布/发都被推开。
    const inRect = (px0 !== null) && pointInRect(_rectNow, px0, py0);
    if (!loc && !inRect) {
      touchInside = false; touchLastPt = null; touchStreak = 0;
      // ★★ v11.5：不再"一离开就把球挪到 (1000,1000,1000)"—— 球正卡在头发/裙子里时，挪走 = 那撮毛
      //   下一秒"啪"地合拢（另一种"抽"）。改成：球心**留在原地**，半径先平滑缩回 0（头发被慢慢松开）；
      //   缩到底之后才挪远（这时它已经碰不到任何东西，视觉上无感）。
      if (phys && touchCollider && touchBallPos) {
        const tNow = nowS_();
        let dtP = tNow - touchPlaceT; touchPlaceT = tNow;
        if (!(dtP > 0) || dtP > 0.25) dtP = 1 / 60;
        touchBallR += (0 - touchBallR) * (1 - Math.exp(-dtP / 0.12));
        if (touchBallR < 0.004) { parkTouchBall(); }
        else {
          try { touchCollider.shape.radius = touchBallR; } catch (e) { }
          if (touchRig) { try { touchRig.updateWorldMatrix(true, false); } catch (e) { } }
          try { touchCollider.updateWorldMatrix(true, false); } catch (e) { }
        }
      } else { parkTouchBall(); }
      const nowM = nowS_();
      if (nowM - touchMissLogT > 6) {
        touchMissLogT = nowM;
        postLog('info', '鼠标摸：光标不在人物上（试过 ' + cands.length + ' 种来源'
          + (cands.length ? '：' + cands.map(c => c.src + '(' + Math.round(c.x) + ',' + Math.round(c.y) + ')').join('、')
            : '（当前没有可用光标：既没有窗口事件，也没有宿主下发光标）')
          + '）⇒ 不判定为摸到（6 秒最多一条）');
      }
      return;
    }
    const cx = (loc ? loc.x : px0), cy = (loc ? loc.y : py0);   // ★ 没命中骨时也用光标坐标（球要靠它定位）
    if (hit) {
      // 命中统计 + 命中日志（3 秒最多一条）：这是"摸着但推不动"与"根本没摸着"的分界线
      _hitStat.n++; _hitStat.t = nowS_(); _hitStat.part = hit.part || ''; _hitStat.src = loc.src || '';
      _diagStat.hit++;
      if (_curMode !== loc.mode) {
        _curMode = loc.mode;
        postLog('info', '鼠标摸：光标来源已确定为「' + loc.src + '」（被命中证实：' + hit.part + '；位置 '
          + Math.round(cx) + ',' + Math.round(cy) + '）—— 之后优先用它');
      } else if (nowS_() - _hitLogT > 3) {
        _hitLogT = nowS_();
        postLog('info', '鼠标摸：命中「' + (hit.part || '?') + '」来源「' + loc.src + '」(' + Math.round(cx) + ',' + Math.round(cy) + ')'
          + '｜表层「' + (_touchInfo.front || '?') + '」' + (_touchInfo.skipped ? ('（已跳过 ' + _touchInfo.skipped + ' 层覆盖物）') : ''));
      }
    }
    touchStreak++;
    if (phys) {
      const sc = (lastOpts && lastOpts.scale) || 1;
      const rMax = Math.max(0, touchRadius() * sc);            // 目标半径（随模型缩放）
      // ★ 球心放在**表层**命中点（_touchInfo.frontPoint），再朝相机抬出 0.7×半径 ⇒ "手指按在皮肤上"，
      //   碰到哪推哪；不用旧的"模型中心深度"（那样摸脸也会去推裙子，且悬空也顶头发）。
      // ★ 放**表层**（不是"身体"那一层）—— 否则球埋进身体里，头发/裙子不会被顶开。部位仍按身体报。
      // ★ 定位点：**本次真的命中**才用"表层命中骨"；没命中（骨头之间的缝）时用**骨点插值**（连续，不断档）。
      //   ⚠ 必须看 `hit`：_touchInfo.frontPoint 只在命中时才被写，没命中时留着**上一次**的值，直接用会让球卡在旧地方。
      let hp = (hit && _touchInfo && _touchInfo.frontPoint) ? _touchInfo.frontPoint : (hit && hit.point);
      if (!hp) hp = touchBoneInterp(cx, cy);
      // ★★ 2026-10-14 第五轮（用户："鼠标放在衣服上不动，还是会不停抽搐，不是应该不动吗"）：
      //   根因 = **球心跟着"命中的那根弹簧骨"每帧跑**。命中的表层往往是裙子/头发（`スカート_12_11`、
      //   `Bone_Hair0xx`），它们**本身就是弹簧骨**、会被球推动 ⇒ 球动 → 推骨 → 骨动 → 球心（绑在骨上）再动，
      //   这是个**正反馈**：鼠标完全不动，球也会一直蹭着那撮毛抽（幅度不大，看门狗的 18° 阈值抓不到）。
      //   修法：定位锚点**只在光标真的移动时更新**（v11.7 起按"累积 ≥1.5px"，慢速滑动也算动）；
      //   光标不动 ⇒ 锚点世界坐标冻住 ⇒ 球静止
      //   ⇒ 物理收敛到"手指按着"的稳定态。这也正是用户的直觉：不动就该不动。
      let p = null, anchorMoved = false;
      try {
        if (hp) {
          if (!touchAnchorPx || !touchAnchorWp) {
            touchAnchorPx = [cx, cy]; touchAnchorWp = hp.clone(); touchPxAcc = 0;
          } else {
            // ★ v11.7：锚点更新改看"**累积**屏幕位移 ≥1.5px"（原来判单帧 ≥2px）。慢速滑动每帧只挪 1px 出头，
            //   单帧永远到不了 2px ⇒ 锚点不更新、球冻住 ⇒ "滑慢一点也没反应"；改成累积后慢速也一路跟着走。
            if (touchPxLastX === null) { touchPxLastX = cx; touchPxLastY = cy; }
            touchPxAcc += Math.hypot(cx - touchPxLastX, cy - touchPxLastY);
            touchPxLastX = cx; touchPxLastY = cy;
            if (touchPxAcc >= 1.5) {
              touchPxAcc = 0;
              touchAnchorPx[0] = cx; touchAnchorPx[1] = cy;
              touchAnchorWp.copy(hp);                     // 光标动了 ⇒ 锚点跟到新目标点（移动中跟随是预期行为）
              anchorMoved = true;
            }
          }
          p = touchAnchorWp.clone().add(new THREE.Vector3().subVectors(camera.position, touchAnchorWp).normalize().multiplyScalar(rMax * 0.7));
        }
      } catch (e) { }
      // ★ 平滑跟随（v11.4）：球心按 τ≈55ms 阻尼滑向目标点，而不是每帧瞬移。
      //   v11.5 再加"每帧最大步长 6 m/s"：命中点偶尔会跳（换部位 / 窗口尺寸变化）—— 不限速时球会一帧
      //   穿过整撮头发把它"甩飞"（同样是瞬跳形状）。限速后任何跳变都被摊成连续移动 = 一路扫过去。
      try {
        if (p) {
          const tNow = nowS_();
          let dtP = tNow - touchPlaceT; touchPlaceT = tNow;
          if (!(dtP > 0) || dtP > 0.25) dtP = 1 / 60;
          if (!touchBallPos || touchBallPos.distanceTo(p) > 0.8) {
            // 大跳（首次触摸 / 换部位）⇒ 落位清零，并且**半径从 0 重新长**（不带着大球瞬移进头发里）
            touchBallPos = p.clone(); touchBallPrev = p.clone(); touchBallSweep = 0; touchBallR = 0;
          } else {
            touchBallPrev.copy(touchBallPos);
            const d = touchBallPos.distanceTo(p);
            const kFollow = 1 - Math.exp(-dtP / 0.055);
            const stepMax = 6 * dtP;
            let k = kFollow;
            if (d > 1e-6 && d * kFollow > stepMax) k = stepMax / d;
            touchBallPos.lerp(p, k);
            touchBallSweep = touchBallPos.distanceTo(touchBallPrev);
          }
          // ★★ 半径策略（v11.6）：碰撞是**硬约束**（一次就把 tail 推到球面外），半径"瞬变"会让骨方向单帧剧变。
          //   · 光标在动 / 刚停下（3 秒内）⇒ 保持 rMax（= "手指按着"，配合锚点冻结 ⇒ 完全静止不抽）；
          //   · 按住不动超过 3 秒 ⇒ σ=0.6s 慢慢松开（头发/裙摆自然回落，不会永久顶着一撮毛）；
          //   · 光标离开模型（!loc 分支）⇒ σ=0.12s 快速缩回。
          if (touchBallSweep > 0.0008) touchBallMoveT = tNow;
          const wantR = (tNow - touchBallMoveT < 3) ? rMax : 0;
          touchBallR += (wantR - touchBallR) * (1 - Math.exp(-dtP / (wantR > touchBallR ? 0.07 : 0.6)));
          if (touchCollider && touchCollider.shape) touchCollider.shape.radius = touchBallR;
          // ★ 抖动探针（v11.6，**验证器**）：光标不动（= 球已冻结、理论上应静止）时，量"被摸的那根骨"
          //   每 0.5s 累计转了多少度。正常"按着"应迅速收敛（<15°/0.5s）；若持续几十度 ⇒ 还有别的在较劲。
          if (!anchorMoved && _touchInfo.front) {
            try {
              let jn = null;
              for (const it of boneScreenPoints()) if (it.name === _touchInfo.front) { jn = it.node; break; }
              if (jn && jn.quaternion) {
                if (_jitNode !== jn || !_jitQ) { _jitNode = jn; _jitQ = jn.quaternion.clone(); _jitAcc = 0; _jitT0 = tNow; }
                else {
                  const dj = 2 * Math.acos(Math.min(1, Math.abs(_jitQ.dot(jn.quaternion)))) * 180 / Math.PI;
                  _jitAcc += dj; _jitQ.copy(jn.quaternion);
                  const el = tNow - _jitT0;
                  if (el >= 0.5) {
                    if (_jitAcc > 15 && tNow - _jitLogT > 4) {
                      _jitLogT = tNow;
                      postLog('info', '按住抖动探针：鼠标不动，但「' + _touchInfo.front + '」在 ' + el.toFixed(1)
                        + 's 内累计转了 ' + _jitAcc.toFixed(0) + '°（球已冻结；若这数仍很大 ⇒ 抽的不只是球推的那处，把这行发我）');
                    }
                    _jitAcc = 0; _jitT0 = tNow;
                  }
                }
              }
            } catch (e) { }
          }
        }
      } catch (e) { }
      if (touchRig && touchBallPos) { try { touchRig.position.copy(touchBallPos); } catch (e) { } }
      if (touchGroup && touchGroup !== touchRig && touchGroup.position && touchBallPos) { try { touchGroup.position.copy(touchBallPos); } catch (e) { } }
      if (touchRig) { try { touchRig.updateWorldMatrix(true, false); } catch (e) { } }
      if (touchCollider) {
        try { touchCollider.updateWorldMatrix(true, false); } catch (e) { }
        if (typeof touchCollider.updateColliderMatrix === 'function') { try { touchCollider.updateColliderMatrix(); } catch (e) { } }
      }
    }
    // ★ v11.7：没命中骨（光标在骨头之间的缝里）⇒ **只推不发事件**（没有部位可以报给 AI），
    //   但球照旧在场、照旧推（见上面 phys 分支）—— 这就是"划过去那一段也有反应"的来源。
    if (!hit) return;
    // 事件：**移动**着摸才算（停着不算；离开后再进才算新一次）+ 连续 2 帧确认 + 冷却
    const moved = touchLastPt ? Math.hypot(cx - touchLastPt[0], cy - touchLastPt[1]) : 99;
    touchLastPt = [cx, cy];
    if (!touchInside) { touchInside = true; touchLastFire = 0; }
    if (touchStreak < 2) return;
    if (moved < 8) return;
    const now = nowS_();
    if (now - touchLastFire < 1.5) return;                  // 冷却：防狂发消息/烧 token
    touchLastFire = now;
    // ★ 部位写进 text：宿主把它当"用户说的话"发给 AI（见 ThreeDeskPet.cs 的 pet_touch 分支）
    //   ⇒ AI 才知道是"被摸头"还是"被抓手"，能回答得像样。
    const text = '摸了摸' + (hit.part || '');
    try { postMessage({ type: 'pet_touch', text: text, part: hit.part || '', bone: hit.bone || '' }); } catch (e) { }
    if (now - touchLogT > 3) {
      touchLogT = now;
      postLog('info', '鼠标触摸：摸到「' + (hit.part || '?') + '」（骨 ' + (hit.bone || '未知')
        + '；表层是「' + (_touchInfo.front || '?') + '」网格 ' + (_touchInfo.frontMesh || '?') + ' 材质 ' + (_touchInfo.frontMat || '?')
        + (_touchInfo.skipped ? ('，已跳过 ' + _touchInfo.skipped + ' 层覆盖物') : '')
        + '，位置 ' + Math.round(cx) + ',' + Math.round(cy) + '）⇒ 已发 pet_touch「' + text + '」；AI 是否回应看宿主开关');
    }
  } catch (e) {
    // ★★ 2026-10-14 教训（就是这次"开了完全没反应"的原因）：这里原来**一次异常就自动停用**
    //   （touchPhysicsOn = false）。上一版有个 `touchMissLogT is not defined` 的手误，一进
    //   "没打到模型"分支就抛 ⇒ 功能在第一秒把自己关掉，用户看到的只有"开了没反应"。
    //   现在改为：记一条、**继续运行**；只有短时间内异常过多（>300 次/10 秒）才停用。
    _touchErrN++;
    const nowE = nowS_();
    if (nowE - _touchErrT > 10) { _touchErrT = nowE; _touchErrN = 0; _touchErrLogged = false; }
    if (!_touchErrLogged) {
      _touchErrLogged = true;
      postLog('warn', '鼠标触摸异常（继续运行，不再自动停用）：' + ((e && e.message) || e));
    }
    if (_touchErrN > 300) { postLog('warn', '鼠标触摸：异常过多（' + _touchErrN + ' 次）⇒ 已停用，重新开关一次可恢复'); touchPhysicsOn = false; _touchErrN = 0; }
  }
}
window.petTouchInfo = function () {
  return {
    on: touchPhysicsOn, radius: touchRadius(),
    hasClasses: !!(VRMSpringBoneCollider && VRMSpringBoneColliderGroup),   // 仅记录版本事实；新实现**不依赖**它
    mounted: !!touchGroup,
    mode: touchMode,
    pokeFallback: touchPokeFallback,      // true = 物理推进实测没通过、走了"直接拨骨"保底
    ballRadius: touchBallR,
    joints: (touchGroup && vrm && vrm.springBoneManager) ? Array.from(vrm.springBoneManager.joints || []).length : 0,
  };
};

function syncSpringColliders() {
  touchTick();                                   // ★ 鼠标触摸（每帧；内部自带开关/能力判断，关着就是空转）
  if (!vrmPhysicsOn || !vrm || !vrm.springBoneManager) return;
  let groups;
  try { groups = vrm.springBoneManager.colliderGroups; } catch (e) { return; }
  if (!groups || !groups.length) return;
  if (!_springColliderChecked) {
    // 首次：先量"它到底有多过期"，再同步（顺便把这一帧同步掉）—— 这条日志就是"做动作穿模"的直接证据
    _springColliderChecked = true;
    try {
      let n = 0, stale = 0, maxd = 0;
      for (const g of groups) for (const c of (g && g.colliders) || []) {
        if (!c || !c.colliderMatrix || typeof c.updateWorldMatrix !== 'function') continue;
        const b = c.colliderMatrix.elements, bx = b[12], by = b[13], bz = b[14];
        c.updateWorldMatrix(true, false);
        const a = c.colliderMatrix.elements;
        const d = Math.sqrt((a[12] - bx) * (a[12] - bx) + (a[13] - by) * (a[13] - by) + (a[14] - bz) * (a[14] - bz));
        n++; if (d > 1e-4) { stale++; if (d > maxd) maxd = d; }
      }
      if (n) postLog('info', '弹簧骨碰撞体同步：共 ' + n + ' 个／过期 ' + stale + ' 个（最大偏差 ' + maxd.toFixed(3) + '）'
        + (stale
          ? ' ⇒ 每帧全量同步（过期的碰撞球不跟着腿走，做动作就会穿模）'
          : ' ⇒ 求解器自己每帧就在更新它们（实测偏差 0）⇒ 改走"抽样体检"，不再每帧全量跑'));
    } catch (e) { }
    return;
  }
  // ★★ 2026-10-14 第四轮（用户："依旧有略微卡顿"）：实测"过期 0 个（偏差 0.000）" ⇒ 这些碰撞体的世界矩阵
  //   每帧已经由 three-vrm 自己的 ancestors 机制更新过了（我们自造的球也在其中，见 _insertJointSort），
  //   原来这里**每帧再全量扫 447 次** `updateWorldMatrix(true, false)`（true = 递归整条父链）纯属白烧 CPU。
  //   ⇒ 快路径：每 2 秒抽 24 个做"体检"（记旧值→强制刷新→比偏差）；一旦发现真过期，**永久切回**每帧全量。
  const nowC = nowS_();
  if (_springColliderFast) {
    if (nowC - _springColliderCheckT < 2) return;
    _springColliderCheckT = nowC;
    try {
      let i = 0, stale = 0, maxd = 0;
      const total = (() => { let t = 0; for (const g of groups) t += ((g && g.colliders && g.colliders.length) || 0); return t; })();
      const step = Math.max(1, Math.floor(total / 24));
      for (const g of groups) for (const c of (g && g.colliders) || []) {
        if (!c || !c.colliderMatrix || typeof c.updateWorldMatrix !== 'function') continue;
        if ((i++ % step) !== 0) continue;
        const b = c.colliderMatrix.elements, bx = b[12], by = b[13], bz = b[14];
        c.updateWorldMatrix(true, false);
        const a = c.colliderMatrix.elements;
        const d = Math.sqrt((a[12] - bx) * (a[12] - bx) + (a[13] - by) * (a[13] - by) + (a[14] - bz) * (a[14] - bz));
        // ★ v11.36c 阈值 1e-4 → **2e-3（2mm）**：旧阈值只有 0.1mm，角色**站着微晃 / 弹簧骨自然摆动**
        //   就会超标（日志实证：`过期 6 个（最大偏差 0.000）`）⇒ 一旦触发就**永久**切回"每帧全量刷
        //   447 个碰撞体"，正好在跳舞这种最需要 CPU 的时候白烧 447 次 updateWorldMatrix（递归整条父链）。
        //   碰撞球滞后 2mm 以内根本不影响观感（穿模要先到厘米级），2mm 才算真过期。
        if (d > 2e-3) { stale++; if (d > maxd) maxd = d; }
      }
      // ★ v11.36c：还要**连续两次**判过期才切（弹簧骨单帧抽一下就够误判了，别一次就判死刑）。
      if (stale) {
        _springColliderStaleHits++;
        if (_springColliderStaleHits >= 2) {
          _springColliderFast = false;
          postLog('warn', '弹簧骨碰撞体抽样体检发现过期 ' + stale + ' 个（最大偏差 ' + maxd.toFixed(3) + '）⇒ 已切回每帧全量同步');
        }
      } else if (_springColliderStaleHits > 0) {
        _springColliderStaleHits = 0;
      }
    } catch (e) { }
    return;
  }
  try {
    for (const g of groups) for (const c of (g && g.colliders) || [])
      if (c && typeof c.updateWorldMatrix === 'function') c.updateWorldMatrix(true, false);
  } catch (e) { }
}

// ---- 姿势"瞬跳"看门狗（**自动排查**，不需要人盯着看是"哪一下"）----
// 现象（用户原话）："抽搐到另一个动作/姿势一瞬间，然后回来 —— 无论是否开着设置面板"。
// 靠人复现 + 事后翻日志太慢，所以这里**每帧量一次姿态变化量**，只在"**某一帧大跳、紧接着又跳回来**"时记现场：
//   这是瞬跳的特征形状 —— 正常动作再快也不会"跳出去、一两帧又跳回来"。
// 记录内容 = 现场快照：谁在写骨骼（mixer 在播哪支 / 手势 / 拖拽 / 具身队列 / ardy / 根位移 / 姿势名 …）+ 帧率，
//   一次就能定责，不需要你再做什么。判据是**标量角度**、可自证；节流 3 秒一条，不会刷屏。
// ★ 采样点里**包含弹簧骨**（头发/裙摆头几根）—— "抽搐"很可能根本不是人形骨骼，而是头发/裙子在抽。
const JUMP_HUMAN = ['hips', 'spine', 'chest', 'neck', 'head',
  'leftUpperArm', 'rightUpperArm', 'leftLowerArm', 'rightLowerArm', 'leftHand', 'rightHand',
  'leftUpperLeg', 'rightUpperLeg', 'leftLowerLeg', 'rightLowerLeg'];
// ★★ v11.27：阈值**分档**（用户："我自己观察看到就是有问题"——他看到的"后半段抽帧"只有 5~14°，
//   被原来统一的 18° 阈值挡在门外，所以日志只报了头发、漏掉了手臂）。
//   人形骨 10°：20fps 下 ≈200°/s，正常缓动达不到（腿限速 22°/帧是极值，但那是**有意的**快照，
//   这里抓的是"偏移突变"那种**意外**跳变）；弹簧骨保持 18°（头发本来就晃，太敏感会刷屏）。
const JUMP_DEG_HUMAN = 10;
const JUMP_DEG_SPRING = 18;
const JUMP_BACK_DEG = 10;     // 之后回到"跳之前的姿态"多少度以内 ⇒ 判定为"跳回来了"
let _jumpPrev = {}, _jumpArmed = null, _jumpLogT = -1e9, _jqA = null, _jqB = null;
let _springResetN = 0;        // 弹簧骨复位次数（ardy 交还时会 reset ⇒ 头发/裙子会"瞬间归位"，也是抽搐嫌疑之一）
function tickPoseJumpWatch(dt) {
  try {
    if (!vrm || !vrm.humanoid || !THREE) return;
    if (!_jqA) { _jqA = new THREE.Quaternion(); _jqB = new THREE.Quaternion(); }
    const nowS = ((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()) / 1000;
    const nodes = [];
    for (const bn of JUMP_HUMAN) { const b = vrm.humanoid.getNormalizedBoneNode(bn); if (b) nodes.push([bn, b]); }
    try {   // 再加 3 根弹簧骨（头发/裙摆）
      const jt = vrm.springBoneManager && vrm.springBoneManager.joints;
      let n = 0;
      if (jt) for (const j of jt) { if (j && j.bone && n < 3) { nodes.push(['弹簧骨·' + (j.bone.name || n), j.bone]); n++; } }
    } catch (e) { }
    const angle = (qa, qb) => 2 * Math.acos(Math.min(1, Math.abs(qa.dot(qb)))) * 180 / Math.PI;
    let worst = null;
    for (const nn of nodes) {
      const nm = nn[0], b = nn[1];
      const cur = b.quaternion, p = _jumpPrev[nm];
      _jumpPrev[nm] = [cur.x, cur.y, cur.z, cur.w];
      if (!p) continue;
      _jqA.set(p[0], p[1], p[2], p[3]); _jqB.copy(cur);
      const deg = angle(_jqA, _jqB);
      // ★ v11.27：人形骨 10°、弹簧骨 18°（见常量处的说明）
      const _lim = (nm.indexOf('弹簧骨') === 0) ? JUMP_DEG_SPRING : JUMP_DEG_HUMAN;
      if (deg > _lim) { if (!worst || deg > worst.deg) worst = { nm: nm, deg: deg, beforeQ: p.slice() }; continue; }
      if (_jumpArmed && _jumpArmed.nm === nm && nowS - _jumpArmed.t < 0.45) {
        _jqA.set(_jumpArmed.beforeQ[0], _jumpArmed.beforeQ[1], _jumpArmed.beforeQ[2], _jumpArmed.beforeQ[3]);
        _jqB.copy(cur);
        const back = angle(_jqA, _jqB);
        if (back < JUMP_BACK_DEG) {
          const a = _jumpArmed; _jumpArmed = null;
          if (nowS - _jumpLogT > 3) {
            _jumpLogT = nowS;
            let extra = '';
            try { extra = ' 具身平滑=' + (+(lastOpts.embodiedSmooth) || 0).toFixed(2); } catch (e) { }
            // ★ 文本里**绝不能出现** 'ardy' 三个字母：PROBE_HINTS 里有它 ⇒ postLog 会**整行静默**
            //   （上一版就是踩了这坑：看门狗跑了但一行都没打出来）。这里改成"生成层"。
            postLog('info', '瞬跳捕获：' + a.nm + ' 单帧跳 ' + a.deg.toFixed(0) + '°，' + (nowS - a.t).toFixed(2)
              + 's 内又回到 ' + back.toFixed(0) + '° 内（= 抽一下就回来）'
              + '｜动作=' + (currentMotionName || '无') + ' 在播=' + (!!currentMotionAction) + ' 手势=' + (!!gestureAction)
              + ' 拖拽=' + (!!dragAction) + ' 跳舞=' + (!!dancingNow) + ' 具身接管=' + (!!embodiedYielding)
              + ' 保持剪辑=' + (!!embodiedQueueIsHold) + ' 队列=' + (embodiedQueue ? embodiedQueue.length : -1) + '帧'
              + ' 生成层=' + (!!ardyActive) + ' 姿势=' + (currentPose || '?') + ' 弹簧复位=' + _springResetN
              + ' 根位移=' + (+(petRoot && petRoot.position.y) || 0).toFixed(3) + ' fps≈' + (dt > 0 ? (1 / dt).toFixed(0) : '?') + extra);
          }
        }
      }
    }
    if (worst && (!_jumpArmed || worst.deg > _jumpArmed.deg)) _jumpArmed = { nm: worst.nm, deg: worst.deg, beforeQ: worst.beforeQ, t: nowS };
  } catch (e) { }
}

// ---- 「语义通道」方向核对（造型面板 / <bodyact> 走的是这条独立通路）----
// 为什么单独核对：造型面板的滑块是**语义通道**（「左上臂·抬」「左肘·屈」…），它们靠 compose 的
//   `axisFor()` 按**世界方向 + 叉乘**现场推轴 —— 理论上与模型无关，但"理论上"已经错过两次了。
// 这里对每个通道各转 **+12°**（正数 = 通道的正方向），看**子骨实际往世界哪边走**，再与该通道的语义比对：
//   抬 → 应当向上；前 → 应当向前；屈膝 → 脚跟应当向后 …… 判据是标量方向、可自证，不依赖任何坐标约定。
// 与「姿势轴向」是**两条不同的路**：那条修的是"骨骼局部 Euler"，这条查的是"语义通道"，别混。
const CHILD_OF_CH = {
  leftUpperArm: 'leftLowerArm', rightUpperArm: 'rightLowerArm', leftLowerArm: 'leftHand', rightLowerArm: 'rightHand',
  leftUpperLeg: 'leftLowerLeg', rightUpperLeg: 'rightLowerLeg', leftLowerLeg: 'leftFoot', rightLowerLeg: 'rightFoot',
  spine: 'chest', chest: 'upperChest', upperChest: 'neck', neck: 'head',
};
// 通道 → 正数时应当往哪走（'|' 表示两种都算对）
const CH_WANT = {
  lArmUp: '上', rArmUp: '上', lArmFwd: '前', rArmFwd: '前',
  lElbow: '前|上', rElbow: '前|上', lElbowSide: '内|外', rElbowSide: '内|外',
  lLegFwd: '前', rLegFwd: '前', lKnee: '后|上', rKnee: '后|上', lAnkle: '上|下', rAnkle: '上|下',
  spinePitch: '前', chestPitch: '前', headPitch: '前|下',
};
let _chanDirsDone = false;
function measureChannelDirs() {
  try {
    if (_chanDirsDone || !vrm || !vrm.humanoid || !THREE) return;
    const C = window.EmbodiedCompose, rig = window.EmbodiedRig;
    if (!C || typeof C.axisFor !== 'function' || !C.CHANNELS || !rig) return;
    _chanDirsDone = true;
    const up = new THREE.Vector3().fromArray(rig.up || [0, 1, 0]).normalize();
    const fwd = new THREE.Vector3().fromArray(rig.fwd || [0, 0, 1]).normalize();
    const lat = new THREE.Vector3().fromArray(rig.lateral || [1, 0, 0]).normalize();
    const out = [], bad = []; let weak = 0;
    for (const ch in CH_WANT) {
      const def = C.CHANNELS[ch];
      if (!def) { out.push(ch + '=无此通道'); continue; }
      const b = vrm.humanoid.getNormalizedBoneNode(def.bone);
      const cn = CHILD_OF_CH[def.bone];
      const c = cn ? vrm.humanoid.getNormalizedBoneNode(cn) : null;
      if (!b || !c) { out.push(ch + '=缺骨'); continue; }
      const pq = b.parent ? b.parent.getWorldQuaternion(new THREE.Quaternion()) : new THREE.Quaternion();
      const arr = C.axisFor(ch, rig, null, pq);
      if (!arr) { out.push(ch + '=无轴'); continue; }
      const ax = new THREE.Vector3().fromArray(arr).normalize();
      vrm.scene.updateMatrixWorld(true);
      const p0 = c.getWorldPosition(new THREE.Vector3());
      const saveQ = b.quaternion.clone();
      b.rotateOnWorldAxis(ax, 12 * Math.PI / 180);      // 正数工况
      b.updateWorldMatrix(true, true);
      const d = c.getWorldPosition(new THREE.Vector3()).sub(p0);
      b.quaternion.copy(saveQ); b.updateWorldMatrix(true, true);
      // ★ 先判"这次量得到底可不可信"：位移量级应 ≈ θ×骨长；远小于它说明这条核对**方法本身**在这台
      //   模型上失效（实测：所有通道都判成"内"，且 lAnkle/headPitch 因为我的子骨表缺项直接报缺骨）
      //   ⇒ 不能拿它当结论去改通道符号（会误导）。量不出就明说，别打 ✗。
      const boneLen = b.getWorldPosition(new THREE.Vector3()).distanceTo(p0);
      const needLen = (12 * Math.PI / 180) * boneLen;
      if (!(needLen > 1e-6) || d.length() < needLen * 0.3) { out.push(ch + '=量不出'); weak++; continue; }
      const du = d.dot(up), df = d.dot(fwd), dl = d.dot(lat);
      const aU = Math.abs(du), aF = Math.abs(df), aL = Math.abs(dl);
      let got;
      if (aU >= aF && aU >= aL) got = du > 0 ? '上' : '下';
      else if (aF >= aL) got = df > 0 ? '前' : '后';
      else got = dl > 0 ? '外' : '内';
      const ok = CH_WANT[ch].split('|').indexOf(got) >= 0;
      out.push(ch + '=' + got + (ok ? '✓' : '✗'));
      if (!ok) bad.push(ch + '(应' + CH_WANT[ch] + '，实测' + got + ')');
    }
    postLog('info', '通道方向（正数应往哪走）：' + out.join(' ') + (weak ? (' ｜其中 ' + weak + ' 项=量不出') : ''));
    if (weak) postLog('info', '通道方向：有 ' + weak + ' 项量不出 ⇒ **这套核对法在这台模型上不可靠**（上一版把所有通道都判成"内"就是它失效），'
      + '别据此改通道符号；后续改用 compose 真值（要改就改，先发我这行）。');
    if (bad.length) postLog('warn', '通道方向异常：' + bad.join('；') + '（这几个通道在你模型上方向反/换轴，把这行发我）');
  } catch (e) { postLog('warn', '通道方向核对失败：' + ((e && e.message) || e)); }
}

// ---- 姿势「轴向自检」：量出每根骨骼的「哪根局部轴 + 哪个号」= 抬 / 前 / 旋 ----
// 背景（这是"换个模型手臂就反了"的根因）：姿势系统（RELAX / 姿势预设 / 面板微调）写的是
//   **归一化骨骼的局部 Euler x/y/z**，而这三根轴的视觉含义取决于**每根骨骼自己的局部坐标系**。
//   标准 VRM 上恰好有固定对应（上臂 z=抬落、+z 落下；腿 x=前后摆；±x=屈膝 —— 见 RELAX/POSES 的用法），
//   但 **PMX→VRM 的转换会原样保留 PMX 的骨骼朝向** ⇒ 同一个 z 在另一台模型上可能是"落"、甚至整根换到 x/y 上。
//   腿碰巧一致、手臂/手指不一致，就是"只有胳膊反了"的来源。
// 做法：**用几何量量出来**，不猜约定 —— 对每根骨、每根局部轴、正负各转一个小角度，
//   看**子骨的世界位移方向**：朝 +上 的分量最大者即"抬"、朝 +前 的最大者即"前"、沿骨轴的最大者即"旋"。
//   判据是标量方向、可自证，与任何坐标系约定无关（和"拇指方向核对"同一套思路）。
// 量出来的用途：① 直接告出"哪一族反了/换轴了"（不用你一个个试开关）；
//   ② 后续据此**自动重映射**（把写死的 x/y/z 换成量到的轴），换模型自动适配。
let _poseAxesLogged = false;
function measurePoseAxes() {
  try {
    if (_poseAxesLogged || !vrm || !vrm.humanoid || !THREE) return;
    _poseAxesLogged = true;
    const CHILD = {
      leftUpperArm: 'leftLowerArm', rightUpperArm: 'rightLowerArm',
      leftLowerArm: 'leftHand', rightLowerArm: 'rightHand',
      leftUpperLeg: 'leftLowerLeg', rightUpperLeg: 'rightLowerLeg',
      leftLowerLeg: 'leftFoot', rightLowerLeg: 'rightFoot',
      spine: 'chest', chest: 'upperChest', neck: 'head',
    };
    const rig = window.EmbodiedRig || {};
    const up = new THREE.Vector3().fromArray(rig.up || [0, 1, 0]).normalize();
    const fwd = new THREE.Vector3().fromArray(rig.fwd || [0, 0, 1]).normalize();
    const AX = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) };
    const EPS = 0.25;                       // 试转角度：够大能读出方向、又小到不会跑偏
    const _q = new THREE.Quaternion(), _p0 = new THREE.Vector3(), _p1 = new THREE.Vector3(), _bp = new THREE.Vector3();
    const out = {}, finger = [];
    vrm.scene.updateMatrixWorld(true);
    for (const bn in CHILD) {
      const b = vrm.humanoid.getNormalizedBoneNode(bn);
      const c = vrm.humanoid.getNormalizedBoneNode(CHILD[bn]);
      if (!b || !c) continue;
      c.getWorldPosition(_p0); b.getWorldPosition(_bp);
      const boneDir = _p0.clone().sub(_bp).normalize();
      const saveQ = b.quaternion.clone();
      const best = { up: { k: -1, a: '?', s: 1 }, fwd: { k: -1, a: '?', s: 1 }, own: { k: -1, a: '?', s: 1 } };
      for (const ax of ['x', 'y', 'z']) for (const sg of [1, -1]) {
        b.quaternion.copy(saveQ);
        b.quaternion.multiply(_q.setFromAxisAngle(AX[ax], EPS * sg));   // 局部轴 ⇒ 右乘（与 rotation.set 同一语义）
        b.updateWorldMatrix(true, true);
        c.getWorldPosition(_p1);
        const d = _p1.sub(_p0);
        for (const role of ['up', 'fwd', 'own']) {
          const ref = role === 'up' ? up : (role === 'fwd' ? fwd : boneDir);
          const v = d.dot(ref);
          if (Math.abs(v) > best[role].k) best[role] = { k: Math.abs(v), a: ax, s: v >= 0 ? sg : -sg };
        }
      }
      b.quaternion.copy(saveQ); b.updateWorldMatrix(true, true);
      const f = (r) => best[r].a + (best[r].s > 0 ? '+' : '−');
      out[bn] = { up: f('up'), fwd: f('fwd'), own: f('own') };
    }
    // 四指弯曲方向的一次性核对（拇指已有单独核对）：让中指的**当前测量轴**转 30°，
    // 看指尖到手腕的距离是**变小(往里蜷 ✓)** 还是**变大(往外翻 ✗)** —— 标量判据，一眼可判。
    try {
      const hd = rig.hand;
      const FIN = { left: 'leftMiddle', right: 'rightMiddle' };
      for (const sd of ['left', 'right']) {
        const info = hd && hd[sd]; if (!info || !info.axis) continue;
        const prox = vrm.humanoid.getNormalizedBoneNode(FIN[sd] + 'Proximal');
        const dist = vrm.humanoid.getNormalizedBoneNode(FIN[sd] + 'Distal');
        const w = vrm.humanoid.getNormalizedBoneNode(sd + 'Hand');
        if (!prox || !dist || !w) continue;
        vrm.scene.updateMatrixWorld(true);
        const d0 = dist.getWorldPosition(new THREE.Vector3()).distanceTo(w.getWorldPosition(new THREE.Vector3()));
        const saveQ = prox.quaternion.clone();
        const ax = new THREE.Vector3().fromArray(info.axis).normalize();
        prox.quaternion.multiply(_q.setFromAxisAngle(ax, 30 * Math.PI / 180 * (info.sign > 0 ? 1 : -1)));
        prox.updateWorldMatrix(true, true);
        const d1 = dist.getWorldPosition(new THREE.Vector3()).distanceTo(w.getWorldPosition(new THREE.Vector3()));
        prox.quaternion.copy(saveQ); prox.updateWorldMatrix(true, true);
        finger.push((sd === 'left' ? '左' : '右') + '中指 ' + d0.toFixed(3) + '→' + d1.toFixed(3)
          + (d1 < d0 * 0.99 ? '（往里蜷 ✓）' : (d1 > d0 * 1.01 ? '（往外翻 ✗）' : '（几乎没动）')));
      }
    } catch (e) { }
    const parts = [];
    for (const bn in out) parts.push(bn + ' ↑' + out[bn].up + ' →' + out[bn].fwd + ' ⟂' + out[bn].own);
    // ★ 措辞**故意避开探针关键词**（`自检`/`量测`）：postLog 的探针闸门默认静默命中这些字的日志，
    //   否则你以为"接了"，其实一行都没打出来 —— 上一轮就是这么白跑一次（PROBE_HINTS 见文件顶部）。
    postLog('info', '姿势轴向（↑=抬 →=前 ⟂=绕骨轴；轴后 +/- 是**该轴向哪个号转**才得到该方向）：' + parts.join('｜'));
    if (finger.length) postLog('info', '姿势轴向·手指：' + finger.join('｜'));

    // ---- 由实测推出「微调值要不要取反」（只修**符号**，保守规则）----
    // 参照 = 作者写 RELAX/POSES 那台模型的约定，可从预设反推：
    //   上臂：抬起 = z（左臂 +z 是"落下" ⇒ 抬起 = z−；右臂镜像）
    //   前臂：屈肘把手抬起来 = x+      大腿：前摆 = x−（sit: leftUpperLeg x=-1.48）
    //   小腿：屈膝(脚跟抬起) = x+（sit: 1.50）      脊柱/胸：前倾 = x+（sit: 0.14 / 0.10）
    // ★ 规则：**只在"实测轴与参照轴相同、但符号相反"时才取反**；
    //   轴整个换到别的轴上的**不猜**（宁可不动）—— 这样绝不会把本来正常的部位（腿、脊柱）弄坏。
    //   实测例（PMX→VRM 转换的菲比）：只有 leftUpperArm/rightUpperArm 的 z 反了 ⇒ 只翻那两根；
    //   另一台模型反过来（腿/脊柱的 x 反、手臂正常）⇒ 只翻腿/脊柱。两边都能对，不用人工试开关。
    const REF = {
      leftUpperArm: { role: 'up', ax: 'z', s: -1 }, rightUpperArm: { role: 'up', ax: 'z', s: 1 },
      leftLowerArm: { role: 'up', ax: 'x', s: 1 }, rightLowerArm: { role: 'up', ax: 'x', s: 1 },
      leftUpperLeg: { role: 'fwd', ax: 'x', s: -1 }, rightUpperLeg: { role: 'fwd', ax: 'x', s: -1 },
      leftLowerLeg: { role: 'up', ax: 'x', s: 1 }, rightLowerLeg: { role: 'up', ax: 'x', s: 1 },
      spine: { role: 'fwd', ax: 'x', s: 1 }, chest: { role: 'fwd', ax: 'x', s: 1 },
    };
    const fix = {}, flips = [];
    for (const bn in REF) {
      const r = REF[bn], m = out[bn];
      if (!m || !m[r.role]) continue;
      const meas = m[r.role];                                  // 形如 "z+" / "x−"
      const ax = meas.charAt(0);
      const sg = (meas.charAt(1) === '+') ? 1 : -1;
      if (ax === r.ax && sg !== r.s) { const o = {}; o[ax] = -1; fix[bn] = o; flips.push(bn + '.' + ax); }
    }
    window.PoseAxisFix = fix;
    // ---- 再验一步：把 RELAX 的手臂值"原样 / 取反"各施加一次，比**手的高度** ----
    // 判据语义明确：RELAX 的意图就是"把 T-pose 的手臂自然垂下" ⇒ **手更低的那种才对**。
    // 有这条标量判据，符号修正才能从"只修用户微调值"升级到"**连基础姿势/预设一起修**"——
    // 用户看到的手臂不对，多半就发生在基础姿势上（否则他只会觉得"滑条方向反"，而不是"整个人不对"）。
    let verified = false;
    try {
      const armB = ['leftUpperArm', 'rightUpperArm', 'leftLowerArm', 'rightLowerArm'];
      const needFix = armB.some(function (b) { return fix[b] && fix[b].z; });
      if (needFix) {
        const saved = [];
        for (const b of armB) { const n = vrm.humanoid.getNormalizedBoneNode(b); if (n) saved.push([n, n.rotation.clone()]); }
        const applyRelax = (flipZ) => {
          for (const b of armB) {
            const n = vrm.humanoid.getNormalizedBoneNode(b); if (!n) continue;
            const rel = RELAX[b] || {}, r0 = boneRest[b] || { x: 0, y: 0, z: 0 };
            const k = (flipZ && fix[b] && fix[b].z) ? -1 : 1;
            n.rotation.set(r0.x + (rel.x || 0) * k, r0.y + (rel.y || 0) * k, r0.z + (rel.z || 0) * k);
          }
          vrm.scene.updateMatrixWorld(true);
        };
        const lower = () => {          // 手比肩低多少（正 = 更低 = 更像自然下垂）
          let s = 0, c = 0;
          for (const sd of ['left', 'right']) {
            const h = vrm.humanoid.getNormalizedBoneNode(sd + 'Hand');
            const sh = vrm.humanoid.getNormalizedBoneNode(sd + 'Shoulder');
            if (!h || !sh) continue;
            s += sh.getWorldPosition(new THREE.Vector3()).y - h.getWorldPosition(new THREE.Vector3()).y; c++;
          }
          return c ? s / c : 0;
        };
        applyRelax(false); const d0 = lower();
        applyRelax(true); const d1 = lower();
        for (const s of saved) s[0].rotation.copy(s[1]);
        vrm.scene.updateMatrixWorld(true);
        const h0 = (window.EmbodiedRig && window.EmbodiedRig.hipToHead) || 1;
        verified = (d1 > d0 + 0.02 * h0);   // 取反后手明显更低 ⇒ 取反 = 自然下垂
        postLog('info', '姿势轴向验证（手臂）：原样"肩−手"高差 ' + d0.toFixed(3) + ' ／ 取反 ' + d1.toFixed(3)
          + '（身高基准 ' + h0.toFixed(3) + '）⇒ '
          + (verified ? '取反才是自然下垂（仅记录，自动修正已停用）' : '维持原样'));
      }
    } catch (e) { }
    window.PoseAxisFixVerified = verified;
    postLog('info', flips.length
      ? ('姿势轴向（**仅供参考**，自动修正已停用）：实测 ' + flips.join('、') + ' 与作者约定同轴反号 —— 不再自动改动；要翻请在面板选「反转」')
      : '姿势轴向（仅供参考，自动修正已停用）：各轴符号与作者约定一致');
    // ★ 量完立刻把结果作用到当前姿势：poseTarget 是**事件驱动**算出来的（setPose 时才重算），
    //   不主动刷一次的话，基础姿势得等下次切换姿势才更新 ⇒ 用户看到的就是"改了没效果"。
    try { refreshPoseTargets(); } catch (e) { }
  } catch (e) { postLog('warn', '姿势轴向取值失败：' + ((e && e.message) || e)); }
}

function frameCamera(scale, camDist) {
  const s = scale || 1;
  lastOpts.scale = s;
  lastOpts.cameraDistance = camDist || lastOpts.cameraDistance || 6;
  if (vrm) vrm.scene.scale.setScalar(s);
  if (mmdMesh) mmdMesh.scale.setScalar(s);
  applySpringScale(s);   // ★ 弹簧骨随大小等比补偿（否则放小后裙子卡住/反重力）
  applyRestPetScale(s);  // ★ 腿根/髋/脚的"宠物坐标静止基准"随大小等比换算（否则缩小时腿距被撑开）
  const refObj = vrm ? vrm.scene : mmdMesh;
  if (vrm) {
    captureNaturalStand();   // 站立基准只在首次（站立时）测量一次
    // 换算到当前 scale 的世界单位，供姿势落座偏移使用
    modelFloorY = naturalFloorY * s;
    modelHipY = naturalHipY * s;
    modelHeight = naturalHeight * s;
    // 大小变化后重新修正坐姿下沉量，避免越调坐得越歪
    if (currentPose === 'sit') poseRootTarget.y = -(naturalHipY - naturalFloorY) * s;
  } else if (!refObj) return;
  fitCamera();
  reportPetBounds();
}

const reframe = fitCamera;   // 兼容旧调用（姿势切换时重新取景）

// ---- 上报宠物轮廓 / 落座 ----
// 宠物在“窗口内”的可见矩形（CSS 像素）用于鼠标穿透：只有矩形内不穿透，空白穿透给桌面；
// dock=true（坐姿）时 C# 把接触线落到任务栏顶（腿垂在任务栏上）。窗口尺寸固定，不再收缩。
let lastPetSig = '';
function reportPetBounds() {
  const root = petRoot || mmdMesh;   // PMX 无 petRoot，用 mmdMesh 算可见矩形
  if (!root || !camera) return;
  const box = lastFitBox || new THREE.Box3().setFromObject(root);   // 优先复用 fitCamera 刚算的
  if (box.isEmpty()) return;
  const W = window.innerWidth, H = window.innerHeight;
  const proj = (x, y, z) => {
    const p = new THREE.Vector3(x, y, z).project(camera);
    return { x: (p.x * 0.5 + 0.5) * W, y: (-p.y * 0.5 + 0.5) * H };
  };
  const corners = [
    [box.min.x, box.min.y, box.min.z], [box.max.x, box.min.y, box.min.z],
    [box.min.x, box.max.y, box.min.z], [box.max.x, box.max.y, box.min.z],
    [box.min.x, box.min.y, box.max.z], [box.max.x, box.min.y, box.max.z],
    [box.min.x, box.max.y, box.max.z], [box.max.x, box.max.y, box.max.z],
  ];
  let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
  for (const c of corners) { const s = proj(c[0], c[1], c[2]); minX = Math.min(minX, s.x); maxX = Math.max(maxX, s.x); minY = Math.min(minY, s.y); maxY = Math.max(maxY, s.y); }
  const bx = Math.max(0, Math.min(minX, W));
  const by = Math.max(0, Math.min(minY, H));
  const bw = Math.max(0, Math.min(maxX, W) - bx);
  const bh = Math.max(0, Math.min(maxY, H) - by);
  // 接触线：坐姿直接报"窗口底边"（半身下切线就在那里，见 fitCamera 的 sit 分支）。
  // 落座时 C# 算 ny = 任务栏顶 - contactY，于是**窗口底边正好贴住任务栏顶**：
  // 上半身完整坐在任务栏上方，下半身（那两条扭曲的腿）留在窗口下方看不见
  // —— 永远不会再出现"窗口被顶到屏幕外、只剩个头顶"。
  // 不用世界坐标投影，是为了避免透视/俯仰/景深带来的偏移把落座位置算歪。
  // 其他姿势用当前姿态的最低点（整只都在任务栏上方）。
  const contactY = (currentPose === 'sit') ? H
    : proj(box.getCenter(new THREE.Vector3()).x, box.min.y, box.min.z).y;
  const dock = (currentPose === 'sit');
  const sig = `${Math.round(bx)},${Math.round(by)},${Math.round(bw)},${Math.round(bh)},${Math.round(contactY)},${dock}`;
  if (sig === lastPetSig) return;
  lastPetSig = sig;
  postMessage({ type: 'pet_bounds', bx: bx, by: by, bw: bw, bh: bh, contactY: contactY, dock: dock });
}

// ---- 像素级命中遮罩：把"模型本体轮廓"发给 C#，替换原来的包围盒矩形 ----
// 只有模型身体(含手臂/头发)可点/可拖，身体四周空白与透明四角都穿透给桌面；
// C# 用此遮罩做"光标是否点在模型上"的判定（仍是整窗穿透开关，只是判定基准从矩形变成轮廓）。
// 降采样到每 maskCell CSS 像素一格，alpha>阈值即记为实体；节流上报，未变化不重发。
let maskCanvas = null, maskCtx = null, maskAccum = 0, lastMaskSig = '';
const maskCell = 4;   // 每格 CSS 像素：越小越精确、数据越大
function capturePetMask(dt) {
  maskAccum += dt;
  if (maskAccum < 0.18) return;   // ~5.5 次/秒，足够跟上待机微摆又不浪费 IPC
  maskAccum = 0;
  // PMX 的 mmdMesh 直接挂在 scene 上、petRoot 为 null，也要生成遮罩（VRM 用 petRoot，PMX 用 mmdMesh）
  if ((!petRoot && !mmdMesh) || !renderer || !canvas) return;
  const W = window.innerWidth, H = window.innerHeight;
  const cols = Math.max(1, Math.ceil(W / maskCell));
  const rows = Math.max(1, Math.ceil(H / maskCell));
  if (!maskCanvas || maskCanvas.width !== cols || maskCanvas.height !== rows) {
    maskCanvas = document.createElement('canvas'); maskCanvas.width = cols; maskCanvas.height = rows;
    maskCtx = maskCanvas.getContext('2d', { willReadFrequently: true });
  }
  maskCtx.clearRect(0, 0, cols, rows);
  maskCtx.drawImage(canvas, 0, 0, cols, rows);
  let data;
  try { data = maskCtx.getImageData(0, 0, cols, rows).data; } catch (e) { return; }
  const total = cols * rows;
  const bytes = new Uint8Array((total >> 3) + 1);
  for (let i = 0; i < total; i++) if (data[i * 4 + 3] > 24) bytes[i >> 3] |= (1 << (i & 7));   // LSB-first 打包
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  const sig = cols + 'x' + rows + ':' + bin;
  if (sig === lastMaskSig) return;   // 轮廓没变就不发，省 IPC
  lastMaskSig = sig;
  postMessage({ type: 'pet_mask', cols, rows, cell: maskCell, data: btoa(bin) });
}

// 兜底 binder（基于 three-vrm-animation 3.4.0 真实结构）：
// VRMAnimation 的轨道在 vrmAnim.humanoidTracks.rotation（Map<骨名, KeyframeTrack>），没有 .humanoid 属性。
// createVRMAnimationClip 会为“VRMA 声明且模型存在”的每个骨骼建轨道；若某骨骼的轨道因故没进 clip
// （极少数归一化节点名不匹配的情况），这里用 归一化节点→原始节点 逐级兜底把轨道补回去（含 VRM 0.x 的 x/z 翻转）。
function addRawBoneFallbackTracks(vrmAnim, vrm, clip) {
  if (!vrmAnim || !vrmAnim.humanoidTracks || !vrm || !vrm.humanoid || !clip) return;
  const rotMap = vrmAnim.humanoidTracks.rotation;
  if (!rotMap || rotMap.size === 0) return;
  const flip = !!(vrm.meta && vrm.meta.metaVersion === '0');
  const have = new Set((clip.tracks || []).map(t => t.name));
  const findNode = (name) => {
    let n = vrm.humanoid.getNormalizedBoneNode(name);
    if (n) return n;
    if (typeof vrm.humanoid.getRawBoneNode === 'function') { n = vrm.humanoid.getRawBoneNode(name); if (n) return n; }
    const rb = vrm.humanoid.rawHumanBones && vrm.humanoid.rawHumanBones[name];
    return rb ? (rb.node || null) : null;
  };
  for (const [name, origTrack] of rotMap.entries()) {
    if (!name || !origTrack) continue;
    if (have.has(origTrack.name)) continue; // 名字已存在（已被 createVRMAnimationClip 绑上）
    const node = findNode(name);
    if (!node) continue;
    const tn = node.name + '.quaternion';
    if (have.has(tn)) continue;
    const values = flip ? origTrack.values.map((v, i) => (i % 2 === 0 ? -v : v)) : origTrack.values;
    clip.tracks.push(new THREE.QuaternionKeyframeTrack(tn, origTrack.times, values));
    have.add(tn);
  }
}

// ---- VRM ----
async function loadVRM(url, motions, opts) {
  currentMotionAction = null; currentMotionName = null; dancingNow = false; updateNowPlaying(); // 切模型时清掉“正在跳”状态
  const loader = new GLTFLoader();
  loader.register((parser) => new VRMLoaderPlugin(parser));

  const buf = await readLocalFile(url);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const gltf = await new Promise((res, rej) => loader.parse(ab, '', res, rej));
  vrm = gltf.userData.vrm;
  // VRM 0.0 模型在 three-vrm 中默认朝向背面，需要转正；VRM 1.0 此调用无副作用
  try { VRMUtils.rotateVRM0(vrm); } catch (e) { console.warn('rotateVRM0 跳过', e); }
  // 视线目标用一个可移动的代理对象：默认贴在相机上（= 正脸看观众），主循环里按光标做小幅偏移
  // → 头/眼跟随鼠标，产生"活人感"；偏移很小，所以正面看依旧是对着你的。
  if (vrm.lookAt) {
    try {
      lookTargetObj = new THREE.Object3D();
      lookTargetObj.position.copy(camera.position);
      scene.add(lookTargetObj);
      vrm.lookAt.target = lookTargetObj;
    } catch (e) { console.warn('lookAt 跳过', e); }
  }
  try { VRMUtils.removeUnnecessaryVertices(gltf.scene); } catch (e) { console.warn('removeUnnecessaryVertices 跳过', e); }
  try { VRMUtils.combineSkeletons(gltf.scene); } catch (e) { console.warn('combineSkeletons 跳过', e); }
  // ★ v11.8：模型就绪 ⇒ 立刻接上「弹簧骨子步」包装（默认 2 步 ≈1/120）与应用「材质观感」开关
  //   子步**打一条日志**（不是静默）："到底有没有生效"要能从日志一眼看到，不然只能靠手感猜。
  try { applySpringSubSteps(undefined, false); } catch (e) { }
  try { applyVrmStyle(undefined, true); } catch (e) { }
  petRoot = new THREE.Group();
  petRoot.add(vrm.scene);
  scene.add(petRoot);
  // 捕获骨骼静止姿态，供程序化姿势/追踪叠加
  boneRest = {}; poseCurrent = {};
  for (const bn of POSE_BONES) {
    const b = vrm.humanoid?.getNormalizedBoneNode(bn);
    if (b) boneRest[bn] = { x: b.rotation.x, y: b.rotation.y, z: b.rotation.z };
  }
  // 具身重定向的“中性基准”必须在【基础姿态收敛之后】采集：
  // 模型原始静止常是 T-pose(双臂平举)，直接当基准会让手臂整体错位（表现为“先放下再抬起 + 收尾瞬跳”）。
  // 所以这里只挂标记，交给渲染循环在基础姿态稳定后采集（见循环内 embodiedNeedNeutral 分支）。
  // 换模型要把**所有**静止基准清干净：只清 restQ 会让位置类基准残留上一个模型的值，
  // 钉位/根位移就会按"别人的骨架"去摆（表现为莫名其妙的偏移，且极难查）。清完由采集函数统一重建。
  embodiedReady = false; embodiedRestQ = {}; embodiedRestP = {};
  rawRestHipsPet = null; rawRestSocketPet = {}; rawRestFootPet = {};
  rawRestHipsPet0 = null; rawRestSocketPet0 = {}; rawRestFootPet0 = {}; restPetScale = 1;
  rawRestWorldQ = {}; rawRestLocalPos = {};
  hipsRestWorldQ = null;
  embodiedPelvicQ = null; _embPinActive = false; _embPinRawActive = false;
  embodiedNeedNeutral = true; embodiedNeutralT = 0;

  setPose('stand');
  vrmMixer = new THREE.AnimationMixer(vrm.scene);

  // VRM 动画（VRMA）。先走 three-vrm-animation 的 humanoid 重定靶（含表情轨道）；
  // 兜底：文件若是普通 GLB 动画（没有 VRMC_vrm_animation 扩展）直接用其 AnimationClip。
  await loadVrmClips(motions);
}

// VRM 动作：仅登记清单，不一次性全加载（见下方 ensureVrmClip 懒加载）。
async function loadVrmClips(motions) {
  vrmClips = {}; clipLRU = []; activeClipNames.clear();
  allMotions = (motions || []).slice();
  const gre = /wave|nod|bow|sway|stretch|twirl|happyjump|heart|tsundere|shy|yawn|lookaround|挥手|点头|鞠躬|摇摆|伸展|转|开心|比心|傲娇|害羞|哈欠|张望|drag|抱|pick|lift|抓|拿|hang|拎|carry|举|hold/i;
  const prefetch = allMotions.filter(m => m.kind === 'vrma' && gre.test(m.name)).slice(0, 4);
  prefetch.forEach(m => ensureVrmClip(m.name).catch(() => {}));   // 后台预取少量手势型，避免首次互动卡顿
  window.__motionStat = { total: allMotions.length, ok: 0, fail: 0, lazy: true };
  console.log('[3D桌宠] 动作清单就绪：共 ' + allMotions.length + ' 个（懒加载，用到才解析进内存）');
}

// 解析单个 VRMA 文件为 AnimationClip（从原 loadVrmClips 循环抽出，供懒加载复用）
async function loadOneVrmClip(m) {
  if (!m || m.kind !== 'vrma') return null;
  const mbuf = await readLocalFile(m.url);
  const mab = mbuf.buffer.slice(mbuf.byteOffset, mbuf.byteOffset + mbuf.byteLength);
  const vag = await new Promise((res, rej) => animLoader.parse(mab, '', res, rej));
  let clip = null;
  const vrmAnim = (vag.userData.vrmAnimations && vag.userData.vrmAnimations[0]) || vag.userData.vrmAnimation;
  if (vrmAnim) {
    if (typeof createVRMAnimationClip === 'function') clip = createVRMAnimationClip(vrmAnim, vrm);
    else if (typeof vrmAnim.createAnimationClip === 'function') clip = vrmAnim.createAnimationClip(vrm);
    if (clip) addRawBoneFallbackTracks(vrmAnim, vrm, clip);
    // 原地跳舞：hips 位移只去水平(x,z)、保留竖直(y)，身体定在原地但保留跳起/下沉律动
    if (clip && clip.tracks && clip.tracks.length) {
      for (const t of clip.tracks) {
        if (/\.position$/.test(t.name)) {
          const v = t.values;
          for (let i = 0; i < v.length; i += 3) { v[i] = 0; v[i + 2] = 0; }
        }
      }
    }
    if (!window.__vrmaDiag) {
      window.__vrmaDiag = true;
      const mv = vrm && vrm.meta ? vrm.meta.metaVersion : '?';
      const tnames = (clip ? clip.tracks : []).map(t => t.name);
      const limbBones = ['leftUpperArm','leftLowerArm','leftHand','rightUpperArm','rightLowerArm','rightHand','leftUpperLeg','leftLowerLeg','leftFoot','rightUpperLeg','rightLowerLeg','rightFoot'];
      const normResolved = {}, rawResolved = {};
      for (const b of limbBones) {
        normResolved[b] = !!(vrm.humanoid && vrm.humanoid.getNormalizedBoneNode(b));
        rawResolved[b] = !!(vrm.humanoid && typeof vrm.humanoid.getRawBoneNode === 'function' && vrm.humanoid.getRawBoneNode(b));
      }
      const limbTracks = tnames.filter(n => /(UpperArm|LowerArm|Hand|UpperLeg|LowerLeg|Foot)\.quaternion$/.test(n)).length;
      const vrmaRotKeys = (vrmAnim && vrmAnim.humanoidTracks && vrmAnim.humanoidTracks.rotation) ? Array.from(vrmAnim.humanoidTracks.rotation.keys()) : [];
      const vrmaLimb = limbBones.filter(b => vrmaRotKeys.includes(b));
      const rawHuman = vrm.humanoid && vrm.humanoid.rawHumanBones ? Object.keys(vrm.humanoid.rawHumanBones) : [];
      const sceneLimbNodes = [];
      vrm.scene.traverse(o => { if (o.name && /(arm|leg|shoulder|hand|foot|upper|lower|thumb|index|elbow|knee)/i.test(o.name)) sceneLimbNodes.push(o.name); });
      console.log('[3D桌宠][诊断] metaVersion=' + mv + '；clip轨道=' + tnames.length + '；clip四肢quaternion=' + limbTracks + '；VRMA四肢声明=' + vrmaLimb.length);
      console.log('[3D桌宠][诊断] 四肢normalized解析：', JSON.stringify(normResolved));
      console.log('[3D桌宠][诊断] 四肢raw解析：', JSON.stringify(rawResolved));
      console.log('[3D桌宠][诊断] VRMA声明的旋转骨骼：', vrmaRotKeys.join(','));
      console.log('[3D桌宠][诊断] 模型rawHumanBones：', rawHuman.join(','));
      console.log('[3D桌宠][诊断] 场景四肢节点名：', sceneLimbNodes.join(' | '));
      console.log('[3D桌宠][诊断] clip轨道名示例：', tnames.slice(0, 24).join(' | '));
    }
  }
  if (!clip && vag.animations && vag.animations.length > 0) clip = vag.animations[0];
  return clip;
}
// 确保某个 VRM 动作已解析并纳入缓存（未加载则后台解析；已加载则刷新 LRU）
async function ensureVrmClip(name) {
  if (!name) return null;
  if (vrmClips[name]) { touchClip(name); return vrmClips[name]; }
  const m = allMotions.find(x => x.name === name || x.name.toLowerCase() === String(name).toLowerCase());
  if (!m) return null;
  if (!animLoader) { animLoader = new GLTFLoader(); animLoader.register((parser) => new VRMAnimationLoaderPlugin(parser)); }
  const clip = await loadOneVrmClip(m);
  if (clip) { vrmClips[name] = clip; touchClip(name); evictClips(); }
  return clip || null;
}

// ---- MMD (PMX + VMD) ----
// PMX 用 MeshToonMaterial：没有渐变贴图时，在弱光下会被环境光"拍平"成灰蒙蒙一片。
// 给所有 toon 材质补一张 3 段渐变图，让主光的明暗层次能显现（边缘/outline 用的 Basic 材质不动）。
let mmdToonGrad = null;
function applyMMDLightingFixes() {
  if (!mmdMesh) return;
  if (!mmdToonGrad) {
    const data = new Uint8Array([60, 60, 60, 255, 150, 150, 150, 255, 255, 255, 255, 255]); // 暗/中/亮 三段（暗部压暗→对比更强、颜色更艳）
    const tex = new THREE.DataTexture(data, 3, 1, THREE.RGBAFormat);
    tex.minFilter = THREE.NearestFilter; tex.magFilter = THREE.NearestFilter;
    tex.needsUpdate = true;
    mmdToonGrad = tex;
  }
  mmdMesh.traverse(o => {
    if (!o.isMesh || !o.material) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    mats.forEach(m => { if (m && m.isMeshToonMaterial && !m.gradientMap) m.gradientMap = mmdToonGrad; });
  });
}
// ★★ v11.48：本页是 **Electron**（fs/fileURLToPath 都是 require 来的），但页面本身跑在
//   http://127.0.0.1:… 上 ⇒ **Chromium 禁止 http 页面 fetch file://**，路径再带中文/空格就必然
//   `TypeError: Failed to fetch`（日志实证：PMX 本体、贴图、VMD 都会挂）。
//   ⇒ 装一个全局的文件 URL 改写器：凡是 file:// 的请求，改写成宿主本机静态服务的 /disk/…（见 diskUrl）。
//     （同一基准下相对路径仍然按原 file:// 路径解析，所以贴图/VMD 子资源自动跟着走对）
let _fileUrlBridgeInstalled = false;
function installFileUrlBridge() {
  if (_fileUrlBridgeInstalled) return;
  _fileUrlBridgeInstalled = true;
  try {
    const _mgr = (typeof THREE !== 'undefined' && THREE.DefaultLoadingManager) ? THREE.DefaultLoadingManager : null;
    if (!_mgr || typeof _mgr.setURLModifier !== 'function') return;
    _mgr.setURLModifier(function (u) {
      try {
        const s = String(u || '');
        if (!isLocalFile(s)) return s;                     // 非本地文件：原样
        return diskUrl(s);
      } catch (e) { return u; }                            // 读不到就原样（不会比原来更差）
    });
  } catch (e) { }
}

async function loadMMD(url, motions, opts) {
  installFileUrlBridge();     // ★ 贴图 / VMD 子资源也要能取到本地文件
  const loader = new MMDLoader();
  // ★★ v11.48（用户："换 PMX 模型连人物都加载不出来"）：
  //   两条加载路径本来就是**分开**的，而它们取文件的方式不同 ——
  //     · VRM：`readLocalFile(url)`（旧版是 Electron fs 直读磁盘，Alife 5 改走 /disk/）⇒
  //       路径带中文/空格从来没出过问题（你这台一直能换 VRM 就是这个原因）；
  //     · MMD/PMX：`MMDLoader.load(url)` ⇒ 内部 `FileLoader.load` ⇒ **fetch(url)** ⇒
  //       页面是 http://127.0.0.1:… 去取 `file:///E:/…/锁瞑/鸣潮_锁暝.pmx`，
  //       协议跨了 + 路径还带中文 ⇒ `TypeError: Failed to fetch`（日志实证）。
  //   修法：装一个 **LoadingManager 的 URL 改写器**（见 installFileUrlBridge）：
  //   FileLoader **真正去取字节**那一步把 file:// 换成宿主本机服务的 /disk/… ⇒ 中文/空格/协议都无所谓；
  //   而 loader 手里拿到的**始终是原始 URL**（扩展名完整）⇒ 它能正确判断 .pmx / .pmd。
  // ★★ v11.50：**不要把 URL 预先转成 blob 再交给 MMDLoader** —— 这是我自己踩的坑：
  //   MMDLoader 靠**扩展名**判断是 .pmx 还是 .pmd（`url.split('.').pop()`），
  //   而 blob: URL 没有扩展名 ⇒ 它把 `blob:http://127.0.0.1:45871/uuid` 按点切开，
  //   取到 `1:45871/77a646f4-…` 当扩展名 ⇒ `Unknown model file extension .1:45871/…`（本次报错）。
  //   正确做法：**原样把 URL 交给 loader**（它有 .pmx，能判格式），真正的取文件由
  //   `installFileUrlBridge()` 装的 LoadingManager 改写器在 FileLoader 取字节那一步兜住
  //   （file:// → /disk/…），两全其美：格式判得对、也绕开了 fetch 取 file://。
  mmdMesh = await new Promise((res, rej) => loader.load(url, res, undefined, rej));
  helper = new MMDAnimationHelper({ afterInit: () => { } });
  // 物理依赖 ammo.js：没引入 ammo 时 new MMDPhysics 会直接抛 "Import ammo.js"，
  // 让整个 loadMMD 中断 → 模型都加载不出来（表现为一切操作都没反应）。
  // 因此先探测 ammo，缺失就降级关掉物理，保证模型一定能出（动画/IK 不受影响）。
  let usePhysics = !!opts.enablePhysics;
  if (usePhysics && typeof Ammo === 'undefined') {
    console.warn('[3D桌宠] 未检测到 ammo.js，已自动关闭物理继续加载（MMD 物理需要 ammo.js）');
    usePhysics = false;
    lastOpts.enablePhysics = false;
  }
  try {
    helper.add(mmdMesh, { physics: usePhysics, ik: !!opts.enableIK });
  } catch (e) {
    console.warn('[3D桌宠] helper.add 失败，降级为仅 IK 重试', e);
    try { if (helper.meshes.indexOf(mmdMesh) < 0) helper.add(mmdMesh, { physics: false, ik: !!opts.enableIK }); }
    catch (e2) { console.warn('[3D桌宠] helper.add 重试仍失败', e2); }
  }
  scene.add(mmdMesh);
  applyMMDLightingFixes();   // PMX 材质打光修正：toon 补渐变（正面"主体光"由 applyLighting 的 MMD 分支补）

  await loadMmdClips(motions);
}

// PMX 动作：同样懒加载（见 ensureMmdClip），仅登记清单
async function loadMmdClips(motions) {
  mmdClips = {}; clipLRU = []; activeClipNames.clear();
  allMmdMotions = (motions || []).filter(m => m.kind === 'vmd').slice();
  console.log('[3D桌宠] PMX 动作清单就绪：共 ' + allMmdMotions.length + ' 个（懒加载）');
}
// 确保某个 VMD 动作已解析并纳入缓存
async function ensureMmdClip(name) {
  if (!name) return null;
  if (mmdClips[name]) { touchClip(name); return mmdClips[name]; }
  const m = allMmdMotions.find(x => x.name === name || x.name.toLowerCase() === String(name).toLowerCase());
  if (!m) return null;
  if (!mmdLoader) mmdLoader = new MMDLoader();
  try {
    const clip = await new Promise((res, rej) => mmdLoader.loadAnimation(m.url, mmdMesh, res, undefined, rej));
    if (clip) { mmdClips[name] = clip; touchClip(name); evictClips(); }
    return clip || null;
  } catch (e) { console.warn('VMD 加载失败', name, e); return null; }
}

// ---- 表情 / 动作采集 ----
function collectExpressions() {
  if (vrm && exprMgr()) {
    const m = exprMgr();
    // VRMExpressionManager.expressions 是“表达式对象数组”，不是 Map；
    // 直接 .keys() 会得到 0/1/2 索引而非表情名 → 选中后 getExpression(index) 返回 null 而失效。
    // 正确取名字：优先用 expressionMap（name→对象）的键，退回用 expressions[].expressionName。
    if (m.expressionMap) return Object.keys(m.expressionMap);
    if (m.expressions) return m.expressions.map(e => e.expressionName);
  }
  if (mmdMesh && mmdMesh.morphTargetDictionary) {
    return Object.keys(mmdMesh.morphTargetDictionary);
  }
  return [];
}
// ---- 当前模型「真正能播」的动作（唯一可信清单）----
// 为什么必须有这层过滤：动作库常把 .vmd 与 .vrma 混放在同一批目录里（实测
// `E:\Nyalume-…\手势舞比心\动作.vmd`），而解析入口 loadOneVrmClip 开头就是
// `if (m.kind !== 'vrma') return null` —— **静默返回**。不过滤的后果（用户实测）：
//   含"播不了的名字"的清单被报给宿主 → 进 AI 常驻信息 → AI 调 <motion option="手势舞比心/动作"/>
//   → C# 校验通过（SupportedMotions 里确实有它）→ 前端也进了播放函数 →
//   **人一动不动、连一行日志都没有**（"调用函数调用了个寂寞"）。
// 同一份名单还被 自动跳舞 / 随机手势 / 拖拽动画 使用 ⇒ 会随机抽到播不了的名字在空转。
// 过滤**只**去掉"按类型根本播不了"的项，不影响任何能播的动作。
function playableMotions() {
  if (vrm) return allMotions.filter(m => m && m.kind === 'vrma');
  if (mmdMesh) return allMmdMotions;      // loadMmdClips 已按 kind === 'vmd' 过滤
  return [];
}
function playableMotionNames() { return playableMotions().map(m => m.name); }

// 播不了就**喊出来**，绝不静默 —— 否则"调用了个寂寞"只能靠猜。同一名字只喊一次，避免刷屏。
const _motionUnplayableWarned = new Set();
function warnMotionUnplayable(name) {
  if (!name || _motionUnplayableWarned.has(name)) return;
  _motionUnplayableWarned.add(name);
  const m = allMotions.find(x => x.name === name);
  if (!m) { postLog('warn', '动作「' + name + '」不在动作清单里 → 无法播放（名字写错？）'); return; }
  if (m.kind !== 'vrma') {
    postLog('warn', '动作「' + name + '」是 .' + m.kind + ' 文件，当前模型是 VRM ⇒ 播不了（要播它得换成 PMX 模型）。'
      + 'AI 的动作清单已按模型类型过滤，正常不会再点名到它。');
  } else {
    postLog('warn', '动作「' + name + '」解析不出动画（.vrma 可能损坏 / 缺 VRMC_vrm_animation 扩展）→ 已跳过。');
  }
}
function collectMotions() {
  return playableMotionNames();
}

// ---- 模型部件（可单独隐藏的 Mesh / 材质分组元素）----
// 两种模型结构不同，都必须支持：
//   · VRM：身体/头发/衣服通常是各自独立的 SkinnedMesh（单材质）→ 按 mesh 逐个隐藏；
//   · PMX：整个人物往往是“一个 SkinnedMesh + 材质数组”，靠 geometry.groups 的材质分组区分身体/衣服/头发
//     → 必须按“材质数组里的元素”逐个隐藏，否则只有一个元素、一关整个人就全没了。
// 复杂人物部件多、跳舞时容易互相穿模变形，允许逐个隐藏来改善观感并减轻计算。
function modelPartRoot() { return vrm ? vrm.scene : mmdMesh; }
// ★ 「为什么明明不是后发的东西叫后发」——名字**不是我起的**：下面这段只做"读取 + 去重"，
//   从不改名。VRM 走的是**网格节点名**（`o.name`，即模型作者在建模软件里给那个对象起的名字），
//   节点名为空时才退回**材质名**（`material.name`）。所以：
//     · 名字是"后发"却不是后发 ⇒ 作者在模型里把一个**别的网格**起名叫「後髪」（复制粘贴改名不彻底，
//       或整个头发+帽子放在同一个对象里）；
//     · 同名部件会显示成「後髪」「後髪#2」「後髪#3」——**它们确实是不同的网格/材质**（去重是为了能分别控制）。
//   光看名字分辨不了 ⇒ 每行加**悬停详情**（节点名/材质名/三角面/是否蒙皮）与「只看这件」（隔离法，
//   用眼睛确认到底是哪一块）—— 名字不可信时，这两样才是可靠手段。
const _partMeta = {};   // key → { node, mat, tris, skinned }（面板悬停详情用）
function collectModelParts() {
  const out = [];
  const seen = new Set();
  const root = modelPartRoot();
  for (const k in _partMeta) delete _partMeta[k];        // 每次重算 ⇒ 不留旧模型的残留
  if (!root) return out;
  const uniq = (base) => { let k = base, i = 2; while (seen.has(k)) k = base + '#' + (i++); seen.add(k); return k; };
  const trisOf = (o, mi) => {
    try {
      if (mi !== undefined && o.geometry && o.geometry.groups) {
        const g = o.geometry.groups.find(x => x.materialIndex === mi);
        if (g) return Math.round((g.count || 0) / 3);
      }
      const n = o.geometry && (o.geometry.index ? o.geometry.index.count : (o.geometry.attributes && o.geometry.attributes.position ? o.geometry.attributes.position.count : 0));
      return Math.round((n || 0) / 3);
    } catch (e) { return 0; }
  };
  root.traverse(o => {
    if (!o.isMesh && !o.isSkinnedMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    if (mats.length > 1) {
      // 多材质 Mesh（PMX 典型：整个人物就是一个 SkinnedMesh，靠材质数组区分身体/衣服/头发）
      // → 每个材质分组各算一个部件，逐个列出，避免“只有一个元素、一关整个人全没了”。
      if (o.geometry && !o.geometry.userData.origGroups)
        o.geometry.userData.origGroups = (o.geometry.groups || []).map(g => ({ start: g.start, count: g.count, materialIndex: g.materialIndex }));
      o.userData.partKeys = [];
      mats.forEach((m, mi) => {
        const base = String((m && m.name) || '').trim()
          || (String(o.name || '').trim() || 'mesh') + '_材' + mi;
        const key = uniq(base);
        o.userData.partKeys[mi] = key;
        _partMeta[key] = { node: String(o.name || '(无名)'), mat: String((m && m.name) || ''), tris: trisOf(o, mi), skinned: !!o.isSkinnedMesh };
        out.push(key);
      });
    } else {
      // 单材质 Mesh（VRM 典型：身体/头发/衣服是各自独立的 SkinnedMesh）→ 整个 mesh 作为一个部件
      const base = String(o.name || '').trim() || String((mats[0] && mats[0].name) || '').trim() || 'mesh';
      o.userData.partKey = uniq(base);    // 绑定到对象上，后续按 key 精确控制可见性
      _partMeta[o.userData.partKey] = {
        node: String(o.name || '(无名)'), mat: String((mats[0] && mats[0].name) || ''),
        tris: trisOf(o), skinned: !!o.isSkinnedMesh,
      };
      out.push(o.userData.partKey);
    }
  });
  return out;
}
function applyHiddenParts(hidden) {
  const set = new Set(Array.isArray(hidden) ? hidden : []);
  const root = modelPartRoot();
  if (!root) return;
  root.traverse(o => {
    if (!o.isMesh && !o.isSkinnedMesh) return;
    if (o.userData.partKeys) {
      // 多材质：按材质过滤 geometry.groups —— 被隐藏的材质分组不绘制，其余照常显示
      const orig = (o.geometry && o.geometry.userData.origGroups) || [];
      o.geometry.groups = orig
        .filter(g => { const k = o.userData.partKeys[g.materialIndex]; return !(k && set.has(k)); })
        .map(g => ({ start: g.start, count: g.count, materialIndex: g.materialIndex }));
    } else if (o.userData.partKey) {
      o.visible = !set.has(o.userData.partKey);
    }
  });
}

// 热重载动作：不重载模型，只清空并重新加载 clips（VRM 的 vrmClips / PMX 的 mmdClips），
// 用于“加载动作文件夹”导入后即时生效。先停掉正在播的动作，避免引用被清空的 clip。
async function reloadMotions(motions) {
  try {
    stopCurrentMotion(0);
    if (gestureAction) { try { gestureAction.stop(); } catch (e) { } gestureAction = null; }
    if (dragAction) { try { dragAction.stop(); } catch (e) { } dragAction = null; }
    dragClipName = null;
    vrmClips = {}; mmdClips = {}; clipLRU = []; activeClipNames.clear();
    if (currentModelType === 'vrm' && vrm) {
      await loadVrmClips(motions);
      try { initGrounding(); } catch (e) { }   // 重新测量各动作接地偏移（脚不悬空）
    } else if (currentModelType === 'mmd' && mmdMesh) {
      await loadMmdClips(motions);
    }
    // 把新清单回报给 C#（它据此刷新 SupportedMotions 与右键菜单），并触发“正在跳”浮层刷新
    applyHiddenParts(lastOpts.hiddenParts || []);   // 重载动作后 mesh 可能重建，重新套用隐藏设置
    postMessage({ type: 'model_info', expressions: collectExpressions(), motions: collectMotions(), parts: collectModelParts() });
    console.log('[3D桌宠] 动作已热重载，当前 ' + collectMotions().length + ' 个');
  } catch (e) { console.error('[3D桌宠] 动作热重载失败', e); }
}

// ---- 消息处理 ----
// ---- 动作人设（AI 自己写的风格契约；用户也能在设置面板里直接改）----
// 每个使用者的对话 AI 会把自己的人设 + 近期记忆蒸馏成一份短契约（C# 侧持久化，并回灌进它的常驻信息）。
// 前端做两件事：① 把数值换成人（待机小动作频率 / 节奏 / 平滑 / 幅度 / 跟随强度）；
//              ② 在设置面板里显示并可编辑（编辑后经 motion_idiom 命令回传宿主）。
// 数值是**一次性应用**：应用后用户自己在面板上改的值优先，不会被宿主反复覆盖回人设值。
let motionIdiomInfo = null;
let motionIdiomEditors = null;   // 面板打开时指向一组编辑器（异步到达时用于回填）
const MOTION_IDIOM_TEXT_FIELDS = ['persona', 'state', 'like', 'avoid', 'signature'];
const MOTION_IDIOM_NUM_FIELDS = ['amp', 'tempo', 'density', 'smooth', 'stillness'];
let motionIdiomDraft = {
  amp: 1, tempo: 1, density: 2, smooth: 0.08, stillness: 0.4,
  persona: '', state: '', like: '', avoid: '', signature: ''
};

// 数值 → 真实手感（独立成函数：面板里用户改完也复用同一条路径，避免两套换算走偏）
function applyMotionIdiomFeel() {
  const d = motionIdiomDraft;
  // 幅度 → 生成动作"跟多少"（腿/脊柱/骨盆/根位移跟得越多，观感上动作越大）。
  // 关键性质：以**现有默认值为 1 倍基准**，amp=1 时完全等于默认手感 —— 写人设不会顺手破坏你调好的默认。
  if (typeof ardyTune === 'function') {
    ardyTune({
      leg: Math.max(0.2, Math.min(1, 0.7 * d.amp)),
      spine: Math.max(0.25, Math.min(1, 0.7 * d.amp)),
      hips: Math.max(0.35, Math.min(1, d.amp)),
      root: Math.max(0, Math.min(1.5, 0.8 * d.amp)),
      smooth: d.smooth
    });
  }
  window.__embodiedSmooth = d.smooth;
  idleGestureLevel = Math.round(d.density);       // 密度 → 待机小动作频率（0=几乎不动）
  motionCooldown = Math.max(0.15, 1.0 / d.tempo); // 节奏 → 两次动作的最小间隔
  motionIdleGap = Math.max(0.1, 0.6 / d.tempo);
  idleGap = Math.max(0.1, 1.5 / d.tempo);
  headTrackStrength = 1 - 0.65 * d.stillness;     // 静定 → 少跟随、少微动
  spineTrackStrength = 1 - 0.65 * d.stillness;
  idleIntensity = 1 - 0.5 * d.stillness;
}

function resetIdiomFeel() {
  if (typeof ardyTune === 'function') ardyTune({ reset: true });
  idleGestureLevel = 2; motionCooldown = 1.0; motionIdleGap = 0.6; idleGap = 1.5;
  headTrackStrength = 1; spineTrackStrength = 1; idleIntensity = 1;
  window.__embodiedSmooth = 0.05;
  postLog('info', '已恢复默认手感（人设文本仍保留；要连人设一起清掉，去配置页把 5 段文本清空）');
}

// 把面板上改过的参数写回宿主（写回"整份草稿"，文本字段原样带回，所以不会覆盖掉配置页里写的文本）。
// 轻 debounce：连续拖几个滑块只发一次；宿主保存后会推回来，面板再回填（值相同 → 不会来回弹）。
let idiomPersistT = null;
function persistIdiomDraft() {
  clearTimeout(idiomPersistT);
  idiomPersistT = setTimeout(() => {
    // setfeel（而不是 set）：只微调手感数值 → 宿主不重置"该提醒 AI 重写了吗"的计时
    sendMenu('motion_idiom', { cmd: 'setfeel', json: JSON.stringify(motionIdiomDraft) });
  }, 250);
}

// 面板已打开时把草稿/状态回填到编辑器（消息可能比面板晚到）
function motionIdiomFillEditors() {
  if (!motionIdiomEditors) return;
  const T = motionIdiomEditors.text || {}, N = motionIdiomEditors.num || {};
  for (const k of MOTION_IDIOM_TEXT_FIELDS)
    if (T[k]) T[k].value = motionIdiomDraft[k] || '';
  for (const k of MOTION_IDIOM_NUM_FIELDS) {
    const inp = N[k];
    if (!inp) continue;
    inp.value = motionIdiomDraft[k];
    if (inp._valEl && inp._fmt) inp._valEl.textContent = inp._fmt(motionIdiomDraft[k]);
  }
  const st = motionIdiomEditors.status;
  if (st) {
    st.textContent = motionIdiomInfo
      ? ('动作人设：' + (motionIdiomInfo.label || '（未命名）') + '\n'
        + '来源：' + (motionIdiomInfo.source === 'user' ? '你自己改的' : 'AI 写的') + '｜' + (motionIdiomInfo.ageText || '')
        + (motionIdiomInfo.due ? '\n⚠ 已到期：AI 下次说话时会看到重写提醒（也可点「让 AI 重写」）' : '')
        + '\n编辑在「插件配置 → 3D桌宠」里（那边窗口宽）')
      : '动作人设：还没收到数据（首次加载中）；编辑在「插件配置 → 3D桌宠」里';
  }
}

messageBus.on('motion_idiom', (msg) => {
  if (!msg) return;
  motionIdiomInfo = msg;
  const cl = (x, a, b) => { const v = +x; return isFinite(v) ? Math.max(a, Math.min(b, v)) : a; };
  motionIdiomDraft = {
    amp: cl(msg.amp, 0.3, 1.5), tempo: cl(msg.tempo, 0.5, 2), density: cl(msg.density, 0, 3),
    smooth: cl(msg.smooth, 0, 0.3), stillness: cl(msg.stillness, 0, 1),
    persona: msg.persona || '', state: msg.state || '', like: msg.like || '',
    avoid: msg.avoid || '', signature: msg.signature || ''
  };
  applyMotionIdiomFeel();
  motionIdiomFillEditors();
  postLog('info', '动作人设已应用：' + (msg.label || '（未命名）') + '｜幅度 ' + motionIdiomDraft.amp +
    ' 节奏 ' + motionIdiomDraft.tempo + ' 密度 ' + idleGestureLevel + ' 平滑 ' + motionIdiomDraft.smooth +
    ' 静定 ' + motionIdiomDraft.stillness + '｜' + (msg.ageText || ''));
});
// ---- 自定义造型（用户在面板里摆好、存下来的姿势）----
// 为什么必须由**用户**来摆：造型类姿势（比心 / 叉腰 / 抱臂 / 耍帅）**得看着画面调**，
// 作者看不见、AI 也没有三维直觉 —— 之前用角度硬凑（比心/背手）两次都失败并撤掉了（见 embodied-compose.js 注释）。
// 用户摆一次 → 存成具名预设 → 之后**所有 AI** 都能像内置预设一样用它：<bodyact preset="名字"/>
let customPoseNames = [], customPoseSig = '';
let poseListRefresh = null;      // 面板打开时指向"刷新造型下拉"的闭包
function applyCustomPoses(json) {
  customPoseNames = [];
  const C = window.EmbodiedCompose;
  if (C && C.registerPreset && typeof json === 'string' && json) {
    let map = null;
    try { map = JSON.parse(json); } catch (e) { postLog('warn', '自定义造型 JSON 解析失败：' + e.message); }
    if (map && typeof map === 'object') {
      for (const name in map) {
        const raw = map[name];
        if (!raw || typeof raw !== 'object') continue;
        // ★ 拆保留键：`__fl_*` / `__fr_*` = 逐指弯曲，`__turn` 转身，`__crouch` / `__kneel` 蹲跪，
        //   `__rootY` 下沉（后三个存的是百分比）。其余键才是"通道名 → 角度"。
        //   为什么要拆：手指与蹲跪/转身**都不是通道**，必须作为 spec 顶层参数交给合成器
        //   （compose 里它们分别是 spec.fingers / spec.crouch / spec.kneel / spec.turn）。
        //   混在 pose 里不会报错（compose 忽略未知通道），但那样它们**永远不生效**——
        //   这正是"摆了手势存下来、AI 播时手指还是老样子"的根因。
        const pose = {}, fL = {}, fR = {};
        let turn = 0, crouch = 0, kneel = 0, rootY = 0, anyL = false, anyR = false;
        for (const k in raw) {
          const v = +raw[k] || 0;
          if (k.indexOf('__') !== 0) { pose[k] = v; continue; }
          if (k.indexOf('__fl_') === 0) { fL[k.slice(5)] = v; anyL = true; }
          else if (k.indexOf('__fr_') === 0) { fR[k.slice(5)] = v; anyR = true; }
          else if (k === '__turn') turn = v;
          else if (k === '__crouch') crouch = v / 100;
          else if (k === '__kneel') kneel = v / 100;
          else if (k === '__rootY') rootY = v / 100;
        }
        // 造型 = 摆上去 → 保持一下 → 自动收回（compose 会自动补收尾段，所以不会瞬跳）
        const spec = { steps: [
          { pose: pose, dur: 0.45, ease: 'out' },
          { pose: pose, dur: 1.2, ease: 'linear' }
        ] };
        if (anyL || anyR) {
          spec.fingers = {};
          if (anyL) spec.fingers.l = Object.assign({ curl: 0 }, fL);
          if (anyR) spec.fingers.r = Object.assign({ curl: 0 }, fR);
        }
        if (Math.abs(turn) > 0.5) spec.turn = turn;
        if (crouch > 0.001) spec.crouch = crouch;
        if (kneel > 0.001) spec.kneel = kneel;
        if (Math.abs(rootY) > 0.0001) spec.rootY = rootY;
        C.registerPreset(name, spec);
        customPoseNames.push(name);
      }
    }
  }
  const sig = customPoseNames.join('|');
  if (sig !== customPoseSig) {          // 只在清单真的变了时打日志（options_update 很频繁）
    customPoseSig = sig;
    postLog('info', customPoseNames.length ? ('自定义造型已就绪：' + customPoseNames.join('、')) : '（没有自定义造型）');
  }
  if (poseListRefresh) poseListRefresh();
}

messageBus.on('motions_update', (msg) => { reloadMotions((msg && msg.motions) || []).catch(e => console.error('[3D桌宠] 动作热重载异常', e)); });
messageBus.on('expression', (msg) => {
  const name = msg.name;
  const sec = msg.seconds;
  const hold = (sec === undefined || sec === null) ? 5 : (sec > 0 ? sec : 0);
  if (vrm && exprMgr()) {
    try {
      exprMgr().setValue(name, 1);
      if (hold > 0) {
        const t = setTimeout(() => { try { exprMgr().setValue(name, 0); } catch (e) { } }, hold * 1000);
        expressionTimers.push(t);
      }
    } catch (e) { console.warn('表情不存在或设置失败', name, e); }
  } else if (mmdMesh && mmdMesh.morphTargetDictionary) {
    const idx = mmdMesh.morphTargetDictionary[name];
    if (idx !== undefined) {
      mmdMesh.morphTargetInfluences[idx] = 1;
      if (hold > 0) {
        const t = setTimeout(() => { mmdMesh.morphTargetInfluences[idx] = 0; }, hold * 1000);
        expressionTimers.push(t);
      }
    }
  }
});

// ==== 具身动作（实验，默认关）====
// 规则：同一时刻只允许一个 driver 写归一化骨骼。但**只有“真的有内容要驱动”时**（收到真实帧数据，或
// 显式开启自检演示）才让 mixer 让位；否则即使开关打开也保持惰性，**绝不打断待机轮换与舞蹈**（见 skill §6.6）。
const EMBODIED_MAP = {   // Core27 关节名 -> VRM humanoid 骨骼名（真实数据按 manifest 对齐后可扩展）
  hips: 'hips', spine1: 'spine', spine2: 'chest', spine3: 'upperChest',
  neck: 'neck', head: 'head',
  l_shoulder: 'leftShoulder', l_uarm: 'leftUpperArm', l_larm: 'leftLowerArm', l_hand: 'leftHand',
  r_shoulder: 'rightShoulder', r_uarm: 'rightUpperArm', r_larm: 'rightLowerArm', r_hand: 'rightHand',
  l_uleg: 'leftUpperLeg', l_lleg: 'leftLowerLeg', l_foot: 'leftFoot', l_toe: 'leftToes',
  r_uleg: 'rightUpperLeg', r_lleg: 'rightLowerLeg', r_foot: 'rightFoot', r_toe: 'rightToes'
};
let embodiedRestQ = {};        // 各 VRM 骨骼的“干净静止”局部四元数（键 = humanoid 骨骼名）
let embodiedRestP = {};        // 各骨骼的静止局部位置（目前用于"根位移/下蹲"还原）
let embodiedReady = false;
let embodiedT = 0;
let embodiedQueue = [];        // 真实帧队列（生成端注入）
let embodiedQueueIsHold = false;   // 队列里的剪辑是不是造型面板的"保持预览"（新动作不该排在它后面）
let embodiedPlayT = 0;         // 播放头（帧）
let embodiedFps = 20;
let embodiedSmoothQ = {};      // 本层“上一次写入”的骨骼值；平滑基于它，而不是骨骼当前值
let embodiedNeedNeutral = false, embodiedNeutralT = 0;   // 中性基准需在基础姿态收敛后采集

// 严格判定开关：只把 true / 1 / '1' 当开启（避免 '0' 这类字符串被 JS 当真值 → 关不掉）
function embodiedOn() { const v = lastOpts.embodiedMotion; return v === true || v === 1 || v === '1'; }

// ---- 生成式动作：**后台预热**（把 AI 第一次 gen: 词条要扛的 6~12 秒冷启动提前吃掉）----
// 为什么需要：首次生成要"读 684MB 权重 + 建 WebGPU 会话"（实测 6~12 秒），而 AI 的第一次
//   <motion option="gen:…"/> 必然发生在**对话中间** ⇒ 用户看到的就是"它说完话后呆站十几秒"。
// 规则：① 只在「具身动作」开着时预热（gen: 本来就依赖它，关着根本用不到）；
//       ② 延迟 25 秒（别和启动/模型加载抢磁盘与 GPU）；③ 每个窗口只试一次（失败也别反复读盘）。
let ardyWarmupTimer = null, ardyWarmupTried = false, ardyWarmupWaitN = 0;
function scheduleArdyWarmup() {
  if (ardyWarmupTried || ardyWarmupTimer) return;
  if (!embodiedOn()) { postLog('info', '生成式动作预热：跳过（「具身动作」未开启）'); return; }
  ardyWarmupTimer = setTimeout(() => {
    ardyWarmupTimer = null;
    if (ardyWarmupTried || !embodiedOn()) return;
    // ★★ 2026-10-14 第四轮（用户："依旧有略微卡顿、不流畅丝滑"）：预热要在 Worker 里读 684MB 权重 +
    //   建 WebGPU 会话，抢 CPU 的那十几秒主线程帧率会掉（日志现场：`瞬跳捕获 … fps≈34` 正落在预热时间窗内，
    //   同一帧弹簧骨跳 34°）。所以：**你刚动过（8 秒内）就先让一让**，10 秒后再试；最多退避 6 次（≈1 分钟），
    //   之后无论如何都跑 —— 否则"用户一直在动 ⇒ 永远不预热 ⇒ 第一次 gen 又等 6~12 秒"。
    let busy = false;
    try { busy = (idleT - (cursorSeenT || -99) < 8); } catch (e) { }
    if (busy && ardyWarmupWaitN < 6) {
      ardyWarmupWaitN++;
      postLog('info', '生成式动作预热：你正在操作，先让一让（第 ' + ardyWarmupWaitN + ' 次退避）⇒ 10 秒后再试');
      scheduleArdyWarmup();
      return;
    }
    if (typeof window.ardyWarmup !== 'function') { postLog('warn', '生成式动作预热：ardy 客户端未加载 → 跳过'); return; }
    ardyWarmupTried = true;
    window.ardyWarmup();   // 成功/失败都由它自己写日志；这里不 await，别堵住主流程
  }, ardyWarmupWaitN ? 10000 : 25000);
}
function embodiedKey(name) { return EMBODIED_MAP[name] || name; }   // 兼容 Core27 名，或直接给 VRM 骨骼名
function embodiedBone(name) { return (vrm && vrm.humanoid) ? vrm.humanoid.getNormalizedBoneNode(embodiedKey(name)) : null; }

function embodiedEnsureRest() {
  if (embodiedReady || !vrm || !vrm.humanoid) return;
  embodiedRestQ = {};
  const nb = vrm.humanoid.normalizedHumanBones || {};
  for (const k in nb) {
    const node = nb[k] && nb[k].node;
    if (node && node.quaternion) {
      embodiedRestQ[k] = node.quaternion.clone();
      if (node.position) embodiedRestP[k] = node.position.clone();   // 根位移（下蹲）要还原到基准位置
    }
  }
  // ★★ 兜底：`normalizedHumanBones` 里**缺项**的骨骼也要有静止基准（手指最常缺）——必须补，否则
  //   `embodiedApplyJoints` 的 `base = embodiedRestQ[key] || b.quaternion` 会退化成"以**当前**值为基准"，
  //   于是把增量一帧帧**累加**上去。用户实测症状（2026-10-13）：
  //     • 手指滑条清零、数字回 0，手指却**回不去**（累加的弯曲留在骨头上）；
  //     • 调高滑条是在**原有弯曲基础上继续弯**；
  //     • 没人下指令时手指骨仍缓慢自转（日志 `手指送达诊断：归一化骨较上次转 0.8°`）。
  //   标准手指骨 = 5 指 × 3 节 × 2 手 = 30 根，缺谁补谁。
  try {
    const F1 = ['Thumb', 'Index', 'Middle', 'Ring', 'Little'], F2 = ['Proximal', 'Intermediate', 'Distal'];
    let added = 0;
    for (const sd of ['left', 'right']) for (const f of F1) for (const su of F2) {
      const nm = sd + f + su;
      if (embodiedRestQ[nm]) continue;
      const b = vrm.humanoid.getNormalizedBoneNode ? vrm.humanoid.getNormalizedBoneNode(nm) : null;
      if (b && b.quaternion) { embodiedRestQ[nm] = b.quaternion.clone(); if (b.position) embodiedRestP[nm] = b.position.clone(); added++; }
    }
    if (added) postLog('info', '具身静止基准：补记 ' + added + ' 根手指骨（normalizedHumanBones 里原本没有 —— 不补会导致手指增量逐帧累加）');
  } catch (e) { }
  // 下面全按"世界"量：先刷新世界矩阵，否则量到的是上一帧的旧值（补偿/自检都会偏）。
  try { vrm.scene.updateMatrixWorld(true); } catch (e) { }
  // 记下骨盆"静止时的世界朝向"：动胯补偿髋窝位置要用（见 applyEmbodiedLegPin）。
  // 特意打一行日志：如果它不是单位朝向（PMX/MMD 模型常见），就能一眼看出来曾踩过的那个坑。
  try {
    const hp = vrm.humanoid.getNormalizedBoneNode('hips');
    if (hp) {
      hp.updateWorldMatrix(true, false);
      hipsRestWorldQ = new THREE.Quaternion();
      hp.getWorldQuaternion(hipsRestWorldQ);
      const e = new THREE.Euler().setFromQuaternion(hipsRestWorldQ, 'XYZ');
      const deg = v => Math.round(v * 180 / Math.PI);
      if (Math.abs(deg(e.x)) + Math.abs(deg(e.y)) + Math.abs(deg(e.z)) > 5)
        postLog('info', '骨盆静止朝向非单位（' + deg(e.x) + '°, ' + deg(e.y) + '°, ' + deg(e.z)
          + '°）：动胯已按它做髋窝补偿（这类朝向在 PMX/MMD 模型上很常见）');
    }
  } catch (e) { hipsRestWorldQ = null; }
  // 同时记下"静止世界基准"：髋窝/脚的世界位置 + 腿根的世界朝向 —— 动胯自检的三个基准量。
  // （这三个都由实体骨骼量出来，不依赖任何"名字解析成功"的假设；解析不到的会以 n/a 出现在自检里。）
  try {
    const rHips = embRawBone('hips');
    if (rHips) {
      rHips.updateWorldMatrix(true, false);
      rawRestHipsPet0 = embToPetLocal(rHips.getWorldPosition(new THREE.Vector3()));
    }
    for (const name of PIN_LEGS) {
      const b = embRawBone(name);
      if (!b) continue;
      b.updateWorldMatrix(true, false);
      rawRestSocketPet0[name] = embToPetLocal(b.getWorldPosition(new THREE.Vector3()));
      rawRestWorldQ[name] = b.getWorldQuaternion(new THREE.Quaternion());
      rawRestLocalPos[name] = b.position.clone();
    }
    for (const name of PIN_FEET) {
      const b = embRawBone(name);
      if (!b) continue;
      b.updateWorldMatrix(true, false);
      rawRestFootPet0[name] = embToPetLocal(b.getWorldPosition(new THREE.Vector3()));
    }
    // ★ 记下"捕获时的 scale"并把宠物坐标基准换算到位；之后每次改大小都要跟着换算
    restPetScale = (lastOpts.scale || 1);
    applyRestPetScale(restPetScale);
    captureThumbRest();     // 拇指方向核对的基准（静止时的"指尖↔中指根"距离）
  } catch (e) { }
  embodiedMeasureRig();                     // 同一时刻量出"骨架朝向/面朝方向"，供通道自动推轴
  // （姿势轴向自检 measurePoseAxes 已挪进 embodiedMeasureRig 末尾 —— 它可能从别的路径被调用，
  //   挂在这里会**没执行过**：第一次实测日志里就没有那行，正是这个原因。）
  embodiedReady = Object.keys(embodiedRestQ).length > 0;
  // 采集完整性告警：位置类基准一旦缺失，"髋窝钉位"和"根位移（下蹲）"会**静默失效** ——
  // 这个 bug 就是这么藏了两轮的（没报错、没日志、现象像"模型的固有毛病"）。宁可疑神疑鬼，也不要静默。
  if (embodiedReady && (!embodiedRestP['hips'] || !embodiedRestP['leftUpperLeg'] || !hipsRestWorldQ))
    postLog('warn', '具身位置基准不完整（骨盆位置=' + !!embodiedRestP['hips'] + ' 腿根位置=' + !!embodiedRestP['leftUpperLeg']
      + ' 骨盆朝向=' + !!hipsRestWorldQ + '）：动胯钉位与根位移（下蹲）将失效，请把这行发给开发者');
}

// 量出重定向用的 rig：各骨骼在世界里的朝向、角色面朝方向、世界"上"。
// embodied-compose 用它把【解剖学通道】(抬/前/外/旋) 自动换成正确的世界旋转轴 ——
// 所以左右正负、T-pose/A-pose、模型朝向都不需要人工校准；换模型会自动重算。
let _rigFailN = 0, _rigFailT = 0;   // 量测失败计数 / 上次失败时刻（限流用；见 catch 与函数开头）
function embodiedMeasureRig() {
  // ★ 刚失败过 ⇒ 2 秒内不再重试。配合"失败不置空 rig" ⇒ 任何异常都退化成"最多每 2 秒试一次"，
  //   彻底堵死"每次合成⇒重测⇒再抛"的死循环（实测曾被刷 600+ 次 / 13 秒）。
  if (_rigFailN > 0 && Date.now() - _rigFailT < 2000) return;
  try {
    if (!vrm || !vrm.humanoid) { window.EmbodiedRig = null; return; }
    // ★★ v11.39「规范 T-pose 下量骨架」—— 换模型零配置的关键一步（用户："有的模型 YZ 轴不一样，
    //   得开反转，怎么改才能通用？"）。
    //   旧行为：拿**当前姿势**下骨骼的世界朝向当 `rig.dir` ⇒ 而 compose 里**每一个**通道的轴都从
    //   `rig.dir` 推出来（抬 = cross(骨骼朝向, 上)、前 = cross(骨骼朝向, 面朝)、自转 = 骨骼朝向）：
    //     ① 基础姿势被摆坏时（模型轴反了 / 面板「反转」没开或开错 ⇒ 手臂翘着、腿反折），
    //        量到的就是**坏姿势**的朝向 ⇒ 所有动作通道的方向/幅度全错
    //        （用户症状："手臂位置不对、幅度偏小、往下压、换个模型就不对"——全都对得上）；
    //     ② 更要命的**退化**：手臂自然下垂时骨骼朝向与"上"平行 ⇒ cross(朝向, 上) ≈ 0 ⇒
    //        抬臂轴退化成随机轴 ⇒ 抬 80° 只动一点点，怎么加幅度都没用（"幅度偏小"的第二个来源）。
    //   规范 T-pose：把所有归一化骨的旋转暂时置**单位四元数**（three-vrm 的人形归一化保证此时骨架
    //   处于作者的标准 T/A-pose）⇒ 量到的朝向**只取决于模型本身而与当前姿势无关**，
    //   于是与"反转开关"彻底解耦：**换任何模型都不用再动开关**。
    //   顺带修好两处：腿部尺寸（a/b/L0）不再在"弯着腿/坏姿势"上量错 ⇒ 蹲/跳落地的 IK 也跟着准了。
    const _canonNames = ['hips', 'spine', 'chest', 'upperChest', 'neck', 'head',
      'leftShoulder', 'leftUpperArm', 'leftLowerArm', 'leftHand',
      'rightShoulder', 'rightUpperArm', 'rightLowerArm', 'rightHand',
      'leftUpperLeg', 'leftLowerLeg', 'leftFoot', 'leftToes',
      'rightUpperLeg', 'rightLowerLeg', 'rightFoot', 'rightToes'];
    const _canonSaved = [];
    for (const _cn of _canonNames) {
      const _cb = vrm.humanoid.getNormalizedBoneNode(_cn);
      if (_cb && _cb.quaternion) _canonSaved.push([_cb, _cb.quaternion.clone()]);
    }
    for (const _cs of _canonSaved) _cs[0].quaternion.identity();
    // ★★ v11.42：取"骨骼朝向"的工具要在 try 之外声明 —— 姿势还原后**还要再量一次**朝向
    //   （见下面"实际姿势朝向"那段：通道轴必须由实际静止姿势推，理由见那里的注释）。
    const g = (n) => vrm.humanoid.getNormalizedBoneNode(n);
    const wp = (n) => { const b = g(n); if (!b) return null; const v = new THREE.Vector3(); b.getWorldPosition(v); return v; };
    const CHILD2 = {
      leftShoulder: 'leftUpperArm', leftUpperArm: 'leftLowerArm', leftLowerArm: 'leftHand',
      rightShoulder: 'rightUpperArm', rightUpperArm: 'rightLowerArm', rightLowerArm: 'rightHand',
      leftUpperLeg: 'leftLowerLeg', leftLowerLeg: 'leftFoot', leftFoot: 'leftToes',
      rightUpperLeg: 'rightLowerLeg', rightLowerLeg: 'rightFoot', rightFoot: 'rightToes',
      spine: 'chest', chest: 'upperChest', upperChest: 'neck', neck: 'head'
    };
    const LEAF2 = { leftHand: 'leftLowerArm', rightHand: 'rightLowerArm', head: 'neck', leftToes: 'leftFoot', rightToes: 'rightFoot' };
    try {                                    // ★ 无论量测中间出什么错，姿势都必须还原（下面 finally）
    vrm.scene.updateMatrixWorld(true);      // 先刷新世界矩阵，否则位置是上一帧的旧值
    const up = new THREE.Vector3(0, 1, 0);
    // 角色自己的"左"：由两只上臂的世界位置得出（与模型朝向/版本无关）
    const pL = wp('leftUpperArm'), pR = wp('rightUpperArm');
    const lateral = (pL && pR) ? pL.clone().sub(pR) : new THREE.Vector3(1, 0, 0);
    lateral.y = 0;
    if (lateral.lengthSq() < 1e-8) lateral.set(1, 0, 0);
    lateral.normalize();
    const fwd = new THREE.Vector3().crossVectors(lateral, up).normalize();   // 面朝 = 左 × 上
    // 骨骼朝向 = 父骨世界位置 → 子骨世界位置
    const CHILD = {
      leftShoulder: 'leftUpperArm', leftUpperArm: 'leftLowerArm', leftLowerArm: 'leftHand',
      rightShoulder: 'rightUpperArm', rightUpperArm: 'rightLowerArm', rightLowerArm: 'rightHand',
      leftUpperLeg: 'leftLowerLeg', leftLowerLeg: 'leftFoot', leftFoot: 'leftToes',
      rightUpperLeg: 'rightLowerLeg', rightLowerLeg: 'rightFoot', rightFoot: 'rightToes',
      spine: 'chest', chest: 'upperChest', upperChest: 'neck', neck: 'head'
    };
    const dir = {};
    for (const b in CHILD) {
      const a = wp(b), c = wp(CHILD[b]);
      if (a && c) { const d = c.clone().sub(a); if (d.lengthSq() > 1e-10) dir[b] = d.normalize().toArray(); }
    }
    // 叶子骨（手/脚趾/头）没有子节点：沿用父链朝向
    const LEAF = { leftHand: 'leftLowerArm', rightHand: 'rightLowerArm', head: 'neck', leftToes: 'leftFoot', rightToes: 'rightFoot' };
    for (const n in LEAF) { if (!dir[n] && dir[LEAF[n]]) dir[n] = dir[LEAF[n]].slice(); }
    // 髋→头 距离：给 ardy 的根位移做比例换算（VRM 的尺度 ÷ ardy 的尺度），换模型自动适配
    const pHip = wp('hips'), pHead = wp('head');
    const hipToHead = (pHip && pHead) ? pHip.distanceTo(pHead) : 0;
    // 腿部量测（供「蹲/跪」的解析 IK）：大腿 a、小腿 b、站立"髋→踝"竖直距离 L0、髋离地高 h0。
    // 全用**世界距离** ⇒ 解出的骨盆下沉量与 rootY 同单位，可以直接拿来用。
    let legs = null;
    try {
      const pHip = wp('leftUpperLeg'), pKnee = wp('leftLowerLeg'), pAnk = wp('leftFoot');
      if (pHip && pKnee && pAnk) {
        const a = pHip.distanceTo(pKnee), b = pKnee.distanceTo(pAnk);
        const L = Math.max(0.01, pHip.y - pAnk.y);
        // 地面高度：优先用已有的站立地面线，退而取包围盒，再退取踝高。
        // **不硬依赖 Box3**：它一旦抛异常，整段量测就静默失败 → 蹲/跪"没反应也没有线索"（踩过）。
        let floorY = (isFinite(modelFloorY) && modelFloorY < pHip.y) ? modelFloorY : pAnk.y;
        try {
          const bb = new THREE.Box3().setFromObject(vrm.scene);
          if (isFinite(bb.min.y) && bb.min.y < pHip.y) floorY = Math.min(floorY, bb.min.y);
        } catch (e2) { }
        if (a > 0.01 && b > 0.01) {
          legs = { a: a, b: b, L0: L, h0: Math.max(L, pHip.y - floorY) };
          // ★ v11.40：措辞**必须避开 PROBE_HINTS 关键字**（'量测'/'自检'/'探针'…）——
          //   原来这行叫"腿部量测"，被探针闸门**静默整行丢弃** ⇒ 从来没有在日志里出现过，
          //   所以"腿长到底量成多少"一直无法核对（蹲/跳落地的 IK 全依赖它）。
          postLog('info', '腿部尺寸（蹲/跪 IK 用）：大腿 ' + a.toFixed(3) + '｜小腿 ' + b.toFixed(3)
            + '｜髋→踝 ' + L.toFixed(3) + '｜髋离地 ' + legs.h0.toFixed(3));
        } else {
          postLog('warn', '腿部量测失败：长度异常（大腿 ' + a.toFixed(4) + '／小腿 ' + b.toFixed(4) + '）→ 蹲/跪不可用');
        }
      } else {
        postLog('warn', '腿部量测失败：取不到 leftUpperLeg/leftLowerLeg/leftFoot 节点 → 蹲/跪不可用');
      }
    } catch (e) { legs = null; postLog('warn', '腿部量测异常：' + e.message + ' → 蹲/跪不可用'); }
    // 手部量测（供手指通道）：每只手的"弯曲轴 + 正方向 + 掌心法线"。
    // 为什么必须量：手指的弯曲轴在骨骼局部空间里，左右手方向相反、不同模型还各不相同 ——
    // 硬写一根轴，结果一定是"一只手往里蜷、另一只手往外翘"（手臂与腿都踩过同一个坑）。
    let hand = null;                    // fingerAxes: 手指骨名 → 父骨局部空间的「弯曲轴/展开轴/正负号」
    for (const _fk in fingerAxes) delete fingerAxes[_fk];   // ★ 清空**复用模块级那个对象**（别再新建局部变量）
    try {
      const mkHand = (side) => {
        const w = wp(side + 'Hand'), ip = wp(side + 'IndexProximal'), lp = wp(side + 'LittleProximal');
        const mp = wp(side + 'MiddleProximal'), md = wp(side + 'MiddleDistal');
        if (!w || !ip || !lp || !mp || !md) return null;
        const axis = ip.clone().sub(lp);                     // 指根连线 ≈ 弯曲轴
        const fdir = md.clone().sub(mp);                     // 手指朝向
        const toWrist = w.clone().sub(md);                   // 蜷起来时指尖该朝手腕去
        if (axis.lengthSq() < 1e-10 || fdir.lengthSq() < 1e-10 || toWrist.lengthSq() < 1e-10) return null;
        axis.normalize(); fdir.normalize(); toWrist.normalize();
        // 绕 axis 转 +θ 会让指尖朝 cross(axis,fdir) 方向走 ⇒ 选符号让它朝手腕 ⇒ **+ 就是"蜷"**
        const moveDir = new THREE.Vector3().crossVectors(axis, fdir).normalize();
        const sign = (moveDir.dot(toWrist) >= 0) ? 1 : -1;
        // 张开手指绕掌心法线转：先叉出来，再翻到"背侧"（与朝手腕的那侧相反）
        const nrm = new THREE.Vector3().crossVectors(axis.clone().multiplyScalar(sign), fdir).normalize();
        if (nrm.dot(toWrist) > 0) nrm.multiplyScalar(-1);
        // ★★ 手掌侧方向：由四指的蜷曲方向反推 —— `cross(axis,fdir)*sign` 就是"指尖蜷起来往哪走"。
        //   （历史坑：拿 `nrm·toWrist` 定符号会退化 —— 指尖→腕与手指几乎平行 ⇒ 点积≈0 ⇒ 手心手背会翻。）
        const palmarDir = new THREE.Vector3().crossVectors(axis, fdir).normalize().multiplyScalar(sign);
        // ★★ 拇指：**必须单独一根"屈曲轴"，而且绝不能沿用四指那根指根连线**。
        //   踩过的坑（2026-10-13 用户实测，原话）："拇指**只能横向移动、不能竖向**，不像其他四指那样弯曲，
        //   只是移动而已" ⇒ 因为旧代码把拇指轴设成了 `axis`（食指根↔小指根连线）：
        //   绕掌横轴转 = **内收/外展（横扫过掌心）**，解剖上根本不是屈曲 —— 所以它只会左右甩、不会往掌心卷。
        //   （更早那版"单开一根落在掌心平面内的轴"方向也不对，于是被改回共用轴 —— 那一步改错了。）
        //   正确做法：**先定"指尖该往哪走"，再反解转轴**。
        //     目标方向 = 拇指尖 → **食指根**（屈曲/对掌时拇指尖正是朝那边收；
        //                 而且这跟内置诊断 `拇指方向核对：指尖↔中指根距离` 判的是同一件事 —— 可自证）。
        //     绕 ax 转 +θ 时指尖位移 ≈ cross(ax, tdir)；要它 = tTarget ⇒ **ax = tdir × tTarget**。
        //   ⇒ 正号 = "卷"（与四指同语义），且判据只用两个**大向量**，不会退化。
        let thumb = null;
        try {
          const tb = wp(side + 'ThumbProximal'), tt = wp(side + 'ThumbDistal') || tb;
          if (tb && tt && ip) {
            const tdir = tt.clone().sub(tb);
            if (tdir.lengthSq() > 1e-10) {
              tdir.normalize();
              const tTarget = ip.clone().sub(tt);              // 拇指尖 → 食指根
              if (tTarget.lengthSq() > 1e-10) {
                tTarget.normalize();
                const axT = new THREE.Vector3().crossVectors(tdir, tTarget);
                if (axT.lengthSq() > 1e-10) {
                  axT.normalize();
                  const chk = new THREE.Vector3().crossVectors(axT, tdir);   // 应朝 tTarget，否则翻号
                  const sgT = (chk.dot(tTarget) >= 0) ? 1 : -1;
                  // ★★ **自标定「满卷角度」**：扫 10~150°，取"拇指尖↔食指根最近"的那一点。
                  //   判据与内置诊断同源（都看这个距离）⇒ 换模型自动重算，**既不用人肉试、也不用改常数**；
                  //   手型库只写"语义比例"（0~250 ⇒ 0~满卷），真正的换算在 compose 的 fingerJoints 里做。
                  const off = tt.clone().sub(tb), tmpV = new THREE.Vector3();
                  const d0 = tt.distanceTo(ip);
                  let full = 0, dBest = d0;
                  for (let deg = 10; deg <= 150; deg += 5) {
                    tmpV.copy(off).applyAxisAngle(axT, (deg * Math.PI / 180) * sgT);
                    const dd = tmpV.add(tb).distanceTo(ip);
                    if (dd < dBest - 1e-6) { dBest = dd; full = deg; }
                  }
                  thumb = { axis: axT.toArray(), sign: sgT, full: full, d0: d0, dBest: dBest };
                }
              }
            }
          }
        } catch (eT) { }
        return { axis: axis.toArray(), sign: sign, normal: nrm.toArray(), thumb: thumb, palmar: palmarDir.toArray() };
      };
      const hl = mkHand('left'), hr = mkHand('right');
      if (hl || hr) {
        hand = { left: hl, right: hr };
        const d = (h) => h ? (h.axis.map(v => v.toFixed(2)).join(',') + '／' + (h.sign > 0 ? '+' : '-')) : '缺失';
        postLog('info', '手部量测：左手弯曲轴 ' + d(hl) + '｜右手弯曲轴 ' + d(hr));
        // ★★ 逐骨把"世界弯曲轴 / 展开轴"换算到**各自父骨的局部空间**（在静止姿态下换算）。
        //   为什么必须这样：手指要以"手（及上一节手指）"为参考系蜷曲 —— 上臂自旋让手在世界里转了，
        //   蜷曲方向也必须跟着转。若仍按**世界轴**施加（旧做法），一扭上臂自旋，手指就会被掰直/扭曲（用户实测）。
        //   换算后：compose 直接产出「父骨局部增量」，pet.js 命中这些骨名时**不做世界共轭**、直接叠加。
        try {
          const FIN = ['Thumb', 'Index', 'Middle', 'Ring', 'Little'], SUF = ['Proximal', 'Intermediate', 'Distal'];
          const qP = new THREE.Quaternion();
          for (const sd of ['left', 'right']) {
            const info = hand[sd]; if (!info) continue;
            const axW = new THREE.Vector3().fromArray(info.axis), nrW = new THREE.Vector3().fromArray(info.normal);
            const axThumb = info.thumb ? new THREE.Vector3().fromArray(info.thumb.axis) : null;
            for (const f of FIN) for (const su of SUF) {
              const nm = sd + f + su;
              const bb = g(nm); if (!bb || !bb.parent) continue;
              bb.parent.getWorldQuaternion(qP);              // 该骨**父级**的静止世界四元数
              const invP = qP.clone().invert();
              // ★ 拇指用**它自己的**屈曲轴（与四指不同面）；其余手指用"食指–小指连线"
              const useT = (f === 'Thumb' && axThumb);
              const ax = (useT ? axThumb : axW).clone().applyQuaternion(invP).normalize();
              fingerAxes[nm] = {
                ax: ax.toArray(),
                nrm: nrW.clone().applyQuaternion(invP).normalize().toArray(),
                // ★ 唯一改动（2026-10-13 第二轮，回档后只留这一处）：
                //   四指"卷"符号**取反** —— 你实测原话"手指弯曲的方向也全都是反的"、"单独的大拇指好像是好的"。
                //   只改非拇指；`fingerAxes` 是四指唯一的轴向来源 ⇒ 造型面板 / 手势库 / <bodyact> 一起正过来。
                //   若哪天发现又反了：把下面的 `-(info.sign || 1)` 改回 `(info.sign || 1)` 即可（一个字符）。
                sign: useT ? (info.thumb.sign || 1) : -(info.sign || 1),
              };
            }
          }
          const thTag = (h) => h && h.thumb ? ('轴(' + h.thumb.axis.map(v => v.toFixed(2)).join(',') + ') 号'
            + (h.thumb.sign > 0 ? '+' : '-')
            + (h.thumb.full ? (' **满卷' + h.thumb.full + '°**（指尖↔食指根 ' + h.thumb.d0.toFixed(3) + '→' + h.thumb.dBest.toFixed(3) + '）')
                            : ' ⚠未标定（拇指按比例退回保守值）')) : '缺失';
          postLog('info', '手指局部轴已量出 ' + Object.keys(fingerAxes).length + ' 根（按父骨局部空间 ⇒ 扭上臂自旋不再掰直手指）'
            + '｜拇指单独轴 左' + thTag(hl) + ' 右' + thTag(hr));
        } catch (eF) { postLog('warn', '手指局部轴量测失败：' + eF.message); }
      } else postLog('warn', '手部量测失败：取不到手指骨骼 → 手型退回世界左右轴（可能左右反）');
    } catch (e) { hand = null; postLog('warn', '手部量测异常：' + e.message); }
    // 取景包络**实测**（和第 3 步的腿一样：拍脑袋的固定系数一定会在某些模型上被切）。
    // 为什么必须实测：抬手过头时"肩高 + 整条手臂长"很容易超过 1.28×身高，尤其手臂偏长的模型 ——
    // 用户实测"开着 1.28 抬手依旧出画"。这里按**该模型自己的骨架**算出两个包络：
    //   envReachH：手臂竖直上举时，指尖能达到的高度 ÷ 站立身高
    //   envReachW：两臂平举时，总宽度 ÷ 站立宽度
    try {
      const nat = measureNatural();
      // ★ 必须**先刷新世界矩阵**再量：否则量到的是"上一次刷新时的"关节位置（腿/手量测同样受益）。
      try { vrm.scene.updateMatrixWorld(true); } catch (e0) { }
      const box = new THREE.Box3().setFromObject(vrm.scene);
      const fl = box.min.y, H0 = Math.max(1e-3, box.max.y - fl), W0 = Math.max(1e-3, box.max.x - box.min.x);
      const seg = (a, b) => (a && b) ? a.distanceTo(b) : 0;
      const shL = wp('leftUpperArm'), shR = wp('rightUpperArm');
      if (nat && shL && shR) {
        // ★★ 手臂可达长度用**骨段求和**（肩→肘 + 肘→腕 ×1.12 含手掌），不要用"肩→手直线距离"：
        //    直线距离在手臂弯曲/姿势变化时会明显偏小，而骨段长度对姿势不敏感、永远等于真实可达长度。
        //    这条踩得很实：实测日志打出"举手可达 1.01×身高｜展臂 1.00×宽"——展臂不可能只有躯干那么宽，
        //    说明量到的臂长是垃圾值，于是取景按"极小的包络"留余量 ⇒ 抬起的手臂被面板压住 / 被画布切掉。
        const armOf = (side, sh) => seg(sh, wp(side + 'LowerArm')) + seg(wp(side + 'LowerArm'), wp(side + 'Hand')) * 1.12;
        const armLen = Math.max(armOf('left', shL), armOf('right', shR));
        const shTop = Math.max(shL.y, shR.y) - fl;                          // 肩离地高
        const span = shL.distanceTo(shR);                                   // 肩宽
        const h1 = (shTop + armLen) / H0, w1 = (2 * armLen + span) / W0;
        // 合理性校验：人形"抬手高"必然 > 身高、"展臂宽"必然 > 身宽。不满足即判为量测失败，
        // 退回**大**的兜底值（宁可人物小一点，也不要让手臂出画/被面板压）。
        if (h1 > 1.05 && w1 > 1.05) {
          envReachH = Math.min(2.4, h1); envReachW = Math.min(3.4, w1);
          postLog('info', '取景包络实测：举手可达 ' + envReachH.toFixed(2) + '×身高｜展臂 ' + envReachW.toFixed(2)
            + '×宽（肩高 ' + shTop.toFixed(3) + '／臂长 ' + armLen.toFixed(3)
            + '／身高 ' + H0.toFixed(3) + '／身宽 ' + W0.toFixed(3) + '）');
        } else {
          envReachH = FIT_ENV_H; envReachW = FIT_ENV_W;
          postLog('warn', '取景包络量测不合理（抬手 ' + h1.toFixed(2) + '×身高／展臂 ' + w1.toFixed(2)
            + '×宽，人形应当都 >1）⇒ 已退回兜底 ' + FIT_ENV_H + ' ×身高 / ' + FIT_ENV_W + ' ×宽，请把这行发给开发者');
        }
      } else {
        envReachH = FIT_ENV_H; envReachW = FIT_ENV_W;
        postLog('warn', '取景包络量测失败：取不到肩部骨骼 ⇒ 已退回兜底 ' + FIT_ENV_H + '/' + FIT_ENV_W);
      }
    } catch (e) { postLog('warn', '取景包络量测失败（退回默认 1.28/1.30）：' + e.message); }
    window.EmbodiedRig = { up: up.toArray(), lateral: lateral.toArray(), fwd: fwd.toArray(), dir: dir, hipToHead: hipToHead, legs: legs, hand: hand, fingerAxes: fingerAxes };
    // ★★ rig 建好之后，下面这些"附带量测 / 套用设置"**任何一个出错都不许再让 rig 失效**：
    //   一旦置空 ⇒ 每次合成都会重量测（第 4182 行就是那个触发点），而量测会给骨头摆测试姿势
    //   ⇒ 持续抽搐；并在"已经弯着的手"上重测轴 ⇒ 手指轴变垃圾 ⇒ 手指怎么调都不动。
    //   （实测：13 秒被刷 600+ 行 `量 rig 失败…fingerAxes is not defined` —— 就是这个循环。）
    try {
      measurePoseAxes();
      // ★ 停用「通道方向核对」：这套方法在本模型上**不可靠**（实测每次把所有通道都判成"内✗"，把用户带偏过
      //   好几轮）。它只写日志、不改行为，但会污染排查线索 ⇒ 直接不跑（函数保留，将来改用 compose 真值重写）。
      // measureChannelDirs();
      // ★ 套用「手指方向（四指/拇指）」的按模型设置（自动=几何基线；反转=再取反）
      const _hfN = applyHandFlipModes();
      postLog('info', '手指方向：四指=' + poseFamilyMode('hand') + ' 拇指=' + poseFamilyMode('thumb')
        + '（共 ' + _hfN + ' 根手指骨；模型键 ' + rigModelKey() + '）');
      // ★★ 逐轴微调值：载入**本模型**的存档（按模型，互不串）—— 这才是"数值能保存/重开面板不是 0"的落点。
      const _psN = adoptSavedPoseOffsets();
      postLog('info', '姿势微调存档：本模型 ' + _psN + ' 个姿势有值'
        + (_psN ? '（已载入并生效，重开面板显示的就是这些数字）' : '（没有存档 ⇒ 面板显示 0 是正常的）')
        + '｜模型键 ' + rigModelKey());
    } catch (eX) {
      postLog('warn', '骨架附带量测/设置失败（rig 已保留，不会重测循环）：' + ((eX && eX.message) || eX));
    }
    console.log('[3D桌宠] 已量出骨架 rig：' + Object.keys(dir).length + ' 根骨骼朝向，面朝=' +
      fwd.toArray().map(v => v.toFixed(2)).join(','));
    _rigFailN = 0;                 // 成功 ⇒ 清失败计数
    // ★ v11.39 量完立刻把 T-pose 收回去：否则角色会被"卡"在标准 T-pose 上（双臂平举）。
    //   放在 finally ⇒ 中间任何一步抛异常/提前 return 也一定会还原。
    //   ★ dir/fwd 是 const，只活在 try 里 ⇒ 用到它们的句子必须在 finally **之前**（漏了就
    //     ReferenceError，且是严格模式下每次量测都炸 —— 这条踩过不止一次）。
    } finally {
      for (const _cs of _canonSaved) _cs[0].quaternion.copy(_cs[1]);
      try { vrm.scene.updateMatrixWorld(true); } catch (_canonE) { }
      // 量出来的朝向留一条证据：手臂应当"向外张开"（规范 T/A-pose），腿应当"朝下"。
      //   如果这里打出"手臂朝下/朝上"，说明该模型的归一化骨没被 three-vrm 归一化 ⇒ 换模型仍会翻。
      try {
        const _d = (window.EmbodiedRig && window.EmbodiedRig.dir) || {};
        const _fmt = (v) => v ? ('(' + v[0].toFixed(2) + ',' + v[1].toFixed(2) + ',' + v[2].toFixed(2) + ')') : '—';
        postLog('info', '规范 T-pose 骨架朝向：右上臂 ' + _fmt(_d.rightUpperArm)
          + '｜左上臂朝向 ' + _fmt(_d.leftUpperArm)
          + '｜右大腿朝向 ' + _fmt(_d.rightUpperLeg)
          + '（手臂应偏外、腿应偏下 ⇒ 与模型/姿势/「反转」开关均无关）');
      } catch (_lf) { }
    }
    // ★★ v11.42「通道轴必须由**实际静止姿势**推，不能由规范 T-pose 推」——
    //   v11.39 我把朝向也拿到规范 T-pose 下量，结果**把肘铰链轴搞坏了**（用户："小臂直接没转，
    //   而是从伸直状态直接往上反弯折，正常人完全做不到，手臂会掰折"）。核对 axisFor 就明白了：
    //     肘通道 kind='fwd' ⇒ 轴 = cross(骨骼朝向, 面朝)
    //       实际静止（手臂下垂，朝向≈(0,-1,0)）⇒ 轴 = ±X（左右轴）⇒ **这才是真屈肘** ✓
    //       规范 T-pose（手臂水平，朝向≈(−1,0,0)）⇒ 轴 = +Y（竖直轴）⇒ 整条小臂横甩 ✗
    //   同理膝盖也是"绕左右轴"才是屈膝。所以：
    //     · 腿长/髋→头距/手指轴/掌心法线 —— 继续用规范 T-pose（与姿势无关，越干净越好）✓
    //     · **骨骼朝向 dir** —— 必须用当前实际姿势（手臂自然下垂的那副骨架）✓
    try {
      const dirNow = {};
      for (const b in CHILD2) {
        const a = wp(b), c = wp(CHILD2[b]);
        if (a && c) { const d = c.clone().sub(a); if (d.lengthSq() > 1e-10) dirNow[b] = d.normalize().toArray(); }
      }
      for (const n in LEAF2) { if (!dirNow[n] && dirNow[LEAF2[n]]) dirNow[n] = dirNow[LEAF2[n]].slice(); }
      if (window.EmbodiedRig && Object.keys(dirNow).length >= 8) {
        // ★★ v11.43「左右对称化」（用户："两个手臂造型都不一样，这怎么算的？"）：
        //   预设里左右通道值**完全相同**（如 lArmUp/rArmUp 都写 104），可画面上两只手臂却一高一低 ——
        //   因为轴是从**各自实测的朝向**推出来的，而 PMX 模型的左右骨朝向并不严格镜像
        //   （实测右上臂≠左上臂的镜像）⇒ 同样的度数得到不同的摆动。
        //   修法：以左侧为基准，右侧强制取"关于 lateral 轴的镜像" ⇒ 两侧轴严格镜像，
        //   **同一组通道值必然得到镜像的动作**（与模型自身左右是否对称无关）。
        const _lat = (window.EmbodiedRig && window.EmbodiedRig.lateral) || [1, 0, 0];
        const _mirror = (v) => {
          const d = v[0] * _lat[0] + v[1] * _lat[1] + v[2] * _lat[2];
          return [v[0] - 2 * d * _lat[0], v[1] - 2 * d * _lat[1], v[2] - 2 * d * _lat[2]];
        };
        const PAIRS = [['leftShoulder', 'rightShoulder'], ['leftUpperArm', 'rightUpperArm'],
          ['leftLowerArm', 'rightLowerArm'], ['leftHand', 'rightHand'],
          ['leftUpperLeg', 'rightUpperLeg'], ['leftLowerLeg', 'rightLowerLeg'],
          ['leftFoot', 'rightFoot'], ['leftToes', 'rightToes']];
        let _symN = 0;
        for (const _pr of PAIRS) { if (dirNow[_pr[0]] && dirNow[_pr[1]]) { dirNow[_pr[1]] = _mirror(dirNow[_pr[0]]); _symN++; } }
        window.EmbodiedRig.dir = dirNow;
        const _fn = (v) => v ? ('(' + v[0].toFixed(2) + ',' + v[1].toFixed(2) + ',' + v[2].toFixed(2) + ')') : '—';
        postLog('info', '实际姿势朝向（通道轴用这一副，左右已镜像对称 ' + _symN + ' 对）：右臂 ' + _fn(dirNow.rightUpperArm)
          + '｜左臂 ' + _fn(dirNow.leftUpperArm) + '｜右大腿 ' + _fn(dirNow.rightUpperLeg) + '｜左大腿 ' + _fn(dirNow.leftUpperLeg)
          + '（两臂应互为镜像 ⇒ 同一组通道值必然摆出镜像的动作）');
      }
    } catch (_dn) { }
    // ★★ v11.45「肘铰链轴（真铰链）」—— 专门量**肘**，供 compose 的 hingeMeasured 通道用。
    //   为什么必须单独量、且必须在**实际姿势**下量：
    //     · 手臂**下垂**时，"让手往上走"的小臂旋转轴 ≈ **左右轴**（这才是真屈肘）；
    //     · 若拿规范 T-pose（手臂水平）去量，得到的是**前后轴** ⇒ 屈肘又变成横甩（又回到掰折）。
    //   做法和"拇指方向核对"同一套：对每根局部轴 ±ε 试转一次，看**手**往哪个方向动得最多，
    //   取"朝上分量最大"的那根轴 ⇒ 判据是标量、可自证，与任何坐标系约定无关。
    try {
      const _AX = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) };
      // ★★ v11.47 判据修正：原来用"手往**上**走的分量最大" —— 对手臂**下垂**的骨架这是**错的**：
      //   手已经在最低点，小角度试转的一阶位移是**水平**的 ⇒ "朝上分量"基本是噪声，
      //   结果被手臂那点倾斜主导 ⇒ 量出世界轴 ≈ 前后轴 Z(0.98)（日志实证），屈肘就变成往侧面折。
      //   改用解剖学判据：**屈肘 = 小臂往身前走**（前臂向前屈），取"手往**面朝方向**的分量最大"，
      //   并把试转角度从 14° 加到 29°（位移够大才测得准）。
      const _EPS = 0.5, _qq = new THREE.Quaternion();
      const _p0 = new THREE.Vector3(), _p1 = new THREE.Vector3();
      const _fwdV = new THREE.Vector3().fromArray((window.EmbodiedRig && window.EmbodiedRig.fwd) || [0, 0, 1]);
      const _measureHinge = (boneName, childName) => {
        const b = vrm.humanoid.getNormalizedBoneNode(boneName);
        const c = vrm.humanoid.getNormalizedBoneNode(childName);
        if (!b || !c) return null;
        vrm.scene.updateMatrixWorld(true);
        c.getWorldPosition(_p0);
        // ★★ v11.46：探针量到的是**骨骼局部轴**（右乘语义），而 compose 发的是**世界增量** ——
        //   两者差一个"骨骼自身的滚转"：`世界轴 = 骨骼当前世界朝向 · 局部轴`。
        //   compose 手里只有静止朝向 dir（一个方向向量，**没有滚转**）⇒ 它做不了这个转换。
        //   v11.45 我把局部轴直接当世界轴用 ⇒ 轴被骨骼滚转带偏 ⇒ 部分模型"屈肘"变成往下折
        //   （用户："为什么有的模型小臂的肘是反的，它不是往上，它往下"）。
        //   ⇒ 在这里**当场转成世界轴**再交给 compose，compose 只需随父级搬（它本来就会）。
        const wq = new THREE.Quaternion();
        b.getWorldQuaternion(wq);
        const save = b.quaternion.clone();
        let best = { k: -1, a: 'x', s: 1 };
        for (const ax of ['x', 'y', 'z']) for (const sg of [1, -1]) {
          b.quaternion.copy(save);
          b.quaternion.multiply(_qq.setFromAxisAngle(_AX[ax], _EPS * sg));
          b.updateWorldMatrix(true, true);
          c.getWorldPosition(_p1);
          const d = _p1.clone().sub(_p0).dot(_fwdV);       // 往**身前**的分量（屈肘方向）
          if (Math.abs(d) > best.k) best = { k: Math.abs(d), a: ax, s: d >= 0 ? sg : -sg };
        }
        b.quaternion.copy(save); b.updateWorldMatrix(true, true);
        // 局部轴 × 符号 ⇒ 转到世界（符号已折进向量里，交给 compose 时 s 恒为 +1）
        const w = _AX[best.a].clone().multiplyScalar(best.s).applyQuaternion(wq).normalize();
        best.world = [w.x, w.y, w.z];
        return best;
      };
      const _axL = _measureHinge('leftLowerArm', 'leftHand');
      const _axR = _measureHinge('rightLowerArm', 'rightHand');
      if ((_axL || _axR) && window.EmbodiedRig) {
        const axes = {};
        if (_axL) axes.leftLowerArm = { up: { v: _axL.world, s: 1 } };
        if (_axR) axes.rightLowerArm = { up: { v: _axR.world, s: 1 } };
        window.EmbodiedRig.axes = axes;
        window.__petAxesBackup = axes;              // ★ 逃生开关用（见 window.petTrueHinge）
        const _f = (r) => r ? ('世界(' + r.world[0].toFixed(2) + ',' + r.world[1].toFixed(2) + ',' + r.world[2].toFixed(2) + ')'
          + '←局部' + r.a + (r.s > 0 ? '+' : '−')) : '—';
        postLog('info', '肘铰链轴（实际姿势实测·已转世界）：左小臂 ' + _f(_axL) + '｜右小臂 ' + _f(_axR)
          + '（绕它转 = 手往身前屈 ⇒ 真屈肘；左右两臂的世界轴应大致反向，且应接近左右轴）');
      }
    } catch (_axE) { }
  } catch (e) {
    // ★ 失败**不置空**既有 rig（旧 rig 远好过 null：null 会触发"每次合成⇒重测"的循环），
    //   并做 2 秒限流 + 计数 ⇒ 同一类错误最多每 2 秒记一行，一眼能看出"在循环"而不是被刷屏淹没。
    _rigFailN++; _rigFailT = Date.now();
    postLog('warn', '量 rig 失败（第 ' + _rigFailN + ' 次，rig ' + (window.EmbodiedRig ? '保留旧值' : '仍为空')
      + '）：' + ((e && e.message) || e));
  }
}

// 供外部（ardy 生成动作）随时索取骨架基：没量就现在量；VRM 还没载完则返回 null 让调用方等。
// 为什么需要它：启动时那次测量是"一次性"的，若在模型加载完成前就调用生成动作，会取不到基准。
let embodiedRigWarned = false;
window.embodiedRigEnsure = function () {
  try {
    if (!window.EmbodiedRig && vrm && vrm.humanoid) {
      try { embodiedEnsureRest(); } catch (e) { /* 交给下面统一判定 */ }
      if (!window.EmbodiedRig) embodiedMeasureRig();
      if (!window.EmbodiedRig && !embodiedRigWarned) {
        embodiedRigWarned = true;
        postLog('warn', '量不到骨架基：vrm=' + !!vrm + ' humanoid=' + !!(vrm && vrm.humanoid) +
          '（模型可能缺两侧上臂，无法自动定"左右"）');
      }
    }
  } catch (e) { }
  return window.EmbodiedRig || null;
};

// 让 mixer 让位：停自动跳舞 + 淡出当前动作/手势/拖拽，把归一化骨骼交出来
function embodiedYieldOn() {
  if (embodiedYielding) return;
  embodiedYielding = true;
  try { dancingNow = false; } catch (e) { }
  try { stopCurrentMotion(0.2); } catch (e) { }
  for (const a of [gestureAction, dragAction]) { if (a) { try { a.fadeOut(0.15); } catch (e) { } } }
  embodiedSmoothQ = {};   // 重采起点：下一帧以“当前姿态”平滑过渡（避免跳变）
  postLog('info', '具身动作接管骨骼（mixer 让位）');
}
function embodiedYieldOff() {
  if (!embodiedYielding) return;   // 未让位 → 纯 no-op（保证默认关时零影响）
  // ★ 骨骼是共享资源：ardy 生成动作层还在用的时候不准释放。
  //   否则具身层"自己队列空了就交还 mixer"会把骨骼抢回去，两层每帧互相覆盖 →
  //   表现为全身乱晃、"像没站在地面上"、动作播到一半像被待机动画顶掉（实测如此）。
  if (ardyActive) {
    if (!ardyYieldHoldLogged) { ardyYieldHoldLogged = true; postLog('info', '生成动作占用骨骼中，暂不交还 mixer'); }
    return;
  }
  embodiedYielding = false;
  ardyYieldHoldLogged = false;
  // ★★ v11.38「交还骨骼时实测」—— 一句判定"落地后弯膝久"到底出在哪一环：
  //   · 交还时膝已经放平（<15°）⇒ 剪辑内是放平了的，用户看到的"等一会才放平"是**交接回站姿**慢
  //     （在 mixer 的 stand/待机，或造型面板那条 40s 保持预览的姿势本身是弯膝的）；
  //   · 交还时膝还弯着 ⇒ 剪辑里就没放平，要改的是预设的收尾段时长/膝值。
  try {
    if (typeof performance !== 'undefined' && performance.now() - _handoffT > 800 && vrm && vrm.humanoid && !embodiedQueueIsHold) {
      _handoffT = performance.now();
      var _ka = function (b) { return b ? (2 * Math.acos(Math.min(1, Math.abs(b.quaternion.w))) * 180 / Math.PI) : 0; };
      var _k1 = _ka(vrm.humanoid.getNormalizedBoneNode('leftLowerLeg'));
      var _k2 = _ka(vrm.humanoid.getNormalizedBoneNode('rightLowerLeg'));
      postLog('info', '· 交还骨骼时实测：膝 左' + _k1.toFixed(0) + '°/右' + _k2.toFixed(0) + '°'
        + (_k1 + _k2 > 30 ? ' ⇒ **剪辑内就没放平**（改预设收尾段）' : ' ⇒ 剪辑内已放平（画面还弯 ⇒ 是交接回站姿/保持预览的锅）'));
    }
  } catch (_he) { }
  try { dancingNow = false; } catch (e) { }   // 交还骨骼：恢复追踪/待机（与 ardyIngest 里的置 true 成对）
  // ★ 交还那一刻不能"瞬间弹回"：追踪层的偏移量一直在算（只是被压制），标志一翻就会一次性回来
  //   → 表现为"做完动作闪回抽搐几帧"。把它的平滑状态清零，让它从 0 重新缓入（回正脸再跟光标）。
  try { headPresence = 0; followNDC = { x: 0, y: 0 }; } catch (e) { }
  // ★★ v11.28：**删掉 `springBoneManager.reset()`**（保留计数便于观察）——
  //   实证链（用户日志）：状态行 `弹簧复位=1→4→6→8→10` **每播一个动作就 +1**，同时"瞬跳捕获"里
  //   全是 `弹簧骨·Bone_Hair001_M 单帧跳 44~154°` / `弹簧骨·怀表 单帧跳 67°` —— **就是这行造成的**：
  //   `reset()` 把每根弹簧骨**瞬移回静止姿势** ⇒ 头发/配饰"闪一下"（用户："后半部分直接抽帧闪烁"）。
  //   当初加它是怕"收尾姿势突变致头发震荡"，但那几轮的收尾问题（段末不同步、偏移尖峰）已经修好，
  //   头发不会再被激发 —— 弹簧骨本来就是**自收敛**的，让它按物理自然回稳即可。
  //   若日后真出现"收尾后头发持续震荡"，正确做法是**延迟 0.3s 再做一次软复位**，绝不要在交还那一帧硬 reset。
  try { _springResetN++; } catch (e) { }
  ardyHipsReset();     // 根位移是临时叠加：交还时把 hips.position 还回去
  ardyTraceArm(1.0);   // 自动开 1 秒采样：把交还前后那几帧记下来（下次日志就能定位）
  embodiedSmoothQ = {};            // 清空本层平滑状态
  // 不再硬写“原始静止”（T-pose 会造成收尾瞬间跳变）：交给基础姿态层自然接管即可（姿势本就接近）。
  postLog('info', '具身动作释放骨骼（恢复 mixer/待机/跳舞）');
}

// ---- ardy 生成动作层（第 2 步：生成 → 重定向 → 播放）----
// 帧格式：{ fps?:20, frames:[ { aims:[ {bone, childBone, dir:[x,y,z]} ] } ] }
//   dir = 该骨骼在 **VRM 世界系** 里的目标朝向（由 ardy-retarget.js 从 ardy 的关节位置算出，
//   坐标基与模型朝向都是量出来的，不是手调的）。
// 为什么用 aim（世界朝向）而不是“局部增量四元数”：ardy 给的是关节位置，父子方向即骨骼朝向；
//   aim 与骨骼长度、模型比例、rest 偏移全都无关，父骨转完后子骨的轴自动跟上。
// 与具身动作共用让位机制（embodiedYieldOn/Off）：播放时 mixer 交出骨骼，播完自动还回去。
let ardyFrames = [], ardyChildOf = {}, ardyFps = 20, ardyPlayT = 0, ardyActive = false, ardyBlend = 0, ardyLast = null;
let ardyYieldHoldLogged = false;   // 「占用中不交还」只提示一次，避免刷屏
let _ardyVA, _ardyVB, _ardyVT, _ardyQ, _ardyPQ, _ardyInv;
let ardyHipsRest = null;        // 根位移用：本片段开始时 hips 的静止位置（交还时复位）
let ardyRootWeight = 0.8;       // 根位移应用比例（可调；0 = 不接根位移）

function ardyIngest(msg) {
  if (!msg) return;
  if (msg.fps) ardyFps = Math.max(1, Math.min(120, +msg.fps || 20));
  const fr = Array.isArray(msg) ? msg : (msg.frames || []);
  let n = 0;
  for (const f of fr) {
    if (!f || !f.aims || !f.aims.length) continue;
    const dirs = {};
    let yaw = null;
    for (const a of f.aims) {
      if (!a) continue;
      if (typeof a.yaw === 'number') { yaw = a.yaw; continue; }   // 骨盆：只取 yaw，不占 aim
      if (!a.dir) continue;
      dirs[a.bone] = a.dir;
      if (a.childBone) ardyChildOf[a.bone] = a.childBone;
    }
    if (Object.keys(dirs).length === 0) continue;
    ardyFrames.push({ dirs: dirs, yaw: yaw, root: f.root || null }); n++;
  }
  if (ardyFrames.length > 900) ardyFrames.splice(0, ardyFrames.length - 900);   // 上限防内存涨
  if (n > 0) {
    // ★ 骨骼只有一套：生成动作开始前，把**具身层**的队列清掉。
    //   否则两层每帧互相覆盖（实测症状：造型拖着不动、膝盖被覆盖回直立、全身抽搐）。
    //   规则：**最新一次明确请求赢** —— 生成动作来了，之前顶住的姿势让位。
    embodiedQueue = []; embodiedPlayT = 0; embodiedPelvicQ = null; _embPinRawActive = false;
    ardyActive = true; ardyBlend = 0; ardyPlayT = 0; ardyLast = null; ardySmoothDir = {}; ardyYieldHoldLogged = false;
    embodiedYieldOn();
    // ★ 关键：头部/脊椎"光标追踪"与待机动作的开关条件是 (danceDisableTrack && dancingNow)，
    //   它们**不看** embodiedYielding。而 embodiedYieldOn 里写了 dancingNow=false →
    //   追踪会在生成动作期间继续写头/脊椎/上身，和本层 aim 每帧互相覆盖 =
    //   "带着身子乱晃 + 画面闪回多次"。所以这里把它按"正在播动作"处理。
    try { dancingNow = true; } catch (e) { }
  }
  // ★★ v11.44：日志措辞**必须避开 PROBE_HINTS 里的 `ardy`** —— 带这三个字母会被闸门整行静默，
  //   于是生成动作"入队/被停止/播完"全程不可见（日志里只剩"生成层=false"，根本查不出谁掐的）。
  //   和状态行里用"生成层"是同一个道理。
  postLog('info', '生成动作帧已入队：本次 ' + n + ' 帧，队列共 ' + ardyFrames.length + ' 帧');
}
// ★ v11.45 逃生开关：控制台里 `petTrueHinge(false)` 立刻退回旧的肘轴（不用改代码、不用重载）；
//   `petTrueHinge(true)` 再开回来。万一真铰链把某个预设弄歪了，这就是一键回滚。
//   原理：compose 每次合成都从 rig.axes 读，置 null 即走旧的叉乘公式（已验证逐帧完全一致）。
window.petTrueHinge = function (on) {
  try {
    if (!window.EmbodiedRig) return false;
    if (on === false) {
      if (window.EmbodiedRig.axes) window.__petAxesBackup = window.EmbodiedRig.axes;
      window.EmbodiedRig.axes = null;
      postLog('info', '肘真铰链已关闭（退回旧轴，行为与 v11.44 完全一致）');
    } else {
      if (window.__petAxesBackup) window.EmbodiedRig.axes = window.__petAxesBackup;
      postLog('info', '肘真铰链已开启（用实测局部轴）');
    }
    return true;
  } catch (e) { return false; }
};
window.ardyFeed = ardyIngest;
window.ardyStopArdy = function (why) {
  const _was = ardyActive;
  ardyFrames = []; ardyLast = null; ardyActive = false; ardyBlend = 0; embodiedYieldOff();
  if (_was) postLog('info', '生成动作已停止（原因：' + (why || '未说明') + '）');
};

// ---- aim「落地校验」：目标方向 vs 写入骨骼后的实际方向 ----
// 为什么必需：日志里一直只验证"**目标**方向"（抽查朝向），从没验证"目标是否真的落到骨骼上"。
// 一旦两者不符，问题就在写入层（父空间共轭/顺序/被别的层覆盖），而不是数据或重定向。
let ardyAimCheckWorst = 1, ardyAimCheckBone = '', ardyAimCheckN = 0, ardyAimCheckRows = [];
function ardyAimCheck() {
  if (!ardyActive) { ardyAimCheckWorst = 1; ardyAimCheckBone = ''; ardyAimCheckN = 0; return; }
  if (!ardyLast || !ardyLast.dirs || !vrm || !vrm.humanoid) return;
  const dirs = ardyLast.dirs;
  ardyAimCheckRows.length = 0;
  for (const b in dirs) {
    const n = vrm.humanoid.getNormalizedBoneNode(b); if (!n) continue;
    const cn = ardyChildOf[b]; const c = cn ? vrm.humanoid.getNormalizedBoneNode(cn) : null; if (!c) continue;
    const A = n.getWorldPosition(new THREE.Vector3()), B = c.getWorldPosition(new THREE.Vector3());
    const d = B.sub(A); if (d.lengthSq() < 1e-10) continue; d.normalize();
    const t = dirs[b];
    const dd = d.x * t[0] + d.y * t[1] + d.z * t[2];
    ardyAimCheckRows.push([b, dd]);
    if (dd < ardyAimCheckWorst) { ardyAimCheckWorst = dd; ardyAimCheckBone = b; }
  }
  ardyAimCheckN++;
  if (ardyAimCheckN % 20 === 0) {
    // ★ 只报"最小值"会误导（最小值差 ≠ 其他都好）。这里给出**分布**：
    //   好骨数 / 总骨数 + 最差三根。看分布才能分清是"整体系统性偏"还是"个别骨骼特例"。
    const rows = ardyAimCheckRows.slice().sort((a, b) => a[1] - b[1]);
    const good = rows.filter(r => r[1] > 0.95).length;
    const top3 = rows.slice(0, 3).map(r => r[0] + '=' + r[1].toFixed(2)).join(' ');
    postLog('info', 'ardy aim 落地校验：达标 ' + good + '/' + rows.length + '（点积>0.95）｜最差三根：' + top3 +
      (good === rows.length ? '  ✓ 全部落地' : (good === 0 ? '  ← 全都没落地：写入/测量系统性错' : '  ← 部分落地')));
  }
}

// 交还骨骼时把 hips.position 复位到本片段的静止位置 —— 根位移是"临时叠加"，不能留在骨骼上
function ardyHipsReset() {
  try {
    const hips = vrm && vrm.humanoid && vrm.humanoid.getNormalizedBoneNode('hips');
    if (hips && ardyHipsRest) { hips.position.copy(ardyHipsRest); hips.updateWorldMatrix(false, true); }
  } catch (e) { }
  ardyHipsRest = null;
}

function ardyInterp(a, b, f) {
  const a0 = a || {}, b0 = b || a || {};
  const da = a0.dirs || {}, db = b0.dirs || da;
  const out = {};
  for (const n in da) {
    const A = da[n], B = db[n] || A;
    const x = A[0] + (B[0] - A[0]) * f, y = A[1] + (B[1] - A[1]) * f, z = A[2] + (B[2] - A[2]) * f;
    const l = Math.hypot(x, y, z) || 1;
    out[n] = [x / l, y / l, z / l, A[3] || 0];   // 第 4 位 = 扭转角（沿用它，别在插值时丢掉）
  }
  // 骨盆 yaw：按**最短角**插值（±π 处线性插值会整圈反转）
  let yaw = null;
  if (typeof a0.yaw === 'number') {
    const y1 = a0.yaw, y2 = (typeof b0.yaw === 'number') ? b0.yaw : y1;
    let d = y2 - y1;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    yaw = y1 + d * f;
  }
  // 根位移：线性插值（位移没有角度歧义）
  let root = null;
  const r1 = a0.root, r2 = b0.root || r1;
  if (r1 && r2) root = [r1[0] + (r2[0] - r1[0]) * f, r1[1] + (r2[1] - r1[1]) * f, r1[2] + (r2[2] - r1[2]) * f];
  return { dirs: out, yaw: yaw, root: root };
}

// 播放头：推进 + 相邻源帧之间按小数相位插值方向（20fps 源在任意渲染帧率下都顺滑）
function ardyPull(dt) {
  ardyPlayT += dt * ardyFps;
  while (ardyPlayT >= 1 && ardyFrames.length > 1) { ardyFrames.shift(); ardyPlayT -= 1; }
  if (ardyPlayT >= 1) { ardyFrames = []; ardyPlayT = 0; postLog('info', 'ardy 动作播放完毕'); ardyTraceArm(1.5); return null; }
  return ardyInterp(ardyFrames[0], ardyFrames[1] || ardyFrames[0], ardyPlayT);
}

// 把“当前骨骼方向 → 目标方向”的世界系旋转写进骨骼（父骨先转，子骨随后量方向）
// 时间平滑（τ）：生成模型逐帧有抖动，直接照抄会"抽搐"；这里把**目标方向**按 τ 平滑掉高频抖动，
// 帧间插值交给播放头。τ 取面板「具身平滑」或 80ms（比具身层略大：生成动作本身更毛）。
let ardySmoothDir = {};
let ardyVelDir = {};            // ★ v11.19：惯性摆动的角速度状态（每骨，向量版二阶弹簧）

// ---- 生成动作的可调参数（审美/手感，全部可调；"正确性"比如坐标基、左右符号不在这里）----
// 逐骨"减权"：v1 不接根位移，腿若 100% 跟随生成动作会变成"原地滑步/站立不稳"。
// 下肢默认 0.4，脊柱 0.7，手臂/颈全跟（1.0，缺省）。控制台： ardyTune({leg:0.2, spine:0.5, smooth:0.12})
const ARDY_WEIGHT_DEFAULT = {
  // 骨盆现在是**只取 yaw**（左右髋轴的水平夹角，不含俯仰/翻滚）→ 结构上不可能倾斜，默认给足 1.0。
  // 想更"稳"就调小（0 = 骨盆完全不转）。
  hips: 1,
  // 下肢：根位移上线后提到 0.7（原来 0.4 是因为"髋不动、腿全跟"会滑步；现在重心会跟着走）
  rightUpperLeg: 0.7, rightLowerLeg: 0.7, rightFoot: 0.7, rightToes: 0.7,
  leftUpperLeg: 0.7, leftLowerLeg: 0.7, leftFoot: 0.7, leftToes: 0.7,
  spine: 0.7, chest: 0.7, upperChest: 0.7, neck: 0.9
};
let ARDY_WEIGHT = Object.assign({}, ARDY_WEIGHT_DEFAULT);
let ardySmoothTau = 0.08;   // 平滑时间常数（秒）：越大越稳、越小越跟手
let ardyTuneLogT = null;    // 参数日志去抖定时器
let ardyFadeOut = 0.6;      // 收尾淡出（秒）：播完从"最后一帧"平滑回位
function ardyTune(patch) {
  if (patch && typeof patch === 'object') {
    if (patch.leg !== undefined) {
      const v = Math.max(0, Math.min(1, +patch.leg || 0));
      for (const s of ['left', 'right']) for (const b of ['UpperLeg', 'LowerLeg', 'Foot', 'Toes']) ARDY_WEIGHT[s + b] = v;
    }
    if (patch.spine !== undefined) {
      const v = Math.max(0, Math.min(1, +patch.spine || 0));
      ARDY_WEIGHT.spine = v; ARDY_WEIGHT.chest = v; ARDY_WEIGHT.upperChest = v;
    }
    if (patch.neck !== undefined) ARDY_WEIGHT.neck = Math.max(0, Math.min(1, +patch.neck || 0));
    // 骨盆单独可调：若出现"身体后仰/视角像仰视"这类观感，先把它调 0 试试（用来快速判定是不是骨盆驱动的问题）
    if (patch.hips !== undefined) ARDY_WEIGHT.hips = Math.max(0, Math.min(1, +patch.hips || 0));
    // 根位移比例：0 = 不接根位移（回到"腿在原地划水"的老观感）；越大越"重心跟着走"
    if (patch.root !== undefined) ardyRootWeight = Math.max(0, Math.min(2, +patch.root || 0));
    if (patch.smooth !== undefined) ardySmoothTau = Math.max(0, Math.min(0.6, +patch.smooth || 0));
    if (patch.fadeOut !== undefined) ardyFadeOut = Math.max(0.05, Math.min(3, +patch.fadeOut || 0.6));
    // 脚部 IK（第 5 项）：0 = 关闭（默认）。它只改两腿旋转，不动骨盆/基础姿势。
    if (patch.footIK !== undefined) ardyFootIK = Math.max(0, Math.min(1, +patch.footIK || 0));
    if (patch.reset) {
      ARDY_WEIGHT = Object.assign({}, ARDY_WEIGHT_DEFAULT);
      ardySmoothTau = 0.08; ardyFadeOut = 0.6;
      ardyRootWeight = 0.8;      // 原来漏了它：reset 后根位移会卡在上次的值，看起来像"没恢复默认"
      ardyFootIK = 0;            // 复位同样要把脚部 IK 归零（否则"恢复默认"后还在钉脚）
    }
    // ★★ 持久化（第 2 项）：**用户改的**才回传给宿主流盘（宿主那份 ArdyTune 会随 options 回来）。
    //   为什么以前重开窗口回默认：这 6 个数只活在内存里（ardyTune 只改局部变量、不发消息）。
    //   `ardyTuneFromHost` 防止"宿主回传 → 又发回宿主"的回环。
    if (!ardyTuneFromHost) ardyTuneSaveThrottled();
    // 拖动滑块会连发多次 → 合并成一次，避免刷屏（日志里只留最后一次）
    clearTimeout(ardyTuneLogT);
    ardyTuneLogT = setTimeout(() => {
      postLog('info', '生成动作参数：骨盆 ' + ARDY_WEIGHT.hips + '｜下肢 ' + ARDY_WEIGHT.leftUpperLeg +
        '｜脊柱 ' + ARDY_WEIGHT.spine + '｜根位移 ' + ardyRootWeight +
        '｜平滑 ' + ardySmoothTau + 's｜收尾淡出 ' + ardyFadeOut + 's');
    }, 350);
  }
  return {
    leg: ARDY_WEIGHT.leftUpperLeg, spine: ARDY_WEIGHT.spine, neck: ARDY_WEIGHT.neck,
    smooth: ardySmoothTau, fadeOut: ardyFadeOut
  };
}
window.ardyTune = ardyTune;
window.ARDY_WEIGHT = ARDY_WEIGHT;
// ---- ★★ 手感参数持久化（第 2 项）：骨盆/下肢/脊柱/根位移/平滑/收尾淡出 ----
// 存法：`sendSetting('ardyTune', JSON)` → 宿主 Configuration.ArdyTune（跨插件重载可靠）
//       → 宿主回 `options_update{ardyTune}` → applyArdyTuneJson() 装回来。
// 为什么不用 localStorage：插件重载后 webview 存储会换目录（实测"重载后全部重置"），只能靠宿主配置。
let ardyTuneFromHost = false, ardyTuneSaveT = null;
function ardyTuneJson() {
  return JSON.stringify({
    hips: ARDY_WEIGHT.hips, leg: ARDY_WEIGHT.leftUpperLeg, spine: ARDY_WEIGHT.spine,
    neck: ARDY_WEIGHT.neck, root: ardyRootWeight, smooth: ardySmoothTau, fadeOut: ardyFadeOut,
    footIK: ardyFootIK,          // 第 5 项：脚部 IK 权重（随手感参数一起持久化）
  });
}
function ardyTuneSaveThrottled() {
  if (ardyTuneSaveT) return;                       // 拖滑块连发 → 500ms 合并一次
  ardyTuneSaveT = setTimeout(() => {
    ardyTuneSaveT = null;
    try { sendSetting('ardyTune', ardyTuneJson()); } catch (e) { }
  }, 500);
}
function applyArdyTuneJson(json) {
  if (!json) return false;
  let o = null;
  try { o = (typeof json === 'string') ? JSON.parse(json) : json; } catch (e) { return false; }
  if (!o || typeof o !== 'object') return false;
  // ★ 只把**确实存在且是有限数**的项拼进 patch：`+undefined = NaN` 会被 ardyTune 夹成 0，
  //   那就等于把用户没设过的项清零了（这类"静默清零"最难查，直接堵死）。
  const p = {};
  for (const k of ['hips', 'leg', 'spine', 'neck', 'root', 'smooth', 'fadeOut', 'footIK']) {
    const v = +o[k];
    if (o[k] !== undefined && o[k] !== null && isFinite(v)) p[k] = v;
  }
  if (!Object.keys(p).length) return false;
  ardyTuneFromHost = true;
  try { ardyTune(p); } finally { ardyTuneFromHost = false; }
  postLog('info', '生成动作参数：已载入上次的手感（骨盆 ' + ARDY_WEIGHT.hips + '｜下肢 ' + ARDY_WEIGHT.leftUpperLeg
    + '｜脊柱 ' + ARDY_WEIGHT.spine + '｜根位移 ' + ardyRootWeight + '｜平滑 ' + ardySmoothTau + 's｜收尾淡出 ' + ardyFadeOut + 's）');
  return true;
}
window.ardyTuneJson = ardyTuneJson;
window.ardyTuneApply = applyArdyTuneJson;

// ---- 收尾"闪回抽搐"定位器：采样关键骨骼的世界四元数，看是哪一帧、哪根骨、被谁写走的 ----
// 用法：控制台 window.ardyTrace(3) 手动开 3 秒；交还骨骼时会**自动**开 1 秒（不需要人工操作）。
let ardyTraceUntil = 0, ardyTraceN = 0;
window.ardyTrace = function (sec) {
  ardyTraceUntil = performance.now() / 1000 + (sec || 1);
  ardyTraceN = 0;
  postLog('info', 'ardyTrace 已开启 ' + (sec || 1) + ' 秒（采样 hips/spine/右臂/右小腿 世界四元数）');
};
function ardyTraceArm(sec) { ardyTraceUntil = performance.now() / 1000 + (sec || 1); ardyTraceN = 0; }
const _ardyTracePrev = {};
function ardyTraceSample(tag) {
  if (!vrm || !vrm.humanoid) return;
  if (performance.now() / 1000 > ardyTraceUntil || ardyTraceN > 80) return;
  ardyTraceN++;
  // 只打印"**跳了**"的骨骼 + 跳了多少度：交还时的抽搐就是这里出现 >3° 的那几行
  const parts = [], prev = _ardyTracePrev[tag] || (_ardyTracePrev[tag] = {});
  for (const b of ['hips', 'spine', 'chest', 'neck', 'head', 'rightUpperArm', 'leftUpperArm', 'rightLowerLeg']) {
    const n = vrm.humanoid.getNormalizedBoneNode(b);
    if (!n) continue;
    const q = n.getWorldQuaternion(new THREE.Quaternion());
    const p = prev[b];
    if (p) {
      let dot = Math.abs(q.x * p[0] + q.y * p[1] + q.z * p[2] + q.w * p[3]);
      if (dot > 1) dot = 1;
      const deg = 2 * Math.acos(dot) * 180 / Math.PI;
      if (deg > 3) parts.push(b + '跳' + deg.toFixed(0) + '°');
    }
    prev[b] = [q.x, q.y, q.z, q.w];
  }
  postLog('info', 'ardyTrace#' + ardyTraceN + '[' + tag + '] ' + (parts.length ? parts.join(' ') : '（无跳变）'));
}

function ardyAimApply(pose, k, dt) {
  if (!vrm || !vrm.humanoid) return;
  const dirs = (pose && pose.dirs) || {};
  // 骨盆：**只转 yaw**（绕世界"上"轴的有符号轴角，模块按 three.js 约定给出）。
  // 必须写在 aim 循环之前：脊柱/腿的"当前方向"依赖骨盆朝向，先转骨盆，后面量的方向才在同一坐标系。
  if (pose && typeof pose.yaw === 'number') {
    const hips = vrm.humanoid.getNormalizedBoneNode('hips');
    const wH = (ARDY_WEIGHT.hips === undefined) ? 1 : ARDY_WEIGHT.hips;
    const ang = pose.yaw * wH * k;                 // k = 淡入淡出（作用在"转多少"上）
    if (hips && Math.abs(ang) > 1e-4) {
      vrm.scene.updateMatrixWorld(true);
      const upA = (window.EmbodiedRig && window.EmbodiedRig.up) || [0, 1, 0];
      const qa = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(upA[0], upA[1], upA[2]), ang);
      const pq = new THREE.Quaternion(), inv = new THREE.Quaternion();
      hips.parent.getWorldQuaternion(pq);
      inv.copy(pq).invert();
      hips.quaternion.copy(inv.multiply(qa).multiply(pq).multiply(hips.quaternion));
      hips.updateWorldMatrix(false, true);         // 让随后子骨（脊柱/腿）测方向时用上新姿态
    }
  }
  // 根位移：把重心平移写进 hips.position（世界偏移 → 父空间）。
  // 为什么需要：不接根位移时，腿只能在"固定不动的髋"下面摆动 → 观感就是"脚像悬浮、原地划水"。
  // 这是临时的叠加量，交还时由 ardyHipsReset() 复位（片段开始时重新采静止位置）。
  if (pose && pose.root && ardyRootWeight > 0) {
    const hips = vrm.humanoid.getNormalizedBoneNode('hips');
    if (hips) {
      if (!ardyHipsRest) ardyHipsRest = hips.position.clone();
      _ardyVT = _ardyVT || new THREE.Vector3();
      const w = ardyRootWeight * k;
      _ardyVT.set(pose.root[0] * w, pose.root[1] * w, pose.root[2] * w);
      _ardyPQ = _ardyPQ || new THREE.Quaternion();
      hips.parent.getWorldQuaternion(_ardyPQ).invert();   // 世界 → 父空间
      _ardyVT.applyQuaternion(_ardyPQ);
      hips.position.copy(ardyHipsRest).add(_ardyVT);
      hips.updateWorldMatrix(false, true);
    }
  }
  _ardyVA = _ardyVA || new THREE.Vector3(); _ardyVB = _ardyVB || new THREE.Vector3();
  _ardyVT = _ardyVT || new THREE.Vector3(); _ardyQ = _ardyQ || new THREE.Quaternion();
  _ardyPQ = _ardyPQ || new THREE.Quaternion(); _ardyInv = _ardyInv || new THREE.Quaternion();
  const tau = (typeof window.__embodiedSmooth === 'number') ? window.__embodiedSmooth : ardySmoothTau;
  // ★ v11.18：生成动作也吃"末端延迟"（远端更慢 = follow-through）—— 见 harmonicDelayScale。
  //   原来所有骨共用 ks ⇒ 整块同步；现在循环内按骨算 ksB。
  const ks = (dt > 0 && tau > 0) ? (1 - Math.exp(-dt / tau)) : 1;
  vrm.scene.updateMatrixWorld(true);      // 先刷新世界矩阵：下面读的是世界位置
  for (const bone in dirs) {
    const b = vrm.humanoid.getNormalizedBoneNode(bone); if (!b) continue;
    // ★ v11.18 末端延迟：本骨自己的平滑系数（远端 τ 更大 ⇒ 晚到、有拖尾）
    // ★ 与 embodiedApplyJoints 同一套规则：躯干跟面板（0=直通），只有远端吃 0.025×倍率的延迟底
    const _sc2 = harmonicDelayScale(bone);
    const _tauB2 = (_sc2 > 1) ? ((tau > 0 ? tau : 0.025) * _sc2) : tau;
    const ksB = (dt > 0 && _tauB2 > 0) ? (1 - Math.exp(-dt / _tauB2)) : 1;
    const cn = ardyChildOf[bone];
    const c = cn ? vrm.humanoid.getNormalizedBoneNode(cn) : null;
    if (!c) continue;
    b.getWorldPosition(_ardyVA); c.getWorldPosition(_ardyVB);
    const cur = _ardyVB.sub(_ardyVA);
    if (cur.lengthSq() < 1e-10) continue;
    cur.normalize();
    const d = dirs[bone];
    _ardyVT.set(d[0], d[1], d[2]);
    if (_ardyVT.lengthSq() < 1e-10) continue;
    // 逐骨平滑：拿到目标方向先"走到"平滑值，再 aim（换动作/新片段时由 ardyIngest 重置）
    const prev = ardySmoothDir[bone];
    const _ipA = inertiaParams(bone);                       // ★ v11.19：生成动作同样吃"惯性摆动"
    if (!prev) {
      ardySmoothDir[bone] = [_ardyVT.x, _ardyVT.y, _ardyVT.z];
      if (_ipA) ardyVelDir[bone] = { x: 0, y: 0, z: 0 };
    } else if (_ipA && dt > 0) {
      // 二阶弹簧-阻尼（向量版）：方向被"甩"向目标 ⇒ 过冲 + 回摆 = 惯性
      const w0 = _ipA[0], zeta = _ipA[1], dtE = Math.min(dt, 1 / 45);
      let vd = ardyVelDir[bone]; if (!vd) { vd = ardyVelDir[bone] = { x: 0, y: 0, z: 0 }; }
      vd.x += (w0 * w0 * (_ardyVT.x - prev[0]) - 2 * zeta * w0 * vd.x) * dtE;
      vd.y += (w0 * w0 * (_ardyVT.y - prev[1]) - 2 * zeta * w0 * vd.y) * dtE;
      vd.z += (w0 * w0 * (_ardyVT.z - prev[2]) - 2 * zeta * w0 * vd.z) * dtE;
      let vl = Math.hypot(vd.x, vd.y, vd.z);
      const VMAX2 = 22;
      if (vl > VMAX2) { const s = VMAX2 / vl; vd.x *= s; vd.y *= s; vd.z *= s; vl = VMAX2; }
      prev[0] += vd.x * dtE; prev[1] += vd.y * dtE; prev[2] += vd.z * dtE;
      const pl = Math.hypot(prev[0], prev[1], prev[2]) || 1;
      _ardyVT.set(prev[0] / pl, prev[1] / pl, prev[2] / pl);
    } else {
      prev[0] += (_ardyVT.x - prev[0]) * ksB; prev[1] += (_ardyVT.y - prev[1]) * ksB; prev[2] += (_ardyVT.z - prev[2]) * ksB;
      const pl = Math.hypot(prev[0], prev[1], prev[2]) || 1;
      _ardyVT.set(prev[0] / pl, prev[1] / pl, prev[2] / pl);
    }
    const w = ARDY_WEIGHT[bone];
    if (w !== undefined && w < 1) _ardyVT.lerp(cur, 1 - w).normalize();   // 减权：只走一部分，腿不乱晃
    // ★ 淡入/淡出必须作用在**修正量（四元数）**上：k=1 全量、k=0 不修正。
    //   旧写法插值"方向"（cur.lerp(target,k)）会让语义**反过来**（k=1 变成不修正、k=0 变成全量修正），
    //   收尾淡出时修正量反向增大 → 某一帧冲出一个大跳（实测：rightUpperArm 单帧跳 131°）。
    _ardyQ.setFromUnitVectors(cur, _ardyVT);
    if (k < 1) _ardyQ.slerp(_ardyInv.identity(), 1 - k);   // 向"无旋转"插值（_ardyInv 下面会重写，安全）
    // 扭转（dir[3]，来自 ardy 的 globalRotations 矩阵）：绕**新的骨轴**再滚转，补回 aim 丢掉的 roll。
    // 没有它的话：手臂横在胸前像"交叉"、关节像木偶（这就是"生硬"的根源）。
    const tw = d[3];
    if (typeof tw === 'number' && Math.abs(tw) > 1e-3) {
      _ardyInv.setFromAxisAngle(_ardyVT, tw * k);          // 轴 = 目标方向（_ardyVT 此时是单位向量）
      _ardyQ.premultiply(_ardyInv);                        // 先 aim 后 roll = roll ∘ aim
    }
    b.parent.getWorldQuaternion(_ardyPQ);
    _ardyInv.copy(_ardyPQ).invert();
    b.quaternion.copy(_ardyInv.multiply(_ardyQ).multiply(_ardyPQ).multiply(b.quaternion));
    b.updateWorldMatrix(false, true);          // 让后续子骨测方向时用上新姿态
  }
}

// ================= ★★ 脚部 IK（第 5 项：治"滑步"）=================
// 问题：生成式动作只给"骨朝向"（aims），腿是照方向摆的 ⇒ 脚常在地上**平移**（滑步是模型/数据固有问题）。
// 做法：在 ardy 施加之后补一层 —— **判定哪只脚落地**（优先用 ardy 的 footContacts；认不出就按"速度"自判）
//   → 落地那一刻记下**锚点**（世界坐标）→ 之后每帧用**两骨解析 IK** 把脚踝拉回锚点（按权重混合）。
// 安全边界：
//   ① 权重默认 **0（关闭）** ⇒ 不推滑条就与现在完全一样（这一层不参与）；
//   ② **只改 upperLeg / lowerLeg 两骨旋转**，不动骨盆、不动基础姿势、不写任何存档；
//   ③ 脚一抬起（速度超阈值）立即解除锚点 ⇒ 不会把抬腿动作拽住；
//   ④ 任何异常都被 catch 吞掉并只记一行 ⇒ 绝不影响正常播放。
let ardyFootIK = 0;
const footAnchor = { left: null, right: null, leftPrev: null, rightPrev: null };
let footIKLogSig = '';
const _fIK = { q: null, pq: null };     // ★ 延迟创建：模块顶层执行时 THREE 可能还没加载（懒建更安全）
function _fIKBones(side) {
  const h = vrm && vrm.humanoid;
  return {
    up: h.getNormalizedBoneNode(side + 'UpperLeg'),
    lo: h.getNormalizedBoneNode(side + 'LowerLeg'),
    ft: h.getNormalizedBoneNode(side + 'Foot'),
  };
}
/** 一条腿：落地判定 + 锚点维护 + 两骨解析 IK。hint=true/false 来自 ardy footContacts，null=按速度自判 */
function footIKApplyLeg(side, weight, dt, hint) {
  const B = _fIKBones(side);
  if (!B.up || !B.lo || !B.ft) return { planted: false, err: '缺骨' };
  const scaleRef = Math.max(1e-4, (window.EmbodiedRig && window.EmbodiedRig.hipToHead) || 0.5);
  const P = (b) => b.getWorldPosition(new THREE.Vector3());
  vrm.scene.updateMatrixWorld(true);
  const hip0 = P(B.up), knee0 = P(B.lo), ankle0 = P(B.ft);
  // 1) 落地判定
  const prevKey = side + 'Prev';
  const prev = footAnchor[prevKey];
  const speed = (prev && dt > 0) ? ankle0.distanceTo(prev) / dt : 0;
  footAnchor[prevKey] = ankle0.clone();
  const moving = speed > scaleRef * 0.8;               // 每秒移动 > 0.8×身高 ⇒ 摆动脚
  const planted = (hint === true) || (hint === false ? false : !moving);
  if (!planted) { footAnchor[side] = null; return { planted: false, speed: speed }; }
  if (!footAnchor[side]) footAnchor[side] = ankle0.clone();      // 刚落地的锚点
  if (!(weight > 0.001)) return { planted: true, speed: speed, held: false };
  // 2) 两骨解析 IK：目标 = 当前脚踝与锚点按权重混合
  const target = ankle0.clone().lerp(footAnchor[side], Math.max(0, Math.min(1, weight)));
  const L1 = hip0.distanceTo(knee0), L2 = knee0.distanceTo(ankle0);
  let d = hip0.distanceTo(target);
  d = Math.max(Math.abs(L1 - L2) * 1.02 + 1e-4, Math.min((L1 + L2) * 0.995, d));   // 夹到可达范围
  const axis = target.clone().sub(hip0).normalize();
  const kneeOff = knee0.clone().sub(hip0);
  const perp = kneeOff.clone().sub(axis.clone().multiplyScalar(kneeOff.dot(axis)));  // 保留原弯曲平面
  if (perp.lengthSq() < 1e-10) perp.set(0, 0, 1);
  perp.normalize();
  const aProj = (L1 * L1 - L2 * L2 + d * d) / (2 * d);
  const hgt = Math.sqrt(Math.max(0, L1 * L1 - aProj * aProj));
  const kneeNew = hip0.clone().add(axis.clone().multiplyScalar(aProj)).add(perp.clone().multiplyScalar(hgt));
  // 3) 世界空间旋转增量 → 父空间共轭（bone.quaternion.premultiply(P⁻¹·q·P)）
  if (!_fIK.q) { _fIK.q = new THREE.Quaternion(); _fIK.pq = new THREE.Quaternion(); }
  const aim = (bone, from, to) => {
    if (from.lengthSq() < 1e-12 || to.lengthSq() < 1e-12) return;
    const q = _fIK.q.setFromUnitVectors(from.clone().normalize(), to.clone().normalize());
    bone.parent.getWorldQuaternion(_fIK.pq);
    bone.quaternion.premultiply(_fIK.pq.clone().invert().multiply(q).multiply(_fIK.pq));
    bone.updateMatrixWorld(true);
  };
  aim(B.up, knee0.clone().sub(hip0), kneeNew.clone().sub(hip0));
  vrm.scene.updateMatrixWorld(true);
  const knee1 = P(B.lo);
  aim(B.lo, P(B.ft).clone().sub(knee1), target.clone().sub(knee1));
  vrm.scene.updateMatrixWorld(true);
  // 4) 迭代一次（两骨解析解一次就够，迭代吃掉数值误差；脚到不了目标时 err 会告诉我们）
  let ankle1 = P(B.ft);
  if (ankle1.distanceTo(target) > scaleRef * 0.004) {
    const hip2 = P(B.up), knee2 = P(B.lo);
    aim(B.up, knee2.clone().sub(hip2), kneeNew.clone().sub(hip2));
    vrm.scene.updateMatrixWorld(true);
    const knee3 = P(B.lo);
    aim(B.lo, P(B.ft).clone().sub(knee3), target.clone().sub(knee3));
    vrm.scene.updateMatrixWorld(true);
    ankle1 = P(B.ft);
  }
  return { planted: true, speed: speed, held: true, err: ankle1.distanceTo(target) };
}
/** 在 applyArdyRetarget 里、ardyAimApply 之后调用（k = 入场/收尾淡入系数） */
function ardyFootIKApply(dt, k) {
  try {
    if (!vrm || !vrm.humanoid || !THREE) return;
    if (!(ardyFootIK > 0.001)) {                         // 权重 0 ⇒ 完全不动骨骼（默认状态）
      if (footIKLogSig !== 'off') { footIKLogSig = 'off'; postLog('info', '脚部 IK：关闭（权重 0）⇒ 滑步按原样，想治就把「生成动作·脚部 IK」往上推'); }
      footAnchor.left = null; footAnchor.right = null;
      return;
    }
    const fr = (typeof ardyFrames !== 'undefined' && ardyFrames && ardyFrames[0]) || null;
    const con = (fr && fr.contact) || null;
    const w = Math.max(0, Math.min(1, ardyFootIK)) * Math.max(0, Math.min(1, (k === undefined ? 1 : k)));
    const rl = footIKApplyLeg('left', w, dt, con ? !!con.l : null);
    const rr = footIKApplyLeg('right', w, dt, con ? !!con.r : null);
    const sig = (rl.planted ? 'L' : '-') + (rr.planted ? 'R' : '-') + '|' + w.toFixed(1) + '|' + (con ? 'c' : 's');
    if (sig !== footIKLogSig) {
      footIKLogSig = sig;
      postLog('info', '脚部 IK：左=' + (rl.planted ? '钉住' : '摆动') + '（' + (rl.held ? ('保持 err ' + (rl.err || 0).toFixed(3)) : '仅判定') + '）'
        + ' 右=' + (rr.planted ? '钉住' : '摆动') + '｜权重 ' + w.toFixed(2) + '｜落地数据=' + (con ? 'ardy footContacts' : '按速度自判'));
    }
  } catch (e) { footIKLogSig = 'err'; postLog('warn', '脚部 IK 异常（已跳过这一帧）：' + ((e && e.message) || e)); }
}

function applyArdyRetarget(dt) {
  if (!vrm || !vrm.humanoid) { ardyActive = false; return; }
  // ★ 硬保证：本帧具身层已经写过骨骼（摆姿/预置/AI 的 bodyact spec）⇒ 生成层让位。
  //   队列清理是"君子协定"，这里才是防两层同帧互相覆盖的兜底（写入层互相覆盖 = 抽搐）。
  if (embodiedWroteFrame) return;
  // 采样点 1：mixer/基础姿态 之后、本层写入之前 —— 谁在上一帧末尾动过骨骼，看这里的跳变
  ardyTraceSample(ardyActive ? 'ardy前' : '交还后');
  if (!ardyActive) return;                     // 默认零影响
  // ★★ v11.44：生成动作**明明在播却被压住不出手**时要留证据 ——
  //   这条 `embodiedWroteFrame` 让位是"防两层同帧互盖"的正确设计，但如果**每一帧**都有别的层写骨
  //   （造型面板那条 40s 保持剪辑就是常驻户），生成动作就一帧都播不出来 ⇒ 用户看到"AI 动作被吞了"。
  if (embodiedWroteFrame) {
    if (typeof performance !== 'undefined' && performance.now() - _ardyBlockT > 3000) {
      _ardyBlockT = performance.now();
      postLog('warn', '生成动作被具身层压住：本帧具身已写骨 ⇒ 生成层整帧让位（AI 动作会播不出来/播一半）'
        + '｜保持剪辑=' + (!!embodiedQueueIsHold) + ' 队列=' + (embodiedQueue ? embodiedQueue.length : -1) + '帧'
        + '｜若这行持续出现 ⇒ 常驻的保持剪辑没能让位');
    }
    return;
  }
  if (ardyFrames.length) {
    ardyBlend = Math.min(1, ardyBlend + dt / 0.25);   // 入场 0.25s 淡入
    const dirs = ardyPull(dt);
    if (dirs) { ardyLast = dirs; ardyAimApply(dirs, ardyBlend, dt); ardyFootIKApply(dt, ardyBlend); return; }
  }
  if (ardyLast && ardyBlend > 0) {             // 队列空 → 用最后一帧淡出，交还骨骼
    ardyBlend = Math.max(0, ardyBlend - dt / ardyFadeOut);   // 收尾别像"闪一下"（可调）
    ardyAimApply(ardyLast, ardyBlend, dt);
    ardyFootIKApply(dt, ardyBlend);            // ★ 脚部 IK（权重 0 = 完全不动，见 ardyFootIKApply）
    if (ardyBlend <= 0.001) {
      ardyLast = null; ardyActive = false; embodiedYieldOff();
      postLog('info', '生成动作播完（队列走完 + 收尾淡出结束 ⇒ 正常交还骨骼）');
    }
    return;
  }
  ardyLast = null; ardyActive = false; embodiedYieldOff();
  postLog('info', '生成动作播完（无尾帧可淡出 ⇒ 直接交还骨骼）');
}

// ---- 真实数据入口（生成端注入）----
// 帧格式（可批量）：{ fps?:20, frames:[ { joints:{ "<Core27或VRM骨骼名>":[x,y,z,w], ... } }, ... ] }
// joints 给的是“相对中性姿态的局部增量四元数”，本层做 bone.quaternion = 静止 ⨯ 增量。
// 生成端负责把关节的全局旋转换算成这里的局部增量（见 skill §6.3）。
// 控制台手测：window.embodiedFeed([{ joints:{ leftUpperArm:[0,0,0.3,0.95] } }])
function embodiedIngest(msg) {
  if (!msg) return;
  if (msg.fps) embodiedFps = Math.max(1, Math.min(120, +msg.fps || 20));
  embodiedRootY = (typeof msg.rootY === 'number' && isFinite(msg.rootY)) ? msg.rootY : 0;   // 根位移（下蹲）
  embodiedTurn = (typeof msg.turn === 'number' && isFinite(msg.turn)) ? Math.max(-180, Math.min(180, msg.turn)) : 0;   // 整体转身（°）
  const fr = Array.isArray(msg) ? msg : (msg.frames || []);
  // ★ v11.12 连招（chain）：上一段若是"末尾不回中性"且正保持着末帧等接续，就把它的末帧记下来 ——
  //   本段开头会从那个姿势滑过去（见 embodiedPull 的"接续混合"），于是两段之间不会"站定一下再动"。
  const wasHolding = embodiedClipChain && embodiedChainHoldT > 0;
  const prevLast = wasHolding ? (embodiedQueue[embodiedQueue.length - 1] || embodiedQueue[0]) : null;
  let n = 0;
  if (Array.isArray(fr)) for (const f of fr) if (f && f.joints) { embodiedQueue.push(f); n++; }
  // ★★ v11.47（用户："AI 自己做的动作又被掐了"）：这条上限原来**从队首砍** ——
  //   造型面板的保持剪辑一条就 811 帧，两条叠起来（811+811=1622 > 900）⇒ 砍掉队首 722 帧，
  //   而**排在前面的正是正在播的那个动作** ⇒ 播到一半被整段抹掉（"只跳了几秒就被吞"）。
  //   改两处：① 上限抬高到 1800；② 超限也**只砍尾部**（待播的新帧），绝不砍正在播的。
  if (embodiedQueue.length > 1800) {
    const _keep = Math.max(1, embodiedPlayT | 0);          // 播放头之前的都是"已播/正在播"，保住
    const _over = embodiedQueue.length - 1800;
    const _cutFrom = Math.min(embodiedQueue.length - 1, Math.max(_keep, 0));
    const _cutN = Math.min(_over, embodiedQueue.length - _cutFrom - 1);
    if (_cutN > 0) embodiedQueue.splice(_cutFrom, _cutN);
    postLog('info', '具身队列超限：已裁掉尾部 ' + _cutN + ' 帧（正在播的不动）⇒ 当前 ' + embodiedQueue.length + ' 帧');
  }
  embodiedLiveReset();
  postLog('info', '★ 动作入队 · 前端版本 v11.50 ｜ 本次 ' + n + ' 帧');                  // ★ v11.29 新动作开始：清空"放下实况"缓冲
  embodiedClipChain = !!msg.chain;
  embodiedChainHoldT = 0;
  embodiedTauOverride = (typeof msg.tau === 'number' && msg.tau > 0) ? Math.max(0.005, Math.min(0.5, msg.tau)) : 0;
  if (wasHolding && prevLast && prevLast.joints && n > 0) { embodiedChainFrom = prevLast; embodiedChainFromT = 0; }
  postLog('info', '具身帧已入队：本次 ' + n + ' 帧，队列共 ' + embodiedQueue.length + ' 帧'
    + (embodiedClipChain ? '｜链式（末尾不回中性）' : '') + (embodiedChainFrom ? '｜接上一段末帧' : ''));
}
// 「动胯」时把**髋窝钉住**：骨盆一转，两个髋关节的世界坐标就会绕着骨盆中心被甩出去，
// 腿虽然朝向已被 compose 用 H⁻¹ 抵消，但位置仍被拖着平移 —— 看上去就是"腿也跟着转"（真人不会这样，
// 髋窝在骨盆上是固定的、腿在原地转）。这里把**位置**也抵消回来：腿根的局部偏移反向转一下即可。
// 注意：只抵消"骨盆自身旋转"这一步 ★ 根位移（下蹲）不受影响 —— 蹲的时候腿照样跟着骨盆一起下去。
// ★ 坐标系坑（踩过一次，症状 = 动胯时两只脚一前一后地滑）：
//   髋窝是**骨盆局部空间**里的一个偏移量，而"骨盆旋转 Δ"是**世界空间**的。
//   两者只有在"骨盆静止朝向 = 单位四元数"时才能直接相乘 —— 而 PMX/MMD 导出的模型，
//   腰/center 骨常常带 180° 朝向，于是补偿被转到了错方向 → 脚就滑了。
//   正解：局部偏移要乘的是 **（当前骨盆世界朝向)⁻¹ × (静止骨盆世界朝向)**，对任何朝向都精确。
const LEG_ROOTS = ['leftUpperLeg', 'rightUpperLeg'];
const PIN_LEGS = LEG_ROOTS;
const PIN_FEET = ['leftFoot', 'rightFoot'];
let embodiedPelvicQ = null;          // 本帧骨盆的旋转增量（= joints.hips），由具身驱动函数记录
let hipsRestWorldQ = null;           // 骨盆"静止时的世界朝向"（量骨架时记下，见 embodiedEnsureRest）
// ★ 关键区分：**归一化骨骼**（normalized，具身层驱动的那套，compose 语义所在）与
//   **原始骨骼**（raw，真正挂在场景里、被蒙皮用的那套）。three-vrm 只把归一化的【旋转】传给原始骨骼，
//   位置**只传 hips** ⇒ 对归一化腿根做的位置补偿看不见。所以基准/补偿/自检一律改成对**原始骨骼**做。
let rawRestHipsPet = null;           // 原始骨盆在【宠物坐标】里的静止位置（下蹲这类纯平移由它带走）
let rawRestSocketPet = {};           // 原始腿根在宠物坐标里的静止位置（钉位目标 + 自检基准）
let rawRestFootPet = {};             // 原始脚：用户眼里的"脚在动"量的就是它
// ★ 上三个是**宠物坐标**（会随 scale 变），所以另存"捕获时的原值 + 捕获时的 scale"，
//   缩放时由 applyRestPetScale 按比例换算 ⇒ 缩小后腿距不会被撑开。
let rawRestHipsPet0 = null, rawRestSocketPet0 = {}, rawRestFootPet0 = {}, restPetScale = 1;
let rawRestWorldQ = {};              // 原始腿根的静止世界朝向（判断"腿有没有被骨盆带着转"）
let rawRestLocalPos = {};            // 原始腿根的静止局部位置（不再动胯时还原）
let _embHipsQNow = null, _embHipsQFix = null, _embPinW = null, _embPinQ = null;
let _embPinV = null, _embPinV2 = null, _embM4 = null;
let _embPinCheckT = 0, _embPinActive = false, _embPinRawActive = false;

// ★ 宠物坐标的静止基准（髋 / 髋窝 / 脚）是**缩前**捕获的，模型 scale 一变就必须按比例换算：
//   否则钉位目标仍按旧尺寸算 ⇒ 缩得越小、腿根被推得越开（用户实测"缩小后腿间距变成这样"）。
//   关系是精确的：宠物坐标 = s · 模型局部坐标 ⇒ petLocal(s) = petLocal(s0) · s/s0。
function applyRestPetScale(s) {
  const k = (isFinite(s) && s > 0 && isFinite(restPetScale) && restPetScale > 0) ? (s / restPetScale) : 1;
  if (rawRestHipsPet0) rawRestHipsPet = rawRestHipsPet0.clone().multiplyScalar(k);
  rawRestSocketPet = {}; for (const n in rawRestSocketPet0) rawRestSocketPet[n] = rawRestSocketPet0[n].clone().multiplyScalar(k);
  rawRestFootPet = {}; for (const n in rawRestFootPet0) rawRestFootPet[n] = rawRestFootPet0[n].clone().multiplyScalar(k);
}

// ---- 拇指方向核对（可见日志，节流 1 秒）：拇指尖到"掌心(中指根)"的距离 —— **握拳时应当变小**。
//   为什么非要有它："往里收 / 往外翻"在缩略图上肉眼分不清，而各种"叉积点积"式判据极易退化
//   （已踩两次）。这个量是**标量**、不依赖任何坐标系约定 ⇒ 一看就知道对错，不必再猜。
let _thumbRestD = { left: null, right: null }, _thumbChkT = 0, _embFingerDriven = false;
function captureThumbRest() {
  for (const sd of ['left', 'right']) {
    const t = embRawBone(sd + 'ThumbDistal') || embRawBone(sd + 'ThumbProximal');
    const p = embRawBone(sd + 'MiddleProximal');
    if (!t || !p) { _thumbRestD[sd] = null; continue; }
    t.updateWorldMatrix(true, false); p.updateWorldMatrix(true, false);
    _thumbRestD[sd] = embToPetLocal(t.getWorldPosition(new THREE.Vector3()))
      .distanceTo(embToPetLocal(p.getWorldPosition(new THREE.Vector3())));
  }
}
function thumbsCheck() {
  const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  if (now - _thumbChkT < 1000) return;
  _thumbChkT = now;
  // ★★ 手指"送达"诊断（只读，1s 一次）：一次回答"值到没到骨头、有没有传到**蒙皮真正用**的原始骨"。
  //   为什么必须量这一环：three-vrm 的骨骼分两层 —— 我们写的是 **normalized**（归一化）骨，蒙皮用的是
  //   **raw**（原始）骨，中间靠 `vrm.update()` 里的 `humanoid.update()` 传导。手指"怎么调都不动"
  //   最可能就是**这一步没发生**，而它跟幅度/符号都无关（用户实测：拉到最大也没反应）。
  //   判据：指令变了以后，归一化骨和原始骨**都**应该转过一个角度；原始骨不转就说明卡在传导。
  try {
    const fk = 'leftIndexProximal';
    const nb2 = vrm && vrm.humanoid && vrm.humanoid.getNormalizedBoneNode ? vrm.humanoid.getNormalizedBoneNode(fk) : null;
    const rb2 = embRawBone(fk);
    if (nb2 && rb2) {
      const qn = nb2.getWorldQuaternion(new THREE.Quaternion());
      const qr = rb2.getWorldQuaternion(new THREE.Quaternion());
      const cmd = (_fLand && _fLand[fk] !== undefined) ? _fLand[fk] : null;
      if (_fSendPrev) {
        const dN = 2 * Math.acos(Math.min(1, Math.abs(qn.dot(_fSendPrev.qn)))) * 180 / Math.PI;
        const dR = 2 * Math.acos(Math.min(1, Math.abs(qr.dot(_fSendPrev.qr)))) * 180 / Math.PI;
        // ★ 阈值提到 3°（0.5° 会把呼吸/待机的微小抖动刷成每分钟几十行），或**指令真的变了**才打
        if (dN > 3 || dR > 3 || (cmd !== null && cmd !== _fSendPrev.cmd)) {
          postLog('info', '手指送达诊断（左食指近节）：指令 ' + (cmd === null ? '—' : cmd.toFixed(0) + '°')
            + '｜归一化骨较上次转 ' + dN.toFixed(1) + '°｜原始骨(蒙皮用)较上次转 ' + dR.toFixed(1) + '°'
            + ' ⇒ ' + (dR > 0.5 ? '传导正常（画面若仍不动 ⇒ 权重/骨名问题）'
              : (dN > 0.5 ? '**卡在传导**：归一化骨转了、原始骨没转（three-vrm 未同步）' : '**值没到骨头**')));
        }
      }
      _fSendPrev = { qn: qn.clone(), qr: qr.clone(), cmd: (cmd === null && _fSendPrev) ? _fSendPrev.cmd : cmd };
    }
  } catch (e) { }
  const parts = [];
  for (const sd of ['left', 'right']) {
    const r0 = _thumbRestD[sd]; if (r0 == null) continue;
    const t = embRawBone(sd + 'ThumbDistal') || embRawBone(sd + 'ThumbProximal');
    const p = embRawBone(sd + 'MiddleProximal');
    if (!t || !p) continue;
    t.updateWorldMatrix(true, false); p.updateWorldMatrix(true, false);
    const d = embToPetLocal(t.getWorldPosition(new THREE.Vector3()))
      .distanceTo(embToPetLocal(p.getWorldPosition(new THREE.Vector3())));
    parts.push((sd === 'left' ? '左' : '右') + r0.toFixed(3) + '→' + d.toFixed(3)
      + (d < r0 * 0.97 ? '（往里收 ✓）' : (d > r0 * 1.03 ? '（往外翻 ✗）' : '（几乎没动）')));
  }
  if (parts.length) postLog('info', '拇指方向核对：指尖↔中指根距离 ' + parts.join('｜') + '（握拳应变小）');
}

// 取"原始骨骼"节点（three-vrm 各版本 API 名不一，两种都试）
function embRawBone(name) {
  const h = vrm && vrm.humanoid;
  if (!h) return null;
  if (typeof h.getRawBoneNode === 'function') { const n = h.getRawBoneNode(name); if (n) return n; }
  const rb = h.rawHumanBones && h.rawHumanBones[name];
  return (rb && rb.node) || null;
}

// 把世界坐标换算到"宠物自己"的坐标系。**自检必须用它**：世界坐标会随"移动宠物/移动窗口/换显示器"
// 整体平移，直接比较世界坐标就会出现满屏的假误差（曾量出 170cm，其实只是把宠物挪了一下）。
function embToPetLocal(v) {
  try { if (petRoot) { petRoot.updateWorldMatrix(true, false); return petRoot.worldToLocal(v); } } catch (e) { }
  return v;
}
function applyEmbodiedLegPin() {
  if (!vrm || !vrm.humanoid) return;
  const hips = vrm.humanoid.getNormalizedBoneNode('hips');
  if (!hips) return;
  if (!embodiedYielding) embodiedPelvicQ = null;                       // 让位后不再保留
  if (!embodiedPelvicQ) {
    // 没在动胯：把上次钉位留下的偏移还原。只在"我们确实改过"时才写 —— 不动别人的骨骼是基本礼貌。
    if (_embPinActive) {
      for (const name of PIN_LEGS) {
        const b = vrm.humanoid.getNormalizedBoneNode(name), rest = embodiedRestP[name];
        if (b && rest && !b.position.equals(rest)) b.position.copy(rest);
      }
      _embPinActive = false;
    }
    return;
  }
  _embHipsQNow = _embHipsQNow || new THREE.Quaternion();
  _embHipsQFix = _embHipsQFix || new THREE.Quaternion();
  if (hipsRestWorldQ) {
    hips.updateWorldMatrix(true, false);
    hips.getWorldQuaternion(_embHipsQNow);                              // 含骨盆旋转 Δ
    _embHipsQFix.copy(_embHipsQNow).invert().multiply(hipsRestWorldQ);
  } else {
    _embHipsQFix.copy(embodiedPelvicQ).invert();                        // 兜底（量不到静止朝向时）
  }
  for (const name of PIN_LEGS) {
    const b = vrm.humanoid.getNormalizedBoneNode(name);
    const rest = embodiedRestP[name];
    if (!b || !rest) continue;
    b.position.copy(rest).applyQuaternion(_embHipsQFix);
  }
  _embPinActive = true;

  // ---- 自检：动胯时**每次都打数字**（节流 1 秒）----
  // 为什么非要有数字：这个 bug 已经来回两轮，靠"看上去对不对"判断太容易扯皮。三个量直接定责：
  //   髋窝残差     ~0 ⇒ 位置钉住了；大 ⇒ 位置补偿没生效
  //   腿根朝向偏差 ~0 ⇒ 腿没被骨盆带着转（正确）；≈骨盆角 ⇒ compose 的 H⁻¹ 抵消没落到腿上
  //   脚残差       ~0 ⇒ 用户眼里"脚没动"；大 ⇒ 脚确实在动
  // n/a = 那个骨骼名没解析到（缺节点本身就是故障原因之一，必须能看见）。
  const nowMs = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  if (nowMs - _embPinCheckT < 1000) return;
  _embPinCheckT = nowMs;
  _embPinW = _embPinW || new THREE.Vector3();
  _embPinQ = _embPinQ || new THREE.Quaternion();
  // 自检统一移到 applyEmbodiedLegPinRaw（在 vrm.update 之后）—— 量"最终画出来的那层"才有意义。
}

// ---------------------------------------------------------------------------
// 把**原始骨骼**的腿根也钉住 —— 这层才是决定"看起来动不动"的那层。
//
// 为什么必须补这一层（踩过的坑，源码级证据）：three-vrm 的 VRMHumanoidRig.update() 只把归一化骨骼的
// 【旋转】写给原始骨骼；位置**只写 hips 一个**（源码注释 “Move the mass center of the VRM”）。
// 所以对归一化腿根做的位置补偿**根本传不到蒙皮**：自检量归一化骨骼得到"髋窝 0.00cm（钉住了）"，
// 可画面上腿照样跟着骨盆平移 —— 量的和看的不是一回事（这就是上一版为什么"数字漂亮、眼睛不对"）。
// 教训：① 补偿要写在真正被渲染的那层骨架上；② 自检也必须量那一层。
//
// 目标位置 = 【宠物坐标】里的静止髋窝 + 骨盆这次的**纯平移**：
//   · 骨盆"旋转"不进入公式 ⇒ 转胯/侧倾时髋窝不动（腿在原地转，不跟着平移）
//   · 骨盆"平移"（下蹲根位移）会带走它 ⇒ 蹲的时候脚照样跟着下去
//   · 用宠物坐标表达 ⇒ 换姿势（petRoot 的旋转/下沉）时依然正确
function applyEmbodiedLegPinRaw() {
  if (!vrm || !vrm.humanoid) return;
  if (!embodiedYielding || !embodiedPelvicQ) {
    // 不再动胯：把原始腿根还原到静止局部位置（平时没人写它们，不清就会一直卡在最后一次的补偿值上）
    if (_embPinRawActive) {
      for (const name of PIN_LEGS) {
        const b = embRawBone(name), rest = rawRestLocalPos[name];
        if (b && rest && !b.position.equals(rest)) b.position.copy(rest);
      }
      _embPinRawActive = false;
    }
    return;
  }
  const rawHips = embRawBone('hips');
  if (!rawHips || !petRoot || !rawRestHipsPet) return;
  _embPinW = _embPinW || new THREE.Vector3();
  _embPinV = _embPinV || new THREE.Vector3();
  _embPinV2 = _embPinV2 || new THREE.Vector3();
  _embM4 = _embM4 || new THREE.Matrix4();
  // 骨盆这次的纯平移增量（宠物坐标）：旋转不改变骨盆原点位置，所以这里天然不含骨盆旋转
  rawHips.updateWorldMatrix(true, false);
  rawHips.getWorldPosition(_embPinW);
  _embPinV.subVectors(embToPetLocal(_embPinW), rawRestHipsPet);
  petRoot.updateWorldMatrix(true, false);
  for (const name of PIN_LEGS) {
    const b = embRawBone(name), restPet = rawRestSocketPet[name];
    if (!b || !restPet || !b.parent) continue;
    _embPinV2.copy(restPet).add(_embPinV);          // 目标（宠物坐标）
    _embPinV2.applyMatrix4(petRoot.matrixWorld);    // → 世界
    b.parent.updateWorldMatrix(true, false);
    _embM4.copy(b.parent.matrixWorld).invert();
    _embPinV2.applyMatrix4(_embM4);                 // → 原始父级局部
    b.position.copy(_embPinV2);
  }
  _embPinRawActive = true;

  // ---- 自检：量**原始骨骼**（= 眼睛看到的那层），节流 1 秒 ----
  // 髋窝残差 ~0 ⇒ 位置真的钉住了；腿根朝向偏差 ~0 ⇒ 腿没被骨盆带着转；脚残差 ~0 ⇒ 脚没动。
  // n/a = 那个骨骼名没解析到（缺节点本身就是故障原因之一，必须看得见）。
  const nowMs = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  if (nowMs - _embPinCheckT < 1000) return;
  _embPinCheckT = nowMs;
  _embPinQ = _embPinQ || new THREE.Quaternion();
  const posErr = (name, map) => {
    const b = embRawBone(name), rw = map[name];
    if (!b || !rw) return null;
    b.updateWorldMatrix(true, false); b.getWorldPosition(_embPinW);
    const w = embToPetLocal(_embPinW);      // 宠物自身坐标：世界整体平移（移动宠物）不算误差
    // 基准再叠上"骨盆这次的纯平移"（下蹲）—— 蹲下时脚本来就该跟着下去，不该记成误差。
    return Math.hypot(w.x - (rw.x + _embPinV.x), w.y - (rw.y + _embPinV.y), w.z - (rw.z + _embPinV.z)) * 100;
  };
  const qErr = (name) => {
    const b = embRawBone(name), rq = rawRestWorldQ[name];
    if (!b || !rq) return null;
    b.updateWorldMatrix(true, false); b.getWorldQuaternion(_embPinQ);
    return 2 * Math.acos(Math.min(1, Math.abs(_embPinQ.dot(rq)))) * 180 / Math.PI;
  };
  const n = (v, u, d) => v == null ? 'n/a' : v.toFixed(d) + u;
  const pelvDeg = 2 * Math.acos(Math.min(1, Math.abs(embodiedPelvicQ.w))) * 180 / Math.PI;
  // 骨盆三轴分解：胯的三个通道就是绕世界 X/Y/Z（见 embodied-compose 的 axisFor），
  // 于是"到底是哪种动胯"能从日志直接读出来，不必再问"你拖的是哪个"。
  const eu = new THREE.Euler().setFromQuaternion(embodiedPelvicQ, 'XYZ');
  const dg = v => v * 180 / Math.PI;
  const pelvAxes = '(前倾 ' + dg(eu.x).toFixed(1) + '/转胯 ' + dg(eu.y).toFixed(1) + '/侧倾 ' + dg(eu.z).toFixed(1) + ')';
  postLog('info', '[动胯自检·原始骨骼] 骨盆 ' + pelvDeg.toFixed(1) + '°' + pelvAxes + '｜髋窝残差 '
    + n(posErr('leftUpperLeg', rawRestSocketPet), 'cm', 2) + '/' + n(posErr('rightUpperLeg', rawRestSocketPet), 'cm', 2)
    + '｜腿根朝向偏差 ' + n(qErr('leftUpperLeg'), '°', 1) + '/' + n(qErr('rightUpperLeg'), '°', 1)
    + '｜脚残差 ' + n(posErr('leftFoot', rawRestFootPet), 'cm', 2) + '/' + n(posErr('rightFoot', rawRestFootPet), 'cm', 2));
}

// 根位移（下蹲 / 降低重心）：把**胯骨整体下移**。腿会跟着下去，配合「屈膝 + 勾脚」就是蹲姿；
// 这也是为什么不给"根位移"通道就没法蹲 —— 光屈膝、骨盆不降，人只会像个悬空的反关节。
// 它走的是**骨骼位置**而不是旋转，所以不算 channel，由 spec.rootY 给（见 embodied-compose）。
// 让位（没在播具身动作）时自动归零，蹲姿的位移不会残留在待机动作上。
let embodiedRootY = 0, embodiedRootApplied = 0;
// ★ v11.12 连招（chain）：本段是否"末尾不回中性"、播完后保持末帧等接续的计时、以及"上一段的末帧"（供接续混合）
let embodiedClipChain = false, embodiedChainHoldT = 0, embodiedChainFrom = null, embodiedChainFromT = 0;
// ★ v11.13 每个动作可以自带"输出平滑"覆盖（`spec.tau`）：跳跃这类**爆发型**动作默认 τ=0.05s 会把
//   "蹬地那一下"抹圆（看着像弹簧/气球），给预置写 τ=0.02~0.03 才保得住爆发力。0 = 用面板值。
let embodiedTauOverride = 0;
function applyEmbodiedRoot() {
  if (!vrm || !vrm.humanoid) return;
  const hips = vrm.humanoid.getNormalizedBoneNode('hips');
  const base = embodiedRestP['hips'];
  if (!hips || !base) return;
  const want = embodiedYielding ? embodiedRootY : 0;
  if (Math.abs(want - embodiedRootApplied) < 1e-6) return;
  // 只动 y：模型根一般不旋转；以后要支持前后/左右位移，按父级世界旋转换算即可。
  hips.position.set(base.x, base.y + want, base.z);
  hips.updateWorldMatrix(true);
  embodiedRootApplied = want;
}

// 整体转身（单位：度 → 内部弧度）：把**整个模型**绕竖直轴慢慢转过去（背对观众 = 180°）。
// 与 hipsYaw 的语义区别必须记住：hipsYaw =「骨盆相对腿」（腿钉在原地，只能小角度）；
// 要转 90° 以上必须转整体，否则就是把胯相对腿拧死 = 反关节。
let embodiedTurn = 0, embodiedTurnCur = 0;
function applyEmbodiedTurn(dt) {
  const want = embodiedYielding ? (embodiedTurn * Math.PI / 180) : 0;    // 让位后自己转回正向
  if (Math.abs(want - embodiedTurnCur) < 1e-5) return embodiedTurnCur;
  const k = (dt > 0) ? (1 - Math.exp(-dt * 3.5)) : 1;                    // 转得慢一点才有分量
  embodiedTurnCur += (want - embodiedTurnCur) * k;
  return embodiedTurnCur;
}

// 转身之后**必须衰减头/脊椎跟随**：身体转过去、头却还想盯着镜头 ⇒ 脖子拧 180°（鬼片）。
function bodyTurnFade() {
  const deg = Math.abs(embodiedTurnCur) * 180 / Math.PI;
  return Math.max(0, 1 - deg / 75);
}

function embodiedInterp(a, b, f) {
  const ja = (a && a.joints) || {}, jb = (b && b.joints) || {};
  const names = new Set(Object.keys(ja).concat(Object.keys(jb)));
  const out = {}; const qa = new THREE.Quaternion(), qb = new THREE.Quaternion();
  for (const n of names) {
    const A = ja[n] || [0, 0, 0, 1], B = jb[n] || [0, 0, 0, 1];   // 缺帧按“中性”处理，避免冻结
    qa.set(A[0], A[1], A[2], A[3]); qb.set(B[0], B[1], B[2], B[3]);
    qa.slerp(qb, f);
    out[n] = [qa.x, qa.y, qa.z, qa.w];
  }
  return out;
}
function embodiedPull(dt) {
  if (!embodiedQueue.length) return null;
  embodiedPlayT += dt * embodiedFps;                 // 播放头按“源帧率”推进
  while (embodiedPlayT >= 1 && embodiedQueue.length > 1) { embodiedQueue.shift(); embodiedPlayT -= 1; }
  // ★ v11.12 连招保持：标了 `chain` 的段播完**不立刻交还** —— 把末帧姿势保持最多 1.2 秒，
  //   期间若有下一段入队就直接接上（`embodiedIngest` 会记下这个末帧，供下一段开头 0.15s 混合过去）。
  //   超过 1.2 秒没人接，就正常交还（避免姿势一直卡着）。
  if (embodiedPlayT >= 1 && embodiedClipChain && embodiedChainHoldT < 1.2) {
    embodiedChainHoldT += dt;
    embodiedPlayT = 1;
    const lf = embodiedQueue[embodiedQueue.length - 1] || embodiedQueue[0];
    return { joints: (lf && lf.joints) || {}, rootY: (lf && typeof lf.rootY === 'number') ? lf.rootY : null };
  }
  if (embodiedPlayT >= 1) {
    embodiedQueue = []; embodiedPlayT = 0; embodiedRootY = 0;
    embodiedClipChain = false; embodiedChainHoldT = 0; embodiedChainFrom = null;
    embodiedTauOverride = 0;                            // 平滑覆盖随动作一起复位
    embodiedLiveDump('左上臂'); postLog('info', '具身动作播放完毕'); return null;   // 播完 → 交回控制权（★ v11.10：帧级根位移也要归零）
  }
  embodiedChainHoldT = 0;                              // 还在播 ⇒ 保持计时清零（只从"播完"开始算）
  const a = embodiedQueue[0], b = embodiedQueue[1] || embodiedQueue[0];
  // 关键：在相邻源帧之间按小数相位做 slerp → 20fps 的源在任意渲染帧率下都顺滑（不再一格一格）
  // ★ v11.10：帧级根位移（跳跃的"上升→滞空→落地"曲线就靠它；没有则返回 null = 用剪辑级常量）。
  let ry = null;
  if (a && typeof a.rootY === 'number') {
    const rb = (b && typeof b.rootY === 'number') ? b.rootY : a.rootY;
    ry = a.rootY + (rb - a.rootY) * embodiedPlayT;
  }
  let jt = embodiedInterp(a, b, embodiedPlayT);
  // ★ v11.12 接续混合：上一段是 chain 且刚保持过 ⇒ 本段开头 0.15s 从"上一段末帧"滑到本段当前帧
  //   （0.15s 是"人眼算即时"的上限：既连得上、又不会让动作变钝）。
  if (embodiedChainFrom) {
    embodiedChainFromT += dt;
    const w = 1 - embodiedChainFromT / 0.15;
    if (w > 0) jt = embodiedInterp(embodiedChainFrom, { joints: jt }, 1 - w);
    else embodiedChainFrom = null;
  }
  return { joints: jt, rootY: ry };
}
let _embTargetQ = null, _embP = null, _embInvP = null, _embD = null;
const _embQ = () => (_embTargetQ || (_embTargetQ = new THREE.Quaternion()));
const _embPQ = () => (_embP || (_embP = new THREE.Quaternion()));
const _embInvPQ = () => (_embInvP || (_embInvP = new THREE.Quaternion()));
const _embDQ = () => (_embD || (_embD = new THREE.Quaternion()));
let embodiedWroteFrame = false;      // 本帧具身层是否真的写了骨骼（供 ardy 层让位；每帧开头清零）
// ★ 手指"落地"诊断（**只读**，不改任何行为、不施加任何力量）：
//   为的是终结"拖手指没反应"这种回合制瞎猜 —— 直接报出**本帧真正写给骨骼的角度**（度，按指合计三节）。
//   判据无需再靠眼睛：若这行显示"食指 90°"而画面没动 ⇒ 问题在别处（权重/骨名）；若显示"食指 4°" ⇒
//   只是滑条值太小（250 = 满卷；日志里 10~60 就相当于 4%~24% ⇒ 每节 1°~7°，肉眼就是"没动"）。
let _fLand = {}, _fLandT = 0, _fLandSig = '';
let _fSendPrev = null;      // 手指"送达"诊断的上一次采样（normalized/raw 世界四元数 + 指令角度）
let _restLackWarned = false; // 静止基准缺失只提醒一次（否则会被刷屏）
// ★★ v11.18「末端延迟跟随（follow-through）」——治"各干各的、整块同步"的僵硬感（用户 2026-10-16：
//   "缺的就是全身协调的活人感，太僵硬了没联动各干各的"）。
//   真人做动作时**远端比近端晚到**：肩先动 → 肘 → 腕 → 手；跨步时大腿先动、脚晚一点。到位后还有过冲回摆。
//   我们原来**所有骨共用一个平滑 τ** ⇒ 全身同一时刻到位 = 木偶/整块移动。
//   这里按骨给"延迟倍率"：手/脚趾 2.0 ｜ 小臂/小腿 1.55 ｜ 上臂/大腿/肩 1.2 ｜ 头颈 1.15 ｜ 躯干 1.0。
//   效果：挥手时手比肩晚约 2~3 帧、落地时脚比大腿晚一点 —— 这是"活人感"性价比最高的一招。
//   两条写入路径共用它（手写/预置走 embodiedApplyJoints，ARDY 生成走 ardyAimApply）。
//   开关：控制台 `window.__petLink = 0` 可临时关掉（做 A/B 对比）。
function harmonicDelayScale(key) {
  try { if (typeof window !== 'undefined' && window.__petLink === 0) return 1; } catch (e) { }
  const s = String(key || '');
  // ★ 自测抓到的坑：VRM 的标准骨名里 `head` / `neck` 是**全小写**（其余是驼峰 leftUpperArm 这种），
  //   原来写 `/Head|Neck/` 大小写敏感 ⇒ 这两根骨永远拿不到延迟（其它骨都正常）。加 `/i` 一并兜住。
  if (/Hand|Toes/i.test(s)) return 2.0;
  if (/LowerArm|LowerLeg/i.test(s)) return 1.55;
  if (/UpperArm|UpperLeg|Shoulder/i.test(s)) return 1.2;
  if (/head|neck/i.test(s)) return 1.15;
  return 1.0;
}
// ★★ v11.19「惯性摆动」参数表（w0 = 固有频率 rad/s，zeta = 阻尼比；**ζ<1 才会过冲/回摆**）
//   用户原话："没有正常人的随大臂身体惯性的摆动"——一阶低通（τ）只能让动作**变慢**，峰值单调趋近，
//   所以永远像机械臂。真人的手臂是**被身体带着甩**的：上升冲过目标一点、停下再荡回去一点。
//   模拟对照（手臂 0.18s 抬起 → 放下）：一阶 τ=0.09 ⇒ 峰值 93%、最低 0%、无回摆；
//   二阶 w0=12 ζ=0.6 ⇒ 峰值 103%、最低 -6%、两次过零 = 真的"甩"起来了。
//   躯干**不启用**（要跟手、不晃）；手指不启用（会让握拳变糊）。
function inertiaParams(key) {
  try { if (typeof window !== 'undefined' && window.__petLink === 0) return null; } catch (e) { }
  const s = String(key || '');
  //   ⚠ **腿刻意不启用二阶**：用户此前明确嫌过"腿/脚像弹簧弹回"（那份痛刚治好），而这次要的是
  //   "随大臂的惯性摆动" ⇒ 惯性只给上肢（手/小臂/上臂/肩）+ 头颈；腿只保留一阶延迟（harmonicDelayScale）。
  //   要试腿的话：把下面两行注释放开即可（LowerLeg 13/0.6、UpperLeg 15/0.75）。
  // ★★ v11.23：这一层的角色变了 —— "甩"改由 **compose 的「运动学惯性偏移」**负责（按加速度反向偏移，
  //   实测能过冲 **且不缩幅度**；而二阶弹簧在 20fps 的插值轨迹上只会变慢、把峰值从 100° 压到 92°）。
  //   所以这里退化为**轻微去抖**：ω0 提高、阻尼接近临界 ⇒ 几乎静态跟随，不再吃上面的过冲。
  //   "回中性不晃"仍由收敛门 + 回站阻尼负责（见 embodiedApplyJoints）。
  if (/Hand/i.test(s)) return [20, 0.90];        // 手腕（手指会被 _isFinger2 提前排除）
  if (/LowerArm/i.test(s)) return [21, 0.90];
  if (/(UpperArm|Shoulder)/i.test(s)) return [22, 0.92];
  if (/(head|neck)/i.test(s)) return [22, 0.95];
  return null;
}
const embodiedVelQ = new Map();           // 每骨角速度（父空间局部，与 embodiedSmoothQ 同空间）
let _embQErr = null, _embQInv = null, _embQStep = null, _embAxis = null;
// ★★ v11.24「接触自检」—— 敬礼/扶帽/摸脸这类"手要贴住某处"的动作，**手到底贴没贴到**必须用数字看。
//   为什么加：离线（compose 层）只输出关节角，**算不出手在世界里的位置**，所以我上一次"盲写"的角度
//   配比只能靠肉眼评价（用户："像投降/挠头"）。这里在真机上量一次"手腕 → 头中心"的距离与方向写进日志，
//   于是下一轮调参就是**按数字逼近**（目标：0.05~0.10m、略偏上偏前），不用再猜。
//   触发条件：某侧肘弯过 100°（说明是"手往头上放"的动作）；节流 900ms 且只有数值变化时才打。
let _contactLogT = 0, _contactSig = '';
let _cpBeat = 0, _cpBeat2 = 0;
let _embErrT = 0;
let _verStamped = false;
let _rtBeat = 0;   // ★ v11.34 渲染循环心跳（每 5 秒一条 —— 比"只在首次打一次"可靠得多）
let _saluteBeat = 0;   // ★ v11.36 敬礼实测心跳（每 3s，渲染循环最前段 ⇒ 不受任何具身层异常影响）
let _holdYieldT = 0;   // ★ v11.36c「保持预览让位给舞蹈」的上报节流（10s 一条）
let _handoffT = 0;     // ★ v11.38「交还骨骼时实测膝角」的上报节流（0.8s 一条）
let _ardyBlockT = 0;   // ★ v11.44「生成动作被具身层压住」的上报节流（3s 一条）   // ★ v11.33 版本戳（渲染循环首次执行时打一次）   // ★ v11.33 具身应用异常的上报节流（"播放不完整"的头号嫌疑就是它）   // ★ v11.31 接触自检的"心跳"与"异常上报"节流（证明它有没有被调用/有没有抛异常）
function contactProbe(dt) {
  try {
    if (!vrm || !vrm.humanoid || !THREE) return;
    if (typeof performance === 'undefined') return;
    const now = performance.now();
    // ★★ v11.31 心跳探针（用户：敬礼改了参数、日志里"接触自检"一条都没有）——
    //   代码逐行核对是通的，那就只剩两种可能：**它没被调用**，或**内部提前 continue/异常被吞**。
    //   这行每 3 秒无条件打一次"两侧肘角原始值 + 三根骨是否拿得到"，把这两种可能一次区分开。
    if (now - _cpBeat > 3000) {
      _cpBeat = now;
      let _dbg = '';
      for (const s2 of ['right', 'left']) {
        const k2 = vrm.humanoid.getNormalizedBoneNode(s2 + 'LowerArm');
        const h2 = vrm.humanoid.getNormalizedBoneNode(s2 + 'Hand');
        const hd2 = vrm.humanoid.getNormalizedBoneNode('head');
        const a2 = k2 ? (2 * Math.acos(Math.min(1, Math.abs(k2.quaternion.w))) * 180 / Math.PI).toFixed(0) : '—';
        _dbg += (s2 === 'right' ? '右' : '左') + '肘' + a2 + (k2 ? '' : '(小臂骨缺)') + (h2 ? '' : '(手骨缺)') + (hd2 ? '' : '(头骨缺)') + ' ';
      }
      postLog('info', '接触自检·心跳：' + _dbg + '｜阈值 55°（超过就会报"手距头/掌面法线"）');
    }
    if (now - _contactLogT < 900) return;
    for (const side of ['right', 'left']) {
      const kn = vrm.humanoid.getNormalizedBoneNode(side + 'LowerArm');
      const hd = vrm.humanoid.getNormalizedBoneNode('head');
      const hn = vrm.humanoid.getNormalizedBoneNode(side + 'Hand');
      if (!kn || !hd || !hn) continue;
      const ang = 2 * Math.acos(Math.min(1, Math.abs(kn.quaternion.w))) * 180 / Math.PI;
      // ★ v11.30：阈值 100° → **55°** —— 敬礼实测没报（说明实机肘角 <100°，我这行把观测卡死了）。
      //   放宽到 55°（"手臂弯起来"就算），并**无论是否接触都报一次肘角** ⇒ 下次日志能看到真实角度。
      if (ang < 55) continue;
      const p1 = hn.getWorldPosition(new THREE.Vector3());
      const p2 = hd.getWorldPosition(new THREE.Vector3());
      const d = p1.distanceTo(p2);
      const dy = p1.y - p2.y, dz = p1.z - p2.z, dx = Math.abs(p1.x - p2.x);
      // ★ v11.28：把**掌心法线方位**也算出来（用户："手掌方向不对/掌心向前不是向下"）——
      //   用"腕 / 食指根 / 小指根"三点叉积得掌面法线，再与世界 up/fwd 求夹角；**不依赖骨骼轴约定**。
      let palmTxt = '';
      try {
        const bIdx = vrm.humanoid.getNormalizedBoneNode(side + 'IndexProximal') || vrm.humanoid.getNormalizedBoneNode(side + 'Index1Proximal');
        const bLit = vrm.humanoid.getNormalizedBoneNode(side + 'LittleProximal') || vrm.humanoid.getNormalizedBoneNode(side + 'Little1Proximal');
        if (bIdx && bLit) {
          const pW2 = hn.getWorldPosition(new THREE.Vector3());
          const pI2 = bIdx.getWorldPosition(new THREE.Vector3());
          const pL2 = bLit.getWorldPosition(new THREE.Vector3());
          const nrm = new THREE.Vector3().crossVectors(pI2.clone().sub(pW2), pL2.clone().sub(pW2)).normalize();
          const ua2 = (window.EmbodiedRig && window.EmbodiedRig.up) || [0, 1, 0];
          const fa2 = (window.EmbodiedRig && window.EmbodiedRig.fwd) || [0, 0, 1];
          const upV = new THREE.Vector3(ua2[0], ua2[1], ua2[2]).normalize();
          const fwV = new THREE.Vector3(fa2[0], fa2[1], fa2[2]).normalize();
          const dUp = nrm.dot(upV), dFw = nrm.dot(fwV);
          palmTxt = '｜掌面法线 离竖直 ' + (Math.acos(Math.min(1, Math.abs(dUp))) * 180 / Math.PI).toFixed(0) + '°（'
            + (dUp > 0.5 ? '朝上' : dUp < -0.5 ? '朝下' : '近水平') + '）·离前向 '
            + (Math.acos(Math.min(1, Math.abs(dFw))) * 180 / Math.PI).toFixed(0) + '°（'
            + (dFw > 0.5 ? '偏前' : dFw < -0.5 ? '偏后' : '近侧向') + '）';
        }
      } catch (e) { }
      const sig = side + '|' + ang.toFixed(0) + '|' + d.toFixed(2) + '|' + palmTxt;
      if (sig === _contactSig) return;
      _contactSig = sig;
      _contactLogT = now;
      postLog('info', '接触自检：' + (side === 'right' ? '右' : '左') + '手 距头中心 ' + d.toFixed(3) + 'm'
        + '｜' + (dy > 0.03 ? '偏上' : dy < -0.03 ? '偏下' : '同高')
        + '·' + (dz > 0.03 ? '偏前' : dz < -0.03 ? '偏后' : '同前后')
        + '·' + (dx > 0.10 ? '偏外' : '贴近中线')
        + palmTxt
        + '｜肘 ' + ang.toFixed(0) + '°　（想"手贴额侧"：距离调到 0.05~0.10m、略偏上偏前；'
        + (d > 0.18 ? '现在太远：加 ArmUp / 加 Elbow' : d < 0.03 ? '现在太近（可能穿进头）：减 Elbow / 加 ArmFwd' : '粗细已接近，微调 ElbowSide/HandTurn 即可')
        + '）');
      return;
    }
  } catch (e) {
    // ★ v11.31：以前这里把异常**静默吞掉** —— 于是"没有日志"既可能是"没触发"、也可能是"抛了但没人知道"。
    //   现在打出来（3 秒节流，不会刷屏），下次日志就能直接告诉我是哪一种。
    try {
      if (performance.now() - _cpBeat2 > 3000) { _cpBeat2 = performance.now(); postLog('info', '接触自检异常：' + (e && e.message ? e.message : e)); }
    } catch (e2) { }
  }
}
// ★★ v11.29「骨骼层冲突审计」—— 治"动作播到后半段就没了"这类**看不清来源**的问题。
//   背景：具身动作播放时，若**别的层**（待机/跳舞/拖拽/生成层/造型草稿…）同时也在写骨骼，
//   两边会逐帧互相覆盖 —— 视觉上就是"动作播到一半被接管/后半段没有/姿势突然变了"。
//   离线能测的（曲线、播放速度、播放头推进）都已经排除（数据见日志），剩下的嫌疑只能在**真机**抓。
//   这里每 1.2s 检查一次：**本帧到底有几个层写了骨骼**；>1 就写日志点名，谁在抢一目了然。
let _layerClashT = -1e9, _layerClashSig = '';
function layerClashAudit() {
  try {
    if (typeof performance === 'undefined') return;
    const now = performance.now();
    if (now - _layerClashT < 1200) return;
    const layers = [];
    if (typeof embodiedWroteFrame !== 'undefined' && embodiedWroteFrame) layers.push('具身动作');
    if (typeof ardyActive !== 'undefined' && ardyActive) layers.push('生成层(ardy)');
    if (typeof dancingNow !== 'undefined' && dancingNow) layers.push('跳舞');
    if (typeof dragAction !== 'undefined' && dragAction) layers.push('拖拽');
    if (layers.length < 2) return;                       // 只有一层在写 ⇒ 正常，不打日志
    const sig = layers.join('+');
    if (sig === _layerClashSig) return;
    _layerClashSig = sig;
    _layerClashT = now;
    postLog('info', '★ 骨骼层冲突：' + sig + ' 本帧**同时**写骨骼 —— 它们会逐帧互相覆盖，'
      + '表现就是"动作播到一半被顶掉/后半段没有"。请把这行发我（要修的是让位规则）。');
  } catch (e) { }
}
// ★★ v11.29「放下实况」—— 动作播完自动把"上臂每帧的目标 vs 实际角度"打进日志。
//   为什么必须加：用户两次报"放下到一半，后面没有过程就到位了"，而**离线能测的全部正常**
//   （曲线均匀、播放头速度正确、结束判定正确）⇒ 问题只发生在**真机逐帧执行**里，只能把过程记下来看。
//   读法：若「实际」序列在某处突然贴近「目标」而目标还在大步走 ⇒ 就是被瞬贴了（收敛门/层冲突/漂移）；
//        若「实际」均匀落后目标一点、最后平滑收敛 ⇒ 那这一段其实是对的（问题在别处）。
let _liveBuf = [];
function embodiedLiveReset() { _liveBuf = []; }
function embodiedLiveDump(tag) {
  try {
    if (_liveBuf.length < 6) return;
    const tail = _liveBuf.slice(-16);
    postLog('info', '放下实况（' + (tag || '上臂') + '）：目标 '
      + tail.map(p => p[0].toFixed(0).padStart(3)).join(' ')
      + ' ｜ 实际 ' + tail.map(p => p[1].toFixed(0).padStart(3)).join(' '));
  } catch (e) { }
}
function embodiedLivePush(joints) {
  // 记一对：本帧「目标」（compose 给的上臂增量）与「实际」（骨骼当前旋转量）。
  // 两者语义略不同（增量 vs 局部），但**角度量级可比** —— 用来判断"趋势是否一致、有没有被瞬贴"足够。
  try {
    if (!joints || !joints.leftUpperArm || !vrm || !vrm.humanoid) return;
    const b = vrm.humanoid.getNormalizedBoneNode('leftUpperArm');
    if (!b) return;
    const qT = joints.leftUpperArm;
    const angT = 2 * Math.acos(Math.min(1, Math.abs(qT[3]))) * 180 / Math.PI;
    const angA = 2 * Math.acos(Math.min(1, Math.abs(b.quaternion.w))) * 180 / Math.PI;
    _liveBuf.push([angT, angA]);
    if (_liveBuf.length > 80) _liveBuf.shift();
  } catch (e) { }
}
function embodiedApplyJoints(joints, dt) {
  if (!vrm || !vrm.humanoid) return;
  embodiedWroteFrame = true;
  _fLand = {};                                   // 每帧重算（别把上一帧的值当成这一帧的）
  // 输出平滑：把“本层上一帧写入的值”按时间常数 slerp 到目标，抑制抖动。
  // 关键：必须基于**本层自己的状态**（骨骼每帧会被“基础姿态”循环重置，对骨骼当前值平滑会退化成
  // lerp(基础姿态, 目标, k) → 抬不起手 + 抽搐）。
  // tau 越小越跟手、越大越平滑；面板「具身平滑」可调，控制台 window.__embodiedSmooth 可临时覆盖。
  const wS = (typeof window.__embodiedSmooth === 'number') ? window.__embodiedSmooth : NaN;
  const s0 = Number(lastOpts.embodiedSmooth);
  // ★ v11.13：本段动作自带的 tau（`spec.tau`）优先 —— 爆发型动作（跳）用它保住"蹬地"的锐度。
  const tau = embodiedTauOverride > 0 ? embodiedTauOverride : (isFinite(wS) ? wS : (isFinite(s0) ? s0 : 0.05));
  // ★ v11.18：k 不再"全身共用一个"，改为**循环内按骨算**（见 kk）——远端更慢 = follow-through。
  const k = (dt > 0 && tau > 0) ? (1 - Math.exp(-dt / tau)) : 1;
  const tq = _embQ(), dq = _embDQ(), pq = _embPQ(), invP = _embInvPQ();
  const fingerAxes = (window.EmbodiedRig && window.EmbodiedRig.fingerAxes) || null;
  for (const name in joints) {
    const key = embodiedKey(name);
    const b = vrm.humanoid.getNormalizedBoneNode(key);
    if (!b) continue;
    const q = joints[name];
    if (!(Array.isArray(q) && q.length === 4)) continue;
    if (/(Thumb|Index|Middle|Ring|Little)\d*(Proximal|Intermediate|Distal)$/.test(key)) _embFingerDriven = true;
    // ★ 兜底：没有静止基准就**当场补记一次**（只补一次、此后固定）。绝不能让 `base` 落到 `b.quaternion`
    //   —— 那等于"以当前值为基准"，增量会被逐帧累加（手指清零回不去 / 调高在原有弯曲上继续弯）。
    if (embodiedRestQ[key] === undefined && b.quaternion) {
      embodiedRestQ[key] = b.quaternion.clone();
      if (!_restLackWarned) {
        _restLackWarned = true;
        postLog('warn', '静止基准缺失：已为 ' + key + ' 当场补记（首次遇到会有一次偏差，之后不再累加）');
      }
    }
    const base = embodiedRestQ[key] || b.quaternion;      // 中性基准（基础姿态，父空间局部四元数）
    // 增量按【世界空间】解释：把绕世界轴的旋转换算成“父空间的局部增量”再叠加到基准上：
    //   localΔ = inv(P) · Δworld · P ；target = localΔ · base
    // 这样动作与基准姿势无关（不会因为基准从 T-pose 变自然下垂就变成“往里缩/穿模”）。
    dq.set(q[0], q[1], q[2], q[3]).normalize();
    if (fingerAxes && fingerAxes[key]) {
      // ★★ 手指特例：compose 给的轴**已经换算到父骨局部空间**（见 embodiedMeasureRig 的 fingerAxes），
      //   所以这里**不做世界共轭**、直接叠加到基准上。这样上臂自旋（手在世界里转了）时，
      //   手指仍绕"手/上一节手指"蜷曲，不会被掰直/扭曲（用户实测症状）。
      tq.copy(dq).multiply(base);
      if (/(Thumb|Index|Middle|Ring|Little)\d*(Proximal|Intermediate|Distal)$/.test(key))
        _fLand[key] = 2 * Math.acos(Math.min(1, Math.abs(dq.w))) * 180 / Math.PI;   // 只记（诊断用）
    } else {
      const parent = b.parent;
      if (parent && parent.getWorldQuaternion) {
        // 关键：先把父级世界矩阵刷新到最新（父骨可能本帧刚被我们驱动），否则轴向差一帧 → 子骨抖动/甩
        parent.updateWorldMatrix(true, false);
        parent.getWorldQuaternion(pq); invP.copy(pq).invert();
      } else { pq.identity(); invP.identity(); }
      tq.copy(invP).multiply(dq).multiply(pq).multiply(base);
    }
    if (key === 'hips') {                                  // 记下骨盆旋转：applyEmbodiedLegPin 要用它抵消髋窝位移
      embodiedPelvicQ = embodiedPelvicQ || new THREE.Quaternion();
      embodiedPelvicQ.copy(dq);
    }
    // ★ v11.18 末端延迟：每根骨用自己的 k（远端 τ 更大 ⇒ 晚到、有拖尾）。手指不参与 ——
    //   它们的轴在父骨局部空间（fingerAxes），加延迟会让"握拳/张开"变糊。
    //   ★ 自测发现的坑：手指骨名里**本身就含 "Hand"**（`leftHandThumb1Proximal` …）⇒ 只靠 fingerAxes
    //     判断的话，一旦模型没量出 fingerAxes（某些 rig），手指会被当成"手"吃 2.0× 延迟 ⇒ 握拳/张开变糊。
    //     所以再加一道**骨名兜底**：匹配 指节 三段式命名的一律不延迟。
    const _isFinger2 = !!(fingerAxes && fingerAxes[key])
      || /(Thumb|Index|Middle|Ring|Little)\d*(Proximal|Intermediate|Distal)$/.test(key);
    //   ★★ 自测修正：不要给**所有骨**加延迟底 —— 用户面板「具身平滑」设 0 就是要"完全跟手"，
    //     全局加底会把躯干也拖慢（模拟：躯干峰值 90%）。改成：
    //       · 躯干（倍率 1.0）**完全跟面板**（0 = 直通，保持跟手）；
    //       · 只有**远端**（倍率 >1）才吃一个延迟底 0.025×倍率 —— 延迟是"运动形态"，该由引擎保证。
    const _sc = harmonicDelayScale(key);
    const _tauB = (_sc > 1) ? ((tau > 0 ? tau : 0.025) * _sc) : tau;
    const kk = _isFinger2 ? k
      : ((dt > 0 && _tauB > 0) ? (1 - Math.exp(-dt / _tauB)) : 1);
    // ★★ v11.19 惯性摆动（二阶弹簧-阻尼）—— 见 inertiaParams 的注释与模拟对照。
    //   有参数（四肢/头颈）⇒ 走弹簧积分；没有（躯干/手指）⇒ 走原来的一阶（跟面板）。
    const _ip = _isFinger2 ? null : inertiaParams(key);
    let cur = embodiedSmoothQ[key];
    if (!cur) {                                              // 首次：以中性为起点（速度归零）
      cur = embodiedSmoothQ[key] = base.clone();
      if (_ip) { const v0 = embodiedVelQ.get(key); if (v0) v0.set(0, 0, 0); }
    } else if (_ip && dt > 0) {
      const w0 = _ip[0], zeta = _ip[1];
      const dtE = Math.min(dt, 1 / 45);                      // ★ 显式积分必须钳 dt：卡顿帧 ω·dt>2 会发散
      let vel = embodiedVelQ.get(key); if (!vel) { vel = new THREE.Vector3(); embodiedVelQ.set(key, vel); }
      if (!_embQErr) { _embQErr = new THREE.Quaternion(); _embQInv = new THREE.Quaternion(); _embQStep = new THREE.Quaternion(); _embAxis = new THREE.Vector3(); }
      // 误差 = 从 cur 转到目标（同一"父空间局部"空间），取最短弧 ⇒ 轴角向量（弧度）
      _embQErr.copy(tq).multiply(_embQInv.copy(cur).invert());
      if (_embQErr.w < 0) _embQErr.set(-_embQErr.x, -_embQErr.y, -_embQErr.z, -_embQErr.w);
      const qw = Math.min(1, Math.max(-1, _embQErr.w));
      const s2 = Math.sqrt(Math.max(0, 1 - qw * qw)), angE = 2 * Math.acos(qw);
      const ex = s2 > 1e-6 ? (_embQErr.x / s2) * angE : 0;
      const ey = s2 > 1e-6 ? (_embQErr.y / s2) * angE : 0;
      const ez = s2 > 1e-6 ? (_embQErr.z / s2) * angE : 0;
      // a = ω²·err − 2ζω·v （弹簧把骨拉向目标，阻尼让摆动衰减）
      //   ★ v11.20：**回站时临时把阻尼拉到 0.9**（近临界阻尼）—— 动作过程中保留 0.58 的弹性（会甩），
      //     但"回到站姿"那一段像有液压一样收住，不再来回摆（实测：不这样做收尾会摆到 -7.8%）。
      // ★★ v11.21 修（用户："卡死了都播放不完整"）：`_neutralTarget` 必须在**使用之前**声明 ——
      //   上一版把它放在下面（收敛门那里），而这里先用了 ⇒ 每帧 `ReferenceError: Cannot access
      //   '_neutralTarget' before initialization`（TDZ）⇒ 渲染循环的兜底 catch 让循环"继续"，
      //   但整段弹簧积分被跳过 ⇒ 动作播不完整、看着像卡死。**声明顺序就是功能本身**（又一次踩这个坑）。
      const _neutralTarget = Math.abs(dq.w) > 0.9992;   // 目标增量 < ≈2.3° ⇒ 这一帧就是"回站"
      const _zEff = _neutralTarget ? 0.75 : zeta;       // ★ v11.25：0.9 → 0.75（别太"液压"，否则收尾像被拽）
      const _wEff = _neutralTarget ? Math.min(w0, 12) : w0;
      vel.x += (_wEff * _wEff * ex - 2 * _zEff * _wEff * vel.x) * dtE;
      vel.y += (_wEff * _wEff * ey - 2 * _zEff * _wEff * vel.y) * dtE;
      vel.z += (_wEff * _wEff * ez - 2 * _zEff * _wEff * vel.z) * dtE;
      // ★★ v11.20 收敛门（治"放回时的卡顿/顿一下"，用户 2026-10-16）：
      //   二阶弹簧在目标回到 0（动作结束回中性）时会一直小幅度过冲/回摆 —— 视觉上就是
      //   "放回去时先停一下、再晃两下"。误差已经很小（≈2° 内）且速度也小 ⇒ 直接贴上去、速度清零。
      //   ⚠ 关键：判据必须**同时要求"这一帧的目标就是回中性"**（`dq` = 增量四元数 ≈ 单位，即 dq.w≈1）——
      //     只按"误差小"来收敛会**把甩出去的过冲一起吃掉**（实测：无门峰值 106% ⇒ 只按误差判 98%，惯性没了）。
      // ★★ v11.25 收紧（用户："放下了一大半，过程就没了，直接跳过后半部分瞬间闪烁抽帧放下了"）——
      //   上一版阈值太松（误差 0.05 rad ≈ 2.9°、速度 0.8 就"直接贴到位"）：放下动作还没走完就被
      //   瞬间贴到目标 ⇒ 视觉上"后半段被跳过、闪一下"。现在只在**几乎完全到位**时收敛：
      //   误差 < 0.015 rad ≈ 0.9°、速度 < 0.2。此时贴上去的位移 <1°，肉眼不可见 ⇒ 既干净收尾、又不抽。
      if (_neutralTarget && angE < 0.015 && vel.length() < 0.2) {
        cur.copy(tq);
        vel.set(0, 0, 0);
        b.quaternion.copy(cur);
        continue;
      }
      let vl = vel.length();
      const VMAX = 22;                                       // 限速：防抖散（rad/s）
      if (vl > VMAX) { vel.multiplyScalar(VMAX / vl); vl = VMAX; }
      if (vl > 1e-6) {
        _embQStep.setFromAxisAngle(_embAxis.copy(vel).normalize(), vl * dtE);
        cur.premultiply(_embQStep);                          // 左乘 = 在该局部空间里转
      }
    } else if (kk < 1) cur.slerp(tq, kk);
    else cur.copy(tq);
    // ★★ v11.32 治"头/脊椎追踪被搞废"：保持类剪辑（40 秒+每2秒续持）长期接管骨骼 ⇒ 绝对覆盖掉追踪层的
    //   颈/胸/脊偏移。修法：保持类剪辑**不写**追踪领地的躯干骨（颈/胸/上胸/脊/胯），其余照写。
    const _holdNoTorso = (typeof embodiedQueueIsHold !== 'undefined' && embodiedQueueIsHold) && /^(neck|chest|upperChest|spine|hips)$/.test(key);
    if (!_holdNoTorso) b.quaternion.copy(cur);
  }
  // ★ 手指落地诊断（只读）：1s 限流 + 只在角度变化时打 ⇒ 不刷屏；有这行就不必再靠肉眼判断"动没动"。
  try {
    if (_embFingerDriven) {
      const nowF = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
      const keys = Object.keys(_fLand);
      if (keys.length && nowF - _fLandT > 1000) {
        let sig = '', sI = 0, sM = 0, sR = 0, sL = 0, sT = 0;
        for (const kk of keys) {
          const a = _fLand[kk]; sig += kk + ':' + a.toFixed(0) + ',';
          if (kk.indexOf('Index') >= 0) sI += a;
          else if (kk.indexOf('Middle') >= 0) sM += a;
          else if (kk.indexOf('Ring') >= 0) sR += a;
          else if (kk.indexOf('Little') >= 0) sL += a;
          else sT += a;
        }
        if (sig !== _fLandSig) {
          _fLandSig = sig; _fLandT = nowF;
          postLog('info', '手指落地（本帧真写给骨骼的角度／三节合计）：食指 ' + sI.toFixed(0) + '°｜中指 ' + sM.toFixed(0)
            + '°｜无名 ' + sR.toFixed(0) + '°｜小指 ' + sL.toFixed(0) + '°｜拇指 ' + sT.toFixed(0)
            + '°（滑条 250 = 满卷；若这几个数不为 0 而画面没动，问题在权重/骨名，不在这里）');
        }
      }
    }
  } catch (e) { }
}

// ---- 自检演示源（默认关；仅当 window.__embodiedDemo===true 时才跑，绝不由 UI 开关隐式触发）----
function embodiedDemoFrame(t) {
  const out = {};
  const s = Math.sin(t * 1.6), s2 = Math.sin(t * 0.8), s3 = Math.sin(t * 3.1);
  const q = (x, y, z) => new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z));
  out.l_uarm = q(0, 0, 1.1 * s);        // 左臂上下摆
  out.r_uarm = q(0, 0, -1.1 * s);       // 右臂上下摆
  out.l_larm = q(0, 0.5 * s2, 0);
  out.r_larm = q(0, -0.5 * s2, 0);
  out.spine2 = q(0, 0.08 * s2, 0);
  out.head = q(0.10 * s3, 0.06 * s2, 0);
  return out;
}

function applyEmbodiedRetarget(dt) {
  if (!embodiedOn()) { embodiedYieldOff(); return; }        // 关（默认）：no-op，不打断任何东西
  if (!vrm || !vrm.humanoid) return;                        // 仅 VRM（PMX 见 skill §7）
  // ★★ v11.36c「让位规则」—— 用户："怎么还能给波及到舞蹈？动作舞蹈完全不对了"。
  //   证据（日志）：`★ 骨骼层冲突：具身动作+跳舞 本帧同时写骨骼` + 同一行 `跳舞=true 具身接管=true
  //   保持剪辑=true 队列=213帧`。凶手是造型面板的**40 秒「保持预览」剪辑**：它每帧把姿势写回
  //   归一化骨骼，和 VRMA 舞蹈逐帧互盖 ⇒ 画面上就是"舞蹈被顶掉/僵住/姿势乱"。
  //   优先级：**真动作（VRMA 舞蹈）> 静态保持预览**。
  //   注意：这里**绝不能**调 embodiedYieldOn（它内部 stopCurrentMotion 会把舞蹈停掉），
  //   也**不能**消费队列（舞蹈结束后保持预览还要接着摆姿势）。只把骨骼让出去即可。
  // ★★ v11.41：条件补上 `ardyActive`（AI 生成动作层）——
  //   原来只判 `currentMotionAction`（VRMA 舞蹈）⇒ AI 生成动作在播时，造型面板那条 40s 保持预览
  //   照样每帧写骨，和生成层逐帧互盖 ⇒ "AI 自己做的舞蹈总被掐断、放不全"（用户原话）。
  //   优先级统一为：**任何真动作（VRMA 舞蹈 / AI 生成动作）> 静态保持预览**。
  if (embodiedQueueIsHold && (currentMotionAction || ardyActive)) {
    if (embodiedYielding && !ardyActive) {
      try { embodiedYielding = false; } catch (e) { }        // 骨骼交还 mixer（舞蹈独占）
      if (typeof performance === 'undefined' || performance.now() - _holdYieldT > 10000) {
        _holdYieldT = (typeof performance === 'undefined') ? 0 : performance.now();
        postLog('info', '· 保持预览已让位给动作（40s 静态剪辑不再逐帧盖骨）；动作结束后自动接回');
      }
    }
    return;
  }
  if (!embodiedReady) return;   // 中性基准未就绪（加载后 ~0.4s 内）→ 先不驱动
  const frame = embodiedPull(dt);                           // ① 真实数据优先
  const useDemo = !frame && window.__embodiedDemo === true; // ② 演示只在显式开启时使用
  if (!frame && !useDemo) { embodiedYieldOff(); return; }   // 没内容可驱动 → 保持惰性（待机/跳舞照旧）
  embodiedYieldOn();
  embodiedT += dt;
  // ★ v11.10：帧级根位移优先（跳跃曲线）；没有就用剪辑级常量（老行为：蹲/跪整体下沉）。
  if (frame && typeof frame.rootY === 'number') embodiedRootY = frame.rootY;
  // ★★ v11.33「把异常钉出来」—— 证据链：日志里「放下实况」（在 embodiedPull 里）有，而
  //   「接触自检·心跳」（每 3 秒无条件、在 contactProbe 里）**一条都没有** ⇒ 说明
  //   pplyEmbodiedRetarget 每次都在**中间**就断了，断点只能是这里 —— embodiedApplyJoints 抛异常。
  //   它抛 ⇒ 本帧的骨只写了一部分 ⇒ 视觉就是"动作播到一半停住/后半段没有"（数据其实是完整的）。
  //   这里包住并打印（3 秒节流），下次日志会直接给出**错误信息 + 出错行**。
  try {
    embodiedApplyJoints(frame ? frame.joints : embodiedDemoFrame(embodiedT), dt);
  } catch (e) {
    try {
      if (performance.now() - _embErrT > 3000) {
        _embErrT = performance.now();
        const _ln = (e && e.stack) ? (String(e.stack).split('\n')[1] || '').trim() : '';
        postLog('info', '★ 具身应用异常：' + (e && e.message ? e.message : e) + ' ｜' + _ln
          + ' —— 该帧后面的骨没被写，"动作播到一半停住"就是它（请把这行发我）');
      }
    } catch (e2) { }
  }
  try { embodiedLivePush(frame ? frame.joints : null); } catch (e3) { }   // ★ v11.29 放下实况采集（播完自动打日志）
}
window.embodiedFeed = (frames) => embodiedIngest({ frames: frames });   // 控制台/生成端注入口

// ---- 内置示例动作（走真实 embodiedIngest 通道，用于验证“真实路径”，区别于 window.__embodiedDemo 演示路径）----
// 触发：设置面板「具身示例」按钮，或控制台 window.embodiedPlaySample()（需「具身动作」开关为开）
function embodiedQuatXYZ(x, y, z) {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z));
  return [q.x, q.y, q.z, q.w];
}
function embodiedSampleClip() {
  // 20fps、4 秒【干净版自检】：双臂从自然姿势抬起 → 放下（刻意不含挥手），另加轻微点头验证非手臂关节。
  // 帧里给的是“绕世界轴的增量四元数”（键用 VRM humanoid 骨骼名）；本层按世界空间重定向叠加到中性姿势上。
  const fps = 20, N = fps * 4, frames = [];
  for (let i = 0; i < N; i++) {
    const t = i / (N - 1);
    const up = Math.sin(Math.PI * t);                    // 0→1→0 平滑抬起/放下
    frames.push({ joints: {
      leftUpperArm: embodiedQuatXYZ(0, 0, 1.00 * up),
      rightUpperArm: embodiedQuatXYZ(0, 0, -1.00 * up),
      head: embodiedQuatXYZ(0.10 * Math.sin(2 * Math.PI * t), 0, 0)
    } });
  }
  return { fps: fps, frames: frames };
}
window.embodiedPlaySample = () => {
  if (!embodiedOn()) { postLog('info', '请先在桌宠设置里打开「具身动作」开关，再播放示例'); return; }
  const clip = embodiedSampleClip();
  embodiedIngest(clip);
  postLog('info', '已注入示例动作（真实通道：' + clip.frames.length + ' 帧 @ ' + clip.fps + 'fps）');
};

// ---- 具身动作：关键帧 spec / 预设 → 合成 → 播放（AI 的 <bodyact> 与面板按钮都走这里）----
let lastEmbodiedFitKey = '0.00|0.00|0', embodiedFitTimer = null;   // 取景跟随（蹲/跪/转身）的去重键与防抖定时器
let fitBottomMarginOverride = null;   // 非 null 时覆盖用户的"底部留白"（蹲/跪期间用）
let fingerDiagSig = '';   // 手型诊断签字：同一手型只打一次，避免刷屏
function embodiedComposeAndPlay(spec, opts) {
  if (!embodiedOn()) { postLog('info', '具身动作未开启，已忽略 BodyAct'); return false; }
  if (typeof spec === 'string') {
    try { spec = JSON.parse(spec); } catch (e) { postLog('error', 'BodyAct spec 不是合法 JSON：' + e.message); return false; }
  }
  if (!spec || typeof spec !== 'object') { postLog('info', 'BodyAct 缺少 spec'); return false; }
  const C = window.EmbodiedCompose;
  if (!C) { postLog('error', '动作合成器未加载（embodied-compose.js）'); return false; }
  // ★★ AI 路径先过「校验器 + 退化阶梯」：不指望 AI 写对，靠"校验不过就自动修正 / 退回预置"。
  //   本地 UI（造型面板）走**可信路径**，不做这道检查 —— 人正看着画面、随时能改，拦它只会碍事。
  if (opts && opts.ai && !spec.preset) {
    const V = window.EmbodiedValidate;
    if (V) {
      const rep = V.check(spec, { channels: (C.channelNames ? C.channelNames() : null), autoFix: true });
      for (const it of (rep.issues || [])) postLog('warn', '动作校验：' + it.msg);
      if (rep.level >= 2) {
        postLog('warn', '动作校验未通过 ⇒ **退回预置动作 ' + rep.fallbackPreset + '**（AI 写的这份不播）');
        spec = { preset: rep.fallbackPreset };
      } else if (rep.level === 1 && rep.fixed) {
        postLog('info', '动作已自动修正 ' + (rep.issues || []).length + ' 处后播放（校验器）');
        spec = rep.fixed;
      }
    } else postLog('warn', '校验器未加载（embodied-validate.js 没进来）—— 本次 AI 动作不做校验');
  }
  // 自愈：腿部尺寸 / 手指局部轴没量到（模型加载时序/量测异常）时，趁这次合成再量一次 —— 蹲跪与手型都依赖它。
  try {
    if (vrm && vrm.humanoid) {
      const rg0 = window.EmbodiedRig;
      const wantFingers0 = !!(spec.fingers && (spec.fingers.l != null || spec.fingers.r != null));
      if (!rg0 || !rg0.legs || (wantFingers0 && !rg0.fingerAxes)) embodiedMeasureRig();
    }
  } catch (e) { }
  let clip = null, effSpec = spec;   // ★ 诊断/日志要用**真正合成用的 spec**：预设模式下 spec 只有 {preset}，
  //   带 steps/fingers 的是 p ⇒ 不换 effSpec 就会打出"手型已应用：{}"（实测踩过，误判成没生效）
  if (spec.preset) {
    const p = C.preset(spec.preset);
    if (!p) { postLog('info', '未知预设：' + spec.preset); return false; }
    // ★ v11.12：预置 + spec 的字段**全部合并**（以前只带 fps ⇒ `{"preset":"jump","chain":true}` 这种写法里
    //   chain 会被丢掉）。现在 spec 里写了什么就覆盖预置的什么（例如改 fps / chain / smooth / rootY），
    //   没写的沿用预置 —— AI 由此可以"基于预置改一点"，也能把预置串成连招。
    effSpec = Object.assign({}, p, spec);
    clip = C.compose(effSpec, window.EmbodiedRig);
  } else {
    clip = C.compose(spec, window.EmbodiedRig);
  }
  if (!clip || !clip.frames.length) { postLog('info', 'BodyAct 合成结果为空（steps 为空？）'); return false; }
  // ★★ 用户点「试做」/ AI 下发动作时**不该排在一段"保持预览"后面**：造型面板的保持剪辑长达 40 秒
  //   （`sendPose(..., true)` 发的是 `dur:40`），而这里走的是**追加**语义 ⇒ 新动作几十秒后才动 ——
  //   实测症状就是"点了没做"（其实合成、入队都成功了，只是排在长剪辑后面）。
  const holdNow = Array.isArray(effSpec.steps) && effSpec.steps.some(function (st) { return st && +st.dur >= 5; });
  // ★ v11.47：保持剪辑**不许叠**。一条就 811 帧，两条叠起来就会顶爆队列上限
  //   ⇒ 超限裁剪把前面正在播的动作一起砍掉（见 embodiedIngest 的注释）。
  //   静态姿势叠着也没意义（同一个姿势）⇒ 新的直接顶掉旧的。
  if (holdNow && embodiedQueueIsHold && embodiedQueue.length) {
    embodiedQueue = []; embodiedPlayT = 0; embodiedT = 0;
  }
  if (embodiedQueueIsHold && !holdNow && embodiedQueue.length) {
    postLog('info', '上一个剪辑是造型面板的"保持预览"（' + embodiedQueue.length + ' 帧），新动作不等它 —— 已清空待播队列');
    embodiedQueue = []; embodiedPlayT = 0; embodiedT = 0;
  }
  // ★★ v11.46（用户："AI 自己调用的舞蹈只跳几秒就被吞了"）：真动作在播时，**造型预览连队都别排**。
  //   日志实证：舞蹈（15.77s）刚开播 ⇒ 紧接着入队一条 811 帧的保持剪辑 ⇒ 具身层一驱动就走
  //   `embodiedYieldOn()` ⇒ `stopCurrentMotion(0.2)` ⇒ 舞蹈 0.2 秒内被掐断。
  //   渲染循环里那道守卫只能让它"不写骨"，**拦不住入队和后续的抢骨骼**；静态姿势在舞蹈期间
  //   本来就没有价值 ⇒ 直接在入口丢掉，干净利落。
  if (holdNow && (!!currentMotionAction || (typeof ardyActive !== 'undefined' && ardyActive) || !!dancingNow)) {
    postLog('info', '造型预览已丢弃：有动作在播（舞蹈/生成动作）⇒ 静态姿势不入队，避免把动作掐断');
    return false;
  }
  embodiedQueueIsHold = holdNow;
  // ★ v11.13：把预置/ spec 自带的"输出平滑"（tau）带给播放层 —— 跳跃这类**爆发型**动作要用更小的 τ
  //   （面板默认 0.05s 会把"蹬地那一下"抹圆，看着像弹簧）。
  if (typeof effSpec.tau === 'number') clip.tau = effSpec.tau;
  embodiedIngest(clip);
  postLog('info', 'BodyAct 已合成：' + clip.frames.length + ' 帧 @' + clip.fps + 'fps' +
    (spec.preset ? '（预设 ' + spec.preset + '）' : '（steps ' + ((spec.steps || []).length) + '）'));
  // ★ v11.9：把 spec 的**结构**也打出来（几步、每步多长、几个通道、有没有手型/根位移、段间平滑值）。
  //   起因：用户报"想跳结果像在空中上下浮动"——只看到"811 帧 @20fps（steps 2）"根本判断不出问题在哪，
  //   （40 秒 = 太长了），有了这行下次直接能对照 spec 与表现。
  try {
    // ★ v11.13 修：预置模式下 steps 在 `effSpec`（合并后的 spec）里，外层 spec 只有 {preset}
    //   ⇒ 以前这里打出来是空的（日志只剩"预设+总时长"）。现在读 effSpec，每段的升降/蹲值都能看到。
    const st = Array.isArray(effSpec.steps) ? effSpec.steps : [];
    const parts = st.map((s, i) => {
      const chans = (s && s.pose) ? Object.keys(s.pose).length : 0;
      const dur = (s && s.dur !== undefined) ? ((+s.dur) || 0).toFixed(2) + 's' : '?s';
      const fins = (s && s.fingers && Object.keys(s.fingers).length) ? ('手型' + Object.keys(s.fingers).length + '项') : '';
      const rt = (s && (s.rootY !== undefined || s.crouch !== undefined))
        ? ('升降' + (s.rootY !== undefined ? (+s.rootY).toFixed(2) : '—')
          + '/蹲' + (s.crouch !== undefined ? (+s.crouch).toFixed(2) : '—'))
        : '';
      return '#' + (i + 1) + ' ' + dur + '·通道' + chans + (fins ? '·' + fins : '') + (rt ? '·' + rt : '');
    }).join('｜');
    postLog('info', 'BodyAct 摘要：' + (spec.preset ? ('预设「' + spec.preset + '」') : (st.length + ' 步'))
      + '｜总时长 ' + (clip.frames.length / Math.max(1, clip.fps)).toFixed(1) + 's'
      + (parts ? ('｜' + parts) : '')
      + (effSpec.smooth !== undefined ? ('｜段间平滑 ' + effSpec.smooth) : '')
      + (effSpec.tau !== undefined ? ('｜输出平滑 τ=' + effSpec.tau) : ''));
  } catch (e) { }
  // 蹲/跪/转身到底生效了没有 —— 必须**打出来**。这类"配套解算"以前失败是静默的（用户只看到"膝盖没弯"，
  // 日志一片空白），所以现在无论成功失败都留痕：成功给数字，失败给原因。
  if (clip.askedCrouch > 0.001 || clip.askedKneel > 0.001) {
    if (clip.plan) postLog('info', '蹲/跪已解算：下沉 ' + (-clip.rootY * 100).toFixed(1) + 'cm｜腿前摆 '
      + clip.plan.legFwd.toFixed(1) + '°｜膝屈 ' + clip.plan.knee.toFixed(1) + '°｜踝勾 ' + clip.plan.ankle.toFixed(1) + '°');
    else postLog('warn', '蹲/跪**没有生效**：没量到腿部尺寸（rig.legs）。看日志有没有「腿部量测」那行；'
      + '没有就是模型加载时量失败了 —— 关掉「具身动作」再打开可重测。');
  }
  if (Math.abs(clip.turn || 0) > 0.5) postLog('info', '整体转身 ' + clip.turn.toFixed(0) + '°');
  if (clip.askedFingers) {
    const stepF = [];
    if (Array.isArray(effSpec.steps)) effSpec.steps.forEach(function (st, i) { if (st && st.fingers !== undefined) stepF.push('step' + i + '=' + JSON.stringify(st.fingers)); });
    postLog('info', '手型已应用：' + JSON.stringify(effSpec.fingers || {}) + (stepF.length ? '｜逐段 ' + stepF.join(' ') : ''));
    // ★ 手型诊断：一次判定"手指为什么不动"——模型没手指骨 / 关节没产出 / 弯曲轴没量到。
    //   只在手型变化时打一次。判据：
    //     模型手指骨 0/30            ⇒ 模型确实没有手指骨（属模型限制，弯曲做不到）；
    //     归一化 0 但原始骨 >0        ⇒ 手指骨存在但没被 VRM humanoid 映射（**可修**：改走原始骨）；
    //     有骨但产出 0               ⇒ compose 那边没生成（spec/手型库问题）；
    //     有骨、有产出但不动          ⇒ 弯曲轴/正负号量错了。
    try {
      const sigF = JSON.stringify(effSpec.fingers || {}) + '|' + (Array.isArray(effSpec.steps) ? effSpec.steps.map(function (st) { return st && st.fingers ? JSON.stringify(st.fingers) : ''; }).join('') : '');
      if (sigF !== fingerDiagSig) {
        fingerDiagSig = sigF;
        const FIN = ['Thumb', 'Index', 'Middle', 'Ring', 'Little'], SUF = ['Proximal', 'Intermediate', 'Distal'];
        let have = 0, raw = 0, produced = 0;
        const miss = [];
        for (const sd of ['left', 'right']) for (const f of FIN) for (const s of SUF) {
          const nm = sd + f + s;
          if (vrm && vrm.humanoid && vrm.humanoid.getNormalizedBoneNode(nm)) have++;
          if (vrm && vrm.humanoid && vrm.humanoid.getRawBoneNode && vrm.humanoid.getRawBoneNode(nm)) raw++;
          if (!(vrm && vrm.humanoid && vrm.humanoid.getNormalizedBoneNode(nm))) miss.push(nm);
        }
        try {
          const seen = {};
          // ★ 必须扫**所有帧**：逐段手型（如 reach_fist）第 1 段本来就不含手指骨，
          //   只看第 0 帧会误报"本次产出 0 个手指关节"（实测踩过，差点以为 compose 坏了）。
          for (let fi = 0; fi < clip.frames.length; fi++) {
            const jj = clip.frames[fi].joints || {};
            for (const k in jj) if (/(Thumb|Index|Middle|Ring|Little)\d*(Proximal|Intermediate|Distal)$/.test(k)) seen[k] = 1;
          }
          produced = Object.keys(seen).length;
        } catch (e2) { }
        const rg = window.EmbodiedRig;
        const hd = (rg && rg.hand) ? ('左' + (rg.hand.left ? '有' : '无') + ' 右' + (rg.hand.right ? '有' : '无')) : '无';
        postLog('info', '手型诊断：归一化手指骨 ' + have + '/30｜原始手指骨 ' + raw + '/30｜本次产出 ' + produced
          + ' 个手指关节｜量到的弯曲轴 ' + hd);
        if (miss.length) postLog('info', '手型诊断：缺失的手指骨 = ' + miss.join('、'));
        // 逐指"弯曲指令"（数值越大越弯、0=伸直）：和肉眼看到的对比，就能判断模型的骨骼标签有没有被镜像/错配。
        try {
          const HS = (window.EmbodiedCompose && window.EmbodiedCompose.HAND_SHAPES) || null;
          const cmd = [];
          const specs = [{ tag: '', f: effSpec.fingers }];
          if (Array.isArray(effSpec.steps)) effSpec.steps.forEach(function (st, i) { if (st && st.fingers !== undefined) specs.push({ tag: 'step' + i, f: st.fingers }); });
          for (const it of specs) {
            const fobj = it.f;
            if (!fobj || typeof fobj !== 'object') continue;
            for (const sd of ['l', 'r']) {
              const rawF = fobj[sd];
              if (rawF == null) continue;
              const fdef = (typeof rawF === 'string') ? (HS && HS[rawF]) : rawF;
              const tagP = it.tag ? it.tag + '/' : '';
              if (!fdef) { cmd.push(tagP + sd + '=' + rawF + '(未知手型)'); continue; }
              const bc = isFinite(+fdef.curl) ? +fdef.curl : 0;
              const kk = ['thumb', 'index', 'middle', 'ring', 'little'].map(function (k) { return isFinite(+fdef[k]) ? +fdef[k] : bc; });
              cmd.push(tagP + sd + ' 拇' + kk[0] + '·食' + kk[1] + '·中' + kk[2] + '·无' + kk[3] + '·小' + kk[4]);
            }
          }
          if (cmd.length) postLog('info', '手型诊断：每指弯曲指令 ' + cmd.join('｜') + '（越大越弯，0=伸直）');
        } catch (e4) { }
        if (have === 0) postLog('info', raw === 0
          ? '手型诊断结论：模型**没有手指骨** ⇒ 手指弯曲做不到（模型限制，不是开关/参数问题）。'
          : '手型诊断结论：手指骨**存在**但没被 VRM humanoid 映射（归一化取不到）⇒ 可以改走原始骨修好。');
        else if (produced === 0) postLog('info', '手型诊断结论：有手指骨但**没产出关节** ⇒ 问题在 compose/手型库。');
        else if (!(rg && rg.hand)) postLog('info', '手型诊断结论：有骨有产出、但**没量到弯曲轴**（rig.hand=无）⇒ 轴退化，请把这行发给开发者。');
      }
    } catch (e) { }
  }
  // 蹲/跪/转身会显著改变身体高度与朝向 ⇒ **取景必须跟着重算**，否则人一沉下去腿就掉出窗口。
  // 防抖：拖动时每次重算会抖，合并成 0.5 秒一次；只在"明显变了"才触发（中性态不触发，免得白晃）。
  const fitKey = (clip.askedCrouch || 0).toFixed(2) + '|' + (clip.askedKneel || 0).toFixed(2)
    + '|' + Math.round((clip.turn || 0) / 15);
  if (fitKey !== lastEmbodiedFitKey) {
    lastEmbodiedFitKey = fitKey;
    clearTimeout(embodiedFitTimer);
    // 蹲/跪时把底部留白临时放大到 20%（小腿/脚在最低处，不留白必被窗口底边切掉）；结束自动还原。
    fitBottomMarginOverride = ((clip.askedCrouch || 0) > 0.02 || (clip.askedKneel || 0) > 0.02) ? 0.20 : null;
    embodiedFitTimer = setTimeout(() => { try { reframe(); } catch (e) { } }, 500);
  }
  return true;
}
window.embodiedBodyAct = (spec) => embodiedComposeAndPlay(spec);

// 造型编辑器用：**替换**当前动作，而不是往队列后面排。
// 队列是"依次播放"语义（AI 连续下发的动作该排队），但拖滑块时每次都要立刻换成新姿势，
// 直接复用 embodiedBodyAct 会把上百条时间线排进队列（画面就不动了）。
window.embodiedPoseOnce = function (spec, opt) {
  // ★★ v11.41：`opt.autoKeep` = **自动续持 / 存档恢复**（不是用户主动摆姿势）。
  //   这类请求**绝不能**掐掉 AI 生成动作 —— 造型面板会周期性续持（每 40s 那条保持剪辑就是它），
  //   而 `ardyStopArdy()` 一刀切 ⇒ AI 舞蹈播到一半被抹掉（"放不全"）。只有**用户主动**改造型才让位。
  const autoKeep = !!(opt && opt.autoKeep);
  // ★★ v11.44「续持不得抢骨骼」—— 这是"AI 自己调用的动作还是被吞了"的最后一环：
  //   造型面板的续持**每 40 秒**来一次，旧代码一进来就 `embodiedQueue = []`（清空具身队列）
  //   + 顶上 40s 保持剪辑 ⇒ 正在播的 AI 动作（走 BodyAct 具身路径的）被**整段抹掉**。
  //   （上一版我只挡住了"掐生成层"，忘了这条清空同样致命。）
  //   续持的语义只是"顶住姿势不倒"，**绝不该抢走正在播的动作**：
  //   只要队列里有非保持剪辑、或有 VRMA 舞蹈、或有生成动作在播 ⇒ 直接跳过这次续持。
  if (autoKeep) {
    const _qHasAction = !!(embodiedQueue && embodiedQueue.length && !embodiedQueueIsHold);
    const _busy = _qHasAction || !!currentMotionAction || !!dancingNow
      || (typeof ardyActive !== 'undefined' && ardyActive);
    if (_busy) {
      postLog('info', '造型续持已跳过：有动作在播（队列 ' + (embodiedQueue ? embodiedQueue.length : -1)
        + '帧｜保持剪辑=' + (!!embodiedQueueIsHold) + '｜生成层=' + (!!ardyActive) + '）⇒ 续持不抢骨骼');
      return false;
    }
  }
  embodiedQueue = []; embodiedPlayT = 0; embodiedT = 0;
  embodiedQueueIsHold = true;    // 造型面板发的是"保持"剪辑 ⇒ 之后的新动作不该排在它后面（见 embodiedComposeAndPlay）
  // ★ 造型预览是"最新一次明确请求"⇒ 必须让**生成动作层**也让位：
  //   否则 ardy 的生成动作会继续每帧写腿/臂，把刚摆好的姿势覆盖掉（膝不弯、手乱摆、抽搐）。
  //   ★ 但"自动续持/存档恢复"不算"明确请求" ⇒ 跳过这条（否则等于定时炸弹，每 40s 掐一次动作）。
  if (!autoKeep && typeof window.ardyStopArdy === 'function' && ardyActive) window.ardyStopArdy('造型面板主动改造型');
  return embodiedComposeAndPlay(spec);
};

// ---- 动作播放（带过渡 crossfade + 默认时长）与自动跳舞 ----
let currentMotionAction = null;
let lastDanceName = null, danceTimer = 0, danceIndex = 0;
let currentMotionName = null;   // 当前正在播放的动作名（用于 UI 显示“正在跳哪支”）
let motionBtns = {};            // 动作列表里各按钮节点，供实时高亮“正在播放”
function updateNowPlaying() {
  // “正在跳”：平时不在屏幕上渲染；仅当右键动作 UI / 设置面板打开时才显示（顶部浮层，不挡人物）
  if (nowPlayingOverlay) {
    nowPlayingOverlay.textContent = currentMotionName ? ('♪ 正在跳：' + currentMotionName) : '♪ 未播放动作';
    refreshNowPlayingOverlay();
  }
  for (const n in motionBtns) { if (motionBtns[n]) motionBtns[n].classList.toggle('sp-btn-active', n === currentMotionName); }
}
// 仅在“右键动作 UI(pet-menu) 或 设置面板”打开时显示“正在跳”浮层；平时隐藏
function refreshNowPlayingOverlay() {
  if (!nowPlayingOverlay) return;
  const show = settingsOpen || (typeof menuEl !== 'undefined' && menuEl && !menuEl.classList.contains('hidden'));
  nowPlayingOverlay.classList.toggle('hidden', !show);
}
function clearMotionTimers() { motionTimers.forEach(t => clearTimeout(t)); motionTimers = []; }
function stopCurrentMotion(fade) {
  releaseMotionExpression();     // 收回自动叠加的表情
  dancingNow = false;   // 动作结束 → 恢复头部/脊椎追踪
  // ★ 动作结束后给待机一个**空档**：待机定时器在动作播放期间一直在倒数，动作一停它往往已经 ≤0 →
  //   下一帧立刻接一个待机动作（观感："动作刚做完就被待机顶掉"）。
  //   这里按「待机动作间隔」重新计时，并保证至少 0.6 秒的交接间隔。
  idleMotionTimer = Math.max(idleMotionTimer, Math.max(0.2, motionIdleGap));   // 节奏：交接空档（可调）
  if (!currentMotionAction) return;
  const a = currentMotionAction;
  const nm = currentMotionName;
  const f = (fade === undefined) ? Math.max(0, +(lastOpts.motionTransition ?? 0.3)) : fade;
  try { a.fadeOut(f); } catch (e) { }
  motionTimers.push(setTimeout(() => { try { a.stop(); } catch (e) { } }, f * 1000 + 60));
  currentMotionAction = null;
  currentMotionName = null; updateNowPlaying();
  setClipActive(nm, false);   // 解除活跃标记，允许其被缓存淘汰
}
async function playVRMMotion(name, seconds, fadeOverride, oneShot) {
  if (!vrm || !vrmMixer) return false;
  let clip = vrmClips[name];
  if (!clip) clip = await ensureVrmClip(name);
  if (!clip) { warnMotionUnplayable(name); return false; }   // ★ 不许静默：点了名却没动，必须留下指纹
  setClipActive(name, true);
  const fade = (fadeOverride !== undefined) ? fadeOverride : Math.max(0, +(lastOpts.motionTransition ?? 0.3));
  const action = vrmMixer.clipAction(clip);
  action.reset();
  action.setLoop(THREE.LoopRepeat, Infinity);   // 循环播放，由时长/切换来控制停止
  action.enabled = true;
  action.setEffectiveWeight(1);
  if (fade > 0) action.fadeIn(fade); 
  action.play();
  if (currentMotionAction && currentMotionAction !== action) { try { currentMotionAction.fadeOut(fade); } catch (e) { } }
  currentMotionAction = action;
  dancingNow = true;   // 标记“正在播动作”，供“舞蹈时关闭追踪”判定
  // ★ v11.36c：点播舞蹈时，造型面板的 40s「保持预览」若还占着骨骼，直接清掉 ——
  //   留着它的话，它会在舞蹈播到一半时继续逐帧盖骨（用户："舞蹈完全不对了"）。
  //   造型面板下次摆姿势/开面板会重新发一条，所以丢掉不会让姿势永久丢失。
  if (embodiedQueueIsHold && embodiedQueue.length) {
    postLog('info', '· 点播动作：造型面板的"保持预览"（' + embodiedQueue.length + ' 帧）已清空，让位给舞蹈');
    embodiedQueue = []; embodiedPlayT = 0; embodiedT = 0; embodiedQueueIsHold = false;
  }
  currentMotionName = name; updateNowPlaying();   // 记录正在播放的动作，供 UI 显示
  applyMotionExpression(clip);   // 不带表情轨道的动作 → 自动叠一个表情
  // 时长：① 显式 seconds 优先；② oneShot（AI 调 <Motion> 不带 seconds，语义="自然播放一次"）
  //       → 用片段自身长度播完就停；③ 其余退到配置「动作持续」（0 = 一直循环）。
  // ★ 修 bug：原来 ② 也落到 ③，而该配置默认 0 = 无限循环 → AI 喊一个动作就永远停不下来。
  let dur = (seconds && seconds > 0) ? seconds
    : (oneShot ? ((clip.duration > 0) ? clip.duration : 3) : (+(lastOpts.motionDuration) || 0));
  // ★★ v11.48（用户实证：AI 发的是 `<Motion option="vrma/004_hello_1" seconds="3"/>`，
  //   而该动作全长 15.77s ⇒ 播 3 秒就停，看着像"被截断了"）：
  //   这不是播放端掐断，**前端老老实实照 AI 的 seconds 办了**。但 AI 写 seconds 的语义是
  //   "希望它做多久"，而 3 秒 < 全长 ⇒ 明显是 AI 低估了动作长度。
  //   ⇒ 若 AI 指定的时长**短于动作全长**，按**完整一支**播（一次性），并留日志说明。
  //   想恢复"严格按 AI 的秒数"：宿主传 `motionAiFull=false` 即可。
  if (lastOpts.motionAiFull !== false && seconds && seconds > 0 && clip.duration > seconds + 0.5) {
    postLog('info', '动作时长：AI 指定 ' + seconds + 's，但该动作全长 ' + clip.duration.toFixed(1)
      + 's ⇒ 按完整一支播（避免"只做几秒就断"；要严格按 AI 秒数请设 motionAiFull=false）');
    dur = clip.duration;
  }
  clearMotionTimers();
  if (dur > 0) {
    // ★ 收尾提前"一个过渡时长"开始，让淡出**正好在剪辑末尾**完成。
    //   否则定时器要等"整段时长"才触发，而 action 是循环的 ⇒ 此刻已又从头起了一帧，
    //   用户看到的是"跳完 → 猛地弹回起始姿势 → 才开始淡出"（"播完跳一下"的观感来源）。
    //   下限 dur*0.5：极短动作 + 大过渡时，别把整段都吃掉。
    const fadeS = Math.max(0, fade);
    const stopAt = Math.max(dur - fadeS, dur * 0.5);
    motionTimers.push(setTimeout(() => stopCurrentMotion(fade), stopAt * 1000));
  }
  return true;
}
// 跳舞/播动作时自动叠加一个表情（很多舞蹈 VRMA 只有骨骼没有表情，脸会僵着）。
// 若动作文件自带表情轨道（track 名以 .weight 结尾），则以动作自带的为准，不抢。
let motionExprApplied = '';
function clipHasExpressionTrack(clip) {
  const tracks = (clip && clip.tracks) || [];
  return tracks.some(t => typeof t.name === 'string' && t.name.endsWith('.weight'));
}
function applyMotionExpression(clip) {
  let name = lastOpts.danceExpression || '';
  if (!name || !vrm || !exprMgr()) return;
  if (clipHasExpressionTrack(clip)) return;   // 动作自带表情轨道 → 以自带的为准
  if (name === 'random') {                     // 随机：每次播放抽到一张不同的脸
    const list = collectExpressions().filter(n => n && n !== 'blink');
    name = list.length ? list[Math.floor(Math.random() * list.length)] : '';
  }
  if (!name) return;
  try {
    if (exprMgr().getExpression(name)) {
      exprMgr().setValue(name, 1);
      motionExprApplied = name;
    }
  } catch (e) { }
}
function releaseMotionExpression() {
  if (!motionExprApplied) return;
  try { if (vrm && exprMgr()) exprMgr().setValue(motionExprApplied, 0); } catch (e) { }
  motionExprApplied = '';
}

// 自动跳舞：按 跳舞时长/过渡 轮流播放动作（风格 0=随机 1=顺序）
// 同时支持 VRM(vrmClips) 与 PMX/VMD(mmdClips)：
// 原先开头是 if (!vrm || !vrmMixer) return; —— PMX 下 vrm 为 null，整段直接返回，
// 导致“自动跳舞”在 MMD 上完全无效（而手动点击走 playMotionByName 不经过这里，所以手动能跳）。
async function updateDance(dt) {
  if (danceBusy) return;   // 加载中锁定，避免同一帧内重复挑选/重复 ensure 导致播两支
  if (embodiedYielding) return;   // 具身动作接管时自动跳舞让位
  const isVrm = !!vrm;
  const names = playableMotionNames();   // ★ 按模型类型过滤：否则会随机抽到 .vmd 等播不了的名字，那轮空转
  if (!lastOpts.autoDance || names.length === 0) { danceTimer = 0; return; }
  if (danceTimer > 0) { danceTimer -= dt; return; }
  let idx;
  if ((+lastOpts.danceStyle) === 1) { idx = danceIndex % names.length; danceIndex++; }
  else { idx = Math.floor(Math.random() * names.length); }
  if (names.length > 1 && names[idx] === lastDanceName) idx = (idx + 1) % names.length;
  lastDanceName = names[idx];
  const dd = +(lastOpts.danceDuration ?? 14) || 14;   // 配置的“跳舞时长”
  let dur = dd;
  danceBusy = true;
  try {
    if (isVrm) {
      if (!vrmMixer) { danceTimer = 1; return; }
      // 懒加载：确保这支已解析（用到才解析）；提前预取下一支，减少切换卡顿
      const nextIdx = (idx + 1) % names.length;
      ensureVrmClip(names[nextIdx]).catch(() => {});
      const cn = await ensureVrmClip(names[idx]);
      if (!cn) { danceTimer = 1; return; }
      const fade = Math.max(0, +(lastOpts.danceTransition ?? 1.2));
      releaseMotionExpression();     // 先收回上一支自动叠加的表情，避免表情累积
      if (!playVRMMotion(cn, 0, fade)) { danceTimer = 1; return; }
      clearMotionTimers();   // 自动跳舞的切换由 danceTimer 统一控制，不让它按“动作持续”自动停
    } else {
      const cn = await ensureMmdClip(names[idx]);
      if (!cn) { danceTimer = 1; return; }
      const clip = mmdClips[names[idx]];
      currentMotionName = names[idx]; updateNowPlaying();
      playMmdClip(clip);
      if (clip.duration > 0) dur = Math.min(clip.duration, dd);
    }
    console.log('[3D桌宠] 自动跳舞 → ' + names[idx]);
    danceTimer = dur;
  } finally { danceBusy = false; }
}

// PMX(MMD) 播放一支 VMD：helper 在 loadMMD 时已 add 过该 mesh，
// 再次 helper.add 会抛 "SkinnedMesh has already been added"，所以直接复用内部 mixer 切换动作。
function playMmdClip(clip, loop) {
  if (!helper || !mmdMesh || !clip) return;
  const obj = helper.objects.get(mmdMesh);
  if (!obj) {   // 兜底：理论上 loadMMD 已 add，不会走到这里
    try { helper.add(mmdMesh, { animation: clip, physics: !!lastOpts.enablePhysics, ik: !!lastOpts.enableIK }); } catch (e) { console.warn('VMD 播放失败', e); }
    return;
  }
  // 切 VMD 时的异常必须就地吞掉：一旦外泄会打断整个渲染循环 → 画面卡死且自动跳舞再也不推进。
  try {
    // 每次切换都用全新 mixer：复用旧 mixer 时，上一支残留的 action/权重/插值状态会随切换累积，
    // 表现正是“第一支正常、第二支跳着跳着卡死”。重建可彻底清掉这些状态（helper 每帧按 object.mixer 取用，安全）。
    if (obj.mixer) { try { obj.mixer.stopAllAction(); } catch (e) { } }
    obj.mixer = new THREE.AnimationMixer(mmdMesh);
    // 物理刚体必须一起 reset：切第二支时刚体还带着上一支的模拟状态，位置突变会让求解发散，
    // 表现为“第二支跳着跳着越来越卡直到卡死”。
    if (obj.physics) { try { obj.physics.reset(); } catch (e) { } }
    const a = obj.mixer.clipAction(clip);
    a.reset();
    // loop===false（点播默认）→ **播完一次就停住**（VMD 没有"回静止姿势"这回事，停在末帧）；
    //   其余（自动跳舞轮播 / 「重复播放」开关打开）→ 一直重复。
    const lp = (loop !== false);
    a.setLoop(lp ? THREE.LoopRepeat : THREE.LoopOnce, lp ? Infinity : 1);
    if (!lp) a.clampWhenFinished = true;      // 停在末帧，别弹回第一帧（那会看到"闪一下又从头"）
    a.enabled = true;
    a.setEffectiveWeight(1);
    a.play();
    dancingNow = true;   // 标记“正在播动作(VMD)”，供“舞蹈时关闭追踪”判定
  } catch (e) {
    console.warn('[3D桌宠] VMD 播放失败', e);
  }
}

// 手动点播一支后，让“这支完整播完”再继续自动轮播。
// 关键：不能设 danceTimer = 0 —— 那等于告诉 updateDance“下一帧立刻切下一支”，
// 结果用户刚点的那支被随机抽的一支瞬间覆盖（表现为“手动选了却跳的是别的/全随机”）。
function armDanceTimerForCurrent() {
  const dd = +(lastOpts.danceDuration ?? 14) || 14;
  let dur = dd;
  const clip = vrm ? vrmClips[currentMotionName] : mmdClips[currentMotionName];
  if (clip && clip.duration > 0) dur = Math.min(clip.duration, dd);
  danceTimer = dur;
}

// 统一按名称播放动作（VRM/MMD 通用入口，供动作列表使用）
// ★★ 点播语义 = **默认"播完一支就停"**（用户要求）。以前不是：
//   这里不传 oneShot ⇒ 落到「动作持续」配置，而它默认 0 = 永不停止 ⇒ 点一支动作就**永远重复同一支**
//   （实测症状："跳完一个，他会继续重复动作，一直跳"）。想一直重复就在「动作」面板打开「重复播放」。
//   注意语义边界：只改**手动点播**；AI 走 bridge 的 'motion' 消息，那边始终是"自然播放一次"，不受此开关影响。
// forceOneShot：留给 bridge(AI) 路径 —— 它的语义固定是"自然播放一次"，不随「重复播放」开关变。
async function playMotionByName(n, forceOneShot) {
  const oneShot = (forceOneShot !== undefined) ? !!forceOneShot : !lastOpts.motionLoop;
  if (vrm) { await playVRMMotion(n, undefined, undefined, oneShot); armDanceTimerForCurrent(); return; }
  if (mmdMesh && helper) {
    const clip = mmdClips[n] || await ensureMmdClip(n); if (!clip) return;
    currentMotionName = n; updateNowPlaying(); playMmdClip(clip, !oneShot);
    clearMotionTimers();   // 清掉上一次点播留下的"停止定时器"（否则它会在新动作播到一半时把状态清掉）
    if (oneShot) {
      // VMD 侧没有"回静止姿势"，停下就是保持末帧 ⇒ 只把状态收回来（否则追踪不恢复、UI 一直显示"正在跳"）
      const dur = (clip.duration > 0) ? clip.duration : 3;
      motionTimers.push(setTimeout(() => { dancingNow = false; currentMotionName = null; updateNowPlaying(); }, dur * 1000 + 60));
    }
    armDanceTimerForCurrent();
  }
}

messageBus.on('motion', async (msg) => {
  // 经 bridge 进来的 = AI/宿主调用：没给 seconds 时，语义是"自然播放一次"（与工具说明一致），
  // 不能退到「动作持续」配置（默认 0 = 无限循环，动作会一直重复停不下来）。UI 内部播放不走这里。
  const oneShot = (msg.seconds === undefined || msg.seconds === null);
  if (oneShot) postLog('info', '动作「' + msg.name + '」按"自然播放一次"处理（AI 未指定时长）');
  // 节奏控制：两次动作太近 → **延后**而不是丢弃（丢弃会让 AI 以为做了其实没做）
  const nowS = performance.now() / 1000;
  const waitS = motionCooldown - (nowS - lastBridgeMotionAt);
  if (waitS > 0.05) {
    postLog('info', '动作间隔保护：距上次 ' + (nowS - lastBridgeMotionAt).toFixed(1) + 's < ' + motionCooldown + 's → 延后 ' + waitS.toFixed(1) + 's');
    await new Promise(r => setTimeout(r, waitS * 1000));
  }
  lastBridgeMotionAt = performance.now() / 1000;
  if (vrm) { await playVRMMotion(msg.name, msg.seconds, undefined, oneShot); armDanceTimerForCurrent(); }
  else if (mmdMesh && helper) { await playMotionByName(msg.name, oneShot); }   // MMD：复用统一入口（含"播完一次就停"）
  armDanceTimerForCurrent();   // 手动指定的这支播完再让自动轮播接管
});

messageBus.on('subtitle', (msg) => {
  const el = document.getElementById('subtitle');
  if (!msg.text) el.classList.add('hidden');
  else { el.textContent = msg.text; el.classList.remove('hidden'); }
});

messageBus.on('using', (msg) => {
  const el = document.getElementById('busy');
  if (msg.value) el.classList.remove('hidden'); else el.classList.add('hidden');
});

messageBus.on('setIK', (msg) => {
  if (helper) { try { helper.enable('ik', !!msg.enabled); } catch (e) { console.warn('IK 切换失败', e); } }
});

messageBus.on('posture', (msg) => { setPose(msg.pose || 'stand'); });
messageBus.on('action', (msg) => { playAction(msg.name); });
messageBus.on('embodied_frames', (msg) => {   // 生成端推帧入口（见 applyEmbodiedRetarget）
  if (!msg) return;
  if (typeof msg.json === 'string') {          // 允许 C#/后端直接送 JSON 文本
    try { embodiedIngest(JSON.parse(msg.json)); } catch (e) { console.warn('[3D桌宠] 具身帧 JSON 解析失败', e); }
    return;
  }
  embodiedIngest(msg);
});
messageBus.on('embodied_sample', () => { if (window.embodiedPlaySample) window.embodiedPlaySample(); });   // 右键“播放具身示例”
messageBus.on('embodied_wave', () => { if (window.embodiedBodyAct) window.embodiedBodyAct({ preset: 'wave' }); });   // 右键“试做具身动作(挥手)”
messageBus.on('bodyexpress', (msg) => { if (msg) embodiedExpress(msg); });                 // AI 的 <bodyexpress>（C# 下发）
// AI 的「生成式动作」<bodyact prompt="…"/>（C# 下发）：文字 → 本地模型生成 → 重定向 → 播放。
// 校验/兜底：ardYPlay 返回 false（没生成出来 / 播放器不可用）时**退回预置动作**，并把结果打进日志，
// 这样 AI 只会看到"确实播了"或"确实回退了"，不会出现"嘴上说做了、画面没动"。
messageBus.on('bodyact_prompt', async (msg) => {
  const prompt = (msg && msg.prompt) || '';
  if (!prompt) return;
  if (!window.ardyPlay) { postLog('error', '生成式动作不可用：ardy-client.js 未加载'); return; }
  postLog('info', 'AI 请求生成式动作：' + prompt);
  // ★★ 走「语义层防线」：生成(dry-run) → 按词表 expect 自动验收 → 不过换 seed 重试一次
  //    → 仍不过就不播（不闪怪姿势）→ 退回预置（举手）→ 把"近似/已退回"写进 <bodystate>。
  let okGen = null, approx = false, judged = false;
  try {
    if (window.ardyPlayVerified) {
      const r = await window.ardyPlayVerified(prompt);
      okGen = !!(r && r.ok);
      approx = !!(r && (r.approx || (r.pass === null)));
      judged = !!(r && r.pass !== null);
    } else {
      okGen = await window.ardyPlay(prompt);      // 旧路径兜底
    }
  } catch (e) { okGen = null; }
  if (okGen) {
    genVerdictNote = approx
      ? ('「' + prompt + '」这次是**近似**（该词条判据未校准，只做了生成成功检查）')
      : (judged ? ('「' + prompt + '」已通过自动验收' + (window.ardyLastVerdict && window.ardyLastVerdict.attempt > 1 ? '（第 2 次生成才达标）' : '')) : '');
    postLog('info', '生成式动作已播放：' + prompt + (genVerdictNote ? ('｜' + genVerdictNote) : ''));
    try { embExprReport(); } catch (e) { }        // 让 <bodystate> 立刻带上这句
    return;
  }
  const v = window.ardyLastVerdict || null;
  genVerdictNote = '「' + prompt + '」两次生成都没达自动验收 ⇒ 已退回预置动作（举手）'
    + (v && v.lines && v.lines.length ? ('；判据：' + v.lines.join('，')) : '');
  postLog('warn', '生成式动作未达自动验收（2 次）→ 退回预置动作（举手）｜' + genVerdictNote);
  try { if (window.embodiedBodyAct) window.embodiedBodyAct({ preset: 'hands_up' }); } catch (e) { }
  try { embExprReport(); } catch (e) { }
});
messageBus.on('embodied_happy', () => embodiedExpress({ emotion: 'happy', intensity: 0.85, hold: 8 }));   // 右键“试做表情(开心)”
messageBus.on('embodied_preset', (msg) => {   // 右键试做任意具身预设（背手 / 比心 …）
  if (msg && msg.name && window.embodiedBodyAct) window.embodiedBodyAct({ preset: msg.name });
});
messageBus.on('embodied_compose', (msg) => {   // AI 的 <bodyact> / C# 下发的关键帧 spec（或预设名）
  if (!msg) return;
  try { embodiedComposeAndPlay(typeof msg.json === 'string' ? msg.json : msg, { ai: true }); }
  catch (e) { postLog('error', 'BodyAct 处理失败：' + e.message); }
});
messageBus.on('env', (msg) => { if (msg.taskbarTop) taskbarTop = msg.taskbarTop; });
messageBus.on('cursor', (msg) => {
  if (msg.w && msg.h) {
    cursorNDC = { x: (msg.x / msg.w) * 2 - 1, y: -(msg.y / msg.h) * 2 + 1 };
    cursorSeenT = idleT;
    // ★ 同时留下**原始像素坐标**：鼠标"摸"用它 + 窗口位置换算出"窗口内坐标"（见 touchCursor）
    cursorScreen = {
      x: +msg.x, y: +msg.y, w: +msg.w, h: +msg.h,
      t: (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()
    };
    learnCursorOffset();     // ★ 与"窗口内 mousemove"配对 ⇒ 自学换算（见 learnCursorOffset 注释）
  }
});
// 宿主回的窗口在屏幕上的位置（物理像素）—— 全屏光标换算成窗口内坐标要用它
messageBus.on('win_rect', (msg) => {
  if (msg && isFinite(+msg.w) && +msg.w > 0) winRect = { x: +msg.x, y: +msg.y, w: +msg.w, h: +msg.h };
});

// ================= 交互：拖动 / 点击 / 右键展开菜单 =================
canvas = document.getElementById('canvas');
const menuEl = document.getElementById('pet-menu');
const nowPlayingOverlay = document.getElementById('now-playing');   // “正在跳”屏幕浮层：仅右键动作 UI 打开时显示

// ---- 菜单数据：完整菜单树（由 C# 按当前能力生成，前端只负责递归渲染） ----
let petMenuTree = [];
let petMenuPath = []; // 从根到当前层级的 uid 路径

function findNodeByUid(list, uid) {
  if (!list) return null;
  for (const n of list) if (n.uid === uid) return n;
  return null;
}
// 沿路径解析出当前要渲染的节点（路径失效时回退到根）
function currentMenuNode() {
  let node = { children: petMenuTree, label: 'root' };
  for (const uid of petMenuPath) {
    const next = findNodeByUid(node.children, uid);
    if (!next) break;
    node = next;
  }
  return node;
}

messageBus.on('menu_data', (msg) => {
  petMenuTree = Array.isArray(msg.menu) ? msg.menu : [];
  // 路径在新树上重新对齐，失效则回退到根（如切模型后 MMD 组消失）
  const newPath = [];
  let cur = { children: petMenuTree };
  let ok = true;
  for (const uid of petMenuPath) {
    const n = findNodeByUid(cur.children, uid);
    if (!n) { ok = false; break; }
    newPath.push(uid); cur = n;
  }
  if (!ok) petMenuPath = [];
  if (!menuEl.classList.contains('hidden')) renderPetMenu();
});

// 画质（低/中/高）：控制 renderer 像素比。高分屏上高像素比会成倍放大画布，吃掉 GPU 显存与算力；
// 低=上限 1.25（不再锁死 1，避免高分屏上糊到没法看），中=上限 1.5，高=原生（默认，保持原行为）。
function applyQuality() {
  if (!renderer) return;
  const q = lastOpts.quality || 'high';
  const dpr = window.devicePixelRatio || 1;
  let ratio = dpr;                        // 高=原生
  if (q === 'low') ratio = Math.min(dpr, 1.25);
  else if (q === 'med') ratio = Math.min(dpr, 1.5);
  renderer.setPixelRatio(ratio);
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  console.log('[3D桌宠] 画质=' + q + '，像素比=' + ratio);
}

messageBus.on('options_update', (msg) => {
  applyIdleOpts(msg);   // 待机/追踪/眨眼参数
  // ---- 光照：氛围光(AMBI1/2/3) + 全局灯光 ----
  const lightKeys = ['enableAmbient', 'ambientSaturation', 'ambient2Color', 'ambient2Intensity', 'ambient2Saturation',
    'ambient3Color', 'ambient3Intensity', 'ambient3Saturation', 'enableKey', 'keySaturation'];
  let lightDirty = false;
  for (const k of lightKeys) if (msg[k] !== undefined) { lastOpts[k] = msg[k]; lightDirty = true; }
  if (msg.lightingPreset !== undefined) lastOpts.lightingPreset = msg.lightingPreset;
  if (msg.lightingIntensity !== undefined) lastOpts.lightingIntensity = msg.lightingIntensity;
  if (msg.lightAmbientColor !== undefined) lastOpts.lightAmbientColor = msg.lightAmbientColor;
  if (msg.lightAmbientIntensity !== undefined) lastOpts.lightAmbientIntensity = msg.lightAmbientIntensity;
  if (msg.lightKeyColor !== undefined) lastOpts.lightKeyColor = msg.lightKeyColor;
  if (msg.lightKeyIntensity !== undefined) lastOpts.lightKeyIntensity = msg.lightKeyIntensity;
  if (lightDirty || msg.lightingPreset !== undefined || msg.lightingIntensity !== undefined ||
      msg.lightAmbientColor !== undefined || msg.lightAmbientIntensity !== undefined ||
      msg.lightKeyColor !== undefined || msg.lightKeyIntensity !== undefined)
    applyLighting(lastOpts.lightingPreset || 'studio', lastOpts.lightingIntensity || 1);
  if (msg.background !== undefined) { lastOpts.background = msg.background; applyBackground(msg.background); }
  if (msg.scale !== undefined) lastOpts.scale = msg.scale;
  if (msg.cameraDistance !== undefined) lastOpts.cameraDistance = msg.cameraDistance;
  if (msg.cameraYaw !== undefined) lastOpts.cameraYaw = msg.cameraYaw;
  if (msg.cameraPitch !== undefined) lastOpts.cameraPitch = msg.cameraPitch;
  if (msg.cameraHeight !== undefined) lastOpts.cameraHeight = msg.cameraHeight;
  if (msg.bottomMargin !== undefined) lastOpts.bottomMargin = msg.bottomMargin;
  if (msg.scale !== undefined || msg.cameraDistance !== undefined || msg.cameraYaw !== undefined ||
      msg.cameraPitch !== undefined || msg.cameraHeight !== undefined || msg.bottomMargin !== undefined)
    frameCamera(lastOpts.scale || 1, lastOpts.cameraDistance || 6);
  if (msg.poseOffsets !== undefined) {
    lastOpts.poseOffsets = msg.poseOffsets;
    if (_poseOffsetsAuthoritative) {
      // ★ 本模型已有自己的存档 ⇒ **拒收**宿主这份。宿主那份是"全局一份"（不按模型），
      //   换模型时正是它把上一个模型的缓存灌进来（用户："会把之前缓存的弄进来……吓了我一跳"）。
      //   内容不一致时把本模型的值推回宿主（两边归位）。
      //   ★ 防回环：①内容相同就不发（宿主把我们的值原样回传时就此打住）
      //             ②2 秒内最多回推一次（万一两边 JSON 键序不同，也不会你一句我一句刷消息）
      let same = false;
      try { same = (JSON.stringify(poseOverrides) === String(msg.poseOffsets || '')); } catch (e) { same = false; }
      const nowMs = Date.now();
      if (!same && nowMs - _posePushBackT > 2000) {
        _posePushBackT = nowMs;
        try { sendMenu('pose_offsets', { value: JSON.stringify(poseOverrides) }); } catch (e) { }
      }
    } else {
      parsePoseOffsets(msg.poseOffsets);
      // ★★ 数据变了就**重建滑条** —— 这是"数值没改 / 还都是 0 / 拖动时突然跳"的解药：
      //   旧代码在这里改了数据却不刷面板 ⇒ 面板数字与真实数据长期不一致，看着像"没保存"。
      refreshPoseBonesUI();
      try { if (currentPose) setPose(currentPose); } catch (e) { }
      // 一次性迁移：把宿主那份（老版本只有全局一份）落到**本模型**的存档里，下次就按模型各管各的
      try { poseOffsetStore(currentPose || 'stand'); _poseOffsetsAuthoritative = true; } catch (e) { }
    }
  }
  // ★ 生成式动作手感参数（第 2 项持久化）：宿主回传 → 装回来（重开窗口不再回默认）
  if (msg.ardyTune !== undefined) { lastOpts.ardyTune = msg.ardyTune; try { applyArdyTuneJson(msg.ardyTune); } catch (e) { } }
  // ★ 宿主回传的"按模型存档"：装进来 + **立刻重读族级模式并套用**（否则要等下一次加载才生效）
  if (msg.rigProfile !== undefined) {
    lastOpts.rigProfile = msg.rigProfile;
    rigHostLoad(msg.rigProfile);
    _famMem = { arm: null, leg: null, hand: null, thumb: null };
    try { applyHandFlipModes(); } catch (e) { }
    try { refreshPoseTargets(); } catch (e) { }
  }
  if (msg.enableIK !== undefined) { lastOpts.enableIK = msg.enableIK; if (helper) { try { helper.enable('ik', !!msg.enableIK); } catch (e) { } } }
  if (msg.enablePhysics !== undefined) { lastOpts.enablePhysics = msg.enablePhysics; if (helper) { try { helper.enable('physics', !!msg.enablePhysics); } catch (e) { } } }
  // VRM 物理（弹簧骨）：和上面 MMD 的 enablePhysics 是两套实现，别混
  if (msg.vrmPhysics !== undefined) { lastOpts.vrmPhysics = msg.vrmPhysics; applyVrmPhysics(!!msg.vrmPhysics); }
  if (msg.enableHeadTrack !== undefined) headTrack = !!msg.enableHeadTrack;
  if (msg.enableSpineTrack !== undefined) spineTrack = !!msg.enableSpineTrack;
  if (msg.windowTop !== undefined) windowTopState = !!msg.windowTop;
  if (msg.mouseThrough !== undefined) lastOpts.mouseThrough = !!msg.mouseThrough;
  // 自定义造型（用户摆好存下来的）：清单变化时重新注册，AI 立刻能用 <bodyact preset="名字"/>
  if (msg.customPoses !== undefined) { lastOpts.customPoses = msg.customPoses; applyCustomPoses(msg.customPoses); }
  // ---- 动作 / 舞蹈 ----
  for (const k of ['motionDuration', 'motionTransition', 'motionLoop', 'autoDance', 'danceStyle', 'danceDuration', 'danceTransition', 'danceExpression', 'danceDisableTrack', 'pmxArmDropDeg', 'embodiedMotion', 'embodiedSmooth', 'embodiedExpression', 'embodiedFaceMap', 'motionIdiomRefreshDays'])
    if (msg[k] !== undefined) lastOpts[k] = msg[k];
  if (msg.embodiedExpression !== undefined) embExprReport();   // 开关变化后回报一次真实状态，供 <bodystate> 查询
  danceDisableTrack = lastOpts.danceDisableTrack !== false;   // “舞蹈时关闭追踪”开关（默认开）
  // 模型部件隐藏清单（C# 持久化后下发）：即时生效，不用重载模型
  if (msg.hiddenParts !== undefined) { lastOpts.hiddenParts = msg.hiddenParts; applyHiddenParts(msg.hiddenParts); }
  // ---- 静止表情（基础表情）----
  if (msg.baseExpression !== undefined) { lastOpts.baseExpression = msg.baseExpression; baseExpression = msg.baseExpression || ''; applyBaseExpression(); }
  if (msg.baseExpressionWeight !== undefined) { lastOpts.baseExpressionWeight = msg.baseExpressionWeight; baseExpressionWeight = Math.max(0, Math.min(1, +msg.baseExpressionWeight || 0.6)); applyBaseExpression(); }
  if (msg.autoDance !== undefined && !msg.autoDance && currentMotionAction) stopCurrentMotion();
  // 打开自动跳舞：只在“当前没在播动作”时才立即起跳；若用户正手动播着一支，
  // 不能把 danceTimer 清 0（那会立刻随机抽一支盖掉用户选的），让它先播完。
  if (msg.autoDance !== undefined && msg.autoDance && !currentMotionAction && !dancingNow) danceTimer = 0;
  // ---- 画质（低/中/高 → 像素比）----
  if (msg.quality !== undefined) { lastOpts.quality = msg.quality; applyQuality(); }
  // ---- 互动触发（是否唤起 AI 回复）----
  for (const k of ['pokeTriggersAi', 'greetTriggersAi', 'patTriggersAi', 'interactionCooldown'])
    if (msg[k] !== undefined) lastOpts[k] = msg[k];
});

// ================= ★★ 受验证的自动轴向检测（第 4 项：把"换模型零配置"做对）=================
// 用户原话："各模型作者都不同，骨骼的命名不同、方向不同、轴不同，有没有什么能够自动修正的方法一步到位？"
// 完全自动做不到（作者约定推不出来），但**能自证的部分可以自动**：
//    抬臂 +60° ⇒ 手应当**向上**；前摆 +60° ⇒ 脚应当**向前** —— 这是几何本身，与作者无关。
//  量出来是反的 ⇒ 把这一族标成"需反转"（**按模型存档**）；量不出或两侧矛盾 ⇒ **不表态**，保持人工。
// 与已被停用那套"自动修正"的四个根本区别（也是它翻车的原因）：
//   ① 只在**能自证**的族上翻（不是靠猜）；② 量不出就不动；③ **只作用于微调值**（scope 仍走 offset，
//   **绝不动基础姿势** —— 上次"误改基础姿势"就是这么坏的）；④ 结论按模型存，换模型各自量、互不串。
const AXIS_AUTO_PROBES = [
  { ch: 'lArmUp', fam: 'arm', want: 'up', human: '左臂抬(手应往上)' },
  { ch: 'rArmUp', fam: 'arm', want: 'up', human: '右臂抬(手应往上)' },
  { ch: 'lLegFwd', fam: 'leg', want: 'fwd', human: '左腿前摆(脚应往前)' },
  { ch: 'rLegFwd', fam: 'leg', want: 'fwd', human: '右腿前摆(脚应往前)' },
];
function autoAxisProbe(silent) {
  const rig = window.EmbodiedRig;
  if (!rig || !vrm || !vrm.humanoid) return null;
  const scaleRef = Math.max(1e-4, rig.hipToHead || 0.5);
  const TH = scaleRef * 0.02;                     // 判据阈值 = 身高 2%（低于它 ⇒ 这一侧不表态）
  const up = new THREE.Vector3(rig.up[0], rig.up[1], rig.up[2]).normalize();
  const fwd = new THREE.Vector3(rig.fwd[0], rig.fwd[1], rig.fwd[2]).normalize();
  const res = {};
  for (const p of AXIS_AUTO_PROBES) {
    let r = stProbeChannel(p.ch, 60);
    // 边缘项重测一次（首测可能撞上"模型刚加载完"的状态残留，抖动不该被当成结论）
    if (r && !r.err && (!r.dv || Math.abs(r.dv[0]) + Math.abs(r.dv[1]) + Math.abs(r.dv[2]) < TH)) r = stProbeChannel(p.ch, 60);
    const e = res[p.fam] = res[p.fam] || { flip: null, detail: [] };
    if (!r || r.err || !r.dv) { e.detail.push(p.human + '=量不出(' + ((r && r.err) || '无返回') + ')'); continue; }
    const proj = (p.want === 'up')
      ? (r.dv[0] * up.x + r.dv[1] * up.y + r.dv[2] * up.z)
      : (r.dv[0] * fwd.x + r.dv[1] * fwd.y + r.dv[2] * fwd.z);
    e.detail.push(p.human + ' Δ=' + proj.toFixed(3));
    if (Math.abs(proj) < TH) continue;                                  // 量不出 ⇒ 不表态
    const need = (proj < 0);
    e.flip = (e.flip === null) ? need : (e.flip === need ? need : null); // 左右矛盾 ⇒ 不表态
  }
  const out = [];
  for (const fam of Object.keys(res)) {
    const e = res[fam];
    const cur = poseFamilyMode(fam);
    if (e.flip === null) {
      out.push(fam + '=量不出/矛盾 ⇒ 保持人工「' + cur + '」（' + e.detail.join('、') + '）');
      continue;
    }
    try { rigSet('famAuto', fam, e.flip ? 'flip' : 'ok'); } catch (er) { }   // ★ 结论按模型存档
    out.push(fam + '=' + (e.flip ? '**需反转**' : '正常')
      + (cur === 'auto' ? '（已按结论生效）' : ('（你手动选了「' + cur + '」⇒ 以你为准）'))
      + '｜' + e.detail.join('、'));
  }
  if (!silent) postLog('info', '轴向自证：' + out.join('　·　'));
  return { res: res, text: out.join('　·　') };
}
function applyAutoAxisVerdict(silent) {
  const r = autoAxisProbe(silent);
  try { refreshPoseTargets(); } catch (e) { }     // 结论立刻作用到微调值
  return r;
}
window.petAxisSelfCheck = function () { return applyAutoAxisVerdict(false); };

// ================= ★★ 造型存档「自动恢复」（重载插件后不必打开面板） =================
// 用户实测（2026-10-14）："还得打开设置面板才加载的姿势；重载插件完是初始直立姿势。"
// 原因：造型面板把"上次发出去的 spec（payload）"存在**按模型**的 rigProfile 里，但只有**打开面板**
//   时才会读它并重发（面板内的续持定时器）⇒ 不打开就一直是直立。这里在模型加载后**主动**恢复一次。
// 安全边界：①草稿全 0（用户清空过）⇒ 不动作；②正在播动作/跳舞 ⇒ 不抢骨骼；③没有 spec ⇒ 只提示；
//   ④只发一次，之后仍由面板的续持接管。
function resumeStoredPose(tag) {
  try {
    if (!window.embodiedPoseOnce) return false;
    const d = rigGet('draft', 'last', null);
    const payload = rigGet('draft', 'payload', null);
    // ★ v11.1：把"这份草稿存于多久之前 + 从哪个模型键读的"写进日志。
    //   以后"加载了很老的数值"一眼就能判定：①日志说存于很久以前 ⇒ 是**没写进去**（请看 persistDraft 的落盘时机）；
    //   ②日志说存于刚不久、可你看到的是旧值 ⇒ 是**读到了另一个键的旧档**（模型键漂移，我再上"跨键取最新"）。
    try {
      const ageS = (d && d.t) ? Math.round((Date.now() - d.t) / 1000) : -1;
      postLog('info', '造型存档：读到草稿'
        + (ageS >= 0
          ? ('（存于 ' + (ageS > 3600 ? ((ageS / 3600).toFixed(1) + ' 小时') : (ageS > 60 ? (Math.round(ageS / 60) + ' 分钟') : (ageS + ' 秒'))) + '前）')
          : '（旧格式，无时间戳）')
        + '｜模型键 ' + rigModelKey()
        + '｜通道 ' + Object.keys((d && d.body) || {}).filter(k => Math.abs(+((d.body || {})[k]) || 0) > 0.5).length
        + ' 项' + (payload ? '｜有 spec' : '｜无 spec'));
    } catch (e) { }
    const body = (d && d.body && typeof d.body === 'object') ? d.body : {};
    const nCh = Object.keys(body).filter(k => Math.abs(+body[k] || 0) > 0.5).length;
    const fg = (d && d.fingers) || {};
    const fl = fg.l || {}, fr = fg.r || {};
    const nFin = ['thumbBase', 'thumbTip', 'thumbSide', 'thumbRoll', 'index', 'middle', 'ring', 'little', 'spread']
      .filter(k => Math.abs(+fl[k] || 0) > 0.5 || Math.abs(+fr[k] || 0) > 0.5).length;
    const nAuto = ['turn', 'crouch', 'kneel', 'rootY'].filter(k => !!(d && +d[k])).length;
    if (!nCh && !nFin && !nAuto) {
      // ★ 顺手把**残留的旧 spec 清掉**：清空动作以前会把上一次的 payload 留在存档里，
      //   任何"重发存档 spec"的路径都可能把它复活（这就是"旧姿势又回来"的祸根）。
      try { if (payload) { rigSet('draft', 'payload', null); postLog('info', '造型存档：草稿为空 ⇒ 保持直立；已顺手清掉残留的旧 spec'); } else postLog('info', '造型存档：草稿为空 ⇒ 保持直立'); } catch (e) { }
      return false;
    }
    if (!payload) {
      // ★★ 旧存档只有数值、没有 spec（用户日志 2026-10-14 15:30:38 实证：
      //   "有数值但**没有可重发的 spec**（旧存档）⇒ 打开一次造型面板即可补上"）
      //   ⇒ 不必再让人去开面板：**现场用数值重建一份 spec**（形状与面板 sendPoseNow 完全一致），
      //     恢复后顺手把 spec 存回去，下次直接命中。
      try {
        const fsum = (o) => ['thumbBase', 'thumbTip', 'thumbSide', 'thumbRoll', 'index', 'middle', 'ring', 'little', 'spread']
          .reduce((s, k) => s + Math.abs(+o[k] || 0), 0);
        const fingers = {};
        if (fsum(fl) > 0.5) fingers.l = Object.assign({ curl: 0 }, fl);
        if (fsum(fr) > 0.5) fingers.r = Object.assign({ curl: 0 }, fr);
        const pose = {};
        for (const k in body) pose[k] = +body[k] || 0;
        const steps = [{ pose: pose, dur: 0.15, ease: 'linear' }, { pose: pose, dur: 40, ease: 'linear' }];
        const spec = JSON.stringify({
          rootY: +(d.rootY || 0), crouch: +(d.crouch || 0), kneel: +(d.kneel || 0), turn: +(d.turn || 0),
          start: pose, steps: steps, fingers: fingers,
        });
        window.embodiedPoseOnce(spec, { autoKeep: true });   // ★ v11.41：存档恢复 ≠ 用户改造型 ⇒ 不掐生成动作
        try { rigSet('draft', 'payload', spec); } catch (e) { }
        postLog('info', '造型存档：旧存档缺 spec ⇒ 已按数值**现场重建并恢复**（通道 ' + nCh + ' 项'
          + (nFin ? ('｜手指 ' + nFin + ' 项') : '') + (nAuto ? ('｜蹲跪转身下沉 ' + nAuto + ' 项') : '') + '）');
        // ★ v11.9：把"到底是哪几项、值多少"也打出来 —— 这段重建会**立刻播一段 40 秒的"保持"动作**
        //   （见上面 steps[1].dur=40，日志里就是 `BodyAct 已合成：811 帧 @20fps（steps 2）`）。
        //   用户报"看着想跳结果像在空中上下浮动"，很大概率看的就是这段（不是 AI 的动作）——
        //   有了这行明细就能一眼看出"是哪个通道/根位移在撑着这个姿势"。
        try {
          const detail = Object.keys(body).filter(k => Math.abs(+body[k]) > 0.01)
            .map(k => k + '=' + (+body[k]).toFixed(2)).join('、');
          postLog('info', '造型明细：' + (detail || '（通道全 0）')
            + '｜rootY=' + (+(d.rootY || 0)).toFixed(2) + ' crouch=' + (+(d.crouch || 0)).toFixed(2)
            + ' kneel=' + (+(d.kneel || 0)).toFixed(2) + ' turn=' + (+(d.turn || 0)).toFixed(2)
            + '｜随后自动播 ' + steps[1].dur + 's「保持」（日志里那条 811 帧的就是它，不是 AI 做的动作）');
        } catch (e) { }
        return true;
      } catch (e) {
        postLog('warn', '造型存档：重建 spec 失败：' + ((e && e.message) || e));
        return false;
      }
    }
    try { if (currentMotionAction) { postLog('info', '造型存档：正在播动作 ⇒ 不自动恢复（避免抢骨骼）'); return false; } } catch (e) { }
    try { if (dancingNow || (embodiedQueue && embodiedQueue.length && !embodiedQueueIsHold)) { postLog('info', '造型存档：正在跳舞/播动作 ⇒ 跳过自动恢复'); return false; } } catch (e) { }
    // ★ v11.41：AI 生成动作在播时同样**不自动恢复** —— 否则那条 40s 保持剪辑会和生成层抢骨骼，
    //   观感就是"AI 的舞蹈播到一半被掰回去放不全"。
    try { if (typeof ardyActive !== 'undefined' && ardyActive) { postLog('info', '造型存档：AI 动作在播 ⇒ 跳过自动恢复'); return false; } } catch (e) { }
    window.embodiedPoseOnce(payload, { autoKeep: true });   // ★ v11.41：自动恢复 ≠ 用户改造型 ⇒ 不掐生成动作
    postLog('info', '造型存档：已自动恢复上次摆好的姿势（通道 ' + nCh + ' 项'
      + (nFin ? ('｜手指 ' + nFin + ' 项') : '') + (nAuto ? ('｜蹲跪转身下沉 ' + nAuto + ' 项') : '')
      + '）' + (tag ? ('［' + tag + '］') : ''));
    return true;
  } catch (e) { postLog('warn', '造型存档恢复失败：' + ((e && e.message) || e)); return false; }
}
window.petResumePose = resumeStoredPose;

// ================= ★★ 一键全量自检（自动判定，不用肉眼看） =================
// 用户诉求（2026-10-14）："各方面多点自测，有些 bug 不好看出来，一个个测太费劲用肉眼观察。"
// 设计原则（都是被前几轮教训逼出来的）：
//   ① **只做确定性判定**：同一 JS 轮次内「量 → 施加 → 再量 → 还原」(同步探针)、纯函数表驱动、
//      往返比较、集合/数量一致性 —— 不依赖过渡动画、帧率、采样时机（以前"自动修正"翻车全栽在采样上）。
//   ② **只报告，不改任何设置**：探针结束后骨骼/设置**原样还原**；判定只进日志。
//   ③ **通过项不刷屏**：日志只出「一行汇总 + 失败/警告详情」。
//   ④ 每条检查独立 try/catch —— 自检自己最不该"一崩全崩"。
const _st = { pass: 0, fail: 0, skip: 0, warnList: [], failList: [], t0: 0, ran: false, busy: false };
function _stOk(name, cond, detail) {
  if (cond) { _st.pass++; return true; }
  _st.fail++;
  _st.failList.push(name + (detail ? ('：' + detail) : ''));
  return false;
}
function _stWarn(name, detail) { _st.warnList.push(name + (detail ? ('：' + detail) : '')); }
// ---- 同步探针零件 ----
function stSnapBones() {
  const snap = [];
  try {
    for (const n of Object.keys((vrm && vrm.humanoid && vrm.humanoid.humanBones) || {})) {
      const b = vrm.humanoid.getNormalizedBoneNode(n);
      if (b && b.quaternion) snap.push([b, b.quaternion.clone()]);
    }
  } catch (e) { }
  return snap;
}
function stRestoreBones(snap) {
  try {
    for (const it of snap) it[0].quaternion.copy(it[1]);
    if (vrm && vrm.scene) vrm.scene.updateMatrixWorld(true);
  } catch (e) { }
}
function stWorldDir(b) {
  // 骨骼"朝向" = 指向第一个**非网格**子骨（终末骨退回用四元数把 +Z 转出来）
  try {
    const p0 = b.getWorldPosition(new THREE.Vector3());
    const ch = (b.children || []).filter(c => c && c.isObject3D && !c.isMesh && !c.isSkinnedMesh)[0];
    if (!ch) return new THREE.Vector3(0, 0, 1).applyQuaternion(b.getWorldQuaternion(new THREE.Quaternion())).normalize();
    const d = ch.getWorldPosition(new THREE.Vector3()).sub(p0);
    return d.lengthSq() > 1e-12 ? d.normalize() : new THREE.Vector3(0, 0, 1).applyQuaternion(b.getWorldQuaternion(new THREE.Quaternion())).normalize();
  } catch (e) { return new THREE.Vector3(0, 0, 1); }
}
function stBonePos(name) {
  const b = vrm && vrm.humanoid ? vrm.humanoid.getNormalizedBoneNode(name) : null;
  return b ? b.getWorldPosition(new THREE.Vector3()) : null;
}
/** compose 的返回是**对象** `{fps, frames, rootY, turn}`（**不是数组**！embodied-compose.js:755）——
 *  第一版探针按数组取 ⇒ 取不到帧 ⇒ ⑥"每个通道都跳过"变成**空心通过**（假绿）、⑦ 全报"没出帧"。
 *  这里统一成一个取帧助手，兼容两种形状。 */
function stComposeFrames(spec) {
  const C = window.EmbodiedCompose, rig = window.EmbodiedRig;
  if (!C || typeof C.compose !== 'function' || !rig) return null;
  let r = null;
  try { r = C.compose(spec, rig); } catch (e) { return null; }
  if (!r) return null;
  const arr = Array.isArray(r) ? r : (Array.isArray(r.frames) ? r.frames : null);
  return (arr && arr.length) ? arr : null;
}
/** 全部 humanoid 骨的"位置+朝向"指纹：用于"到底有没有动"的**整体**判定。
 *  为什么不能用单个末端骨：纯旋转通道（headRoll）末端位置几乎不动、躯干通道动的是骨盆以上 ⇒
 *  第一版只看一个末端骨 ⇒ 26 个通道被误判成"死通道"（日志 2026-10-14 15:31:01 实证）。 */
function stMeasureAll() {
  const out = [];
  try {
    for (const n of Object.keys((vrm.humanoid && vrm.humanoid.humanBones) || {})) {
      const b = vrm.humanoid.getNormalizedBoneNode(n);
      if (!b) continue;
      const p = b.getWorldPosition(new THREE.Vector3());
      out.push(p.x, p.y, p.z, b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w);
    }
  } catch (e) { }
  return out;
}
function stMaxDiff(a, b) {
  if (!a || !b || !a.length || a.length !== b.length) return -1;
  let m = 0;
  for (let i = 0; i < a.length; i++) { const d = Math.abs(a[i] - b[i]); if (d > m) m = d; }
  return m;
}
/** 单通道探针：compose 一帧 → dt=0 瞬时施加 → 量末端位移/骨朝向变化 → **还原** */
function stProbeChannel(ch, deg) {
  if (!vrm || !vrm.humanoid) return { err: '模型未加载' };
  const pose = {}; pose[ch] = deg;
  const arr = stComposeFrames({ steps: [{ pose: pose, dur: 0.2, ease: 'linear' }] });
  const fr = arr ? arr[arr.length - 1] : null;
  if (!fr || !fr.joints) return { err: 'compose 没出帧' };
  const endName = /^(l|r)/.test(ch)
    ? ((/Leg|Knee|Ankle|Toes/.test(ch)) ? (ch[0] === 'l' ? 'leftFoot' : 'rightFoot') : (ch[0] === 'l' ? 'leftHand' : 'rightHand'))
    : 'head';
  const snap = stSnapBones();
  try { vrm.scene.updateMatrixWorld(true); } catch (e) { }
  const all0 = stMeasureAll();                         // 全骨指纹（"到底有没有动"的判据）
  const eb = vrm.humanoid.getNormalizedBoneNode(endName);
  const p0 = eb ? eb.getWorldPosition(new THREE.Vector3()) : null;
  const d0 = eb ? stWorldDir(eb).clone() : null;
  const p0hip = stBonePos('hips');
  try { embodiedApplyJoints(fr.joints, 0); } catch (e) { }
  try { vrm.scene.updateMatrixWorld(true); } catch (e) { }
  const all1 = stMeasureAll();
  const p1 = eb ? eb.getWorldPosition(new THREE.Vector3()) : null;
  const d1 = eb ? stWorldDir(eb).clone() : null;
  const p1hip = stBonePos('hips');
  stRestoreBones(snap);
  const dirDeg = (d0 && d1) ? (Math.acos(Math.max(-1, Math.min(1, d0.dot(d1)))) * 180 / Math.PI) : 0;
  return {
    end: endName, dirDeg: dirDeg, moved: stMaxDiff(all0, all1),
    disp: (p0 && p1) ? p0.distanceTo(p1) : 0,
    hipDisp: (p0hip && p1hip) ? p0hip.distanceTo(p1hip) : 0,
    // 末端位移**向量**（世界系）：第 4 项"受验证的自动轴向检测"靠它判方向（该往上还是往下）
    dv: (p0 && p1) ? [p1.x - p0.x, p1.y - p0.y, p1.z - p0.z] : null,
  };
}
/** 手指探针：curl/thumbBase/thumbTip 满值 250 → "指尖↔腕"距离应**变小**；并单独报末节骨转了多少度 */
function stProbeFinger(side, key, val) {
  const C = window.EmbodiedCompose, rig = window.EmbodiedRig;
  if (!C || !rig || !vrm || !vrm.humanoid) return { err: 'compose/rig 不可用' };
  // ★ `curl`/`spread` 必须**显式带上 0**：离线性验证过的写法是 `{curl:0, index:250}`；
  //   只给 `{index:250}` 时这条路径上算出来是"没变化"（日志 2026-10-14 15:30:38：`index(Δ0.0000)`）。
  const o = { curl: 0, spread: 0 }; o[key] = val;
  const f = {};
  // ★★ spec 的手指键是 **l / r**（不是 left/right）—— 第一版写错 ⇒ 生成的手指状态被忽略 ⇒
  //   探针全报"缺骨"（**假警报**，日志 2026-10-14 15:07 实证：8 条 ⑦ 全红）。这里定死。
  f[side === 'left' ? 'l' : 'r'] = o;
  // ★ fingers 放在 **spec 顶层**（这是离线性验证过的写法；放 step 里在这条路径上会取不到帧）
  const arr = stComposeFrames({ fingers: f, steps: [{ pose: {}, dur: 0.2, ease: 'linear' }] });
  const fr = arr ? arr[arr.length - 1] : null;
  if (!fr || !fr.joints) return { err: 'compose 没出帧（fingers 键/值不被接受）' };
  const sd = (side === 'left') ? 'left' : 'right';
  const prox = { thumbBase: 'ThumbProximal', thumbTip: 'ThumbDistal', index: 'IndexProximal', middle: 'MiddleProximal', ring: 'RingProximal', little: 'LittleProximal' }[key];
  const tipN = { thumbBase: 'ThumbDistal', thumbTip: 'ThumbDistal', index: 'IndexDistal', middle: 'MiddleDistal', ring: 'RingDistal', little: 'LittleDistal' }[key];
  const midN = { thumbBase: 'ThumbIntermediate', thumbTip: 'ThumbIntermediate', index: 'IndexIntermediate', middle: 'MiddleIntermediate', ring: 'RingIntermediate', little: 'LittleIntermediate' }[key];
  const g = (n) => vrm.humanoid.getNormalizedBoneNode(n);
  const tipB = g(sd + tipN) || g(sd + midN) || g(sd + prox);
  const wristB = g(sd + 'Hand') || g(sd + 'LowerArm');
  if (!tipB || !wristB) return { err: '缺骨（' + sd + tipN + (wristB ? '' : ' / Hand') + '）' };
  const snap = stSnapBones();
  try { vrm.scene.updateMatrixWorld(true); } catch (e) { }
  const w0 = wristB.getWorldPosition(new THREE.Vector3());
  const d0 = tipB.getWorldPosition(new THREE.Vector3()).distanceTo(w0);
  const q0 = tipB.quaternion.clone();
  try { embodiedApplyJoints(fr.joints, 0); } catch (e) { }
  try { vrm.scene.updateMatrixWorld(true); } catch (e) { }
  const d1 = tipB.getWorldPosition(new THREE.Vector3()).distanceTo(wristB.getWorldPosition(new THREE.Vector3()));
  // 末节骨**自己**转了多少度（"指尖弯有没有效果"的直接答案）
  const dot = Math.min(1, Math.abs(q0.x * tipB.quaternion.x + q0.y * tipB.quaternion.y + q0.z * tipB.quaternion.z + q0.w * tipB.quaternion.w));
  const boneDeg = 2 * Math.acos(dot) * 180 / Math.PI;
  stRestoreBones(snap);
  return { d: d1 - d0, boneDeg: boneDeg, tipName: tipB.name, side: side };
}
function nowS_() {
  return (typeof performance !== 'undefined' && performance.now) ? (performance.now() / 1000) : (Date.now() / 1000);
}
// 模型加载后自动自检（默认开；面板里可关）。放在"加载完 2.5 秒"后跑：等姿势/取景/物理都落定。
function stAutoOn() { try { return localStorage.getItem('petSelfTestAuto') !== '0'; } catch (e) { return true; } }
function stScheduleAuto(tag) {
  if (!stAutoOn()) return;
  setTimeout(() => {
    try {
      if (!vrm || !vrm.humanoid) return;
      postLog('info', '自检（自动触发·' + (tag || '加载后') + '）');
      petSelfTest({ auto: true });
    } catch (e) { postLog('warn', '自动自检异常：' + ((e && e.message) || e)); }
  }, 2500);
}
function petSelfTest(opts) {
  opts = opts || {};
  if (!vrm || !vrm.humanoid || !THREE) { postLog('warn', '自检：模型还没加载，先加载模型再试'); return null; }
  _st.pass = 0; _st.fail = 0; _st.skip = 0; _st.warnList = []; _st.failList = []; _st.t0 = nowS_(); _st.busy = true;
  const scaleRef = Math.max(1e-4, (window.EmbodiedRig && window.EmbodiedRig.hipToHead) || 0.5);
  const EPS = scaleRef * 0.01;                     // 可辨阈值 = 身高 1%（低于它一律算"没动"）
  postLog('info', '===== 自检开始（自动判定；探针跑完会原样还原，不改任何设置）=====');

  // ① 骨架完整性
  try {
    const need = ['hips', 'spine', 'chest', 'neck', 'head', 'leftUpperArm', 'rightUpperArm', 'leftLowerArm', 'rightLowerArm',
      'leftHand', 'rightHand', 'leftUpperLeg', 'rightUpperLeg', 'leftLowerLeg', 'rightLowerLeg', 'leftFoot', 'rightFoot'];
    const miss = need.filter(n => !vrm.humanoid.getNormalizedBoneNode(n));
    _stOk(' ① 骨架完整性', miss.length === 0, miss.length ? ('缺 ' + miss.join(',')) : '');
    const nf = Object.keys(fingerAxes || {}).length;
    _stOk(' ① 手指骨轴表', nf >= 26, '只有 ' + nf + ' 根（标准 30，缺的多半是拇指节）');
  } catch (e) { _stOk(' ① 骨架完整性', false, e.message); }

  // ② 渲染在跑
  try {
    const info = renderer && renderer.info && renderer.info.render;
    _stOk(' ② 渲染在跑（有 drawcall）', !!(info && info.calls > 0), info ? ('calls=' + info.calls + ' tris=' + info.triangles) : 'renderer.info 取不到');
  } catch (e) { _stWarn(' ② 渲染在跑', e.message); }

  // ③ 存档往返（rig / pose微调 / 手感）
  try {
    const key = '__selftest', probe = { a: 1, b: [2, 3] };
    rigSet(key, 'x', probe);
    const back = rigGet(key, 'x', null);
    rigSet(key, 'x', undefined);
    _stOk(' ③ 存档往返(rigProfile)', !!(back && back.a === 1 && back.b && back.b[1] === 3), JSON.stringify(back));
  } catch (e) { _stOk(' ③ 存档往返(rigProfile)', false, e.message); }
  try {
    const o = JSON.parse(ardyTuneJson());
    _stOk(' ③ 手感参数序列化', ['hips', 'leg', 'spine', 'neck', 'root', 'smooth', 'fadeOut'].every(k => typeof o[k] === 'number'), JSON.stringify(o));
  } catch (e) { _stOk(' ③ 手感参数序列化', false, e.message); }

  // ④ 部件显隐往返（隐藏 → 全隐 → 恢复：必须逐项复原）
  try {
    const parts = collectModelParts();
    const metaN = Object.keys(_partMeta).length;
    _stOk(' ④ 部件清单与详情一致', metaN === parts.length && parts.length > 0, metaN + ' vs ' + parts.length);
    const noTris = parts.filter(p => !(_partMeta[p] && _partMeta[p].tris > 0));
    if (noTris.length) _stWarn(' ④ 有部件三角面数为 0', noTris.slice(0, 5).join(','));
    const before = (lastOpts.hiddenParts || []).slice();
    applyHiddenParts(parts);                       // 全隐
    let stillVisible = 0;
    modelPartRoot().traverse(o => {
      if (o.isMesh || o.isSkinnedMesh) {
        if (o.userData.partKeys) { if (o.geometry && o.geometry.groups && o.geometry.groups.length) stillVisible++; }
        else if (o.userData.partKey && o.visible) stillVisible++;
      }
    });
    _stOk(' ④ 全隐后应全部不可见', stillVisible === 0, '还剩 ' + stillVisible + ' 件可见');
    applyHiddenParts([]);                          // 全显
    applyHiddenParts(before);                      // 还原
    _stOk(' ④ 还原为原清单', JSON.stringify((lastOpts.hiddenParts || []).slice()) === JSON.stringify(before));
  } catch (e) { _stOk(' ④ 部件显隐往返', false, e.message); }

  // ⑤ 弹簧骨链（数量 + 冻结/解冻双向）
  try {
    const ch = springChains();
    if (!ch.length) {
      _stWarn(' ⑤ 弹簧骨链', springDiag());
    } else {
      _stOk(' ⑤ 弹簧骨链可取', ch.length > 0, ch.length + ' 条；最长 ' + ch[0].name + '(' + ch[0].joints.length + ' 节)');
      const saved = rigGet('spring', 'frozen', null);
      const target = ch[0];
      setSpringFrozen(target.name, true);
      const zeroed = target.joints.every(j => j.settings && j.settings.stiffness === 0);
      setSpringFrozen(target.name, false);
      const restored = target.joints.every(j => {
        const b = _springJointBase.get(j.settings);
        return b && Math.abs(j.settings.stiffness - b.stiffness * (lastOpts.scale || 1)) < 1e-6;
      });
      rigSet('spring', 'frozen', saved || []);     // 还原用户设置
      applySpringChains(true);
      _stOk(' ⑤ 冻结生效（stiffness→0）', zeroed);
      _stOk(' ⑤ 解冻按作者原值还原', restored);
    }
  } catch (e) { _stOk(' ⑤ 弹簧骨链', false, e.message); }

  // ⑥ 全通道"有没有效果"（compose 真值；死通道 = "看着能调、人不动"那一类）
  try {
    let movedN = 0;
    const dead = [], failed = [];
    for (const c of ARDY_CH_LIST_OR_POSE()) {
      const r = stProbeChannel(c, 60);
      // ★★ 探针**失败**绝不能算"跳过"：第一版就是"取不到帧 ⇒ continue"⇒ ⑥ 变成**空心通过**（假绿）。
      if (!r || r.err) { failed.push(c + (r && r.err ? ('=' + r.err) : '=无返回')); continue; }
      // 有效 = **任意一根** humanoid 骨的位置/朝向变了（全骨指纹）或末端有明显位移/转向。
      // ★ 用全骨指纹才能覆盖"纯旋转""只动躯干"这类通道（只量末端骨会把它们误判成死通道）。
      if (r.moved > 1e-4 || r.disp > EPS || r.hipDisp > EPS || r.dirDeg >= 3) movedN++;
      else dead.push(c + '(全骨最大变化 ' + (r.moved < 0 ? '?' : r.moved.toExponential(1))
        + ' 位移' + r.disp.toFixed(3) + '/' + r.hipDisp.toFixed(3) + ' 朝向' + r.dirDeg.toFixed(1) + '°)');
    }
    _stOk(' ⑥ 通道有效性（60° 应带得动末端或转动末端骨）',
      failed.length === 0 && dead.length === 0 && movedN >= 8,
      (failed.length ? ('探针失败 ' + failed.length + ' 个：' + failed.slice(0, 3).join(',') + '｜') : '')
      + (dead.length ? ('死通道 ' + dead.length + ' 个：' + dead.slice(0, 6).join(',') + '｜') : '')
      + '有效 ' + movedN + ' 个');
  } catch (e) { _stOk(' ⑥ 通道有效性', false, e.message); }

  // ⑦ 手指：卷 250 应"指尖↔腕"变近；拇指指尖弯应真转末节
  try {
    for (const side of ['left', 'right']) {
      const bad = [];
      for (const k of ['index', 'middle', 'ring', 'little']) {
        let r = stProbeFinger(side, k, 250);
        // ★ 边缘项**重测一次**再判：日志 2026-10-14 15:40:54 出现过"同一项第一次 Δ0.0000、下一次全绿"
        //   （模型刚加载完/手指轴表刚建好时的状态残留）⇒ 单次失败不足以定罪，重测能消掉这类抖动。
        if (r && !r.err && !(r.d < -EPS)) r = stProbeFinger(side, k, 250);
        if (!r || r.err) { bad.push(k + '=' + ((r && r.err) || '无返回')); continue; }
        if (!(r.d < -EPS)) bad.push(k + '(Δ' + r.d.toFixed(4) + ')');
      }
      _stOk(' ⑦ 四指卷向（' + (side === 'left' ? '左' : '右') + '手）', bad.length === 0, bad.join(','));
    }
    for (const side of ['left', 'right']) {
      const tb = stProbeFinger(side, 'thumbBase', 250);
      const tt = stProbeFinger(side, 'thumbTip', 250);
      const sideTxt = (side === 'left') ? '左' : '右';
      _stOk(' ⑦ 拇指根节弯（' + sideTxt + '）', !!(tb && !tb.err && tb.d < -EPS),
        tb ? (tb.err ? ('✗' + tb.err) : ('Δ' + tb.d.toFixed(4))) : '无返回');
      _stOk(' ⑦ 拇指指尖弯（' + sideTxt + '）', !!(tt && !tt.err && tt.boneDeg >= 8),
        tt ? (tt.err ? ('✗' + tt.err) : ('末节骨(' + tt.tipName + ')转 ' + tt.boneDeg.toFixed(0) + '°')) : '无返回');
    }
  } catch (e) { _stOk(' ⑦ 手指自测', false, e.message); }

  // ⑧ 面板数值 ↔ 数据一致性（面板开着才测；这正是"滑条显示 0 但数据其实有值"那类 bug）
  try {
    const b = window.__stBones;
    if (b && b.map) {
      let mism = [];
      for (const k in b.map) {
        const sp = k.split('.');
        const want = +(poseOverrides[b.pose] && poseOverrides[b.pose][sp[0]] && poseOverrides[b.pose][sp[0]][sp[1]] || 0);
        const got = +b.map[k].value;
        // ★ 容差 = 该滑条自己的 step：浏览器会**按 step 吸附**（step=2、min=-35 时，数据 0 会显示成 1）
        //   —— 第一版没留容差 ⇒ 报了一堆"面板1≠数据0"的**假警报**（日志 2026-10-14 15:08 实证）。
        const tol = Math.max(1e-6, Math.abs(+b.map[k].step || 0));
        if (Math.abs(want - got) > tol) mism.push(k + ' 面板' + got + '≠数据' + want);
      }
      _stOk(' ⑧ 逐轴微调 面板↔数据', mism.length === 0, mism.slice(0, 4).join('；'));
    } else _st.skip++;      // 面板没开 ⇒ 静默跳过（自动自检时不该刷警告）
    const p = window.__stPose;
    if (p && p.sliders && p.draft) {
      let mism2 = [];
      for (const ch in p.sliders) {
        const want = +p.draft[ch] || 0, got = +p.sliders[ch].value || 0;
        const tol2 = Math.max(1e-6, Math.abs(+p.sliders[ch].step || 0));   // 同上：留 step 容差
        if (Math.abs(want - got) > tol2) mism2.push(ch + ' 面板' + got + '≠数据' + want);
      }
      _stOk(' ⑧ 造型通道 面板↔数据', mism2.length === 0, mism2.slice(0, 4).join('；'));
    } else _st.skip++;
  } catch (e) { _stOk(' ⑧ 面板↔数据', false, e.message); }

  // ⑨ 验收逻辑（ardy 纯函数表驱动，8 例含反例）
  try {
    if (window.ardySelfTest) {
      const r = window.ardySelfTest();
      _stOk(' ⑨ 生成式验收逻辑(8 例含反例)', !!(r && r.fail === 0), r ? (r.pass + ' 通过 / ' + r.fail + ' 失败' + (r.note ? ('；' + r.note) : '')) : '无返回');
    } else _stWarn(' ⑨ 生成式验收逻辑', 'ardy-client.js 未加载');
  } catch (e) { _stOk(' ⑨ 生成式验收逻辑', false, e.message); }

  // ⑩ 取景：人物包围盒是否在画面内（切边只警告，因为"取景余量"是用户可调项）
  try {
    const box = new THREE.Box3().setFromObject(vrm.scene);
    const pts = [[box.min.x, box.min.y, box.min.z], [box.max.x, box.max.y, box.max.z]];
    const W = window.innerWidth, H = window.innerHeight;
    const out = pts.some(p => {
      const v = new THREE.Vector3(p[0], p[1], p[2]).project(camera);
      return Math.abs(v.x) > 1.02 || Math.abs(v.y) > 1.02;
    });
    if (out) _stWarn(' ⑩ 取景切边', '包围盒有角点出画（想收一点就把「取景余量」调大）');
    else _st.pass++;
  } catch (e) { _stWarn(' ⑩ 取景', e.message); }

  // ⑪ 脚部 IK 解算精度（第 5 项）：把脚踝**故意打歪**，再让 IK 拉回锚点，误差应 < 1% 身高。
  //    这条是纯几何、确定性 ⇒ 能一眼判定 IK 数学对不对（不靠看画面）。
  try {
    const snapIK = stSnapBones();
    const saveW = ardyFootIK, saveL = footAnchor.left;
    ardyFootIK = 1; footAnchor.left = null;
    const B = _fIKBones('left');
    let okIK = false, txt = '缺骨（leftUpperLeg/LowerLeg/Foot）';
    if (B.up && B.lo && B.ft) {
      vrm.scene.updateMatrixWorld(true);
      const a0 = B.ft.getWorldPosition(new THREE.Vector3());
      footAnchor.left = a0.clone();                       // 锚点 = 当前脚踝（可达目标 ⇒ 应能精确回到）
      B.up.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.35));  // 先打歪
      vrm.scene.updateMatrixWorld(true);
      try { footIKApplyLeg('left', 1, 1 / 60, true); } catch (e) { }
      vrm.scene.updateMatrixWorld(true);
      const err = B.ft.getWorldPosition(new THREE.Vector3()).distanceTo(a0);
      okIK = err < scaleRef * 0.01;
      txt = '回到锚点误差 ' + err.toFixed(4) + '（阈值 ' + (scaleRef * 0.01).toFixed(4) + '）';
    }
    ardyFootIK = saveW; footAnchor.left = saveL || null; footAnchor.right = null;
    stRestoreBones(snapIK);
    _stOk(' ⑪ 脚部 IK 解算精度', okIK, txt);
  } catch (e) { _stOk(' ⑪ 脚部 IK 解算精度', false, e.message); }

  // ⑫ 鼠标触摸（弹簧骨碰撞球）：能被挂上 + 能跟随光标（确定性：给一个假光标，看球位置是否真的动）
  try {
    const info = window.petTouchInfo ? window.petTouchInfo() : null;
    if (!info) _stWarn(' ⑫ 鼠标触摸', 'petTouchInfo 不可用');
    // ★ 2026-10-14 第三轮：不再因"版本没导出碰撞体类"降级 —— 物理球已改为**自造**（鸭子类型，
    //   直接对接求解器的 colliderGroups/s.calculateCollision/colliderMatrix），与版本导出无关。
    //   真正的判据只有一条：挂得上 + 跟得上 + **物理实测推得动**（后者写进结论，见下面 _stOk）。
    else {
      const saveOn = touchPhysicsOn, saveFire = touchLastFire, saveLoc = cursorLocal;
      touchPhysicsOn = true;
      const ok1 = !!ensureTouchCollider();
      let ok2 = false, moved = 0, partTxt = '';
      if (ok1) {
        // ★ 造一个"真的打在人物身上"的假光标：拿**模型自己的骨头**投影到屏幕（比写死坐标可靠 ——
        //   写死坐标会遇到"那一点根本没打到模型"，自检就永远失败）。顺便验**部位识别**。
        let px = -1, py = -1;
        try {
          if (vrm && vrm.humanoid) {
            const bn = vrm.humanoid.getNormalizedBoneNode('head') || vrm.humanoid.getNormalizedBoneNode('chest');
            if (bn) {
              vrm.scene.updateMatrixWorld(true);
              const wp = bn.getWorldPosition(new THREE.Vector3()).project(camera);
              px = (wp.x * 0.5 + 0.5) * window.innerWidth;
              py = (-wp.y * 0.5 + 0.5) * window.innerHeight;
              const hh = touchHitBone(px, py, true);      // ★ 骨级判定（射线 244.9ms/次，自检也不该卡）
              partTxt = hh ? ('｜识别部位「' + hh.part + '」（骨 ' + (hh.bone || '?') + '）') : '｜该点未命中表面';
            }
          }
        } catch (e) { }
        const before = touchRig ? touchRig.position.clone() : touchGroup.position.clone();
        cursorLocal = { x: px, y: py, t: (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now() };
        touchLastFire = nowS_() + 60;                 // 自检期间**不许**真发 pet_touch（否则会去打扰 AI）
        try { touchTick(); } catch (e) { }
        const nowP = touchRig ? touchRig.position : touchGroup.position;
        moved = nowP.distanceTo(before);
        ok2 = moved > 1e-4;
      }
      cursorLocal = saveLoc; touchLastFire = saveFire; touchPhysicsOn = saveOn;
      if (!saveOn && touchGroup) touchDropCollider('自检还原');
      _stOk(' ⑫ 鼠标触摸（挂载 + 跟随光标 + 部位识别 + 物理推进实测）', ok1 && ok2,
        ok1 ? ('跟随 Δ=' + moved.toFixed(3) + partTxt
          + (touchPokeFallback
            ? '｜⚠ 物理推进实测**没通过**（tail 推不出去）⇒ 已启用"直接拨骨"保底（会有"抽一下"的手感）'
            : '｜物理推进实测通过（头发/裙摆是真的被球推开的）'))
          : '挂载失败（看上面 warn 行）');
    }
  } catch (e) { _stOk(' ⑫ 鼠标触摸', false, e.message); }

  const ms = Math.round((nowS_() - _st.t0) * 1000);
  const head = '自检：通过 ' + _st.pass + '｜失败 ' + _st.fail + '｜警告 ' + _st.warnList.length
    + (_st.skip ? ('｜跳过 ' + _st.skip) : '') + '（' + ms + 'ms）';
  if (_st.fail || _st.warnList.length) {
    postLog(_st.fail ? 'warn' : 'info', head);
    for (const f of _st.failList) postLog('warn', '  ✗ ' + f);
    for (const w of _st.warnList) postLog('info', '  ⚠ ' + w);
  } else {
    postLog('info', head + ' —— 全部通过');
  }
  _st.ran = true; _st.busy = false;
  return { pass: _st.pass, fail: _st.fail, warns: _st.warnList.slice(), fails: _st.failList.slice(), ms: ms };
}
window.petSelfTest = petSelfTest;
// 通道清单（自检用）：优先用造型面板的真实通道表，拿不到就退回逐轴微调的表
function ARDY_CH_LIST_OR_POSE() {
  try {
    if (window.EmbodiedCompose && window.EmbodiedCompose.CHANNELS) {
      const c = window.EmbodiedCompose.CHANNELS;
      if (Array.isArray(c) && c.length) return c.slice();
      if (c && typeof c === 'object') return Object.keys(c);
    }
  } catch (e) { }
  return ['lArmUp', 'rArmUp', 'lArmFwd', 'rArmFwd', 'lElbow', 'rElbow', 'lLegFwd', 'rLegFwd', 'lKnee', 'rKnee',
    'spinePitch', 'chestPitch', 'headPitch', 'headYaw', 'hipsYaw'];
}

// ================= 设置面板（Mate-Engine 风格：分区、滑条/开关/下拉/取色，全部实时生效并保存） =================
messageBus.on('settings_open', () => {
  // ★ 顺序很重要：**先显示、再构建**。构建万一抛错，面板也已经在屏幕上（外加一行 error），
  //   不会退化成"点了完全没反应"这种最难查的症状（"动作/表情/模型点了没反应"就是这么来的）。
  settingsEl.classList.remove('hidden');
  settingsOpen = true;
  // 每次打开都重建：动作/表情清单会随模型与 motions 目录变化，只构建一次会显示旧内容
  try { buildSettingsUI(); } catch (e) { postLog('error', '设置面板构建失败：' + ((e && e.message) || e)); }
  refreshNowPlayingOverlay();   // 设置面板打开时显示“正在跳”浮层
  // 面板压在宠物上方时也要能点：把面板矩形上报给 C#，穿透判定要用；
  // 同时重新取景把宠物平移到面板另一侧空闲区域，避免挡住角色。
  afterPanelOpen();
});
const settingsEl = document.getElementById('settings-panel');
let settingsOpen = false;   // 设置面板是否展开：展开时相机把宠物让到面板另一侧
let scaleSliderEl = null;   // “大小”滑条，供滚轮缩放时同步显示

// ================= 模型部件浮层（webview，和设置面板同款：右侧可拖拽 + 打开时 reframe 让位，不挡人物） =================
// 原来“模型部件”是原生右键子菜单，部件多时菜单很高、直接盖在人物上，toggle 时看不到效果；
// 改成 webview 浮层，打开即把人物让到左侧空闲区（reframe），可拖到任意位置、可反复开关对照。
const modelPartsEl = document.createElement('div');
modelPartsEl.id = 'model-parts-panel';
modelPartsEl.className = 'settings-panel hidden';   // 直接复用设置面板样式（右侧 260px、可拖拽、半透明）
document.body.appendChild(modelPartsEl);
let modelPartsOpen = false;
messageBus.on('model_parts_open', () => {
  modelPartsEl.classList.remove('hidden');   // 先显示、再构建（原因见 settings_open 处说明）
  modelPartsOpen = true;
  try { buildModelPartsUI(); } catch (e) { postLog('error', '模型部件面板构建失败：' + ((e && e.message) || e)); }
  afterPanelOpen();   // 打开后让位，避免挡住角色
});

// ================= 「动作」/「表情」各自一个浮层（和「模型部件」同款，不合并、不新增结构） =================
// 动机：这两个列表原本只能走**宿主渲染的右键菜单**，而菜单弹在右键位置（通常就是人物身上）
// ⇒ 一边挑动作一边看不到人跳成什么样。这里各自做成 webview 浮层，入口仍是菜单里原来的两项。
// ★ 教训：新面板必须**登记进 reportUiBounds()**（鼠标穿透的"可点区域"名单，见文件下方）。
//   漏登记过一次 ⇒ 开着鼠标穿透时点击直接穿透到桌面 ⇒ 面板上的按钮和 × 都点不到（"关不掉"）。
const motFloatEl = document.createElement('div');
motFloatEl.id = 'motions-panel'; motFloatEl.className = 'settings-panel hidden';
document.body.appendChild(motFloatEl);
let motFloatOpen = false;
const expFloatEl = document.createElement('div');
expFloatEl.id = 'expressions-panel'; expFloatEl.className = 'settings-panel hidden';
document.body.appendChild(expFloatEl);
let expFloatOpen = false;

// ---------------------------------------------------------------------------
// ★ 面板"打开过一次之后就打不开"的真凶（实测）：
//   所有面板都是 position:fixed，拖动时把 left/top **写死**（见 makeDraggable），之后再没人纠正它。
//   而画布会自动加宽/收窄（panel_space 临时加宽画布、用户拉窗口、还原尺寸），窗口一旦**变窄**，
//   面板的 left 就落到窗口之外 ⇒ 内容仍在画、但**看不见**，看起来就是"打不开"。
//   （最糟的情况：整个面板在窗口右侧外，连标题栏都抓不到 ⇒ 再也拖不回来。）
//   对策：每次打开面板、以及窗口尺寸变化时，把每个可见面板**夹回窗口内**（至少留 56px 可抓）。
function clampPanelIntoView(panel) {
  if (!panel || panel.classList.contains('hidden')) return;
  const r = panel.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return;    // 还没布局（display:none）⇒ 量不到，别乱设坐标
  const W = window.innerWidth, H = window.innerHeight;
  const KEEP = 56;                             // 至少这么多像素留在窗口内 ⇒ 标题栏抓得到、拖得回来
  const l = Math.min(Math.max(r.left, KEEP - r.width), W - KEEP);
  const t = Math.min(Math.max(r.top, KEEP - r.height), H - KEEP);
  if (Math.abs(l - r.left) > 0.5 || Math.abs(t - r.top) > 0.5) {
    panel.style.left = l + 'px'; panel.style.top = t + 'px';
    panel.style.right = 'auto'; panel.style.bottom = 'auto';
    try {
      postLog('info', '面板越界已夹回窗口内：' + Math.round(r.left) + ',' + Math.round(r.top)
        + ' → ' + Math.round(l) + ',' + Math.round(t) + '（窗 ' + W + '×' + H + '）');
    } catch (e) { }
  }
}
function clampAllPanelsIntoView() {
  for (const p of [settingsEl, modelPartsEl, motFloatEl, expFloatEl, modelFloatEl]) {
    try { clampPanelIntoView(p); } catch (e) { }
  }
}
// 面板打开后的统一收尾：夹回窗口内 → 重新取景（让位）→ 上报可点区域。
// ★ 顺带打一行**永远可见**的确认（不算探针、不走静默）：它 + 宿主那行「打开浮层：xxx」配合，
//   能把"打不开"一刀切成三种，不必再猜：
//     · 宿主有行、这里没有 ⇒ 消息没到 webview（桥/前端异常）
//     · 两边都有行        ⇒ 面板**确实显示出来了**（那"看不到"就是位置或遮挡问题）
//     · 宿主没有行        ⇒ 那次点击根本没发生（右键菜单没弹出 / 被鼠标穿透吞掉）
function afterPanelOpen() {
  // ★ 记下"面板刚打开"的时刻：它之后紧接着的取景会给宿主发"加宽画布"请求。
  //   加宽落地前的几帧里先**不缩人物**（见 fitCamera 的 widenGrace），消掉"先缩一下再长回来"的闪动。
  panelWidenReqT = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  setTimeout(() => {
    clampAllPanelsIntoView();
    try {
      const vis = [];
      if (typeof settingsEl !== 'undefined' && settingsEl && !settingsEl.classList.contains('hidden')) vis.push('设置面板');
      if (typeof modelPartsEl !== 'undefined' && modelPartsEl && !modelPartsEl.classList.contains('hidden')) vis.push('模型部件');
      if (typeof motFloatEl !== 'undefined' && motFloatEl && !motFloatEl.classList.contains('hidden')) vis.push('动作(' + currentMotionNames().length + '项)');
      if (typeof expFloatEl !== 'undefined' && expFloatEl && !expFloatEl.classList.contains('hidden')) vis.push('表情');
      if (typeof modelFloatEl !== 'undefined' && modelFloatEl && !modelFloatEl.classList.contains('hidden')) vis.push('模型');
      postLog('info', '面板已显示：' + (vis.join('、') || '（无）') + '｜窗 ' + window.innerWidth + '×' + window.innerHeight);
    } catch (e) { }
    reframe(); reportUiBounds();
  }, 0);
}
window.addEventListener('resize', () => { try { clampAllPanelsIntoView(); } catch (e) { } });

function fillButtonList(parent, title, emptyNote, names, onClick) {
  const sec = spSection(title);
  if (!names.length) { sec.appendChild(el('div', 'sp-note', emptyNote)); parent.appendChild(sec); return null; }
  // ★ **一条一行**（和原来的右键菜单一致）。不做成"一块一块"的格子：名字会被截成方块、几十条也读不清。
  const wrap = el('div', 'sp-list');
  for (const n of names) {
    const b = el('button', 'sp-list-item', n);
    b.addEventListener('click', () => onClick(n, b, wrap));
    wrap.appendChild(b);
  }
  sec.appendChild(wrap); parent.appendChild(sec);
  return wrap;
}
function currentMotionNames() {
  // ★★ 必须读**全集清单**（allMotions / allMmdMotions），不能读 vrmClips / mmdClips！
  //   这两个是**懒加载缓存**（用到才解析进内存，见 ensureVrmClip），启动时是空的 ⇒
  //   拿它当"动作清单"的后果：宿主那边（collectMotions 读 allMotions）报「208 动作」，
  //   而浮层里永远写「共 0 个 / 当前没有动作」—— 实测就是这个问题（用户："仍显示 0 个动作"）。
  //   清单只有一份数据源：collectMotions()。它读的是 allMotions，与宿主完全一致。
  return collectMotions();
}
function currentExpressionNames() {
  try {
    if (vrm && exprMgr() && exprMgr().expressions) return exprMgr().expressions.map(e => e.expressionName || e.name).filter(Boolean);
    if (mmdMesh && mmdMesh.morphTargetDictionary) return Object.keys(mmdMesh.morphTargetDictionary);
  } catch (e) { }
  return [];
}
// 表情试放（与宿主 expression 消息同一套做法：给值 + 定时复位）
function applyExpressionOnce(name, holdSec) {
  const hold = holdSec > 0 ? holdSec : 5;
  try {
    if (vrm && exprMgr()) {
      exprMgr().setValue(name, 1);
      expressionTimers.push(setTimeout(() => { try { exprMgr().setValue(name, 0); } catch (e) { } }, hold * 1000));
    } else if (mmdMesh && mmdMesh.morphTargetDictionary && mmdMesh.morphTargetDictionary[name] !== undefined) {
      const idx = mmdMesh.morphTargetDictionary[name];
      mmdMesh.morphTargetInfluences[idx] = 1;
      expressionTimers.push(setTimeout(() => { mmdMesh.morphTargetInfluences[idx] = 0; }, hold * 1000));
    }
  } catch (e) { }
}
// 一行一个"菜单项"（带右侧状态文字），用于开关类条目
function listRow(parent, label, rightText, onClick) {
  const b = el('button', 'sp-list-item', label + (rightText ? '　' + rightText : ''));
  b.addEventListener('click', () => onClick(b));
  parent.appendChild(b);
  return b;
}
function buildMotionsFloat() {
  // ★ 照「模型部件」面板的内联写法搭（不再走 mkFloatShell + enableFloatScroll 这条独立壳）：
  //   那两个面板一直正常，三个浮层老出"位置跑出画布 / 关不掉只剩一条边"，根因就是这条独立路径 + 位置残留。
  motFloatEl.innerHTML = '';
  const hdr = el('div', 'sp-header', '🎬 动作');
  const close = el('button', 'sp-close', '×'); hdr.appendChild(close);
  close.addEventListener('click', () => { motFloatEl.classList.add('hidden'); motFloatOpen = false; reframe(); reportUiBounds(); });
  motFloatEl.appendChild(hdr);
  makeDraggable(motFloatEl, hdr);
  const body = el('div', 'sp-body'); motFloatEl.appendChild(body);
  // 原来「动作」子菜单里的条目**一个不少**地搬进来（导入 / 开关 / 具身示例与自检）
  const tools = spSection('导入');
  const tw = el('div', 'sp-list');
  const b1 = el('button', 'sp-list-item', '📂 加载动作文件夹…');
  b1.addEventListener('click', () => { try { postLog('info', '浮层：点击「加载动作文件夹…」'); } catch (e) { } sendMenu('import_motion'); });
  const b2 = el('button', 'sp-list-item', '📄 加载具身动作文件…');
  b2.addEventListener('click', () => { try { postLog('info', '浮层：点击「加载具身动作文件…」'); } catch (e) { } sendMenu('import_embodied'); });
  tw.appendChild(b1); tw.appendChild(b2); tools.appendChild(tw); body.appendChild(tools);

  // ---- 播放开关（用户要求：默认"点一支、跳完一支就停"，想一直重复再打开）----
  // ★ 开关值用**数字 1/0** 而不是字符串 '1'/'0'：sendSetting 会把值写回 lastOpts，
  //   而字符串 '0' 在 JS 里是**真值** ⇒ 面板重开会把"关"显示成"开"（这个坑别踩）。
  const secPlay = spSection('播放');
  spToggle(secPlay, '重复播放（点动作循环不停）', !!lastOpts.motionLoop,
    on => sendSetting('motionLoop', on ? 1 : 0));
  secPlay.appendChild(el('div', 'sp-note', '关（默认）：点一支动作，跳完自动收回。开：一直重复这支，直到你点别的或再关掉。'));
  body.appendChild(secPlay);

  const names = currentMotionNames();
  fillButtonList(body, '动作（点一下播放，共 ' + names.length + ' 个）',
    '当前没有动作。先用上面的「加载动作文件夹…」导入 vmd / vrma。', names,
    (n, b, wrap) => {
      for (const sib of wrap.children) if (sib.classList) sib.classList.remove('sp-active');
      b.classList.add('sp-active');
      playMotionByName(n).catch(() => { });
    });

  // 开关与自检（原「动作」子菜单里的其余条目，逐个搬过来）
  const secA = spSection('开关 / 自检');
  const lw = el('div', 'sp-list');
  listRow(lw, '🚫 舞蹈时关闭追踪', (lastOpts.trackOffDuringDance ? '开' : '关'),
    () => sendMenu('setting', { key: 'dance_disable_track', value: lastOpts.trackOffDuringDance ? '0' : '1' }));
  listRow(lw, '🤖 具身动作(实验)', (lastOpts.embodiedMotion ? '开' : '关'),
    () => sendMenu('setting', { key: 'embodied_motion', value: lastOpts.embodiedMotion ? '0' : '1' }));
  listRow(lw, '🙂 具身表情(实验)', (lastOpts.embodiedExpression ? '开' : '关'),
    () => sendMenu('setting', { key: 'embodied_expression', value: lastOpts.embodiedExpression ? '0' : '1' }));
  const sep = el('div', 'sp-list-sep'); lw.appendChild(sep);
  listRow(lw, '▶ 播放具身示例', '', () => sendMenu('embodied_sample'));
  listRow(lw, '👋 试做具身动作(挥手)', '', () => sendMenu('embodied_wave'));
  listRow(lw, '✊ 试做:伸手→握拳(身体+手指)', '', () => { try { if (window.embodiedBodyAct) window.embodiedBodyAct({ preset: 'reach_fist' }); } catch (e) { } });
  listRow(lw, '😊 试做表情(开心)', '', () => sendMenu('embodied_happy'));
  secA.appendChild(lw); body.appendChild(secA);
}
messageBus.on('motions_open', () => {
  // ★ 每次打开都**复位到右下角默认位置**：拖动会写死 left/top，而 panel_space 会让窗口在 420↔744 间
  //   加宽/收窄，残留的 left/top 会让下一次打开跑到画布外、或只露一条边（夹回逻辑只保证"至少露 56px"，
  //   不保证完整可见）。复位后永远从右下角完整出现，拖动在本会话内仍然有效。
  motFloatEl.style.left = ''; motFloatEl.style.top = ''; motFloatEl.style.right = ''; motFloatEl.style.bottom = '';
  motFloatEl.classList.remove('hidden');   // 先显示、再构建（原因见 settings_open 处说明）
  motFloatOpen = true;
  try { buildMotionsFloat(); } catch (e) { postLog('error', '动作面板构建失败：' + ((e && e.message) || e)); }
  afterPanelOpen();
});
function buildExpressionsFloat() {
  expFloatEl.innerHTML = '';
  const hdr = el('div', 'sp-header', '😊 表情');
  const close = el('button', 'sp-close', '×'); hdr.appendChild(close);
  close.addEventListener('click', () => { expFloatEl.classList.add('hidden'); expFloatOpen = false; reframe(); reportUiBounds(); });
  expFloatEl.appendChild(hdr);
  makeDraggable(expFloatEl, hdr);
  const body = el('div', 'sp-body'); expFloatEl.appendChild(body);
  const names = currentExpressionNames();
  fillButtonList(body, '表情（点一下试放 5 秒，共 ' + names.length + ' 个）',
    '当前模型没有可用表情。', names, (n) => applyExpressionOnce(n, 5));
}
messageBus.on('expressions_open', () => {
  expFloatEl.style.left = ''; expFloatEl.style.top = ''; expFloatEl.style.right = ''; expFloatEl.style.bottom = '';
  expFloatEl.classList.remove('hidden');   // 先显示、再构建
  expFloatOpen = true;
  try { buildExpressionsFloat(); } catch (e) { postLog('error', '表情面板构建失败：' + ((e && e.message) || e)); }
  afterPanelOpen();
});

// 模型浮层：清单由宿主随 models_open 一起发来（前端只负责逐行画 + 点击切模型）
const modelFloatEl = document.createElement('div');
modelFloatEl.id = 'models-panel'; modelFloatEl.className = 'settings-panel hidden';
document.body.appendChild(modelFloatEl);
let modelFloatOpen = false, modelFloatItems = [];
messageBus.on('models_open', (msg) => {
  modelFloatItems = (msg && msg.models) || [];
  modelFloatEl.style.left = ''; modelFloatEl.style.top = ''; modelFloatEl.style.right = ''; modelFloatEl.style.bottom = '';
  modelFloatEl.classList.remove('hidden');   // 先显示、再构建（原因见 settings_open 处说明）
  modelFloatOpen = true;
  try { buildModelsFloat(); } catch (e) { postLog('error', '模型面板构建失败：' + ((e && e.message) || e)); }
  afterPanelOpen();
});
function buildModelsFloat() {
  modelFloatEl.innerHTML = '';
  const hdr = el('div', 'sp-header', '🧬 模型');
  const close = el('button', 'sp-close', '×'); hdr.appendChild(close);
  close.addEventListener('click', () => { modelFloatEl.classList.add('hidden'); modelFloatOpen = false; reframe(); reportUiBounds(); });
  modelFloatEl.appendChild(hdr);
  makeDraggable(modelFloatEl, hdr);
  const body = el('div', 'sp-body'); modelFloatEl.appendChild(body);
  const sec = spSection('模型（点一下切换，共 ' + modelFloatItems.length + ' 个）');
  const wrap = el('div', 'sp-list');
  if (!modelFloatItems.length) {
    wrap.appendChild(el('div', 'sp-note', '没有可用模型。用下面的「加载模型…」选一个（vrm / pmx）。'));
  } else {
    for (const it of modelFloatItems) {
      const b = el('button', 'sp-list-item', (it.label || it.name) + (it.current ? '　当前' : ''));
      if (it.current) b.classList.add('sp-active');
      b.addEventListener('click', () => {
        for (const sib of wrap.children) if (sib.classList) sib.classList.remove('sp-active');
        b.classList.add('sp-active');
        sendMenu('model', { name: it.name });   // 与原来菜单项同一个动作
      });
      wrap.appendChild(b);
    }
  }
  sec.appendChild(wrap); body.appendChild(sec);
  const tools = spSection('导入');
  const tw = el('div', 'sp-list');
  const b1 = el('button', 'sp-list-item', '📁 加载模型…');
  b1.addEventListener('click', () => { try { postLog('info', '浮层：点击「加载模型…」'); } catch (e) { } sendMenu('import_model'); });
  tw.appendChild(b1); tools.appendChild(tw); body.appendChild(tools);
}
function buildModelPartsUI() {
  modelPartsEl.innerHTML = '';
  const hdr = el('div', 'sp-header', '🧩 模型部件（显隐）');
  const close = el('button', 'sp-close', '×'); hdr.appendChild(close);
  close.addEventListener('click', () => { modelPartsEl.classList.add('hidden'); modelPartsOpen = false; reframe(); reportUiBounds(); });
  modelPartsEl.appendChild(hdr);
  makeDraggable(modelPartsEl, hdr);
  const body = el('div', 'sp-body'); modelPartsEl.appendChild(body);
  const parts = collectModelParts();
  if (!parts.length) { body.appendChild(el('div', 'sp-note', '当前模型没有可单独显隐的部件。')); return; }

  const getHidden = () => new Set(lastOpts.hiddenParts || []);
  // ★★ 版式（用户明确要求，照「动作 / 表情」浮层那套）：**每一块自己内部滚动 + 可收起**，
  //   不必把整块面板滑到底才能看见另一块（原话："不至于要把那么一长串都滑到底，才能再看到另一个"）。
  const foldBox = (h) => {
    const d = el('div');
    d.style.cssText = 'max-height:' + h + ';overflow-y:auto;overscroll-behavior:contain;padding-right:2px;';
    return d;
  };
  const mkFold = (sec, target, openText, closedText) => {
    const b = el('button', 'sp-toggle', openText);
    b.style.cssText = 'margin-left:8px;font-size:11px;padding:0 6px;';
    b.title = '收起 / 展开这一块（收起后不占高度）';
    b.addEventListener('click', () => {
      const hid = (target.style.display === 'none');
      target.style.display = hid ? '' : 'none';
      b.textContent = hid ? openText : closedText;
    });
    const t = sec.firstChild; if (t) t.appendChild(b);
    return b;
  };
  const stat = el('div', 'sp-note', '');
  body.appendChild(stat);

  // ---- ① 材质部件（现成那 44 件）----
  const secM = spSection('材质部件（' + parts.length + ' 件）');
  body.appendChild(secM);
  const mBox = foldBox('min(28vh, 230px)');
  secM.appendChild(mBox);
  mkFold(secM, mBox, '收起', '展开');

  // ---- 工具条：搜索 + 一键全显 / 全隐 ----
  // 为什么要搜索：这台模型 44 个部件、名字是作者写的中日文材质名（"後髪 / 服 / 素体…"），
  //   平铺一长条要滚半天才找到一件（用户实测吐槽："必须滑到底才能看另一个"）。
  const bar = el('div', 'sp-row');
  const q = document.createElement('input');
  q.type = 'text'; q.className = 'sp-select'; q.placeholder = '搜部件名（如 髪 / 裙 / 服 / 手）';
  q.style.cssText = 'flex:1 1 auto;min-width:0;font-size:12px;';
  const bAll = el('button', 'sp-toggle', '全显');
  const bNone = el('button', 'sp-toggle', '全隐');
  bAll.style.cssText = bNone.style.cssText = 'flex:0 0 auto;font-size:11px;padding:0 6px;margin-left:4px;';
  bAll.title = '把全部部件恢复显示';
  bNone.title = '把全部部件隐藏（排查"是哪一件在穿模/挡视线"时用；记得点「全显」恢复）';
  bar.appendChild(q); bar.appendChild(bAll); bar.appendChild(bNone);
  mBox.appendChild(bar);

  // ---- 分组：VRM 材质名中日文混杂，按关键字归类（归不进的一律放「其他」）----
  //   顺序有意义：先"头发"，再"脸/五官"，再"鞋袜/配饰"，**然后才是衣服**（"体操服"含"体"字，
  //   衣服必须排到"身体/皮肤"前面），最后身体，其余=其他。
  //   ★ 关键字表是**离线抽查过**的（`node -e` 跑常见 VRM 材质名：後髪/顔/素体/スカート/靴下/メガネ…），
  //     第一版漏了日语假名词（スカート 裙、シャツ 衬衫、しっぽ 尾…全落进"其他"）、且"眼镜"被"眼"抢到脸组 —— 已补。
  const GROUPS = [
    ['头发', ['髪', '发', '髮', 'hair', 'ponytail', '前发', '後发', '刘', 'ウィッグ', 'ヘア']],
    ['脸 / 五官', ['顔', '颜', 'face', '目', '眼', '瞳', 'eye', '眉', 'brow', '口', 'mouth', '齿', '歯', '牙', '舌', 'tongue', '鼻', 'nose', '耳', 'ear', 'まつげ', '睫毛', 'くちびる', '唇']],
    ['鞋 / 袜', ['靴', '鞋', 'shoes', 'sock', '袜', '襪', 'boot', 'loaf', 'くつ', 'ストッキン', 'タイツ', 'ソックス']],
    ['配饰', ['饰', '飾', 'accessor', 'hat', '帽', 'glass', 'メガネ', 'サングラス', '耳环', 'neckl', '项链', 'ribbon', 'リボン', 'ネクタイ', 'ベルト', 'マフラー', '手袋', 'グローブ', 'ring', '尾', '尻尾', 'しっぽ', 'tail', 'wing', '羽', 'feather', '翼', '角', 'つの', 'horn', 'アクセサリ']],
    ['衣服', ['服', '衣', 'cloth', 'dress', 'ドレス', 'skirt', 'スカート', '裙', 'shirt', 'シャツ', 'ブラウス', '衬衫', '裤', 'ズボン', 'pants', '袖', 'sleeve', 'coat', 'コート', '外套', '毛', 'jacket', 'ジャケット', 'cape', 'マント', '披风', 'ワンピ', 'セーラー', 'tops', 'top_', '上衣', 'ボトム', 'ニット', 'セーター']],
    ['身体 / 皮肤', ['素体', '体', '體', 'body', 'skin', '肌', '皮膚', '皮肤', 'hand', '手', '足', 'leg', '腕', 'arm', 'neck', '首']],
  ];
  const groupOf = (p) => {
    const s = String(p).toLowerCase();
    // 「眼镜」必须**先判**：否则会被"眼"抢进「脸 / 五官」组（离线抽查抓到的）。
    if (/眼镜|眼鏡|めがね|メガネ|サングラス|glass/i.test(p)) return '配饰';
    for (const [gn, kws] of GROUPS) { for (const k of kws) if (s.indexOf(k) >= 0) return gn; }
    return '其他';
  };

  const partList = el('div');      // 滚动交给外层 mBox（避免"滚动条套滚动条"，那反而更难滑）
  mBox.appendChild(partList);
  const rowRefs = [];              // [{p, btn}]
  const gBtnRef = {};              // 组名 → 该组按钮（用于"隐藏本组/显示本组"文案同步）
  const gListRef = {};             // 组名 → 该组部件名数组

  // ★ 批量（全显/全隐/隐藏本组）时把**持久化消息排队发**，不要一口气怼 44 条：
  //   宿主每条都会重写一次配置文件，实测并发写出 `IOException: …json is being used by another process`
  //   （用户日志 2026-10-14 14:12:48 一次「全隐」后刷了几十行这个错 + 几百行 `VRM 物理(弹簧骨)：开`）。
  //   本地显示/隐藏**立即生效**（用户看不到差别），只有"落盘"这条按 15ms 间隔排队（44 条 ≈ 0.7s）。
  let _pendQ = [], _pendTimer = null, _pendTotal = 0, _soloSaved = null;
  const flushPendQ = () => {
    _pendTimer = null;
    const it = _pendQ.shift();
    if (!it) return;
    try { sendMenu('setting', { key: 'part:' + it.p, value: it.hide ? '1' : '0' }); } catch (e) { }
    if (_pendQ.length) { _pendTimer = setTimeout(flushPendQ, 15); return; }
    try { postLog('info', '模型部件：已保存 ' + _pendTotal + ' 条显隐设置'); } catch (e) { }
    _pendTotal = 0;
  };
  const queueSave = (p, hide) => {
    _pendTotal++;
    _pendQ.push({ p: p, hide: !!hide });
    if (!_pendTimer) _pendTimer = setTimeout(flushPendQ, 10);
  };
  const applyRow = (p, wantHidden, queued) => {
    const set = getHidden();
    if (wantHidden) set.add(p); else set.delete(p);
    lastOpts.hiddenParts = Array.from(set);
    applyHiddenParts(lastOpts.hiddenParts);                                       // 本地即时生效
    if (queued) queueSave(p, wantHidden);
    else {
      try { sendMenu('setting', { key: 'part:' + p, value: wantHidden ? '1' : '0' }); } catch (e) { }
    }
  };
  const syncUI = () => {
    const hid = getHidden();
    let shown = 0;
    for (const it of rowRefs) {
      const h = hid.has(it.p);
      it.btn.classList.toggle('on', !h);          // on = 显示中
      it.btn.textContent = h ? '隐藏' : '显示';
      if (!it.row.style.display || it.row.style.display !== 'none') shown++;
    }
    for (const gn in gBtnRef) {
      const arr = gListRef[gn] || [];
      const allHid = arr.length > 0 && arr.every(p => hid.has(p));
      gBtnRef[gn].textContent = allHid ? '显示本组' : '隐藏本组';
    }
    stat.textContent = '共 ' + parts.length + ' 件｜显示中 ' + shown + '｜已隐藏 ' + hid.size
      + '（点右侧按钮切换；「全隐」可一次藏掉全部，用来排查是哪一件穿模/挡视线）';
  };

  const rebuildList = () => {
    partList.innerHTML = '';
    rowRefs.length = 0;
    for (const gn in gBtnRef) delete gBtnRef[gn];
    for (const gn in gListRef) delete gListRef[gn];
    const kw = (q.value || '').trim().toLowerCase();
    let hit = 0;
    const gnames = GROUPS.map(g => g[0]).concat(['其他']);
    for (const gn of gnames) {
      const items = parts.filter(p => groupOf(p) === gn && (!kw || String(p).toLowerCase().indexOf(kw) >= 0));
      if (!items.length) continue;
      hit += items.length;
      gListRef[gn] = items;
      const hd = el('div', '', '— ' + gn + '（' + items.length + '）—');
      hd.style.cssText = 'font-size:12px;opacity:0.6;margin:8px 0 2px;';
      const gb = el('button', 'sp-toggle', '隐藏本组');
      gb.style.cssText = 'margin-left:8px;font-size:11px;padding:0 6px;';
      gb.title = '把「' + gn + '」这一组一起切换（' + items.length + ' 件）';
      gb.addEventListener('click', () => {
        const hid = getHidden();
        const arr = gListRef[gn] || [];
        const allHid = arr.length > 0 && arr.every(p => hid.has(p));
        for (const p of arr) applyRow(p, !allHid, true);   // 全隐了 → 点它=全显；否则=全隐（排队落盘）
        syncUI();
        postLog('info', '模型部件：' + (allHid ? '显示' : '隐藏') + '「' + gn + '」共 ' + arr.length + ' 件');
      });
      gBtnRef[gn] = gb; hd.appendChild(gb);
      partList.appendChild(hd);
      for (const p of items) {
        const r = el('div', 'sp-row');
        const name = el('span', 'sp-label', p);
        name.style.flex = '1 1 auto'; name.style.minWidth = '0';
        name.style.overflow = 'hidden'; name.style.textOverflow = 'ellipsis'; name.style.whiteSpace = 'nowrap';
        // ★ 名字可能是作者乱起的（所以才有"不是后发却叫后发"）⇒ 悬停给出**可核对的事实**：
        //   节点名（模型里那个对象的名字）+ 材质名 + 三角面数 + 是否蒙皮网格。
        //   名字对不上时，用「独」（只看这件）用眼睛确认到底是哪一块 —— 这是唯一可靠的判据。
        const meta = _partMeta[p];
        name.title = p + (meta
          ? ('\n节点: ' + meta.node + '\n材质: ' + (meta.mat || '(无名)')
            + '\n三角面: ' + meta.tris + (meta.skinned ? '（蒙皮网格 SkinnedMesh）' : ''))
          : '\n（没有详情：该部件信息已过期，重开面板即可）');
        r.appendChild(name);
        const btn = el('button', 'sp-toggle on', '显示');
        btn.style.flex = '0 0 auto';
        btn.addEventListener('click', () => {
          const nowShown = btn.classList.contains('on'); // 当前"显示中" → 点击要隐藏
          applyRow(p, nowShown);
          syncUI();
        });
        const bSolo = el('button', 'sp-toggle', '独');
        bSolo.style.cssText = 'flex:0 0 auto;font-size:11px;padding:0 5px;margin-left:4px;';
        bSolo.title = '只看这件：把其它全部隐藏（再点一次恢复原来的显隐）—— 名字不可信时用它确认是哪一块';
        bSolo.addEventListener('click', () => {
          if (_soloSaved) {                                            // 恢复
            lastOpts.hiddenParts = _soloSaved.slice();
            _soloSaved = null;
          } else {
            _soloSaved = (lastOpts.hiddenParts || []).slice();
            lastOpts.hiddenParts = parts.filter(x => x !== p);          // 除它以外全隐藏
          }
          applyHiddenParts(lastOpts.hiddenParts);
          const hid = getHidden();
          for (const x of parts) queueSave(x, hid.has(x));              // 逐条排队落盘（本地已即时生效）
          syncUI();
          postLog('info', '模型部件：' + (_soloSaved ? ('只看「' + p + '」') : '已取消"只看这件"'));
        });
        r.appendChild(btn); r.appendChild(bSolo); partList.appendChild(r);
        rowRefs.push({ p: p, btn: btn, row: r });
      }
    }
    if (!hit) partList.appendChild(el('div', 'sp-note', '没有匹配「' + kw + '」的部件'));
    syncUI();
  };

  q.addEventListener('input', rebuildList);
  bAll.addEventListener('click', () => {
    for (const p of parts) applyRow(p, false, true);
    syncUI();
    postLog('info', '模型部件：已全部显示（' + parts.length + ' 件，正在排队保存）');
  });
  bNone.addEventListener('click', () => {
    for (const p of parts) applyRow(p, true, true);
    syncUI();
    postLog('info', '模型部件：已全部隐藏（' + parts.length + ' 件，正在排队保存）—— 排查是哪一件时用它，记得点「全显」恢复');
  });

  rebuildList();
  try {
    const hid = getHidden();
    const cnt = {};
    for (const p of parts) { const g = groupOf(p); cnt[g] = (cnt[g] || 0) + 1; }
    postLog('info', '模型部件面板：材质 ' + parts.length + ' 件｜已隐藏 ' + hid.size + '｜分组 '
      + Object.keys(cnt).map(g => g + cnt[g]).join('/'));
    // 把"名字与事实"一起打出来（名字可能是作者乱起的；三角面数能一眼分辨"这件到底是头发还是身体"）
    postLog('info', '模型部件详情（名字｜节点｜材质｜三角面）：'
      + parts.slice(0, 8).map(p => {
        const m0 = _partMeta[p] || {};
        return p + '｜' + (m0.node || '?') + '｜' + (m0.mat || '-') + '｜' + (m0.tris || 0);
      }).join('　·　') + (parts.length > 8 ? ('　… 其余 ' + (parts.length - 8) + ' 件同上格式（面板悬停可见）') : ''));
  } catch (e) { }

  // ---- ② 骨骼链 / 弹簧骨（怀表 / 发辫 / 裙×48 / 胸 / 带子 / 披风 / 飘带…）----
  //   这些是**物理链**，不在材质表里（材质栏管不到它们）—— 逐条「冻结」= 把这条链钉住不再摆动。
  const chains = springChains();
  const secC = spSection('骨骼链 / 弹簧骨（' + chains.length + ' 条）');
  body.appendChild(secC);
  const cBox = foldBox('min(26vh, 215px)');
  secC.appendChild(cBox);
  mkFold(secC, cBox, '收起', '展开');
  if (!chains.length) {
    // ★ 取不到就把**原始事实**写出来（类型/数量/可用数）—— 上次显示 0 条只有一句"没有弹簧骨"，
    //   结果真因是 `joints` 是 Set 而我的 `.filter` 抛异常被吞掉。以后不再靠猜。
    const dg = springDiag();
    cBox.appendChild(el('div', 'sp-note', '取不到弹簧骨链。诊断：' + dg
      + '（PMX 或没配 VRM 弹簧骨的模型就是空的；若是 Set/数组类型正常但数量 >0，把这行发我）'));
    try { postLog('warn', '弹簧骨链取不到：' + dg); } catch (e) { }
  } else {
    const cBar = el('div', 'sp-row');
    const cq = document.createElement('input');
    cq.type = 'text'; cq.className = 'sp-select'; cq.placeholder = '搜链名（裙 / 髪 / 怀表…）';
    cq.style.cssText = 'flex:1 1 auto;min-width:0;font-size:12px;';
    const bUnfreeze = el('button', 'sp-toggle', '全部解冻');
    bUnfreeze.style.cssText = 'flex:0 0 auto;font-size:11px;padding:0 6px;margin-left:4px;';
    cBar.appendChild(cq); cBar.appendChild(bUnfreeze);
    cBox.appendChild(cBar);
    const cStat = el('div', 'sp-note', '');
    cBox.appendChild(cStat);
    const cList = el('div');
    cBox.appendChild(cList);
    const cBtns = [];
    const frozenNow = () => springFrozenSet();
    const syncC = () => {
      const fz = frozenNow();
      let n = 0;
      for (const it of cBtns) {
        const h = fz.has(it.name);
        if (h) n++;
        it.btn.classList.toggle('on', !h);
        it.btn.textContent = h ? '已冻结' : '冻结';
      }
      cStat.textContent = '共 ' + chains.length + ' 条｜已冻结 ' + n
        + '（「冻结」= 这条链不再摆动/像钉子一样钉住；再点一次解冻，按作者原值恢复）';
    };
    const rebuildC = () => {
      const kw = (cq.value || '').trim().toLowerCase();
      cList.innerHTML = ''; cBtns.length = 0;
      let hit = 0;
      for (const ch of chains) {
        if (kw && String(ch.name).toLowerCase().indexOf(kw) < 0) continue;
        hit++;
        const r = el('div', 'sp-row');
        const nm = el('span', 'sp-label', ch.name + '（' + ch.joints.length + ' 节）');
        nm.style.cssText = 'flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
        nm.title = ch.name + '（' + ch.joints.length + ' 节弹簧骨）';
        const btn = el('button', 'sp-toggle', '冻结');
        btn.style.flex = '0 0 auto';
        btn.addEventListener('click', () => { setSpringFrozen(ch.name, !frozenNow().has(ch.name)); syncC(); });
        r.appendChild(nm); r.appendChild(btn); cList.appendChild(r);
        cBtns.push({ name: ch.name, btn: btn });
      }
      if (!hit) cList.appendChild(el('div', 'sp-note', '没有匹配「' + kw + '」的链'));
      syncC();
    };
    cq.addEventListener('input', rebuildC);
    bUnfreeze.addEventListener('click', () => {
      rigSet('spring', 'frozen', []);
      applySpringChains(true);
      syncC();
      postLog('info', '弹簧骨链：已全部解冻（' + chains.length + ' 条）');
    });
    rebuildC();
    try {
      const fz = springFrozenSet();
      postLog('info', '弹簧骨链：共 ' + chains.length + ' 条｜已冻结 ' + fz.size + '｜最长链前 6 条 '
        + chains.slice(0, 6).map(c => c.name + '(' + c.joints.length + ')').join('、'));
    } catch (e) { }
  }
}
function el(tag, cls, txt) { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }
function spSection(title) { const s = el('div', 'sp-sec'); s.appendChild(el('div', 'sp-sec-title', title)); return s; }
// ★★ 长标签不再被省略号截断（用户："备注字多被挤掉省略了就几个字没看懂"）：
//   ≥9 个字 ⇒ 允许**换行**显示完整 + 悬停显示全文；短标签保持原来的单行省略（面板很窄时优先保数值可见）。
function spRow(label) {
  const r = el('div', 'sp-row');
  const s = el('span', 'sp-label', label);
  const t = String(label == null ? '' : label);
  if (t.length >= 9) { s.classList.add('sp-label-wrap'); s.title = t; }
  r.appendChild(s); return r;
}
// spSlider(..., fmt, desc)：第 9 个参数是可选的**说明行** —— 写在滑条下方，讲"拖了会发生什么"。
// 为什么必须有：控件名只能表达"是什么"，表达不了"效果"（比如「偏航 180」= 看背面、却不动角色）。
// 别人（以及几个月后的自己）打开面板，靠这一行才能不看源码就明白。
function spSlider(parent, label, min, max, step, val, onInput, fmt, desc) {
  const r = spRow(label);
  const v = el('span', 'sp-val', fmt ? fmt(val) : ('' + val));
  const inp = document.createElement('input'); inp.type = 'range'; inp.min = min; inp.max = max; inp.step = step; inp.value = val; inp.className = 'sp-range';
  inp.addEventListener('input', () => { const n = parseFloat(inp.value); v.textContent = fmt ? fmt(n) : ('' + n); onInput(n); });
  inp._valEl = v;   // 供滚轮缩放等外部改动时同步显示
  // ★ 数值挪到**滑块正中间**（覆盖在轨道上，指针穿透，拖动不受影响）。
  //   原来数值占右边一列，面板一窄就要左右滚动才能看见"调了多少"——用户明确要求不要再出现横向滚动。
  const wrap = el('div', 'sp-range-wrap');
  wrap.appendChild(inp); wrap.appendChild(v);
  // ★★ 「点数字/点标签 → 直接输入数值」（用户要求：滑条只能拖太费劲，尤其 0~250 这种宽量程）。
  //   回车确认、Esc 取消、失焦也算确认；自动夹到 [min,max]，和拖动走**同一个** onInput ⇒ 行为一致。
  const beginEdit = () => {
    if (wrap.querySelector('.sp-val-edit')) return;      // 已在编辑
    const box = document.createElement('input');
    box.type = 'text'; box.className = 'sp-val-edit'; box.value = String(inp.value);
    box.style.cssText = 'width:60px;text-align:center;background:rgba(0,0,0,0.6);color:#fff;'
      + 'border:1px solid #6f9bff;border-radius:4px;font-size:11.5px;padding:1px 3px;';
    v.style.display = 'none'; wrap.appendChild(box); box.focus(); box.select();
    const done = (ok) => {
      const raw = String(box.value).replace(/[^\-\d.]/g, '');
      try { box.remove(); } catch (e) { }
      v.style.display = '';
      if (!ok) return;
      let n = parseFloat(raw);
      if (!isFinite(n)) return;
      n = Math.max(+min, Math.min(+max, n));
      inp.value = n;
      v.textContent = fmt ? fmt(n) : ('' + n);
      onInput(n);
    };
    box.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); done(true); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(false); }
    });
    box.addEventListener('blur', () => done(true));
  };
  v.style.pointerEvents = 'auto';            // 数值不再"指针穿透"：点它就能输入（只占文字那一小块，拖动照旧）
  v.style.cursor = 'text';
  v.title = '点数字可直接输入（回车确认 / Esc 取消）';
  v.addEventListener('click', beginEdit);
  const _lbl = r.querySelector('.sp-label');
  if (_lbl) { _lbl.style.cursor = 'text'; _lbl.title = '点标签也能输入数值'; _lbl.addEventListener('click', beginEdit); }
  r.appendChild(wrap); parent.appendChild(r);
  if (desc) {
    const d = el('div', '', desc);
    d.style.cssText = 'font-size:11px;opacity:0.62;margin:-2px 0 7px 2px;line-height:1.35;white-space:pre-wrap;';
    parent.appendChild(d);
  }
  return inp;
}
function spToggle(parent, label, val, onChange) {
  const r = spRow(label);
  const btn = el('button', 'sp-toggle' + (val ? ' on' : '')); btn.textContent = val ? '开' : '关';
  btn.addEventListener('click', () => { const nv = !btn.classList.contains('on'); btn.classList.toggle('on', nv); btn.textContent = nv ? '开' : '关'; onChange(nv); });
  r.appendChild(btn); parent.appendChild(r); return btn;
}
function spDropdown(parent, label, opts, val, onChange) {
  const r = spRow(label); const sel = document.createElement('select'); sel.className = 'sp-select';
  for (const o of opts) { const op = document.createElement('option'); op.value = o.v; op.textContent = o.t; if (o.v === val) op.selected = true; sel.appendChild(op); }
  sel.addEventListener('change', () => onChange(sel.value)); r.appendChild(sel); parent.appendChild(r); return sel;
}
function spColor(parent, label, val, onChange) {
  const r = spRow(label); const inp = document.createElement('input'); inp.type = 'color'; inp.value = val || '#ffffff'; inp.className = 'sp-color';
  inp.addEventListener('input', () => onChange(inp.value)); r.appendChild(inp); parent.appendChild(r); return inp;
}
// 宿主 ApplySetting 只认 snake_case 键（base_expr / camera / idle / dance_expr …），
// 而设置面板里 sendSetting 普遍用 camelCase（baseExpression / cameraDistance …），两者对不上导致大部分设置下发无效。
// 这里统一做一次翻译，调用点无需逐个改键名。
const SETTING_KEY_MAP = {
  cameraDistance: 'camera', cameraYaw: 'yaw', cameraPitch: 'pitch', cameraHeight: 'height',
  bottomMargin: 'bottom_margin', lightingPreset: 'lighting', lightingIntensity: 'intensity',
  enableAmbient: 'enable_ambient', lightAmbientIntensity: 'amb_intensity', ambientSaturation: 'amb_saturation',
  lightAmbientColor: 'amb_color', ambient2Intensity: 'amb2_intensity', ambient2Saturation: 'amb2_saturation',
  ambient2Color: 'amb2_color', ambient3Intensity: 'amb3_intensity', ambient3Saturation: 'amb3_saturation',
  ambient3Color: 'amb3_color', enableKey: 'enable_key', lightKeyIntensity: 'key_intensity',
  keySaturation: 'key_saturation', lightKeyColor: 'key_color',
  idleAnimation: 'idle', idleIntensity: 'idle_intensity', idleSpeed: 'idle_speed', idleGesture: 'idle_gesture', idleGap: 'idle_gap',
  motionIdiomRefreshDays: 'motion_idiom_refresh_days',
  baseExpression: 'base_expr', baseExpressionWeight: 'base_expr_weight',
  motionDuration: 'motion_duration', motionTransition: 'motion_transition', motionLoop: 'motion_loop',
  autoDance: 'dance', danceStyle: 'dance_style', danceDuration: 'dance_duration', danceTransition: 'dance_transition',
  danceExpression: 'dance_expr', danceDisableTrack: 'dance_disable_track',
  embodiedMotion: 'embodied_motion', embodiedSmooth: 'embodied_smooth', embodiedExpression: 'embodied_expression',
  embodiedFaceMap: 'embodied_face_map',
  enableHeadTrack: 'head_track', headTrackStrength: 'track_head',
  enableSpineTrack: 'spine_track', spineTrackStrength: 'track_spine',
  cursorTracking: 'cursor_track', windowTop: 'top', mouseThrough: 'mouse_through', vrmPhysics: 'vrm_physics',
  pokeTriggersAi: 'poke_ai', greetTriggersAi: 'greet_ai', patTriggersAi: 'pat_ai',
  interactionCooldown: 'interact_cooldown',
  ardyTune: 'ardy_tune'          // 生成式动作手感参数（JSON 字符串，第 2 项持久化）
};
function sendSetting(key, val) {
  // 本地立即把当前值写回 lastOpts：面板重开时所有滑条/开关都读 lastOpts，
  // 不写回就会"效果在、但面板回退到初始值、像没保存"（C# 那边仍照常持久化）。
  lastOpts[key] = val;
  const k = SETTING_KEY_MAP[key] || key;
  sendMenu('setting', { key: k, value: (typeof val === 'number') ? String(val) : val });
}
// 可在设置面板里逐轴微调的骨骼（新增小臂：扶头这类姿势主要靠小臂角度掰正）
const POSE_BONE_EDIT = ['spine', 'chest', 'leftUpperArm', 'leftLowerArm', 'rightUpperArm', 'rightLowerArm',
  'leftUpperLeg', 'rightUpperLeg', 'leftLowerLeg', 'rightLowerLeg'];
// ★★ 本地立即生效 —— 不要改回"只发消息"。
//   旧实现：拖动只 sendMenu，然后**完全依赖宿主回 options_update** 才 setPose 应用。
//   只要那条回传链有任何一处不对（消息名/字段/时序/被别的处理分支截住），
//   症状就是**整块滑条"看着能调、人一动不动"**，而且面板重开会显示新值（本地 state 已改）——
//   排查时会一直以为是"应用逻辑写错了"。用户实测这块"一个都不能用"，就是踩在这上面。
//   现在：先本地重算 poseTarget（当帧就动），再发消息给宿主持久化；宿主回传那条路照旧（幂等）。
let _poseLogT = -1e9;
let _lastPoseEdit = '';            // 最近一次拖的"骨.轴=值"（写进诊断行，便于一眼确认写入路径通了）

// ================= ★★ 逐轴微调值的"按模型存档"（治"数值没保存/还都是 0/缓存突然灌进来"）=================
// 用户实证（2026-10-14）："关了设置面板，动作是那样，但数值它没保存还都是 0，甚至会把之前缓存的弄进来……
//   也不是一开始就把缓存弄进来的，是我调整的时候才突然加进来的，吓了我一跳。"
// 原因链（读代码即可复现，不是猜）：
//   ① `poseOverrides` **只在内存** —— 换模型/重载就没了（所以重开面板显示 0，而人物还摆着姿势：
//      那份姿势是宿主侧仍在生效的偏移）。
//   ② 宿主的 `poseOffsets` 是**全局一份**（不按模型）⇒ 换模型回来时，它会把**上一个模型的缓存**灌进来。
//   ③ 宿主每次回传 `poseOffsets` 都会 `parsePoseOffsets` **原地覆盖** `poseOverrides`，但**不刷新面板**
//      ⇒ 数据变了、滑条还停在旧数字（"数值没改""还都是 0"）；等你下一次拖动才看见它跳 = "吓我一跳"。
// 修法（三件一起，缺一件都还会复现）：
//   ① 每个姿势的微调值写进**按模型的存档**（复用 rigProfile：本地 localStorage + 宿主 Configuration.RigProfile）；
//   ② 载入模型后以**本模型存档为准**（有存档就不吃宿主那份全局缓存，并把自己推回宿主）；
//   ③ 数据一变（拿起宿主的、或你拖动）就**重建滑条**（面板开着时）⇒ 面板数字永远 == 真实数据。
let _poseOffsetsAuthoritative = false;    // 本模型有存档 ⇒ 拒收宿主那份全局缓存（防"别的模型的值灌进来"）
let _posePushBackT = -1e9;                // 回推宿主的时间戳（防"你推我我推你"的回环）
let _poseSaveT = -1e9, _poseSaveTimer = null;
function poseOffsetsSaved() {
  const o = rigGet('pose', '__all', null);
  return (o && typeof o === 'object') ? o : null;
}
function poseOffsetStore(pose) {
  // 还没确定"当前模型"就别写：否则会把值记到 unknown 键上（换模型后又读不到 = 白存）
  if (!currentModelUrl) return;
  const all = Object.assign({}, poseOffsetsSaved() || {});
  const cur = poseOverrides[pose] || {};
  const clean = {};
  for (const bn in cur) {
    const o = cur[bn] || {};
    const x = +o.x || 0, y = +o.y || 0, z = +o.z || 0;
    if (x || y || z) clean[bn] = { x: x, y: y, z: z };     // 只存非 0：存档不膨胀，换模型也不会灌进一堆没意义的 0
  }
  if (Object.keys(clean).length) all[pose] = clean; else delete all[pose];
  rigSet('pose', '__all', all);                            // 本地 + 宿主双写（跨插件重载也还在）
}
function poseOffsetStoreThrottled(pose) {
  const now = Date.now();
  if (now - _poseSaveT > 400) { _poseSaveT = now; try { poseOffsetStore(pose); } catch (e) { } return; }
  if (_poseSaveTimer) return;                              // 拖动时 ~10 次/秒，节流到 400ms 一次（末尾补一次）
  _poseSaveTimer = setTimeout(() => {
    _poseSaveTimer = null; _poseSaveT = Date.now();
    try { poseOffsetStore(currentPose || 'stand'); } catch (e) { }
  }, 450);
}
function adoptSavedPoseOffsets() {
  const all = poseOffsetsSaved();
  const keys = all ? Object.keys(all) : [];
  if (!keys.length) { _poseOffsetsAuthoritative = false; return 0; }
  for (const p of keys) {
    if (!poseOverrides[p]) poseOverrides[p] = {};
    for (const bn in all[p]) poseOverrides[p][bn] = Object.assign({}, all[p][bn]);
  }
  _poseOffsetsAuthoritative = true;
  try { refreshPoseTargets(); } catch (e) { }
  return keys.length;
}
// 面板开着时，把"骨骼微调"那一块的滑条按当前数据重画（数据变了就调它 ⇒ 面板数字不会停在旧值上）
function refreshPoseBonesUI() {
  try {
    if (!settingsOpen || !settingsEl) return;
    const w = settingsEl.querySelector('.sp-bones');
    if (w) buildPoseBones(w);
  } catch (e) { }
}
function pushPoseOffsets() {
  const pose = currentPose || 'stand';
  try { refreshPoseTargets(); } catch (e) { }
  // 诊断（最多 1 秒一条，只在你拖滑条时打）：一次回答"是没应用，还是应用了被别的层盖住"。
  try {
    const nowS = ((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()) / 1000;
    if (nowS - _poseLogT > 1.0) {
      _poseLogT = nowS;
      const t = poseTarget['spine'] || {}, c = poseCurrent['spine'] || {};
      postLog('info', '姿势微调：' + pose + '｜刚改=' + (_lastPoseEdit || '—')
        + '｜spine 目标 x=' + (+t.x || 0).toFixed(3) + ' 当前 x=' + (+c.x || 0).toFixed(3)
        + '｜动作中=' + (!!currentMotionAction) + ' 手势=' + (!!gestureAction) + ' 拖拽=' + (!!dragAction)
        + ' 具身接管=' + (!!embodiedYielding) + ' 跳舞=' + (!!dancingNow));
    }
  } catch (e) { }
  sendMenu('pose_offsets', { value: JSON.stringify(poseOverrides) });
}
function buildPoseBones(wrap) {
  wrap.innerHTML = '';
  const pose = currentPose || 'stand';
  if (!poseOverrides[pose]) poseOverrides[pose] = {};
  const _stMap = {};        // 自检用：滑条 ↔ 数据 对照表（暴露到 window.__stBones）
  for (const bn of POSE_BONE_EDIT) {
    if (!poseOverrides[pose][bn]) poseOverrides[pose][bn] = {};
    const o = poseOverrides[pose][bn];      // 只用于**读初值**
    wrap.appendChild(el('div', 'sp-bone-name', bn));
    ['x', 'y', 'z'].forEach(axis => {
      // ★★ 写入时**重新按当前 `poseOverrides` 取目标对象**，绝不长期持有子对象引用。
      //   为什么（这是这块"看着能调、人一动不动"的真因）：`pushPoseOffsets()` 一发给宿主，
      //   宿主立刻回 `options_update` → `parsePoseOffsets()` 会把 `poseOverrides` **整体换成新对象**
      //   ⇒ 若闭包里抓着旧的子对象，之后所有拖动都写进**没人读的孤儿对象** ⇒ 只有第一次拖的那一下有效。
      //   （同一类坑在文件注释里记过一次"看着能调、人一动不动"，当时只补了本地 refresh，没治引用。）
      _stMap[bn + '.' + axis] = spSlider(wrap, bn + '.' + axis, -1.5, 1.5, 0.05, o[axis] || 0, v => {
        const pv = +v || 0;
        const pp = poseOverrides[pose] || (poseOverrides[pose] = {});
        const bb = pp[bn] || (pp[bn] = {});
        bb[axis] = pv;
        try { _lastPoseEdit = bn + '.' + axis + '=' + pv.toFixed(2); } catch (e) { }
        _poseOffsetsAuthoritative = true;     // ★ 本模型从此以"你刚拖的值"为准（宿主那份全局缓存不再回灌）
        poseOffsetStoreThrottled(pose);       // ★ 按模型立即存档（这就是"数值要能保存"的关键）
        pushPoseOffsets();
      });
    });
  }
  window.__stBones = { pose: pose, map: _stMap };   // 自检用：面板滑条 ↔ 数据 对照（"显示 0 但其实有值"那类 bug 一测就现形）
}
function buildSettingsUI() {
  settingsEl.innerHTML = '';
  const hdr = el('div', 'sp-header', '⚙️ 设置面板');
  const close = el('button', 'sp-close', '×'); hdr.appendChild(close);
  close.addEventListener('click', () => { settingsEl.classList.add('hidden'); settingsOpen = false; reframe(); reportUiBounds(); refreshNowPlayingOverlay(); });
  settingsEl.appendChild(hdr);
  makeDraggable(settingsEl, hdr);
  const body = el('div', 'sp-body'); settingsEl.appendChild(body);

  let sec = spSection('相机');
  spSlider(sec, '距离', 3, 12, 0.5, lastOpts.cameraDistance || 6, v => sendSetting('cameraDistance', v));
  spSlider(sec, '偏航(°前脸0/背面180)', -180, 180, 5, lastOpts.cameraYaw || 0, v => sendSetting('cameraYaw', v));
  spSlider(sec, '俯仰(°正俯视)', -45, 70, 5, lastOpts.cameraPitch || 0, v => sendSetting('cameraPitch', v));
  spSlider(sec, '高度', -0.6, 0.6, 0.05, lastOpts.cameraHeight || 0, v => sendSetting('cameraHeight', v));
  spSlider(sec, '底部留白(脚露出来)', 0, 0.25, 0.01, lastOpts.bottomMargin ?? 0.07, v => sendSetting('bottomMargin', v.toFixed(2)));
  // 取景余量（前端本地，不走宿主配置）：默认按"最坏情况包络"留够 ⇒ 举手/展臂/蹲跪/转身都不切边，
  // 代价是体型整体 ≈ 旧值的 78%。**调到 1.00 就完全等价于旧行为**（能放到最大，极端动作可能切边）。
  // 想要"又大又少切"：0.95(能到最大) ↔ 1.28(绝不切) 之间取折中，再配合「大小」「距离」。
  spSlider(sec, '取景余量(额外留白)', 0.80, 3.00, 0.02, fitEnvFactor,
    v => { fitEnvFactor = +v; try { reframe(); } catch (e) { } }, v => (+v).toFixed(2),
    '1.00=刚够装下"举手指尖"（已按你模型的骨架实测）；调小会开始切边（人物更大），调大更保险（更小）。'
    + '抬手/展臂仍被面板挡或出画时，直接往上调（1.5~2.0）即可，不必等改代码。');
  body.appendChild(sec);

  sec = spSection('光照');
  spDropdown(sec, '预设', [{ v: 'studio', t: '影棚' }, { v: 'soft', t: '柔和' }, { v: 'flat', t: '平光' }], lastOpts.lightingPreset || 'studio', v => sendSetting('lightingPreset', v));
  spSlider(sec, '总强度', 0.2, 3, 0.1, lastOpts.lightingIntensity || 1, v => sendSetting('lightingIntensity', v));
  // 氛围光（环境光 / 外部打光）：AMBI1/2/3 各自 强度/饱和度/颜色
  spToggle(sec, '启用氛围光', lastOpts.enableAmbient !== false, on => sendSetting('enableAmbient', on ? '1' : '0'));
  spSlider(sec, 'AMBI1 强度', 0, 3, 0.1, lastOpts.lightAmbientIntensity ?? 1, v => sendSetting('lightAmbientIntensity', v));
  spSlider(sec, 'AMBI1 饱和度', 0, 3, 0.1, lastOpts.ambientSaturation ?? 1, v => sendSetting('ambientSaturation', v));
  spColor(sec, 'AMBI1 颜色', lastOpts.lightAmbientColor || '#ffffff', v => sendSetting('lightAmbientColor', v));
  spSlider(sec, 'AMBI2 强度', 0, 3, 0.1, lastOpts.ambient2Intensity ?? 0.7, v => sendSetting('ambient2Intensity', v));
  spSlider(sec, 'AMBI2 饱和度', 0, 3, 0.1, lastOpts.ambient2Saturation ?? 1, v => sendSetting('ambient2Saturation', v));
  spColor(sec, 'AMBI2 颜色', lastOpts.ambient2Color || '#dfe6ff', v => sendSetting('ambient2Color', v));
  spSlider(sec, 'AMBI3 强度', 0, 3, 0.1, lastOpts.ambient3Intensity ?? 0.35, v => sendSetting('ambient3Intensity', v));
  spSlider(sec, 'AMBI3 饱和度', 0, 3, 0.1, lastOpts.ambient3Saturation ?? 1, v => sendSetting('ambient3Saturation', v));
  spColor(sec, 'AMBI3 颜色', lastOpts.ambient3Color || '#aab4ff', v => sendSetting('ambient3Color', v));
  // 全局灯光（关键光）
  spToggle(sec, '启用灯光', lastOpts.enableKey !== false, on => sendSetting('enableKey', on ? '1' : '0'));
  // 主光强度（自定义滑块）：本地立即重打光 + 回传持久化，拖动顺滑不钝。
  // 0~3、步进 0.05，PMX 下此值即最终亮度（无隐藏倍率）；VRM 同理。前面那段"主体光"补光也随此值联动。
  spSlider(sec, '主光强度（自定义）', 0, 3, 0.05, lastOpts.lightKeyIntensity ?? 1.1, v => {
    lastOpts.lightKeyIntensity = v;
    applyLighting(lastOpts.lightingPreset || 'studio', lastOpts.lightingIntensity || 1);
    sendSetting('lightKeyIntensity', v);
  });
  spSlider(sec, '灯光饱和度', 0, 3, 0.1, lastOpts.keySaturation ?? 1, v => sendSetting('keySaturation', v));
  spColor(sec, '灯光颜色', lastOpts.lightKeyColor || '#ffffff', v => sendSetting('lightKeyColor', v));
  body.appendChild(sec);

  sec = spSection('背景');
  const transparent = !(lastOpts.background && /^[0-9a-fA-F]{6}$/.test(lastOpts.background));
  spToggle(sec, '透明背景', transparent, on => sendSetting('background', on ? '' : '#0b0e16'));
  spColor(sec, '底色(关透明时)', lastOpts.background || '#0b0e16', v => sendSetting('background', v));
  body.appendChild(sec);

  sec = spSection('模型');
  scaleSliderEl = spSlider(sec, '大小', 0.4, 2.2, 0.1, lastOpts.scale || 1, v => sendSetting('scale', v));
  // ★ VRM 物理（弹簧骨：头发/裙子/胸）。以前**没有开关**（由 vrm.update 每帧驱动 = 常开），这里补上。
  //   值用数字 1/0：sendSetting 会写回 lastOpts，而字符串 '0' 在 JS 里是真值 ⇒ 会把"关"显示成"开"。
  //   PMX 模型的物理不在这里，走「设置 → MMD → 物理」。
  spToggle(sec, '物理(VRM 弹簧骨：头发/裙子)', vrmPhysicsEnabled(), on => sendSetting('vrmPhysics', on ? 1 : 0));
  sec.appendChild(el('div', 'sp-note', '关掉后头发/裙子/胸不再摆动（固定住），适合摆造型或截图。只对 VRM 模型生效；PMX 用右键「设置 → MMD → 物理」。'));
  // ★★ 穿模旋钮（2026-10-14 拆分，用户实测：旧版推到 2.3 后**头发被撑炸**）：
  //   旧实现把这**一个倍率同时乘到**"关节半径(hitRadius)"和"所有碰撞体半径"⇒
  //     ①头发关节变粗 ⇒ 发丝互相顶开；②头/身体碰撞体变大 ⇒ 头发被推离头 ⇒ 炸毛。
  //   而"防穿模"真正需要放大的只是**躯干/腿上的碰撞体**（裙子/衣服被腿穿过，靠它们撑开）。
  //   —— 现在拆成两个，各管一件事，互不牵连：
  spSlider(sec, '物理·碰体', 0.5, 3, 0.1, springVolumeScale(),
    v => { setSpringVolumeScale(v); applySpringScale._logged = false; try { applySpringScale(lastOpts.scale || 1); } catch (e) { } },
    v => '×' + (+v).toFixed(1),
    '裙子/衣服**被腿穿过去**时调大（1.0 = 模型原值）。只放大**躯干与腿上的碰撞体**，'
    + '头/发上的碰撞体一律不动 ⇒ 不会把头发顶炸。≥2 会把衣服明显顶开，建议 ≤1.6。');
  spSlider(sec, '物理·发丝', 0.5, 3, 0.1, springHitScale(),
    v => { setSpringHitScale(v); try { applySpringScale(lastOpts.scale || 1); } catch (e) { } },
    v => '×' + (+v).toFixed(1),
    '**头发丝之间互相穿**时调大（1.0 = 模型原值）。它只改"每根发丝自己的粗细"，'
    + '推大有副作用：发丝会互相顶开 ⇒ 看着像**炸毛**（所以默认 1.0，别乱推）。');
  // ★ v11.8 新增两个"手感/观感"旋钮（依据 Nyalume 在同类模型上的量化结论）：
  spDropdown(sec, '物理·子步(治发丝微抖)',
    [{ v: '1', t: '关（原样，1 步）' }, { v: '2', t: '2 步（≈120Hz，推荐）' }, { v: '3', t: '3 步' }, { v: '4', t: '4 步（≈240Hz）' }],
    String(springSubSteps()), v => { applySpringSubSteps(+v); });
  sec.appendChild(el('div', 'sp-note', '头发/裙子"一直在微抖"时调高：把每帧物理拆成多个**小步**（步小 = 不过冲、'
    + '浅穿浅推）。实测同类模型 1/65→1/120 抖动率 40.9%→20.2%，再加更多没更好。'
    + '量化对比用控制台 `await petClothProbe(3000)`（抖动率 / 下沉 / 单帧大跳）。'));
  spToggle(sec, '材质观感(MToon 增强)', vrmStyleEnabled(), on => { applyVrmStyle(on); });
  sec.appendChild(el('div', 'sp-note', '材质观感：按「脸 / 头发 / 其他」三组分别调阴影柔度、阴影色（防死黑）、'
    + '轮廓粗细、非脸材质加暖边缘光。默认关，开一下对比就知道喜不喜欢。'));
  body.appendChild(sec);

  sec = spSection('节奏（防"太密集"）');
  // 说明：这三个值目前只存在当前窗口（下次重开回默认）—— 等你调到手感满意，我再把它们落进
  // 插件配置项做持久化（路线图第 7 项），这样就不用反复调。
  spSlider(sec, '动作间隔(秒)', 0, 10, 0.5, motionCooldown, v => { motionCooldown = +v; postLog('info', '节奏：动作间隔 ' + (+v).toFixed(1) + 's'); });
  spSlider(sec, '空档(秒)', 0, 5, 0.1, motionIdleGap, v => { motionIdleGap = +v; postLog('info', '节奏：交接空档 ' + (+v).toFixed(1) + 's'); });
  spSlider(sec, '表情最短保持(秒)', 0, 15, 0.5, exprHoldMin, v => { exprHoldMin = +v; postLog('info', '节奏：表情最短保持 ' + (+v).toFixed(1) + 's'); });

  sec = spSection('待机动画（让它活起来）');
  spToggle(sec, '启用待机动画', idleEnabled, on => sendSetting('idleAnimation', on ? '1' : '0'));
  // 待机现在 = 循环播放短 VRMA 动作；这里调“动作与动作之间”的间隔（0=无缝连播）
  spSlider(sec, '待机动作间隔(秒)', 0, 6, 0.1, lastOpts.idleGap ?? 1.5, v => sendSetting('idleGap', v.toFixed(2)));
  // 待机强度/速度 是“程序化微动”(呼吸/重心摆动)，只对 PMX(MMD) 生效；
  // VRM 的待机完全由 VRMA 动作驱动，这两个滑块对 VRM 没有任何作用，故仅 MMD 时显示。
  if (mmdMesh) {
    spSlider(sec, '待机强度(仅MMD)', 0, 3, 0.1, idleIntensity, v => sendSetting('idleIntensity', v.toFixed(2)));
    spSlider(sec, '待机速度(仅MMD)', 0.5, 2, 0.1, idleSpeed, v => sendSetting('idleSpeed', v.toFixed(2)));
  }
  spToggle(sec, '自动眨眼', blinkEnabled, on => sendSetting('blink', on ? '1' : '0'));
  // 静止表情（基础表情）：让桌宠平时就有表情，而不是面无表情；播放动作时自动让位给舞蹈表情
  const expOpts = [{ v: '', t: '无（仅眨眼）' }].concat(collectExpressions().map(n => ({ v: n, t: n })));
  // 注：onchange 里“本地立即生效”+ sendSetting 持久化，两条都做。
  // 原因：baseExpression/randomExpr 是较新的设置项，宿主（C# 桌宠）未必回传 options_update，
  // 若只靠回传赋值，baseExpression 会一直是 '' → 表情永远不生效。本地先设好，宿主回传时再走 options_update 幂等覆盖。
  spDropdown(sec, '静止表情', expOpts, lastOpts.baseExpression || '', v => { baseExpression = v || ''; applyBaseExpression(); sendSetting('baseExpression', v); });
  spSlider(sec, '静止表情强度', 0, 1, 0.05, lastOpts.baseExpressionWeight ?? 0.6, v => { baseExpressionWeight = Math.max(0, Math.min(1, +v || 0.6)); applyBaseExpression(); sendSetting('baseExpressionWeight', v.toFixed(2)); });
  // 随机表情：待机时每隔一段时间自动换一张脸（与上面的“静止表情”互斥——开了随机就忽略固定表情）
  spToggle(sec, '随机表情', !!lastOpts.randomExpr, on => { randomExpr = !!on; if (!randomExpr) randomExprCur = ''; applyBaseExpression(); sendSetting('randomExpr', on ? '1' : '0'); });
  spSlider(sec, '随机表情间隔(秒)', 2, 30, 1, lastOpts.randomExprInterval ?? 8, v => { randomExprInterval = Math.max(1, +v || 8); sendSetting('randomExprInterval', v); });
  // 预览小动作（本地立即播放，不写配置）：按钮由全部动作清单(allMotions)生成（懒加载，点击时才解析）；
  // 每个按钮播它自己对应的片段——绝不会像以前那样硬编码 wave/nod 去模糊匹配到错的舞蹈片段。
  const actRow = el('div', 'sp-row');
  actRow.appendChild(el('span', 'sp-label', '试试'));
  const actWrap = el('div', 'sp-actions');
  const GESTURE_LABEL = { wave: '挥手', nod: '点头', bow: '鞠躬', sway: '摇摆', stretch: '伸展', twirl: '转身', yawn: '伸懒腰',
    happyjump: '开心跳', heart: '比心', shy: '害羞', tsundere: '傲娇', lookaround: '张望', bounce: '跳一下', jump: '跳一下',
    clap: '鼓掌', surprise: '惊讶', laugh: '笑', dance: '跳舞', idle: '待机', sit: '坐下', run: '跑', walk: '走' };
  const motionNames = playableMotionNames().filter(n => /wave|nod|bow|sway|stretch|twirl|happyjump|heart|tsundere|shy|yawn|lookaround|挥手|点头|鞠躬|摇摆|伸展|转|开心|比心|傲娇|害羞|哈欠|张望|bounce|jump|clap|surprise|laugh|dance|idle|sit|run|walk|弹|鼓掌|惊讶|笑|跳舞|待机|坐下|跑|走|抱|举|拎|拿|抓|hang|drag|carry|hold/i.test(n));
  if (motionNames.length) {
    motionNames.forEach(n => {
      const label = GESTURE_LABEL[n] || GESTURE_LABEL[n.toLowerCase()] || n.replace(/\.(vrma|vrm|glb|gltf)$/i, '');
      const b = el('button', 'sp-btn', label);
      b.title = n;   // 悬停显示真实片段名，便于核对
      b.addEventListener('click', () => playAction(n));
      actWrap.appendChild(b);
    });
  } else {
    actWrap.appendChild(el('span', 'sp-val', '无可用动作'));
  }
  actRow.appendChild(actWrap); sec.appendChild(actRow);
  body.appendChild(sec);

  sec = spSection('动作 / 舞蹈');
  // 注：“当前播放(正在跳哪支)”不再放这里常驻，改为屏幕浮层，仅右键打开动作 UI 时显示
  spToggle(sec, '显示地面参考线', showGroundLine, on => { showGroundLine = on; sendSetting('showGroundLine', on ? '1' : '0'); });
  // ★ 点播的"重复 / 播完就停"开关（默认关 = 点一支动作跳完一支马上停，用户要求）。
  //   值用数字 1/0：sendSetting 会写回 lastOpts，字符串 '0' 在 JS 里是真值 ⇒ 会把"关"显示成"开"。
  spToggle(sec, '点播动作重复播放(默认播完就停)', !!lastOpts.motionLoop, on => sendSetting('motionLoop', on ? 1 : 0));
  spSlider(sec, '时长(秒)', 0, 60, 1, lastOpts.motionDuration || 0, v => sendSetting('motionDuration', v),
    v => (+v).toFixed(0) + 's',
    '仅当上面「重复播放」打开时生效：到期自动停；0 = 一直循环。关闭「重复播放」时，点播一律播完一支就停（此项无效）。');
  spSlider(sec, '动作过渡(秒)', 0, 2, 0.05, lastOpts.motionTransition ?? 0.3, v => sendSetting('motionTransition', v.toFixed(2)));
  spToggle(sec, '自动跳舞', !!lastOpts.autoDance, on => sendSetting('autoDance', on ? '1' : '0'));
  spToggle(sec, '舞蹈时关闭追踪', danceDisableTrack, on => sendSetting('danceDisableTrack', on ? '1' : '0'));
  // 具身动作（实验，默认关）：开启后角色才会用 AI 实时生成动作驱动身体（每轮可能耗 token）；关掉=普通桌宠。
  spToggle(sec, '具身动作(实验，耗token)', !!lastOpts.embodiedMotion, on => sendSetting('embodiedMotion', on ? '1' : '0'));
  // 具身表情（实验，默认关）：AI 控制情绪与眼嘴。**不吃模型、不吃显存**，只是每轮多一点 token。
  spToggle(sec, '具身表情(实验，耗token)', !!lastOpts.embodiedExpression, on => sendSetting('embodiedExpression', on ? '1' : '0'));
  // 情绪 → 表情映射（一次设置、永久有效）：候选表只能靠名字猜语义，很多模型的 happy/joy 是"闭眼笑"，
  // 想要的脸可能是另一张（例如本模型的「星星眼」）。留「自动挑」就用候选表。
  {
    const labels = { happy: '开心', sad: '难过', angry: '生气', relaxed: '放松', surprised: '惊讶', shy: '害羞', thinking: '思考' };
    const EMOS = (window.EmbodiedExpression ? window.EmbodiedExpression.EMOTIONS : ['happy', 'sad', 'angry', 'relaxed', 'surprised', 'shy', 'thinking']);
    const cur = embExprFaceMap();
    const faceOpts = [{ v: '', t: '自动挑' }].concat(collectExpressions().map(n => ({ v: n, t: n })));
    if (faceOpts.length > 1) {
      for (const emo of EMOS) {
        if (emo === 'neutral') continue;
        spDropdown(sec, '表情映射·' + (labels[emo] || emo), faceOpts, cur[emo] || '', v => {
          const m = embExprFaceMap();
          if (v) m[emo] = v; else delete m[emo];
          lastOpts.embodiedFaceMap = Object.keys(m).map(k => k + '=' + m[k]).join(';');
          sendSetting('embodiedFaceMap', lastOpts.embodiedFaceMap);
        });
      }
    }
  }
  spSlider(sec, '具身平滑', 0, 0.3, 0.01, lastOpts.embodiedSmooth ?? 0.05, v => sendSetting('embodiedSmooth', +(+v).toFixed(2)));
  // ★ 表情引擎（VAD + FACS/AU）：情绪不再"整张脸切一个预设"，而是 20 个面部动作单元按 VAD 连续混合、
  //   保持并逐渐衰减；同一套数据还能区分"强势/退缩"（支配度 D）。模型没有任何可用通道时自动退回老链路。
  spToggle(sec, '表情引擎（VAD+FACS 连续表情）', faceEngineOn, on => {
    faceEngineSave(on);
    if (!on) {
      try { if (faceEng) faceEng.engine.reset(); } catch (e) { }
      try { embExprClear(); } catch (e) { }
      embExpr = null;
    }
  });
  sec.appendChild(el('div', 'sp-note', '开：情绪拆成 AU（提眉/收眼/嘴角上扬…）连续演绎，换情绪不会"啪一下换脸"，'
    + '并能用支配度区分强势/退缩。关：退回旧的「情绪→表情名查表」。'
    + (faceEngCoverage ? ('当前模型覆盖 ' + faceEngCoverage.supported + '/' + faceEngCoverage.total + ' 个 AU。') : '')
    + '换模型会自动重新适配；模型没有可用通道时自动退回。'));
  // ★ 表情引擎参数（对齐 SoullinkEmotion3D 的 LabSettings）：预设 + 即时生效的滑条，存 localStorage
  spDropdown(sec, '表情预设', [
    { v: 'natural', t: '自然（推荐）' },
    { v: 'exaggerated', t: '夸张' },
    { v: 'restrained', t: '克制' },
    { v: 'author', t: '作者默认(Soullink demo)' }
  ], facePresetName, v => { facePresetSet(v); });
  const faceSlider = (label, key, min, max, step) => spSlider(sec, label, min, max, step, faceParams[key],
    v => { faceParams[key] = +v; faceParamsApply(); faceParamsSave(); });
  faceSlider('表情强度 ×', 'gain', 0.5, 2.5, 0.05);
  faceSlider('细节占比', 'detailMix', 0, 1, 0.05);
  faceSlider('保持时长 s', 'hold', 0, 12, 0.5);
  faceSlider('衰减半衰期 s', 'halfLife', 2, 20, 0.5);
  faceSlider('逼近速度', 'approach', 0.5, 4, 0.1);
  faceSlider('平滑', 'faceSmoothing', 0.08, 0.6, 0.02);
  faceSlider('眉部增益 ×', 'browGain', 0, 2, 0.05);
  faceSlider('眼部增益 ×', 'eyeGain', 0, 2, 0.05);
  faceSlider('嘴部增益 ×', 'mouthGain', 0, 2, 0.05);
  {
    const r = spRow('参数');
    const b = el('button', 'sp-toggle', '恢复本预设');
    b.addEventListener('click', () => { facePresetSet(facePresetName); postLog('info', '表情参数已恢复为预设：' + facePresetName); });
    r.appendChild(b); sec.appendChild(r);
    sec.appendChild(el('div', 'sp-note', '参数直接改引擎行为：强度=总增益；细节占比=AU 细节权重；'
      + '保持/半衰期=情绪停留多久、回落多快；逼近速度=软硬；分区增益=眉/眼/嘴的相对权重（如害羞可眼↑嘴↓）。'
      + '「作者默认」= SoullinkEmotion3D demo 的原始值。'));
  }
  {   // 环境自检：生成式动作(ardy-mini)的前置条件 → WebGPU 是否可用（点一下看结果，也会写日志）
    const r = spRow('环境自检');
    const b = el('button', 'sp-toggle', '检查 WebGPU');
    const info = el('div', '', '');
    info.style.fontSize = '12px';
    info.style.opacity = '0.75';
    b.addEventListener('click', async () => {
      b.textContent = '检查中…';
      const e = await petEnvProbe();
      b.textContent = (e.gpu === '可用' ? '✅ WebGPU 可用' : '❌ ' + (e.gpu || '探测失败'));
      info.textContent = 'Chromium ' + (e.chromium || '?') + ' · f16:' + (e.f16 || '-') + ' · Node:' + (e.node || '-') +
        (e.adapter ? ' · ' + e.adapter : '') + (e.note ? ' · ' + e.note : '');
    });
    r.appendChild(b); sec.appendChild(r); sec.appendChild(info);
  }
  {   // 生成式动作第 1 步自检：把 ardy 运行时跑通（加载模型 + 生成一段），**先不驱动模型**
    const r = spRow('生成式动作');
    const b = el('button', 'sp-toggle', '▶ 第1步自检(试跑 ardy)');
    const info = el('div', '', '');
    info.style.fontSize = '12px'; info.style.opacity = '0.75';
    info.textContent = '需 urdy 权重在 Storage/ThreeDeskPet/Ardy；首次要读 684MB 建 WebGPU 会话，较慢';
    b.addEventListener('click', async () => {
      b.textContent = '运行中…（首次较慢，别关窗口）';
      const res = window.ardyTest ? await window.ardyTest('a person waves hello with the right hand') : null;
      b.textContent = res ? '✅ 运行时跑通（详情见日志）' : '❌ 失败（详情见日志）';
    });
    r.appendChild(b); sec.appendChild(r); sec.appendChild(info);

    // 第 2 步：写一句英文动作提示 → ardy 生成 40 帧(约 2 秒) → 重定向到当前 VRM → 真的摆出来
    const b2 = el('button', 'sp-toggle', '▶ 第2步自检(生成→重定向→播放)');
    const info2 = el('div', '', '');
    info2.style.fontSize = '12px'; info2.style.opacity = '0.75';
    info2.textContent = '生成约 6 秒/段；播完自动把骨骼还给待机/跳舞';
    b2.addEventListener('click', async () => {
      b2.textContent = '生成中…（约 6 秒，首次更慢，别关窗口）';
      const ok2 = window.ardyPlay ? await window.ardyPlay('a person raises the right hand high above the head and waves hello') : null;
      b2.textContent = ok2 ? '✅ 已重定向并播放（详情见日志）' : '❌ 失败（详情见日志）';
    });
    r.appendChild(b2); sec.appendChild(r); sec.appendChild(info2);

    // ① 批量试跑候选词条：把 ardy-phrases.json 的 candidates **一次跑完**，日志按 `[词条试跑 i/N] 短语` 分段。
    //   为什么要它：白名单的规则是"必须真机实测过『签名』才能进 verified"，一条条手工点太慢；
    //   这里一次跑完 → 把日志给开发者，就能判定哪几条合格、该写进 verified（写进去后 AI 立刻能用 gen: 调它）。
    const b3 = el('button', 'sp-toggle', '▶ 批量试跑候选词条');
    const info3 = el('div', '', '');
    info3.style.fontSize = '12px'; info3.style.opacity = '0.75';
    info3.textContent = '逐个跑 ardy-phrases.json 的 candidates（每条约 6 秒生成 + 2 秒播放；22 条约 3 分钟）；'
      + '日志按 [词条试跑 i/N] 分段，跑完把日志发出来判签名';
    b3.addEventListener('click', async () => {
      if (!window.ardyPlay) { postLog('error', 'ardyPlay 未加载（ardy-client.js 没进来？）'); return; }
      let list = [];
      try {
        const r0 = await fetch('ardy-phrases.json', { cache: 'no-store' });
        const j0 = await r0.json();
        list = (j0 && Array.isArray(j0.candidates)) ? j0.candidates.slice() : [];
      } catch (e) { postLog('error', '读 ardy-phrases.json 失败：' + e.message); return; }
      if (!list.length) { postLog('warn', 'candidates 为空（ardy-phrases.json）'); return; }
      postLog('info', '词条试跑开始：共 ' + list.length + ' 条');
      for (let i = 0; i < list.length; i++) {
        if (!b3.isConnected) { postLog('warn', '面板已关 → 试跑中断（第 ' + (i + 1) + ' 条起未跑）'); break; }
        const ph = list[i];
        b3.textContent = '试跑中 ' + (i + 1) + '/' + list.length + '…';
        postLog('info', '===== [词条试跑 ' + (i + 1) + '/' + list.length + '] ' + ph + ' =====');
        try { await window.ardyPlay(ph); } catch (e) { postLog('error', '词条试跑异常：' + e.message); }
        await new Promise(r1 => setTimeout(r1, 2600));   // 等它播完再跑下一条，免得两条互相覆盖
      }
      b3.textContent = '✅ 试跑结束（把日志发出来判签名）';
      postLog('info', '词条试跑结束');
    });
    r.appendChild(b3); sec.appendChild(r); sec.appendChild(info3);

    // ★ 这里原来是「▶ 蹲下自检(生成→播放)」，用的是提示词 "a person squats down and stands up" ——
    //   而那句在 ardy-phrases.json 的 rejected 里早被证伪（生成出来是健身宽站蹲/马步 + 跨步，不是蹲）。
    //   更糟的是：想试"蹲"的人最自然会点这个按钮 → 看见马步 + 跨步 + 忽上忽下，就以为"蹲做不出来"。
    //   所以换成**解析 IK 的蹲/跪**（确定解、脚踩地、膝自己弯），把生成式那条路明确标为不可靠。
    const rCrouch2 = spRow('蹲 / 跪（自动 IK · 推荐）');
    const bCrouch = el('button', 'sp-toggle', '▶ 蹲下');
    const bKneel = el('button', 'sp-toggle', '▶ 跪下');
    bCrouch.addEventListener('click', () => {
      try {
        window.embodiedPoseOnce(JSON.stringify({ crouch: 0.85, steps: [
          { pose: { spinePitch: 6, headPitch: 8 }, dur: 0.02, ease: 'linear' },
          { pose: { spinePitch: 6, headPitch: 8 }, dur: 3, ease: 'linear' }] }));
      } catch (e) { postLog('error', '蹲下失败：' + e.message); }
    });
    bKneel.addEventListener('click', () => {
      try {
        window.embodiedPoseOnce(JSON.stringify({ kneel: 0.9, steps: [
          { pose: { spinePitch: 8 }, dur: 0.02, ease: 'linear' },
          { pose: { spinePitch: 8 }, dur: 3, ease: 'linear' }] }));
      } catch (e) { postLog('error', '跪下失败：' + e.message); }
    });
    const infoCrouch = el('div', '', '这两个走**解析 IK**（膝屈 + 骨盆高度 + 勾脚联立解，脚原地踩住），'
      + '日志会打「蹲/跪已解算：下沉 …cm｜膝屈 …°」。\n'
      + '⚠ 别用「生成式动作」试蹲：本地模型没有地面/IK 概念，它生成的 squat 是健身宽站蹲（马步 + 跨步 + 上下起伏）。');
    infoCrouch.style.fontSize = '12px'; infoCrouch.style.opacity = '0.75'; infoCrouch.style.whiteSpace = 'pre-wrap';
    rCrouch2.appendChild(bCrouch); rCrouch2.appendChild(bKneel); sec.appendChild(rCrouch2); sec.appendChild(infoCrouch);

    // 生成动作的手感旋钮（即时生效，不用重开窗口；控制台同样可用 ardyTune({...})）
    spSlider(sec, '生成动作·骨盆权重', 0, 1, 0.05, ARDY_WEIGHT.hips, v => ardyTune({ hips: +v }));
    spSlider(sec, '生成·根移', 0, 1.5, 0.05, ardyRootWeight, v => ardyTune({ root: +v }));
    spSlider(sec, '生成动作·下肢权重', 0, 1, 0.05, ARDY_WEIGHT.leftUpperLeg, v => ardyTune({ leg: +v }));
    spSlider(sec, '生成动作·脊柱权重', 0, 1, 0.05, ARDY_WEIGHT.spine, v => ardyTune({ spine: +v }));
    spSlider(sec, '生成动作·平滑(秒)', 0, 0.3, 0.01, ardySmoothTau, v => ardyTune({ smooth: +v }));
    spSlider(sec, '生成·淡出', 0.05, 2, 0.05, ardyFadeOut, v => ardyTune({ fadeOut: +v }));
    // ★ 第 5 项：脚部 IK（治滑步）。**默认 0 = 完全不影响现状**，想试就往上推。
    spSlider(sec, '生成·脚IK', 0, 1, 0.05, ardyFootIK, v => ardyTune({ footIK: +v }), v => (+v).toFixed(2),
      '钉住落地脚、消除"在原地平移"的滑步。**默认 0（关闭）**；建议 0.5~0.8。'
      + '落地判定优先用 ardy 的 footContacts（认不出就按脚速自判）；脚一抬起立即松开，不会拽住抬腿。'
      + '只改两条腿的旋转，不动骨盆/基础姿势。');

    // ---- 动作人设 ----
    // 编辑按"改动频率"分两处：
    //   · 5 段文本（我是谁 / 近况 / 惯用 / 忌讳 / 签名）→「插件配置 → 3D桌宠」：写字要宽窗口；
    //   · **5 个关键参数**（幅度 / 节奏 / 小动作密度 / 平滑 / 静定）→ **在这里复制一份**：
    //     调手感是高频动作，不该每次都跑去配置页 —— 这个面板才是手边最近的入口。
    const idiStatus = el('div', '', '');
    idiStatus.style.fontSize = '12px'; idiStatus.style.opacity = '0.78'; idiStatus.style.whiteSpace = 'pre-wrap';
    sec.appendChild(idiStatus);

    const idiNumSpec = {
      amp: ['幅度', 0.3, 1.5, 0.05], tempo: ['节奏', 0.5, 2, 0.05], density: ['小动作密度', 0, 3, 1],
      smooth: ['平滑(秒)', 0, 0.3, 0.01], stillness: ['静定', 0, 1, 0.05]
    };
    const idiNumEd = {};
    // 只给"光看名字猜不出效果"的两项；幅度/节奏/密度拖一下就明白，不写说明（免得面板变长）
    const IDI_DESC = {
      smooth: '平滑：大=柔和（略糊），小=跟手（更利落、也可能更抖）。',
      stillness: '静定：大=冷淡少动（头/脊椎不太跟光标），小=活泼好动。'
    };
    for (const k of MOTION_IDIOM_NUM_FIELDS) {
      const sp = idiNumSpec[k];
      // 拖动**即时生效**（本地直接改手感）；松手才写回宿主（避免每帧发消息、也避免把更新时间刷成今天）
      const inp = spSlider(sec, '人设·' + sp[0], sp[1], sp[2], sp[3], motionIdiomDraft[k],
        v => { motionIdiomDraft[k] = +v; applyMotionIdiomFeel(); }, null, IDI_DESC[k]);
      inp._fmt = x => (+x).toFixed(2);
      if (inp._valEl) inp._valEl.textContent = (+motionIdiomDraft[k]).toFixed(2);
      inp.addEventListener('change', () => {
        postLog('info', '人设参数：' + sp[0] + ' = ' + motionIdiomDraft[k] + '（即时生效，已写回）');
        persistIdiomDraft();
      });
      idiNumEd[k] = inp;
    }

    const rIdi = spRow('动作人设');
    const bIdiRewrite = el('button', 'sp-toggle', '让 AI 重写');
    bIdiRewrite.addEventListener('click', () => sendMenu('motion_idiom', { cmd: 'rewrite' }));
    const bIdiReset = el('button', 'sp-toggle', '恢复默认');
    bIdiReset.addEventListener('click', () => resetIdiomFeel());
    rIdi.appendChild(bIdiRewrite); rIdi.appendChild(bIdiReset); sec.appendChild(rIdi);

    // 提醒间隔也放这——它虽然偏"策略"，但同样属于"调一次就想立刻看到效果"的项
    spSlider(sec, '人设·更新提醒(天)', 0, 60, 1, +(lastOpts.motionIdiomRefreshDays ?? 14),
      v => sendSetting('motionIdiomRefreshDays', String(Math.round(+v))), v => Math.round(+v) + ' 天',
      '0=不提醒。到期会在 AI 的信息里加一行提醒它按最新记忆重写（不占对话回合）。');

    motionIdiomEditors = { num: idiNumEd, status: idiStatus };
    motionIdiomFillEditors();
  }
  {   // ---- 造型编辑器：用户看着画面摆姿势 → 存成具名造型 → 所有 AI 都能用 ----
    // 这条路线是为了绕开一个死结：造型类姿势（比心/叉腰/抱臂/耍帅）**必须看着画面调**，
    // 作者看不见、AI 也没有三维直觉 —— 用角度硬凑试过两次都失败并撤掉了。
    // 所以把"摆"交给用户（拖滑块，即时可见），摆好存下来，之后 AI 说 <bodyact preset="比心"/> 就行。
    const tip = el('div', '', '拖动下面滑块摆姿势（即时可见）→ 填名字点「保存」→ 之后 AI 就能用 <bodyact preset="名字"/>。\n'
      + '每个关节都给了**三个自由度**（自转 + 两向摆动，肢体主轴可到 ±180°），可以像真人关节那样拧；'
      + '躯干/头的范围收窄了（过头会明显穿模）。');
    tip.style.fontSize = '12px'; tip.style.opacity = '0.78'; tip.style.whiteSpace = 'pre-wrap';
    sec.appendChild(tip);

    const COMP = window.EmbodiedCompose;
    const chans = (COMP && COMP.channelNames) ? COMP.channelNames() : [];
    const CH_LABEL = {
      lShoulderUp: '左肩·耸', rShoulderUp: '右肩·耸', lShoulderFwd: '左肩·前', rShoulderFwd: '右肩·前',
      lArmUp: '左上臂·抬', rArmUp: '右上臂·抬', lArmFwd: '左上臂·前摆', rArmFwd: '右上臂·前摆',
      lArmTwist: '左上臂·自转', rArmTwist: '右上臂·自转',
      lElbow: '左肘·屈', rElbow: '右肘·屈', lElbowSide: '左小臂·外摆', rElbowSide: '右小臂·外摆',
      lElbowTwist: '左小臂·旋', rElbowTwist: '右小臂·旋',
      lHandTurn: '左手·转掌', rHandTurn: '右手·转掌',
      lHandBend: '左手·压翘', rHandBend: '右手·压翘', lHandSide: '左手·左右', rHandSide: '右手·左右',
      headPitch: '头·点', headYaw: '头·转', headRoll: '头·歪',
      spinePitch: '脊柱·躬', spineYaw: '脊柱·转', spineRoll: '脊柱·侧弯',
      chestPitch: '胸·躬', chestYaw: '胸·转', chestRoll: '胸·侧弯',
      hipsPitch: '胯·前倾(上身跟)', hipsYaw: '胯·转(上身跟)', hipsRoll: '胯·侧倾(上身跟)',
      lLegFwd: '左腿·前抬', rLegFwd: '右腿·前抬', lLegSide: '左腿·侧开', rLegSide: '右腿·侧开',
      lLegTwist: '左腿·自转', rLegTwist: '右腿·自转', lKnee: '左膝·屈', rKnee: '右膝·屈',
      lAnkle: '左脚·勾绷', rAnkle: '右脚·勾绷', lAnkleSide: '左脚·内外翻', rAnkleSide: '右脚·内外翻',
      lToes: '左脚趾·翘', rToes: '右脚趾·翘'
    };
    // 幅度：**肢体给到 ±180**（关节本来就是 360° 可转的球窝），躯干/头收一些（过头明显穿模、也不像人）。
    // 0 一定要落在区间内 —— 滑块初值就是 0（= 自然姿势）。
    const CH_RANGE = {
      lShoulderUp: [-35, 45], rShoulderUp: [-35, 45], lShoulderFwd: [-45, 45], rShoulderFwd: [-45, 45],
      lArmUp: [-180, 180], rArmUp: [-180, 180], lArmFwd: [-180, 180], rArmFwd: [-180, 180],
      lArmTwist: [-180, 180], rArmTwist: [-180, 180],
      lElbow: [-30, 170], rElbow: [-30, 170], lElbowSide: [-180, 180], rElbowSide: [-180, 180],
      lElbowTwist: [-180, 180], rElbowTwist: [-180, 180],
      lHandTurn: [-180, 180], rHandTurn: [-180, 180], lHandBend: [-90, 90], rHandBend: [-90, 90],
      lHandSide: [-60, 60], rHandSide: [-60, 60],
      headPitch: [-45, 45], headYaw: [-80, 80], headRoll: [-45, 45],
      spinePitch: [-40, 60], spineYaw: [-60, 60], spineRoll: [-45, 45],
      chestPitch: [-35, 45], chestYaw: [-50, 50], chestRoll: [-40, 40],
      // 胯的幅度**单独收窄**：骨盆一转，整个上身跟着走、两个髋窝也会位移（腿脚被带着平移），
      // 角度一大就"像整个人在转/晃"。实测 20~30° 已经很明显了。
      hipsPitch: [-30, 30], hipsYaw: [-35, 35], hipsRoll: [-25, 25],
      lLegFwd: [-180, 180], rLegFwd: [-180, 180], lLegSide: [-180, 180], rLegSide: [-180, 180],
      lLegTwist: [-180, 180], rLegTwist: [-180, 180], lKnee: [-20, 170], rKnee: [-20, 170],
      lAnkle: [-60, 60], rAnkle: [-60, 60], lAnkleSide: [-45, 45], rAnkleSide: [-45, 45],
      lToes: [-60, 60], rToes: [-60, 60]
    };
    const poseDraft = {}, poseSliders = {};
    // ★★ 面板数值的"记忆"（**按模型**存，重载/换模型后还在）：
    //   ① 首选：上次面板真正发出去的数值（下面每 ~2 秒落盘一次 `rigSet('draft','last',…)`）；
    //   ② 其次：配置里的 `__` 保留键（C# 保存的造型）。
    //   为什么必须回填：面板草稿若是 0，**定时续持会把这份 0 又发下去** ⇒ 人物被拉回站立
    //   （用户实测："检查数值是 0 又给放回去了，变成站立姿态"）。回填 + 原样重发（见 sendPoseNow）双保险。
    // `_lastSpecPayload` 也从本模型存档里恢复（= 上次发出去的那份 spec）：这样重载后
    //   ①"续持"仍原样重发正确的姿势；②面板数值有据可依（你只说手动拖滑块 ⇒ 这份记录就是唯一真相）。
    let _draftSavePending = null, _draftSaveTimer = null, _draftSavedT = 0;
    let _lastSpecPayload = null;
    try { const _p = rigGet('draft', 'payload', null); if (typeof _p === 'string' && _p) _lastSpecPayload = _p; } catch (e) { }
    const _draftLast = (() => { try { const d = rigGet('draft', 'last', null); return (d && typeof d === 'object') ? d : {}; } catch (e) { return {}; } })();
    const _draftBody = (_draftLast.body && typeof _draftLast.body === 'object') ? _draftLast.body : {};
    const _ovCfg = poseOverrides[currentPose] || {};
    // ③ 第三来源：配置里的"造型库"（`customPoses`）取**最后保存的那个**—— 也就是你刚摆好的造型。
    //    （面板草稿与 poseOffsets 都为空时用它，数值立刻正确，不必等下次拖动。）
    let _cpLast = null;
    try {
      const cp = JSON.parse(lastOpts.customPoses || 'null');
      if (cp && typeof cp === 'object') { const ks = Object.keys(cp); if (ks.length) _cpLast = cp[ks[ks.length - 1]]; }
    } catch (e) { }
    const _bodySeed = (Object.keys(_draftBody).length ? _draftBody : (_cpLast || _ovCfg));
    for (const ch of chans) poseDraft[ch] = +_bodySeed[ch] || 0;

    // 预览：第一段 dur=0.01 → 第一帧就已经是目标姿势（不会先闪一下中性），第二段长时间"顶住"。
    // 为什么需要定时重发：compose 的时间线**末尾会自动补一段"回到中性"**（防止收尾瞬跳），
    // 所以任何姿势过一会儿都会自己收回直立 —— 摆姿势期间每隔一会儿重发一次就顶住了。
    // （时长也不能太大：帧队列有 900 帧上限，40s×20fps=800 正好还在限内，再长会被截断成只剩收尾段。）
    let poseHoldTimer = null;
    let poseRootY = 0;                 // 根位移（裸降骨盆，不弯膝）：负 = 整体下移
    let poseCrouch = 0, poseKneel = 0; // 蹲 / 跪：交给腿部解析 IK（膝屈 + 骨盆高度 + 勾脚联立解）
    let poseTurn = 0;                  // 整体转身（°）：转整个模型，背对观众 = ±180
    // ★ 这四个同样按"上次发出的数值"（其次配置的 `__` 键；存的是百分比：蹲/跪/下沉 ×100，转身是度）回填。
    try {
      if (isFinite(+_draftLast.turn)) poseTurn = +_draftLast.turn;
      else if (isFinite(+_ovCfg['__turn'])) poseTurn = +_ovCfg['__turn'];
      else if (_cpLast && isFinite(+_cpLast['__turn'])) poseTurn = +_cpLast['__turn'];
      if (isFinite(+_draftLast.crouch)) poseCrouch = +_draftLast.crouch;
      else if (isFinite(+_ovCfg['__crouch'])) poseCrouch = +_ovCfg['__crouch'] / 100;
      else if (_cpLast && isFinite(+_cpLast['__crouch'])) poseCrouch = +_cpLast['__crouch'] / 100;
      if (isFinite(+_draftLast.kneel)) poseKneel = +_draftLast.kneel;
      else if (isFinite(+_ovCfg['__kneel'])) poseKneel = +_ovCfg['__kneel'] / 100;
      else if (_cpLast && isFinite(+_cpLast['__kneel'])) poseKneel = +_cpLast['__kneel'] / 100;
      if (isFinite(+_draftLast.rootY)) poseRootY = +_draftLast.rootY;
      else if (isFinite(+_ovCfg['__rootY'])) poseRootY = +_ovCfg['__rootY'] / 100;
      else if (_cpLast && isFinite(+_cpLast['__rootY'])) poseRootY = +_cpLast['__rootY'] / 100;
    } catch (e) { }
    // 逐指控制：每只手 = 5 根手指的弯曲 + 1 个张开 ⇒ 共 12 个滑块。
    //   **不是** 30 个指节滑块（那样面板会炸，见 embodied-compose.js:396 的设计取舍），
    //   而是引擎 spec 里本来就有的那几个数：{curl, thumb, index, middle, ring, little, spread}。
    // 为什么必须补：面板以前只给 8 个固定手型下拉 ⇒ "比心 / OK"这类**要逐指精细角度**的造型
    //   根本摆不出来（用户实测："手指调不了"）。下拉现在只当**种子**（选中即把该手型的数值灌进滑块），
    //   之后逐指微调 —— 这才是"看着画面摆造型"能落地的前提。
    const FINGER_KEYS = ['thumb', 'index', 'middle', 'ring', 'little'];
    // ★★ 拇指是**球窝关节**，一个"卷"根本不够 —— 用户原话："单调一个平移怎么可能够，xy 轴加弯曲起码三个滑块，
    //   跟其他四指不一样"。四指是铰链，只要"卷 + 张开"；拇指要**三个独立自由度**：
    //     卷(thumb)      = 朝掌心屈（0~250 = 伸直~满卷，满卷角度由本模型自标定）
    //     摆(thumbSide)  = 内收/外展（正 = 离开掌心张开；负 = 往掌心里收）
    //     转(thumbRoll)  = 绕拇指自身长轴翻掌面（做"对掌 / 捏"这类造型时用它调朝向）
    //   [键, 标签, min, max, step, 显示格式化, 说明]
    const THUMB_DOF = [
      ['thumbBase', '拇指·根节弯', 0, 250, 5, v => Math.round(v),
        '近节（根部关节）屈 —— 0~250 = 伸直~满屈（"满屈"取本模型自标定的整根满卷角，日志 `满卷 XX°`）。'],
      ['thumbTip', '拇指·指尖弯', 0, 250, 5, v => Math.round(v),
        '末节（指尖关节）屈 —— **单独勾指尖**用它（四指做不到、拇指可以）。'],
      ['thumbSide', '拇指·摆(内收↔外展)', -150, 150, 5, v => (v > 0 ? '+' : '') + Math.round(v) + '°',
        '正 = 离开掌心/张开（外展）；负 = 往掌心里收（内收）。捏/对掌通常要收。'],
      ['thumbRoll', '拇指·转(对掌朝向)', -180, 180, 5, v => (v > 0 ? '+' : '') + Math.round(v) + '°',
        '绕拇指自身长轴**拧** —— 只改"掌面朝向"，**不产生弯曲**（所以觉得它像"只是转一下"是对的）。']
    ];
    const FINGER_LABEL = { thumb: '拇指', index: '食指', middle: '中指', ring: '无名指', little: '小指', spread: '五指张开' };
    const zeroFingers = () => ({ thumbBase: 0, thumbTip: 0, thumbSide: 0, thumbRoll: 0, index: 0, middle: 0, ring: 0, little: 0, spread: 0 });
    let poseFingerL = zeroFingers(), poseFingerR = zeroFingers();
    // ★ 手指数值同样优先按"上次发出的数值"，其次已保存造型的 `__fl_*` / `__fr_*` 保留键回填。
    try {
      const _dlF = (_draftLast.fingers && typeof _draftLast.fingers === 'object') ? _draftLast.fingers : null;
      for (const k in poseFingerL) {
        if (_dlF && _dlF.l && isFinite(+_dlF.l[k])) poseFingerL[k] = +_dlF.l[k];
        else if (isFinite(+_ovCfg['__fl_' + k])) poseFingerL[k] = +_ovCfg['__fl_' + k];
        else if (_cpLast && isFinite(+_cpLast['__fl_' + k])) poseFingerL[k] = +_cpLast['__fl_' + k];
        if (_dlF && _dlF.r && isFinite(+_dlF.r[k])) poseFingerR[k] = +_dlF.r[k];
        else if (isFinite(+_ovCfg['__fr_' + k])) poseFingerR[k] = +_ovCfg['__fr_' + k];
        else if (_cpLast && isFinite(+_cpLast['__fr_' + k])) poseFingerR[k] = +_cpLast['__fr_' + k];
      }
    } catch (e) { }
    const poseFingerInps = { l: {}, r: {} };   // 手指滑块（供"下拉种子"与"清这组"回写显示）
    // 只有真调过手指才发 fingers：全 0 = "不动手指"。若把全 0 发下去，等于强令五指伸直，
    // 会把手型从"继承/不干预"变成"明确伸直"，盖掉别人的层。
    const mkFingers = (st) => {
      if (!st) return null;
      // ★★ 全 0 **必须照样发出去**，它的语义是"**五指明确伸直**"。
      //   旧代码在全 0 时返回 null（注释写着"全 0 = 不动手指"）⇒ 用户把滑条清零后，
      //   手指**保持上一次的弯曲、回不去**（2026-10-13 实测原话："清零了，还是没变回去"）；
      //   而且下一次调高会让人以为"在原有弯曲上继续弯"。想真的"不干预手指"的调用方，
      //   走 `sendPoseNow(..., noFingers=true)`（那条路直接传 null），不要靠"全 0"来表达。
      const o = { curl: 0, spread: +st.spread || 0 };
      for (const k of FINGER_KEYS) if (k !== 'thumb') o[k] = +st[k] || 0;
      // 拇指：两个关节 + 摆 + 转（不发老字段 `thumb`，免得两条路打架）
      o.thumbBase = +st.thumbBase || 0;
      o.thumbTip = +st.thumbTip || 0;
      o.thumbSide = +st.thumbSide || 0;
      o.thumbRoll = +st.thumbRoll || 0;
      return o;
    };
    // ★★ 落盘"面板数值"（按模型存：①前端 ②宿主配置）。两个要点：
    //   ① **空草稿不自动覆盖** —— 否则"面板一打开/某次全 0 的发送"会把好存档冲成 0
    //      （用户实测："除了手指一系列的参数保存了，其他的都没保存，都是 0"）。
    //   ② 主动清空（一键清空/清这组）走 `force=true`，**必须**把清空也存下去，
    //      否则下次打开又把旧值读回来 ⇒ "清不干净"（用户实测）。
    const persistDraft = (force) => {
      try {
        const bodyZero = !poseDraft || Object.keys(poseDraft).every(k => Math.abs(+poseDraft[k] || 0) < 0.5);
        const zL = !Object.keys(poseFingerL).some(k => Math.abs(+poseFingerL[k] || 0) > 0.5);
        const zR = !Object.keys(poseFingerR).some(k => Math.abs(+poseFingerR[k] || 0) > 0.5);
        const allZero = bodyZero && zL && zR && !(+poseTurn || +poseCrouch || +poseKneel || +poseRootY);
        if (allZero && !force) return;
        const obj = {
          body: Object.assign({}, poseDraft),
          fingers: { l: Object.assign({}, poseFingerL), r: Object.assign({}, poseFingerR) },
          turn: poseTurn, crouch: poseCrouch, kneel: poseKneel, rootY: poseRootY,
          payload: _lastSpecPayload,     // 连 spec 一起存 ⇒ 重载后续持仍重发正确姿势
          t: Date.now(),                 // ★★ v11.1：存档带时间戳 ⇒ 恢复时能报"存于多久之前"
        };
        _draftSavePending = obj;
        const t = Date.now();
        // ★★ v11.1 修（用户实测："保存还没做好，加载的很老的数值"——只改过手臂那排数值）：
        //   旧实现节流 **2 秒**，且只在"松手后 2 秒"才补一次 ⇒ 只要你在 2 秒内**重载插件/换模型/**关窗口**，
        //   最后一次改动就**没写进去** ⇒ 下次恢复出来的是更早那份（看起来就是"加载了很老的数值"）。
        //   现在：① 节流降到 600ms；② 页面要隐藏/卸载时**立刻落盘**（重载插件走的就是这条路）。
        if (force || t - _draftSavedT > 600) { _draftSavedT = t; rigSet('draft', 'last', obj); }
        else if (!_draftSaveTimer) {
          _draftSaveTimer = setTimeout(() => {
            _draftSaveTimer = null; _draftSavedT = Date.now();
            if (_draftSavePending) rigSet('draft', 'last', _draftSavePending);
          }, 600);
        }
        const flushDraft = () => {
          try {
            _draftSavedT = Date.now();
            if (_draftSavePending) rigSet('draft', 'last', _draftSavePending);
          } catch (e) { }
        };
        try {
          if (!persistDraft._hooked) {
            persistDraft._hooked = true;
            window.addEventListener('pagehide', flushDraft);        // 重载插件/关窗口
            window.addEventListener('beforeunload', flushDraft);
            document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushDraft(); });
            window.petFlushPoseDraft = flushDraft;                  // 别处（换模型等）需要时可直接调用
          }
        } catch (e) { }
      } catch (e) { }
    };
    const sendPoseNow = (pose, hold, refresh, noFingers) => {
      // ★★ 续持（refresh）**原样重发上一次真正发出去的 spec**，绝不用面板草稿重算：
      //   草稿可能是 0（刚重载、被清空、或当前造型是别处应用的）⇒ 重发就会把人物**拉回站立**
      //   （用户实测原话："经过一定时间…检查数值是 0 又给放回去了，变成站立姿态"——就是这里）。
      //   原样重发 ⇒ 续持在语义上只是"顶住不倒"，永远不改变姿势。
      if (refresh && _lastSpecPayload) {
        try { window.embodiedPoseOnce(_lastSpecPayload, { autoKeep: true }); } catch (e) { postLog('error', '续持重发失败：' + e.message); }
        return;
      }
      const fingers = {};
      const fl = noFingers ? null : mkFingers(poseFingerL), fr = noFingers ? null : mkFingers(poseFingerR);
      if (fl) fingers.l = fl;
      if (fr) fingers.r = fr;
      // ★★ refresh（15 秒一次的"续持"）必须**平滑过渡**：否则上一段动作刚播完，这里会以 0.01s
      //   瞬间把人物拽回草稿姿势 ⇒ 用户看到的就是"最后一下扭曲崩了"（日志实证：播完 → 801 帧
      //   保持以 0.01s 硬跳回来，还带着草稿里的 `整体转身 45°`）。
      // ★★ 拖动那条路也不能再是 0.01s（2026-10-13 实证）：拖滑条时每秒替换 ~10 次队列，
      //   每次都在 **0.01s 内瞬移**到新姿势 ⇒ 单帧就能跳 125°（手臂）/175°（头发），
      //   看门狗抓到的两条正是这样（`具身接管=true 保持剪辑=true 队列=807/203帧`，0.09~0.37s 又回来）
      //   ⇒ 用户看到的就是"抽搐一下又回来"。0.15s 仍然"跟手"（人眼约 150ms 内都算即时），
      //   但把单帧步长压到 ~13°（60fps），不再是一次瞬移。
      const headDur = refresh ? 0.35 : 0.15;
      const headEase = refresh ? 'inout' : 'linear';
      const steps = hold
        ? [{ pose: pose, dur: headDur, ease: headEase }, { pose: pose, dur: 40, ease: 'linear' }]
        : [{ pose: pose, dur: 0.35, ease: 'inout' }];
      try {
        // ★ `start: pose` = 把"正在发送的姿势"作为剪辑的**起始姿势** ⇒ 首段是"同姿势→同姿势" ⇒ **零位移**。
        //   不加它就是旧行为（每段从全 0 中性起步）⇒ 每次重发都会先往中性沉一下 = 胳膊抽搐 / 15s 闪烁。
        const payload = JSON.stringify({ rootY: poseRootY, crouch: poseCrouch, kneel: poseKneel, turn: poseTurn, start: pose, fingers: fingers, steps: steps });
        _lastSpecPayload = payload;          // ★ 记下来：续持原样重发它（见函数开头），姿势就不会被"顶"回站立
        window.embodiedPoseOnce(payload);
        // ★★ v11.2 修（用户实测："保存还没做好，加载的很老的数值"，后来又出现
        //   `造型存档：读到草稿｜通道 0 项｜无 spec` ⇒ **好存档被写成空**）：
        //   原来这里只要"这次发出去的是全 0"就 `persistDraft(true)`（强制落盘）——
        //   但"全 0"有两种来源：①**用户主动清空**（该落盘）②**草稿还没载入 / 本来就是空**
        //   （模型刚加载、面板刚打开、续持定时器第一次跑都以空草稿发送）⇒ ②会把好存档抹掉。
        //   现在**只由明确的清空按钮**去 force 落盘（那些地方本来就直接调 persistDraft(true)），
        //   这里不再自动写空档。
        //   （"清不干净"的问题仍由清空按钮那条路覆盖：它们会把 payload 一起写成全 0。）
      } catch (e) { postLog('error', '造型预览失败：' + e.message); }
      // ★ 记住"这次发出去的数值"（按模型；空草稿不覆盖、清空走 force，见 persistDraft 注释）
      try { persistDraft(false); } catch (e) { }
      if (!hold) { clearInterval(poseHoldTimer); poseHoldTimer = null; return; }
      if (!poseHoldTimer) poseHoldTimer = setInterval(() => {
        if (!sec.isConnected) { clearInterval(poseHoldTimer); poseHoldTimer = null; return; }   // 面板已关 → 停
        // ★ 正在播"真动作"（试做/ AI 下发）时不打断它 —— 等它播完再续持，否则会把动作拦腰砍断
        if (!embodiedQueueIsHold && embodiedQueue.length) return;
        // ★★ 保持剪辑**尾巴自带"回到中性"**（compose 为防止收尾瞬跳会自动补一段），所以必须在它播完
        //   **之前**就顶上，否则人物会周期性地**收回站立姿势**、等下一次定时器才摆回来 ——
        //   用户实测症状："调完姿势，隔一段固定时间变成初始站立姿态，然后又回去"。
        //   现在：剩余 <100 帧（5s）就续；且定时器 2s 一跳 ⇒ 最多晚 2s 顶上，永远吃不到尾段。
        //   （"重发会闪/抽"这个老毛病已由 `start` 起始姿势从根上解决，所以可以放心勤续持。）
        if (embodiedQueueIsHold && embodiedQueue.length > 100) return;
        sendPose(poseDraft, true, true);
      }, 2000);
    };

    // ★★ 拖动限流 —— 这条**必须**有。滑条每动一下（`input` 事件可到 60/s）就会走一次 sendPose：
    //   而 hold 模式的 spec 是「0.01s 跟手 + **40 秒保持**」⇒ 一支 **809 帧**的剪辑，
    //   而且 `embodiedPoseOnce` 是**整队替换**（还顺带停掉 ardy 层）。
    //   实测（用户日志）：一秒内塞了 ~20 支 809 帧剪辑 —— 后果有两层：
    //   ① 白白烧 CPU（每支要合成 800+ 帧 × 30 关节）；
    //   ② **每次整队替换都是一次"交接"**（清队 → 重新灌帧 → 平滑状态重置），
    //      交接那一帧很容易露出底下的基础姿势 ⇒ 肉眼就是"抽到另一个姿势一瞬间又回来"。
    //   限流到 ~10 次/秒，并保证**松手后一定补发最后一次**（否则最后一格停不到位、拖完不回正）。
    let _poseSendT = 0, _poseSendTimer = null, _poseSendArgs = null;
    const sendPose = (pose, hold, refresh, noFingers) => {
      const nowMs = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
      const MIN_MS = 100;
      if (!hold || nowMs - _poseSendT >= MIN_MS) {          // 非 hold（收回/归零）必须立即生效
        _poseSendT = nowMs; sendPoseNow(pose, hold, refresh, noFingers); return;
      }
      _poseSendArgs = [pose, hold, refresh, noFingers];      // 拖太快 → 只留最后一次，稍后补发
      if (_poseSendTimer) return;
      _poseSendTimer = setTimeout(() => {
        _poseSendTimer = null;
        _poseSendT = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
        const a = _poseSendArgs; _poseSendArgs = null;
        if (a) { try { sendPoseNow(a[0], a[1], a[2], a[3]); } catch (e) { } }
      }, MIN_MS);
    };
    // ★ 给"设置面板里的轴向/手指方向开关"一个立刻重发的入口（见 setPoseFamilyMode）：
    //   改了方向符号后，正在播的造型剪辑还是老轴算出来的 ⇒ 不重发就得等下次拖滑块/重载模型。
    window.__poseResend = () => { try { sendPose(poseDraft, true); } catch (e) { } };
    window.__poseResendClear = () => { try { window.__poseResend = null; } catch (e) { } };

    // 蹲 / 跪：**自动解算双腿**（骨盆降到哪、膝屈多少、脚踝反勾多少是同一个三角形的三个量，
    // 必须联立解 —— 这就是以前"调不动膝盖、蹲不像蹲"的原因）。脚自动踩在原地，不必手调。
    // 注意：这两种模式下，手写的腿/膝/踝通道会被 IK 覆盖（它们是配套算出来的，单独写没有意义）。
    // ★ 初值同样回填（否则"蹲着"重开面板显示 0，和上面通道滑条是同一类病）：0~100 = 0~100%
    const crouchInp = spSlider(sec, '造型·蹲下', 0, 100, 1,
      Math.max(0, Math.min(100, Math.round((+poseCrouch || 0) * 100))), v => {
      poseCrouch = (+v) / 100; poseKneel = 0;
      if (kneelInp) { kneelInp.value = 0; if (kneelInp._valEl) kneelInp._valEl.textContent = '0'; }
      sendPose(poseDraft, true);
    }, v => Math.round(+v));
    const kneelInp = spSlider(sec, '造型·跪下(自动)', 0, 100, 1,
      Math.max(0, Math.min(100, Math.round((+poseKneel || 0) * 100))), v => {
      poseKneel = (+v) / 100; poseCrouch = 0;
      if (crouchInp) { crouchInp.value = 0; if (crouchInp._valEl) crouchInp._valEl.textContent = '0'; }
      sendPose(poseDraft, true);
    }, v => Math.round(+v));
    // 这排"自动姿势"是自洽的：不会因为草稿里别的通道而算错（手臂/头的值只会**叠加**在画面上，
    // 这是有意保留的组合能力，例如"蹲下 + 抱胸"）。要擦掉乱拖的残留，用各组标题旁的「清这组」即可。
    // 手型下拉 = **种子**：选中只是把该手型的数值灌进下面的逐指滑块，之后继续逐指微调。
    // （HAND_SHAPES 里本来就有 half「半握」，旧下拉漏了它 —— 一并补上。）
    const HAND_OPTS = [
      { v: '', t: '（不动手指）' }, { v: 'relaxed', t: '自然半握' }, { v: 'half', t: '半握' },
      { v: 'open', t: '摊平' }, { v: 'spread', t: '五指张开' }, { v: 'fist', t: '握拳' },
      { v: 'point', t: '指人' }, { v: 'thumb_up', t: '竖拇指' }, { v: 'victory', t: '剪刀手' }
    ];
    const seedFingers = (st, inps, shapeName) => {
      const HS = (window.EmbodiedCompose && window.EmbodiedCompose.HAND_SHAPES) || null;
      const def = (shapeName && HS) ? HS[shapeName] : null;
      const bc = (def && isFinite(+def.curl)) ? +def.curl : 0;      // 未逐指定值的指 = 用 curl 基准
      // 四指（拇指不在这里 —— 它有 4 个自由度，下面单独处理）
      for (const k of FINGER_KEYS) {
        if (k === 'thumb') continue;
        const v = (def && def[k] != null && isFinite(+def[k])) ? +def[k] : bc;
        st[k] = v;
        const inp = inps[k];
        if (inp) { inp.value = v; if (inp._valEl) inp._valEl.textContent = Math.round(v) + '°'; }
      }
      // 拇指两个关节：手型只写 `thumb`（整体语义）时**两节都取它**（与 compose 的向后兼容规则一致）；
      //   写了 thumbBase / thumbTip 就各自用各自的。
      {
        const hasExplicit = !!(def && (def.thumbBase != null || def.thumbTip != null));
        const tLegacy = (def && def.thumb != null && isFinite(+def.thumb)) ? +def.thumb : 0;
        for (const key of ['thumbBase', 'thumbTip']) {
          let v = (def && def[key] != null && isFinite(+def[key])) ? +def[key] : (hasExplicit ? 0 : tLegacy);
          v = Math.max(0, Math.min(250, v));
          st[key] = v;
          const inp = inps[key];
          if (inp) { inp.value = v; if (inp._valEl) inp._valEl.textContent = Math.round(v); }
        }
      }
      // 拇指的摆 / 转（真实角度）
      for (const d of THUMB_DOF) {
        if (d[0] === 'thumbBase' || d[0] === 'thumbTip') continue;
        let v = (def && def[d[0]] != null && isFinite(+def[d[0]])) ? +def[d[0]] : 0;
        v = Math.max(-180, Math.min(180, v));
        st[d[0]] = v;
        const inp = inps[d[0]];
        if (inp) { inp.value = v; if (inp._valEl) inp._valEl.textContent = d[5](v); }
      }
      st.spread = (def && isFinite(+def.spread)) ? +def.spread : 0;
      const sp = inps.spread;
      if (sp) { sp.value = st.spread; if (sp._valEl) sp._valEl.textContent = Math.round(st.spread) + '°'; }
      sendPose(poseDraft, true);
    };
    const handLInp = spDropdown(sec, '造型·左手型(种子)', HAND_OPTS, '', v => seedFingers(poseFingerL, poseFingerInps.l, v));
    const handRInp = spDropdown(sec, '造型·右手型(种子)', HAND_OPTS, '', v => seedFingers(poseFingerR, poseFingerInps.r, v));
    {   // ---- 逐指滑块（比心 / OK 这类造型全靠它）----
      const fhd = el('div', '', '— 手指（逐指微调；上面下拉=种子）—');
      fhd.style.fontSize = '12px'; fhd.style.opacity = '0.6'; fhd.style.margin = '10px 0 2px';
      const bFClr = el('button', 'sp-toggle', '清这组');
      bFClr.style.cssText = 'margin-left:8px;font-size:11px;padding:0 6px;';
      bFClr.addEventListener('click', () => {
        for (const sd of ['l', 'r']) {
          const st = (sd === 'l') ? poseFingerL : poseFingerR;
          const z = zeroFingers();
          for (const k in z) st[k] = 0;
          for (const k in poseFingerInps[sd]) {
            const inp = poseFingerInps[sd][k];
            if (inp) { inp.value = 0; if (inp._valEl) inp._valEl.textContent = '0°'; }
          }
        }
        sendPose(poseDraft, true);
        persistDraft(true);   // 手指组的清空同样落盘
        postLog('info', '已清空手指（逐指全部归零 = 明确伸直）');
      });
      fhd.appendChild(bFClr); sec.appendChild(fhd);
      for (const sd of ['l', 'r']) {
        const st = (sd === 'l') ? poseFingerL : poseFingerR;
        const sideTxt = (sd === 'l') ? '左' : '右';
        // 拇指：**三个独立滑块**（卷 / 摆 / 转）—— 球窝关节，跟四指不一样
        for (const d of THUMB_DOF) {
          const inp = spSlider(sec, '造型·' + sideTxt + d[1], d[2], d[3], d[4], (+st[d[0]] || 0),
            v => { st[d[0]] = +v; sendPose(poseDraft, true); }, d[5], d[6]);
          poseFingerInps[sd][d[0]] = inp;
        }
        // 四指 + 张开（铰链关节，各 1 个自由度）
        for (const k of ['index', 'middle', 'ring', 'little', 'spread']) {
          const mx = (k === 'spread') ? 40 : 250;
          const inp = spSlider(sec, '造型·' + sideTxt + FINGER_LABEL[k], 0, mx, 5, (+st[k] || 0),
            v => { st[k] = +v; sendPose(poseDraft, true); }, v => Math.round(+v) + '°');
          poseFingerInps[sd][k] = inp;
        }
      }
    }

    // 标签写清楚：这一行是"清空"，不是"执行动作"（上一版写成「自动姿势」容易误解成按钮）。
    const rAutoClear = spRow('一键清空 ↓ 这四项');
    const bAutoClear = el('button', 'sp-toggle', '清·蹲跪转身/下沉');
    bAutoClear.addEventListener('click', () => {
      poseCrouch = 0; poseKneel = 0; poseTurn = 0; poseRootY = 0;
      for (const inp of [crouchInp, kneelInp, turnInp, rootInp]) if (inp) { inp.value = 0; if (inp._valEl) inp._valEl.textContent = '0'; }
      sendPose(poseDraft, true);
      // 打一行日志：按钮"点了没反应"这件事以前只能靠猜（画面没变可能是别的原因）——现在有确凿记录。
      postLog('info', '已清空自动姿势（蹲/跪/转身/下沉 全部归零）');
    });
    rAutoClear.appendChild(bAutoClear); sec.appendChild(rAutoClear);

    // 裸降骨盆（不弯膝）保留一个入口：坐下 / 纯粹下沉重心这类"不需要屈膝"的场合用它。
    // ★ 初值回填：滑条 0~100 ↔ poseRootY 0~-0.35（反向换算），否则"下沉着"重开面板显示 0。
    const rootInp = spSlider(sec, '造型·下沉', 0, 100, 1,
      Math.max(0, Math.min(100, Math.round(-(+poseRootY || 0) / 0.35 * 100))), v => {
      poseRootY = -0.35 * (+v) / 100;      // 最多下移 0.35 模型单位（约可视身高的 1/4）
      sendPose(poseDraft, true);
    }, v => Math.round(+v));
    // 整体转身：转**整个模型**（含脚）—— 大幅转身 / 背对观众用它，别用「胯·转」去凑。
    // 「胯·转」是骨盆相对腿（腿钉在原地），只能小角度；拧到 180° 是把胯相对腿拧死 = 反关节。
    const turnInp = spSlider(sec, '造型·转身°', -180, 180, 5,
      Math.max(-180, Math.min(180, +poseTurn || 0)), v => {
      poseTurn = +v;
      sendPose(poseDraft, true);
    }, v => Math.round(+v) + '°',
      '转整个人（含脚）；「胯·转」只转骨盆、腿钉在原地，拧不到 90° 以上。');

    // 通道现在是"每个关节三自由度"（自转 + 两向摆动），数量翻了几倍 → 按部位加小标题，否则一长条滑块找不到北
    const GROUP_OF = {
      lShoulderUp: '肩', rShoulderUp: '肩', lShoulderFwd: '肩', rShoulderFwd: '肩',
      lArmUp: '手臂', rArmUp: '手臂', lArmFwd: '手臂', rArmFwd: '手臂', lArmTwist: '手臂', rArmTwist: '手臂',
      lElbow: '手臂', rElbow: '手臂', lElbowSide: '手臂', rElbowSide: '手臂', lElbowTwist: '手臂', rElbowTwist: '手臂',
      lHandTurn: '手', rHandTurn: '手', lHandBend: '手', rHandBend: '手', lHandSide: '手', rHandSide: '手',
      headPitch: '头 / 躯干 / 胯', headYaw: '头 / 躯干 / 胯', headRoll: '头 / 躯干 / 胯',
      spinePitch: '头 / 躯干 / 胯', spineYaw: '头 / 躯干 / 胯', spineRoll: '头 / 躯干 / 胯',
      chestPitch: '头 / 躯干 / 胯', chestYaw: '头 / 躯干 / 胯', chestRoll: '头 / 躯干 / 胯',
      hipsPitch: '头 / 躯干 / 胯', hipsYaw: '头 / 躯干 / 胯', hipsRoll: '头 / 躯干 / 胯',
      lLegFwd: '腿 / 脚', rLegFwd: '腿 / 脚', lLegSide: '腿 / 脚', rLegSide: '腿 / 脚',
      lLegTwist: '腿 / 脚', rLegTwist: '腿 / 脚', lKnee: '腿 / 脚', rKnee: '腿 / 脚',
      lAnkle: '腿 / 脚', rAnkle: '腿 / 脚', lAnkleSide: '腿 / 脚', rAnkleSide: '腿 / 脚',
      lToes: '腿 / 脚', rToes: '腿 / 脚'
    };
    // 分组 → 通道表（给"只清这一组"用）
    const GROUP_CHANS = {};
    for (const ch of chans) { const g0 = GROUP_OF[ch] || ''; if (g0) (GROUP_CHANS[g0] || (GROUP_CHANS[g0] = [])).push(ch); }
    let lastGroup = '';
    for (const ch of chans) {
      const g = GROUP_OF[ch] || '';
      if (g && g !== lastGroup) {
        lastGroup = g;
        const hd = el('div', '', '— ' + g + ' —');
        hd.style.fontSize = '12px'; hd.style.opacity = '0.6'; hd.style.margin = '10px 0 2px';
        // 「清这组」：乱拖留下的残留一键去掉，**不必按总归零**（你在别的组里辛苦摆好的姿势不受影响）。
        const bClr = el('button', 'sp-toggle', '清这组');
        bClr.style.cssText = 'margin-left:8px;font-size:11px;padding:0 6px;';
        bClr.addEventListener('click', () => {
          for (const c of (GROUP_CHANS[g] || [])) {
            poseDraft[c] = 0;
            const s2 = poseSliders[c];
            if (s2) { s2.value = 0; if (s2._valEl) s2._valEl.textContent = '0°'; }
          }
          sendPose(poseDraft, true);
          persistDraft(true);   // 分组清空也要落盘，否则下次打开又回来
          postLog('info', '已清空「' + g + '」这一组通道');
        });
        hd.appendChild(bClr);
        sec.appendChild(hd);
      }
      const rg = CH_RANGE[ch] || [-180, 180];
      // ★ 初值用**草稿里的值**（不再写死 0）—— 否则重载后数值在草稿里、滑条却显示 0
      //   （用户实测："除了手指一系列的参数保存了，其他的都没保存，都是 0"——其实是显示问题+覆盖问题）
      const inp = spSlider(sec, '造型·' + (CH_LABEL[ch] || ch), rg[0], rg[1], 2, (+poseDraft[ch] || 0),
        v => { poseDraft[ch] = +v; sendPose(poseDraft, true); },
        x => Math.round(+x) + '°');
      inp._fmt = x => Math.round(+x) + '°';
      // ★★ 这里原来还有一行 `if (inp._valEl) inp._valEl.textContent = '0°';` ——
      //   它**无条件**把数字写成 0°，把上面刚种进去的草稿值盖掉。这正是你报的
      //   "相应改动部分的滑块数值还全都是 0 / 我上次的都清零了"：
      //   **数据在、人也摆着那个姿势、旋钮位置也对，只有"数字"被这行写成了 0**
      //   （所以"看着像没保存"，其实是显示层撒谎）。删掉它 —— 显示统一由 spSlider 的 fmt 负责
      //   （初值 / 拖动 / 手输三条路一致）。
      poseSliders[ch] = inp;
    }

    // ★★ 面板打开即把**恢复出来的数值重新套用一次** —— 让"面板显示 == 画面"永远成立
    //   （用户报的"把之前的数值重新加载进来了，但滑块数字全是 0"就是这两者不一致：
    //     姿势是旧 payload 顶着的、数字被写成了 0）。
    //   安全性：`sendPose` 带 `start: pose` ⇒ 是"同姿势→同姿势"⇒ 零位移，不会抽一下；
    //   且**全 0 草稿不发送**（0 的语义是"明确归零/伸直"，不该在打开面板时强行加给模型）。
    try {
      const FKEYS = ['thumbBase', 'thumbTip', 'thumbSide', 'thumbRoll', 'index', 'middle', 'ring', 'little', 'spread'];
      const nCh = Object.keys(poseDraft).filter(k => Math.abs(+poseDraft[k] || 0) > 0.5).length;
      const nFin = (['l', 'r'].reduce((n, sd) => {
        const st = (sd === 'l') ? poseFingerL : poseFingerR;
        return n + FKEYS.filter(k => Math.abs(+st[k] || 0) > 0.5).length;
      }, 0));
      const nAuto = ['turn', 'crouch', 'kneel', 'rootY'].filter(k => !!+({ turn: poseTurn, crouch: poseCrouch, kneel: poseKneel, rootY: poseRootY })[k]).length;
      if (nCh || nFin || nAuto) {
        sendPose(poseDraft, true);
        postLog('info', '造型面板：已按本模型存档回填并重新套用（通道 ' + nCh + ' 项'
          + (nFin ? '｜手指 ' + nFin + ' 项' : '') + (nAuto ? '｜蹲跪转身下沉 ' + nAuto + ' 项' : '')
          + '）；滑块数字与画面一致。');
      }
    } catch (e) { }

    const rSave = spRow('存为造型');
    const nameInp = document.createElement('input');
    nameInp.type = 'text'; nameInp.className = 'sp-select'; nameInp.maxLength = 12;
    nameInp.placeholder = '名字（如 比心）';
    nameInp.style.width = '34%'; nameInp.style.fontSize = '12px';
    const bSave = el('button', 'sp-toggle', '保存');
    const bZero = el('button', 'sp-toggle', '归零');
    const bBack = el('button', 'sp-toggle', '收回');
    bSave.addEventListener('click', () => {
      const nm = (nameInp.value || '').trim();
      if (!nm) { postLog('warn', '造型：先填个名字'); return; }
      // ★ 手指 / 转身 / 蹲跪 / 下沉必须**一起存**：旧代码只存了 poseDraft（通道角度）⇒
      //   "摆好手势 → 保存 → AI 用 <bodyact preset="名字"/> 播"时手指与转身全丢
      //   （实测症状：存完只有身体姿势，手指仍是默认状态；比心存了等于没存）。
      //   存法：用 `__` 前缀的**保留键**塞进同一张"通道名 → 数值"平面表 ⇒
      //   C# 的造型存储（Dictionary<string, Dictionary<string, double>>）一行都不用改。
      //   crouch/kneel/rootY 存成百分比：C# 会丢弃 |值| ≤ 0.5 的项，0.3 的蹲会被静默吃掉。
      const payload = Object.assign({}, poseDraft);
      for (const k of FINGER_KEYS) { payload['__fl_' + k] = poseFingerL[k]; payload['__fr_' + k] = poseFingerR[k]; }
      payload['__fl_spread'] = poseFingerL.spread; payload['__fr_spread'] = poseFingerR.spread;
      payload['__turn'] = poseTurn;
      payload['__crouch'] = poseCrouch * 100; payload['__kneel'] = poseKneel * 100;
      payload['__rootY'] = poseRootY * 100;
      sendMenu('pose_save', { name: nm, pose: JSON.stringify(payload) });
    });
    bZero.addEventListener('click', () => {
      for (const ch of chans) { poseDraft[ch] = 0; const s = poseSliders[ch]; if (s) { s.value = 0; if (s._valEl) s._valEl.textContent = '0°'; } }
      poseRootY = 0; poseCrouch = 0; poseKneel = 0; poseTurn = 0;   // 蹲/跪/下沉/转身一起归零
      for (const sd of ['l', 'r']) {                                 // 手指一起归零
        const st = (sd === 'l') ? poseFingerL : poseFingerR;
        const z = zeroFingers(); for (const k in z) st[k] = 0;
        for (const k in poseFingerInps[sd]) {
          const inp = poseFingerInps[sd][k];
          if (inp) { inp.value = 0; if (inp._valEl) inp._valEl.textContent = '0°'; }
        }
      }
      if (handLInp) handLInp.value = ''; if (handRInp) handRInp.value = '';   // 下拉回到「（不动手指）」
      if (rootInp) { rootInp.value = 0; if (rootInp._valEl) rootInp._valEl.textContent = '0'; }
      if (turnInp) { turnInp.value = 0; if (turnInp._valEl) turnInp._valEl.textContent = '0°'; }
      if (crouchInp) { crouchInp.value = 0; if (crouchInp._valEl) crouchInp._valEl.textContent = '0'; }
      if (kneelInp) { kneelInp.value = 0; if (kneelInp._valEl) kneelInp._valEl.textContent = '0'; }
      sendPose(poseDraft, true);
      // ★★ 「清空"清不干净"」的**真正原因**（2026-10-14 定位）：`sendPose` 是**限流**的
      //   （100ms 内只留最后一次、延后补发，见 sendPose 的 MIN_MS）⇒ 执行到下一行时
      //   `_lastSpecPayload` **往往还是上一次的旧 spec**，旧代码把它一起存了下去 ⇒
      //   存档里就一直躺着"几个版本之前那次"的姿势，重开面板/重载后"续持"把它又发出来
      //   （用户实测："我都全清零了没保存，还是好多个版本之前保存的一次，还得打开设置面板才加载的姿势"）。
      //   所以清空必须**显式把 spec 也清掉**（后面那条延后补发会用全 0 草稿重建一份中性 spec，
      //   并由 sendPoseNow 里的 allZero 分支强制落盘）。
      _lastSpecPayload = null;
      persistDraft(true);     // ★ 清空必须**存下去**：否则下次打开面板又把旧值读回来 = "清不干净"
    });
    // 「收回」= 回中性，手指也要**一起松开**（否则人会直立但五指还捏着）
    bBack.addEventListener('click', () => sendPose({}, false, false, true));
    rSave.appendChild(nameInp); rSave.appendChild(bSave); rSave.appendChild(bZero); rSave.appendChild(bBack);
    sec.appendChild(rSave);

    const rList = spRow('已有造型');
    const delSel = document.createElement('select');
    delSel.className = 'sp-select'; delSel.style.width = '44%'; delSel.style.fontSize = '12px';
    poseListRefresh = () => {
      delSel.innerHTML = '';
      if (!customPoseNames.length) { const o = document.createElement('option'); o.value = ''; o.textContent = '（还没有）'; delSel.appendChild(o); return; }
      for (const n of customPoseNames) { const o = document.createElement('option'); o.value = n; o.textContent = n; delSel.appendChild(o); }
    };
    const bDel = el('button', 'sp-toggle', '删除');
    bDel.addEventListener('click', () => { const n = delSel.value; if (n) sendMenu('pose_delete', { name: n }); });
    rList.appendChild(delSel); rList.appendChild(bDel); sec.appendChild(rList);
    poseListRefresh();
    // 自检用：造型面板的滑条 ↔ 草稿 对照（两个对象都是"原地改"的 ⇒ 暴露引用即可一直有效）
    window.__stPose = { sliders: poseSliders, draft: poseDraft };
  }
  {   // 真实通道自检：注入一段内置示例动作（需上面的开关为“开”才生效）
    const r = spRow('具身示例');
    const b = el('button', 'sp-toggle', '▶ 播放示例');
    b.addEventListener('click', () => { if (window.embodiedPlaySample) window.embodiedPlaySample(); });
    r.appendChild(b); sec.appendChild(r);
  }
  {   // 关键帧合成自检：用预设“挥手”走 <bodyact> 同一条链路
    const r = spRow('试做动作');
    const b = el('button', 'sp-toggle', '▶ 挥手');
    b.addEventListener('click', () => { if (window.embodiedBodyAct) window.embodiedBodyAct({ preset: 'wave' }); });
    r.appendChild(b);
    const b2 = el('button', 'sp-toggle', '✊ 伸手→握拳');
    b2.style.marginLeft = '8px';
    b2.addEventListener('click', () => { if (window.embodiedBodyAct) window.embodiedBodyAct({ preset: 'reach_fist' }); });
    r.appendChild(b2);
    // ★ v11.23：敬礼（大臂前抬 + 肘大幅弯曲 123° + 手贴额侧）—— "接触型姿势"的现成范例：
    //   末段空段保持 ⇒ 惯性归零 ⇒ 手贴得稳；想让 AI 学怎么写大屈肘动作就用它当例子。
    const b8 = el('button', 'sp-toggle', '🎖 敬礼');
    b8.style.marginLeft = '8px';
    b8.addEventListener('click', () => { if (window.embodiedBodyAct) window.embodiedBodyAct({ preset: 'salute' }); });
    r.appendChild(b8); sec.appendChild(r);
    // ★ v11.10：跳（蓄力→弹起→滞空→落地缓冲）。三档 + 两个"连"的入口：不用控制台、不用等 AI，
    //   点一下就能看到"真跳"和"连跳"长什么样（也方便和之前那段 40 秒"保持"对比）。
    const r2 = spRow('试做·跳');
    const b3 = el('button', 'sp-toggle', '⤒ 轻快蹦');
    b3.addEventListener('click', () => { if (window.embodiedBodyAct) window.embodiedBodyAct({ preset: 'jump' }); });
    r2.appendChild(b3);
    const b4 = el('button', 'sp-toggle', '⤒⤒ 用力跳');
    b4.style.marginLeft = '8px';
    b4.addEventListener('click', () => { if (window.embodiedBodyAct) window.embodiedBodyAct({ preset: 'jump_power' }); });
    r2.appendChild(b4);
    const b5 = el('button', 'sp-toggle', '🙌 欢呼跳');
    b5.style.marginLeft = '8px';
    b5.addEventListener('click', () => { if (window.embodiedBodyAct) window.embodiedBodyAct({ preset: 'jump_joy' }); });
    r2.appendChild(b5); sec.appendChild(r2);
    const r3 = spRow('试做·连');
    const b6 = el('button', 'sp-toggle', '⌒ 连蹦两下');
    b6.addEventListener('click', () => { if (window.embodiedBodyAct) window.embodiedBodyAct({ preset: 'jump_x2' }); });
    r3.appendChild(b6);
    const b7 = el('button', 'sp-toggle', '🔗 连跳两下(chain)');
    b7.style.marginLeft = '8px';
    b7.addEventListener('click', () => {
      try {
        if (!window.embodiedBodyAct) return;
        // ★ 连招最小验证：第一条标 chain（末尾不回中性，末帧保持 1.2s 等接续），1.05s 后发第二条接上。
        window.embodiedBodyAct({ preset: 'jump', chain: true });
        setTimeout(() => { try { window.embodiedBodyAct({ preset: 'jump' }); } catch (e) { } }, 1050);
      } catch (e) { }
    });
    r3.appendChild(b7); sec.appendChild(r3);
    sec.appendChild(el('div', 'sp-note', '跳：蓄力下压 → 弹起 → 滞空 → 落地缓冲（轻快蹦 ~1.05s / 用力跳 ~1.6s 深蹲式）。'
      + '连：「连蹦两下」是一条预置跑完两跳；「连跳两下(chain)」是两条动作靠 chain 接起来 —— 对比两者的衔接。'));
  }
  spDropdown(sec, '跳舞风格', [{ v: '0', t: '随机' }, { v: '1', t: '顺序' }], String(lastOpts.danceStyle ?? 0), v => sendSetting('danceStyle', v));
  spSlider(sec, '跳舞时长(秒)', 3, 60, 1, lastOpts.danceDuration ?? 14, v => sendSetting('danceDuration', v));
  spSlider(sec, '跳舞过渡(秒)', 0, 3, 0.1, lastOpts.danceTransition ?? 1.2, v => sendSetting('danceTransition', v.toFixed(2)));
  // 跳舞时自动叠加的表情（用模型自带的表情名；动作自带表情轨道时以自带的为准）
  const exprOpts = [{ v: '', t: '不自动' }, { v: 'random', t: '随机' }].concat(collectExpressions().map(n => ({ v: n, t: n })));
  spDropdown(sec, '跳舞表情', exprOpts, lastOpts.danceExpression || '', v => sendSetting('danceExpression', v));
  // 动作列表：点一下即播放（套用上面的时长/过渡）。始终显示本栏，没动作时给提示，避免"整栏消失"造成困惑。
  const motions = collectMotions();
  const mRow = el('div', 'sp-row');
  mRow.appendChild(el('span', 'sp-label', '动作列表'));
  const mWrap = el('div', 'sp-actions');
  if (motions.length) {
    motionBtns = {};
    // ★★ v11.49「按曲名分组」（用户："一大长串放那儿很烦，想挑动作都不好找"）：
    //   动作名是「目录/文件」形式（如 AI猫ダンス/AI猫ダンス）。曲包多时平铺几十上百个按钮根本没法找。
    //   现在按 `/` **前面那段**分组：组内 ≤2 个直接平铺（分组反而绕），>2 个就收成一个可折叠的
    //   「组名 (n)」—— 点一下展开。正在播的那支所在的组**自动展开**，并高亮那支。
    const groups = new Map();
    const noGroup = [];
    motions.forEach(n => {
      const i = String(n).indexOf('/');
      const g = i > 0 ? String(n).slice(0, i) : '';
      if (!g) { noGroup.push(n); return; }
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(n);
    });
    const addBtn = (parent, n) => {
      const b = el('button', 'sp-btn', n);
      if (n === currentMotionName) b.classList.add('sp-btn-active');   // 高亮正在播放的那支（在动作选择 UI 里直接看出在跳什么）
      b.addEventListener('click', () => playMotionByName(n));
      parent.appendChild(b);
      motionBtns[n] = b;
    };
    noGroup.forEach(n => addBtn(mWrap, n));
    groups.forEach((list, gname) => {
      if (list.length <= 2) { list.forEach(n => addBtn(mWrap, n)); return; }
      const box = el('div', 'sp-group');
      const head = el('button', 'sp-btn sp-group-head', gname + ' (' + list.length + ')');
      const inner = el('div', 'sp-actions sp-group-body hidden');
      const open = !!currentMotionName && list.some(n => n === currentMotionName);
      if (open) inner.classList.remove('hidden');
      head.addEventListener('click', () => {
        inner.classList.toggle('hidden');
        try { reframe(); reportUiBounds(); } catch (e) { }
      });
      list.forEach(n => addBtn(inner, n));
      box.appendChild(head); box.appendChild(inner);
      mWrap.appendChild(box);
    });
  } else {
    const st = window.__motionStat;
    let note;
    if (st && st.total > 0) {
      note = '传入 ' + st.total + ' 个动作，但成功 0 个（失败 ' + st.fail + '）。请打开桌宠窗口控制台(右键→检查/DevTools)看报错，或把失败名发我。';
    } else {
      note = '未检测到动作文件。把 .vrma 放到模型目录下的 motions 文件夹，然后右键桌宠 → 重新加载模型/动作（或重启 Alife）。';
    }
    mWrap.appendChild(el('div', 'sp-note', note));
  }
  mRow.appendChild(mWrap); sec.appendChild(mRow);
  body.appendChild(sec);

  sec = spSection('互动 / 窗口');
  spToggle(sec, '头部追踪', headTrack, on => sendSetting('enableHeadTrack', on ? '1' : '0'));
  spSlider(sec, '头部/眼部追踪强度', 0, 1.5, 0.1, headTrackStrength, v => sendSetting('headTrackStrength', v.toFixed(2)));
  spToggle(sec, '脊椎追踪', spineTrack, on => sendSetting('enableSpineTrack', on ? '1' : '0'));
  spSlider(sec, '脊椎追踪强度', 0, 1.5, 0.1, spineTrackStrength, v => sendSetting('spineTrackStrength', v.toFixed(2)));
  spToggle(sec, '全屏光标追踪', !!lastOpts.cursorTracking, on => sendSetting('cursorTracking', on ? '1' : '0'));
  spToggle(sec, '置顶', windowTopState, on => sendSetting('windowTop', on ? '1' : '0'));
  spToggle(sec, '鼠标穿透(空白处穿透到桌面)', lastOpts.mouseThrough !== false, on => sendSetting('mouseThrough', on ? '1' : '0'));
  body.appendChild(sec);

  sec = spSection('互动触发（省 token）');
  const noteEl = el('div', 'sp-note', '关掉后该互动只做动作/表情，不会唤起 AI 说话，也就不消耗 token。');
  sec.appendChild(noteEl);
  spToggle(sec, '戳一下 → 触发回复', !!lastOpts.pokeTriggersAi, on => sendSetting('pokeTriggersAi', on ? '1' : '0'));
  spToggle(sec, '打招呼 → 触发回复', !!lastOpts.greetTriggersAi, on => sendSetting('greetTriggersAi', on ? '1' : '0'));
  spToggle(sec, '摸到 → 触发回复（任意部位）', !!lastOpts.patTriggersAi, on => sendSetting('patTriggersAi', on ? '1' : '0'));
  spSlider(sec, '冷却(秒)', 0, 120, 5, lastOpts.interactionCooldown || 0, v => sendSetting('interactionCooldown', v));
  // ★★ 用户反馈（2026-10-14）："这个鼠标摸是干什么的，备注字多被挤掉省略了就几个字没看懂"
  //   ⇒ ①名字改短、②说明拆成**每行一个 div**（多行短句，一定不被挤成省略号）。
  spToggle(sec, '鼠标摸（把光标当手指）', touchPhysicsEnabled(),
    on => { setTouchPhysics(on); if (on) touchPhysicsOn = true; });
  spSlider(sec, '手指粗细(半径)', 0.02, 0.15, 0.005, touchRadius(), v => setTouchRadius(+v), v => (+v).toFixed(3),
    '小球越大推得越开。建议 0.05 ~ 0.10；太大就像有根棍子在拨头发。');
  const tl1 = el('div', 'sp-note', '【鼠标摸是什么】光标处放一个看不见的小球当"手指"：'
    + '它碰到头发 / 裙子 / 胸时，这些部位会被**物理地推开**（真实碰撞，不是播动画），像用手指拨一下。');
  const tl2 = el('div', 'sp-note', '· 生效条件：模型配了 VRM 弹簧骨。本模型有；PMX 模型没有这套，开了也没反应。');
  const tl3 = el('div', 'sp-note', '· 默认关；它只负责"被推开"这个物理效果，不影响其它功能。');
  const tl4 = el('div', 'sp-note', '· 会不会让 AI 说话：由上面「摸到 → 触发回复（任意部位）」+「互动冷却」决定 '
    + '—— 关掉就不烧 token。');
  for (const t of [tl1, tl2, tl3, tl4]) { t.style.margin = '0 0 3px 2px'; sec.appendChild(t); }
  body.appendChild(sec);

  sec = spSection('姿势（骨骼微调，动作翻车可自行掰正）');
  spDropdown(sec, '当前姿势', [{ v: 'stand', t: '站立' }, { v: 'sit', t: '坐' }, { v: 'lieback', t: '仰躺' }], currentPose || 'stand', v => { sendMenu('posture', { pose: v }); const w = sec._bonesWrap; if (w) buildPoseBones(w); });
  // ★ 轴向自动校正（实测）：有些转换模型（PMX→VRM）的骨骼局部轴与作者写 RELAX/POSES 的约定**同轴反号**，
  //   表现就是"拖『上』却往『下』"。加载时已量出（日志 `姿势轴向` 那行），这里只控制**是否把它作用到微调值**上；
  //   RELAX / 姿势预设不受影响（避免把当前看着正常的基础姿势改坏）。觉得更糟就关掉。
  const fxList = Object.keys(window.PoseAxisFix || {});
  // ★ 「自动」现在的含义 = **用自证结论**（抬臂应向上/前摆应向前，量得出就按它，量不出就不动）。
  //   想完全按自己拖的原样施加 ⇒ 选「不反转」；方向反了 ⇒ 选「反转」。三者都会按模型记住。
  const famOpts = [{ v: 'auto', t: '自动(用自证结论)' }, { v: 'flip', t: '反转' }, { v: 'off', t: '不反转' }];
  spDropdown(sec, '微调轴向·手臂/手', famOpts, poseFamilyMode('arm'), v => { setPoseFamilyMode('arm', v); try { refreshPoseTargets(); } catch (e) { } });
  spDropdown(sec, '微调轴向·腿', famOpts, poseFamilyMode('leg'), v => { setPoseFamilyMode('leg', v); try { refreshPoseTargets(); } catch (e) { } });
  // ★ 手指方向的手动反向（你要的"笨办法"）：四指 / 拇指各一行。改的是 `fingerAxes`（卷向的唯一来源）
  //   ⇒ 造型面板 / 手势库 / AI 的 <bodyact> 三条路**同时**生效，不用各处去找开关。
  const famOpts2 = [{ v: 'auto', t: '自动' }, { v: 'flip', t: '反转' }];
  spDropdown(sec, '手指方向·四指', famOpts2, poseFamilyMode('hand'), v => setPoseFamilyMode('hand', v));
  spDropdown(sec, '手指方向·拇指', famOpts2, poseFamilyMode('thumb'), v => setPoseFamilyMode('thumb', v));
  sec.appendChild(el('div', 'sp-note', (fxList.length
    ? ('本模型实测：' + fxList.join('、') + ' 与作者约定同轴反号（仅供参考，已停用自动修正）。')
    : '本模型实测各轴符号与作者约定一致（仅供参考）。')
    + ' 自动修正已停用：默认「不反转」= 完全按你拖的数值原样施加；'
    + '某族方向反了就选「反转」。不再自动动基础姿势。'
    + ' 手指方向那两行同理（自动 = 几何基线，反转 = 在它之上再取反）。'
    + ' **以上选择全部按模型存档**，重载或换模型回来都还在。'));
  // ★★ 这一块（30 条逐轴滑条）与「造型」面板能力重复、且没造型好用 ⇒ **默认收起、不再占地方**
  //   （用户 2026-10-14 原话："跟造型有点重复了…还不如咱造型做得好…直接把这一长串丢了吧"）。
  //   保留的原因：它刚被修好（陈旧引用导致"看着能调、人一动不动"，见 buildPoseBones 注释），
  //   按一次「展开」可用；如果你确实不要了，说一句我直接删（连代码一起）。
  const bonesWrap = el('div', 'sp-bones sp-list hidden'); sec._bonesWrap = bonesWrap;
  const _bg = el('button', 'sp-toggle', '展开逐轴微调(30)');
  _bg.style.cssText = 'font-size:11px;padding:0 6px;';
  _bg.addEventListener('click', () => {
    const open = bonesWrap.classList.contains('hidden');
    bonesWrap.classList.toggle('hidden', !open);
    _bg.textContent = open ? '收起逐轴微调' : '展开逐轴微调(30)';
  });
  const _bz = el('button', 'sp-toggle', '归零');
  _bz.style.cssText = 'margin-left:8px;font-size:11px;padding:0 6px;';
  _bz.addEventListener('click', () => {
    const p = currentPose || 'stand';
    poseOverrides[p] = {};
    _poseOffsetsAuthoritative = true;
    try { poseOffsetStore(p); } catch (e) { }      // ★ 归零也要落存档（否则重开面板又"复活"旧值）
    try { refreshPoseTargets(); } catch (e) { }
    try { _lastPoseEdit = '归零'; } catch (e) { }
    pushPoseOffsets();
    try { if (sec._bonesWrap) buildPoseBones(sec._bonesWrap); } catch (e) { }
  });
  sec.appendChild(_bg);
  sec.appendChild(_bz);
  sec.appendChild(bonesWrap);
  buildPoseBones(bonesWrap);
  body.appendChild(sec);

  // ---- 诊断（默认全关：探针默认静默，见文件顶部 postLog 的探针闸门）----
  // 放在最下方：平时不用管；哪次出问题需要我排查时，打开它 → 复现 → 把日志发我 → 再关掉。
  sec = spSection('诊断（排查用）');
  sec.appendChild(el('div', 'sp-note', '默认关闭。探针是给我排查用的自检日志；它们会跟着鼠标/姿势刷新、把日志刷满，所以平时静默。'));
  spToggle(sec, '诊断探针（会刷屏，排查完关掉）', probeEnabled(), on => window.petProbes(on));
  // ★★ 一键全量自检（用户诉求："别让我用肉眼一个个看"）——10 组**确定性**检查，一次跑完：
  //   探针只在同一 JS 轮次内「量→施加→再量→还原」，跑完骨骼与设置原样还原，**只报告不改动**。
  const stRow = spRow('一键全量自检');
  const bST = el('button', 'sp-toggle', '▶ 跑一遍（自动判定）');
  bST.addEventListener('click', () => {
    bST.textContent = '自检中…';
    try { window.petSelfTest({ from: 'panel' }); } catch (e) { postLog('error', '自检异常：' + (e && e.message)); }
    bST.textContent = '▶ 再跑一遍';
  });
  stRow.appendChild(bST); sec.appendChild(stRow);
  sec.appendChild(el('div', 'sp-note', '覆盖：骨架完整性 / 渲染在跑 / 存档往返(rig·手感) / 部件显隐往返 / 弹簧骨冻结·解冻双向 / '
    + '**全通道有效性（死通道）** / 手指卷向 + 拇指指尖弯(报末节骨转多少度) / **面板数值↔数据** / 生成式验收逻辑(8 例含反例) / 取景切边。\n'
    + '日志只出「自检：通过 N｜失败 M｜警告 K」+ 失败项详情（通过项不刷屏）。'));
  spToggle(sec, '模型加载后自动自检', stAutoOn(), on => { try { localStorage.setItem('petSelfTestAuto', on ? '1' : '0'); } catch (e) { } });
  body.appendChild(sec);
}
function makeDraggable(panel, handle) {
  let dx = 0, dy = 0, dragging = false, lastFit = 0;
  handle.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    if (e.target && e.target.closest && e.target.closest('.sp-close')) return;  // 点 × 不进入拖动：保证 × 一定触发 click、一定关得掉
    dragging = true;
    const r = panel.getBoundingClientRect();
    // ★ 关键修复：面板默认 right:12 锚在右边。只清 bottom 不清 right，拖动写 left 时就会变成
    //   “left 与 right 同时生效” ⇒ 宽度被压成 (视口 - 12 - left) 的一条竖边（“只漏出一点点、在右下角”的真凶）。
    //   所以起步时把 right 也清掉，并显式用当前 left/top 接管 ⇒ 面板恢复 300px 宽、跟随鼠标正常拖。
    panel.style.left = r.left + 'px';
    panel.style.top = r.top + 'px';
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
    dx = e.clientX - r.left; dy = e.clientY - r.top; e.preventDefault();
  });
  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    panel.style.left = Math.max(0, Math.min(e.clientX - dx, window.innerWidth - panel.offsetWidth)) + 'px';
    panel.style.top = Math.max(0, Math.min(e.clientY - dy, window.innerHeight - panel.offsetHeight)) + 'px';
    reportUiBounds();
    // ★ 面板被拖走时要**立刻**重新让位（节流 ~80ms）。否则在周期重算到来之前（最长 1 秒），
    //   面板会实实在在压住人物 —— 看起来就是"人物黏着面板、跟着被挡在后面"。
    //   让位的目标自带死区与平滑（见 fitCamera），所以这种高频调用不会把它抖起来。
    const nowMs = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    if (nowMs - lastFit > 80) { lastFit = nowMs; try { reframe(); } catch (err) { } }
  });
  window.addEventListener('mouseup', () => { if (dragging) { dragging = false; reportUiBounds(); } });
}

// ---- 拖动窗口：只有点到"角色本体"才响应（点周围空白区域不拖动、不戳） ----
// VRM 模型在 petRoot 下；PMX 的 mmdMesh 直接挂在 scene 上、petRoot 为 null，二者都作为命中目标。
function hitPet(clientX, clientY) {
  const target = petRoot || mmdMesh;
  if (!THREE || !camera || !target) return true; // 引擎未就绪时不拦截
  // ★★ 2026-10-14 第四轮（用户："依旧有略微卡顿"）：原来这里对**十万面蒙皮模型**跑 Raycaster
  //   —— 实测慢到 **244.9 ms/次**（见触摸审计那行）⇒ 每次点击/拖拽起手都卡 0.25 秒！
  //   而"点是不是点在宠物身上"根本不需要射线：骨级判定（便宜）+ 模型屏幕矩形兜底就够；
  //   何况本窗口按模型轮廓做了像素级穿透 ⇒ 落在窗口里的点击本来就在人物附近，宽松判定无副作用。
  // ★ v11.8：轻模型（<3 万面）补一条**精确**路（射线 + 蒙皮权重回溯到人形骨，见 pickPetBySkin）；
  //   重模型（本机十月面）自动跳过——射线在那种模型上 245ms/次，不值。
  try {
    if (!boneScreenPoints().length) return true;   // 骨点还没准备好（模型加载中）⇒ 信息不足，不拦截
    const tri = petTriCount();
    if (tri > 0 && tri < 30000) {
      const pk = pickPetBySkin(clientX, clientY);
      if (pk) { _petLastPick = { t: nowS_(), part: pk.part || '', bone: pk.bone || '' }; return true; }
    }
    if (touchHitBone(clientX, clientY, true)) return true;
    const rr = modelScreenRectCached();
    if (rr && clientX >= rr.x0 - 6 && clientX <= rr.x1 + 6 && clientY >= rr.y0 - 6 && clientY <= rr.y1 + 6) return true;
    return false;
  } catch (e) { return true; }
}
// ---- ★★ 点击命中增强（v11.8，思路借鉴 Nyalume 的 pick()：射线 → 蒙皮权重最大骨 → 沿 parent 回溯人形骨）----
// 用途：轻模型（<3 万面）的点击/拖拽起手用**精确**命中，并给出"点到哪根骨/哪个部位"。
// 不用于每帧触摸（那走骨级判定）；`petTriCount()` 现算面数，不靠猜。
let _petTriCount = -1, _petLastPick = null, _rawHumanMap = null;
function petTriCount() {
  if (_petTriCount >= 0) return _petTriCount;
  let t = 0;
  try {
    const root = petRoot || (vrm && vrm.scene) || mmdMesh;
    if (root) root.traverse(o => {
      const g = o && o.geometry;
      if (!g) return;
      const n = g.index ? g.index.count : ((g.attributes && g.attributes.position) ? g.attributes.position.count : 0);
      t += Math.floor(n / 3);
    });
  } catch (e) { }
  _petTriCount = t;
  return t;
}
function rawHumanoidMap() {
  if (_rawHumanMap || !vrm || !vrm.humanoid) return _rawHumanMap;
  const m = new Map();
  try {
    const nb = vrm.humanoid.normalizedHumanBones || {};
    for (const k in nb) {
      try {
        const raw = (typeof vrm.humanoid.getRawBoneNode === 'function') ? vrm.humanoid.getRawBoneNode(k) : null;
        if (raw) m.set(raw, k);
      } catch (e) { }
      try { const nn = vrm.humanoid.getNormalizedBoneNode(k); if (nn) m.set(nn, k); } catch (e) { }
    }
  } catch (e) { }
  _rawHumanMap = m;
  return m;
}
function pickPetBySkin(clientX, clientY) {
  try {
    if (!THREE || !camera || !vrm) return null;
    const root = petRoot || vrm.scene;
    const meshes = [];
    root.traverse(o => { if (o && o.isMesh) meshes.push(o); });
    if (!meshes.length) return null;
    const rc = new THREE.Raycaster();
    rc.setFromCamera(new THREE.Vector2((clientX / window.innerWidth) * 2 - 1, -(clientY / window.innerHeight) * 2 + 1), camera);
    const hit = rc.intersectObjects(meshes, false)[0];
    if (!hit || !hit.face || !hit.object.isSkinnedMesh) return null;
    const geo = hit.object.geometry, sk = hit.object.skeleton;
    const wA = geo.attributes && geo.attributes.skinWeight, iA = geo.attributes && geo.attributes.skinIndex;
    let raw = null, best = -1;
    if (wA && iA && sk && sk.bones) {
      for (const vi of [hit.face.a, hit.face.b, hit.face.c]) {
        for (let i = 0; i < 4; i++) {
          const w = wA.getComponent ? wA.getComponent(vi, i) : 0;
          if (w > best) {
            const bi = iA.getComponent ? iA.getComponent(vi, i) : -1;
            const b = sk.bones[bi];
            if (b) { best = w; raw = b; }
          }
        }
      }
    }
    // 头发/手指等非人形骨 → 沿 parent 回溯到最近的人形骨（部位识别用）
    const map = rawHumanoidMap();
    let p = raw;
    for (let i = 0; i < 12 && p; i++) { if (map && map.has(p)) break; p = p.parent; }
    const boneName = (p && p.name) || (raw && raw.name) || '';
    return {
      part: partLabelFromBone(boneName) || '身体',
      bone: boneName,
      point: hit.point ? hit.point.clone() : null,
    };
  } catch (e) { return null; }
}

let petDragging = false, petDragMoved = false;
window.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  if (!(e.target.closest && e.target.closest('[data-drag]'))) return;
  if (!hitPet(e.clientX, e.clientY)) return;
  hidePetMenu();
  petDragging = true;
  petDragMoved = false;
  startDragAnim();   // 拖拽时播放“被抓起”动画（有对应 VRMA 才播，否则仅移动窗口）
  postMessage({ type: 'drag_start' });
});
window.addEventListener('mousemove', (e) => {
  if (!petDragging) return;
  const dx = e.movementX || 0, dy = e.movementY || 0;
  if (dx === 0 && dy === 0) return;
  petDragMoved = true;
  postMessage({ type: 'drag_move', dx: dx, dy: dy });
});
window.addEventListener('mouseup', () => { if (petDragging) { petDragging = false; stopDragAnim(); postMessage({ type: 'drag_end' }); } });

// ---- 点击（未拖动）戳一下 ----
let petDownPt = null;
canvas.addEventListener('pointerdown', (e) => { if (e.button === 0) petDownPt = { x: e.clientX, y: e.clientY }; });
canvas.addEventListener('pointerup', (e) => {
  if (e.button !== 0 || !petDownPt || petDragMoved) { petDownPt = null; return; }
  const moved = Math.abs(e.clientX - petDownPt.x) + Math.abs(e.clientY - petDownPt.y);
  petDownPt = null;
  if (moved < 6 && hitPet(e.clientX, e.clientY)) {
    // ★ v11.8：轻模型下 hitPet 顺手给出了"点到哪根骨/哪个部位"（pickPetBySkin）⇒ 带上，AI 才知道戳哪了
    const pk = (_petLastPick && (nowS_() - _petLastPick.t) < 0.6) ? _petLastPick : null;
    postMessage({ type: 'interacted', text: '戳了一下' + (pk && pk.part ? ('（' + pk.part + '）') : '') });
  }
});

// ---- 滚轮实时缩放宠物大小（上滚放大、下滚缩小；防抖持久化到配置） ----
// 合帧：滚轮的惯性/高频会在一帧内连发多个事件，原实现每个事件都同步重取景
// （fitCamera 含全模型包围盒 + 骨骼矩阵更新），快速"放大后立刻缩小"会把主线程堵死 → 模型僵住。
// 改为：同一帧内的多个滚轮事件只累计目标值，帧末统一应用一次。
let scalePersistTimer = null;
let wheelPendingScale = null;   // 本帧待应用的目标大小
let wheelRafId = 0;             // 合帧 rAF 句柄（0 = 本帧无待处理）
function applyScaleLive(next) {
  lastOpts.scale = next;
  frameCamera(next, lastOpts.cameraDistance || 6);
  if (scaleSliderEl) {
    scaleSliderEl.value = String(next.toFixed(2));
    if (scaleSliderEl._valEl) scaleSliderEl._valEl.textContent = next.toFixed(2);
  }
  clearTimeout(scalePersistTimer);
  scalePersistTimer = setTimeout(() => sendSetting('scale', next.toFixed(2)), 300);
}
window.addEventListener('wheel', (e) => {
  // 菜单/面板内部滚动不要触发缩放。★ 用 .settings-panel 一次覆盖**所有**浮层
  // （设置/模型部件/动作/表情/模型）—— 之前只写了三个具体 id，新加的浮层漏在外面，
  // 于是在浮层上滚轮会去改"模型大小"、列表反而不滚（实测就是这个）。
  if (e.target && e.target.closest && e.target.closest('.settings-panel, #pet-menu, .sp-modal-box')) return;
  e.preventDefault();
  const cur = (wheelPendingScale == null) ? (lastOpts.scale || 1) : wheelPendingScale;
  const next = Math.min(2.2, Math.max(0.4, cur - Math.sign(e.deltaY) * 0.08));
  if (Math.abs(next - cur) < 1e-3) return;
  wheelPendingScale = next;
  if (!wheelRafId) {
    wheelRafId = requestAnimationFrame(() => {
      wheelRafId = 0;
      const s = wheelPendingScale; wheelPendingScale = null;
      if (s != null) applyScaleLive(s);
    });
  }
}, { passive: false });

// ---- 上报 UI 区域给 C#（鼠标穿透判定：菜单/面板上必须可点，其余空白穿透到桌面） ----
function rectUnionRects(rects) {
  let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
  for (const r of rects) { minX = Math.min(minX, r.left); minY = Math.min(minY, r.top); maxX = Math.max(maxX, r.right); maxY = Math.max(maxY, r.bottom); }
  if (maxX < minX) return null;
  return { left: minX, top: minY, right: maxX, bottom: maxY };
}
function reportUiBounds() {
  const items = [];
  if (typeof menuEl !== 'undefined' && menuEl && !menuEl.classList.contains('hidden')) {
    // 环形菜单容器自身无尺寸，取所有子项并集
    const kids = menuEl.classList.contains('radial') ? Array.from(menuEl.children) : [menuEl];
    const rs = kids.map(k => k.getBoundingClientRect()).filter(r => r.width > 0 && r.height > 0);
    const u = rectUnionRects(rs);
    if (u) items.push({ id: 'menu', x: u.left, y: u.top, w: u.right - u.left, h: u.bottom - u.top });
  }
  if (typeof settingsEl !== 'undefined' && settingsEl && !settingsEl.classList.contains('hidden')) {
    const r = settingsEl.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) items.push({ id: 'settings', x: r.left, y: r.top, w: r.width, h: r.height });
  }
  if (typeof modelPartsEl !== 'undefined' && modelPartsEl && !modelPartsEl.classList.contains('hidden')) {
    const r = modelPartsEl.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) items.push({ id: 'modelParts', x: r.left, y: r.top, w: r.width, h: r.height });
  }
  // 动作 / 表情浮层：**必须登记**，否则开着"鼠标穿透"时点击直接穿到桌面 ⇒ 按钮和 × 都点不到（踩过）
  if (typeof motFloatEl !== 'undefined' && motFloatEl && !motFloatEl.classList.contains('hidden')) {
    const r = motFloatEl.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) items.push({ id: 'motions', x: r.left, y: r.top, w: r.width, h: r.height });
  }
  if (typeof expFloatEl !== 'undefined' && expFloatEl && !expFloatEl.classList.contains('hidden')) {
    const r = expFloatEl.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) items.push({ id: 'expressions', x: r.left, y: r.top, w: r.width, h: r.height });
  }
  if (typeof modelFloatEl !== 'undefined' && modelFloatEl && !modelFloatEl.classList.contains('hidden')) {
    const r = modelFloatEl.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) items.push({ id: 'models', x: r.left, y: r.top, w: r.width, h: r.height });
  }
  if (typeof modelPickerEl !== 'undefined' && modelPickerEl) {
    const box = modelPickerEl.querySelector('.sp-modal-box');
    if (box) { const r = box.getBoundingClientRect(); if (r.width > 0 && r.height > 0) items.push({ id: 'model_picker', x: r.left, y: r.top, w: r.width, h: r.height }); }
  }
  postMessage({ type: 'ui_bounds', items: items });
  refreshUiHover();
}

// ---- UI 悬停即时上报（修复"面板上点不动"）----
// 仅靠 C# 的 30ms 轮询 + 矩形判定会有延迟/偏差，可能出现 mousedown 与 mouseup 之间被切换成穿透
// → mouseup 被送到桌面 → 点击不成立（表现：悬停有指针、却点不动，动一动鼠标又能点）。
// 这里由渲染进程用 DOM 实时命中：光标一进入面板/菜单，就立刻让 C# 关闭穿透。
let uiHoverLast = null, uiHoverRaf = 0, uiHoverX = -1, uiHoverY = -1;
// ★ 可点区域名单**只此一份**（原来散在两处：这里 + ResizeObserver 的 id 列表）。
//   教训：后加的三个浮层（动作/表情/模型）漏登记过 ⇒ 开着鼠标穿透时点它们会被判成"空白"
//   ⇒ 点击穿透到桌面（"点不动/关不掉"）。以后**新增面板只改这一行**。
const UI_HIT_SELECTOR = '#settings-panel, #pet-menu, #model-parts-panel, #motions-panel, #expressions-panel, #models-panel, .sp-modal-box';
const UI_PANEL_IDS = ['settings-panel', 'pet-menu', 'model-parts-panel', 'motions-panel', 'expressions-panel', 'models-panel'];
function uiHitTest(x, y) {
  try {
    const el = document.elementFromPoint(x, y);
    return !!(el && el.closest && el.closest(UI_HIT_SELECTOR));
  } catch (e) { return false; }
}
function refreshUiHover() {
  if (uiHoverRaf) return;
  uiHoverRaf = requestAnimationFrame(() => {
    uiHoverRaf = 0;
    const over = uiHitTest(uiHoverX, uiHoverY);
    if (over !== uiHoverLast) { uiHoverLast = over; postMessage({ type: 'ui_hover', over: over }); }
  });
}
window.addEventListener('mousemove', (e) => { uiHoverX = e.clientX; uiHoverY = e.clientY; refreshUiHover(); }, { passive: true });
document.addEventListener('mouseleave', () => { uiHoverX = -1; uiHoverY = -1; refreshUiHover(); });
// 面板内滚动 / 尺寸变化后立即重报一次（双保险：防止矩形过期）
document.addEventListener('scroll', () => { reportUiBounds(); }, true);
if (typeof ResizeObserver === 'function') {
  try {
    const ro = new ResizeObserver(() => { reportUiBounds(); });
    // 用 UI_PANEL_IDS（唯一名单）：原先这里只盯 3 个面板，新浮层的尺寸变化不会重报矩形
    for (const id of UI_PANEL_IDS) { const n = document.getElementById(id); if (n) ro.observe(n); }
  } catch (e) { }
}

// ---- 选模型面板：import_model 递归扫描后由 C# 把候选列表发来，这里列出让用户挑一个 ----
let modelPickerEl = null;
function showModelPicker(folder, items, note) {
  hideModelPicker();
  const overlay = el('div', 'sp-modal');
  overlay.addEventListener('click', (e) => { if (e.target === overlay) hideModelPicker(); });
  const box = el('div', 'sp-modal-box');
  box.appendChild(el('div', 'sp-modal-title', '📂 选择模型' + (folder ? '：' + folder : '')));
  if (note) box.appendChild(el('div', 'sp-note', note));
  const list = el('div', 'sp-modal-list');
  if (items && items.length) {
    for (const it of items) {
      const b = el('button', 'sp-modal-item', it.name);
      b.title = it.path;
      b.addEventListener('click', () => {
        hideModelPicker();
        postMessage({ type: 'pet_menu', action: 'load_model_file', path: it.path });
      });
      list.appendChild(b);
    }
  } else if (!note) {
    box.appendChild(el('div', 'sp-note', '未找到模型文件'));
  }
  box.appendChild(list);
  const bar = el('div', 'sp-modal-bar');
  const close = el('button', 'sp-btn', '关闭');
  close.addEventListener('click', hideModelPicker);
  bar.appendChild(close);
  box.appendChild(bar);
  overlay.appendChild(box);
  document.body.appendChild(overlay);
  modelPickerEl = overlay;
  reportUiBounds();
}
function hideModelPicker() {
  if (modelPickerEl) { modelPickerEl.remove(); modelPickerEl = null; reportUiBounds(); }
}
messageBus.on('model_candidates', (msg) => showModelPicker(msg && msg.folder, msg && msg.items, msg && msg.note));

// ---- 菜单构建（递归渲染 C# 下发的菜单树） ----
function mkItem(icon, label, onClick, opts) {
  const it = document.createElement('div');
  it.className = 'pm-item';
  it.title = label || '';   // 悬停显示完整动作名（长名省略号截断时仍能看到全称）
  const ic = document.createElement('span'); ic.className = 'pm-ico'; ic.textContent = icon || '';
  const lb = document.createElement('span'); lb.className = 'pm-label'; lb.textContent = label;
  it.appendChild(ic); it.appendChild(lb);
  if (opts && opts.arrow) { const a = document.createElement('span'); a.className = 'pm-arrow'; a.textContent = '▸'; it.appendChild(a); }
  if (opts && opts.value !== undefined && opts.value !== null && opts.value !== '') { const v = document.createElement('span'); v.className = 'pm-val'; v.textContent = opts.value; it.appendChild(v); }
  it.addEventListener('click', (ev) => { ev.stopPropagation(); onClick(); });
  return it;
}
function mkSep() { const s = document.createElement('div'); s.className = 'pm-sep'; return s; }
function mkEmpty(t) { const s = document.createElement('div'); s.className = 'pm-empty'; s.textContent = t; return s; }
function mkTitle(t) { const s = document.createElement('div'); s.className = 'pm-title'; s.textContent = t; return s; }
function sendMenu(action, extra) { postMessage(Object.assign({ type: 'pet_menu', action: action }, extra || {})); }

function settingDisp(node) {
  const i = (node.options || []).indexOf(node.value);
  if (i >= 0 && node.labels && node.labels[i] != null) return node.labels[i];
  return node.value || '';
}
function cycleSetting(node) {
  const opts = node.options || [];
  if (opts.length) {
    const i = opts.indexOf(node.value);
    node.value = opts[(i + 1) % opts.length];
  }
  sendMenu('setting', { key: SETTING_KEY_MAP[node.key] || node.key, value: node.value });
  renderPetMenu();
}

// 右键菜单里的真滑块：拖动时本地实时回传（C# 只回 options_update、不会重建菜单，所以拖动不丢焦点）。
// 亮度类项回传后会即时重打光，大小/相机类即时重取景。
function mkSliderRow(node) {
  const row = document.createElement('div');
  row.className = 'pm-item pm-slider-row';
  const lab = document.createElement('span'); lab.className = 'pm-label'; lab.textContent = node.label; row.appendChild(lab);
  const inp = document.createElement('input');
  inp.type = 'range'; inp.className = 'pm-range';
  const mn = (node.sliderMin != null) ? node.sliderMin : 0;
  const mx = (node.sliderMax != null) ? node.sliderMax : 3;
  const st = (node.sliderStep != null) ? node.sliderStep : 0.1;
  inp.min = mn; inp.max = mx; inp.step = st;
  const cur = (node.value != null && node.value !== '' && isFinite(parseFloat(node.value))) ? parseFloat(node.value) : mn;
  inp.value = cur;
  const val = document.createElement('span'); val.className = 'pm-val'; val.textContent = (+cur).toFixed(2);
  inp.addEventListener('input', (ev) => {
    ev.stopPropagation();
    val.textContent = (+inp.value).toFixed(2);
    node.value = inp.value;            // 回写缓存节点：C# 只回 options_update、不重建菜单，不写回重开就显示旧值
    const camel = Object.keys(SETTING_KEY_MAP).find(k => SETTING_KEY_MAP[k] === node.key) || node.key;
    lastOpts[camel] = inp.value;       // 同步 lastOpts（与 sendSetting 行为一致，避免重开回退）
    sendMenu('setting', { key: SETTING_KEY_MAP[node.key] || node.key, value: inp.value });
  });
  inp.addEventListener('click', (ev) => ev.stopPropagation());
  inp.addEventListener('mousedown', (ev) => ev.stopPropagation());
  row.appendChild(inp); row.appendChild(val);
  return row;
}

function buildMenuNode(c) {
  try {
    if (c.sep) return mkSep();
    if (c.children && c.children.length)
      return mkItem(c.icon, c.label, () => { if (c.uid) petMenuPath.push(c.uid); renderPetMenu(); }, { arrow: true });
    if (c.action === 'setting' && c.slider)
      return mkSliderRow(c);
    if (c.action === 'setting')
      return mkItem(c.icon, c.label, () => cycleSetting(c), { value: settingDisp(c) });
    if (c.action) {
      // 浏览类（动作/表情）点击后保持菜单打开，方便连着试几个；只有“终止类”才关菜单。
      // 之前一律 hidePetMenu —— 点一下就整个菜单消失，像“闪退退出界面”。
      const keepOpen = (c.action === 'action' || c.action === 'motion' || c.action === 'expression');
      const it = mkItem(c.icon, c.label, () => {
        sendMenu(c.action, c.arg);
        if (keepOpen) refreshNowPlayingOverlay(); else hidePetMenu();
      }, c.value ? { value: c.value } : undefined);
      // 动作类目：高亮当前正在播放的那一支
      if (c.action === 'motion') {
        const mn = (c.arg && c.arg.name) || (typeof c.arg === 'string' ? c.arg : '') || '';
        if (mn && mn === currentMotionName) it.classList.add('pm-active');
      }
      return it;
    }
    return mkItem(c.icon, c.label, () => {});
  } catch (e) {
    // 单项渲染失败绝不拖垮整个菜单（否则整块菜单闪没了，像“闪退”）
    console.warn('[3D桌宠] 菜单项渲染失败', (c && c.label) || '', e);
    return mkItem('⚠️', (c && c.label) || '（菜单项渲染失败）', () => {});
  }
}

// 把列表菜单夹取到视口内（环形根菜单不处理）：避免从点击点继承的位置把整列裁到屏幕外，
// 超高时由 CSS 的 max-height + overflow-y:auto 提供滚动，保证所有项都可见。
function fitMenuToViewport() {
  if (menuEl.classList.contains('hidden') || menuEl.classList.contains('radial')) return;
  const r = menuEl.getBoundingClientRect();
  const curLeft = parseFloat(menuEl.style.left) || 4;
  const curTop = parseFloat(menuEl.style.top) || 4;
  const left = Math.max(4, Math.min(curLeft, window.innerWidth - r.width - 4));
  const top = Math.max(4, Math.min(curTop, window.innerHeight - r.height - 4));
  menuEl.style.left = left + 'px';
  menuEl.style.top = top + 'px';
}

function renderPetMenu() {
  const node = currentMenuNode();
  const children = node.children || [];
  menuEl.innerHTML = '';
  // 子级：普通列表
  if (petMenuPath.length > 0) {
    menuEl.classList.remove('radial');
    menuEl.appendChild(mkItem('‹', '返回', () => { petMenuPath.pop(); renderPetMenu(); }));
    if (node.label && node.label !== 'root') menuEl.appendChild(mkTitle('『' + node.label + '』'));
    if (!children.length) { menuEl.appendChild(mkEmpty('（空）')); fitMenuToViewport(); return; }
    for (const c of children) { if (c.visible === false) continue; menuEl.appendChild(buildMenuNode(c)); }
    // 列表子菜单从环形根菜单位置继承下来，可能停在窗口偏下/偏右处导致整列被裁到视口外；
    // 这里重新夹取到视口内，超高时由 CSS 的 max-height + overflow-y 提供滚动，确保全部可见。
    fitMenuToViewport();
    return;
  }
  // 根级：环形径向菜单（围绕点击点）
  const vis = children.filter(c => c.visible !== false && !c.sep);
  const n = vis.length;
  menuEl.classList.add('radial');
  menuEl.style.left = menuOpenX + 'px';
  menuEl.style.top = menuOpenY + 'px';
  // 初始半径按项数增大，保证相邻芯片不互相重叠
  const M = 6;
  const fitW = Math.max(80, window.innerWidth - M * 2);
  const fitH = Math.max(80, window.innerHeight - M * 2);
  let R = Math.max(96, Math.min(196, 74 / Math.sin(Math.PI / Math.max(2, n))));
  const layoutRadial = (r) => {
    Array.from(menuEl.querySelectorAll('.radial-chip')).forEach(e => e.remove());
    vis.forEach((c, i) => {
      const it = buildMenuNode(c);
      it.classList.add('radial-chip');
      const ang = -Math.PI / 2 + (i / Math.max(1, n)) * Math.PI * 2;
      it.style.position = 'absolute';
      it.style.left = (Math.cos(ang) * r) + 'px';
      it.style.top = (Math.sin(ang) * r) + 'px';
      it.style.transform = 'translate(-50%, -50%)';
      menuEl.appendChild(it);
    });
  };
  const chipUnion = () => rectUnionRects(
    Array.from(menuEl.querySelectorAll('.radial-chip')).map(k => k.getBoundingClientRect()));
  // 窗口是固定尺寸（默认 500×600）。若整个环形放不下，就按比例缩小半径重排，直到能装进窗口，
  // 否则最外侧芯片（如"动作"）会被排出窗口边界，既看不到也点不到。
  layoutRadial(R);
  for (let t = 0; t < 6; t++) {
    const uu = chipUnion();
    if (!uu) break;
    const w = uu.right - uu.left, h = uu.bottom - uu.top;
    const sc = Math.min(1, (fitW * 0.94) / w, (fitH * 0.94) / h);
    if (sc > 0.985) break;
    R = Math.max(52, R * sc * 0.96);
    layoutRadial(R);
  }
  // 整体平移，把环形收进窗口内，避免超出窗口边缘被裁掉
  const u = chipUnion();
  if (u) {
    let dx = 0, dy = 0;
    if (u.left < M) dx = M - u.left;
    else if (u.right > window.innerWidth - M) dx = window.innerWidth - M - u.right;
    if (u.top < M) dy = M - u.top;
    else if (u.bottom > window.innerHeight - M) dy = window.innerHeight - M - u.bottom;
    if (dx || dy) {
      menuOpenX += dx; menuOpenY += dy;
      menuEl.style.left = menuOpenX + 'px';
      menuEl.style.top = menuOpenY + 'px';
    }
  }
  reportUiBounds();
}

let menuOpenX = 0, menuOpenY = 0;
function openPetMenu(x, y) {
  menuOpenX = x; menuOpenY = y;
  petMenuPath = [];
  menuEl.classList.remove('hidden');   // 先显示再渲染，保证元素有尺寸可测量/夹取
  renderPetMenu();
  if (!menuEl.classList.contains('radial')) {
    const r = menuEl.getBoundingClientRect();
    const left = Math.max(4, Math.min(x, window.innerWidth - r.width - 4));
    const top = Math.max(4, Math.min(y, window.innerHeight - r.height - 4));
    menuEl.style.left = left + 'px';
    menuEl.style.top = top + 'px';
  }
  reportUiBounds();
}
function hidePetMenu() { menuEl.classList.add('hidden'); menuEl.innerHTML = ''; reportUiBounds(); refreshNowPlayingOverlay(); }

window.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  if (e.target.closest && e.target.closest('#pet-menu')) return;
  // 只有真正右键到"角色本体"才弹菜单（空白处不反应；空白处通常已被鼠标穿透放行）
  if (!hitPet(e.clientX, e.clientY)) return;
  openPetMenu(e.clientX, e.clientY);
  refreshNowPlayingOverlay();   // 右键打开动作 UI 时显示“正在跳”浮层
}, true);
window.addEventListener('mousedown', (e) => {
  if (menuEl.classList.contains('hidden')) return;
  if (e.target.closest && e.target.closest('#pet-menu')) return;
  hidePetMenu();
}, true);
window.addEventListener('resize', () => hidePetMenu());
window.addEventListener('blur', () => hidePetMenu());
