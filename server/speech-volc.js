import { randomUUID } from "node:crypto";
import { endpoint } from "./providers.js";
const timeout = (signal) => AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(120000)]);
function headers(key, resource) {
  return {
    "Content-Type": "application/json",
    "X-Api-Key": key,
    "X-Api-Resource-Id": resource,
    "X-Api-Request-Id": randomUUID(),
  };
}
export async function transcribeVolc(c, audio, signal) {
  const r = await fetch(endpoint(c.baseUrl) + "/auc/bigmodel/recognize/flash", {
    method: "POST",
    redirect: "error",
    headers: {
      ...headers(c.apiKey, c.asrResource || "volc.bigasr.auc_turbo"),
      "X-Api-Sequence": "-1",
    },
    body: JSON.stringify({
      audio: {
        data: audio.toString("base64"),
      },
      request: {
        model_name: c.asrModel === "seed_asr" ? "bigmodel" : c.asrModel,
        enable_itn: true,
        enable_punc: true,
      },
    }),
    signal: timeout(signal),
  });
  if (!r.ok) throw Error(`豆包 ASR HTTP ${r.status}；请检查语音 Key、资源授权和余额`);
  const code = r.headers.get("X-Api-Status-Code");
  if (code && code !== "20000000")
    throw Error(`豆包 ASR ${code}：${r.headers.get("X-Api-Message") || "识别失败"}`);
  const j = await r.json();
  if (j.code && j.code !== 20000000) throw Error(`豆包 ASR ${j.code}：${j.message || "识别失败"}`);
  if (typeof j.result?.text !== "string" || !j.result.text.trim())
    throw Error("未识别到文字，请检查麦克风或重录");
  return {
    text: j.result.text,
  };
}
export async function synthesizeVolc(c, text, signal) {
  const r = await fetch(endpoint(c.ttsBaseUrl || c.baseUrl) + "/tts/unidirectional", {
    method: "POST",
    redirect: "error",
    headers: headers(c.ttsApiKey || c.apiKey, c.ttsResource || c.ttsModel),
    body: JSON.stringify({
      req_params: {
        text,
        speaker: c.voice,
        audio_params: {
          format: "mp3",
          sample_rate: 24000,
        },
      },
    }),
    signal: timeout(signal),
  });
  if (!r.ok) throw Error(`豆包 TTS HTTP ${r.status}；请检查语音 Key、音色及资源权限`);
  const reader = r.body.getReader(),
    decoder = new TextDecoder(),
    chunks = [];
  let buffer = "",
    size = 0,
    finished = false;
  function consume(line) {
    if (!line.trim()) return;
    const j = JSON.parse(line.replace(/^data:\s*/, ""));
    if (j.code === 20000000) {
      finished = true;
      return;
    }
    if (j.code !== 0) throw Error(`豆包 TTS ${j.code}：${j.message || "合成失败"}`);
    if (j.data) {
      const b = Buffer.from(j.data, "base64");
      size += b.length;
      if (size > 25 * 1024 * 1024) throw Error("语音结果过大");
      chunks.push(b);
    }
  }
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value || new Uint8Array(), {
        stream: !done,
      });
      if (buffer.length > 36 * 1024 * 1024) throw Error("语音响应过大");
      let i;
      while ((i = buffer.indexOf("\n")) >= 0) {
        consume(buffer.slice(0, i));
        buffer = buffer.slice(i + 1);
      }
      if (done) {
        consume(buffer);
        break;
      }
    }
    if (!finished || !size) throw Error("语音流不完整，未返回可播放音频");
    return {
      buffer: Buffer.concat(chunks),
      type: "audio/mpeg",
    };
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
