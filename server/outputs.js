import { uid, one, run, now } from "./core.js";
import { safeDownloadName } from "./transport.js";
export function saveAgentOutput(space, scope, turnId, binding, file) {
  if (typeof file.workspacePath !== "string" || !file.workspacePath || file.workspacePath.length > 2000)
    throw Error("Agent 文件路径无效");
  const old = one(
    "SELECT id,name,mime FROM remote_outputs WHERE space=? AND chat=? AND remote=? AND workspace_path=? AND turn_id=?",
    space,
    scope,
    file.conversationId,
    file.workspacePath,
    turnId,
  );
  if (old) return old;
  const id = uid(),
    name = safeDownloadName(file.name || file.filename || file.workspacePath),
    mime = String(file.mimeType || file.mime || "application/octet-stream");
  run(
    "INSERT INTO remote_outputs(id,space,chat,turn_id,remote,agent,binding,name,workspace_path,mime,created) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
    id,
    space,
    scope,
    turnId,
    file.conversationId,
    file.agentId,
    binding,
    name,
    file.workspacePath,
    mime,
    now(),
  );
  return {
    id,
    name,
    mime,
  };
}
