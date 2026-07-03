import { copyFileSync, mkdirSync } from "node:fs";
mkdirSync("dist", { recursive: true });
for (const f of ["index.html", "styles.css"]) copyFileSync(f, `dist/${f}`);
console.log("static copied → dist/");
