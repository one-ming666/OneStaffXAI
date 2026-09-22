import fs from "node:fs";
import path from "node:path";
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from "docx";
import ExcelJS from "exceljs";
import mammoth from "mammoth";
import { ROOT, DATA, uid, now, run, all, owned, fail } from "./core.js";
export const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c],
  );
export { parseDocument as parseFile } from "./parser.js";
export function fileContext(space, query, ids = []) {
  const files = ids.length
    ? ids.map((id) => owned("files", id, space))
    : all("SELECT * FROM files WHERE space=? AND scope='knowledge' AND status='ready'", space);
  const words = [...new Set(query.toLowerCase().match(/[a-z0-9]{2,}|[\u4e00-\u9fff]{2}/g) || [])];
  const hits = [];
  for (const f of files) {
    for (let i = 0; i < f.text.length; i += 800) {
      const content = f.text.slice(i, i + 1000);
      const score = words.reduce((n, w) => n + (content.toLowerCase().includes(w) ? 1 : 0), 0);
      if (score || ids.length)
        hits.push({
          id: f.id,
          name: f.name,
          position: `字符 ${i + 1}–${i + content.length}`,
          content,
          score,
        });
    }
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, 12);
}
export function contextText(hits) {
  return hits.length
    ? hits.map((h, i) => `[资料${i + 1} ${h.name} ${h.position}]\n${h.content}`).join("\n\n")
    : "当前资料中未检索到足够依据。请区分模型通用知识与已核验事实。";
}
function csvRows(str) {
  const rows = [];
  let row = [],
    v = "",
    quoted = false;
  for (let i = 0; i < str.length; i++) {
    const c = str[i];
    if (c === '"') {
      if (quoted && str[i + 1] === '"') {
        v += '"';
        i++;
      } else quoted = !quoted;
    } else if (c === "," && !quoted) {
      row.push(v);
      v = "";
    } else if ((c === "\n" || c === "\r") && !quoted) {
      if (c === "\r" && str[i + 1] === "\n") i++;
      row.push(v);
      if (row.some((x) => x !== "")) rows.push(row);
      row = [];
      v = "";
    } else v += c;
  }
  row.push(v);
  if (row.some((x) => x !== "")) rows.push(row);
  return rows;
}
export async function statistics(space, ids) {
  const results = [];
  for (const id of ids) {
    const f = owned("files", id, space),
      ext = path.extname(f.name).toLowerCase();
    let sheets = [];
    if (ext === ".csv")
      sheets = [
        {
          name: f.name,
          rows: csvRows(f.text.replace(/^\uFEFF/, "")),
        },
      ];
    if (ext === ".xlsx") {
      const w = new ExcelJS.Workbook();
      await w.xlsx.readFile(f.path);
      sheets = w.worksheets.map((s) => {
        const rows = [];
        s.eachRow(
          {
            includeEmpty: true,
          },
          (r) =>
            rows.push(
              r.values.slice(1).map((v) => (v && typeof v === "object" ? (v.result ?? v.text ?? "") : v)),
            ),
        );
        return {
          name: s.name,
          rows,
        };
      });
    }
    for (const s of sheets) {
      const [headers = [], ...rows] = s.rows;
      const columns = headers.map((h, i) => {
        const vals = rows.map((r) => r[i]),
          present = vals.filter((v) => v !== "" && v !== null && v !== undefined);
        const nums = present
          .filter((v) => typeof v === "number" || (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v.trim())))
          .map(Number);
        return {
          column: String(h || `列${i + 1}`),
          records: rows.length,
          missing: vals.length - present.length,
          numeric: nums.length,
          ...(nums.length
            ? {
                sum: nums.reduce((a, b) => a + b, 0),
                mean: nums.reduce((a, b) => a + b, 0) / nums.length,
                min: Math.min(...nums),
                max: Math.max(...nums),
              }
            : {}),
        };
      });
      results.push({
        file: f.name,
        sheet: s.name,
        records: rows.length,
        columns,
      });
    }
  }
  return results;
}
export async function makeArtifact({ space, task, title, text, kind = "docx", stats = [] }) {
  if (!["docx", "xlsx", "html", "pdf", "pptx", "md", "txt"].includes(kind)) fail("不支持此格式");
  if (typeof text !== "string" || !text.trim()) fail("正文为空，不能生成文件");
  if (text.length > 500000) fail("正文超过500000字，请分批导出");
  title =
    String(title || "工作成果")
      .replace(/[\u0000-\u001f\u007f]/g, " ")
      .trim() || "工作成果";
  const id = uid(),
    version =
      Number(
        all(
          "SELECT version FROM artifacts WHERE space=? AND task=? AND kind=? ORDER BY version DESC LIMIT 1",
          space,
          task || "",
          kind,
        )[0]?.version || 0,
      ) + 1;
  const name = title.replace(/[\\/:*?"<>|]/g, "_").slice(0, 70) + `_v${version}.${kind}`;
  const dest = path.join(DATA, "artifacts", id + "." + kind);
  let buf;
  if (kind === "docx") {
    const children = text.split("\n").map(
      (l) =>
        new Paragraph({
          ...(l.match(/^#{1,3} /)
            ? {
                heading: l.startsWith("# ") ? HeadingLevel.HEADING_1 : HeadingLevel.HEADING_2,
              }
            : {}),
          children: [
            new TextRun({
              text: l.replace(/^#{1,6} /, "").replace(/\*\*/g, ""),
              font: "Microsoft YaHei",
              size: 22,
            }),
          ],
          spacing: {
            after: 120,
            line: 320,
          },
        }),
    );
    buf = await Packer.toBuffer(
      new Document({
        creator: "OneStaff X AI",
        styles: {
          default: {
            document: {
              run: {
                font: "Microsoft YaHei",
                size: 22,
              },
            },
          },
        },
        sections: [
          {
            children: [
              new Paragraph({
                text: title,
                heading: HeadingLevel.TITLE,
              }),
              ...children,
            ],
          },
        ],
      }),
    );
  } else if (kind === "xlsx") {
    const w = new ExcelJS.Workbook();
    w.creator = "OneStaff X AI";
    const s = w.addWorksheet("分析统计");
    s.addRow(["文件", "工作表", "字段", "记录数", "缺失数", "数值数", "合计", "均值", "最小", "最大"]);
    for (const item of stats)
      for (const c of item.columns)
        s.addRow([
          item.file,
          item.sheet,
          c.column,
          c.records,
          c.missing,
          c.numeric,
          c.sum ?? "",
          c.mean ?? "",
          c.min ?? "",
          c.max ?? "",
        ]);
    if (!stats.length) s.addRow(["本任务没有可统计的 CSV/XLSX，未生成推测数据"]);
    s.columns.forEach((c) => (c.width = 20));
    s.getRow(1).font = {
      bold: true,
      color: {
        argb: "FFFFFFFF",
      },
    };
    s.getRow(1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: {
        argb: "FF2563EB",
      },
    };
    s.views = [
      {
        state: "frozen",
        ySplit: 1,
      },
    ];
    const notes = w.addWorksheet("说明");
    text.split("\n").forEach((l) => notes.addRow([l]));
    notes.getColumn(1).width = 100;
    buf = Buffer.from(await w.xlsx.writeBuffer());
  } else if (kind === "html") {
    buf = Buffer.from(text);
  } else if (kind === "pdf") {
    const { default: PDFDocument } = await import("pdfkit");
    const candidates = [
      process.env.PDF_FONT,
      path.join(ROOT, "server/fonts/NotoSansSC.ttf"),
      path.join(DATA, "NotoSansSC.ttf"),
      "C:/Windows/Fonts/simhei.ttf",
      "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc",
      "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    ].filter(Boolean);
    const font = candidates.find((f) => fs.existsSync(f));
    if (!font) fail("PDF 中文字体未安装：请按指南设置 PDF_FONT，或下载 Word 后导出 PDF", 503);
    const awaitFontkit = await import("fontkit");
    buf = await new Promise((resolve, reject) => {
      const d = new PDFDocument({
        size: "A4",
        margin: 52,
      });
      const parts = [];
      d.on("data", (b) => parts.push(b));
      d.on("end", () => resolve(Buffer.concat(parts)));
      d.on("error", reject);
      try {
        const { default: fontkit } = awaitFontkit;
        const fontObj = fontkit.openSync(font);
        const face =
          fontObj.fonts?.find((f) => /CJKsc|SC|WenQuanYi/i.test(f.postscriptName)) || fontObj.fonts?.[0];
        d.font(font, face?.postscriptName).fontSize(22).text(title);
        d.moveDown().fontSize(11).text(text.replace(/^#+ /gm, ""), {
          lineGap: 5,
        });
        d.end();
      } catch (e) {
        reject(e);
      }
    });
  } else if (kind === "pptx") {
    const { default: PptxGenJS } = await import("pptxgenjs");
    const p = new PptxGenJS();
    p.layout = "LAYOUT_WIDE";
    p.author = "OneStaff X AI";
    const lines = text
      .split("\n")
      .filter(Boolean)
      .flatMap((line) => {
        const chars = Array.from(line);
        return Array.from(
          {
            length: Math.ceil(chars.length / 160),
          },
          (_, i) => chars.slice(i * 160, (i + 1) * 160).join(""),
        );
      });
    let chunks = [];
    for (let i = 0; i < lines.length; i += 4) chunks.push(lines.slice(i, i + 4));
    if (!chunks.length) chunks = [["暂无正文"]];
    for (const [i, ls] of chunks.entries()) {
      const s = p.addSlide();
      s.background = {
        color: "F4F8FF",
      };
      s.addText(i ? title + " · " + (i + 1) : title, {
        x: 0.6,
        y: 0.4,
        w: 12,
        h: 0.8,
        fontSize: 26,
        color: "182C47",
        bold: true,
        fontFace: "Microsoft YaHei",
      });
      s.addText(ls.join("\n\n"), {
        x: 0.7,
        y: 1.5,
        w: 11.9,
        h: 5.1,
        fontSize: 17,
        breakLine: false,
        fit: "shrink",
        color: "334155",
        fontFace: "Microsoft YaHei",
      });
    }
    buf = await p.write({
      outputType: "nodebuffer",
    });
  } else {
    buf = Buffer.from(text);
  }
  fs.writeFileSync(dest, buf);
  run(
    "INSERT INTO artifacts VALUES(?,?,?,?,?,?,?,?)",
    id,
    space,
    task || "",
    name,
    kind,
    dest,
    version,
    now(),
  );
  return {
    id,
    name,
    kind,
    version,
  };
}
export function reportHtml(title, text) {
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${esc(title)}</title><style>body{max-width:900px;margin:48px auto;padding:24px;font:16px/1.9 system-ui;color:#182c47}pre{white-space:pre-wrap;font:inherit}h1{font-size:32px}button{padding:10px}@media print{button{display:none}}</style><button onclick="print()">打印 / 保存 PDF</button><h1>${esc(title)}</h1><pre>${esc(text)}</pre></html>`;
}
