import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
const root = path.resolve(import.meta.dirname, "..");
let failures = 0,
  count = 0;
function check(source, label, module = false) {
  const r = spawnSync(process.execPath, ["--check", "--input-type=" + (module ? "module" : "commonjs")], {
    input: source,
    encoding: "utf8",
  });
  count++;
  if (r.status) {
    failures++;
    console.error(label + "\n" + r.stderr);
  }
}
function walk(dir) {
  for (const entry of fs.readdirSync(dir, {
    withFileTypes: true,
  })) {
    const f = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(f);
      continue;
    }
    if (/\.(m?js)$/.test(f)) check(fs.readFileSync(f, "utf8"), f, true);
    if (f.endsWith(".html")) {
      const html = fs.readFileSync(f, "utf8");
      for (const [i, m] of [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/gi)].entries()) {
        const type = /\btype=["']([^"']+)/i.exec(m[1])?.[1];
        if (m[2].trim() && (!type || ["module", "text/javascript", "application/javascript"].includes(type)))
          check(m[2], f + " script " + i, type === "module");
      }
    }
  }
}
for (const dir of ["server", "scripts", "public"]) walk(path.join(root, dir));
console.log(`Source syntax: ${count - failures}/${count} passed`);
process.exitCode = failures ? 1 : 0;
