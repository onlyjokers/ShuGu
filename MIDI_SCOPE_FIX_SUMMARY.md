# MIDI 映射作用域修复总结

## 问题描述

用户报告了一个问题：MIDI 控制下的声音播放对所有 Clients 都起作用，即使没有选中任何客户端，只要使用 MIDI 控制 Synth 中的 Freq (Hz)，所有用户都会响应。

## 根本原因

1. **全局作用域模式**：之前的实现使用全局的 `scopeMode` 变量，所有 MIDI 映射共享同一个作用域设置
2. **`client-scope` 映射的副作用**：如果用户有 MIDI 控制器映射到 `client-scope` 目标，控制器的值会改变全局的 `scopeMode`，导致所有映射都受影响
3. **缺少明确的作用域指示**：UI 上没有显示每个映射的作用域，用户无法知道映射是影响选中的客户端还是所有客户端

## 解决方案

### 1. 为每个映射添加独立的作用域属性

修改了 `ControlSlot` 类型定义，添加了 `scope?: Scope` 属性：

```typescript
type ControlSlot = {
  id: string;
  label: string;
  kind: SlotKind;
  binding?: MidiBinding;
  // ... 其他属性
  scope?: Scope; // 新增：每个槽独立的作用域配置
  lastApplied?: string;
  lastUpdated?: number;
};
```

### 2. 默认作用域为"选中的客户端"

在 `addSlot` 函数中，新创建的映射默认 `scope` 为 `'selected'`：

```typescript
const newSlot: ControlSlot = {
  // ... 其他属性
  scope: 'selected', // 默认只影响选中的客户端
  // ...
};
```

### 3. 使用映射自己的作用域

修改了 `applyMapping` 函数，使用每个映射自己的 `scope` 而不是全局的 `scopeMode`：

```typescript
function applyMapping(slotId: string, parsed: ParsedMessage) {
  const slot = slots.find((s) => s.id === slotId);
  if (!slot || !slot.targetId) return;

  // 使用映射自己的作用域，默认为 'selected'
  const scope = slot.scope ?? 'selected';
  const hasSelection = $selectedClients.length > 0;
  
  // 当作用域是 'selected' 且没有选中客户端时，阻止执行
  if (scope === 'selected' && !hasSelection && !selectionTargetIds.has(slot.targetId)) {
    infoMessage = '请选择至少一个客户端后再触发该映射。';
    return;
  }
  
  // ... 应用映射
}
```

### 4. 添加作用域切换按钮

在 UI 中为每个映射添加了作用域切换按钮：

- **🎯 图标**：表示"选中的客户端"（默认）
- **🌍 图标**：表示"所有客户端"
- 点击按钮可以在两种模式之间切换
- 鼠标悬停显示提示信息

```typescript
function toggleSlotScope(slotId: string) {
  updateSlot(slotId, (slot) => ({
    ...slot,
    scope: slot.scope === 'all' ? 'selected' : 'all',
  }));
  persistSlots();
}
```

### 5. 移除过时的全局作用域控制

- 删除了 `client-scope` 目标定义
- 从 `continuousGroups` 的 `clients` 组中移除了 `client-scope`
- 保留了 `scopeMode` 变量用于向后兼容，但不再实际使用

### 6. 数据迁移

更新了 `hydrateFromStorage` 函数，确保从 localStorage 恢复时：

- 保留每个映射的 `scope` 属性
- 对于没有 `scope` 属性的旧映射，默认设置为 `'selected'`

```typescript
const scope = s.scope === 'all' || s.scope === 'selected' ? s.scope : 'selected';
```

## 用户体验改进

### 视觉指示

每个 MIDI 映射卡片现在都有清晰的作用域指示器：

- **选中模式（默认）**：🎯 按钮，次要样式
- **全部模式**：🌍 按钮，主要样式（渐变蓝色背景）

### 交互方式

1. 创建新映射时，默认只影响选中的客户端
2. 点击作用域按钮即可切换模式
3. 鼠标悬停显示当前模式和操作提示
4. 如果没有选中客户端且映射是"选中模式"，触发时会显示提示信息

## 测试建议

1. **创建新映射**：验证默认是"选中模式"（🎯）
2. **选中客户端**：选中一个或多个客户端，触发映射，验证只有选中的客户端响应
3. **切换到全部模式**：点击 🎯 切换到 🌍，触发映射，验证所有客户端响应
4. **无选中客户端**：不选中任何客户端，触发"选中模式"的映射，验证显示提示信息
5. **数据持久化**：刷新页面，验证每个映射的作用域设置被保留

## 文件修改清单

- `/Users/ziqi/Desktop/ShuGu/apps/manager/src/lib/features/midi/MidiMapper.svelte`
  - 添加 `scope` 属性到 `ControlSlot` 类型
  - 修改 `addSlot` 函数，设置默认 scope
  - 修改 `applyMapping` 函数，使用映射自己的 scope
  - 添加 `toggleSlotScope` 函数
  - 移除 `client-scope` 目标定义
  - 更新 `hydrateFromStorage` 函数
  - 在 UI 中添加作用域切换按钮
  - 添加 CSS 样式
