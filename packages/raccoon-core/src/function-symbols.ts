export type FunctionLanguage = {
  extensions: string[]
  module: string
  wasm: string
  exportNames?: string[]
  nodeTypes: Set<string>
}

export const FUNCTION_LANGUAGES = [
  {
    extensions: [".js", ".jsx", ".mjs", ".cjs"],
    module: "tree-sitter-javascript",
    wasm: "tree-sitter-javascript.wasm",
    nodeTypes: new Set([
      "function_declaration",
      "method_definition",
      "generator_function_declaration",
    ]),
  },
  {
    extensions: [".ts", ".mts", ".cts"],
    module: "tree-sitter-typescript",
    wasm: "tree-sitter-typescript.wasm",
    exportNames: ["typescript"],
    nodeTypes: new Set([
      "function_declaration",
      "method_definition",
      "abstract_method_signature",
      "method_signature",
      "generator_function_declaration",
    ]),
  },
  {
    extensions: [".tsx"],
    module: "tree-sitter-typescript",
    wasm: "tree-sitter-tsx.wasm",
    exportNames: ["tsx"],
    nodeTypes: new Set([
      "function_declaration",
      "method_definition",
      "abstract_method_signature",
      "method_signature",
      "generator_function_declaration",
    ]),
  },
  {
    extensions: [".py", ".pyw"],
    module: "tree-sitter-python",
    wasm: "tree-sitter-python.wasm",
    nodeTypes: new Set(["function_definition"]),
  },
  {
    extensions: [".sh", ".bash", ".bashrc", ".bash_profile", ".profile", ".zsh", ".zshrc"],
    module: "tree-sitter-bash",
    wasm: "tree-sitter-bash.wasm",
    nodeTypes: new Set(["function_definition"]),
  },
  {
    extensions: [".go"],
    module: "tree-sitter-go",
    wasm: "tree-sitter-go.wasm",
    nodeTypes: new Set(["function_declaration", "method_declaration"]),
  },
  {
    extensions: [".c", ".h"],
    module: "tree-sitter-c",
    wasm: "tree-sitter-c.wasm",
    nodeTypes: new Set(["function_definition"]),
  },
  {
    extensions: [".cc", ".cpp", ".cxx", ".c++", ".hh", ".hpp", ".hxx", ".h++"],
    module: "tree-sitter-cpp",
    wasm: "tree-sitter-cpp.wasm",
    nodeTypes: new Set(["function_definition"]),
  },
  {
    extensions: [".cs", ".csx"],
    module: "tree-sitter-c-sharp",
    wasm: "tree-sitter-c_sharp.wasm",
    nodeTypes: new Set([
      "constructor_declaration",
      "conversion_operator_declaration",
      "destructor_declaration",
      "local_function_statement",
      "method_declaration",
      "operator_declaration",
    ]),
  },
  {
    extensions: [".rs"],
    module: "tree-sitter-rust",
    wasm: "tree-sitter-rust.wasm",
    nodeTypes: new Set(["function_item"]),
  },
  {
    extensions: [".java"],
    module: "tree-sitter-java",
    wasm: "tree-sitter-java.wasm",
    nodeTypes: new Set(["constructor_declaration", "method_declaration"]),
  },
  {
    extensions: [".kt", ".kts"],
    module: "@tree-sitter-grammars/tree-sitter-kotlin",
    wasm: "tree-sitter-kotlin.wasm",
    nodeTypes: new Set(["function_declaration", "secondary_constructor"]),
  },
  {
    extensions: [".swift"],
    module: "tree-sitter-swift",
    wasm: "tree-sitter-swift.wasm",
    nodeTypes: new Set(["function_declaration", "initializer_declaration", "deinitializer_declaration"]),
  },
  {
    extensions: [".php", ".php3", ".php4", ".php5", ".phtml"],
    module: "tree-sitter-php",
    wasm: "tree-sitter-php.wasm",
    exportNames: ["php_only", "php", "phpOnly"],
    nodeTypes: new Set(["function_definition", "method_declaration", "method", "class_method"]),
  },
  {
    extensions: [".dart"],
    module: "tree-sitter-dart",
    wasm: "tree-sitter-dart.wasm",
    nodeTypes: new Set(["function_signature", "method_signature"]),
  },
  {
    extensions: [".rb", ".rake", ".gemspec"],
    module: "tree-sitter-ruby",
    wasm: "tree-sitter-ruby.wasm",
    nodeTypes: new Set(["method", "singleton_method"]),
  },
  {
    extensions: [".scala", ".sc"],
    module: "tree-sitter-scala",
    wasm: "tree-sitter-scala.wasm",
    nodeTypes: new Set(["function_definition"]),
  },
  {
    extensions: [".m", ".mm"],
    module: "tree-sitter-objc",
    wasm: "tree-sitter-objc.wasm",
    nodeTypes: new Set(["function_definition", "method_definition"]),
  },
  {
    extensions: [".lua"],
    module: "tree-sitter-lua",
    wasm: "tree-sitter-lua.wasm",
    nodeTypes: new Set(["function_declaration", "function_definition", "function_definition_statement"]),
  },
  {
    extensions: [".ps1", ".psm1"],
    module: "tree-sitter-powershell",
    wasm: "tree-sitter-powershell.wasm",
    nodeTypes: new Set(["function_statement"]),
  },
] satisfies FunctionLanguage[]

export function functionLanguage(fileName: string) {
  const extension = /\.[^./\\]+$/.exec(fileName)?.[0]?.toLowerCase()
  return FUNCTION_LANGUAGES.find((language) => language.extensions.includes(extension ?? ""))
}
