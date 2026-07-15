"use strict";

// Chrome Web Store용 스크린샷 5장(1280×800 PNG)을 생성한다.
//
// 원리: 허구 데이터 픽스처(store-assets/demo) 위에서 "실제 확장 코드"(content.css,
// content-core/entitlement/license-client/content.js, options.html/js)를 chrome.* shim으로
// 구동해, 화면에 보이는 가림 오버레이/선택 모드/범위 선택 UI/옵션 페이지가 전부 실제
// 제품 렌더링이 되게 한다(합성 이미지 아님). 그 페이지를 headless Chrome이 캡처한다.
//
// - 실제 개인정보/실존 브랜드 없음(픽스처는 example.com 허구 데이터만 사용)
// - 네트워크 요청 없음(chrome shim이 GET_ENTITLEMENT를 로컬에서 응답; fetch 호출 경로 없음)
// - 실행: node scripts/generate-screenshots.js  → store-assets/screenshots/*.png
const fs = require("fs");
const path = require("path");
const http = require("http");
const { execFile } = require("child_process");

const ROOT = path.join(__dirname, "..");
const OUT_DIR = path.join(ROOT, "store-assets", "screenshots");
const SCENE_DIR = path.join(ROOT, ".screenshot-scenes"); // 임시 (gitignore 대상)
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

// ---------------------------------------------------------------------
// 1) 공용 조각: demo 픽스처(스타일+본문), 확장 소스, chrome shim
// ---------------------------------------------------------------------
const demoHtml = read("store-assets/demo/index.html");
const demoStyle = /<style>([\s\S]*?)<\/style>/.exec(demoHtml)[1];
const demoBody = /<body>([\s\S]*?)<\/body>/.exec(demoHtml)[1];

const EN_MESSAGES = JSON.parse(read("_locales/en/messages.json"));

// 장면 전용 build-config: production 모드(개발 배너/진단 패널 숨김), Developer Pro/debug OFF.
const SCENE_BUILD_CONFIG = `(function (root) {
  root.CloakliBuildConfig = { mode: "production", developerPro: false, debug: false,
    licenseServerUrl: "https://cloakli-license.mycloakli.workers.dev", checkoutUrl: "" };
  if (typeof module !== "undefined" && module.exports) module.exports = root.CloakliBuildConfig;
})(typeof self !== "undefined" ? self : window);`;

// chrome.* shim: storage(장면별 seed) + runtime(onMessage/sendMessage) + i18n(en).
// window.__SCENE 전역(각 장면 HTML이 정의)을 읽는다.
const SHIM_JS = `(function () {
  const MESSAGES = ${JSON.stringify(EN_MESSAGES)};
  const scene = window.__SCENE || {};
  const data = scene.storage || {};
  const messageListeners = [];
  window.chrome = {
    runtime: {
      id: "scene-preview",
      lastError: undefined,
      getURL: (p) => p,
      getManifest: () => ({ version: "0.2.0" }),
      onMessage: { addListener: (fn) => messageListeners.push(fn) },
      sendMessage: (message, cb) => {
        if (message && message.type === "GET_ENTITLEMENT") {
          setTimeout(() => cb({ ok: true, entitlement: scene.entitlement || { tier: "free", source: "free", status: "none" } }), 0);
          return;
        }
        setTimeout(() => cb(undefined), 0);
      },
    },
    storage: {
      local: {
        get: (keys, cb) => {
          const list = Array.isArray(keys) ? keys : [keys];
          const out = {};
          list.forEach((k) => { if (k in data) out[k] = JSON.parse(JSON.stringify(data[k])); });
          setTimeout(() => cb(out), 0);
        },
        set: (obj, cb) => { Object.assign(data, JSON.parse(JSON.stringify(obj))); setTimeout(() => cb && cb(), 0); },
        remove: (keys, cb) => { (Array.isArray(keys) ? keys : [keys]).forEach((k) => delete data[k]); setTimeout(() => cb && cb(), 0); },
      },
      onChanged: { addListener: () => {} },
    },
    i18n: {
      getMessage: (key, subs) => {
        const entry = MESSAGES[key];
        if (!entry) return "";
        let text = entry.message;
        (Array.isArray(subs) ? subs : subs != null ? [subs] : []).forEach((v, i) => {
          text = text.split("$" + (i + 1)).join(String(v));
        });
        return text;
      },
    },
    tabs: { create: () => {}, query: (q, cb) => cb && cb([]) },
    alarms: { create: () => {}, onAlarm: { addListener: () => {} } },
    commands: { onCommand: { addListener: () => {} } },
  };
  // content script에 메시지를 보내는 헬퍼(장면 시나리오용)
  window.__sendToContent = (msg) => new Promise((resolve) => {
    if (messageListeners.length === 0) { resolve(); return; }
    messageListeners[0](msg, {}, resolve);
  });
  // 캡션 바
  if (scene.caption) {
    document.addEventListener("DOMContentLoaded", () => {
      const bar = document.createElement("div");
      bar.textContent = scene.caption;
      const edge = scene.captionAt === "bottom" ? "bottom:0" : "top:0";
      bar.style.cssText = "position:fixed;" + edge + ";left:0;right:0;height:60px;z-index:2147483647;" +
        "background:#101828;color:#fff;display:flex;align-items:center;justify-content:center;" +
        "font:700 24px 'Segoe UI',system-ui,sans-serif;letter-spacing:.2px;box-shadow:0 2px 8px rgba(0,0,0,.35)";
      document.body.appendChild(bar);
    });
  }
})();`;

const EXT_SOURCES = ["content-core.js", "entitlement.js", "license-client.js", "content.js"];

function fixturePage(opts) {
  // caption(60px) + zoom 0.92 픽스처(≈736px) = 1280×800 안에 맞춤
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<link rel="stylesheet" href="content.css">
<style>${demoStyle}
  html,body{width:1280px;height:800px;overflow:hidden;}
  body{display:block;background:#0b0f17;}
  #fixture{display:flex;width:1280px;height:800px;zoom:0.92;margin-top:60px;background:#f4f5f7;}
  ${opts.extraCss || ""}
</style></head><body>
<script>window.__SCENE = ${JSON.stringify({ caption: opts.caption, captionAt: opts.captionAt, storage: opts.storage || {}, entitlement: opts.entitlement })};</script>
<script src="shim.js"></script>
<div id="fixture">${opts.fixtureHtml != null ? opts.fixtureHtml : demoBody}</div>
${EXT_SOURCES.map((f) => (f === "entitlement.js" ? '<script src="build-config-scene.js"></script>\n' : "") + `<script src="${f}"></script>`).join("\n")}
<script>${opts.scenario || ""}</script>
</body></html>`;
}

const PRO_ENTITLEMENT = { tier: "pro", source: "license", status: "active", expiresAt: null, lastValidatedAt: Date.now(), licenseDisplaySuffix: "K9F2" };

// ---------------------------------------------------------------------
// 2) 장면 정의
// ---------------------------------------------------------------------
function buildScenes() {
  const scenes = [];

  // 장면 1: Before / After 비교 (오른쪽 사본만 가리는 site 규칙 seed)
  const beforeAfterFixture = `
    <div class="split">
      <div class="pane"><div class="pane-label">Before</div><div class="crop"><div class="mini" id="before">${demoBody}</div></div></div>
      <div class="pane"><div class="pane-label after">After — with Cloakli</div><div class="crop"><div class="mini" id="after">${demoBody}</div></div></div>
    </div>`;
  scenes.push({
    name: "screenshot-1-before-after",
    html: fixturePage({
      caption: "Hide sensitive information before sharing your screen",
      fixtureHtml: beforeAfterFixture,
      extraCss: `
        #fixture{background:#0b0f17;display:block;zoom:1;height:740px;}
        .split{display:flex;gap:16px;padding:120px 16px 0;}
        .pane{flex:1;}
        .pane-label{color:#9aa4b2;font:600 18px 'Segoe UI',sans-serif;margin:0 0 10px 2px;}
        .pane-label.after{color:#6ee7a0;}
        .crop{overflow:hidden;border-radius:10px;box-shadow:0 4px 18px rgba(0,0,0,.45);}
        .mini{width:1280px;height:800px;zoom:0.49;display:flex;background:#f4f5f7;}`,
      storage: {
        cloakliRules: {
          "127.0.0.1": [
            { id: "s1", hostname: "127.0.0.1", scope: "site", selector: "#after .card:nth-of-type(1) .value", pagePattern: null, createdAt: 1 },
            { id: "s2", hostname: "127.0.0.1", scope: "site", selector: "#after tr.unread", pagePattern: null, createdAt: 2 },
            { id: "s3", hostname: "127.0.0.1", scope: "site", selector: "#after .video:nth-of-type(1) .thumb", pagePattern: null, createdAt: 3 },
          ],
        },
      },
      entitlement: PRO_ENTITLEMENT,
    }),
  });

  // 장면 2: 선택 모드 (화면 고정 배너가 상단을 차지하므로 캡션은 하단에)
  scenes.push({
    name: "screenshot-2-selection",
    html: fixturePage({
      caption: "Select exactly what you want to hide",
      captionAt: "bottom",
      entitlement: PRO_ENTITLEMENT,
      scenario: `
        setTimeout(async () => {
          await window.__sendToContent({ type: "START_SELECTION_MODE" });
          const target = document.querySelector("table tr.unread");
          const r = target.getBoundingClientRect();
          const shield = document.getElementById("cloakli-selection-shield-root");
          shield.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }));
        }, 300);`,
    }),
  });

  // 장면 3: 범위 선택 UI (이 요소만 / 페이지 유형 / 사이트 전체)
  scenes.push({
    name: "screenshot-3-scope",
    html: fixturePage({
      caption: "Choose where each mask applies",
      entitlement: PRO_ENTITLEMENT,
      scenario: `
        setTimeout(async () => {
          await window.__sendToContent({ type: "START_SELECTION_MODE" });
          const target = document.querySelector(".video .thumb");
          const r = target.getBoundingClientRect();
          const shield = document.getElementById("cloakli-selection-shield-root");
          shield.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }));
        }, 300);`,
    }),
  });

  // 장면 4: 옵션 페이지 (실제 options.html + 저장 규칙 + License Pro 요약)
  const optionsHtml = read("options.html").replace(
    '<script src="content-core.js"></script>',
    `<script>window.__SCENE = ${JSON.stringify({
      caption: "Manage all your saved masks",
      storage: {
        cloakliRules: {
          "dashboard.example.com": [
            { id: "r1", hostname: "dashboard.example.com", scope: "site", selector: ".account-balance .value", pagePattern: null, role: "generic-text", family: "generic", createdAt: Date.now() - 86400000 },
            { id: "r2", hostname: "dashboard.example.com", scope: "element", selector: "#orders .order-row:nth-of-type(1)", pagePattern: null, role: "generic-text", family: "generic", createdAt: Date.now() - 4000000 },
          ],
          "mail.example.org": [
            { id: "r3", hostname: "mail.example.org", scope: "page", selector: ".mail-row .date-time", pagePattern: "/inbox", role: "date-time", family: "mail-list-row", createdAt: Date.now() - 500000 },
          ],
        },
        cloakliPausedHostnames: {},
      },
      entitlement: PRO_ENTITLEMENT,
    })};</script>\n<script src="shim.js"></script>\n<script src="content-core.js"></script>`
  ).replace('<script src="build-config.js"></script>', '<script src="build-config-scene.js"></script>')
   .replace("</head>", "<style>body{padding-top:60px;} html,body{width:1280px;min-height:800px;}</style></head>");
  scenes.push({ name: "screenshot-4-options", html: optionsHtml });

  // 장면 5: 로컬 우선 구조 설명 슬라이드 (UI 아님 — 다이어그램)
  scenes.push({
    name: "screenshot-5-local-first",
    html: `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><style>
      html,body{width:1280px;height:800px;margin:0;overflow:hidden;background:#0f1420;color:#eef2f8;font-family:'Segoe UI',system-ui,sans-serif;}
      .wrap{padding:64px 80px;}
      h1{font-size:44px;margin:0 0 10px;}
      p.sub{color:#9aa4b2;font-size:20px;margin:0 0 44px;}
      .diagram{display:flex;align-items:center;gap:28px;margin-bottom:48px;}
      .box{background:#161d2e;border:1px solid #2a3550;border-radius:14px;padding:26px 30px;}
      .box h3{margin:0 0 10px;font-size:22px;color:#4da3ff;}
      .box ul{margin:0;padding-left:20px;color:#c6cede;font-size:17px;line-height:1.75;}
      .arrow{color:#5b6b8c;font-size:15px;text-align:center;line-height:1.5;}
      .arrow .line{font-size:30px;color:#4da3ff;}
      .never{background:#131a29;border-left:4px solid #6ee7a0;border-radius:8px;padding:18px 24px;font-size:19px;color:#d7deea;}
      .never strong{color:#6ee7a0;}
    </style></head><body><div class="wrap">
      <h1>Your webpage content stays on your device</h1>
      <p class="sub">Cloakli is local-first. Masks are drawn and stored in your browser.</p>
      <div class="diagram">
        <div class="box" style="flex:1.2">
          <h3>Your browser</h3>
          <ul><li>Mask rules saved locally</li><li>Masks re-applied on revisit</li><li>Works offline</li></ul>
        </div>
        <div class="arrow"><div class="line">→</div>license check only<br>(only if you activate Pro)</div>
        <div class="box" style="flex:1">
          <h3>Cloakli license server</h3>
          <ul><li>Verifies your Pro license</li><li>Receives no page content</li></ul>
        </div>
      </div>
      <div class="never"><strong>Never sent anywhere:</strong> page text, emails, titles, images, screenshots, browsing history. No analytics, no tracking.</div>
    </div></body></html>`,
  });

  return scenes;
}

// ---------------------------------------------------------------------
// 3) 정적 서버 + headless Chrome 캡처
// ---------------------------------------------------------------------
function contentType(file) {
  if (file.endsWith(".html")) return "text/html; charset=utf-8";
  if (file.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (file.endsWith(".css")) return "text/css; charset=utf-8";
  return "application/octet-stream";
}

async function main() {
  if (!fs.existsSync(CHROME)) {
    console.error("Chrome 실행 파일을 찾지 못했습니다:", CHROME);
    process.exit(1);
  }
  fs.rmSync(SCENE_DIR, { recursive: true, force: true });
  fs.mkdirSync(SCENE_DIR, { recursive: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });

  // 장면 폴더 구성: 실제 확장 소스 + shim + 장면 HTML
  for (const f of ["content.css", ...EXT_SOURCES]) {
    fs.copyFileSync(path.join(ROOT, f), path.join(SCENE_DIR, f));
  }
  fs.copyFileSync(path.join(ROOT, "options.css"), path.join(SCENE_DIR, "options.css"));
  fs.copyFileSync(path.join(ROOT, "options.js"), path.join(SCENE_DIR, "options.js"));
  fs.writeFileSync(path.join(SCENE_DIR, "shim.js"), SHIM_JS);
  fs.writeFileSync(path.join(SCENE_DIR, "build-config-scene.js"), SCENE_BUILD_CONFIG);

  const scenes = buildScenes();
  for (const scene of scenes) {
    fs.writeFileSync(path.join(SCENE_DIR, scene.name + ".html"), scene.html);
  }

  const server = http.createServer((req, res) => {
    const file = path.join(SCENE_DIR, decodeURIComponent(req.url.replace(/^\//, "")) || "index.html");
    if (!file.startsWith(SCENE_DIR) || !fs.existsSync(file)) {
      res.writeHead(404);
      res.end("not found");
      return;
    }
    res.writeHead(200, { "Content-Type": contentType(file) });
    res.end(fs.readFileSync(file));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;

  const profileDir = path.join(SCENE_DIR, "chrome-profile");
  const results = [];
  try {
    for (const scene of scenes) {
      const out = path.join(OUT_DIR, scene.name + ".png");
      fs.rmSync(out, { force: true });
      // 주의: 동기 실행(execFileSync)은 이 프로세스의 HTTP 서버 응답까지 막아 교착된다.
      // 반드시 비동기로 실행해 이벤트 루프가 장면 파일을 계속 서빙할 수 있게 한다.
      await new Promise((resolve, reject) => {
        execFile(
          CHROME,
          [
            "--headless=new",
            "--disable-gpu",
            "--no-first-run",
            "--no-default-browser-check",
            "--hide-scrollbars",
            "--force-device-scale-factor=1",
            "--window-size=1280,800",
            "--user-data-dir=" + profileDir,
            "--virtual-time-budget=4000",
            "--screenshot=" + out,
            `http://127.0.0.1:${port}/${scene.name}.html`,
          ],
          { timeout: 90000 },
          (err) => (err ? reject(err) : resolve())
        );
      });
      const size = fs.existsSync(out) ? fs.statSync(out).size : 0;
      results.push({ scene: scene.name, ok: size > 10000, bytes: size });
    }
  } finally {
    server.close();
  }

  let failed = 0;
  for (const r of results) {
    console.log((r.ok ? "✓" : "✗") + " " + r.scene + ".png (" + r.bytes + " bytes)");
    if (!r.ok) failed++;
  }
  fs.rmSync(SCENE_DIR, { recursive: true, force: true });
  if (failed > 0) process.exit(1);
  console.log("스크린샷 " + results.length + "장 생성 완료 → store-assets/screenshots/");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
