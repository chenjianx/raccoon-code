import esbuild from "esbuild"
import { copyFile, mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { FUNCTION_LANGUAGES } from "../raccoon-core/src/function-symbols.ts"

const production = process.argv.includes("--production")

await esbuild.build({
  entryPoints: ["sidecar/index.ts"],
  bundle: true,
  format: "cjs",
  platform: "node",
  target: "node20",
  minify: production,
  sourcemap: !production,
  outfile: "src/main/resources/sidecar/sidecar.cjs",
  // The opencode server is spawned as a child process (bin/raccoon); nothing
  // from the SDK's optional native deps needs bundling here. Keep node builtins
  // external so the CJS output runs under the host's plain `node`.
  logLevel: "info",
})

const resources = path.resolve("src/main/resources/sidecar")
await mkdir(path.join(resources, "grammars"), { recursive: true })
await Promise.all([...new Set(FUNCTION_LANGUAGES.map((language) => language.wasm))].map(async (file) => {
  const source = file === "tree-sitter-powershell.wasm"
    ? path.resolve("../raccoon-vscode/node_modules/tree-sitter-powershell", file)
    : path.resolve("node_modules/tree-sitter-wasms/out", file)
  await copyFile(source, path.join(resources, "grammars", file))
}))
await copyFile(path.resolve("node_modules/web-tree-sitter/tree-sitter.wasm"), path.join(resources, "tree-sitter.wasm"))
await writeFile(path.join(resources, "grammars.txt"), [...new Set(FUNCTION_LANGUAGES.map((language) => language.wasm))].join("\n") + "\n")
await writeFile(path.join(resources, "extensions.txt"), [...new Set(FUNCTION_LANGUAGES.flatMap((language) => language.extensions))].join("\n") + "\n")
