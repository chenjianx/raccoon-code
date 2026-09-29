// Public surface of @opencode-ai/raccoon-core. The platform-agnostic orchestrator plus the
// port contracts and pure helpers that host adapters (VSCode, future JetBrains) build against.

export { RaccoonProvider } from "./provider/index.js"

export type {
  AutocompleteConnection,
  ConnectionPort,
  ConnectionState,
  ServerConfig,
  Disposable,
  Emitter,
  KeyValueStore,
  HostPlatform,
  WebviewTransport,
  RaccoonWebviewSource,
  EditorContext,
  EditorContextAction,
  EditorDiagnostic,
  DocumentRangeRef,
  FileSearchResult,
} from "./provider/platform.js"

export { isRaccoonLoggedIn } from "./provider/session/raccoon-auth-state.js"

export { createPrompt } from "./provider/editor/editor-prompt.js"
export { formatTerminalOutput, gitChangesContext } from "./provider/editor/context-mentions.js"

export { MarketplaceService } from "./services/marketplace/index.js"
export type { McpStatus } from "./services/marketplace/index.js"
export { SkillMarketplaceService } from "./services/skill-marketplace/index.js"

export {
  AUTOCOMPLETE_MODELS,
  DEFAULT_AUTOCOMPLETE_MODEL,
  getAutocompleteModel,
  type AutocompleteModelDef,
} from "./services/autocomplete/models.js"

export { RaccoonAutocompleteService, type AutocompleteServiceHooks } from "./services/autocomplete/service.js"
export type {
  AutocompleteInput,
  AutocompleteOutcome,
  AutocompletePosition,
  AutocompleteRange,
  SelectedCompletionInfo,
} from "./services/autocomplete/util/types.js"

export { FUNCTION_LANGUAGES, functionLanguage, type FunctionLanguage } from "./function-symbols.js"
