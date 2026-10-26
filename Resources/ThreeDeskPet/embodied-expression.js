/* 具身表情合成器（embodied-expression.js，纯 JS，零依赖）
 *
 * 把「情绪标签 + 强度 + 眼嘴控制」解析成 **VRM 表情权重**，供 pet.js 逐帧写入。
 *
 * 核心理念：VRM 自带 blendshape 权重表 → 表情**不需要任何生成模型**。
 *   情绪 → 权重是查表 + 交叉淡入；"活着"的连续感来自眨眼/微动/口型这些定时器。
 *   （对比照片级方案要跑 CTEG/FLAME 生成面部几何：动漫头用不上，白烧 600MB 显存。）
 *
 * 表情名一律**从模型里发现**（可用清单由 pet.js 传入）：
 *   同一情绪会按 VRM 标准名 → MMD morph 名 → 中文/日文常见名的顺序挑第一个存在的，
 *   所以换模型/PMX 都不用改这里；实在没有就忽略该通道（优雅退化）。
 *
 * 同时挂到 window（页面用）与 globalThis（Node 测试用）。
 */
(function (root) {
  'use strict';

  // 情绪 → 候选表情名（按优先级：VRM 标准名 → MMD/日文 → 中文）
  // ★ 2026-10-15：日文别名按 VRM 0 模型的实际命名补全（对照 Nyalume 的别名表）：
  //   なごみ（和み）/ はぁと（爱心眼）/ じと目（不满的眼神）/ はぅ（困扰）/ びっくり（吃惊）…
  //   `surprised` 末尾的 `aa` 是**兜底**：VRM 0 常没有 surprised 预设，用"张嘴"代替（Nyalume 同款做法）；
  //   它排在最后 ⇒ 只有前面全不命中才会用到，不会抢掉真正有表情的模型。
  // 情绪 → 候选表情名（按优先级：VRM 标准名 → MMD/日文 → 中文）
  // ★ 24 种情绪（对齐 SoullinkEmotion3D 的 emotionCatalog）：粗粒度模型只有 joy/angry/sorrow/fun/blink，
  //   所以每种情绪的候选链**末尾都落到最近的基础表情**，保证任何模型都有脸；细粒度模型则由 VAD+FACS 引擎细分。
  var CANDIDATES = {
    neutral: [],
    happy: ['happy', 'Happy', 'joy', 'Joy', '笑い', '笑顔', 'smile', 'Smile', '喜び', 'はぁと',
      'にっこり', 'にこにこ', '开心', '高兴', '笑'],
    excited: ['excited', 'Excited', '興奮', 'わくわく', '开心', '高兴', 'joy', 'happy'],
    amused: ['amused', '忍俊', '笑い', 'にこり', 'にやり', 'smile', 'happy', 'joy'],
    proud: ['proud', '得意', 'どや', 'smug', 'happy', 'joy'],
    confident: ['confident', '自信', 'きりっと', 'happy', 'joy'],
    calm: ['calm', 'relaxed', 'リラックス', 'なごみ', 'やすらぎ', 'ほんわか', '安心', '轻松', '放松'],
    relieved: ['relieved', '安心', 'ほっと', 'relaxed', 'calm', 'happy'],
    affectionate: ['affectionate', '優しい', 'やさしい', '温柔', 'smile', 'happy'],
    shy: ['shy', 'Shy', 'bashful', '照れ', '照れる', 'てれ', 'Blush', 'blush', '害羞'],
    embarrassed: ['embarrassed', '窘迫', '照れ2', '照れ', 'shy', 'blush', '困る'],
    curious: ['curious', '好奇', 'きょとん', 'thinking', '困る'],
    concerned: ['concerned', '关切', '心配', '困る', 'sad', 'sorrow'],
    confused: ['confused', '困惑', 'はてな', '困る', 'thinking', '困るA'],
    tired: ['tired', '疲惫', '疲れ', 'ぐったり', 'sad', 'sorrow'],
    sad: ['sad', 'Sad', 'sorrow', '悲しい', '悲しみ', '悲しむ', 'しょんぼり', '难过', '伤心', '悲伤'],
    lonely: ['lonely', '落寞', '寂しい', 'さみしい', 'sad', 'sorrow'],
    disappointed: ['disappointed', '失望', 'がっかり', 'sad', 'sorrow'],
    anxiety: ['anxiety', '紧张', '不安', 'sad', 'fear', 'surprised'],
    fear: ['fear', '害怕', '怖い', '恐怖', 'びっくり', 'surprised', '見開く'],
    angry: ['angry', 'Angry', '怒り', 'じと目', 'ムッ', 'ぷんぷん', '生气', '愤怒', '怒'],
    frustrated: ['frustrated', '烦躁', 'イライラ', 'じと目', 'angry', '怒り'],
    disgust: ['disgust', '嫌弃', '嫌悪', '嫌', 'じと目', 'angry', '怒り'],
    surprised: ['surprised', 'Surprised', 'surprise', '驚き', 'びっくり', 'はぅ', '惊讶', '吃惊', '見開く', 'a', 'o', 'aa'],
    // 兼容旧标签
    relaxed: ['relaxed', 'Relaxed', 'リラックス', 'やすらぎ', 'なごみ', 'ほんわか', '轻松', '放松', 'calm'],
    thinking: ['thinking', 'think', '困る', '考える', '悩む', '思考', '好奇', '困るA', '困惑']
  };

  // 情绪 → 副表情（有就叠一点，显得自然；没有就忽略）
  var SECONDARY = {
    happy: [],
    excited: [{ emo: 'happy', w: 0.55 }],
    amused: [{ emo: 'happy', w: 0.45 }],
    proud: [{ emo: 'happy', w: 0.35 }],
    confident: [{ emo: 'happy', w: 0.20 }],
    calm: [],
    relieved: [{ emo: 'happy', w: 0.25 }],
    affectionate: [{ emo: 'happy', w: 0.35 }],
    surprised: [{ emo: 'happy', w: 0.25 }],
    shy: [{ emo: 'happy', w: 0.42 }],
    embarrassed: [{ emo: 'shy', w: 0.55 }],
    curious: [{ emo: 'surprised', w: 0.25 }],
    concerned: [{ emo: 'sad', w: 0.35 }],
    confused: [{ emo: 'thinking', w: 0.40 }],
    tired: [{ emo: 'sad', w: 0.30 }],
    sad: [],
    lonely: [{ emo: 'sad', w: 0.55 }],
    disappointed: [{ emo: 'sad', w: 0.60 }],
    anxiety: [{ emo: 'fear', w: 0.35 }],
    fear: [{ emo: 'surprised', w: 0.45 }],
    angry: [],
    frustrated: [{ emo: 'angry', w: 0.60 }],
    disgust: [{ emo: 'angry', w: 0.45 }],
    relaxed: [],
    thinking: [],
    neutral: []
  };

  var MOUTH_NAMES = ['aa', 'A', 'あ', '口開け', '口开'];
  var BLINK_NAMES = ['blink', 'Blink', 'まばたき', '瞬き', '眨眼'];

  /** 从可用清单里挑第一个命中的候选名（先精确、再忽略大小写） */
  function pick(names, avail) {
    if (!names || !names.length || !avail || !avail.length) return null;
    var set = {}, low = {};
    for (var i = 0; i < avail.length; i++) { set[avail[i]] = true; low[String(avail[i]).toLowerCase()] = avail[i]; }
    for (var j = 0; j < names.length; j++) if (set[names[j]]) return names[j];
    for (var k = 0; k < names.length; k++) { var hit = low[String(names[k]).toLowerCase()]; if (hit) return hit; }
    return null;
  }

  /**
   * 情绪 + 强度 → { 表情名: 权重 }
   * @param {string} emotion  CANDIDATES 的键（未知则退回 neutral）
   * @param {number} intensity 0..1
   * @param {string[]} avail  模型实际可用的表情名清单
   */
  function resolve(emotion, intensity, avail) {
    var out = {};
    var w = Math.max(0, Math.min(1, +intensity || 0));
    var prim = CANDIDATES[emotion] || CANDIDATES.neutral;
    var name = pick(prim, avail);
    if (name) out[name] = w;
    var sec = SECONDARY[emotion] || [];
    for (var i = 0; i < sec.length; i++) {
      var sn = pick(CANDIDATES[sec[i].emo] || [], avail);
      if (sn) out[sn] = Math.max(out[sn] || 0, w * sec[i].w);
    }
    return out;
  }

  function mouthName(avail) { return pick(MOUTH_NAMES, avail); }
  function blinkName(avail) { return pick(BLINK_NAMES, avail); }

  // 24 种（对齐 SoullinkEmotion3D 的情绪目录）+ 兼容旧标签 relaxed/thinking
  var EMOTIONS = ['neutral', 'happy', 'excited', 'amused', 'proud', 'confident', 'calm', 'relieved',
    'affectionate', 'shy', 'embarrassed', 'curious', 'concerned', 'confused', 'tired', 'sad',
    'lonely', 'disappointed', 'anxiety', 'fear', 'angry', 'frustrated', 'disgust', 'surprised',
    'relaxed', 'thinking'];

  var api = {
    CANDIDATES: CANDIDATES, SECONDARY: SECONDARY, EMOTIONS: EMOTIONS,
    pick: pick, resolve: resolve, mouthName: mouthName, blinkName: blinkName
  };
  root.EmbodiedExpression = api;
})(typeof window !== 'undefined' ? window : globalThis);
