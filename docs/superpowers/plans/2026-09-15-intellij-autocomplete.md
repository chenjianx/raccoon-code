# IntelliJ Autocomplete Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 Raccoon IntelliJ 插件增加与现有 VS Code 插件共用核心的行内自动补全，支持灰字展示、`Tab` 接受、`Esc` 取消、持久化开关和模型选择。

**Architecture:** 把 VS Code 中不依赖编辑器 API 的补全流水线提取到 `@opencode-ai/raccoon-core`，由 VS Code 适配器和 IntelliJ Sidecar 共同调用。IntelliJ Kotlin 层只负责 Sidecar 生命周期、编辑器快照、过期响应校验、inlay 渲染及快捷键，不重复实现 FIM 流水线。

**Tech Stack:** TypeScript、Bun、React 19、VS Code Extension API、Kotlin 2.1、IntelliJ Platform 2024.2、Gradle、Node stdio JSON 帧、OpenCode SDK `/fim` SSE。

**Spec:** `docs/superpowers/specs/2026-09-15-intellij-autocomplete-design.md`

## Global Constraints

- 保留当前工作区全部未提交改动；修改前后逐文件检查 diff，不覆盖或回退用户内容。
- 不新增运行时依赖；优先复用现有 Bun、React、Gson、IntelliJ Platform 和 SDK 能力。
- 不修改 FIM 后端协议、补全模型 ID、计费逻辑或聊天功能。
- IntelliJ 最低目标保持 `sinceBuild = "242"`，Kotlin JVM toolchain 保持 17。
- `packages/raccoon-*` 不添加 `raccoon_change` 标记。
- 测试从对应包目录运行，绝不从仓库根目录运行测试。
- 类型检查使用包内现有脚本；不直接运行 `tsc`。
- 不实现按词部分接受、IDEA 自动补全状态栏、手动触发或新的上下文检索。
- 仓库规定“未明确要求不得提交”；因此每个任务只做 review checkpoint，不执行 `git commit`。

## File Structure

### Shared core

- Create `packages/raccoon-core/src/services/autocomplete/service.ts`: host-neutral connection gating, model selection, backoff, FIM execution, acceptance bookkeeping.
- Create `packages/raccoon-core/src/services/autocomplete/service.test.ts`: service-level connection, success, cancellation, fatal and model tests.
- Copy editor-neutral files from `packages/raccoon-vscode/src/services/autocomplete/` into matching paths under `packages/raccoon-core/src/services/autocomplete/`: `CompletionProvider.ts`, `ErrorBackoff.ts`, `classification/**`, `constants/**`, `filtering/**`, `generation/**`, `llm/**`, `postprocessing/**`, `prefiltering/**`, and `util/**` except VS Code-only adapters. Task 2 deletes the original copies only after VS Code is switched.
- Modify `packages/raccoon-core/src/services/autocomplete/util/types.ts`: replace `vscode` types with plain position/range structures.
- Modify `packages/raccoon-core/src/index.ts`: export the shared service and public autocomplete types.
- Modify `packages/raccoon-core/src/provider/platform.ts`: add connection state and autocomplete model settings to host ports.
- Modify `packages/raccoon-core/src/provider/index.ts`: publish and persist autocomplete model state.

### VS Code adapter

- Modify `packages/raccoon-vscode/src/services/autocomplete/vscodeProvider.ts`: translate VS Code documents/ranges into shared inputs and call `RaccoonAutocompleteService`.
- Keep `packages/raccoon-vscode/src/services/autocomplete/AutocompleteServiceManager.ts`, `StatusBar.ts`, and `index.ts` as VS Code-only lifecycle/UI adapters.
- Delete migrated editor-neutral files from `packages/raccoon-vscode/src/services/autocomplete/` after the adapter compiles against core.
- Modify `packages/raccoon-vscode/src/provider/vscode-platform.ts`: map autocomplete model getters/setters/listeners to the existing `raccoon.autocomplete.model` key.

### Webview settings

- Modify `packages/raccoon-webview/src/protocol.ts`: add selected autocomplete model, available model list, and `saveSettings.autocompleteModel`.
- Modify `packages/raccoon-webview/src/components/settings/settings-autocomplete.tsx`: render the existing `Select` control below the enable switch.
- Create `packages/raccoon-webview/src/components/settings/settings-autocomplete.test.tsx`: verify both model choices and selected state.
- Modify `packages/raccoon-webview/src/components/settings/settings-view.tsx`: maintain, dirty-check, discard, and save the model draft.
- Modify `packages/raccoon-webview/src/i18n/en.ts`, `zh.ts`, and `zh-hant.ts`: add model row title/description strings.

### IntelliJ Sidecar

- Create `packages/raccoon-intellij/sidecar/autocomplete.ts`: one-active-request coordinator around the shared service.
- Create `packages/raccoon-intellij/sidecar/autocomplete.test.ts`: cancellation, stale result, disabled state and dispose tests.
- Modify `packages/raccoon-intellij/sidecar/rpc.ts`: define autocomplete and settings frames.
- Modify `packages/raccoon-intellij/sidecar/platform.ts`: hold model state and report setting changes to Kotlin.
- Modify `packages/raccoon-intellij/sidecar/index.ts`: create/dispose coordinator and route frames.

### IntelliJ Kotlin host

- Create `packages/raccoon-intellij/src/main/kotlin/com/sensetime/sensecode/jetbrains/raccoon/autocomplete/RaccoonAutocompleteSettings.kt`: project persistence and model normalization.
- Create `packages/raccoon-intellij/src/test/kotlin/com/sensetime/sensecode/jetbrains/raccoon/autocomplete/AutocompleteSettingsTest.kt`: settings normalization tests.
- Create `packages/raccoon-intellij/src/main/kotlin/com/sensetime/sensecode/jetbrains/raccoon/autocomplete/AutocompleteText.kt`: pure range, deduplication and render-plan logic.
- Create `packages/raccoon-intellij/src/test/kotlin/com/sensetime/sensecode/jetbrains/raccoon/autocomplete/AutocompleteTextTest.kt`: pure Kotlin tests.
- Create `packages/raccoon-intellij/src/main/kotlin/com/sensetime/sensecode/jetbrains/raccoon/autocomplete/RaccoonInlayRenderer.kt`: inline/block ghost text renderer.
- Create `packages/raccoon-intellij/src/main/kotlin/com/sensetime/sensecode/jetbrains/raccoon/autocomplete/RaccoonAutocompleteService.kt`: request snapshot, response validation, render/accept/cancel lifecycle.
- Create `packages/raccoon-intellij/src/main/kotlin/com/sensetime/sensecode/jetbrains/raccoon/autocomplete/AutocompleteEditorListener.kt`: document, caret, file selection and lookup listeners.
- Create `packages/raccoon-intellij/src/main/kotlin/com/sensetime/sensecode/jetbrains/raccoon/autocomplete/AutocompleteLookupListener.kt`: project-scoped native completion popup listener.
- Create `packages/raccoon-intellij/src/main/kotlin/com/sensetime/sensecode/jetbrains/raccoon/autocomplete/AcceptAutocompleteAction.kt`: conditional `Tab` handler.
- Create `packages/raccoon-intellij/src/main/kotlin/com/sensetime/sensecode/jetbrains/raccoon/autocomplete/CancelAutocompleteAction.kt`: conditional `Esc` handler.
- Create `packages/raccoon-intellij/src/main/kotlin/com/sensetime/sensecode/jetbrains/raccoon/autocomplete/RaccoonActionPromoter.kt`: promote the conditional accept action over default Tab handling.
- Modify `packages/raccoon-intellij/src/main/kotlin/com/sensetime/sensecode/jetbrains/raccoon/RaccoonService.kt`: idempotent Sidecar startup and correlated autocomplete callbacks.
- Modify `packages/raccoon-intellij/src/main/kotlin/com/sensetime/sensecode/jetbrains/raccoon/SidecarProcess.kt`: notify service on unexpected process termination.
- Modify `packages/raccoon-intellij/src/main/resources/META-INF/plugin.xml`: register the listener, promoter and actions; project services use the existing annotation-based pattern.
- Modify `packages/raccoon-intellij/build.gradle.kts`: add Kotlin test support without disturbing current resource tasks.
- Create `packages/raccoon-intellij/test/autocomplete-registration.test.ts`: static packaging/registration assertions.

---

### Task 1: Extract the host-neutral autocomplete core

**Files:**
- Create: `packages/raccoon-core/src/services/autocomplete/service.ts`
- Create: `packages/raccoon-core/src/services/autocomplete/service.test.ts`
- Create: `packages/raccoon-core/src/services/autocomplete/{CompletionProvider.ts,ErrorBackoff.ts,classification,constants,filtering,generation,llm,postprocessing,prefiltering,util}` by copying the current VS Code-neutral sources.
- Modify: `packages/raccoon-core/src/services/autocomplete/util/types.ts`
- Modify: `packages/raccoon-core/src/provider/platform.ts`
- Modify: `packages/raccoon-core/src/index.ts`
- Test: `packages/raccoon-core/src/services/autocomplete/**/*.test.ts`

**Interfaces:**
- Consumes: `ConnectionPort.getClientAsync(directory)` and SDK `client.fim.complete(request, options)`.
- Produces: `AutocompleteInput`, `AutocompleteOutcome`, `AutocompletePosition`, `AutocompleteRange`, `SelectedCompletionInfo`, and `RaccoonAutocompleteService`.

- [ ] **Step 1: Add a failing structural-type test**

Add to `service.test.ts` a fake connected port and an input that contains only plain objects:

```ts
import { expect, test } from "bun:test"
import type { OpencodeClient } from "@opencode-ai/sdk/v2/client"
import { RaccoonAutocompleteService } from "./service"

const input = {
  completionId: "completion-1",
  filepath: "/workspace/example.ts",
  languageId: "typescript",
  pos: { line: 0, character: 14 },
  fileContents: "const answer = ",
  isUntitledFile: false,
}

test("completes through a connected host-neutral port", async () => {
  const client = {
    fim: {
      complete: async () => ({
        stream: (async function* () {
          yield { type: "delta", text: "42" }
          yield { type: "done" }
        })(),
      }),
    },
  } as unknown as OpencodeClient
  const service = new RaccoonAutocompleteService(
    {
      getConnectionState: () => "connected",
      getClientAsync: async () => client,
    },
    "/workspace",
    "raccoon-pro-completion",
  )

  expect((await service.complete(input, new AbortController().signal))?.completion).toBe("42")
})
```

- [ ] **Step 2: Run the focused test and verify the missing service fails**

Run from `packages/raccoon-core`:

```bash
bun test src/services/autocomplete/service.test.ts
```

Expected: FAIL because `./service` and `RaccoonAutocompleteService` do not exist.

- [ ] **Step 3: Copy the existing neutral pipeline into core**

Use `apply_patch` to create core copies so the VS Code package remains buildable until Task 2. Preserve directory names and implementation behavior, copy the existing tests, and update relative imports. In the core copy of `util/types.ts`, replace the `vscode` import with these exported structures:

```ts
export interface AutocompletePosition {
  line: number
  character: number
}

export interface AutocompleteRange {
  start: AutocompletePosition
  end: AutocompletePosition
}

export interface SelectedCompletionInfo {
  text: string
  range: AutocompleteRange
}
```

Set `AutocompleteInput.pos` to `AutocompletePosition` and `selectedCompletionInfo` to `SelectedCompletionInfo | undefined`. Keep all other defaults and pipeline behavior byte-for-byte unless an import or type requires adjustment.

- [ ] **Step 4: Extend the shared connection contract**

Add the existing concrete connection method to `ConnectionPort`:

```ts
export interface ConnectionPort {
  onStateChange(listener: (state: ConnectionState) => void): () => void
  getConnectionState(): ConnectionState
  getServerConfig(): ServerConfig | null
  getClientAsync(directory: string): Promise<OpencodeClient>
}

export type AutocompleteConnection = Pick<ConnectionPort, "getConnectionState" | "getClientAsync">
```

Both existing concrete hosts already expose `getConnectionState()`, so this tightens the port without adding host behavior.

- [ ] **Step 5: Implement the shared facade minimally**

Implement the following public surface in `service.ts`:

```ts
export type AutocompleteServiceHooks = {
  onActivity?: (active: boolean) => void
  onFatalError?: (status: number | null) => void
  log?: (message: string) => void
}

export class RaccoonAutocompleteService {
  constructor(
    connection: AutocompleteConnection,
    directory: string,
    model: string,
    hooks?: AutocompleteServiceHooks,
  )

  setModel(model: string): void
  resetBackoff(): void
  complete(input: AutocompleteInput, signal: AbortSignal): Promise<AutocompleteOutcome | undefined>
  accept(completion: string, filepath: string): void
}
```

Normalize `model` through `getAutocompleteModel(model).id`; return `undefined` before touching the connection when the signal is already aborted, disconnected or blocked; call `hooks.onActivity(true/false)` with `finally`; construct `RaccoonFimLlm` with backoff success/failure hooks; emit `onFatalError` once per fatal period; delegate acceptance to `CompletionProvider.accept`.

- [ ] **Step 6: Add failure, cancellation and model tests**

Add tests with exact assertions:

```ts
test("does not create a client while disconnected", async () => {
  let calls = 0
  const service = new RaccoonAutocompleteService(
    {
      getConnectionState: () => "disconnected",
      getClientAsync: async () => {
        calls += 1
        throw new Error("must not connect")
      },
    },
    "/workspace",
    "raccoon-pro-completion",
  )

  expect(await service.complete(input, new AbortController().signal)).toBeUndefined()
  expect(calls).toBe(0)
})

test("returns no completion for an aborted request", async () => {
  const controller = new AbortController()
  let calls = 0
  const service = new RaccoonAutocompleteService(
    {
      getConnectionState: () => "connected",
      getClientAsync: async () => {
        calls += 1
        throw new Error("must not request after cancellation")
      },
    },
    "/workspace",
    "raccoon-pro-completion",
  )
  controller.abort()
  expect(await service.complete(input, controller.signal)).toBeUndefined()
  expect(calls).toBe(0)
})
```

Also assert that `setModel("unknown")` causes the next FIM request body to use `DEFAULT_AUTOCOMPLETE_MODEL.id`, and that a `402` failure invokes the fatal hook once and blocks the following request.

- [ ] **Step 7: Export the shared API and run core verification**

Export the facade and public types from `packages/raccoon-core/src/index.ts`, then run from `packages/raccoon-core`:

```bash
bun test src/services/autocomplete
bun run typecheck
```

Expected: all moved and new tests PASS; typecheck exits 0.

- [ ] **Step 8: Review checkpoint without committing**

Run:

```bash
git diff --check -- packages/raccoon-core
git status --short packages/raccoon-core
```

Confirm only the planned extraction, types, tests and exports appear. Do not commit.

### Task 2: Repoint the VS Code adapter without changing behavior

**Files:**
- Modify: `packages/raccoon-vscode/src/services/autocomplete/vscodeProvider.ts`
- Modify: `packages/raccoon-vscode/src/services/autocomplete/AutocompleteServiceManager.ts`
- Delete: migrated neutral files under `packages/raccoon-vscode/src/services/autocomplete/`
- Keep: `packages/raccoon-vscode/src/services/autocomplete/{index.ts,StatusBar.ts,AutocompleteServiceManager.ts,vscodeProvider.ts}`

**Interfaces:**
- Consumes: `RaccoonAutocompleteService.complete`, `.accept`, `.setModel`, and `.resetBackoff` from Task 1.
- Produces: unchanged `AutocompleteInlineCompletionProvider` implementing `vscode.InlineCompletionItemProvider`.

- [ ] **Step 1: Capture the VS Code regression baseline**

Run from `packages/raccoon-vscode` before changing imports:

```bash
bun run check-types
bun run lint
node esbuild.cjs
```

Expected: all three commands exit 0. If a baseline command already fails, record its exact output and do not attribute it to this task.

- [ ] **Step 2: Replace the private pipeline with the shared facade**

In `vscodeProvider.ts`, import the shared API:

```ts
import {
  DEFAULT_AUTOCOMPLETE_MODEL,
  RaccoonAutocompleteService,
  type AutocompleteInput,
  type AutocompleteOutcome,
} from "@opencode-ai/raccoon-core"
```

Construct `RaccoonAutocompleteService` with the existing connection, workspace path, model ID and callbacks. Keep the accepted command, `lastOutcome`, fatal warning, suggestion context key and `InlineCompletionItem` creation in the VS Code adapter.

Map `selectedCompletionInfo.range` explicitly into plain objects:

```ts
const selectedCompletionInfo = context.selectedCompletionInfo
  ? {
      text: context.selectedCompletionInfo.text,
      range: {
        start: {
          line: context.selectedCompletionInfo.range.start.line,
          character: context.selectedCompletionInfo.range.start.character,
        },
        end: {
          line: context.selectedCompletionInfo.range.end.line,
          character: context.selectedCompletionInfo.range.end.character,
        },
      },
    }
  : undefined
```

Continue to use the original VS Code range when creating the returned item. Preserve `completeBracketPairs = true`, end-of-line replacement, multi-cursor guard and `vscode-scm` guard.

- [ ] **Step 3: Delegate lifecycle methods**

Make `setModel`, `resetBackoff`, and accepted-completion handling call the matching shared facade methods. Adapter disposal continues to unregister its VS Code command; remove adapter-owned `ErrorBackoff`, `RaccoonFimLlm`, and `CompletionProvider` state.

- [ ] **Step 4: Remove migrated duplicate files**

After all adapter imports point to `@opencode-ai/raccoon-core`, delete the neutral implementations and their tests from the VS Code package. Leave only the four VS Code-specific files listed above.

- [ ] **Step 5: Verify VS Code compatibility**

Run from `packages/raccoon-vscode`:

```bash
bun run check-types
bun run lint
node esbuild.cjs
```

Then run from `packages/raccoon-core`:

```bash
bun test src/services/autocomplete
```

Expected: every command exits 0; the extension bundle resolves the shared core; core tests remain PASS.

- [ ] **Step 6: Review checkpoint without committing**

Run `git diff --check -- packages/raccoon-vscode packages/raccoon-core` and confirm the VS Code manifest configuration keys and commands are unchanged. Do not commit.

### Task 3: Add the shared autocomplete model setting

**Files:**
- Modify: `packages/raccoon-webview/src/protocol.ts`
- Create: `packages/raccoon-webview/src/components/settings/settings-autocomplete.test.tsx`
- Modify: `packages/raccoon-webview/src/components/settings/settings-autocomplete.tsx`
- Modify: `packages/raccoon-webview/src/components/settings/settings-view.tsx`
- Modify: `packages/raccoon-webview/src/i18n/{en,zh,zh-hant}.ts`
- Modify: `packages/raccoon-core/src/provider/platform.ts`
- Modify: `packages/raccoon-core/src/provider/index.ts`
- Modify: `packages/raccoon-vscode/src/provider/vscode-platform.ts`
- Modify: `packages/raccoon-intellij/sidecar/rpc.ts`
- Modify: `packages/raccoon-intellij/sidecar/platform.ts`
- Modify: `packages/raccoon-intellij/sidecar/index.ts`

**Interfaces:**
- Consumes: `AUTOCOMPLETE_MODELS`, `DEFAULT_AUTOCOMPLETE_MODEL`, `getAutocompleteModel`.
- Produces: `RaccoonState.autocompleteModel`, `RaccoonState.autocompleteModels`, `saveSettings.autocompleteModel`, and host model setting methods/events.

- [ ] **Step 1: Write a failing settings component test**

Create `settings-autocomplete.test.tsx` using the existing providers and render helper:

```tsx
test("renders and selects the configured autocomplete model", () => {
  const html = render(
    <SettingsAutocomplete
      enabled
      model="raccoon-completion"
      models={[
        { id: "raccoon-pro-completion", label: "Raccoon Complete Pro" },
        { id: "raccoon-completion", label: "Raccoon Complete" },
      ]}
      onEnabledChange={() => {}}
      onModelChange={() => {}}
    />,
  )

  expect(html).toContain("Raccoon Complete Pro")
  expect(html).toContain("Raccoon Complete")
  expect(html).toContain("raccoon-completion")
})
```

- [ ] **Step 2: Run the focused Webview test and verify the prop mismatch fails**

Run from `packages/raccoon-webview`:

```bash
bun test src/components/settings/settings-autocomplete.test.tsx
```

Expected: FAIL because `model`, `models`, and `onModelChange` are not accepted.

- [ ] **Step 3: Extend protocol state and save payload**

Add this reusable protocol type:

```ts
export type RaccoonAutocompleteModel = {
  id: string
  label: string
}
```

Add to `RaccoonState`:

```ts
autocompleteEnabled?: boolean
autocompleteModel?: string
autocompleteModels?: RaccoonAutocompleteModel[]
```

Add `autocompleteModel?: string` beside `autocompleteEnabled` inside `saveSettings.settings`. No separate immediate-change message is required because the existing settings page saves drafts through `saveSettings`.

- [ ] **Step 4: Extend the host settings port and provider state**

Add to `HostPlatform.settings`:

```ts
getAutocompleteModel(): string
setAutocompleteModel(model: string): Promise<void>
onAutocompleteModelChange(listener: (model: string) => void): Disposable
```

Initialize Provider state with normalized host settings and model metadata:

```ts
autocompleteModel: getAutocompleteModel(this.platform.settings.getAutocompleteModel()).id,
autocompleteModels: AUTOCOMPLETE_MODELS.map((model) => ({ id: model.id, label: model.label })),
```

Add a model listener parallel to the enabled listener, dispose it with the Provider, and handle `message.settings.autocompleteModel` in `saveSettings()` by calling a new `setAutocompleteModel(model)` method that normalizes with `getAutocompleteModel` before persisting and posting state.

- [ ] **Step 5: Map both host adapters to their model state**

In `vscode-platform.ts`, add model getters/setters/listener using `raccoon.autocomplete.model` and `vscode.workspace.onDidChangeConfiguration`. Normalize reads and writes with `getAutocompleteModel`; do not add a new VS Code configuration key.

In `sidecar/platform.ts`, add the model field and emitter required by the new host interface. Add `autocompleteModel` to the `init` frame in `rpc.ts`, and pass its normalized value from `sidecar/index.ts`. Persistence back to Kotlin is added with the remaining autocomplete RPC frames in Task 4; at this point the Sidecar must retain model changes for its lifetime and pass type checking.

- [ ] **Step 6: Render and save the Webview draft**

Use the existing `Select` primitive in `SettingsAutocomplete`:

```tsx
<SettingsRow
  title={language.t("settings.autocomplete.model.title")}
  description={language.t("settings.autocomplete.model.description")}
>
  <Select
    className="settings-select w-[220px] max-w-full"
    value={props.model}
    options={props.models.map((model) => ({ value: model.id, label: model.label }))}
    ariaLabel={language.t("settings.autocomplete.model.title")}
    onChange={props.onModelChange}
  />
</SettingsRow>
```

In `SettingsView`, derive `configuredAutocompleteModel` as `config.autocompleteModel ?? config.autocompleteModels?.[0]?.id ?? "raccoon-pro-completion"`. Add `draftAutocompleteModel`, sync it from that value, include it in `dirty` and `discard`, and add `{ autocompleteModel: draftAutocompleteModel }` only when changed. Pass the selected model, available models and setter to `SettingsAutocomplete`.

- [ ] **Step 7: Add translations and verify Webview/core/VS Code**

Add equivalent localized strings for `settings.autocomplete.model.title` and `.description` in all three translation files. Run:

```bash
cd packages/raccoon-webview
bun test src/components/settings/settings-autocomplete.test.tsx src/components/settings/settings-view.test.tsx
bun run typecheck

cd ../raccoon-core
bun test src/provider src/services/autocomplete
bun run typecheck

cd ../raccoon-vscode
bun run check-types
bun run lint

cd ../raccoon-intellij
bun run check-types
```

Expected: all commands exit 0.

- [ ] **Step 8: Review checkpoint without committing**

Run `git diff --check` only on the files listed in this task. Pay special attention to the already-modified Webview protocol and translations; verify existing user changes remain. Do not commit.

### Task 4: Add the IntelliJ Sidecar autocomplete coordinator

**Files:**
- Create: `packages/raccoon-intellij/sidecar/autocomplete.ts`
- Create: `packages/raccoon-intellij/sidecar/autocomplete.test.ts`
- Modify: `packages/raccoon-intellij/sidecar/rpc.ts`
- Modify: `packages/raccoon-intellij/sidecar/platform.ts`
- Modify: `packages/raccoon-intellij/sidecar/index.ts`

**Interfaces:**
- Consumes: `RaccoonAutocompleteService`, `AutocompleteInput`, and Sidecar platform settings.
- Produces: `autocompleteComplete`, `autocompleteCancel`, `autocompleteAccept`, `autocompleteResult`, and `autocompleteSettings` stdio frames.

- [ ] **Step 1: Write failing coordinator tests**

Define a minimal service port in `autocomplete.ts` so the coordinator can be tested without SDK mocks:

```ts
export interface AutocompleteEngine {
  complete(input: AutocompleteInput, signal: AbortSignal): Promise<AutocompleteOutcome | undefined>
  accept(completion: string, filepath: string): void
  setModel(model: string): void
  resetBackoff(): void
}
```

Write a deferred-promise test that starts request `one`, then request `two`, resolves both, and asserts only `two` emits:

```ts
expect(firstSignal.aborted).toBe(true)
expect(sent).toEqual([{ type: "autocompleteResult", requestID: "two", completion: "second" }])
```

Also test that `cancel("one")` aborts only the matching active request and `dispose()` aborts the active request without emitting a result.

- [ ] **Step 2: Run the focused test and verify it fails**

Run from `packages/raccoon-intellij`:

```bash
bun test sidecar/autocomplete.test.ts
```

Expected: FAIL because the coordinator does not exist.

- [ ] **Step 3: Define concrete RPC frames**

Retain the `init` frame extended in Task 3 and add the three request frames to `HostToSidecar`:

```ts
| { type: "autocompleteComplete"; requestID: string; input: AutocompleteInput }
| { type: "autocompleteCancel"; requestID: string }
| { type: "autocompleteAccept"; completion: string; filepath: string }
```

Extend `SidecarToHost`:

```ts
| { type: "autocompleteResult"; requestID: string; completion?: string }
| { type: "autocompleteSettings"; enabled: boolean; model: string }
```

Keep newline framing and stdout reservation unchanged.

- [ ] **Step 4: Implement one-active-request coordination**

Implement `SidecarAutocomplete` with this public surface:

```ts
export class SidecarAutocomplete {
  constructor(engine: AutocompleteEngine, send: (message: SidecarToHost) => void)
  complete(requestID: string, input: AutocompleteInput): void
  cancel(requestID: string): void
  accept(completion: string, filepath: string): void
  setEnabled(enabled: boolean): void
  setModel(model: string): void
  resetBackoff(): void
  dispose(): void
}
```

`complete()` must cancel the prior controller, create a new one, and emit only if the active ID and controller still match after awaiting. Disabled requests emit one empty `autocompleteResult` immediately. `setEnabled(false)` cancels the active request. Active state is cleared in `finally` only if it still belongs to that request.

- [ ] **Step 5: Add the persistence callback to SidecarPlatform**

Add an `onAutocompleteSettingsChange` callback beside the model state introduced in Task 3. On either enabled or model change, emit the local listener and call:

```ts
opts.onAutocompleteSettingsChange({
  enabled: this.autocompleteEnabled,
  model: this.autocompleteModel,
})
```

Normalize the model before storing it.

- [ ] **Step 6: Wire the coordinator in the Sidecar entry point**

Create the shared service after `connection` and `platform`, pass `platform.settings.getAutocompleteModel()`, and subscribe to enabled/model changes to update the coordinator. Route all three new host frames. On `dispose`, abort the coordinator before disposing Provider and connection.

Send `autocompleteSettings` from the Sidecar platform callback; initialize unknown/missing models to the shared default. Keep chat transport routing unchanged.

- [ ] **Step 7: Run Sidecar verification**

Run from `packages/raccoon-intellij`:

```bash
bun test sidecar/autocomplete.test.ts
bun run check-types
bun run build:sidecar
```

Expected: tests PASS, typecheck exits 0, and `src/main/resources/sidecar/sidecar.cjs` is generated successfully.

- [ ] **Step 8: Review checkpoint without committing**

Run `git diff --check -- packages/raccoon-intellij/sidecar packages/raccoon-intellij/src/main/resources/sidecar`. Confirm stdout writes remain limited to typed RPC frames. Do not commit.

### Task 5: Decouple Sidecar startup and persist IntelliJ autocomplete settings

**Files:**
- Create: `packages/raccoon-intellij/src/main/kotlin/com/sensetime/sensecode/jetbrains/raccoon/autocomplete/RaccoonAutocompleteSettings.kt`
- Modify: `packages/raccoon-intellij/src/main/kotlin/com/sensetime/sensecode/jetbrains/raccoon/RaccoonService.kt`
- Modify: `packages/raccoon-intellij/src/main/kotlin/com/sensetime/sensecode/jetbrains/raccoon/SidecarProcess.kt`
- Modify: `packages/raccoon-intellij/build.gradle.kts`
- Test: `packages/raccoon-intellij/src/test/kotlin/com/sensetime/sensecode/jetbrains/raccoon/autocomplete/AutocompleteSettingsTest.kt`

**Interfaces:**
- Consumes: Task 4 RPC frames.
- Produces: `ensureStarted`, `requestAutocomplete`, `cancelAutocomplete`, `acceptAutocomplete`, and project-persisted settings.

- [ ] **Step 1: Add Kotlin test support and a failing normalization test**

Add `testImplementation(kotlin("test"))` to the existing Gradle dependencies without changing IntelliJ platform coordinates or current resource tasks. Create a pure normalization function and test:

```kotlin
class AutocompleteSettingsTest {
    @Test
    fun `unknown model falls back to pro completion`() {
        assertEquals("raccoon-pro-completion", normalizeAutocompleteModel("unknown"))
    }

    @Test
    fun `known completion model is preserved`() {
        assertEquals("raccoon-completion", normalizeAutocompleteModel("raccoon-completion"))
    }
}
```

- [ ] **Step 2: Run the focused Gradle test and verify it fails**

Run from `packages/raccoon-intellij`:

```bash
./gradlew test --tests '*AutocompleteSettingsTest'
```

Expected: FAIL because the settings implementation does not exist.

- [ ] **Step 3: Implement project-level persistence**

Use `PropertiesComponent.getInstance(project)` with exact keys:

```kotlin
private const val ENABLED_KEY = "raccoon.autocomplete.enabled"
private const val MODEL_KEY = "raccoon.autocomplete.model"
const val DEFAULT_AUTOCOMPLETE_MODEL = "raccoon-pro-completion"
```

Annotate the class with `@Service(Service.Level.PROJECT)`. Expose `enabled` with default `true` and `model` normalized to either `raccoon-pro-completion` or `raccoon-completion`. Setters persist through `setValue`; no application-global storage is added.

- [ ] **Step 4: Make Sidecar startup idempotent and independent of Tool Window**

Refactor `RaccoonService` so `initToolWindow()` creates the Webview/content and then calls an idempotent synchronized `ensureStarted()`. `ensureStarted()` resolves resources, creates exactly one `SidecarProcess`, starts it, and sends an `init` frame populated from `RaccoonAutocompleteSettings`:

```json
{
  "type": "init",
  "directory": "/workspace",
  "locale": "zh-CN",
  "autocompleteEnabled": true,
  "autocompleteModel": "raccoon-pro-completion"
}
```

Build JSON with Gson objects rather than interpolating document content into strings.

- [ ] **Step 5: Add correlated host methods**

Store callbacks in `ConcurrentHashMap<String, (String?) -> Unit>` keyed by request ID and add these methods:

```kotlin
fun requestAutocomplete(requestID: String, input: JsonObject, callback: (String?) -> Unit)
fun cancelAutocomplete(requestID: String)
fun acceptAutocomplete(completion: String, filepath: String)
```

`requestAutocomplete` calls `ensureStarted()`, replaces any callback for the same ID, and sends `autocompleteComplete`. `onSidecarMessage` removes and invokes the callback for `autocompleteResult`; handles `autocompleteSettings` by updating project settings. `cancelAutocomplete` removes the callback before sending cancellation.

- [ ] **Step 6: Handle process termination cleanly**

Add `onTerminated: () -> Unit` to `SidecarProcess`. Invoke it from `processTerminated` after logging. `RaccoonService` clears its Sidecar reference and completes every outstanding callback with `null`; guard normal disposal so it does not restart or double-notify.

- [ ] **Step 7: Run Kotlin and Sidecar verification**

Run from `packages/raccoon-intellij`:

```bash
./gradlew test --tests '*AutocompleteSettingsTest'
bun run check-types
bun run build:sidecar
```

Expected: all commands exit 0.

- [ ] **Step 8: Review checkpoint without committing**

Inspect `git diff -- packages/raccoon-intellij/build.gradle.kts` carefully because it already contains user changes. Confirm the only new Gradle change is Kotlin test support and all existing Webview resource tasks remain. Do not commit.

### Task 6: Implement IntelliJ render planning and project autocomplete service

**Files:**
- Create: `packages/raccoon-intellij/src/main/kotlin/com/sensetime/sensecode/jetbrains/raccoon/autocomplete/AutocompleteText.kt`
- Create: `packages/raccoon-intellij/src/test/kotlin/com/sensetime/sensecode/jetbrains/raccoon/autocomplete/AutocompleteTextTest.kt`
- Create: `packages/raccoon-intellij/src/main/kotlin/com/sensetime/sensecode/jetbrains/raccoon/autocomplete/RaccoonInlayRenderer.kt`
- Create: `packages/raccoon-intellij/src/main/kotlin/com/sensetime/sensecode/jetbrains/raccoon/autocomplete/RaccoonAutocompleteService.kt`

**Interfaces:**
- Consumes: `RaccoonService` correlated host methods and `RaccoonAutocompleteSettings`.
- Produces: `trigger(editor)`, `clear(editor?)`, `hasSuggestion(editor, caretOffset)`, and `accept(editor)`.

- [ ] **Step 1: Write failing pure text-plan tests**

Define the expected API in tests:

```kotlin
@Test
fun `single-line completion replaces through line end`() {
    assertEquals(
        AutocompleteRenderPlan("println(value)", "println(value)", 13),
        planAutocomplete("val x = prin)", 8, 13, "println(value)"),
    )
}

@Test
fun `multiline completion is rejected before nonblank line suffix`() {
    assertNull(planAutocomplete("val x = suffix", 8, 14, "first\nsecond"))
}

@Test
fun `matching suffix is not duplicated`() {
    assertEquals(
        AutocompleteRenderPlan("value", "value)", 8),
        planAutocomplete("return )", 7, 8, "value)"),
    )
}
```

- [ ] **Step 2: Run the focused tests and verify missing symbols fail**

Run from `packages/raccoon-intellij`:

```bash
./gradlew test --tests '*AutocompleteTextTest'
```

Expected: FAIL because `AutocompleteRenderPlan` and `planAutocomplete` do not exist.

- [ ] **Step 3: Implement pure render planning**

Create:

```kotlin
data class AutocompleteRenderPlan(
    val displayText: String,
    val insertText: String,
    val replaceEndOffset: Int,
)

fun planAutocomplete(
    documentText: String,
    caretOffset: Int,
    lineEndOffset: Int,
    completion: String,
): AutocompleteRenderPlan?
```

Return `null` for empty completion, invalid offsets, or multiline completion before a nonblank line suffix. For a single-line suggestion, find the nonblank current-line suffix inside the completion: trim only `displayText` before a later matching suffix, retain the raw completion as `insertText`, return `null` when the completion starts with the entire existing suffix, and keep end-of-line replacement semantics. Keeping display and insertion text separate prevents a visually deduplicated auto-closing bracket from being lost on acceptance.

- [ ] **Step 4: Implement the inlay renderer**

Port only the reference repository's rendering concept. Use the editor plain font with fallback and the IDE inactive/ghost foreground color. Add one inline inlay for the first non-empty line and one block inlay for remaining lines. Do not add the reference status widget or partial-accept code.

- [ ] **Step 5: Implement the project service state machine**

Use this pending state:

```kotlin
data class PendingAutocomplete(
    val requestID: String,
    val editor: Editor,
    val documentStamp: Long,
    val caretOffset: Int,
    val replaceEndOffset: Int,
    val filepath: String,
    val displayText: String?,
    val insertText: String?,
)
```

`trigger(editor)` must:

1. reject disabled settings, disposed/non-main editors, multiple carets, selections, missing virtual files and injected documents;
2. clear/cancel the previous state;
3. capture document text, `modificationStamp`, caret logical position, language ID and file path inside a read action;
4. create an `AutocompleteInput` Gson object with `isUntitledFile = false`;
5. call `RaccoonService.requestAutocomplete`;
6. on the EDT, validate request ID, editor identity, document stamp and caret offset;
7. call `planAutocomplete`, render `displayText`, and attach both display/insertion text plus range to pending state.

Use an internal `accepting` flag so the document event caused by `accept()` does not immediately trigger another request.

- [ ] **Step 6: Implement accept and clear behavior**

`accept(editor)` checks editor/caret/document stamp, then uses `WriteCommandAction.runWriteCommandAction` to replace `[caretOffset, replaceEndOffset)` with `insertText` and move the caret. Send `acceptAutocomplete(insertText, filepath)` after a successful write, dispose inlays, and clear pending state.

`clear(editor?)` removes only `RaccoonInlayRenderer` instances, cancels the matching request, and leaves unrelated IDE inlays untouched. Make repeated clear calls safe.

- [ ] **Step 7: Run focused and compile verification**

Run from `packages/raccoon-intellij`:

```bash
./gradlew test --tests '*AutocompleteTextTest'
./gradlew compileKotlin
```

Expected: tests PASS and IntelliJ Kotlin sources compile.

- [ ] **Step 8: Review checkpoint without committing**

Run `git diff --check` on the four files and their tests. Confirm no code from the reference repository's diff editor, status widget, partial accept or settings classes was copied. Do not commit.

### Task 7: Register editor listeners and conditional shortcuts

**Files:**
- Create: `packages/raccoon-intellij/src/main/kotlin/com/sensetime/sensecode/jetbrains/raccoon/autocomplete/AutocompleteEditorListener.kt`
- Create: `packages/raccoon-intellij/src/main/kotlin/com/sensetime/sensecode/jetbrains/raccoon/autocomplete/AutocompleteLookupListener.kt`
- Create: `packages/raccoon-intellij/src/main/kotlin/com/sensetime/sensecode/jetbrains/raccoon/autocomplete/AcceptAutocompleteAction.kt`
- Create: `packages/raccoon-intellij/src/main/kotlin/com/sensetime/sensecode/jetbrains/raccoon/autocomplete/CancelAutocompleteAction.kt`
- Create: `packages/raccoon-intellij/src/main/kotlin/com/sensetime/sensecode/jetbrains/raccoon/autocomplete/RaccoonActionPromoter.kt`
- Modify: `packages/raccoon-intellij/src/main/resources/META-INF/plugin.xml`
- Create: `packages/raccoon-intellij/test/autocomplete-registration.test.ts`

**Interfaces:**
- Consumes: Task 6 project service.
- Produces: automatic trigger/clear lifecycle and conditional `Tab`/`Esc` integration.

- [ ] **Step 1: Write a failing plugin registration test**

Read `plugin.xml` and assert:

```ts
expect(xml).toContain("AutocompleteEditorListener")
expect(xml).toContain("RaccoonActionPromoter")
expect(xml).toContain("AcceptAutocompleteAction")
expect(xml).toContain('first-keystroke="TAB"')
expect(xml).toContain("CancelAutocompleteAction")
expect(xml).toContain('first-keystroke="ESCAPE"')
expect(xml).not.toContain("PartialAcceptAutocompleteAction")
expect(xml).not.toContain("AutocompleteSpinnerWidget")
```

- [ ] **Step 2: Run the focused Bun test and verify it fails**

Run from `packages/raccoon-intellij`:

```bash
bun test test/autocomplete-registration.test.ts
```

Expected: FAIL because the registrations do not exist.

- [ ] **Step 3: Implement editor lifecycle listeners**

Register listeners per created main editor and unregister them on release:

- document change: `invokeLater` and call `trigger(editor)` only when it remains the selected editor;
- caret/selection change: call `clear(editor)` unless the service is currently accepting;
- selected file change: clear the old editor;
- lookup shown: clear the current suggestion so IDEA completion owns `Tab`.

Tie listener connections to editor/project disposal; do not keep released editors in a global collection.

Create an annotation-based project service `AutocompleteLookupListener`. On construction, connect to `LookupManagerListener.TOPIC`; when `activeLookupChanged` supplies a lookup, clear the suggestion for that lookup's editor. Resolve this service once from `AutocompleteEditorListener.editorCreated` so the project subscription is installed without adding an XML service registration.

- [ ] **Step 4: Implement conditional actions**

`AcceptAutocompleteAction` extends `EditorAction`. Its handler calls `service.accept(editor)` inside the service's write-command path. `isEnabledForCaret` returns `service.hasSuggestion(editor, caret.offset)`.

`CancelAutocompleteAction` uses the same condition and calls `service.clear(editor)`. When either condition is false, IntelliJ's original action remains available.

- [ ] **Step 5: Promote only the enabled accept action**

Implement `ActionPromoter` by reading `CommonDataKeys.EDITOR` from the `DataContext`, resolving the project `RaccoonAutocompleteService`, and checking `hasSuggestion(editor, editor.caretModel.offset)`. Return `actions.filterIsInstance<AcceptAutocompleteAction>()` only when that list is non-empty and the service reports a valid suggestion; otherwise return `null`. This gives an active suggestion priority over the default Tab action without globally consuming Tab.

- [ ] **Step 6: Register the listener, promoter and actions**

Add to the existing `<extensions>` block:

```xml
<editorFactoryListener implementation="com.sensetime.sensecode.jetbrains.raccoon.autocomplete.AutocompleteEditorListener"/>
<actionPromoter order="last" implementation="com.sensetime.sensecode.jetbrains.raccoon.autocomplete.RaccoonActionPromoter"/>
```

Annotate `RaccoonAutocompleteService`, `RaccoonAutocompleteSettings`, and `AutocompleteLookupListener` with `@Service(Service.Level.PROJECT)`, matching the existing `RaccoonService`; do not duplicate those services in `plugin.xml`.

Add the two actions under `<actions>` with exact `TAB` and `ESCAPE` shortcuts for `$default` and `Mac OS X`. Do not register partial accept or a status widget.

- [ ] **Step 7: Run registration and Kotlin verification**

Run from `packages/raccoon-intellij`:

```bash
bun test test/autocomplete-registration.test.ts
./gradlew test
./gradlew compileKotlin
```

Expected: all commands exit 0.

- [ ] **Step 8: Review checkpoint without committing**

Run `git diff --check -- packages/raccoon-intellij/src/main packages/raccoon-intellij/test`. Confirm existing Tool Window registration and icons remain unchanged. Do not commit.

### Task 8: End-to-end packaging and regression verification

**Files:**
- Modify only if a verification failure proves a local integration defect in files from Tasks 1–7.
- Inspect: all files listed in the plan plus existing user-modified files that overlap the final diff.

**Interfaces:**
- Consumes: completed shared core, VS Code adapter, Webview setting, Sidecar and Kotlin host.
- Produces: a verified IntelliJ plugin artifact and unchanged VS Code build.

- [ ] **Step 1: Run the complete shared-core suite**

From `packages/raccoon-core`:

```bash
bun test
bun run typecheck
```

Expected: all tests PASS and typecheck exits 0.

- [ ] **Step 2: Run VS Code regression checks**

From `packages/raccoon-vscode`:

```bash
bun run check-types
bun run lint
node esbuild.cjs
```

Expected: all commands exit 0 and generate the extension bundle.

- [ ] **Step 3: Run Webview checks**

From `packages/raccoon-webview`:

```bash
bun test
bun run typecheck
```

Expected: all tests PASS and typecheck exits 0.

- [ ] **Step 4: Run IntelliJ TypeScript and Kotlin checks**

From `packages/raccoon-intellij`:

```bash
bun test
bun run check-types
bun run build:sidecar
./gradlew test
./gradlew compileKotlin
```

Expected: all commands exit 0.

- [ ] **Step 5: Build the IntelliJ plugin package**

From `packages/raccoon-intellij`:

```bash
./gradlew buildPlugin
```

Expected: Gradle exits 0 and writes a plugin archive under `build/distributions/` containing `META-INF/plugin.xml`, Webview assets, `sidecar/sidecar.cjs`, icons and bundled platform binaries.

- [ ] **Step 6: Inspect the packaged archive**

Run from `packages/raccoon-intellij`:

```bash
plugin_archive=$(find build/distributions -maxdepth 1 -name '*.zip' -print | sort | tail -1)
test -n "$plugin_archive"
unzip -l "$plugin_archive" | rg 'plugin.xml|sidecar.cjs|webview/assets|bin/.*/raccoon'
```

Expected: each resource class appears at least once; no partial-accept or autocomplete-status-widget class is present.

- [ ] **Step 7: Run an IDE smoke check when credentials are available**

Start the sandbox IDE from `packages/raccoon-intellij` with `./gradlew runIde`. In a normal source file with one caret, verify: typing pauses and shows gray text; `Esc` clears it; a fresh suggestion is accepted by `Tab`; opening native code completion clears Raccoon text; disabling autocomplete stops requests; selecting each model persists after closing and reopening settings; autocomplete works before opening the Raccoon Tool Window.

If the sandbox IDE has no usable Raccoon login or backend access, stop after verifying plugin load, settings persistence, shortcut registration and absence of editor exceptions, and report the live FIM portion as skipped because credentials were unavailable.

- [ ] **Step 8: Run final diff and whitespace checks**

From the repository root:

```bash
git diff --check
git status --short
git diff --stat
```

Compare the final status with the baseline recorded before implementation. Confirm every newly changed path belongs to this plan and all pre-existing user changes remain.

- [ ] **Step 9: Report without committing**

Report changed files by package, every command run and its result, the built archive path, and any check that could not run. Do not claim manual IDE behavior was verified unless `runIde` was actually exercised; do not commit unless the user explicitly asks.
