function invalid(message, status = 502) {
  throw Object.assign(Error(message), {
    status,
  });
}
export function validatePlan(p, allowed = ["researcher", "analyst", "writer", "designer", "coder"]) {
  if (!p || !Array.isArray(p.steps) || p.steps.length < 1 || p.steps.length > 7)
    invalid("计划必须包含 1–7 个执行步骤", 502);
  const ids = new Set();
  for (const s of p.steps) {
    if (typeof s.id !== "string" || !/^[a-z0-9_-]{1,30}$/i.test(s.id) || ids.has(s.id))
      invalid("计划节点 ID 无效或重复", 502);
    if (!allowed.includes(s.role)) invalid("计划包含不支持的岗位", 502);
    if (typeof s.action !== "string" || !s.action.trim()) invalid("计划步骤缺少具体工作", 502);
    if (!Array.isArray(s.depends) || s.depends.some((d) => !ids.has(d)))
      invalid("计划依赖必须指向前置步骤，不能形成循环", 502);
    ids.add(s.id);
  }
  return {
    summary: String(p.summary || ""),
    steps: p.steps.map((s) => ({
      id: s.id,
      role: s.role,
      action: s.action.slice(0, 1500),
      depends: s.depends,
    })),
    format: ["docx", "html", "xlsx", "pptx", "pdf"].includes(p.format) ? p.format : "docx",
    criteria: Array.isArray(p.criteria) ? p.criteria.map(String).slice(0, 8) : [],
  };
}
