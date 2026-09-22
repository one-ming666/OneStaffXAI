import fs from "node:fs";
import path from "node:path";
export const allowedExtensions = new Set([
  ".txt",
  ".md",
  ".csv",
  ".json",
  ".docx",
  ".xlsx",
  ".pptx",
  ".pdf",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
]);
export const mimeFor = {
  ".pdf": "application/pdf",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".csv": "text/csv",
  ".json": "application/json",
};
export async function parseDocument(file) {
  const ext = path.extname(file.name || file.originalname).toLowerCase();
  let text = "",
    status = "ready";
  if (!allowedExtensions.has(ext)) throw Error("支持 PDF、DOCX、XLSX、PPTX、TXT、MD、CSV、JSON 和常见图片");
  if ([".txt", ".md", ".csv", ".json"].includes(ext))
    text = fs.readFileSync(file.path, "utf8").replace(/^\uFEFF/, "");
  else if (ext === ".docx") {
    const mammoth = await import("mammoth");
    text = (
      await (mammoth.default || mammoth).extractRawText({
        path: file.path,
      })
    ).value;
  } else if (ext === ".xlsx") {
    const { default: ExcelJS } = await import("exceljs"),
      w = new ExcelJS.Workbook();
    await w.xlsx.readFile(file.path);
    for (const sheet of w.worksheets) {
      text += `\n表：${sheet.name}\n`;
      sheet.eachRow((row, i) => {
        if (i <= 20000 && text.length < 500000)
          text +=
            row.values
              .slice(1)
              .map((v) => (v && typeof v === "object" ? JSON.stringify(v) : String(v ?? "")))
              .join("\t") + "\n";
      });
    }
  } else if (ext === ".pdf") {
    const { PDFParse } = await import("pdf-parse");
    const p = new PDFParse({
      data: fs.readFileSync(file.path),
    });
    try {
      text = (await p.getText()).text;
      if (!text?.trim()) status = "scan_or_empty";
    } finally {
      await p.destroy();
    }
  } else if (ext === ".pptx") {
    const { default: JSZip } = await import("jszip");
    const zip = await JSZip.loadAsync(fs.readFileSync(file.path));
    const slides = Object.keys(zip.files)
      .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
      .sort((a, b) => Number(a.match(/slide(\d+)/)[1]) - Number(b.match(/slide(\d+)/)[1]));
    if (slides.length > 1000) throw Error("演示文稿超过1000页，请拆分上传");
    const decode = (s) =>
      s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, v) =>
        v[0] === "#"
          ? String.fromCodePoint(v[1].toLowerCase() === "x" ? parseInt(v.slice(2), 16) : Number(v.slice(1)))
          : {
              amp: "&",
              lt: "<",
              gt: ">",
              quot: '"',
              apos: "'",
            }[v],
      );
    for (const name of slides) {
      if ((zip.file(name)._data?.uncompressedSize || 0) > 8000000) throw Error("单页文稿内容过大");
      const xml = await zip.file(name).async("string");
      text +=
        "\n第" +
        name.match(/slide(\d+)/)[1] +
        "页\n" +
        [...xml.matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g)].map((m) => decode(m[1])).join("\n");
      if (text.length > 500000) break;
    }
    if (!text.trim()) status = "scan_or_empty";
  } else status = "image";
  return {
    text: String(text || "").slice(0, 500000),
    status,
    truncated: text.length > 500000,
  };
}
