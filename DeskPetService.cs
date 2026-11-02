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
    [Description("切换人物基础姿势：stand=站立；sit_full=全身坐（腿可见，普通窗口用这个）；sit=任务栏坐（只显示上半身）；lieback=仰躺。"
        + "用户说『坐下/坐好/坐着/站起来/躺下』时用它；**不要用 bodyact 的 crouch 代替坐下**（crouch 只是蹲）。")]
    public Task Pose(string option)
    {
        option = (option ?? "").Trim();
        string p = option.ToLowerInvariant();
        if (p != "stand" && p != "sit" && p != "sit_full" && p != "lieback")
            throw new Exception("选项不存在");
        pet.SetPosture(p);
        return Task.CompletedTask;
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
        + "★gen: 模式下 seconds 还可控制生成长度：不填=4 秒；填大于 4 会按 4 秒分段生成并**连续播放**（最多 12 秒）。"
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
            BodyActPromptCore(hit.Phrase, seconds);      // 走「具身动作」开关与同一条生成链路（失败由前端退回）；seconds 可拉长生成
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
        pet.BodyExpressDocChanged += RegisterEmbodiedExpressionHandler;
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

        string exprHint = pet.EmbodiedExpressionEnabled
            ? "- ★ 情绪表情**优先**用 `<bodyexpress emotion=\"happy\" intensity=\"0.8\" hold=\"5\"/>`（真实面部驱动，24 种情绪，吃 VRM 表情权重）；`<bodystate/>` 查实际渲染。下面 `Expression option` 是旧的表情名接口（兜底，别优先）。\n"
            : "";
        handler = new XmlHandler(this) {
            Description = "此服务让你获得一副可交互的 3D 桌宠身体（VRM / PMX+VMD）。这是你主要的对外输出表情动作等外观信息的工具，需要积极使用。需要详细说明时先输出 <DeskPetService/> 读取；随后用 <bodyexpress/>（情绪表情）、<bodyact/>（具身动作）、<Expression/> / <Motion/> 调用。",
            Explanation = $"""
                           ## 支持选项
                           - 当前模型：{pet.CurrentModel}
                           - 支持的 {nameof(Expression)} 选项：{expressions}
                           - 支持的 {nameof(Motion)} 选项：{motions}
                           - 可切换的模型：{models}
                           {exprHint}
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
        // ★ P0-B：改隐式文档 —— 常驻只注入一行描述，完整文档由模型需要时用 <DeskPetService/> 读取。
        //   旧默认 Explicit 会把“表情/动作/模型清单 + 全部说明”每轮重复注入（日志实测 Input≈30.7k）。
        functionService.RegisterHandler(handler, DocumentMode.Implicit, DestroyCancellationToken);
        try
        {
            AlifeLog.LogInformation($"[3D桌宠] 提示词体积：常驻 {BuildModelInfoText().Length} 字符｜主工具文档 {handler.Document().Length} 字符（Implicit）");
        }
        catch (Exception e) { AlifeLog.LogWarning("[3D桌宠] 提示词体积统计失败: " + e.Message); }
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
                Description = "用关键帧 JSON 驱动 3D 身体的「具身动作」（在预置动作之外自由编排动作）。先输出 <BodyActHost/> 读取完整通道/配方，随后用 <bodyact .../> 调用。",
                Explanation = """
                    ## 具身动作（bodyact）
                    在预置动作之外，用**关键帧 JSON** 自由编排。角度单位=度；**正数一律=抬起来/往身前/往身体外侧**
                    （左右正负不用算）。通道是解剖学语义，旋转轴由引擎按当前模型的真实骨骼朝向推导。

                    ★★ **一次回复只发一条 bodyact**：连续/并行动作必须写进同一条 spec 的多个 steps（同一时间段里多个通道一起给），
                    不要拆成多条调用——每条都会先播完并回站姿，中间会出现明显空档（用户实测“一条一条执行、很生硬”）。
                    “并行”= 同一个 step 里同时给多个通道（手臂 + 脊柱 + 头），不是等一个动作做完再做下一个。
                    拥抱直接用预设 hug：它已经包含“前伸 → 收拢 → 保持 → 回位”，**不要再补一条交叉双臂动作**；想更紧就在同一 spec 里加一步。

                    ## 通道（l=左 r=右）
                    肩: l/rShoulderUp(耸肩)  l/rShoulderFwd(含胸/展肩)
                    上臂: l/rArmUp(0垂/30稍抬/90侧平/150过头；**横向张开手臂用它，别用 ElbowSide 硬掰**)  l/rArmFwd(±30明显,±55夸张)  l/rArmIn(水平内收：拥抱往前伸时 10~25；35+ 会抱到自己胸口)
                    肘: l/rElbow(**只能 0~145 的正数**：0直/40自然/70手到身前/90+紧收；负数=反关节，会被夹到 0)
                        l/rElbowSide(只是 ±35 以内的"摆手"微调，**不能拿它当屈肘**；写大=小臂横着掰断)
                    腕: l/rHandTurn(转掌，±85)  l/rHandBend(压/翘，-55~70)  l/rHandSide(±25)
                    ⚠ `l/rArmTwist`、`l/rElbowTwist` 实测无效，不要写（掌心朝向用 HandTurn，别超过 ±85）。
                    头/腰/胸/胯: head|spine|chest|hips + Pitch(点头/躬身) Yaw(转) Roll(歪/侧弯)
                    胯(hips*) = 骨盆相对腿（腿钉原地，≤±35°）；大幅转身用 `turn`（整身连脚一起转）。
                    腿: l/rLegFwd(正=前抬,负=后摆)  l/rLegSide(±75, 横向开腿/大步)  l/rLegTwist  l/rKnee(**只能 0~150 的正数**，负=反膝会被夹到 0)
                        l/rAnkle(勾脚)  l/rAnkleSide(内外翻)  l/rToes(翘趾)
                    ⚠ **关节硬约束**：肘/膝/腕/肩/腿都有生理范围（引擎最后一道闸会夹住并写日志），
                      别用"大幅度硬转"去凑姿势；尤其**肘只能屈、膝只能后折**，写反了画面就是手臂折断。
                    高层参数（**写在 step 层，不要塞进 pose**）：crouch(0~1 蹲；1≈膝97°/下沉0.41m 深蹲)  rootY(±0.6 胯升降)  kneel(0~1 跪；1≈膝74°/下沉0.44m 膝触地)  turn(±720, 360=转一圈, 顶层)  repeat  chain  overlay

                    ### 基础姿势（不是动作）
                    - 坐下/坐好 → Pose 工具 option=sit_full（全身坐，腿可见）；坐到任务栏 → sit（只显示上半身）；
                      站起来 → stand；躺下 → lieback。
                    - **不要用 bodyact 的 crouch/kneel 代替“坐下”**：crouch 是蹲，不是坐。
                    - 具身动作引擎会自动补：肘跟随、腕自然翘、抬臂掌心朝向、胸腔/头部联动、单侧发力时的重心微倾；
                      写动作时不用重复这些，**同一条动作至少要有一处停顿/空段**，不要所有段都匀速。

                    ### 常用配方（角度取自内置预置实测值；照抄改数，别从零猜）
                    一拍 = `{"pose":{...},"dur":0.5,"ease":"inout"}`；引擎会自动补"回自然姿势"，通常只写"去"的那拍。
                    - 鞠躬: spinePitch35 chestPitch12 headPitch12 lArmUp=rArmUp12；0.55s inout
                    - 拥抱: 直接用 preset="hug"；自由编排必须 ArmFwd 75~90（往前伸）+ **ArmIn 10~25**（只轻轻收拢）+ Elbow 35~60
                    - **幅度底线**：拥抱/挥手/伸手/指这类表达动作，主通道别写 10~20°（画面几乎看不出）；
                      挥手 ArmUp≥90、伸手 ArmFwd≥55、拥抱 ArmFwd≥75 且 ArmIn 10~25；小角度只用于微调。
                      （只写 ArmFwd 手臂会停在身体两侧，抱不拢 = “只往前伸一点点”）
                    - 小示意: 上列×0.4；0.35s
                    - 点头两下: headPitch 18→-4→18→0，每拍0.25s
                    - 摇头: headYaw 20↔-20，每拍0.22s，`"repeat":2`
                    - 歪头: headRoll14 headYaw6；0.35s out
                    - 缩肩/不好意思: lShoulderUp=rShoulderUp20 headPitch10 headRoll8；0.35s out
                    - 耸肩: lArmUp=rArmUp30 lElbow=rElbow45 headRoll8→-8→8；每拍0.35s
                    - 挺直/精神一振: spinePitch-8 headPitch-10 lShoulderUp=rShoulderUp14；0.4s out（负=后仰/抬头）
                    - 泄气: spinePitch28 chestPitch10 headPitch16 lShoulderUp=rShoulderUp-12；0.6s inout
                    - 伸手: rArmUp84 rArmFwd10 rElbow26 rElbowSide4 rHandTurn-16 chestYaw-5；0.62s inout
                    - 双手举起: ①ArmUp58 ArmFwd14 Elbow42 ②146/22/ElbowSide8 ③152/32；0.34+0.32+0.18s
                      ⚠ 别只写 ArmUp=150 一个值（旧版，手臂像棍直上直下）
                    - 侧身让开: turn40 headYaw20；0.45s inout
                    - 挥手: ArmUp70~90 Elbow30 → ElbowSide ±25~35 来回两次 → 收手

                    **硬规则**
                    1. 一个连续动作写成**一段**；拆两段会"刹一下再起步"。要停顿用空段 `{"dur":0.4}`。
                    2. 相邻段一律 `ease:"inout"`；别写 `linear`（匀速=机械）。
                    3. 大臂先动 → 小臂跟上（**肘必须变**）→ 指尖；同一根骨至少变两次，全程一个值=棍。
                    4. 接触型（敬礼/扶帽/摸脸）末段留空段保持；大臂 ArmFwd 20~30，否则手够不到。

                    ### 活人感：引擎自动把动作"铺开"到整条脊柱（**你不用管**）
                    真实人体的转动是分散在多节骨骼上的，所以引擎会自动分摊：
                    - 你写 `headYaw:30` ⇒ 自动变成「头 45% + 颈 40% + 上胸 15%」（骨骼链累加，头朝向基本不变，但脖子会跟着转）；
                    - 写 `spinePitch`（弯腰）⇒ 自动带一点胸/上胸一起弯；写 `chestXxx` ⇒ 自动带上胸；
                    - 手臂抬过 55° ⇒ 自动带一点耸肩（治"手臂从躯干直接长出来"的僵硬）。
                    **你只管写"意图通道"**（头 / 腰 / 手 / 腿）—— 颈、上胸这类是引擎内部通道，不对外开放。
                    想要**刻意的机械 / 僵直 / 木偶感**（比如演一个机器人、或者生气时绷住）：spec 里加 `"link":0` 关掉联动。

                    ### 蹲 / 跪（不用手调膝盖）
                    `crouch` 0~1（0站→1最深，按踝背屈 32° 标定，再大也不更深）；`kneel` 0~1（膝盖触地）。
                    ⚠ 这两个是**段参数**：写在 step 层（`{"crouch":0.7,"dur":0.5}`），**不要放进 pose**。
                    给了 crouch/kneel，腿/膝/踝由引擎 IK 解算；**别再手写** lKnee/rKnee/lAnkle（会被覆盖）。
                    膝屈参考：crouch 0.3≈26° / 0.6≈44° / 1≈62°（下沉厘米数随模型腿长变，别照抄）。
                    
                    例: <bodyact spec='{"crouch":0.7,"steps":[{"pose":{"headPitch":10,"spinePitch":8,"lArmFwd":18,"rArmFwd":18,"lElbow":32,"rElbow":32},"dur":0.5}]}'/>
                    ⚠ 蹲下时**手臂一定要跟着给一点**（ArmFwd 15~25 + Elbow 25~40）；只写 crouch + 头/腰 = 木偶下蹲（很生硬）。
                    ⚠ 蹲/跪**不要**用 prompt 生成（模型没有地面概念，会出健身宽站蹲）。

                    ### 跳 / 蹦（优先用预置，别什么场合都跳同一个）
                    `jump` 轻快≈1.05s｜`jump_power` 全力深蹲跳≈1.6s｜`jump_joy` 欢呼跳≈1.4s｜`jump_x2` 连蹦两下。
                    手写跳：每段可给 `rootY`(±0.6) 与 `crouch`；**下压慢(0.3~0.45s)、弹起快(ease:"in")、顶点一瞬、落地浅缓冲**。
                    腾空收腿只写腿通道（`lLegFwd52 lKnee100 lAnkle22` …），蓄力/落地段别写（由 crouch 接管）。

                    ### 自己编动作
                    量级见上面的通道表与配方；不确定就先用预置起步（`preset`），再改一两处关键通道。
                    节奏：`dur` 0.15~0.35s 最自然；单步 ≤4s、整段总时长 ≤8s（超了会被前端截断）。
                    需要长时间保持姿势不要写 40s 的 dur —— 用造型面板/静态造型，或分段续接。

                    ### 接触型姿势（敬礼 / 扶帽 / 摸脸）
                    惯性会让末端"甩过头"：末段接一个**空段**（`{"dur":0.30}`，无 pose）停住即可贴稳；
                    大臂给一点 `ArmFwd` 20~30° 才够得到额头；要更稳可 `{"preset":"salute","inertia":0.3}`。
                    肘范围：0直/45自然/90手到胸前/120+敬礼（本机可到 145°）。

                    ### 连招（一次回复里的多条 bodyact 会按顺序播）
                    默认每条末尾回自然姿势；想让前一条的结束姿势留给下一条，加 `"chain":true`。
                    例：`<bodyact preset="jump" spec='{"chain":true}'/>` ＋ `<bodyact preset="jump"/>`。
                    预置与 spec 会合并（spec 字段覆盖预置）⇒ 等于"基于预置改一点"。

                    ### 整体转身
                    `"turn": 360`（±720，正=往角色左边；360=原地转一圈，180=背对观众）—— 转的是**整个模型**（含脚）。
                    动作开始时逐渐转过去（180°≈1.1s、360°≈2.2s），结束时沿**最短路径**慢慢回正；
                    整圈（360°）结束等价于原朝向 ⇒ 不会"转一圈再倒着转回来"。
                    大幅转身用 turn；只有骨盆/上身转、脚不动才用 hipsYaw（≤±35°）。

                    ### 手型（fingers）
                    `"fingers":{"l":"fist","r":"spread"}`；手型名：open / relaxed / half / fist / spread / point / thumb_up / victory。
                    逐指：`{"r":{"curl":100,"index":0}}`；拇指另有 `thumbBase/thumbTip`(0~250)、`thumbSide`(±150)、`thumbRoll`(±180)。
                    比心 / OK 这类精细造型别硬凑：先翻「可用动作」列表，没有就请用户摆好后存预设。

                    ### overlay（叠加）
                    `{"overlay":{"base":"wave","add":{...},"amp":1.1,"tempo":0.8}}`：base=打底预设/spec，add=叠加关键帧，
                    amp 幅度、tempo 节奏。同一动作演出不同人格的主力。

                    ## 用法
                    <bodyact spec='{"steps":[{"pose":{...},"dur":0.45,"ease":"out"}, ...]}'/>
                    - pose 只写要改的通道；未写保持上一段；末尾会自动回自然姿势（不用补收尾）。
                    - 顶层可写 `repeat`。也可直接用预置：<bodyact preset="wave"/>。
                    - 预置：wave / nod / shake / bow / hands_up / stretch / shrug / salute / reach_fist /
                            jump / jump_power / jump_joy / jump_x2 / hug。

                    ## 生成式动作 prompt
                    `<bodyact prompt="a person does jumping jacks"/>`：本地生成默认 80 帧@20fps（≈4s），零联网；gen: 词条加 seconds 可生成更长（上限 12s）。
                    词条是**闭集**（见常驻信息「生成式动作词条」，只能照抄；换说法=抽盲盒）。
                    「可用动作」没有、配方也表达不了时可用（站立小反馈最合适）；**不要**用于蹲跪/精细手指。
                    结果不保证精确；不像就如实说明并改 preset，别反复重试同一条。

                    ## 造型类姿势（比心 / 叉腰 / 抱臂 / 耍帅）
                    角度硬凑一定不像。顺序：① 先翻「可用动作」列表，有就直接 `<motion option="精确名字"/>`（一字不差）；
                    ② 没有就请用户去「造型」面板摆好并保存，之后 `<bodyact preset="造型名"/>`；③ 都没有就如实说做不到。

                    ## 使用频率
                    **不是每轮都动**。只有对话本身带情绪/动作意图时才用（打招呼/告别/道谢/被夸/被责备/明显开心难过/
                    说到看、听、来、跳、走、挥手）。普通问答、解释、闲聊、技术讨论一律不要调用。
                    每条回复**最多 1 个动作 + 1 个表情**。

                    ## 对谁反应
                    优先级：主人 > 群友；直接对我说 > 旁观。主人表达情绪 → **必须回应**（表情 + 匹配动作）；
                    群友与我无关的闲聊 → 沉默；@我/评价我 → 反应但低一档；主人跟别人聊且与我无关 → 只给极轻表情，不摆动作。

                    ## 情绪 → 动作
                    | 情绪 | 表情 | 动作 |
                    |---|---|---|
                    | 开心 / 被夸 | happy | nod / hands_up |
                    | 害羞 | shy | 只表情，或小幅 nod（少动更传神） |
                    | 鼓励 | happy | hands_up / wave |
                    | 羡慕 | surprised / shy | 小幅歪头，不要大动作 |
                    | 难过 | sad | 缓慢 nod |
                    | 生气 | angry | shake |
                    | 撒娇 | shy | stretch / nod |
                    | 惊讶 | surprised | 只表情 |
                    | 特别兴奋 | happy | jump（轻）/ jump_power（用力）/ jump_joy（欢呼），别连跳 |
                    强度：轻=只表情；中=表情+小动作；强=表情+明显动作。主人明显情绪至少"中"，群友最多"中"，旁观无。
                    动作只能从真实存在的 preset / 动作列表里选；没有贴切的就只发表情（宁缺勿编）。
                    """,
            };
            functionService.RegisterHandler(embodiedHandler, DocumentMode.Implicit, DestroyCancellationToken);
            AlifeLog.LogInformation($"[3D桌宠] 已注册具身动作工具（bodyact，Implicit｜文档 {embodiedHandler.Document().Length} 字符）");
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
    void BodyActPromptCore(string prompt, double? seconds = null)
    {
        if (!pet.EmbodiedMotionEnabled) throw new Exception("「具身动作」未开启：请先在桌宠设置里打开，再使用 bodyact prompt");
        pet.GenerateMotion(prompt, seconds);
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
                Description = "用「情绪 + 强度 + 保持」驱动角色的真实面部表情与眼嘴（不是文字描述），并可查询真实身体状态。先输出 <BodyExpressHost/> 读取说明，随后用 <bodyexpress .../> / <bodystate/> 调用。",
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
            bool injectDoc = pet.BodyExpressDocEnabled;
            functionService.RegisterHandler(embodiedExprHandler, injectDoc ? DocumentMode.Implicit : DocumentMode.None, DestroyCancellationToken);
            AlifeLog.LogInformation($"[3D桌宠] 已注册具身表情工具（bodyexpress / bodystate，{(injectDoc ? "Implicit" : "文档注入关闭（靠记忆）")}｜文档 {embodiedExprHandler.Document().Length} 字符）");
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
                    + "（幅度/节奏/小动作密度/平滑/静定 + 惯用动作/忌讳/签名动作）。不填参数=读回当前设定；reset=true=清空。"
                    + "先输出 <MotionIdiomHost/> 读取完整说明，随后用 <motionidiom .../> 调用。",
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
            functionService.RegisterHandler(motionIdiomHandler, DocumentMode.Implicit, DestroyCancellationToken);
            AlifeLog.LogInformation($"[3D桌宠] 已注册动作人设工具（motionidiom，Implicit｜文档 {motionIdiomHandler.Document().Length} 字符）");
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
