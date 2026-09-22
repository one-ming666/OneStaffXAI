import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "onestaff-services-"));
process.env.DATA_DIR = temp;
process.env.NODE_ENV = "test";
process.env.ALLOW_LOCAL_API = "1";
const { config, saveConfig, run, db, now } = await import("../server/core.js");
const { searchWeb, compatible, auxiliary, endpoint } = await import("../server/providers.js");
const { weather, synthesize, registerServiceRoutes } = await import("../server/services.js");
let seen = [],
  failureWeather = false,
  finish = "stop";
const server = http.createServer(async (q, r) => {
  const parts = [];
  for await (const c of q) parts.push(c);
  const raw = Buffer.concat(parts);
  let body = {};
  if ((q.headers["content-type"] || "").includes("application/json")) body = JSON.parse(raw.toString());
  seen.push({
    url: q.url,
    headers: q.headers,
    raw,
    body,
  });
  if (q.url.startsWith("/weather/")) {
    r.setHeader("Content-Type", "application/json");
    if (failureWeather) {
      r.statusCode = 503;
      return r.end("{}");
    }
    return r.end(
      JSON.stringify({
        temperature: {
          value: 23,
          unit: "°C",
        },
        condition: {
          text: "多云",
        },
        humidity: 0.54,
        metadata: {
          attributions: ["https://www.qweather.com", "javascript:bad"],
        },
      }),
    );
  }
  if (q.url === "/search")
    return r.end(
      JSON.stringify({
        results: [
          {
            title: "Primary docs",
            url: "https://docs.example.org",
            content: "x".repeat(3000),
          },
          {
            url: "javascript:bad",
            content: "ignore",
          },
        ],
      }),
    );
  if (q.url.endsWith("/audio/transcriptions"))
    return r.end(
      JSON.stringify({
        text: "真实 HTTP 夹具转写结果",
      }),
    );
  if (q.url.endsWith("/audio/speech")) {
    r.setHeader("Content-Type", "audio/mpeg");
    return r.end(Buffer.from("ID3-FAKE-FIXTURE-AUDIO"));
  }
  if (q.url.endsWith("/chat/completions")) {
    if (body.stream) {
      r.setHeader("Content-Type", "text/event-stream");
      r.write(
        "data: " +
          JSON.stringify({
            choices: [
              {
                delta: {
                  content: "分块",
                },
                finish_reason: null,
              },
            ],
          }) +
          "\n\n",
      );
      r.write(
        "data: " +
          JSON.stringify({
            choices: [
              {
                delta: {
                  content: "输出",
                },
                finish_reason: finish,
              },
            ],
          }) +
          "\n\n",
      );
      return r.end("data: [DONE]\n\n");
    }
    return r.end(
      JSON.stringify({
        choices: [
          {
            message: {
              content: "只翻译夹具原文",
            },
            finish_reason: finish,
          },
        ],
      }),
    );
  }
  r.statusCode = 404;
  r.end("{}");
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
const base = "http://127.0.0.1:" + server.address().port;
process.env.TEST_SEARCH_URL = base + "/search";
const cfg = config();
cfg.providers[0] = {
  ...cfg.providers[0],
  protocol: "chat",
  keyFrom: "",
  baseUrl: base + "/v1",
  model: "fixture-model",
  apiKey: "fixture-main-key",
};
cfg.providers[1] = {
  ...cfg.providers[1],
  protocol: "chat",
  keyFrom: "",
  baseUrl: base + "/aux/v1",
  model: "fixture-aux-model",
  apiKey: "fixture-aux-key",
};
cfg.defaultProvider = cfg.providers[0].id;
cfg.auxiliary.providerId = cfg.providers[1].id;
cfg.search = {
  apiKey: "fixture-search-key",
  maxResults: 5,
};
cfg.speech = {
  baseUrl: base + "/asr/v1",
  apiKey: "fixture-asr-key",
  asrModel: "fixture-asr",
  ttsBaseUrl: base + "/tts/v1",
  ttsApiKey: "fixture-tts-key",
  ttsModel: "fixture-tts",
  voice: "fixture-voice",
};
saveConfig(cfg);
const routes = new Map(),
  app = {
    get: (p, ...h) => routes.set("GET " + p, h.at(-1)),
    post: (p, ...h) => routes.set("POST " + p, h.at(-1)),
    put: (p, ...h) => routes.set("PUT " + p, h.at(-1)),
  };
registerServiceRoutes(app, {
  wrap: (x) => x,
  admin: () => {},
  upload: {
    single: () => () => {},
  },
  limit: () => {},
});
function request(method, p, req) {
  return new Promise((resolve, reject) => {
    const r = {
      json: resolve,
      type: () => r,
      send: resolve,
    };
    Promise.resolve(routes.get(method + " " + p)(req, r)).catch(reject);
  });
}
test.after(() => {
  server.closeAllConnections();
  server.close();
  db.close();
  fs.rmSync(temp, {
    recursive: true,
    force: true,
  });
});
test("Tavily request sends correct key and only safe source links", async () => {
  const out = await searchWeb("核对资料");
  const req = seen.at(-1);
  assert.equal(req.headers.authorization, "Bearer fixture-search-key");
  assert.equal(req.body.query, "核对资料");
  assert.equal(req.body.include_answer, false);
  assert.equal(out.length, 1);
  assert.equal(out[0].content.length, 2200);
});
test("Weather disabled makes no network request; V1 uses configured coordinates and header", async () => {
  let before = seen.length;
  assert.equal((await weather()).state, "disabled");
  assert.equal(seen.length, before);
  let c = config();
  c.weather = {
    enabled: true,
    baseUrl: base,
    apiKey: "fixture-weather-key",
    city: "测试城市",
    latitude: "39.90",
    longitude: "116.40",
  };
  saveConfig(c);
  const w = await weather();
  assert.equal(w.state, "ready");
  assert.equal(w.temperature, 23);
  assert.equal(w.humidity, 54);
  assert.equal(w.attributions.length, 1);
  assert.match(seen.at(-1).url, /weather\/v1\/current\/39.90\/116.40/);
  assert.equal(seen.at(-1).headers["x-qw-api-key"], "fixture-weather-key");
});
test("Weather cache avoids extra calls and labels stale data after upstream failure", async () => {
  const before = seen.length;
  const cached = await weather();
  assert.equal(cached.cached, true);
  assert.equal(seen.length, before);
  failureWeather = true;
  const stale = await weather(true);
  assert.equal(stale.stale, true);
  assert.match(stale.error, /503/);
  failureWeather = false;
});
test("TTS uses separate credentials, exact input/model/voice and returns audio bytes", async () => {
  const out = await synthesize("你好");
  const req = seen.at(-1);
  assert.equal(req.url, "/tts/v1/audio/speech");
  assert.equal(req.headers.authorization, "Bearer fixture-tts-key");
  assert.equal(req.body.model, "fixture-tts");
  assert.equal(req.body.voice, "fixture-voice");
  assert.equal(req.body.input, "你好");
  assert.equal(req.body.response_format, "mp3");
  assert.equal(out.type, "audio/mpeg");
  assert.equal(out.buffer.subarray(0, 3).toString(), "ID3");
  await assert.rejects(synthesize("x".repeat(5001)), /5000/);
});
test("ASR actually sends multipart audio to configured transcription URL and removes temp file", async () => {
  const p = path.join(temp, "clip.webm");
  fs.writeFileSync(p, Buffer.from("BINARY-WEBM-FIXTURE"));
  const out = await request("POST", "/api/speech/transcribe", {
    space: "space-a",
    file: {
      path: p,
      mimetype: "audio/webm",
      originalname: "clip.webm",
    },
  });
  const req = seen.at(-1);
  assert.equal(out.text, "真实 HTTP 夹具转写结果");
  assert.equal(req.url, "/asr/v1/audio/transcriptions");
  assert.equal(req.headers.authorization, "Bearer fixture-asr-key");
  assert.match(req.headers["content-type"], /multipart\/form-data/);
  assert.ok(req.raw.includes("BINARY-WEBM-FIXTURE"));
  assert.ok(req.raw.includes("fixture-asr"));
  assert.equal(fs.existsSync(p), false);
});
test("Auxiliary model uses configured independent group, never the main OpenHex route", async () => {
  const out = await auxiliary([
    {
      role: "user",
      content: "原文",
    },
  ]);
  const req = seen.at(-1);
  assert.equal(req.url, "/aux/v1/chat/completions");
  assert.equal(req.headers.authorization, "Bearer fixture-aux-key");
  assert.equal(out.channel, "direct:" + cfg.providers[1].id);
  assert.equal(req.body.messages.length, 1);
});
test("Compatible SSE streams actual HTTP chunks and rejects length-truncated output", async () => {
  let chunks = "";
  await compatible({
    messages: [
      {
        role: "user",
        content: "问题",
      },
    ],
    onToken: (t) => (chunks += t),
    signal: AbortSignal.timeout(5000),
  });
  assert.equal(chunks, "分块输出");
  finish = "length";
  await assert.rejects(
    auxiliary([
      {
        role: "user",
        content: "长原文",
      },
    ]),
    /长度上限/,
  );
  finish = "stop";
});
test("Translation retains original, caches result and prevents another space access", async () => {
  run("INSERT INTO spaces VALUES(?,?,?)", "space-a", "{}", now());
  run(
    "INSERT INTO chats(id,space,employee,title,created) VALUES(?,?,?,?,?)",
    "chat-a",
    "space-a",
    "director",
    "test",
    now(),
  );
  const id = Number(
    run(
      "INSERT INTO messages(chat,role,content,created) VALUES(?,?,?,?)",
      "chat-a",
      "assistant",
      "未经替换的原文",
      now(),
    ).lastInsertRowid,
  );
  const before = seen.length;
  const out = await request("POST", "/api/messages/:id/translate", {
    space: "space-a",
    params: {
      id,
    },
    body: {
      target: "en",
    },
  });
  assert.equal(out.cached, false);
  assert.equal(db.prepare("SELECT content FROM messages WHERE id=?").get(id).content, "未经替换的原文");
  const second = await request("POST", "/api/messages/:id/translate", {
    space: "space-a",
    params: {
      id,
    },
    body: {
      target: "en",
    },
  });
  assert.equal(second.cached, true);
  assert.equal(seen.length, before + 1);
  await assert.rejects(
    request("POST", "/api/messages/:id/translate", {
      space: "space-b",
      params: {
        id,
      },
      body: {
        target: "en",
      },
    }),
    /无权/,
  );
});
test("Persona bubbles send at most a short topic, not document text; reuse rate-limited result", async () => {
  const before = seen.length;
  const out = await request("POST", "/api/companion/bubble", {
    space: "space-a",
    body: {
      context: "a".repeat(3000),
      phase: "thinking",
    },
  });
  const req = seen.at(-1);
  assert.match(out.label, /角色气泡/);
  assert.ok(req.body.messages[1].content.length < 380);
  assert.match(req.body.messages[0].content, /不是真实|不是真|不是主智能体真实/);
  await request("POST", "/api/companion/bubble", {
    space: "space-a",
    body: {
      context: "other",
    },
  });
  assert.equal(seen.length, before + 1);
});
test("Admin URL validation rejects query credentials and requires explicit local opt-in", () => {
  assert.throws(() => endpoint(base + "?token=secret"));
  delete process.env.ALLOW_LOCAL_API;
  assert.throws(() => endpoint(base));
  process.env.ALLOW_LOCAL_API = "1";
});
