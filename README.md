# presents.DeskPet3D · 3D桌宠

提供可被 AI 驱动的 3D 桌宠身体，支持 VRM 模型（表情 / 动画 / 弹簧骨 / 视线）与 PMX + VMD 模型（IK / 物理 / 打光，可跳舞）。AI 可以通过它表达自己，并接收互动反馈。

包含两个模块：

- **3D桌宠控制** —— 把 AI 连接到桌宠身体，用桌宠表达自己并接收互动反馈。
- **3D桌宠** —— VRM / PMX+VMD 身体本体。

模型放在 `Storage/<角色>/ThreeDeskPet/Models/<名称>/` 下，不随插件分发。

## 安装

解压后目录名必须与插件 id 一致（`presents.DeskPet3D`），放到 Alife 的 `Storage/Plugins/` 下，重启后由客户端自行编译加载。依赖 `Alife.Function.FunctionCaller` 与 `Alife.Function.MessageFilter`。

## 版本

当前版本 **5.0.0**，发布包见 [Releases](https://github.com/presents0721/presents.DeskPet3D/releases)。

插件大版本与 Alife 大版本对应：5.x 只给 Alife 5.0.0+ 用，4.x 请勿安装或更新到 5.x（两条线功能一致，底层接口按版本适配）。

## 源码

仓库结构即插件目录结构：`manifest.json` + `*.cs` + `Resources/`。运行时产生的 `out/`、`state.json` 等不进仓库（见 `.gitignore`）。
