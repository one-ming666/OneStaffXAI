import fs from "node:fs";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { DATA, uid, hash, now, run, one, all, owned, fail } from "./core.js";
import { normalizeFilename } from "./transport.js";
import { allowedExtensions, mimeFor, parseDocument } from "./parser.js";
const queue = [];
let parsing = 0;
export function queueParse(file) {
  queue.push(file);
  pump();
}
function pump() {
  while (parsing < 2 && queue.length) {
    const file = queue.shift();
    if (!one("SELECT id FROM files WHERE id=?", file.id)) continue;
    parsing++;
    const worker = new Worker(new URL("./parse-worker.js", import.meta.url), {
      workerData: file,
      resourceLimits: {
        maxOldGenerationSizeMb: 256,
      },
    });
    let finished = false;
    const finish = (result) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      worker.terminate().catch(() => {});
      run(
        "UPDATE files SET text=?,status=?,parse_error=? WHERE id=?",
        result.text || "",
        result.status || "parse_failed",
        result.error || (result.truncated ? "本地索引保留前500000字符；原文件未截断" : null),
        file.id,
      );
      parsing--;
      pump();
    };
    const timer = setTimeout(
      () =>
        finish({
          status: "parse_failed",
          error: "本地提取超过45秒；原文件已保留，可直接发送给 OpenHex",
        }),
      45000,
    );
    worker.once("message", finish);
    worker.once("error", () =>
      finish({
        status: "parse_failed",
        error: "本地解析进程失败；原文件已保留",
      }),
    );
    worker.once("exit", (code) => {
      if (!finished)
        finish({
          status: "parse_failed",
          error: "本地解析进程已退出；原文件已保留",
        });
    });
  }
}
export function resumeParsing() {
  for (const file of all("SELECT * FROM files WHERE status='parsing'")) queueParse(file);
}
export function registerUploadRoutes(app, { upload, wrap, isFileBusy }) {
  app.get("/api/files", (q, r) =>
    r.json(
      all(
        "SELECT id,name,mime,size,status,scope,sha256,parse_error,created FROM files WHERE space=?" +
          (q.query.scope === "knowledge" ? " AND scope='knowledge'" : "") +
          " ORDER BY created DESC",
        q.space,
      ),
    ),
  );
  app.post(
    "/api/files",
    upload.single("file"),
    wrap(async (q, r) => {
      if (!q.file) fail("请选择文件");
      const f = q.file;
      try {
        f.originalname = normalizeFilename(f.originalname);
        const ext = path.extname(f.originalname).toLowerCase();
        if (!allowedExtensions.has(ext)) fail("不支持此文件格式；请上传 PDF、Office 文档、文本或常见图片");
        const total = one("SELECT COALESCE(SUM(size),0) n FROM files WHERE space=?", q.space).n;
        if (total + f.size > 256 * 1024 * 1024)
          fail("当前空间文件总量上限为256 MB，请先清理不再需要的资料", 413);
        const bytes = fs.readFileSync(f.path);
        if (!bytes.length) fail("不能上传空文件");
        if (ext === ".pdf" && !bytes.subarray(0, 1024).includes(Buffer.from("%PDF-")))
          fail("文件扩展名为 PDF，但内容不是有效的 PDF 头部");
        if ([".docx", ".xlsx", ".pptx"].includes(ext) && bytes.subarray(0, 2).toString() !== "PK")
          fail("Office 文件格式不正确，请重新导出");
        const sha = hash(bytes),
          scope = q.body.scope === "chat" ? "chat" : "knowledge";
        const duplicate = one(
          "SELECT id,name,mime,size,status,scope,sha256 FROM files WHERE space=? AND sha256=? AND name=? AND scope=?",
          q.space,
          sha,
          f.originalname,
          scope,
        );
        if (duplicate) {
          fs.rmSync(f.path, {
            force: true,
          });
          return r.json({
            ...duplicate,
            deduplicated: true,
          });
        }
        const id = uid();
        let parsed = {
          text: "",
          status: "parsing",
        };
        if ([".txt", ".md", ".csv", ".json", ".png", ".jpg", ".jpeg", ".webp"].includes(ext))
          parsed = await parseDocument(f);
        const file = {
          id,
          space: q.space,
          name: f.originalname,
          mime: mimeFor[ext] || f.mimetype,
          path: f.path,
          size: f.size,
          sha256: sha,
          status: parsed.status,
        };
        run(
          "INSERT INTO files(id,space,name,mime,path,size,text,status,created,scope,sha256) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
          id,
          q.space,
          file.name,
          file.mime,
          f.path,
          f.size,
          parsed.text,
          parsed.status,
          now(),
          scope,
          sha,
        );
        if (parsed.status === "parsing") queueParse(file);
        r.status(201).json({
          id,
          name: file.name,
          mime: file.mime,
          size: f.size,
          sha256: sha,
          status: parsed.status,
          scope,
        });
      } catch (e) {
        fs.rmSync(f.path, {
          force: true,
        });
        throw e;
      }
    }),
  );
  app.get("/api/files/:id/download", (q, r) => {
    const f = owned("files", q.params.id, q.space);
    r.download(f.path, f.name);
  });
  app.patch("/api/files/:id/knowledge", (q, r) => {
    const f = owned("files", q.params.id, q.space);
    run("UPDATE files SET scope=? WHERE id=?", q.body.enabled === false ? "chat" : "knowledge", f.id);
    r.json({
      ok: true,
    });
  });
  app.delete("/api/files/:id", (q, r) => {
    const f = owned("files", q.params.id, q.space);
    if (
      isFileBusy(f.id) ||
      all(
        "SELECT inputs FROM tasks WHERE space=? AND status IN ('planning','running','reviewing','revising','delivering')",
        q.space,
      ).some((t) => JSON.parse(t.inputs).includes(f.id))
    )
      fail("文件正在使用，请先停止相应请求或取消任务", 409);
    run("DELETE FROM remote_uploads WHERE file=? AND space=?", f.id, q.space);
    run("DELETE FROM files WHERE id=?", f.id);
    fs.rmSync(f.path, {
      force: true,
    });
    r.json({
      ok: true,
      notice: "已删除本站文件和缓存；曾发送到第三方平台的副本需要到平台另行删除",
    });
  });
}
