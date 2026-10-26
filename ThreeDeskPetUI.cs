using System;
using System.ComponentModel;
using System.Globalization;
using System.Linq;
using System.Reflection;
using Alife.Framework;
using Microsoft.AspNetCore.Components;
using Microsoft.AspNetCore.Components.Rendering;

namespace presents.DeskPet3D;

/// <summary>
/// 「3D桌宠」的插件配置页（功能检视 → 3D桌宠）。
///
/// 为什么自己渲染而不是用框架的通用表单：
///   · 模块没有 EditorUI 时，通用表单按**字段声明顺序**平铺，几十项一路排下去，
///     "动作人设"这种最该被看见的东西会被埋在中后段（实测用户根本找不到）；
///   · 手写之后：动作人设置顶（5 段文本 + 5 个数值 + 提醒间隔），其余配置项仍**完整**列出（反射生成，不漏项）；
///   · 只改排版与最值校验，不引入任何新语义。
///
/// 保存沿用框架底部按钮（应用全局 / 应用到角色）；同时每次改动都同步给运行中的模块，
/// 所以改完立刻生效（不必等保存），保存只决定"是否长期记住"。
/// </summary>
public sealed class ThreeDeskPetUI : ModuleUIBase<ThreeDeskPet, ThreeDeskPetConfig>
{
    string message = "";

    /// <summary>除动作人设以外的全部可编辑项：按声明顺序、跳过 [Browsable(false)]（那是"运行时不在这里改"的项）。</summary>
    static readonly PropertyInfo[] RestProps = typeof(ThreeDeskPetConfig)
        .GetProperties(BindingFlags.Public | BindingFlags.Instance)
        .Where(p => p.CanRead && p.CanWrite)
        .Where(p => !p.Name.StartsWith("MotionIdiom", StringComparison.Ordinal))
        .Where(p => p.GetCustomAttribute<BrowsableAttribute>()?.Browsable != false)
        .ToArray();

    /// <summary>把改动同步到运行中的模块（让效果立刻可见；持久化交给框架的"应用"按钮）。</summary>
    void Sync()
    {
        try { if (Module != null) Module.Configuration = Configuration; } catch { }
    }

    MotionIdiom? Idiom()
    {
        try { return MotionIdiom.From(Configuration); } catch { return null; }
    }

    protected override void BuildRenderTree(RenderTreeBuilder b)
    {
        if (Configuration is null) return;
        int s = 0;
        b.OpenElement(s++, "section");
        b.AddAttribute(s++, "class", "dp3d");
        b.AddMarkupContent(s++, "<style>" + Styles + "</style>");

        Heading(b, ref s, "动作人设");
        Text(b, ref s, "由你的 AI 自己写（性格 + 近期记忆蒸馏），你也可以在这里直接改。"
            + "幅度 / 节奏 / 密度等数值会立刻影响待机与动作手感；1 = 默认手感，不会破坏你原来调好的默认值。"
            + "空的说明还没写过 —— 对 AI 说「用 <motionidiom> 写下你自己的动作人设」就会自动填。");
        MotionIdiom? idi = Idiom();
        if (idi != null)
        {
            int age = idi.DaysSinceUpdate();
            string src = idi.Source == "user" ? "你自己改的" : (idi.IsEmpty ? "还没写过" : "AI 写的");
            Text(b, ref s, "状态：" + src + (age >= 0 ? "，更新于 " + (age == 0 ? "今天" : age + " 天前") : "")
                + (idi.IsEmpty ? "" : "（提醒间隔 " + Configuration.MotionIdiomRefreshDays + " 天）"));
        }

        TextInput(b, ref s, "我是谁", Configuration.MotionIdiomPersona, v => { Configuration.MotionIdiomPersona = v; Sync(); }, 48);
        TextInput(b, ref s, "近况 / 记忆的影响", Configuration.MotionIdiomState, v => { Configuration.MotionIdiomState = v; Sync(); }, 48);
        TextInput(b, ref s, "惯用动作", Configuration.MotionIdiomLike, v => { Configuration.MotionIdiomLike = v; Sync(); }, 48);
        TextInput(b, ref s, "忌讳", Configuration.MotionIdiomAvoid, v => { Configuration.MotionIdiomAvoid = v; Sync(); }, 48);
        TextInput(b, ref s, "签名动作", Configuration.MotionIdiomSignature, v => { Configuration.MotionIdiomSignature = v; Sync(); }, 48);
        NumberInput(b, ref s, "幅度", Configuration.MotionIdiomAmp, 0.3, 1.5, 0.05, v => { Configuration.MotionIdiomAmp = v; Sync(); });
        NumberInput(b, ref s, "节奏", Configuration.MotionIdiomTempo, 0.5, 2, 0.05, v => { Configuration.MotionIdiomTempo = v; Sync(); });
        NumberInput(b, ref s, "小动作密度", Configuration.MotionIdiomDensity, 0, 3, 1, v => { Configuration.MotionIdiomDensity = v; Sync(); });
        NumberInput(b, ref s, "平滑（秒）", Configuration.MotionIdiomSmooth, 0, 0.3, 0.01, v => { Configuration.MotionIdiomSmooth = v; Sync(); });
        NumberInput(b, ref s, "静定", Configuration.MotionIdiomStillness, 0, 1, 0.05, v => { Configuration.MotionIdiomStillness = v; Sync(); });
        NumberInput(b, ref s, "更新提醒间隔（天）", Configuration.MotionIdiomRefreshDays, 0, 60, 1,
            v => { Configuration.MotionIdiomRefreshDays = (int)Math.Round(v); Sync(); },
            "到期后会在 AI 的常驻信息里多一句提醒，它下次说话时顺手更新 —— 不额外占用对话回合。0 = 不提醒。");

        Heading(b, ref s, "其余配置");
        Text(b, ref s, "以下按配置项声明顺序完整列出（跳过只能在运行时改的项，那些在桌宠右键菜单与设置面板里）。"
            + "改动即时生效；想长期记住就点页面底部的「应用全局 / 应用到角色」。");
        foreach (PropertyInfo p in RestProps) RenderProperty(b, ref s, p);

        b.OpenElement(s++, "p");
        b.AddAttribute(s++, "class", "dp3d-status");
        b.AddContent(s++, message);
        b.CloseElement();
        b.CloseElement();
    }

    void RenderProperty(RenderTreeBuilder b, ref int s, PropertyInfo p)
    {
        string hint = p.GetCustomAttribute<DescriptionAttribute>()?.Description ?? "";
        Type t = Nullable.GetUnderlyingType(p.PropertyType) ?? p.PropertyType;
        object? cur;
        try { cur = p.GetValue(Configuration); } catch { return; }

        if (t == typeof(bool))
        {
            BoolInput(b, ref s, p.Name, cur is bool bv && bv, v => Set(p, v), hint);
            return;
        }
        if (t.IsEnum)
        {
            SelectInput(b, ref s, p.Name, Convert.ToString(cur, CultureInfo.InvariantCulture) ?? "",
                Enum.GetNames(t), v => Set(p, Enum.Parse(t, v)), hint);
            return;
        }
        if (t == typeof(string))
        {
            TextInput(b, ref s, p.Name, cur as string ?? "", v => Set(p, v), 0, hint);
            return;
        }
        if (t == typeof(double) || t == typeof(float) || t == typeof(int) || t == typeof(long))
        {
            double d = 0;
            try { d = Convert.ToDouble(cur, CultureInfo.InvariantCulture); } catch { }
            bool integral = t == typeof(int) || t == typeof(long);
            // 不用 min/max：这些是老配置项，历史值可能超出"推荐区间"，卡住反而改不动；
            // 真正的范围校验只给动作人设（那边是 AI/用户都可能填错的新字段）。
            NumberInput(b, ref s, p.Name, d, double.NaN, double.NaN, integral ? 1 : 0.01,
                v => Set(p, integral ? (object)(int)Math.Round(v) : v), hint);
            return;
        }
        Text(b, ref s, p.Name + "：" + (Convert.ToString(cur, CultureInfo.InvariantCulture) ?? "（不支持在此编辑）"));
    }

    void Set(PropertyInfo p, object value)
    {
        try { p.SetValue(Configuration, value); Sync(); message = ""; }
        catch (Exception e) { message = p.Name + " 设置失败：" + e.Message; }
    }

    // ---- 渲染小工具（与工作区里其它手写配置页保持同一风格）----

    static void Heading(RenderTreeBuilder b, ref int s, string text)
    {
        b.OpenElement(s++, "h4"); b.AddContent(s++, text); b.CloseElement();
    }

    static void Text(RenderTreeBuilder b, ref int s, string text)
    {
        b.OpenElement(s++, "p"); b.AddContent(s++, text); b.CloseElement();
    }

    void TextInput(RenderTreeBuilder b, ref int s, string label, string value, Action<string> change, int maxLen, string hint = "")
    {
        b.OpenElement(s++, "label"); b.AddAttribute(s++, "class", "dp3d-row");
        b.OpenElement(s++, "span"); b.AddContent(s++, label); b.CloseElement();
        b.OpenElement(s++, "input"); b.AddAttribute(s++, "type", "text");
        b.AddAttribute(s++, "value", value);
        if (maxLen > 0) b.AddAttribute(s++, "maxlength", maxLen);
        b.AddAttribute(s++, "onchange", EventCallback.Factory.Create<ChangeEventArgs>(this, e =>
        {
            string v = e.Value?.ToString() ?? "";
            if (maxLen > 0 && v.Length > maxLen) v = v.Substring(0, maxLen);
            change(v);
        }));
        b.CloseElement(); b.CloseElement();
        if (hint.Length > 0) Text(b, ref s, hint);
    }

    void NumberInput(RenderTreeBuilder b, ref int s, string label, double value, double min, double max, double step,
        Action<double> change, string hint = "")
    {
        b.OpenElement(s++, "label"); b.AddAttribute(s++, "class", "dp3d-row");
        b.OpenElement(s++, "span"); b.AddContent(s++, label); b.CloseElement();
        b.OpenElement(s++, "input"); b.AddAttribute(s++, "type", "number");
        if (!double.IsNaN(min)) b.AddAttribute(s++, "min", min);
        if (!double.IsNaN(max)) b.AddAttribute(s++, "max", max);
        b.AddAttribute(s++, "step", step);
        b.AddAttribute(s++, "value", value.ToString(CultureInfo.InvariantCulture));
        b.AddAttribute(s++, "onchange", EventCallback.Factory.Create<ChangeEventArgs>(this, e =>
        {
            if (!double.TryParse(e.Value?.ToString(), NumberStyles.Float, CultureInfo.InvariantCulture, out double n)
                || !double.IsFinite(n))
            {
                message = label + "：请输入数字";
                return;
            }
            if (!double.IsNaN(min) && !double.IsNaN(max) && (n < min || n > max))
            {
                message = label + "：需要在 " + min.ToString(CultureInfo.InvariantCulture)
                    + " ~ " + max.ToString(CultureInfo.InvariantCulture) + " 之间";
                return;
            }
            change(n);
        }));
        b.CloseElement(); b.CloseElement();
        if (hint.Length > 0) Text(b, ref s, hint);
    }

    void BoolInput(RenderTreeBuilder b, ref int s, string label, bool value, Action<bool> change, string hint)
    {
        b.OpenElement(s++, "label"); b.AddAttribute(s++, "class", "dp3d-row");
        b.OpenElement(s++, "span"); b.AddContent(s++, label); b.CloseElement();
        b.OpenElement(s++, "input"); b.AddAttribute(s++, "type", "checkbox");
        b.AddAttribute(s++, "checked", value);
        b.AddAttribute(s++, "onchange", EventCallback.Factory.Create<ChangeEventArgs>(this, e => change(e.Value is true)));
        b.CloseElement(); b.CloseElement();
        if (hint.Length > 0) Text(b, ref s, hint);
    }

    void SelectInput(RenderTreeBuilder b, ref int s, string label, string value, string[] options, Action<string> change, string hint)
    {
        b.OpenElement(s++, "label"); b.AddAttribute(s++, "class", "dp3d-row");
        b.OpenElement(s++, "span"); b.AddContent(s++, label); b.CloseElement();
        b.OpenElement(s++, "select");
        b.AddAttribute(s++, "value", value);
        b.AddAttribute(s++, "onchange", EventCallback.Factory.Create<ChangeEventArgs>(this, e => change(e.Value?.ToString() ?? "")));
        foreach (string o in options)
        {
            b.OpenElement(s++, "option");
            b.AddAttribute(s++, "value", o);
            b.AddAttribute(s++, "selected", o == value);
            b.AddContent(s++, o);
            b.CloseElement();
        }
        b.CloseElement(); b.CloseElement();
        if (hint.Length > 0) Text(b, ref s, hint);
    }

    const string Styles = """
        .dp3d{box-sizing:border-box;width:100%;max-width:780px;margin:8px auto;padding:24px 28px;font:14px/1.65 'Segoe UI','Microsoft YaHei',sans-serif;color:var(--text-color,#342e45);background:var(--background-color,#fbf9ff);border:1px solid #8b74ac25;border-radius:20px;box-shadow:0 8px 28px #35234608}
        .dp3d h4{font-size:15px;letter-spacing:.02em;margin:26px 0 14px;padding-top:20px;border-top:1px solid #8b74ac25;color:inherit}
        .dp3d h4:first-of-type{border:0;margin:0 0 16px;padding:0;font-size:22px;font-weight:650;color:#8061aa}
        .dp3d .dp3d-row{display:flex;align-items:center;justify-content:space-between;gap:20px;margin:14px 0;font-size:14px}
        .dp3d .dp3d-row>span{flex:0 0 auto}
        .dp3d input[type=text],.dp3d input[type=number],.dp3d select{box-sizing:border-box;width:320px;max-width:60%;padding:9px 12px;border:1px solid #8b74ac40;border-radius:10px;background:var(--background-color,#fff);color:inherit;font:inherit;outline:none}
        .dp3d input:focus,.dp3d select:focus{border-color:#9a7ac1;box-shadow:0 0 0 3px #9a7ac115}
        .dp3d input[type=checkbox]{width:18px;height:18px;accent-color:#8263a8}
        .dp3d p{font-size:12px;color:#8b7d9b;line-height:1.8;margin:8px 0 14px}
        .dp3d .dp3d-status{color:#8061aa;min-height:20px;margin-top:18px}
        @media(max-width:520px){.dp3d{padding:18px}.dp3d input[type=text],.dp3d input[type=number],.dp3d select{width:55%}}
        """;
}
