using System;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Numerics;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Alife.Client;
using Alife.Foundation;
using Alife.Framework;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using System.Windows.Forms;

namespace presents.DeskPet3D;

/// <summary>
/// 3D 桌宠显示模块：在宿主透明窗口（Alife 5：WebView2，通过 IAlifeApplication 创建）里用 Three.js 渲染
/// VRM / PMX(VMD) 模型，通过 <see cref="PetBridge"/> 与宿主通讯，作为桌宠身体的具体实现。
/// 不实现 IDeskPet 接口，直接由同插件内的 DeskPetService 注入使用，避免与另外两个桌宠插件产生 IDeskPet 的 DI 歧义。
/// </summary>
[Module("3D桌宠",
    """
    提供一个 3D 桌宠身体（VRM 模型 / PMX 模型 + VMD 动作）。
    VRM：表情=blend shape、动画、弹簧骨、视线。
    PMX：用户自备模型与动作配布，支持 IK / 物理 / 打光，可跳舞。
    模型放在 Storage/<角色>/ThreeDeskPet/Models/<名称>/ 下：
      - VRM：model.vrm（或首个 .vrm）
      - PMX：model.pmx（或首个 .pmx），动作放 motions/*.vmd
      - VRM 动画：motions/*.vrma
    """,
    defaultCategory: "presents/桌宠",
    EditorUI = typeof(ThreeDeskPetUI))]
public partial class ThreeDeskPet(
    PluginSystem pluginSystem,
    StorageSystem storageSystem,
    IAlifeApplication alifeApplication,
    ILogger<ThreeDeskPet> logger) :
    ChatBehaviour,
    IConfigurable<ThreeDeskPetConfig>
{
    public ThreeDeskPetConfig Configuration { get; set; } = null!;

    public event Action<string>? OnInput;
    public event Action<string>? OnInteracted;
    /// <summary>模型切换完成事件（参数为新模型名）。</summary>
    public event Action<string>? ModelSwitched;

    /// <summary>前端对「动作人设」的操作请求。
    /// cmd：get=索取当前值（页面加载完主动要）/ set=用户在面板里保存了编辑 / rewrite=请 AI 按最新记忆重写一次。
    /// json：set 时携带的编辑后契约。</summary>
    public event Action<string, string>? MotionStyleCommand;

    /// <summary>自定义造型清单变化（用户在面板里保存/删除）→ 上层刷新常驻信息，让 AI 立刻看到新造型名。</summary>
    public event Action? CustomPosesChanged;

    public string[] SupportedExpressions => Locked(() => threeExpressions.ToArray());
    // ★ v11.49：给 AI 的清单可再封顶（配置 MotionListLimit，0=不限制）。
    //   只影响**给 AI 的选项**，右键菜单仍列全部（SendMenuData 直接读 threeMotions）。
    public string[] SupportedMotions => Locked(() =>
    {
        string[] arr = threeMotions.ToArray();
        int lim = Configuration.MotionListLimit;
        if (lim > 0 && arr.Length > lim) arr = arr.Take(lim).ToArray();
        return arr;
    });
    public string CurrentModel => Configuration.ModelName;
    public string[] AvailableModels => ThreeAvailableModels();

    public async Task<bool> SwitchModelAsync(string modelName)
    {
        modelName = (modelName ?? "").Trim();
        if (string.IsNullOrEmpty(modelName)) return false;
        if (AvailableModels.Contains(modelName, StringComparer.OrdinalIgnoreCase) == false)
        {
            AlifeLog.LogWarning($"[3D桌宠] 模型不存在: {modelName}；可选: {string.Join(", ", AvailableModels)}");
            return false;
        }
        string previous = Configuration.ModelName;
        bool changed = !string.Equals(previous, modelName, StringComparison.OrdinalIgnoreCase);
        Configuration.ModelName = modelName;
        PersistConfig();
        if (!changed) return true;
        try
        {
            await SwitchModelInPlaceAsync(modelName);
        }
        catch (Exception e)
        {
            AlifeLog.LogError(e);
            Configuration.ModelName = previous;
            PersistConfig();
            try { await SwitchModelInPlaceAsync(previous); } catch (Exception e2) { AlifeLog.LogError(e2); }
            return false;
        }
        ModelSwitched?.Invoke(modelName);
        return true;
    }

    public Task ShowUsing(bool isUsing)
    {
        bridge?.SendMessage("using", new { value = isUsing });
        return Task.CompletedTask;
    }
    public Task ShowSubtitle(string? subtitle)
    {
        bridge?.SendMessage("subtitle", new { text = subtitle });
        return Task.CompletedTask;
    }
    public Task ShowExpression(string? expression, double? seconds = null)
    {
        if (string.IsNullOrWhiteSpace(expression)) return Task.CompletedTask;
        bridge?.SendMessage("expression", new { name = expression, seconds });
        return Task.CompletedTask;
    }
    public Task ShowMotion(string? motion, double? seconds = null)
    {
        if (string.IsNullOrWhiteSpace(motion)) return Task.CompletedTask;
        bridge?.SendMessage("motion", new { name = motion, seconds });
        return Task.CompletedTask;
    }

    /// <summary>下发一次「生成式动作」：一句英文 → 本地模型现场生成 → 重定向到当前 VRM → 播放。
    /// 前端会回报结果；失败时由前端退回预置动作（见 pet.js 的 bodyact_prompt 处理）。</summary>
    public void GenerateMotion(string prompt)
    {
        if (string.IsNullOrWhiteSpace(prompt)) return;
        bridge?.SendMessage("bodyact_prompt", new { prompt });
    }

    // ── 生成式动作词条（<motion option="gen:标签"/> 用）────────────────────────────
    // 为什么要**读文件**而不是硬编码：白名单以前写在 bodyact 的工具说明里（只有 1 条），
    //   于是"AI 只会调现成动作"——给它 208 个动作文件和 1 条生成词条，它当然不碰生成式。
    //   数据化之后："真机试跑通过一条 → 写进 ardy-phrases.json 的 verified" ⇒ **下一轮就生效**，
    //   不用改 C#、不用重编译插件。
    // 带 mtime 缓存（文件没改不重读）；文件缺失/解析失败一律降级到内置兜底 —— 绝不让桌宠起不来。
    readonly object genPhrasesLock = new();
    (string Label, string Phrase)[] genPhrases = Array.Empty<(string, string)>();
    DateTime genPhrasesMtime = DateTime.MinValue;

    static readonly (string Label, string Phrase)[] BuiltinGenPhrases = {
        ("举手挥手", "a person raises the right hand high above the head and waves hello")   // 2026-10-11 实测通过
    };

    /// <summary>生成式动作的可用词条。数据源 = 插件目录 Resources/ThreeDeskPet/ardy-phrases.json 的 verified 段。</summary>
    public (string Label, string Phrase)[] GenPhrases { get { EnsureGenPhrases(); return genPhrases; } }

    void EnsureGenPhrases()
    {
        try
        {
            lock (genPhrasesLock)
            {
                string p = Path.Combine(pluginSystem.PluginContext.GetPluginDirectoryPath("presents.DeskPet3D"),
                    "Resources", "ThreeDeskPet", "ardy-phrases.json");
                if (!File.Exists(p))
                {
                    if (genPhrases.Length == 0) { genPhrases = BuiltinGenPhrases; AlifeLog.LogWarning("[3D桌宠] 找不到 ardy-phrases.json → 生成式词条用内置兜底"); }
                    return;
                }
                DateTime mt = File.GetLastWriteTimeUtc(p);
                if (mt == genPhrasesMtime) return;                     // 文件没改 ⇒ 不重读
                var list = new List<(string, string)>();
                using (JsonDocument doc = JsonDocument.Parse(File.ReadAllText(p)))
                {
                    if (doc.RootElement.TryGetProperty("verified", out JsonElement arr) && arr.ValueKind == JsonValueKind.Array)
                    {
                        foreach (JsonElement e in arr.EnumerateArray())
                        {
                            string phrase = (e.TryGetProperty("phrase", out JsonElement ph) ? ph.GetString() : null) ?? "";
                            string label = (e.TryGetProperty("label", out JsonElement lb) ? lb.GetString() : null) ?? "";
                            if (string.IsNullOrWhiteSpace(phrase)) continue;
                            list.Add((string.IsNullOrWhiteSpace(label) ? phrase.Trim() : label.Trim(), phrase.Trim()));
                        }
                    }
                }
                genPhrases = list.Count > 0 ? list.ToArray() : BuiltinGenPhrases;
                genPhrasesMtime = mt;
                AlifeLog.LogInformation("[3D桌宠] 生成式词条已载入 " + genPhrases.Length + " 条（ardy-phrases.json 的 verified）");
            }
        }
        catch (Exception e)
        {
            AlifeLog.LogError(e);
            lock (genPhrasesLock) { if (genPhrases.Length == 0) genPhrases = BuiltinGenPhrases; }
        }
    }

    /// <summary>下发「动作人设」到前端（内容由 DeskPetService 组装：手感数值 + 文本 + 更新时间/是否到期）。
    /// 前端据此换手感，并在设置面板里显示、可直接编辑（编辑后经 motion_idiom 命令回传）。
    /// 注意手感的应用是**一次性**的：之后用户在面板上自己调的值优先，不会被反复覆盖。
    /// 参数收成 object 而非逐项：这个契约还会长（文本字段/状态字段），逐项会越摊越宽。</summary>
    public void SetMotionStyle(object payload)
    {
        bridge?.SendMessage("motion_idiom", payload);
    }

    /// <summary>读当前「动作人设」（从插件配置投影；配置是唯一来源，配置页可直接编辑）。</summary>
    internal MotionIdiom MotionIdiomSnapshot() => MotionIdiom.From(Configuration);

    /// <summary>写回「动作人设」：夹取 → 写入配置 → 持久化。
    /// source 记 ai / user —— 面板据此提示"还有没有必要让 AI 重写"。
    /// touch=false 用于「只微调手感参数」（面板上拖幅度/节奏那几个滑块）：
    /// 那种改动不该重置"多久没重写人设"的计时，否则爱调手感的人会永远等不到重写提醒 ——
    /// 而那条提醒的本意是"记忆变了就该重新蒸馏"，与手感微调无关。</summary>
    internal void SaveMotionIdiom(MotionIdiom m, string source, bool touch = true)
    {
        if (m is null) return;
        m.Source = source ?? "";
        long prevUpdated = m.UpdatedUtc;
        m.Clamp();                    // 夹取（顺带刷新 UpdatedUtc）
        if (!touch) m.UpdatedUtc = prevUpdated;
        m.ApplyTo(Configuration);
        PersistConfig();
    }

    /// <summary>清空动作人设（文本清掉、手感回默认）。</summary>
    internal void ClearMotionIdiom() => SaveMotionIdiom(new MotionIdiom(), "user");

    /// <summary>保存 / 删除一个自定义造型（同名覆盖）。返回 false = 名字为空、姿势全零、或没找到要删的。</summary>
    internal bool MutateCustomPose(string name, string? poseJson, bool delete)
    {
        name = (name ?? "").Trim();
        if (name.Length == 0) return false;
        Dictionary<string, Dictionary<string, double>> map;
        try
        {
            map = string.IsNullOrWhiteSpace(Configuration.CustomPoses)
                ? new Dictionary<string, Dictionary<string, double>>()
                : JsonSerializer.Deserialize<Dictionary<string, Dictionary<string, double>>>(Configuration.CustomPoses)
                  ?? new Dictionary<string, Dictionary<string, double>>();
        }
        catch { map = new Dictionary<string, Dictionary<string, double>>(); }

        if (delete)
        {
            if (!map.Remove(name)) return false;
        }
        else
        {
            Dictionary<string, double>? pose;
            try { pose = JsonSerializer.Deserialize<Dictionary<string, double>>(poseJson ?? "{}"); }
            catch { return false; }
            if (pose is null) return false;
            // 丢掉零值通道：只留真正摆了的（配置小、看起来也清楚）
            var kept = new Dictionary<string, double>();
            foreach (var kv in pose) if (Math.Abs(kv.Value) > 0.5) kept[kv.Key] = kv.Value;
            if (kept.Count == 0) return false;     // 全零 = 根本没摆，拒绝存（否则会存出一个"没变化"的造型）
            map[name] = kept;
        }

        Configuration.CustomPoses = JsonSerializer.Serialize(map);
        PersistConfig();
        bridge?.SendMessage("options_update", new { customPoses = Configuration.CustomPoses });
        CustomPosesChanged?.Invoke();
        return true;
    }

    /// <summary>「具身动作」开关是否开启（AI 工具据此决定是否注册 / 是否可用）。</summary>
    public bool EmbodiedMotionEnabled => Configuration.EmbodiedMotion;

    /// <summary>开关变化时触发（供 DeskPetService 重新注册/注销 AI 工具，避免关闭时白占 token）。</summary>
    public event Action? EmbodiedMotionChanged;

    /// <summary>「具身表情」开关是否开启（AI 控制情绪/眼嘴；走 VRM 自带表情权重，不需要任何生成模型）。</summary>
    public bool EmbodiedExpressionEnabled => Configuration.EmbodiedExpression;

    /// <summary>具身表情开关变化时触发（同样按需注册/注销 AI 工具）。</summary>
    public event Action? EmbodiedExpressionChanged;

    /// <summary>下发一次具身表情：情绪 + 强度 + 保持秒数 + 眼嘴显式控制（-1 = 不干预）。</summary>
    public void ShowEmbodiedExpression(string emotion, double intensity = 0.8, double hold = 8, double mouth = -1, double eyes = -1,
        string? vad = null, string? au = null, double attack = 0, double decay = 0)
    {
        if (string.IsNullOrWhiteSpace(emotion)) return;
        // vad/au/attack/decay 是「连续表情」的扩展参数（详见 BodyExpressHost 的说明）：
        //   vad="愉悦,唤醒,支配"（各 -1..1）、au="通道名:权重,…"（单通道 ≤0.3）、
        //   attack=到 90% 的秒数、decay=衰减半衰期秒数。留空/0 = 用面板默认。
        bridge?.SendMessage("bodyexpress", new { emotion, intensity, hold, mouth, eyes, vad, au, attack, decay });
    }

    /// <summary>前端回报的「实际渲染」状态（供 AI 的 bodystate 查询，避免模型凭想象描述自己的表情）。</summary>
    string embodiedStateText = "（还没有收到身体状态回报：可能桌宠窗口刚打开、或未开启具身表情）";
    public string EmbodiedStateText { get { lock (threeLock) return embodiedStateText; } }

    /// <summary>把关键帧 spec（JSON）下发前端合成并播放。仅“具身动作”开启时有效。</summary>
    public void ComposeBody(string specJson)
    {
        if (string.IsNullOrWhiteSpace(specJson)) return;
        bridge?.SendMessage("embodied_compose", new { json = specJson });
    }
    public Task<Vector2> GetPosition()
    {
        if (window is null)
            return Task.FromResult(Vector2.Zero);
        float dpi = (float)window.Dpi;
        Rectangle bounds = window.Bounds;
        Vector2 position = new(
            (bounds.X + bounds.Width / 2.0f) * dpi,
            (bounds.Y + bounds.Height / 2.0f) * dpi);
        return Task.FromResult(position);
    }
    public async Task Move(Vector2 offset, float seconds)
    {
        if (disposed || window is null) return;
        float dpi = (float)window.Dpi;
        Rectangle bounds = window.Bounds;
        double startX = bounds.X;
        double startY = bounds.Y;
        double endX = startX + offset.X / dpi;
        double endY = startY + offset.Y / dpi;
        long startTick = Environment.TickCount64;
        int durationMs = (int)(seconds * 1000);
        if (durationMs <= 0) durationMs = 1;
        while (true)
        {
            long elapsed = Environment.TickCount64 - startTick;
            double t = Math.Min(1.0, (double)elapsed / durationMs);
            double ease = t * (2 - t);
            bounds.X = (int)Math.Round(startX + (endX - startX) * ease);
            bounds.Y = (int)Math.Round(startY + (endY - startY) * ease);
            // 每帧都检查：重载/停止时窗口可能已被销毁，继续 SetBounds 会让主进程抛
            // "BrowserWindow with id 'N' was not found"（该异常发生在主进程，插件侧 catch 不到）。
            if (disposed || window is null) break;
            try { window.SetBounds(bounds); } catch { break; }
            if (t >= 1.0) break;
            await Task.Delay(16);
        }
    }
    public void ResetWindow() => window?.ResetBounds();

    // ---- 内部状态 ----
    List<string> threeExpressions = new();
    List<string> threeMotions = new();
    List<string> threeParts = new();     // 模型部件（Mesh/材质分组元素）名清单，供“模型部件”菜单逐个开关
    string threeCurrentModel = "";
    string threeCurrentModelType = "";
    bool windowTop = true;
    bool headTrack = true;
    bool spineTrack = true;
    double headTrackStrength = 1;   // 头部/眼部追踪强度
    double spineTrackStrength = 1;  // 脊椎追踪强度
    bool blink = true;              // 自动眨眼
    DateTimeOffset lastAiInteraction = DateTimeOffset.MinValue;   // 上次触发 AI 的时间（冷却用）
    bool autoSit = false;      // 拖到任务栏自动落座状态（避免重复下发）
    readonly object threeLock = new();
    ServiceProvider provider = null!;
    PetWindow window = null!;
    PetBridge bridge = null!;
    /// <summary>插件已销毁（重载/停止）。置位后不再操作窗口，避免向已销毁的 BrowserWindow 发请求
    /// （主进程会抛 "BrowserWindow with id 'N' was not found"，该异常发生在主进程，插件侧 catch 不到）。</summary>
    volatile bool disposed = false;

    T Locked<T>(Func<T> f) { lock (threeLock) return f(); }

    protected override async Task OnAwake()
    {
        activeInstance = this;   // 先绑定：托盘点击始终指向当前实例（即便初始化中途失败也不会误调旧实例）
        await InitPetAsync();
        await RegisterHotkeysAsync();
    }
    protected override async Task OnDestroy()
    {
        disposed = true;   // 先置位：让仍在跑的 Move 循环/消息处理立刻停止操作窗口
        if (activeInstance == this) activeInstance = null;
        window = null!;
        bridge = null!;
        // 给在途的窗口命令（移动循环的最后一次 SetBounds 等）一点落地时间，
        // 避免 provider.DisposeAsync() 关窗瞬间正好有命令到达主进程而触发 "BrowserWindow not found"。
        await Task.Delay(150);
        if (provider is not null)
            await provider.DisposeAsync();
        DisposeTray();   // 顺手收掉托盘，Alife 退出时也不留残留图标
    }

    async Task InitPetAsync()
    {
        string modelName = Configuration.ModelName;
        if (string.IsNullOrWhiteSpace(modelName))
        {
            modelName = ThreeAvailableModels().FirstOrDefault() ?? "";
            Configuration.ModelName = modelName;
        }

        provider = BuildProvider();
        try
        {
            window = provider.GetRequiredService<PetWindow>();
            bridge = provider.GetRequiredService<PetBridge>();
            // 固定窗口尺寸 + 鼠标穿透（在创建窗口前设置）
            window.WindowWidth = Math.Max(220, Configuration.WindowWidth);
            window.WindowHeight = Math.Max(320, Configuration.WindowHeight);
            window.MouseThrough = Configuration.MouseThrough;
            // 待机/追踪状态从配置初始化（菜单与 options_update 用）
            headTrackStrength = Configuration.HeadTrackStrength;
            spineTrackStrength = Configuration.SpineTrackStrength;
            blink = Configuration.Blink;
            bridge.OnMessage += OnBridgeMessage;

            string wwwRoot = Path.Combine(
                pluginSystem.PluginContext.GetPluginDirectoryPath("presents.DeskPet3D"),
                "Resources", "ThreeDeskPet");
            await window.CreateAsync(wwwRoot, bridge);
            CreatePetTray();   // 系统托盘：左键切换显隐，避免“先躲起来”后找不到
            window.BroadcastCursor = Configuration.CursorTracking;
            SendMenuData();

            await LoadModelAsync(modelName);
        }
        catch
        {
            await provider.DisposeAsync();
            provider = null!;
            throw;
        }
    }

    ServiceProvider BuildProvider()
    {
        ServiceCollection services = new();
        services.AddSingleton(logger);
        services.AddSingleton(storageSystem);
        services.AddSingleton(alifeApplication);
        services.AddSingleton(new PetStorageKey(Character.StorageKey));
        services.AddSingleton<PetWindow>();
        services.AddSingleton<PetBridge>();
        return services.BuildServiceProvider();
    }

    void OnBridgeMessage(string type, JsonElement payload)
    {
        if (disposed) return;   // 已销毁：不再处理消息，避免对已销毁的 BrowserWindow 发请求
        if (type == "log")
        {
            string level = payload.TryGetProperty("level", out JsonElement levelProp) ? levelProp.GetString() ?? "" : "";
            string text = payload.TryGetProperty("text", out JsonElement textProp) ? textProp.GetString() ?? "" : "";
            if (string.IsNullOrEmpty(text)) return;
            if (level is "error" or "resource-error" or "unhandledrejection")
                AlifeLog.LogWarning($"[3D桌宠前端/{level}] {text}");
            else
                logger.LogInformation($"[3D桌宠前端/{level}] {text}");
            return;
        }
        if (type == "model_info")
        {
            try
            {
                lock (threeLock)
                {
                    threeExpressions.Clear();
                    threeMotions.Clear();
                    if (payload.TryGetProperty("expressions", out JsonElement exps) && exps.ValueKind == JsonValueKind.Array)
                        foreach (JsonElement e in exps.EnumerateArray())
                            if (e.ValueKind == JsonValueKind.String) threeExpressions.Add(e.GetString()!);
                    if (payload.TryGetProperty("motions", out JsonElement mots) && mots.ValueKind == JsonValueKind.Array)
                        foreach (JsonElement m in mots.EnumerateArray())
                            if (m.ValueKind == JsonValueKind.String) threeMotions.Add(m.GetString()!);
                    threeParts.Clear();
                    if (payload.TryGetProperty("parts", out JsonElement pts) && pts.ValueKind == JsonValueKind.Array)
                        foreach (JsonElement p in pts.EnumerateArray())
                            if (p.ValueKind == JsonValueKind.String) threeParts.Add(p.GetString()!);
                }
                AlifeLog.LogInformation($"[3D桌宠] 模型信息：{threeExpressions.Count} 表情 / {threeMotions.Count} 动作 / {threeParts.Count} 部件");
                SendMenuData();
            }
            catch (Exception e) { AlifeLog.LogError(e); }
            return;
        }
        if (type == "embodied_state")
        {
            // 前端回报"实际渲染"的表情/动作状态 → 缓存成一句话，供 AI 的 <bodystate> 查询
            try
            {
                if (payload.TryGetProperty("state", out JsonElement st) && st.ValueKind == JsonValueKind.Object)
                {
                    string emo = st.TryGetProperty("emotion", out JsonElement em) && em.ValueKind == JsonValueKind.String ? em.GetString() ?? "" : "";
                    bool active = st.TryGetProperty("active", out JsonElement ac) && ac.ValueKind == JsonValueKind.True;
                    double inten = st.TryGetProperty("intensity", out JsonElement it) && it.ValueKind == JsonValueKind.Number ? it.GetDouble() : 0;
                    bool dancing = st.TryGetProperty("dancing", out JsonElement da) && da.ValueKind == JsonValueKind.True;
                    string motion = st.TryGetProperty("motion", out JsonElement mo) && mo.ValueKind == JsonValueKind.String ? mo.GetString() ?? "" : "";
                    string weights = "";
                    if (st.TryGetProperty("weights", out JsonElement wt) && wt.ValueKind == JsonValueKind.Object)
                        weights = string.Join("、", wt.EnumerateObject()
                            .Where(p => p.Value.ValueKind == JsonValueKind.Number && p.Value.GetDouble() > 0.01)
                            .Select(p => $"{p.Name} {p.Value.GetDouble():0.00}"));

                    string note = st.TryGetProperty("note", out JsonElement nt) && nt.ValueKind == JsonValueKind.String ? nt.GetString() ?? "" : "";
                    // ★ 生成式动作的**验收结论**（"已通过自动验收 / 只是近似 / 已退回预置动作"）：
                    //   让 AI 知道它下发的 `gen:词条` 到底"真做到了"还是"退回了举手"——否则它会跟用户说错话。
                    string genNote = st.TryGetProperty("genNote", out JsonElement gn) && gn.ValueKind == JsonValueKind.String ? gn.GetString() ?? "" : "";

                    string text = (active ? $"表情：{emo}（强度 {inten:0.00}）" : "表情：没有 AI 驱动的表情，正在用你自己的静止/随机表情")
                        + (weights.Length > 0 ? $"；实际权重 {weights}" : "")
                        + (note.Length > 0 ? $"；注意：{note}" : "")
                        + (genNote.Length > 0 ? $"；生成式动作：{genNote}" : "")
                        + (dancing ? "；正在跳舞" : (motion.Length > 0 ? $"；正在播动作「{motion}」" : "；当前没有播动作"));
                    lock (threeLock) embodiedStateText = text;
                }
            }
            catch (Exception e) { AlifeLog.LogWarning("[3D桌宠] 解析身体状态回报失败: " + e.Message); }
            return;
        }
        if (type == "input")
        {
            string text = payload.TryGetProperty("text", out JsonElement t) ? t.GetString() ?? "" : "";
            OnInput?.Invoke(text);
            return;
        }
        if (type == "interacted")
        {
            string text = payload.TryGetProperty("text", out JsonElement t) ? t.GetString() ?? "" : "";
            // 戳一下：无论是否触发 AI，都给个可视反应（只做动作、不说话、不消耗 token）
            bridge?.SendMessage("action", new { name = "bounce" });
            if (Configuration.PokeTriggersAi) FireInteraction(text);
            return;
        }
        if (type == "pet_touch")
        {
            // ★ 鼠标"摸"（弹簧骨触摸物理，移植 Mate-Engine 的做法）：
            //   先给一个**不花钱**的可视反应（bounce）；是否唤起 AI 说话，由「摸到 → 触发回复」（原「摸摸头」，
            //   现在任意部位都算：头/头发/手/手臂/腿/裙摆…）开关决定
            //   —— 用户明确要求："这条会回馈给 AI、费 token，必须有开关让用户自己选"。
            string touchText = payload.TryGetProperty("text", out JsonElement tt) && tt.ValueKind == JsonValueKind.String
                ? (tt.GetString() ?? "摸了摸") : "摸了摸";
            bridge?.SendMessage("action", new { name = "bounce" });
            if (Configuration.PatTriggersAi) FireInteraction(touchText);
            return;
        }
        if (type == "drag_start")
        {
            threeDragPos = window.Bounds;
            window.KeepInteractiveFor(1500);   // 拖动期间强制不穿透，避免快速拖动被拦截中断
            window.SetDragging(true);          // 拖动期间不做落座位移，避免和手拖动互相打架
            return;
        }
        if (type == "need_rect")
        {
            // ★ 把窗口在屏幕上的位置/大小（物理像素）回给前端：鼠标"摸"需要把宿主下发的**全屏光标**
            //   换算成"窗口内坐标"——本机窗口是按模型轮廓像素级穿透的，光标落在人物上时**不一定**有 mousemove，
            //   前端因此拿不到窗口内光标（用户实测："依旧没反应"且没有诊断行）。前端每 3 秒问一次。
            try
            {
                var b = window.Bounds;
                // 前端把该回包当**物理像素**用（换算公式里会 ÷dpr），所以这里乘回 DPI
                double scale = window.Dpi <= 0 ? 1 : window.Dpi;
                bridge?.SendMessage("win_rect", new {
                    x = (int)Math.Round(b.X * scale),
                    y = (int)Math.Round(b.Y * scale),
                    w = (int)Math.Round(b.Width * scale),
                    h = (int)Math.Round(b.Height * scale),
                });
            }
            catch { }
            return;
        }
        if (type == "drag_end")
        {
            window.SetDragging(false);         // 松手后补一次落座对齐
            return;
        }
        if (type == "drag_move")
        {
            if (threeDragPos is Rectangle drag)
            {
                // Rectangle 现在是结构体（值类型）：改动必须写回 threeDragPos，否则下一次拖动消息会丢掉位移
                drag.X += payload.TryGetProperty("dx", out JsonElement dxp) ? dxp.GetInt32() : 0;
                drag.Y += payload.TryGetProperty("dy", out JsonElement dyp) ? dyp.GetInt32() : 0;
                threeDragPos = drag;
                try { window.SetBounds(drag); } catch (Exception e) { AlifeLog.LogWarning(e.Message); }
                window.KeepInteractiveFor(1500);
                // 拖到底部（窗口底边接近任务栏顶）自动坐；拖离自动站，模拟 MateEngine 手感
                int tb = window.TaskbarTop;
                bool near = tb > 0 && (drag.Y + drag.Height) >= tb - 12;
                if (near && !autoSit) { autoSit = true; bridge.SendMessage("posture", new { pose = "sit" }); }
                else if (!near && autoSit) { autoSit = false; bridge.SendMessage("posture", new { pose = "stand" }); }
            }
            return;
        }
        if (type == "pet_menu")
        {
            _ = HandleMenuAsync(payload);
            return;
        }
        if (type == "pet_bounds")
        {
            // 前端报告宠物在“窗口内”的可见矩形（CSS 像素）+ 接触线，用于：
            //   1) 鼠标穿透判定（只有宠物轮廓上不穿透）；
            //   2) dock=true 时把接触线（臀/脚）落到任务栏顶（腿自然垂在任务栏上）。
            // 窗口大小固定，不再随宠物包围盒收缩。
            try
            {
                double bx = payload.TryGetProperty("bx", out JsonElement bxEl) ? bxEl.GetDouble() : 0;
                double by = payload.TryGetProperty("by", out JsonElement byEl) ? byEl.GetDouble() : 0;
                double bw = payload.TryGetProperty("bw", out JsonElement bwEl) ? bwEl.GetDouble() : 0;
                double bh = payload.TryGetProperty("bh", out JsonElement bhEl) ? bhEl.GetDouble() : 0;
                double contactY = payload.TryGetProperty("contactY", out JsonElement cy) ? cy.GetDouble() : 0;
                bool dock = payload.TryGetProperty("dock", out JsonElement dk) && dk.ValueKind == JsonValueKind.True;
                window.SetBodyRect(bx, by, bw, bh);
                window.PlaceDock(dock, contactY);
            }
            catch { }
            return;
        }
        if (type == "pet_mask")
        {
            // 前端把"模型本体轮廓"降采样成网格发来，替换包围盒矩形：只有模型身体可点/可拖，
            // 四周空白与透明四角都穿透桌面（像素级命中）。data 为 base64 打包位图(LSB-first)。
            try
            {
                int cols = payload.TryGetProperty("cols", out JsonElement cEl) ? cEl.GetInt32() : 0;
                int rows = payload.TryGetProperty("rows", out JsonElement rEl) ? rEl.GetInt32() : 0;
                int cell = payload.TryGetProperty("cell", out JsonElement cellEl) ? cellEl.GetInt32() : 4;
                string b64 = payload.TryGetProperty("data", out JsonElement dEl) ? dEl.GetString() ?? "" : "";
                if (cols > 0 && rows > 0 && b64.Length > 0)
                {
                    byte[] bits = Convert.FromBase64String(b64);
                    window.SetBodyMask(cols, rows, cell, bits);
                }
            }
            catch { }
            return;
        }
        if (type == "ui_hover")
        {
            // 前端即时上报"光标是否在面板/菜单上"：在 UI 上立即关闭穿透，
            // 避免 mousedown 与 mouseup 之间被切成穿透、mouseup 送到桌面导致"点不动"。
            try { window.SetUiHover(payload.TryGetProperty("over", out JsonElement overEl) && overEl.ValueKind == JsonValueKind.True); }
            catch { }
            return;
        }
        if (type == "ui_bounds")
        {
            // 修复：这里原先缺少 type 判断，任何走到这一行的消息都会以"空 items"清掉 UI 矩形。
            // 前端报告当前展开的菜单/设置面板矩形（窗口内 CSS 像素）：显示期间这些区域必须可点击。
            try
            {
                List<Rectangle> rects = new();
                if (payload.TryGetProperty("items", out JsonElement items) && items.ValueKind == JsonValueKind.Array)
                {
                    foreach (JsonElement it in items.EnumerateArray())
                    {
                        double x = it.TryGetProperty("x", out JsonElement xv) ? xv.GetDouble() : 0;
                        double y = it.TryGetProperty("y", out JsonElement yv) ? yv.GetDouble() : 0;
                        double w = it.TryGetProperty("w", out JsonElement wv) ? wv.GetDouble() : 0;
                        double h = it.TryGetProperty("h", out JsonElement hv) ? hv.GetDouble() : 0;
                        if (w > 0 && h > 0)
                            rects.Add(new Rectangle { X = (int)Math.Round(x), Y = (int)Math.Round(y), Width = (int)Math.Round(w), Height = (int)Math.Round(h) });
                    }
                }
                window.SetUiRects(rects);
            }
            catch { }
            return;
        }
    }

    async Task LoadModelAsync(string modelName)
    {
        if (disposed || bridge is null) return;   // 正在卸载：放弃，避免往已关窗口发命令（防止主进程 BrowserWindow not found）
        if (string.IsNullOrWhiteSpace(modelName))
        {
            AlifeLog.LogWarning("[3D桌宠] 未配置模型（ThreeDeskPet/Models 下没有可用模型）。窗口将保持空场景，请在配置里指定模型文件夹。");
            return;
        }
        var (modelFile, modelType, motions) = ResolveModel(modelName);
        threeCurrentModelType = modelType;
        if (modelFile is null)
        {
            AlifeLog.LogWarning($"[3D桌宠] 找不到模型文件: {modelName}");
            return;
        }

        TaskCompletionSource loadedTcs = new(TaskCreationOptions.RunContinuationsAsynchronously);
        void Handler(string t, JsonElement _)
        {
            if (t == "loaded") { bridge.OnMessage -= Handler; loadedTcs.TrySetResult(); }
        }
        bridge.OnMessage += Handler;

        bridge?.SendMessage("load", new
        {
            modelType,
            url = new Uri(modelFile).AbsoluteUri,
            name = modelName,
            motions = motions.Select(m => new { name = m.name, url = m.url, kind = m.kind }).ToArray(),
            options = BuildLoadOptions(motions)
        });

        using CancellationTokenSource timeout = new(TimeSpan.FromSeconds(60));
        await loadedTcs.Task.WaitAsync(timeout.Token);
        threeCurrentModel = modelName;
        TryPlayBootMotion();
        // 初始加载也通知上层刷新表情/动作清单（晚于 OnAwake，确保 AI 能看到）
        ModelSwitched?.Invoke(modelName);
    }

    async Task SwitchModelInPlaceAsync(string modelName)
    {
        if (disposed || bridge is null) return;
        var (modelFile, modelType, motions) = ResolveModel(modelName);
        threeCurrentModelType = modelType;
        if (modelFile is null) throw new InvalidOperationException("找不到模型 " + modelName);

        TaskCompletionSource loadedTcs = new(TaskCreationOptions.RunContinuationsAsynchronously);
        void Handler(string t, JsonElement _)
        {
            if (t == "loaded") { bridge.OnMessage -= Handler; loadedTcs.TrySetResult(); }
        }
        bridge.OnMessage += Handler;

        bridge?.SendMessage("load", new
        {
            modelType,
            url = new Uri(modelFile).AbsoluteUri,
            name = modelName,
            motions = motions.Select(m => new { name = m.name, url = m.url, kind = m.kind }).ToArray(),
            options = BuildLoadOptions(motions)
        });

        using CancellationTokenSource timeout = new(TimeSpan.FromSeconds(60));
        await loadedTcs.Task.WaitAsync(timeout.Token);
        threeCurrentModel = modelName;
        TryPlayBootMotion();
    }

    object BuildLoadOptions(List<(string name, string url, string kind)> motions) => new
    {
        enableIK = Configuration.EnableIK,
        enablePhysics = Configuration.EnablePhysics,
        vrmPhysics = Configuration.VrmPhysics,
        lightingIntensity = Configuration.LightingIntensity,
        lightingPreset = Configuration.LightingPreset,
        lightAmbientColor = Configuration.LightAmbientColor,
        lightAmbientIntensity = Configuration.LightAmbientIntensity,
        lightKeyColor = Configuration.LightKeyColor,
        lightKeyIntensity = Configuration.LightKeyIntensity,
        enableAmbient = Configuration.EnableAmbientLight,
        ambientSaturation = Configuration.LightAmbientSaturation,
        ambient2Color = Configuration.LightAmbient2Color,
        ambient2Intensity = Configuration.LightAmbient2Intensity,
        ambient2Saturation = Configuration.LightAmbient2Saturation,
        ambient3Color = Configuration.LightAmbient3Color,
        ambient3Intensity = Configuration.LightAmbient3Intensity,
        ambient3Saturation = Configuration.LightAmbient3Saturation,
        enableKey = Configuration.EnableKeyLight,
        keySaturation = Configuration.LightKeySaturation,
        motionDuration = Configuration.MotionDuration,
        motionTransition = Configuration.MotionTransition,
        motionLoop = Configuration.MotionLoop,
        autoDance = Configuration.AutoDance,
        danceStyle = Configuration.DanceStyle,
        danceDuration = Configuration.DanceDuration,
        danceTransition = Configuration.DanceTransition,
        danceDisableTrack = Configuration.TrackOffDuringDance,
        embodiedMotion = Configuration.EmbodiedMotion,
        embodiedSmooth = Configuration.EmbodiedSmooth,
        embodiedExpression = Configuration.EmbodiedExpression,
        embodiedFaceMap = Configuration.EmbodiedFaceMap,
        motionIdiomRefreshDays = Configuration.MotionIdiomRefreshDays,
        customPoses = Configuration.CustomPoses,
        hiddenParts = SplitHiddenParts(),
        pmxArmDropDeg = Configuration.PmxArmDropDeg,
        scale = Configuration.ModelScale,
        cameraDistance = Configuration.CameraDistance,
        cameraYaw = Configuration.CameraYaw,
        cameraPitch = Configuration.CameraPitch,
        cameraHeight = Configuration.CameraHeight,
        background = Configuration.BackgroundColor,
        bootMotion = Configuration.BootMotion,
        cursorTracking = Configuration.CursorTracking,
        mouseThrough = Configuration.MouseThrough,
        quality = Configuration.Quality,
        poseOffsets = Configuration.PoseOffsets,
        rigProfile = Configuration.RigProfile,          // 骨架轴向/手指方向/面板数值的按模型存档
        idleAnimation = Configuration.IdleAnimation,
        idleIntensity = Configuration.IdleIntensity,
        idleSpeed = Configuration.IdleSpeed,
        idleGesture = Configuration.IdleGesture,
        idleGap = Configuration.IdleGap,
        blink = Configuration.Blink,
        headTrackStrength = Configuration.HeadTrackStrength,
        spineTrackStrength = Configuration.SpineTrackStrength,
        pokeTriggersAi = Configuration.PokeTriggersAi,
        greetTriggersAi = Configuration.GreetTriggersAi,
        patTriggersAi = Configuration.PatTriggersAi,
        interactionCooldown = Configuration.InteractionCooldown,
        bottomMargin = Configuration.BottomMargin,
        danceExpression = Configuration.DanceExpression,
        baseExpression = Configuration.BaseExpression,
        baseExpressionWeight = Configuration.BaseExpressionWeight,
        motions = motions.Select(m => new { name = m.name, url = m.url, kind = m.kind }).ToArray(),
    };

    void TryPlayBootMotion()
    {
        if (string.IsNullOrWhiteSpace(Configuration.BootMotion)) return;
        bridge?.SendMessage("motion", new { name = Configuration.BootMotion });
    }

    (string modelFile, string modelType, List<(string name, string url, string kind)> motions) ResolveModel(string modelName)
    {
        string dir;
        string? resolvedFile;
        string? resolvedType;

        // 1) 绝对路径直接指向 .vrm/.pmx 文件：直接用（支持把模型放在任意盘，如 E:\VRM模型\...）
        if (Path.IsPathRooted(modelName) && !Directory.Exists(modelName))
        {
            if (File.Exists(modelName) &&
                (modelName.EndsWith(".vrm", StringComparison.OrdinalIgnoreCase)
                 || modelName.EndsWith(".pmx", StringComparison.OrdinalIgnoreCase)))
            {
                resolvedFile = modelName;
                resolvedType = modelName.EndsWith(".vrm", StringComparison.OrdinalIgnoreCase) ? "vrm" : "mmd";
                dir = Path.GetDirectoryName(modelName)!;
            }
            else return default;
        }
        // 2) 目录（绝对目录，或 Storage/<角色>/ThreeDeskPet/Models 下的"模型文件夹名"）：在目录内找首个模型文件
        else
        {
            dir = Path.IsPathRooted(modelName)
                ? modelName
                : Path.Combine(ThreeModelRoot(), modelName);
            if (!Directory.Exists(dir)) return default;

            resolvedFile = Directory.GetFiles(dir, "*.vrm", SearchOption.TopDirectoryOnly).FirstOrDefault()
                        ?? Directory.GetFiles(dir, "*.pmx", SearchOption.TopDirectoryOnly).FirstOrDefault();
            if (resolvedFile is null) return default;
            resolvedType = resolvedFile.EndsWith(".vrm", StringComparison.OrdinalIgnoreCase) ? "vrm" : "mmd";
        }

        List<(string name, string url, string kind)> motions = new();
        string motionsDir = Path.Combine(dir, "motions");
        if (Directory.Exists(motionsDir))
            ScanMotionDir(motionsDir, motions);
        // 额外动作目录（如 E:\VRMA 这类动作库）：递归扫描，与模型 motions 合并，无需拷贝
        if (!string.IsNullOrWhiteSpace(Configuration.ExtraMotionPaths))
        {
            foreach (string p in Configuration.ExtraMotionPaths.Split(new char[] { ';', '\n' }, StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
            {
                if (Directory.Exists(p)) ScanMotionDir(p, motions);
                else AlifeLog.LogWarning($"[3D桌宠] 额外动作目录不存在，已跳过：{p}");
            }
        }

        // ★★ v11.49：只留**与当前模型配套**的动作格式。
        //   用户实测（E:\VRMA）：66 个 .vrma + 44 个 .vmd —— 而这两类基本是**同一批舞的两个格式副本**
        //   （每个曲包里 vmd/ 与 vrma/ 各放一份）。全列 ⇒ AI 看到 200+ 个名字：
        //     ① 吃大量 token；② 一半点了根本播不了（VRM 只能播 vrma、PMX 只能播 vmd）。
        //   按模型类型过滤后：名字数量基本减半，且**清单里出现的必然能播**。
        if (Configuration.MotionMatchModelType && !string.IsNullOrEmpty(resolvedType))
        {
            string want = string.Equals(resolvedType, "mmd", StringComparison.OrdinalIgnoreCase) ? "vmd" : "vrma";
            int before = motions.Count;
            motions = motions.Where(m => string.Equals(m.kind, want, StringComparison.OrdinalIgnoreCase)).ToList();
            AlifeLog.LogInformation($"[3D桌宠] 动作已按模型类型过滤（当前 {resolvedType} ⇒ 只留 {want}）：{before} → {motions.Count}");
        }
        return (resolvedFile, resolvedType, motions);
    }

    /// <summary>递归扫描一个目录下的动作文件（.vmd/.vrma/.vrm）并加入 motions。
    /// 子目录也扫（用户常按分类把 VRMA 放进 sunbathing/ 这类子文件夹）。
    ///
    /// ★ 去重规则（这里踩过一个大坑）：**按「路径」去重，不按「文件名」**。
    ///   旧实现用裸文件名当身份、同名直接丢弃，于是各动作库里那些通用名（`动作.vmd`、`motion.vmd`、
    ///   `idle.vmd`…）互相顶掉 —— 几十个动作最后只剩一个，日志里成片刷
    ///   `动作名重复，已跳过：动作（E:\Nyalume-...\手势舞比心\动作.vmd）` 就是它的指纹（用户实测"导入了但动作很少"）。
    ///   现在：同一个文件被多个扫描根重复扫到才跳过；显示名用「子目录/文件名」保证可区分，
    ///   万一仍重名就加 ` (2)` 序号 —— **任何情况下都不再丢动作**。
    /// </summary>
    /// <summary>动作库里常见的"格式文件夹"名：它们**不能**当动作名的前缀（否则一长串都顶着同一个前缀）。</summary>
    static readonly HashSet<string> FormatDirNames = new(StringComparer.OrdinalIgnoreCase)
    { "vmd", "vrma", "vrm", "motions", "motion", "dance", "dances", "动画", "动作" };

    void ScanMotionDir(string dir, List<(string name, string url, string kind)> motions)
    {
        var seenNames = new HashSet<string>(motions.Select(m => m.name), StringComparer.OrdinalIgnoreCase);
        var seenUrls = new HashSet<string>(motions.Select(m => m.url), StringComparer.OrdinalIgnoreCase);
        void AddIfNew(string f, string kind)
        {
            string url = new Uri(f).AbsoluteUri;
            if (!seenUrls.Add(url)) return;   // 同一文件（被不同扫描根重复扫到）⇒ 才算真重复
            string stem = Path.GetFileNameWithoutExtension(f);
            string dirOf = Path.GetDirectoryName(f) ?? "";
            string parent = Path.GetFileName(dirOf);
            // ★ v11.49：父目录只是**格式文件夹**（vmd / vrma / motions…）时，改用**再上一层**（曲名）当前缀。
            //   实测 E:\VRMA 的结构是 `<曲名>\<曲名>\vmd\<曲名>.vmd` ⇒ 旧逻辑给出的名字全是
            //   `vrma/xxx`、`vmd/xxx` —— 前缀是格式名，几十支舞都顶着同一个前缀，
            //   UI 里一长串根本没法按曲子找（用户："想挑动作放都不好找"）。
            //   跳过格式文件夹后名字变成 `<曲名>/<曲名>`，UI 端就能按曲名分组。
            if (FormatDirNames.Contains(parent))
            {
                string up = Path.GetFileName(Path.GetDirectoryName(dirOf) ?? "");
                if (!string.IsNullOrEmpty(up)) parent = up;
            }
            // 目录名与文件名相同（如 AI猫ダンス/AI猫ダンス.vmd）就只留一个，否则「目录/文件名」
            string name = (string.IsNullOrEmpty(parent) || string.Equals(parent, stem, StringComparison.OrdinalIgnoreCase))
                ? stem : parent + "/" + stem;
            string final = name;
            for (int i = 2; !seenNames.Add(final); i++) final = name + " (" + i + ")";
            motions.Add((final, url, kind));
        }
        foreach (string f in Directory.GetFiles(dir, "*.vmd", SearchOption.AllDirectories)) AddIfNew(f, "vmd");
        foreach (string f in Directory.GetFiles(dir, "*.vrma", SearchOption.AllDirectories)) AddIfNew(f, "vrma");
        foreach (string f in Directory.GetFiles(dir, "*.vrm", SearchOption.AllDirectories)) AddIfNew(f, "vrma");
    }

    // 固定模型目录（Storage/<角色>/ThreeDeskPet/Models/<名>/）下的模型文件夹名
    string[] FixedModelNames()
    {
        string root = ThreeModelRoot();
        if (!Directory.Exists(root)) return Array.Empty<string>();
        return Directory.GetDirectories(root)
            .Where(d => Directory.GetFiles(d, "*.vrm", SearchOption.TopDirectoryOnly).Length > 0
                     || Directory.GetFiles(d, "*.pmx", SearchOption.TopDirectoryOnly).Length > 0)
            .Select(Path.GetFileName)
            .Where(n => !string.IsNullOrEmpty(n))
            .ToArray()!;
    }

    // 额外模型目录（ExtraModelPaths，分号/换行分隔）里递归扫到的 .vrm/.pmx 绝对路径
    IEnumerable<string> ExtraModelFiles()
    {
        foreach (var raw in (Configuration.ExtraModelPaths ?? "")
            .Split(new[] { ';', '\n', '\r' }, StringSplitOptions.RemoveEmptyEntries))
        {
            string root = raw.Trim();
            if (root.Length == 0 || !Directory.Exists(root)) continue;
            string[] files;
            try
            {
                files = Directory.EnumerateFiles(root, "*", SearchOption.AllDirectories)
                    .Where(f => f.EndsWith(".vrm", StringComparison.OrdinalIgnoreCase)
                             || f.EndsWith(".pmx", StringComparison.OrdinalIgnoreCase))
                    .ToArray();
            }
            catch { continue; }
            foreach (var f in files) yield return f;
        }
    }

    string[] ThreeAvailableModels()
    {
        List<string> list = new(FixedModelNames());
        foreach (var f in ExtraModelFiles())
            if (!list.Contains(f, StringComparer.OrdinalIgnoreCase)) list.Add(f);
        return list.ToArray();
    }

    string ThreeModelRoot() => Path.Combine(AlifePath.StorageFolderPath, Character.StorageKey, "ThreeDeskPet", "Models");

    /// <summary>重扫当前模型的动作（含 ExtraMotionPaths），把新清单推给前端热重载，并刷新右键菜单。</summary>
    async Task ReloadMotionsAsync()
    {
        if (bridge is null || string.IsNullOrWhiteSpace(threeCurrentModel)) return;
        var (_, _, motions) = ResolveModel(threeCurrentModel);
        lock (threeLock)
        {
            threeMotions.Clear();
            threeMotions.AddRange(motions.Select(m => m.name));
        }
        bridge.SendMessage("motions_update", new
        {
            motions = motions.Select(m => new { name = m.name, url = m.url, kind = m.kind }).ToArray()
        });
        SendMenuData();   // 刷新右键“动作”子菜单（列出新动作）
    }

    // ★★ 配置落盘必须**互斥 + 原子 + 重试**：
    //   宿主自己也会写同一个文件（保存角色/其他插件配置），两边同时 `File.WriteAllText` 就抛
    //   `IOException: … is being used by another process` —— 实测一次点「全隐」（44 条设置消息）
    //   能刷出十几行，而且**那一次设置可能就没存上**（用户侧表现："改了过一会儿又回去了"）。
    //   做法：进程内锁（static ⇒ 覆盖多个实例）+ 写临时文件再原子替换 + 5 次退避重试。
    static readonly object _persistLock = new object();
    void PersistConfig()
    {
        string path = Path.Combine(AlifePath.StorageFolderPath, Character.StorageKey, "Configuration", $"{GetType().FullName}.json");
        string json = JsonSerializer.Serialize(Configuration, new JsonSerializerOptions { WriteIndented = true });
        lock (_persistLock)
        {
            for (int attempt = 0; attempt < 5; attempt++)
            {
                try
                {
                    Directory.CreateDirectory(Path.GetDirectoryName(path)!);
                    string tmp = path + ".tmp";
                    File.WriteAllText(tmp, json);
                    File.Move(tmp, path, true);        // 原子替换：读者要么看到旧内容、要么看到新内容
                    return;
                }
                catch (Exception e)
                {
                    if (attempt == 4) { AlifeLog.LogError("[3D桌宠] 配置保存失败（已重试 5 次）：" + e.Message); return; }
                    System.Threading.Thread.Sleep(40 * (attempt + 1));   // 40/80/120/160ms 退避
                }
            }
        }
    }

    // ================= 交互层：右键菜单 / 设置 / 拖动 / 隐藏 =================

    /// <summary>拖动时的窗口基准位置（渲染进程只发增量 dx/dy）。</summary>
    Rectangle? threeDragPos;
    bool petHidden;
    // 面板打开时"把画布加宽"的状态：记下面板打开前的**窗口尺寸**，关闭时原样还原。
    // ★ 为什么拆成 4 个 int 而不是存一个 Rectangle：本环境的 Rectangle 是**引用类型**，
    //   `Rectangle nb = panelSpaceBase;` 只是别名 ⇒ `nb.Width = ...` 会把"基准"本身也改掉
    //   ⇒ 每加宽一次基准就被改写一次（420 → 706 → 744 一路爬），"还原"永远还原到加宽后的宽度。
    //   实测症状：关掉设置面板画布缩不回去；日志里 `706 → 706`、`744 → 744`（起点终点同一对象）就是它的指纹。
    int panelSpaceBaseX, panelSpaceBaseY, panelSpaceBaseW, panelSpaceBaseH;
    bool panelSpaceActive;

    static string Fmt(double v) => v.ToString("0.##", System.Globalization.CultureInfo.InvariantCulture);

    /// <summary>右键菜单树节点（能力驱动）：由 C# 按当前模型类型与可用能力组装，渲染进程递归渲染。</summary>
    class PetMenuItem
    {
        public string uid = "";
        public string label = "";
        public string icon = "";
        public bool visible = true;
        public bool sep;
        public string? action;      // 叶子动作：greet/poke/expression/motion/model/reset/hide/setting
        public object? arg;         // 动作附加参数（如 { name } / { key, value }）
        public string? value;       // 叶子展示值（如模型"当前"标记）
        public List<PetMenuItem>? children; // 子菜单
        public string? key;         // 设置项 key（action=="setting" 时）
        public string[]? options;   // 设置项可循环取值
        public string[]? labels;    // 对应展示文案
        // 滑块型设置项（右键菜单里把"弱/中/强"三档换成可拖动的真滑块）
        public bool slider = false;
        public double sliderMin = 0;
        public double sliderMax = 3;
        public double sliderStep = 0.1;
    }

    /// <summary>把右键菜单（按当前能力生成的菜单树）推给渲染进程。Mate-Engine 风格的分组，但条目由本引擎真实能力决定。</summary>
    // 配置里“隐藏的模型部件”按分号/换行分隔存，拆成数组用
    string[] SplitHiddenParts() =>
        (Configuration.HiddenModelParts ?? "")
        .Split(new[] { ';', '\n', '\r' }, StringSplitOptions.RemoveEmptyEntries)
        .Select(s => s.Trim()).Where(s => s.Length > 0).ToArray();

    void SendMenuData()
    {
        if (disposed || bridge is null) return;
        string[] exps, mots;
        lock (threeLock) { exps = threeExpressions.ToArray(); mots = threeMotions.ToArray(); }
        bool isMmd = string.Equals(threeCurrentModelType, "mmd", StringComparison.OrdinalIgnoreCase);

        int uidc = 0;
        PetMenuItem M(string label, string icon, string? action = null, object? arg = null,
            string? value = null, List<PetMenuItem>? children = null, string? key = null,
            string[]? options = null, string[]? labels = null, bool sep = false,
            bool slider = false, double sliderMin = 0, double sliderMax = 3, double sliderStep = 0.1)
            => new PetMenuItem { uid = "n" + (uidc++), label = label, icon = icon, action = action,
                arg = arg, value = value, children = children, key = key, options = options, labels = labels, sep = sep,
                slider = slider, sliderMin = sliderMin, sliderMax = sliderMax, sliderStep = sliderStep };

        // 根菜单：打招呼+摸摸它合并进“互动”（少占一项）；“重置位置”收进“设置”的“窗口”组
        List<PetMenuItem> root = new();

        // 互动：打招呼 + 摸摸它 + 先躲起来（三个常用操作收进一组，根菜单项数为偶、环形更对称）
        root.Add(M("互动", "👋", children: new List<PetMenuItem>
        {
            M("打个招呼", "👋", "greet"),
            M("摸摸它", "✋", "poke"),
            M("先躲起来", "🙈", "hide"),
        }));
        // 表情：列表改为 webview 浮层（宿主菜单弹在右键位置、常压在人物身上，看不到表情效果）。
        // 入口**还是原来的「表情」**，位置、名字都不变；只是点开的是一个可拖拽的浮层，不再逐条列在菜单里。
        if (exps.Length > 0)
            root.Add(M("表情", "😊", "open_expressions"));

        // 动作：**和「表情」一致** —— 点开就是 webview 浮层，不再弹子菜单。
        // 原子菜单里的条目**一个不少**地搬进了浮层（导入动作文件夹 / 加载具身动作文件 / 舞蹈时关闭追踪 /
        // 具身动作·表情(实验) / 播放具身示例 / 试做具身动作(挥手) / 试做表情(开心)），
        // 只是从"菜单里逐条"变成"面板里逐条" —— 这样挑动作时能一直看到人物在跳什么。
        root.Add(M("动作", "💃", "open_motions"));

        // 模型：**和「动作」「表情」一致** —— 点开就是 webview 浮层（宿主把模型清单发过去，前端逐行画）。
        // 原来子菜单里的条目都在浮层里：每个模型一行（当前那个标「当前」）+「📁 加载模型…」。
        root.Add(M("模型", "🧬", "open_models"));
        root.Add(M("重新加载模型/动作", "🔃", "reload"));   // 重新扫描 motions 目录（装了新动作后点这个，不用重启）
        root.Add(M("", "", sep: true));

        // 设置：按能力分组（视觉 / MMD / 窗口），命名参考 Mate-Engine 体感
        List<PetMenuItem> settings = new();
        settings.Add(M("视觉", "💡", children: new List<PetMenuItem>
        {
            M("光照", "•", "setting", key: "lighting", options: new[] { "studio", "soft", "flat" }, labels: new[] { "影棚", "柔和", "平光" }, value: Configuration.LightingPreset),
            M("光照强度", "•", "setting", key: "intensity", slider: true, sliderMin: 0.2, sliderMax: 3, sliderStep: 0.1, value: Fmt(Configuration.LightingIntensity)),
            M("氛围光", "•", "setting", key: "enable_ambient", options: new[] { "1", "0" }, labels: new[] { "开", "关" }, value: Configuration.EnableAmbientLight ? "1" : "0"),
            M("氛围光强度", "•", "setting", key: "amb_intensity", slider: true, sliderMin: 0, sliderMax: 3, sliderStep: 0.1, value: Fmt(Configuration.LightAmbientIntensity)),
            M("氛围光饱和", "•", "setting", key: "amb_saturation", slider: true, sliderMin: 0, sliderMax: 3, sliderStep: 0.1, value: Fmt(Configuration.LightAmbientSaturation)),
            M("灯光", "•", "setting", key: "enable_key", options: new[] { "1", "0" }, labels: new[] { "开", "关" }, value: Configuration.EnableKeyLight ? "1" : "0"),
            M("灯光强度", "•", "setting", key: "key_intensity", slider: true, sliderMin: 0, sliderMax: 3, sliderStep: 0.05, value: Fmt(Configuration.LightKeyIntensity)),
            M("灯光饱和", "•", "setting", key: "key_saturation", slider: true, sliderMin: 0, sliderMax: 3, sliderStep: 0.1, value: Fmt(Configuration.LightKeySaturation)),
            M("模型大小", "•", "setting", key: "scale", slider: true, sliderMin: 0.4, sliderMax: 2.2, sliderStep: 0.05, value: Fmt(Configuration.ModelScale)),
            M("相机距离", "•", "setting", key: "camera", slider: true, sliderMin: 3, sliderMax: 12, sliderStep: 0.5, value: Fmt(Configuration.CameraDistance)),
        }));
        if (isMmd)
            settings.Add(M("MMD", "🦴", children: new List<PetMenuItem>
            {
                M("IK", "•", "setting", key: "ik", options: new[] { "1", "0" }, labels: new[] { "开", "关" }, value: Configuration.EnableIK ? "1" : "0"),
                M("物理", "•", "setting", key: "physics", options: new[] { "1", "0" }, labels: new[] { "开", "关" }, value: Configuration.EnablePhysics ? "1" : "0"),
                // 手臂收拢：MMD 标准静止姿势是 A-pose(双臂张开)。不同模型骨骼轴向不统一，
                // 正负方向哪个对就用哪个（拖滑块实时预览即可），0=保持模型原样。
                M("手臂收拢(度)", "•", "setting", key: "pmx_arm_drop", slider: true,
                    sliderMin: -60, sliderMax: 60, sliderStep: 1, value: Fmt(Configuration.PmxArmDropDeg)),
            }));
        else
            settings.Add(M("VRM", "🦴", children: new List<PetMenuItem>
            {
                // VRM 的"物理"= 弹簧骨（头发/裙子/胸）。three-vrm 每帧由 vrm.update 积分 ⇒ **本来就是开着的**，
                // 以前只是没有开关。放在与 MMD 对称的位置（设置 → VRM → 物理），免得用户满处找。
                M("物理(弹簧骨)", "•", "setting", key: "vrm_physics", options: new[] { "1", "0" }, labels: new[] { "开", "关" }, value: Configuration.VrmPhysics ? "1" : "0"),
            }));
        settings.Add(M("窗口", "🪟", children: new List<PetMenuItem>
        {
            M("置顶", "•", "setting", key: "top", options: new[] { "1", "0" }, labels: new[] { "开", "关" }, value: windowTop ? "1" : "0"),
            M("鼠标穿透", "•", "setting", key: "mouse_through", options: new[] { "1", "0" }, labels: new[] { "开", "关" }, value: Configuration.MouseThrough ? "1" : "0"),
            M("重置位置", "🎯", "reset"),
        }));
        settings.Add(M("互动", "🖱️", children: new List<PetMenuItem>
        {
            M("头部追踪", "•", "setting", key: "head_track", options: new[] { "1", "0" }, labels: new[] { "开", "关" }, value: headTrack ? "1" : "0"),
            M("脊椎追踪", "•", "setting", key: "spine_track", options: new[] { "1", "0" }, labels: new[] { "开", "关" }, value: spineTrack ? "1" : "0"),
            M(Math.Abs(Configuration.CameraYaw) < 90 ? "翻转朝向：正常" : "翻转朝向：已翻转", "🔄", "flipFacing"),
        }));
        // 待机 = 循环播放短 VRMA 动作。这里只放真正生效的项：
        //   • 开关 / 动作间隔 / 自动眨眼         —— VRM、PMX 都生效
        //   • 待机强度 / 待机速度               —— 属于“程序化微动”(呼吸/重心)，只有 PMX(MMD) 用得上
        //     （VRM 的待机完全由 VRMA 动作驱动，这两个滑块对 VRM 毫无作用 → 仅 MMD 显示，免得看着像没用）
        var idleChildren = new List<PetMenuItem>
        {
            M("待机动画", "•", "setting", key: "idle", options: new[] { "1", "0" }, labels: new[] { "开", "关" }, value: Configuration.IdleAnimation ? "1" : "0"),
            // 待机现在=循环播放短 VRMA：这里调“动作与动作之间”的间隔(秒)，0=无缝连播
            M("动作间隔(秒)", "•", "setting", key: "idle_gap", slider: true,
                sliderMin: 0, sliderMax: 6, sliderStep: 0.1, value: Fmt(Configuration.IdleGap)),
            M("自动眨眼", "•", "setting", key: "blink", options: new[] { "1", "0" }, labels: new[] { "开", "关" }, value: Configuration.Blink ? "1" : "0"),
        };
        if (isMmd)
        {
            idleChildren.Add(M("待机强度", "•", "setting", key: "idle_intensity", slider: true,
                sliderMin: 0, sliderMax: 3, sliderStep: 0.1, value: Fmt(Configuration.IdleIntensity)));
            idleChildren.Add(M("待机速度", "•", "setting", key: "idle_speed", slider: true,
                sliderMin: 0.5, sliderMax: 2, sliderStep: 0.1, value: Fmt(Configuration.IdleSpeed)));
        }
        settings.Add(M("待机", "🧍", children: idleChildren));
        settings.Add(M("舞蹈", "💃", children: new List<PetMenuItem>
        {
            M("自动跳舞", "•", "setting", key: "dance", options: new[] { "1", "0" }, labels: new[] { "开", "关" }, value: Configuration.AutoDance ? "1" : "0"),
            M("跳舞风格", "•", "setting", key: "dance_style", options: new[] { "0", "1" }, labels: new[] { "随机", "顺序" }, value: Configuration.DanceStyle.ToString()),
            M("跳舞时长", "•", "setting", key: "dance_duration", options: new[] { "8", "14", "24" }, labels: new[] { "短", "中", "长" }, value: Fmt(Configuration.DanceDuration)),
        }));
        settings.Add(M("触发回复(省token)", "💬", children: new List<PetMenuItem>
        {
            M("戳一下", "•", "setting", key: "poke_ai", options: new[] { "1", "0" }, labels: new[] { "触发", "不触发" }, value: Configuration.PokeTriggersAi ? "1" : "0"),
            M("打招呼", "•", "setting", key: "greet_ai", options: new[] { "1", "0" }, labels: new[] { "触发", "不触发" }, value: Configuration.GreetTriggersAi ? "1" : "0"),
            M("被摸到（任意部位）", "•", "setting", key: "pat_ai", options: new[] { "1", "0" }, labels: new[] { "触发", "不触发" }, value: Configuration.PatTriggersAi ? "1" : "0"),
            M("冷却(秒)", "•", "setting", key: "interact_cooldown", options: new[] { "0", "10", "30" }, labels: new[] { "不冷却", "10秒", "30秒" }, value: Fmt(Configuration.InteractionCooldown)),
        }));
        // 画质（低/中/高 → 渲染像素比）：照 EXE 的右键菜单，作为“设置”下与 视觉/窗口… 平级的独立项
        settings.Add(M("画质", "•", "setting", key: "quality", options: new[] { "low", "med", "high" }, labels: new[] { "低", "中", "高" }, value: string.IsNullOrEmpty(Configuration.Quality) ? "high" : Configuration.Quality));
        root.Add(M("设置", "⚙️", children: settings));

        // 模型部件：改为打开 webview 浮层（像设置面板，右侧可拖拽 + 打开时让位，不挡人物）；
        // 部件清单在前端 pet.js 里直接收集渲染，不再用原生子菜单（部件多时高得挡住人物）。
        root.Add(M("模型部件", "🧩", "open_model_parts"));

        // 姿势（仅 VRM 有意义；MMD 用物理/IK 表现）回到根菜单
        if (!isMmd)
            root.Add(M("姿势", "🪑", children: new List<PetMenuItem>
            {
                M("站立", "•", "posture", new { pose = "stand" }),
                M("坐到任务栏", "🪑", "posture", new { pose = "sit" }),
                M("仰躺", "•", "posture", new { pose = "lieback" }),
            }));
        root.Add(M("设置面板", "🎛️", "settings"));
        root.Add(M("关闭桌宠", "🚪", "close_pet"));   // 真正退出本桌宠（关窗口+收托盘），不牵连 Alife 宿主

        bridge.SendMessage("menu_data", new { menu = root });
    }

    async Task HandleMenuAsync(JsonElement payload)
    {
        string action = payload.TryGetProperty("action", out JsonElement ap) ? ap.GetString() ?? "" : "";
        try
        {
            switch (action)
            {
                case "greet":
                    bridge?.SendMessage("action", new { name = "wave" });
                    if (Configuration.GreetTriggersAi) FireInteraction("和桌宠打了个招呼");
                    break;
                case "poke":
                    bridge?.SendMessage("action", new { name = "shy" });
                    if (Configuration.PatTriggersAi) FireInteraction("摸了摸桌宠");
                    break;
                case "action":
                    if (payload.TryGetProperty("name", out JsonElement an))
                        bridge?.SendMessage("action", new { name = an.GetString() });
                    break;
                case "expression":
                    if (payload.TryGetProperty("name", out JsonElement en)) await ShowExpression(en.GetString());
                    break;
                case "motion":
                    if (payload.TryGetProperty("name", out JsonElement mn)) await ShowMotion(mn.GetString());
                    break;
                case "model":
                    if (payload.TryGetProperty("name", out JsonElement mo))
                    {
                        string name = mo.GetString() ?? "";
                        if (!string.IsNullOrWhiteSpace(name) && !string.Equals(name, threeCurrentModel, StringComparison.OrdinalIgnoreCase))
                        {
                            await SwitchModelInPlaceAsync(name);
                            Configuration.ModelName = name;
                            PersistConfig();
                            ModelSwitched?.Invoke(name);
                        }
                    }
                    break;
                case "reload":   // 重新加载当前模型与动作（重新扫描 motions 目录）
                    try
                    {
                        string cur = threeCurrentModel;
                        if (!string.IsNullOrWhiteSpace(cur))
                        {
                            await SwitchModelInPlaceAsync(cur);
                            ModelSwitched?.Invoke(cur);
                            AlifeLog.LogInformation("[3D桌宠] 已重新加载模型与动作");
                        }
                    }
                    catch (Exception e) { AlifeLog.LogError(e); }
                    break;
                case "import_motion":   // 选择本地动作文件夹（.vrma/.vmd/.vrm），加入 ExtraMotionPaths 并热重载
                    try
                    {
                        AlifeLog.LogInformation("[3D桌宠] 收到 import_motion：正在打开文件夹选择框…");
                        // Alife 5 的宿主只提供"单选文件夹"，不再有多选；要加多个目录就再点一次
                        string? folder = await alifeApplication.SelectFolderAsync();
                        if (string.IsNullOrWhiteSpace(folder))
                        {
                            // 取消也要留痕：以前这里完全静默，日志里看不出"是没点到、还是取消了"
                            AlifeLog.LogInformation("[3D桌宠] import_motion：未选择文件夹（已取消）");
                        }
                        else
                        {
                            var list = new List<string>((Configuration.ExtraMotionPaths ?? "").Split(
                                new char[] { ';', '\n' }, StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries));
                            bool added = false;
                            if (Directory.Exists(folder) && !list.Contains(folder, StringComparer.OrdinalIgnoreCase)) { list.Add(folder); added = true; }
                            if (added)
                            {
                                Configuration.ExtraMotionPaths = string.Join(";", list);
                                PersistConfig();
                            }
                            else
                            {
                                // ★ 这条是以前的静默坑：目录**已经在配置里**时，旧代码连重新扫描都不做 ⇒
                                //   用户按了"加载动作文件夹"却"动作还是 0"（实测症状）。现在已存在的目录也强制重扫。
                                AlifeLog.LogInformation("[3D桌宠] import_motion：所选目录已在列表里，仍重新扫描一次");
                            }
                            await ReloadMotionsAsync();
                            int motionCount;
                            lock (threeLock) motionCount = threeMotions.Count;
                            AlifeLog.LogInformation($"[3D桌宠] 已添加动作目录：{Configuration.ExtraMotionPaths}（当前动作 {motionCount} 个）");
                        }
                    }
                    catch (Exception e) { AlifeLog.LogError(e); }
                    break;
                case "import_model":   // 选择本地模型文件夹，递归扫描里面所有 .vrm/.pmx，列出让用户挑一个加载
                    try
                    {
                        AlifeLog.LogInformation("[3D桌宠] 收到 import_model：正在打开文件夹选择框…");
                        string? pickedFolder = await alifeApplication.SelectFolderAsync();
                        if (!string.IsNullOrWhiteSpace(pickedFolder))
                        {
                            string folder = pickedFolder;
                            // 记住这个目录，下次自动列进右键“模型”子菜单（与独立版 EXE 的 modelDirs 行为一致）
                            {
                                var dirs = (Configuration.ExtraModelPaths ?? "")
                                    .Split(new[] { ';', '\n', '\r' }, StringSplitOptions.RemoveEmptyEntries)
                                    .Select(s => s.Trim()).Where(s => s.Length > 0).ToList();
                                if (!dirs.Any(p => string.Equals(p, folder, StringComparison.OrdinalIgnoreCase)))
                                {
                                    dirs.Add(folder);
                                    Configuration.ExtraModelPaths = string.Join(";", dirs);
                                    PersistConfig();
                                    SendMenuData();
                                }
                            }
                            var models = ScanModelFilesRecursive(folder);
                            if (models.Count == 0)
                            {
                                bridge?.SendMessage("model_candidates", new { folder = folder, items = Array.Empty<object>(), note = "该文件夹及子目录内未找到 .vrm / .pmx 模型文件" });
                            }
                            else if (models.Count == 1)
                            {
                                await LoadModelByPathAsync(models[0]);
                            }
                            else
                            {
                                bridge?.SendMessage("model_candidates", new
                                {
                                    folder = folder,
                                    items = models.Select(p => new { path = p, name = Path.GetFileName(p) }).ToArray(),
                                });
                            }
                        }
                    }
                    catch (Exception e) { AlifeLog.LogError(e); }
                    break;
                case "load_model_file":   // 前端“选模型”面板点了某个具体文件 → 按绝对路径加载
                    try
                    {
                        if (payload.TryGetProperty("path", out JsonElement lp) && !string.IsNullOrWhiteSpace(lp.GetString()))
                            await LoadModelByPathAsync(lp.GetString()!);
                    }
                    catch (Exception e) { AlifeLog.LogError(e); }
                    break;
                case "reset":
                    window.ResetBounds();
                    bridge.SendMessage("posture", new { pose = "stand" });
                    break;
                case "hide":
                    HidePet(true);
                    break;
                case "posture":
                    if (payload.TryGetProperty("pose", out JsonElement pp))
                    {
                        string pose = pp.GetString() ?? "stand";
                        // 落座由前端在切姿势后通过 pet_bounds(dock=true) 处理，这里只下发姿势
                        if (!windowTop) { windowTop = true; try { window.SetTopMost(true); } catch { } }
                        autoSit = string.Equals(pose, "sit", StringComparison.OrdinalIgnoreCase);
                        bridge.SendMessage("posture", new { pose = pose });
                    }
                    break;
                case "pose_offsets":
                    if (payload.TryGetProperty("value", out JsonElement pov)) Configuration.PoseOffsets = pov.GetString() ?? "";
                    PersistConfig();
                    bridge.SendMessage("options_update", new { poseOffsets = Configuration.PoseOffsets });
                    break;
                case "rig_profile":        // 前端：骨架轴向/手指方向/面板数值的按模型存档（跨**插件重载**可靠）
                {
                    // 变量名必须独特：switch 各 case 共用外层作用域（见上面 pose_save 的注释）。
                    if (payload.TryGetProperty("value", out JsonElement rigPv))
                        Configuration.RigProfile = (rigPv.ValueKind == JsonValueKind.String) ? (rigPv.GetString() ?? "") : rigPv.ToString();
                    PersistConfig();
                    bridge.SendMessage("options_update", new { rigProfile = Configuration.RigProfile });
                    break;
                }
                case "setting":
                    ApplySetting(payload);
                    break;
                case "settings":
                    bridge.SendMessage("settings_open", new { });
                    break;
                case "motion_idiom":       // 前端：索取 / 用户保存编辑 / 请 AI 重写
                {
                    // 加花括号 + 独特变量名：switch 各 case 共用外层作用域，不加会把局部变量提升到整段 switch 里，
                    // 与其他 case 撞名就 CS0136（这条踩过一次，代价是一轮重载）。
                    string miCmd = payload.TryGetProperty("cmd", out JsonElement miCmdEl) ? (miCmdEl.GetString() ?? "") : "";
                    string miJson = payload.TryGetProperty("json", out JsonElement miJsonEl) ? (miJsonEl.GetString() ?? "") : "";
                    MotionStyleCommand?.Invoke(miCmd, miJson);
                    break;
                }
                case "pose_save":          // 用户在面板里摆好一个造型 → 存下来（之后 AI 可用 <bodyact preset="名字"/>）
                {
                    // 注意：switch 各 case 共用**外层作用域**，这里的 out 变量名必须独特，
                    // 否则会 CS0136（"无法在此范围中声明名为 X 的局部变量"）—— 我用 pn 撞过外层那个 pn。
                    string poseSaveName = payload.TryGetProperty("name", out JsonElement poseNameEl) ? (poseNameEl.GetString() ?? "") : "";
                    string poseSaveJson = payload.TryGetProperty("pose", out JsonElement poseJsonEl) ? (poseJsonEl.GetString() ?? "") : "";
                    if (MutateCustomPose(poseSaveName, poseSaveJson, false))
                        AlifeLog.LogInformation("[3D桌宠] 已保存自定义造型：" + poseSaveName);
                    else
                        AlifeLog.LogWarning("[3D桌宠] 造型保存被拒绝（名字为空 / 姿势全是 0 / JSON 不合法）");
                    break;
                }
                case "pose_delete":
                {
                    string poseDelName = payload.TryGetProperty("name", out JsonElement poseDelEl) ? (poseDelEl.GetString() ?? "") : "";
                    if (MutateCustomPose(poseDelName, null, true))
                        AlifeLog.LogInformation("[3D桌宠] 已删除自定义造型：" + poseDelName);
                    break;
                }
                case "embodied_sample":   // 播放具身示例（前端走真实 embodied_frames 通道注入内置动作）
                    bridge?.SendMessage("embodied_sample", new { });
                    break;
                case "embodied_wave":     // 试做具身动作：预设“挥手”（与 AI 的 <bodyact preset="wave"/> 同一链路）
                    bridge?.SendMessage("embodied_wave", new { });
                    break;
                case "embodied_happy":    // 试做具身表情：情绪=开心（与 AI 的 <bodyexpress emotion="happy"/> 同一链路）
                    ShowEmbodiedExpression("happy", 0.85, 8);
                    break;
                case "embodied_preset":   // 试做任意具身预设（背手 / 双手比心 …）
                    if (payload.TryGetProperty("name", out JsonElement pn))
                        bridge?.SendMessage("embodied_preset", new { name = pn.GetString() });
                    break;
                case "import_embodied":   // 选择具身动作 JSON 文件 → 读文本经 embodied_frames 推给前端
                    try
                    {
                        // Alife 5 没有文件选择 API：借托盘 STA 线程的消息泵弹 WinForms 对话框
                        string? file = await PickFileAsync(
                            "选择具身动作文件（.json：{fps, frames:[{joints:{骨骼:[x,y,z,w]}}]}）",
                            "具身动作 JSON|*.json");
                        if (!string.IsNullOrWhiteSpace(file) && File.Exists(file))
                        {
                            bridge?.SendMessage("embodied_frames", new { json = File.ReadAllText(file) });
                            AlifeLog.LogInformation("[3D桌宠] 已加载具身动作文件：" + file);
                        }
                    }
                    catch (Exception e) { AlifeLog.LogError(e); }
                    break;
                case "open_model_parts":   // 打开 webview 的“模型部件”浮层（不挡人物）
                    AlifeLog.LogInformation("[3D桌宠] 打开浮层：模型部件");
                    bridge.SendMessage("model_parts_open", new { });
                    break;
                case "open_motions":   // 打开 webview 的“动作”浮层（不挡人物）
                    // 这行日志的用途：把"点击没反应"一刀切成两种情况 ——
                    //   有这行 ⇒ 消息到了前端，面板一定被画出来了（看不见就是"画在窗口外/被夹住"，见前端 clampPanelIntoView）；
                    //   没这行 ⇒ 菜单项没被点到 / 消息没发出来（问题在宿主或菜单这一侧）。
                    AlifeLog.LogInformation("[3D桌宠] 打开浮层：动作");
                    bridge.SendMessage("motions_open", new { });
                    break;
                case "open_expressions":   // 打开 webview 的“表情”浮层（不挡人物）
                    AlifeLog.LogInformation("[3D桌宠] 打开浮层：表情");
                    bridge.SendMessage("expressions_open", new { });
                    break;
                case "open_models":   // 打开 webview 的“模型”浮层（不挡人物）。清单由宿主给，前端只负责画
                    {
                        AlifeLog.LogInformation("[3D桌宠] 打开浮层：模型");
                        var items = new List<object>();
                        // 固定模型目录：标签=文件夹名，标识=文件夹名（按 Storage/.../Models/<名> 找）
                        foreach (var n in FixedModelNames())
                            items.Add(new
                            {
                                name = n,
                                label = n,
                                current = string.Equals(n, threeCurrentModel, StringComparison.OrdinalIgnoreCase),
                            });
                        // 额外模型目录：标签=文件名，标识=绝对路径
                        foreach (var f in ExtraModelFiles())
                            items.Add(new
                            {
                                name = f,
                                label = Path.GetFileNameWithoutExtension(f),
                                current = string.Equals(f, threeCurrentModel, StringComparison.OrdinalIgnoreCase),
                            });
                        bridge.SendMessage("models_open", new { models = items });
                    }
                    break;
                case "close_pet":   // 只关本桌宠窗口，不牵连 Alife 宿主
                    ClosePet();
                    break;
                case "panel_space":   // 面板打开/关闭：临时**加宽画布**，人物保持原大、面板占新空间
                    // 用户要求："不如老老实实搞画布自动扩大" —— 不再靠缩小人物去避让。
                    // 左右各扩一半 ⇒ 人物在屏幕上的视觉位置不变；关闭面板时原样还原。
                    {
                        try
                        {
                            int extra = 0;
                            if (payload.TryGetProperty("extra", out JsonElement exEl))
                            {
                                if (exEl.ValueKind == JsonValueKind.Number) extra = exEl.GetInt32();
                                else if (exEl.ValueKind == JsonValueKind.String && int.TryParse(exEl.GetString(), out int exNum)) extra = exNum;
                            }
                            string side = "right";
                            if (payload.TryGetProperty("side", out JsonElement sdEl) && sdEl.ValueKind == JsonValueKind.String) side = sdEl.GetString() ?? "right";
                            extra = Math.Max(0, Math.Min(420, extra));   // 上限 420px：再宽就"扩得有点大了"
                            bool want = payload.TryGetProperty("open", out JsonElement opEl) && opEl.ValueKind == JsonValueKind.String && opEl.GetString() == "1";
                            AlifeLog.LogInformation($"[3D桌宠] 面板加宽请求：extra={extra}px open={want} side={side}（收到原始值 {exEl.ValueKind}）");
                            if (want && extra > 0)
                            {
                                if (!panelSpaceActive)
                                {
                                    // 基准尺寸取**配置值**（窗口本来按它创建：420×600），位置取当前值。
                                    // 绝不拿"当前宽度"当基准 —— 上次没还原时基准会被记成加宽后的宽度（踩过）。
                                    Rectangle cur = window.Bounds;
                                    // 用对象初始化器（本文件的 Rectangle 没有 4 参构造函数，写 new Rectangle(x,y,w,h) 会 CS1729）
                                    panelSpaceBaseX = cur.X;
                                    panelSpaceBaseY = cur.Y;
                                    panelSpaceBaseW = Math.Max(220, Configuration.WindowWidth);
                                    panelSpaceBaseH = Math.Max(320, Configuration.WindowHeight);
                                    panelSpaceActive = true;
                                }
                                // 目标矩形**每次新建**（int 字段是值拷贝，绝不会被别名改掉）
                                Rectangle nb = new Rectangle
                                {
                                    X = (side == "left") ? panelSpaceBaseX - extra : panelSpaceBaseX,
                                    Y = panelSpaceBaseY,
                                    Width = panelSpaceBaseW + extra,
                                    Height = panelSpaceBaseH,
                                };
                                window.SetBounds(nb);
                                AlifeLog.LogInformation($"[3D桌宠] 面板加宽画布：{panelSpaceBaseW} → {nb.Width}px（朝{side}扩，人物大小不变）");
                                // 再读一次实际 Bounds：SetBounds 若被系统/宿主夹住，这里会立刻看出来（别再靠猜）
                                AlifeLog.LogInformation($"[3D桌宠] 加宽后实际窗口宽度：{window.Bounds.Width}px");
                            }
                            else if (panelSpaceActive)
                            {
                                window.SetBounds(new Rectangle
                                {
                                    X = panelSpaceBaseX,
                                    Y = panelSpaceBaseY,
                                    Width = panelSpaceBaseW,
                                    Height = panelSpaceBaseH,
                                });
                                panelSpaceActive = false;
                                AlifeLog.LogInformation($"[3D桌宠] 面板关闭：画布宽度还原为 {panelSpaceBaseW}px");
                            }
                        }
                        catch (Exception e) { AlifeLog.LogWarning("[3D桌宠] 面板加宽画布失败（将退回缩小人物避让）：" + e.Message); }
                    }
                    break;
                case "flipFacing":
                    Configuration.CameraYaw = Math.Abs(Configuration.CameraYaw) < 90 ? 180 : 0;
                    PersistConfig();
                    bridge?.SendMessage("options_update", new { cameraYaw = Configuration.CameraYaw });
                    SendMenuData();   // 刷新菜单文案（正常/已翻转）
                    break;
            }
        }
        catch (Exception e) { AlifeLog.LogError(e); }
    }

    /// <summary>递归扫描文件夹内所有 .vrm / .pmx 模型文件（含子目录），按路径排序返回。</summary>
    static List<string> ScanModelFilesRecursive(string root)
    {
        var result = new List<string>();
        if (string.IsNullOrWhiteSpace(root) || !Directory.Exists(root)) return result;
        void Walk(string dir)
        {
            IEnumerable<string> files;
            try { files = Directory.EnumerateFiles(dir); }
            catch { return; }
            foreach (var f in files)
                if (f.EndsWith(".vrm", StringComparison.OrdinalIgnoreCase) || f.EndsWith(".pmx", StringComparison.OrdinalIgnoreCase))
                    result.Add(f);
            IEnumerable<string> dirs;
            try { dirs = Directory.EnumerateDirectories(dir); }
            catch { return; }
            foreach (var d in dirs) Walk(d);
        }
        Walk(root);
        result.Sort(StringComparer.OrdinalIgnoreCase);
        return result;
    }

    /// <summary>按任意绝对路径的模型文件加载（支持把模型放在任意盘/任意目录，不要求放进 Models/&lt;名&gt;/）。
    /// 失败自动回滚到上一个模型。</summary>
    async Task LoadModelByPathAsync(string path)
    {
        if (bridge is null) return;
        if (!File.Exists(path)) { AlifeLog.LogWarning("[3D桌宠] 模型文件不存在: " + path); return; }
        string previous = Configuration.ModelName;
        Configuration.ModelName = path;
        PersistConfig();
        try
        {
            await SwitchModelInPlaceAsync(path);
            ModelSwitched?.Invoke(path);
            AlifeLog.LogInformation("[3D桌宠] 已加载模型（任意路径）：" + path);
            SendMenuData();   // 刷新右键“模型”子菜单的“当前”标记
        }
        catch (Exception e)
        {
            AlifeLog.LogError(e);
            Configuration.ModelName = previous;
            PersistConfig();
            try { await SwitchModelInPlaceAsync(previous); } catch (Exception e2) { AlifeLog.LogError(e2); }
        }
    }

    /// <summary>
    /// 触发一次"需要 AI 回复"的交互。受互动冷却限制：冷却期内重复触发会被忽略，避免误触连续消耗 token。
    /// </summary>
    void FireInteraction(string text)
    {
        double cd = Configuration.InteractionCooldown;
        if (cd > 0)
        {
            DateTimeOffset now = DateTimeOffset.Now;
            if ((now - lastAiInteraction).TotalSeconds < cd)
            {
                AlifeLog.LogInformation($"[3D桌宠] 互动冷却中（{cd:0.##}s），本次不触发 AI 回复");
                return;
            }
            lastAiInteraction = now;
        }
        OnInteracted?.Invoke(text);
    }

    void ApplySetting(JsonElement payload)
    {
        string key = payload.TryGetProperty("key", out JsonElement k) ? k.GetString() ?? "" : "";
        string val = payload.TryGetProperty("value", out JsonElement v) ? v.GetString() ?? "" : "";
        double num = double.TryParse(val, System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out double d) ? d : 0;
        switch (key)
        {
            case "lighting": Configuration.LightingPreset = val; break;
            case "intensity": if (num > 0) Configuration.LightingIntensity = num; break;
            case "scale": if (num > 0) Configuration.ModelScale = num; break;
            case "camera": if (num > 0) Configuration.CameraDistance = num; break;
            case "yaw": Configuration.CameraYaw = num; break;
            case "pitch": Configuration.CameraPitch = num; break;
            case "height": Configuration.CameraHeight = num; break;
            case "amb_color": Configuration.LightAmbientColor = val; break;
            case "amb_intensity": if (num >= 0) Configuration.LightAmbientIntensity = num; break;
            case "key_color": Configuration.LightKeyColor = val; break;
            case "key_intensity": if (num >= 0) Configuration.LightKeyIntensity = num; break;
            case "background": Configuration.BackgroundColor = val; break;
            case "boot_motion": Configuration.BootMotion = val; break;
            case "pose_offsets": Configuration.PoseOffsets = val; break;
            // 生成式动作手感参数（骨盆/下肢/脊柱/根位移/平滑/收尾淡出）：落配置 + 立刻回传，
            //   否则重开窗口又回默认（用户实测）。前端只在"用户真调过"时才发，不会被回传覆盖。
            case "ardy_tune":
                Configuration.ArdyTune = val;
                PersistConfig();
                bridge?.SendMessage("options_update", new { ardyTune = Configuration.ArdyTune });
                break;
            case "ik": Configuration.EnableIK = val == "1"; break;
            case "physics": Configuration.EnablePhysics = val == "1"; break;
            // VRM 的"物理"= 弹簧骨（头发/裙子/胸），和上面 MMD 的 physics 是两套实现
            case "vrm_physics": Configuration.VrmPhysics = val == "1"; break;
            case "top":
                windowTop = val == "1";
                try { window.SetTopMost(windowTop); } catch (Exception e) { AlifeLog.LogWarning("置顶切换失败: " + e.Message); }
                break;
            case "head_track":
                headTrack = val == "1";
                break;
            case "spine_track":
                spineTrack = val == "1";
                break;
            case "cursor_track":
                Configuration.CursorTracking = val == "1";
                if (window != null) window.BroadcastCursor = Configuration.CursorTracking;
                break;
            case "mouse_through":
                Configuration.MouseThrough = val == "1";
                if (window != null) window.MouseThrough = Configuration.MouseThrough;
                break;
            case "idle": Configuration.IdleAnimation = val == "1"; break;
            case "idle_intensity": if (num >= 0) Configuration.IdleIntensity = num; break;   // 允许 0（完全静止）
            case "idle_speed": if (num > 0) Configuration.IdleSpeed = num; break;
            case "idle_gesture": Configuration.IdleGesture = (int)num; break;
            case "idle_gap": if (num >= 0) Configuration.IdleGap = num; break;
            case "blink": Configuration.Blink = val == "1"; blink = Configuration.Blink; break;
            case "track_head": if (num >= 0) { Configuration.HeadTrackStrength = num; headTrackStrength = num; } break;
            case "track_spine": if (num >= 0) { Configuration.SpineTrackStrength = num; spineTrackStrength = num; } break;
            // 光照：氛围光(AMBI1/2/3) + 全局灯光
            case "enable_ambient": Configuration.EnableAmbientLight = val == "1"; break;
            case "amb_saturation": if (num >= 0) Configuration.LightAmbientSaturation = num; break;
            case "amb2_intensity": if (num >= 0) Configuration.LightAmbient2Intensity = num; break;
            case "amb2_saturation": if (num >= 0) Configuration.LightAmbient2Saturation = num; break;
            case "amb2_color": Configuration.LightAmbient2Color = val; break;
            case "amb3_intensity": if (num >= 0) Configuration.LightAmbient3Intensity = num; break;
            case "amb3_saturation": if (num >= 0) Configuration.LightAmbient3Saturation = num; break;
            case "amb3_color": Configuration.LightAmbient3Color = val; break;
            case "enable_key": Configuration.EnableKeyLight = val == "1"; break;
            case "key_saturation": if (num >= 0) Configuration.LightKeySaturation = num; break;
            // 动作 / 舞蹈
            case "motion_duration": if (num >= 0) Configuration.MotionDuration = num; break;
            case "motion_transition": if (num >= 0) Configuration.MotionTransition = num; break;
            case "motion_loop": Configuration.MotionLoop = val == "1"; break;
            case "dance": Configuration.AutoDance = val == "1"; break;
            case "dance_style": Configuration.DanceStyle = (int)num; break;
            case "dance_duration": if (num > 0) Configuration.DanceDuration = num; break;
            case "dance_transition": if (num >= 0) Configuration.DanceTransition = num; break;
            case "dance_disable_track": Configuration.TrackOffDuringDance = val == "1"; break;
            // 具身动作（实验，默认关）：开启才用 AI 生成动作驱动身体，避免白烧 token
            case "embodied_motion":
                Configuration.EmbodiedMotion = val == "1";
                try { EmbodiedMotionChanged?.Invoke(); } catch (Exception e) { AlifeLog.LogWarning("具身动作开关通知失败: " + e.Message); }
                break;
            // 具身表情（实验，默认关）：开启才让 AI 控制情绪/眼嘴，避免白烧 token
            case "embodied_expression":
                Configuration.EmbodiedExpression = val == "1";
                try { EmbodiedExpressionChanged?.Invoke(); } catch (Exception e) { AlifeLog.LogWarning("具身表情开关通知失败: " + e.Message); }
                break;
            // 情绪 → 表情映射（"happy=星星眼;angry=怒り"）：把情绪指到模型自己好看的那张脸
            case "embodied_face_map": Configuration.EmbodiedFaceMap = val; break;
            case "embodied_smooth": if (num >= 0 && num <= 1) Configuration.EmbodiedSmooth = num; break;
            // PMX 手臂收拢角度(度)：允许负数，故不能加 num > 0 限制
            case "pmx_arm_drop": Configuration.PmxArmDropDeg = num; break;
            // 模型部件开关：key 形如 "part:<部件名>"，val "1"=隐藏 / "0"=显示
            case string pk when pk.StartsWith("part:", StringComparison.Ordinal):
            {
                string partName = pk.Substring(5);
                var set = new HashSet<string>(SplitHiddenParts(), StringComparer.OrdinalIgnoreCase);
                if (val == "1") set.Add(partName);
                else set.Remove(partName);
                Configuration.HiddenModelParts = string.Join(";", set);
                break;
            }
            // 互动是否触发 AI 回复（省 token）
            case "poke_ai": Configuration.PokeTriggersAi = val == "1"; break;
            case "greet_ai": Configuration.GreetTriggersAi = val == "1"; break;
            case "pat_ai": Configuration.PatTriggersAi = val == "1"; break;
            case "interact_cooldown": if (num >= 0) Configuration.InteractionCooldown = num; break;
            case "bottom_margin": if (num >= 0) Configuration.BottomMargin = num; break;
            // 画质：low/ med/ high 直接写配置，并由 options_update 推给前端 applyQuality 立即生效
            case "quality": Configuration.Quality = val; break;
            case "dance_expr": Configuration.DanceExpression = val; break;
            case "base_expr": Configuration.BaseExpression = val; break;
            case "base_expr_weight": if (num >= 0 && num <= 1) Configuration.BaseExpressionWeight = num; break;
            // 「动作人设」自动更新提醒间隔(天)：0=不提醒。到期后由 AI 在常驻信息里看到一句提醒、顺手重写。
            case "motion_idiom_refresh_days": if (num >= 0) Configuration.MotionIdiomRefreshDays = (int)num; break;
        }
        PersistConfig();
        bridge?.SendMessage("options_update", new
        {
            lightingPreset = Configuration.LightingPreset,
            lightingIntensity = Configuration.LightingIntensity,
            lightAmbientColor = Configuration.LightAmbientColor,
            lightAmbientIntensity = Configuration.LightAmbientIntensity,
            lightKeyColor = Configuration.LightKeyColor,
            lightKeyIntensity = Configuration.LightKeyIntensity,
            enableAmbient = Configuration.EnableAmbientLight,
            ambientSaturation = Configuration.LightAmbientSaturation,
            ambient2Color = Configuration.LightAmbient2Color,
            ambient2Intensity = Configuration.LightAmbient2Intensity,
            ambient2Saturation = Configuration.LightAmbient2Saturation,
            ambient3Color = Configuration.LightAmbient3Color,
            ambient3Intensity = Configuration.LightAmbient3Intensity,
            ambient3Saturation = Configuration.LightAmbient3Saturation,
            enableKey = Configuration.EnableKeyLight,
            keySaturation = Configuration.LightKeySaturation,
            background = Configuration.BackgroundColor,
            scale = Configuration.ModelScale,
            cameraDistance = Configuration.CameraDistance,
            cameraYaw = Configuration.CameraYaw,
            cameraPitch = Configuration.CameraPitch,
            cameraHeight = Configuration.CameraHeight,
            bootMotion = Configuration.BootMotion,
            poseOffsets = Configuration.PoseOffsets,
            rigProfile = Configuration.RigProfile,
            ardyTune = Configuration.ArdyTune,   // 生成式动作手感参数（重开窗口不再回默认）
            enableIK = Configuration.EnableIK,
            enablePhysics = Configuration.EnablePhysics,
            vrmPhysics = Configuration.VrmPhysics,
            enableHeadTrack = headTrack,
            enableSpineTrack = spineTrack,
            windowTop = windowTop,
            cursorTracking = Configuration.CursorTracking,
            mouseThrough = Configuration.MouseThrough,
            quality = Configuration.Quality,
            idleAnimation = Configuration.IdleAnimation,
            idleIntensity = Configuration.IdleIntensity,
            idleSpeed = Configuration.IdleSpeed,
            idleGesture = Configuration.IdleGesture,
            blink = Configuration.Blink,
            headTrackStrength = headTrackStrength,
            spineTrackStrength = spineTrackStrength,
            motionDuration = Configuration.MotionDuration,
            motionTransition = Configuration.MotionTransition,
            motionLoop = Configuration.MotionLoop,
            autoDance = Configuration.AutoDance,
            danceStyle = Configuration.DanceStyle,
            danceDuration = Configuration.DanceDuration,
            danceTransition = Configuration.DanceTransition,
            danceDisableTrack = Configuration.TrackOffDuringDance,
            embodiedMotion = Configuration.EmbodiedMotion,
            embodiedSmooth = Configuration.EmbodiedSmooth,
            embodiedExpression = Configuration.EmbodiedExpression,
            embodiedFaceMap = Configuration.EmbodiedFaceMap,
            motionIdiomRefreshDays = Configuration.MotionIdiomRefreshDays,
            customPoses = Configuration.CustomPoses,
            hiddenParts = SplitHiddenParts(),
            pmxArmDropDeg = Configuration.PmxArmDropDeg,
            pokeTriggersAi = Configuration.PokeTriggersAi,
            greetTriggersAi = Configuration.GreetTriggersAi,
            patTriggersAi = Configuration.PatTriggersAi,
            interactionCooldown = Configuration.InteractionCooldown,
            bottomMargin = Configuration.BottomMargin,
            danceExpression = Configuration.DanceExpression,
            baseExpression = Configuration.BaseExpression,
            baseExpressionWeight = Configuration.BaseExpressionWeight
        });
    }

    void HidePet(bool hide)
    {
        try
        {
            if (hide) { window.HideWindow(); petHidden = true; }
            else if (petHidden) { window.ShowWindow(); petHidden = false; }
        }
        catch (Exception e) { AlifeLog.LogWarning(e.Message); }
    }

    // 系统托盘：用 WinForms NotifyIcon 建一个真实托盘图标（与 Alife.Function.Browser 同一套 API，在本宿主可正常显示）。
    // 右键菜单仅含 显示/隐藏、关闭桌宠；左键点击切换。创建失败也不影响桌宠本体运行。
    // 关闭桌宠 = 真正退出本桌宠（关 Electron 窗口 + 收托盘），不牵连 Alife 宿主；想再开就重启 Alife。
    // 由于本宿主没有给插件全局的 WinForms 消息泵，需在独立 STA 线程上跑 Application.Run 来驱动托盘（同 Browser 插件做法）。
    static NotifyIcon? petTray;
    static bool trayStarted;
    static SynchronizationContext? traySync;   // 托盘 STA 线程的同步上下文，用于跨线程安全地收托盘
    static volatile ThreeDeskPet? activeInstance;
    void CreatePetTray()
    {
        if (trayStarted) return;
        trayStarted = true;
        try
        {
            var thread = new Thread(() =>
            {
                try
                {
                    // 手动装一个 WinForms 同步上下文，便于在其它线程安全地把“收托盘”派发回本 STA 线程
                    try { traySync = new System.Windows.Forms.WindowsFormsSynchronizationContext(); SynchronizationContext.SetSynchronizationContext(traySync); } catch { }
                    var tray = new NotifyIcon
                    {
                        Icon = System.Drawing.SystemIcons.Application,
                        Text = "3D 桌宠",
                        Visible = true,
                    };

                    var menu = new ContextMenuStrip();
                    var showHide = new ToolStripMenuItem("显示 / 隐藏");
                    showHide.Click += (_, _) =>
                    {
                        try { var a = activeInstance; if (a is not null) a.HidePet(!a.petHidden); }
                        catch (Exception ex) { AlifeLog.LogWarning("[3D桌宠] 切换失败：" + ex.Message); }
                    };
                    var closeItem = new ToolStripMenuItem("关闭桌宠");
                    closeItem.Click += (_, _) => { try { activeInstance?.ClosePet(); } catch (Exception ex) { AlifeLog.LogWarning("[3D桌宠] 关闭失败：" + ex.Message); } };
                    menu.Items.Add(showHide);
                    menu.Items.Add(closeItem);
                    tray.ContextMenuStrip = menu;

                    // 左键点击：切换显隐（关掉桌宠后托盘已收，此项随之失效）
                    tray.MouseClick += (_, e) =>
                    {
                        if (e.Button != MouseButtons.Left) return;
                        try { var a = activeInstance; if (a is not null) a.HidePet(!a.petHidden); }
                        catch (Exception ex) { AlifeLog.LogWarning("[3D桌宠] 切换失败：" + ex.Message); }
                    };

                    petTray = tray;
                    Application.Run();   // 该 STA 线程的消息泵，支撑托盘菜单与鼠标事件
                }
                catch (Exception ex) { AlifeLog.LogWarning("[3D桌宠] 托盘线程内失败：" + ex.Message); }
            });
            thread.SetApartmentState(ApartmentState.STA);
            thread.IsBackground = true;
            thread.Start();
        }
        catch (Exception e) { AlifeLog.LogWarning("[3D桌宠] 托盘创建失败（不影响运行）：" + e.Message); }
    }

    // 真正“关闭”本桌宠：释放 Electron 窗口（不再留悬空 id）+ 收掉托盘，本插件进入已关闭态。
    // 不牵连 Alife 宿主，想再开就重启 Alife。
    async void ClosePet()
    {
        try { await ShutdownPetAsync(); }
        catch (Exception ex) { AlifeLog.LogWarning("[3D桌宠] 关闭失败：" + ex.Message); }
    }

    async Task ShutdownPetAsync()
    {
        if (disposed) return;
        disposed = true;   // 先置位：移动循环/消息处理立刻停手，不再向窗口发命令
        if (activeInstance == this) activeInstance = null;
        window = null!;
        bridge = null!;
        // 给在途的窗口命令（移动循环最后一条 SetBounds 等）一点落地时间，
        // 避免关窗瞬间命令到达主进程触发 "BrowserWindow not found"。
        await Task.Delay(150);
        if (provider is not null)
        {
            var p = provider;
            provider = null;
            try { await p.DisposeAsync(); } catch (Exception ex) { AlifeLog.LogWarning("[3D桌宠] 释放插件失败：" + ex.Message); }
        }
        DisposeTray();
    }

    // 收掉系统托盘图标并结束其 STA 消息泵（重置静态标记，便于重启 Alife 后重新建托盘）
    static void DisposeTray()
    {
        try
        {
            var t = petTray;
            petTray = null;
            trayStarted = false;
            var ctx = traySync;
            traySync = null;
            if (t is not null)
            {
                // NotifyIcon 没有 BeginInvoke；用其 STA 线程的同步上下文把销毁派发回去，避免跨线程释放踩坑
                if (ctx is not null)
                    // 只能结束本托盘线程的消息泵；Application.Exit() 会在该线程上关闭主窗口，
                    // 触发“是否直接关闭应用？”弹窗并导致跨线程访问 CoreWebView2 崩溃。
                    ctx.Post(_ => { try { t.Visible = false; t.Dispose(); } catch { } try { UnregisterHotkeys(); } catch { } Application.ExitThread(); }, null);
                else
                    try { t.Visible = false; t.Dispose(); } catch { }
            }
        }
        catch (Exception ex) { AlifeLog.LogWarning("[3D桌宠] 托盘释放失败：" + ex.Message); }
    }

    static bool hotkeyRegistered;

    // Alife 5 宿主删掉了 Electron，全局热键改用 Win32 RegisterHotKey（MOD_CONTROL|MOD_ALT + 按键）。
    // WM_HOTKEY 只会派发到"注册它的那条线程"的窗口，所以注册/注销都必须在托盘 STA 线程上做。
    const uint MOD_ALT = 0x0001, MOD_CONTROL = 0x0002;
    const uint WM_HOTKEY = 0x0312;
    const int HWND_MESSAGE = -3;
    static IntPtr hotkeyWnd;
    static readonly Dictionary<int, Action> hotkeyHandlers = new();
    static int nextHotkeyId = 0xC000;
    // 窗口类注册后系统只保留函数指针，必须用静态字段持有托管委托，否则被 GC 回收时会崩
    static readonly WndProcDelegate HotkeyWndProcRef = HotkeyWndProc;

    async Task RegisterHotkeysAsync()
    {
        if (hotkeyRegistered) return;
        hotkeyRegistered = true;
        // CreatePetTray 在独立 STA 线程里起消息泵，traySync 稍后才就绪，这里等一小会儿
        for (int i = 0; i < 20 && traySync is null; i++)
            await Task.Delay(100);
        SynchronizationContext? ctx = traySync;
        if (ctx is null)
        {
            AlifeLog.LogWarning("[3D桌宠] 托盘线程未就绪，Ctrl+Alt+H 显隐热键不可用（可用托盘菜单）");
            return;
        }
        ctx.Post(_ =>
        {
            try
            {
                if (!RegisterGlobalHotkey('H', () => HidePet(!petHidden)))
                    AlifeLog.LogWarning("[3D桌宠] 显隐热键未注册（可能被其它程序占用），可用托盘菜单「显示 / 隐藏」唤回");
            }
            catch (Exception e) { AlifeLog.LogWarning("[3D桌宠] 热键注册失败: " + e.Message); }
        }, null);
    }

    static bool RegisterGlobalHotkey(int key, Action action)
    {
        // 消息窗口（HWND_MESSAGE）承载通知，不侵入宿主任何窗口
        if (hotkeyWnd == IntPtr.Zero)
        {
            string cls = Guid.NewGuid().ToString("N");
            IntPtr hInstance = GetModuleHandleW(null);
            WNDCLASS wc = new() { lpfnWndProc = HotkeyWndProcRef, lpszClassName = cls, hInstance = hInstance };
            RegisterClassW(ref wc);
            hotkeyWnd = CreateWindowExW(0, cls, "PetHotkey", 0, 0, 0, 0, 0, HWND_MESSAGE, IntPtr.Zero, hInstance, IntPtr.Zero);
        }
        int id = nextHotkeyId++;
        if (!RegisterHotKey(hotkeyWnd, id, MOD_CONTROL | MOD_ALT, (uint)key)) return false;
        hotkeyHandlers[id] = action;
        return true;
    }

    /// <summary>释放全部热键（须在创建消息窗口的同一条线程上调用）。</summary>
    static void UnregisterHotkeys()
    {
        foreach (int id in hotkeyHandlers.Keys)
        {
            try { UnregisterHotKey(hotkeyWnd, id); } catch { }
        }
        hotkeyHandlers.Clear();
        if (hotkeyWnd != IntPtr.Zero)
        {
            try { DestroyWindow(hotkeyWnd); } catch { }
            hotkeyWnd = IntPtr.Zero;
        }
    }

    static IntPtr HotkeyWndProc(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam)
    {
        if (msg == WM_HOTKEY && hotkeyHandlers.TryGetValue((int)wParam, out Action? action))
        {
            try { action?.Invoke(); } catch { }
            return IntPtr.Zero;
        }
        return DefWindowProcW(hWnd, msg, wParam, lParam);
    }

    /// <summary>
    /// Alife 5 没有文件选择 API：借托盘 STA 线程的消息泵弹一个 WinForms OpenFileDialog。
    /// </summary>
    Task<string?> PickFileAsync(string title, string filter)
    {
        SynchronizationContext? ctx = traySync;
        if (ctx is null) return Task.FromResult<string?>(null);
        TaskCompletionSource<string?> tcs = new(TaskCreationOptions.RunContinuationsAsynchronously);
        ctx.Post(_ =>
        {
            try
            {
                using OpenFileDialog dlg = new() { Title = title, Filter = filter, CheckFileExists = true };
                tcs.TrySetResult(dlg.ShowDialog() == DialogResult.OK ? dlg.FileName : null);
            }
            catch (Exception e)
            {
                AlifeLog.LogWarning("[3D桌宠] 文件选择框失败: " + e.Message);
                tcs.TrySetResult(null);
            }
        }, null);
        return tcs.Task;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct WNDCLASS
    {
        public uint style;
        public WndProcDelegate lpfnWndProc;
        public int cbClsExtra, cbWndExtra;
        public IntPtr hInstance, hIcon, hCursor, hbrBackground;
        [MarshalAs(UnmanagedType.LPWStr)] public string lpszMenuName;
        [MarshalAs(UnmanagedType.LPWStr)] public string lpszClassName;
    }
    delegate IntPtr WndProcDelegate(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern ushort RegisterClassW(ref WNDCLASS wc);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr CreateWindowExW(uint exStyle, string cls, string name, uint style, int x, int y, int w, int h, IntPtr parent, IntPtr menu, IntPtr instance, IntPtr param);
    [DllImport("user32.dll")] static extern bool RegisterHotKey(IntPtr hWnd, int id, uint modifiers, uint vk);
    [DllImport("user32.dll")] static extern bool UnregisterHotKey(IntPtr hWnd, int id);
    [DllImport("user32.dll")] static extern bool DestroyWindow(IntPtr hWnd);
    [DllImport("user32.dll")] static extern IntPtr DefWindowProcW(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern IntPtr GetModuleHandleW(string? name);
}
