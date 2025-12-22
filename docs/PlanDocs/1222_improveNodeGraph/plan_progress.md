# Node Graph Improvement Plan - 执行进度

## 执行时间线

### 2025-12-22

#### Step 0 — 基线、观测与安全网 ✅
#### Step 1 — 立即止血 ✅

#### Step 2 — 渲染器迁移 (XYFlow Route A) 🔄

**已完成:**
- [x] Step 2.1.1: GraphViewAdapter 接口 (`adapters/graph-view-adapter.ts`)
- [x] Step 2.1.2: ReteAdapter 实现 (`adapters/rete-adapter.ts`)
- [x] Step 2.1: Adapter 集成到控制器/NodeCanvas（group/loop/midi/minimap 全部走 adapter）
- [x] Step 2.2.1: 路线 A 确认 (@xyflow/svelte)
- [x] Step 2.2.2: XYFlowRenderer 骨架
- [x] Step 2.2.3: 节点控件 + Live values（inline number/boolean/color + config controls + `ng_live` 开关）
- [x] Step 2.2.4: 高亮数据传递（node/edge: active/localLoop/deployedLoop + ports）
- [x] Step 2.2.5: 虚拟化 (onlyRenderVisibleElements)
- [x] 路由切换 (+page.svelte → NodeCanvasRenderer)
- [x] Step 2.3: Overlays 迁移（Toolbar / NodePicker / Group / Loop / Marquee / Minimap / Logs）

**待完成:**
- [ ] Step 2.4: XYFlow parity（Patch/Override/Clipboard/Hotkeys，保持 flag 默认走 Rete）

---

## 已创建文件

```
adapters/                          # 渲染器抽象层
├── graph-view-adapter.ts          # 接口
├── rete-adapter.ts                # Rete 实现
├── xyflow-adapter.ts              # XYFlow 实现
node-canvas-xyflow/                # XYFlow 渲染器
├── NodeCanvasXYFlow.svelte        # 主组件 (骨架)
├── XYFlowNode.svelte              # 自定义节点
├── XYFlowEdge.svelte              # 自定义边
NodeCanvasRenderer.svelte          # 渲染器切换
```

---

## 当前状态

XYFlow 渲染器可通过 `?ng_renderer=xyflow` 或 Toolbar DEV 菜单切换访问（默认仍为 Rete）：
- ✅ 基本节点/边渲染（含 onlyRenderVisibleElements）
- ✅ 拖拽移动 / 缩放 / 平移
- ✅ Toolbar / Overlays（Picker / Group / Loop / Marquee / Minimap / Logs）
- ✅ Loop / Group / MIDI 高亮链路（通过 GraphViewAdapter 复用控制器逻辑）
- ✅ 节点控件编辑（inline number/boolean/color + config controls）
- ✅ Live port values（并接入 `ng_live` 开关）
- ❌ Patch（audio-out）自动 deploy/stop/remove、override TTL/commit、copy/paste 等仍未迁移（因此保持 flag 默认走 Rete）
