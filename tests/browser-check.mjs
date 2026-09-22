import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { DatabaseSync } from "node:sqlite";
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "playwright"
);
const root = path.resolve(import.meta.dirname, ".."),
  temp = fs.mkdtempSync(path.join(os.tmpdir(), "onestaff-browser-"));
const out =
  process.env.BROWSER_OUTPUT || path.join(root, "test-results/browser");
fs.mkdirSync(out, {
  recursive: true,
});
const child = spawn(process.execPath, ["server/index.js"], {
  cwd: root,
  env: {
    ...process.env,
    DATA_DIR: temp,
    PORT: "0",
    HOST: "127.0.0.1",
    ADMIN_PASSWORD: "browser-test-only",
    NODE_ENV: "test",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let browser,
  db,
  base,
  output = "";
try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(Error("Server startup: " + output)),
      10000,
    );
    child.stdout.on("data", (b) => {
      output += b;
      const m = output.match(/localhost:(\d+)/);
      if (m) {
        base = "http://127.0.0.1:" + m[1];
        clearTimeout(timer);
        resolve();
      }
    });
    child.stderr.on("data", (b) => (output += b));
    child.once("exit", () => reject(Error(output)));
  });
  db = new DatabaseSync(path.join(temp, "onestaff.db"));
  browser = await chromium.launch({
    headless: true,
    ...(process.env.BROWSER_EXECUTABLE
      ? {
          executablePath: process.env.BROWSER_EXECUTABLE,
        }
      : {}),
    args: [
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--no-zygote",
      "--use-gl=angle",
      "--use-angle=swiftshader",
    ],
  });
  const results = [];
  for (const viewport of process.env.BROWSER_ONLY_UNLOCK
    ? []
    : [
        {
          width: 360,
          height: 800,
        },
        {
          width: 390,
          height: 844,
        },
        {
          width: 768,
          height: 1024,
        },
        {
          width: 1440,
          height: 1000,
        },
      ].filter(
        (v) =>
          !process.env.BROWSER_WIDTH ||
          v.width === Number(process.env.BROWSER_WIDTH),
      )) {
    const context = await browser.newContext({
        viewport,
        acceptDownloads: true,
      }),
      page = await context.newPage(),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(base + "/app.html");
    await page.locator("#partner-name").fill("浏览器验收" + viewport.width);
    await page
      .getByRole("button", {
        name: "开启我的智能空间",
      })
      .click();
    await page.locator("#message-input").waitFor();
    for (const route of [
      "chat",
      "employees",
      "tasks",
      "artifacts",
      "knowledge",
      "plugins",
      "discover",
      "friends",
      "hello",
      "stats",
      "settings",
    ]) {
      await page.goto(base + "/app.html#" + route);
      await page.waitForFunction(
        () =>
          document.querySelector("#content") &&
          !document.querySelector(".skeleton"),
      );
      await page.evaluate(() => {
        scrollTo(0, 0);
        document.querySelector(".stage").scrollTop = 0;
      });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth + 2,
        ),
        false,
        `${viewport.width} ${route} horizontal overflow`,
      );
      if (["chat", "tasks", "settings"].includes(route))
        await page.screenshot({
          path: path.join(out, `${viewport.width}-${route}.png`),
          fullPage: true,
        });
      await page.evaluate(
        () =>
          (window._scrollBefore = [
            scrollY,
            ...[...document.querySelectorAll("*")].map((e) => e.scrollTop),
          ]),
      );
      await page.mouse.move(viewport.width - 25, viewport.height / 2);
      await page.mouse.wheel(0, 1000);
      await page.waitForTimeout(250);
      let state = await page.evaluate(() => {
        const s = document.querySelector(".stage");
        return {
          can:
            document.documentElement.scrollHeight > innerHeight + 10 ||
            s.scrollHeight > s.clientHeight + 10,
          moved: [
            scrollY,
            ...[...document.querySelectorAll("*")].map((e) => e.scrollTop),
          ].some((v, i) => v > (window._scrollBefore[i] || 0)),
        };
      });
      if (state.can && !state.moved) {
        await page.mouse.wheel(0, 700);
        await page.waitForTimeout(300);
        state = await page.evaluate(() => ({
          can: true,
          moved:
            scrollY > 0 ||
            [...document.querySelectorAll("*")].some((e) => e.scrollTop > 0),
        }));
      }
      if (state.can)
        assert.equal(
          state.moved,
          true,
          `${viewport.width} ${route} wheel trapped`,
        );
    }
    await page.locator("#speech-rate").fill("1.5");
    await page.locator("#speech-volume").fill("0.4");
    await page
      .locator(
        '[data-form="speech-preferences"] button[type="submit"], [data-form="speech-preferences"] button:not([type])',
      )
      .click();
    await page.waitForFunction(() => session.profile.speechRate === 1.5);
    await page.reload();
    await page.locator("#speech-rate").waitFor();
    assert.equal(await page.locator("#speech-rate").inputValue(), "1.5");
    await page.locator('[data-action="device-diagnostics"]').click();
    await page.locator("#dialog[open]").waitFor();
    assert.ok((await page.locator(".diagnostic-row").count()) >= 5);
    await page.keyboard.press("Escape");
    const space = db
      .prepare("SELECT id FROM spaces WHERE profile LIKE ?")
      .get("%浏览器验收" + viewport.width + "%").id;
    const id = "browser-task-" + viewport.width,
      now = new Date().toISOString(),
      text = "节点草稿内容：需要核验。\n".repeat(80);
    db.prepare(
      "INSERT INTO tasks(id,space,request,title,status,plan,inputs,channel,output,review,created,updated) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
    ).run(
      id,
      space,
      "验证草稿查看",
      "协作草稿验收",
      "needs_revision",
      JSON.stringify({
        summary: "验证草稿",
        steps: [
          {
            id: "s1",
            role: "writer",
            action: "整理项目正文",
            depends: [],
          },
        ],
        criteria: ["完整正文"],
      }),
      "[]",
      "direct",
      text,
      JSON.stringify({
        pass: false,
        summary: "尚需核验",
        issues: ["请检查事实"],
      }),
      now,
      now,
    );
    db.prepare("INSERT INTO task_node_outputs VALUES(?,?,?,?,?)").run(
      id,
      "s1",
      text,
      "done",
      now,
    );
    await page.goto(base + "/app.html#tasks/" + id);
    await page.locator('[data-action="view-node"]').first().click();
    await page.locator(".node-output").waitFor();
    assert.match(
      await page.locator(".node-output").textContent(),
      /节点草稿内容/,
    );
    await page.mouse.move(viewport.width / 2, viewport.height / 2);
    await page.mouse.wheel(0, 600);
    await page.waitForTimeout(250);
    assert.ok(
      await page
        .locator("#dialog .dialog-body")
        .evaluate((d) => d.scrollTop > 0),
    );
    await page.keyboard.press("Escape");
    const download = page.waitForEvent("download");
    await page.locator('[data-action="export-task"][data-kind="docx"]').click();
    const file = await download;
    assert.match(file.suggestedFilename(), /待核验草稿/);
    await page.goto(base + "/app.html#settings");
    await page.locator('[data-action="admin"]').click();
    await page.locator('input[name="password"]').fill("browser-test-only");
    await page.locator('[data-form="admin-login"] button').click();
    await page.locator('[data-form="admin-config"]').waitFor();
    for (const height of [viewport.height, 400]) {
      await page.setViewportSize({ width: viewport.width, height });
      const scroller = page.locator("#dialog .dialog-body");
      await scroller.focus();
      await page.keyboard.press("Control+End");
      await page.waitForFunction(
        () => {
          const body = document.querySelector("#dialog .dialog-body");
          return body.scrollTop + body.clientHeight >= body.scrollHeight - 3;
        },
        null,
        { timeout: 2500 },
      );
      const geometry = await scroller.evaluate((body) => {
        const dialog = body.closest("dialog");
        const head = dialog
          .querySelector(".dialog-head")
          .getBoundingClientRect();
        const box = body.getBoundingClientRect();
        const outer = dialog.getBoundingClientRect();
        return {
          reachedEnd:
            body.scrollTop + body.clientHeight >= body.scrollHeight - 3,
          headClear: head.bottom <= box.top + 1 && head.top >= 0,
          fits: outer.top >= 0 && outer.bottom <= innerHeight + 1,
          noOverflow: body.scrollWidth <= body.clientWidth + 2,
        };
      });
      assert.deepEqual(
        geometry,
        {
          reachedEnd: true,
          headClear: true,
          fits: true,
          noOverflow: true,
        },
        `dialog must scroll to bottom without covering header at ${viewport.width}x${height}`,
      );
      await page.locator('#dialog [data-action="close"]').click();
      await page.locator('[data-action="admin"]').click();
      await page.locator('[data-form="admin-config"]').waitFor();
    }
    await page.setViewportSize(viewport);
    await page.mouse.move(viewport.width / 2, viewport.height / 2);
    await page.mouse.wheel(0, 1200);
    await page.waitForTimeout(250);
    assert.ok(
      await page
        .locator("#dialog .dialog-body")
        .evaluate((d) => d.scrollTop > 0),
    );
    assert.equal(
      await page
        .locator("#dialog .dialog-body")
        .evaluate((d) => d.scrollWidth > d.clientWidth + 2),
      false,
    );
    await page.screenshot({
      path: path.join(out, `${viewport.width}-dialog.png`),
    });
    assert.equal(
      await page
        .locator('input[name="agent_director"], input[name="agent_supervisor"]')
        .count(),
      0,
    );
    await page.route("**/api/admin/test", async (route) => {
      const body = route.request().postDataJSON();
      const fail = body.role === "researcher";
      await route.fulfill({
        status: fail ? 400 : 200,
        contentType: "application/json",
        body: JSON.stringify(
          fail
            ? {
                error: "Validation error",
                diagnosis: "HTTP 400\ntargetAgentIds.0: Invalid UUID",
              }
            : {
                ok: true,
                channel: "fixture",
                elapsedMs: 20,
                reply: "测试夹具连接成功",
              },
        ),
      });
    });
    const modelButton = page.locator('[data-action="test-profile"]').last();
    await modelButton.scrollIntoViewIfNeeded();
    const modelScroll = await page
      .locator("#dialog .dialog-body")
      .evaluate((d) => d.scrollTop);
    await modelButton.click();
    await page.waitForFunction(() =>
      [...document.querySelectorAll(".profile-result")].some((e) =>
        e.textContent.includes("测试夹具连接成功"),
      ),
    );
    assert.ok(
      Math.abs(
        (await page
          .locator("#dialog .dialog-body")
          .evaluate((d) => d.scrollTop)) - modelScroll,
      ) < 120,
      "model test should retain scroll position",
    );
    await page.locator("summary").filter({ hasText: "02 · 协作方式" }).click();
    await page.locator('[data-action="test-all-employees"]').click();
    await page.waitForFunction(() =>
      document
        .querySelector("#batch-test-summary")
        .textContent.includes("测试结束"),
    );
    assert.match(
      await page.locator("#batch-test-summary").textContent(),
      /不可用 1/,
    );
    assert.match(
      await page.locator('[data-employee-result="researcher"]').textContent(),
      /targetAgentIds.0/,
    );
    assert.match(
      await page.locator('[data-employee-result="director"]').textContent(),
      /可用/,
    );
    await page.screenshot({
      path: path.join(out, `${viewport.width}-employee-tests.png`),
      fullPage: true,
    });
    await page.unroute("**/api/admin/test");
    await page.keyboard.press("Escape");
    if (viewport.width <= 820) {
      await page.locator('[data-action="menu"]').click();
      await page.locator(".sidebar.open").waitFor();
      await page.locator('.sidebar a[href="#knowledge"]').click();
      await page.locator("#kb-upload").waitFor({
        state: "attached",
      });
      assert.equal(await page.locator(".sidebar.open").count(), 0);
    }
    const chat = (
      await (
        await page.request.post(base + "/api/chats", {
          data: {
            employee: "director",
          },
        })
      ).json()
    ).id;
    db.prepare(
      "INSERT INTO messages(chat,role,content,channel,meta,created) VALUES(?,?,?,?,?,?)",
    ).run(
      chat,
      "assistant",
      "这是用于验证聊天导出的测试正文。\n".repeat(90) + "长回复末尾标记",
      "fixture",
      JSON.stringify({
        review: {
          state: "clear",
          summary: "测试复核",
          issues: [],
        },
        followups: ["下一步如何验证这份结果？"],
      }),
      now,
    );
    for (let i = 0; i < 8; i++) {
      db.prepare(
        "INSERT INTO messages(chat,role,content,channel,meta,created) VALUES(?,?,?,?,?,?)",
      ).run(
        chat,
        i % 2 ? "assistant" : "user",
        `第${i + 2}条消息\n` + "多轮滚动验证。\n".repeat(10),
        "fixture",
        "{}",
        now,
      );
    }
    await page.goto(base + "/app.html#chat");
    await page.locator('[data-action="chat-history"]').click();
    await page
      .locator('[data-action="load-flow-chat"][data-id="' + chat + '"]')
      .click();
    const conversation = page.locator("#conversation");
    await page.waitForFunction(
      () => document.querySelectorAll("#conversation .message").length === 9,
    );
    await conversation.evaluate((el) => {
      el.scrollTop = 0;
    });
    await conversation.hover();
    await page.mouse.wheel(0, 650);
    await page.waitForTimeout(350);
    assert.ok(
      await conversation.evaluate((el) => el.scrollTop > 100),
      "wheel must scroll long chat",
    );
    await conversation.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    assert.ok(
      await conversation.evaluate((el) => {
        const last = el
          .querySelector(".message:last-child")
          .getBoundingClientRect();
        const box = el.getBoundingClientRect();
        return last.bottom <= box.bottom + 2 && last.bottom > box.top;
      }),
      "last message must be reachable, not clipped by message list",
    );
    await page.mouse.wheel(0, -650);
    await page.waitForTimeout(350);
    assert.ok(
      await conversation.evaluate(
        (el) => el.scrollTop < el.scrollHeight - el.clientHeight - 100,
      ),
      "wheel must scroll back to history",
    );
    await page.locator('[data-action="followup"]').click();
    assert.equal(
      await page.locator("#message-input").inputValue(),
      "下一步如何验证这份结果？",
    );
    await page.locator('[data-action="export-message"]').first().click();
    const messageDownload = page.waitForEvent("download");
    await page
      .locator('[data-action="generate-message-file"][data-kind="pdf"]')
      .click();
    assert.match((await messageDownload).suggestedFilename(), /\.pdf$/);
    await page.keyboard.press("Escape");
    await page.screenshot({
      path: path.join(out, `${viewport.width}-conversation.png`),
      fullPage: true,
    });
    assert.deepEqual(errors, []);
    results.push({
      width: viewport.width,
      routes: 11,
      passed: true,
    });
    await context.close();
  }
  for (const width of process.env.BROWSER_WIDTH ? [] : [390, 768]) {
    const context = await browser.newContext({
        viewport: {
          width,
          height: 900,
        },
      }),
      page = await context.newPage();
    page.setDefaultTimeout(15000);
    await page.goto(base + "/unlock.html");
    await page.waitForTimeout(300);
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 2,
      ),
      false,
      "unlock overflow",
    );
    assert.ok(
      await page
        .locator(".panel.access")
        .evaluate((e) => e.clientWidth > Math.min(innerWidth * 0.8, 580)),
      "unlock panel too narrow",
    );
    await page.screenshot({
      path: path.join(out, width + "-unlock.png"),
      fullPage: true,
    });
    await page.locator('[data-unlock-mode="gesture"]').click();
    await page.evaluate(() => {
      window.Hands = class {
        setOptions() {}
        onResults() {}
        close() {}
      };
      navigator.mediaDevices.getUserMedia = async () => {
        throw new DOMException("test denied", "NotAllowedError");
      };
    });
    await page.locator("#gestureStart").click();
    await page.waitForFunction(() =>
      document
        .querySelector("#gestureCountdown")
        .textContent.includes("摄像头权限被拒绝"),
    );
    await page.locator('[data-unlock-mode="pin"]').click();
    for (const digit of "1314")
      await page
        .locator("#keypad button")
        .filter({
          hasText: new RegExp("^" + digit + "$"),
        })
        .click();
    await page.waitForFunction(
      () => !document.querySelector("#success").classList.contains("hidden"),
    );
    await page.goto(base + "/");
    await page.locator("#go").click();
    const lock = page.frameLocator("#lockFrame");
    await lock.locator("#keypad button").first().waitFor({ state: "visible" });
    for (const digit of "1314")
      await lock
        .locator("#keypad button")
        .filter({ hasText: new RegExp("^" + digit + "$") })
        .click();
    await page.waitForURL("**/app.html#onboarding");
    assert.equal(
      await page
        .locator("body")
        .innerText()
        .then((text) => text.length > 0),
      true,
    );
    await context.close();
  }
  fs.writeFileSync(
    path.join(out, "results.json"),
    JSON.stringify(results, null, 2),
  );
  console.log(JSON.stringify(results));
} finally {
  db?.close();
  await browser?.close();
  child.kill("SIGTERM");
  await once(child, "exit");
  fs.rmSync(temp, {
    recursive: true,
    force: true,
  });
}
