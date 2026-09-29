import path from "node:path"
import { functionLanguage } from "@opencode-ai/raccoon-core"
import type { Node } from "web-tree-sitter"
const { Language, Parser } = require("web-tree-sitter") as typeof import("web-tree-sitter")

export type FunctionRange = { type: string; start: number; end: number }

export function createFunctionRangeExtractor(grammarDirectory: string, runtimeWasm: string) {
  const parsers = new Map<string, Promise<InstanceType<typeof Parser>>>()
  const initialized = Parser.init({ locateFile: () => runtimeWasm })

  return async (fileName: string, source: string): Promise<FunctionRange[]> => {
    const config = functionLanguage(fileName)
    if (!config) return []

    try {
      const parser = await (parsers.get(config.wasm) ?? (() => {
        const loading = initialized.then(async () => {
          const parser = new Parser()
          parser.setLanguage(await Language.load(path.join(grammarDirectory, config.wasm)))
          return parser
        })
        parsers.set(config.wasm, loading)
        return loading
      })())
      const tree = parser.parse(source)
      if (!tree) return []
      const ranges: FunctionRange[] = []
      const visit = (node: Node) => {
        if (config.nodeTypes.has(node.type)) ranges.push({ type: node.type, start: node.startIndex, end: node.endIndex })
        node.children.forEach((child) => { if (child) visit(child) })
      }
      visit(tree.rootNode)
      tree.delete()
      return ranges
    } catch {
      parsers.delete(config.wasm)
      return []
    }
  }
}
