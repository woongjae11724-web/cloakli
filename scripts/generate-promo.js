"use strict";

// Chrome Web Store 프로모션 타일 2종을 생성한다.
//   small:   440×280  → store-assets/promo/promo-small-440x280.png
//   marquee: 1400×560 → store-assets/promo/promo-marquee-1400x560.png
// 요건: JPEG 또는 24비트 PNG(알파 비포함) — headless Chrome 캡처(32비트 RGBA)를
// 알파 없는 24비트 RGB PNG로 재인코딩한다(외부 이미지 라이브러리 없이).
//
// 마키 타일의 제품 화면은 스크린샷과 같은 방식으로 "실제 확장 코드"(HIDDEN 오버레이)를
// 허구 픽스처 위에 구동해 렌더링한다 — 합성/가짜 UI 아님, 실개인정보 없음, 네트워크 없음.
// 실행: node scripts/generate-promo.js
const fs = require("fs");
const path = require("path");
const http = require("http");
const zlib = require("zlib");
const { execFile } = require("child_process");

const ROOT = path.join(__dirname, "..");
const OUT_DIR = path.join(ROOT, "store-assets", "promo");
const SCENE_DIR = path.join(ROOT, ".screenshot-scenes");
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

// ---------------------------------------------------------------------
// PNG 알파 제거: RGBA(색상 유형 6) → RGB(색상 유형 2) 재인코딩
// ---------------------------------------------------------------------
function crc32(buf) {
  let c;
  const table = crc32.table || (crc32.table = (() => {
    const t = [];
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })());
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeAndData = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData));
  return Buffer.concat([len, typeAndData, crc]);
}

// PNG를 파싱해 8비트 RGBA면 알파를 제거한 24비트 RGB PNG 버퍼를 돌려준다.
// 이미 RGB(유형 2)면 그대로 돌려준다. 그 외 형식이면 오류를 던진다(예상 밖 입력을 숨기지 않음).
function stripAlpha(pngBuf) {
  if (pngBuf.readUInt32BE(0) !== 0x89504e47) throw new Error("PNG가 아닙니다");
  let off = 8;
  let width = 0, height = 0, bitDepth = 0, colorType = 0;
  const idat = [];
  while (off < pngBuf.length) {
    const len = pngBuf.readUInt32BE(off);
    const type = pngBuf.toString("ascii", off + 4, off + 8);
    const data = pngBuf.subarray(off + 8, off + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      if (data[12] !== 0) throw new Error("interlaced PNG는 지원하지 않음");
    } else if (type === "IDAT") {
      idat.push(data);
    }
    off += 12 + len;
  }
  if (colorType === 2 && bitDepth === 8) return pngBuf; // 이미 24비트 RGB
  if (colorType !== 6 || bitDepth !== 8) throw new Error("예상 밖 PNG 형식: colorType=" + colorType + " bitDepth=" + bitDepth);

  // unfilter (bpp=4)
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  const out = Buffer.alloc(height * (width * 3 + 1));
  const prev = Buffer.alloc(stride);
  const cur = Buffer.alloc(stride);
  const paeth = (a, b, c) => {
    const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };
  let inOff = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[inOff++];
    for (let x = 0; x < stride; x++) {
      const rawByte = raw[inOff + x];
      const left = x >= 4 ? cur[x - 4] : 0;
      const up = prev[x];
      const upLeft = x >= 4 ? prev[x - 4] : 0;
      let value;
      switch (filter) {
        case 0: value = rawByte; break;
        case 1: value = rawByte + left; break;
        case 2: value = rawByte + up; break;
        case 3: value = rawByte + ((left + up) >> 1); break;
        case 4: value = rawByte + paeth(left, up, upLeft); break;
        default: throw new Error("알 수 없는 필터: " + filter);
      }
      cur[x] = value & 0xff;
    }
    inOff += stride;
    const rowStart = y * (width * 3 + 1);
    out[rowStart] = 0; // filter 0
    for (let x = 0; x < width; x++) {
      out[rowStart + 1 + x * 3] = cur[x * 4];
      out[rowStart + 2 + x * 3] = cur[x * 4 + 1];
      out[rowStart + 3 + x * 3] = cur[x * 4 + 2];
      // 알파는 버린다 (배경이 불투명하도록 장면 쪽에서 보장)
    }
    cur.copy(prev);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: truecolor (no alpha)
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", zlib.deflateSync(out, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------
// 장면 (로고는 아이콘과 같은 디자인을 CSS로 재현: 남색 라운드 사각형 + 파랑/초록 가림 바)
// ---------------------------------------------------------------------
const LOGO_CSS = `
  .logo{display:inline-flex;align-items:center;gap:14px;}
  .glyph{border-radius:22%;background:#1f2937;display:flex;flex-direction:column;justify-content:center;gap:7px;padding:0 10px;box-sizing:border-box;}
  .glyph .bar{height:9px;border-radius:99px;flex:none;}
  .glyph .b1{background:#4da3ff;width:100%;}
  .glyph .b2{background:#8fd0a3;width:72%;}
  .glyph .b3{background:#4da3ff;width:88%;}
  .wordmark{font-weight:800;color:#fff;letter-spacing:.5px;}`;

const demoHtml = read("store-assets/demo/index.html");
const demoStyle = /<style>([\s\S]*?)<\/style>/.exec(demoHtml)[1];
const demoBody = /<body>([\s\S]*?)<\/body>/.exec(demoHtml)[1];

// 마키 오른쪽 제품 화면: 잔액/받은편지함에 실제 HIDDEN 오버레이 (스크린샷과 같은 shim 구동)
const MARQUEE_STORAGE = {
  cloakliRules: {
    "127.0.0.1": [
      { id: "p1", hostname: "127.0.0.1", scope: "site", selector: ".card:nth-of-type(1) .value", pagePattern: null, createdAt: 1 },
      { id: "p2", hostname: "127.0.0.1", scope: "site", selector: "tr.unread", pagePattern: null, createdAt: 2 },
    ],
  },
};

const SHIM_MIN = `(function(){
  const scene = window.__SCENE || {}; const data = scene.storage || {};
  window.chrome = {
    runtime: { id: "promo", lastError: undefined, getURL: (p)=>p, getManifest: ()=>({version:"0.2.0"}),
      onMessage: { addListener: ()=>{} },
      sendMessage: (m,cb)=>setTimeout(()=>cb({ok:true,entitlement:{tier:"pro",source:"license",status:"active"}}),0) },
    storage: { local: {
        get:(keys,cb)=>{const l=Array.isArray(keys)?keys:[keys];const o={};l.forEach(k=>{if(k in data)o[k]=JSON.parse(JSON.stringify(data[k]));});setTimeout(()=>cb(o),0);},
        set:(obj,cb)=>{Object.assign(data,obj);setTimeout(()=>cb&&cb(),0);},
        remove:(k,cb)=>setTimeout(()=>cb&&cb(),0) },
      onChanged:{addListener:()=>{}} },
    i18n: { getMessage: ()=>"" },
    tabs:{create:()=>{},query:(q,cb)=>cb&&cb([])}, alarms:{create:()=>{},onAlarm:{addListener:()=>{}}}, commands:{onCommand:{addListener:()=>{}}}
  };
})();`;

function buildScenes() {
  return [
    {
      name: "promo-small-440x280",
      width: 440,
      height: 280,
      html: `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
        html,body{width:440px;height:280px;margin:0;overflow:hidden;background:#0f1420;font-family:'Segoe UI',system-ui,sans-serif;}
        ${LOGO_CSS}
        .wrap{padding:34px 32px;}
        .glyph{width:56px;height:56px;}
        .wordmark{font-size:34px;}
        h2{color:#eef2f8;font-size:22px;line-height:1.35;margin:26px 0 10px;font-weight:700;}
        .chip{display:inline-flex;align-items:center;gap:8px;background:#111827;border:1px solid #2a3550;border-radius:8px;padding:8px 14px;color:#9aa4b2;font-size:13px;}
        .hidden-tag{background:#111827;color:#e5e7eb;border:1px solid #374151;border-radius:4px;padding:2px 8px;font-size:11px;font-weight:700;letter-spacing:1px;background:#1f2937;}
      </style></head><body><div class="wrap">
        <div class="logo"><div class="glyph"><div class="bar b1"></div><div class="bar b2"></div><div class="bar b3"></div></div><span class="wordmark">Cloakli</span></div>
        <h2>Hide sensitive information<br>before you share your screen.</h2>
        <div class="chip"><span class="hidden-tag">HIDDEN</span> One click. Stays hidden on revisit.</div>
      </div></body></html>`,
    },
    {
      name: "promo-marquee-1400x560",
      width: 1400,
      height: 560,
      html: `<!DOCTYPE html><html><head><meta charset="UTF-8">
      <link rel="stylesheet" href="content.css">
      <style>${demoStyle}
        html,body{width:1400px;height:560px;margin:0;overflow:hidden;background:#0f1420;font-family:'Segoe UI',system-ui,sans-serif;}
        ${LOGO_CSS}
        .layout{display:flex;height:560px;}
        .left{width:470px;padding:56px 20px 0 56px;box-sizing:border-box;}
        .glyph{width:64px;height:64px;}
        .wordmark{font-size:40px;}
        h2{color:#eef2f8;font-size:34px;line-height:1.3;margin:34px 0 14px;font-weight:800;}
        p.sub{color:#9aa4b2;font-size:18px;line-height:1.6;margin:0;}
        .right{flex:1;position:relative;padding:48px 0 0 26px;}
        .frame{width:1280px;height:800px;zoom:0.66;display:flex;background:#f4f5f7;border-radius:12px;box-shadow:0 10px 40px rgba(0,0,0,.5);overflow:hidden;}
      </style></head><body>
      <script>window.__SCENE = ${JSON.stringify({ storage: MARQUEE_STORAGE })};</script>
      <script src="shim.js"></script>
      <div class="layout">
        <div class="left">
          <div class="logo"><div class="glyph"><div class="bar b1"></div><div class="bar b2"></div><div class="bar b3"></div></div><span class="wordmark">Cloakli</span></div>
          <h2>Hide it before<br>you share it.</h2>
          <p class="sub">Cover balances, emails, and thumbnails on any webpage — masks come back automatically every time you revisit.</p>
        </div>
        <div class="right"><div class="frame">${demoBody}</div></div>
      </div>
      <script src="content-core.js"></script>
      <script src="build-config-scene.js"></script>
      <script src="entitlement.js"></script>
      <script src="license-client.js"></script>
      <script src="content.js"></script>
      </body></html>`,
    },
  ];
}

const SCENE_BUILD_CONFIG = `(function (root) {
  root.CloakliBuildConfig = { mode: "production", developerPro: false, debug: false,
    licenseServerUrl: "https://cloakli-license.mycloakli.workers.dev", checkoutUrl: "" };
})(typeof self !== "undefined" ? self : window);`;

async function main() {
  fs.rmSync(SCENE_DIR, { recursive: true, force: true });
  fs.mkdirSync(SCENE_DIR, { recursive: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const f of ["content.css", "content-core.js", "entitlement.js", "license-client.js", "content.js"]) {
    fs.copyFileSync(path.join(ROOT, f), path.join(SCENE_DIR, f));
  }
  fs.writeFileSync(path.join(SCENE_DIR, "shim.js"), SHIM_MIN);
  fs.writeFileSync(path.join(SCENE_DIR, "build-config-scene.js"), SCENE_BUILD_CONFIG);
  const scenes = buildScenes();
  for (const s of scenes) fs.writeFileSync(path.join(SCENE_DIR, s.name + ".html"), s.html);

  const server = http.createServer((req, res) => {
    const file = path.join(SCENE_DIR, decodeURIComponent(req.url.replace(/^\//, "")));
    if (!file.startsWith(SCENE_DIR) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
    const ct = file.endsWith(".html") ? "text/html; charset=utf-8" : file.endsWith(".css") ? "text/css" : "text/javascript";
    res.writeHead(200, { "Content-Type": ct });
    res.end(fs.readFileSync(file));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const profileDir = path.join(SCENE_DIR, "chrome-profile");

  try {
    for (const scene of buildScenes()) {
      const out = path.join(OUT_DIR, scene.name + ".png");
      fs.rmSync(out, { force: true });
      await new Promise((resolve, reject) => {
        execFile(CHROME, [
          "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
          "--hide-scrollbars", "--force-device-scale-factor=1",
          "--window-size=" + scene.width + "," + scene.height,
          "--user-data-dir=" + profileDir,
          "--virtual-time-budget=4000",
          "--screenshot=" + out,
          `http://127.0.0.1:${port}/${scene.name}.html`,
        ], { timeout: 90000 }, (err) => (err ? reject(err) : resolve()));
      });
      const converted = stripAlpha(fs.readFileSync(out));
      fs.writeFileSync(out, converted);
      // 검증: 크기·색상 유형
      const buf = fs.readFileSync(out);
      const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20), ct = buf[25];
      console.log(`✓ ${scene.name}.png ${w}x${h} colorType=${ct}(RGB, 알파 없음) ${buf.length} bytes`);
      if (w !== scene.width || h !== scene.height || ct !== 2) throw new Error("규격 불일치: " + scene.name);
    }
  } finally {
    server.close();
  }
  fs.rmSync(SCENE_DIR, { recursive: true, force: true });
  console.log("프로모션 타일 생성 완료 → store-assets/promo/");
}

main().catch((err) => { console.error(err); process.exit(1); });
