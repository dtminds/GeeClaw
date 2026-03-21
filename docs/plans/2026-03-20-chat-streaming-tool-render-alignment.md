# Chat Streaming / Tool Render Alignment Design

## 背景

当前 GeeClaw 的聊天实时渲染模型主要是：

- `messages`: 已落入历史列表的消息
- `streamingMessage`: 当前唯一的一条流式 assistant 消息
- `streamingTools`: 挂在这条流式消息旁边的工具状态

这个模型在下面这种时序下会天然失真：

1. assistant 先输出一段文字
2. agent 调用工具
3. assistant 再输出一段文字
4. agent 再调用工具

因为 UI 里只有“一条当前流式消息”，它无法稳定表达 `text -> tool -> text -> tool` 这种交错序列。结果就是：

- 多段 assistant 文本会被粘在一起
- 中途 tool card 往往出不来，或者被后续更新覆盖
- 切走再切回来会恢复正常，因为那时展示的是 `chat.history` 的最终结果，而不是实时态

这不是单个 `ChatMessage` 组件的问题，而是实时状态模型和拼装方式与 OpenClaw control-ui 不一致。

## OpenClaw control-ui 的真实实现

参考代码：

- `/Users/lsave/workspace/AI/openclaw/ui/src/ui/views/chat.ts`
- `/Users/lsave/workspace/AI/openclaw/ui/src/ui/app-tool-stream.ts`
- `/Users/lsave/workspace/AI/openclaw/ui/src/ui/controllers/chat.ts`
- `/Users/lsave/workspace/AI/openclaw/ui/src/ui/app-gateway.ts`
- `/Users/lsave/workspace/AI/openclaw/ui/src/ui/app-render.ts`

### 1. 它把实时聊天拆成四类状态

OpenClaw 聊天视图并不是只靠一条 `streamingMessage`。

它同时维护：

- `messages`: `chat.history` 返回的正式历史消息
- `toolMessages`: 由 `agent` 事件中 `stream: "tool"` 实时合成出来的“伪消息”
- `streamSegments`: 当工具开始时，把当前正在输出的 assistant 文本切一刀，存成已完成的文本片段
- `stream`: 当前仍在继续增长的 assistant 文本流

对应到 `ChatProps`：

- `messages`
- `toolMessages`
- `streamSegments`
- `stream`
- `streamStartedAt`

### 2. 文本流和工具流来自两条不同事件通道

OpenClaw 的 `chat` 事件只负责 assistant 文本流：

- `delta`: 更新当前 `chatStream`
- `final`: 把最终 assistant 消息落入 `chatMessages`，并清掉 `chatStream`

工具不是从 assistant delta 里硬解析出的。

工具实时状态来自 `agent` 事件，且 `payload.stream === "tool"`。这一类事件带有：

- `toolCallId`
- `name`
- `phase`: `start` / `update` / `result`
- `args`
- `partialResult`
- `result`

`app-tool-stream.ts` 会把它们转换成 `ToolStreamEntry`，再合成为可渲染消息：

- 开始时生成 `toolcall`
- 有输出时补 `toolresult`

### 3. 工具开始时，会先把当前文本流“截断成片段”

这是最关键的设计点。

当第一条某个 `toolCallId` 的工具事件到达时，control-ui 会先检查当前是否存在 `chatStream`。

如果有，它会：

- 把当前 `chatStream` 追加进 `chatStreamSegments`
- 清空当前 `chatStream`
- 清空 `chatStreamStartedAt`

然后再创建这次工具调用对应的 `toolMessages`

这样 UI 最终展示顺序自然就是：

- 文本片段 A
- 工具卡 A
- 文本片段 B
- 工具卡 B
- 当前仍在流式中的文本

而不是把所有内容继续塞进一条消息里。

### 4. 视图层最后再统一组装

`views/chat.ts` 里的 `buildChatItems()` 会按这个顺序构造渲染列表：

1. 历史消息 `messages`
2. `streamSegments` 与 `toolMessages` 按索引交错插入
3. 当前 live `stream` 或 reading indicator

然后 `groupMessages()` 再把连续同角色消息分组展示。

重点是：

- 工具卡在视图层已经是独立消息项
- 不是 `ChatMessage` 组件内部的临时附属状态
- `ChatMessage` 只负责渲染单条消息，不负责决定跨 turn 的边界

### 5. history 只在最终阶段回刷

OpenClaw 不会在每次工具更新时都重刷历史。

它的策略是：

- 实时阶段依赖本地 `stream` / `streamSegments` / `toolMessages`
- 当聊天最终结束，并且本轮确实出现过工具事件时，再执行一次 `loadChatHistory()`
- 这样用服务端的最终历史替换本地实时态

这能避免“实时 tool card 刚插进来，又被不完整 history 覆盖掉”的问题。

## 对 GeeClaw 当前实现的结论

当前 GeeClaw 的主要偏差有三类：

### 1. 状态模型过于扁平

现在只有：

- `messages`
- `streamingMessage`
- `streamingTools`

这会把所有实时内容都挤进“当前这一条 assistant 消息”里，无法表示多个中间 turn。

### 2. tool card 依赖于单条消息的附加信息

现在 tool 展示主要依赖：

- `streamingMessage` 里的 tool block
- 或 `streamingTools` 作为 `ChatMessage` 的附加参数

这意味着工具卡是否出现，取决于当前“这条消息”是不是刚好还保留着工具相关上下文。只要后续文字 delta 到来、覆盖或清空这条消息，tool card 就会丢。

### 3. 历史轮询和实时态之间没有明确边界

`loadHistory(true)` 在发送期间会继续更新 `messages`。如果历史里还没有完整的中间 tool turn，就会把本地实时态对应的结构冲掉，用户看到的效果就是：

- 中途不显示 tool
- 结束后自动刷新，才突然变正确

这正是现在用户看到的现象。

## GeeClaw 应采用的目标模型

结论很明确：不要继续在 `ChatMessage.tsx` 上补丁式修复。

应该把 GeeClaw 的实时聊天模型对齐为和 OpenClaw 相同的四层结构。

### 目标状态

建议在 `src/stores/chat.ts` 中拆成：

- `messages: RawMessage[]`
- `streamingText: string | null`
- `streamingTextStartedAt: number | null`
- `streamSegments: Array<{ text: string; ts: number }>`
- `toolStreamById: Map<string, ToolStreamEntry>`
- `toolStreamOrder: string[]`
- `toolMessages: RawMessage[]`

必要时保留少量派生字段，但不要再让“一个 streaming assistant message”承担全部职责。

### 目标事件分工

#### `chat` 事件

- `delta`
  - 只更新当前 `streamingText`
- `final`
  - 把最终 assistant 消息放入 `messages`
  - 清空 `streamingText`
  - 结束发送态

#### `agent` + `stream:"tool"` 事件

- `start`
  - 若当前存在 `streamingText`，先 flush 到 `streamSegments`
  - 创建或更新 `toolStreamById[toolCallId]`
  - 生成对应 `toolMessages`
- `update`
  - 更新对应工具项的实时输出
  - 刷新 `toolMessages`
- `result`
  - 完成对应工具项
  - 刷新 `toolMessages`
  - 不立即 reload history

### 目标渲染拼装

建议在聊天页引入类似 `buildChatItems()` 的拼装函数，输出统一的可渲染序列：

1. 历史消息 `messages`
2. `streamSegments` 和 `toolMessages` 按顺序交错
3. 当前 live `streamingText`
4. 若当前没有 live text 但仍在等待，可显示 typing / reading indicator

也就是说，聊天页不再单独渲染：

- 一串 `messages`
- 再额外渲染一个“当前 streaming ChatMessage”

而是直接渲染一份统一的 `chatItems`。

### 目标组件职责

#### `src/pages/Chat/index.tsx`

负责：

- 从 store 读取 `messages / streamSegments / toolMessages / streamingText`
- 构造统一的 `chatItems`
- 渲染列表

不再负责把 `streamingTools` 塞给一条特殊消息。

#### `src/pages/Chat/ChatMessage.tsx`

负责：

- 渲染单条正式消息
- 渲染 synthetic tool message

不负责：

- 推断跨 turn 边界
- 合并多段流式文本
- 兜底决定某个 tool card 应不应该出现

## 推荐开发顺序

### 第一步：先改 store 数据模型

目标：

- 接住 `agent` 的 `stream:"tool"` 事件
- 在 store 层维护 `toolMessages` 和 `streamSegments`
- 移除对“单条 `streamingMessage` 携带全部实时内容”的依赖

如果这一步不完成，后面的渲染改造仍然会反复出边界问题。

### 第二步：实现统一 chat item 拼装层

新增一个纯函数，类似：

`buildChatItems({ messages, toolMessages, streamSegments, streamingText, ... })`

要求：

- 顺序稳定
- key 稳定
- 支持 `text -> tool -> text -> tool`
- 不依赖切 tab 或 history reload 才变正确

### 第三步：让 `ChatMessage` 只渲染单条项

把 tool card 的来源从：

- `streamingTools`

迁移为：

- 正式的 synthetic tool message

这样组件输入会更稳定，也更接近 OpenClaw 原始设计。

### 第四步：收紧 history reload 策略

原则：

- 工具实时阶段不应依赖频繁 `loadHistory(true)` 才能看到 tool card
- 若有轮询，也不能覆盖本地实时 item
- 最佳方案是仅在最终完成后再用 authoritative history 替换本地实时态

## 需要守住的实现约束

### 1. 一个工具调用必须有稳定主键

以 `toolCallId` 为主键维护工具流，否则多次 update/result 会重复插卡或错位。

### 2. 文本 flush 发生在“工具第一次出现”时

不是每次 tool update 都 flush。

只在某个新工具第一次进入 live 列表时，把当前 `streamingText` 截成 segment。

### 3. 实时 UI 顺序必须由本地状态直接表达

不能指望服务端 history 在中途已经完整可用。

### 4. 最终历史可以替换实时态，但不能在进行中覆盖它

否则会再次出现“中途没 tool，结束后自动变正常”的回归。

## 建议补的测试场景

至少覆盖下面几类：

1. `delta(text1) -> tool(start/result) -> delta(text2) -> tool(start/result) -> final`
   期望：实时展示为 `text1 -> tool1 -> text2 -> tool2 -> final`

2. 多次 `tool(start/update/update/result)`，中间 assistant 不说话
   期望：工具卡持续更新，不重复插入

3. `tool(start)` 后又来了新的 assistant delta
   期望：新文本出现在工具卡后，而不是继续拼进工具卡前的文本段

4. 发送过程中触发 `loadHistory(true)`
   期望：不覆盖本地实时 `toolMessages` / `streamSegments`

5. 最终 `final` 后 reload history
   期望：本地实时态被正式历史平滑替换，不重复

## 本次结论

这次开发不应该从 `ChatMessage.tsx` 修起。

正确路径是：

1. 让 store 先对齐 OpenClaw control-ui 的实时模型
2. 让聊天页渲染统一的 item 序列
3. 让工具卡成为独立消息项，而不是某条流式消息的附属状态

只有这样，`assistant -> tool -> assistant -> tool` 这种复杂时序才能稳定工作。
