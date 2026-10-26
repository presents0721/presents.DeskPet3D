using System;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.Threading;
using System.Threading.Tasks;
using System.Text.Json;
using Alife.Client;
using Alife.Framework;
using Alife.Foundation;

namespace presents.DeskPet3D;

/// <summary>按角色隔离的存储键前缀，值为角色的 StorageKey（如 "Character\Mao"）。</summary>
public record PetStorageKey(string Value);

/// <summary>
/// 3D 桌宠窗口封装：创建透明置顶窗口、定位/移动/缩放、DPI 与脚本执行，
/// 并通过 StorageSystem 持久化/恢复窗口位置大小（按角色隔离）。
/// 网页资源位于插件 Resources/ThreeDeskPet/。
/// Alife 5：窗口由宿主 IAlifeApplication 创建（WebView2），不再有 Electron.NET；
/// 主进程⇄页面走 window.alifeWindow 桥（见 <see cref="OnMessage"/>）。
/// </summary>
public sealed class PetWindow(IAlifeApplication alifeApplication, StorageSystem storage, PetStorageKey storageKey) : IAsyncDisposable
{
    public event Action? MouseMoved;
    /// <summary>页面经 window.alifeWindow.postMessage 上报的消息（type + 原始 JSON 根节点）。</summary>
    public event Action<string, JsonElement>? OnMessage;

    public double Dpi => dpi;
    public Rectangle Bounds => bounds;
    /// <summary>任务栏顶在屏幕 CSS 像素中的 Y 坐标（工作区底部）。</summary>
    public int TaskbarTop => workArea.Y + workArea.Height;
    /// <summary>是否把全局光标位置广播给前端（全屏头部追踪）。由 ThreeDeskPet 按配置开关。</summary>
    public bool BroadcastCursor { get; set; } = false;
    public Point Position => position;
    public Point CursorScreenPoint => cursorScreenPoint;

    /// <summary>该桌宠实例独有的 IPC 频道名，避免多开时各桌宠消息互相串扰。</summary>
    public string ChannelId { get; } = "pet-" + Guid.NewGuid().ToString("N");

    /// <summary>窗口宽度（CSS 像素，固定），留够空间给宠物 + 右键菜单 + 设置面板。</summary>
    public int WindowWidth { get; set; } = 420;
    /// <summary>窗口高度（CSS 像素，固定）。</summary>
    public int WindowHeight { get; set; } = 600;
    /// <summary>鼠标穿透：光标不在宠物/菜单/面板上时让事件穿透到桌面，不再挡住图标。由配置开关。</summary>
    public bool MouseThrough { get; set; } = true;

    public void ResetBounds()
    {
        SetBounds(defaultBounds);
        ignoreState = null;   // 位置变了，重新判定穿透
    }

    /// <summary>
    /// 落座：dock=true 时把宠物接触线（臀部/脚）落到任务栏顶，腿自然垂在任务栏上；
    /// dock=false 时恢复落座前的位置。窗口大小固定，不再随宠物包围盒收缩
    /// （旧逻辑会把窗口缩到 80px 指甲盖大小，这就是"超级小一个"的根因）。
    /// </summary>
    public void PlaceDock(bool dock, double contactY)
    {
        pendingDock = dock;
        pendingContactY = contactY;
        if (dragging) return;   // 拖动中不抢用户对位置的控制权，松手后再补对齐
        ApplyDock();
    }

    /// <summary>拖动状态：拖动期间不做落座位移，结束后补一次。</summary>
    public void SetDragging(bool value)
    {
        if (dragging == value) return;
        dragging = value;
        if (!value && pendingDock) ApplyDock();
        ignoreState = null;
    }

    void ApplyDock()
    {
        try
        {
            if (pendingDock)
            {
                int taskbarTop = TaskbarTop;
                // 只有窗口本来就贴近任务栏时才吸附落座：否则在桌面中间选"坐"，整窗会被瞬间拽到任务栏，
                // 屏幕下方的窗口被任务栏遮住、只露出一条缝 → 看起来"像被埋在地里、只露头顶"。
                // 拖到任务栏附近再落座（或本来就贴在任务栏上）才吸附。
                bool nearTaskbar = (bounds.Y + WindowHeight) >= taskbarTop - 40;
                if (!nearTaskbar)
                {
                    if (docked) { docked = false; SetBounds(new Rectangle { X = bounds.X, Y = dockedSavedY, Width = WindowWidth, Height = WindowHeight }); }
                    return;
                }
                if (!docked) { dockedSavedY = bounds.Y; docked = true; }
                // 接触线守卫：前端上报异常（NaN/0/越界）时兜底为“窗口底边”，
                // 否则 ny 会算出平台外的 Y，窗口被甩到屏幕顶部 → 表现为"只剩个头顶/整只不见了"。
                double cy = pendingContactY;
                if (double.IsNaN(cy) || double.IsInfinity(cy) || cy <= 0) cy = WindowHeight;
                cy = Math.Max(WindowHeight * 0.1, Math.Min(WindowHeight * 1.5, cy));
                int ny = (int)Math.Round(taskbarTop - cy);
                // 前端待机慢摆会让 pet_bounds 一直在微动，这里位置没变就不碰窗口，避免每帧 SetBounds。
                if (ny != bounds.Y)
                    SetBounds(new Rectangle { X = bounds.X, Y = ny, Width = WindowWidth, Height = WindowHeight });
            }
            else if (docked)
            {
                docked = false;
                SetBounds(new Rectangle { X = bounds.X, Y = dockedSavedY, Width = WindowWidth, Height = WindowHeight });
            }
        }
        catch (Exception e) { AlifeLog.LogWarning("宠物落座失败: " + e.Message); }
    }

    /// <summary>前端上报宠物在窗口内的可见矩形（窗口内 CSS 像素），供鼠标穿透判定（遮罩未就绪时的兜底）。</summary>
    public void SetBodyRect(double x, double y, double w, double h)
    {
        lock (interactiveLock)
        {
            bodyRect = (w > 0 && h > 0)
                ? new Rectangle { X = (int)Math.Round(x), Y = (int)Math.Round(y), Width = (int)Math.Round(w), Height = (int)Math.Round(h) }
                : null;
        }
        ignoreState = null;
    }

    /// <summary>前端上报模型本体像素级命中遮罩（降采样网格，每格 cell CSS 像素，实体位=1，LSB-first 打包）。</summary>
    public void SetBodyMask(int cols, int rows, int cell, byte[] bits)
    {
        lock (interactiveLock)
        {
            maskCols = cols; maskRows = rows; maskCell = cell;
            bodyMask = bits; hasMask = cols > 0 && rows > 0 && bits != null;
        }
        ignoreState = null;
    }

    /// <summary>光标(窗口内 CSS 像素)是否落在模型本体遮罩上。</summary>
    bool MaskHit(double cx, double cy)
    {
        byte[]? mask = bodyMask;
        if (!hasMask || mask == null) return false;
        int col = (int)(cx / maskCell);
        int row = (int)(cy / maskCell);
        if (col < 0 || row < 0 || col >= maskCols || row >= maskRows) return false;
        int idx = row * maskCols + col;
        int byteIdx = idx >> 3, bit = idx & 7;
        return (mask[byteIdx] & (1 << bit)) != 0;
    }

    /// <summary>前端上报当前展开的 UI 面板矩形（窗口内 CSS 像素），供鼠标穿透判定。</summary>
    public void SetUiRects(List<Rectangle> rects)
    {
        lock (interactiveLock) { uiRects = rects ?? new List<Rectangle>(); }
        ignoreState = null;
    }

    /// <summary>前端即时上报"光标是否在面板/菜单上"：在 UI 上立即关闭穿透，避免 mousedown/mouseup 之间被穿透吞掉点击。</summary>
    public void SetUiHover(bool over)
    {
        uiHover = over;
        if (over) SetIgnore(false);   // 立即放行点击
        else ignoreState = null;      // 交回常规判定（下次轮询按矩形/遮罩重算）
    }

    IAlifeWindow? window;
    PetStaticServer? staticServer;   // 本地静态服务（http://127.0.0.1:PORT）：生成式动作需要 fetch/Worker/WebGPU
    double dpi = 1;
    Rectangle bounds;
    Rectangle workArea;              // 主屏工作区（屏幕坐标，CSS/逻辑像素）
    Rectangle savedBounds;           // 正常（非落座）时的位置，用于"取消落座"恢复
    Point position;
    Point cursorScreenPoint;         // 屏幕坐标，CSS/逻辑像素（已按 dpi 换算）
    CancellationTokenSource? cancellationTokenSource;
    PetBridge? bridge;               // 缓存 IPC 桥，供 Loop 广播全局光标
    int regionFailures;              // 穿透区域下发连续失败次数（连续失败拉回整窗可交互）
    DateTime lastCursorWarn = DateTime.MinValue;   // 光标读取失败日志节流（轮询每 30ms，不能刷屏）
    readonly object boundsSync = new();
    bool boundsFlushRunning;
    bool hasPendingBounds;
    Rectangle pendingBounds;

    // 鼠标穿透状态：仅在宠物/UI 上不穿透，其余空白穿透给桌面（对标 MateEngine）。
    readonly object interactiveLock = new();
    Rectangle? bodyRect;
    List<Rectangle> uiRects = new();
    bool uiHover;   // 前端即时上报：光标在面板/菜单上（优先于矩形判定，避免点击被穿透吞掉）
    // 像素级命中遮罩：前端把"模型本体轮廓"降采样成网格(每格 cell CSS 像素，实体=1)发来，
    // 替换原来的包围盒矩形 —— 只有模型身体可点/可拖，四周空白与透明四角都穿透桌面。
    byte[]? bodyMask;
    int maskCols, maskRows, maskCell;
    bool hasMask;
    bool? ignoreState;           // 当前下发给窗口的穿透状态，null=未知
    bool docked;                 // 是否处于落座态
    int dockedSavedY;            // 落座前的窗口 Y，用于取消落座恢复
    DateTime dragHoldUntil;      // 在此之前强制不穿透（拖动等连续交互）
    bool dragging;               // 用户正在拖动宠物（拖动期间不做落座位移）
    bool pendingDock;            // 最近一次落座请求
    double pendingContactY;      // 最近一次接触线

    // 换了键名：旧版本把窗口默认放到了屏幕外，且会把窗口收缩到宠物大小（指甲盖），
    // 那份已保存的尺寸会一直被读回来，所以用新键丢弃旧值，并且只恢复 X/Y、尺寸一律用配置值。
    readonly string windowBoundsKey = $"{storageKey.Value}/ThreeDeskPet/WindowBounds3";
    Rectangle defaultBounds;

    public async Task CreateAsync(string wwwRoot, PetBridge bridge)
    {
        this.bridge = bridge;
        if (!OperatingSystem.IsWindows())
            throw new NotSupportedException("不支持的平台。");

        // 宿主统一用逻辑(CSS)像素：物理像素 / DPI。屏幕尺寸先取物理像素，再换算成工作区。
        dpi = alifeApplication.GetDpiScale();
        if (dpi <= 0) dpi = 1;
        workArea = GetWorkArea(dpi);

        defaultBounds = new Rectangle {
            X = workArea.X + workArea.Width - WindowWidth - 60,
            // 整窗完整落在屏幕内并底部对齐工作区（脚踩任务栏），不再伸出屏幕底部
            Y = workArea.Y + workArea.Height - WindowHeight,
            Width = WindowWidth,
            Height = WindowHeight,
        };

        // 只恢复已保存的位置（X/Y）；尺寸一律用配置值，避免读回旧版本收缩后的指甲盖尺寸。
        Rectangle? restored = storage.GetObject<Rectangle>(windowBoundsKey);
        bounds = restored is Rectangle rr && rr.Width > 0 && rr.Height > 0
            ? new Rectangle { X = rr.X, Y = rr.Y, Width = WindowWidth, Height = WindowHeight }
            : new Rectangle { X = defaultBounds.X, Y = defaultBounds.Y, Width = WindowWidth, Height = WindowHeight };
        bounds.Width = WindowWidth;
        bounds.Height = WindowHeight;
        savedBounds = new Rectangle { X = bounds.X, Y = bounds.Y, Width = bounds.Width, Height = bounds.Height };
        Rectangle wa = workArea;
        const int MinVisible = 60;
        if (bounds.X + bounds.Width <= wa.X) bounds.X = wa.X;
        if (bounds.X >= wa.X + wa.Width) bounds.X = wa.X + wa.Width - MinVisible;
        if (bounds.Y + bounds.Height <= wa.Y) bounds.Y = wa.Y;
        if (bounds.Y >= wa.Y + wa.Height) bounds.Y = wa.Y + wa.Height - MinVisible;
        position = new Point {
            X = bounds.X + bounds.Width / 2,
            Y = bounds.Y + bounds.Height / 2,
        };
        cursorScreenPoint = GetCursorPosition();

        TaskCompletionSource initTcs = new(TaskCreationOptions.RunContinuationsAsynchronously);
        void OnInit(string type, JsonElement _)
        {
            if (type == "init")
            {
                bridge.OnMessage -= OnInit;
                initTcs.TrySetResult();
            }
        }
        bridge.OnMessage += OnInit;
        try
        {
            // 优先走本地静态服务：生成式动作(ardy-mini)的运行时要用 fetch 读权重、加载 ORT 的 wasm 与 Web Worker，
            // 这些在 file:// 下都被 Chromium 挡（fetch 被拦 + Worker 必须同源）。失败则回退 file://，保证桌宠照常显示。
            string url;
            try
            {
                staticServer = new PetStaticServer(
                    ("/", wwwRoot),
                    ("/ardy/", Path.Combine(AlifePath.StorageFolderPath, "ThreeDeskPet", "Ardy")));
                url = $"http://127.0.0.1:{staticServer.Port}/index.html?petChannel={ChannelId}";
                AlifeLog.LogInformation($"[3D桌宠] 本地静态服务已启动：http://127.0.0.1:{staticServer.Port}/");
                _ = Task.Run(() => CleanStaleArdyCaches(staticServer.Port));   // 顺手回收历史随机端口留下的权重缓存副本
            }
            catch (Exception serveEx)
            {
                AlifeLog.LogWarning("[3D桌宠] 本地静态服务启动失败，回退 file://：" + serveEx.Message);
                try { staticServer?.Dispose(); } catch { }
                staticServer = null;
                url = $"{new Uri(Path.Combine(wwwRoot, "index.html")).AbsoluteUri}?petChannel={ChannelId}";
            }
            window = await alifeApplication.CreateWindowAsync(new AlifeWindowOptions {
                Title = "3D 桌宠",
                Bounds = bounds,
                TopMost = true,
                Transparent = true,
                Resizable = false,
                Url = url,
            });
            // 页面→宿主：window.alifeWindow.postMessage(obj) 统一从这里进来
            window.MessageReceived += OnIpcMessage;
            window.BoundsChanged += OnBoundsChanged;

            // 唤醒并等待页面加载完成（Launch 之后页面才开始跑 pet.js，init 可能早于本方法的后续代码）
            await window.Launch();

            using CancellationTokenSource initTimeout = new(TimeSpan.FromSeconds(30));
            await initTcs.Task.WaitAsync(initTimeout.Token);
        }
        finally
        {
            bridge.OnMessage -= OnInit;
        }

        // 通知前端任务栏位置（屏幕 CSS 像素），用于"坐到任务栏"判定
        try { bridge.SendMessage("env", new { taskbarTop = TaskbarTop }); }
        catch (Exception e) { AlifeLog.LogWarning("下发 env 失败: " + e.Message); }

        cancellationTokenSource = new CancellationTokenSource();
        Loop(cancellationTokenSource.Token);
    }

    /// <summary>
    /// 主屏工作区（CSS/逻辑像素）。Alife 5 宿主只给"物理屏幕尺寸 + DPI"，
    /// 任务栏高度借系统 API 兜底：WinForms 的返回值单位随进程 DPI 感知变化，
    /// 这里用"与物理/逻辑尺寸哪个更接近"自动判断后统一换算成逻辑像素。
    /// </summary>
    Rectangle GetWorkArea(double scale)
    {
        Size physical = alifeApplication.GetScreenSize();
        Size logical = new(
            Math.Max(1, (int)Math.Round(physical.Width / scale)),
            Math.Max(1, (int)Math.Round(physical.Height / scale)));
        try
        {
            System.Windows.Forms.Screen? screen = System.Windows.Forms.Screen.PrimaryScreen;
            Rectangle sysBounds = screen?.Bounds ?? new Rectangle(0, 0, physical.Width, physical.Height);
            Rectangle sysWork = screen?.WorkingArea ?? sysBounds;
            double k = Math.Abs(sysBounds.Width - physical.Width) <= Math.Abs(sysBounds.Width - logical.Width) ? scale : 1;
            return new Rectangle(
                (int)Math.Round(sysWork.X / k),
                (int)Math.Round(sysWork.Y / k),
                (int)Math.Round(sysWork.Width / k),
                (int)Math.Round(sysWork.Height / k));
        }
        catch (Exception e)
        {
            AlifeLog.LogWarning("[3D桌宠] 获取主屏工作区失败，按整屏兜底：" + e.Message);
            return new Rectangle(0, 0, logical.Width, logical.Height);
        }
    }

    /// <summary>把窗口挪到指定位置/大小（逻辑像素）。宿主 API 是异步的，这里做了乐观更新：
    /// 本地 bounds 立即生效，后续落座/拖动逻辑拿到的都是新值，不必等 BoundsChanged 回包。
    /// 拖动时前端会连发 drag_move，这里合并成"最后一次为准"，避免异步调用排队导致窗口跟不上鼠标。</summary>
    public void SetBounds(Rectangle newBounds)
    {
        bounds = new Rectangle { X = newBounds.X, Y = newBounds.Y, Width = newBounds.Width, Height = newBounds.Height };
        position = new Point {
            X = bounds.X + bounds.Width / 2,
            Y = bounds.Y + bounds.Height / 2,
        };
        ignoreState = null;
        IAlifeWindow? w = window;
        if (w == null) return;
        lock (boundsSync)
        {
            pendingBounds = bounds;
            hasPendingBounds = true;
            if (boundsFlushRunning) return;
            boundsFlushRunning = true;
        }
        _ = FlushBoundsAsync(w);
    }

    async Task FlushBoundsAsync(IAlifeWindow w)
    {
        try
        {
            while (true)
            {
                Rectangle next;
                lock (boundsSync)
                {
                    if (!hasPendingBounds) { boundsFlushRunning = false; return; }
                    next = pendingBounds;
                    hasPendingBounds = false;
                }
                await w.SetBoundsAsync(next);
            }
        }
        catch (Exception e)
        {
            lock (boundsSync) { boundsFlushRunning = false; hasPendingBounds = false; }
            AlifeLog.LogWarning("移动桌宠窗口失败: " + e.Message);
        }
    }

    /// <summary>置顶开关（右键菜单"总在最前"）。</summary>
    public void SetTopMost(bool topMost)
    {
        IAlifeWindow? w = window;
        if (w != null) Forget(w.SetTopMostAsync(topMost), "设置桌宠置顶");
    }

    public void HideWindow()
    {
        IAlifeWindow? w = window;
        if (w != null) Forget(w.HideAsync(), "隐藏桌宠窗口");
    }

    public void ShowWindow()
    {
        IAlifeWindow? w = window;
        if (w != null) Forget(w.ShowAsync(), "显示桌宠窗口");
    }

    /// <summary>把一条 JSON 消息发给页面（window.alifeWindow.onMessage 收到）。</summary>
    public void PostMessage(string json)
    {
        IAlifeWindow? w = window;
        if (w != null) Forget(w.PostMessageAsync(json), "发送桌宠消息");
    }

    public async Task<string?> ExecuteJavaScriptAsync(string script)
    {
        IAlifeWindow? w = window;
        if (w == null) return null;
        try { return await w.ExecuteScriptAsync(script); }
        catch (Exception e) { AlifeLog.LogWarning("执行桌宠脚本失败: " + e.Message); return null; }
    }

    void Forget(Task task, string what)
    {
        _ = task.ContinueWith(
            t => AlifeLog.LogWarning(what + "失败: " + (t.Exception?.GetBaseException().Message ?? "?")),
            CancellationToken.None, TaskContinuationOptions.OnlyOnFaulted, TaskScheduler.Default);
    }

    /// <summary>宿主窗口消息 → type + JSON 根节点（解析失败只记日志）。</summary>
    void OnIpcMessage(object? payload)
    {
        try
        {
            string? json = payload switch {
                string s => s,
                JsonElement el => el.GetRawText(),
                _ => payload?.ToString(),
            };
            if (string.IsNullOrWhiteSpace(json)) return;

            using JsonDocument doc = JsonDocument.Parse(json);
            JsonElement root = doc.RootElement.Clone();
            if (root.ValueKind != JsonValueKind.Object) return;
            if (root.TryGetProperty("type", out JsonElement typeProp) == false) return;
            string? type = typeProp.ValueKind == JsonValueKind.String ? typeProp.GetString() : null;
            if (type == null) return;

            try { OnMessage?.Invoke(type, root); }
            catch (Exception e) { AlifeLog.LogWarning("执行桌宠前端消息回调失败: " + e.Message); }
        }
        catch (Exception e) { AlifeLog.LogWarning("解析桌宠前端消息失败: " + e.Message); }
    }

    /// <summary>全局光标（屏幕坐标，已换算成逻辑/CSS 像素）。</summary>
    Point GetCursorPosition()
    {
        try
        {
            double scale = alifeApplication.GetDpiScale();   // 缩放可能被系统改（换显示器/改缩放），跟随刷新
            if (scale > 0) dpi = scale;
            Point p = alifeApplication.GetCursorPosition();
            p.X = (int)Math.Round(p.X / dpi);
            p.Y = (int)Math.Round(p.Y / dpi);
            return p;
        }
        catch (Exception e)
        {
            if (DateTime.UtcNow - lastCursorWarn > TimeSpan.FromSeconds(10))
            {
                lastCursorWarn = DateTime.UtcNow;
                AlifeLog.LogWarning("[3D桌宠] 获取光标位置失败: " + e.Message);
            }
            return cursorScreenPoint;
        }
    }

    /// <summary>
    /// 极小的本地静态 HTTP 服务：只绑 127.0.0.1、随机端口、只读。
    /// 为什么要它：生成式动作(ardy-mini)的运行时用 fetch() 读权重、加载 ORT 的 wasm 与 Web Worker，
    /// 这些在 file:// 下全被 Chromium 拦（且 Worker 必须与页面同源）。走 http://127.0.0.1 后
    /// 同源 + 安全上下文(WebGPU 要求) + Range 请求全部正常。
    /// 用 TcpListener 手写 HTTP/1.1，避免 HttpListener 需要 URL ACL / 管理员权限的坑。
    /// </summary>
    sealed class PetStaticServer : IDisposable
    {
        readonly System.Net.Sockets.TcpListener listener;
        readonly System.Threading.CancellationTokenSource cts = new();
        readonly System.Collections.Generic.List<(string prefix, string root)> mappings = new();
        public int Port { get; }

        static readonly System.Collections.Generic.Dictionary<string, string> Mime =
            new(System.StringComparer.OrdinalIgnoreCase)
            {
                [".html"] = "text/html; charset=utf-8",
                [".js"] = "text/javascript; charset=utf-8",
                [".mjs"] = "text/javascript; charset=utf-8",
                [".css"] = "text/css; charset=utf-8",
                [".json"] = "application/json; charset=utf-8",
                [".wasm"] = "application/wasm",
                [".png"] = "image/png",
                [".jpg"] = "image/jpeg",
                [".jpeg"] = "image/jpeg",
                [".webp"] = "image/webp",
                [".gif"] = "image/gif",
                [".svg"] = "image/svg+xml",
                [".txt"] = "text/plain; charset=utf-8",
                [".md"] = "text/plain; charset=utf-8",
            };

        /// <summary>稳定端口基准：ardy 权重缓存要求 origin 跨启动稳定。</summary>
        const int StablePortBase = 45871;
        /// <summary>稳定端口顺延区间：基准被占用时同区间顺延（origin 数量有界），避免每次换 origin。</summary>
        const int StablePortSpan = 32;

        public PetStaticServer(params (string prefix, string root)[] map)
        {
            foreach (var m in map)
            {
                string p = m.prefix.StartsWith('/') ? m.prefix : "/" + m.prefix;
                if (!p.EndsWith('/')) p += "/";
                mappings.Add((p, System.IO.Path.GetFullPath(m.root)));
            }
            mappings.Sort((a, b) => b.prefix.Length.CompareTo(a.prefix.Length));   // 长前缀优先匹配

            // 稳定端口优先：ardy 权重（684MB）的浏览器缓存（CacheStorage）按 origin 分桶，
            // 端口一变就是全新 origin —— marker 校验不过、旧缓存永不清理，权重每次重下还白占一份磁盘
            // （曾把 C 盘堆到 60GB）。端口固定后热启动直接命中 "Cached model"，只保留一份缓存。
            // 基准端口被别的程序占用时在同一小区间顺延；区间全不可用才退回随机端口（保底能用）。
            System.Exception? last = null;
            for (int offset = 0; offset < StablePortSpan; offset++)
            {
                int port = StablePortBase + offset;
                try
                {
                    listener = new System.Net.Sockets.TcpListener(System.Net.IPAddress.Loopback, port);
                    listener.Start();
                    Port = port;
                    _ = System.Threading.Tasks.Task.Run(AcceptLoop);
                    return;
                }
                catch (System.Exception e) { last = e; }
            }
            for (int attempt = 0; attempt < 8; attempt++)
            {
                int port = FreePort();
                try
                {
                    listener = new System.Net.Sockets.TcpListener(System.Net.IPAddress.Loopback, port);
                    listener.Start();
                    Port = port;
                    _ = System.Threading.Tasks.Task.Run(AcceptLoop);
                    return;
                }
                catch (System.Exception e) { last = e; }
            }
            throw new System.IO.IOException("无法在回环地址上绑定端口：" + (last?.Message ?? "?"));
        }

        static int FreePort()
        {
            var probe = new System.Net.Sockets.TcpListener(System.Net.IPAddress.Loopback, 0);
            probe.Start();
            int port = ((System.Net.IPEndPoint)probe.LocalEndpoint).Port;
            probe.Stop();
            return port;
        }

        async System.Threading.Tasks.Task AcceptLoop()
        {
            while (!cts.IsCancellationRequested)
            {
                System.Net.Sockets.TcpClient client;
                try { client = await listener.AcceptTcpClientAsync(cts.Token); }
                catch { break; }
                _ = System.Threading.Tasks.Task.Run(() => Handle(client));
            }
        }

        void Handle(System.Net.Sockets.TcpClient client)
        {
            try
            {
                using (client)
                using (System.Net.Sockets.NetworkStream stream = client.GetStream())
                {
                    client.ReceiveTimeout = 20000;
                    client.SendTimeout = 180000;
                    string? head = ReadHead(stream);
                    if (head is null) return;
                    string[] lines = head.Split("\r\n");
                    string[] first = lines[0].Split(' ');
                    if (first.Length < 2) return;
                    string method = first[0].ToUpperInvariant();
                    string target = first[1];
                    string range = "";
                    foreach (string l in lines)
                        if (l.StartsWith("Range:", System.StringComparison.OrdinalIgnoreCase)) range = l.Substring(6).Trim();

                    int q = target.IndexOf('?');
                    if (q >= 0) target = target.Substring(0, q);
                    try { target = System.Uri.UnescapeDataString(target); } catch { }

                    string? file = ResolveDisk(target) ?? Resolve(target);
                    if (file is null) { WriteText(stream, "404 Not Found", "no such file: " + target); return; }

                    System.IO.FileInfo fi = new(file);
                    long start = 0, end = fi.Length - 1;
                    bool partial = false;
                    if (range.StartsWith("bytes=", System.StringComparison.OrdinalIgnoreCase))
                    {
                        string spec = range.Substring(6).Split(',')[0].Trim();
                        int dash = spec.IndexOf('-');
                        if (dash >= 0)
                        {
                            string left = spec.Substring(0, dash), right = spec.Substring(dash + 1);
                            if (left.Length == 0 && right.Length > 0 && long.TryParse(right, out long suffix))
                            {
                                start = System.Math.Max(0, fi.Length - suffix);      // 后缀范围 bytes=-N
                            }
                            else
                            {
                                if (left.Length > 0) long.TryParse(left, out start);
                                if (right.Length > 0 && long.TryParse(right, out long rEnd)) end = System.Math.Min(end, rEnd);
                            }
                            partial = true;
                        }
                    }
                    if (start > end || start >= fi.Length) { WriteText(stream, "416 Range Not Satisfiable", "bad range"); return; }

                    long length = end - start + 1;
                    string mime = Mime.TryGetValue(System.IO.Path.GetExtension(file), out string? m) ? m! : "application/octet-stream";
                    string headerText =
                        (partial ? "HTTP/1.1 206 Partial Content\r\n" : "HTTP/1.1 200 OK\r\n") +
                        "Content-Type: " + mime + "\r\n" +
                        "Content-Length: " + length + "\r\n" +
                        "Accept-Ranges: bytes\r\n" +
                        (partial ? "Content-Range: bytes " + start + "-" + end + "/" + fi.Length + "\r\n" : "") +
                        // 页面在 http://127.0.0.1 下，/disk/ 只服务本机读取（模型目录可能不在插件目录里）
                        "Access-Control-Allow-Origin: *\r\n" +
                        // 生成式动作(ardy)的权重 684MB 放在 Storage/ThreeDeskPet/Ardy 下 → 可长缓存：
                        // 否则**每次重开窗口都要重下 684MB**。插件目录里的前端(JS/CSS)保持 no-store，
                        // 这样我改的前端代码每次重开立即生效，两边互不影响。
                        ((file ?? "").IndexOf("Ardy", StringComparison.OrdinalIgnoreCase) >= 0
                            ? "Cache-Control: public, max-age=604800, immutable\r\n"
                            : "Cache-Control: no-store\r\n") +
                        "Connection: close\r\n\r\n";
                    byte[] header = System.Text.Encoding.ASCII.GetBytes(headerText);
                    stream.Write(header, 0, header.Length);

                    if (method != "HEAD")
                    {
                        using System.IO.FileStream fs = new(file, System.IO.FileMode.Open, System.IO.FileAccess.Read, System.IO.FileShare.Read, 1 << 20);
                        fs.Seek(start, System.IO.SeekOrigin.Begin);
                        byte[] buf = new byte[1 << 20];
                        long remaining = length;
                        while (remaining > 0)
                        {
                            int want = (int)System.Math.Min(buf.Length, remaining);
                            int got = fs.Read(buf, 0, want);
                            if (got <= 0) break;
                            stream.Write(buf, 0, got);
                            remaining -= got;
                        }
                    }
                    stream.Flush();
                }
            }
            catch { /* 客户端断开/超时都属正常 */ }
        }

        /// <summary>
        /// /disk/&lt;绝对路径&gt;：把磁盘文件当静态资源供页面读取。
        /// 为什么需要它：Alife 5 的 WebView2 没有 Node，前端原先用 Electron 的 fs 直接读
        /// 模型/动作/贴图（它们存放在插件目录之外的任意目录），这里改由本机回环 HTTP 提供。
        /// 只读、只可能被本机页面访问。
        /// </summary>
        static string? ResolveDisk(string target)
        {
            const string prefix = "/disk/";
            if (!target.StartsWith(prefix, System.StringComparison.OrdinalIgnoreCase)) return null;
            string path = target.Substring(prefix.Length);
            if (path.Length < 3) return null;
            string full;
            try { full = System.IO.Path.GetFullPath(path); } catch { return null; }
            return System.IO.File.Exists(full) ? full : null;
        }

        string? Resolve(string target)
        {
            foreach (var (prefix, root) in mappings)
            {
                if (!target.StartsWith(prefix, System.StringComparison.OrdinalIgnoreCase)) continue;
                string rel = target.Substring(prefix.Length).Replace('/', System.IO.Path.DirectorySeparatorChar);
                if (rel.Length == 0) rel = "index.html";
                string full;
                try { full = System.IO.Path.GetFullPath(System.IO.Path.Combine(root, rel)); } catch { continue; }
                if (!full.StartsWith(root, System.StringComparison.OrdinalIgnoreCase)) continue;   // 防目录穿越
                if (System.IO.File.Exists(full)) return full;
            }
            return null;
        }

        static string? ReadHead(System.Net.Sockets.NetworkStream stream)
        {
            System.IO.MemoryStream ms = new();
            byte[] one = new byte[1];
            while (ms.Length < 65536)
            {
                int n;
                try { n = stream.Read(one, 0, 1); } catch { return null; }
                if (n <= 0) return null;
                ms.WriteByte(one[0]);
                if (ms.Length >= 4)
                {
                    byte[] a = ms.GetBuffer();
                    int L = (int)ms.Length;
                    if (a[L - 4] == 13 && a[L - 3] == 10 && a[L - 2] == 13 && a[L - 1] == 10)
                        return System.Text.Encoding.UTF8.GetString(a, 0, L);
                }
            }
            return null;
        }

        static void WriteText(System.Net.Sockets.NetworkStream stream, string status, string body)
        {
            byte[] b = System.Text.Encoding.UTF8.GetBytes(body);
            string head = "HTTP/1.1 " + status + "\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: " + b.Length + "\r\nConnection: close\r\n\r\n";
            byte[] h = System.Text.Encoding.ASCII.GetBytes(head);
            stream.Write(h, 0, h.Length);
            stream.Write(b, 0, b.Length);
            stream.Flush();
        }

        public void Dispose()
        {
            try { cts.Cancel(); } catch { }
            try { listener?.Stop(); } catch { }
            try { cts.Dispose(); } catch { }
        }
    }

    public async ValueTask DisposeAsync()
    {
        try { if (bounds.Width > 0 && bounds.Height > 0) storage.SetObject(windowBoundsKey, bounds); }
        catch (Exception e) { AlifeLog.LogWarning("PetWindow 保存位置失败: " + e.Message); }

        try { cancellationTokenSource?.Cancel(); cancellationTokenSource?.Dispose(); }
        catch (Exception e) { AlifeLog.LogWarning("PetWindow 停止轮询失败: " + e.Message); }

        IAlifeWindow? w = window;
        window = null;
        if (w != null)
        {
            try
            {
                w.MessageReceived -= OnIpcMessage;
                w.BoundsChanged -= OnBoundsChanged;
                await w.DisposeAsync();
            }
            catch (Exception e) { AlifeLog.LogWarning("PetWindow 关闭窗口失败: " + e.Message); }
        }

        try { staticServer?.Dispose(); staticServer = null; }
        catch (Exception e) { AlifeLog.LogWarning("PetWindow 关闭本地静态服务失败: " + e.Message); }
    }

    /// <summary>
    /// 回收历史遗留的 ardy 权重缓存：端口随机时代每次启动都会在浏览器 profile 的
    /// CacheStorage 下留一份完整权重副本（约 684MB），Chromium 从不自动回收。
    /// 只删除同时满足：index.txt 带本插件缓存前缀 / 端口不是本次端口 / 该端口无进程监听
    /// / 目录 10 分钟内无改动 的 origin 目录。全程 best-effort，失败只记日志。
    /// </summary>
    static void CleanStaleArdyCaches(int currentPort)
    {
        try
        {
            string appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
            foreach (string profile in Directory.GetDirectories(appData))
            {
                string storageRoot = Path.Combine(profile, "Service Worker", "CacheStorage");
                if (!Directory.Exists(storageRoot)) continue;
                foreach (string origin in Directory.GetDirectories(storageRoot))
                {
                    try
                    {
                        string index = Path.Combine(origin, "index.txt");
                        if (!File.Exists(index)) continue;
                        string text = File.ReadAllText(index);
                        if (text.IndexOf("ardy-mini-model-files-v1-", StringComparison.Ordinal) < 0) continue;
                        var match = System.Text.RegularExpressions.Regex.Match(text, @"127\.0\.0\.1:(\d+)");
                        if (!match.Success) continue;
                        int port = int.Parse(match.Groups[1].Value);
                        if (port == currentPort) continue;                                    // 本次会话正在用
                        if (Directory.GetLastWriteTimeUtc(origin) > DateTime.UtcNow.AddMinutes(-10)) continue;   // 刚写入，先留着
                        if (LoopbackPortAlive(port)) continue;                               // 别的实例还在用
                        long size = DirectorySize(origin);
                        Directory.Delete(origin, true);
                        AlifeLog.LogInformation($"[3D桌宠] 已回收 ardy 权重缓存遗留副本（旧端口 {port}，约 {size / 1024 / 1024} MB）");
                    }
                    catch (Exception e) { AlifeLog.LogWarning("[3D桌宠] 回收 ardy 缓存副本失败: " + e.Message); }
                }
            }
        }
        catch (Exception e) { AlifeLog.LogWarning("[3D桌宠] 扫描 ardy 缓存副本失败: " + e.Message); }
    }

    static bool LoopbackPortAlive(int port)
    {
        try
        {
            using var probe = new System.Net.Sockets.TcpClient();
            return probe.ConnectAsync(System.Net.IPAddress.Loopback, port).Wait(200) && probe.Connected;
        }
        catch { return false; }
    }

    static long DirectorySize(string path)
    {
        long total = 0;
        try
        {
            foreach (string file in Directory.EnumerateFiles(path, "*", SearchOption.AllDirectories))
            {
                try { total += new FileInfo(file).Length; } catch { }
            }
        }
        catch { }
        return total;
    }

    void OnBoundsChanged(Rectangle newBounds)
    {
        bounds = newBounds;
        savedBounds = newBounds;   // 持久化最后位置（拖动/落座后重启仍保持）
        position.X = bounds.X + bounds.Width / 2;
        position.Y = bounds.Y + bounds.Height / 2;
        ignoreState = null;        // 位置变了，重新判定穿透
    }

    async void Loop(CancellationToken cancellationToken = default)
    {
        int failCount = 0;
        while (cancellationToken.IsCancellationRequested == false)
        {
            try
            {
                await Task.Delay(30, cancellationToken);
                Point newCursorPoint = GetCursorPosition();
                if (cursorScreenPoint.X != newCursorPoint.X || cursorScreenPoint.Y != newCursorPoint.Y)
                {
                    cursorScreenPoint = newCursorPoint;
                    MouseMoved?.Invoke();
                    if (BroadcastCursor && bridge != null)
                    {
                        // 前端按"屏幕 CSS 像素"理解该值（与窗口坐标同一单位）
                        bridge.SendMessage("cursor", new { x = cursorScreenPoint.X, y = cursorScreenPoint.Y, w = workArea.Width, h = workArea.Height });
                    }
                }
                // 鼠标穿透：光标不在宠物/菜单/面板上时，事件穿透到桌面（对标 MateEngine）
                try { ApplyIgnoreState(); failCount = 0; }
                catch (Exception)
                {
                    // IPC 瞬时拥堵（穿透切换瞬间可能 >1s）：单次失败不能让循环退出，
                    // 否则窗口会永久卡在最后一次 SetIgnoreMouseEvents 的状态。
                    // 连续失败时拉回"不穿透"，宁可短暂挡一下桌面也不能永久穿透。
                    if (++failCount >= 3)
                    {
                        try { PushInputRegions(null); } catch { }
                        ignoreState = false;
                        failCount = 0;
                    }
                }
            }
            catch (OperationCanceledException) { break; }
            catch (Exception e)
            {
                AlifeLog.LogWarning("PetWindow 轮询瞬时失败，500ms 后重试: " + e.Message);
                try { await Task.Delay(500, cancellationToken); }
                catch (OperationCanceledException) { break; }
            }
        }
    }

    /// <summary>在此后 ms 毫秒内强制不穿透（拖动等连续交互期间调用，避免被穿透拦截打断）。</summary>
    public void KeepInteractiveFor(int ms)
    {
        dragHoldUntil = DateTime.UtcNow.AddMilliseconds(ms);
        ignoreState = null;
    }

    /// <summary>按全局光标是否落在宠物/UI 上，动态切换窗口穿透状态。</summary>
    void ApplyIgnoreState()
    {
        if (!MouseThrough) { SetIgnore(false); return; }
        if (DateTime.UtcNow < dragHoldUntil) { SetIgnore(false); return; }   // 拖动等交互期间保持可点
        Rectangle b = bounds;
        double cx = cursorScreenPoint.X - b.X;   // 光标在窗口内的坐标
        double cy = cursorScreenPoint.Y - b.Y;
        bool interactive;
        lock (interactiveLock)
        {
            // 模型本体命中：优先用前端发来的像素级遮罩；遮罩未就绪时退回包围盒矩形兜底
            bool modelHit;
            if (hasMask && bodyMask != null) modelHit = MaskHit(cx, cy);
            else if (bodyRect is Rectangle br) modelHit = cx >= br.X && cx <= br.X + br.Width && cy >= br.Y && cy <= br.Y + br.Height;
            else modelHit = uiRects.Count == 0;   // 未就绪默认不穿透，避免整窗穿透后彻底无法交互
            bool uiHit = false;
            foreach (Rectangle r in uiRects)
            {
                if (cx >= r.X && cx <= r.X + r.Width && cy >= r.Y && cy <= r.Y + r.Height) { uiHit = true; break; }
            }
            interactive = uiHover || uiHit || modelHit;
        }
        SetIgnore(!interactive);
    }

    /// <summary>
    /// 切换穿透：ignore=true 时下发"空交互区域"（整窗穿透），false 时下发 null（整窗可交互）。
    /// 与 Electron 的 SetIgnoreMouseEvents 语义一一对应，判定逻辑（遮罩/矩形/UI）完全不变。
    /// </summary>
    void SetIgnore(bool ignore)
    {
        if (ignoreState == ignore) return;
        ignoreState = ignore;
        PushInputRegions(ignore ? Array.Empty<Rectangle>() : null);
    }

    void PushInputRegions(Rectangle[]? regions)
    {
        IAlifeWindow? w = window;
        if (w == null) return;
        _ = PushAsync(w, regions);
    }

    async Task PushAsync(IAlifeWindow w, Rectangle[]? regions)
    {
        try
        {
            await w.SetInputRegionsAsync(regions);
            regionFailures = 0;
        }
        catch (Exception e)
        {
            // 连续失败时把窗口拉回"整窗可交互"，宁可短暂挡一下桌面也不能永久穿透（防止桌宠彻底点不到）
            ignoreState = null;
            if (++regionFailures >= 3)
            {
                regionFailures = 0;
                try { await w.SetInputRegionsAsync(null); } catch { }
            }
            AlifeLog.LogWarning("鼠标穿透切换失败: " + e.Message);
        }
    }
}
