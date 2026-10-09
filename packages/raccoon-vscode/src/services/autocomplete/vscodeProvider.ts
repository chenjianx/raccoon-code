import * as vscode from "vscode"
import {
  DEFAULT_AUTOCOMPLETE_MODEL,
  RaccoonAutocompleteService,
  type AutocompleteInput,
  type AutocompleteOutcome,
} from "@opencode-ai/raccoon-core"
import type { RaccoonConnectionService } from "../cli-backend/index.js"

export interface AutocompleteSettings {
  enableAutoTrigger?: boolean
  model?: string
}

const INLINE_COMPLETION_ACCEPTED_COMMAND = "raccoon.autocomplete.inline-completion.accepted"

let completionIdCounter = 0

/**
 * VSCode adapter (InlineCompletionItemProvider) over the shared autocomplete facade.
 * Ported from continue-rac (extensions/vscode/src/autocomplete/completionProvider.ts),
 * keeping the accepted-completion context key and VSCode-specific presentation.
 */
export class AutocompleteInlineCompletionProvider implements vscode.InlineCompletionItemProvider {
  private readonly autocompleteService: RaccoonAutocompleteService
  private acceptedCommand: vscode.Disposable | null = null
  private lastOutcome: AutocompleteOutcome | undefined

  constructor(
    modelId: string,
    connectionService: RaccoonConnectionService,
    private readonly getSettings: () => AutocompleteSettings | null,
    workspacePath: string,
    onFatalError?: (status: number | null) => void,
    private readonly log: (msg: string) => void = () => {},
    onActivity?: (active: boolean) => void,
  ) {
    this.autocompleteService = new RaccoonAutocompleteService(
      connectionService,
      workspacePath,
      modelId || DEFAULT_AUTOCOMPLETE_MODEL.id,
      { onFatalError, log: this.log, onActivity },
    )

    this.acceptedCommand = vscode.commands.registerCommand(INLINE_COMPLETION_ACCEPTED_COMMAND, () => {
      if (this.lastOutcome) {
        this.autocompleteService.accept(this.lastOutcome.completion, this.lastOutcome.filepath)
      }
      vscode.commands.executeCommand("setContext", "raccoon.autocomplete.hasSuggestions", false)
    })
  }

  public setModel(modelId: string): void {
    this.autocompleteService.setModel(modelId)
  }

  public resetBackoff(): void {
    this.autocompleteService.resetBackoff()
  }

  public dispose(): void {
    this.acceptedCommand?.dispose()
    this.acceptedCommand = null
  }

  private setHasSuggestions(value: boolean): void {
    vscode.commands.executeCommand("setContext", "raccoon.autocomplete.hasSuggestions", value)
  }

  public async provideInlineCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    context: vscode.InlineCompletionContext,
    token: vscode.CancellationToken,
  ): Promise<vscode.InlineCompletionItem[] | vscode.InlineCompletionList | undefined> {
    const settings = this.getSettings()
    if (!(settings?.enableAutoTrigger ?? false)) {
      return undefined
    }
    return this.provideInlineCompletionItems_Internal(document, position, context, token)
  }

  public async provideInlineCompletionItems_Internal(
    document: vscode.TextDocument,
    position: vscode.Position,
    context: vscode.InlineCompletionContext,
    token: vscode.CancellationToken,
  ): Promise<vscode.InlineCompletionItem[] | vscode.InlineCompletionList | undefined> {
    if (token.isCancellationRequested) {
      return undefined
    }
    if (document.uri.scheme === "vscode-scm") {
      return undefined
    }
    // Don't autocomplete with multi-cursor.
    const editor = vscode.window.activeTextEditor
    if (editor && editor.selections.length > 1) {
      return undefined
    }

    if (context.selectedCompletionInfo) {
      const { text, range } = context.selectedCompletionInfo
      const typedText = document.getText(range)
      const typedLength = range.end.character - range.start.character
      if (typedLength < 4) return undefined
      if (!text.startsWith(typedText)) return undefined
    }

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

    const abortController = new AbortController()
    const signal = abortController.signal
    token.onCancellationRequested(() => abortController.abort())

    const input: AutocompleteInput = {
      completionId: `${++completionIdCounter}`,
      filepath: document.uri.fsPath,
      languageId: document.languageId,
      pos: { line: position.line, character: position.character },
      fileContents: document.getText(),
      selectedCompletionInfo,
      isUntitledFile: document.isUntitled,
    }

    const outcome = await this.autocompleteService.complete(input, signal)

    if (signal.aborted || !outcome || !outcome.completion) {
      this.setHasSuggestions(false)
      return undefined
    }
    this.lastOutcome = outcome

    const startPos = context.selectedCompletionInfo?.range.start ?? position
    // Replace from the completion start to the end of the current line (matching
    // continue-rac). The FIM model already accounts for the suffix, so replacing
    // the rest of the line absorbs editor-inserted leftovers — e.g. the `)` that
    // auto-close-brackets adds after `for(` — instead of leaving them dangling
    // after the completion.
    const range = new vscode.Range(startPos, document.lineAt(startPos.line).range.end)
    const item = new vscode.InlineCompletionItem(outcome.completion, range, {
      command: INLINE_COMPLETION_ACCEPTED_COMMAND,
      title: "Autocomplete Accepted",
    })
    // Matches continue-rac: let VSCode auto-close brackets the completion leaves
    // open. Safe now that `range` replaces to end of line (editor-inserted
    // closers are overwritten rather than left dangling after the completion).
    ;(item as unknown as { completeBracketPairs: boolean }).completeBracketPairs = true

    this.setHasSuggestions(true)
    this.log(`[fetch] done, len=${outcome.completion.length} (cacheHit=${outcome.cacheHit}) -> SHOW`)
    return [item]
  }
}
