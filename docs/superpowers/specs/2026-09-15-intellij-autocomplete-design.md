# IntelliJ 自动补全设计

日期：2026-09-15

## 背景

当前 `packages/raccoon-vscode` 已实现基于 `/fim` 的行内自动补全，包括防抖、缓存、预过滤、流式生成、括号过滤、后处理和错误退避。`packages/raccoon-intellij` 已具备聊天 Webview、Node Sidecar、自动补全开关协议和后端连接，但尚未接入编辑器事件、补全请求、灰字渲染与接受/取消动作；初始化还将自动补全固定为关闭。

参考仓库 `continue-rac/xhx-v3/continue-rac` 提供了 IntelliJ 编辑器监听、inlay 渲染和快捷键交互范例。本实现复用其交互思路，但不复制其完整补全核心。

## 目标

- IDEA/IntelliJ 平台在用户输入时显示与 VS Code 行为一致的行内补全建议。
- 支持单行和多行灰字，`Tab` 接受，`Esc` 取消。
- 自动补全开关和模型选择在设置页可用，并在 IDE 重启后保持。
- VS Code 与 IDEA 共用同一套编辑器无关补全逻辑，避免两套实现漂移。
- 快速输入、移动光标、切换文件和关闭项目时不展示过期结果，也不泄漏请求。
- 认证失败、余额不足、限流和网络故障不会造成高频重复请求或通知。

## 非目标

- 不实现按词部分接受。
- 不新增 IDEA 自动补全状态栏菜单。
- 不新增手动触发、手动重载或新的上下文检索能力。
- 不改变 FIM 后端协议、模型列表或计费逻辑。
- 不重构聊天、历史记录或其他 Webview 功能。

## 方案选择

采用“共享补全核心 + IDEA 原生交互层”。

不采用以下方案：

- 将 VS Code 补全流水线复制到 IDEA Sidecar：初始改动隔离，但会产生约 1,500 行重复逻辑，后续修复容易不一致。
- Kotlin 直接调用 `/fim`：实现较短，但会绕过现有缓存、防抖、过滤、后处理和错误退避，不能达到 VS Code 行为对齐。

## 架构

### 共享补全核心

将 `packages/raccoon-vscode/src/services/autocomplete` 中不依赖 VS Code API 的实现移动到 `packages/raccoon-core/src/services/autocomplete`。共享层包含：

- `CompletionProvider` 及输入、输出、位置和选中补全信息等宿主无关类型；
- 防抖、LRU 缓存、语言信息、预过滤、流式生成、括号处理和后处理；
- `RaccoonFimLlm` 和错误退避；
- 一个宿主无关的 `RaccoonAutocompleteService`，统一处理连接状态检查、模型切换、错误退避、请求执行和接受记录。

共享类型不得引用 `vscode`。原先使用 `vscode.Position`、`Range` 或 `SelectedCompletionInfo` 的位置改为最小结构类型。FIM 服务依赖一个最小连接接口；现有 VS Code `RaccoonConnectionService` 与 IntelliJ `SidecarConnection` 均满足该接口。

`packages/raccoon-vscode` 保留 `InlineCompletionItemProvider`、状态栏、命令和 VS Code 配置适配器，并改为调用共享服务。迁移不改变其命令 ID、配置键、显示范围或默认行为。

### IntelliJ Sidecar

Sidecar 创建一个项目级 `RaccoonAutocompleteService`，与聊天 Provider 共用 `SidecarConnection`。stdio 协议增加以下相关帧：

- Host → Sidecar：补全请求、按请求 ID 取消、接受记录；
- Sidecar → Host：补全成功、空结果或失败结果；
- Sidecar → Host：自动补全设置发生变化，供 Kotlin 持久化。

每个补全请求携带请求 ID、文件路径、语言、文档全文、光标位置和补全 ID。Sidecar 为活动请求保存 `AbortController`；同一项目的新请求、显式取消、关闭开关或 Sidecar 退出都会终止旧请求。

业务错误由共享服务记录并进入退避，不把每次失败作为 IDE 弹窗。Sidecar 仅返回足够让 Kotlin 清理加载状态和待展示状态的结构化结果。

### IntelliJ Kotlin 宿主

新增项目级自动补全服务并注册编辑器工厂监听器。该层负责：

- 只监听主编辑器，忽略控制台、diff、注入片段、已释放编辑器和多光标场景；
- 在文档变化后采集文件、语言、全文、光标和 `modificationStamp`，请求 Sidecar；
- 在继续输入、移动光标、改变选择、切换文件、出现 IDE 补全弹窗或项目关闭时取消并清除建议；
- 验证响应仍对应当前请求、编辑器、文档版本和光标位置后再渲染；
- 管理单行 inline inlay 与后续行 block inlay；
- 仅在有效建议存在时接管 `Tab` 和 `Esc`。

Sidecar 生命周期从 Tool Window 生命周期中解耦。`RaccoonService` 提供幂等的 `ensureStarted()`；Tool Window 和自动补全服务都可以触发启动，因此用户无需先打开聊天窗口。Webview 仍按原方式按需创建。

## 数据流

1. 文档发生变化，Kotlin 等待 IDE 应用本次编辑，然后创建请求快照。
2. Kotlin 清除已有 inlay，取消上一个请求，将新请求发送给 Sidecar。
3. Sidecar 检查自动补全开关、后端连接和错误退避。
4. 共享服务执行防抖、预过滤、缓存查询、FIM 流式请求、过滤与后处理。
5. Sidecar 返回最终补全文本或空结果。
6. Kotlin 比较请求 ID、编辑器、`modificationStamp` 和光标偏移；任一不匹配即丢弃。
7. Kotlin 渲染第一行 inline inlay 和剩余行 block inlay。
8. 用户按 `Tab` 时，以写命令替换触发位置到原行尾的范围并移动光标，然后发送接受记录；按 `Esc` 或继续编辑则取消并清除。

接受范围与 VS Code 保持一致：补全从触发位置替换到该行末尾，以吸收 IDE 自动插入的闭合字符。展示前沿用参考实现的行尾去重保护，避免建议和光标后的已有文本重复；去重后的展示文本与原始插入文本分别保存，接受时仍使用原始文本，避免丢失闭合字符。多行建议只在光标至行尾为空白或可安全替换时展示。

## 并发与生命周期

- Kotlin 只维护一个当前待处理请求和一个当前可见建议。
- Sidecar 以请求 ID 管理取消；迟到响应不会覆盖新请求。
- 共享服务继续使用现有防抖和生成复用逻辑。
- 接受建议触发的文档事件带内部标记，不立即再次请求。
- Sidecar 退出、项目释放或关闭自动补全时，中止活动请求并释放所有 inlay。
- `Tab`/`Esc` 动作的启用条件包含编辑器一致、光标一致和建议文本非空；条件不满足时由 IDEA 原动作处理。

## 设置与持久化

设置页的自动补全区域包含：

- 行内自动补全开关；
- 补全模型下拉框，选项来自 `AUTOCOMPLETE_MODELS`。

协议状态增加当前模型及可用模型列表，Webview 消息增加模型更新。`RaccoonProvider` 将开关和模型写入平台设置端口。

IDEA 使用项目级 `PropertiesComponent` 持久化设置，初始化默认值为：

- 自动补全开启；
- `DEFAULT_AUTOCOMPLETE_MODEL.id`。

Kotlin 启动 Sidecar 时把持久化值放入 `init` 帧。Sidecar 内设置变化后回传 Kotlin 持久化。VS Code 平台适配器继续映射到现有的 `raccoon.autocomplete.enableAutoTrigger` 和 `raccoon.autocomplete.model` 配置键。

## 错误处理

- 未连接：跳过请求；连接恢复后可继续。
- `401`、`402`、`403`：视为致命错误，阻止后续自动请求，直到重新连接、认证状态变化或用户切换设置触发重置。
- `429` 和 `5xx`：沿用指数退避与熔断冷却。
- 主动取消：作为正常结束，不记录为失败。
- Sidecar 启动或通信失败：记录到 IDEA 日志，清除待处理状态，不阻塞编辑器和聊天 UI。
- Webview 设置消息非法或模型 ID 未知：回退到默认模型，并把规范化状态同步回 UI。

## 测试策略

### TypeScript

- 将现有防抖、HelperVars、行过滤和后处理测试随实现迁移到 `raccoon-core`。
- 为 `RaccoonAutocompleteService` 增加连接门禁、模型切换、取消、接受记录和错误退避测试。
- 为 IntelliJ Sidecar 请求协调器增加新请求取消旧请求、迟到结果丢弃、关闭开关和 dispose 测试。
- 为 Webview 设置协议和模型选择增加组件/消息映射测试。
- 保留或补充 VS Code 适配器测试，证明配置键和返回范围不变。

### Kotlin/Gradle

- 将行尾去重、展示条件和接受范围计算放在可独立测试的纯函数中，覆盖单行、多行、已有闭合字符和文档版本变化。
- 编译验证监听器、inlay renderer、快捷键动作、服务注册和持久化 API。
- 构建完整插件，验证 Sidecar 与 Webview 资源被打包。

### 验证命令

所有测试从对应包目录执行，不从仓库根目录运行测试：

- `packages/raccoon-core`：单元测试与类型检查；
- `packages/raccoon-vscode`：单元测试、类型检查和构建；
- `packages/raccoon-webview`：相关组件测试与类型检查；
- `packages/raccoon-intellij`：Sidecar 测试、类型检查、Gradle 测试和插件构建。

## 验收标准

- IDEA 输入代码后自动出现单行或多行灰字建议。
- `Tab` 接受、`Esc` 取消；没有有效建议时不抢占原快捷键。
- 快速连续输入、移动光标、切换文件和 IDE 原生补全弹窗出现时不展示过期建议。
- 设置页能够启停自动补全并切换现有模型，重启 IDE 后设置保持。
- 未登录、断线、限流或余额不足时不会持续请求或刷屏。
- 无需先打开 Raccoon Tool Window 即可触发自动补全。
- VS Code 自动补全的现有行为和配置兼容性保持不变。
- 相关 TypeScript 测试、类型检查、Kotlin/Gradle 测试和插件构建通过。

## 预计改动范围

- `packages/raccoon-core/src/services/autocomplete/**`：共享核心与测试。
- `packages/raccoon-core/src/provider/**`：自动补全模型设置的状态与平台端口。
- `packages/raccoon-vscode/src/services/autocomplete/**`：保留 VS Code 适配层，改用共享核心。
- `packages/raccoon-vscode/src/provider/vscode-platform.ts`：模型设置映射。
- `packages/raccoon-webview/src/protocol.ts` 与自动补全设置组件：模型状态和选择器。
- `packages/raccoon-intellij/sidecar/**`：请求协调、RPC 和设置同步。
- `packages/raccoon-intellij/src/main/kotlin/**`：服务生命周期、监听器、渲染、动作和持久化。
- `packages/raccoon-intellij/src/main/resources/META-INF/plugin.xml`：服务、监听器和快捷键注册。

## 风险与控制

- 当前工作区已有未提交改动，且涉及 `raccoon-intellij` 构建文件和 `raccoon-webview`。实现时逐文件检查 diff，只做局部补丁，不覆盖现有改动。
- IntelliJ 不同版本的 inlay API 存在差异。使用当前插件目标版本可编译、且参考实现已采用的基础 `InlayModel` API，不引入仅新版本可用的实验性 inline completion API。
- Sidecar 原先由 Tool Window 启动。通过幂等启动方法解耦后，需要测试重复启动和 Webview 延迟创建，确保只存在一个进程和一个 Provider。
- 共享核心迁移可能影响 VS Code 导入路径。迁移保持公开行为不变，并先移动测试、再切换适配器，避免无测试的大范围替换。
