export function connectionDiagnosis(error, scrub = String) {
  const status = Number(error.upstreamStatus || error.status);
  const hints = {
    400: "请求参数未通过平台校验，请检查下方字段；OpenHex Agent ID 应为控制台中的 UUID。",
    422: "请求字段格式不符合平台要求，请检查下方字段及 Agent ID。",
    401: "凭据缺失、过期或类型不匹配，请核对个人 Key / 工作区 Key 的选择并保存。",
    402: "服务账户余额或额度不足，请到服务商控制台核对。",
    403: "当前凭据没有调用权限，请核对账号、Agent / 模型授权和工作区。",
    404: "接口或资源不可见，请核对 API 地址、模型 ID / Agent ID 及发布状态。",
    429: "调用频率或额度受限，请稍后重试并检查服务商配额。",
  };
  const raw = [error.body?.issues, error.body?.errors, error.body?.detail].find(
    Array.isArray,
  );
  const fields = Array.isArray(raw)
    ? raw
        .slice(0, 8)
        .map((x) => {
          const field = Array.isArray(x?.loc)
            ? x.loc.join(".")
            : Array.isArray(x?.path)
              ? x.path.join(".")
              : x?.field;
          return [field, x?.msg || x?.message || x?.type]
            .filter((x) => typeof x === "string")
            .map(scrub)
            .join(": ");
        })
        .filter(Boolean)
    : [];
  const reason = scrub(error.message || "调用失败");
  const localConfig = /^(请配置|请填写|请先|尚未配置|.*Agent ID格式错误)/.test(
    reason,
  );
  const hint = localConfig
    ? "这是本站配置检查，请按上面的提示补齐并保存后再测试。"
    : hints[status] ||
      (status >= 500
        ? "上游服务异常，请稍后检查平台状态；不代表密钥错误。"
        : /timeout|abort|超时/i.test(reason)
          ? "等待超时，请检查网络和 Agent 冷启动；先核对远端记录，再决定是否重试。"
          : /fetch|ENOTFOUND|ECONN|network/i.test(reason)
            ? "网络请求失败，请检查服务端网络、DNS、代理与 API 地址。"
            : "请核对已保存配置；以下为当前能取得的错误信息。");
  return {
    upstreamStatus: Number.isFinite(status) ? status : undefined,
    diagnosis: [
      Number.isFinite(status) ? `HTTP ${status}` : "未取得 HTTP 状态码",
      reason,
      ...fields,
      hint,
    ].join("\n"),
  };
}
