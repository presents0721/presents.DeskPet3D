/* ardy-mini 文本分支用的分词器：sentence-transformers/all-MiniLM-L6-v2（BERT uncased WordPiece）
 *
 * 为什么自己写：@huggingface/tokenizers 是额外一份 WASM（还要自己本地化）；而 BERT WordPiece 规则
 * 非常确定，自己实现的好处是**可以用真实的 tokenizer.json 在 Node 里离线验证**（见 scripts/test-ardy-tokenizer.mjs），
 * 不必等浏览器环境。
 *
 * 规则来源（HF tokenizer.json）：BertNormalizer(lowercase/strip_accents) → BertPreTokenizer
 * （空白切分 + 标点单列 + CJK 单列）→ WordPiece（最长匹配、子词前缀 "##"、失败退 [UNK]）→
 * 加 [CLS]/[SEP]、按 max_length 截断、[PAD] 补齐。
 *
 * 输出与 onnxruntime-web 的 int64 输入对齐：BigInt64Array。
 */
(function (root) {
  'use strict';

  // BERT 的标点范围（BertPreTokenizer 用的就是这几段）
  const RE_PUNCT = /[\u0021-\u002f\u003a-\u0040\u005b-\u0060\u007b-\u007e\u2000-\u206f]/;
  function isPunct(ch) { return RE_PUNCT.test(ch); }
  function isCJK(ch) {
    const c = ch.codePointAt(0);
    return (c >= 0x4E00 && c <= 0x9FFF) || (c >= 0x3400 && c <= 0x4DBF) ||
      (c >= 0x3040 && c <= 0x30FF) || (c >= 0xAC00 && c <= 0xD7AF);
  }
  function isSpace(ch) { return /\s/.test(ch); }

  /** BertPreTokenizer：空白处切分；每个标点单独成词；CJK 每个字单独成词 */
  function preTokenize(text) {
    const out = [];
    let cur = '';
    const chars = Array.from(text);
    for (let i = 0; i < chars.length; i++) {
      const ch = chars[i];
      if (isSpace(ch)) { if (cur) { out.push(cur); cur = ''; } continue; }
      if (isPunct(ch) || isCJK(ch)) { if (cur) { out.push(cur); cur = ''; } out.push(ch); continue; }
      cur += ch;
    }
    if (cur) out.push(cur);
    return out;
  }

  /**
   * @param {object} json HF tokenizer.json 解析后的对象
   * @returns {{encode:function(string,number=):object, vocabSize:number, info:object}}
   */
  function createTokenizer(json) {
    if (!json) throw new Error('ardy-tokenizer: 缺少 tokenizer.json');
    const model = json.model || {};
    const vocab = model.vocab;
    if (!vocab) throw new Error('ardy-tokenizer: tokenizer.json 里没有 model.vocab');
    const type = model.type || 'WordPiece';
    if (type !== 'WordPiece') throw new Error('ardy-tokenizer: 只实现了 WordPiece，收到 ' + type);
    const unkToken = model.unk_token || '[UNK]';
    const contPrefix = model.continuing_subword_prefix === undefined ? '##' : model.continuing_subword_prefix;
    const maxCharsPerWord = model.max_input_chars_per_word || 100;
    const norm = json.normalizer || {};
    const doLower = norm.lowercase !== false;           // MiniLM uncased = true
    const stripAccents = !!norm.strip_accents;
    const CLS = '[CLS]', SEP = '[SEP]', PAD = '[PAD]';
    if (vocab[CLS] === undefined || vocab[SEP] === undefined || vocab[PAD] === undefined) {
      throw new Error('ardy-tokenizer: 词表缺少 [CLS]/[SEP]/[PAD]');
    }

    function normalize(text) {
      let t = text == null ? '' : String(text);
      if (stripAccents) t = t.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      t = t.replace(/[\u0000\uFFFD]/g, '');            // 去掉控制符/替换符
      if (doLower) t = t.toLowerCase();
      return t;
    }

    /** WordPiece 最长匹配；返回 token 字符串数组，整词无法切分时返回 null（退 [UNK]） */
    function wordpiece(word) {
      if (word.length > maxCharsPerWord) return null;
      const pieces = [];
      let start = 0;
      while (start < word.length) {
        let end = word.length, hit = null;
        while (start < end) {
          const sub = (start > 0 ? contPrefix : '') + word.slice(start, end);
          if (vocab[sub] !== undefined) { hit = sub; break; }
          end--;
        }
        if (hit === null) return null;
        pieces.push(hit);
        start = end;
      }
      return pieces;
    }

    /**
     * @param {string} text
     * @param {number} maxLen 序列长度（清单 tokenizer.max_length = 128）
     * @returns {{inputIds:BigInt64Array, attentionMask:BigInt64Array, tokenTypeIds:BigInt64Array,
     *            tokens:string[], ids:number[], length:number}}
     */
    function encode(text, maxLen) {
      maxLen = Math.max(2, Math.floor(maxLen || 128));
      const toks = [CLS];
      const words = preTokenize(normalize(text));
      for (let i = 0; i < words.length; i++) {
        const pieces = wordpiece(words[i]);
        if (pieces === null) toks.push(unkToken);
        else for (let j = 0; j < pieces.length; j++) toks.push(pieces[j]);
      }
      toks.push(SEP);

      // 超长：截断到 maxLen，但保证最后一个位置是 [SEP]
      let seq = toks;
      if (seq.length > maxLen) {
        seq = toks.slice(0, maxLen);
        seq[maxLen - 1] = SEP;
      }

      const inputIds = new BigInt64Array(maxLen);
      const attentionMask = new BigInt64Array(maxLen);
      const tokenTypeIds = new BigInt64Array(maxLen);
      const ids = new Array(maxLen);
      for (let i = 0; i < maxLen; i++) {
        const within = i < seq.length;
        const tok = within ? seq[i] : PAD;
        const id = vocab[tok] === undefined ? vocab[unkToken] : vocab[tok];
        inputIds[i] = BigInt(id);
        attentionMask[i] = BigInt(within ? 1 : 0);
        tokenTypeIds[i] = 0n;
        ids[i] = id;
      }
      return {
        inputIds: inputIds, attentionMask: attentionMask, tokenTypeIds: tokenTypeIds,
        tokens: seq.slice(), ids: ids, length: seq.length
      };
    }

    return {
      encode: encode,
      vocabSize: Object.keys(vocab).length,
      info: { type: type, lowercase: doLower, stripAccents: stripAccents, unk: unkToken, prefix: contPrefix }
    };
  }

  const api = { createTokenizer: createTokenizer, preTokenize: preTokenize };
  root.ArdyTokenizer = api;
})(typeof window !== 'undefined' ? window : globalThis);
