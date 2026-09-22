import path from "node:path";
export async function configurationText(file) {
  const ext = path.extname(file.originalname).toLowerCase();
  if ([".txt", ".md", ".json"].includes(ext))
    return file.buffer.toString("utf8").replace(/^\uFEFF/, "");
  if (ext === ".docx") {
    const { default: JSZip } = await import("jszip");
    const zip = await JSZip.loadAsync(file.buffer);
    const total = Object.values(zip.files).reduce(
      (n, f) => n + (f._data?.uncompressedSize || 0),
      0,
    );
    if (total > 8 * 1024 * 1024)
      throw Error("配置文档解压后超过8 MB，请使用精简TXT模板。");
    const { default: mammoth } = await import("mammoth");
    return (await mammoth.extractRawText({ buffer: file.buffer })).value;
  }
  if (ext === ".pdf") {
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: file.buffer });
    try {
      const { text, total } = await parser.getText({
        first: 20,
        pageJoiner: "\n",
      });
      if (total > 20) throw Error("配置PDF超过20页，请截取配置内容后上传。");
      if (!text.trim())
        throw Error("PDF没有可提取文字，请使用TXT或DOCX；扫描图片不支持导入。");
      return text;
    } finally {
      await parser.destroy();
    }
  }
  throw Error("配置导入支持TXT、MD、JSON、DOCX及文字PDF。");
}
