/**
 * Tunable autocomplete options, mirroring the subset of continue-rac's
 * TabAutocompleteOptions that the prefix/suffix-only pipeline uses.
 */
export interface AutocompleteOptions {
  disable: boolean
  maxPromptTokens: number
  prefixPercentage: number
  maxSuffixPercentage: number
  debounceDelay: number
  multilineCompletions: "always" | "never" | "auto"
  useCache: boolean
  transform: boolean
  showWhateverWeHaveAtXMs: number
}

export const DEFAULT_AUTOCOMPLETE_OPTIONS: AutocompleteOptions = {
  disable: false,
  maxPromptTokens: 768,
  prefixPercentage: 0.3,
  maxSuffixPercentage: 0.2,
  debounceDelay: 250,
  multilineCompletions: "auto",
  useCache: true,
  transform: true,
  // Batch-rendered: await the whole stream then show once, so progressive
  // truncation is disabled (it would only cut multi-line completions short).
  showWhateverWeHaveAtXMs: 0,
}

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

/**
 * Everything the core pipeline needs about a single completion request,
 * decoupled from host editor types. Built by the host provider layer.
 */
export interface AutocompleteInput {
  completionId: string
  filepath: string
  languageId: string
  pos: AutocompletePosition
  /** Full document text (already resolved by the provider). */
  fileContents: string
  selectedCompletionInfo?: SelectedCompletionInfo
  isUntitledFile: boolean
}

/** Result of a completion, with metadata for caching/logging. */
export interface AutocompleteOutcome {
  completion: string
  prefix: string
  suffix: string
  modelName: string
  cacheHit: boolean
  time: number
  numLines: number
  completionId: string
  filepath: string
}
