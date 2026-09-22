import { MODEL_PRESETS, resolvedProvider } from "./presets.js";
import express from "express";
import multer from "multer";
import fs from "node:fs";
import path from "node:path";
import { randomInt, randomBytes } from "node:crypto";
import {
  ROOT,
  DATA,
  db,
  uid,
  hash,
  same,
  now,
  one,
  all,
  run,
  json,
  config,
  saveConfig,
  redact,
  mergeSecrets,
  owned,
  fail,
  employees,
  employee,
  event,
  audit,
  safeError,
} from "./core.js";
import {
  infer,
  member,
  endpoint,
  searchWeb,
  listOpenhexAgents,
} from "./providers.js";
import { fileContext, contextText, makeArtifact, statistics } from "./files.js";
import {
  createTask,
  confirmTask,
  cancelTask,
  retryTask,
  recoverTasks,
  active,
} from "./tasks.js";
import {
  registerChatRoutes,
  isFileBusy,
  recoverTurns,
  activeChats,
} from "./chat.js";
import { registerUploadRoutes, resumeParsing } from "./uploads.js";
import { registerServiceRoutes } from "./services.js";
import { parseApiDocument, validateConfiguration } from "./configuration.js";
import { connectionDiagnosis } from "./diagnostics.js";
import { configurationText } from "./config-document.js";
const app = express(),
  port = Number(process.env.PORT || 3000),
  production = process.env.NODE_ENV === "production";
app.disable("x-powered-by");
app.set("trust proxy", process.env.TRUST_PROXY === "1" ? 1 : false);
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  if (req.path.startsWith("/api/")) res.setHeader("Cache-Control", "no-store");
  if (
    ["POST", "PUT", "PATCH", "DELETE"].includes(req.method) &&
    req.headers.origin
  ) {
    const allowed =
      process.env.PUBLIC_URL || `${req.protocol}://${req.get("host")}`;
    if (req.headers.origin !== allowed)
      return res.status(403).json({
        error: "请求来源不匹配",
      });
  }
  next();
});
app.use(
  express.json({
    limit: "3mb",
  }),
);
const wrap = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);
const cookie = (name, v, age) =>
  `${name}=${v}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${production ? "; Secure" : ""}`;
const cookies = (req) =>
  Object.fromEntries(
    (req.headers.cookie || "").split(";").map((s) => s.trim().split("=")),
  );
const limits = new Map();
function limit(req, label, max = 40) {
  const key = label + ":" + req.ip;
  const entry = limits.get(key) || {
    n: 0,
    until: Date.now() + 60000,
  };
  if (entry.until < Date.now()) {
    entry.n = 0;
    entry.until = Date.now() + 60000;
  }
  entry.n++;
  limits.set(key, entry);
  if (entry.n > max) fail("请求过于频繁，请稍后重试", 429);
}
setInterval(() => {
  for (const [k, v] of limits) if (v.until < Date.now()) limits.delete(k);
  run("DELETE FROM sessions WHERE expires<?", Date.now());
  run("DELETE FROM transfers WHERE expires<?", Date.now());
  run("DELETE FROM capabilities WHERE expires<?", Date.now());
  run("DELETE FROM shares WHERE expires<?", Date.now());
}, 60000).unref();
function newSession(space, res) {
  const token = uid() + uid();
  run(
    "INSERT INTO sessions VALUES(?,?,?)",
    hash(token),
    space,
    Date.now() + 90 * 86400000,
  );
  res.setHeader("Set-Cookie", cookie("os_session", token, 90 * 86400));
}
function createSpace(res) {
  const id = uid();
  run(
    "INSERT INTO spaces VALUES(?,?,?)",
    id,
    JSON.stringify({
      name: "我的智能空间",
      avatar: "px_02",
      onboarded: false,
      tone: 50,
      creativity: 35,
    }),
    now(),
  );
  newSession(id, res);
  return id;
}
function auth(req, res, next) {
  const token = cookies(req).os_session || "";
  const s = one(
    "SELECT space FROM sessions WHERE token=? AND expires>?",
    hash(token),
    Date.now(),
  );
  if (!s)
    return res.status(401).json({
      error: "访客会话已失效，请刷新页面",
    });
  req.space = s.space;
  next();
}
let adminPassword = process.env.ADMIN_PASSWORD;
const adminPath = path.join(DATA, "admin-password.txt");
if (!adminPassword) {
  if (fs.existsSync(adminPath))
    adminPassword = fs.readFileSync(adminPath, "utf8").trim();
  else {
    adminPassword = randomBytes(18).toString("base64url");
    fs.writeFileSync(adminPath, adminPassword + "\n", {
      mode: 0o600,
    });
  }
}
const admins = new Map();
function admin(req, res, next) {
  const token = cookies(req).os_admin;
  const a = admins.get(hash(token || ""));
  if (!a || a.expires < Date.now() || a.space !== req.space)
    return res.status(403).json({
      error: "请先解锁管理员配置",
    });
  next();
}
app.get("/api/health", (_q, r) =>
  r.json({
    ok: true,
    version: "2026.9.19",
  }),
);
app.get("/api/session", (q, r) => {
  limit(q, "session", 100);
  const token = cookies(q).os_session || "";
  let space = one(
    "SELECT space FROM sessions WHERE token=? AND expires>?",
    hash(token),
    Date.now(),
  )?.space;
  if (!space) space = createSpace(r);
  const c = config();
  r.json({
    profile: json(one("SELECT profile FROM spaces WHERE id=?", space).profile),
    channel: c.channel,
    configured:
      !!resolvedProvider(c, c.defaultProvider)?.apiKey &&
      !!resolvedProvider(c, c.defaultProvider)?.model,
    speech: !!c.speech?.apiKey && !!c.speech?.asrModel,
    tts:
      !!(c.speech?.ttsApiKey || c.speech?.apiKey) &&
      !!c.speech?.ttsModel &&
      !!c.speech?.voice,
    search: !!c.search?.apiKey,
    weather: !!c.weather?.enabled,
    auxiliary: !!c.providers.find(
      (p) => p.id === (c.auxiliary?.providerId || c.defaultProvider),
    )?.apiKey,
    version: "2026.9.19",
  });
});
app.get("/shared/artifact/:id", (q, r) => {
  const s = one(
    "SELECT * FROM shares WHERE token=? AND artifact=? AND expires>?",
    hash(String(q.query.token || "")),
    q.params.id,
    Date.now(),
  );
  if (!s) fail("下载授权已失效", 403);
  const a = owned("artifacts", s.artifact, s.space);
  r.download(a.path, a.name);
});
app.use("/api", auth);
app.post("/api/session/new", (q, r) => {
  limit(q, "newspace", 10);
  createSpace(r);
  r.json({
    ok: true,
  });
});
app.patch("/api/profile", (q, r) => {
  const old = json(
    one("SELECT profile FROM spaces WHERE id=?", q.space).profile,
  );
  const p = q.body;
  const avatar = String(p.avatar || old.avatar);
  if (
    !/^px_\d{2}$/.test(avatar) &&
    !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(avatar)
  )
    fail("请选择有效头像");
  if (avatar.length > 1500000) fail("头像过大");
  const setting = (key, fallback, min, max) => {
    const n = Number(p[key] ?? old[key] ?? fallback);
    if (!Number.isFinite(n) || n < min || n > max) fail("设置超出范围：" + key);
    return n;
  };
  const profile = {
    ...old,
    speechRate: setting("speechRate", 1, 0.5, 2),
    speechVolume: setting("speechVolume", 1, 0, 1),
    proactive:
      p.proactive === undefined
        ? old.proactive !== false
        : p.proactive === true,
    name: String(p.name ?? old.name).slice(0, 30),
    avatar,
    onboarded: p.onboarded ?? old.onboarded,
    tone: Math.max(0, Math.min(100, Number(p.tone ?? old.tone))),
    creativity: Math.max(
      0,
      Math.min(100, Number(p.creativity ?? old.creativity)),
    ),
  };
  run(
    "UPDATE spaces SET profile=? WHERE id=?",
    JSON.stringify(profile),
    q.space,
  );
  r.json(profile);
});
app.post("/api/session/code", (q, r) => {
  limit(q, "code", 5);
  run("DELETE FROM transfers WHERE space=?", q.space);
  let code;
  do {
    code = String(randomInt(100000, 1000000));
  } while (one("SELECT code FROM transfers WHERE code=?", hash(code)));
  run(
    "INSERT INTO transfers VALUES(?,?,?)",
    hash(code),
    q.space,
    Date.now() + 300000,
  );
  r.json({
    code,
    expiresIn: 300,
  });
});
app.post("/api/session/resume", (q, r) => {
  limit(q, "resume", 5);
  const code = hash(String(q.body.code || ""));
  const row = one(
    "SELECT * FROM transfers WHERE code=? AND expires>?",
    code,
    Date.now(),
  );
  if (!row) fail("接续码错误、过期或已使用");
  run("DELETE FROM transfers WHERE code=?", code);
  newSession(row.space, r);
  r.json({
    ok: true,
  });
});
app.get("/api/employees", (q, r) => r.json(employees(q.space)));
app.post("/api/employees", (q, r) => {
  const p = q.body;
  if (!p.name || !p.prompt) fail("请填写姓名和岗位指令");
  if (all("SELECT id FROM employees WHERE space=?", q.space).length >= 30)
    fail("每个空间最多创建30名员工");
  const e = {
    id: uid(),
    name: String(p.name).slice(0, 30),
    job: String(p.job || "自定义员工").slice(0, 40),
    avatar: /^px_\d{2}$/.test(p.avatar) ? p.avatar : "px_02",
    description: String(p.description || "").slice(0, 300),
    prompt: String(p.prompt).slice(0, 6000),
    local: true,
  };
  run("INSERT INTO employees VALUES(?,?,?)", e.id, q.space, JSON.stringify(e));
  r.json(e);
});
app.delete("/api/employees/:id", (q, r) => {
  owned("employees", q.params.id, q.space);
  run("DELETE FROM employees WHERE id=?", q.params.id);
  r.json({
    ok: true,
  });
});
const upload = multer({
  dest: path.join(DATA, "uploads"),
  limits: {
    fileSize: 20 * 1024 * 1024,
    files: 1,
  },
});
registerChatRoutes(app, {
  wrap,
  limit,
});
registerUploadRoutes(app, {
  upload,
  wrap,
  isFileBusy,
});
registerServiceRoutes(app, {
  upload,
  wrap,
  limit,
  admin,
});
app.post("/api/files/search", (q, r) =>
  r.json(fileContext(q.space, String(q.body.query || ""))),
);
app.get("/api/tasks", (q, r) =>
  r.json(
    all(
      "SELECT id,title,status,error,channel,created,updated FROM tasks WHERE space=? ORDER BY created DESC",
      q.space,
    ),
  ),
);
app.post(
  "/api/tasks",
  wrap(async (q, r) => {
    limit(q, "tasks", 8);
    if (active() >= 4) fail("当前最多同时执行4个任务", 429);
    const id = await createTask(
      q.space,
      String(q.body.request || ""),
      Array.isArray(q.body.files) ? q.body.files.slice(0, 10) : [],
      config().channel,
      q.body.sourceTask,
    );
    r.status(202).json({
      id,
    });
  }),
);
app.get("/api/tasks/:id", (q, r) => {
  const t = owned("tasks", q.params.id, q.space);
  r.json({
    ...t,
    plan: json(t.plan),
    inputs: json(t.inputs),
    review: json(t.review),
    runtime: json(t.runtime),
    events: all("SELECT * FROM events WHERE task=? ORDER BY id", t.id).map(
      (e) => ({
        ...e,
        data: json(e.data),
      }),
    ),
    artifacts: all(
      "SELECT id,name,kind,version,created FROM artifacts WHERE task=? AND space=?",
      t.id,
      q.space,
    ),
  });
});
app.get("/api/tasks/:id/nodes/:node", (q, r) => {
  const t = owned("tasks", q.params.id, q.space),
    node = String(q.params.node);
  const step = json(t.plan)?.steps?.find((s) => s.id === node);
  if (!step) fail("节点不存在", 404);
  const saved = one(
    "SELECT text,status,updated FROM task_node_outputs WHERE task=? AND node=?",
    t.id,
    node,
  );
  const events = all("SELECT * FROM events WHERE task=? ORDER BY id", t.id).map(
    (e) => ({
      ...e,
      data: json(e.data),
    }),
  );
  const start = events.findLastIndex((e) => e.kind === "planning");
  const done = events
    .slice(Math.max(0, start))
    .findLast((e) => e.kind === "step_done" && e.data.node === node);
  r.json({
    step,
    text: saved?.text || done?.data.text || "",
    status:
      saved?.status === "running" &&
      !["running", "reviewing", "delivering"].includes(t.status)
        ? t.status
        : saved?.status || (done ? "done" : "pending"),
    updated: saved?.updated || done?.created || null,
    taskStatus: t.status,
  });
});
app.post("/api/tasks/:id/confirm", (q, r) => {
  confirmTask(q.space, q.params.id, q.body.approved === true);
  r.json({
    ok: true,
  });
});
app.post("/api/tasks/:id/cancel", (q, r) => {
  cancelTask(q.space, q.params.id);
  r.json({
    ok: true,
  });
});
app.post("/api/tasks/:id/retry", (q, r) => {
  retryTask(q.space, q.params.id);
  r.json({
    ok: true,
  });
});
app.post(
  "/api/messages/:id/export",
  wrap(async (q, r) => {
    const m = one(
      "SELECT m.*,c.space,c.title FROM messages m JOIN chats c ON c.id=m.chat WHERE m.id=? AND c.space=?",
      q.params.id,
      q.space,
    );
    if (!m || m.role !== "assistant") fail("回复不存在或无权访问", 404);
    const kind = q.body.kind;
    if (!["docx", "pdf", "pptx", "md"].includes(kind)) fail("不支持此格式");
    const meta = json(m.meta) || {},
      draft = meta.review?.state !== "clear" || meta.interrupted;
    const text =
      m.content +
      (draft
        ? "\n\n待核验草稿：" + (meta.review?.summary || "尚未完成独立监察")
        : "");
    r.json(
      await makeArtifact({
        space: q.space,
        title: (draft ? "待核验草稿_" : "") + m.title,
        text,
        kind,
      }),
    );
  }),
);
app.get("/api/artifacts", (q, r) =>
  r.json(
    all(
      "SELECT id,task,name,kind,version,created FROM artifacts WHERE space=? ORDER BY created DESC",
      q.space,
    ),
  ),
);
app.get("/api/artifacts/:id/download", (q, r) => {
  const a = owned("artifacts", q.params.id, q.space);
  r.download(a.path, a.name);
});
app.get("/api/artifacts/:id/preview", (q, r) => {
  const a = owned("artifacts", q.params.id, q.space);
  if (a.kind !== "html") fail("此格式请下载查看");
  r.setHeader(
    "Content-Security-Policy",
    "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; form-action 'none'; frame-src 'none'",
  );
  r.type("html").sendFile(a.path);
});
app.post(
  "/api/tasks/:id/export",
  wrap(async (q, r) => {
    const t = owned("tasks", q.params.id, q.space);
    if (!t.output?.trim()) fail("当前还没有可导出的正文");
    const kind = q.body.kind;
    if (!["docx", "xlsx", "pdf", "pptx", "md"].includes(kind))
      fail("不支持此格式");
    r.json(
      await makeArtifact({
        space: q.space,
        task: t.id,
        title: (t.status === "succeeded" ? "" : "待核验草稿_") + t.title,
        text:
          t.output +
          (t.status === "succeeded"
            ? ""
            : "\n\n草稿状态：" +
              t.status +
              "。尚未通过完整验收。\n" +
              (json(t.review)?.issues || []).join("\n")),
        kind,
        stats: kind === "xlsx" ? await statistics(q.space, json(t.inputs)) : [],
      }),
    );
  }),
);
const builtins = [
  {
    id: "knowledge",
    name: "私有知识库",
    description: "检索当前空间资料并标注来源",
    state: "ready",
  },
  {
    id: "spreadsheet",
    name: "表格统计",
    description: "真实统计 CSV / Excel 数值与缺失项",
    state: "ready",
  },
  {
    id: "artifacts",
    name: "成果生成",
    description: "将通过监察的成果导出为文件",
    state: "ready",
  },
  {
    id: "web",
    name: "联网搜索",
    description: "需要管理员配置 Tavily",
    state: "configuration",
  },
];
app.get("/api/plugins", (q, r) =>
  r.json({
    builtin: builtins,
    added: all("SELECT data FROM plugins WHERE space=?", q.space).map((x) =>
      json(x.data),
    ),
  }),
);
app.post("/api/plugins", (q, r) => {
  const p = q.body;
  if (!p.name) fail("请填写插件名称");
  const item = {
    id: uid(),
    name: String(p.name).slice(0, 50),
    description: String(p.description || "").slice(0, 300),
    url: String(p.url || "").slice(0, 500),
    state: "registered",
    created: now(),
  };
  run(
    "INSERT INTO plugins VALUES(?,?,?)",
    item.id,
    q.space,
    JSON.stringify(item),
  );
  r.json(item);
});
app.delete("/api/plugins/:id", (q, r) => {
  owned("plugins", q.params.id, q.space);
  run("DELETE FROM plugins WHERE id=?", q.params.id);
  r.json({
    ok: true,
  });
});
app.post("/api/skills", upload.single("file"), (q, r) => {
  if (q.file)
    fs.rmSync(q.file.path, {
      force: true,
    });
  r.status(422).json({
    error: "当前版本暂不支持导入此类 Skill，文件未启用，也未作为代码执行。",
  });
});
app.get("/api/stats", (q, r) =>
  r.json({
    tasks: one("SELECT count(*) n FROM tasks WHERE space=?", q.space).n,
    completed: one(
      "SELECT count(*) n FROM tasks WHERE space=? AND status='succeeded'",
      q.space,
    ).n,
    files: one("SELECT count(*) n FROM files WHERE space=?", q.space).n,
    artifacts: one("SELECT count(*) n FROM artifacts WHERE space=?", q.space).n,
    roles: employees(q.space).length,
    channels: all(
      "SELECT channel,count(*) n FROM chats WHERE space=? AND channel IS NOT NULL GROUP BY channel",
      q.space,
    ),
  }),
);
app.get("/api/reminders", (q, r) =>
  r.json(all("SELECT * FROM reminders WHERE space=? ORDER BY due", q.space)),
);
app.post("/api/reminders", (q, r) => {
  const due = Date.parse(q.body.due);
  if (!Number.isFinite(due) || due < Date.now()) fail("请选择未来时间");
  const id = uid();
  run(
    "INSERT INTO reminders VALUES(?,?,?,?,0)",
    id,
    q.space,
    String(q.body.title || "任务跟进").slice(0, 100),
    due,
  );
  r.json({
    id,
  });
});
app.post("/api/reminders/:id/seen", (q, r) => {
  owned("reminders", q.params.id, q.space);
  run("UPDATE reminders SET seen=1 WHERE id=?", q.params.id);
  r.json({
    ok: true,
  });
});
app.post("/api/admin/login", (q, r) => {
  limit(q, "admin", 5);
  if (!same(String(q.body.password || ""), adminPassword))
    fail("管理员口令错误", 403);
  const token = uid() + uid();
  admins.set(hash(token), {
    space: q.space,
    expires: Date.now() + 3600000,
  });
  r.setHeader("Set-Cookie", cookie("os_admin", token, 3600));
  r.json({
    ok: true,
  });
});
app.get("/api/admin/config", admin, (_q, r) => r.json(redact(config())));
app.put("/api/admin/config", admin, (q, r) => {
  if (activeChats() || active())
    fail("仍有对话或团队任务执行中，请先等待完成或停止后再修改服务配置", 409);
  const old = config(),
    c = mergeSecrets(
      {
        ...old,
        ...q.body,
        openhex: {
          ...old.openhex,
          ...q.body.openhex,
          entrypoints: old.openhex.entrypoints,
        },
      },
      old,
    );
  validateConfiguration(c);
  saveConfig(c);
  run("DELETE FROM settings WHERE key='model-tests'");
  audit(q.space, "config", "管理员更新服务配置");
  r.json(redact(config()));
});
const importPreviews = new Map();
const configUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024, files: 1, fields: 0 },
});
app.post(
  "/api/admin/import-api/preview",
  admin,
  configUpload.single("file"),
  wrap(async (q, r) => {
    limit(q, "config-import", 10);
    if (activeChats() || active())
      fail("仍有对话或团队任务执行中，请先等待完成或停止后再导入配置", 409);
    let text;
    try {
      text = q.file
        ? await configurationText(q.file)
        : String(q.body.text || "");
    } catch (error) {
      error.status = 400;
      throw error;
    }
    const old = config(),
      parsed = parseApiDocument(text, old),
      token = uid() + uid();
    for (const [key, item] of importPreviews)
      if (item.expires < Date.now() || item.space === q.space)
        importPreviews.delete(key);
    importPreviews.set(hash(token), {
      space: q.space,
      expires: Date.now() + 300000,
      base: hash(JSON.stringify(redact(old))),
      config: parsed.config,
    });
    r.json({
      token,
      changes: parsed.changes,
      warnings: parsed.warnings,
      expiresIn: 300,
    });
  }),
);
app.post("/api/admin/import-api/apply", admin, (q, r) => {
  if (activeChats() || active())
    fail("仍有对话或团队任务执行中，请先等待完成或停止后再导入配置", 409);
  const key = hash(String(q.body.token || "")),
    item = importPreviews.get(key);
  importPreviews.delete(key);
  if (!item || item.space !== q.space || item.expires < Date.now())
    fail("导入预览已过期，请重新选择 API.txt", 409);
  if (item.base !== hash(JSON.stringify(redact(config()))))
    fail("配置在预览后已变化，请重新预览再导入", 409);
  validateConfiguration(item.config);
  saveConfig(item.config);
  run("DELETE FROM settings WHERE key='model-tests'");
  audit(q.space, "config_import", "管理员确认导入 API 文档");
  r.json(redact(config()));
});
app.get(
  "/api/admin/openhex/agents",
  admin,
  wrap(async (q, r) => {
    limit(q, "agent-list", 20);
    r.json(await listOpenhexAgents());
  }),
);
app.get("/api/admin/presets", admin, (_q, r) => r.json(MODEL_PRESETS));
app.get("/api/admin/model-status", admin, (_q, r) =>
  r.json(
    json(one("SELECT value FROM settings WHERE key='model-tests'")?.value) ||
      {},
  ),
);
app.post(
  "/api/admin/test",
  admin,
  wrap(async (q, r) => {
    limit(q, "connection", 30);
    if (
      q.body.employeeTest &&
      !employees(q.space).some((e) => e.id === q.body.role)
    )
      fail("待测试的员工不存在", 400);
    const c = config();
    const baseRole = ["director", "supervisor"].includes(q.body.role);
    const override = !baseRole && c.singleProviders?.[q.body.role];
    const channel = q.body.employeeTest
        ? baseRole || override
          ? "direct"
          : c.channel
        : q.body.channel || c.channel,
      providerId = q.body.employeeTest
        ? baseRole
          ? undefined
          : override
        : q.body.providerId;
    if (providerId && !config().providers.some((p) => p.id === providerId))
      fail("模型档案不存在");
    const started = Date.now(),
      snapshot = hash(JSON.stringify(config()));
    try {
      const out = await infer({
        space: q.space,
        role: employees(q.space).some((e) => e.id === q.body.role)
          ? q.body.role
          : "director",
        channel,
        providerId,
        timeoutMs: 90000,
        allowFallback: false,
        messages: [
          {
            role: "user",
            content: "连接测试，请只回复“连接成功”。",
          },
        ],
      });
      const result = {
        ok: true,
        channel: out.channel,
        reply: out.text.slice(0, 500),
        testedAt: now(),
        elapsedMs: Date.now() - started,
      };
      saveTest(result);
      r.json(result);
    } catch (error) {
      Object.assign(error, connectionDiagnosis(error, safeError));
      saveTest({
        ok: false,
        error: error.diagnosis,
        testedAt: now(),
        elapsedMs: Date.now() - started,
      });
      throw error;
    }
    function saveTest(result) {
      if (hash(JSON.stringify(config())) !== snapshot) return;
      const values =
        json(
          one("SELECT value FROM settings WHERE key='model-tests'")?.value,
        ) || {};
      values[
        q.body.employeeTest
          ? `employee:${q.body.role}`
          : providerId || (q.body.role ? `employee:${q.body.role}` : channel)
      ] = result;
      run(
        "INSERT OR REPLACE INTO settings VALUES(?,?)",
        "model-tests",
        JSON.stringify(values),
      );
    }
  }),
);
let mcpSecret = process.env.MCP_TOKEN;
const mcpPath = path.join(DATA, "mcp-token.txt");
if (!mcpSecret) {
  if (fs.existsSync(mcpPath))
    mcpSecret = fs.readFileSync(mcpPath, "utf8").trim();
  else {
    mcpSecret = uid() + uid();
    fs.writeFileSync(mcpPath, mcpSecret + "\n", {
      mode: 0o600,
    });
  }
}
app.post("/api/tasks/:id/capability", (q, r) => {
  const t = owned("tasks", q.params.id, q.space);
  const token = uid() + uid();
  run(
    "INSERT INTO capabilities VALUES(?,?,?,?)",
    hash(token),
    q.space,
    t.id,
    Date.now() + 1800000,
  );
  r.json({
    capability: token,
    expiresIn: 1800,
    message: "仅将此凭证用于本次 OpenHex 工具调用，30分钟后失效",
  });
});
const toolList = [
  {
    name: "search_knowledge",
    description: "检索当前授权任务空间的资料，需任务 capability",
    inputSchema: {
      type: "object",
      properties: {
        capability: {
          type: "string",
        },
        query: {
          type: "string",
        },
      },
      required: ["capability", "query"],
    },
  },
  {
    name: "task_status",
    description: "读取授权任务的真实状态及成果",
    inputSchema: {
      type: "object",
      properties: {
        capability: {
          type: "string",
        },
      },
      required: ["capability"],
    },
  },
  {
    name: "analyze_tables",
    description: "计算授权任务附件中CSV/XLSX的数值统计",
    inputSchema: {
      type: "object",
      properties: {
        capability: {
          type: "string",
        },
      },
      required: ["capability"],
    },
  },
  {
    name: "create_document",
    description: "将用户要求的正文保存为Word成果文件，不代表监察通过",
    inputSchema: {
      type: "object",
      properties: {
        capability: {
          type: "string",
        },
        title: {
          type: "string",
        },
        content: {
          type: "string",
        },
      },
      required: ["capability", "title", "content"],
    },
  },
];
app.post(
  "/mcp",
  wrap(async (q, r) => {
    limit(q, "mcp", 60);
    if (!same(q.headers.authorization || "", "Bearer " + mcpSecret))
      return r.status(401).json({
        error: "Unauthorized",
      });
    const { id, method, params } = q.body;
    if (id === undefined) return r.sendStatus(202);
    const result = (x) =>
      r.json({
        jsonrpc: "2.0",
        id,
        result: x,
      });
    if (method === "initialize")
      return result({
        protocolVersion: "2025-03-26",
        capabilities: {
          tools: {},
        },
        serverInfo: {
          name: "onestaff-tools",
          version: "2026.9.19",
        },
      });
    if (method === "ping") return result({});
    if (method === "tools/list")
      return result({
        tools: toolList,
      });
    if (method !== "tools/call")
      return r.json({
        jsonrpc: "2.0",
        id,
        error: {
          code: -32601,
          message: "Method not found",
        },
      });
    try {
      const a = params.arguments || {},
        cap = one(
          "SELECT * FROM capabilities WHERE token=? AND expires>?",
          hash(a.capability || ""),
          Date.now(),
        );
      if (!cap) fail("任务授权无效或已过期", 403);
      const t = owned("tasks", cap.task, cap.space);
      let value;
      switch (params.name) {
        case "search_knowledge":
          value = fileContext(cap.space, String(a.query || ""), json(t.inputs));
          break;
        case "task_status":
          value = {
            status: t.status,
            title: t.title,
            error: t.error,
            artifacts: all(
              "SELECT id,name,kind FROM artifacts WHERE task=? AND space=?",
              t.id,
              cap.space,
            ),
          };
          break;
        case "analyze_tables":
          value = await statistics(cap.space, json(t.inputs));
          break;
        case "create_document":
          if (
            ![
              "running",
              "reviewing",
              "revising",
              "delivering",
              "succeeded",
            ].includes(t.status)
          )
            fail("用户尚未确认执行或任务已停止，不能创建文件", 409);
          if (!String(a.content || "").trim() || a.content.length > 120000)
            fail("正文为空或过长");
          value = await makeArtifact({
            space: cap.space,
            task: t.id,
            title: "工具草稿_" + String(a.title).slice(0, 50),
            text: a.content,
            kind: "docx",
          });
          if (process.env.PUBLIC_URL) {
            const token = uid() + uid();
            run(
              "INSERT INTO shares VALUES(?,?,?,?)",
              hash(token),
              value.id,
              cap.space,
              Date.now() + 1800000,
            );
            value.download =
              process.env.PUBLIC_URL.replace(/\/$/, "") +
              "/shared/artifact/" +
              value.id +
              "?token=" +
              token;
            value.expiresIn = 1800;
          } else
            value.download =
              "在OneStaff成果中心下载；设置PUBLIC_URL后工具返回短时下载链接";
          value.review = "未监察的工具草稿";
          break;
        default:
          fail("未知工具");
      }
      event(t.id, "mcp", "openhex", {
        message: `工具 ${params.name} 调用成功`,
      });
      return result({
        content: [
          {
            type: "text",
            text: JSON.stringify(value),
          },
        ],
      });
    } catch (e) {
      return result({
        isError: true,
        content: [
          {
            type: "text",
            text: e.message,
          },
        ],
      });
    }
  }),
);
app.get("/mcp", (_q, r) => r.sendStatus(405));
app.delete("/mcp", (_q, r) => r.sendStatus(405));
app.get("/USER_GUIDE.html", (_q, r) =>
  r.sendFile(path.join(ROOT, "USER_GUIDE.html")),
);
app.use(
  express.static(path.join(ROOT, "public"), {
    index: "index.html",
    dotfiles: "deny",
  }),
);
app.use((err, q, r, _next) => {
  if (r.headersSent) return r.end();
  const status = err.code === "LIMIT_FILE_SIZE" ? 413 : err.status || 500;
  const msg =
    err.code === "LIMIT_FILE_SIZE"
      ? q.path.includes("import-api")
        ? "配置文档不能超过2 MB"
        : "单个文件不能超过20 MB"
      : safeError(err);
  if (q.path.includes("/admin/") && !err.diagnosis)
    Object.assign(err, connectionDiagnosis(err, safeError));
  const body = {
    error: msg,
  };
  for (const k of [
    "code",
    "field",
    "providerId",
    "url",
    "upstreamStatus",
    "diagnosis",
  ])
    if (err?.[k] !== undefined) body[k] = err[k];
  if (Array.isArray(err?.errors))
    body.errors = err.errors.map((x) => ({
      field: x.field,
      label: x.label,
      message: safeError(x.message),
    }));
  r.status(status).json(body);
});
recoverTasks();
recoverTurns();
resumeParsing();
export const server = app.listen(port, process.env.HOST || "127.0.0.1", () => {
  console.log(`OneStaff X AI → http://localhost:${server.address().port}`);
  console.log(
    "管理员口令：请查看 data/admin-password.txt，或使用 ADMIN_PASSWORD 环境变量。",
  );
});
function shutdown() {
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
