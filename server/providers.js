import { colleagueContract } from "./behavior.js";
import { resolvedProvider, roleChannel } from "./presets.js";
import fs from "node:fs";
import {
  config,
  fail,
  hash,
  one,
  run,
  seal,
  unseal,
  safeError,
} from "./core.js";
import { streamOpenhex } from "./transport.js";
export function endpoint(value) {
  let u;
  try {
    u = new URL(value);
  } catch {
    fail("服务地址无效，请填写完整的 HTTPS Base URL");
  }
  const local = process.env.ALLOW_LOCAL_API === "1";
  if (u.protocol !== "https:" && !(local && u.protocol === "http:"))
    fail(
      "服务地址必须使用 HTTPS；本地模型需由管理员明确设置 ALLOW_LOCAL_API=1",
    );
  if (u.username || u.password || u.hash || u.search)
    fail("Base URL 不能包含凭据、查询参数或片段");
  if (
    !local &&
    /^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.|\[?::1|172\.(1[6-9]|2\d|3[01])\.)/i.test(
      u.hostname,
    )
  )
    fail("不允许访问内网服务地址");
  return u.href.replace(/\/$/, "");
}
const tokenCache = new Map(),
  pendingTokens = new Map();
async function SDK() {
  return import("@openhex-ai/agent-sdk");
}
export function bindingFor(role, agentOverride) {
  const c = config().openhex;
  return hash(
    [
      c.baseUrl,
      c.authMode,
      c.authMode === "workspace" ? c.workspace : "",
      hash(c.apiKey || ""),
      agentOverride || c.agents?.[role] || "",
    ].join("|"),
  );
}
export async function member(space, force = false) {
  const c = config().openhex;
  if (!c.apiKey) fail("请配置 OpenHex API Key", 503);
  if (c.authMode === "personal") return c.apiKey;
  if (c.authMode !== "workspace") fail("OpenHex 凭据类型无效", 400);
  const key = hash(c.apiKey + c.baseUrl + c.workspace + space),
    old = tokenCache.get(key);
  if (
    !force &&
    old &&
    old.expires >
      Date.now() + Math.min(1500000, config().transport.totalTimeoutMs + 60000)
  )
    return old.token;
  if (pendingTokens.has(key)) return pendingTokens.get(key);
  const request = (async () => {
    const { OpenhexClient } = await SDK();
    const admin = new OpenhexClient({
      apiKey: c.apiKey,
      baseUrl: endpoint(c.baseUrl),
      timeoutMs: 30000,
    });
    const workspace = c.workspace || (await admin.workspaces.whoami()).slug;
    if (!workspace) fail("工作区查询未返回 slug，请核对工作区 Key", 502);
    const session = await admin.workspace(workspace).startVisitorSession({
      sp_user_ref: space,
      ttl_seconds: 1800,
    });
    if (!session.token) fail("工作区未返回有效会话令牌", 502);
    tokenCache.set(key, {
      token: session.token,
      expires: Math.min(
        Date.now() + 1800000,
        Date.parse(session.expires_at) || Infinity,
      ),
    });
    return session.token;
  })();
  pendingTokens.set(key, request);
  try {
    return await request;
  } finally {
    pendingTokens.delete(key);
  }
}
export async function remoteClient(space, role = "director", agentOverride) {
  const sdk = await SDK(),
    c = config(),
    agentId = agentOverride || c.openhex.agents?.[role];
  if (!agentId) fail(`尚未配置 ${role} 的 Agent ID`, 503);
  if (
    endpoint(c.openhex.baseUrl) === "https://api.openhex.tech" &&
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      agentId,
    )
  )
    fail(
      `${role} 的 Agent ID格式错误：需要 /console/ 后的完整UUID；保存正确ID后再测试。`,
      400,
    );
  return {
    sdk,
    agentId,
    client: new sdk.OpenhexClient({
      apiKey: await member(space),
      agentId,
      baseUrl: endpoint(c.openhex.baseUrl),
      timeoutMs: c.transport.uploadTimeoutMs,
    }),
  };
}
export function extractJson(text) {
  const s = text
    .replace(/^```(?:json)?\s*/, "")
    .replace(/\s*```$/, "")
    .trim();
  try {
    return JSON.parse(s);
  } catch {}
  const a = s.indexOf("{"),
    b = s.lastIndexOf("}");
  if (a >= 0 && b > a) {
    try {
      return JSON.parse(s.slice(a, b + 1));
    } catch {}
  }
  fail("模型没有返回有效结构，未继续执行，请检查模型或 Agent 指令", 502);
}
export function providerFor(role = "director", providerId) {
  const c = config();
  return resolvedProvider(
    c,
    providerId ||
      (role === "supervisor" && c.reviewProvider
        ? c.reviewProvider
        : c.defaultProvider),
  );
}
export function readiness(channel, role = "director", providerId) {
  channel = roleChannel(channel, role);
  const c = config();
  if (channel === "openhex") {
    if (!c.openhex.apiKey || !c.openhex.agents?.[role])
      fail(`请配置 OpenHex API Key 和 ${role} 的 Agent ID`, 503);
  } else {
    const p = providerFor(role, providerId);
    if (!p?.apiKey || !p?.model)
      fail("请填写兼容模型的 API Key、准确的模型 ID 和 Base URL", 503);
  }
}
async function openhex(opts) {
  const { sdk, agentId, client } = await remoteClient(opts.space, opts.role);
  const fingerprint = bindingFor(opts.role),
    cacheKey = (f) =>
      hash(
        [
          fingerprint,
          opts.space,
          agentId,
          opts.uploadScope || opts.remote || "new",
          f.id,
          f.sha256 || "",
        ].join("|"),
      );
  return streamOpenhex({
    ...opts,
    sdk,
    client,
    agentId,
    files: opts.files || opts.images || [],
    idleTimeoutMs: config().transport.idleTimeoutMs,
    cacheGet: async (f) => {
      const old = one(
        "SELECT part FROM remote_uploads WHERE cache_key=? AND expires>?",
        cacheKey(f),
        Date.now(),
      );
      return old ? JSON.parse(unseal(old.part)) : null;
    },
    cachePut: async (f, part) =>
      run(
        "INSERT OR REPLACE INTO remote_uploads VALUES(?,?,?,?,?)",
        cacheKey(f),
        opts.space,
        f.id,
        seal(JSON.stringify(part)),
        Date.now() + 1800000,
      ),
  });
}
export async function compatible({
  role,
  messages,
  signal,
  onToken,
  images = [],
  providerId,
  maxTokens,
  temperature,
}) {
  readiness("direct", role, providerId);
  const p = providerFor(role, providerId),
    msgs = messages.map((x) => ({
      ...x,
    }));
  if (images.length) {
    const i = msgs.findLastIndex((m) => m.role === "user");
    if (i >= 0)
      msgs[i].content = [
        {
          type: "text",
          text: msgs[i].content,
        },
        ...images.map((f) => ({
          type: "image_url",
          image_url: {
            url: `data:${f.mime};base64,${fs.readFileSync(f.path).toString("base64")}`,
          },
        })),
      ];
  }
  const responses = p.protocol === "responses";
  const base = endpoint(p.baseUrl).replace(
    /\/(?:responses|chat\/completions)$/,
    "",
  );
  const payload = responses
    ? {
        model: p.model,
        input: msgs.map((m) => ({
          ...m,
          content: Array.isArray(m.content)
            ? m.content.map((x) =>
                x.type === "image_url"
                  ? {
                      type: "input_image",
                      image_url: x.image_url.url,
                    }
                  : {
                      type: "input_text",
                      text: x.text,
                    },
              )
            : m.content,
        })),
        stream: !!onToken,
        max_output_tokens: Math.min(
          Number(maxTokens || p.maxTokens) || 6000,
          12000,
        ),
      }
    : {
        model: p.model,
        messages: msgs,
        stream: !!onToken,
        max_tokens: Math.min(Number(maxTokens || p.maxTokens) || 6000, 12000),
      };
  if (temperature !== undefined || p.temperature !== undefined)
    payload.temperature = Number(temperature ?? p.temperature);
  const response = await fetch(
    base + (responses ? "/responses" : "/chat/completions"),
    {
      method: "POST",
      redirect: "error",
      headers: {
        Authorization: `Bearer ${p.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal,
    },
  );
  if (!response.ok) {
    let detail = "";
    try {
      const j = await response.json();
      detail = safeError(j.error?.message || j.message || "").slice(0, 250);
    } catch {}
    throw Object.assign(
      Error(
        `模型服务返回 ${response.status}；请核对模型 ID、Key、余额及接口协议${detail ? " · " + detail : ""}`,
      ),
      {
        status: 502,
        upstreamStatus: response.status,
      },
    );
  }
  let text = "",
    finishReason = null;
  if (onToken) {
    const reader = response.body.getReader(),
      dec = new TextDecoder();
    let buffer = "",
      finished = false;
    try {
      while (true) {
        const { value, done } = await reader.read();
        buffer += dec.decode(value || new Uint8Array(), {
          stream: !done,
        });
        if (done && buffer && !buffer.endsWith("\n")) buffer += "\n";
        let i;
        while ((i = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, i).trim();
          buffer = buffer.slice(i + 1);
          if (!line.startsWith("data:")) continue;
          const raw = line.slice(5).trim();
          if (raw === "[DONE]") {
            finished = true;
            continue;
          }
          let j;
          try {
            j = JSON.parse(raw);
          } catch {
            continue;
          }
          if (
            j.error ||
            ["response.failed", "response.incomplete", "error"].includes(j.type)
          )
            throw Error("模型流返回错误或输出不完整");
          if (j.type === "response.completed") {
            finished = true;
            finishReason = "stop";
          }
          const t = responses
            ? j.type === "response.output_text.delta"
              ? j.delta
              : ""
            : j.choices?.[0]?.delta?.content || "";
          if (typeof t === "string" && t) {
            text += t;
            onToken(t);
          }
          if (j.choices?.[0]?.finish_reason) {
            finished = true;
            finishReason = j.choices[0].finish_reason;
          }
        }
        if (done) break;
      }
      if (!finished) throw Error("模型输出流意外中断");
    } finally {
      reader.releaseLock();
    }
  } else {
    const j = await response.json();
    if (j.error || ["failed", "incomplete"].includes(j.status))
      throw Error("模型返回失败或输出不完整");
    text = responses
      ? j.output_text ||
        (j.output || [])
          .flatMap((x) => x.content || [])
          .filter((x) => x.type === "output_text")
          .map((x) => x.text)
          .join("")
      : j.choices?.[0]?.message?.content || "";
    finishReason = j.choices?.[0]?.finish_reason;
  }
  if (finishReason === "length")
    throw Error(
      "模型输出达到长度上限，未作为完整结果保存。请缩短问题或将文档分段后重试；原消息仍保留。",
    );
  if (finishReason === "content_filter")
    throw Error("模型服务中止了这段输出，未作为完整结果保存。");
  if (!String(text).trim()) throw Error("模型未返回有效文本");
  return {
    text,
    channel: `direct:${p.id}`,
    remote: null,
  };
}
export async function infer(opts) {
  opts = {
    ...opts,
    styleInstruction: opts.styleInstruction || colleagueContract,
    messages: (opts.messages || []).map((m, i) =>
      i === 0 && m.role === "system"
        ? {
            ...m,
            content: m.content + "\n" + colleagueContract,
          }
        : m,
    ),
    inputText: opts.inputText
      ? colleagueContract + "\n\n用户任务与资料：\n" + opts.inputText
      : opts.inputText,
  };
  const c = config(),
    channel = roleChannel(opts.channel || c.channel, opts.role || "director");
  const signal = AbortSignal.any([
    ...(opts.signal ? [opts.signal] : []),
    AbortSignal.timeout(
      Math.min(Number(opts.timeoutMs) || c.transport.totalTimeoutMs, 900000),
    ),
  ]);
  let started = false;
  const params = {
    ...opts,
    signal,
    onToken: opts.onToken
      ? (t) => {
          started = true;
          opts.onToken(t);
        }
      : undefined,
  };
  try {
    return await (channel === "openhex" ? openhex(params) : compatible(params));
  } catch (e) {
    const transient = e.upstreamStatus >= 500 || e.status >= 500;
    if (
      channel === "openhex" &&
      c.fallback &&
      transient &&
      !e.accepted &&
      !started &&
      !opts.files?.length &&
      !signal.aborted &&
      opts.allowFallback !== false
    ) {
      opts.onEvent?.({
        type: "fallback",
        message:
          "OpenHex 在消息受理前失败；本轮改用自建模型，不计为 OpenHex 成功",
      });
      return compatible(params);
    }
    throw e;
  }
}
export async function searchWeb(query, signal) {
  const c = config().search;
  if (!c.apiKey)
    fail("联网搜索未配置，请关闭本轮联网开关或填写 Tavily Key", 503);
  const response = await fetch(
    (process.env.NODE_ENV === "test" && process.env.TEST_SEARCH_URL) ||
      "https://api.tavily.com/search",
    {
      method: "POST",
      redirect: "error",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${c.apiKey}`,
      },
      body: JSON.stringify({
        query: String(query).slice(0, 2000),
        max_results: Math.min(8, Math.max(1, Number(c.maxResults) || 5)),
        include_answer: false,
        search_depth: "basic",
      }),
      signal: AbortSignal.any([
        ...(signal ? [signal] : []),
        AbortSignal.timeout(30000),
      ]),
    },
  );
  if (!response.ok)
    fail(`联网搜索返回 ${response.status}，本轮未将搜索结果交给 Agent`, 502);
  const j = await response.json();
  return (j.results || [])
    .filter((x) => /^https?:\/\//.test(x.url))
    .map((x) => ({
      title: x.title,
      url: x.url,
      content: String(x.content || "").slice(0, 2200),
    }));
}
export async function auxiliary(
  messages,
  { maxTokens = 1600, timeoutMs = 90000, signal, temperature = 0.2 } = {},
) {
  return infer({
    role: "director",
    channel: "direct",
    allowFallback: false,
    providerId: config().auxiliary.providerId || undefined,
    messages,
    maxTokens,
    timeoutMs,
    signal,
    temperature,
  });
}
export async function listOpenhexAgents() {
  const c = config().openhex;
  if (!c.apiKey) fail("请先保存 OpenHex API Key", 503);
  let data;
  if (c.authMode === "workspace") {
    const { OpenhexClient } = await SDK();
    const admin = new OpenhexClient({
      apiKey: c.apiKey,
      baseUrl: endpoint(c.baseUrl),
      timeoutMs: 30000,
    });
    const slug = c.workspace || (await admin.workspaces.whoami()).slug;
    if (!slug) fail("工作区查询未返回 slug", 502);
    data = await admin.workspace(slug).listAgents();
  } else {
    const response = await fetch(endpoint(c.baseUrl) + "/api/v2/agents", {
      headers: {
        Authorization: `Bearer ${c.apiKey}`,
      },
      redirect: "error",
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) {
      let body;
      try {
        body = await response.json();
      } catch {}
      throw Object.assign(
        Error(
          typeof body?.detail === "string"
            ? body.detail
            : `OpenHex返回HTTP ${response.status}`,
        ),
        { status: response.status, body },
      );
    }
    data = await response.json();
  }
  const rows = Array.isArray(data)
    ? data
    : data.agents || data.items || data.data;
  if (!Array.isArray(rows))
    fail("OpenHex Agent 列表格式无法识别，请手动填写 Agent ID", 502);
  return {
    authMode: c.authMode,
    agents: rows
      .filter((x) => x && typeof x.id === "string")
      .slice(0, 500)
      .map((x) => ({
        id: x.id,
        name: String(x.name || x.id).slice(0, 120),
      })),
  };
}
