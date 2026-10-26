using System;

namespace presents.DeskPet3D;

/// <summary>
/// 「动作人设」（motion idiom）——由**每个使用者自己的对话 AI** 把「长篇人设 + 上下文记忆」蒸馏成的一小段风格契约。
///
/// 为什么不做成预设库：人设千差万别（几千字很常见），而且**记忆比人设影响更大**
/// （关系升温/争吵/被冷落都会改变表达），枚举式预设必然覆盖不全、且换个角色立刻失效。
/// 所以这里只定义**格式**与**数值语义**，内容全部交给 AI 自己写、自己更新，并按角色持久化。
///
/// 分工（这是本类存在的意义）：
///   · 文本字段 → 拼进常驻提示，让 AI 自己**跨轮次/跨会话保持一致**（提示词侧，不额外吃一次工具调用）；
///   · 数值字段 → 下发前端换算成**真实手感**（待机小动作频率 / 节奏 / 平滑 / 幅度 / 跟随强度）。
///
/// 设计边界：「**手感归用户（可调），正确归几何（不给旋钮）**」——这里只放审美/风格；
/// 不放坐标基、左右符号、关节映射之类的**正确性**参数（那些必须自动量出来，做成旋钮只会诱使用错值去掩盖 bug）。
/// </summary>
sealed class MotionIdiom
{
    // ---- 数值向量：全部会真实生效（下发前端一次性换算成手感）----
    public double Amp { get; set; } = 1.0;       // 幅度 0.3~1.5：小=克制含蓄 / 大=夸张奔放
    public double Tempo { get; set; } = 1.0;     // 节奏 0.5~2  ：小=慢条斯理 / 大=干脆利落
    public double Density { get; set; } = 2.0;   // 小动作密度 0~3：平时主动做动作的频率（0=几乎不动）
    public double Smooth { get; set; } = 0.08;   // 平滑 0~0.3：大=优雅柔和 / 小=跟手直接
    public double Stillness { get; set; } = 0.4; // 静定 0~1  ：大=少跟随少微动（冷、稳）/ 小=活泼好动

    // ---- 文本字段：进常驻提示，每项都限长（免得白吃 token）----
    public string Persona { get; set; } = "";    // 一句话：我是什么样的人
    public string State { get; set; } = "";      // 一句话：**记忆/近况**对动作风格的影响（会变，记得更新）
    public string Like { get; set; } = "";       // 惯用动作 / 偏好（如"爱歪头、常抱臂、高兴时举双手"）
    public string Avoid { get; set; } = "";      // 忌讳（如"不大跳、不撒娇式摆手"）
    public string Signature { get; set; } = "";  // 签名动作：被夸 / 打招呼时固定用哪一个
    public long UpdatedUtc { get; set; }
    public string Source { get; set; } = "";     // 谁写的：ai / user（面板里显示，便于用户判断该不该让 AI 重写）

    /// <summary>单个文本字段的字符上限：常驻提示要够短（AI 写几千字人设也没关系，这里必须蒸馏成短句）。</summary>
    const int TextMax = 48;

    public bool IsEmpty =>
        string.IsNullOrWhiteSpace(Persona) && string.IsNullOrWhiteSpace(State) &&
        string.IsNullOrWhiteSpace(Like) && string.IsNullOrWhiteSpace(Avoid) && string.IsNullOrWhiteSpace(Signature);

    /// <summary>把数值夹到安全区间、文本截断（AI 可能给 amp="20" 这种离谱值，绝不能直接下发）。</summary>
    public void Clamp()
    {
        Amp = Math.Clamp(Amp, 0.3, 1.5);
        Tempo = Math.Clamp(Tempo, 0.5, 2.0);
        Density = Math.Clamp(Density, 0.0, 3.0);
        Smooth = Math.Clamp(Smooth, 0.0, 0.3);
        Stillness = Math.Clamp(Stillness, 0.0, 1.0);
        Persona = Trunc(Persona); State = Trunc(State); Like = Trunc(Like);
        Avoid = Trunc(Avoid); Signature = Trunc(Signature);
        UpdatedUtc = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
    }

    static string Trunc(string? s)
    {
        s = (s ?? "").Replace("\r", " ").Replace("\n", " ").Trim();
        return s.Length <= TextMax ? s : s[..TextMax];
    }

    /// <summary>常驻提示用的紧凑文本；空则返回 null。
    /// 这是"AI 自己写的契约回去约束它自己"的地方，也是它跨会话不跑偏的锚点。</summary>
    public string? Compact()
    {
        if (IsEmpty) return null;
        var sb = new System.Text.StringBuilder();
        sb.Append("【我的动作人设】（你自己写的，务必照此表达、保持一致；要改就再用 <motionidiom> 覆盖）\n");
        if (Persona.Length > 0) sb.Append("- 我是：").Append(Persona).Append('\n');
        if (State.Length > 0) sb.Append("- 记忆/近况的影响：").Append(State).Append('\n');
        if (Like.Length > 0) sb.Append("- 惯用动作：").Append(Like).Append('\n');
        if (Avoid.Length > 0) sb.Append("- 忌讳：").Append(Avoid).Append('\n');
        if (Signature.Length > 0) sb.Append("- 签名动作：").Append(Signature).Append('\n');
        sb.Append("- 当前手感（已生效）：幅度 ").Append(Amp.ToString("0.##"))
          .Append("｜节奏 ").Append(Tempo.ToString("0.##"))
          .Append("｜密度 ").Append(Density.ToString("0.#"))
          .Append("｜平滑 ").Append(Smooth.ToString("0.##"))
          .Append("｜静定 ").Append(Stillness.ToString("0.##"));
        return sb.ToString();
    }

    /// <summary>距上次更新过了多少天（从未写过 = -1）。用于"该提醒 AI 重写了吗"。</summary>
    public int DaysSinceUpdate()
    {
        if (UpdatedUtc <= 0) return -1;
        try
        {
            var t = DateTimeOffset.FromUnixTimeSeconds(UpdatedUtc);
            return (int)Math.Max(0, (DateTimeOffset.UtcNow - t).TotalDays);
        }
        catch { return -1; }
    }

    /// <summary>设置面板里显示的"更新于 / 是否到期"说明。</summary>
    public string AgeText(int dueDays)
    {
        int d = DaysSinceUpdate();
        if (d < 0) return "还没写过";
        string who = Source == "user" ? "你自己编辑" : "AI 写的";
        string age = d == 0 ? "今天" : d + " 天前";
        if (dueDays <= 0) return $"{who}，更新于{age}（已关闭自动提醒）";
        if (d >= dueDays) return $"{who}，更新于{age} —— ⚠ 已到期（间隔 {dueDays} 天），AI 下次说话时会看到重写提醒";
        return $"{who}，更新于{age}（{dueDays - d} 天后提醒重写）";
    }

    /// <summary>设置面板/日志里显示的一行摘要（不含数值）。</summary>
    public string Summary()
    {
        if (IsEmpty) return "";
        var parts = new System.Collections.Generic.List<string>();
        if (State.Length > 0) parts.Add("近况:" + State);
        if (Like.Length > 0) parts.Add("惯用:" + Like);
        if (Avoid.Length > 0) parts.Add("忌讳:" + Avoid);
        if (Signature.Length > 0) parts.Add("签名:" + Signature);
        return string.Join("｜", parts);
    }

    /// <summary>从插件配置投影出动作人设。
    /// **配置是唯一来源**（不再另存 JSON 文件）→ 配置页改的、AI 写的、桌宠面板传的都是同一份数据，
    /// 不会出现"配置页显示 A、运行用的是 B"这种不同步。</summary>
    public static MotionIdiom From(ThreeDeskPetConfig c) => new()
    {
        Amp = c.MotionIdiomAmp,
        Tempo = c.MotionIdiomTempo,
        Density = c.MotionIdiomDensity,
        Smooth = c.MotionIdiomSmooth,
        Stillness = c.MotionIdiomStillness,
        Persona = c.MotionIdiomPersona,
        State = c.MotionIdiomState,
        Like = c.MotionIdiomLike,
        Avoid = c.MotionIdiomAvoid,
        Signature = c.MotionIdiomSignature,
        UpdatedUtc = c.MotionIdiomUpdatedUtc,
        Source = c.MotionIdiomSource
    };

    /// <summary>写回插件配置（调用方负责先 Clamp，再持久化配置）。</summary>
    public void ApplyTo(ThreeDeskPetConfig c)
    {
        c.MotionIdiomAmp = Amp;
        c.MotionIdiomTempo = Tempo;
        c.MotionIdiomDensity = Density;
        c.MotionIdiomSmooth = Smooth;
        c.MotionIdiomStillness = Stillness;
        c.MotionIdiomPersona = Persona;
        c.MotionIdiomState = State;
        c.MotionIdiomLike = Like;
        c.MotionIdiomAvoid = Avoid;
        c.MotionIdiomSignature = Signature;
        c.MotionIdiomUpdatedUtc = UpdatedUtc;
        c.MotionIdiomSource = Source;
    }

    /// <summary>变更指纹：用来检测"配置页被外部改了"（与上次同步的比较），避免每帧都重建提示。</summary>
    public string Fingerprint() => string.Join("|", Amp, Tempo, Density, Smooth, Stillness,
        Persona, State, Like, Avoid, Signature);
}
