(() => {
  "use strict";

  let leaving = false;
  const boundDocs = new WeakSet();
  const frame = document.querySelector("#lockFrame");
  async function enter(doc) {
    if (leaving) return;
    const note = doc?.querySelector("#bridge-note");
    if (location.protocol === "file:") {
      if (note)
        note.textContent =
          "请先运行工程中的“START_ONESTAFF.cmd”，再从 http://localhost:3000 进入。直接双击 HTML 无法连接后端。";
      return;
    }
    leaving = true;
    if (note) note.textContent = "验证完成，正在进入虚拟形象选择…";
    try {
      const response = await fetch("/api/session", {
        credentials: "same-origin",
        cache: "no-store",
      });
      if (!response.ok) throw Error("服务返回 " + response.status);
      await response.json();
      window.location.assign("/app.html#onboarding");
    } catch (error) {
      leaving = false;
      if (note)
        note.textContent = "后端未连接，请确认“START_ONESTAFF.cmd”的终端仍在运行，再点击“进入智能空间”。";
      console.error("进入工作空间失败", error);
    }
  }
  function decorateAndBind() {
    if (!frame) return;
    try {
      const doc = frame.contentDocument;
      if (!doc || boundDocs.has(doc)) return;
      const success = doc.querySelector("#success");
      if (!success) return;
      boundDocs.add(doc);
      const panel = success.firstElementChild || success;
      let button = doc.querySelector("#bridge-enter");
      if (!button) {
        button = doc.createElement("button");
        button.id = "bridge-enter";
        button.textContent = "进入智能空间";
        button.style.cssText =
          "display:block;margin:16px auto 8px;padding:12px 22px;border-radius:12px;border:1px solid rgba(112,166,255,.55);background:linear-gradient(135deg,#4a8cff,#1764e8);color:#fff;font-weight:700;cursor:pointer;box-shadow:0 10px 30px rgba(30,100,220,.28)";
        button.addEventListener("click", () => enter(doc));
        panel.appendChild(button);
      }
      let note = doc.querySelector("#bridge-note");
      if (!note) {
        note = doc.createElement("p");
        note.id = "bridge-note";
        note.textContent = "验证成功后会自动进入虚拟形象选择。";
        note.style.cssText =
          "max-width:480px;margin:0 auto;font-size:12px;line-height:1.7;padding:0 20px;color:#84a8da;text-align:center";
        panel.appendChild(note);
      }
      const check = () => {
        if (!success.classList.contains("hidden")) setTimeout(() => enter(doc), 520);
      };
      frame.contentWindow?.addEventListener("onestaff:unlocked", check);
      new MutationObserver(check).observe(success, {
        attributes: true,
        attributeFilter: ["class"],
      });
      check();
    } catch (error) {
      console.error("解锁接续绑定失败", error);
    }
  }
  window.addEventListener("message", (event) => {
    if (!frame || event.source !== frame.contentWindow) return;
    if (event.data?.type === "onestaff:unlocked" || event.data === "onestaff:unlocked") {
      enter(frame.contentDocument);
    }
  });
  frame?.addEventListener("load", decorateAndBind);
  decorateAndBind();
  const timer = setInterval(decorateAndBind, 350);
  window.addEventListener("pagehide", () => clearInterval(timer), {
    once: true,
  });
})();
