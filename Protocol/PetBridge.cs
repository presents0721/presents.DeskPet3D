using System;
using System.Collections.Generic;
using System.Text.Json;
using System.Threading.Tasks;
using Microsoft.Extensions.Logging;
using Newtonsoft.Json.Linq;

namespace presents.DeskPet3D;

/// <summary>
/// 3D 桌宠宿主 ⇄ 页面 的消息桥（Alife 5：走 window.alifeWindow，不再有 Electron IPC）。
/// 信封对象为 { type: string, ...payload }；页面经 window.alifeWindow.postMessage 上报，
/// 主进程经 <see cref="OnMessage"/> 事件分发。
/// </summary>
public sealed class PetBridge : IDisposable
{
    public event Action<string, JsonElement>? OnMessage;

    /// <summary>向页面发送消息（合并 type 与 payload 为单一信封 JSON）。</summary>
    public void SendMessage(string type, object? payload = null)
    {
        try
        {
            JObject envelope = new() { ["type"] = type };
            if (payload != null)
            {
                JObject payloadObj = JObject.FromObject(payload);
                foreach (KeyValuePair<string, JToken?> kvp in payloadObj)
                    envelope[kvp.Key] = kvp.Value;
            }
            window.PostMessage(envelope.ToString(Newtonsoft.Json.Formatting.None));
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "发送桌宠消息失败");
        }
    }

    /// <summary>在页面里执行 JS 并返回结果。</summary>
    public Task<string?> ExecuteJavaScriptAsync(string script)
    {
        return window.ExecuteJavaScriptAsync(script);
    }

    readonly PetWindow window;
    readonly ILogger<ThreeDeskPet> logger;

    public PetBridge(PetWindow window, ILogger<ThreeDeskPet> logger)
    {
        this.window = window;
        this.logger = logger;
        window.OnMessage += Forward;
    }
    public void Dispose()
    {
        window.OnMessage -= Forward;
    }

    void Forward(string type, JsonElement root)
    {
        try { OnMessage?.Invoke(type, root); }
        catch (Exception e) { logger.LogError(e, "执行桌宠前端消息回调失败"); }
    }
}
