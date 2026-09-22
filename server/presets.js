export const MODEL_PRESETS = [
  {
    id: "doubao-character",
    label: "豆包 · 拟人交流",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    protocol: "auto",
    model: "",
    apiKey: "",
    keyFrom: "",
    capabilities: ["chat"],
  },
  {
    id: "doubao-turbo",
    label: "豆包 · 编程与工具规划",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    protocol: "auto",
    model: "",
    apiKey: "",
    keyFrom: "doubao-character",
    capabilities: ["code", "tools"],
  },
  {
    id: "doubao-pro",
    label: "豆包 · 总监深度推理",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    protocol: "auto",
    model: "",
    apiKey: "",
    keyFrom: "doubao-character",
    capabilities: ["reasoning", "long"],
  },
  {
    id: "deepseek-flash",
    label: "DeepSeek · 快速备选",
    baseUrl: "https://api.deepseek.com",
    protocol: "chat",
    model: "",
    apiKey: "",
    keyFrom: "",
    capabilities: ["chat", "code"],
  },
  {
    id: "deepseek-pro",
    label: "DeepSeek · 独立监察",
    baseUrl: "https://api.deepseek.com",
    protocol: "chat",
    model: "",
    apiKey: "",
    keyFrom: "deepseek-flash",
    capabilities: ["reasoning", "review"],
  },
];
export function resolvedProvider(c, id) {
  const source = c.providers.find((p) => p.id === id);
  if (!source) return null;
  let p = source;
  const visited = new Set();
  while (p.keyFrom) {
    if (visited.has(p.id))
      throw Object.assign(Error("模型密钥引用形成循环"), {
        status: 400,
      });
    visited.add(p.id);
    p = c.providers.find((x) => x.id === p.keyFrom);
    if (!p)
      throw Object.assign(Error("模型密钥来源不存在"), {
        status: 400,
      });
  }
  return {
    ...source,
    apiKey: p.apiKey || "",
  };
}
export function classifyTask(text) {
  if (/长篇|全文|深度推理|复杂方案|上万字|完整架构|长文|复杂分析/.test(text)) return "reasoning";
  if (/代码|重构|前端|调试|报错|函数|接口|工具|编程/.test(text)) return "code";
  return "chat";
}
export function routeProfile(c, text) {
  return c.routing?.enabled ? c.routing[classifyTask(text)] || c.defaultProvider : c.defaultProvider;
}
export function roleChannel(channel, role) {
  if (["director", "supervisor"].includes(role)) return "direct";
  return channel === "hybrid" ? "openhex" : channel;
}
