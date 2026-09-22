import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { randomBytes, createCipheriv } from "node:crypto";
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "onestaff-storage-")),
  key = randomBytes(32);
fs.writeFileSync(path.join(dir, "master.key"), key);
const old = new DatabaseSync(path.join(dir, "onestaff.db"));
old.exec(
  `CREATE TABLE spaces(id TEXT PRIMARY KEY,profile TEXT NOT NULL,created TEXT NOT NULL);CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);CREATE TABLE chats(id TEXT PRIMARY KEY,space TEXT NOT NULL,employee TEXT NOT NULL,title TEXT NOT NULL,remote TEXT,channel TEXT,created TEXT NOT NULL);CREATE TABLE messages(id INTEGER PRIMARY KEY AUTOINCREMENT,chat TEXT NOT NULL,role TEXT NOT NULL,content TEXT NOT NULL,channel TEXT,created TEXT NOT NULL);CREATE TABLE files(id TEXT PRIMARY KEY,space TEXT NOT NULL,name TEXT NOT NULL,mime TEXT,path TEXT NOT NULL,size INTEGER NOT NULL,text TEXT NOT NULL,status TEXT NOT NULL,created TEXT NOT NULL);`,
);
old
  .prepare("INSERT INTO spaces VALUES(?,?,?)")
  .run("space-a", '{"name":"旧伙伴","onboarded":true}', "2026-09-19");
old
  .prepare("INSERT INTO chats VALUES(?,?,?,?,?,?,?)")
  .run("old-chat", "space-a", "director", "旧对话", "old-remote", "openhex", "2026-09-19");
old
  .prepare("INSERT INTO messages(chat,role,content,created)VALUES(?,?,?,?)")
  .run("old-chat", "user", "旧对话不能丢失", "2026-09-19");
old
  .prepare("INSERT INTO files VALUES(?,?,?,?,?,?,?,?,?)")
  .run(
    "old-file",
    "space-a",
    "说明书.pdf",
    "application/pdf",
    "old-path",
    100,
    "旧索引",
    "ready",
    "2026-09-19",
  );
const original = {
  channel: "openhex",
  providers: [
    {
      id: "deepseek",
      model: "existing-model",
      baseUrl: "https://fixture.invalid",
      apiKey: "secret-provider-key",
    },
  ],
  openhex: {
    workspace: "fixture-space",
    apiKey: "secret-workspace-key",
    agents: {
      director: "old-agent",
    },
  },
};
const iv = randomBytes(12),
  cipher = createCipheriv("aes-256-gcm", key, iv);
const sealed = Buffer.concat([
  iv,
  cipher.update(JSON.stringify(original)),
  cipher.final(),
  cipher.getAuthTag(),
]).toString("base64");
old.prepare("INSERT INTO settings VALUES(?,?)").run("config", sealed);
old.close();
process.env.DATA_DIR = dir;
delete process.env.OPENHEX_WORKSPACE_KEY;
delete process.env.OPENHEX_AGENT_ID;
delete process.env.OPENHEX_WORKSPACE_SLUG;
const core = await import("../server/core.js");
const { saveAgentOutput } = await import("../server/outputs.js");
test.after(() => {
  core.db.close();
  fs.rmSync(dir, {
    recursive: true,
    force: true,
  });
});
test("Additive migration preserves old key, chat history, remote ID and PDF metadata", () => {
  assert.deepEqual(fs.readFileSync(path.join(dir, "master.key")), key);
  assert.equal(core.one("SELECT content FROM messages WHERE chat=?", "old-chat").content, "旧对话不能丢失");
  assert.equal(core.one("SELECT remote,binding FROM chats WHERE id=?", "old-chat").remote, "old-remote");
  const f = core.one("SELECT * FROM files WHERE id=?", "old-file");
  assert.equal(f.scope, "knowledge");
  assert.equal(f.name, "说明书.pdf");
  assert.equal(f.sha256, null);
});
test("Legacy encrypted model configuration gains new services without losing credentials", () => {
  const c = core.config();
  assert.equal(c.openhex.apiKey, "secret-workspace-key");
  assert.equal(c.providers[0].model, "existing-model");
  assert.equal(c.weather.enabled, false);
  assert.equal(c.speech.ttsApiKey, "");
  assert.equal(c.transport.totalTimeoutMs, 360000);
  assert.equal(c.auxiliary.bubbleStyle, "mixed");
});
test("Masked credentials remain masked; saving masks preserves existing keys", () => {
  const c = core.config(),
    out = core.redact(c);
  assert.match(out.openhex.apiKey, /^••••/);
  assert.ok(!JSON.stringify(out).includes("secret-workspace-key"));
  const merged = core.mergeSecrets(out, c);
  assert.equal(merged.openhex.apiKey, c.openhex.apiKey);
  assert.equal(merged.providers[0].apiKey, "secret-provider-key");
});
test("Temporary file parts are encrypted, not stored as public signed URLs", () => {
  const part = JSON.stringify({
      file: {
        file_url: "https://fixture.invalid/signed?secret=not-public",
      },
    }),
    a = core.seal(part),
    b = core.seal(part);
  assert.notEqual(a, b);
  assert.equal(core.unseal(a), part);
  assert.ok(!a.includes("not-public"));
  assert.throws(() => core.unseal(a.slice(0, -10) + "AAAA"));
});
test("Space ownership blocks access to another visitor file", () => {
  assert.equal(core.owned("files", "old-file", "space-a").name, "说明书.pdf");
  assert.throws(
    () => core.owned("files", "old-file", "space-b"),
    (e) => e.status === 404,
  );
  assert.throws(() => core.owned("settings", "config", "space-a"));
});
test("Same cloud filename in a new turn gets a different local attachment ID", () => {
  const file = {
    conversationId: "remote",
    agentId: "agent",
    workspacePath: "/outputs/report.docx",
    name: "report.docx",
  };
  const a = saveAgentOutput("space-a", "old-chat", "turn-one", "binding", file),
    again = saveAgentOutput("space-a", "old-chat", "turn-one", "binding", file),
    b = saveAgentOutput("space-a", "old-chat", "turn-two", "binding", file);
  assert.equal(a.id, again.id);
  assert.notEqual(a.id, b.id);
  assert.equal(core.one("SELECT COUNT(*) n FROM remote_outputs").n, 2);
});
test("Error messages remove configured keys and Bearer credentials", () => {
  const message = core.safeError(Error("secret-workspace-key / secret-provider-key / Bearer secret-token"));
  assert.ok(!message.includes("secret-workspace-key"));
  assert.ok(!message.includes("secret-provider-key"));
  assert.ok(!message.includes("secret-token"));
});
test("Admin configuration omits full QR image data to keep save payload small", () => {
  const c = core.config();
  c.openhex.entrypoints = {
    director: {
      url: "https://agent.openhex.tech/share/fixture",
      qr: "data:image/png;base64,AAAA",
    },
  };
  const out = core.redact(c);
  assert.equal(out.openhex.entrypoints.director.hasQr, true);
  assert.equal(out.openhex.entrypoints.director.qr, undefined);
});
