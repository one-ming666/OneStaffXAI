import { MODEL_PRESETS, resolvedProvider } from "./presets.js";
import { validateConfigUrls, boundedTransport } from "./validation.js";
const invalid = (message, field) => {
  throw Object.assign(Error(message), {
    status: 400,
    code: "CONFIG_VALIDATION",
    field,
  });
};
export function validateConfiguration(c) {
  if (!["openhex", "direct", "hybrid"].includes(c.channel))
    invalid("协作方式无效", "channel");
  if (
    !Array.isArray(c.providers) ||
    !c.providers.length ||
    c.providers.length > 30
  )
    invalid("模型档案数量应为 1–30", "providers");
  const ids = new Set();
  for (const p of c.providers) {
    if (!p || !/^[a-z0-9_-]{1,40}$/i.test(p.id))
      invalid("模型档案 ID 无效", "providers");
    if (ids.has(p.id)) invalid(`模型档案 ID 重复：${p.id}`, "providers");
    ids.add(p.id);
    if (typeof p.label !== "string" || !p.label.trim() || p.label.length > 80)
      invalid("模型显示名称应为 1–80 字", `providers.${p.id}.label`);
    if (typeof p.model !== "string" || p.model.length > 200)
      invalid(
        `${p.label}：实际模型 ID 必须为文本且不超过 200 字`,
        `providers.${p.id}.model`,
      );
    if (!["auto", "chat", "responses", undefined].includes(p.protocol))
      invalid(`${p.label}：接口协议无效`, `providers.${p.id}.protocol`);
    if (typeof p.apiKey !== "string")
      invalid(`${p.label}：API Key 应为文本`, `providers.${p.id}.apiKey`);
    try {
      resolvedProvider(c, p.id);
    } catch (e) {
      invalid(`${p.label}：${e.message}`, `providers.${p.id}.keyFrom`);
    }
  }
  for (const id of [
    c.defaultProvider,
    c.reviewProvider,
    c.auxiliary?.providerId,
    ...Object.values(c.singleProviders || {}),
    ...(c.routing?.enabled
      ? [c.routing.chat, c.routing.code, c.routing.reasoning]
      : []),
  ].filter(Boolean))
    if (!ids.has(id)) invalid(`所选模型档案不存在：${id}`, "defaultProvider");
  if (!c.openhex || !["personal", "workspace"].includes(c.openhex.authMode))
    invalid("OpenHex 凭据类型无效", "openhex.authMode");
  for (const [role, id] of Object.entries(c.openhex.agents || {}))
    if (
      !["director", "supervisor"].includes(role) &&
      (typeof id !== "string" || id.length > 200 || /https?:|\s/.test(id))
    )
      invalid(
        `OpenHex ${role} Agent ID 无效：请填写真实 ID，不是链接`,
        `openhex.agents.${role}`,
      );
  if (c.openhex.baseUrl?.replace(/\/$/, "") === "https://api.openhex.tech")
    for (const [role, id] of Object.entries(c.openhex.agents || {}))
      if (
        id &&
        !["director", "supervisor"].includes(role) &&
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          id,
        )
      )
        invalid(
          `OpenHex ${role}：Agent ID应为 /console/ 后的完整UUID，请从“读取我的Agent列表”选择。`,
          `openhex.agents.${role}`,
        );
  if (c.speech?.protocol && !["volc", "compatible"].includes(c.speech.protocol))
    invalid("豆包语音协议无效", "speech.protocol");
  validateConfigUrls(c);
  c.transport = boundedTransport(c.transport);
  c.maxParallel = 2;
  return c;
}
export function parseApiDocument(text, previous) {
  if (typeof text !== "string" || text.length > 65536)
    invalid("请选择 64 KB 以内的 UTF-8 API 文本文件", "import");
  if ((text.match(/\uFFFD/g) || []).length > 2)
    invalid("文件不是有效 UTF-8 文本，请在记事本另存为 UTF-8 后导入", "import");
  if (text.trimStart().startsWith("{")) {
    let patch;
    try {
      patch = JSON.parse(text);
    } catch {
      invalid("JSON格式无效，请检查引号和逗号。", "import");
    }
    if (
      !Object.keys(patch).some((key) =>
        [
          "openhex",
          "providers",
          "channel",
          "defaultProvider",
          "reviewProvider",
          "speech",
          "weather",
          "search",
          "routing",
          "singleProviders",
          "auxiliary",
          "transport",
        ].includes(key),
      )
    )
      invalid("JSON中没有可识别的配置字段，请使用配置对象格式。", "import");
    if (
      patch.openhex !== undefined &&
      (!patch.openhex ||
        typeof patch.openhex !== "object" ||
        Array.isArray(patch.openhex))
    )
      invalid("openhex必须是配置对象。", "import");
    const c = structuredClone(previous);
    for (const key of [
      "channel",
      "providers",
      "defaultProvider",
      "reviewProvider",
      "routing",
      "singleProviders",
      "speech",
      "weather",
      "search",
      "auxiliary",
      "transport",
    ]) {
      if (patch[key] !== undefined) c[key] = patch[key];
    }
    if (patch.openhex)
      c.openhex = {
        ...c.openhex,
        ...patch.openhex,
        entrypoints: c.openhex.entrypoints,
      };
    for (const role of ["director", "supervisor"])
      delete c.openhex.agents?.[role];
    return {
      config: validateConfiguration(c),
      changes: ["导入JSON中明确提供的模型、员工映射及服务配置"],
      warnings: [
        "总监与监察者使用基座模型，不导入其Agent ID。确认后保存，连接状态仍需测试。",
      ],
    };
  }
  const c = structuredClone(previous),
    lines = text
      .replace(/^\uFEFF/, "")
      .split(/\r?\n/)
      .map((x) => x.trim())
      .filter(Boolean),
    changes = [],
    warnings = [];
  const headings = [
    "豆包 · 拟人交流",
    "豆包 · 编程与工具规划",
    "豆包 · 总监深度推理",
    "DeepSeek · 快速备选",
    "DeepSeek · 独立监察",
    "OpenHex API 地址",
    "OpenHex API Key",
    "Agent ID",
    "Tavily API Key",
    "和风天气",
    "豆包语音识别与朗读",
  ];
  const section = (title) => {
    const start = lines.indexOf(title);
    if (start < 0) return [];
    let end = start + 1;
    while (end < lines.length && !headings.includes(lines[end])) end++;
    return lines.slice(start + 1, end);
  };
  const after = (arr, label) => {
    const i = arr.indexOf(label);
    return i >= 0 ? arr[i + 1] || "" : "";
  };
  let recognized = 0;
  for (const preset of MODEL_PRESETS) {
    const arr = section(preset.label);
    if (!arr.length) continue;
    recognized++;
    let p = c.providers.find((x) => x.id === preset.id);
    if (!p) {
      p = structuredClone(preset);
      c.providers.push(p);
    }
    const model = arr.find(
      (x) => !/^(实际模型ID|实际模型 ID|API|https?:)/i.test(x),
    );
    if (model) {
      p.model = model;
      changes.push(`${p.label}：更新实际模型 ID`);
    }
    const base = arr.find((x) => /^https?:\/\//.test(x));
    if (base) p.baseUrl = base;
    const key = after(arr, "API");
    if (key) {
      p.apiKey = key;
      p.keyFrom = "";
      changes.push(`${p.label}：导入密钥（后端加密）`);
    }
    if (preset.id.startsWith("doubao")) p.protocol = "auto";
  }
  if (lines.includes("豆包 · 拟人交流")) {
    for (const id of ["doubao-turbo", "doubao-pro"]) {
      const p = c.providers.find((x) => x.id === id);
      if (p && !after(section(p.label), "API")) {
        p.keyFrom = "doubao-character";
        p.apiKey = "";
      }
    }
  }
  if (lines.includes("DeepSeek · 快速备选")) {
    const p = c.providers.find((x) => x.id === "deepseek-pro");
    if (p && !after(section(p.label), "API")) {
      p.keyFrom = "deepseek-flash";
      p.apiKey = "";
    }
  }
  const ohBase = section("OpenHex API 地址")[0],
    ohKey = section("OpenHex API Key")[0];
  if (ohBase || ohKey) {
    recognized++;
    if (ohBase) c.openhex.baseUrl = ohBase;
    if (ohKey) c.openhex.apiKey = ohKey;
    c.openhex.authMode = "personal";
    c.openhex.workspace = "";
    changes.push("OpenHex：个人 API Key / 默认工作区");
  }
  if (lines.includes("Agent ID") && !section("Agent ID").length)
    warnings.push(
      "文档中的 Agent ID 留空，未创建或猜测员工映射。团队会使用总监 + 监察者；配置员工后再启用其 OpenHex 能力。",
    );
  if (section("Agent ID").length)
    for (const line of section("Agent ID")) {
      const match = line.match(
        /^(researcher|analyst|writer|designer|coder|研究员?|分析师?|文案|设计师?|程序员|编程)\s*[:：=]\s*(\S+)$/i,
      );
      if (!match) {
        warnings.push(
          "有未识别的员工映射行；请使用 岗位ID: Agent UUID 格式，未自动分配。",
        );
        continue;
      }
      const roles = {
        研究: "researcher",
        研究员: "researcher",
        分析: "analyst",
        分析师: "analyst",
        文案: "writer",
        设计: "designer",
        设计师: "designer",
        程序员: "coder",
        编程: "coder",
      };
      const role = roles[match[1]] || match[1].toLowerCase();
      c.openhex.agents[role] = match[2];
      recognized++;
      changes.push(`员工 ${role}：导入Agent ID`);
    }
  const tavily = section("Tavily API Key")[0];
  if (tavily) {
    recognized++;
    c.search.apiKey = tavily;
    changes.push("Tavily：更新联网搜索密钥");
  }
  const weather = section("和风天气");
  if (weather.length) {
    recognized++;
    const h = after(weather, "控制台分配的专属 API Host"),
      k = after(weather, "API Key");
    if (h) c.weather.baseUrl = h;
    if (k) c.weather.apiKey = k;
    const lat = weather.find((x) => x.startsWith("纬度")),
      lon = weather.find((x) => x.startsWith("经度"));
    if (lat) c.weather.latitude = lat.replace(/^纬度\s*[:：]?\s*/, "");
    if (lon) c.weather.longitude = lon.replace(/^经度\s*[:：]?\s*/, "");
    if (weather.includes("北京")) c.weather.city = "北京";
    c.weather.enabled = !!(c.weather.apiKey && c.weather.baseUrl);
    changes.push("和风天气：专属 Host、密钥和城市坐标");
  }
  const voice = section("豆包语音识别与朗读");
  if (voice.length) {
    recognized++;
    for (const [label, key] of [
      ["ASR / 默认语音 Base URL", "baseUrl"],
      ["语音api", "apiKey"],
      ["ASR 转写模型 ID", "asrModel"],
      ["ASR Resource ID", "asrResource"],
      ["TTS 合成模型 ID", "ttsModel"],
      ["TTS Resource ID", "ttsResource"],
      ["实际音色 ID", "voice"],
    ]) {
      const value = after(voice, label);
      if (value) c.speech[key] = value;
    }
    c.speech.protocol = "volc";
    c.speech.ttsBaseUrl = "";
    c.speech.ttsApiKey = "";
    changes.push("豆包语音：ASR、TTS、资源 ID、音色（与文本密钥分开）");
  }
  if (!recognized)
    invalid(
      "没有识别到 API 文档中的配置分区，请使用本工程支持的 API.txt 格式",
      "import",
    );
  warnings.push(
    "文档未指定豆包文本接口协议：采用自动模式，只有接口明确不支持时才切换，不会因密钥错误反复请求。",
  );
  const overrides = [
    "OPENHEX_API_KEY",
    "OPENHEX_WORKSPACE_KEY",
    "OPENHEX_BASE_URL",
    "OPENHEX_AUTH_MODE",
    "OPENHEX_WORKSPACE_SLUG",
    "OPENHEX_AGENT_ID",
  ].filter((k) => process.env[k]);
  if (overrides.length)
    warnings.push(
      "检测到环境变量覆盖：" +
        overrides.join("、") +
        "。这些变量优先于网页配置，修改 .env 后需重启；此处不显示变量值。",
    );
  warnings.push(
    "导入不等于连接成功。保存后逐项测试模型、天气、语音和 OpenHex 账户权限。",
  );
  return {
    config: validateConfiguration(c),
    changes,
    warnings,
  };
}
