<!-- Purpose: 1221 新多媒体资源系统（资源库/预加载）+ Tone 单音频引擎统一 + Max/MSP 式“可部署音频 Patch（不依赖 Loop）” 的总体计划与可执行落地步骤。 -->

# 1221_newMultiMediaSystem 计划（资源库 + Multimedia-Core + Max/MSP 式多媒体 Patch）

更新时间：2025-12-22

> 这份文档是“做事用”的：把目标拆成明确的系统边界、接口标准、数据模型、逐步实现步骤、验收标准与回滚策略。  
> 你可以把它当作一个可持续更新的 RFC / 技术实施路线图。

---

## 0. 目标重申（必须同时满足）

### 0.1 资源预加载系统（资源数据库）

1. 要有一个“资源数据库”（Asset/Resource DB），能接收 **音频 / 图片 / 视频**。
2. Client/Manager 在需要资源时，通过 **固定的 HTTPS 请求**获取资源内容（未来更换服务器/对象存储/第三方托管时尽量好迁移）。
3. 资源获取的接口标准尽量贴近常见公共标准（HTTP GET、Range、ETag、Cache-Control 等），避免耦合 ShuGu 私有协议。

### 0.2 单一音频系统：Synth 必须迁移到 Tone.js

1. 现在项目里存在两套音频链路：Tone 节点（Tone.js）+ Sound/Synth（原生 WebAudio）。这是不可接受的。
2. `Synth(update)`/`modulateSoundUpdate` 必须 **保留现有所有特性**，但底层统一到 Tone.js（同一个 audio context / 同一个 master chain）。

### 0.3 不再依赖 Loop 才能操纵音频（Max/MSP 模式）

1. Manager 上编辑 Node Graph，Client 上实时发声。
2. 音频 patch 的部署不应依赖 “loop 检测（SCC + sensors）” 这种机制；应支持像 Max/MSP 一样自由连线。
3. 实时调参只能走小消息（override/param），**绝不通过 msg 链路传大音频内容**。

### 0.4 单一真相源（Single Source of Truth）

1. 节点类型/端口/schema/序列化结构必须只有 **一个真相源**（建议以 `@shugu/node-core` 为唯一来源）。
2. Manager 的 UI 展示可以做“派生/装饰”（label、布局、UI 控件样式），但不能出现与 node-core 不一致的端口类型/配置字段定义。
3. Client 的运行时能力（多媒体、executor、资源缓存）必须 **解耦于 apps/client（SvelteKit）**，以便未来把 Manager 控制对象从“client”扩展到其他实体（例如新的可控设备/渲染端/机器人等），仍可复用同一套 runtime。

---

## 1. 现状盘点（关键问题与根因）

> 这里不是抱怨，是为了避免“头痛医头”。

### 1.1 资源与传输

- Manager 侧 `file` 控件当前走 `FileReader.readAsDataURL`，把整个文件编码成巨大的 base64 字符串写进 graph config；这会污染：
  - Graph deploy payload（发给 client 的 node-executor）
  - Graph 存盘/导出
  - 任何 override/config 更新链路
- 这与“不能通过 msg 链路传大音频”的目标直接冲突。

### 1.2 音频系统重复

- `SoundPlayer` / `ModulatedSoundPlayer`（Synth）在 `@shugu/sdk-client` 内部创建自己的 `AudioContext`（原生 WebAudio）。
- Tone 节点（`tone-adapter`）又动态 import Tone 并使用 Tone 的 context。
- 结果：同一 client 上可能存在 **多个 AudioContext**，以及两套音量/输出链路，行为不可控、难排查、移动端更容易出问题。

### 1.3 部署模型不符合 Max/MSP

- Manager 当前只会把“符合 loop 规则的子图”导出给 client（且要求包含 `proc-client-sensors` 等），这对“纯音频 patch”是天然不友好。
- 这导致用户为了部署音频不得不“造 loop”、强行连 sensors 或自环，属于 UI/架构强迫症，不是目标系统应有行为。

### 1.4 Tone 节点组的“数字输出”困惑：UI 语义与运行时语义不一致

你观察到的“Tone 系列节点输出都是数字节点”，本质上是 **Manager 端展示（spec）与 Client 端运行时（tone-adapter）存在漂移**：

1. **Manager 的 Tone 节点 specs 把音频端口标成了 `number`**
   - 例如 `apps/manager/src/lib/nodes/specs/tone-delay.json` 里 `in/out` 都是 `number`。
   - 因此 UI 上的 socket/连线看起来就是“数字线”，直觉上像在传一个数。

2. **Client 实际上并不是在“用数字传音频样本”**
   - 音频真正的 signal flow 发生在 client 的 Tone.js AudioGraph 中（`packages/sdk-client/src/tone-adapter.ts`）。
   - tone-adapter 通过 node 类型（`tone-delay/tone-player/...`）+ 端口 id（`in/out/value`）去识别“哪些连接是音频连接”，然后在 Tone 里把节点 connect 起来。

3. **“数字如何调制音频”的答案：数字不是音频本体，而是参数控制流（control-rate）**
   - 在当前体系里，NodeRuntime 仍然会 tick（通常 33ms 一次）去计算数值节点（`number/lfo/math/...`）的输出。
   - tone-adapter 读取这些输入数值，把它们写入 Tone 节点的参数（例如 delay 的 `delayTime/wet/feedback`），通过 `rampTo/setValueAtTime` 等方式平滑更新。
   - 也就是说：数字线在语义上更像 Max 里的控制信号（control message/CV），而不是 `~` 音频线。

4. 这套实现的问题（也是你直觉“不对劲”的根因）
   - **心智模型错位**：UI 看起来像“数字系统”，但内部在做音频 graph，用户很难理解也很难调试。
   - **误连风险**：没有明确的 `audio` 端口类型，错误连接更容易发生且不报错。
   - **单位/默认值漂移**：node-core / manager-spec / client-runtime 可能各写一份参数定义，久了必然不一致。
   - **调制质量上限**：如果调制来自 tick 的数值节点，本质是控制率更新，极端情况下会产生 stepping/zipper noise（虽可通过 ramp 缓解）。

对应的修复方向（在后文计划里落地）：
- 在 `@shugu/node-core` 引入明确的端口类型 `audio`，并把 Tone 节点的 `in/out/value` 改为 `audio`。
- Manager 不再手写 Tone 节点 spec（或必须由 node-core codegen），从源头消灭 “number masquerading as audio”。
- tone-adapter 的音频连接识别从“硬编码端口表”逐步收敛为“看端口类型/kind”，让语义自洽、可扩展。

---

## 2. 目标架构（最终形态）

### 2.1 三大系统边界

1. **Asset Service（Server）**
   - 负责：上传、去重、存储、元数据索引、按 HTTPS 标准下载（支持 Range）。
   - 输出：稳定的 `assetId` + 可缓存的 `content URL`。

2. **Asset Reference（Protocol/Graph）**
   - Graph 中只保存“轻量引用”（`assetId` 或 `asset:`/`shugu://asset/` scheme）。
   - Client/Manager 通过“解析器”把引用解析为真实 HTTPS URL（未来迁移服务器只改解析器）。

3. **Multimedia-Core（Client 多媒体运行时，包含 Tone 引擎）**
   - 音频：Tone.js（唯一音频引擎）+ 统一 master chain（全局音量/静音/Limiter）。
   - 图片：统一的 image show/hide（用于现有 showImage/hideImage）。
   - 视频：统一的 video 播放/停止/音量/静音/loop（用于现有 playMedia(video)）。
   - 资源：Asset resolver + preload + persistent cache + 校验（sha256/ETag）。
   - 事件：对外只暴露“状态 + 指令 API”，不绑定 Svelte store（apps/client 只做桥接）。

### 2.2 数据流（概念图）

```
Manager UI
  ├─(上传文件)─> Server Asset Service (DB + Storage)
  │               └─ 返回 {assetId, mimeType, size, sha256, urls...}
  ├─(编辑 NodeGraph: 只存 assetId/ref + 参数)─> Server (socket)
  └─(deploy patch + override 参数)────────────> Client (node-executor plugin)

Client
  ├─ MultimediaCore（唯一运行时）
  │    ├─ ToneAudioEngine（唯一 Tone 引擎）
  │    ├─ MediaEngine（image/video 播放控制）
  │    ├─ ResourceStore（preload + 缓存 + 校验）
  │    └─ ReadinessReporter（向 manager 上报 ready 状态）
  └─ NodeExecutor（graph 执行器）
       └─ ToneAdapter（使用 ToneAudioEngine 搭音频链）

### 2.3 Single Source of Truth 的落地方式（强制）

> 这是避免未来再出现 “Manager 端口显示是 number，但 client 其实是 audio sink” 这类结构性 bug 的关键。

**要求：**
- `@shugu/node-core` 作为唯一的节点定义来源（ports/configSchema/types/serialization）。
- Manager 不再维护“会改变语义的 JSON spec”。允许两种模式二选一：
  1) 彻底移除 Tone/核心节点的 JSON specs，Manager 直接从 node-core 注册表读取定义并渲染 UI。
  2) 保留 JSON 作为 UI 皮肤层，但必须由 node-core 生成（build-time codegen），禁止手写导致漂移。

**额外建议（用于 Max/MSP 语义）：**
- 在 node-core 新增端口类型 `audio`（而不是用 `any` 假扮），Manager 渲染独立 socket（`audio`），并在 NodeRuntime 中把 `audio` 端口默认标记为 `kind: 'sink'`（或在音频节点上显式标记）。
  - 好处：UI 更像 Max（audio 线和 control 线分离），且减少误连/误解。
```

---

## 3. 资源数据库与预加载系统（Asset Service）

> 目标：像“一个小型对象存储 + 元数据 DB”，但先落在我们可控的 server 上；未来迁移到 S3/R2/其他 CDN 时改动最小。

### 3.0 资产服务文档（必须维护）

为确保未来 API 迁移/二次开发不踩坑，维护一份独立的服务说明文档：

- `docs/PlanDocs/1221_newMultiMediaSystem/Asset_Service_serve.md`

内容要求：
- API 端点、请求/响应示例、headers（Range/ETag/Cache-Control/CORS）与错误码
- DB schema、StorageAdapter 抽象、部署配置项与安全注意事项
- 迁移指南：从本地存储迁移到 S3/R2/CDN、从固定 URL 迁移到 pre-signed URL 的兼容策略

### 3.1 资源标识与引用格式（Graph/Protocol 侧）

#### 推荐方案（MVP 兼容、迁移成本低）

- Graph/Protocol 仍然使用 `string` 表示资源位置，但引入 **统一 scheme**：
  - `asset:<assetId>`
  - 或 `shugu://asset/<assetId>`
- Client/Manager 内部通过 `AssetUrlResolver` 将其解析为：
  - `https://{server}/api/assets/<assetId>/content`

优点：
- 不需要大范围改协议字段类型（仍是 string），老节点（例如 tone-player 的 url）可直接接受。
- 未来迁移只改 resolver 的“base URL 计算规则”，甚至可变为 pre-signed URL。

#### 资产元信息结构（跨端统一）

```ts
type AssetKind = 'audio' | 'image' | 'video';

type AssetRecord = {
  id: string;            // assetId（主流方案：UUIDv4；内容一致性由 sha256/ETag 负责）
  kind: AssetKind;       // audio/image/video
  mimeType: string;
  sizeBytes: number;
  sha256: string;        // 去重/一致性校验
  originalName: string;
  createdAt: number;     // epoch ms
  updatedAt: number;     // epoch ms

  // 可选：便于 UI 与后续优化
  durationMs?: number;   // audio/video
  width?: number;        // image/video
  height?: number;       // image/video

  // content URL 不一定要存 DB（可由 resolver 生成），但接口返回时可附带
  contentUrl?: string;
};
```

### 3.2 Server 数据库设计（MVP 先落地，后续可换）

> Server 目前是 NestJS，尚未引入 DB。MVP 推荐：SQLite（单文件，易部署）+ StorageAdapter（本地磁盘），未来换 Postgres/S3 改动集中。

#### 表：`assets`

- `id TEXT PRIMARY KEY`（UUIDv4）
- `kind TEXT NOT NULL`（audio/image/video）
- `mime_type TEXT NOT NULL`
- `size_bytes INTEGER NOT NULL`
- `sha256 TEXT NOT NULL UNIQUE`
- `original_name TEXT NOT NULL`
- `storage_backend TEXT NOT NULL`（`localfs` | `s3` | `r2`...）
- `storage_key TEXT NOT NULL`（文件实际存储位置的 key/path）
- `created_at INTEGER NOT NULL`
- `updated_at INTEGER NOT NULL`
- 可选字段：
  - `duration_ms INTEGER`
  - `width INTEGER`
  - `height INTEGER`

索引：
- `UNIQUE(sha256)`（强制：内容去重与一致性基准）
- `INDEX(kind, created_at)`
- `INDEX(updated_at)`

> 注：当 `assets.sha256` 已做 UNIQUE 时，额外的 `asset_aliases` 表不是必需；MVP 可先不建表。

#### 表：`asset_tags` / `asset_usage`（可选：后续 UI 与 GC）

- `asset_tags(asset_id, tag)`
- `asset_usage(asset_id, ref_count, last_seen_at)`

MVP 可先不做，先把“可用的上传/下载/列表”跑通。

### 3.3 StorageAdapter（强制抽象，保证可迁移）

定义一个 storage 接口（server 内部）：

- `put(stream|buffer, {sha256, kind, ext, mimeType}) -> {storageKey}`
- `get(storageKey) -> stream`
- `stat(storageKey) -> {size, modifiedAt}`
- `delete(storageKey)`

MVP 实现：`LocalFsStorage`
- 目录结构建议：`<dataDir>/assets/<sha256Prefix>/<assetId>` 或 `<sha256>`
- 上传流程：
  1) 写入临时文件（避免中途失败污染）
  2) 完成后原子 rename 到最终路径
  3) 记录 DB

未来实现：`S3Storage` / `R2Storage`
- 仅替换 adapter，不改 API。

### 3.4 HTTPS API 设计（尽量贴近常见标准）

> 目标：让 client 以“访问一个普通 CDN 资源”的方式加载；并且支持 video/audio 的 Range（几乎所有现代播放器都会用）。

统一前缀：`/api/assets`

#### 3.4.1 上传（Manager 使用）

`POST /api/assets`
- `Content-Type: multipart/form-data`
- form 字段：
  - `file`: 二进制文件
  - 可选：`kind`（不传则服务端从 mime 推断）
  - 可选：`originalName`

返回（JSON）：
```json
{
  "asset": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "kind": "audio",
    "mimeType": "audio/mpeg",
    "sizeBytes": 123456,
    "sha256": "…",
    "originalName": "foo.mp3",
    "createdAt": 1734740000000,
    "updatedAt": 1734740000000,
    "contentUrl": "https://host/api/assets/550e8400-e29b-41d4-a716-446655440000/content"
  }
}
```

建议行为：
- 若 sha256 已存在：返回已有 asset（可在响应中加 `deduped: true`）。
- 支持大文件：限制上限、返回明确错误（413）。

#### 3.4.2 读取元数据（Manager/Client 可用）

`GET /api/assets/:id`
- 返回 `AssetRecord`（JSON）
- 用于 UI 列表、预览、预加载决策。

`GET /api/assets?kind=audio&limit=50&cursor=...`
- 列表/分页（MVP 可选）。

#### 3.4.3 读取内容（Client 播放/渲染使用）

`GET /api/assets/:id/content`
- 返回二进制内容
- 必须支持：
  - `Range` 请求（206 / `Content-Range` / `Accept-Ranges: bytes`）
  - `ETag` + `If-None-Match`（304）
  - `Cache-Control`（内容不可变时：`public, max-age=31536000, immutable`）
  - 正确的 `Content-Type`
  - 建议：`ETag` 直接等于 `sha256`（或强绑定于 sha256），以便 client 做一致性校验与跨会话缓存验证
  - 建议：`Content-Disposition: inline; filename="<originalName>"`（便于调试与下载）

`HEAD /api/assets/:id/content`
- 返回 headers（大小、ETag 等），不返回 body（用于 preload/校验）。

#### 3.4.4 CORS（必须）

- Client 与 Manager 可能在不同 origin（`/` vs `/manager`），但通常同域；仍建议统一启用：
  - `Access-Control-Allow-Origin: <configured-origins>`（不要用 `*` 搭配 credentials）
  - `Access-Control-Allow-Headers: Range, If-None-Match, Content-Type`
  - `Access-Control-Expose-Headers: Content-Range, Accept-Ranges, ETag, Content-Length`

### 3.5 Client 侧资源预加载（ResourceStore）

目标：
- 从 **client 登录进入开始**就尽可能预先 preload（不是“等到要用才下载”）。
- preload 过程 **不在 client UI 上显示**（不弹窗、不进页面 UI），只在 console 输出进度与错误。
- 当 manifest 中 **所有资源都已下载并校验** 后，client 主动上报给 manager：
  - Manager 的 client dot：从“刚连接（黄）”变成“资源就绪（绿）”
  - 若出现不可恢复错误（404/校验失败等）：可变为“错误（红）”，并在日志中可定位

关键前提（manifest 的来源）：
- client 自己不知道“要 preload 哪些资产”，必须有一个 manifest（来自 manager 的项目/graph）。
- 为保证“从登录开始就 preload”，client 应同时支持：
  1) **本地持久化的 last manifest**（上次运行保存），登录后立即启动 preload；
  2) **manager 推送的最新 manifest**（连接建立后立刻推送/更新），用来增量更新 preload 列表。

#### Manifest 的范围（需要明确，否则会影响“预加载到底有多预先”）

你提出的要求是“绝对不能等到准备调用这个文件时才下载”。这里有两种常见解释，对应两种实现方式：

1) **项目级预加载（更“预先”，更像你想要的）**
   - manifest = 当前项目资产库里的“全部 assets”（audio/image/video）。
   - 好处：未来即使 graph/scene 切换去用某个 asset，也几乎不会遇到“第一次用才下载”。
   - 风险：资产数量多/视频很大时，首次登录会很久、占带宽（需要并发限制、优先级、可中断）。

2) **图/场景级预加载（更“精确”，更省资源）**
   - manifest = 当前部署 patch/当前 scene/当前 graph 所引用的 assets（通过扫描 `asset:` 引用得到）。
   - 好处：下载量可控，首登更快。
   - 风险：当你后来在 manager 新接入一个从未引用过的 asset，会触发一次“新增下载”（但依然可以做到：一引用就立即后台下载，不等到真正播放那一刻）。

推荐策略（折中，MVP 也容易落地）：
- **高优先级**：图/场景级（确保“要用的一定已下载”）
- **低优先级**：项目级剩余资产后台慢慢补齐（console 仍有进度，但不影响实时控制）

✅ **已确认（2025-12-21）**：
- 先只预加载“当前 graph/scene 引用的资产”（高优先级）
- 其余资产后台低优先级补齐
- 高优先级内部的下载顺序：按 manager 生成 manifest 时的“首次出现顺序”（保证马上要用的资源最先开始下载）

核心组件：

1. `AssetUrlResolver`
   - 输入：`asset:<id>` / `shugu://asset/<id>` / 普通 URL
   - 输出：最终可 fetch 的 HTTPS URL
   - 依赖：`serverUrl`（client 已有保存/配置）

2. `ResourceStore`
   - 维护：
     - `inFlight: Map<assetId, Promise<...>>`
     - `metaCache: Map<assetId, AssetRecord>`
   - 能力：
     - `preload(assetRefs: string[], opts)`
     - `getContentUrl(assetRef)`
     - `getMeta(assetId)`
   - 缓存/持久化策略（必须跨刷新/重进保持）：
     - 首选：Cache Storage（持久化 Response，跨刷新/重进复用）
     - 元信息：IndexedDB（保存 `assetId/sha256/etag/size/verifiedAt` 等）
   - 一致性校验策略（必须）：
     - server `GET /api/assets/:id` 返回 `sha256`
     - `GET/HEAD /content` 返回 `ETag == sha256`（推荐）
     - 首次下载完成后：
       - 基线校验（MVP）：校验 `ETag === meta.sha256`（因此强烈建议 ETag 直接等于 sha256）
       - 额外校验（可选）：当 `sizeBytes` 小于阈值（例如 ≤ 20MB）时，client 再计算内容 sha256（WebCrypto）复核；避免对大视频做整文件 hash 造成内存/性能问题
       - 成功后写入 `verifiedAt`
     - 后续启动时：对已缓存条目执行快速验证（HEAD 比对 ETag/Length）；仅在不一致时才重下（必要时再复核 hash）
     - 目标：**不会出现“文件内容变了但文件名/URL 没变导致不重新下载”**

3. 与 manager 的 manifest 同步（更早、更预先）
  - 新增一个轻量 plugin（推荐：`pluginId = "multimedia-core"`；也可先临时挂在 node-executor 下）
    - manager -> client：`command = "asset-manifest-set"`，payload: `{ manifestId, assets: AssetRecord[] | {id,sha256,kind}[] }`
    - client -> manager：通过 `sensorType: "custom"` 上报 `{ kind:"multimedia-core", event:"asset-preload", status:"loading|ready|error", progress... }`
  - manager 侧：从“当前项目/graph”实时导出 manifest，并在 client 连接时立即推送
  - client 侧：登录后立刻开始 preload（先用 last manifest），收到新 manifest 后增量 preload（不重复下载）

4. 与 node-executor 的协作（仍然需要，但不是“第一次下载”的触发点）
   - node-executor deploy 时仍可扫描 patch graph 并补充 manifest（防止 manager 漏推）
   - 但原则上：deploy 不应是下载开始的第一时刻（避免“用时才下载”）

### 3.6 Manager 侧资源选择（替换 DataURL）

目标：
- Node Graph 中选择本地文件时，写入的是 `asset:<id>`（或直接写入 `https://.../content` 也可，但推荐写 asset scheme）。

实现点：
- 替换现有 file picker 行为：
  - 现在：FileReader -> DataURL -> setValue
  - 目标：upload -> assetId -> setValue(`asset:<id>`)
- 增加上传进度/失败提示（至少 toast）
- 可选：资产浏览器（历史资源可复用）

迁移策略（必须考虑）：
- 旧项目里已经存了 DataURL 的 graph：
  - 提供一次性“迁移脚本/按钮”：扫描 graph config，发现 `data:audio/...;base64,...`，自动上传并替换为 `asset:<id>`。
  - 注意：这一步必须可控且可回滚（先导出备份）。

---

## 4. Multimedia-Core：统一多媒体运行时（Tone 音频 + 图片/视频 + 资源缓存）

### 4.1 统一目标（技术约束）

1. Client 上多媒体运行时只有 **一套**（`MultimediaCore`），apps/client 只做 UI/权限/连接的薄壳。
2. 音频：只存在 **一个** Tone 音频上下文（Tone.js context），所有发声（Tone nodes、媒体音频、Synth）共享同一 master chain（全局音量/静音/Limiter）。
3. 图片/视频：播放状态由 `MultimediaCore` 统一维护，UI 组件只负责渲染（不包含业务逻辑）。
4. 资源：从登录开始 preload；跨刷新/重进复用缓存；必须支持一致性校验（sha256/ETag）。
5. 仍保留移动端用户手势解锁逻辑（`Tone.start()` 必须在 gesture 内）。

### 4.2 模块边界与解耦（为未来新增“可控对象”做准备）

> 目标：未来除了 “client” 以外还会有其他可被 manager 控制的对象，因此 runtime 必须是可复用的库，而不是埋在 Svelte store 里。

推荐落地方式：新增 package（或 sdk-client 子模块）`MultimediaCore`：
- 位置建议：`packages/multimedia-core/`（纯 TS，无 Svelte 依赖）
- 对外暴露：
  - `createMultimediaCore({ serverUrl, sdk, logger })`
  - `core.setAssetManifest(manifest)`（收到 manager 推送/本地恢复时调用）
  - `core.getState()` + `core.subscribe(cb)`（或 EventEmitter）
  - `core.playMedia(...) / core.stopMedia(...) / core.showImage(...) / core.hideImage(...)`
  - `core.enableAudioFromUserGesture()`（内部 Tone.start）
- `apps/client`：只负责把 core state 映射到 Svelte stores（videoState/imageState 等），并把控制消息转发给 core。

### 4.3 ToneAudioEngine（MultimediaCore 内部“唯一音频入口”）

职责：
- `ensureLoaded(): Promise<ToneModule>`（动态 import Tone）
- `startFromUserGesture(): Promise<void>`（内部调用 `Tone.start()`）
- `getStatus(): { loaded, enabled, error }`
- `getMaster(): { input, output, setVolume, mute }`（内部维护 master gain/limiter）
- `now(): number`（`Tone.now()`）

统一改造点：
- `tone-adapter` 不再自己维护 `toneModule/masterGain`，改为复用 `ToneAudioEngine`。
- `SoundPlayer` / `ModulatedSoundPlayer` 迁移后也只用 `ToneAudioEngine`（禁止新建 AudioContext）。

### 4.4 MediaEngine（图片/视频播放统一后端）

目标：把目前散落在 `apps/client/src/lib/stores/client.ts` 的 media 后端逻辑搬进 `MultimediaCore`，UI 仅渲染。

能力：
- Image：`showImage({ url, durationMs? })` / `hideImage()`
- Video：`playVideo({ url, loop, muted, volume, executeAt? })` / `stopVideo()`
- 状态：
  - `imageState = { url, visible, duration }`
  - `videoState = { url, playing, muted, loop, volume }`

UI 对接策略：
- VisualCanvas 等组件继续使用 store，但 store 的值来自 `MultimediaCore.subscribe`。
- 这样未来即使不是浏览器 UI（例如原生壳/新对象），也可复用同一套播放后端。

### 4.5 媒体音频播放迁移（SoundPlayer -> ToneSoundPlayer）

目标：保留现有特性（URL 播放、loop、volume、fadeIn、更新不重启、server-time 调度、失败回退），但统一到 Tone。

建议实现：`ToneSoundPlayer`
- 主路径：`Tone.Player` + `Tone.Gain`，输出接入 `ToneAudioEngine.master.input`
- 调度：`player.start(core.audio.now() + delaySeconds)`
- fadeIn：gain 做 `setValueAtTime + linearRampTo`
- 缓存：优先依赖 HTTP cache + ResourceStore（预先下载）；谨慎使用 Tone.Buffer 常驻缓存（避免爆内存）

回退路径（保留“CORS/解码失败”兼容）：
- HTMLAudioElement + MediaElementAudioSourceNode（接入 ToneAudioEngine 的 raw context destination 或 master）

### 4.6 Synth(update) 迁移到 Tone（ModulatedSoundPlayer -> ToneModulatedSoundPlayer）

目标：保留现有 API/行为（attack/release、duration、波形、modDepth/modFrequency、update 不重启、可精确调度），但底层统一到 Tone。

建议实现：`ToneModulatedSoundPlayer`
- 方案 A：`Tone.Synth` + `Tone.LFO` + `Tone.AmplitudeEnvelope`
- 方案 B：`Tone.Oscillator` + `Tone.Gain` + `Tone.Oscillator`(LFO) 直接 connect 到 frequency param（更贴近现状）

### 4.7 “双系统”切换与回滚（逐步替换，避免一次性爆炸）

落地顺序建议：
1. 先引入 `MultimediaCore` + `ToneAudioEngine`（不删旧实现，先让 Tone 节点改用 ToneAudioEngine）
2. 把 media（image/video）后端逻辑迁入 `MediaEngine`（apps/client 仅渲染）
3. 把 SoundPlayer 切到 Tone（保留旧实现 behind flag）
4. 把 ModulatedSoundPlayer（Synth）切到 Tone（保留旧实现 behind flag）
5. 全量验证稳定后，移除/退役旧 AudioContext 创建逻辑

验收标准（必须通过）：
- 单 client 生命周期内：Tone 相关 `AudioContext` 实例数量 = 1（用调试日志/断言验证）
- Tone nodes + 媒体音频 + Synth 同时工作时：无双重输出、无明显延迟漂移、无音量异常

### 4.8 Tone.js 标准化（实现与外部展示必须“对齐官方标准”）

约束：Tone 节点的内部实现、参数单位、默认值、命名必须对齐 Tone.js 官方文档与示例。

建议动作（按优先级）：
1. **锁定 Tone 版本基线**：优先升级到与文档一致的版本（例如 `15.1.22`），并逐个适配 tone-adapter（注意破坏性变更/弃用 API）。
2. **端口语义**：音频端口使用 `audio`（或至少 `kind: "sink"` + 明确 label），参数端口使用 number（0..1 或 seconds/Hz 等），避免“音频线看起来像数字线”。
3. **参数更新方式**：优先使用 Tone 的 `rampTo`/`setValueAtTime` 等标准方法做平滑，避免 zipper noise。
4. **资源释放**：node 移除/重部署时必须调用 Tone 节点的 `dispose()`，避免泄漏与残留 connect。
5. **输出链路**：通过 `ToneAudioEngine.master`（或 Tone 官方 destination API）统一接出，不在各处直接乱连 `Destination`。

参考（后续实现/验收时以这些为准）：
- `https://tonejs.github.io/`
- `https://tonejs.github.io/docs/15.1.22/index.html`
- `https://tonejs.github.io/examples/`

---

## 5. Max/MSP 式 Patch：不再需要 Loop 才能部署/运行

### 5.1 Patch 的定义

Patch = “要在 client 上执行的一个子图”，具有：
- `patchId`（稳定标识，用于重部署/状态追踪）
- `targetClientIds`（一个或多个）
- `graph`（nodes + connections）
- `meta`（tickInterval、requiredCapabilities、protocolVersion、executorVersion）

Patch 的关键点：
- 不要求是 SCC/loop。
- 允许纯 DAG（例如 `tone-player -> tone-delay -> audio-out`）。
- 允许控制节点（lfo/math/number）驱动参数输入，实现调制。

### 5.2 NodeGraph 里必须出现的“音频出口”概念

为了贴近 Max 的 `dac~`，建议新增一个节点：
- `audio-out` / `tone-destination`
  - 输入：`in`（audio sink）
  - 配置：`bus`/`volume`/`enabled`
  - 运行时（client）：把输入链路接到 master（ToneAudioEngine 的 master）

这样用户的心智模型会变成：
`Audio Source Node (tone-player/osc/granular) -> Effect Node (tone-delay...) -> audio-out -> (扬声器)`

### 5.3 部署选择方式（推荐从“可用”到“正确”分两步）

#### MVP（先把 Loop 依赖去掉）

- Manager 允许对任意一个 client：
  - “Deploy 当前整个 graph（或一个选中的 group）”到 client
  - 不再要求 graph 内包含 `proc-client-sensors` 或形成 loop
- NodeExecutor 在 client 上照常运行（tick 仍可固定 33ms）

#### 推荐（Max/Msp 语义更清晰）

- Patch 由 `audio-out` 节点作为 root 自动推导：
  - 从 `audio-out.in` 逆向遍历所有上游连接（包括 sink edges），收集依赖节点，构成 patch 子图。
  - 这让“patch 边界”自然、稳定，也便于多个 patch 共存（多个 audio-out）。

✅ **已确认（2025-12-21）**：默认采用本方案（`audio-out` 作为 patch root）。  
`Deploy 全图/组选` 只作为早期过渡/调试入口保留，不作为长期主路径。

### 5.4 Manager 侧实现改造（替代 loop-controller）

新增 `patch-controller`（参考现有 loop-controller 的职责）：
- 维护：
  - `localPatches`（可部署 patch 列表）
  - `deployedPatches`（已部署 patchId -> clientId）
  - `deployPending`（超时、错误处理）
  - executor log（复用 node-executor 的 custom sensor 回报机制）
- 提供动作：
  - `deployPatch(patch)`
  - `stopPatch(patch)`
  - `removePatch(patch)`
  - `stopAllPatches()`

Patch 的发现与导出（Manager）：
- `exportGraphForPatch(patchId)`：
  - 输入：root node id（例如 audio-out 的 nodeId）或 group nodeIds
  - 输出：最小子图（nodes + internal connections）+ meta
  - 必须有 whitelist（类似现在 loop export）保证 client runtime 可执行

UI 层（NodeCanvas）：
- 新增 Patch Overlay（类似 LoopFramesOverlay）
  - 展示 patch 边界框（基于 root 节点及其子图 bounds）
  - 展示 deploy/stop/remove 按钮
  - 展示 executor 状态/日志入口

### 5.5 Client 侧执行与“热更新”策略

目标：编辑时尽可能不断音，至少参数调整实时生效。

基础策略：
- 结构变化（增删节点/连线）：走 `deploy`（发送完整 patch graph）。
- 参数变化（旋钮）：走 `override-set`（小消息，高频）。

关键工程点：
- 保证 nodeId 在 manager 中稳定（不要每次编辑就生成新 id），这样：
  - `tone-adapter.syncActiveNodes` 可以复用 Tone 实例，只重连线/更新参数，减少爆音。

可选优化（第二阶段）：
- NodeExecutor.deploy 不再 `runtime.clear()`，而是“更新图 + compileNow”，减少 tick 状态丢失。
- 引入 “deploy diff”（只发变更），但这不是 MVP 必需。

### 5.6 Override 语义（必须支持“可持久实时调参”）

现状：override 有 TTL，TTL 到期会恢复基线值；这会导致“松手后参数回弹/失效”。

建议：
- **参数调节时**：发送高频 override（可带短 TTL，避免网络/断连导致永久卡住）
- **调节结束时（pointerup/blur）**：发送一次 “commit override”（不带 TTL，或 TTL 很长），并/或同步到 patch 的基线 config

实现方案二选一（或都做）：
1. `override-set` 增加 `ttlMs?: null` 表示永久（协议保持兼容：不传 ttl 即永久）
2. 新增 plugin command：`override-commit`（语义更清晰）

验收标准：
- 在 manager 上改变 delay time/wet，client 的声音在 100ms~200ms 内可感知变化
- 松手后保持最后值（不会 1.5s 后回到旧值）

---

## 6. Node/Protocol/SDK 层面的必要改动清单（按优先级）

### P0（必须，才能开始正确使用）

1. Single Source of Truth：node 定义以 `@shugu/node-core` 为唯一来源（Manager 不再手写会漂移的 specs；至少对 Tone/核心节点强制由 node-core 生成/驱动）
2. 资源引用：引入 `asset:` scheme + `AssetUrlResolver`（Graph/Protocol 只存引用）
3. Asset Service：上传/元数据/内容（Range/ETag/Cache）+ 鉴权（Bearer token，读写分离）+ 文档 `Asset_Service_serve.md`
4. Manager file picker：改为 upload + 写 `asset:<id>`（禁止 DataURL 入图）
5. MultimediaCore：抽离并解耦 apps/client（作为可复用 runtime），并承载 `ResourceStore + MediaEngine + ToneAudioEngine`
6. 预加载前置：client 登录后即启动 preload（last manifest + manager 推送 manifest），完成后上报 readiness
7. Manager client dot 状态：默认“已连接但未就绪（黄）”，assets 全就绪变“就绪（绿）”，错误变“错误（红）”
8. Patch 部署：去掉 loop 强依赖，提供 patch 导出/部署入口（MVP：全图/组选；推荐：audio-out root）
9. Tone 单音频引擎：通过 `ToneAudioEngine` 统一 Tone context，逐步消除旧 AudioContext

### P1（强烈建议，提升易用性与正确性）

1. 新增 `audio-out` 节点（Max 的 dac~）
2. Patch 自动推导（从 audio-out root 逆向收集子图）
3. override commit 机制（持久调参）
4. 资源浏览器 + 迁移工具（DataURL -> assetId）
5. Tone.js 标准化：锁定 Tone 版本基线（对齐官方 docs/examples），逐节点校准参数/默认值/单位/实现

### P2（优化与规模化）

1. 增量 deploy / diff
2. 资源派生：waveform 缩略图、video poster、image thumb
3. GC/引用计数：自动清理未使用资产
4. 多客户端同步播放：更严格的 server-time 对齐与预加载策略

---

## 7. 分阶段实施计划（足够细的“执行清单”）

> 这里按“每一步都可验收、可回滚”的方式拆分。

### Phase 0 - 设计确认与风险收敛（1~2 天）

- [x] assetId：UUIDv4（主流）
- [x] resolver 输入：同时支持 `asset:<id>` 与 `shugu://asset/<id>`
- [x] server 资产存储目录（需要可写，部署文档更新）
- [x] 上传鉴权：`Authorization: Bearer <token>`（纯内存校验，不走 DB）
- [x] 下载默认公开：防止“读 token”影响打开 client 的体验；可选开启 `ASSET_READ_TOKEN`
- [x] patch root：以 `audio-out` 为 root 自动推导（全图/组选仅作为过渡/调试）
- [x] preload 范围：先预加载“当前 graph/scene 引用资产”，按首次出现顺序调度；其余后台低优先级补齐

验收：
- 这份 plan 中的关键决策都有“选型结论 + 为什么”。

---

### Phase 1 - Server Asset Service（MVP 可用：上传/下载/Range/ETag）

实现位置建议：`apps/server/src/assets/…`

1) DB 与存储
- [x] 引入持久化索引（MVP：JSON index `ASSET_DB_PATH`；后续可换 SQLite/Postgres）
- [x] 实现 `LocalFsStorage`（temp 写入 + rename）
- [x] 实现 sha256 计算与 dedupe（可选但强烈建议）

2) API
- [x] `POST /api/assets`（multipart upload）
- [x] `GET /api/assets/:id`（metadata）
- [x] `GET /api/assets`（list，管理用；需要写 token）
- [x] `GET /api/assets/:id/content`（支持 Range、ETag、Cache-Control）
- [x] `HEAD /api/assets/:id/content`
- [x] `DELETE /api/assets/:id`（delete，管理用；需要写 token）
- [x] CORS headers（Range/ETag 必须可用）
- [x] 鉴权（写保护，读公开，且不影响实时交互延迟）：
  - `Authorization: Bearer <token>`
  - `ASSET_WRITE_TOKEN`（manager 上传/管理）
  - `ASSET_READ_TOKEN`（可选；若开启则读请求需要 token）
  - 校验必须是纯内存（常量时间字符串比较），禁止每次请求走 DB

3) 运维
- [x] 配置项：`ASSET_DATA_DIR`、`ASSET_MAX_BYTES`、`ASSET_DB_PATH`、`ASSET_PUBLIC_BASE_URL`（可选）、`ASSET_READ_TOKEN`、`ASSET_WRITE_TOKEN`
- [x] 日志：上传/下载错误要有可定位信息（MVP：console + Nest exception）

验收：
- 能上传一个 50MB 音频并返回 assetId
- Client 用 `curl -H "Range: bytes=0-1023"` 能得到 206 + `Content-Range`
- ETag 生效：`If-None-Match` 返回 304

回滚：
- Asset service 独立模块，不影响 socket 主逻辑；失败可暂时回退到“只支持 URL 外链”。

---

### Phase 2 - Manager 集成：文件选择 => 上传 => 写入 assetRef（禁止 DataURL 入图）

1) UI 交互
- [x] 改造 `file` 控件：选择文件后显示 uploading/progress（最少显示“Uploading…”）
- [x] 上传成功后：把 config 值写成 `asset:<id>`（而不是 base64）
- [x] 上传失败：显示错误 + 不写入
- [x] 上传鉴权：`POST /api/assets` 必须带 `Authorization: Bearer <ASSET_WRITE_TOKEN>`（token 存在 manager 配置里，不写入 graph）
- [x] 新增独立页面 `Assets Manager`：list/upload/delete（不干扰 Node Graph）

2) 节点层面
- [x] `load-media-sound` 节点从“data URL loader”语义变为“asset loader”（输出 assetRef string）
- [x] 为图片/视频做同类节点（或通用 `load-asset` 节点：kind=audio/image/video）

3) 兼容旧项目
- [x] 增加“迁移工具”（按钮或脚本）：DataURL -> 上传 -> assetRef

4) Manifest 导出与推送（为“登录即预加载”提供前置条件）
- [x] Manager 维护 `currentAssetManifest`（推荐包含优先级）：
  - 高优先级：从“当前 graph/scene/patch”扫描 `asset:` 引用生成（保证即将使用的资源一定预先到位）
  - 低优先级（可选）：项目资产库里的“全部 assets”（满足你想要的“更预先”体验）
- [x] client 连接建立后立即推送 manifest（plugin 推荐：`multimedia-core`；MVP 也可临时挂在 `node-executor`）
- [x] manifest 变更时增量推送（debounce，避免拖动/编辑时刷屏）
- [x] 高优先级下载顺序（你已要求）：
  - 按“首次出现顺序”生成有序列表（稳定、可预测）
  - 推荐扫描策略（稳定且贴近 Max/MSP 语义）：以 patch root（`audio-out` / video 输出 / image 输出）为起点做 DFS/BFS，按端口顺序遍历上游；遇到 `asset:` 立刻 append（去重保持首次顺序）
  - 若同一资源被多处引用：只保留第一次出现的位置（后续视为已满足）

5) Client dot 状态（黄->绿，满足你明确提出的 UX）
- [x] Manager 维护 per-client `readiness`：`connected`（黄）/ `assets-loading`（黄）/ `assets-ready`（绿）/ `assets-error`（红）
- [x] 在 client 刚注册/刚加入时，把 dot 设为黄（不要默认绿）
- [x] 监听 client 上报的 `multimedia-core asset-preload` 事件：
  - `status=loading`：保持黄，可选显示“xx/yy”
  - `status=ready`：变绿
  - `status=error`：变红（并在日志面板可定位错误 assetId）
- [x] UI 同步点：ClientList（列表 dot）+ NodeGraph 的 client-node（canvas dot）保持一致

验收：
- Graph JSON 中不再出现 `data:audio/...;base64,` 这种超长字符串
- 部署 patch 时 payload 大小稳定（与音频文件大小无关）
- client 登录后（不操作 UI）console 可见 preload 进度；完成后 manager dot 由黄变绿

回滚：
- 保留一个 debug 开关允许 DataURL（仅本地调试），默认禁用。

---

### Phase 2.5 - Node Schema & Tone 节点标准化（修复“数字输出”语义漂移）

目标：让 Tone 节点在 Manager 的外观/连线语义与 Client 的 Tone.js runtime 保持一致（参考 Tone 官方 docs/examples）。

1) node-core：引入 `audio` 端口类型（Single Source of Truth）
- [x] `packages/node-core/src/types.ts`：`PortType` 增加 `audio`
- [x] `packages/node-core/src/definitions.ts`：所有 Tone 音频端口改为：
  - 输入：`{ id:'in', type:'audio', kind:'sink' }`
  - 输出：`{ id:'out'|'value', type:'audio', kind:'sink' }`
- [x] 同步修正其它“本质是音频”的节点（例如 `audio-out`）

2) Manager：移除/收敛 hand-written Tone specs
- [x] 首选：Manager 直接消费 node-core definitions 渲染 UI（Tone/核心节点优先以 node-core 为准，JSON spec 不再覆盖语义）
- [x] 备选：保留 JSON 但改为 build-time codegen（不需要：已采用 node-core 作为唯一来源）
 - [x] UI socket 规则：
  - `audio` 端口：独立样式（颜色/粗细/连接规则），只允许连到 `audio`
  - `number`/`boolean`：仍是控制端口，只能连到同类型或 `any`

3) sdk-client tone-adapter：音频连接识别策略收敛
- [x] MVP：保留现有端口表（`AUDIO_INPUT_PORTS/AUDIO_OUTPUT_PORTS`）以兼容旧图
- [x] 下一步：优先用端口类型 `audio` 来识别音频连接（减少硬编码）

验收（你最关心的感知点）：
- Tone Delay/Tone Player 等节点的输入输出在 Manager UI 里不再显示为“数字线”，而是明确的 `audio` 线
- 连接错误在 UI 侧就能被阻止（而不是连上了没声才猜）

---

### Phase 3 - Client 集成：MultimediaCore（登录即预加载 + 缓存/校验 + readiness 上报）

1) MultimediaCore 框架落地（解耦 apps/client）
- [x] 建立 `packages/multimedia-core/`（或先放在 `@shugu/sdk-client` 内部模块），不依赖 Svelte
- [x] 暴露最小 API：`setAssetManifest` / `preloadNow` / `resolveAssetRef` / `subscribeState`
- [x] 内部包含：`AssetUrlResolver` + `ResourceStore` + `ReadinessReporter`（后续再加 `ToneAudioEngine/MediaEngine`）
- [x] 鉴权接入：默认读公开（不需要 token）；若开启读鉴权则可用 `?token=<ASSET_READ_TOKEN>`（兼容媒体元素无法加 headers）

2) AssetUrlResolver（跨音频/图片/视频统一）
- [x] 支持 `asset:<id>` + `shugu://asset/<id>` + 直链 URL
- [x] 输出统一为 `https://{server}/api/assets/<id>/content`（或未来 302 / pre-signed URL）

3) Manifest 驱动的“登录即预加载”（不依赖 deploy）
- [x] client 启动时立即加载并使用 `lastManifest`（IndexedDB/localStorage）开始 preload（只写 console 进度，不进 UI）
- [x] socket 连接成功后，接收 manager 推送的 `currentManifest`：
  - 若 `manifestId` 相同：继续当前 preload
  - 若不同：做增量 diff（新增下载/删除可延后做 GC），并切换 readiness 归属到新 manifest
- [x] preload 策略（MVP）：
  - 音频/图片：GET 触发 Cache Storage 写入
  - 视频：至少 HEAD 校验 + 可选预热首段（小 Range）
  - 并发限制（例如 4~6），避免占满带宽影响实时控制
  - **优先级（你已要求）**：严格按 manifest 的顺序调度下载；新增的“更靠前”资源要能插队到队列前部（保证马上要用的先到）
- [x] console 进度规范（仅日志，不 UI）：
  - 开始：`[asset] preload start manifest=... total=...`
  - 进度：`[asset] preload progress x/y (bytes ...)`
  - 完成：`[asset] preload ready manifest=...`
  - 失败：`[asset] preload error id=... reason=...`

4) 持久化缓存 + sha256 验证（跨刷新/重进生效）
- [x] Cache Storage：缓存 `GET /content` 响应（跨刷新/重进复用）
- [x] IndexedDB：缓存 `assetId -> { etag, sizeBytes, verifiedAt }`（MVP；sha256 可后续补齐）
- [x] 一致性校验规则：
  - 首次下载后：
    - 基线校验（MVP）：校验 `ETag === meta.sha256`
    - 额外校验（可选）：`sizeBytes` 较小时再用 WebCrypto 计算 sha256 复核（大视频不做整文件 hash）
  - 后续启动：HEAD 比对 `ETag/Content-Length`；一致则跳过下载，不一致则重下（必要时再复核 hash）
- [x] 目标：不会出现“服务器内容变了但 URL/文件名不变导致不重新下载”的情况

5) Readiness 上报（驱动 manager dot 颜色）
- [x] preload 开始即上报 `status=loading`
- [x] 全部资源 verified 后上报 `status=ready`
- [x] 任意资源不可恢复错误上报 `status=error`（带 assetId/原因）
- [x] 上报渠道：
  - 推荐：新增 plugin `multimedia-core`（manager->client 下发 manifest；client->manager 上报状态走 custom sensor）
  - MVP：可先复用 custom sensor（`kind:'multimedia-core'`）不上新协议类型

6) Resolver 接入现有播放链路（不改变外部 API）
- [x] Tone Player/Granular 的 url 输入改为先 resolve（支持 assetRef）
- [x] 现有 `playMedia/showImage/playSound` 的 url 输入也先 resolve（支持 assetRef）

验收：
- client 页面打开后无需任何 UI 操作，console 就开始 preload（基于 lastManifest，随后切到 currentManifest）
- preload 完成后 manager 对应 client-dot 从黄变绿
- 刷新页面/退出重进时，若资源未变更：不会重新下载（只做快速校验）

---

### Phase 4 - ToneAudioEngine 落地（统一 Tone context）

1) Tone 统一入口
- [x] 新增 `ToneAudioEngine`
- [x] client Start 手势解锁只调用 ToneAudioEngine（统一 `Tone.start()`）
- [x] tone-adapter 改为使用 ToneAudioEngine（移除重复 global 状态）

验收：
- Tone nodes 与其他音频系统（尚未迁移）能共存但最终都将过渡
- ToneAudioEngine status 可在 UI/日志中看到（loaded/enabled/error）

---

### Phase 5 - Synth(update) 迁移到 Tone（消除双音频系统）

1) 新实现
- [x] `ToneModulatedSoundPlayer`：实现 play/update/stop（对齐现有功能）
- [x] 确保只使用 ToneAudioEngine 的 context，不创建新 AudioContext

2) 替换接入点
- [x] `modulateSound` / `modulateSoundUpdate` 动作改为调用 Tone 版本
 - [x] 兼容旧 payload 字段（attack/release/durationMs 等）

验收：
- 在同一 client 上：Tone nodes + synth(update) 同时工作且不打架
- 运行中修改 synth 的 modDepth/modFrequency 立即生效

回滚：
- 保留旧 ModulatedSoundPlayer 实现 behind flag（紧急回退）

---

### Phase 6 - MultimediaCore 媒体后端统一（image/video -> MediaEngine；audio -> ToneSoundPlayer）

1) Image/Video：迁入 MediaEngine（彻底解耦 apps/client store）
- [x] `MultimediaCore.MediaEngine` 维护 `imageState/videoState`（当前散落在 `apps/client/src/lib/stores/client.ts`）
- [x] `showImage/hideImage/playMedia(video)/stopMedia` 的 client 端执行路径全部改为调用 MediaEngine
- [x] `apps/client` 只负责把 core state 映射到 store（渲染层），不承载业务逻辑
- [x] URL 输入支持 `asset:`（通过 resolver + ResourceStore 命中缓存）

2) Audio：SoundPlayer 迁移到 Tone（保留 fallback）
- [x] `ToneSoundPlayer`（Tone.Player 路径）
- [x] 失败 fallback（HTMLAudio + MediaElementSource 接 Tone master）
- [x] 替换 `playSound` / `playMedia(audio)` 的底层实现

验收：
- Image/Video 的行为与旧实现一致（播放/停止/loop/mute/volume/auto-hide）
- Audio 的行为与旧实现一致（播放/停止/loop/更新音量/淡入）
- 大音频从 asset service 拉取播放正常（Range/CORS 正确），且能命中缓存减少等待

---

### Phase 7 - Patch 部署系统（替代 loop 依赖，Max/MSP 模式落地）

1) Patch 导出（Manager）
- [x] 实现 `exportGraphForPatch(...)`：
  - 默认：导出 `audio-out` root 的依赖子图（你已确认采用主流 Max/MSP 语义）
  - 过渡/调试：仍可导出整个 graph 或选中 group（可开关）
- [x] whitelist：保证 client 能执行（类似现有 allowedNodeTypes）

2) Patch 目标与部署（Manager Graph 驱动）
- [x] Graph 驱动目标选择：推荐 `audio-out(Deploy) → client-object(In)`（更符合“输出接到 Client”的心智模型），并兼容旧连法 `client-object(out) → audio-out(client)`；彻底移除 toolbar patch-controls
- [x] 自动部署策略（debounce）：拓扑变更时自动 deploy；断开/stop 时 stop+remove
- [x] 参数变化不触发 redeploy：走 override-set + commit（保持实时调参手感）

3) Client 侧执行（NodeExecutor）
- [x] NodeExecutor deploy 放宽限制（不要求 sensors/loop）
- [x] requiredCapabilities 仍保留（sound/visual 等）

4) override 路由（关键）
- [x] manager 发送 override 时能找到“该 node 属于哪个 patch / 哪个 client”
- [x] 引入 commit 语义，确保参数持久

5) MIDI 控制（Manager-only，桥接到 Client Patch）
- [x] Patch 导出阶段自动排除 `midi-*` 节点（client 端不具备 WebMIDI/source/runtime，避免不可部署报错）
- [x] Manager 运行时将 `midi-* → patch-node` 的连线视为桥接：每个 tick 把 MIDI 输出转成 `override-set` 下发到 client；断线时 `override-remove`

验收（你最关心的 end-to-end）：
- 在 Node Graph 上：`load-asset(audio)` -> `tone-player` -> `tone-delay` -> `audio-out`
- 部署到 client 后能稳定发声
- 在 manager 调整 delay time / wet / feedback，client 音频实时变化且松手后保持
- 音频文件越大也不影响 deploy/override 消息体积（只传 assetId）

---

### Phase 8 - 清理与长期维护

- [x] 删除/退役旧 AudioContext 创建代码路径（或改为只走 ToneAudioEngine）
- [x] 文档更新：DEPLOY.md 增加资产存储目录与备份策略
- [x] 增加“健康检查”：资产目录可写、DB 可用、磁盘空间预警（可选）

---

## 8. 风险清单（提前写出来，避免踩雷）

1) **Range 实现不正确**会导致 iOS/Safari 视频/音频加载异常或无法 seek。
2) **CORS headers 不完整**会导致 Tone/Fetch/HTMLAudio 各种失败，且错误信息很差。
3) **多 AudioContext** 在移动端更容易出现“无声/卡顿/恢复失败”。
4) **deploy 频率过高**会造成音频 glitch：需要 debounce、并尽可能复用 nodeId/Tone 实例。
5) **大音频 decode 缓存**会爆内存：MVP 先依赖 HTTP cache，不要一上来把所有 buffer 常驻内存。

---

## 9. 已确认的关键决策（2025-12-21）

1) **assetId（主流）**
- 采用 **UUIDv4** 作为 `assetId`（graph 中写 `asset:<uuid>`）
- `sha256` 仍然是去重/一致性基准（DB 强制 `UNIQUE(sha256)`；`ETag == sha256`）

2) **鉴权（必须，且不影响实时交互延迟）**
- 必须鉴权，但鉴权只能发生在 Asset Service HTTP 路径，不影响 socket 控制链路
- 采用主流 HTTP 标准：`Authorization: Bearer <token>`
- MVP：读写 token 分离（`ASSET_READ_TOKEN`/`ASSET_WRITE_TOKEN`），且服务端校验必须纯内存（常量时间字符串比较），禁止每次请求走 DB
- 迁移预留：未来可把 token 升级为 JWT/OAuth2 或 resolver 下发 pre-signed URL（详见 `Asset_Service_serve.md`）

3) **Patch root（主流 Max/MSP 语义）**
- 默认以 `audio-out` 为 patch root 自动推导部署子图
- “Deploy 全图/组选”只作为过渡/调试入口

4) **预加载范围与优先级**
- 高优先级：只预加载“当前 graph/scene 引用的资产”（不等到真正播放才下载）
- 高优先级内部顺序：按 **首次出现顺序**（manifest 有序列表），确保马上要用的最先开始下载
- 低优先级：其余资产后台补齐（可开关/可限速）

---

## 10. 完成定义（Definition of Done）

当以下全部成立时，本计划算完成：

- Manager 上传音频/图片/视频后，graph 中只保存 `asset:<id>`（无 DataURL）
- Client 能通过统一 HTTPS endpoint 获取资源（支持 Range/ETag/Cache）
- Client 上所有发声都通过 ToneAudioEngine（无第二套 AudioContext）
- Node Graph 可像 Max/MSP 一样连接音频源/效果/输出，不依赖 loop；部署到 client 后能实时调参、稳定发声
