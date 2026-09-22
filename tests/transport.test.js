import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  buildAgentInput,
  streamOpenhex,
  transferParts,
  validRequestId,
  safeShareUrl,
  normalizeFilename,
  validateQr,
  boundHistory,
} from "../server/transport.js";
import { validatePlan } from "../server/planner.js";
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "onestaff-transport-"));
test.after(() =>
  fs.rmSync(dir, {
    recursive: true,
    force: true,
  }),
);
const sdk = {
  extractText: (r) => r.text || "",
  isTurnComplete: (r) => r.raw?.type === "result",
  isInterrupt: (r) => r.raw?.type === "interrupt",
  extractFileAttachment: (r) => r.file || null,
  extractImages: (r) => r.images || [],
  extractToolCalls: (r) => r.tools || [],
};
const end = {
  id: "final",
  sender: "agent",
  raw: {
    type: "result",
    is_error: false,
  },
};
function fake(
  records = [
    {
      id: "r1",
      sender: "assistant",
      text: "回复一",
    },
    end,
  ],
) {
  const calls = {
    uploads: [],
    sent: [],
    resumes: [],
    interrupts: [],
  };
  let count = 0;
  const client = {
    files: {
      async uploadPart(f, o) {
        calls.uploads.push({
          file: f,
          options: o,
        });
        if (o.as === "image")
          return {
            type: "image_url",
            image_url: {
              url: "https://fixture.invalid/a.png",
            },
          };
        return {
          type: "file",
          file: {
            filename: f.filename,
            file_url: "https://fixture.invalid/" + ++count,
          },
        };
      },
    },
    chat: {
      async send(req, opts) {
        calls.sent.push({
          req,
          opts,
        });
        return {
          conversationId: req.conversationId || "new-conversation",
          userEventId: "u1",
        };
      },
      async *resumeTurn(id, opts) {
        calls.resumes.push({
          id,
          opts,
        });
        for (const r of records) {
          if (r instanceof Error) throw r;
          yield r;
        }
      },
      async interrupt(id) {
        calls.interrupts.push(id);
      },
    },
  };
  return {
    client,
    calls,
  };
}
function attachment(name, data, status = "ready") {
  const id = name.replace(/\W/g, "") + "0123456789",
    p = path.join(dir, id);
  fs.writeFileSync(p, data);
  return {
    id,
    name,
    path: p,
    size: data.length,
    mime: name.endsWith(".pdf")
      ? "application/pdf"
      : "application/octet-stream",
    status,
  };
}
const question = "请核对这份文档的最后一章";
test("OpenHex sends only the explicit new question, not repeated system/history", () => {
  assert.equal(
    buildAgentInput({
      inputText: question,
      messages: [
        {
          role: "system",
          content: "persona",
        },
        {
          role: "user",
          content: "old",
        },
        {
          role: "assistant",
          content: "old reply",
        },
      ],
      remote: "conversation",
    }),
    question,
  );
  assert.equal(
    buildAgentInput({
      messages: [
        {
          role: "system",
          content: "persona",
        },
        {
          role: "user",
          content: question,
        },
      ],
      remote: "conversation",
    }),
    question,
  );
});
test("A new task gets its one-time planning instruction, never previous private history", () => {
  assert.equal(
    buildAgentInput({
      messages: [
        {
          role: "system",
          content: "plan",
        },
        {
          role: "user",
          content: "old",
        },
        {
          role: "assistant",
          content: "private",
        },
        {
          role: "user",
          content: "new task",
        },
      ],
    }),
    "plan\n\nnew task",
  );
});
test("Original PDF, DOCX, spreadsheet and image bytes are uploaded before send", async () => {
  const bytes = Buffer.from(
      "%PDF-1.7\n" + "完整内容".repeat(5000) + "TAIL_SENTINEL_END",
    ),
    files = [
      attachment("测试文档.pdf", bytes),
      attachment("report.docx", Buffer.from("PK-docx-binary")),
      attachment("sales.xlsx", Buffer.from("PK-xlsx-binary")),
      attachment("photo.png", Buffer.from([137, 80, 78, 71, 1, 2, 3]), "image"),
    ],
    { client, calls } = fake();
  const out = await streamOpenhex({
    client,
    sdk,
    agentId: "agent-one",
    inputText: question,
    files,
  });
  assert.equal(out.text, "回复一");
  assert.equal(calls.uploads.length, 4);
  assert.equal(calls.sent[0].req.parts.length, 4);
  assert.equal(calls.sent[0].req.message, question);
  assert.equal(calls.sent[0].req.newConversation, true);
  assert.equal(
    createHash("sha256").update(calls.uploads[0].file.data).digest("hex"),
    createHash("sha256").update(bytes).digest("hex"),
  );
  assert.ok(
    calls.uploads[0].file.data.toString().endsWith("TAIL_SENTINEL_END"),
  );
  assert.equal(calls.uploads[3].options.as, "image");
  for (const x of calls.uploads) assert.equal(x.options.agentId, "agent-one");
});
test("Continuation uses the same conversationId and does not force a new conversation", async () => {
  const { client, calls } = fake();
  await streamOpenhex({
    client,
    sdk,
    agentId: "a",
    remote: "kept",
    inputText: "继续",
    messages: [
      {
        role: "user",
        content: "must not include",
      },
    ],
  });
  assert.deepEqual(calls.sent[0].req, {
    message: "继续",
    conversationId: "kept",
  });
  assert.equal(calls.resumes[0].opts.lastEventId, "u1");
});
test("Upload cache avoids transfer; forceUpload explicitly invalidates reuse", async () => {
  const f = attachment("cache.pdf", Buffer.from("%PDF-cache")),
    cache = new Map(),
    { client, calls } = fake(),
    events = [];
  const opts = {
    client,
    files: [f],
    agentId: "a",
    cacheGet: (x) => cache.get(x.id),
    cachePut: (x, p) => cache.set(x.id, p),
    onEvent: (e) => events.push(e),
  };
  await transferParts(opts);
  await transferParts(opts);
  assert.equal(calls.uploads.length, 1);
  assert.ok(events.find((e) => e.phase === "uploaded" && e.cached));
  await transferParts({
    ...opts,
    force: true,
  });
  assert.equal(calls.uploads.length, 2);
});
test("Failed PDF upload never silently degrades into a text-only question", async () => {
  const { client, calls } = fake();
  client.files.uploadPart = async () => {
    throw Error("upload failure");
  };
  await assert.rejects(
    streamOpenhex({
      client,
      sdk,
      agentId: "a",
      inputText: "q",
      files: [attachment("fail.pdf", Buffer.from("%PDF-fail"))],
    }),
    /upload failure/,
  );
  assert.equal(calls.sent.length, 0);
});
test("Invalid uploadPart responses are rejected", async () => {
  const { client } = fake();
  client.files.uploadPart = async () => ({
    url: "wrong-shape",
  });
  await assert.rejects(
    transferParts({
      client,
      files: [attachment("invalid.pdf", Buffer.from("%PDF-x"))],
      agentId: "a",
    }),
    /有效附件/,
  );
});
test("Duplicate stream IDs, echoed user text and final summary are not repeated", async () => {
  const { client } = fake([
    {
      id: "u1",
      sender: "user",
      text: "echoed input",
    },
    {
      id: "r1",
      sender: "assistant",
      text: "A",
    },
    {
      id: "r1",
      sender: "assistant",
      text: "A",
    },
    {
      id: "r2",
      sender: "agent",
      text: "B",
    },
    {
      ...end,
      text: "AB",
    },
  ]);
  let emitted = "";
  const out = await streamOpenhex({
    client,
    sdk,
    inputText: "question",
    agentId: "a",
    onToken: (t) => (emitted += t),
  });
  assert.equal(out.text, "AB");
  assert.equal(emitted, "AB");
});
test("Resume only reads from stored cursor and never sends or uploads again", async () => {
  const { client, calls } = fake([
    {
      id: "r2",
      sender: "assistant",
      text: "rest",
    },
    end,
  ]);
  const out = await streamOpenhex({
    client,
    sdk,
    agentId: "a",
    remote: "kept",
    resume: true,
    resumeCursor: "r1",
    files: [attachment("ignored.pdf", Buffer.from("ignored"))],
  });
  assert.equal(calls.sent.length, 0);
  assert.equal(calls.uploads.length, 0);
  assert.equal(calls.resumes[0].opts.lastEventId, "r1");
  assert.equal(out.text, "rest");
});
test("Stream loss preserves accepted status and conversation for manual recovery", async () => {
  const { client } = fake([
    {
      id: "r1",
      sender: "assistant",
      text: "partial",
    },
    Error("connection lost"),
  ]);
  let saved;
  try {
    await streamOpenhex({
      client,
      sdk,
      agentId: "a",
      inputText: "write a file",
      onCursor: (cursor, text, id) =>
        (saved = {
          cursor,
          text,
          id,
        }),
    });
    assert.fail("expected failure");
  } catch (e) {
    assert.equal(e.accepted, true);
    assert.equal(e.remote, "new-conversation");
    assert.equal(e.cursor, "r1");
  }
  assert.equal(saved.text, "partial");
});
test("A file-only response produces a downloadable attachment instead of an empty-answer error", async () => {
  const { client } = fake([
    {
      id: "file1",
      sender: "system",
      file: {
        name: "report.docx",
        workspacePath: "/outputs/report.docx",
        mimeType: "application/docx",
      },
    },
    end,
  ]);
  const files = [];
  const out = await streamOpenhex({
    client,
    sdk,
    agentId: "a",
    inputText: "generate",
    onAttachment: (f) => files.push(f),
  });
  assert.equal(out.fileCount, 1);
  assert.equal(files[0].conversationId, "new-conversation");
  assert.equal(files[0].agentId, "a");
});
test("An image-only response is not reported as empty text", async () => {
  const { client } = fake([
    {
      id: "image1",
      sender: "agent",
      images: ["https://fixture.invalid/image.png"],
    },
    end,
  ]);
  const images = [];
  await streamOpenhex({
    client,
    sdk,
    agentId: "a",
    inputText: "draw",
    onImage: (x) => images.push(x),
  });
  assert.equal(images.length, 1);
});
test("Explicit cancellation also attempts to interrupt the accepted remote turn", async () => {
  const ac = new AbortController(),
    { client, calls } = fake([
      {
        id: "r1",
        sender: "agent",
        text: "hello",
      },
      end,
    ]);
  await assert.rejects(
    streamOpenhex({
      client,
      sdk,
      signal: ac.signal,
      agentId: "a",
      inputText: "q",
      onToken: () => ac.abort(),
    }),
  );
  assert.equal(calls.interrupts.length, 1);
  assert.equal(calls.interrupts[0], "new-conversation");
});
test("Terminal platform failure is not labeled resumable", async () => {
  const { client } = fake([
    {
      ...end,
      raw: {
        type: "result",
        is_error: true,
      },
    },
  ]);
  await assert.rejects(
    streamOpenhex({
      client,
      sdk,
      agentId: "a",
      inputText: "q",
    }),
    (e) => e.terminal === true && e.accepted === true,
  );
});
test("Chinese file names preserve UTF-8, and Latin1 multipart mojibake is repaired", () => {
  assert.equal(normalizeFilename("产品说明书.pdf"), "产品说明书.pdf");
  const mojibake = Buffer.from("产品说明书.pdf").toString("latin1");
  assert.equal(normalizeFilename(mojibake), "产品说明书.pdf");
  assert.equal(normalizeFilename("../../report.docx"), "report.docx");
});
test("Share URLs accept only official HTTPS share entries, not credentials or control-console URLs", () => {
  assert.equal(
    safeShareUrl("https://agent.openhex.tech/share/demo-id"),
    "https://agent.openhex.tech/share/demo-id",
  );
  for (const u of [
    "javascript:alert(1)",
    "https://evil.example/share/a",
    "https://app.openhex.tech/console/id",
    "http://agent.openhex.tech/share/id",
    "https://x:y@agent.openhex.tech/share/id",
    "https://agent.openhex.tech/share/id?token=secret",
  ])
    assert.throws(() => safeShareUrl(u));
});
test("QR uploads reject HTML, fake PNG data and oversized input", () => {
  assert.throws(() => validateQr("data:text/html;base64,AAAA"));
  assert.throws(() => validateQr("data:image/png;base64,AAAA"));
  assert.throws(() => validateQr("x".repeat(1500001)));
  assert.equal(validateQr(""), "");
});
test("Direct-model history has explicit character and message bounds", () => {
  const history = Array.from(
    {
      length: 100,
    },
    (_, i) => ({
      role: i % 2 ? "assistant" : "user",
      content: "x".repeat(2000),
    }),
  );
  const out = boundHistory(history, 8000, 10);
  assert.equal(out.length, 4);
  assert.equal(
    out.reduce((n, x) => n + x.content.length, 0),
    8000,
  );
});
test("Request IDs reject path fragments and invalid repeated-request identifiers", () => {
  assert.ok(validRequestId("request-12345678"));
  assert.ok(!validRequestId("../other"));
  assert.ok(!validRequestId("x".repeat(81)));
});
test("Task plan validation rejects cycles, unknown roles, duplicate IDs and unsupported structure", () => {
  const valid = {
    steps: [
      {
        id: "one",
        role: "researcher",
        action: "read",
        depends: [],
      },
      {
        id: "two",
        role: "writer",
        action: "write",
        depends: ["one"],
      },
    ],
  };
  assert.equal(validatePlan(valid).format, "docx");
  for (const steps of [
    [
      {
        id: "one",
        role: "researcher",
        action: "read",
        depends: ["one"],
      },
    ],
    [
      {
        id: "one",
        role: "root",
        action: "execute",
        depends: [],
      },
    ],
    [valid.steps[0], valid.steps[0]],
    [],
  ])
    assert.throws(() =>
      validatePlan({
        steps,
      }),
    );
});
test("Missing acknowledged turn cursor never causes a replay of previous conversation history", async () => {
  const { client, calls } = fake();
  client.chat.send = async () => ({
    conversationId: "acknowledged",
  });
  await assert.rejects(
    streamOpenhex({
      client,
      sdk,
      agentId: "a",
      inputText: "q",
    }),
    (e) => e.terminal === true && e.accepted === true,
  );
  assert.equal(calls.resumes.length, 0);
});
import { connectionDiagnosis } from "../server/diagnostics.js";
import { validateAgentRequest } from "../server/transport.js";
test("OpenHex 400优先展示issues字段，保留详细原因并脱敏", () => {
  const result = connectionDiagnosis(
    {
      status: 400,
      message: "Validation error",
      body: {
        detail: "Validation error",
        issues: [
          { path: ["targetAgentIds", 0], message: "Invalid UUID secret-key" },
        ],
      },
    },
    (s) => String(s).replaceAll("secret-key", "[REDACTED]"),
  );
  assert.match(result.diagnosis, /HTTP 400/);
  assert.match(result.diagnosis, /targetAgentIds.0: Invalid UUID/);
  assert.ok(!result.diagnosis.includes("secret-key"));
  const id = "f4e6da32-9ad5-4cbb-a9a5-bbf1a6420969";
  assert.doesNotThrow(() =>
    validateAgentRequest({ message: "你好", targetAgentIds: [id] }, true),
  );
  for (const request of [
    { message: "", targetAgentIds: [id] },
    { message: "你好", targetAgentIds: ["short-id"] },
    { message: "你好", targetAgentIds: [] },
    { message: "你好", targetAgentIds: [id], conversationId: null },
    {
      message: "你好",
      targetAgentIds: [id],
      parts: [{ type: "file", file: { file_url: "https://example.com/a" } }],
    },
  ])
    assert.throws(
      () => validateAgentRequest(request, true),
      (e) => e.status === 400 && e.body.issues.length > 0,
    );
});
