import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "onestaff-v3-"));
process.env.DATA_DIR = temp;
process.env.ALLOW_LOCAL_API = "1";
const { config, saveConfig, db, mergeSecrets } = await import("../server/core.js");
const { compatible } = await import("../server/providers.js");
const { transcribeVolc, synthesizeVolc } = await import("../server/speech-volc.js");
const { classifyTask, roleChannel, routeProfile, resolvedProvider } = await import("../server/presets.js");
let calls = [],
  mode = "ok";
const server = http.createServer(async (q, r) => {
  let raw = "";
  for await (const b of q) raw += b;
  const body = JSON.parse(raw);
  calls.push({
    url: q.url,
    body,
    headers: q.headers,
  });
  if (q.url.endsWith("/responses")) {
    if (!body.stream)
      return r.end(
        JSON.stringify({
          status: "completed",
          output: [
            {
              type: "message",
              content: [
                {
                  type: "output_text",
                  text: "完整答复",
                },
              ],
            },
          ],
        }),
      );
    r.setHeader("Content-Type", "text/event-stream");
    const text =
      "data: " +
      JSON.stringify({
        type: "response.output_text.delta",
        delta: "分块答复",
      }) +
      "\n\n";
    r.write(text.slice(0, 11));
    r.write(text.slice(11));
    if (mode !== "truncated")
      r.write(
        "data: " +
          JSON.stringify({
            type: mode === "failed" ? "response.failed" : "response.completed",
            response: {
              status: mode === "failed" ? "failed" : "completed",
            },
          }) +
          "\n\n",
      );
    return r.end();
  }
  if (q.url.endsWith("/recognize/flash")) {
    r.setHeader("X-Api-Status-Code", mode === "asr-fail" ? "45000001" : "20000000");
    return r.end(
      JSON.stringify({
        result: {
          text: "识别文字",
        },
      }),
    );
  }
  if (q.url.endsWith("/tts/unidirectional")) {
    r.setHeader("Content-Type", "application/json");
    r.write(
      JSON.stringify({
        code: 0,
        data: Buffer.from("ID3-AUDIO").toString("base64"),
      }) + "\n",
    );
    if (mode !== "tts-truncated")
      r.write(
        JSON.stringify({
          code: 20000000,
          message: "OK",
        }) + "\n",
      );
    return r.end();
  }
  r.statusCode = 404;
  r.end("{}");
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
const base = "http://127.0.0.1:" + server.address().port;
const cfg = config();
cfg.providers = [
  {
    id: "test",
    label: "测试",
    baseUrl: base + "/v3/responses",
    apiKey: "test-key",
    model: "model-id",
    protocol: "responses",
  },
];
cfg.defaultProvider = "test";
cfg.reviewProvider = "test";
saveConfig(cfg);
test.after(() => {
  server.closeAllConnections();
  server.close();
  db.close();
  fs.rmSync(temp, {
    recursive: true,
    force: true,
  });
});
test("Responses 请求和输出事件经过真实 HTTP，完整路径不重复拼接", async () => {
  const out = await compatible({
    role: "director",
    messages: [
      {
        role: "user",
        content: "你好",
      },
    ],
  });
  assert.equal(out.text, "完整答复");
  assert.equal(calls.at(-1).url, "/v3/responses");
  assert.ok(Array.isArray(calls.at(-1).body.input));
  assert.equal(calls.at(-1).body.messages, undefined);
  let text = "";
  await compatible({
    role: "director",
    messages: [
      {
        role: "user",
        content: "你好",
      },
    ],
    onToken: (x) => (text += x),
  });
  assert.equal(text, "分块答复");
});
test("Responses 截断和上游失败不保存为成功", async () => {
  for (const value of ["truncated", "failed"]) {
    mode = value;
    await assert.rejects(
      compatible({
        messages: [
          {
            role: "user",
            content: "你好",
          },
        ],
        onToken: () => {},
      }),
    );
  }
  mode = "ok";
});
test("模型档案密钥引用及优先级不会把复杂代码任务降为闲聊", () => {
  assert.equal(classifyTask("完整架构和前端代码"), "reasoning");
  assert.equal(classifyTask("函数报错调试"), "code");
  assert.equal(classifyTask("你好"), "chat");
  assert.equal(roleChannel("hybrid", "director"), "direct");
  assert.equal(roleChannel("hybrid", "supervisor"), "direct");
  assert.equal(roleChannel("hybrid", "writer"), "openhex");
  assert.equal(
    routeProfile(
      {
        defaultProvider: "main",
        routing: {
          enabled: true,
          code: "coder",
        },
      },
      "写代码",
    ),
    "coder",
  );
  assert.throws(() =>
    resolvedProvider(
      {
        providers: [
          {
            id: "a",
            keyFrom: "b",
          },
          {
            id: "b",
            keyFrom: "a",
          },
        ],
      },
      "a",
    ),
  );
  const next = {
    providers: [
      {
        id: "b",
        apiKey: "••••2222",
      },
      {
        id: "a",
        apiKey: "••••1111",
      },
    ],
  };
  mergeSecrets(next, {
    providers: [
      {
        id: "a",
        apiKey: "secret-a",
      },
      {
        id: "b",
        apiKey: "secret-b",
      },
    ],
  });
  assert.equal(next.providers[0].apiKey, "secret-b");
});
test("豆包 ASR 原生 Key 和 Resource 协议及 seed_asr 映射", async () => {
  const c = {
    baseUrl: base + "/api/v3",
    apiKey: "speech-key",
    asrModel: "seed_asr",
    asrResource: "volc.bigasr.auc_turbo",
  };
  const out = await transcribeVolc(c, Buffer.from("WAV-FIXTURE"));
  assert.equal(out.text, "识别文字");
  const call = calls.at(-1);
  assert.equal(call.url, "/api/v3/auc/bigmodel/recognize/flash");
  assert.equal(call.headers["x-api-key"], "speech-key");
  assert.equal(call.body.request.model_name, "bigmodel");
  assert.equal(Buffer.from(call.body.audio.data, "base64").toString(), "WAV-FIXTURE");
  mode = "asr-fail";
  await assert.rejects(transcribeVolc(c, Buffer.from("WAV")), /45000001/);
  mode = "ok";
});
test("豆包 TTS 拼接 Base64 音频并拒绝缺失完成标记", async () => {
  const c = {
    baseUrl: base + "/api/v3",
    apiKey: "speech-key",
    ttsModel: "seed-tts-2.0",
    voice: "zh_female_vv_jupiter_bigtts",
  };
  const out = await synthesizeVolc(c, "你好");
  assert.equal(out.buffer.toString(), "ID3-AUDIO");
  assert.equal(calls.at(-1).headers["x-api-resource-id"], "seed-tts-2.0");
  assert.equal(calls.at(-1).body.req_params.speaker, c.voice);
  mode = "tts-truncated";
  await assert.rejects(synthesizeVolc(c, "你好"), /不完整/);
  mode = "ok";
});
