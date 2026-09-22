export function endpoint(value, label = "服务地址", field = "baseUrl") {
  const invalid = (message) => {
    throw Object.assign(Error(`${label} 无效：${message}`), {
      status: 400,
      field,
      label,
      code: "INVALID_CONFIG_URL",
    });
  };
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) invalid("不能为空");
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) invalid("缺少 https://");
  let u;
  try {
    u = new URL(text);
  } catch {
    invalid("请填写完整的 HTTPS 地址");
  }
  const local = process.env.ALLOW_LOCAL_API === "1";
  if (u.protocol !== "https:" && !(local && u.protocol === "http:"))
    invalid("必须使用 https://；本地接口需管理员显式设置 ALLOW_LOCAL_API=1");
  if (u.username || u.password || u.hash || u.search) invalid("不能含账号密码、查询参数或 # 片段");
  const host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (
    !local &&
    (/^(localhost$|127\.|10\.|192\.168\.|169\.254\.|0\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host) ||
      host === "::1" ||
      host === "::" ||
      /^f[cd][0-9a-f]{2}:|^fe[89ab][0-9a-f]:|^::ffff:/.test(host) ||
      /\.localhost$|\.local$/.test(host))
  )
    invalid("不允许内网地址；本地接口需显式授权");
  return u.href.replace(/\/$/, "");
}
export function validateConfigUrls(c) {
  const errors = [];
  const check = (value, label, field, required = true) => {
    if (!required && !value) return;
    try {
      endpoint(value, label, field);
    } catch (e) {
      errors.push({
        field,
        label,
        message: e.message,
      });
    }
  };
  for (const [i, p] of (c.providers || []).entries())
    check(p.baseUrl, `${p.label || p.id || "模型 " + (i + 1)} · Base URL`, `providers.${p.id || i}.baseUrl`);
  check(c.openhex?.baseUrl, "OpenHex API 地址", "openhex.baseUrl");
  check(c.speech?.baseUrl, "豆包语音 ASR / 默认 Base URL", "speech.baseUrl", false);
  check(c.speech?.ttsBaseUrl, "豆包语音 TTS 独立 Base URL", "speech.ttsBaseUrl", false);
  if (c.weather?.enabled || c.weather?.baseUrl)
    check(c.weather?.baseUrl, "和风天气 API Host", "weather.baseUrl");
  if (c.weather?.enabled) {
    for (const [key, label, max] of [
      ["latitude", "纬度", 90],
      ["longitude", "经度", 180],
    ]) {
      const v = c.weather[key];
      if (v === "" || v == null || !Number.isFinite(Number(v)) || Math.abs(Number(v)) > max)
        errors.push({
          field: `weather.${key}`,
          label: `和风天气${label}`,
          message: `和风天气${label}无效：应为 -${max} 到 ${max} 的数字`,
        });
    }
  }
  if (errors.length)
    throw Object.assign(Error(errors.map((x) => x.message).join("\n")), {
      status: 400,
      code: "CONFIG_VALIDATION",
      errors,
      field: errors[0].field,
    });
  return c;
}
export function boundedTransport(t = {}) {
  const integer = (v, d, lo, hi) =>
    Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Math.round(Number(v)))) : d;
  return {
    uploadTimeoutMs: integer(t.uploadTimeoutMs, 120000, 10000, 180000),
    idleTimeoutMs: integer(t.idleTimeoutMs, 90000, 15000, 300000),
    totalTimeoutMs: integer(t.totalTimeoutMs, 360000, 30000, 600000),
    teamRemoteTimeoutMs: integer(t.teamRemoteTimeoutMs, 120000, 15000, 300000),
  };
}
