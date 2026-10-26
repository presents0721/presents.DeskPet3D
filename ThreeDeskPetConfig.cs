using System.ComponentModel;

namespace presents.DeskPet3D;

/// <summary>3D 渲染后端类型（实际模型格式按文件后缀自动判定，这里只是默认设定提示）。</summary>
public enum DeskPetRendererType
{
    /// <summary>VRM 模型（单文件 .vrm，支持表情 blend shape / 动画 / 弹簧骨 / 视线）。</summary>
    VRM,
    /// <summary>PMX 模型 + VMD 动作（用户自备模型与动作配布，支持 IK / 物理 / 打光）。</summary>
    MMD,
}

public record ThreeDeskPetConfig
{
    // ═══ 动作人设（motion idiom）═══
    // **故意放在最前**：它是"这个角色怎么动"的核心，最该被一眼看到；
    // 数据以配置为**唯一来源**（不另存 JSON 文件），AI 写入 / 桌宠面板 / 这里编辑都回到同一份，避免不同步。
    // 由 AI 自己写（性格 + 近期记忆蒸馏），也可以在这里直接改。
    [Description("动作人设·我是谁（≤48 字）：一句话性格，如「傲娇、嘴硬心软、怕被看穿」。"
        + "留空=还没写过 —— 可以让 AI 用 <motionidiom> 按它的性格与记忆自动填写。")]
    public string MotionIdiomPersona { get; set; } = "";

    [Description("动作人设·近况/记忆的影响（≤48 字）：最近的记忆与关系怎样改变了你的表达。"
        + "**记忆优先于人设** —— 同一句性格，处在不同关系里该有不同动作。")]
    public string MotionIdiomState { get; set; } = "";

    [Description("动作人设·惯用动作（≤48 字）：如「爱歪头、常抱臂、高兴时举双手」。")]
    public string MotionIdiomLike { get; set; } = "";

    [Description("动作人设·忌讳（≤48 字）：明确不做的动作，如「不大跳、不撒娇式摆手」。")]
    public string MotionIdiomAvoid { get; set; } = "";

    [Description("动作人设·签名动作（≤48 字）：被夸/打招呼时固定用哪个，如「先楞一下再撇嘴」。")]
    public string MotionIdiomSignature { get; set; } = "";

    [Description("动作人设·幅度 0.3~1.5：小=克制含蓄，大=夸张奔放。1 = 默认手感（不动你原来调的默认值）。")]
    public double MotionIdiomAmp { get; set; } = 1.0;

    [Description("动作人设·节奏 0.5~2：小=慢条斯理，大=干脆利落。1 = 默认。")]
    public double MotionIdiomTempo { get; set; } = 1.0;

    [Description("动作人设·小动作密度 0~3：平时主动做小动作的频率。0=几乎不动，2=默认，3=很活跃。")]
    public double MotionIdiomDensity { get; set; } = 2.0;

    [Description("动作人设·平滑 0~0.3 秒：大=优雅柔和，小=跟手直接。0.08 = 默认。")]
    public double MotionIdiomSmooth { get; set; } = 0.08;

    [Description("动作人设·静定 0~1：大=少跟随少微动（冷、稳），小=活泼好动。0.4 = 默认。")]
    public double MotionIdiomStillness { get; set; } = 0.4;

    [Description("动作人设·自动更新提醒间隔(天)：0=不提醒。到期后会在 AI 的常驻信息里附一句提醒，" +
        "让它按最新记忆自己重写人设（**不额外占用对话回合** —— 它在下次说话时顺手更新）。" +
        "太短=没攒下变化就重写、白费 token；太长=对多变的人设不及时。默认 14 天。")]
    public int MotionIdiomRefreshDays { get; set; } = 14;

    [Browsable(false)]
    [Description("动作人设·最后更新时间（Unix 秒）。自动维护，用于「多久没更新、要不要提醒重写」。")]
    public long MotionIdiomUpdatedUtc { get; set; }

    [Browsable(false)]
    [Description("动作人设·来源：ai / user。自动维护，面板据此提示「还有没有必要让 AI 重写」。")]
    public string MotionIdiomSource { get; set; } = "";

    // ---- 自定义造型（用户摆好存下来的姿势）----
    // 造型类姿势（比心/叉腰/抱臂/耍帅）必须"看着画面调"：作者看不见、AI 也没有三维直觉，
    // 用角度硬凑试过两次都失败（见 embodied-compose.js 注释）。所以改成：用户在桌宠面板里摆好 → 存名 →
    // 之后所有 AI 都能像内置预设一样用它：<bodyact preset="比心"/>。
    // 这里只存数据；编辑入口在桌宠设置面板的「造型」区（配置页不暴露 JSON，免得手写坏掉）。
    [Browsable(false)]
    [Description("自定义造型（JSON：造型名 → { 通道: 度 }）。由桌宠面板的「造型」区自动维护。")]
    public string CustomPoses { get; set; } = "";

    // ═══ 模型与渲染 ═══
    [Description("当前模型文件夹名，位于 Storage/<角色>/ThreeDeskPet/Models/<名称>/。留空则自动用第一个可用模型。")]
    public string ModelName { get; set; } = "";

    [Description("默认渲染后端：VRM 或 MMD(PMX+VMD)。实际加载时按模型文件后缀自动判定（.vrm→VRM，.pmx→MMD）。")]
    public DeskPetRendererType RendererType { get; set; } = DeskPetRendererType.VRM;

    [Description("MMD 是否启用 IK（反向动力学）。VMD 跳舞必须开，否则腿脚等依赖 IK 的部位会错位、动不起来。")]
    public bool EnableIK { get; set; } = true;

    [Description("MMD 是否启用物理（头发/裙子/飘带摆动）。关掉后这些部位会僵硬。")]
    public bool EnablePhysics { get; set; } = true;

    // VRM 侧与 MMD 的 EnablePhysics 是**两套东西**，别混：MMD 走 ammo.js 刚体，VRM 走 three-vrm 弹簧骨。
    // 以前 VRM 没有开关（弹簧骨由 vrm.update(dt) 每帧积分 = 常开），用户要一个能开的开关，故补此项。
    [Description("VRM 是否启用物理（弹簧骨：头发/裙子/胸的摆动）。关掉后它们固定不动。默认开。")]
    public bool VrmPhysics { get; set; } = true;

    [Description("光照强度倍率（环境光+主光），0~3，默认 1。")]
    public double LightingIntensity { get; set; } = 1.0;

    [Description("光照预设：studio=主光+补光+轮廓光；soft=柔和半球光；flat=仅环境光（最平）。")]
    public string LightingPreset { get; set; } = "studio";

    [Description("模型整体缩放倍数，默认 1。")]
    public double ModelScale { get; set; } = 1.0;

    [Description("相机距离（值越大模型越小越靠后），默认 6。")]
    public double CameraDistance { get; set; } = 6.0;

    [Description("相机偏航角(度)：绕模型水平旋转取景，0=正脸，180=背面。替换旧的硬翻转。")]
    public double CameraYaw { get; set; } = 0.0;

    [Description("相机俯仰角(度)：正=从上方俯视（解决躺下看裙底），负=仰视。默认 0。")]
    public double CameraPitch { get; set; } = 0.0;

    [Description("相机高度偏移(世界单位)：整体上移/下移取景，默认 0。")]
    public double CameraHeight { get; set; } = 0.0;

    [Description("氛围光颜色(十六进制，如 #ffffff)，默认白。")]
    public string LightAmbientColor { get; set; } = "#ffffff";

    [Description("氛围光强度，默认 1。")]
    public double LightAmbientIntensity { get; set; } = 1.0;

    [Description("全局主光(关键光)颜色，默认白。")]
    public string LightKeyColor { get; set; } = "#ffffff";

    [Description("全局主光强度，默认 1.1。")]
    public double LightKeyIntensity { get; set; } = 1.1;

    [Description("背景色(十六进制)；留空=透明。设置颜色后窗口显示该底色而非透明。")]
    public string BackgroundColor { get; set; } = "";

    [Description("开机/加载后自动播放的动作名（VRMA/VMD 名），留空不自动播放。")]
    public string BootMotion { get; set; } = "";

    [Description("全屏光标追踪：true 时头部/眼睛跟随整个屏幕的光标（C# 广播全局光标）。")]
    public bool CursorTracking { get; set; } = true;

    [Description("姿势骨骼偏移(JSON)：每个姿势下各骨骼的角度微调，供设置面板实时掰正。")]
    public string PoseOffsets { get; set; } = "";

    [Description("桌宠窗口宽度(CSS 像素)。窗口固定为此大小，宠物在其中按“模型大小”缩放；右侧留一列给设置面板与右键菜单。默认 500。")]
    public int WindowWidth { get; set; } = 500;

    [Description("桌宠窗口高度(CSS 像素)。默认 600。")]
    public int WindowHeight { get; set; } = 600;

    [Description("鼠标穿透：开启后，光标不在宠物/菜单/设置面板上时，鼠标事件穿透到桌面（不挡住图标）；在宠物上时正常交互。默认开。")]
    public bool MouseThrough { get; set; } = true;

    [Description("待机动画：开启后桌宠会自然呼吸、重心轻微摆动、四肢/头部微动，还会偶尔做个小动作，不再梆硬站桩。默认开。")]
    public bool IdleAnimation { get; set; } = true;

    [Description("待机动画强度(0.3~1.8)，越大动作越明显。默认 1。")]
    public double IdleIntensity { get; set; } = 1.0;

    [Description("待机动画速度(0.5~2)，越大摆动越快。默认 1。")]
    public double IdleSpeed { get; set; } = 1.0;

    [Description("待机小动作频率：0=关，1=低，2=中，3=高。默认 2（约每 10~20 秒来一次挥手/点头/跳一下等）。")]
    public int IdleGesture { get; set; } = 2;

    [Description("待机动作间隔(秒)：两支待机动作之间的停顿；0=无缝连播，越大越“一顿一顿”。默认 1.5。")]
    public double IdleGap { get; set; } = 1.5;

    [Description("自动眨眼：开启后随机间隔眨眼。默认开。")]
    public bool Blink { get; set; } = true;

    [Description("头部/眼部追踪强度(0~1.5)：光标移动时头与眼跟随的程度，0=不跟随。默认 1。")]
    public double HeadTrackStrength { get; set; } = 1.0;

    [Description("脊椎追踪强度(0~1.5)：光标移动时上半身跟随扭转的程度。默认 1。")]
    public double SpineTrackStrength { get; set; } = 1.0;

    // ---- 光照：3 组氛围光(环境光) + 全局灯光(关键光)，各自 强度/饱和度/颜色 ----
    [Description("启用氛围光(环境光)：外部打光的基础层，关掉后只剩全局灯光。默认开。")]
    public bool EnableAmbientLight { get; set; } = true;

    [Description("氛围光1(主环境光)饱和度，0=灰白 1=原色。默认 1。")]
    public double LightAmbientSaturation { get; set; } = 1.0;

    [Description("氛围光2(半球光)颜色(十六进制)，默认淡蓝。")]
    public string LightAmbient2Color { get; set; } = "#dfe6ff";

    [Description("氛围光2(半球光)强度，默认 0.7。")]
    public double LightAmbient2Intensity { get; set; } = 0.7;

    [Description("氛围光2饱和度，默认 1。")]
    public double LightAmbient2Saturation { get; set; } = 1.0;

    [Description("氛围光3(冷色补光)颜色(十六进制)，默认蓝紫。")]
    public string LightAmbient3Color { get; set; } = "#aab4ff";

    [Description("氛围光3(冷色补光)强度，默认 0.35。")]
    public double LightAmbient3Intensity { get; set; } = 0.35;

    [Description("氛围光3饱和度，默认 1。")]
    public double LightAmbient3Saturation { get; set; } = 1.0;

    [Description("启用全局灯光(关键光)：主要打向角色的方向光，关掉后只有氛围光。默认开。")]
    public bool EnableKeyLight { get; set; } = true;

    [Description("全局灯光(关键光)饱和度，默认 1。")]
    public double LightKeySaturation { get; set; } = 1.0;

    // ---- 动作 / 舞蹈 ----
    // 这些运行时项在桌宠自己的设置面板里有更完善的控件（滑块/下拉），就不在系统配置里重复出现了，
    // 但仍随配置持久化（[Browsable(false)] 只隐藏字段、不影响读写）。
    [Browsable(false)]
    [Description("动作默认持续秒数：播放动作时若未单独指定时长则用此值；0=不自动停(由动作本身循环)。默认 0。")]
    public double MotionDuration { get; set; } = 0.0;

    [Browsable(false)]
    [Description("动作过渡(交叉淡入淡出)秒数：切换动作时的平滑时间。默认 0.3。")]
    public double MotionTransition { get; set; } = 0.3;

    // 点播（桌宠面板/右键点一支动作）的循环开关。默认 false = **播完一次就停**。
    // 为什么要有它：老行为是"帧动画无限循环 + 「动作持续」默认 0 = 永不停止" ⇒
    //   用户点一支动作就永远重复同一支（实测："跳完一个，还会继续重复动作，一直跳"）。
    // 语义边界：只影响**手动点播**；AI 走 bridge 的 'motion' 消息，那边始终是"自然播放一次"。
    [Browsable(false)]
    [Description("点播动作是否重复播放：false=播完一次就停(默认)，true=一直循环。对应桌宠「动作」面板里的「重复播放」开关。")]
    public bool MotionLoop { get; set; } = false;

    // ★★ 骨架/轴向存档（JSON 字符串，按模型分键）：
    //   存「微调轴向·手臂/腿」「手指方向·四指/拇指」这些**每模型**的设置 + 面板数值/上次发出的 spec。
    //   为什么必须放**宿主配置**而不是前端的 localStorage：实测"重载插件后全部重置"（本插件的 webview
    //   在插件重载后会换存储目录）⇒ 只有宿主侧配置才是跨重载可靠的（造型 CustomPoses 就是同一套路）。
    [Browsable(false)]
    [Description("骨架轴向/手指方向/造型面板数值的按模型存档（JSON，前端自动维护，一般不用手改）。")]
    public string RigProfile { get; set; } = "";

    // ★★ 生成式动作的"手感参数"（JSON：骨盆/下肢/脊柱/根位移/平滑/收尾淡出）：
    //   以前只在内存里 ⇒ 重开窗口全回默认（用户实测："重开窗口全回默认"）。它**不分模型**（是审美偏好），
    //   所以直接存一个 JSON 字符串（不分键），与 RigProfile 同一套持久化管道。
    [Browsable(false)]
    [Description("生成式动作手感参数（JSON：hips/leg/spine/neck/root/smooth/fadeOut；前端自动维护）。")]
    public string ArdyTune { get; set; } = "";

    [Browsable(false)]
    [Description("自动跳舞：开启后桌宠会按“跳舞时长/过渡”自动轮流播放动作。默认关。")]
    public bool AutoDance { get; set; } = false;

    [Browsable(false)]
    [Description("跳舞风格：0=随机，1=顺序。默认 0（随机）。")]
    public int DanceStyle { get; set; } = 0;

    [Browsable(false)]
    [Description("每段舞蹈持续秒数(自动跳舞用)。默认 14。")]
    public double DanceDuration { get; set; } = 14.0;

    [Browsable(false)]
    [Description("舞蹈之间过渡(交叉淡入淡出)秒数。默认 1.2。")]
    public double DanceTransition { get; set; } = 1.2;

    // ---- 互动触发（是否让交互去唤起 AI 回复；关掉只做动作、不消耗 token） ----
    [Description("「戳一下」(点击角色身体)是否触发 AI 回复。关掉后戳它只会有动作反应，不再消耗 token。默认关（避免误触烧钱）。")]
    public bool PokeTriggersAi { get; set; } = false;

    [Description("右键菜单「打个招呼」是否触发 AI 回复。关掉后只挥手、不回复。默认开。")]
    public bool GreetTriggersAi { get; set; } = true;

    [Description("「被摸到」是否触发 AI 回复：鼠标在角色身上缓慢划动（头 / 头发 / 脸 / 手 / 手臂 / 腿 / 裙摆…**任意部位**都算），"
        + "以及右键菜单「摸摸它」。关掉后只做动作反馈（bounce / shy）、不回复、不消耗 token。默认开。"
        + "（说明：本项原先叫「摸摸头」，因为当时只能摸头；现在任意部位都会走到这个开关，故改名。）")]
    public bool PatTriggersAi { get; set; } = true;

    [Description("互动触发回复的冷却秒数：0=不冷却。冷却期内重复互动会被忽略，防止误触连续消耗 token。默认 0。")]
    public double InteractionCooldown { get; set; } = 0.0;

    [Description("底部留白：脚底离窗口底边的距离（按可视高度的比例）。原来最低点正好贴底边会把脚裁掉，调大即可让脚完整露出。默认 0.07。")]
    public double BottomMargin { get; set; } = 0.07;

    [Browsable(false)]
    [Description("跳舞/播放动作时自动叠加的表情名（填模型自带的表情，如 Joy、Fun、害羞）。留空=不自动叠加。若动作文件本身带表情轨道，则以动作自带的为准。")]
    public string DanceExpression { get; set; } = "";

    [Browsable(false)]
    [Description("舞蹈时关闭头部/脊椎追踪：开启后，桌宠在播放动作(跳舞)期间暂停跟随光标，避免头/上半身被追踪拉扯、与舞蹈动作打架；动作结束自动恢复追踪。默认开。")]
    public bool TrackOffDuringDance { get; set; } = true;

    [Browsable(false)]
    [Description("具身动作（实验，默认关）：开启后角色才会用 AI 实时生成动作驱动身体（每轮可能消耗 token）；" +
        "关闭时就是普通桌宠，VMD/VRMA 舞蹈与手势照旧、零额外 token。需自备生成模型与 WebGPU。")]
    public bool EmbodiedMotion { get; set; } = false;

    [Browsable(false)]
    [Description("具身表情（实验，默认关）：开启后角色才会用 AI 控制情绪与眼嘴（每轮可能消耗 token）；" +
        "关闭时只用你自己的静止/随机表情，零额外 token。表情走 VRM 自带表情权重，**不吃模型、不吃显存**。")]
    public bool EmbodiedExpression { get; set; } = false;

    [Browsable(false)]
    [Description("情绪→表情映射（一次设置、永久有效）：把情绪指到模型自己的某张脸，格式 \"happy=星星眼;angry=怒り\"。" +
        "留空=按候选表自动挑。之所以需要它：表情名只能靠猜语义，很多模型的 happy/joy 是闭眼笑，用户想要的脸可能是另一张。")]
    public string EmbodiedFaceMap { get; set; } = "";

    [Browsable(false)]
    [Description("具身动作输出平滑（秒，0~0.3）：写入骨骼前向目标按此时间常数靠拢，抑制源数据抖动；" +
        "越小越跟手、越大越平滑（也越滞后），0=关闭平滑。默认 0.05。")]
    public double EmbodiedSmooth { get; set; } = 0.05;

    [Browsable(false)]
    [Description("隐藏的模型部件名（分号分隔）：模型由多个 Mesh/材质分组拼成，把容易穿模变形的部件（裙摆、长发、配饰等）" +
        "在这里排除即可不渲染，改善跳舞观感并减轻计算。在右键菜单「设置 → 模型部件」里逐个开关，无需手填。")]
    public string HiddenModelParts { get; set; } = "";

    [Browsable(false)]
    [Description("PMX 手臂收拢角度(度，-60~60)：MMD 模型标准静止姿势是 A-pose(双臂张开)，把胳膊往身体收就调大这个值。" +
        "不同模型的骨骼轴向不统一，正负方向可能相反 —— 往哪边转得对就用哪个符号。0=保持模型原样。仅对 PMX(MMD) 生效。")]
    public double PmxArmDropDeg { get; set; } = 0.0;

    [Description("静止/待机时的基础表情（让桌宠平时就有表情，而不是面无表情）。填模型自带表情名，如 happy、relaxed、Joy。留空=无（仅眨眼）。")]
    public string BaseExpression { get; set; } = "";

    [Description("基础表情强度(0~1)。默认 0.6。")]
    public double BaseExpressionWeight { get; set; } = 0.6;

    [Description("额外动作目录（分号或换行分隔）：递归扫描其中的 .vrma/.vmd/.vrm，与模型 motions 文件夹合并进跳舞轮播。" +
        "用于把 E:\\VRMA 这类动作库直接纳入，无需把文件拷进模型目录。例：E:\\VRMA 或 E:\\VRMA;F:\\舞蹈")]
    public string ExtraMotionPaths { get; set; } = "";

    // ★ v11.49（用户：动作库里同一支舞常同时放 .vmd 和 .vrma 两份，全列出来 200+ 个，吃 AI 的 token）
    [Description("★只加载**与当前模型配套**的动作格式（默认开）。VRM 模型只能播 .vrma、PMX/MMD 模型只能播 .vmd，" +
        "而动作库里同一支舞常常两个格式各存一份 ⇒ 关掉会把两百多个名字全塞给 AI（一半点了也播不了）。开着只留能播的那份。")]
    public bool MotionMatchModelType { get; set; } = true;

    [Description("给 AI 的动作清单**最多列多少个**（0=不限制，默认 0）。动作特别多时可设 40~80，明显省 token；" +
        "超出部分仍在右键菜单里可用，只是不出现在 AI 的选项里。")]
    public int MotionListLimit { get; set; } = 0;

    [Description("额外模型目录（分号或换行分隔）：递归扫描其中的 .vrm/.pmx，与 Storage/<角色>/ThreeDeskPet/Models 一起列进右键“模型”子菜单，" +
        "点一下直接切换、无需再递归选文件夹。用于把 E:\\VRM模型 这类模型库直接纳入。用“加载模型…”选一次文件夹后会自动记到这里。" +
        "例：E:\\VRM模型 或 E:\\VRM模型;F:\\PMX")]
    public string ExtraModelPaths { get; set; } = "";

    [Description("画质（控制渲染像素比，省 GPU 显存与算力）：low=低(上限1.25)，med=中(上限1.5)，high=高(原生，默认)。高分屏上选低/中可明显降负载，且不再糊到没法看。")]
    public string Quality { get; set; } = "high";
}
