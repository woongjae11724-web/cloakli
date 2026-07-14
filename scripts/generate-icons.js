// Cloakli 확장 아이콘(PNG)을 외부 이미지 도구 없이 생성한다.
//
// 디자인: 짙은 남색 둥근 사각형 배경 위에 밝은 파란색 가로 "가림 막대" 두 개 —
// 문서의 민감한 줄을 가린(redact) 모습을 단순하게 표현한다. 브랜드 색은
// popup.css와 동일한 #1f2937(배경)/#4da3ff(강조)를 사용한다.
//
// PNG는 표준 구조(IHDR + IDAT(zlib deflate) + IEND)로 직접 인코딩한다.
// 사용법: node scripts/generate-icons.js  → icons/icon{16,32,48,128}.png 생성
"use strict";

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const SIZES = [16, 32, 48, 128];
const OUT_DIR = path.join(__dirname, "..", "icons");

// 색상 (RGBA)
const BG = [31, 41, 55, 255]; // #1f2937
const BAR = [77, 163, 255, 255]; // #4da3ff
const BAR_SOFT = [143, 208, 163, 255]; // #8fd0a3 (아래 짧은 막대)
const TRANSPARENT = [0, 0, 0, 0];

// ---------------------------------------------------------------------
// 픽셀 그리기
// ---------------------------------------------------------------------

// 둥근 사각형 내부 여부(간단한 코너 원 판정). 픽셀 중심 좌표 기준.
function insideRoundedRect(x, y, size, radius) {
  const min = 0;
  const max = size - 1;
  const r = radius;
  // 네 코너 바깥 영역만 원 판정, 나머지는 사각형 내부
  const cx = x < min + r ? min + r : x > max - r ? max - r : x;
  const cy = y < min + r ? min + r : y > max - r ? max - r : y;
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r + r * 0.5;
}

function renderIcon(size) {
  const px = new Uint8Array(size * size * 4);
  const radius = Math.max(2, Math.round(size * 0.22));

  // 가림 막대 배치(비율 기반): 위 긴 막대 + 아래 짧은 막대
  const bar1Top = Math.round(size * 0.3);
  const bar1Bottom = Math.round(size * 0.45);
  const bar2Top = Math.round(size * 0.58);
  const bar2Bottom = Math.round(size * 0.73);
  const barLeft = Math.round(size * 0.2);
  const bar1Right = Math.round(size * 0.8);
  const bar2Right = Math.round(size * 0.6);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let color = TRANSPARENT;
      if (insideRoundedRect(x, y, size, radius)) {
        color = BG;
        if (y >= bar1Top && y < bar1Bottom && x >= barLeft && x < bar1Right) color = BAR;
        else if (y >= bar2Top && y < bar2Bottom && x >= barLeft && x < bar2Right) color = BAR_SOFT;
      }
      const i = (y * size + x) * 4;
      px[i] = color[0];
      px[i + 1] = color[1];
      px[i + 2] = color[2];
      px[i + 3] = color[3];
    }
  }
  return px;
}

// ---------------------------------------------------------------------
// PNG 인코딩 (IHDR + IDAT + IEND)
// ---------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeAndData = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData));
  return Buffer.concat([len, typeAndData, crc]);
}

function encodePng(size, rgba) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); // width
  ihdr.writeUInt32BE(size, 4); // height
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  // scanline마다 filter byte(0) 추가
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1);
  }

  return Buffer.concat([
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
for (const size of SIZES) {
  const png = encodePng(size, renderIcon(size));
  const file = path.join(OUT_DIR, "icon" + size + ".png");
  fs.writeFileSync(file, png);
  console.log("생성:", path.relative(process.cwd(), file), png.length + " bytes");
}
