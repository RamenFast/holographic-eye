import { copyFileSync, mkdirSync, existsSync } from "node:fs";
mkdirSync("dist", { recursive: true });
for (const f of ["index.html", "styles.css", "favicon.png"]) {
  if (existsSync(f)) copyFileSync(f, `dist/${f}`);
}
console.log("static copied → dist/");
