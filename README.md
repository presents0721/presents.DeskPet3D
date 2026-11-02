# 3D桌宠（presents.DeskPet3D）

在 Alife 里给角色一个 **3D 身体**：透明置顶窗口 + Three.js 渲染 VRM / PMX 模型，
支持表情、待机动画、跳舞（VMD / VRMA）、头部与脊椎跟随鼠标、弹簧骨（头发/裙子）触摸、
以及可选的具身动作（AI 驱动的程序化姿势 / 生成式动作）。

> 目标：**装完就能跑**。前端三方库、物理引擎、推理运行时全部随插件分发，不依赖 CDN、不需要联网。

---

## 1. 安装

- 插件市场里点安装即可（插件目录名必须是 `presents.DeskPet3D`）。
- 手动安装：把整个文件夹放到
  `%USERPROFILE%\Documents\Alife\Storage\Plugins\presents.DeskPet3D\`
  （**不要**放成 `presents.DeskPet3D.xxx` 之类的临时名，否则插件 ID 不匹配）。

> ⚠ 目录名就是插件 ID。`ThreeDeskPet.cs` 里查找 `Resources/ThreeDeskPet/ardy-phrases.json` 用的是固定 ID，
> 改名会导致生成式动作词条退回内置兜底（其它功能不受影响）。

---

## 2. 随插件分发的资源（不需要你下）

| 资源 | 位置 | 用途 |
|---|---|---|
| three.js r160 | `Resources/ThreeDeskPet/vendor/three.module.js` | 渲染核心 |
| three-vrm 3.4.0 / three-vrm-animation 3.4.0 | `Resources/ThreeDeskPet/vendor/` | VRM 加载、表情、弹簧骨、VRMA |
| three addons（GLTFLoader / MMDLoader / MMDPhysics / CCDIKSolver / mmdparser …） | `Resources/ThreeDeskPet/vendor/addons/` | PMX/VMD 加载与 IK/物理 |
| ammo.js（wasm） | `Resources/ThreeDeskPet/vendor/ammo/` | MMD 刚体物理 |
| ONNX Runtime Web（wasm + WebGPU） | `Resources/ThreeDeskPet/ort/` | 生成式动作的推理运行时 |
| 表情引擎（VAD+FACS，Apache-2.0） | `Resources/ThreeDeskPet/face-engine.js` | 24 种情绪、FACS/AU→BlendShape 映射、视线 |
| 生成式动作词条表 | `Resources/ThreeDeskPet/ardy-phrases.json` | 给 AI 的可选动作短语 |
| 权重下载脚本 | `Resources/ThreeDeskPet/tools/download-ardy-fp32.ps1` | 一键下载可选权重 |

前端所有 `import` 都指向本地 `vendor/`（见 `index.html` 的 importmap），**断网也能正常显示**。

---

## 3. 需要你自备的资源（插件里**不带任何模型与动作**）

> 本插件只提供渲染与驱动能力。**包内没有任何 `.vrm` / `.pmx` / `.vmd` / `.vrma` 文件**，
> 模型与配布动作的版权归原作者，请自行获取并遵守各自的许可（多数模型/动作禁止二次分发，
> 部分仅限个人使用）。插件能做的只是：帮你打开正确的目录、缺模型时在窗口里提示、以及生成式动作权重的下载。

### 3.1 去哪找

- **VRM 模型**：VRoid Hub、BOOTH（搜 "VRM" / "3Dモデル"）、ニコニ立体、
  以及国内创作者常发布的模之屋（aplaybox）等社区。授权看模型页说明（个人使用 / 可否改模 / 可否商用）。
- **PMX（MMD）模型 + VMD 动作**：MMD 配布站、各作者配布页；舞蹈动作多为 `.vmd`，
  下载时注意「モーション」与「カメラ」是两种文件，本插件只要动作（モーション）。
- **VRMA 动作**：VRoid / BOOTH 上搜 "VRMA"，或自己用 VRM Animation 工具导出。
- 拿到文件后按下面 3.2 / 3.3 放好即可，**不用改文件名**（插件认目录里第一个 `.vrm` / `.pmx`）。

### 3.2 模型放哪

放到 **当前角色** 的模型目录：

```
Storage\<角色>\ThreeDeskPet\Models\<模型名>\
    model.vrm            ← VRM（或该目录下第一个 .vrm）
    model.pmx            ← PMX/MMD（或该目录下第一个 .pmx）
    motions\*.vrma       ← VRM 动画
    motions\*.vmd        ← PMX 动作（VMD）
```

- VRM：推荐 VRM 0.x / 1.0，带表情（blend shape）与 spring bone 的模型效果最好。
- PMX：贴图目录要一起拷（`.pmx` 旁边的 `tex/` 等），否则模型会是灰模。
- 右键桌宠 → **「打开模型文件夹」** 可直接打开上面的 `Models` 目录。
- 也支持「额外模型目录」（插件配置里可填多个路径）。
- 一个模型一个子文件夹；换模型：右键 →「模型」浮层里点一下即可。

### 3.3 动作

- VRM：`.vrma`（推荐）或 `.vmd`（自动重定向）。
- PMX：`.vmd` 配布。
- 放到模型目录下的 `motions/`，然后右键 →「重新加载模型/动作」即可，无需重启。

### 3.4 生成式动作权重（可选，约 684 MB）

只有开启 **具身动作 → 生成式动作** 时才需要；模型显示、跳舞、表情、程序化动作都不依赖它。

两种方式任选：

1. 右键桌宠 → **「下载生成式动作资源」**（或设置面板 → 资源 → 下载）；
   脚本会从 `huggingface.co` 拉取、失败自动切 `hf-mirror.com`，支持断点续传。下载完 **重开桌宠窗口**。
2. 手动：仓库 `intsuc/Llama-3-ARDY-Mini-Core40-Browser`（固定 revision
   `1c21362effeecec0454bfc0d818661525ae6b387`）的 `fp32/` 目录 + 根目录几个说明文件，
   全部放到 `Storage\ThreeDeskPet\Ardy\`（保持 `fp32/...` 层级）。

> 为什么是 fp32：`ardy-client.js` 固定读 `/ardy/fp32/` —— 多数机器不暴露 WebGPU 的 `shader-f16`，
> fp16 变体会建不出会话。别为了省 32MB 换成 fp16。

---

## 4. 表情：24 种情绪 + 表情引擎

前端内置一套 **VAD（愉悦/唤醒/支配）+ FACS/AU（面部动作单元）** 表情引擎（`face-engine.js`，
取自 [SoullinkEmotion3D](https://github.com/nanlingyin/SoullinkEmotion3D)，Apache-2.0，已编译为单文件、无外部依赖）。

**24 种情绪**（AI 用 `<bodyexpress emotion="...">` 调用，也可在控制台 `embodiedExpress({emotion:'...'})`）：

```
neutral 中性 / happy 开心 / excited 兴奋 / amused 忍俊 / proud 得意 / confident 自信
calm 安心 / relieved 释然 / affectionate 温柔 / shy 害羞 / embarrassed 窘迫 / curious 好奇
concerned 关切 / confused 困惑 / tired 疲惫 / sad 低落 / lonely 落寞 / disappointed 失望
anxiety 紧张 / fear 害怕 / angry 生气 / frustrated 烦躁 / disgust 嫌弃 / surprised 惊讶
```

**四种驱动方式**（可混用）：

| 方式 | 写法 | 用途 |
|---|---|---|
| 情绪 + 强度 | `emotion="shy" intensity="0.7"` | 日常最常用 |
| 连续 VAD | `vad="0.6,0.4,-0.2"`（各 −1~1） | 精确混合；**支配度 D** 决定强势/退缩 |
| 局部 AU | `au="au12LipCornerPuller:0.2,au06CheekRaiser:0.15"` | 微调，单通道上限 0.3 |
| 包络 | `attack="0.15" decay="3"`（秒） | 起落节奏：猝不及防 / 久久不散 |

**换模型零配置**：加载时自动扫描模型的表情清单，按
「VRM 标准预设 → VRoid `Fcl_*` → ARKit 52 → MMD 日文名（にこり/困る/怒り/見開く/まばたき…）」
依次匹配；同一 AU 只取第一个命中通道（避免重复驱动）。模型通道少时用语义预设打底，
完全没有表情定义时退回「情绪→表情名查表」或头部/视线姿态。

**可调参数**（设置面板 → 动作/舞蹈 → 表情引擎）：4 个预设（自然 / 夸张 / 克制 / 作者默认）+
10 个滑条（表情强度、细节占比、保持时长、衰减半衰期、逼近速度、平滑、眉/眼/嘴增益），
实时生效、存本地。情绪还自带**视线**（害羞垂眼偏开、思考瞟向一边），会叠到 lookAt 目标上。

> 注意：部分模型（尤其是转换/裁剪过的 VRM）只有 mesh morph 而**没有登记 VRM 表情**，
> 这类模型引擎无从驱动，属模型本身限制，不是插件问题。

---

## 5. 第一次使用

1. 放好模型与动作（见 3.1 ~ 3.3），右键桌宠 →「重新加载模型/动作」。没放之前，窗口里会有一张提示卡，点它直接打开模型文件夹。
2. 右键 →「设置面板」：大小/相机/物理/画质/追踪等都在这里；「资源」小节有打开模型目录与权重下载。
3. 右键 →「动作」浮层：点一支动作就播；待机时会自动循环 `motions/` 里的短 VRMA（模型自带的待机动作照旧生效）。
4. 想让 AI 用动作说话：插件配置里开启「具身动作 / 具身表情」（默认关，会多花一点 token）。

---

## 6. 排查与反馈

- **出问题时先开探针**：右键 →「设置面板」→ 最下方「诊断」→ 打开「诊断探针（会刷屏，排查完关掉）」，
  复现一次，然后把 **Alife 日志** 里 `[3D桌宠前端/...]` 那几行发出来。错误与资源加载失败（error / resource-error）
  永远会打印，不受探针开关影响。
- **一键全量自检**：同一个「诊断」小节里，10 组确定性检查（骨架完整性 / 渲染在跑 / 存档往返 /
  部件显隐 / 弹簧骨冻结解冻 / 全通道有效性 / 手指卷向 / 面板数值↔数据 / 生成式验收逻辑 / 取景切边），
  跑完只报「通过 N｜失败 M｜警告 K」+ 失败详情，不改任何设置。
- **环境自检**：「动作 / 舞蹈」小节里，检查 WebGPU / Chromium / Node 版本，判断生成式动作能不能跑。
- 常见现象：
  - 模型不出来 → 看日志有没有 `未配置模型`；用「打开模型文件夹」确认路径与后缀。
  - PMX 灰模 → 贴图目录没跟着拷。
  - 人物不明显/偏小 → 「设置面板 → 相机」里的模型大小与相机距离，或让面板让位（打开面板会自动取景）。

---

## 7. 许可与致谢

- three.js（MIT）、@pixiv/three-vrm（MIT）、ammo.js（zlib）、ONNX Runtime（MIT）随插件分发，版权归各自作者。
- 生成式动作模型 `Llama-3-ARDY-Mini-Core40-Browser` 为**复合许可**
  （NVIDIA Open Model License + Meta Llama 3 + Apache-2.0/CC-BY-4.0）；
  使用/再分发前请阅读下载目录里的 `MODEL_TERMS.md` 与 `NOTICE`。
- 3D 模型与 VMD/VRMA 动作的版权归原作者；本插件**不附带**任何模型或动作资源。
