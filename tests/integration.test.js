import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
const ROOT = path.resolve(import.meta.dirname, "..");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "onestaff-test-"));
let child,
  base,
  fixture,
  fixtureBase,
  received = [];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
function replyFor(messages) {
  const system = messages[0]?.content || "",
    user = messages.at(-1)?.content || "";
  if (system.includes("只做规划，不执行操作"))
    return JSON.stringify({
      summary: "测试项目交付",
      format: user.includes("HTMLCASE") ? "html" : "docx",
      criteria: ["依据资料", "完整输出"],
      steps: [
        {
          id: "s1",
          role: "researcher",
          action: "整理提供的资料",
          depends: [],
        },
        {
          id: "s2",
          role: "analyst",
          action: "验证数据",
          depends: [],
        },
        {
          id: "s3",
          role: user.includes("HTMLCASE") ? "coder" : "writer",
          action: "生成成果",
          depends: ["s1", "s2"],
        },
      ],
    });
  if (system.includes("推荐0至2个"))
    return JSON.stringify({
      questions: ["下一步该怎么验证结果？"],
    });
  if (system.includes("独立监察者"))
    return JSON.stringify({
      pass: !user.includes("REVIEWFAIL"),
      issues: user.includes("REVIEWFAIL") ? ["测试要求返修"] : [],
      summary: user.includes("REVIEWFAIL") ? "仍需完善" : "核验通过",
    });
  if (user.includes("HTMLCASE"))
    return '<!doctype html><html><meta charset="utf-8"><title>测试网页</title><body><h1>测试项目</h1></body></html>';
  return (
    "# 测试项目\n这是来自本地协议测试服务的固定夹具，不是生产模型。\n" +
    (user.includes("REVIEWFAIL")
      ? "REVIEWFAIL"
      : "资料核验：缺失值及统计口径已列明。")
  );
}
function client() {
  let cookie = "";
  return {
    async raw(route, method = "GET", body) {
      const headers = {};
      if (cookie) headers.Cookie = cookie;
      if (body && !(body instanceof FormData))
        headers["Content-Type"] = "application/json";
      const r = await fetch(base + "/api" + route, {
        method,
        headers,
        body: body
          ? body instanceof FormData
            ? body
            : JSON.stringify(body)
          : undefined,
      });
      const set = r.headers.get("set-cookie");
      if (set) {
        const kv = set.split(";")[0],
          name = kv.split("=")[0];
        cookie = cookie
          .split("; ")
          .filter((x) => x && !x.startsWith(name + "="))
          .concat(kv)
          .join("; ");
      }
      return r;
    },
    async request(route, method = "GET", body) {
      const r = await this.raw(route, method, body),
        j = await r.json();
      if (!r.ok)
        throw Object.assign(Error(j.error), {
          status: r.status,
        });
      return j;
    },
    cookie() {
      return cookie;
    },
  };
}
async function until(c, id, wanted) {
  for (let i = 0; i < 120; i++) {
    const t = await c.request("/tasks/" + id);
    if (wanted.includes(t.status)) return t;
    await wait(60);
  }
  throw Error("task timeout");
}
const a = client(),
  b = client();
let cfg, task, art, file;
let reviewWaiting = false,
  followupOverlapped = false,
  releaseReview;
test.before(async () => {
  fixture = http.createServer(async (q, r) => {
    let raw = "";
    for await (const chunk of q) raw += chunk;
    const body = raw ? JSON.parse(raw) : {};
    received.push({
      url: q.url,
      body,
      authorization: q.headers.authorization,
    });
    if (q.url === "/api/v2/agents")
      return r.end(
        JSON.stringify([
          {
            id: "agent-research",
            name: "研究员",
          },
          {
            id: "agent-writing",
            name: "文案",
          },
        ]),
      );
    if (q.url.startsWith("/missing")) {
      r.statusCode = 503;
      return r.end("{}");
    }
    if (q.url.endsWith("/chat/completions")) {
      if (body.messages.at(-1)?.content.includes("PARALLEL_CHECK")) {
        if (body.messages[0]?.content.includes("独立监察者")) {
          reviewWaiting = true;
          await new Promise((resolve) => {
            const timer = setTimeout(resolve, 1500);
            releaseReview = () => {
              clearTimeout(timer);
              resolve();
            };
          });
          reviewWaiting = false;
        }
        if (body.messages[0]?.content.includes("推荐0至2个")) {
          followupOverlapped = reviewWaiting;
          releaseReview?.();
        }
      }
      if (body.messages.some((m) => String(m.content).includes("MODELFAIL"))) {
        r.writeHead(503);
        return r.end("{}");
      }
      if (body.messages.some((m) => String(m.content).includes("SLOWCASE")))
        await wait(700);
      const text = replyFor(body.messages);
      if (body.stream) {
        r.writeHead(200, {
          "Content-Type": "text/event-stream",
        });
        for (const x of [text.slice(0, 10), text.slice(10)])
          r.write(
            "data: " +
              JSON.stringify({
                choices: [
                  {
                    delta: {
                      content: x,
                    },
                  },
                ],
              }) +
              "\n\n",
          );
        return r.end("data: [DONE]\n\n");
      }
      return r.end(
        JSON.stringify({
          choices: [
            {
              message: {
                content: text,
              },
            },
          ],
        }),
      );
    }
    if (q.url.endsWith("/members"))
      return r.end(
        JSON.stringify({
          member_id: "member-fixture",
        }),
      );
    if (q.url.includes("/sessions"))
      return r.end(
        JSON.stringify({
          token: "fixture-member-token",
          expires_at: new Date(Date.now() + 1800000).toISOString(),
        }),
      );
    if (q.url.includes("/whoami"))
      return r.end(
        JSON.stringify({
          slug: "test-workspace",
        }),
      );
    if (
      q.url.endsWith("/conversations/send") &&
      body.targetAgentIds?.includes("invalid-fixture")
    ) {
      r.statusCode = 400;
      return r.end(
        JSON.stringify({
          detail: "Validation error",
          issues: [{ path: ["targetAgentIds", 0], message: "Invalid UUID" }],
        }),
      );
    }
    if (q.url.endsWith("/conversations/send"))
      return r.end(
        JSON.stringify({
          conversationId: "remote-" + received.length,
          userEventId: "user-1",
        }),
      );
    if (q.url.includes("/stream")) {
      r.writeHead(200, {
        "Content-Type": "text/event-stream",
      });
      r.write(
        "id: a1\ndata: " +
          JSON.stringify({
            id: "a1",
            sender: "assistant",
            raw: {
              type: "assistant",
              message: {
                content: [
                  {
                    type: "text",
                    text: "OpenHex SDK 协议夹具回复",
                  },
                ],
              },
            },
          }) +
          "\n\n",
      );
      return r.end(
        "id: r1\ndata: " +
          JSON.stringify({
            id: "r1",
            sender: "assistant",
            raw: {
              type: "result",
              is_error: false,
            },
          }) +
          "\n\n",
      );
    }
    r.writeHead(404);
    r.end("{}");
  });
  fixture.listen(0, "127.0.0.1");
  await once(fixture, "listening");
  fixtureBase = "http://127.0.0.1:" + fixture.address().port;
  child = spawn(process.execPath, ["server/index.js"], {
    cwd: ROOT,
    env: {
      ...process.env,
      DATA_DIR: temp,
      PORT: "0",
      HOST: "127.0.0.1",
      ALLOW_LOCAL_API: "1",
      ADMIN_PASSWORD: "test-admin-password",
      MCP_TOKEN: "test-mcp",
      NODE_ENV: "test",
      OPENHEX_API_KEY: "",
      OPENHEX_AUTH_MODE: "",
      OPENHEX_WORKSPACE_KEY: "",
      OPENHEX_WORKSPACE_SLUG: "",
      OPENHEX_AGENT_ID: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  await new Promise((resolve, reject) => {
    const t = setTimeout(
      () => reject(Error("startup timed out: " + output)),
      10000,
    );
    child.stdout.on("data", (b) => {
      output += b;
      const m = output.match(/http:\/\/localhost:(\d+)/);
      if (m) {
        base = "http://127.0.0.1:" + m[1];
        clearTimeout(t);
        resolve();
      }
    });
    child.stderr.on("data", (b) => (output += b));
    child.on("exit", (code) => reject(Error("server exited " + code + output)));
  });
});
test.after(async () => {
  child?.kill("SIGTERM");
  if (child) await once(child, "exit");
  fixture?.closeAllConnections();
  fixture?.close();
  fs.rmSync(temp, {
    recursive: true,
    force: true,
  });
});
test("访客隔离、空间持久化和管理员权限", async () => {
  await a.request("/session");
  await b.request("/session");
  await a.request("/profile", "PATCH", {
    name: "测试空间A",
    avatar: "px_02",
    onboarded: true,
  });
  assert.equal((await a.request("/session")).profile.name, "测试空间A");
  assert.notEqual((await b.request("/session")).profile.name, "测试空间A");
  assert.equal((await a.raw("/admin/config")).status, 403);
  assert.equal(
    (
      await a.raw("/tasks", "POST", {
        request: "缺凭证不执行",
      })
    ).status,
    503,
  );
  await a.request("/admin/login", "POST", {
    password: "test-admin-password",
  });
  cfg = await a.request("/admin/config");
  cfg.channel = "direct";
  cfg.routing.enabled = false;
  cfg.providers = [
    {
      id: "deepseek",
      label: "本地测试夹具",
      baseUrl: fixtureBase,
      model: "fixture",
      apiKey: "fixture-secret",
    },
  ];
  cfg.defaultProvider = "deepseek";
  cfg.reviewProvider = "deepseek";
  await a.request("/admin/config", "PUT", cfg);
  const masked = await a.request("/admin/config");
  assert.match(masked.providers[0].apiKey, /^••••/);
  assert.ok(!JSON.stringify(masked).includes("fixture-secret"));
  assert.ok(
    !fs
      .readFileSync(path.join(temp, "onestaff.db"))
      .includes(Buffer.from("fixture-secret")),
  );
});
test("文件解析、知识检索和越权删除拦截", async () => {
  const f = new FormData();
  f.append(
    "file",
    new Blob(["name,units,price\nA,2,10\nB,3,20\nC,,5"]),
    "sales.csv",
  );
  file = await a.request("/files", "POST", f);
  assert.equal((await b.request("/files")).length, 0);
  assert.equal((await b.raw("/files/" + file.id, "DELETE")).status, 404);
  const hits = await a.request("/files/search", "POST", {
    query: "units",
  });
  assert.ok(hits.length > 0);
  assert.match(hits[0].content, /A,2,10/);
});
test("真实HTTP流式传递与聊天隔离", async () => {
  const c = await a.request("/chats", "POST", {
    employee: "director",
  });
  assert.equal((await b.raw("/chats/" + c.id)).status, 404);
  const r = await a.raw("/chats/" + c.id + "/send", "POST", {
    text: "units",
    files: [file.id],
    knowledge: true,
  });
  const text = await r.text();
  assert.match(text, /event: grounding/);
  assert.match(text, /\"enabled\":true/);
  assert.match(text, /\"matched\":true/);
  assert.match(text, /event: token/);
  assert.match(text, /event: done/);
  const saved = await a.request("/chats/" + c.id);
  assert.equal(saved.messages.length, 2);
  assert.match(saved.messages[1].content, /测试项目/);
});
test("确认门、顺序依赖、独立监察和Word成果", async () => {
  task = (
    await a.request("/tasks", "POST", {
      request: "编写项目方案",
      files: [file.id],
    })
  ).id;
  let t = await until(a, task, ["waiting_approval", "failed"]);
  assert.equal(t.status, "waiting_approval");
  assert.equal(t.artifacts.length, 0);
  assert.equal(
    (
      await b.raw("/tasks/" + task + "/confirm", "POST", {
        approved: true,
      })
    ).status,
    404,
  );
  await a.request("/tasks/" + task + "/confirm", "POST", {
    approved: true,
  });
  assert.equal(
    (
      await a.raw("/tasks/" + task + "/confirm", "POST", {
        approved: true,
      })
    ).status,
    409,
  );
  t = await until(a, task, ["succeeded", "failed"]);
  assert.equal(t.status, "succeeded", t.error);
  assert.equal(t.review.pass, true);
  const ev = t.events;
  assert.ok(
    ev.findIndex((e) => e.kind === "step_start" && e.data.node === "s2") >
      ev.findIndex((e) => e.kind === "step_done" && e.data.node === "s1"),
  );
  const stats = ev.find((e) => e.kind === "statistics").data.stats;
  assert.equal(stats[0].columns.find((c) => c.column === "units").sum, 5);
  assert.equal(stats[0].columns.find((c) => c.column === "units").missing, 1);
  art = t.artifacts.find((x) => x.kind === "docx");
  assert.ok(art);
  const r = await a.raw("/artifacts/" + art.id + "/download");
  assert.equal(
    Buffer.from(await r.arrayBuffer())
      .subarray(0, 2)
      .toString(),
    "PK",
  );
  assert.equal((await b.raw("/artifacts/" + art.id + "/download")).status, 404);
  const html = t.artifacts.find((x) => x.kind === "html");
  assert.match(
    (await a.raw("/artifacts/" + html.id + "/preview")).headers.get(
      "content-security-policy",
    ),
    /sandbox allow-scripts/,
  );
});
test("监察不通过保留原稿、绝不自动返修或伪造成功", async () => {
  const id = (
    await a.request("/tasks", "POST", {
      request: "REVIEWFAIL 测试任务",
    })
  ).id;
  await until(a, id, ["waiting_approval"]);
  await a.request("/tasks/" + id + "/confirm", "POST", {
    approved: true,
  });
  const t = await until(a, id, ["needs_revision", "failed"]);
  assert.equal(t.status, "needs_revision");
  assert.equal(t.events.filter((e) => e.kind === "revision").length, 0);
  assert.ok(t.artifacts.some((x) => x.kind === "md"));
  const draft = await a.request("/tasks/" + id + "/export", "POST", {
    kind: "docx",
  });
  assert.match(draft.name, /待核验草稿/);
});
test("模型故障会失败、取消不会复活", async () => {
  let id = (
    await a.request("/tasks", "POST", {
      request: "MODELFAIL",
    })
  ).id;
  let t = await until(a, id, ["waiting_approval"]);
  assert.ok(t.events.some((e) => e.kind === "planning_fallback"));
  await a.request("/tasks/" + id + "/confirm", "POST", {
    approved: true,
  });
  t = await until(a, id, ["failed"]);
  assert.match(t.error, /503/);
  id = (
    await a.request("/tasks", "POST", {
      request: "SLOWCASE",
    })
  ).id;
  await a.request("/tasks/" + id + "/cancel", "POST");
  await wait(900);
  t = await a.request("/tasks/" + id);
  assert.equal(t.status, "cancelled");
  assert.equal(t.artifacts.length, 0);
});
test("插件只是登记、Skill上传不执行", async () => {
  const p = await a.request("/plugins", "POST", {
    name: "测试插件",
    url: "https://example.org",
  });
  assert.equal(p.state, "registered");
  assert.equal((await b.request("/plugins")).added.length, 0);
  const f = new FormData();
  f.append("file", new Blob(["malicious code is never executed"]), "SKILL.md");
  assert.equal((await a.raw("/skills", "POST", f)).status, 422);
});
test("短时接续码只能使用一次", async () => {
  const c = client();
  await c.request("/session");
  const code = (await a.request("/session/code", "POST")).code;
  await c.request("/session/resume", "POST", {
    code,
  });
  assert.equal((await c.request("/session")).profile.name, "测试空间A");
  assert.equal(
    (
      await b.raw("/session/resume", "POST", {
        code,
      })
    ).status,
    400,
  );
});
test("MCP传输鉴权与任务授权分层", async () => {
  async function mcp(body, auth = true) {
    const r = await fetch(base + "/mcp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(auth
          ? {
              Authorization: "Bearer test-mcp",
            }
          : {}),
      },
      body: JSON.stringify(body),
    });
    return {
      status: r.status,
      body: await r.json(),
    };
  }
  assert.equal(
    (
      await mcp(
        {
          id: 1,
          method: "tools/list",
        },
        false,
      )
    ).status,
    401,
  );
  let out = await mcp({
    id: 2,
    method: "tools/call",
    params: {
      name: "task_status",
      arguments: {
        capability: "wrong",
      },
    },
  });
  assert.equal(out.body.result.isError, true);
  const cap = await a.request("/tasks/" + task + "/capability", "POST");
  out = await mcp({
    id: 3,
    method: "tools/call",
    params: {
      name: "analyze_tables",
      arguments: {
        capability: cap.capability,
      },
    },
  });
  const data = JSON.parse(out.body.result.content[0].text);
  assert.equal(data[0].records, 3);
});
test("OpenHex官方SDK使用成员令牌，首次新建会话并续接", async () => {
  cfg = await a.request("/admin/config");
  cfg.channel = "openhex";
  cfg.openhex = {
    baseUrl: fixtureBase,
    authMode: "workspace",
    workspace: "test-workspace",
    apiKey: "workspace-fixture",
    agents: {
      researcher: "agent-fixture",
    },
  };
  await a.request("/admin/config", "PUT", cfg);
  const c = await a.request("/chats", "POST", {
    employee: "researcher",
  });
  let r = await a.raw("/chats/" + c.id + "/send", "POST", {
    text: "OpenHex SDK连接测试",
  });
  let s = await r.text();
  assert.match(s, /OpenHex SDK 协议夹具回复/);
  assert.match(s, /event: done/);
  const sent = received
    .filter((x) => x.url.endsWith("/conversations/send"))
    .at(-1);
  assert.equal(sent.body.newConversation, true);
  assert.equal(sent.authorization, "Bearer fixture-member-token");
  r = await a.raw("/chats/" + c.id + "/send", "POST", {
    text: "继续",
  });
  await r.text();
  const second = received
    .filter((x) => x.url.endsWith("/conversations/send"))
    .at(-1);
  assert.ok(second.body.conversationId);
  assert.equal(second.body.newConversation, undefined);
});
test("Excel与PPT实际导出、Word重读及内容验证", async () => {
  for (const kind of ["xlsx", "pptx"]) {
    const f = await a.request("/tasks/" + task + "/export", "POST", {
      kind,
    });
    const r = await a.raw("/artifacts/" + f.id + "/download");
    const buf = Buffer.from(await r.arrayBuffer());
    assert.equal(buf.subarray(0, 2).toString(), "PK");
    if (kind === "xlsx") {
      const { default: ExcelJS } = await import("exceljs");
      const w = new ExcelJS.Workbook();
      await w.xlsx.load(buf);
      assert.equal(
        w.getWorksheet("分析统计").getRow(2).getCell(1).value,
        "sales.csv",
      );
    }
  }
  const r = await a.raw("/artifacts/" + art.id + "/download");
  const form = new FormData();
  form.append("file", new Blob([await r.arrayBuffer()]), "roundtrip.docx");
  const f = await a.request("/files", "POST", form);
  for (let i = 0; i < 100 && f.status === "parsing"; i++) {
    await wait(100);
    Object.assign(
      f,
      (await a.request("/files")).find((x) => x.id === f.id),
    );
  }
  assert.equal(f.status, "ready");
  const hits = await a.request("/files/search", "POST", {
    query: "测试项目",
  });
  assert.ok(hits.some((h) => h.name === "roundtrip.docx"));
});
test(
  "混合编排中基座总监和监察独立调用，执行员工使用 SDK",
  {
    timeout: 12000,
  },
  async () => {
    cfg = await a.request("/admin/config");
    cfg.channel = "hybrid";
    cfg.routing.enabled = false;
    cfg.openhex.authMode = "personal";
    cfg.openhex.apiKey = "personal-fixture";
    cfg.openhex.workspace = "";
    cfg.providers = [
      {
        id: "director-base",
        label: "测试总监",
        baseUrl: fixtureBase,
        model: "director-model",
        apiKey: "shared-fixture-key",
      },
      {
        id: "review-base",
        label: "测试监察",
        baseUrl: fixtureBase,
        model: "review-model",
        apiKey: "",
        keyFrom: "director-base",
      },
    ];
    cfg.defaultProvider = "director-base";
    cfg.reviewProvider = "review-base";
    cfg.auxiliary.providerId = "";
    cfg.singleProviders = {};
    cfg.openhex.agents = {
      researcher: "agent-research",
      analyst: "agent-analysis",
      writer: "agent-writing",
    };
    await a.request("/admin/config", "PUT", cfg);
    const begin = received.length;
    const id = (
      await a.request("/tasks", "POST", {
        request: "验证混合分工，输出工作方案",
      })
    ).id;
    let t = await until(a, id, ["waiting_approval", "failed"]);
    assert.equal(t.status, "waiting_approval", t.error);
    await a.request("/tasks/" + id + "/confirm", "POST", {
      approved: true,
    });
    t = await until(a, id, ["succeeded", "failed"]);
    assert.equal(t.status, "succeeded", t.error);
    const calls = received.slice(begin),
      modelCalls = calls.filter((x) => x.url.endsWith("/chat/completions"));
    assert.ok(modelCalls.some((x) => x.body.model === "director-model"));
    assert.ok(modelCalls.some((x) => x.body.model === "review-model"));
    assert.equal(
      calls.filter((x) => x.url.endsWith("/conversations/send")).length,
      3,
    );
    assert.ok(
      calls
        .filter((x) => x.url.endsWith("/conversations/send"))
        .every((x) => x.authorization === "Bearer personal-fixture"),
    );
    assert.ok(!calls.some((x) => /whoami|sessions|members/.test(x.url)));
    assert.ok(
      modelCalls.every((x) => x.authorization === "Bearer shared-fixture-key"),
    );
    assert.ok(
      t.events.some(
        (e) => e.kind === "step_done" && e.data.channel === "openhex",
      ),
    );
    assert.equal(t.review.pass, true);
  },
);
test("单人 SDK 回复接受基座监察且监察故障不伪装通过", async () => {
  const chat = (
    await a.request("/chats", "POST", {
      employee: "researcher",
    })
  ).id;
  let r = await a.raw("/chats/" + chat + "/send", "POST", {
    text: "REVIEWFAIL 请检查",
  });
  let stream = await r.text();
  assert.match(stream, /event: review/);
  assert.match(stream, /"state":"warning"/);
  let detail = await a.request("/chats/" + chat);
  assert.equal(detail.messages.at(-1).review.state, "warning");
  cfg = await a.request("/admin/config");
  cfg.providers.find((p) => p.id === "review-base").baseUrl =
    fixtureBase + "/missing";
  await a.request("/admin/config", "PUT", cfg);
  r = await a.raw("/chats/" + chat + "/send", "POST", {
    text: "监察接口故障时保留回复",
  });
  stream = await r.text();
  assert.match(stream, /"state":"unavailable"/);
  assert.match(stream, /event: done/);
  detail = await a.request("/chats/" + chat);
  assert.equal(detail.messages.at(-1).review.state, "unavailable");
});
test("模型重排按 ID 保留密钥，拒绝重复与循环，测试状态持久化", async () => {
  cfg = await a.request("/admin/config");
  cfg.providers.find((p) => p.id === "review-base").baseUrl = fixtureBase;
  cfg.providers.reverse();
  await a.request("/admin/config", "PUT", cfg);
  let out = await a.request("/admin/test", "POST", {
    channel: "direct",
    providerId: "review-base",
  });
  assert.equal(out.ok, true);
  assert.equal(received.at(-1).authorization, "Bearer shared-fixture-key");
  assert.equal(
    (await a.request("/admin/model-status"))["review-base"].ok,
    true,
  );
  const duplicate = structuredClone(cfg);
  duplicate.providers.push({
    ...duplicate.providers[0],
  });
  assert.equal((await a.raw("/admin/config", "PUT", duplicate)).status, 400);
  const cyclic = structuredClone(cfg);
  cyclic.providers.find((p) => p.id === "director-base").keyFrom =
    "review-base";
  assert.equal((await a.raw("/admin/config", "PUT", cyclic)).status, 400);
  await a.request("/admin/config", "PUT", cfg);
  assert.deepEqual(await a.request("/admin/model-status"), {});
  assert.equal((await b.raw("/admin/model-status")).status, 403);
  assert.equal(
    (
      await b.raw("/admin/test", "POST", {
        providerId: "review-base",
      })
    ).status,
    403,
  );
});
test("个人 Key 直连默认工作区，访客会话分离且不签发工作区令牌", async () => {
  cfg = await a.request("/admin/config");
  cfg.openhex.authMode = "personal";
  cfg.openhex.apiKey = "personal-fixture";
  cfg.openhex.workspace = "ignored-in-personal-mode";
  await a.request("/admin/config", "PUT", cfg);
  const begin = received.length;
  const first = (
    await a.request("/chats", "POST", {
      employee: "researcher",
    })
  ).id;
  const second = (
    await b.request("/chats", "POST", {
      employee: "researcher",
    })
  ).id;
  await (
    await a.raw("/chats/" + first + "/send", "POST", {
      text: "访客A的独立对话",
    })
  ).text();
  await (
    await b.raw("/chats/" + second + "/send", "POST", {
      text: "访客B的独立对话",
    })
  ).text();
  const one = await a.request("/chats/" + first),
    two = await b.request("/chats/" + second);
  assert.equal(one.messages.at(-1).review.state, "clear");
  assert.equal(two.messages.at(-1).review.state, "clear");
  assert.equal((await b.raw("/chats/" + first)).status, 404);
  const calls = received.slice(begin),
    sends = calls.filter((x) => x.url.endsWith("/conversations/send"));
  assert.equal(sends.length, 2);
  assert.ok(
    sends.every(
      (x) =>
        x.authorization === "Bearer personal-fixture" &&
        x.body.newConversation === true &&
        !x.body.conversationId,
    ),
  );
  assert.ok(!calls.some((x) => /whoami|sessions|members/.test(x.url)));
  const streams = calls.filter((x) => x.url.includes("/stream"));
  assert.notEqual(streams[0].url, streams[1].url);
  await (
    await a.raw("/chats/" + first + "/send", "POST", {
      text: "继续我的对话",
    })
  ).text();
  assert.ok(
    received.filter((x) => x.url.endsWith("/conversations/send")).at(-1).body
      .conversationId,
  );
  const agents = await a.request("/admin/openhex/agents");
  assert.equal(agents.agents[0].id, "agent-research");
  assert.equal(received.at(-1).authorization, "Bearer personal-fixture");
  assert.equal((await b.raw("/admin/openhex/agents")).status, 403);
  const invalid = structuredClone(cfg);
  invalid.openhex.authMode = "auto";
  assert.equal((await a.raw("/admin/config", "PUT", invalid)).status, 400);
});
test("语音偏好持久化、数值边界与访客隔离", async () => {
  const p = await a.request("/profile", "PATCH", {
    speechRate: 1.4,
    speechVolume: 0.35,
    proactive: false,
  });
  assert.equal(p.speechRate, 1.4);
  assert.equal((await a.request("/session")).profile.speechVolume, 0.35);
  assert.notEqual((await b.request("/session")).profile.speechRate, 1.4);
  assert.equal(
    (
      await a.raw("/profile", "PATCH", {
        speechRate: "oops",
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await a.raw("/profile", "PATCH", {
        speechVolume: 2,
      })
    ).status,
    400,
  );
});
test("正文后监察与总监后续建议并行，均保留完整结果", async () => {
  await a.request("/profile", "PATCH", { proactive: true });
  const c = await a.request("/chats", "POST", { employee: "director" });
  const response = await a.raw("/chats/" + c.id + "/send", "POST", {
    text: "PARALLEL_CHECK 请帮助规划下一步",
  });
  const stream = await response.text();
  assert.equal(response.status, 200);
  assert.equal(followupOverlapped, true, "建议应在监察返回前开始");
  assert.match(stream, /event: done/);
  assert.match(stream, /核验通过/);
  assert.match(stream, /下一步该怎么验证结果/);
  await a.request("/profile", "PATCH", { proactive: false });
});
test("节点产出真实可查，跨空间访问被阻止", async () => {
  const out = await a.request("/tasks/" + task + "/nodes/s1");
  assert.ok(out.text);
  assert.equal(out.status, "done");
  assert.equal((await b.raw("/tasks/" + task + "/nodes/s1")).status, 404);
  assert.equal((await a.raw("/tasks/" + task + "/nodes/missing")).status, 404);
});
test("聊天文件生成、下载、中文重读与消息所有权", async () => {
  const c = await a.request("/chats", "POST", {
    employee: "director",
  });
  await (
    await a.raw("/chats/" + c.id + "/send", "POST", {
      text: "请整理中文文件测试",
    })
  ).text();
  const detail = await a.request("/chats/" + c.id),
    id = detail.messages.at(-1).id;
  const { PDFParse } = await import("pdf-parse");
  const { default: JSZip } = await import("jszip");
  for (const kind of ["docx", "pdf", "pptx"]) {
    const out = await a.request("/messages/" + id + "/export", "POST", {
      kind,
    });
    const r = await a.raw("/artifacts/" + out.id + "/download");
    assert.equal(r.status, 200);
    assert.match(r.headers.get("content-disposition"), /attachment/);
    const bytes = Buffer.from(await r.arrayBuffer());
    if (kind === "pdf") {
      assert.equal(bytes.subarray(0, 5).toString(), "%PDF-");
      const parser = new PDFParse({
        data: bytes,
      });
      try {
        assert.match((await parser.getText()).text, /测试项目/);
      } finally {
        await parser.destroy();
      }
    } else {
      const zip = await JSZip.loadAsync(bytes);
      assert.ok(
        zip.file(
          kind === "docx" ? "word/document.xml" : "ppt/slides/slide1.xml",
        ),
      );
    }
    assert.equal(
      (await b.raw("/artifacts/" + out.id + "/download")).status,
      404,
    );
  }
  assert.equal(
    (
      await b.raw("/messages/" + id + "/export", "POST", {
        kind: "docx",
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await a.raw("/messages/" + id + "/export", "POST", {
        kind: "exe",
      })
    ).status,
    400,
  );
});
test("上传拒绝空文件及伪装PDF，正常下载逐字节一致", async () => {
  for (const [name, data] of [
    ["empty.txt", ""],
    ["fake.pdf", "not a pdf"],
  ]) {
    const f = new FormData();
    f.append("file", new Blob([data]), name);
    assert.equal((await a.raw("/files", "POST", f)).status, 400);
  }
  const bytes = Buffer.from("中文上传下载核对\n数据不能丢失");
  const f = new FormData();
  f.append("file", new Blob([bytes]), "中文资料.txt");
  const out = await a.request("/files", "POST", f);
  assert.deepEqual(
    Buffer.from(
      await (await a.raw("/files/" + out.id + "/download")).arrayBuffer(),
    ),
    bytes,
  );
  assert.equal((await b.raw("/files/" + out.id + "/download")).status, 404);
});
test("员工逐项测试隔离结果，总监监察不需要Agent ID", async () => {
  const before = await a.request("/admin/config");
  const current = structuredClone(before);
  current.channel = "openhex";
  current.openhex.agents = {};
  current.singleProviders = {};
  await a.request("/admin/config", "PUT", current);
  for (const role of ["director", "supervisor"])
    assert.equal(
      (await a.request("/admin/test", "POST", { employeeTest: true, role })).ok,
      true,
    );
  const failed = await a.raw("/admin/test", "POST", {
    employeeTest: true,
    role: "researcher",
  });
  assert.equal(failed.status, 503);
  assert.match((await failed.json()).diagnosis, /尚未配置/);
  const status = await a.request("/admin/model-status");
  assert.equal(status["employee:director"].ok, true);
  assert.equal(status["employee:supervisor"].ok, true);
  assert.equal(status["employee:researcher"].ok, false);
  current.openhex.agents.researcher = "invalid-fixture";
  await a.request("/admin/config", "PUT", current);
  const rejected = await a.raw("/admin/test", "POST", {
    employeeTest: true,
    role: "researcher",
  });
  assert.equal(rejected.status, 400);
  assert.match(
    (await rejected.json()).diagnosis,
    /targetAgentIds.0: Invalid UUID/,
  );
  await a.request("/admin/config", "PUT", before);
});
test("配置文档上传预览不写入，确认一次生效，DOCX和JSON均可读取", async () => {
  const original = await a.request("/admin/config");
  const form = new FormData();
  form.append(
    "file",
    new Blob([
      JSON.stringify({
        openhex: {
          authMode: "personal",
          agents: { writer: "document-fixture" },
        },
      }),
    ]),
    "config.json",
  );
  const preview = await a.request("/admin/import-api/preview", "POST", form);
  assert.deepEqual(
    (await a.request("/admin/config")).openhex.agents,
    original.openhex.agents,
  );
  await a.request("/admin/import-api/apply", "POST", { token: preview.token });
  assert.equal(
    (await a.request("/admin/config")).openhex.agents.writer,
    "document-fixture",
  );
  assert.equal(
    (await a.raw("/admin/import-api/apply", "POST", { token: preview.token }))
      .status,
    409,
  );
  const { Document, Packer, Paragraph } = await import("docx");
  const bytes = await Packer.toBuffer(
    new Document({
      sections: [
        {
          children: [
            new Paragraph("Agent ID"),
            new Paragraph("writer: word-fixture"),
          ],
        },
      ],
    }),
  );
  const word = new FormData();
  word.append("file", new Blob([bytes]), "config.docx");
  const wordPreview = await a.request(
    "/admin/import-api/preview",
    "POST",
    word,
  );
  assert.ok(wordPreview.changes.some((x) => x.includes("writer")));
  const { default: PDFDocument } = await import("pdfkit");
  const pdfBytes = await new Promise((resolve) => {
    const pdf = new PDFDocument();
    const chunks = [];
    pdf.on("data", (x) => chunks.push(x));
    pdf.on("end", () => resolve(Buffer.concat(chunks)));
    pdf.text('{"openhex":{"authMode":"personal"}}');
    pdf.end();
  });
  const pdfForm = new FormData();
  pdfForm.append("file", new Blob([pdfBytes]), "config.pdf");
  assert.ok(
    (await a.request("/admin/import-api/preview", "POST", pdfForm)).token,
  );
  const invalidForm = new FormData();
  invalidForm.append("file", new Blob(["not a real document"]), "bad.docx");
  assert.equal(
    (await a.raw("/admin/import-api/preview", "POST", invalidForm)).status,
    400,
  );
  assert.equal(
    (await b.raw("/admin/import-api/preview", "POST", form)).status,
    403,
  );
  await a.request("/admin/config", "PUT", original);
});
