import { readFile } from "node:fs/promises";
export const validRequestId = (s) =>
  typeof s === "string" && /^[a-zA-Z0-9_-]{8,80}$/.test(s);
export function validateAgentRequest(request, strictIds = false) {
  const issues = [];
  const uuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (typeof request.message !== "string" || !request.message.trim())
    issues.push({
      path: ["message"],
      message: "必须是非空文字，只有附件时也请附一句任务说明。",
    });
  if (
    !request.conversationId &&
    (!Array.isArray(request.targetAgentIds) ||
      !request.targetAgentIds.length ||
      request.targetAgentIds.length > 10)
  )
    issues.push({
      path: ["targetAgentIds"],
      message: "新对话必须指定1至10个Agent ID。",
    });
  for (const [i, id] of (Array.isArray(request.targetAgentIds)
    ? request.targetAgentIds
    : []
  ).entries())
    if (typeof id !== "string" || !id || (strictIds && !uuid.test(id)))
      issues.push({
        path: ["targetAgentIds", i],
        message:
          "必须填写控制台 /console/ 后的完整UUID，不能填写名称、分享token或短ID。",
      });
  for (const key of ["conversationId", "parts", "senderName", "senderAvatar"])
    if (key in request && (request[key] === null || request[key] === ""))
      issues.push({
        path: [key],
        message: "没有值时应省略此字段，不能传null或空字符串。",
      });
  if (request.parts !== undefined && !Array.isArray(request.parts))
    issues.push({
      path: ["parts"],
      message: "附件必须为数组，无附件时省略字段。",
    });
  for (const [i, part] of (Array.isArray(request.parts)
    ? request.parts
    : []
  ).entries()) {
    const valid =
      part?.type === "text"
        ? typeof part.text === "string" && !!part.text.trim()
        : part?.type === "image_url"
          ? typeof part.image_url?.url === "string" && !!part.image_url.url
          : part?.type === "file" &&
            typeof part.file?.filename === "string" &&
            !!part.file.filename.trim() &&
            typeof part.file?.file_url === "string" &&
            !!part.file.file_url;
    if (!valid)
      issues.push({
        path: ["parts", i],
        message:
          "附件结构无效；文件需要filename和file_url，图片需要image_url.url。",
      });
  }
  if (issues.length)
    throw Object.assign(Error("发送前请求体检查失败"), {
      status: 400,
      body: { issues },
    });
  return request;
}
export function buildAgentInput({
  inputText,
  messages = [],
  remote,
  styleInstruction,
}) {
  if (typeof inputText === "string")
    return !remote && styleInstruction
      ? `${styleInstruction}\n\n${inputText}`
      : inputText;
  const last = messages.findLast((m) => m.role === "user");
  const text = typeof last?.content === "string" ? last.content : "";
  const instruction = !remote
    ? messages
        .filter((m) => m.role === "system")
        .map((m) => m.content)
        .join("\n")
    : "";
  return instruction ? `${instruction}\n\n${text}` : text;
}
export function safeShareUrl(value) {
  if (!value) return "";
  const u = new URL(String(value).trim());
  if (
    u.protocol !== "https:" ||
    u.hostname !== "agent.openhex.tech" ||
    !/^\/share\/[a-zA-Z0-9_-]+\/?$/.test(u.pathname) ||
    u.username ||
    u.password ||
    u.search ||
    u.hash
  )
    throw Error(
      "请粘贴 OpenHex 的 HTTPS 网页分享链接（agent.openhex.tech/share/…），不是 API Key 或控制台地址",
    );
  return u.href;
}
export function validateQr(value) {
  if (!value) return "";
  if (
    typeof value !== "string" ||
    value.length > 1500000 ||
    !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(value)
  )
    throw Error("二维码需要 1 MB 以内的 PNG 图片");
  const bytes = Buffer.from(value.split(",")[1], "base64");
  if (
    bytes.length < 24 ||
    bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a" ||
    bytes.readUInt32BE(16) > 4096 ||
    bytes.readUInt32BE(20) > 4096
  )
    throw Error("二维码 PNG 无效或尺寸过大");
  return value;
}
export function safeDownloadName(name) {
  return (
    String(name || "agent-output")
      .split(/[\\/]/)
      .at(-1)
      .replace(/[\x00-\x1f<>:"|?*]/g, "_")
      .slice(0, 180) || "agent-output"
  );
}
export function normalizeFilename(name) {
  const text = String(name || "document");
  const decoded = Buffer.from(text, "latin1").toString("utf8");
  return safeDownloadName(
    !/[^\u0000-\u00ff]/.test(text) && !decoded.includes("\uFFFD")
      ? decoded
      : text,
  );
}
export function boundHistory(history, maxChars = 28000, maxMessages = 16) {
  const out = [];
  let used = 0;
  for (const m of history.slice(-maxMessages).reverse()) {
    const content = String(m.content || "");
    if (used + content.length > maxChars && out.length) break;
    out.unshift({
      role: m.role,
      content: content.slice(-maxChars),
    });
    used += content.length;
  }
  return out;
}
function validPart(part) {
  if (!part || !["file", "image_url"].includes(part.type)) return false;
  const url = part.type === "file" ? part.file?.file_url : part.image_url?.url;
  return typeof url === "string" && /^https:\/\//i.test(url);
}
export async function transferParts({
  client,
  files = [],
  agentId,
  conversationId,
  signal,
  cacheGet,
  cachePut,
  onEvent,
  force = false,
}) {
  const parts = [];
  for (const [i, file] of files.entries()) {
    signal?.throwIfAborted();
    let part = !force && (await cacheGet?.(file));
    if (part && !validPart(part)) part = null;
    const cached = !!part;
    onEvent?.({
      type: "upload",
      phase: part ? "cached" : "uploading",
      fileId: file.id,
      name: file.name,
      bytes: file.size,
      index: i + 1,
      total: files.length,
      message: part
        ? `复用已上传原文件：${file.name}`
        : `正在把原文件上传至 OpenHex：${file.name}`,
    });
    if (!part) {
      const filename = `${String(file.id || "").slice(0, 12)}_${safeDownloadName(file.name)}`;
      const bytes = await readFile(file.path);
      part = await client.files.uploadPart(
        {
          data: bytes,
          filename,
        },
        {
          contentType: file.mime || "application/octet-stream",
          agentId,
          ...(conversationId
            ? {
                chatGroupId: conversationId,
              }
            : {}),
          signal,
          as: file.status === "image" ? "image" : "file",
        },
      );
      if (!validPart(part))
        throw Error(`OpenHex 未返回有效附件部件：${file.name}`);
      await cachePut?.(file, part);
    }
    parts.push(part);
    onEvent?.({
      type: "upload",
      phase: "uploaded",
      fileId: file.id,
      name: file.name,
      bytes: file.size,
      index: i + 1,
      total: files.length,
      cached,
      message: `原文件已送达上传接口：${file.name}（不等同于已完成解析）`,
    });
  }
  return parts;
}
export async function streamOpenhex({
  client,
  sdk,
  agentId,
  inputText,
  messages,
  styleInstruction,
  files = [],
  signal,
  remote,
  onRemote,
  onToken,
  onEvent,
  onCursor,
  onAttachment,
  onImage,
  cacheGet,
  cachePut,
  forceUpload = false,
  resumeCursor,
  resume = false,
  idleTimeoutMs = 240000,
}) {
  let accepted = !!resume,
    conversationId = remote,
    text = "",
    complete = false,
    fileCount = 0,
    imageCount = 0,
    interactionCount = 0,
    lastCursor = resumeCursor,
    dispatchStarted = false;
  const seen = new Set();
  const stop = () => {
    if (conversationId)
      client.chat
        .interrupt(conversationId, {
          signal: AbortSignal.timeout(10000),
        })
        .catch(() => {});
  };
  signal?.addEventListener("abort", stop, {
    once: true,
  });
  try {
    if (!resume) {
      const parts = await transferParts({
        client,
        files,
        agentId,
        conversationId: remote,
        signal,
        cacheGet,
        cachePut,
        onEvent,
        force: forceUpload,
      });
      signal?.throwIfAborted();
      onEvent?.({
        type: "phase",
        phase: "sending",
        message: "正在提交本轮新消息",
      });
      dispatchStarted = true;
      const sent = await client.chat.send(
        validateAgentRequest({
          message: buildAgentInput({
            inputText,
            messages,
            remote,
            styleInstruction,
          }),
          ...(remote
            ? {
                conversationId: remote,
              }
            : {
                targetAgentIds: [agentId],
                newConversation: true,
              }),
          ...(parts.length
            ? {
                parts,
              }
            : {}),
        }),
        {
          signal,
        },
      );
      accepted = true;
      conversationId = sent.conversationId;
      lastCursor = sent.userEventId;
      if (!conversationId)
        throw Error("OpenHex 未返回 conversationId；不要自动重发本轮");
      await onRemote?.(conversationId, lastCursor);
      if (!lastCursor)
        throw Object.assign(
          Error(
            "平台已受理消息但未返回本轮游标。为避免把历史回复当成本轮，不读取旧流；请到平台核对，不要重复发送。",
          ),
          {
            terminal: true,
          },
        );
    }
    onEvent?.({
      type: "phase",
      phase: "waiting",
      message: "消息已受理，等待 Agent 响应；生成文件时可能需要更久",
    });
    for await (const record of client.chat.resumeTurn(conversationId, {
      lastEventId: lastCursor,
      signal,
      idleTimeoutMs,
      includeThinking: false,
      reconnect: true,
    })) {
      signal?.throwIfAborted();
      if (record.id && seen.has(record.id)) continue;
      if (record.id) seen.add(record.id);
      if (seen.size > 100000)
        throw Object.assign(
          Error("OpenHex 本轮事件过多，已停止接收；请到平台核对进度"),
          {
            code: "EVENT_LIMIT",
          },
        );
      if (sdk.isInterrupt?.(record))
        throw Object.assign(Error("Agent 已被打断"), {
          code: "REMOTE_INTERRUPTED",
          terminal: true,
        });
      const isEnd = sdk.isTurnComplete(record);
      if (
        !isEnd &&
        (record.sender === "agent" || record.sender === "assistant")
      ) {
        const fragment = sdk.extractText(record) || "";
        if (fragment) {
          text += fragment;
          onToken?.(fragment);
        }
        for (const call of sdk.extractToolCalls?.(record) || [])
          onEvent?.({
            type: "tool",
            phase: "working",
            name: String(call.name || "tool").slice(0, 120),
            message: `Agent 正在调用工具：${String(call.name || "tool").slice(0, 120)}`,
          });
      }
      const attachment = sdk.extractFileAttachment?.(record);
      if (attachment?.workspacePath) {
        fileCount++;
        await onAttachment?.({
          ...attachment,
          conversationId,
          agentId,
        });
      }
      for (const url of sdk.extractImages?.(record) || [])
        if (typeof url === "string" && /^https:\/\//i.test(url)) {
          imageCount++;
          onImage?.(url);
        }
      const connectors = sdk.extractConnectorSetup?.(record) || [];
      const needsInteraction =
        sdk.extractInfoCollect?.(record) ||
        sdk.extractPaymentGate?.(record) ||
        (Array.isArray(connectors) && connectors.length) ||
        ["info_collection", "payment_gate"].includes(record.raw?.type);
      if (needsInteraction) {
        interactionCount++;
        onEvent?.({
          type: "interaction",
          phase: "action_required",
          message:
            "OpenHex 需要你在平台原会话完成信息填写、支付或连接器授权。本站不会代你提交；不要重复发送当前任务。",
        });
      }
      if (record.raw?.type === "agent_status")
        onEvent?.({
          type: "phase",
          phase: String(record.raw.phase || "working"),
          message: "Agent 正在处理本轮任务",
        });
      lastCursor = record.id || lastCursor;
      await onCursor?.(lastCursor, text, conversationId);
      if (isEnd) {
        if (record.raw?.is_error)
          throw Object.assign(
            Error(
              "OpenHex Agent 返回执行失败，请检查平台记录；不会自动重新执行",
            ),
            {
              code: "REMOTE_FAILED",
              terminal: true,
            },
          );
        complete = true;
        break;
      }
    }
    if (!complete)
      throw Object.assign(
        Error("OpenHex 回复流中断，可恢复接收；请勿反复发送同一问题"),
        {
          code: "STREAM_INTERRUPTED",
        },
      );
    if (interactionCount) {
      const notice =
        "\n\n【需要你处理】OpenHex 返回了待交互卡片。请登录同一 OpenHex 账号，在对应原会话核对并完成信息填写、支付或连接器授权；本站未代为提交，也不把它标记为任务完成。";
      text += notice;
      onToken?.(notice);
    }
    if (!text.trim() && !fileCount && !imageCount && !resume)
      throw Error("本轮未收到正文或文件附件，请检查 Agent 输出");
    return {
      text,
      remote: conversationId,
      cursor: lastCursor,
      fileCount,
      interactionCount,
      channel: "openhex",
    };
  } catch (cause) {
    const error = cause instanceof Error ? cause : Error(String(cause));
    const status = Number(
      error.status || error.statusCode || error.response?.status,
    );
    error.acceptanceUnknown =
      dispatchStarted && !accepted && (!status || status >= 500);
    error.accepted = accepted;
    error.remote = conversationId;
    error.cursor = lastCursor;
    throw error;
  } finally {
    signal?.removeEventListener("abort", stop);
  }
}
