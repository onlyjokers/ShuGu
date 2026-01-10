# 0109 Root/Manager ControlPlane Plan - 执行进度

> Purpose: 记录本计划（`docs/PlanDocs/0109_RootManagerControlPlane/plan.md`）的执行日志与勾选状态。

## 总进度

- [x] Phase 0：大清洗与新骨架（先解耦/删冗余/拆巨石；不引入新功能）
- [x] Phase 1：功能回归（保证“现有全部能力”在新骨架上跑通）
- [x] Phase 1.5：Pre-Phase2 Gate（基线固化 / 架构地图 / 质量闸门）
- [ ] Phase 2：删除旧实现（只保留一套路径）+ 关键护栏落地（防止再变屎山）
- [ ] Phase 3：Root/Manager 形态重构（同一 app：`/root` + `/manager`，强制 code-splitting）
- [ ] Phase 4：ControlPlane v2（授权/转交/回溯/收回/终止；Server 仲裁可开关）
- [ ] Phase 5：分布式执行器 v2（授权 client 运行子图并可控他端）
- [ ] Phase 6：插件体系一致化（Tone / 多媒体 / Visual / AI 统一契约）
- [ ] Phase 7：多 Display 输出与输出路由（多屏、远程/本地通道统一）
- [ ] Phase 8：AI 接口与模型资产化（后台下载；未启用 0 计算开销；手机本地推理）
- [ ] Phase 9：工程化：测试、可观测性、性能预算（演出级稳定性）

---

## 执行日志

### 2026-01-09

- [ ] 初始化：设计冻结（待你确认关键决策点）
- [x] Phase 0 启动：新增依赖护栏脚本 `scripts/guard-deps.mjs`（阻止 deep-import；约束 protocol/node-core 依赖）。
- [x] Phase 0 验证：运行 `node scripts/guard-deps.mjs`（无违规）。
- [x] Phase 0 文档产出：新增 `docs/PlanDocs/0109_RootManagerControlPlane/phase0_artifacts.md`（依赖规则 v0 / 删除清单 v1 / 回归清单 v1）。
- [x] Phase 0 拆分：`packages/node-core/src/definitions.ts` 拆为 `packages/node-core/src/definitions/*` 模块，保留原有导出入口。
- [x] Phase 0 验证：运行 `pnpm --filter @shugu/node-core run lint`（仅 warnings：no-explicit-any / unused-vars，历史问题未处理）。
- [x] Phase 0 拆分：`apps/manager/src/lib/components/nodes/NodeCanvas.svelte` 拆出 runtime 模块 `apps/manager/src/lib/components/nodes/node-canvas/runtime/*`（patch 部署/override、client selection、sleep socket sync）；主文件 3793 → 2295 行。
- [x] Phase 0 验证：运行 `pnpm --filter @shugu/manager run lint`（0 errors；warnings 为历史问题 + TS 版本提示）。
- [x] Phase 0 拆分：继续按职责拆分 `apps/manager/src/lib/components/nodes/NodeCanvas.svelte`，新增 controller/utils 模块：
  - `apps/manager/src/lib/components/nodes/node-canvas/controllers/focus-controller.ts`
  - `apps/manager/src/lib/components/nodes/node-canvas/controllers/group-port-nodes-controller.ts`
  - `apps/manager/src/lib/components/nodes/node-canvas/controllers/clipboard-controller.ts`
  - `apps/manager/src/lib/components/nodes/node-canvas/controllers/frame-drag-controller.ts`
  - `apps/manager/src/lib/components/nodes/node-canvas/utils/group-port-utils.ts`

  主文件 2295 → 1573 行。
- [x] Phase 0 格式化：运行 `pnpm exec prettier --write apps/manager/src/lib/components/nodes/NodeCanvas.svelte`（修复 tab/space 混用，避免 eslint `no-mixed-spaces-and-tabs`）。
- [x] Phase 0 验证：运行 `pnpm --filter @shugu/manager run lint`（0 errors；warnings 为历史问题 + TS 版本提示）。
- [x] Phase 0 Transport：新增 Display transport 抽象骨架 `apps/manager/src/lib/display/display-transport.ts`（local MessagePort bridge 优先；未 ready 时 server `group=display` fallback）。
- [x] Phase 0 收敛：`apps/manager/src/lib/stores/manager.ts`、`apps/manager/src/lib/nodes/specs/register.ts` 的 Display 控制发送统一走 `displayTransport.sendControl(...)`（减少重复判断/offset 换算）。
- [x] Phase 0 验证：运行 `pnpm --filter @shugu/manager run lint`（0 errors；warnings 为历史问题 + TS 版本提示）。
- [x] Phase 0 拆分：`apps/client/src/lib/stores/client.ts` 拆为可维护模块（保留 `$lib/stores/client` 单入口导出）：
  - `apps/client/src/lib/stores/client/client-state.ts`（state/permissions/latency）
  - `apps/client/src/lib/stores/client/client-visual.ts`（visual scenes/camera/effects）
  - `apps/client/src/lib/stores/client/client-media.ts`（audioStream + media clip + video/image state）
  - `apps/client/src/lib/stores/client/client-control.ts`（executeControl + plugin control）
  - `apps/client/src/lib/stores/client/client-runtime.ts`（SDK lifecycle + controllers + permissions flow）
  - `apps/client/src/lib/stores/client/client-tone.ts`（Tone enablement + readiness reporting）
  - `apps/client/src/lib/stores/client/client-screenshot.ts`（push-image-upload 截图上传）
  - `apps/client/src/lib/stores/client/client-identity.ts`（device/session identity）
  - `apps/client/src/lib/stores/client/client-utils.ts`（shared utils）
- [x] Phase 0 验证：运行 `pnpm --filter @shugu/client run lint`（0 errors；warnings 为历史问题 + TS 版本提示）。
- [x] Phase 0 拆分：`packages/sdk-client/src/tone-adapter.ts` 拆为可维护模块（保留原入口为薄导出层）：
  - `packages/sdk-client/src/tone-adapter/engine-host.ts`（Tone 加载 / transport / graph wiring）
  - `packages/sdk-client/src/tone-adapter/nodes.ts`（node instances + loop/scheduling + audio-data）
  - `packages/sdk-client/src/tone-adapter/register.ts`（NodeRegistry definitions）
  - `packages/sdk-client/src/tone-adapter/state.ts`（shared state/constants）
  - `packages/sdk-client/src/tone-adapter/utils.ts`（parsing helpers）
  - `packages/sdk-client/src/tone-adapter/types.ts`（shared types）
- [x] Phase 0 验证：运行 `pnpm --filter @shugu/sdk-client run lint`（0 errors；warnings 为历史问题 + TS 版本提示）。

### 2026-01-10

- [x] Phase 1 固定验证命令：
  - `pnpm guard:deps` ✅
  - `pnpm --filter @shugu/node-core run test` ✅
  - `pnpm --filter @shugu/sdk-client run build` ✅
  - `pnpm --filter @shugu/manager run build` ✅（有 chunk size / svelte warnings，历史问题未处理）
  - `pnpm --filter @shugu/client run build` ✅（有 svelte warnings，历史问题未处理）
- [x] Phase 1 回归环境（为避开默认端口占用，统一用一套 dev 端口）：
  - Server：`https://localhost:3002`（`PORT=3002`；`ASSET_WRITE_TOKEN=dev-write`）
  - Manager：`https://127.0.0.1:5176/manager`
  - Client：`https://127.0.0.1:5177/?server=https://localhost:3002&e2e=1`
  - Display：`https://127.0.0.1:5175/display`
- [x] Phase 1 回归 playbook：新增 `docs/PlanDocs/0109_RootManagerControlPlane/phase1_regression_playbook.md`（下次回归复用指南 + 常见坑排查）。
- [x] Phase 1 回归清单 v1（`phase0_artifacts.md:66`）逐项验证：
  - [x] Control chain：Manager -> Server -> Client 控制链路 OK（`screenColor` Play/Stop Selected 生效）。
  - [x] Control chain：Manager -> Display local bridge OK（DisplayPanel `status=connected / ready=yes`；`Send To Display` 开启后 `screenColor` 可镜像到 Display）。
  - [x] Node graph & runtime：编辑/loop/scene OK（构造 `client-object <-> proc-client-sensors` 环；`localLoops=1`；`exportGraphForLoop` OK）。
  - [x] Node graph & runtime：deploy/export/import OK（`exportGraphForPatchFromRootNodeIds(scene-out)` OK；`exportGraph/loadGraph` round-trip OK）。
- [x] Node graph & runtime：功能集冒烟 OK（覆盖 `screenColor / flashlight / showImage/hideImage / visualScenes(mel-scene)` 等关键动作）。
  - [x] Assets & media：manifest 扫描 + 下发 OK（上传 `测试.png` 后 manifest 更新，ClientSelector dot 进入 `ready`；Display 侧 `multimediaCore` preload ready）。
- [x] Assets & media：Client 多媒体层语义 OK（`showImage`/`hideImage`、`visualScenes` 行为正确）。
  - [x] Assets & media：媒体动作 OK（`image upload`、`flashlight on/off`、`mel-scene` 切换、`screenColor`）。
  - [x] Stability：Manager 在 Start/Stop/Deploy/Scene switch 冒烟流程中未崩（tab 仍可切换）。
  - [x] Stability：高频控件 OK：开启 `▶ Stream On` 后，连续改动 ScreenColor 参数可产生多次 `screenColor` 下发（1s 内 `delta=5`）。
- [x] Phase 1 回归中发现并修复的问题（为保证 checklist 全绿）：
  - [x] 修复：Assets `HEAD /content` 500（非 ASCII filename 导致 Node header `ERR_INVALID_CHAR`）→ 改为 ASCII fallback `filename=\"...\"` + RFC 5987 `filename*=`。文件：`apps/server/src/assets/assets.controller.ts`。
  - [x] 修复：Server dev 输出目录权限问题（历史 `dist-dev` 为 root-owned 导致 watch unlink 失败）→ `apps/server/tsconfig.dev.json`：`outDir` 改为 `./dist-dev-local`。
  - [x] 修复：Display 在 server fallback 后无法 Reconnect 回到 local（MessagePort）+ local ready 上报只发一次 → `apps/display/src/lib/stores/display.ts`：允许 late-pair、ready 分通道上报、local 模式忽略 server control/plugin/media、dev 允许同 hostname 任意端口 origin。
  - [x] 修复：Manager 的 `Stream On` 更新路径不触发（reactive deps 缺失）→ `apps/manager/src/lib/features/*/*Control.svelte`：`queueUpdate(...)` 改为显式参数驱动（ScreenColor/Flashlight/Synth）。

- [x] Phase 1.5.A 基线固化：
  - `git status --porcelain` ✅（clean）
  - Tag：`phase1-baseline-20260110` ✅（annotated tag；commit: `01934da3`）
- [x] Phase 1.5.B 质量闸门：
  - `pnpm guard:deps` ✅（`[deps-guard] ok (602 files scanned)`）
  - `pnpm lint` ✅（0 errors；warnings 为历史债，当前共 63 warnings，以 `no-explicit-any`/unused-vars 为主）
  - `pnpm build:all` ✅（通过；有 chunk size / vite-plugin-svelte warnings，作为 Phase 3 code-splitting 的证据锚点）
- [x] Phase 1.5.C 架构地图：新增 `docs/ARCHITECTURE.md` ✅（repo map / 数据流 / 入口索引 / hotspots）。
- [x] Phase 1.5.D 本地生成物治理：新增 `pnpm clean:artifacts` ✅（见 `scripts/clean-artifacts.mjs`）。
  - 注：如果 clean 输出 `EACCES/EPERM`，说明历史生成物是 root-owned（曾用 sudo build）；需要一次性 `sudo chown -R $(whoami) <path>` 修复。
- [x] Phase 1.5.E Phase 2 输入准备：新增“删除清单 v2”✅
  - `docs/PlanDocs/0109_RootManagerControlPlane/phase2_targets.md`
  - 并在 `docs/PlanDocs/0109_RootManagerControlPlane/plan.md` 链接该清单。

- [x] Phase 2 Batch #1（Display routing 去旁路 / section 1；commit: `dbfb1e1`）：
  - [x] 收敛：Manager 内 Display 发送统一经 `apps/manager/src/lib/display/display-transport.ts`（移除 NodeCanvas/patch-runtime 的 local bridge 旁路）。
    - `apps/manager/src/lib/stores/manager.ts`：导出 `displayTransport` 供复用。
    - `apps/manager/src/lib/components/nodes/NodeCanvas.svelte`：不再直调 `sendLocalDisplayPlugin`。
    - `apps/manager/src/lib/components/nodes/node-canvas/runtime/patch-runtime.ts`：Display 目标发送改为 `displayTransport.sendPlugin(..., { localOnly: true })`。
    - `apps/manager/src/lib/nodes/specs/register.ts`：改为复用 store 的 `displayTransport`（不再自行组装 local sender）。
    - `apps/manager/src/lib/display/display-transport.ts`：新增 `localOnly` 选项，用于需要“仅 paired Display”的 callsite。
  - [x] Acceptance hook：`rg "sendLocalDisplay|targetGroup\\('display'\\)" apps/manager/src` 仅命中 `display-transport.ts` 与 store wiring。
  - [x] Phase 2 固定动作（batch after-delete gates）：
    - `pnpm guard:deps` ✅（`[deps-guard] ok (493 files scanned)`）
    - `pnpm lint` ✅（0 errors；63 warnings 为历史债）
    - `pnpm build:all` ✅（通过；仍有 vite/svelte warnings，留作 Phase 3 证据锚点）
  - [x] 回归（Playbook+自动化）：
    - `pnpm --filter @shugu/node-core run test` ✅（24/24）
    - `pnpm e2e:node-executor:offline` ✅
    - `pnpm e2e:node-executor` ✅（补齐 e2e 环境/脚本与 server allowlist，使 loop deploy 状态可回传）
      - 修复：`apps/manager/src/lib/components/nodes/node-canvas/controllers/loop-controller.ts` 绑定 nodeEngine 方法，避免 `this` 丢失导致 deploy 报错。
      - 修复：`apps/server/src/message-router/message-router.service.ts` 允许转发 `custom.kind=node-executor`，否则 Manager 收不到 deployed/rejected 事件（Loop deploy 会 timeout）。
      - 改进：`scripts/e2e/node-executor.mjs` 在未安装 Playwright Chromium 时 fallback 到系统 Chrome，并补齐 Start/Select All 等前置步骤。
      - 关联计划：PlanB（Client Recursive NodeGroup / NodeExecutor），详见 `docs/PlanDocs/1217_ClientRecursiveNodeGroup/Plan_porgress.md`。
  - [x] 手动回归（Display local bridge）：按 `phase1_regression_playbook.md` 复查 DisplayPanel pairing + Send To Display ✅
    - 过程：Manager 登录/Connect → 打开 Display → 点击 Reconnect 确保 local pairing → 状态 `status=connected` + `ready=yes`。
    - 结果：开启 `Send To Display` 后执行 `Screen Color / Play All`，Display 出现 `.screen-overlay`（opacity=1）。
    - 备注：Assets / Media / 稳定性未在本批复跑（沿用 Phase 1 结论）。

- [x] Phase 2 Batch #2（Audio execution：移除 legacy players / `phase2_targets.md` section 3）：
  - [x] 目标：在 `packages/sdk-client/src/action-executors.ts` 删除 deprecated/legacy player（优先 `ModulatedSoundPlayer`），并确保 Tone 路径覆盖 Phase 1 所需动作。
    - 删除 `ModulatedSoundPlayer`（仅保留 `ToneModulatedSoundPlayer`）。
  - [x] 固定动作（batch after-delete gates）：
    - `pnpm guard:deps` ✅（`[deps-guard] ok (508 files scanned)`）
    - `pnpm lint` ✅（0 errors；63 warnings 为历史债）
    - `pnpm build:all` ✅（通过；vite/sass deprecation warnings 仍在）
  - [x] 回归：按 `phase1_regression_playbook.md`（尤其关注移动端音频策略 / user gesture / AudioContext）。
    - 用户手动真机验证：Tone enable/ready 正常；Synth Play/Update/Stop ✅；`Stream On` 下参数更新稳定、不丢声。

- [x] Phase 2 Batch #3（Visual scenes：收敛 legacy single-scene vs multi-scene / `phase2_targets.md` section 4；commit: `42315ec`）：
  - [x] 决策：采用 multi-scene（`visualScenes` 为唯一语义），移除单场景分支。
  - [x] 清理与收敛：
    - Protocol：移除 `visualSceneSwitch`/`visualSceneBox`/`visualSceneMel`/`visualSceneFrontCamera`/`visualSceneBackCamera`。
    - Manager：SceneControl 改为多场景 toggle → 发送 `visualScenes`；bootstrap 改为 `scenes[]`。
    - Client：以 `visualScenes` 为唯一输入，移除 `currentScene`/legacy handlers；启动配置改为应用 `scenes[]`。
    - Visual plugins：SceneManager 移除 `switchTo/getCurrentScene`（只保留 multi-scene）。
    - Node/Core：删除 legacy scene processor nodes + Manager specs（proc-visual-scene-*）。
  - [x] 固定动作（batch after-delete gates）：
    - `pnpm guard:deps` ✅（`[deps-guard] ok (554 files scanned)`）
    - `pnpm lint` ✅（0 errors；63 warnings 为历史债）
    - `pnpm build:all` ✅（通过；vite/sass deprecation warnings 仍在）
  - [x] 回归：Phase 1 checklist 中 `visualScenes` / mel-scene / VisualCanvas 相关项全绿（用户手动验证）。
    - 结果（2026-01-10）：Scene Layer（Box/Mel toggle）✅；mel-scene ✅；VisualCanvas ✅。
    - 媒体动作：`showImage` / `hideImage` / `screenColor` ✅。
    - 稳定性：Start/Stop/Deploy/Scene switch loop ✅。

- [x] Phase 2 Batch #4（Media：VideoPlayer 去重复 / `phase2_targets.md` section 2；commit: `98d076a`）：
  - [x] 决策：选 A（抽到 `packages/ui-kit`）。
  - [x] 清理与收敛：
    - `packages/ui-kit` 新增共享 `VideoPlayer` 组件（Client/Display 共用）。
    - 删除 `apps/client`/`apps/display` 内重复的 `VideoPlayer.svelte`。
    - 入口改为从 `@shugu/ui-kit` 引用；`ui-kit` 增加 `@shugu/multimedia-core` 依赖与 `svelte-shims.d.ts`。
  - [x] 固定动作（batch after-delete gates）：
    - `pnpm guard:deps` ✅（`[deps-guard] ok (555 files scanned)`）
    - `pnpm lint` ✅（0 errors；57 warnings 为历史债）
    - `pnpm build:all` ✅（通过；vite/sass deprecation warnings 仍在）
  - [x] Acceptance hook：
    - `rg -n "\\$lib/components/VideoPlayer\\.svelte|\\$components/VideoPlayer\\.svelte" apps` 无命中。
    - `rg -n "import \\{ VideoPlayer \\} from '@shugu/ui-kit'" apps` 仅命中 Client/Display 调用点。
  - [x] 回归：Phase 1 checklist 中媒体动作（playMedia/showImage/hideImage 等）全绿（用户手动验证）。
    - 结果（2026-01-10）：`playMedia` / `showImage` / `hideImage` / `screenColor` ✅。
    - 备注：用户反馈 Screen Color 语义更贴近 Scene Layer Player，建议后续重分类。

- [ ] Phase 2 Batch #5（Transitional glue：一次性迁移脚本/历史兼容胶水 / `phase2_targets.md` section 5）：
  - [ ] 目标：对“无 owner 的过渡脚本/迁移逻辑”做删/收口（删除或改成显式手动导入动作）。
  - [x] 5A DataURL migration：移除 `migrate-dataurls` 与 Assets Manager 入口。
  - [x] 5A 固定动作（batch after-delete gates）：
    - `pnpm guard:deps` ✅（`[deps-guard] ok (543 files scanned)`）
    - `pnpm lint` ✅（0 errors；warnings 为历史债 + ui-kit any）
    - `pnpm build:all` ✅（通过；vite/sass warnings 仍在）
  - [x] 5A 回归：Phase 1 checklist 全绿（用户手动验证）。
    - 结果（2026-01-10）：Assets Manager 正常加载；Refresh/Upload ✅（DataURL 迁移入口已移除）。
  - [x] 5B MIDI legacy migrations：移除 legacy MIDI 绑定迁移路径。
    - 删除 `midi-param-bridge`（旧 localStorage 绑定系统）。
    - 删除 `migrateLegacyMidiParamBindings` 与 Registry MIDI Panel 启动迁移。
  - [x] 5B 固定动作（batch after-delete gates）：
    - `pnpm guard:deps` ✅（`[deps-guard] ok (542 files scanned)`）
    - `pnpm lint` ✅（0 errors；57 warnings 为历史债）
    - `pnpm build:all` ✅（通过；vite/sass warnings 仍在）
  - [x] 5B 回归：Phase 1 checklist 全绿（用户手动验证）。
    - 结果（2026-01-10）：Registry MIDI 模板导入/导出 ✅；Node Graph 基本操作/Deploy ✅；控制链路 ✅。
  - [x] 5C Console 功能拔除：移除 Console 卡片与相关状态（仅保留 Node Graph）。
    - 删除 `apps/manager/src/lib/features/**` 下 Console 卡片（Synth/Media/Flashlight/ScreenColor/Vibration/Scene）。
    - 删除 `apps/manager/src/lib/stores/controlState.ts`、`apps/manager/src/lib/streaming/streaming.ts`。
    - 移除 `Global Sync`/`Stream On`/`Require Tone Ready` 的死 UI（原仅用于 Console 控件的 executeAt/节流路径）。
  - [x] 5C Bootstrap 拔除：删除 Server `bootstrap` module 与 Client 侧 bootstrap 拉取/应用。
    - Server：移除 `/bootstrap/*`（controller/service/module）并从 `apps/server/src/app.module.ts` 删除引用。
    - Client：启动只从 `/geo/fence` 获取围栏（不再拉取 `/bootstrap/config`）。
  - [x] 5C 固定动作（batch after-delete gates）：
    - `pnpm guard:deps` ✅（`[deps-guard] ok (542 files scanned)`）
    - `pnpm lint` ✅（0 errors；57 warnings 为历史债）
    - `pnpm build:all` ✅（通过；vite/sass warnings 仍在）
  - [ ] 5C 回归：Phase 1 checklist 全绿（重点：Assets/Display/NodeGraph/媒体动作；Console 已移除则不再作为回归入口）。
