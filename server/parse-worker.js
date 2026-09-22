import { parentPort, workerData } from "node:worker_threads";
import { parseDocument } from "./parser.js";
try {
  parentPort.postMessage(await parseDocument(workerData));
} catch (error) {
  parentPort.postMessage({
    status: "parse_failed",
    text: "",
    error: "本地提取失败；原文件仍已保存，可传给 OpenHex。" + String(error.message).slice(0, 200),
  });
}
