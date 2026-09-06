import { copyFileSync, mkdirSync, existsSync, rmSync } from "node:fs";
mkdirSync("dist", { recursive: true });
if (process.env.npm_lifecycle_event === "build") rmSync("dist/bundle.js.map", { force: true });
for (const f of ["index.html", "styles.css", "explorer.css", "field-key.css", "memory-editor.css", "capacity-warning.css", "favicon.png"]) {
  if (existsSync(f)) copyFileSync(f, `dist/${f}`);
}
copyFileSync("../eye_geometry/zig-out/geometry.wasm", "dist/geometry.wasm");
console.log("static and Zig geometry copied → dist/");
