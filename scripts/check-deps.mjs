import fs from "node:fs";
import path from "node:path";
const root = path.resolve(import.meta.dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
try {
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major < 22 || (major === 22 && minor < 13)) throw Error("Node >=22.13 is required.");
  for (const name of [
    "express",
    "multer",
    "docx",
    "exceljs",
    "mammoth",
    "pdf-parse",
    "pdfkit",
    "pptxgenjs",
    "qrcode",
  ])
    await import(name);
  for (const [name, expected] of Object.entries(manifest.dependencies)) {
    const installed = JSON.parse(fs.readFileSync(path.join(root, "node_modules", name, "package.json"), "utf8")).version;
    if (installed !== expected) throw Error(`Expected ${name} ${expected}, found ${installed}. Run npm ci.`);
  }
  const sdk = await import("@openhex-ai/agent-sdk"),
    pkg = JSON.parse(
      fs.readFileSync(path.join(root, "node_modules/@openhex-ai/agent-sdk/package.json"), "utf8"),
    );
  const client = new sdk.OpenhexClient({
    apiKey: "dependency-check-placeholder",
    agentId: "dependency-check-placeholder",
  });
  for (const method of ["uploadPart", "downloadConversationFile"])
    if (typeof client.files?.[method] !== "function") throw Error("SDK missing files." + method);
  if (typeof client.chat?.resumeTurn !== "function" || typeof sdk.extractFileAttachment !== "function")
    throw Error("SDK streaming/file helper is missing.");
  console.log(`[OK] Dependencies load successfully. OpenHex SDK ${pkg.version} with original-file APIs.`);
} catch (e) {
  console.error("[CHECK] " + e.message);
  process.exitCode = 1;
}
