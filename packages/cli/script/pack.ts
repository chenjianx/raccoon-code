#!/usr/bin/env bun
import { $ } from "bun"
import pkg from "../package.json"
import { Script } from "@opencode/script"
import { archiveDir, npmDir } from "@opencode/script/pack"
import { existsSync } from "fs"
import { chmod, mkdir, rm, utimes } from "node:fs/promises"
import path from "node:path"

// Packs the built CLI (dist/) into npm tarballs in dist/npm and standalone archives in dist/archives at
// the repository root. The release workflow signs the macOS and Windows packages and archives afterwards.
const dir = path.resolve(import.meta.dir, "..")
// raccoon_change - select the independent Raccoon distribution explicitly
const raccoon = process.argv.includes("--raccoon-only")
const root = path.resolve(process.env.OPENCODE_CLI_DIST ?? path.join(dir, raccoon ? "dist/raccoon" : "dist"))
process.chdir(dir)
await mkdir(npmDir, { recursive: true })
await mkdir(archiveDir, { recursive: true })

// raccoon_change - only pack the explicitly selected distribution
await packDistribution(
  raccoon
    ? {
        root,
        name: "raccoon-code-cli",
        command: "raccoon",
        binary: "raccoon",
        packagePrefix: "raccoon-",
        archive: () => true,
      }
    : {
        root,
        name: pkg.name,
        command: "opencode",
        legacyCommand: "opencode2",
        binary: "opencode",
        packagePrefix: "@opencode/cli-",
        archive: (target) => target.startsWith("linux-"),
      },
)
if (!raccoon && existsSync(path.join(root, "node"))) {
  await packDistribution({
    root: path.join(root, "node"),
    name: "@opencode/cli-node",
    command: "opencode2-node",
    binary: "opencode2-node",
    packagePrefix: "@opencode/cli-node-",
    archive: () => true,
  })
}

async function packDistribution(input: {
  root: string
  name: string
  command: string
  legacyCommand?: string
  binary: string
  packagePrefix: string
  archive: (target: string) => boolean
}) {
  const binaries: Record<string, string> = {}
  for (const filepath of new Bun.Glob("*/package.json").scanSync({ cwd: input.root })) {
    const item = await Bun.file(`${input.root}/${filepath}`).json()
    if (!item.name.startsWith(input.packagePrefix)) continue
    // raccoon_change - ignore the wrapper package on repeat Raccoon publications
    if (raccoon && !/^raccoon-(darwin|linux|windows)-/.test(item.name)) continue
    binaries[item.name] = item.version
  }
  console.log(input.name, "binaries", binaries)
  const versions = new Set(Object.values(binaries))
  if (versions.size > 1) throw new Error(`Binary package versions do not match for ${input.name}`)
  const version = versions.values().next().value
  if (!version) throw new Error(`No binary packages found for ${input.name}`)
  if (version !== Script.version) throw new Error(`Expected ${Script.version}, got ${version} for ${input.name}`)

  await $`mkdir -p ${input.root}/${input.name}/bin`
  await $`cp ./script/postinstall.mjs ${input.root}/${input.name}/postinstall.mjs`
  // raccoon_change - ship the matching standalone installer for curl upgrades
  if (raccoon)
    await Bun.write(path.join(input.root, input.name, "install"), Bun.file(path.resolve(dir, "../../install")))
  await Bun.file(`${input.root}/${input.name}/bin/${input.command}.exe`).write(
    [
      `echo "Error: ${input.name}'s postinstall script was not run." >&2`,
      'echo "" >&2',
      'echo "This occurs when installation scripts are disabled." >&2',
      'echo "Run the package postinstall script or reinstall with scripts enabled." >&2',
      "exit 1",
      "",
    ].join("\n"),
  )
  await Bun.file(`${input.root}/${input.name}/package.json`).write(
    JSON.stringify(
      {
        name: input.name,
        bin: {
          [input.command]: `./bin/${input.command}.exe`,
          ...(input.legacyCommand ? { [input.legacyCommand]: `./bin/${input.command}.exe` } : {}),
        },
        ...(input.command !== input.binary ? { opencodeSourceBinary: input.binary } : {}),
        scripts: { postinstall: "node ./postinstall.mjs" },
        version,
        license: pkg.license,
        // raccoon_change - published package metadata uses the matching repository
        repository: {
          type: "git",
          url: `git+https://github.com/${raccoon ? "chenjianx/raccoon-code" : "anomalyco/opencode"}.git`,
        },
        os: ["darwin", "linux", "win32"],
        cpu: ["arm64", "x64"],
        optionalDependencies: binaries,
      },
      null,
      2,
    ),
  )

  await Promise.all(Object.keys(binaries).map((name) => pack(`${input.root}/${name.replace("@opencode/", "")}`)))
  await pack(`${input.root}/${input.name}`)
  const files = await Promise.all(
    Object.keys(binaries)
      .map((name) => name.slice(input.packagePrefix.length))
      .filter(input.archive)
      .map((target) =>
        archive(
          path.join(input.root, `${input.packagePrefix.replace("@opencode/", "")}${target}`, "bin"),
          target,
          input.binary,
        ),
      ),
  )
  // raccoon_change - retain metadata for the independent Raccoon release
  if (raccoon)
    await Bun.write(
      path.join(input.root, "raccoon-release.json"),
      JSON.stringify(
        {
          channel: Script.channel,
          name: "raccoon-cli",
          version,
          package: input.name,
          files: files.map((file) => path.basename(file)),
        },
        null,
        2,
      ),
    )
}

async function pack(directory: string) {
  // raccoon_change - exclude tarballs from earlier releases packed in place
  if (raccoon)
    for (const file of new Bun.Glob("*.tgz").scanSync({ cwd: directory })) await rm(path.join(directory, file))
  if (process.platform !== "win32") await $`chmod -R 755 .`.cwd(directory)
  await $`bun pm pack --destination ${npmDir}`.cwd(directory)
}

async function archive(bin: string, target: string, binary: string) {
  const executable = `${binary}${target.startsWith("windows-") ? ".exe" : ""}`
  const source = path.join(bin, executable)
  if (!(await Bun.file(source).exists()) || !Bun.file(source).size) throw new Error(`Missing binary: ${source}`)
  // GitHub artifact downloads lose execute bits. Fixed timestamps make retries reproducible.
  await chmod(source, 0o755)
  await utimes(source, new Date("1980-01-01T00:00:00Z"), new Date("1980-01-01T00:00:00Z"))
  const extension = target.startsWith("linux-") ? "tar.gz" : "zip"
  const output = path.join(archiveDir, `${binary}-${target}.${extension}`)
  await rm(output, { force: true })
  if (extension === "tar.gz") {
    // raccoon_change start - allow local Raccoon release checks with macOS bsdtar
    if (raccoon && process.platform === "darwin") await $`tar -czf ${output} -C ${bin} ${executable}`
    else await $`tar --mtime=@0 --owner=0 --group=0 --numeric-owner -czf ${output} -C ${bin} ${executable}`
    // raccoon_change end
  }
  if (extension === "zip") await $`zip -X -q ${output} ${executable}`.cwd(bin)
  return output
}
