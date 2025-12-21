# Node Specs (Manager)

Manager 的 Node Graph 节点通过本目录及子目录下的 `**/*.json` 自动注册。

## 结构

每个 JSON 文件代表一个节点：

- `type`: 节点类型 ID（全局唯一）
- `label`: 显示名称
- `category`: 分类（用于 Add 菜单分组）
- `inputs` / `outputs`: 端口定义（支持 `min`/`max`/`step` 约束）
- `configSchema`: 配置项（支持 `min`/`max`/`step` 约束）
- `runtime`: 运行时逻辑选择（安全内置实现，不使用 `eval`）

## runtime.kind（目前支持）

- `command`: 发送控制命令（适合新增各种 Processor 节点）
- `number`, `math`, `lfo`
- `logic-add`, `logic-multiple`, `logic-subtract`, `logic-divide`, `logic-if`, `logic-for`
- `param-get`, `param-set`
- `client-object`, `proc-client-sensors`
- `midi-fuzzy`, `midi-boolean`, `midi-map`, `midi-select-map`, `midi-color-map`

## 新增节点

1. 在本目录（或子目录）新增一个 `*.json`
2. 填写上述字段（至少需要 `type/label/category/inputs/outputs/configSchema/runtime`）
3. 重启 `pnpm dev:manager`（或重新 build）即可在 Add 菜单中出现
