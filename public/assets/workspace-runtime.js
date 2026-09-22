const networkMeter = (() => {
  let bytes = 0,
    at = performance.now();
  const add = (n) => {
    bytes += Math.max(0, Number(n) || 0);
  };
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        if (new URL(e.name).origin === location.origin && !/\/chats\/[^/]+\/(send|resume)$/.test(e.name))
          add(e.transferSize);
      }
    }).observe({
      type: "resource",
      buffered: false,
    });
  } catch {}
  return {
    add,
    sample() {
      const t = performance.now(),
        rate = (bytes * 1000) / Math.max(1, t - at);
      bytes = 0;
      at = t;
      return rate;
    },
  };
})();
function mediaProblem(error, device = "麦克风") {
  if (!window.isSecureContext)
    return `当前连接不是安全连接，浏览器禁止访问${device}。请使用 HTTPS；本机可以使用 localhost。`;
  return (
    {
      NotAllowedError: `${device}权限被拒绝。请点击地址栏权限图标允许访问，并检查系统隐私设置。`,
      NotFoundError: `未检测到${device}。请连接设备，检查系统是否能识别，再重试。`,
      NotReadableError: `${device}被其他程序占用或驱动异常。请关闭占用设备的会议软件，检查系统设备设置。`,
      OverconstrainedError: `${device}不支持当前采集参数，请换用其他设备。`,
      SecurityError: `浏览器或系统安全策略禁用了${device}。请检查站点权限。`,
      AbortError: `${device}启动被中断，请重新连接设备再试。`,
      "not-allowed": "语音权限被拒绝，请允许麦克风访问。",
      "audio-capture": "未能采集音频，请检查麦克风连接和系统输入设备。",
      network: "浏览器语音识别服务连接失败。请检查网络，或在设置中配置后端语音识别。",
      "no-speech": "没有识别到声音，请靠近麦克风后重试。",
    }[error?.name || error?.error] ||
    error?.message ||
    "设备暂时不可用，请使用文字输入。"
  );
}
let activeRecognition = null,
  recordingTimer = null,
  voiceStarting = false,
  audioObjectUrl = null;
function paintMic(on) {
  const b = document.querySelector('[data-action="voice"]');
  if (b) {
    b.setAttribute("aria-pressed", String(on));
    b.title = on ? "正在录音，点击停止" : "点击开始录音";
    b.classList.toggle("recording", on);
  }
}
function stopSpeech() {
  if (typeof liveAudio !== "undefined" && liveAudio) {
    liveAudio.pause();
    liveAudio = null;
  }
  if (audioObjectUrl) {
    URL.revokeObjectURL(audioObjectUrl);
    audioObjectUrl = null;
  }
  window.speechSynthesis?.cancel();
  document.querySelector("#companion")?.classList.remove("speaking");
}
async function startVoiceCapture() {
  if (activeRecognition) {
    activeRecognition.stop();
    return;
  }
  if (recording) {
    if (recording.state === "recording") recording.stop();
    return;
  }
  if (voiceStarting) return;
  if (!isSecureContext) return toast(mediaProblem({}, "麦克风"));
  voiceStarting = true;
  let stream;
  try {
    if (!session.speech) {
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SR) throw Error("当前浏览器不支持语音识别。请配置后端语音服务，或使用支持语音识别的浏览器。");
      const recognition = new SR();
      activeRecognition = recognition;
      recognition.lang = "zh-CN";
      recognition.onresult = (e) => {
        if ($("#message-input")) {
          $("#message-input").value += e.results[0][0].transcript;
          savedDraft = $("#message-input").value;
        }
      };
      recognition.onerror = (e) => toast(mediaProblem(e));
      recognition.onend = () => {
        activeRecognition = null;
        paintMic(false);
      };
      recognition.start();
      paintMic(true);
      toast("正在听，请说话。识别结果填入输入框，由你确认发送。");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder)
      throw Error("当前浏览器缺少录音能力，请更新浏览器或使用文字输入。");
    stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
    });
    const chunks = [],
      rec = new MediaRecorder(stream);
    recording = rec;
    paintMic(true);
    rec.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };
    rec.onerror = (e) => {
      toast(mediaProblem(e.error));
      stream.getTracks().forEach((t) => t.stop());
      recording = null;
      paintMic(false);
      clearTimeout(recordingTimer);
    };
    rec.onstop = async () => {
      clearTimeout(recordingTimer);
      stream.getTracks().forEach((t) => t.stop());
      recording = null;
      paintMic(false);
      const form = new FormData();
      toast("正在转写录音…");
      try {
        form.append(
          "file",
          await wavRecording(
            new Blob(chunks, {
              type: rec.mimeType,
            }),
          ),
          "recording.wav",
        );
        const out = await api("/speech/transcribe", "POST", form);
        savedDraft = ($("#message-input")?.value || savedDraft) + (out.text || "");
        if ($("#message-input")) $("#message-input").value = savedDraft;
        toast(out.text ? "识别完成，请确认后发送。" : "没有识别到文字，请检查麦克风输入。");
      } catch (e) {
        toast(e.message);
      }
    };
    rec.start();
    recordingTimer = setTimeout(() => {
      if (rec.state === "recording") rec.stop();
    }, 60000);
    toast("正在录音，点击麦克风停止；最长60秒。");
  } catch (e) {
    stream?.getTracks().forEach((t) => t.stop());
    activeRecognition = null;
    paintMic(false);
    toast(mediaProblem(e));
  } finally {
    voiceStarting = false;
  }
}
function speechSettings() {
  return `<section class="card speech-settings"><h3>语音与总监跟进</h3><form data-form="speech-preferences" class="form"><div class="grid two"><div><label for="speech-rate">朗读语速 <output id="rate-label">${session.profile.speechRate ?? 1}×</output></label><input id="speech-rate" name="speechRate" type="range" min="0.5" max="2" step="0.1" value="${session.profile.speechRate ?? 1}"></div><div><label for="speech-volume">朗读音量 <output id="volume-label">${Math.round((session.profile.speechVolume ?? 1) * 100)}%</output></label><input id="speech-volume" name="speechVolume" type="range" min="0" max="1" step="0.05" value="${session.profile.speechVolume ?? 1}"></div></div><label class="flex"><input type="checkbox" name="proactive" ${session.profile.proactive !== false ? "checked" : ""}>总监主动提供下一步问题建议</label><p class="hint">语速和音量作用于后续朗读；手机浏览器可能由系统音量控制实际响度。问题建议会增加一次模型调用，不会自行执行任务。</p><div class="flex wrap"><button class="btn primary">保存设置</button><button type="button" class="btn" data-action="speech-preview">试听</button><button type="button" class="btn" data-action="speech-stop">停止朗读</button><button type="button" class="btn" data-action="device-diagnostics">检查设备能力</button></div></form></section>`;
}
async function deviceDiagnostics() {
  const rows = [
    ["安全连接", isSecureContext ? "正常" : "请使用 HTTPS 或 localhost"],
    ["网络", navigator.onLine ? "浏览器显示在线；服务连通性仍需验证" : "离线，请连接网络"],
    [
      "录音接口",
      navigator.mediaDevices?.getUserMedia && window.MediaRecorder ? "支持" : "不支持或被安全策略禁用",
    ],
    ["浏览器朗读", "speechSynthesis" in window ? "支持" : "不支持，可配置后端 TTS"],
    [
      "语音识别",
      session.speech
        ? "已配置后端，需实际录音验证"
        : window.SpeechRecognition || window.webkitSpeechRecognition
          ? "支持浏览器识别"
          : "需配置后端语音服务",
    ],
  ];
  for (const name of ["camera", "microphone"]) {
    try {
      const p = await navigator.permissions.query({
        name,
      });
      rows.push([
        name === "camera" ? "摄像头权限" : "麦克风权限",
        {
          granted: "已允许",
          denied: "已拒绝，请在站点权限及系统隐私设置中允许",
          prompt: "未授权，使用时会请求",
        }[p.state],
      ]);
    } catch {
      rows.push([name === "camera" ? "摄像头权限" : "麦克风权限", "浏览器不支持预查询，请通过实际启动验证"]);
    }
  }
  try {
    await api("/telemetry");
    rows.push(["后端连接", "正常"]);
  } catch (e) {
    rows.push(["后端连接", e.message]);
  }
  modal(
    "设备与连接检查",
    `<p class="hint">此检查不会自动开启摄像头或麦克风；硬件是否可用需在使用时验证。</p>${rows.map(([k, v]) => `<div class="diagnostic-row"><strong>${k}</strong><span>${escape(v)}</span></div>`).join("")}`,
  );
}
async function downloadFile(url, name) {
  const r = await fetch(url, {
    credentials: "same-origin",
    signal: AbortSignal.timeout(150000),
  });
  if (!r.ok) {
    let v;
    try {
      v = await r.json();
    } catch {}
    throw Error(v?.error || `下载失败（HTTP ${r.status}），请重试或检查文件是否仍存在。`);
  }
  const disposition = r.headers.get("content-disposition") || "";
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(disposition),
    plain = /filename="([^"]+)"/i.exec(disposition);
  let filename = name || plain?.[1] || "工作成果";
  if (encoded)
    try {
      filename = decodeURIComponent(encoded[1]);
    } catch {}
  const blob = await r.blob();
  if (!blob.size) throw Error("服务器返回空文件，请重新生成后下载。");
  const objectUrl = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = objectUrl;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
  toast("文件已交给浏览器下载，请查看下载列表。");
}
document.addEventListener("DOMContentLoaded", () => {
  Object.assign(actions, {
    "device-diagnostics": deviceDiagnostics,
    "speech-stop": stopSpeech,
    "speech-preview": () => {
      const old = {
        ...session.profile,
      };
      session.profile.speechRate = Number($("#speech-rate")?.value || 1);
      session.profile.speechVolume = Number($("#speech-volume")?.value ?? 1);
      return speech("你好，我是你的数字同事。我们可以一起把这项工作做好。").finally(() => {
        session.profile = old;
      });
    },
    followup: (b) => {
      if (busy) return toast("请等本轮完成后继续");
      const input = $("#message-input");
      if (input) {
        input.value = b.dataset.question;
        savedDraft = input.value;
        input.focus();
        input.scrollIntoView({
          block: "nearest",
        });
      }
    },
    "export-message": (b) =>
      modal(
        "导出回复",
        `<p class="hint">导出已保存的回复；未通过独立监察的内容会标记为草稿。</p><div class="flex wrap">${["docx", "pdf", "pptx", "md"].map((kind) => `<button class="btn" data-action="generate-message-file" data-id="${b.dataset.id}" data-kind="${kind}">${kind.toUpperCase()}</button>`).join("")}</div>`,
      ),
    "generate-message-file": async (b) => {
      b.disabled = true;
      try {
        const out = await api("/messages/" + b.dataset.id + "/export", "POST", {
          kind: b.dataset.kind,
        });
        await downloadFile("/api/artifacts/" + out.id + "/download", out.name);
      } finally {
        b.disabled = false;
      }
    },
    "view-node": async (b) => {
      const node = await api("/tasks/" + b.dataset.task + "/nodes/" + encodeURIComponent(b.dataset.node));
      modal(
        node.step.action,
        `<p class="hint">${node.status === "done" ? "本节点已形成产出；整体是否通过监察请查看任务结论。" : "当前状态：" + escape(statuses[node.status] || "等待执行") + "。草稿不代表最终交付。"}</p><pre class="node-output">${escape(node.text || "当前节点尚未生成正文。请稍后刷新查看。")}</pre><button class="btn" data-action="view-node" data-task="${b.dataset.task}" data-node="${b.dataset.node}">刷新节点内容</button>`,
      );
    },
    "export-task": async (b) => {
      b.disabled = true;
      try {
        const out = await api("/tasks/" + b.dataset.id + "/export", "POST", {
          kind: b.dataset.kind,
        });
        await downloadFile("/api/artifacts/" + out.id + "/download", out.name);
      } finally {
        b.disabled = false;
      }
    },
  });
  document.addEventListener("input", (e) => {
    if (e.target.id === "speech-rate") $("#rate-label").textContent = e.target.value + "×";
    if (e.target.id === "speech-volume")
      $("#volume-label").textContent = Math.round(e.target.value * 100) + "%";
  });
  document.addEventListener("submit", async (e) => {
    if (e.target.dataset.form !== "speech-preferences") return;
    e.preventDefault();
    const form = e.target,
      button = form.querySelector("button");
    button.disabled = true;
    try {
      const f = new FormData(form);
      session.profile = await api("/profile", "PATCH", {
        speechRate: Number(f.get("speechRate")),
        speechVolume: Number(f.get("speechVolume")),
        proactive: f.has("proactive"),
      });
      toast("语音与跟进偏好已保存。");
    } catch (err) {
      toast(err.message);
    } finally {
      button.disabled = false;
    }
  });
  document.addEventListener("click", async (e) => {
    const a = e.target.closest('a[href*="/download"]');
    if (!a) return;
    const url = new URL(a.href);
    if (url.origin !== location.origin || !url.pathname.startsWith("/api/")) return;
    e.preventDefault();
    if (a.dataset.downloading) return;
    a.dataset.downloading = "1";
    try {
      await downloadFile(url.href);
    } catch (err) {
      toast(err.message);
    } finally {
      delete a.dataset.downloading;
    }
  });
  document.querySelector("#dialog")?.addEventListener("click", (e) => {
    const d = e.currentTarget;
    if (e.target !== d) return;
    const r = d.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) d.close();
  });
});
window.addEventListener("pagehide", () => {
  clearTimeout(recordingTimer);
  activeRecognition?.abort();
  if (recording?.state === "recording") recording.stop();
  stopSpeech();
});
