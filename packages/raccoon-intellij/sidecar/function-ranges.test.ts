// @ts-expect-error Bun exposes this module to tests; the Sidecar compiler intentionally loads Node-only types.
import { expect, test } from "bun:test"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { createFunctionRangeExtractor } from "./function-ranges.js"

const extract = createFunctionRangeExtractor(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../node_modules/tree-sitter-wasms/out"),
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../node_modules/web-tree-sitter/tree-sitter.wasm"),
)

test.each([
  ["example.py", "def hello():\n    pass\n", "function_definition"],
  ["example.js", "function hello() {}\n", "function_declaration"],
  ["example.swift", "func hello() {}\n", "function_declaration"],
  ["example.lua", "function hello() end\n", "function_definition_statement"],
])("finds functions in %s", async (fileName: string, source: string, type: string) => {
  expect((await extract(fileName, source)).map((range) => range.type)).toContain(type)
})

test("returns no ranges for unsupported extensions", async () => {
  expect(await extract("example.txt", "def hello(): pass")).toEqual([])
})

test("uses editor offsets after multibyte characters", async () => {
  const source = "# 😀\ndef hello(): pass\n"
  expect((await extract("example.py", source))[0]?.start).toBe(source.indexOf("def hello"))
})

test.each([
  ["example.ts", "function hello(): void {}"],
  ["example.tsx", "function Hello() { return <div/> }"],
  ["example.sh", "hello() { echo hi; }"],
  ["example.go", "package main\nfunc hello() {}"],
  ["example.c", "void hello() {}"],
  ["example.cpp", "void hello() {}"],
  ["example.cs", "class C { void Hello() {} }"],
  ["example.rs", "fn hello() {}"],
  ["example.java", "class C { void hello() {} }"],
  ["example.kt", "fun hello() {}"],
  ["example.php", "<?php function hello() {}"],
  ["example.dart", "void hello() {}"],
  ["example.rb", "def hello; end"],
  ["example.scala", "def hello(): Unit = ()"],
  ["example.m", "void hello() {}"],
])("finds a function in %s", async (fileName: string, source: string) => {
  expect(await extract(fileName, source)).not.toEqual([])
})

test("finds a PowerShell function", async () => {
  const extractPowerShell = createFunctionRangeExtractor(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../raccoon-vscode/node_modules/tree-sitter-powershell"),
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../node_modules/web-tree-sitter/tree-sitter.wasm"),
  )
  expect(await extractPowerShell("example.ps1", "function hello {}")).not.toEqual([])
})
