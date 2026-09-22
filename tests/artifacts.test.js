import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "onestaff-artifacts-"));
process.env.DATA_DIR = dir;
const { makeArtifact } = await import("../server/files.js");
const { parseDocument } = await import("../server/parser.js");
const { all, db } = await import("../server/core.js");
test.after(() => {
  db.close();
  fs.rmSync(dir, {
    recursive: true,
    force: true,
  });
});
for (const kind of ["docx", "pdf", "pptx"])
  test(kind + " 中文长段落与末尾不丢失", async () => {
    const text = "段落开头\n" + "验证内容完整性".repeat(900) + "\n最终验收标记";
    const out = await makeArtifact({
      space: "fixture",
      title: "文档验证",
      text,
      kind,
    });
    const f = all("SELECT * FROM artifacts WHERE id=?", out.id)[0];
    const parsed = await parseDocument(f);
    assert.equal(parsed.status, "ready");
    assert.ok(parsed.text.includes("最终验收标记"));
    assert.equal(
      (
        parsed.text
          .replace(/第\d+页|文档验证(?: · \d+)?|-- \d+ of \d+ --/g, "")
          .replace(/\s/g, "")
          .match(/验证内容完整性/g) || []
      ).length,
      900,
    );
  });
test("空正文和非法格式拒绝生成", async () => {
  await assert.rejects(
    makeArtifact({
      space: "fixture",
      title: "空文档",
      text: " ",
      kind: "docx",
    }),
  );
  await assert.rejects(
    makeArtifact({
      space: "fixture",
      title: "非法格式",
      text: "内容",
      kind: "exe",
    }),
  );
});
