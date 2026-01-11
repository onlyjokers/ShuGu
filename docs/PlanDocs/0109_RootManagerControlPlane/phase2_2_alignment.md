<!--
Purpose: Phase 2.2 alignment checklist for “same-level capability, misaligned organization”.
Owner: ShuGu / System Architecture
Created: 2026-01-10
Status: Draft (actionable checklist)
-->

# Phase 2.2 组织形式对齐清单（Alignment Targets）

目标：在不新增功能的前提下，把**“同一层级能力却组织/入口分裂”**的问题收敛为单一入口、单一语义、单一目录归属，避免 Phase 3 继续堆叠债务。

执行规则（沿用 Phase 2）：

- 不新增功能；只做结构对齐/重命名/迁移/删除。
- 每个 item 都必须明确 **Single Source of Truth**。
- 每完成一批：`pnpm guard:deps` + `pnpm lint` +（推荐）`pnpm build:all` + Phase 1 回归。

---

## 2.2-1 Visual Effect：Legacy 命令 vs Effect 链

现状（证据）：

- 旧命令（`asciiMode/asciiResolution/convolution`）已从运行时路径移除，视觉后处理统一走 `visualEffects`。
- Legacy 节点（`proc-visual-effect-*`）已删除。
- Client 移除了 `syncLegacyVisualEffects()` 的旧胶水。

目标组织：

- 视觉后处理只保留 **Effect 链**（`visualEffects`）作为唯一入口。
- Legacy 命令仅作为短期“翻译器”或完全移除。

可执行步骤：

1. 将 `proc-visual-effect-*` 标记为 deprecated，或迁移为输出 effect chain。
2. Manager/SDK 侧停止对 `asciiMode/asciiResolution/convolution` 的直接调用。
3. Client 侧移除 `syncLegacyVisualEffects()` 及 legacy stores（或改为兼容期翻译层）。

验收：

- `rg "asciiMode|asciiResolution" apps/client apps/manager packages/node-core packages/sdk-manager`  
  无运行时命中（仅允许文档/历史说明）。
- `rg "action: 'convolution'|action: \\\"convolution\\\"\" apps/client apps/manager packages/node-core`  
  无运行时命中。

状态：完成（legacy 命令与节点已移除）

---

## 2.2-2 Scene type vs Plugin id 的映射不统一

现状（证据）：

- 协议层 scene type：`box|mel|frontCamera|backCamera`。
- 插件 id：`box-scene|mel-scene|ascii-scene`（并未统一）。
- 映射逻辑写死在 `VisualCanvas`。

目标组织：

- 统一映射表/注册表：**一个地方定义 type↔id**，业务只调用该入口。

可执行步骤：

1. 在 `@shugu/visual-plugins` 或 `@shugu/protocol` 新增 `sceneRegistry`（type/id 一对一映射）。
2. `VisualCanvas` 只使用 registry，不再硬编码字符串。
3. 依赖该映射的地方统一迁移。

验收：

- `rg "box-scene|mel-scene" apps/client` 只命中 registry 文件。

状态：完成（registry 已落地）

---

## 2.2-3 Camera 作为 Scene 但未插件化

现状（证据）：

- `frontCamera/backCamera` 被定义为 Scene Layer item，但实现仍在 `VisualCanvas` 的 video overlay。

目标组织（二选一）：

- **A)** Camera Scene 插件化（`@shugu/visual-plugins`），与 Box/Mel 同级。
- **B)** 明确“例外层”（文档化），从 Scene Layer 中剥离。

可执行步骤（选 A 时）：

1. 新增 `CameraScene` 插件（front/back 作为参数或两种 id）。
2. `applySceneLayer()` 只负责启用插件，不再内联 video overlay。
3. 更新 Scene 管理与 DOM 顺序逻辑。

验收：

- VisualCanvas 中不再存在 camera-specific DOM 叠层逻辑（或在 ARCHITECTURE 中明确例外）。

状态：完成（选 B：记录为例外；见 `docs/ARCHITECTURE.md`）

---

## 2.2-4 ASCII 命名冲突（Scene vs Effect）

现状（证据）：

- `ascii` 同时存在于 **Effect 链** 与 **Scene 插件**（`ascii-scene`），语义不同。

目标组织：

- **命名显式化**：避免同名但语义不同（例如 `mel-ascii-scene`）。

可执行步骤：

1. 重命名 `ascii-scene` → `mel-ascii-scene`（含 id 与导出入口）。
2. 更新 `VisualPluginId` 与引用点。
3. 若不再使用该插件，则直接移除。

验收：

- 不再出现两个不同能力共享 `ascii` 命名且无限定词。

状态：完成（已改名为 `mel-ascii-scene`）

---

## 2.2-5 ScreenColor 语义归属

现状（证据）：

- `screenColor` 当前是 Control Action + Overlay，但语义接近 Scene Layer。

目标组织（二选一）：

- **A)** 迁入 Scene Layer（例如 `scene-screen-color` 或 layer player），与 `scene-mel` 同级。
- **B)** 保持 Control Overlay，但明确改名/文档说明避免误解。

可执行步骤（选 A 时）：

1. 添加 Scene 插件 or Scene Layer Player。
2. Manager 改为 `visualScenes` 控制入口。
3. Display/Client 渲染改为 Scene 链路，删除 `screenColor` 直控。

验收：

- ScreenColor 只存在单一入口（Scene 或 Control），无双通路。

状态：完成（选 B：保持 Control Overlay；见 `docs/ARCHITECTURE.md`）

---

## 2.2-6 Scene vs Effect 的职责边界（Base Frame vs Post-Process）

现状（证据）：

- `VisualCanvas` 同时承担 base-frame 合成 + effect pipeline 管理，职责边界模糊。

目标组织：

- Base layer 合成抽到单一模块（例如 `visual-layer`），Effect pipeline 固定走 `@shugu/visual-effects`。

可执行步骤：

1. 抽 `drawBaseFrame` / base-layer 合成逻辑为独立模块。
2. Display/Client 若需复用，直接使用同一模块。

验收：

- `VisualCanvas` 只负责编排（数据源 + pipeline 调用），不含具体合成算法。

状态：完成（base-frame 已抽出）

---

## 建议执行顺序（Phase 2.2）

1. 2.2-2（Scene 映射统一）  
2. 2.2-3（Camera 插件化 or 例外决策）  
3. 2.2-4（ASCII 命名冲突）  
4. 2.2-5（ScreenColor 归属）  
5. 2.2-1（Effect Legacy 彻底合并）  
6. 2.2-6（职责边界抽离）

每一步都需要完成 Phase 1 回归并记录。
