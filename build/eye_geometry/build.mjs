#!/usr/bin/env node
import { mkdirSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const zig = resolve(process.env.ZIG || resolve(here, "../toolchains/zig-x86_64-linux-0.15.2/zig"));
const source = resolve(here, "geometry.zig");
const outputDir = resolve(here, "zig-out");
const output = resolve(outputDir, "geometry.wasm");

function run(args, label) {
  const result = spawnSync(zig, args, { cwd: here, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (result.status !== 0) {
    process.stderr.write(result.stdout);
    process.stderr.write(result.stderr);
    throw new Error(`${label} failed with exit ${result.status ?? "spawn error"}. Fix: use the project-contained Zig 0.15.2 toolchain.`);
  }
  return result.stdout.trim();
}

try {
  statSync(zig);
  const version = run(["version"], "Zig version check");
  if (version !== "0.15.2") {
    throw new Error(`unsupported Zig ${version || "unknown"}. Fix: set ZIG to a Zig 0.15.2 executable.`);
  }
  mkdirSync(outputDir, { recursive: true });
  run([
    "build-exe", source,
    "-target", "wasm32-freestanding",
    "-O", "ReleaseFast",
    "-fno-entry",
    "-fstrip",
    "-fsingle-threaded",
    "--export-memory",
    "--export=facts_ptr",
    "--export=facts_capacity",
    "--export=hit_test",
    "--initial-memory=4194304",
    "--max-memory=4194304",
    "--stack", "65536",
    `-femit-bin=${output}`,
  ], "WebAssembly build");
  const bytes = statSync(output).size;
  console.log(JSON.stringify({
    status: "ok", tool: "eye-geometry-build", version: "1.1.0",
    ts: new Date().toISOString(), compiler_version: "0.15.2", output, bytes,
  }));
} catch (error) {
  console.log(JSON.stringify({
    status: "error", tool: "eye-geometry-build", version: "1.1.0",
    ts: new Date().toISOString(), compiler_version: "0.15.2",
    error: String(error.message || error),
    fix: "Use the pinned project toolchain and inspect the compiler diagnostics on stderr.",
  }));
  process.exit(2);
}
