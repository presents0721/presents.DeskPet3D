using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.IO;
using System.Linq;
using System.Numerics;
using System.Threading;
using System.Threading.Tasks;
using Alife.Framework;
using Alife.Foundation;
using Alife.Function.FunctionCaller;
using Alife.Function.MessageFilter;

namespace presents.DeskPet3D;

/// <summary>
/// 3D 桌宠 AI 前端：通过 <see cref="ThreeDeskPet"/> 驱动 3D 桌宠显示（VRM / PMX+VMD）。
/// 自身不管理桌宠生命周期，桌宠由 ThreeDeskPet 自行管理。
/// </summary>
[Module("3D桌宠控制",
    """
    将AI连接到 3D 桌宠身体（VRM / PMX+VMD），使其可以用桌宠表达自己并接收互动反馈。
    """,
    defaultCategory: "presents/交互方式",
    EditorUI = typeof(DeskPetServiceUI))]
public class DeskPetService(
    XmlFunctionCaller functionService,
    Interactor<DeskPetService> interactor,
    MessageFilterService messageFilterService,
    ThreeDeskPet pet) :
    ChatBehaviour,
    IConfigurable<DeskPetServiceConfig>
{
    public DeskPetServiceConfig Configuration { get; set; } = null!;

    [XmlFunction(FunctionMode.Content)]
    [Description("显示一段气泡文本")]
    public async Task Speak(XmlExecutorContext context, [XmlContent] string content, CancellationToken cancellationToken)
    {
        try
        {
            switch (context.CallMode)
            {
                case CallMode.Opening:
                    lastBubbleEndTime = 0;
                    break;
                case CallMode.Closing:
                {
                    try
                    {
                        if (DateTimeOffset.Now.ToUnixTimeMilliseconds() < lastBubbleEndTime)
                            await Task.Delay(TimeSpan.FromMilliseconds(lastBubbleEndTime - DateTimeOffset.Now.ToUnixTimeMilliseconds()),
                                cancellationToken);
                    }
                    finally
                    {
                        await pet.ShowSubtitle(null);
                    }
                    break;
                }
                case CallMode.Content:
                {
                    content = content.Trim();
                    if (string.IsNullOrWhiteSpace(content))
                        break;
                    if (cancellationToken.IsCancellationRequested)
                        break;

                    if (DateTimeOffset.Now.ToUnixTimeMilliseconds() < lastBubbleEndTime)
                        await Task.Delay(TimeSpan.FromMilliseconds(lastBubbleEndTime - DateTimeOffset.Now.ToUnixTimeMilliseconds()),
                            cancellationToken);
                    await pet.ShowSubtitle(content);
                    lastBubbleEndTime = DateTimeOffset.Now.ToUnixTimeMilliseconds() +
                                        Math.Max(content.Length * Configuration.BubbleDurationPerCharMs, 1500);
                    break;
                }
            }
        }
        catch (OperationCanceledException) { }
    }

    [XmlFunction(FunctionMode.OneShot)]
    [Description("表演一个表情（选项见附加说明）。seconds：保持多少秒后自动收回；不填=默认5秒；填0或负数=一直保持。"
        + "★使用频率：不是每次回复都要用 —— 只在情绪明显（开心/难过/害羞/惊讶/生气…）时才用，普通问答不用；"
        + "同一条回复最多 1 个表情，且不要与动作同时堆叠。")]
    public Task Expression(string option, double? seconds = null)
    {
        option = option.Trim();
        if (string.IsNullOrWhiteSpace(option))
            return Task.CompletedTask;
        if (pet.SupportedExpressions.Contains(option) == false)
            throw new Exception("选项不存在");

        return pet.ShowExpression(option, seconds);
    }

    [XmlFunction(FunctionMode.OneShot)]
    // ★★ v11.48 规则重写（用户实测：AI 发 `<Motion option="vrma/004_hello_1" seconds="3"/>`，
    //   可该动作全长 15.77s、前 3 秒是背身、第 4 秒才转身打招呼 ⇒ 播 3 秒等于什么都没展示）。
    //   病根在**规则**：把 seconds 说成"保持多久"，AI 就会随手填个小数；
    //   而素材的时长与内容（哪一段才是重点动作）AI 根本无从得知。
    //   ⇒ 改成：**默认不要填**，让它自然播完一次；只有想让它多循环一会儿才填，且必须填够长。
    [Description("表演一个动作（选项见附加说明）。"
        + "★seconds 默认**不要填**：让它自然播完一次。素材长短不一（几秒到几十秒）、内容你也无从预知 —— "
        + "实测某支打招呼动作全长 15.8 秒、前 3 秒是背身、第 4 秒才转身打招呼，填短秒数会正好停在没内容的那段。"
        + "只有想让它**多循环一会儿**（跳舞、待机晃动）才填 seconds，且要填够长（≥15）；填 0 或负数=一直保持。"
        + "option 也能写 `gen:词条`（如 gen:举手挥手）→ 由本地模型**现场生成**一个新动作（词条表见附加说明）；"
        + "★使用频率：不是每次回复都要用 —— 只在对话本身含明确动作意图（打招呼/告别/道谢/被夸/被责备/说到动作词）时才用，"
        + "普通问答与闲聊一律不用；同一条回复最多 1 个动作。")]
    public Task Motion(string option, double? seconds = null)
    {
        option = option.Trim();
        if (string.IsNullOrWhiteSpace(option))
            return Task.CompletedTask;

        // ② 生成式词条：<motion option="gen:举手挥手"/> —— **复用 AI 已经熟练的 Motion 入口**，底层走本地生成。
        //    为什么要这样接：它面对 208 个现成动作文件时只会调文件，而生成式白名单只有 1 条时它没有理由去用；
        //    把生成词条塞进同一个入口后，"它只调现成动作"这个行为就从"问题"变成了"机制"（AI 零学习成本）。
        const string genPrefix = "gen:";
        if (option.StartsWith(genPrefix, StringComparison.OrdinalIgnoreCase))
        {
            string key = option.Substring(genPrefix.Length).Trim();
            (string Label, string Phrase) hit = default;
            bool found = false;
            foreach (var g in pet.GenPhrases)
            {
                if (string.Equals(g.Label, key, StringComparison.OrdinalIgnoreCase)
                    || string.Equals(g.Phrase, key, StringComparison.OrdinalIgnoreCase)) { hit = g; found = true; break; }
            }
            if (!found || string.IsNullOrWhiteSpace(hit.Phrase))
                throw new Exception("未知的生成式词条「" + key + "」。可用：" + GenPhrasesText());
            BodyActPromptCore(hit.Phrase);      // 走「具身动作」开关与同一条生成链路（失败由前端退回）
            return Task.CompletedTask;
        }

        if (pet.SupportedMotions.Contains(option) == false)
            throw new Exception("选项不存在");

        return pet.ShowMotion(option, seconds);
    }

    /// <summary>生成式词条清单文本（常驻信息与报错文案共用）。</summary>
    string GenPhrasesText()
    {
        var g = pet.GenPhrases;
        if (g.Length == 0) return "（当前没有可用词条）";
        var sb = new System.Text.StringBuilder();
        foreach (var x in g) { if (sb.Length > 0) sb.Append('、'); sb.Append("gen:").Append(x.Label); }
        return sb.ToString();
    }

    [XmlFunction(FunctionMode.OneShot)]
    [Description("获取当前屏幕位置（使用后需等待结果返回）")]
    public async Task Position()
    {
        try
        {
            Vector2 position = await pet.GetPosition();
            interactor.Poke($"当前位置: x={position.X}, y={position.Y}");
        }
        catch (TimeoutException)
        {
            interactor.Poke("获取坐标超时");
        }
    }

    [XmlFunction(FunctionMode.All)]
    [Description("切换桌宠使用的模型。用法：<switchmodel name=\"模型文件夹名\"/> 或 <switchmodel>模型文件夹名</switchmodel>；可选模型见附加说明")]
    public async Task SwitchModel(string? name = null, [XmlContent] string? content = null)
    {
        string want = (string.IsNullOrWhiteSpace(name) ? content : name) ?? "";
        want = want.Trim();
        AlifeLog.LogInformation($"[3D桌宠] SwitchModel 被调用: name={name ?? ""} content={content ?? ""}");

        string[] models = pet.AvailableModels;
        string? hit = models.FirstOrDefault(m => string.Equals(m, want, StringComparison.OrdinalIgnoreCase))
                   ?? models.FirstOrDefault(m => m.Contains(want, StringComparison.OrdinalIgnoreCase));
        if (hit == null)
        {
            interactor.Poke($"没有找到模型「{want}」。可选模型：{string.Join("、", models)}");
            return;
        }
        if (string.Equals(hit, pet.CurrentModel, StringComparison.OrdinalIgnoreCase))
        {
            interactor.Poke($"现在用的就是「{hit}」");
            return;
        }
        interactor.Poke($"正在切换到模型「{hit}」，稍等一下…");

        string target = hit;
        _ = Task.Run(async () =>
        {
            try
            {
                bool ok = await pet.SwitchModelAsync(target);
                AlifeLog.LogInformation($"[3D桌宠] 切换结果: {(ok ? "成功" : "失败")}");
                if (!ok) interactor.Poke($"切换到「{target}」失败");
            }
            catch (Exception e)
            {
                AlifeLog.LogError(e);
                try { interactor.Poke($"切换到「{target}」失败：{e.Message}"); } catch { }
            }
        });
        await Task.CompletedTask;
    }

    long lastBubbleEndTime;
    bool lastStatus;
    XmlHandler? handler;
    XmlHandler? embodiedHandler;   // 具身动作工具：仅开关开启时注册 → 关闭时零 token 开销
    XmlHandler? embodiedExprHandler;   // 具身表情工具：同理随开关注册/注销
    XmlHandler? motionIdiomHandler;    // 动作人设工具（常驻：它同时决定"从预置动作里挑哪个"与待机手感）

    // 「动作人设」存放在**插件配置**里（ThreeDeskPetConfig.MotionIdiom*）：配置页窗口宽，5 段文本 + 5 个数值才编辑得动，
    // 而且支持「应用到角色」，正好对上"人设属于这个角色"。配置是**唯一来源**，这里只做投影与写入，
    // 避免"配置页显示 A、运行用的是 B"这类不同步。
    MotionIdiom Idiom() => pet.MotionIdiomSnapshot();
    string idiomSig = "";      // 上次同步的人设指纹（检测配置页改了内容）
    string idiomDueSig = "";   // 上次同步的提醒间隔（检测配置页改了天数）
    double idiomPollAt;        // 轮询节流（秒）

    protected override Task OnAwake()
    {
        RegisterHandler();

        // 动作人设工具常驻注册（不随具身开关走）：它同时影响"AI 从预置动作里挑哪个"与待机小动作频率/节奏等手感。
        RegisterMotionIdiomHandler();
        // 前端每次加载完会主动索取一次（重开窗口/换模型都能立刻恢复手感，不依赖启动时序）；
        // 用户在面板里点「让 AI 重写」也走这里。
        pet.MotionStyleCommand += OnMotionStyleCommand;
        // 用户在面板里存/删自定义造型 → 刷新常驻信息，让 AI 立刻知道有哪些造型可用
        pet.CustomPosesChanged += OnCustomPosesChanged;
        try { idiomSig = Idiom().Fingerprint(); idiomDueSig = MotionIdiomDueDays().ToString(); }
        catch (Exception e) { AlifeLog.LogError(e); }

        // 具身动作工具随开关走：开启才注册（关闭时零 token 开销），开关变化时自动重注册
        pet.EmbodiedMotionChanged += RegisterEmbodiedHandler;
        RegisterEmbodiedHandler();

        // 具身表情工具同理：开启才注册（走 VRM 自带表情权重，不吃模型/显存，只是每轮多一点 token）
        pet.EmbodiedExpressionChanged += RegisterEmbodiedExpressionHandler;
        RegisterEmbodiedExpressionHandler();

        messageFilterService.AddMessageReplyRule(new MessageReplyRule {
            Name = nameof(DeskPetService),
            InputMatching = input => input.Contains(Interactor<DeskPetService>.GetMessageTag()),
            OutputMatching = output => output.Contains(nameof(Speak), StringComparison.OrdinalIgnoreCase),
            CorrectionMessage = () => $"{nameof(DeskPetService)}消息必须用{nameof(Speak)}标签回复。如果不想发送消息，也请发送空标签。"
        }, DestroyCancellationToken);

        return Task.CompletedTask;
    }

    /// <summary>重建并注册函数文档（模型切换后表情/动作/可选模型清单会变，需要重发）。</summary>
    void RegisterHandler()
    {
        if (handler != null)
            functionService.UnregisterHandler(handler);

        string expressions = pet.SupportedExpressions.Length == 0 ? "当前不支持" : string.Join(", ", pet.SupportedExpressions);
        string motions = pet.SupportedMotions.Length == 0 ? "当前不支持" : string.Join(", ", pet.SupportedMotions);
        string models = pet.AvailableModels.Length == 0 ? "无" : string.Join(", ", pet.AvailableModels);

        handler = new XmlHandler(this) {
            Description = "此服务让你获得一副可交互的 3D 桌宠身体（VRM / PMX+VMD）。这是你主要的对外输出表情动作等外观信息的工具，需要积极使用。",
            Explanation = $"""
                           ## 支持选项
                           - 当前模型：{pet.CurrentModel}
                           - 支持的 {nameof(Expression)} 选项：{expressions}
                           - 支持的 {nameof(Motion)} 选项：{motions}
                           - 可切换的模型：{models}

                           注意：{nameof(Expression)} / {nameof(Motion)} 的 option 只能从上面列出的选项里选。
                           seconds 只对{nameof(Expression)}有意义（保持多久后收回）：
                           - 不填：表情 5 秒后自动收回默认
                           - seconds="12"：保持 12 秒；seconds="0" 或负数：一直保持，直到你换别的表情
                           - 例：<expression option="害羞" seconds="0"/> 会一直害羞
                           ★{nameof(Motion)} **不要填 seconds**：让它自然播完一次即可。
                             素材有长有短、内容你也不知道（很多动作前几秒只是起势/背身，重点动作在后面），
                             填短秒数会正好截断在没内容的那段。只有想让它多循环一会儿（跳舞/待机）才填，且要 ≥15。
                           """
        };
        functionService.RegisterHandler(handler, cancellationToken: DestroyCancellationToken);
    }

    /// <summary>按「具身动作」开关注册/注销 AI 的 bodyact 工具（关闭时完全不注册 → 不占 token）。</summary>
    void RegisterEmbodiedHandler()
    {
        try
        {
            if (embodiedHandler != null) { functionService.UnregisterHandler(embodiedHandler); embodiedHandler = null; }
            if (!pet.EmbodiedMotionEnabled) { AlifeLog.LogInformation("[3D桌宠] 具身动作未开启，已注销 bodyact 工具"); return; }

            embodiedHandler = new XmlHandler(new BodyActHost(this))
            {
                Description = "用关键帧 JSON 驱动 3D 身体的「具身动作」（在预置动作之外自由编排动作）。",
                Explanation = """
                    ## 具身动作（bodyact）
                    在预置动作之外，用**关键帧 JSON** 自由编排身体动作。角度单位 = **度**。
                    通道是**解剖学语义**，旋转轴由引擎按当前模型的真实骨骼朝向自动推导：
                    **正数一律 = "抬起来 / 往身前 / 往身体外侧"**，左右正负你不用算、也不用管模型朝向。

                    ## 可用通道（**每个关节都有完整的三个自由度**：自转 + 两向摆动，肢体主轴可给到 ±180°）
                    命名规律：`l`=左 `r`=右；`Up`=抬、`Fwd`=往身前摆、`Side`=往身体外侧、`Twist`=绕自身长轴自转。
                    - lArmUp / rArmUp            上臂抬起（正数=抬高）
                    - lArmFwd / rArmFwd          上臂往身前摆
                    ⚠ lArmTwist / rArmTwist（上臂自转）**已实测无效，不要写**：VRM 归一化骨只保留"骨骼朝向"，
                      绕自身长轴的自转分量会被丢弃（内置动作里给过 ±52 也毫无变化）。
                      想调掌心/肘尖朝向，用下面的 ElbowSide（可靠）或 HandTurn（实测可用）。
                    - lElbow / rElbow            屈肘（小臂往身前折，正数=折起来）
                    - lElbowSide / rElbowSide    小臂往身体外侧摆（★挥手/摆手用这个，±25~30 就够；左右两侧都要写）
                    - lElbowTwist / rElbowTwist  前臂自转（**尚未证实有效**，用了没变化是正常的，别反复调它）
                    - lHandTurn / rHandTurn      手腕转掌（实测可用）
                    - lHandBend / rHandBend      手腕下压 / 上翘
                    - lHandSide / rHandSide      手腕左右偏
                    - lShoulderUp / rShoulderFwd 耸肩 / 含胸展肩（**左右两侧都有**：rShoulderUp / rShoulderFwd 同样可用；
                                                  只写一侧会出现"两个肩膀不一样高")
                    - headPitch / headYaw / headRoll      点头 / 转头 / 歪头
                    - spinePitch / spineYaw / spineRoll   躬身 / 转身 / 侧弯
                    - chestPitch / chestYaw / chestRoll   上胸同上
                    - hipsPitch / hipsYaw / hipsRoll      **动胯 = 骨盆相对腿**：上身跟着前倾 / 转 / 侧倾，腿脚留在原地。
                                                          （它不是"把整个人当一块转"——那种整体位姿不在这张表里，别用这几个通道去凑）
                    - lLegFwd / rLegFwd          大腿往身前抬（正数向前；负数向后，也就是迈步）
                    - lLegSide / rLegSide        大腿向侧开（劈叉方向）
                    - lLegTwist / rLegTwist      大腿自转（脚尖朝里 / 朝外）
                    - lKnee / rKnee              屈膝（正数=小腿往后折，和真人一样，不是反关节）
                    - lAnkle / rAnkle            勾脚 / 绷脚尖
                    - lAnkleSide / rAnkleSide    脚内外翻
                    - lToes / rToes              脚趾翘起（重心前移的感觉）

                    ### 常用「反馈动作」配方（**照着改数就行，别从零猜角度**）
                    下表每一行的角度都**取自内置预置的同款实测数值**（bow / nod / shake / shrug / stretch /
                    hands_up / reach_fist）—— 同一套轴、同一套符号（正=抬/前/外，负=沉/后），不会歪。
                    用法：一拍就是 `{"pose":{...},"dur":0.5,"ease":"inout"}`；引擎会**自动补"回到自然姿势"**，
                    所以通常只写"去"的那一拍。想让"回正"更从容就显式再写一拍（dur 0.5 左右）。

                    | 想表达 | 通道搭配（单位=度） | 节奏 |
                    |---|---|---|
                    | 欠身 / 鞠躬致意 | spinePitch=35, chestPitch=12, headPitch=12, lArmUp=rArmUp=12 | 去 0.55s `inout`，回 0.55s |
                    | 只是"示意"的小欠身 | 上列各值 ×0.4（spinePitch≈14, headPitch≈5） | 去 0.35s `inout` |
                    | 认真点头（两下） | headPitch=18 → -4 → 18 → 0 | 每拍 0.25s `inout` |
                    | 摇头（否定 / 无奈） | headYaw=20 ↔ -20 | 每拍 0.22s，顶层 `"repeat":2` |
                    | 歪头（疑惑 / 卖萌） | headRoll=14, headYaw=6 | 0.35s `out` |
                    | 缩肩 / 不好意思 | lShoulderUp=rShoulderUp=20, headPitch=10, headRoll=8 | 0.35s `out` |
                    | 耸肩（"谁知道呢"） | lArmUp=rArmUp=30, lElbow=rElbow=45, headRoll=8 → -8 → 8 | 每拍 0.35s（= 内置 shrug 原值） |
                    | 挺直 / 精神一振 | spinePitch=-8, headPitch=-10, lShoulderUp=rShoulderUp=14 | 0.4s `out`（负数=后仰/抬头，stretch 验证过） |
                    | 泄气 / 蔫下去 | spinePitch=28, chestPitch=10, headPitch=16, lShoulderUp=rShoulderUp=-12 | 0.6s `inout`（肩负值=沉肩） |
                    | 伸手（递东西 / 解释） | rArmUp=84, rArmFwd=10, rElbow=26, rElbowSide=4, rHandTurn=-16, chestYaw=-5 | 0.62s `inout`（= 内置 reach_fist 抬起段） |
                    | 双手举起（欢呼 / 投降） | ① 起手甩开：lArmUp=rArmUp=58, lArmFwd=rArmFwd=14, lElbow=rElbow=42
                      ② 举过头：lArmUp=rArmUp=146, lElbow=rElbow=22, lElbowSide=rElbowSide=8
                      ③ 到位余势：lArmUp=rArmUp=152, lElbow=rElbow=32 | 0.34s + 0.32s + 0.18s（=内置 hands_up）
                      ⚠ 别只写 `lArmUp=rArmUp=150` 一个值 —— 那是旧版，手臂会像根棍直上直下 |
                    | 侧身让开 / 看别处 | turn=40, headYaw=20（turn=整体转身，脚也跟着转） | 0.45s `inout` |

                    **写顺动作为的硬规则（都踩过坑，务必遵守）**：
                    1. **一个连续动作写成一段**：别把"抬一半 → 做别的 → 继续抬"拆成两段 —— 每段都会各自
                       "加速→减速到 0"，两段之间必然"刹一下再起步"（实测观感很怪）。
                    2. 需要"停一拍"就用**空段**：`{"dur":0.4}`（只有 dur、不写 pose），别靠相邻两段都减速去凑。
                    3. 相邻段一律 `ease:"inout"`；引擎还有 `smooth:0.3` 的跨段低通兜底（`"smooth":0` 可关）。
                    ⚠ 这些是"素材里没有的**小反馈**"。要造型类（比心 / 叉腰 / 抱臂）照旧走 `<motion>` 或请用户摆。

                    ### 活人感：引擎自动把动作"铺开"到整条脊柱（**你不用管**）
                    真实人体的转动是分散在多节骨骼上的，所以引擎会自动分摊：
                    - 你写 `headYaw:30` ⇒ 自动变成「头 45% + 颈 40% + 上胸 15%」（骨骼链累加，头朝向基本不变，但脖子会跟着转）；
                    - 写 `spinePitch`（弯腰）⇒ 自动带一点胸/上胸一起弯；写 `chestXxx` ⇒ 自动带上胸；
                    - 手臂抬过 55° ⇒ 自动带一点耸肩（治"手臂从躯干直接长出来"的僵硬）。
                    **你只管写"意图通道"**（头 / 腰 / 手 / 腿）—— 颈、上胸这类是引擎内部通道，不对外开放。
                    想要**刻意的机械 / 僵直 / 木偶感**（比如演一个机器人、或者生气时绷住）：spec 里加 `"link":0` 关掉联动。

                    ### 蹲 / 跪（**不用手调膝盖**：给一个数，双腿自动解算）
                    这两个是"高层参数"，不是通道。给了它，**双腿的腿/膝/踝由解析 IK 算出来**：
                    「骨盆降到哪」和「膝屈多少」是同一个三角形的两个量，必须联立解，手调一定对不上
                    （这就是"单弯膝脚会离地、单降骨盆会悬空"的原因）。解完脚会自动踩在原地。
                    - `"crouch": 0.6`  下蹲（0~1：站 → 蹲到底）。降低重心、蹲着说话/捡东西用它。
                      ⚠ **刻度已按踝背屈极限（32°）标定**：crouch=1 = 「脚跟不离地能蹲到的最深」。
                      写更大的值也不会更深（会被夹到极限）。
                      ⚠ **下面所有「cm」都是按开发机模型（腿长约 0.8 单位）算的，会随模型腿长变化** ——
                        只把 cm 当**量级参考**（几厘米 / 十几厘米 / 二十几厘米），膝屈的**度数才是跨模型通用的**。
                      想要"更深/更夸张"的姿势得靠**空中收腿**等手段，别指望 crouch。
                    - `"kneel": 1`     跪下（0~1：站 → 双膝跪地：膝触地、小腿放平、脚尖点地）。
                    例：<bodyact spec='{"crouch":0.7,"steps":[{"pose":{"headPitch":10,"spinePitch":8},"dur":0.5}]}'/>
                    ⚠ 给了 crouch/kneel 就**别再手写** lKnee/rKnee/lAnkle —— 那几个会被自动值覆盖（写了不生效）。
                    ⚠⚠ 蹲/跪**也不要**用 `<bodyact prompt>` 去生成：本地生成模型没有地面/接触/IK 概念，
                    它生成的 squat 是**健身宽站蹲**（两腿向两侧岔开成马步 + 跨步、根位移忽上忽下），完全不像蹲
                    （squat 类词条已全部列进词表的 rejected，实测证伪）。蹲跪只有 crouch/kneel 这一条路。

                    ### 跳 / 蹦（三档预置 —— **别什么场合都跳同一个**）
                    - `jump`（轻快蹦，≈1.05s）：浅蓄力（膝 ~66°）→ 弹起 → 滞空 → 落地轻缓冲。
                      用在：小开心、轻快回应、给"嗯！"换个花样。
                    - `jump_power`（全力深蹲跳，≈1.6s）：**动漫式深蹲**（膝屈 ~135°、胯降约为腿长的 0.4 倍，脚跟贴屁股）
                      → 手臂后收再上甩 → 弹起 → 滞空 → 落地深缓冲。用在：特别兴奋、庆祝、"终于做到了"。
                    - `jump_joy`（欢呼跳，≈1.4s）：双臂高举着跳。用在：被夸 / 被加油 / 想被注意。
                    - 手写版（真要改高度/节奏时）：**每段都能给 `rootY`（胯的实际升降，±0.6 世界单位）
                      与 `crouch`（腿部弯曲 0~1；注意**只写 crouch 不写 rootY 时，胯会自动跟着腿部解算一起下沉**）**，
                      段内按 ease 插值、不写就沿用上一段：
                      例：<bodyact spec='{"steps":[{"crouch":0.9,"dur":0.42,"ease":"out"},{"rootY":0.3,"crouch":0.05,"dur":0.18,"ease":"in"},{"rootY":0.34,"crouch":0,"dur":0.22,"ease":"inout"},{"crouch":0.78,"dur":0.26,"ease":"in"},{"crouch":0,"dur":0.3,"ease":"out"}]}'/>
                      要点：**下压慢（0.3~0.45s）、弹起快（`ease:"in"`）、顶点只留一瞬、落地再压一次浅缓冲**才像跳；
                      crouch 深浅参考（已按踝背屈极限标定）：0.3≈膝 26°、0.6≈膝 44°、1.0≈膝 62°
                      （下沉的**厘米数随模型腿长变**，不要照抄；膝屈度数才是通用的）。
                      ⚠ 腾空段的 rootY 别给到 0.5 以上（会像飞）；也别连跳，一次就够。
                    - **动漫式"跳起来收腿"**（膝盖大幅弯曲、脚跟贴近屁股）只能**手写腿部通道**（空中腿不受地面约束）：
                      `{"lLegFwd":52,"lKnee":100,"lAnkle":22,"rLegFwd":50,"rKnee":96,"rAnkle":22}` = 提膝 + 小腿折叠 + 勾脚。
                      要点：**先蹬直（写 0）→ 腾空收 → 下落伸出去**，三段连起来才有动漫感（现成范例就是 `jump_power` 预设）。
                      腿部通道速查：`lLegFwd/rLegFwd`（大腿前摆＝提膝，正＝向前上）、`lKnee/rKnee`（屈膝，正＝小腿往后折）、
                      `lAnkle/rAnkle`（勾脚，正＝脚尖翘）；`×Side` 系列管外展。
                      ⚠ **只在腾空段写**（那时蹲/跪解算不接管）；蓄力/落地段的腿由 crouch 自动解算，手写会被覆盖。

                    ### 自己编动作：按"真人规律"排，**数值你自己定**（比用预置更自由）
                    你本来就能写任意通道 —— 缺的只是"动作学常识"。照下面的**阶段规律**排，
                    数值按幅度感觉给（括号里是常见量级，可超可减）：

                    **手臂通道速查**（"像不像活人"最关键的一组）：
                    - `lArmUp/rArmUp` 抬臂（0 = 垂在身侧，+30 稍抬，+90 与肩平，+150 高举过头）
                    - `lArmFwd/rArmFwd` **前后摆**（正 = 往身前，负 = 往身后；±30 明显，±55 很夸张）
                    - `lElbow/rElbow` 屈肘（0 = 伸直，40 = 自然弯，70 = 手收到身前，90+ = 紧收）
                    - ⚠ `lArmTwist/rArmTwist` 上臂自转**无效（写了没变化），不要用**；掌心朝向改用 rHandTurn/lHandTurn
                    - `lElbowSide/rElbowSide` 小臂外摆（挥手主要靠它；**左右两侧都要写**，只写一侧会两边不一样）
                    - `lHandTurn/lHandBend/rHandTurn` 手腕转掌 / 压翘

                    **动作配方**（阶段 → 该动的通道；数值自己给）：
                    - **跳**：① 蓄力：`crouch` 0.5~0.9（腿自动蹲）+ `spinePitch` 前倾 + **手臂后摆
                      （`ArmFwd` −40~−55）+ 屈肘 65~85**；② 蹬地（`ease:"in"`）：`rootY` 抬升 + 手臂
                      **前上甩开**（`ArmFwd` +30、肘伸到 20~25）；③ 腾空：`rootY` 峰值 + 手臂上举、肘微屈 30
                      + 收腿（`lKnee` 90~110）；④ 下落：肘再屈 45~55；⑤ 落地缓冲：**肘 60~75 + `crouch` 0.4~0.5**。
                    - **挥手**：抬臂到与肩平（`ArmUp` 70~90、`Elbow` 30）→ **小臂左右摆**（`ElbowSide` ±25~35，
                      来回两次）→ 收手。
                    - **鞠躬**：`spinePitch` 30~40 + `chestPitch` 10~15 + 头随（`headPitch` 10）
                      + **手臂被动后让**（`ArmFwd` −8~−15、`Elbow` 10~20）；起身反向。
                    - **欢呼**：双臂高举（`ArmUp` 140~158）+ 肘微屈 24~34 + 身体微后仰（`spinePitch` −5），可叠跳。
                    - **耸肩 / 摊手**：`ShoulderUp` 15~25 + `Elbow` 40~50 + 手腕外翻（`HandTurn`）。
                    - **伸手拿 / 递东西**：`ArmFwd` +50~70 + `Elbow` 20~30 + 手型（`fingers`）配合。
                    **通用心法**：**大臂先动 → 小臂跟着（肘必须有变化）→ 最后指尖**；同一根骨在一个动作里
                    "至少变两次"（出去、再回来一点）才像活人 —— **全程一个值 = 棍**。
                    不确定就先用预置起步（`preset`），再改一两处关键通道。
                    ⚠ **别写 `"ease":"linear"`**（匀速 = 机械；引擎的"惯性甩动"要靠**加减速**才看得出来）。
                    不写 ease 就默认 `inout`；要在**段末**有冲劲儿用 `"in"`（加速收尾）、要稳稳停住用 `"out"`。
                    段落也别太长：0.15~0.35s 一段最容易出"活人感"，0.6s 以上的匀速段一定显僵。

                    ### 大幅屈肘 / 接触型姿势（敬礼、扶帽、摸脸、捏东西 —— 手要**贴住**某处）
                    这类动作有个新坑：**惯性偏移会让末端"甩过头"**（角偏移在末端会放大成几厘米的位移）。
                    三条做法（现成范例：`<bodyact preset="salute"/>` 敬礼）：
                    1. **末段留一个空段保持**：`{"pose":{…},"dur":0.32}` 之后接 `{"dur":0.30}`（无 pose）——
                      **停住 ⇒ 速度/加速度项同时归零 ⇒ 偏移消失**，手自然贴稳；
                    2. 大臂记得**往前给一点**（`ArmFwd` 20~30°），否则肘弯了手也够不到额头；
                    3. 还想更精确：`{"preset":"salute","inertia":0.3}`（`inertia` 0~1 缩放整条动作的惯性，0=不用）。
                       —— 引擎已经会自动把"肘弯过 95° 时的手/小臂偏移"压到 60%，一般不用你操心。
                    **肘的可用范围很大**：0=伸直、45=自然弯、90=手到胸前、120+=敬礼/扶帽（本机模型能到 145°）。

                    ### 连招 / 编排：**连不连、怎么连，你自己定**（不用问用户）
                    宿主会**按顺序播**你一次回复里的多条 `<bodyact>`。默认每条末尾都"回到自然姿势"（所以是"一下、一下"）；
                    想让几条连成一套，就给**前面**的加 `"chain":true`（末尾不回中性，结束姿势留给下一条接上）：
                    - 连蹦两下：`<bodyact preset="jump" spec='{"chain":true}'/>` ＋ 再一条 `<bodyact preset="jump"/>`
                      （预置与 spec 会**合并**，spec 里写的字段覆盖预置 ⇒ 这就等于"基于预置改一点"）
                    - 跳完接欢呼：`<bodyact preset="jump_power" spec='{"chain":true}'/>` ＋ `<bodyact preset="jump_joy"/>`
                    - 现成的两连蹦：`<bodyact preset="jump_x2"/>`（跳 → 浅缓冲 → 再跳 → 落地 → 回站，中途不站定）
                    - 也能连别的：挥手 → 鞠躬、伸手 → 握拳 → 放下……凡"有延续关系"的都行
                    什么时候**别**用：两条动作彼此独立，或你希望中间有个明确的"站定"停顿时 —— 那正是回中性的价值。
                    原则：**预置只是省事的起点**。你可以自己写关键帧（spec）、用 overlay 叠加、用 chain 串起来 ——
                    怎么演，由你按当下的情绪和场景决定，不必等用户来指定。

                    ### 整体转身（大幅转身 / 背对观众）
                    `"turn": 150`（度，±180；正的=往角色自己的左边转）—— 转的是**整个模型**（含脚一起转）。
                    - 想背对观众/躲开/转身看别处：`<bodyact spec='{"turn":180,"steps":[...]}'/>`
                    - ⚠ **别用 hipsYaw 去凑大幅转身**：hipsYaw 的语义是「骨盆相对腿」（腿钉在原地），
                      只能小角度（≤±35°）；拧到 90° 以上就是把胯相对腿拧死（反关节、会穿模）。
                      判断法：**腿脚要跟着一起转 → turn；只有骨盆/上身转、脚不动 → hipsYaw**。

                    ### 手型（手指：握拳 / 张开 / 指人 / 竖拇指 / 剪刀手）
                    `"fingers": {"l":"fist","r":"spread"}`
                    - 左右手各自给一个**手型名**，或给逐指数值：`{"r":{"curl":100,"index":0}}` = 右手握拳但食指伸直；
                    - 手型名：open(摊平) / relaxed(自然半握) / half(半握) / fist(握拳) / spread(五指张开)
                              / point(指人) / thumb_up(竖拇指) / victory(剪刀手)；
                    - **拇指是「球窝 + 两个铰链关节」，比四指多几档**（四指只有"卷 + 张开"）：
                      `thumbBase` 0~250 = **近节（根部关节）屈**；`thumbTip` 0~250 = **末节（指尖关节）屈**
                        —— 250 = 该节满屈，尺度由本模型自标定，**你别猜**；也可只写 `thumb`（两节同值，老写法兼容）；
                      `thumbSide` ±150 = 内收/外展（**正 = 离开掌心张开**；负 = 往掌心里收）；
                      `thumbRoll` ±180 = 绕拇指自身长轴**拧**（只改掌面朝向、**不产生弯曲**，对掌时调朝向用）。
                      例：`{"r":{"thumbBase":250,"thumbTip":250,"thumbSide":-60}}` = 拇指两节都弯满并收进掌心（像握拳）。
                      ⚠ 但"捏 / 对掌 / 比心"这类**精细造型仍然别自己硬凑** → 让用户去造型面板摆（拇指有 4 个滑块）。
                    - 想"举拳呐喊"就叠加：`{"overlay":{"base":"hands_up","add":{"fingers":{"l":"fist","r":"fist"}}}}`；
                    - ⚠ 比心 / OK 这类**精细造型**按这个顺序解决，别自己硬凑（要逐指精细角度，硬写一定走形）：
                      ① **先翻常驻信息里的「可用动作」列表**看有没有现成的（比心/握手/鼓掌这类常有现成文件）→
                         有就直接 `<motion option="精确名字"/>`（名字一字不差，含斜杠）；
                      ② 没有再让用户去造型面板摆好手势 → 存成预设 → 你之后用 `<bodyact preset="名字"/>`。

                    ### 组合语法 overlay（把两段动作叠起来）
                    `<bodyact spec='{"overlay":{"base":"wave","add":{"steps":[{"pose":{"headRoll":12},"dur":0.3}]},"amp":1.1,"tempo":0.8}}'/>`
                    - `base`：预设名或一份 spec（打底）；`add`：叠在它之上的关键帧/参数（**不会把 base 吃掉**）；
                    - `amp`：缩放叠加量（1.1=夸张些，0.5=含蓄一半）；`tempo`：改叠加部分的节奏（0.8=慢一档）；
                    - 这是"同一个动作演出不同人格"的主力：预置挥手叠上歪头/抬肩/慢半拍就是另一个人。

                    ## 用法
                    <bodyact spec='{"steps":[{"pose":{"rArmUp":96,"rElbowSide":-12},"dur":0.45,"ease":"out"},{"pose":{"rElbowSide":30},"dur":0.2},{"pose":{"rElbowSide":-24},"dur":0.2},{"pose":{"rElbowSide":30},"dur":0.2}]}'/>

                    - 每一步 `pose` **只写要改的通道**，未写的通道保持上一步的值；
                    - `dur` = 本步用时（秒）；`ease` = linear | in | out | inout；
                    - 顶层可选 `repeat`（整段重复几次）；**末尾会自动回到自然姿势**，你无需补收尾；
                    - 也可直接用预设：<bodyact preset="wave"/>；
                      预设：wave(挥手) / nod(点头) / shake(摇头) / bow(鞠躬) / hands_up(举手) / stretch(伸懒腰) / shrug(耸肩)
                            / jump(轻快蹦) / jump_power(全力深蹲跳) / jump_joy(欢呼跳) / jump_x2(连蹦两下)；

                    ## 生成式动作 prompt（本地模型现场生成，**词条受限于下表**）
                    `<bodyact prompt="a person raises the right hand high above the head and waves hello"/>`
                    一句英文 → 本地模型现场生成 40 帧（@20fps ≈ 2 秒）→ 播放，**零联网、不吃 token**。
                    它的文本理解很**粗**（语义向量模型，不是指令模型）：**只能从上表词条里挑，别自己造句**，
                    换说法很可能生成出完全不相干的动作。
                    **可用词条（实测有效）**：见**常驻信息**里「生成式动作词条」那一行
                    （数据源 = 插件里的 ardy-phrases.json 的 verified 段：真机试跑通过一条就加一条）。
                    ⚠ 这里**不再硬编码** —— 旧写法让白名单实际只有 1 条，AI 于是从不使用生成式。
                    词条是**闭集**：只能照抄那一行里出现的标签/原句，别自己造句。
                    **什么时候用（③ 已改成"优先"，不再是最后手段）**：
                    当**「可用动作」列表里没有合适的文件、配方（preset / 关键帧）也表达不了**时，
                    **首选 `gen:` 词条**（`<motion option="gen:举手挥手"/>`），而不是硬凑 spec 或干脆不动。
                    典型场景：站立待机类小反馈（低头 / 抬头 / 环顾 / 轻微摆臂 / 敬礼 …）。
                    **不要**用它做：蹲跪（走 crouch/kneel）、精细手指造型（走 `<motion>` 或请用户摆）。
                    生成结果**不保证精确**，单次约 1 秒生成 + 2 秒播放；若画面没动或不像，**如实说明并改用 preset**，
                    不要反复重试同一条。

                    ## 造型类姿势（比心 / 叉腰 / 抱臂 / 耍帅 / 敬礼…）：**按顺序解决，别自己硬凑**
                    这类姿势用角度硬凑是做不出来的：通道只到手腕、也没有 IK，
                    而且造型必须"看着画面"调 —— 你凑出来的只会是不像的怪姿势（观感比不做更差）。
                    正确顺序（**从上往下试，别跳步；第 0 步最容易漏**）：
                    0. **先翻常驻信息里的「可用动作」列表**：那是磁盘上现成的动作文件（常含比心 / 握手 / 鼓掌 / 舞蹈…）。
                       有对得上的就直接 `<motion option="精确名字"/>` —— 最省事、也最像（**名字一字不差，含斜杠**）。
                       ⚠ **只能点清单里真实出现的名字，别照抄示例**：清单已按当前模型类型过滤过
                       （VRM 只列 .vrma、PMX 只列 .vmd）—— 清单里没有的名字**一定播不了**（点了也是人不动）。
                    1. 列表里没有，再**请用户**打开桌宠设置面板 →「造型」区 → 拖滑块摆好 → 填名字点「保存」；
                    2. 之后你就能像用内置预设一样使用它：`<bodyact preset="造型名"/>`；
                    3. 已有哪些造型会写在你的常驻信息里（"自定义造型：…"）。
                    都没有：**如实说做不到**。
                    - 例：<bodyact preset="nod"/> 会点头两次。

                    ## 使用频率（**最重要**：不要每轮都动）
                    **不是每次回复都要调用**。只有对话内容本身带明确情绪或动作意图时才用：
                    打招呼 / 告别 / 道谢 / 被夸 / 被责备 / 明显开心或难过 / 明确说到"看、听、来、跳、走、挥手"等动作词。
                    **普通问答、解释说明、闲聊、连续的技术讨论一律不要调用** —— 保持安静才像真人。
                    同一条回复里**最多 1 个动作 + 1 个表情**，不要每个分句都配动作；也不要为了"显得生动"而加。

                    ## 对谁反应、用什么反应（多人 / 群聊场景）
                    **优先级**：主人 > 群友；直接对我说 > 我在旁观。
                    判断"有没有关"看三件事：**谁在说**（主人 / 群友）、**说给谁**（我 / 别人）、**内容是否关于我**。
                    - **主人**说的话**默认都与我有关**（我是他的伙伴）。主人表达情绪（夸奖、鼓励、抱怨、累了、开心、
                      羡慕、撒娇…）→ **必须回应**：一个表情 + 一个**与该情绪匹配**的动作（见下表）。
                      这是"表达情绪"的必需项，**不是可选项**。
                    - **群友之间与我无关的闲聊 → 沉默**（不发表情、不摆动作）；只有群友 @我 / 评价我 / 直接问我时才反应，
                      且强度比主人**低一档**。
                    - 主人只是在群里跟别人聊、内容与我无关时 → 可以给一个**极轻**的表情表示"我在听"，**不要摆动作**。

                    ## 情绪 → 动作 对照（动作必须和情绪匹配，别乱配）
                    | 情绪 | 表情 option | 动作 |
                    |---|---|---|
                    | 被夸 / 开心 | happy | nod（点头）或 hands_up（举手小庆祝） |
                    | 害羞 / 被夸得不好意思 | shy | 幅度要**小**：nod 后停顿，或干脆只留表情（害羞=少动更传神） |
                    | 鼓励我 / 加油 | happy | hands_up 或 wave（挥手打气） |
                    | 羡慕 | surprised 或 shy | 小幅歪头（nod 后停住），**不要大动作** |
                    | 主人难过 / 需要共情 | sad | 缓慢 nod（低头）一两次，动作轻 |
                    | 生气 / 被冒犯 | angry | shake（摇头） |
                    | 撒娇 / 讨要 | shy | stretch（伸懒腰）或 nod，表情保持久一点 |
                    | 惊讶 | surprised | 优先只表情，一般**不给动作** |
                    | 特别兴奋 / 想被注意 | happy | 三档跳按情景选：轻快 `jump` / 用力 `jump_power`（深蹲式）/ 欢呼 `jump_joy`；别连跳 |
                    **强度三档**：轻 = 只表情；中 = 表情 + 一个小动作；强 = 表情 + 明显动作。
                    主人情绪明显 → 至少"中"；群友对我有情绪 → 最多"中"；旁观 → 无。
                    **动作只能从"预置"（`<bodyact preset="…">`）或"动作列表"（`<motion option="…">`）里真实存在的选项里选**；
                    没有贴切的就**只发表情** —— 宁缺勿编（编一个"差不多"的姿势观感更差）。
                    """,
            };
            functionService.RegisterHandler(embodiedHandler, cancellationToken: DestroyCancellationToken);
            AlifeLog.LogInformation("[3D桌宠] 已注册具身动作工具（bodyact）");
        }
        catch (Exception e) { AlifeLog.LogError(e); }
    }

    /// <summary>校验开关并下发 spec 给前端合成播放。</summary>
    void BodyActCore(string json)
    {
        if (!pet.EmbodiedMotionEnabled) throw new Exception("「具身动作」未开启：请先在桌宠设置里打开，再使用 bodyact");
        pet.ComposeBody(json);
        interactor.Poke("已下发具身动作（正在合成并播放，结束后会自动回到自然姿势）。");
    }

    /// <summary>校验开关并下发「生成式动作」（文字 → 本地模型生成 → 重定向 → 播放；失败由前端退回预置）。</summary>
    void BodyActPromptCore(string prompt)
    {
        if (!pet.EmbodiedMotionEnabled) throw new Exception("「具身动作」未开启：请先在桌宠设置里打开，再使用 bodyact prompt");
        pet.GenerateMotion(prompt);
        interactor.Poke($"已交给本地模型现场生成动作：\"{prompt}\"（首次需加载约 684MB 权重，可能要等十几秒；"
            + "之后就快了：约 1 秒生成 + 2 秒播放）。生成结果不保证精确，若画面没动或不像请改用 preset。");
    }

    /// <summary>按「具身表情」开关注册/注销 AI 的情绪/眼嘴工具（关闭时完全不注册 → 不占 token）。</summary>
    void RegisterEmbodiedExpressionHandler()
    {
        try
        {
            if (embodiedExprHandler != null) { functionService.UnregisterHandler(embodiedExprHandler); embodiedExprHandler = null; }
            if (!pet.EmbodiedExpressionEnabled) { AlifeLog.LogInformation("[3D桌宠] 具身表情未开启，已注销 bodyexpress 工具"); return; }

            embodiedExprHandler = new XmlHandler(new BodyExpressHost(this))
            {
                Description = "用「情绪 + 强度 + 保持」驱动角色的真实面部表情与眼嘴（不是文字描述），并可查询真实身体状态。",
                Explanation = """
                    ## 具身表情（bodyexpress）
                    直接驱动角色的脸，**不需要任何生成模型**（走 VRM 自带表情权重，本地即时合成，不吃显存）。

                    ## 可用情绪
                    neutral(中性) / happy(开心) / excited(兴奋) / amused(忍俊) / proud(得意) / confident(自信) / calm(安心) / relieved(释然) / affectionate(温柔) / shy(害羞) / embarrassed(窘迫) / curious(好奇) / concerned(关切) / confused(困惑) / tired(疲惫) / sad(低落) / lonely(落寞) / disappointed(失望) / anxiety(紧张) / fear(害怕) / angry(生气) / frustrated(烦躁) / disgust(嫌弃) / surprised(惊讶)（另兼容 relaxed/thinking）

                    ## 参数
                    - emotion：情绪（必填）
                    - intensity：强度 0~1（默认 0.8；别一直用 1.0，容易变"瞪眼怪"）
                    - hold：保持秒数（默认 8；填 0 或负数 = 一直保持到你下次调用）
                    - mouth_open / eyes_closed：0~1；默认 -1 = 不干预。说话时可小幅驱动嘴型、思考时可半闭眼
                    - vad：「愉悦,唤醒,支配」三个数，各 -1~1。**支配度 D 决定"强势/退缩"**（+0.8=自信压人，-0.8=退缩示弱）；
                      需要精确控制或混合情绪时用（如 0.55,0.35,-0.5 = 害羞但开心）。别和 emotion 的语义打架
                    - au：「通道名:权重,…」局部微调，**单通道上限 0.3**（防止把脸拼坏）。如 au="au12LipCornerPuller:0.2"（强压笑意）
                    - attack：到 90% 的秒数（小=猝不及防，惊讶 0.15；大=缓缓浮现，忧郁 0.9）
                    - decay：衰减半衰期秒数（小=情绪一闪而过，大=久久不散）
                    - 例：<bodyexpress emotion="happy" intensity="0.9" hold="6"/>
                    - 例：<bodyexpress emotion="thinking" intensity="0.6" hold="4" eyes_closed="0.4"/>
                    - 例（惊讶）：<bodyexpress emotion="surprised" intensity="0.85" hold="2" attack="0.15" decay="3"/>
                    - 例（傲娇）：<bodyexpress emotion="angry" intensity="0.45" hold="2.5" au="au12LipCornerPuller:0.2" vad="-0.1,0.5,-0.2"/>
                      要点：基调用 anger、强度别高、再用 au 偷偷抬一点嘴角，hold 短（2~3s），配合嘴硬台词效果最好

                    ## 与 <expression> 的区别
                    <expression> 是"照模型预置清单摆一张指定的脸"，适合精确指名；
                    <bodyexpress> 是"用情绪表达"，自动挑最合适的那张脸并带一点微动，更适合聊天时的自然反应。

                    ## 模型没有对应表情时（自动兜底）
                    系统会自动改用**头部/注视姿态**表达情绪（低头=难过、上抬=惊讶、偏头躲开=害羞…），
                    并在 <bodystate/> 里说明。所以任何模型都不会因为"没有那张脸"而报错或毫无反应；
                    你也别假设自己"做了表情"就一定画面上有——想确认就用 <bodystate/>。

                    ## 查询真实状态
                    <bodystate/> 返回**实际渲染**的表情、表情权重和正在播的动作。不要凭想象描述自己的表情；不确定时先查询。
                    """,
            };
            functionService.RegisterHandler(embodiedExprHandler, cancellationToken: DestroyCancellationToken);
            AlifeLog.LogInformation("[3D桌宠] 已注册具身表情工具（bodyexpress / bodystate）");
        }
        catch (Exception e) { AlifeLog.LogError(e); }
    }

    /// <summary>校验开关并下发一次具身表情（情绪 + 强度 + 保持 + 眼嘴）。</summary>
    void EmbodiedExpressCore(string emotion, double intensity, double hold, double mouthOpen, double eyesClosed,
        string? vad = null, string? au = null, double attack = 0, double decay = 0)
    {
        if (!pet.EmbodiedExpressionEnabled) throw new Exception("「具身表情」未开启：请先在桌宠设置里打开，再使用 bodyexpress");
        pet.ShowEmbodiedExpression(emotion, intensity, hold, mouthOpen, eyesClosed, vad, au, attack, decay);
        string extra = "";
        if (!string.IsNullOrWhiteSpace(vad)) extra += $"，VAD {vad}";
        if (!string.IsNullOrWhiteSpace(au)) extra += $"，AU {au}";
        if (attack > 0) extra += $"，起 {attack:0.00}s";
        if (decay > 0) extra += $"，衰减 {decay:0.0}s";
        interactor.Poke($"已切到表情「{emotion}」（强度 {intensity:0.00}，{(hold > 0 ? "保持 " + hold + " 秒" : "一直保持")}{extra}）");
    }

    /// <summary>把「实际渲染」的身体状态回显给 AI（供 BodyExpressHost.BodyState 调用）。</summary>
    void PokeEmbodiedState() => interactor.Poke(pet.EmbodiedStateText);

    /// <summary>bodyexpress 的承载对象：单独一个 handler，便于随开关注册/注销。</summary>
    public sealed class BodyExpressHost(DeskPetService owner)
    {
        [XmlFunction(FunctionMode.OneShot)]
        [Description("用情绪驱动角色的面部表情与眼嘴（真实生效，不是文字描述）。emotion=neutral/happy/excited/amused/proud/confident/calm/relieved/affectionate/shy/embarrassed/curious/concerned/confused/tired/sad/lonely/disappointed/anxiety/fear/angry/frustrated/disgust/surprised（24 种，另兼容 relaxed/thinking）；intensity 0~1；hold 保持秒数(0=一直保持)；mouth_open/eyes_closed 0~1，-1=不干预；vad=\"愉悦,唤醒,支配\"（各 -1~1，可直接指定连续情绪坐标）；au=\"通道名:权重,…\"（局部微调，单通道 ≤0.3）；attack=到 90% 的秒数；decay=衰减半衰期秒数。")]
        public Task BodyExpress(string emotion, double intensity = 0.8, double hold = 8, double mouth_open = -1, double eyes_closed = -1,
            string? vad = null, string? au = null, double attack = 0, double decay = 0)
        {
            owner.EmbodiedExpressCore(emotion, intensity, hold, mouth_open, eyes_closed, vad, au, attack, decay);
            return Task.CompletedTask;
        }

        [XmlFunction(FunctionMode.OneShot)]
        [Description("查询桌宠身体的真实状态（当前表情/表情权重/正在播的动作等），用来确认自己实际做到了什么，而不是凭想象描述。")]
        public Task BodyState()
        {
            // pet / interactor 是基类的 protected 成员：嵌套类里通过 owner. 访问不到（CS1061），
            // 所以由外层方法代劳。
            owner.PokeEmbodiedState();
            return Task.CompletedTask;
        }
    }

    /// <summary>bodyact 的承载对象：单独一个 handler，便于随开关注册/注销。</summary>
    public sealed class BodyActHost(DeskPetService owner)
    {
        [XmlFunction(FunctionMode.All)]
        [Description("驱动 3D 身体做动作。三种用法：prompt=\"英文短语\"（本地模型**现场生成**全新动作，词条见附加说明）；preset=\"wave\" 等预设名（精确、零延迟）；spec='{…}' 关键帧 JSON（自由编排）。")]
        public Task BodyAct(string? spec = null, string? prompt = null, string? preset = null, [XmlContent] string? content = null)
        {
            // 优先级：prompt（生成）> spec/content（关键帧）> preset（预设名）
            if (!string.IsNullOrWhiteSpace(prompt))
            {
                owner.BodyActPromptCore(prompt!);
                return Task.CompletedTask;
            }
            string json = !string.IsNullOrWhiteSpace(spec) ? spec! : (content ?? "");
            // ★★ v11.48 修：工具说明里承诺「preset 与 spec **合并**，spec 字段覆盖预置 ⇒ 基于预置改一点」，
            //   但旧代码写成 `json 为空 且 preset 有值` 才用 preset ⇒ spec 一有值 preset 就被**整个丢掉**。
            //   实测后果：<bodyact preset="jump" spec='{"chain":true}'/> 只会拿到 {"chain":true}
            //   —— 没有 steps ⇒ 什么都不播（连招示例直接失效）。改成真正的合并。
            if (!string.IsNullOrWhiteSpace(preset)) json = MergePresetIntoSpec(json, preset!.Trim());
            if (string.IsNullOrWhiteSpace(json)) throw new Exception("bodyact 需要 prompt、preset 或 spec（JSON）之一");
            owner.BodyActCore(json);
            return Task.CompletedTask;
        }

        /// <summary>把 preset 名并进 spec JSON（spec 里已有的 preset 字段优先）。spec 不是 JSON 对象时保持原样。</summary>
        static string MergePresetIntoSpec(string? json, string presetName)
        {
            string s = (json ?? "").Trim();
            string only = "{\"preset\":" + System.Text.Json.JsonSerializer.Serialize(presetName) + "}";
            if (s.Length == 0) return only;
            try
            {
                var node = System.Text.Json.Nodes.JsonNode.Parse(s);
                if (node is System.Text.Json.Nodes.JsonObject obj)
                {
                    // spec 里已经写了 preset 就以 spec 为准（与"spec 覆盖预置"的文档一致）
                    if (obj["preset"] == null) obj["preset"] = System.Text.Json.Nodes.JsonValue.Create(presetName);
                    return obj.ToJsonString();
                }
            }
            catch { return only; }      // 解析失败 ⇒ 至少让预置能播
            return s;                    // 合法但不是对象（如帧数组）⇒ 保持原行为
        }
    }

    /// <summary>注册「动作人设」工具。常驻注册：它也影响"从预置动作里挑哪个"与待机手感。</summary>
    void RegisterMotionIdiomHandler()
    {
        try
        {
            if (motionIdiomHandler != null) { functionService.UnregisterHandler(motionIdiomHandler); motionIdiomHandler = null; }
            motionIdiomHandler = new XmlHandler(new MotionIdiomHost(this))
            {
                Description = "写下/更新你自己的「动作人设」：把性格设定与**近期记忆**蒸馏成一小段动作风格契约"
                    + "（幅度/节奏/小动作密度/平滑/静定 + 惯用动作/忌讳/签名动作）。不填参数=读回当前设定；reset=true=清空。",
                Explanation = """
                    ## 动作人设（motionidiom）—— 让你动起来像"你自己"

                    默认所有角色共用同一套动作习惯，看起来就是套路化的"通用可爱"。
                    这个工具让你把**自己的性格设定 + 近期记忆**蒸馏成一小段风格契约，之后你的动作表达就带上自己的味道。
                    （它写一次就长期存在：会被拼进你的常驻信息里，所以**换了会话也不会跑偏**。）

                    ## 何时写
                    - **第一次**：启用后用一次即可，**不要每轮调用**；
                    - **需要更新**：人设变了，或**记忆发生了变化**（关系升温 / 争吵 / 被冷落 / 发生了大事）→ 再写一次覆盖；
                    - 记忆的影响**优先于人设**：`state` 就写"近况让我动作变成什么样"。

                    ## 参数（都可选，只写要改的）
                    - persona：一句话「我是什么样的人」
                    - state：一句话「记忆/近况对我动作风格的影响」（会变，记得更新）
                    - like：惯用动作（如"爱歪头、常抱臂、高兴时举双手"）
                    - avoid：忌讳（如"不大跳、不撒娇式摆手"）
                    - signature：签名动作（被夸 / 打招呼时固定用哪个）
                    - amp 幅度 0.3~1.5（小=克制含蓄 / 大=夸张奔放）
                    - tempo 节奏 0.5~2（小=慢条斯理 / 大=干脆利落）
                    - density 小动作密度 0~3（0=几乎不动 / 3=很活跃）
                    - smooth 平滑 0~0.3（大=优雅柔和 / 小=跟手直接）
                    - stillness 静定 0~1（大=少跟随少微动、偏冷偏稳 / 小=活泼好动）

                    例：
                    <motionidiom persona="傲娇、嘴硬心软、怕被看穿" state="最近被冷落，动作更收敛、话更少"
                     like="歪头、小幅摇头、抱臂" avoid="不大跳、不撒娇式摆手" signature="被夸时先楞一下再撇嘴"
                     amp="0.6" tempo="0.8" density="1.2" smooth="0.12" stillness="0.7"/>

                    ## 典型人设 → 数值参考
                    | 人设 | amp | tempo | density | smooth | stillness |
                    | 元气活泼 | 1.2 | 1.3 | 3 | 0.05 | 0.15 |
                    | 温柔娴静 | 0.7 | 0.8 | 1 | 0.15 | 0.6 |
                    | 傲娇 | 0.6 | 0.9 | 1 | 0.12 | 0.7 |
                    | 冷面沉稳 | 0.5 | 1.0 | 0.5 | 0.1 | 0.9 |
                    | 慵懒 | 0.6 | 0.6 | 1 | 0.2 | 0.8 |

                    ## 做不到的**别写进去**
                    没有位移/IK：**精细手指造型**（比心、OK、敬礼、抱拳）、大幅位移、**跳**做不到。
                    写进 like/signature 只会让你反复尝试又做不到 —— 只写**单轴、意图性**的肢体语言
                    （点头/摇头/挥手/耸肩/抬手/歪头/转身/颔首这一类）。
                    **手指本身是有的**：握拳 / 五指张开 / 指人 / 竖拇指 / 剪刀手用 `"fingers"`（见上）；
                    比心这种精细造型请让用户摆好存成预设，然后用 `<bodyact preset="名字"/>`。
                    **可以做到的**（别漏了）：蹲下与跪下用 <bodyact spec='{"crouch":0.7}'/> / {"kneel":1}
                    自动解算（膝盖你永远不用手写）；原地动作、动胯、屈膝、勾脚、翘脚趾都可以。

                    ## 用户看得到、改得到，到期会自动提醒你重写
                    - 这份人设**用户能直接看到，也能直接改**（桌宠设置面板「动作/舞蹈」底部），改完立即生效；
                      所以不要把它当成"只有你知道的私有笔记" —— 它是**你和用户共同维护**的风格说明。
                    - 面板上会显示"谁写的 / 多久没更新 / 是否到期"，还有一个「让 AI 重写」按钮（用户会直接叫你重写）。
                    - 到期后你的常驻信息里会多出一行提醒：那是让你**在下次说话时顺手更新**（不额外占用对话回合）。
                      看到提醒时 —— 有变化就更新，确实没变化就保持不动，不要为了"完成任务"而空改一遍。
                    - 与用户手改冲突时：**以最新一次为准**（用户改完，你下一轮看到的就是他改后的版本）。

                    ## 和谁配合
                    写完之后：`<motion option="…">` 挑预置时要挑**符合自己人设**的；
                    `<bodyact preset/spec>` 的幅度与节奏也照上面的数值来（`amp` 大就写更大的角度、`tempo` 小就把 dur 拉长）。
                    """,
            };
            functionService.RegisterHandler(motionIdiomHandler, cancellationToken: DestroyCancellationToken);
            AlifeLog.LogInformation("[3D桌宠] 已注册动作人设工具（motionidiom）");
        }
        catch (Exception e) { AlifeLog.LogError(e); }
    }

    /// <summary>动作人设：写入 / 读回 / 清空，并同步常驻提示与前端手感。不填任何参数 = 读回。</summary>
    void MotionIdiomCore(double amp, double tempo, double density, double smooth, double stillness,
        string? persona, string? state, string? like, string? avoid, string? signature, bool reset)
    {
        if (reset)
        {
            pet.ClearMotionIdiom();
            MotionIdiomSync();
            interactor.Poke("已清空你的动作人设（这套动作风格不再影响你；想要就重新写一次）。");
            return;
        }

        // 空串按"没给"处理（XML 绑定可能给空串）：宁可少改，也不要把字段意外抹掉；清空请用 reset。
        bool Has(string? s) => !string.IsNullOrWhiteSpace(s);
        bool write = amp >= 0 || tempo >= 0 || density >= 0 || smooth >= 0 || stillness >= 0
            || Has(persona) || Has(state) || Has(like) || Has(avoid) || Has(signature);

        MotionIdiom m = Idiom();
        if (!write)
        {
            interactor.Poke(m.IsEmpty
                ? "你还没写过动作人设。若你的角色有固定性格或近期记忆，用 <motionidiom persona=\"…\" state=\"…\" like=\"…\" avoid=\"…\" signature=\"…\" amp=\"0.6\" tempo=\"0.9\"/> 写一次，你的动作表达就会带上自己的风格。"
                  + "（用户也可以在「插件配置 → 3D桌宠」里直接编辑这套人设。）"
                : "你当前的动作人设：\n" + m.Compact());
            return;
        }

        if (amp >= 0) m.Amp = amp;
        if (tempo >= 0) m.Tempo = tempo;
        if (density >= 0) m.Density = density;
        if (smooth >= 0) m.Smooth = smooth;
        if (stillness >= 0) m.Stillness = stillness;
        if (Has(persona)) m.Persona = persona!;
        if (Has(state)) m.State = state!;
        if (Has(like)) m.Like = like!;
        if (Has(avoid)) m.Avoid = avoid!;
        if (Has(signature)) m.Signature = signature!;
        pet.SaveMotionIdiom(m, "ai");     // 夹取 + 写回配置 + 持久化
        MotionIdiomSync();
        MotionIdiom saved = Idiom();
        interactor.Poke($"动作人设已记下并生效：幅度 {saved.Amp:0.##}、节奏 {saved.Tempo:0.##}、"
            + $"小动作密度 {saved.Density:0.#}、平滑 {saved.Smooth:0.##}、静定 {saved.Stillness:0.##}。"
            + "之后我会按这个风格表达。");
    }

    /// <summary>人设变化后：刷新常驻提示（AI 自己看得见）+ 把数值推给前端换成真实手感。</summary>
    void MotionIdiomSync()
    {
        try { idiomSig = Idiom().Fingerprint(); } catch { }
        try { PushMotionStyle(); } catch (Exception e) { AlifeLog.LogError(e); }
        try { RefreshModelPrompt(); } catch (Exception e) { AlifeLog.LogError(e); }
    }

    /// <summary>把动作人设下发前端：数值（换手感）+ 文本/状态（小面板只做一行摘要显示）。</summary>
    void PushMotionStyle()
    {
        int due = MotionIdiomDueDays();
        MotionIdiom m = Idiom();
        pet.SetMotionStyle(new
        {
            amp = m.Amp,
            tempo = m.Tempo,
            density = m.Density,
            smooth = m.Smooth,
            stillness = m.Stillness,
            label = m.Persona.Length > 0 ? m.Persona : "（未命名）",
            summary = m.Summary(),
            persona = m.Persona,
            state = m.State,
            like = m.Like,
            avoid = m.Avoid,
            signature = m.Signature,
            source = m.Source,
            refreshDays = due,                              // 0 = 已关闭自动提醒
            due = due > 0 && m.DaysSinceUpdate() >= due,    // 小面板显示"已到期"
            ageText = m.AgeText(due),
            isEmpty = m.IsEmpty
        });
    }

    /// <summary>动作人设的自动更新提醒间隔（天）；0 = 关闭。</summary>
    int MotionIdiomDueDays() { try { return Math.Max(0, pet.Configuration.MotionIdiomRefreshDays); } catch { return 0; } }

    /// <summary>用户摆好的自定义造型名单（没有则返回 ""）。AI 可直接 <bodyact preset="名字"/>。</summary>
    string CustomPoseNamesText()
    {
        try
        {
            string j = pet.Configuration.CustomPoses;
            if (string.IsNullOrWhiteSpace(j)) return "";
            Dictionary<string, Dictionary<string, double>>? map =
                System.Text.Json.JsonSerializer.Deserialize<Dictionary<string, Dictionary<string, double>>>(j);
            if (map is null || map.Count == 0) return "";
            return string.Join("、", map.Keys);
        }
        catch { return ""; }
    }

    /// <summary>造型清单变化 → 重发常驻信息（AI 下一轮就能看到新的造型名/提示）。</summary>
    void OnCustomPosesChanged()
    {
        try { RefreshModelPrompt(); } catch (Exception e) { AlifeLog.LogError(e); }
    }

    /// <summary>前端的动作人设请求：get=索取 / set=用户保存编辑 / rewrite=请 AI 按最新记忆重写。</summary>
    void OnMotionStyleCommand(string cmd, string json)
    {
        try
        {
            switch ((cmd ?? "").Trim().ToLowerInvariant())
            {
                case "get":
                    PushMotionStyle();
                    break;

                case "set":
                case "setfeel":     // setfeel = 桌宠面板只微调了手感参数（不重置"该提醒重写"的计时）
                {
                    // 用户手动编辑：整份覆盖（面板给的是全部字段），来源记 user 便于区分"该不该让 AI 重写"。
                    if (string.IsNullOrWhiteSpace(json)) return;
                    bool touch = cmd.Trim().ToLowerInvariant() == "set";
                    MotionIdiom? edited;
                    try
                    {
                        // JS 传的键是小写（amp / persona / …），属性是 PascalCase → **必须**开忽略大小写，
                        // 否则会静默反序列化成空对象（这个坑踩过一次，表现为"保存了但全空"）。
                        edited = System.Text.Json.JsonSerializer.Deserialize<MotionIdiom>(json,
                            new System.Text.Json.JsonSerializerOptions { PropertyNameCaseInsensitive = true });
                    }
                    catch (Exception e) { interactor.Poke("动作人设保存失败（JSON 不合法）：" + e.Message); return; }
                    if (edited is null) return;
                    pet.SaveMotionIdiom(edited, "user", touch);   // 夹取 + 写回配置 + 持久化
                    MotionIdiomSync();
                    if (touch)
                        interactor.Poke("动作人设已按你的编辑保存并生效。"
                            + (MotionIdiomDueDays() > 0 ? " 到期后 AI 会按最新记忆自己重写，你可以随时再改。" : ""));
                    else
                        AlifeLog.LogInformation("[3D桌宠] 动作人设手感参数已更新（只微调数值，不重置重写提醒计时）");
                    break;
                }

                case "rewrite":
                    // 用户点「让 AI 重写」：这是**用户主动发起**的一次对话注入（会消耗一轮），所以由用户决定何时花。
                    interactor.Chat("（桌宠系统）请根据你最新的记忆与关系变化，用 <motionidiom> 更新一次你的动作人设："
                        + Idiom().Compact()
                        + "\n只写有变化的字段即可；若确实没有变化，保持原样不用调用。");
                    interactor.Poke("已请 AI 按最新记忆重写动作人设（它会在这次回复里处理）。");
                    break;
            }
        }
        catch (Exception e) { AlifeLog.LogError(e); }
    }

    /// <summary>motionidiom 的承载对象（单独一个 handler，便于随开关注册/注销）。</summary>
    public sealed class MotionIdiomHost(DeskPetService owner)
    {
        [XmlFunction(FunctionMode.OneShot)]
        [Description("写下/更新你自己的「动作人设」（性格 + 记忆 → 动作风格契约）。不填任何参数 = 读回当前设定；reset=\"true\" = 清空。一次写完长期有效，不要每轮调用。")]
        public Task MotionIdiom(
            double amp = -1, double tempo = -1, double density = -1, double smooth = -1, double stillness = -1,
            string? persona = null, string? state = null, string? like = null, string? avoid = null, string? signature = null,
            string? reset = null)
        {
            // reset 用字符串而非 bool：XML 绑定对 bool 的容错不确定，而"空值=清空"是**破坏性**行为，
            // 万一绑定对缺省属性给空串就会误清空 —— 所以只认明确的 true/1/yes。
            bool doReset = reset is not null &&
                (reset.Trim().Equals("true", StringComparison.OrdinalIgnoreCase)
                 || reset.Trim() == "1"
                 || reset.Trim().Equals("yes", StringComparison.OrdinalIgnoreCase));
            owner.MotionIdiomCore(amp, tempo, density, smooth, stillness, persona, state, like, avoid, signature, doReset);
            return Task.CompletedTask;
        }
    }

    void RefreshModelPrompt()
    {
        interactor.Prompt(BuildModelInfoText());
    }

    string BuildModelInfoText()
    {
        string expressions = pet.SupportedExpressions.Length == 0 ? "（当前模型没有可用的表情）" : string.Join("、", pet.SupportedExpressions);
        string motions = pet.SupportedMotions.Length == 0 ? "（当前模型没有可用的动作）" : string.Join("、", pet.SupportedMotions);
        string models = pet.AvailableModels.Length == 0 ? "（本机只有这一个模型）" : string.Join("、", pet.AvailableModels);
        // 动作人设：AI 自己写的风格契约定时回灌到常驻信息里 → 它每轮都看得见，跨会话也不会跑偏。
        // （没写时不硬塞长文，只给一句引导，避免白吃 token。）
        MotionIdiom m = Idiom();
        string idiom = m.Compact()
            ?? "（你还没写过动作人设。若你的角色有固定性格或近期记忆，用 <motionidiom> 写一次："
             + "动作幅度/节奏/惯用动作/忌讳就能按你自己的设定来，而不是所有角色共用一套动作。"
             + "用户也可以在「插件配置 → 3D桌宠」里直接编辑这几项。）";
        // 到期提醒：只在到期时多出一行，且**不额外占用对话回合** —— AI 在它下次说话时顺手更新，
        // 所以既不会"没攒下变化就重写白费 token"，也不会长期不更新。间隔由用户设置（0=关闭）。
        int dueDays = MotionIdiomDueDays();
        int ageDays = m.DaysSinceUpdate();
        string refreshNote = (!m.IsEmpty && dueDays > 0 && ageDays >= dueDays)
            ? $"\n⚠ 你的动作人设已 {ageDays} 天没更新（提醒间隔 {dueDays} 天）：对照你最近的记忆/关系变化，"
              + "若有明显不同就用 <motionidiom> 更新一次（只写变化的字段）；确实没变化就保持不动。"
            : "";
        // 自定义造型：把用户摆好的造型名字告诉 AI（它自己用 spec 凑造型是做不出来的，必须用这些）。
        // ★ 顺序很重要：**先引导它翻「可用动作」列表**。列表里常有现成的（实测有"手势舞比心/动作"），
        //   直接 <motion> 播放既省事又最像；旧文案只写"请用户去摆"，会把它推去让用户白拖一次滑块。
        string customPoses = CustomPoseNamesText();
        string poseLine = "\n- 需要造型类姿势（比心 / 叉腰 / 抱臂 / 耍帅 / 敬礼…）时，**按这个顺序解决**："
            + "① 先翻上面「可用动作」列表里有没有现成的（比心 / 握手 / 鼓掌 / 舞蹈…）→ 有就用 "
            + "<motion option=\"精确名字\"/>（名字一字不差，含斜杠）；"
            + (customPoses.Length > 0
                ? $"② 再试用户已经摆好的造型：{customPoses} —— 用 <bodyact preset=\"造型名\"/>；"
                  + "想要新造型就请用户去桌宠面板的「造型」里摆一次并命名（造型必须看着画面调，你自己凑角度做不出来）。"
                : "② 列表里没有，就请用户到桌宠面板的「造型」区拖滑块摆一次并命名（造型必须看着画面调，你自己凑角度做不出来）。")
            + "你自己用 spec 硬凑角度是做不出来的 —— 宁可不做，也不要编一个不像的姿势。";
        // 生成式词条：和 208 个现成动作**并列**列出来 —— 并列它才会被当成"选项"而不是"特殊技能"。
        string genPhrases = GenPhrasesText();
        return $"""
                【当前桌宠模型】{pet.CurrentModel}
                - 可用表情（{nameof(Expression)} 的 option）：{expressions}
                - 可用动作（{nameof(Motion)} 的 option）：{motions}
                - 生成式动作词条（**同样**用 {nameof(Motion)} 的 option，写成 `gen:标签` → 本地模型现场生成）：{genPhrases}
                - 可切换的模型（{nameof(SwitchModel)} 的 name）：{models}
                只能用上面列出的选项，不要自己编造；不确定就用{nameof(Speak)}说话。
                想换模型时用 {nameof(SwitchModel)} 指定上面列出的模型名。
                seconds 只对表情有用（保持多久后收回）：不填=5 秒后收回；填秒数=保持那么久；填 0 或负数=一直保持。
                ★动作的 seconds **不要填**：让它自然播完一次 —— 素材长短与内容你都无法预知
                  （例如一支打招呼动作前 3 秒是背身、第 4 秒才转身），填短秒数会截断在没内容的那段；
                  只有想让它多循环一会儿（跳舞/待机）才填，且要 ≥15。

                {idiom}
                {refreshNote}
                {poseLine}
                - 素材里没有的**小反馈动作**（欠身 / 歪头 / 缩肩 / 泄气 / 挺直 / 伸手 / 侧身…）：用
                  <bodyact spec=…> 自己写。**配方表（含实测角度）在 bodyact 工具说明的「常用反馈动作配方」一节**，
                  照着配、改幅度就行 —— 比你从零猜角度靠谱得多。
                """;
    }

    void AnnounceSwitch(string modelName)
    {
        try
        {
            string expressions = pet.SupportedExpressions.Length == 0 ? "无" : string.Join("、", pet.SupportedExpressions);
            string motions = pet.SupportedMotions.Length == 0 ? "无" : string.Join("、", pet.SupportedMotions);
            string models = pet.AvailableModels.Length == 0 ? "无" : string.Join("、", pet.AvailableModels);
            interactor.Chat($"（桌宠换模型了）现在用的是「{modelName}」。可用表情：{expressions}；可用动作：{motions}；还能切换的模型：{models}。");
        }
        catch (Exception e) { AlifeLog.LogError(e); }
    }

    string LastModelPath => Path.Combine(AlifePath.StorageFolderPath, Character.StorageKey, "Configuration", $"{GetType().FullName}.lastmodel.txt");

    void OnModelSwitched(string modelName)
    {
        AlifeLog.LogInformation($"[3D桌宠] 模型已切换为 {modelName}，刷新常驻信息与函数文档");
        try { RefreshModelPrompt(); } catch (Exception e) { AlifeLog.LogError(e); }
        try { RegisterHandler(); } catch (Exception e) { AlifeLog.LogError(e); }
        // 换模型后前端会重新走 load（options 会覆盖手感）→ 这里补推一次人设，保证不丢。
        try { PushMotionStyle(); } catch (Exception e) { AlifeLog.LogError(e); }
        AnnounceSwitch(modelName);
        WriteLastModel(modelName);
    }

    void WriteLastModel(string modelName)
    {
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(LastModelPath)!);
            File.WriteAllText(LastModelPath, modelName ?? "");
        }
        catch (Exception e) { AlifeLog.LogError(e); }
    }

    protected override Task OnStart()
    {
        pet.OnInput += interactor.Chat;
        pet.OnInteracted += text => interactor.Chat("交互：" + text);
        pet.ModelSwitched += OnModelSwitched;
        // 重新注册 handler：3D 模型通常在 OnAwake 之后才加载完，这里用已加载的表情/动作刷新一次
        RegisterHandler();

        RefreshModelPrompt();
        // 启动时也把动作人设的数值推一次：否则重开窗口后人设只剩"提示词侧"，手感会退回默认。
        try { PushMotionStyle(); } catch (Exception e) { AlifeLog.LogError(e); }

        string current = pet.CurrentModel;
        string last = "";
        try { if (File.Exists(LastModelPath)) last = File.ReadAllText(LastModelPath).Trim(); } catch { }
        if (!string.IsNullOrEmpty(last) && !string.Equals(last, current, StringComparison.OrdinalIgnoreCase))
            AnnounceSwitch(current);
        WriteLastModel(current);

        return Task.CompletedTask;
    }
    protected override Task OnUpdate()
    {
        bool currentStatus = ChatBot.IsChatOccupied;
        if (currentStatus != lastStatus)
        {
            lastStatus = currentStatus;
            _ = pet.ShowUsing(currentStatus);
        }

        // 配置页可以**直接编辑**动作人设（它现在是配置项），但"应用/应用到角色"由框架处理，这里拿不到回调。
        // 所以每 2 秒比对一次指纹：变了就当作"用户手改"→ 夹取越界值、标记来源、落盘、重新推给前端并刷新常驻提示。
        // 轮询成本可忽略（10 个字段拼个串），换来的是"两个入口（AI / 用户）永远一致"。
        try
        {
            double now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() / 1000.0;
            if (now >= idiomPollAt)
            {
                idiomPollAt = now + 2;
                string sig = Idiom().Fingerprint();
                string dueSig = MotionIdiomDueDays().ToString();
                if (sig != idiomSig)
                {
                    MotionIdiom m = Idiom();
                    bool outOfRange = m.Amp < 0.3 || m.Amp > 1.5 || m.Tempo < 0.5 || m.Tempo > 2
                        || m.Density < 0 || m.Density > 3 || m.Smooth < 0 || m.Smooth > 0.3
                        || m.Stillness < 0 || m.Stillness > 1;
                    pet.SaveMotionIdiom(m, "user");     // 夹取 + 来源=user + 刷新更新时间 + 持久化
                    idiomSig = Idiom().Fingerprint();   // 防止每 2 秒重复处理
                    idiomDueSig = MotionIdiomDueDays().ToString();
                    MotionIdiomSync();
                    AlifeLog.LogInformation("[3D桌宠] 检测到配置页修改了动作人设，已重新应用"
                        + (outOfRange ? "（越界数值已自动夹到合法区间）" : ""));
                }
                else if (dueSig != idiomDueSig)
                {
                    // 只改了「更新提醒间隔」：不动人设与时间戳，只刷新常驻提示（到期那一行据此出现/消失）
                    idiomDueSig = dueSig;
                    try { RefreshModelPrompt(); } catch (Exception e) { AlifeLog.LogError(e); }
                    AlifeLog.LogInformation("[3D桌宠] 动作人设更新提醒间隔已改为 " + dueSig + " 天");
                }
            }
        }
        catch (Exception e) { AlifeLog.LogError(e); }

        return Task.CompletedTask;
    }
}
