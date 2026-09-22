import { MODEL_PRESETS } from "./presets.js";
import { DatabaseSync } from "node:sqlite";
import { randomBytes, createHash, createCipheriv, createDecipheriv, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
export const ROOT = path.resolve(import.meta.dirname, "..");
export const DATA = path.resolve(process.env.DATA_DIR || path.join(ROOT, "data"));
for (const d of ["", "uploads", "artifacts"])
  fs.mkdirSync(path.join(DATA, d), {
    recursive: true,
  });
export const uid = () => randomBytes(16).toString("hex");
export const now = () => new Date().toISOString();
export const hash = (s) => createHash("sha256").update(s).digest("hex");
export const same = (a, b) => {
  const x = Buffer.from(String(a)),
    y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
};
const masterPath = path.join(DATA, "master.key");
if (!fs.existsSync(masterPath)) {
  if (fs.existsSync(path.join(DATA, "onestaff.db")))
    throw Error(
      "Existing database has no master.key. Restore the original key; do not create a replacement.",
    );
  fs.writeFileSync(masterPath, randomBytes(32), {
    mode: 0o600,
    flag: "wx",
  });
}
const master = fs.readFileSync(masterPath);
if (master.length !== 32) throw Error("master.key is invalid. Restore the original 32-byte key.");
export function seal(s) {
  const iv = randomBytes(12),
    c = createCipheriv("aes-256-gcm", master, iv);
  return Buffer.concat([iv, c.update(s), c.final(), c.getAuthTag()]).toString("base64");
}
export function unseal(s) {
  const b = Buffer.from(s, "base64"),
    c = createDecipheriv("aes-256-gcm", master, b.subarray(0, 12));
  c.setAuthTag(b.subarray(-16));
  return Buffer.concat([c.update(b.subarray(12, -16)), c.final()]).toString();
}
export const db = new DatabaseSync(path.join(DATA, "onestaff.db"));
db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
CREATE TABLE IF NOT EXISTS spaces(id TEXT PRIMARY KEY,profile TEXT NOT NULL,created TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,space TEXT NOT NULL REFERENCES spaces(id),expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS transfers(code TEXT PRIMARY KEY,space TEXT NOT NULL,expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS employees(id TEXT PRIMARY KEY,space TEXT NOT NULL,data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS chats(id TEXT PRIMARY KEY,space TEXT NOT NULL,employee TEXT NOT NULL,title TEXT NOT NULL,remote TEXT,channel TEXT,created TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS messages(id INTEGER PRIMARY KEY AUTOINCREMENT,chat TEXT NOT NULL,role TEXT NOT NULL,content TEXT NOT NULL,channel TEXT,created TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS files(id TEXT PRIMARY KEY,space TEXT NOT NULL,name TEXT NOT NULL,mime TEXT,path TEXT NOT NULL,size INTEGER NOT NULL,text TEXT NOT NULL,status TEXT NOT NULL,created TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS task_node_outputs(task TEXT NOT NULL,node TEXT NOT NULL,text TEXT NOT NULL DEFAULT '',status TEXT NOT NULL,updated TEXT NOT NULL,PRIMARY KEY(task,node));
CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY,space TEXT NOT NULL,request TEXT NOT NULL,title TEXT NOT NULL,status TEXT NOT NULL,plan TEXT NOT NULL DEFAULT '{}',inputs TEXT NOT NULL DEFAULT '[]',channel TEXT NOT NULL,error TEXT,output TEXT,review TEXT,created TEXT NOT NULL,updated TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY AUTOINCREMENT,task TEXT NOT NULL,kind TEXT NOT NULL,actor TEXT NOT NULL,data TEXT NOT NULL,created TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS artifacts(id TEXT PRIMARY KEY,space TEXT NOT NULL,task TEXT,name TEXT NOT NULL,kind TEXT NOT NULL,path TEXT NOT NULL,version INTEGER NOT NULL,created TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS plugins(id TEXT PRIMARY KEY,space TEXT NOT NULL,data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS capabilities(token TEXT PRIMARY KEY,space TEXT NOT NULL,task TEXT NOT NULL,expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS shares(token TEXT PRIMARY KEY,artifact TEXT NOT NULL,space TEXT NOT NULL,expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS reminders(id TEXT PRIMARY KEY,space TEXT NOT NULL,title TEXT NOT NULL,due INTEGER NOT NULL,seen INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY AUTOINCREMENT,space TEXT,action TEXT,detail TEXT,created TEXT);
`);
export const one = (sql, ...p) => db.prepare(sql).get(...p);
export const all = (sql, ...p) => db.prepare(sql).all(...p);
export const run = (sql, ...p) => db.prepare(sql).run(...p);
export const json = (s) => {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
};
export function event(task, kind, actor, data) {
  run(
    "INSERT INTO events(task,kind,actor,data,created) VALUES(?,?,?,?,?)",
    task,
    kind,
    actor,
    JSON.stringify(data),
    now(),
  );
}
export function audit(space, action, detail) {
  run(
    "INSERT INTO audit(space,action,detail,created) VALUES(?,?,?,?)",
    space,
    action,
    String(detail).slice(0, 500),
    now(),
  );
}
export const ROLES = [
  {
    id: "director",
    name: "星澜",
    job: "团队总监",
    avatar: "px_02",
    description: "理解目标、制定计划、分配岗位、汇总交付",
    prompt:
      "你是团队总监。围绕用户目标拆解可执行步骤，区分事实、假设和待补资料。表达像真实团队总监：自然、负责、有判断，不机械复述，不堆套话；技术和正式交付优先准确。",
  },
  {
    id: "researcher",
    name: "知微",
    job: "研究员",
    avatar: "px_07",
    description: "资料检索、证据整理、来源核验",
    prompt: "你是研究员。严格根据实际资料作答，逐项给出引用标记，缺乏证据时明确说明。",
  },
  {
    id: "analyst",
    name: "数禾",
    job: "数据分析师",
    avatar: "px_08",
    description: "数据口径、统计分析、结论验证",
    prompt: "你是数据分析师。只使用实际数据与确定性统计结果，说明缺失值、样本和口径，不编造数值。",
  },
  {
    id: "writer",
    name: "闻笙",
    job: "文案策划",
    avatar: "px_27",
    description: "方案、文案、报告与表达",
    prompt: "你是文案策划。用具体、准确、简洁的中文形成可使用的正文，保留证据来源，避免空话。",
  },
  {
    id: "designer",
    name: "绘月",
    job: "设计助手",
    avatar: "px_28",
    description: "视觉方案、版式与设计规格",
    prompt: "你是设计助手。提供可执行的设计规格与布局建议。未调用生图工具时不要声称已生成图片。",
  },
  {
    id: "coder",
    name: "凌川",
    job: "代码工程师",
    avatar: "px_35",
    description: "HTML 页面生成与修改",
    prompt:
      "你是代码工程师。输出完整可运行单文件HTML；优先内联CSS和JS，不请求外部资源，不访问父页面或用户敏感信息。",
  },
  {
    id: "supervisor",
    name: "明鉴",
    job: "监察者",
    avatar: "px_37",
    description: "独立检查、发现缺口、退回返修",
    prompt:
      "你是独立监察者。核查目标覆盖、证据支持、数据准确和交付完整性。没有依据不能通过，不偏袒执行者。表达像真实监察同事：冷静、具体、直接指出问题。",
  },
];
export function employees(space) {
  const c = config();
  return [...ROLES, ...all("SELECT data FROM employees WHERE space=?", space).map((x) => json(x.data))].map(
    (e) => ({
      ...e,
      entrypoint: c.openhex.entrypoints?.[e.id]
        ? {
            url: c.openhex.entrypoints[e.id].url || "",
            hasQr: !!c.openhex.entrypoints[e.id].qr,
          }
        : null,
      agentConfigured: !!c.openhex.agents?.[e.id],
    }),
  );
}
export function employee(space, id) {
  return employees(space).find((x) => x.id === id) || ROLES[0];
}
export function config() {
  const row = one("SELECT value FROM settings WHERE key='config'");
  const c = row ? json(unseal(row.value)) || {} : {};
  return {
    channel: "hybrid",
    fallback: false,
    defaultProvider: "doubao-pro",
    reviewProvider: "deepseek-pro",
    maxParallel: 2,
    providers: structuredClone(MODEL_PRESETS),
    ...c,
    openhex: {
      ...c.openhex,
      authMode:
        process.env.OPENHEX_AUTH_MODE ||
        (process.env.OPENHEX_API_KEY
          ? "personal"
          : process.env.OPENHEX_WORKSPACE_KEY
            ? "workspace"
            : c.openhex?.authMode || "personal"),
      baseUrl: process.env.OPENHEX_BASE_URL || c.openhex?.baseUrl || "https://api.openhex.tech",
      workspace: process.env.OPENHEX_WORKSPACE_SLUG || c.openhex?.workspace || "",
      apiKey: process.env.OPENHEX_API_KEY || process.env.OPENHEX_WORKSPACE_KEY || c.openhex?.apiKey || "",
      agents: {
        ...c.openhex?.agents,
        ...(process.env.OPENHEX_AGENT_ID
          ? {
              director: process.env.OPENHEX_AGENT_ID,
            }
          : {}),
      },
      entrypoints: c.openhex?.entrypoints || {},
    },
    search: {
      apiKey: "",
      maxResults: 5,
      ...c.search,
    },
    weather: {
      enabled: false,
      baseUrl: "",
      apiKey: "",
      city: "",
      latitude: "",
      longitude: "",
      ...c.weather,
    },
    speech: {
      protocol: "volc",
      baseUrl: "https://openspeech.bytedance.com/api/v3",
      apiKey: "",
      asrModel: "seed_asr",
      ttsModel: "seed-tts-2.0",
      voice: "zh_female_cancan_uranus_bigtts",
      ttsBaseUrl: "",
      ttsApiKey: "",
      asrResource: "volc.bigasr.auc_turbo",
      ttsResource: "seed-tts-2.0",
      ...c.speech,
      ...(c.speech && !c.speech.protocol
        ? {
            protocol: "compatible",
          }
        : {}),
    },
    auxiliary: {
      providerId: "",
      bubbleStyle: "mixed",
      ...c.auxiliary,
    },
    singleProviders: c.singleProviders || {},
    routing: {
      enabled: !row,
      chat: "doubao-character",
      code: "doubao-turbo",
      reasoning: "doubao-pro",
      ...c.routing,
    },
    transport: {
      uploadTimeoutMs: 120000,
      idleTimeoutMs: 90000,
      totalTimeoutMs: 360000,
      teamRemoteTimeoutMs: 120000,
      ...c.transport,
    },
  };
}
export function saveConfig(c) {
  run("INSERT OR REPLACE INTO settings VALUES(?,?)", "config", seal(JSON.stringify(c)));
}
export function redact(c) {
  const out = JSON.parse(
    JSON.stringify(c, (k, v) =>
      k === "apiKey" || k === "ttsApiKey" ? (v ? "••••" + String(v).slice(-4) : "") : v,
    ),
  );
  if (out.openhex?.entrypoints)
    for (const e of Object.values(out.openhex.entrypoints)) {
      e.hasQr = !!e.qr;
      delete e.qr;
    }
  return out;
}
export function mergeSecrets(next, prev) {
  if (Array.isArray(next)) {
    for (const item of next)
      if (item && typeof item === "object")
        mergeSecrets(item, Array.isArray(prev) ? prev.find((p) => p.id === item.id) : undefined);
    return next;
  }
  for (const [k, v] of Object.entries(next)) {
    if ((k === "apiKey" || k === "ttsApiKey") && typeof v === "string" && v.startsWith("••••"))
      next[k] = prev?.[k] || "";
    else if (v && typeof v === "object") mergeSecrets(v, prev?.[k]);
  }
  return next;
}
export function fail(message, status = 400) {
  const e = new Error(message);
  e.status = status;
  throw e;
}
export function owned(table, id, space) {
  if (!["chats", "files", "tasks", "artifacts", "employees", "plugins", "reminders"].includes(table))
    throw Error("invalid table");
  const r = one(`SELECT * FROM ${table} WHERE id=? AND space=?`, id, space);
  if (!r) fail("项目不存在或无权访问", 404);
  return r;
}
function addColumn(table, column, type) {
  if (!all(`PRAGMA table_info(${table})`).some((x) => x.name === column))
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
}
addColumn("chats", "binding", "TEXT");
addColumn("tasks", "runtime", "TEXT NOT NULL DEFAULT '{}'");
addColumn("messages", "meta", "TEXT NOT NULL DEFAULT '{}'");
addColumn("files", "scope", "TEXT NOT NULL DEFAULT 'knowledge'");
addColumn("files", "sha256", "TEXT");
addColumn("files", "parse_error", "TEXT");
db.exec(`
CREATE TABLE IF NOT EXISTS remote_uploads(cache_key TEXT PRIMARY KEY,space TEXT NOT NULL,file TEXT NOT NULL,part TEXT NOT NULL,expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS chat_turns(id TEXT PRIMARY KEY,chat TEXT NOT NULL,space TEXT NOT NULL,payload_hash TEXT NOT NULL,status TEXT NOT NULL,input TEXT NOT NULL,output TEXT NOT NULL DEFAULT '',remote TEXT,cursor TEXT,meta TEXT NOT NULL DEFAULT '{}',created TEXT NOT NULL,updated TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS remote_outputs(id TEXT PRIMARY KEY,space TEXT NOT NULL,chat TEXT NOT NULL,remote TEXT NOT NULL,agent TEXT NOT NULL,binding TEXT NOT NULL,name TEXT NOT NULL,workspace_path TEXT NOT NULL,mime TEXT,artifact TEXT,created TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS message_translations(message INTEGER NOT NULL,target TEXT NOT NULL,fingerprint TEXT NOT NULL,text TEXT NOT NULL,created TEXT NOT NULL,PRIMARY KEY(message,target,fingerprint));
CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat,id);
CREATE INDEX IF NOT EXISTS idx_files_space ON files(space,scope);
CREATE INDEX IF NOT EXISTS idx_turns_chat ON chat_turns(chat,created);

`);
addColumn("remote_outputs", "turn_id", "TEXT NOT NULL DEFAULT ''");
db.exec(
  "DROP INDEX IF EXISTS idx_remote_output; CREATE UNIQUE INDEX idx_remote_output ON remote_outputs(space,chat,remote,workspace_path,turn_id)",
);
export const safeError = (error) => {
  let text = String(error?.message || error || "服务异常");
  for (const p of [
    config().openhex,
    ...config().providers,
    config().speech,
    config().weather,
    config().search,
  ])
    for (const key of [p?.apiKey, p?.ttsApiKey]) if (key) text = text.split(key).join("[REDACTED]");
  return text
    .replace(/Bearer\s+[^\s"']+/gi, "Bearer [REDACTED]")
    .replace(/(?:sk_ws_|mysta_|sk-)[A-Za-z0-9_-]{8,}/g, "[REDACTED]")
    .slice(0, 800);
};
