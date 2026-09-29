import { createRequire } from "module"
import { functionLanguage, type FunctionLanguage } from "@opencode-ai/raccoon-core"
import * as vscode from "vscode"

type TreeSitterPoint = {
  row: number
  column: number
}

type TreeSitterNode = {
  type: string
  startPosition: TreeSitterPoint
  endPosition: TreeSitterPoint
  childCount: number
  child(index: number): TreeSitterNode | null
}

type TreeSitterTree = {
  rootNode: TreeSitterNode
}

type TreeSitterParser = {
  setLanguage(language: unknown): void
  parse(text: string): TreeSitterTree
}

type TreeSitterParserConstructor = {
  new (): TreeSitterParser
}

type FunctionRange = { range: vscode.Range }

const require = createRequire(__filename)

const parsers = new Map<string, TreeSitterParser>()

export function extractFunctionRanges(document: vscode.TextDocument) {
  const config = functionLanguage(document.fileName)
  if (!config) return []

  try {
    const parser = parserFor(config)
    if (!parser) return []

    const ranges: FunctionRange[] = []
    collectFunctions(parser.parse(document.getText()).rootNode, config, ranges)
    return ranges
  } catch {
    return []
  }
}

function parserFor(config: FunctionLanguage) {
  const key = config.exportNames ? `${config.module}:${config.exportNames.join(",")}` : config.module
  const cached = parsers.get(key)
  if (cached) return cached

  const Parser = require("tree-sitter") as TreeSitterParserConstructor
  const grammar = require(config.module) as Record<string, unknown>
  const parser = parserFromGrammar(Parser, grammar, config)
  if (!parser) return

  parsers.set(key, parser)
  return parser
}

function collectFunctions(node: TreeSitterNode, config: FunctionLanguage, ranges: FunctionRange[]) {
  if (config.nodeTypes.has(node.type)) {
    ranges.push({ range: rangeFromNode(node) })
  }

  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i)
    if (!child) continue
    collectFunctions(child, config, ranges)
  }
}

function rangeFromNode(node: TreeSitterNode) {
  return new vscode.Range(pointFromTreeSitter(node.startPosition), pointFromTreeSitter(node.endPosition))
}

function pointFromTreeSitter(point: TreeSitterPoint) {
  return new vscode.Position(point.row, point.column)
}

function parserFromGrammar(Parser: TreeSitterParserConstructor, grammar: Record<string, unknown>, config: FunctionLanguage) {
  return [
    ...(config.exportNames ?? []).map((name) => grammar[name]),
    grammar,
    grammar.default,
    grammar.language,
  ].filter(Boolean).reduce<TreeSitterParser | undefined>((current, language) => {
    if (current) return current

    try {
      const parser = new Parser()
      parser.setLanguage(language)
      return parser
    } catch {
      return
    }
  }, undefined)
}
