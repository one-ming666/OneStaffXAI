const store = {
  getItem(k) {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  setItem(k, v) {
    try {
      localStorage.setItem(k, v);
    } catch {}
  },
  removeItem(k) {
    try {
      localStorage.removeItem(k);
    } catch {}
  },
};
const $ = (s) => document.querySelector(s),
  $$ = (s) => [...document.querySelectorAll(s)];
const escape = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c],
  );
const paths = {
  mic: "M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8",
  wifi: "M2 8a16 16 0 0 1 20 0M5 12a11 11 0 0 1 14 0M8 16a6 6 0 0 1 8 0M12 20h.01",
  chat: "M8 10h8M8 14h5M5 4h14v14H8l-4 3V5z",
  team: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M18 8a3 3 0 0 1 0 6M22 21v-2a4 4 0 0 0-3-3.8",
  tasks: "M8 6h12M8 12h12M8 18h12M3 6h1M3 12h1M3 18h1",
  files:
    "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M8 13h8M8 17h6",
  knowledge:
    "M4 19.5A2.5 2.5 0 0 1 6.5 17H20M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z",
  plugins: "M12 3v5M9 3h6M5 8h14v5a7 7 0 0 1-14 0zM12 20v3",
  settings:
    "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2",
  discover: "M12 3l9 9-9 9-9-9zM12 8l4 4-4 4-4-4z",
  plus: "M12 5v14M5 12h14",
  arrow: "M5 12h14M14 7l5 5-5 5",
  history: "M3 11a9 9 0 1 1 2 7M3 4v7h7M12 7v5l3 2",
  menu: "M4 6h16M4 12h16M4 18h16",
  close: "M6 6l12 12M18 6L6 18",
  upload: "M12 16V3M7 8l5-5 5 5M4 16v5h16v-5",
  star: "m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3l-5.6 2.9 1.1-6.2L3 9.6l6.2-.9z",
};
const icon = (n) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[n] || paths.star}"/></svg>`;
async function api(url, method = "GET", data) {
  const slow =
    url.includes("/test") ||
    url.includes("/translate") ||
    url.includes("/speech/") ||
    url.startsWith("/files");
  const opt = {
    method,
    credentials: "same-origin",
    signal: AbortSignal.timeout(slow ? 150000 : 30000),
  };
  if (data instanceof FormData) opt.body = data;
  else if (data !== undefined) {
    opt.headers = {
      "Content-Type": "application/json",
    };
    opt.body = JSON.stringify(data);
  }
  let r;
  try {
    r = await fetch("/api" + url, opt);
  } catch (e) {
    throw Error(
      e.name === "TimeoutError"
        ? "等待响应超时；不要重复提交正在执行的任务，请刷新历史核对状态"
        : e.message,
    );
  }
  let j;
  try {
    j = await r.json();
  } catch {
    throw Error("服务器未返回有效响应，请查看启动窗口");
  }
  if (!r.ok)
    throw Object.assign(Error(j.error || "请求失败"), {
      status: r.status,
      field: j.field,
      errors: j.errors,
      code: j.code,
      providerId: j.providerId,
      diagnosis: j.diagnosis,
      url: j.url,
    });
  return j;
}
let session,
  staff = [],
  routeToken = 0,
  chatId = null,
  chatEmployee = "director",
  busy = false,
  sending = false,
  uploadQueueBusy = false,
  savedDraft = "",
  redrawMessages = false,
  chatMessages = [],
  chatFiles = [],
  searchEnabled = false,
  kbEnabled = store.getItem("onestaff_kb_enabled") === "1",
  chosen = "px_02",
  taskTimer,
  reminderTimer,
  techTimer,
  adminConfig = null,
  recording = null,
  recordChunks = [];
const labels = {
  chat: "总监工作台",
  employees: "数字员工",
  tasks: "团队协作",
  artifacts: "成果中心",
  knowledge: "私有知识库",
  plugins: "插件中心",
  discover: "发现空间",
  friends: "我的朋友",
  hello: "Hello World",
  stats: "数据表现",
  settings: "设置与帮助",
};
const statuses = {
  planning: "规划中",
  waiting_approval: "等待确认",
  running: "执行中",
  reviewing: "监察中",
  revising: "返修中",
  delivering: "生成成果",
  succeeded: "已交付",
  failed: "执行失败",
  cancelled: "已取消",
  needs_revision: "待完善",
  interrupted: "执行中断",
};
const avatarIds = Array.from(
  {
    length: 40,
  },
  (_, i) => "px_" + String(i + 1).padStart(2, "0"),
);
const demoPlugins = [
  {
    id: "gmail",
    name: "Gmail",
    desc: "邮件收发与会话整理",
    mark: "M",
    tone: "red",
  },
  {
    id: "gdrive",
    name: "Google Drive",
    desc: "Drive、Docs、Sheets 与 Slides",
    mark: "D",
    tone: "gold",
  },
  {
    id: "github",
    name: "GitHub",
    desc: "代码仓库、Issue 与协作流程",
    mark: "GH",
    tone: "dark",
  },
  {
    id: "gcal",
    name: "Google Calendar",
    desc: "日历与日程管理",
    mark: "31",
    tone: "blue",
  },
  {
    id: "notion",
    name: "Notion",
    desc: "知识文档与工作流",
    mark: "N",
    tone: "dark",
  },
  {
    id: "slack",
    name: "Slack",
    desc: "团队消息与协作空间",
    mark: "S",
    tone: "multi",
  },
  {
    id: "outlook",
    name: "Outlook Mail",
    desc: "企业邮箱与日程入口",
    mark: "O",
    tone: "blue",
  },
  {
    id: "pdf",
    name: "PDF Toolkit",
    desc: "PDF 阅读、摘要与结构化",
    mark: "PDF",
    tone: "red",
  },
  {
    id: "docs",
    name: "Google Docs",
    desc: "在线文档协作入口",
    mark: "Doc",
    tone: "blue",
  },
  {
    id: "sheets",
    name: "Google Sheets",
    desc: "表格与数据协作入口",
    mark: "X",
    tone: "green",
  },
  {
    id: "figma",
    name: "Figma",
    desc: "设计文件与评审入口",
    mark: "F",
    tone: "multi",
  },
  {
    id: "feishu",
    name: "飞书",
    desc: "文档、群组与多维表格入口",
    mark: "飞",
    tone: "blue",
  },
  {
    id: "wecom",
    name: "企业微信",
    desc: "企业通信与客户协作入口",
    mark: "企",
    tone: "green",
  },
  {
    id: "granola",
    name: "Granola",
    desc: "会议笔记与内容整理入口",
    mark: "G",
    tone: "violet",
  },
];
function demoPluginSet() {
  try {
    const saved = JSON.parse(store.getItem("onestaff_demo_plugins") || "null");
    return new Set(
      Array.isArray(saved)
        ? saved
        : ["github", "slack", "sheets", "pdf", "docs"],
    );
  } catch {
    return new Set(["github", "slack", "sheets", "pdf", "docs"]);
  }
}
let demoPluginState = demoPluginSet();
function saveDemoPlugins() {
  store.setItem("onestaff_demo_plugins", JSON.stringify([...demoPluginState]));
}
const pluginIcons = {
  wecom: "wecom.jpg",
  outlook: "outlook.ico",
  figma: "figma.svg",
  granola: "granola_icon.svg",
  gmail: "gmail.ico",
  gdrive: "gdrive.png",
  github: "github.svg",
  gcal: "gcal.ico",
  notion: "notion.ico",
  slack: "slack.png",
  docs: "docs.ico",
  sheets: "sheets.ico",
  feishu: "feishu.ico",
};
function pluginLogo(x) {
  return `<span class="plugin-logo ${x.tone || ""}">${pluginIcons[x.id] ? `<img src="/assets/plugins/${pluginIcons[x.id]}" alt="${escape(x.name)} 标志">` : icon("files")}</span>`;
}
function techStrip() {
  return `<div class="tech-strip" aria-label="网络与环境状态"><span class="tech-chip"><i class="tech-pulse"></i><b id="tech-clock">--:--:--</b></span><span class="tech-chip network-chip" title="网络图标表示浏览器联网状态；浏览器不一定能识别 Wi-Fi 或有线连接">${icon("wifi")}<span id="tech-network">连接中</span></span><span class="tech-chip speed-chip" title="最近一秒本站实际接收的数据量；不是整机流量或宽带最大速度"><span class="speed-bars" aria-hidden="true">▂▄▆</span><span id="tech-speed">↓ 0 B/s</span></span><button class="tech-chip weather-chip" id="tech-weather" data-action="weather-info">☼ 天气未配置</button></div>`;
}
function refreshTechStatus() {
  clearInterval(techTimer);
  const tick = () => {
    if (document.hidden) return;
    if ($("#tech-clock"))
      $("#tech-clock").textContent = new Date().toLocaleTimeString("zh-CN", {
        hour12: false,
      });
    const network = $("#tech-network");
    if (network)
      network.textContent = navigator.onLine
        ? navigator.connection?.type === "wifi"
          ? "Wi-Fi"
          : "在线"
        : "离线";
    const sample = networkMeter.sample();
    if ($("#tech-speed"))
      $("#tech-speed").textContent = "↓ " + formatSize(sample) + "/s";
    $(".speed-chip")?.classList.toggle("active", sample > 0);
    if (Date.now() - weatherAt > 300000) {
      weatherAt = Date.now();
      api("/weather")
        .then((v) => {
          weatherValue = v;
          paintWeather();
        })
        .catch(() => {
          weatherValue = {
            state: "error",
          };
          paintWeather();
        });
    } else paintWeather();
  };
  tick();
  techTimer = setInterval(tick, 1000);
}
window.addEventListener("online", refreshTechStatus);
window.addEventListener("offline", refreshTechStatus);
function employeeNode(id, compact = false) {
  const e = role(id);
  return `<div class="flow-agent ${compact ? "compact" : ""}">${portrait(e.avatar, "flow-avatar")}<div><strong>${escape(e.job)}</strong><small>${escape(e.name)}</small></div><span class="agent-state"></span></div>`;
}
function teamOverview() {
  return teamTree(null);
}
function teamTasksView(tasks) {
  return (
    head(
      "团队协作",
      "复杂任务交给总监统一调度，过程、依赖、监察与成果都可追踪。",
      `<button class="btn primary" data-action="new-task">${icon("plus")} 新建团队任务</button>`,
    ) +
    teamOverview() +
    `<section class="card task-list-card"><div class="section-title"><div><span class="eyebrow">TASK QUEUE</span><h3>协作任务</h3></div><span class="muted tiny">${tasks.length} 个任务</span></div>${tasks.length ? tasks.map((t) => `<a class="task-item" href="#tasks/${t.id}"><div class="file-icon">${icon("tasks")}</div><div class="grow"><h3 class="truncate" style="margin:0 0 6px">${escape(t.title)}</h3><span class="muted tiny">${date(t.created)} · ${t.channel === "hybrid" ? "基座 + OpenHex" : t.channel === "openhex" ? "OpenHex" : "自建模型"}</span>${t.error ? `<p class="tiny task-error">${escape(t.error)}</p>` : ""}</div>${badge(t.status)}${icon("arrow")}</a>`).join("") : empty("准备好你的第一个团队目标", "上传资料，让总监先提出计划；你确认后，团队才开始执行。", '<button class="btn" data-action="new-task">创建任务</button>')}</section>`
  );
}
function groundingBadge(m) {
  if (m.role !== "assistant" || !m.grounding) return "";
  const g = m.grounding;
  if (g.enabled && g.matched)
    return `<div class="grounding good"><span>✓</span><strong>基于知识库回答</strong><small>命中 ${g.hitCount || 0} 条私有资料片段</small></div>`;
  if (g.enabled && !g.matched)
    return `<div class="grounding warn"><span>!</span><strong>未检索到关键词</strong><small>由大模型通用知识回答</small></div>`;
  return `<div class="grounding neutral"><span>○</span><strong>私有知识库未开启</strong><small>${g.attachedCount ? "仅使用你显式上传的附件" : "本次未检索私有资料"}</small></div>`;
}
function friendsView() {
  const people = [
    [
      "px_04",
      "林小夏",
      "产品经理",
      "热爱产品与用户体验，一起探索 AI 的更多应用场景。",
    ],
    [
      "px_34",
      "陈宇",
      "算法工程师",
      "用技术解决真实的问题，让复杂的世界更简单。",
    ],
    ["px_24", "苏怡", "设计师", "好的设计，让 AI 更有温度。"],
    ["px_17", "张晨", "运营专家", "关注 AI 产品的增长与用户价值。"],
    ["px_35", "王磊", "开发工程师", "持续构建更高效的开发工具链。"],
    ["px_29", "李梦", "市场专员", "用创意连接更多可能。"],
  ];
  return (
    `<div class="demo-banner"><span>DEMO SPACE</span><strong>演示界面 · 社交协作功能暂未开发</strong><small>可进入浏览，页面中的加好友、消息、加入群组按钮均不会执行动作。</small></div>` +
    head("我的朋友", "连接优秀的人，一起让 AI 创造更多可能。") +
    `<div class="friends-layout demo-page"><section><div class="friend-stats">${[
      ["我的好友", "24", "志同道合的伙伴"],
      ["我的团队", "3", "一起创造更大价值"],
      ["我关注的", "18", "持续学习，保持连接"],
      ["我的粉丝", "56", "感谢一路同行"],
    ]
      .map(
        ([a, b, c], i) =>
          `<div class="friend-stat s${i}"><span>${i === 0 ? "♟" : i === 1 ? "♣" : i === 2 ? "♥" : "●"}</span><div><small>${a}</small><strong>${b}</strong><em>${c}</em></div></div>`,
      )
      .join(
        "",
      )}</div><div class="card friend-list"><div class="section-title"><h3>好友列表</h3><span class="pill">仅演示</span></div>${people.map(([a, n, j, d]) => `<div class="friend-row">${portrait(a, "friend-avatar")}<div><strong>${n}</strong><span>${j}</span></div><p>${d}</p><button class="btn small" disabled>消息</button><button class="icon-btn" disabled>•••</button></div>`).join("")}<button class="load-demo" disabled>加载更多</button></div></section><aside class="stack"><div class="card"><div class="section-title"><h3>新的朋友</h3><span class="muted tiny">演示推荐</span></div>${people
      .slice(0, 4)
      .map(
        ([a, n, j]) =>
          `<div class="suggest-row">${portrait(a, "friend-avatar")}<div class="grow"><strong>${n}</strong><small>${j}</small></div><button class="btn small" disabled>＋ 加为好友</button></div>`,
      )
      .join(
        "",
      )}</div><div class="card"><h3>推荐群组</h3>${["AI 产品交流群", "提示词创作俱乐部", "行业应用探索组", "设计与 AI 灵感站"].map((g, i) => `<div class="suggest-row"><span class="group-logo">${["▣", "✦", "▥", "◉"][i]}</span><div class="grow"><strong>${g}</strong><small>${128 - i * 22} 位成员</small></div><button class="btn small" disabled>加入</button></div>`).join("")}</div></aside></div>`
  );
}
function helloView() {
  return (
    `<div class="demo-banner"><span>HELLO WORLD / PREVIEW</span><strong>演示界面 · 开发者实验室正在建设</strong><small>页面可进入，但所有运行、发布、创建按钮均为静态演示。</small></div>` +
    head(
      "Hello World",
      "把想法变成可运行的 AI 应用，这里将承载开发者实验、沙盒预览与发布流程。",
    ) +
    `<div class="hello-grid demo-page"><section class="card hello-code"><div class="section-title"><div><span class="eyebrow">SANDBOX / APP LAB</span><h3>AI 应用实验台</h3></div><span class="pill pending">UNDER DEVELOPMENT</span></div><div class="fake-editor"><div class="editor-tabs"><span class="active">app.py</span><span>config.json</span><span>README.md</span></div><pre><span>01</span>  from onestaff import Agent\n<span>02</span>\n<span>03</span>  assistant = Agent(\n<span>04</span>      role=<b>"researcher"</b>,\n<span>05</span>      knowledge=<b>"private"</b>,\n<span>06</span>      tools=[<b>"browser", "files"</b>]\n<span>07</span>  )\n<span>08</span>\n<span>09</span>  assistant.run(<b>"Hello World"</b>)</pre></div><div class="flex wrap"><button class="btn primary" disabled>▶ 运行沙盒</button><button class="btn" disabled>创建应用</button><button class="btn" disabled>发布到团队</button></div></section><aside class="stack"><div class="card"><span class="eyebrow">RUNTIME STATUS</span><h3>开发环境</h3><div class="hello-status"><span><i class="dot green"></i>工作区</span><b>READY</b></div><div class="hello-status"><span><i class="dot"></i>沙盒执行</span><b>LOCKED</b></div><div class="hello-status"><span><i class="dot"></i>部署通道</span><b>COMING SOON</b></div></div><div class="card"><h3>下一阶段能力</h3><p class="muted tiny">本地智能体导入、工具权限隔离、应用版本管理、OpenHex 工作区发布。</p><button class="btn" disabled>查看路线图</button></div></aside></div>`
  );
}
const portrait = (a, cls = "avatar") => {
  if (a?.startsWith("data:image/png;base64,"))
    return `<img class="${[cls, "custom-portrait", "pixel-avatar"].filter(Boolean).join(" ")}" src="${escape(a)}" alt="像素伙伴">`;
  const n = Math.max(1, Math.min(40, Number(a?.slice(3)) || 2)),
    id = "px_" + String(n).padStart(2, "0");
  return `<img class="${[cls, "pixel-avatar"].filter(Boolean).join(" ")}" src="/assets/avatars/${id}.png" alt="像素伙伴 ${String(n).padStart(2, "0")}" loading="lazy">`;
};
const role = (id) =>
  id === "team"
    ? {
        id: "team",
        name: "团队协作",
        job: "总监调度 · 独立监察",
        avatar: "px_02",
        description: "描述目标 → 确认计划 → 员工执行 → 监察交付",
      }
    : staff.find((e) => e.id === id) ||
      staff[0] || {
        name: "星澜",
        job: "团队总监",
        avatar: "px_02",
      };
const date = (t) =>
  new Date(t).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
const badge = (s) =>
  `<span class="pill ${s === "succeeded" ? "success" : ["failed", "needs_revision", "interrupted"].includes(s) ? "error" : s === "waiting_approval" ? "pending" : ""}">${statuses[s] || escape(s)}</span>`;
function toast(s) {
  if ($("#dialog").open && !$('[data-form="admin-config"]')) {
    let notice = $("#dialog-notice");
    if (!notice) {
      notice = document.createElement("p");
      notice.id = "dialog-notice";
      notice.className = "callout";
      notice.setAttribute("role", "status");
      $("#dialog .dialog-body").prepend(notice);
    }
    notice.textContent = s;
  }
  if ($("#dialog").open && $('[data-form="admin-config"]')) {
    const box = $("#service-test-result");
    if (box) box.textContent = s;
  }
  $("#toast").textContent = s;
  $("#toast").classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => $("#toast").classList.remove("show"), 4500);
}
function modal(title, content) {
  const d = $("#dialog");
  d.innerHTML = `<div class="dialog-head"><h2 id="dialog-title">${escape(title)}</h2><button class="icon-btn" data-action="close" aria-label="关闭">${icon("close")}</button></div><div class="dialog-body" tabindex="0">${content}</div>`;
  d.setAttribute("aria-labelledby", "dialog-title");
  if (!d.open) d.showModal();
  d.querySelector(".dialog-body").scrollTop = 0;
}
function close() {
  $("#dialog").close();
}
function goto(hash) {
  if (location.hash === "#" + hash) render();
  else location.hash = hash;
}
function head(title, desc, actions = "") {
  return `<div class="page-head"><div><div class="eyebrow">ONE STAFF / INTELLIGENT WORKSPACE</div><h1>${title}</h1><p>${desc}</p></div>${actions}</div>`;
}
function empty(title, desc, action = "") {
  return `<div class="empty">${icon("files")}<h3>${title}</h3><p>${desc}</p>${action}</div>`;
}
function shell(page) {
  const nav = (id, ico) =>
    `<a class="nav ${page === id ? "active" : ""}" href="#${id}">${icon(ico)}<span>${labels[id]}</span></a>`;
  $("#app").innerHTML =
    `<div class="shell"><aside class="sidebar"><a class="brand" href="#chat"><img src="/assets/logo.png" alt="One Staff X AI"><small>PEOPLE × AI · BETTER TOMORROW</small></a><div class="sidebar-scroll"><div class="nav-section">我的工作空间</div>${nav("chat", "chat")}${nav("employees", "team")}${nav("tasks", "tasks")}${nav("artifacts", "files")}<div class="nav-section">能力与资源</div>${nav("knowledge", "knowledge")}${nav("plugins", "plugins")}${nav("discover", "discover")}${nav("friends", "team")}${nav("hello", "files")}${nav("stats", "tasks")}</div><div class="sidebar-bottom">${nav("settings", "settings")}<button class="space-card" data-action="profile" style="width:100%;text-align:left">${portrait(session.profile.avatar)}<span class="grow"><strong class="tiny">${escape(session.profile.name)}</strong><span class="muted tiny" style="display:block;margin-top:5px">我的 AI 空间 · 2026.9.19</span></span><span>›</span></button></div></aside><section class="stage"><header class="topbar"><div class="flex"><button class="icon-btn menu-btn" data-action="menu" aria-label="菜单">${icon("menu")}</button><span class="crumb">我的空间 <span style="margin:0 10px">/</span> ${labels[page] || "团队协作"}</span></div><div class="top-actions">${techStrip()}<span class="badge model-badge"><span class="dot ${session.configured ? "green" : ""}"></span>${session.channel === "hybrid" ? "混合协作" : session.channel === "openhex" ? "OpenHex" : "自建模型"} · ${session.configured ? "已配置" : "待配置"}</span><button class="icon-btn" data-action="transfer" title="跨设备接续">${icon("arrow")}</button><button class="icon-btn" data-action="reminder" title="提醒">${icon("history")}</button></div></header><main class="container" id="content"></main></section></div><nav class="mobile-nav">${[
      ["chat", "chat"],
      ["employees", "team"],
      ["tasks", "tasks"],
      ["discover", "discover"],
      ["settings", "settings"],
    ]
      .map(
        ([id, ico]) =>
          `<a href="#${id}" class="${page === id ? "active" : ""}">${icon(ico)}${labels[id]}</a>`,
      )
      .join("")}</nav>`;
  refreshTechStatus();
}
async function render() {
  if ($("#message-input")) savedDraft = $("#message-input").value;
  const token = ++routeToken;
  clearInterval(taskTimer);
  const [page = "chat", id] = location.hash.slice(1).split("/");
  if (page === "onboarding") {
    renderOnboarding();
    return;
  }
  const safe = labels[page] ? page : "chat";
  shell(safe);
  $("#content").innerHTML = '<div class="skeleton">正在载入你的工作空间…</div>';
  try {
    let html;
    if (page === "chat") {
      renderChat();
      return;
    } else if (page === "employees") html = employeesView();
    else if (page === "tasks" && id) {
      await taskView(id, token);
      return;
    } else if (page === "tasks") {
      html = teamTasksView(await api("/tasks"));
    } else if (page === "artifacts") html = await artifactsView();
    else if (page === "knowledge") html = await knowledgeView();
    else if (page === "plugins") html = await pluginsView();
    else if (page === "stats") html = await statsView();
    else if (page === "friends") html = friendsView();
    else if (page === "hello") html = helloView();
    else if (page === "settings") html = settingsView();
    else html = discoverView();
    if (token === routeToken) $("#content").innerHTML = html;
  } catch (e) {
    if (token === routeToken)
      $("#content").innerHTML = empty(
        "暂时未能载入",
        escape(e.message),
        '<button class="btn" data-action="reload">重试</button>',
      );
  }
}
function renderOnboarding() {
  chosen = session.profile.avatar || "px_02";
  const picks = [
    ["px_02", "星澜", "沉稳 · 清晰"],
    ["px_08", "知微", "细致 · 敏锐"],
    ["px_35", "凌川", "专注 · 理性"],
    ["px_28", "绘月", "灵动 · 创意"],
    ["px_14", "青岚", "好奇 · 探索"],
  ];
  $("#app").innerHTML =
    `<div class="onboarding"><a href="/"><img src="/assets/logo.png" alt="One Staff X AI" style="width:235px;height:80px;object-fit:contain;margin-bottom:35px"></a><div class="steps-bar"><span class="current">01 选择形象</span><span>02 为 TA 命名</span><span>03 开启智能空间</span></div><div class="eyebrow">MEET YOUR AI PARTNER</div><h1>选择你的第一位 AI 搭档</h1><p class="muted">从这里开始，把想法交给一支懂你的团队。</p><div class="avatar-lineup">${picks.map(([a, n, d]) => `<button class="avatar-choice ${chosen === a ? "selected" : ""}" data-action="choose-avatar" data-id="${a}" data-name="${n}">${portrait(a, "")}<strong>${n}</strong><small>${d}</small></button>`).join("")}</div><div class="flex wrap" style="justify-content:center"><button class="btn" data-action="avatar-library">＋ 更多头像</button><button class="btn ghost" data-action="custom-avatar">自定义像素形象 ${icon("arrow")}</button></div><div id="custom-choice"></div><form class="onboard-bottom" data-form="onboard"><label for="partner-name">你想怎么称呼 TA？</label><input id="partner-name" name="name" value="${escape(session.profile.onboarded ? session.profile.name : "星澜")}" maxlength="30" required placeholder="为你的伙伴起个名字"><button class="btn primary">开启我的智能空间 ${icon("arrow")}</button><p class="muted tiny" style="margin-top:15px">之后可以随时更换形象、姓名和工作风格。</p></form></div>`;
}
function selectAvatar(a, n) {
  chosen = a;
  $$(".avatar-choice").forEach((b) =>
    b.classList.toggle("selected", b.dataset.id === a),
  );
  if (n && $("#partner-name")) $("#partner-name").value = n;
  const el = $("#custom-choice");
  if (el && !$$(".avatar-choice").some((b) => b.dataset.id === a))
    el.innerHTML = `<div class="flex" style="justify-content:center;margin-top:20px">${portrait(a)}<span class="tiny muted">已选择你的专属形象</span></div>`;
  else if (el) el.innerHTML = "";
}
function avatarLibrary() {
  modal(
    "选择像素形象",
    `<p class="muted tiny">40 个头像均已拆分为独立透明 PNG，不再使用雪碧图裁切；更换形象不会改变历史记录。</p><div class="avatar-library">${avatarIds.map((a, i) => `<button data-action="pick-library" data-id="${a}">${portrait(a, "")}<small class="muted">${String(i + 1).padStart(2, "0")}</small></button>`).join("")}</div>`,
  );
}
function customAvatar() {
  modal(
    "自定义像素形象",
    `<p class="muted tiny">在画板上绘制，或上传你的透明 PNG。保存后作为空间形象使用。</p><div style="text-align:center"><canvas id="pixel" class="pixel-canvas" width="32" height="32"></canvas><div class="flex wrap" style="justify-content:center;margin:15px 0"><input type="color" id="pixel-color" value="#3976ef" style="width:60px;height:40px;padding:3px"><button class="btn small" data-action="pixel-erase">橡皮擦</button><button class="btn small" data-action="pixel-clear">清空</button><label class="btn small">上传 PNG<input type="file" accept="image/png" id="avatar-upload" hidden style="display:none"></label></div><button class="btn primary" data-action="pixel-save">保存形象</button></div>`,
  );
  const c = $("#pixel"),
    ctx = c.getContext("2d");
  let painting = false,
    erase = false;
  const draw = (e) => {
    if (!painting) return;
    const b = c.getBoundingClientRect(),
      x = Math.floor(((e.clientX - b.left) / b.width) * 32),
      y = Math.floor(((e.clientY - b.top) / b.height) * 32);
    if (erase) ctx.clearRect(x, y, 1, 1);
    else {
      ctx.fillStyle = $("#pixel-color").value;
      ctx.fillRect(x, y, 1, 1);
    }
  };
  c.addEventListener("pointerdown", (e) => {
    painting = true;
    c.setPointerCapture(e.pointerId);
    draw(e);
  });
  c.addEventListener("pointermove", draw);
  c.addEventListener("pointerup", () => (painting = false));
  c.addEventListener("pointercancel", () => (painting = false));
  $('[data-action="pixel-erase"]').onclick = () => {
    erase = !erase;
    $('[data-action="pixel-erase"]').classList.toggle("primary", erase);
  };
  $("#pixel-color").onchange = () => {
    erase = false;
  };
  $("#avatar-upload").onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    if (f.size > 1024 * 1024) return toast("请选择 1 MB 以内的 PNG");
    const data = await new Promise((resolve) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.readAsDataURL(f);
    });
    selectAvatar(data);
    close();
  };
}
function renderChat() {
  const draft = $("#message-input")?.value ?? savedDraft,
    e = role(chatEmployee);
  bubbleEpoch++;
  $("#content").innerHTML =
    `<section class="kb-control ${kbEnabled ? "on" : "off"}"><div class="kb-control-main"><span class="kb-icon">${icon("knowledge")}</span><div><strong>私有知识库 ${kbEnabled ? "ON" : "OFF"}</strong><small>${kbEnabled ? "检索你主动加入知识库的资料" : "本轮不自动检索私有资料"}</small></div></div><button class="kb-switch ${kbEnabled ? "active" : ""}" data-action="toggle-kb" aria-pressed="${kbEnabled}"><i></i><span>${kbEnabled ? "已开启" : "未开启"}</span></button><p>附件单独发送，不等同于加入知识库。关闭检索不会擦除 Agent 已接收的历史；严格隔离请新建对话。</p></section>
  <div class="chat-layout flow-chat"><section class="card chat-main"><div class="chat-top flex between"><div class="flex">${portrait(e.avatar)}<div class="grow"><select id="chat-employee" ${busy ? "disabled" : ""} aria-label="选择数字员工">${staff.map((s) => `<option value="${s.id}" ${s.id === chatEmployee ? "selected" : ""}>${escape(s.name)} · ${escape(s.job)}</option>`).join("")}</select><div class="muted tiny chat-description">${escape(e.description)}</div></div></div><div class="flex">${["director", "supervisor"].includes(chatEmployee) ? '<a class="btn small" href="#tasks">团队协作 ↗</a>' : `<button class="btn small" data-action="platform-entry" data-id="${e.id}">平台直达 ↗</button>`}<button class="icon-btn" data-action="chat-history" title="历史对话">${icon("history")}</button><button class="icon-btn" data-action="new-chat" title="新建隔离对话">${icon("plus")}</button></div></div>
  <div class="experience-bar"><span class="mini-status"><i></i> ${chatEmployee === "director" ? "总监直聊 · 独立监察" : "员工对话 · 独立监察"}</span><label class="check-pill"><input type="checkbox" id="translation-toggle" ${viewPrefs.translate ? "checked" : ""}> 翻译</label><select id="translation-language" aria-label="翻译目标语言">${Object.entries(
    languageNames,
  )
    .map(
      ([k, v]) =>
        `<option value="${k}" ${k === viewPrefs.language ? "selected" : ""}>${v}</option>`,
    )
    .join(
      "",
    )}</select><label class="check-pill"><input type="checkbox" id="bubble-toggle" ${viewPrefs.bubbles ? "checked" : ""}> 角色气泡</label></div>
  <div id="conversation" aria-live="off">${chatMessages.length ? messagesHtml() : welcomeHtml()}</div><div id="turn-status" class="turn-status" role="status">${turnStatusHtml()}</div>
  <div class="composer" id="drop-zone"><div id="attachments">${attachmentsHtml()}</div><textarea id="message-input" placeholder="领导，说说今天的目标吧。可以输入问题，也可以拖入资料。" aria-label="消息内容">${escape(draft)}</textarea><div class="composer-footer"><div class="composer-tools"><button data-action="attach">＋ 原文件</button><button data-action="toggle-search" class="${searchEnabled ? "selected" : ""}">联网${searchEnabled ? " ON" : ""}</button><button data-action="voice" class="mic-button" aria-label="开始或停止录音" title="点击录音，再次点击停止" aria-pressed="${!!recording}">${icon("mic")}</button><button data-action="plugins-modal">插件</button></div><div class="flex"><button class="btn small" data-action="team-input" ${busy ? "disabled" : ""}>交给团队</button><button class="btn primary small" id="send-btn" data-action="${busy ? "stop-chat" : "send-chat"}">${busy ? "停止" : "发送 ↑"}</button></div></div><small class="composer-hint">每轮最多 8 个附件 · 每个 20 MB · 合计 64 MB · Enter 发送，Shift + Enter 换行</small></div><section id="review-panel" class="review-panel" aria-live="polite">${reviewPanel()}</section></section>
  <aside class="chat-aside"><div class="card companion ${busy ? "thinking" : ""}" id="companion"><div class="eyebrow">A LITTLE PRESENCE</div><div class="state">${busy ? "请求处理中 · 状态见对话栏" : "READY WHEN YOU ARE"}</div><div class="companion-stage"><div id="character-bubble" class="character-bubble" hidden></div>${portrait(session.profile.avatar, "")}</div><h2>${escape(session.profile.name)}</h2><p>认真工作，也留一点轻松。</p><div class="line"></div><div class="flex between tiny"><span class="muted">当前搭档</span><strong>${escape(e.job)}</strong></div><button class="btn ghost small" data-action="profile">形象与性格</button></div><div class="card side-note"><strong>先聊清楚，再动手</strong>这里是总监的一对一工作台。需要分工时，再点“交给团队”。OpenHex 缺席时，总监和监察者接手，不会冒充远端员工。</div><div class="card side-note"><strong>资料怎么交到模型手上？</strong>总监读取本地提取的文档片段；OpenHex 员工接收原文件。两条通道会明确标注，不把“上传成功”说成“已读完”。</div></aside></div>`;
  $("#chat-employee").onchange = (x) => {
    if (sending || uploadQueueBusy) {
      x.target.value = chatEmployee;
      return toast("请先等待本轮准备或上传结束");
    }
    savedDraft = "";
    $("#message-input").value = "";
    chatEmployee = x.target.value;
    chatId = null;
    chatMessages = [];
    chatFiles = [];
    lastTurn = null;
    renderChat();
  };
  $("#message-input").oninput = () => {
    savedDraft = $("#message-input").value;
  };
  $("#message-input").onkeydown = (x) => {
    if (x.key === "Enter" && !x.shiftKey && !x.isComposing) {
      x.preventDefault();
      if (!busy) sendChat().catch((err) => toast(err.message));
    }
  };
  $("#translation-toggle").onchange = async (x) => {
    if (
      x.target.checked &&
      !confirm(
        "开启后，回复原文会发送给管理员配置的辅助模型翻译，产生额外用量。翻译不是 Agent 原回答。是否开启？",
      )
    )
      x.target.checked = false;
    viewPrefs.translate = x.target.checked;
    saveViewPrefs();
    updateMessages();
    if (viewPrefs.translate) translateRecent();
  };
  $("#translation-language").onchange = (x) => {
    viewPrefs.language = x.target.value;
    saveViewPrefs();
    updateMessages();
    if (viewPrefs.translate) translateRecent();
  };
  $("#bubble-toggle").onchange = (x) => {
    if (
      x.target.checked &&
      !confirm(
        "角色气泡由辅助模型生成，最多使用本轮问题前320字，不发送文档全文。它是角色化表达，不是主智能体的真实思考，会产生额外用量。是否开启？",
      )
    )
      x.target.checked = false;
    viewPrefs.bubbles = x.target.checked;
    saveViewPrefs();
    if (viewPrefs.bubbles && !session.auxiliary)
      toast("辅助模型尚未配置，角色气泡暂不生成，请先配置并测试");
    if (!viewPrefs.bubbles) {
      bubbleEpoch++;
      $("#character-bubble").hidden = true;
    }
  };
  const dz = $("#drop-zone");
  dz.ondragover = (x) => {
    x.preventDefault();
    dz.classList.add("dragover");
  };
  dz.ondragleave = () => dz.classList.remove("dragover");
  dz.ondrop = (x) => {
    x.preventDefault();
    dz.classList.remove("dragover");
    enqueueFiles([...x.dataTransfer.files]);
  };
  $("#message-input").addEventListener("paste", (x) => {
    const f = [...x.clipboardData.files];
    if (f.length) {
      x.preventDefault();
      enqueueFiles(f);
    }
  });
  requestAnimationFrame(() => {
    const box = $("#conversation");
    if (box && chatMessages.length) box.scrollTop = box.scrollHeight;
  });
}
function welcomeHtml() {
  const e = role(chatEmployee);
  if (chatEmployee === "director")
    return `<div class="director-welcome"><div class="welcome-kicker"><i></i> 总监已就位 <span>ONE STAFF × AI</span></div><div class="welcome-message"><span class="welcome-avatar">${portrait(e.avatar)}</span><div><strong>${escape(e.name)} <small>你的 AI 总监</small></strong><p>你好，我是星澜。把目标或资料发给我，我们一起把这项工作往前推进。</p><img class="welcome-robot" src="/assets/director-welcome.webp?v=20260919" width="98" height="148" alt="笑着向你打招呼的蓝白机器人" decoding="async"></div></div><div class="welcome-suggestions">${[
      ["梳理今天的任务", "帮我梳理今天要做的工作，先问我两三个关键问题。"],
      ["一起分析资料", "请帮我分析资料。先说明你需要哪些文件和信息。"],
      ["讨论一个想法", "我有个想法想和你聊聊，请先帮我把需求问清楚。"],
    ]
      .map(
        ([title, prompt]) =>
          `<button data-action="quick" data-prompt="${prompt}">${title} <span>↗</span></button>`,
      )
      .join("")}</div></div>`;
  return `<div class="director-welcome employee-welcome"><div class="welcome-kicker">${escape(e.job)} · 已就位</div><h2>我是${escape(e.name)}，这件事我们一起琢磨。</h2><p>${escape(e.description)}</p><p class="hint">这里是一对一对话；多人分工请打开“团队协作”。</p></div>`;
}
function messagesHtml() {
  return `<div class="messages" id="messages">${chatMessages
    .map((m, i) => {
      const translation = m.translations?.[viewPrefs.language],
        sources = [
          ...new Map(
            (m.sources || [])
              .filter((x) => x && typeof x === "object")
              .map((x) => [x.id || x.url || x.title || x.name, x]),
          ).values(),
        ].slice(0, 10);
      return `<div class="message ${m.role}" data-message-index="${i}">${portrait(m.role === "user" ? session.profile.avatar : role(chatEmployee).avatar)}<div class="bubble"><div class="message-meta">${m.role === "user" ? "你" : escape(role(chatEmployee).name)}${m.channel ? " · " + escape(m.channel === "openhex" ? "OpenHex" : m.channel) : ""}${m.interrupted ? " · 回复未完成" : ""}</div>${groundingBadge(m)}
  ${(m.files || []).length && m.role === "user" ? `<div class="file-chips">${m.files.map((f) => `<a href="/api/files/${encodeURIComponent(f.id)}/download" class="file-chip">${icon("files")}<span>${escape(f.name)}</span></a>`).join("")}</div>` : ""}
  <pre class="answer-text">${escape(m.content)}</pre>
  ${(m.outputs || []).map((f) => `<div class="output-file">${icon("files")}<div class="grow"><strong>${escape(f.name)}</strong><small>Agent 返回文件 · 按需取回原文件</small></div><button class="btn small" data-action="download-output" data-id="${f.id}" data-name="${escape(f.name)}">下载 ↓</button></div>`).join("")}
  ${(m.images || []).length ? `<div class="file-chips">${m.images.map((url, n) => `<a class="file-chip" href="${escape(safeHref(url))}" target="_blank" rel="noopener noreferrer">打开生成图片 ${n + 1} ↗</a>`).join("")}</div>` : ""}${sources.length ? `<details class="source-details"><summary>本轮参考来源 · ${sources.length}</summary>${sources.map((s) => (s.url ? `<a href="${escape(safeHref(s.url))}" target="_blank" rel="noopener noreferrer">${escape(s.title || s.url)} ↗</a>` : `<span>${escape(s.name || "私有资料")} · ${escape(s.position || "")}</span>`)).join("")}</details>` : ""}
  ${viewPrefs.translate && m.role === "assistant" && m.content ? `<section class="translation-block"><div class="tiny"><strong>辅助译文 · ${languageNames[viewPrefs.language]}</strong><span>原文始终保留</span></div><pre>${escape(translation?.text || translation?.error || (translation?.loading ? "正在翻译，不影响原回答…" : "本条尚未翻译"))}</pre>${!translation?.text && !translation?.loading ? `<button class="btn ghost small" data-action="translate-message" data-id="${i}" ${m.id ? "" : "disabled"}>翻译这条回复</button>` : ""}</section>` : ""}
  ${m.role === "assistant" && m.content ? `<div class="message-actions">${m.id ? `<button class="btn ghost small" data-action="export-message" data-id="${m.id}">导出文件</button>` : ""}<button class="btn ghost small" data-action="copy-message" data-id="${i}">复制原文</button><button class="btn ghost small" data-action="speak" data-id="${i}">朗读原文</button>${m.metrics?.totalMs ? `<small>首字 ${m.metrics.firstTokenMs ? (m.metrics.firstTokenMs / 1000).toFixed(1) + "s" : "—"} · 本轮 ${(m.metrics.totalMs / 1000).toFixed(1)}s</small>` : ""}</div>${(m.followups || []).length ? `<div class="followup-list"><small>接下来可以聊</small>${m.followups.map((q) => `<button data-action="followup" data-question="${escape(q)}">${escape(q)} ↗</button>`).join("")}</div>` : ""}` : ""}</div></div>`;
    })
    .join("")}</div>`;
}
function updateMessages(tokensOnly = false) {
  if (!tokensOnly) redrawMessages = true;
  if (messageFrame) return;
  messageFrame = requestAnimationFrame(() => {
    messageFrame = 0;
    const box = $("#conversation");
    if (!box) return;
    const stick = box.scrollHeight - box.scrollTop - box.clientHeight < 120,
      old = box.scrollTop;
    const nodes = box.querySelectorAll("[data-message-index]");
    if (redrawMessages || nodes.length !== chatMessages.length) {
      box.innerHTML = chatMessages.length ? messagesHtml() : welcomeHtml();
      redrawMessages = false;
      paintReview();
    } else {
      const i = chatMessages.length - 1,
        node = box.querySelector(
          '[data-message-index="' + i + '"] .answer-text',
        );
      if (node && node.textContent !== chatMessages[i]?.content)
        node.textContent = chatMessages[i].content;
    }
    box.scrollTop = stick ? box.scrollHeight : old;
  });
}
function attachmentsHtml() {
  return [
    ...chatFiles.map(
      (f) =>
        `<span class="attachment"><span title="${escape(f.name)}">${escape(f.name)}</span><small>${formatSize(f.size)}</small><button data-action="remove-attachment" data-id="${f.id}" aria-label="移除附件" ${busy ? "disabled" : ""}>×</button></span>`,
    ),
    ...uploadJobs.map(
      (f) =>
        `<span class="attachment uploading"><span>${escape(f.name)}</span><small>${f.progress === 100 ? "本地保存中" : f.progress + "% · 浏览器→本站"}</small></span>`,
    ),
  ].join("");
}
async function sendChat() {
  if (busy || sending) return;
  if (uploadJobs.length || uploadQueueBusy)
    return toast("请先等待文件上传到本站完成");
  const input = $("#message-input"),
    text = input?.value.trim();
  if (!text) return;
  if (text.length > 16000)
    return toast("本轮问题最多16000字，长资料请作为文件上传");
  if (
    lastTurn &&
    ["running", "preparing", "reviewing"].includes(lastTurn.status)
  )
    return toast("上轮仍在执行，请先刷新历史或停止上轮");
  sending = true;
  const initialEmployee = chatEmployee,
    button = $("#send-btn");
  if (button) button.disabled = true;
  try {
    if (!chatId)
      chatId = (
        await api("/chats", "POST", {
          employee: initialEmployee,
        })
      ).id;
    const files = chatFiles.slice(),
      message = {
        role: "assistant",
        content: "",
        sources: [],
        outputs: [],
        files: [],
        requestId: crypto.randomUUID(),
      };
    chatMessages.push(
      {
        role: "user",
        content: text,
        files,
      },
      message,
    );
    savedDraft = "";
    if ($("#message-input")) $("#message-input").value = "";
    await consumeTurn(message, false, {
      text,
      files: files.map((f) => f.id),
      knowledge: kbEnabled,
      search: searchEnabled,
      requestId: message.requestId,
    });
  } finally {
    sending = false;
    const b = $("#send-btn");
    if (b) b.disabled = false;
  }
}
function employeesView() {
  const add = `<div class="employee-add-control"><button class="btn primary" data-action="new-employee">＋ 添加员工</button><div><button data-action="new-employee">自定义员工</button><label>上传本地智能体<input hidden type="file" id="employee-import-page" accept=".json"></label></div></div>`;
  return (
    head(
      "你的数字员工团队",
      "每一位都有专长，每一次协作都围绕同一个目标。",
      add,
    ) +
    `<button class="team-entry card" data-action="talk" data-id="team"><div>${portrait("px_02", "portrait")}</div><div><span class="eyebrow">YOUR FIRST CONVERSATION</span><h2>团队协作</h2><p>一个目标，多位专家。总监规划分工，监察者独立复核。</p><span class="pill">进入团队对话 →</span></div></button><div class="grid three employee-grid">${staff.map((e) => `<article class="card employee-card">${portrait(e.avatar, "portrait")}<span class="pill">${escape(e.job)}</span><h3>${escape(e.name)}</h3><p>${escape(e.description)}</p><div class="flex wrap"><button class="btn small primary" data-action="talk" data-id="${e.id}">开始对话 ${icon("arrow")}</button><button class="btn small" data-action="employee-detail" data-id="${e.id}">详情</button><button class="btn small" data-action="platform-entry" data-id="${e.id}">平台直达</button>${e.local ? `<button class="btn ghost small" data-action="delete-employee" data-id="${e.id}">删除</button>` : ""}</div></article>`).join("")}</div><div class="callout"><strong>两种扩展方式：</strong>“自定义员工”在页面内填写岗位指令；“上传本地智能体”导入本站 JSON 角色配置。导入不会执行第三方代码包。</div>`
  );
}
function newEmployee() {
  const first = "px_02";
  modal(
    "添加数字员工",
    `<form class="form employee-form" data-form="employee"><div class="employee-form-grid"><section><label>姓名</label><input name="name" required maxlength="30" placeholder="例如：项目顾问"><label>岗位</label><input name="job" required placeholder="例如：项目策划"><label>简介</label><input name="description" placeholder="一句话说明 TA 的专长"><label>岗位指令</label><textarea name="prompt" required rows="7" placeholder="擅长什么、工作流程、输出要求与边界"></textarea></section><section class="employee-avatar-panel"><input type="hidden" name="avatar" id="employee-avatar-value" value="${first}"><div class="employee-avatar-preview" id="employee-avatar-preview">${portrait(first, "portrait")}</div><strong>从头像库选择</strong><small>独立透明 PNG · 不拉伸裁切</small><div class="employee-avatar-grid">${avatarIds.map((a, i) => `<button type="button" class="${a === first ? "selected" : ""}" data-action="employee-avatar" data-id="${a}">${portrait(a, "")}</button>`).join("")}</div></section></div><div class="employee-form-footer"><button class="btn primary">保存自定义员工</button><label class="btn">上传本地智能体<input hidden type="file" id="employee-import" accept=".json"></label><span class="hint">支持本站 JSON：name、job、description、prompt、avatar；不会运行导入文件中的代码。</span></div></form>`,
  );
}
async function newTask(prefill = "") {
  const files = await api("/files");
  modal(
    "把目标交给团队",
    `<form class="form" data-form="task"><label>你希望最终拿到什么？</label><textarea name="request" required rows="5" placeholder="说明目标、已有资料、成果格式和验收要求…">${escape(prefill)}</textarea><label>使用资料</label><div class="stack" style="gap:9px;max-height:160px;overflow:auto">${files.length ? files.map((f) => `<label class="flex" style="margin:0"><input type="checkbox" name="files" value="${f.id}" ${chatFiles.some((x) => x.id === f.id) ? "checked" : ""}>${escape(f.name)}</label>`).join("") : '<span class="muted tiny">暂无资料。可以先在私有知识库上传。</span>'}</div><div class="callout">总监先生成计划，得到你的确认后才执行。监察未通过时保留原稿，等待你确认修订。</div><button class="btn primary">生成执行计划 ${icon("arrow")}</button></form>`,
  );
}
async function taskView(id, token) {
  if (token !== routeToken) return;
  const t = await api("/tasks/" + id);
  if (token !== routeToken) return;
  const p = t.plan || {};
  const scroll = document.querySelector(".stage")?.scrollTop || 0;
  const opened = [...document.querySelectorAll("#content details")].map(
    (x) => x.open,
  );
  $("#content").innerHTML =
    head(
      escape(t.title),
      "每一步执行、每一次检查，都有真实记录。",
      `<a href="#tasks" class="btn">返回任务列表</a>`,
    ) +
    teamRuntimeBanner(t) +
    teamTree(t) +
    `<div class="grid two" style="grid-template-columns:minmax(0,1.25fr) minmax(0,1fr)"><section class="stack"><div class="card"><div class="flex between"><h2 style="margin:0">执行计划</h2>${badge(t.status)}</div><p class="muted tiny" style="margin-top:15px">${escape(t.request)}</p>${(p.steps || []).map((s, i) => `<div class="plan-step"><span class="step-index">${i + 1}</span><div><strong class="tiny">${escape(role(s.role).job)}</strong><p style="font-size:13px;margin:7px 0">${escape(s.action)}</p><span class="muted tiny">${s.depends.length ? "依赖：" + s.depends.join("、") : "可独立执行"}</span></div></div>`).join("")}${p.criteria?.length ? `<div class="callout">验收标准：${p.criteria.map(escape).join("；")}</div>` : ""}<div class="flex wrap" style="margin-top:18px">${t.status === "waiting_approval" ? `<button class="btn primary" data-action="approve-task" data-id="${id}">确认计划，开始执行</button>` : ""}${["planning", "waiting_approval", "running", "reviewing", "revising", "delivering"].includes(t.status) ? `<button class="btn" data-action="cancel-task" data-id="${id}">取消任务</button>` : ""}${["failed", "interrupted", "needs_revision"].includes(t.status) ? `<button class="btn" data-action="retry-task" data-id="${id}">重新规划</button>` : ""}${t.output ? `<button class="btn" data-action="revise-task" data-id="${id}">继续修改</button>` : ""}<button class="btn ghost small" data-action="task-capability" data-id="${id}">OpenHex 工具授权</button></div>${t.error ? `<p class="notice">${escape(t.error)}</p>` : ""}</div>${t.review ? `<div class="card"><h3>监察结论</h3><p>${escape(t.review.summary)}</p>${t.review.issues?.map((x) => `<p class="tiny muted">• ${escape(x)}</p>`).join("") || ""}</div>` : ""}${t.artifacts.length || t.output ? `<div class="card"><h3>本次成果</h3>${artifactRows(t.artifacts)}${t.output ? `<div class="flex wrap" style="margin-top:18px">${["docx", "xlsx", "pdf", "pptx", "md"].map((k) => `<button class="btn small" data-action="export-task" data-id="${id}" data-kind="${k}">导出 ${k.toUpperCase()}</button>`).join("")}</div>` : ""}</div>` : ""}${t.output ? `<details class="card"><summary>查看成果正文${t.status !== "succeeded" ? "（草稿）" : ""}</summary><div class="result-text" style="margin-top:18px">${escape(t.output)}</div></details>` : ""}</section><section class="card"><h2>团队执行记录</h2><p class="muted tiny">展示计划、工具、节点产出与监察结论。</p><div class="timeline">${t.events
      .map(
        (e) =>
          `<article class="timeline-item"><header><strong>${escape(
            {
              system: "系统",
              user: "你",
              openhex: "OpenHex",
            }[e.actor] || role(e.actor).job,
          )}</strong><span class="muted tiny">${date(e.created)}</span></header><p>${escape(e.data.message || e.data.summary || e.data.name || e.kind)}</p>${e.data.text ? `<details><summary class="tiny muted">查看节点产出</summary><pre>${escape(e.data.text)}</pre></details>` : ""}${e.kind === "remote_attachment" ? `<button class="btn small" data-action="download-output" data-id="${e.data.id}" data-name="${escape(e.data.name)}">取回原始附件 ↓</button>` : ""}${e.data.channel ? `<span class="pill">${escape(e.data.channel)}</span>` : ""}${e.data.sources ? `<div class="source-list">${e.data.sources.map((s) => escape(s.name || s.title || s.url)).join("<br>")}</div>` : ""}</article>`,
      )
      .join("")}</div></section></div>`;
  document
    .querySelectorAll("#content details")
    .forEach((x, i) => (x.open = opened[i] || false));
  if (document.querySelector(".stage"))
    document.querySelector(".stage").scrollTop = scroll;
  if (
    ["planning", "running", "reviewing", "revising", "delivering"].includes(
      t.status,
    )
  ) {
    clearInterval(taskTimer);
    taskTimer = setTimeout(
      () =>
        taskView(id, token).catch((e) => {
          if (token === routeToken) {
            toast(e.message);
            taskTimer = setTimeout(
              () => taskView(id, token).catch((e) => toast(e.message)),
              5000,
            );
          }
        }),
      2500,
    );
  }
}
function artifactRows(files) {
  return files
    .map(
      (f) =>
        `<div class="file-row"><span class="file-icon">${escape(f.kind.toUpperCase())}</span><div class="grow"><strong class="tiny">${escape(f.name)}</strong><div class="muted tiny" style="margin-top:6px">版本 ${f.version} · ${date(f.created || Date.now())}</div></div>${f.kind === "html" ? `<button class="btn small" data-action="preview" data-id="${f.id}">预览</button>` : ""}<a class="btn small" href="/api/artifacts/${f.id}/download">下载</a></div>`,
    )
    .join("");
}
async function artifactsView() {
  const list = await api("/artifacts");
  return (
    head("成果中心", "每一份交付都保存在这里，随时下载，继续完善。") +
    `<div class="card">${list.length ? artifactRows(list) : empty("你的成果，即将在这里出现", "给团队一个目标，完成后的文档、数据表和网页会自动归档。", '<button class="btn primary" data-action="new-task">开始第一个任务</button>')}</div>`
  );
}
async function knowledgeView() {
  const list = await api("/files");
  return (
    head("私有知识库", "原文件、文字索引与每轮附件分开管理。") +
    `<section class="knowledge-summary"><div><span class="eyebrow">PRIVATE KNOWLEDGE</span><h2>让每一次回答，都有据可依。</h2><p>把资料留在你的空间，在需要时主动启用检索。</p></div><div><strong>${list.filter((f) => f.scope === "knowledge").length}</strong><small>知识库文件</small></div><div><strong>${list.filter((f) => f.scope === "knowledge" && f.status === "ready").length}</strong><small>索引就绪</small></div></section><div class="grid two"><div class="card"><label class="dropzone"><div style="width:30px;margin:auto">${icon("upload")}</div><h3>上传并加入知识库</h3><p class="hint">每份最多20 MB · PDF、DOCX、XLSX、PPTX、文本或图片</p><input type="file" id="kb-upload" hidden accept=".docx,.xlsx,.pptx,.csv,.txt,.md,.json,.pdf,.png,.jpg,.jpeg,.webp"></label><div class="callout">文字索引在后台解析，原文件始终保留。本站不做扫描PDF的OCR；PPTX提取幻灯片文字，图片内容需另行识别。OpenHex 是否能完整读取原文件，取决于对应Agent实际工具与权限。</div></div><div class="card"><h3>试试检索</h3><form data-form="search-kb" class="form"><input name="query" required placeholder="输入问题或关键词"><button class="btn">检索知识库</button></form><div id="kb-results" class="hint">只检索“已加入知识库”且本地索引完成的文件。聊天附件不会自动参与。</div></div></div><section class="card" style="margin-top:20px"><div class="flex between"><h3>空间文件 · ${list.length}</h3><button class="btn small" data-action="refresh-files">刷新解析状态</button></div>${
      list
        .map(
          (f) =>
            `<div class="file-row"><span class="file-icon">${escape(f.name.split(".").at(-1).toUpperCase().slice(0, 5))}</span><div class="grow"><strong>${escape(f.name)}</strong><p class="hint">${formatSize(f.size)} · ${
              {
                ready: "文字索引就绪",
                parsing: "后台解析中",
                image: "图片原文件",
                scan_or_empty: "无可提取文字",
                parse_failed: "本地解析失败，原文件保留",
                original_only: "仅原文件",
              }[f.status] || escape(f.status)
            }${f.parse_error ? " · " + escape(f.parse_error) : ""}</p></div><span class="pill">${f.scope === "knowledge" ? "知识库" : "仅聊天附件"}</span><button class="btn small" data-action="file-knowledge" data-id="${f.id}" data-enabled="${f.scope === "knowledge" ? "false" : "true"}">${f.scope === "knowledge" ? "移出知识库" : "加入知识库"}</button><a class="btn small" href="/api/files/${f.id}/download">原文件</a><button class="btn ghost small" data-action="delete-file" data-id="${f.id}">删除</button></div>`,
        )
        .join("") || empty("尚未上传资料", "聊天文件与知识库文件将分开标识。")
    }</section>`
  );
}
async function pluginsView() {
  const p = await api("/plugins");
  const installed = demoPlugins.filter((x) => demoPluginState.has(x.id));
  return (
    head(
      "插件中心",
      "把常用工具放进同一个工作空间。此页为比赛演示目录，不会真实连接第三方账号。",
      '<button class="btn primary" data-action="add-plugin">＋ 添加自定义入口</button>',
    ) +
    `<div class="plugin-demo-note"><div><strong>DISPLAY-ONLY PLUGIN GALLERY</strong><span>可添加 / 已添加仅改变本地演示状态，不会授权、调用或向第三方发送任何数据。</span></div><span class="pill success">安全演示模式</span></div><section class="installed-strip"><span>已添加</span>${installed.map((x) => pluginLogo(x)).join("") || '<small class="muted">暂无演示插件</small>'}</section><div class="plugin-grid">${demoPlugins.map((x) => `<article class="plugin-card">${pluginLogo(x)}<div class="grow"><h3>${escape(x.name)}</h3><p>${escape(x.desc)}</p></div><button class="plugin-toggle ${demoPluginState.has(x.id) ? "installed" : ""}" data-action="demo-plugin-toggle" data-id="${x.id}">${demoPluginState.has(x.id) ? "✓ 已添加" : "＋ 添加"}</button></article>`).join("")}</div><h3 class="section-spacer">工程内置能力</h3><div class="grid four">${p.builtin.map((x) => `<div class="card capability-card"><span class="cap-icon">${icon("plugins")}</span><h3>${escape(x.name)}</h3><p class="muted tiny">${escape(x.description)}</p><span class="pill ${x.state === "ready" ? "success" : ""}">${x.state === "ready" ? "已接入" : session.search ? "已配置" : "待配置"}</span></div>`).join("")}</div><h3 class="section-spacer">我的自定义入口</h3><div class="card">${p.added.length ? p.added.map((x) => `<div class="file-row"><div class="grow"><h3 style="margin-bottom:7px">${escape(x.name)}</h3><span class="muted tiny">${escape(x.description)}</span></div><span class="pill">已登记 · 未接入执行</span><button class="btn small" data-action="remove-plugin" data-id="${x.id}">移除</button></div>`).join("") : empty("还没有自定义入口", "可保存名称与服务地址作为产品演示；当前不会发起外部调用。")}</div><div class="card skill-card"><div class="flex between wrap"><div><h3>导入 Skill</h3><p class="muted tiny" style="margin:0">为未来工作流保存扩展入口，当前不执行上传代码。</p></div><label class="btn">＋ 选择 Skill 文件<input type="file" id="skill-upload" accept=".md,.zip,.json,.yaml,.yml" style="display:none"></label></div></div>`
  );
}
async function statsView() {
  const s = await api("/stats");
  return (
    head("数据表现", "只记录实际发生的工作，不推算没有依据的提效数字。") +
    `<div class="grid four">${[
      ["累计任务", s.tasks],
      ["已交付任务", s.completed],
      ["成果文件", s.artifacts],
      ["资料文件", s.files],
    ]
      .map(
        ([k, v]) =>
          `<div class="card"><span class="muted tiny">${k}</span><div class="stat-number">${v}</div><span class="tiny muted">当前空间累计</span></div>`,
      )
      .join(
        "",
      )}</div><div class="card" style="margin-top:22px"><h3>对话通道</h3>${s.channels.length ? s.channels.map((c) => `<div class="file-row"><span class="grow">${escape(c.channel)}</span><strong>${c.n} 段对话</strong></div>`).join("") : empty("尚无已完成的模型对话", "配置服务后，这里会显示实际使用的通道。")}</div>`
  );
}
function discoverView() {
  const cards = [
    [
      "文档模板",
      "项目工作计划模板",
      "清晰规划，高效执行",
      "请根据我上传的项目资料，制定一份项目工作计划，明确目标、里程碑、负责人和验收标准。",
    ],
    [
      "应用案例",
      "AI 助力市场分析",
      "从数据到洞察的实践",
      "分析我上传的数据，说明数据口径、关键变化、证据与限制，并给出可执行建议。",
    ],
    [
      "提示词",
      "高效会议纪要提示词",
      "让会议内容一键结构化",
      "把我提供的会议内容整理为结论、待办、负责人、时间节点和风险。",
    ],
    [
      "行业方案",
      "品牌营销创意方案",
      "用 AI 激发更多创意",
      "基于真实产品信息制定品牌内容方案，不虚构参数。",
    ],
    [
      "学习资料",
      "AI 应用入门指南",
      "从基础到进阶的系统学习",
      "根据资料整理学习路线、核心概念、例题和复盘问题。",
    ],
  ];
  return (
    head("发现空间", "探索优质内容，激发灵感，让 AI 帮你看见更多可能。") +
    `<section class="discover-hero"><div><span class="pill">精选专题</span><h2>用 AI 打开新的工作方式</h2><p>从优秀的实践中，找到属于你的灵感。</p><button class="btn primary" data-action="template" data-prompt="帮我梳理一个可以由 AI 团队完成的工作场景，并给出可执行步骤。">立即探索 ${icon("arrow")}</button></div><div class="hero-visual"><i></i><i></i><i></i><strong>AI</strong><span>MORE<br>INSPIRATION</span></div></section><div class="discover-tabs">${["全部", "文档模板", "应用案例", "行业方案", "提示词", "学习资料"].map((x, i) => `<button data-action="discover-filter" data-id="${x}" class="${i === 0 ? "active" : ""}">${x}</button>`).join("")}</div><div class="discover-layout"><section><div class="section-title"><h3>精选内容</h3><span class="muted tiny">基于演示模板 · 可直接进入团队任务</span></div><div class="discover-cards">${cards.map(([tag, t, d, p], i) => `<article data-category="${tag}" class="discover-card dc${i}"><div class="discover-art"><span>${["Aa", "▥", "···", "✦", "▤"][i]}</span></div><small>${tag}</small><h3>${t}</h3><p>${d}</p><button data-action="template" data-prompt="${escape(p)}">使用模板 →</button></article>`).join("")}</div><div class="card lab-row"><div><span class="eyebrow">CREATIVE LAB</span><h3>创意实验室</h3><p class="muted tiny">内置项目素材供体验；游戏属于演示内容，不代表模型现场生成。</p></div><div class="flex wrap"><button class="btn" data-action="game" data-id="snake">贪吃蛇</button><button class="btn" data-action="game" data-id="xgo">星际战场</button></div></div></section><aside class="discover-aside stack"><div class="card quote-card"><b>“</b><p>好的想法<br>值得被更多人看见。</p><span>—— One Staff X AI</span></div><div class="card"><div class="section-title"><h3>热门标签</h3><small>查看更多 ›</small></div><div class="tag-cloud">${["工作总结", "产品方案", "市场营销", "数据分析", "客户服务", "运营策划", "人力资源", "行业研究", "提示词", "创意设计", "效率提升", "团队协作"].map((x) => `<span># ${x}</span>`).join("")}</div></div><div class="card ranking"><div class="section-title"><h3>大家都在看</h3><small>演示排行</small></div>${["新员工入职指南模板", "市场调研分析框架", "客户服务话术库", "产品需求文档模板", "团队周报自动生成方案"].map((x, i) => `<div><b>${i + 1}</b><span>${x}</span></div>`).join("")}</div></aside></div>`
  );
}
function settingsView() {
  return (
    head("设置与帮助", "管理空间、模型服务和你的工作偏好。") +
    speechSettings() +
    `<div class="grid two"><div class="card"><h3>我的智能空间</h3><div class="flex" style="margin:22px 0">${portrait(session.profile.avatar)}<div><strong>${escape(session.profile.name)}</strong><p class="muted tiny" style="margin:5px 0">聊天、资料、任务按访客身份隔离</p></div></div><div class="flex wrap"><button class="btn" data-action="profile">修改形象与风格</button><button class="btn" data-action="transfer">跨设备接续</button></div><div class="callout">同一浏览器会恢复你的空间。换设备请使用五分钟内有效、使用一次即失效的接续码。</div><button class="btn ghost small" data-action="new-space">开始一次全新的体验</button></div><div class="card"><h3>模型与 OpenHex</h3><p class="muted tiny">后端配置模型 API、OpenHex 工作区和员工 Agent 映射。密钥不会返回给普通访客。</p><div class="flex wrap" style="margin:22px 0"><span class="pill">${session.channel === "hybrid" ? "基座模型 + OpenHex 协作" : session.channel === "openhex" ? "OpenHex 通道" : "自建模型通道"}</span><span class="pill">${session.configured ? "已配置 · 需连接测试验证" : "尚未配置"}</span></div><button class="btn primary" data-action="admin">管理员配置</button><p class="muted tiny" style="margin-top:15px">本地首次启动生成管理员口令，位于 data/admin-password.txt。</p></div></div><div class="card" style="margin-top:22px"><h3>功能指南与用户反馈</h3><div class="grid three"><div><p class="tiny muted">第一次使用</p><button class="btn" data-action="help">打开操作指南</button></div><div><p class="tiny muted">提醒与后续跟进</p><button class="btn" data-action="reminder">管理站内提醒</button></div><div><p class="tiny muted">用户反馈 · 联系开发者</p><a class="btn" href="mailto:gubei11001@163.com?subject=OneStaff%20X%20AI%20用户反馈">gubei11001@163.com</a><p class="hint">请描述操作步骤、预期结果与实际现象，附件中遮住密钥。</p><a class="btn" href="/">重新体验星云解锁</a></div></div></div><div class="callout">商业版与任意代码执行暂未开放。当前生成的 HTML 在受限预览中运行，后端不会安装或执行模型生成的任意程序。</div>`
  );
}
async function adminView() {
  try {
    adminConfig = await api("/admin/config");
  } catch {
    modal(
      "管理员配置",
      `<form class="form" data-form="admin-login"><p class="hint">打开工程 data/admin-password.txt，复制管理员口令。</p><label>管理员口令</label><input name="password" type="password" required autocomplete="current-password"><button class="btn primary">解锁配置</button></form>`,
    );
    return;
  }
  const tests = await api("/admin/model-status");
  renderAdmin(tests);
}
function renderAdmin(tests = {}) {
  const c = adminConfig;
  const existing = $('[data-form="admin-config"]');
  const scroll = existing ? $("#dialog .dialog-body").scrollTop : 0;
  const expanded = existing
    ? [...existing.querySelectorAll("details")].map((x) => x.open)
    : null;
  modal(
    "服务控制台",
    `<form class="form service-form" data-form="admin-config">
 <div class="config-banner"><span class="eyebrow">SERVER CONFIGURATION</span><h3>配置一次，访客直接使用</h3><p>一个模型一张档案。同一厂商可以共用密钥，也可以为每个模型单独填写。</p></div>
 <section class="api-import-strip"><div><strong>上传文档配置</strong><small>TXT / MD / JSON / DOCX / 文字PDF，最大2 MB。按模板填写，预览后一次保存。</small><a href="/config-template.txt" download>下载配置模板</a></div><button class="btn primary small" type="button" data-action="import-api">上传配置文档</button></section><div id="config-errors" role="alert" hidden></div><div class="config-status" id="config-status" role="status">已读取后端配置。保存成功与接口可用是两种状态，请逐项测试。</div>
 <details open><summary>01 · 模型档案与分工</summary><div id="model-profiles">${c.providers.map((p, i) => profileFields(p, i, tests[p.id])).join("")}</div><div class="flex wrap"><button type="button" class="btn" data-action="add-profile">＋ 添加模型档案</button><button type="button" class="btn" data-action="load-presets">补入豆包与 DeepSeek 预设</button></div>
 <div class="grid two"><div><label>团队总监基座模型</label><select name="defaultProvider">${providerOptions(c, c.defaultProvider).replace('<option value="">与系统默认相同</option>', "")}</select></div><div><label>独立监察基座模型</label><select name="reviewProvider">${providerOptions(c, c.reviewProvider, "跟随总监模型（建议改用另一基座）")}</select></div></div>
 <label class="check-pill"><input type="checkbox" name="route_enabled" ${c.routing?.enabled ? "checked" : ""}> 根据任务类型自动选择直接对话模型</label><div class="grid three">${[
   ["chat", "日常交流"],
   ["code", "代码与工具规划"],
   ["reasoning", "长文与复杂推理"],
 ]
   .map(
     ([k, n]) =>
       `<div><label>${n}</label><select name="route_${k}">${providerOptions(c, c.routing?.[k])}</select></div>`,
   )
   .join(
     "",
   )}</div><p class="hint">规则顺序：复杂推理 → 编程 → 日常交流。自动选择只作用于直接模型对话；总监规划与监察使用上方固定基座，OpenHex 员工保持各自平台模型。</p>
 <label>翻译与角色气泡模型</label><select name="aux_provider">${providerOptions(c, c.auxiliary?.providerId)}</select><label>角色气泡风格</label><select name="bubble_style">${[
   ["mixed", "工作与轻松表达"],
   ["work", "工作陪伴"],
   ["life", "轻松感想"],
 ]
   .map(
     ([k, v]) =>
       `<option value="${k}" ${c.auxiliary?.bubbleStyle === k ? "selected" : ""}>${v}</option>`,
   )
   .join("")}</select></details>
 <details><summary>02 · 协作方式与 OpenHex 员工</summary><label>执行方式</label><select name="channel">${[
   ["hybrid", "推荐 · 基座总监与监察 + OpenHex 员工"],
   ["openhex", "OpenHex 员工优先 · 总监与监察仍用基座"],
   ["direct", "独立使用 · 全部走基座模型"],
 ]
   .map(
     ([k, v]) =>
       `<option value="${k}" ${c.channel === k ? "selected" : ""}>${v}</option>`,
   )
   .join(
     "",
   )}</select><p class="hint">推荐模式下，总监、监察者不需要 Agent ID；研究、分析、文案、设计、编程员工配置各自 Agent ID。单人回复始终另由基座监察模型检查。</p>${field("oh_base", "OpenHex API 地址", c.openhex.baseUrl)}<label>OpenHex 凭据类型</label><select name="oh_auth_mode"><option value="personal" ${c.openhex.authMode === "personal" ? "selected" : ""}>个人 API Key · 默认工作区（你的用法）</option><option value="workspace" ${c.openhex.authMode === "workspace" ? "selected" : ""}>工作区 API Key · 成员令牌模式</option></select>${field("oh_key", "OpenHex API Key", c.openhex.apiKey, "password", "个人 Key 来自 OpenHex 设置 → API Key；只保存在后端。")}<div id="workspace-options" ${c.openhex.authMode === "personal" ? "hidden" : ""}>${field("oh_workspace", "工作区 Slug", c.openhex.workspace, "text", "仅工作区 Key 模式使用；留空时查询所属工作区。")}</div><p class="hint">个人 Key 模式直接调用你的 Agent，不填写工作区 Slug，也不申请成员令牌。本站隔离访客聊天记录，但远端仍共用你的账号、Agent 记忆与文件资源。</p><button type="button" class="btn" data-action="load-openhex-agents">读取我的 Agent 列表</button><p id="openhex-agent-result" class="hint" role="status">先保存 Key，再读取列表；随后在员工 Agent ID 输入框选择对应 Agent。</p><datalist id="openhex-agent-ids"></datalist>
 <div class="flex wrap"><button type="button" class="btn primary" data-action="test-all-employees">一键测试全部员工</button><button type="button" class="btn" data-action="stop-employee-tests">停止后续测试</button></div><p id="batch-test-summary" role="status" class="hint">测试后端已保存配置；逐个执行，会使用服务商额度。停止后当前请求仍会完成。</p>
 ${staff.map((e) => employeeConfigFields(e, c, tests[`employee:${e.id}`])).join("")}</details>
 <details><summary>03 · Tavily 联网搜索</summary>${field("search_key", "Tavily API Key", c.search?.apiKey, "password")}<label>结果条数</label><select name="search_count">${[3, 5, 8].map((n) => `<option ${n === Number(c.search?.maxResults || 5) ? "selected" : ""}>${n}</option>`).join("")}</select></details>
 <details><summary>04 · 和风天气</summary><label class="check-pill"><input type="checkbox" name="weather_enabled" ${c.weather?.enabled ? "checked" : ""}> 启用天气</label>${field("weather_base", "控制台分配的专属 API Host", c.weather?.baseUrl, "text", "https://你的专属域名.qweatherapi.com")}${field("weather_key", "API Key", c.weather?.apiKey, "password")}${field("weather_city", "城市名称", c.weather?.city)}<div class="grid two"><div>${field("weather_lat", "纬度", c.weather?.latitude)}</div><div>${field("weather_lon", "经度", c.weather?.longitude)}</div></div></details>
 <details><summary>05 · 豆包语音识别与朗读</summary><label>语音协议</label><select name="speech_protocol"><option value="volc" ${c.speech.protocol === "volc" ? "selected" : ""}>豆包原生 HTTP</option><option value="compatible" ${c.speech.protocol !== "volc" ? "selected" : ""}>OpenAI 兼容音频接口</option></select>${field("speech_base", "ASR / 默认语音 Base URL", c.speech?.baseUrl)}${field("speech_key", "ASR / 默认语音 API Key", c.speech?.apiKey, "password")}${field("asr_model", "ASR 转写模型 ID", c.speech?.asrModel)}${field("asr_resource", "ASR Resource ID", c.speech?.asrResource || "volc.bigasr.auc_turbo")}${field("tts_base", "TTS 独立 Base URL（留空沿用）", c.speech?.ttsBaseUrl)}${field("tts_key", "TTS 独立 Key（留空沿用）", c.speech?.ttsApiKey, "password")}${field("tts_model", "TTS 合成模型 ID", c.speech?.ttsModel)}${field("tts_resource", "TTS Resource ID", c.speech?.ttsResource || "seed-tts-2.0")}${field("voice", "实际音色 ID", c.speech?.voice)}<p class="hint">语音 Key 与火山方舟文本模型 Key 属于不同服务。Resource ID 决定调用资源，需有对应权限；ASR 录音会转换为 WAV。</p></details>
 <details><summary>06 · 超时与稳定性</summary><div class="grid two">${[
   ["uploadTimeoutMs", "原文件上传 / 非流式 SDK 超时", 120, 10, 180],
   ["idleTimeoutMs", "流式无事件等待上限", 90, 15, 300],
   ["totalTimeoutMs", "单次模型调用总上限", 360, 30, 600],
   ["teamRemoteTimeoutMs", "团队远端节点接管阈值", 120, 15, 300],
 ]
   .map(
     ([k, label, seconds, min, max]) =>
       `<div><label>${label}（秒）</label><input type="number" min="${min}" max="${max}" name="timeout_${k}" value="${Math.round((c.transport?.[k] || seconds * 1000) / 1000)}"></div>`,
   )
   .join(
     "",
   )}</div><p class="hint">OpenHex 首次启动或复杂工具可能需要较长等待，可按需调高。团队超时后转总监文字接管，不自动重发远端工具任务；单次总上限不是整项多步骤任务的总时长。</p></details>
 <div class="save-services"><button type="submit" class="btn primary">保存到后端</button>${[
   ["search", "搜索"],
   ["weather", "天气"],
   ["auxiliary", "辅助模型"],
   ["tts", "TTS"],
 ]
   .map(
     ([k, v]) =>
       `<button type="button" class="btn" data-action="test-service" data-id="${k}">测试${v}</button>`,
   )
   .join(
     "",
   )}<div id="service-test-result" role="status">测试使用已保存配置；请先保存，再点击模型卡上的连接测试。</div></div></form>`,
  );
  if (expanded)
    $$(".service-form details").forEach((x, i) => {
      x.open = expanded[i] ?? false;
    });
  $("#dialog .dialog-body").scrollTop = scroll;
  collectConfigFromSavedForm = draftConfig();
}
function profileFields(p, i, test) {
  return `<section class="model-profile" data-profile-id="${escape(p.id)}"><div class="flex between wrap"><h3>${escape(p.label || p.id)}</h3><span class="pill ${test ? (test.ok ? "success" : "error") : ""}">${test ? (test.ok ? "连接测试通过" : "连接测试失败") : "待测试"}</span></div><div class="grid two"><div>${field(`p${i}_label`, "显示名称", p.label)}</div><div>${field(`p${i}_model`, "实际模型 ID", p.model)}</div></div>${field(`p${i}_base`, "Base URL", p.baseUrl)}<div class="grid two"><div><label>接口协议</label><select name="p${i}_protocol"><option value="auto" ${p.protocol === "auto" ? "selected" : ""}>自动识别（仅协议不支持时切换）</option><option value="chat" ${!p.protocol || p.protocol === "chat" ? "selected" : ""}>Chat Completions</option><option value="responses" ${p.protocol === "responses" ? "selected" : ""}>Responses</option></select></div><div><label>密钥来源</label><select name="p${i}_keyFrom"><option value="">独立密钥</option>${adminConfig.providers
    .filter((x) => x.id !== p.id)
    .map(
      (x) =>
        `<option value="${escape(x.id)}" ${x.id === p.keyFrom ? "selected" : ""}>共用 ${escape(x.label || x.id)}</option>`,
    )
    .join(
      "",
    )}</select></div></div>${field(`p${i}_key`, "API Key（共用时无需填写）", p.apiKey, "password")}<div class="flex wrap"><button type="button" class="btn small" data-action="test-profile" data-id="${escape(p.id)}">测试此模型</button><button type="button" class="btn small" data-action="duplicate-profile" data-id="${escape(p.id)}">复制为新档案</button><button type="button" class="btn small" data-action="remove-profile" data-id="${escape(p.id)}">移除档案</button></div><div class="profile-result hint" data-result="${escape(p.id)}">${test ? escape((test.error || test.reply) + " · " + date(test.testedAt)) : "已预填不代表已授权，保存后测试可用性。"}</div></section>`;
}
function configFeedback(text, error = false) {
  const el = $("#config-status");
  if (el) {
    el.textContent = text;
    el.classList.toggle("error", error);
  }
}
function employeeConfigFields(e, c, test) {
  const base = ["director", "supervisor"].includes(e.id);
  return `<section class="agent-config-row" data-employee-row="${escape(e.id)}"><div class="flex">${portrait(e.avatar)}<strong>${escape(e.name)} · ${escape(e.job)}</strong></div>${base ? '<p class="hint">使用上方指定的基座模型，无需 Agent ID。</p>' : field("agent_" + e.id, "Agent ID", c.openhex.agents?.[e.id] || "").replace("<input", '<input list="openhex-agent-ids"')}<button type="button" class="btn small" data-action="test-agent" data-id="${escape(e.id)}">测试此员工</button>${base ? "" : `<label>单人聊天模型覆盖</label><select name="single_${e.id}">${providerOptions(c, c.singleProviders?.[e.id], "跟随执行方式")}</select><button type="button" class="btn small" data-action="edit-entrypoint" data-id="${e.id}">分享入口</button>`}<p class="profile-result hint" data-employee-result="${escape(e.id)}" role="status">${test ? escape((test.ok ? "可用：" : "不可用：") + (test.error || test.reply) + " · " + date(test.testedAt)) : "未测试"}</p></section>`;
}
let employeeBatchRunning = false;
let employeeBatchStop = false;
function configHasUnsavedChanges() {
  return (
    JSON.stringify(draftConfig()) !== JSON.stringify(collectConfigFromSavedForm)
  );
}
let collectConfigFromSavedForm;
function draftConfig() {
  const form = $('[data-form="admin-config"]');
  const data = new FormData(form);
  return collectConfig(Object.fromEntries(data), data);
}
async function reminders() {
  const list = await api("/reminders");
  modal(
    "提醒与跟进",
    `<p class="muted tiny">提醒在网页打开时显示；关闭网页后不会发送系统推送，重新打开会提示已到期事项。</p><form data-form="reminder" class="form"><label>提醒内容</label><input name="title" required maxlength="100" placeholder="例如：检查项目方案反馈"><label>提醒时间</label><input type="datetime-local" name="due" required><button class="btn primary" style="margin:15px 0">添加提醒</button></form><div>${list.map((x) => `<div class="file-row"><div class="grow"><strong class="tiny">${escape(x.title)}</strong><p class="muted tiny" style="margin:5px 0">${date(x.due)} · ${x.seen ? "已读" : x.due < Date.now() ? "已到期" : "待提醒"}</p></div>${!x.seen ? `<button class="btn small" data-action="seen-reminder" data-id="${x.id}">已处理</button>` : ""}</div>`).join("")}</div>`,
  );
}
async function speech(text) {
  stopSpeech();
  if (liveAudio) {
    liveAudio.pause();
    liveAudio = null;
  }
  if ("speechSynthesis" in window) speechSynthesis.cancel();
  if (session.tts) {
    if (text.length > 5000)
      return toast("单次朗读最多5000字，请复制需要的段落单独处理");
    toast("正在合成语音…");
    const r = await fetch("/api/speech/speak", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text,
      }),
      signal: AbortSignal.timeout(150000),
    });
    if (!r.ok) throw Error((await r.json()).error);
    const url = URL.createObjectURL(await r.blob()),
      a = new Audio(url);
    audioObjectUrl = url;
    liveAudio = a;
    a.playbackRate = session.profile.speechRate ?? 1;
    a.volume = session.profile.speechVolume ?? 1;
    $("#companion")?.classList.add("speaking");
    a.onended = a.onerror = () => {
      $("#companion")?.classList.remove("speaking");
      URL.revokeObjectURL(url);
      liveAudio = null;
    };
    await a.play();
  } else if ("speechSynthesis" in window) {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "zh-CN";
    u.rate = session.profile.speechRate ?? 1;
    u.volume = session.profile.speechVolume ?? 1;
    speechSynthesis.speak(u);
    toast("使用浏览器朗读（不是已接入的语音 API）");
  } else toast("请先配置 TTS 服务");
}
async function voice() {
  return startVoiceCapture();
}
async function uploadFile(file, scope = "knowledge") {
  if (file.size > 20 * 1024 * 1024) throw Error("单个文件不能超过20 MB");
  const job = {
    name: file.name,
    size: file.size,
    progress: 0,
  };
  uploadJobs.push(job);
  if ($("#attachments")) $("#attachments").innerHTML = attachmentsHtml();
  try {
    return await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/files");
      xhr.timeout = 150000;
      xhr.withCredentials = true;
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable)
          job.progress = Math.round((e.loaded / e.total) * 100);
        if ($("#attachments")) $("#attachments").innerHTML = attachmentsHtml();
      };
      xhr.onload = () => {
        let data;
        try {
          data = JSON.parse(xhr.responseText);
        } catch {
          return reject(Error("上传响应无效"));
        }
        if (xhr.status < 200 || xhr.status >= 300)
          return reject(Error(data.error || "上传失败"));
        toast(
          `原文件已保存：${file.name}${data.status === "parsing" ? "；本地文字索引正在后台解析" : ""}`,
        );
        resolve(data);
      };
      xhr.onerror = () => reject(Error("上传连接中断，请确认后端窗口仍在运行"));
      xhr.ontimeout = () => reject(Error("上传超过150秒，请检查网络后重试"));
      const form = new FormData();
      form.append("scope", scope);
      form.append("file", file, file.name);
      xhr.send(form);
    });
  } finally {
    uploadJobs = uploadJobs.filter((x) => x !== job);
    if ($("#attachments")) $("#attachments").innerHTML = attachmentsHtml();
  }
}
function chooseFile(callback, accept = "") {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = accept;
  input.onchange = () => {
    if (input.files[0]) callback(input.files[0]).catch((e) => toast(e.message));
  };
  input.click();
}
const actions = {
  close,
  menu: () => $(".sidebar").classList.toggle("open"),
  reload: render,
  "choose-avatar": (b) => selectAvatar(b.dataset.id, b.dataset.name),
  "avatar-library": avatarLibrary,
  "pick-library": (b) => {
    selectAvatar(b.dataset.id);
    close();
  },
  "custom-avatar": customAvatar,
  "pixel-clear": () => $("#pixel").getContext("2d").clearRect(0, 0, 32, 32),
  "pixel-save": () => {
    const c = $("#pixel"),
      d = c.getContext("2d").getImageData(0, 0, 32, 32).data;
    if (!d.some((v, i) => i % 4 === 3 && v)) return toast("先画上几笔吧");
    selectAvatar(c.toDataURL("image/png"));
    close();
  },
  profile: () => {
    modal(
      "形象与工作风格",
      `<form class="form" data-form="profile"><div class="flex">${portrait(session.profile.avatar)}<div class="grow"><label>空间 / 伙伴名称</label><input name="name" value="${escape(session.profile.name)}" required maxlength="30"></div></div><label>表达风格：轻松 ↔ 严谨</label><input type="range" name="tone" min="0" max="100" value="${session.profile.tone}"><label>创造性偏好：稳健 ↔ 发散</label><input type="range" name="creativity" min="0" max="100" value="${session.profile.creativity}"><div class="flex wrap" style="margin-top:22px"><button class="btn primary">保存偏好</button><button type="button" class="btn" data-action="change-avatar">更换像素形象</button></div></form>`,
    );
  },
  "change-avatar": () => {
    close();
    goto("onboarding");
  },
  quick: (b) => {
    $("#message-input").value = b.dataset.prompt;
    $("#message-input").focus();
  },
  "send-chat": sendChat,
  "stop-chat": () => chatId && api("/chats/" + chatId + "/stop", "POST"),
  "new-chat": () => {
    if (busy) return toast("请先停止当前回复");
    chatId = null;
    chatMessages = [];
    chatFiles = [];
    renderChat();
  },
  "chat-history": async () => {
    const list = await api("/chats");
    modal(
      "历史对话",
      `<div class="history-list">${list.length ? list.map((c) => `<button data-action="open-chat" data-id="${c.id}"><strong class="tiny">${escape(c.title)}</strong><p class="muted tiny" style="margin:6px 0 0">${escape(role(c.employee).name)} · ${date(c.created)}</p></button>`).join("") : empty("还没有历史对话", "发送第一条消息开始。")}</div>`,
    );
  },
  "open-chat": async (b) => {
    if (busy) return toast("请先停止当前回复");
    const c = await api("/chats/" + b.dataset.id);
    chatId = c.id;
    chatEmployee = c.employee;
    chatMessages = c.messages;
    close();
    renderChat();
  },
  attach: () =>
    chooseFile(async (f) => {
      const result = await uploadFile(f);
      chatFiles.push(result);
      if ($("#attachments")) $("#attachments").innerHTML = attachmentsHtml();
    }, ".pdf,.docx,.xlsx,.csv,.txt,.md,.json,.png,.jpg,.jpeg,.webp"),
  "remove-attachment": (b) => {
    chatFiles = chatFiles.filter((f) => f.id !== b.dataset.id);
    $("#attachments").innerHTML = attachmentsHtml();
  },
  "copy-message": (b) =>
    navigator.clipboard
      .writeText(chatMessages[Number(b.dataset.id)].content)
      .then(() => toast("已复制")),
  speak: (b) => speech(chatMessages[Number(b.dataset.id)].content),
  voice,
  "plugins-modal": async () => {
    const p = await api("/plugins");
    modal(
      "添加插件与 Skill",
      `<div class="stack">${p.builtin.map((x) => `<div class="flex between"><div><strong class="tiny">${escape(x.name)}</strong><p class="muted tiny" style="margin:4px 0">${escape(x.description)}</p></div><span class="pill">${x.state === "ready" ? "已接入" : "需要配置"}</span></div>`).join("")}</div><div class="flex wrap" style="margin-top:22px"><button class="btn primary" data-action="add-plugin">＋ 添加插件</button><label class="btn">上传 Skill<input type="file" id="skill-upload" style="display:none" accept=".md,.zip,.json,.yaml,.yml"></label><button class="btn ghost" data-action="open-plugins">管理全部扩展</button></div>`,
    );
  },
  "open-plugins": () => {
    close();
    goto("plugins");
  },
  "add-plugin": () =>
    modal(
      "添加插件",
      `<form class="form" data-form="plugin"><label>插件名称</label><input name="name" required placeholder="例如：飞书工作助手"><label>说明</label><input name="description" placeholder="希望它完成什么工作"><label>服务地址（可选）</label><input name="url" type="url" placeholder="https://…"><div class="callout">此入口保存插件信息，当前不会自动调用外部服务，也不需要提供密钥。</div><button class="btn primary">添加到我的插件</button></form>`,
    ),
  "remove-plugin": async (b) => {
    await api("/plugins/" + b.dataset.id, "DELETE");
    render();
  },
  "new-employee": newEmployee,
  "employee-detail": (b) => {
    const e = role(b.dataset.id);
    modal(
      e.name + " · " + e.job,
      `<div style="text-align:center">${portrait(e.avatar, "portrait")}</div><p>${escape(e.description)}</p><h3>岗位指令</h3><pre class="code">${escape(e.prompt)}</pre><button class="btn primary" data-action="talk" data-id="${e.id}">与 TA 对话</button>`,
    );
  },
  "delete-employee": async (b) => {
    if (!confirm("删除这位自定义员工？已有对话仍保留。")) return;
    await api("/employees/" + b.dataset.id, "DELETE");
    staff = await api("/employees");
    render();
  },
  talk: (b) => {
    if (busy || uploadJobs.length) return toast("请先停止当前回复");
    chatEmployee = b.dataset.id;
    chatId = null;
    chatMessages = [];
    chatFiles = [];
    lastTurn = null;
    close();
    goto("chat");
  },
  "new-task": () => newTask(),
  "team-input": () => newTask($("#message-input").value),
  template: (b) => newTask(b.dataset.prompt),
  "approve-task": async (b) => {
    b.disabled = true;
    await api("/tasks/" + b.dataset.id + "/confirm", "POST", {
      approved: true,
    });
    toast("计划已确认，团队开始执行");
    render();
  },
  "cancel-task": async (b) => {
    await api("/tasks/" + b.dataset.id + "/cancel", "POST");
    render();
  },
  "retry-task": async (b) => {
    await api("/tasks/" + b.dataset.id + "/retry", "POST");
    render();
  },
  "revise-task": (b) =>
    modal(
      "继续修改成果",
      `<form class="form" data-form="revise"><input type="hidden" name="sourceTask" value="${b.dataset.id}"><label>你希望修改哪里？</label><textarea name="request" required placeholder="例如：补充实施预算，压缩背景介绍，改成面向评委的语气。"></textarea><p class="hint">将建立关联的新任务，保留原成果；新计划仍需你确认。</p><button class="btn primary">提交修改要求</button></form>`,
    ),
  "export-task": async (b) => {
    b.disabled = true;
    try {
      await api("/tasks/" + b.dataset.id + "/export", "POST", {
        kind: b.dataset.kind,
      });
      toast("已生成新的导出版本");
      render();
    } finally {
      b.disabled = false;
    }
  },
  preview: (b) =>
    modal(
      "成果预览",
      `<iframe class="preview-frame" sandbox="allow-scripts" src="/api/artifacts/${b.dataset.id}/preview" title="隔离成果预览"></iframe><p class="muted tiny">预览禁止访问外网和父页面。完整文件可下载后自行检查。</p><a class="btn primary" href="/api/artifacts/${b.dataset.id}/download">下载成果</a>`,
    ),
  "delete-file": async (b) => {
    if (!confirm("删除这份资料？删除后将不再用于新检索。")) return;
    await api("/files/" + b.dataset.id, "DELETE");
    render();
  },
  transfer: () =>
    modal(
      "跨设备接续",
      `<div class="stack"><div class="card" style="box-shadow:none;background:#f0f5ff"><h3>把当前空间带到另一台设备</h3><p class="muted tiny">先生成一次性接续码，再在另一台设备的同一网站输入。</p><button class="btn primary" data-action="generate-code">生成接续码</button><div id="transfer-code"></div></div><form class="form" data-form="resume"><label>接续已有空间</label><input name="code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" required placeholder="输入6位接续码"><button class="btn" style="margin-top:12px">进入对应空间</button></form></div>`,
    ),
  "generate-code": async () => {
    const r = await api("/session/code", "POST");
    $("#transfer-code").innerHTML =
      `<div style="font-size:32px;letter-spacing:7px;color:#3976ef;margin:18px 0">${r.code}</div><p class="tiny muted">5分钟内有效，仅可使用一次。拥有此码的人可进入当前空间。</p>`;
  },
  "new-space": async () => {
    if (
      !confirm(
        "开始新体验后，当前浏览器会进入新空间。如需回来，请先生成接续码并在其他设备接续。",
      )
    )
      return;
    await api("/session/new", "POST");
    session = await api("/session");
    chatId = null;
    chatMessages = [];
    staff = await api("/employees");
    goto("onboarding");
  },
  admin: adminView,
  reminder: reminders,
  "seen-reminder": async (b) => {
    await api("/reminders/" + b.dataset.id + "/seen", "POST");
    reminders();
  },
  "old-help": () =>
    modal(
      "开始使用 One Staff X AI",
      `<div class="stack"><p><strong>1. 配置服务</strong><br>打开设置 → 管理员配置。填写 OpenHex 个人 API Key 与 Agent ID，或填写自建模型 API，保存后测试连接。</p><p><strong>2. 上传资料</strong><br>在知识库上传产品资料、项目背景或表格；也可在聊天输入框选择附件。</p><p><strong>3. 开始工作</strong><br>普通问题直接对话；生成报告、分析数据、制作网页时，点击“交给团队”。</p><p><strong>4. 确认与交付</strong><br>查看计划后确认执行，团队执行、监察和返修均记录在任务页。通过后在成果中心下载。</p><p><strong>5. 后续修改</strong><br>进入任务详情 → 继续修改。跨设备使用右上角接续入口。</p><p class="muted tiny">工程压缩包 docs/ 中包含完整操作、部署和修改指南。密钥仅在自己的后台填写。</p></div>`,
    ),
  game: (b) =>
    modal(
      b.dataset.id === "xgo" ? "星际战场 · 仅电脑操作" : "贪吃蛇",
      `<iframe class="preview-frame" sandbox="allow-scripts allow-same-origin allow-pointer-lock" src="/games/${b.dataset.id === "xgo" ? "xgo" : "snake"}.html" title="内置游戏"></iframe>`,
    ),
  "test-connection": async (b) => {
    b.disabled = true;
    const old = b.textContent;
    b.textContent = "测试中…";
    try {
      const out = await api("/admin/test", "POST", {
        channel: b.dataset.channel,
      });
      toast(out.channel + "：" + out.reply);
    } finally {
      b.disabled = false;
      b.textContent = old;
    }
  },
  "task-capability": async (b) => {
    const v = await api("/tasks/" + b.dataset.id + "/capability", "POST");
    modal(
      "OpenHex 工具授权",
      `<p class="muted tiny">用于已在 OpenHex 配置的本站 MCP 工具。此凭证只授权本任务，30分钟有效。</p><textarea readonly id="capability-value">${escape(v.capability)}</textarea><button class="btn" data-action="copy-capability" style="margin-top:12px">复制凭证</button><div class="callout">请在 OpenHex 对话里说明任务并提供 capability。工具返回的文件可在本站成果中心下载。更多接入步骤见工程中的 OpenHex 指南。</div>`,
    );
  },
  "copy-capability": () =>
    navigator.clipboard
      .writeText($("#capability-value").value)
      .then(() => toast("已复制任务授权")),
  "toggle-kb": () => {
    if (busy) return toast("请在本轮结束后切换知识库");
    kbEnabled = !kbEnabled;
    store.setItem("onestaff_kb_enabled", kbEnabled ? "1" : "0");
    renderChat();
    toast(
      kbEnabled
        ? "私有知识库已开启：回答前优先检索"
        : "私有知识库已关闭：本次不自动检索",
    );
  },
  "demo-plugin-toggle": (b) => {
    const id = b.dataset.id;
    if (demoPluginState.has(id)) demoPluginState.delete(id);
    else demoPluginState.add(id);
    saveDemoPlugins();
    render();
  },
  "employee-avatar": (b) => {
    const v = $("#employee-avatar-value");
    if (v) v.value = b.dataset.id;
    const p = $("#employee-avatar-preview");
    if (p) p.innerHTML = portrait(b.dataset.id, "portrait");
    $$(".employee-avatar-grid button").forEach((x) =>
      x.classList.toggle("selected", x.dataset.id === b.dataset.id),
    );
  },
  "toggle-search": (b) => {
    searchEnabled = !searchEnabled;
    b.classList.toggle("selected", searchEnabled);
    if (searchEnabled && !session.search)
      toast("联网搜索尚未配置，请管理员先设置搜索 API");
  },
};
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-action]");
  if (!b) return;
  const fn = actions[b.dataset.action];
  if (fn)
    Promise.resolve()
      .then(() => fn(b, e))
      .catch((err) => {
        toast(err.message);
        b.disabled = false;
      });
});
document.addEventListener("submit", async (e) => {
  const form = e.target;
  if (!form.dataset.form) return;
  e.preventDefault();
  const submit = form.querySelector("button:not([type=button])");
  if (submit) submit.disabled = true;
  const f = new FormData(form),
    values = Object.fromEntries(f);
  try {
    switch (form.dataset.form) {
      case "onboard":
        session.profile = await api("/profile", "PATCH", {
          name: values.name,
          avatar: chosen,
          onboarded: true,
        });
        goto("chat");
        break;
      case "profile":
        session.profile = await api("/profile", "PATCH", {
          name: values.name,
          tone: Number(values.tone),
          creativity: Number(values.creativity),
        });
        close();
        render();
        break;
      case "employee":
        await api("/employees", "POST", values);
        staff = await api("/employees");
        close();
        render();
        break;
      case "task": {
        const r = await api("/tasks", "POST", {
          request: values.request,
          files: f.getAll("files"),
        });
        close();
        goto("tasks/" + r.id);
        break;
      }
      case "revise": {
        const r = await api("/tasks", "POST", values);
        close();
        goto("tasks/" + r.id);
        break;
      }
      case "plugin":
        await api("/plugins", "POST", values);
        close();
        toast("插件已添加，当前尚未接入执行");
        if (location.hash === "#plugins") render();
        break;
      case "search-kb": {
        const hits = await api("/files/search", "POST", values);
        $("#kb-results").innerHTML = hits.length
          ? hits
              .map(
                (h) =>
                  `<div style="margin-bottom:14px"><strong>${escape(h.name)}</strong> · ${escape(h.position)}<p>${escape(h.content)}</p></div>`,
              )
              .join("")
          : "当前资料中未检索到足够依据。";
        break;
      }
      case "resume":
        await api("/session/resume", "POST", values);
        close();
        location.reload();
        break;
      case "admin-login":
        await api("/admin/login", "POST", values);
        await adminView();
        break;
      case "admin-config": {
        if (employeeBatchRunning)
          throw Error("员工测试进行中，请停止后等待当前测试完成再保存。");
        const c = collectConfig(values, f);
        adminConfig = await api("/admin/config", "PUT", c);
        session = await api("/session");
        staff = await api("/employees");
        weatherAt = 0;
        renderAdmin();
        configFeedback(
          "✓ 已保存到后端 · " +
            new Date().toLocaleTimeString() +
            "。现在可以逐项测试。",
        );
        break;
      }
      case "reminder":
        await api("/reminders", "POST", {
          title: values.title,
          due: new Date(values.due).toISOString(),
        });
        await reminders();
        toast("提醒已保存");
        break;
    }
  } catch (err) {
    if (form.dataset.form === "admin-config") {
      showConfigErrors(err);
      configFeedback("保存失败：" + err.message, true);
    }
    toast(err.message);
  } finally {
    if (submit) submit.disabled = false;
  }
});
document.addEventListener("change", async (e) => {
  try {
    if (e.target.id === "kb-upload" && e.target.files[0]) {
      await uploadFile(e.target.files[0]);
      render();
    }
    if (e.target.id === "skill-upload" && e.target.files[0]) {
      const f = new FormData();
      f.append("file", e.target.files[0]);
      await api("/skills", "POST", f);
    }
    if (
      (e.target.id === "employee-import" ||
        e.target.id === "employee-import-page") &&
      e.target.files[0]
    ) {
      const file = e.target.files[0];
      if (file.size > 50000) throw Error("员工配置文件过大");
      const p = JSON.parse(await file.text());
      await api("/employees", "POST", p);
      staff = await api("/employees");
      if ($("#dialog")?.open) close();
      goto("employees");
      toast("本地智能体配置已导入");
    }
  } catch (err) {
    toast(err.message);
  }
});
window.addEventListener("hashchange", render);
async function boot() {
  try {
    session = await api("/session");
    staff = await api("/employees");
    if (!session.profile?.onboarded) {
      history.replaceState(null, "", "#onboarding");
      renderOnboarding();
    } else {
      await render();
    }
    window.dispatchEvent(new Event("onestaff:ready"));
    reminderTimer = setInterval(async () => {
      try {
        const list = await api("/reminders");
        const due = list.find((r) => !r.seen && r.due <= Date.now());
        if (due) {
          toast("提醒：" + due.title);
          await api("/reminders/" + due.id + "/seen", "POST");
        }
      } catch {}
    }, 30000);
  } catch (e) {
    $("#app").innerHTML =
      `<div class="onboarding"><h1>工作空间尚未连接</h1><p>${escape(e.message)}</p><p class="muted">请使用工程中的启动脚本，再访问本地网址。</p><button class="btn" onclick="location.reload()">重新连接</button></div>`;
  }
}
let uploadJobs = [],
  activeRequest = null,
  lastTurn = null,
  messageFrame = 0,
  bubbleEpoch = 0,
  telemetryAt = 0,
  weatherAt = 0,
  telemetryValue = null,
  weatherValue = null,
  liveAudio = null;
const viewPrefs = {
  translate: store.getItem("os_translate") === "1",
  language: store.getItem("os_language") || "en",
  bubbles: store.getItem("os_bubbles") === "1",
};
const languageNames = {
  "zh-CN": "简体中文",
  en: "英语",
  ja: "日语",
  ko: "韩语",
  fr: "法语",
  de: "德语",
  es: "西班牙语",
};
const safeHref = (v) => {
  try {
    const u = new URL(v);
    return ["https:", "http:"].includes(u.protocol) ? u.href : "#";
  } catch {
    return "#";
  }
};
function saveViewPrefs() {
  store.setItem("os_translate", viewPrefs.translate ? "1" : "0");
  store.setItem("os_language", viewPrefs.language);
  store.setItem("os_bubbles", viewPrefs.bubbles ? "1" : "0");
}
function paintWeather() {
  const e = $("#tech-weather"),
    w = weatherValue;
  if (!e || !w) return;
  e.textContent =
    w.state === "ready"
      ? `☼ ${w.city} ${w.temperature}${w.unit}${w.stale ? " · 旧数据" : ""}`
      : w.state === "error"
        ? "☼ 天气暂不可用"
        : "☼ 天气未配置";
}
function weatherInfo() {
  const w = weatherValue || {};
  modal(
    "网络与天气",
    `<p>网络图标表示联网状态；↓ 是本站实际接收速率，不代表整台电脑或运营商宽带速度。浏览器不支持网络类型检测时，仅显示在线或离线。</p><p>${w.state === "ready" ? escape(w.city) + " · " + escape(w.condition) + " · " + escape(w.temperature) + escape(w.unit) : "天气尚未配置或暂不可用"}</p><button class="btn" data-action="device-diagnostics">检查设备能力</button>`,
  );
}
function formatSize(n) {
  return n >= 1048576
    ? (n / 1048576).toFixed(1) + " MB"
    : Math.ceil((n || 0) / 1024) + " KB";
}
function turnStatusHtml() {
  if (activeRequest && busy)
    return `<span class="status-orbit"></span><div class="grow"><strong>${escape(activeRequest.message || "准备本轮请求")}</strong><small>已等待 <span id="turn-elapsed">${Math.floor((Date.now() - activeRequest.started) / 1000)}</span>s · 关闭页面不会自动撤销远端操作</small></div>`;
  if (
    lastTurn &&
    ["preparing", "running", "interrupted", "failed", "cancelled"].includes(
      lastTurn.status,
    )
  )
    return `<div class="grow"><strong>${lastTurn.status === "interrupted" ? "接收中断 · 不会重新提交问题" : lastTurn.status === "running" || lastTurn.status === "preparing" ? "后端仍在执行，请刷新历史查看" : "本轮已停止 / 未完成"}</strong><small>${escape(lastTurn.error || "已保存已收到的文本，查看平台可核对实际执行结果。")}</small></div><div class="flex wrap">${lastTurn.status === "failed" && !lastTurn.accepted && !lastTurn.acceptanceUnknown ? `<button class="btn small" data-action="prepare-retry">重新准备问题</button>` : ""}${lastTurn.canResume ? `<button class="btn small" data-action="resume-turn">恢复接收</button>` : ""}<button class="btn small" data-action="refresh-chat">刷新历史</button>${["preparing", "running", "interrupted"].includes(lastTurn.status) ? `<button class="btn small" data-action="stop-chat">停止任务</button>` : ""}<button class="btn small" data-action="platform-entry" data-id="${chatEmployee}">平台直达</button></div>`;
  return `<span class="transport-note">${["director", "supervisor"].includes(chatEmployee) ? "基座直聊 · 文档为本地片段 · 独立监察" : "原文件上传 · 会话连续 · 流式接收 · 结果可追踪"}</span>`;
}
function paintTurn() {
  if ($("#turn-status")) $("#turn-status").innerHTML = turnStatusHtml();
}
async function enqueueFiles(files) {
  if (busy || sending || uploadQueueBusy)
    return toast("当前正在发送或上传，请等待这一批完成");
  if (chatFiles.length + uploadJobs.length + files.length > 8)
    return toast("每轮最多8个附件");
  if (
    [...chatFiles, ...uploadJobs, ...files].reduce(
      (n, f) => n + (f.size || 0),
      0,
    ) >
    64 * 1024 * 1024
  )
    return toast("本轮附件合计不能超过64 MB");
  uploadQueueBusy = true;
  try {
    for (const f of files) {
      try {
        const v = await uploadFile(f, "chat");
        if (!chatFiles.some((x) => x.id === v.id)) chatFiles.push(v);
      } catch (err) {
        toast(err.message);
      }
    }
    if ($("#attachments")) $("#attachments").innerHTML = attachmentsHtml();
  } finally {
    uploadQueueBusy = false;
  }
}
async function consumeTurn(message, resume, payload) {
  if (busy) return;
  busy = true;
  const currentChat = chatId;
  let accepted = false,
    ended = false,
    hadError = false,
    remoteAccepted = resume;
  const queued = chatFiles.slice();
  activeRequest = {
    id: payload.requestId,
    chat: currentChat,
    started: Date.now(),
    message: resume ? "正在恢复接收，不重发问题" : "正在准备本轮原文件与消息",
  };
  renderChat();
  if (viewPrefs.bubbles && !resume) bubbleForTurn(payload.text);
  const timer = setInterval(() => {
    if ($("#turn-elapsed"))
      $("#turn-elapsed").textContent = Math.floor(
        (Date.now() - activeRequest.started) / 1000,
      );
  }, 1000);
  try {
    const r = await fetch(
      `/api/chats/${currentChat}/${resume ? "resume" : "send"}`,
      {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(650000),
      },
    );
    if (!r.ok) throw Error((await r.json()).error || "发送失败");
    const reader = r.body.getReader(),
      decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { value, done } = await reader.read();
      networkMeter.add(value?.byteLength || 0);
      buffer += decoder
        .decode(value || new Uint8Array(), {
          stream: !done,
        })
        .replace(/\r\n/g, "\n");
      let end;
      if (buffer.length > 2000000)
        throw Error("响应分段过大，已暂停接收，请刷新历史核对");
      while ((end = buffer.indexOf("\n\n")) >= 0) {
        const block = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const type = block.match(/^event:\s*(.*)$/m)?.[1],
          raw = block
            .split("\n")
            .filter((l) => l.startsWith("data:"))
            .map((l) => l.slice(5).trimStart())
            .join("\n");
        if (!raw) continue;
        const data = JSON.parse(raw);
        if (type === "meta") {
          accepted = true;
          message.requestId = data.requestId;
          if (!resume) {
            chatFiles = [];
            if ($("#attachments"))
              $("#attachments").innerHTML = attachmentsHtml();
          }
        }
        if (type === "token") {
          message.content += data;
          updateMessages(true);
        }
        if (type === "review") {
          message.review = data;
          paintReview();
        }
        if (type === "grounding") {
          message.grounding = data;
          updateMessages();
        }
        if (type === "sources") {
          message.sources = data;
          updateMessages();
        }
        if (type === "attachment") {
          message.outputs = [
            ...(message.outputs || []).filter((f) => f.id !== data.id),
            data,
          ];
          updateMessages();
        }
        if (type === "status") {
          if (data.phase === "waiting") remoteAccepted = true;
          activeRequest.message = data.message || "Agent 正在处理请求";
          paintTurn();
        }
        if (type === "done") {
          Object.assign(message, data, {
            content: data.text ?? message.content,
            id: data.messageId,
          });
          lastTurn = {
            status: "done",
            id: payload.requestId,
          };
          ended = true;
          updateMessages();
        }
        if (type === "error") {
          hadError = true;
          remoteAccepted = !!data.accepted;
          lastTurn = {
            id: data.requestId || payload.requestId,
            status: data.canResume ? "interrupted" : "failed",
            canResume: !!data.canResume,
            accepted: !!data.accepted,
            error: data.message,
          };
          message.interrupted = true;
          message.error = data.message;
          if (data.text && !message.content) message.content = data.text;
          if (data.messageId) message.id = data.messageId;
          toast(data.message);
          updateMessages();
        }
      }
      if (done) break;
    }
    if (!ended && !hadError)
      throw Error(
        "接收连接结束，但尚未收到完成标记。请刷新历史；不要反复重发问题。",
      );
  } catch (error) {
    toast(error.message);
    if (!hadError)
      lastTurn = {
        id: payload.requestId,
        status: accepted ? "running" : "failed",
        error: error.message,
        canResume: false,
      };
    message.interrupted = !ended;
    if (!message.content)
      message.content =
        "本轮接收未完成：" +
        error.message +
        "\n请先刷新历史核对，避免重复发起操作。";
    updateMessages();
  } finally {
    clearInterval(timer);
    busy = false;
    activeRequest = null;
    bubbleEpoch++;
    if (hadError && !remoteAccepted && !resume) {
      chatFiles = queued;
      if ($("#attachments")) $("#attachments").innerHTML = attachmentsHtml();
    }
    paintTurn();
    paintReview();
    const b = $("#send-btn");
    if (b) {
      b.textContent = "发送 ↑";
      b.dataset.action = "send-chat";
    }
    if ($("#chat-employee")) $("#chat-employee").disabled = false;
    $("#companion")?.classList.remove("thinking");
    if ($("#companion .state"))
      $("#companion .state").textContent = "READY WHEN YOU ARE";
    if (ended && viewPrefs.translate) translateMessage(message);
  }
}
async function refreshChat(id = chatId) {
  if (!id) return;
  if (busy) return toast("正在接收中；停止后再切换历史");
  const originalHash = location.hash,
    originalRoute = routeToken;
  const out = await api("/chats/" + id);
  if (location.hash !== originalHash || routeToken !== originalRoute) return;
  chatId = id;
  chatEmployee = out.employee;
  chatMessages = out.messages;
  lastTurn = out.activeTurn;
  if (
    lastTurn &&
    ["running", "preparing", "interrupted"].includes(lastTurn.status) &&
    !chatMessages.some((m) => m.id === lastTurn.messageId) &&
    lastTurn.text
  )
    chatMessages.push({
      role: "assistant",
      content: lastTurn.text,
      interrupted: true,
      requestId: lastTurn.id,
    });
  close();
  if (location.hash !== "#chat") goto("chat");
  else renderChat();
}
async function resumeTurn() {
  if (!lastTurn?.canResume || busy) return;
  const requestId = lastTurn.id;
  let m = chatMessages.findLast(
    (m) =>
      m.role === "assistant" &&
      (m.requestId === requestId || m.id === lastTurn.messageId),
  );
  if (!m) {
    m = {
      role: "assistant",
      content: lastTurn.text || "",
      outputs: [],
      sources: [],
    };
    chatMessages.push(m);
  }
  await consumeTurn(m, true, {
    requestId,
  });
}
async function translateMessage(message) {
  if (!message?.id || !message.content) return;
  const target = viewPrefs.language;
  message.translations ||= {};
  if (
    message.translations[target]?.text ||
    message.translations[target]?.loading
  )
    return;
  message.translations[target] = {
    loading: true,
  };
  updateMessages();
  try {
    const out = await api(`/messages/${message.id}/translate`, "POST", {
      target,
    });
    message.translations[target] = out;
  } catch (e) {
    message.translations[target] = {
      error: "翻译暂不可用：" + e.message,
    };
  }
  updateMessages();
}
function translateRecent() {
  const message = chatMessages.findLast((m) => m.role === "assistant" && m.id);
  if (message) translateMessage(message);
}
async function bubbleForTurn(context) {
  if (!viewPrefs.bubbles || !session.auxiliary) return;
  const epoch = bubbleEpoch,
    current = chatId;
  await new Promise((r) => setTimeout(r, 1800));
  if (!busy || epoch !== bubbleEpoch) return;
  try {
    const result = await api("/companion/bubble", "POST", {
      chatId: current,
      phase: "thinking",
      context: String(context || "").slice(0, 320),
    });
    if (!viewPrefs.bubbles || epoch !== bubbleEpoch) return;
    const el = $("#character-bubble");
    if (el) {
      el.hidden = false;
      el.innerHTML = `<p>${escape(result.text)}</p><small>${escape(result.label)}</small>`;
    }
  } catch {}
}
async function platformEntry(id) {
  const e = role(id),
    out = await api(`/employees/${encodeURIComponent(id)}/entrypoint`);
  modal(
    `${e.name} · 平台直达`,
    `<div class="platform-entry"><div class="platform-avatar">${portrait(e.avatar, "portrait")}</div><h3>继续使用 OpenHex 官方问答</h3><p class="hint">${escape(out.notice)}</p>${out.qr ? `<img class="platform-qr" src="${escape(out.qr)}" alt="管理员配置的平台二维码"><p class="hint">${out.qrSource === "uploaded" ? "管理员上传：扫码前核对手机显示的目标网址" : "根据已配置分享链接自动生成"}</p>` : ""}${out.url ? `<a class="btn primary" href="${escape(safeHref(out.url))}" target="_blank" rel="noopener noreferrer">打开平台问答 ↗</a><p class="entry-url">${escape(out.url)}</p>` : out.qr ? "" : `<div class="callout">这位员工还没有配置平台分享链接或二维码。管理员可在“设置 → 管理员配置 → 员工映射”中添加。</div>`}<button class="btn" data-action="copy-current-question">复制最近一条问题</button><p class="hint">仅复制问题文字，不自动发送历史或文件。已经受理的写文件等操作，请先在平台核对，避免重复执行。</p></div>`,
  );
}
async function downloadOutput(b) {
  b.disabled = true;
  const label = b.textContent;
  b.textContent = "取回中…";
  try {
    const r = await fetch(
      `/api/remote-outputs/${encodeURIComponent(b.dataset.id)}/download`,
      {
        credentials: "same-origin",
        signal: AbortSignal.timeout(150000),
      },
    );
    if (!r.ok) {
      let e;
      try {
        e = await r.json();
      } catch {}
      throw Error(e?.error || "文件取回失败，可前往平台下载");
    }
    const url = URL.createObjectURL(await r.blob()),
      a = document.createElement("a");
    a.href = url;
    a.download = b.dataset.name || "agent-output";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    toast("文件已取回，请查看浏览器下载列表");
  } finally {
    b.disabled = false;
    b.textContent = label;
  }
}
async function entrypointEditor(id) {
  const e = role(id),
    out = await api(`/employees/${id}/entrypoint`);
  modal(
    `${e.name} · 分享链接与二维码`,
    `<form class="form" data-form="entrypoint"><input type="hidden" name="employee" value="${id}"><label>OpenHex 网页分享链接</label><input name="url" value="${escape(out.url)}" placeholder="https://agent.openhex.tech/share/…"><p class="hint">分享链接不是 Agent ID，也不是 API Key。只填链接即可自动生成二维码。</p><label>已有二维码图片（可选）</label><input type="file" id="entry-qr-file" accept="image/png,image/jpeg,image/webp"><input type="hidden" name="qr" id="entry-qr-value" value="${escape(out.qrSource === "uploaded" ? out.qr : "")}"><div id="entry-qr-preview">${out.qrSource === "uploaded" ? `<img class="platform-qr" src="${escape(out.qr)}" alt="已上传二维码">` : ""}</div><button type="button" class="btn small" data-action="clear-qr">清除自传二维码</button><p class="hint">图片只做显示，不会解析其中内容。请管理员核对二维码与员工相符；不上传含密钥的截图。</p><button class="btn primary">保存此员工入口</button></form>`,
  );
  $("#entry-qr-file").onchange = async (x) => {
    const file = x.target.files[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) return toast("二维码图片请小于2 MB");
    try {
      const bitmap = await createImageBitmap(file),
        c = document.createElement("canvas");
      const ratio = Math.min(1, 800 / Math.max(bitmap.width, bitmap.height));
      c.width = Math.round(bitmap.width * ratio);
      c.height = Math.round(bitmap.height * ratio);
      c.getContext("2d").drawImage(bitmap, 0, 0, c.width, c.height);
      bitmap.close();
      const url = c.toDataURL("image/png");
      $("#entry-qr-value").value = url;
      $("#entry-qr-preview").innerHTML =
        `<img class="platform-qr" src="${url}" alt="待保存二维码">`;
    } catch {
      toast("无法读取图片，请使用清晰的 PNG/JPEG 二维码");
    }
  };
}
function providerOptions(c, value, empty = "与系统默认相同") {
  return (
    `<option value="">${empty}</option>` +
    c.providers
      .map(
        (p) =>
          `<option value="${p.id}" ${p.id === value ? "selected" : ""}>${escape(p.label || p.id)}</option>`,
      )
      .join("")
  );
}
function field(name, label, value = "", type = "text", hint = "") {
  return `<label>${label}</label><input type="${type}" name="${name}" value="${escape(value)}" autocomplete="${type === "password" ? "off" : "on"}">${hint ? `<p class="hint">${hint}</p>` : ""}`;
}
function collectConfig(values, form) {
  const c = structuredClone(adminConfig),
    f = form;
  c.channel = values.channel;
  c.fallback = false;
  c.openhex = {
    ...c.openhex,
    authMode: values.oh_auth_mode,
    baseUrl: values.oh_base.trim(),
    workspace: values.oh_workspace.trim(),
    apiKey: values.oh_key.trim(),
    agents: {
      ...c.openhex.agents,
    },
  };
  delete c.openhex.entrypoints;
  c.singleProviders = {
    ...c.singleProviders,
  };
  for (const e of staff) {
    c.openhex.agents[e.id] = (values["agent_" + e.id] || "").trim();
    if (values["single_" + e.id])
      c.singleProviders[e.id] = values["single_" + e.id];
    else delete c.singleProviders[e.id];
  }
  c.providers.forEach((p, i) => {
    p.label = values[`p${i}_label`].trim();
    p.protocol = values[`p${i}_protocol`];
    p.keyFrom = values[`p${i}_keyFrom`] || "";
    p.baseUrl = values[`p${i}_base`].trim();
    p.model = values[`p${i}_model`].trim();
    p.apiKey = values[`p${i}_key`].trim();
  });
  c.defaultProvider = values.defaultProvider;
  c.reviewProvider = values.reviewProvider;
  c.routing = {
    enabled: f.has("route_enabled"),
    chat: values.route_chat,
    code: values.route_code,
    reasoning: values.route_reasoning,
  };
  c.auxiliary = {
    providerId: values.aux_provider,
    bubbleStyle: values.bubble_style,
  };
  c.search = {
    apiKey: values.search_key.trim(),
    maxResults: Number(values.search_count),
  };
  c.weather = {
    enabled: f.has("weather_enabled"),
    baseUrl: values.weather_base.trim(),
    apiKey: values.weather_key.trim(),
    city: values.weather_city.trim(),
    latitude: values.weather_lat.trim(),
    longitude: values.weather_lon.trim(),
  };
  c.speech = {
    protocol: values.speech_protocol,
    asrResource: values.asr_resource.trim(),
    ttsResource: values.tts_resource.trim(),
    baseUrl: values.speech_base.trim(),
    apiKey: values.speech_key.trim(),
    asrModel: values.asr_model.trim(),
    ttsBaseUrl: values.tts_base.trim(),
    ttsApiKey: values.tts_key.trim(),
    ttsModel: values.tts_model.trim(),
    voice: values.voice.trim(),
  };
  c.transport = {
    ...c.transport,
  };
  for (const k of [
    "uploadTimeoutMs",
    "idleTimeoutMs",
    "totalTimeoutMs",
    "teamRemoteTimeoutMs",
  ]) {
    const v = Number(values["timeout_" + k]);
    if (Number.isFinite(v) && v > 0) c.transport[k] = v * 1000;
  }
  return c;
}
function setupExperience() {
  Object.assign(actions, {
    "refresh-files": () => render(),
    "file-knowledge": async (b) => {
      await api("/files/" + b.dataset.id + "/knowledge", "PATCH", {
        enabled: b.dataset.enabled === "true",
      });
      render();
    },
    "weather-info": weatherInfo,
    "platform-entry": (b) => platformEntry(b.dataset.id || chatEmployee),
    "edit-entrypoint": (b) => {
      if (
        !confirm(
          "打开分享入口会离开当前配置表单。请先保存尚未提交的配置。继续？",
        )
      )
        return;
      return entrypointEditor(b.dataset.id);
    },
    "clear-qr": () => {
      $("#entry-qr-value").value = "";
      $("#entry-qr-preview").innerHTML = "";
    },
    "copy-current-question": async () => {
      const text =
        $("#message-input")?.value.trim() ||
        chatMessages.findLast((m) => m.role === "user")?.content ||
        "";
      if (!text) return toast("没有可复制的问题");
      await navigator.clipboard.writeText(text);
      toast("已复制问题文字；未发送到平台");
    },
    "download-output": downloadOutput,
    "resume-turn": resumeTurn,
    "refresh-chat": () => refreshChat(),
    "translate-message": (b) =>
      translateMessage(chatMessages[Number(b.dataset.id)]),
    "stop-chat": async () => {
      if (!chatId) return;
      await api(`/chats/${chatId}/stop`, "POST");
      toast("已发送停止请求。已完成的外部操作不会被撤销；请核对平台结果");
      if (!busy) await refreshChat();
    },
    attach: () => {
      const input = document.createElement("input");
      input.type = "file";
      input.multiple = true;
      input.accept =
        ".pdf,.docx,.xlsx,.csv,.txt,.md,.json,.pptx,.png,.jpg,.jpeg,.webp";
      input.onchange = () => enqueueFiles([...input.files]);
      input.click();
    },
    "remove-attachment": (b) => {
      if (busy) return;
      chatFiles = chatFiles.filter((f) => f.id !== b.dataset.id);
      if ($("#attachments")) $("#attachments").innerHTML = attachmentsHtml();
    },
    "new-chat": () => {
      if (busy || sending || uploadJobs.length || uploadQueueBusy)
        return toast("请先结束当前请求或上传");
      savedDraft = "";
      if ($("#message-input")) $("#message-input").value = "";
      chatId = null;
      lastTurn = null;
      chatMessages = [];
      chatFiles = [];
      renderChat();
      toast("已开启新的隔离对话；不会续接其他历史");
    },
    "chat-history": async () => {
      if (busy) return toast("请先结束当前接收");
      const list = await api("/chats");
      modal(
        "对话历史 · 按员工隔离",
        `<div class="stack">${
          list
            .filter((c) => c.employee === chatEmployee)
            .map(
              (c) =>
                `<button class="history-row" data-action="load-flow-chat" data-id="${c.id}"><strong>${escape(c.title)}</strong><small>${date(c.created)} · ${escape(c.channel || "尚未调用")}</small></button>`,
            )
            .join("") || '<p class="hint">当前员工没有历史对话。</p>'
        }</div>`,
      );
    },
    "load-flow-chat": (b) => refreshChat(b.dataset.id),
    "prepare-retry": async () => {
      const m = chatMessages.findLast((m) => m.role === "user");
      if (!m) return;
      if ($("#message-input")) $("#message-input").value = m.content;
      const files = await api("/files");
      chatFiles = files.filter((f) =>
        (m.files || []).some((x) => x.id === f.id),
      );
      if ($("#attachments")) $("#attachments").innerHTML = attachmentsHtml();
      toast("问题与仍存在的附件已填回；请核对后自行点击发送，不会自动执行");
    },
    talk: (b) => {
      if (busy || sending || uploadQueueBusy)
        return toast("请先结束当前接收或上传");
      if (b.dataset.id === "team") {
        close();
        return goto("tasks");
      }
      savedDraft = "";
      chatEmployee = b.dataset.id;
      chatId = null;
      lastTurn = null;
      chatMessages = [];
      chatFiles = [];
      close();
      if (location.hash === "#chat") renderChat();
      else goto("chat");
    },
    "test-service": async (b) => {
      b.disabled = true;
      const box = $("#service-test-result");
      if (box) box.textContent = "正在真实测试，请等待…";
      try {
        const v = await api("/admin/services/test", "POST", {
          service: b.dataset.id,
        });
        if (box)
          box.textContent =
            `测试通过 · ${(v.elapsedMs / 1000).toFixed(1)}s · ` +
            (v.result.text ||
              v.result.message ||
              v.result.condition ||
              `返回 ${v.result.results?.length ?? 0} 条结果`);
      } catch (e) {
        if (box) box.textContent = "测试未通过：" + (e.diagnosis || e.message);
      } finally {
        b.disabled = false;
      }
    },
    help: () =>
      modal(
        "OneStaff X AI · 开始使用",
        `<div class="stack"><p>先保存 API 配置并测试，再通过工作台发送文字或原文件。聊天附件只属于本轮，不会自动进入私有知识库。</p><p>网络中断时先刷新历史：后端可能仍在运行。出现“恢复接收”时仅恢复输出，不重新发题；平台直达使用独立入口。</p><p>团队先规划、用户确认后执行；监察不通过会保留原稿，等待用户提出修订，不会自行重写。</p><a class="btn primary" href="/USER_GUIDE.html" target="_blank" rel="noopener">打开完整操作手册 ↗</a></div>`,
      ),
  });
  document.addEventListener("submit", async (e) => {
    if (e.target.dataset.form !== "entrypoint") return;
    e.preventDefault();
    const form = e.target,
      button = form.querySelector("button:not([type=button])");
    button.disabled = true;
    try {
      const v = Object.fromEntries(new FormData(form));
      await api(`/admin/employees/${v.employee}/entrypoint`, "PUT", {
        url: v.url,
        qr: v.qr,
      });
      staff = await api("/employees");
      toast("员工分享入口已保存");
      await adminView();
    } catch (err) {
      toast(err.message);
    } finally {
      button.disabled = false;
    }
  });
  window.addEventListener("beforeunload", (e) => {
    if (busy || sending || uploadJobs.length || uploadQueueBusy) {
      e.preventDefault();
      e.returnValue = "";
    }
  });
}
setupExperience();
boot();
function reviewPanel() {
  const last = chatMessages.findLast((m) => m.role === "assistant"),
    r = last?.review;
  const pending = busy && !r;
  const state = pending ? "queued" : r?.state || "idle";
  const title = {
    clear: "未发现异常",
    warning: "发现预警",
    unavailable: "监察未完成",
    checking: "监察检查中",
    queued: "等待回复完成",
    idle: "等待本轮检查",
  }[state];
  return `<div class="review-heading ${state}"><span>◇ 监察者意见</span><strong>${title}</strong></div><p>${escape(r?.summary || (chatEmployee === "team" ? "团队执行后，监察结论会保存在任务详情中。" : "回复生成后自动独立复核；尚无检查结果。"))}</p>${r?.issues?.length ? `<ul>${r.issues.map((x) => `<li>${escape(x)}</li>`).join("")}</ul>` : ""}<small>检查范围：可见回复及引用信息。远端工具权限由 OpenHex 控制。</small>`;
}
function paintReview() {
  const el = $("#review-panel");
  if (el) el.innerHTML = reviewPanel();
}
function teamTree(t) {
  const events = t?.events || [];
  const start = events.findLastIndex((e) => e.kind === "planning");
  const current = events.slice(Math.max(0, start));
  const terminal = ["failed", "cancelled", "interrupted"].includes(t?.status);
  const steps =
    t?.plan?.steps ||
    ["researcher", "analyst", "writer", "designer", "coder"].map((r, i) => ({
      id: "idle" + i,
      role: r,
      action: role(r).description || "等待任务分配",
      depends: [],
    }));
  const node = (id, action, state, extra = "") =>
    `<div class="tree-node ${state}">${portrait(role(id).avatar)}<div><strong>${escape(role(id).name)} <small>${escape(role(id).job)}</small></strong><p>${escape(action)}</p>${extra}</div><span class="tree-state">${
      {
        idle: "空闲",
        running: "进行中",
        done: "已完成",
        blocked: "已中止",
        warning: "需处理",
      }[state]
    }</span></div>`;
  const work = steps
    .map((s) => {
      const done = current.some(
          (e) => e.kind === "step_done" && e.data.node === s.id,
        ),
        started = current.some(
          (e) => e.kind === "step_start" && e.data.node === s.id,
        );
      return node(
        s.role,
        s.action,
        done ? "done" : started ? (terminal ? "blocked" : "running") : "idle",
        (s.depends.length
          ? `<small>依赖 ${s.depends.map(escape).join("、")}</small>`
          : "") +
          (t
            ? `<button class="btn small node-open" data-action="view-node" data-task="${t.id}" data-node="${s.id}">查看节点${done ? "产出" : "草稿"}</button>`
            : ""),
      );
    })
    .join("");
  return `<section class="card team-tree"><div class="section-title"><div><span class="eyebrow">TEAM STRUCTURE / LIVE STATUS</span><h2>每一份工作，都有明确归属</h2></div><span class="pill">${t ? "根据执行事件更新" : "等待新任务"}</span></div><div class="tree-root">${node("director", t?.plan?.summary || "理解目标、制定计划、汇总交付", t ? (terminal ? "blocked" : ["planning", "running"].includes(t.status) ? "running" : "done") : "idle")}</div><div class="tree-branches">${work}</div><div class="tree-review">${node("supervisor", t?.review?.summary || "独立检查需求覆盖、依据和交付完整性", t?.review ? (t.review.pass ? "done" : "warning") : t?.status === "reviewing" ? "running" : "idle")}</div></section>`;
}
actions.help = () =>
  modal(
    "功能指南",
    `<div class="guide-content"><p>从一个目标开始，也可以选择一位员工单独对话。</p>${[
      [
        "工作台",
        "默认进入团队协作：输入目标并发送，阅读总监生成的计划，点击确认后执行。顶部下拉框可切换单独员工；单人历史和团队任务分别保存。",
      ],
      [
        "单人对话与监察",
        "选择员工、输入问题、发送。回复流式显示，输入框下方会显示监察意见及原因。检查失败会明确提示，不能视为通过。平台直达离开本站，不受本站监察。",
      ],
      [
        "数字员工",
        "首张卡片进入团队。点击自定义员工填写姓名、岗位和指令，或上传 JSON 角色配置。管理员可将新员工映射到 OpenHex Agent；导入 JSON 不会安装或执行本地代码。",
      ],
      [
        "团队协作",
        "任务树展示负责人、工作内容、依赖和状态。先确认计划，再执行。监察未通过保留草稿；点击继续修改可创建修订任务。取消会停止后续流程，不能撤销远端已发生的操作。",
      ],
      [
        "附件与私有知识库",
        "聊天＋原文件只发送本轮附件；知识库页面上传或加入后才参与主动检索。工作台知识库开关控制新请求。关闭开关不删除旧会话上下文，严格隔离请新建对话。",
      ],
      [
        "成果中心",
        "查看已生成的成果，下载 Word、表格、PPT、PDF、Markdown 或 HTML。HTML 隔离预览。Agent 返回附件未经二进制审查，应检查文件内容。",
      ],
      [
        "联网搜索",
        "工作台点击联网 ON 后查询 Tavily 并附来源；团队研究步骤在已配置时使用。未配置会提示，不编造检索结果。",
      ],
      [
        "语音与翻译",
        "语音按钮开始录音，再点结束；识别文字填入输入框，确认后发送。回复下方可以朗读。翻译与角色气泡需单独开启，由辅助模型处理并产生用量。",
      ],
      [
        "插件中心与发现空间",
        "插件目录显示品牌图标；添加仅收藏演示入口，真实工具权限在 OpenHex 配置。发现空间按分类筛选模板，点击使用模板生成团队任务。",
      ],
      [
        "空间与提醒",
        "设置中修改形象、称呼及风格。右上角生成接续码，在另一设备接续同一空间。站内提醒仅在网页打开时触发；新访客自动创建隔离空间。",
      ],
      [
        "配置与反馈",
        "管理员在服务控制台保存模型和服务密钥，访客无需填写。保存后逐张测试模型。发现问题请发邮件至 gubei11001@163.com，说明页面、步骤与现象。",
      ],
    ]
      .map(
        ([title, body], i) =>
          `<section><h3>${String(i + 1).padStart(2, "0")} ${title}</h3><p>${body}</p></section>`,
      )
      .join(
        "",
      )}<a class="btn" href="/USER_GUIDE.html" target="_blank">打开完整操作指南</a></div>`,
  );
actions["discover-filter"] = (b) => {
  $$(".discover-tabs button").forEach((x) =>
    x.classList.toggle("active", x === b),
  );
  $$(".discover-card").forEach(
    (x) =>
      (x.hidden =
        b.dataset.id !== "全部" && x.dataset.category !== b.dataset.id),
  );
};
actions["add-profile"] = () => {
  adminConfig = draftConfig();
  if (adminConfig.providers.length >= 30) return toast("最多30个模型档案");
  adminConfig.providers.push({
    id: "model-" + Date.now().toString(36),
    label: "新模型",
    baseUrl: "https://api.deepseek.com",
    protocol: "chat",
    model: "",
    apiKey: "",
    keyFrom: "",
  });
  renderAdmin();
  configFeedback("已添加到草稿，请填写后保存。");
};
actions["duplicate-profile"] = (b) => {
  adminConfig = draftConfig();
  if (adminConfig.providers.length >= 30) return toast("最多30个模型档案");
  const p = adminConfig.providers.find((p) => p.id === b.dataset.id);
  adminConfig.providers.push({
    ...p,
    id: "model-" + Date.now().toString(36),
    label: p.label + " 副本",
    apiKey: "",
    keyFrom: p.keyFrom || p.id,
  });
  renderAdmin();
  configFeedback("已复制模型档案，共用原密钥；修改名称与模型 ID 后保存。");
};
actions["remove-profile"] = (b) => {
  adminConfig = draftConfig();
  const id = b.dataset.id,
    c = adminConfig;
  const refs = [
    c.defaultProvider,
    c.reviewProvider,
    c.auxiliary.providerId,
    ...Object.values(c.singleProviders),
    ...(c.routing.enabled
      ? [c.routing.chat, c.routing.code, c.routing.reasoning]
      : []),
  ];
  if (refs.includes(id) || c.providers.some((p) => p.keyFrom === id))
    return configFeedback(
      "此档案仍被分工或其他档案引用，请先更换相关选择。",
      true,
    );
  if (c.providers.length === 1) return;
  adminConfig.providers = c.providers.filter((p) => p.id !== id);
  renderAdmin();
  configFeedback("档案已从草稿移除，保存后生效。");
};
actions["load-presets"] = async () => {
  adminConfig = draftConfig();
  const presets = await api("/admin/presets");
  for (const p of presets)
    if (!adminConfig.providers.some((x) => x.id === p.id))
      adminConfig.providers.push(p);
  renderAdmin();
  configFeedback("已补入缺少的预设，保留现有档案；请检查分工后保存。");
};
actions["test-profile"] = async (b) => {
  if (configHasUnsavedChanges())
    return toast("配置尚未保存，请先保存到后端再测试。");
  const box = document.querySelector('[data-result="' + b.dataset.id + '"]');
  b.disabled = true;
  box.textContent = "正在测试后端已保存的模型…";
  try {
    const out = await api("/admin/test", "POST", {
      channel: "direct",
      providerId: b.dataset.id,
    });
    box.textContent =
      "✓ 测试通过 · " +
      (out.elapsedMs / 1000).toFixed(1) +
      " 秒 · " +
      out.reply;
    const pill = b.closest(".model-profile").querySelector(".pill");
    pill.textContent = "连接测试通过";
    pill.className = "pill success";
    configFeedback("模型连接测试通过：" + out.channel);
  } catch (e) {
    box.textContent = "测试失败：" + (e.diagnosis || e.message);
    const pill = b.closest(".model-profile").querySelector(".pill");
    pill.textContent = "连接测试失败";
    pill.className = "pill error";
    configFeedback("连接测试失败：" + e.message, true);
  } finally {
    b.disabled = false;
  }
};
async function wavRecording(blob) {
  const Context = window.AudioContext || window.webkitAudioContext;
  const context = new Context();
  try {
    const decoded = await context.decodeAudioData(await blob.arrayBuffer());
    const rate = 16000;
    const offline = new OfflineAudioContext(
      1,
      Math.ceil(decoded.duration * rate),
      rate,
    );
    const src = offline.createBufferSource();
    src.buffer = decoded;
    src.connect(offline.destination);
    src.start();
    const audio = await offline.startRendering(),
      samples = audio.getChannelData(0),
      buffer = new ArrayBuffer(44 + samples.length * 2),
      view = new DataView(buffer);
    const str = (offset, value) => {
      for (let i = 0; i < value.length; i++)
        view.setUint8(offset + i, value.charCodeAt(i));
    };
    str(0, "RIFF");
    view.setUint32(4, 36 + samples.length * 2, true);
    str(8, "WAVE");
    str(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, rate, true);
    view.setUint32(28, rate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    str(36, "data");
    view.setUint32(40, samples.length * 2, true);
    samples.forEach((v, i) =>
      view.setInt16(
        44 + i * 2,
        Math.max(-1, Math.min(1, v)) * (v < 0 ? 32768 : 32767),
        true,
      ),
    );
    return new Blob([buffer], {
      type: "audio/wav",
    });
  } finally {
    await context.close();
  }
}
actions["test-agent"] = async (b) => {
  if (employeeBatchRunning) return;
  if (configHasUnsavedChanges())
    return toast("配置尚未保存，请先保存到后端再测试。");
  return testEmployee(b);
};
async function testEmployee(b) {
  const box = document.querySelector(
    `[data-employee-result="${CSS.escape(b.dataset.id)}"]`,
  );
  b.disabled = true;
  box.textContent = "测试中…";
  box.dataset.state = "running";
  try {
    const out = await api("/admin/test", "POST", {
      employeeTest: true,
      role: b.dataset.id,
    });
    box.textContent = `可用 · ${out.channel} · ${(out.elapsedMs / 1000).toFixed(1)} 秒\n${out.reply}`;
    box.dataset.state = "success";
    return true;
  } catch (e) {
    box.textContent = "不可用：\n" + (e.diagnosis || e.message);
    box.dataset.state = "error";
    return false;
  } finally {
    b.disabled = false;
  }
}
actions["test-all-employees"] = async (b) => {
  if (employeeBatchRunning) return;
  if (configHasUnsavedChanges())
    return toast("配置尚未保存，请先保存到后端再测试。");
  employeeBatchRunning = true;
  employeeBatchStop = false;
  b.disabled = true;
  const form = b.closest("form");
  const summary = form.querySelector("#batch-test-summary");
  const buttons = [...form.querySelectorAll('[data-action="test-agent"]')];
  const controls = [...form.querySelectorAll("input,select,button")].filter(
    (x) => x.dataset.action !== "stop-employee-tests",
  );
  const disabledBefore = controls.map((x) => x.disabled);
  controls.forEach((x) => {
    x.disabled = true;
  });
  let ok = 0,
    failed = 0;
  try {
    for (const button of buttons) {
      if (employeeBatchStop || !form.isConnected) break;
      summary.textContent = `正在测试 ${ok + failed + 1}/${buttons.length} · 可用 ${ok} · 不可用 ${failed}`;
      if (await testEmployee(button)) ok++;
      else failed++;
    }
  } finally {
    summary.textContent = `${employeeBatchStop ? "已停止" : "测试结束"} · 可用 ${ok} · 不可用 ${failed} · 未测试 ${buttons.length - ok - failed}`;
    employeeBatchRunning = false;
    controls.forEach((x, i) => {
      x.disabled = disabledBefore[i];
    });
    b.disabled = false;
  }
};
actions["stop-employee-tests"] = () => {
  employeeBatchStop = true;
};
$("#dialog").addEventListener("close", () => {
  employeeBatchStop = true;
});
document.addEventListener("input", (e) => {
  if (e.target.closest('[data-form="admin-config"]')) {
    const el = $("#config-status");
    if (el) {
      el.textContent = "有未保存的更改。保存到后端后，新的配置才会生效。";
      el.classList.remove("error");
    }
  }
});
const singleChatHistory = actions["chat-history"];
actions["chat-history"] = (b) =>
  chatEmployee === "team" ? goto("tasks") : singleChatHistory(b);
document.addEventListener("change", (e) => {
  if (e.target.name === "oh_auth_mode")
    $("#workspace-options").hidden = e.target.value !== "workspace";
});
actions["load-openhex-agents"] = async (b) => {
  b.disabled = true;
  const result = $("#openhex-agent-result");
  result.textContent = "正在读取已保存凭据下的 Agent…";
  try {
    const out = await api("/admin/openhex/agents");
    $("#openhex-agent-ids").innerHTML = out.agents
      .map((x) => `<option value="${escape(x.id)}">${escape(x.name)}</option>`)
      .join("");
    result.textContent = `已读取 ${out.agents.length} 个 Agent。点击下方员工的 Agent ID 输入框选择，也可手动粘贴。`;
    configFeedback("Agent 列表读取成功；员工映射修改后需再次保存。");
  } catch (e) {
    result.textContent = "读取失败：" + (e.diagnosis || e.message);
    configFeedback(result.textContent, true);
  } finally {
    b.disabled = false;
  }
};
function showConfigErrors(error) {
  const form = $('[data-form="admin-config"]');
  if (!form) return;
  form
    .querySelectorAll("[aria-invalid]")
    .forEach((x) => x.removeAttribute("aria-invalid"));
  const errors = error.errors?.length
    ? error.errors
    : [
        {
          field: error.field,
          message: error.message,
        },
      ];
  const names = {
    "weather.baseUrl": "weather_base",
    "weather.latitude": "weather_lat",
    "weather.longitude": "weather_lon",
    "openhex.baseUrl": "oh_base",
    "openhex.authMode": "oh_auth_mode",
    "speech.baseUrl": "speech_base",
    "speech.ttsBaseUrl": "tts_base",
    "speech.protocol": "speech_protocol",
    defaultProvider: "defaultProvider",
  };
  for (const e of errors) {
    let name = names[e.field];
    if (e.field?.startsWith("providers.")) {
      const [, id, key] = e.field.split("."),
        i = adminConfig.providers.findIndex((p) => p.id === id);
      name = `p${i}_${
        {
          baseUrl: "base",
          apiKey: "key",
        }[key] || key
      }`;
    }
    if (e.field?.startsWith("openhex.agents."))
      name = "agent_" + e.field.split(".").at(-1);
    const input = name ? form.elements.namedItem(name) : null;
    if (input) {
      input.setAttribute("aria-invalid", "true");
      const section = input.closest("details");
      if (section) section.open = true;
    }
  }
  const box = $("#config-errors");
  if (box) {
    box.hidden = false;
    box.innerHTML =
      "<strong>请检查以下具体配置项</strong>" +
      errors.map((e) => "<p>" + escape(e.message) + "</p>").join("");
    box.scrollIntoView({
      block: "nearest",
    });
  }
}
let pendingApiImport = null;
actions["import-api"] = () => {
  const picker = document.createElement("input");
  picker.type = "file";
  picker.accept = ".txt,.md,.json,.docx,.pdf";
  picker.onchange = async () => {
    const file = picker.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024)
      return toast("请选择2 MB以内的配置文档，提取文字不超过64 KB。");
    try {
      if (
        !confirm(
          "将读取所选文件并发送给当前 OneStaff 后端用于配置预览。请确认这是你自己的本地服务；未保存的表单修改不会合并。继续？",
        )
      )
        return;
      const form = new FormData();
      form.append("file", file);
      const out = await api("/admin/import-api/preview", "POST", form);
      pendingApiImport = out.token;
      modal(
        "API 配置导入预览",
        `<section class="import-preview"><span class="eyebrow">REVIEW BEFORE APPLY</span><h3>这些配置将写入后端</h3>${out.changes.map((x) => "<p>✓ " + escape(x) + "</p>").join("")}<div class="callout">${out.warnings.map((x) => "<p>" + escape(x) + "</p>").join("")}</div><p class="hint">此处不显示密钥。确认后以加密形式保存；原文件不会复制进工程目录。预览 5 分钟后过期。</p><div class="flex wrap"><button class="btn primary" data-action="apply-api-import">确认导入并保存</button><button class="btn" data-action="cancel-api-import">返回配置</button></div></section>`,
      );
    } catch (e) {
      showConfigErrors(e);
      toast(e.message);
    }
  };
  picker.click();
};
actions["apply-api-import"] = async (b) => {
  if (!pendingApiImport) return toast("请重新选择文件");
  b.disabled = true;
  try {
    adminConfig = await api("/admin/import-api/apply", "POST", {
      token: pendingApiImport,
    });
    pendingApiImport = null;
    session = await api("/session");
    staff = await api("/employees");
    renderAdmin();
    configFeedback(
      "✓ API 文件已导入后端。请逐项测试；Agent ID 留空不会被自动猜测。",
    );
  } catch (e) {
    toast(e.message);
    b.disabled = false;
  }
};
actions["cancel-api-import"] = () => {
  pendingApiImport = null;
  return adminView();
};
function teamRuntimeBanner(t) {
  const rt =
    typeof t.runtime === "string"
      ? (() => {
          try {
            return JSON.parse(t.runtime);
          } catch {
            return {};
          }
        })()
      : t.runtime || {};
  if (!rt.mode) return "";
  return `<section class="team-runtime ${rt.mode === "dual" ? "dual" : ""}"><span class="runtime-symbol">${rt.mode === "dual" ? "◈" : "✧"}</span><div><strong>${rt.mode === "dual" ? "总监 + 监察者正在配合" : "OpenHex 员工协作模式"}</strong><p>${escape(rt.reason || "总监负责规划与汇总，监察者独立复核。")}</p>${rt.issues?.length ? "<small>存在待核验事项，结果会明确保留为草稿。</small>" : ""}</div></section>`;
}
window.addEventListener("offline", () =>
  toast("网络已断开。已提交的请求可能仍在后端执行，请恢复网络后先刷新历史。"),
);
window.addEventListener("online", () => {
  toast("网络已恢复。请先刷新历史查看上轮结果，不会自动重发问题。");
});
