import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
const root = path.resolve(import.meta.dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
test("工作空间所引用本地脚本和样式均存在", () => {
  for (const page of ["public/app.html", "public/index.html", "public/unlock.html"]) {
    const html = read(page);
    for (const match of html.matchAll(/(?:src|href)="(\/assets\/[^"?#]+)(?:[^" ]*)"/g))
      assert.ok(fs.existsSync(path.join(root, "public", match[1])), match[1]);
    assert.match(html, /<meta[^>]+name="viewport"/);
  }
});
test("头像资源完整且PNG头部有效", () => {
  for (let n = 1; n <= 40; n++) {
    const b = fs.readFileSync(
      path.join(root, "public/assets/avatars/px_" + String(n).padStart(2, "0") + ".png"),
    );
    assert.deepEqual([...b.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  }
});
test("Windows启动脚本使用ASCII与CRLF，保持CMD兼容", () => {
  for (const f of fs.readdirSync(root).filter((x) => x.endsWith(".cmd"))) {
    const b = fs.readFileSync(path.join(root, f));
    assert.ok(
      [...b].every((x) => x < 128),
      f,
    );
    assert.ok(!b.toString().replaceAll("\r\n", "").includes("\n"), f);
  }
});
test("PDF中文字体支持外部路径并保留许可证参考", () => {
  const files = read("server/files.js");
  assert.match(files, /process\.env\.PDF_FONT/);
  assert.match(files, /NotoSansCJK-Regular\.ttc/);
  assert.match(read("server/fonts/OFL.txt"), /SIL OPEN FONT LICENSE/);
});
