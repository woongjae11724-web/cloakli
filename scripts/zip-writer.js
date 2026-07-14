// 아주 작은 순수 Node.js ZIP 작성/읽기 구현 (외부 의존성 없음).
//
// Chrome Web Store는 표준 ZIP 형식이면 압축 여부와 무관하게 받아들이므로, 여기서는
// 구현을 단순하고 안전하게 유지하기 위해 압축 없이 저장(STORE, method 0)한다.
// createZip()이 만든 버퍼를 readZipEntries()로 다시 읽을 수 있어(중앙 디렉터리 파싱),
// 패키징 스크립트가 별도의 unzip 도구 없이도 방금 만든 ZIP의 내용을 스스로 검증한다.
"use strict";

// 표준 CRC-32(IEEE 802.3) 구현. ZIP 형식이 각 파일 항목마다 요구하는 체크섬이다.
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date) {
  const d = date || new Date();
  const dosTime = ((d.getHours() & 0x1f) << 11) | ((d.getMinutes() & 0x3f) << 5) | ((d.getSeconds() >> 1) & 0x1f);
  const dosDate = (((d.getFullYear() - 1980) & 0x7f) << 9) | (((d.getMonth() + 1) & 0xf) << 5) | (d.getDate() & 0x1f);
  return { dosTime, dosDate };
}

// entries: [{ name: "manifest.json"(항상 "/" 구분, 최상단 기준 상대 경로), data: Buffer }]
// 반환값: ZIP 파일 전체를 담은 Buffer.
function createZip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  const { dosTime, dosDate } = dosDateTime();

  entries.forEach((entry) => {
    const name = entry.name.replace(/\\/g, "/");
    const nameBuf = Buffer.from(name, "utf8");
    const data = entry.data;
    const crc = crc32(data);
    const size = data.length;

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0); // local file header signature
    localHeader.writeUInt16LE(20, 4); // version needed to extract
    localHeader.writeUInt16LE(0, 6); // general purpose flag
    localHeader.writeUInt16LE(0, 8); // compression method: 0 = store
    localHeader.writeUInt16LE(dosTime, 10);
    localHeader.writeUInt16LE(dosDate, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(size, 18); // compressed size
    localHeader.writeUInt32LE(size, 22); // uncompressed size
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28); // extra field length

    localParts.push(localHeader, nameBuf, data);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0); // central directory file header signature
    centralHeader.writeUInt16LE(20, 4); // version made by
    centralHeader.writeUInt16LE(20, 6); // version needed to extract
    centralHeader.writeUInt16LE(0, 8); // flag
    centralHeader.writeUInt16LE(0, 10); // method
    centralHeader.writeUInt16LE(dosTime, 12);
    centralHeader.writeUInt16LE(dosDate, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(size, 20);
    centralHeader.writeUInt32LE(size, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30); // extra length
    centralHeader.writeUInt16LE(0, 32); // comment length
    centralHeader.writeUInt16LE(0, 34); // disk number start
    centralHeader.writeUInt16LE(0, 36); // internal file attrs
    centralHeader.writeUInt32LE(0, 38); // external file attrs
    centralHeader.writeUInt32LE(offset, 42); // relative offset of local header

    centralParts.push(centralHeader, nameBuf);

    offset += localHeader.length + nameBuf.length + data.length;
  });

  const centralDirStart = offset;
  const centralDirBuf = Buffer.concat(centralParts);

  const endRecord = Buffer.alloc(22);
  endRecord.writeUInt32LE(0x06054b50, 0); // end of central directory signature
  endRecord.writeUInt16LE(0, 4); // this disk number
  endRecord.writeUInt16LE(0, 6); // disk with central directory
  endRecord.writeUInt16LE(entries.length, 8); // entries on this disk
  endRecord.writeUInt16LE(entries.length, 10); // total entries
  endRecord.writeUInt32LE(centralDirBuf.length, 12); // central directory size
  endRecord.writeUInt32LE(centralDirStart, 16); // central directory offset
  endRecord.writeUInt16LE(0, 20); // comment length

  return Buffer.concat([...localParts, centralDirBuf, endRecord]);
}

// createZip()으로 만든 ZIP 버퍼(또는 표준 ZIP)의 중앙 디렉터리를 읽어 파일 이름 목록을
// 돌려준다. 별도의 unzip 도구 없이 "방금 만든 ZIP 안에 무엇이 들어있는지" 검증하기 위함이다.
function readZipEntries(buffer) {
  // 댓글(comment)이 없다고 가정하고 파일 맨 끝 22바이트에서 EOCD를 먼저 시도하되,
  // 혹시 있을 경우를 대비해 뒤에서부터 시그니처를 찾는다.
  let eocdOffset = -1;
  for (let i = buffer.length - 22; i >= 0; i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1) {
    throw new Error("유효한 ZIP 파일이 아닙니다 (EOCD를 찾지 못함)");
  }

  const totalEntries = buffer.readUInt16LE(eocdOffset + 10);
  const centralDirOffset = buffer.readUInt32LE(eocdOffset + 16);

  const entries = [];
  let ptr = centralDirOffset;
  for (let i = 0; i < totalEntries; i++) {
    const signature = buffer.readUInt32LE(ptr);
    if (signature !== 0x02014b50) {
      throw new Error("ZIP 중앙 디렉터리가 손상되었습니다");
    }
    const compressedSize = buffer.readUInt32LE(ptr + 20);
    const uncompressedSize = buffer.readUInt32LE(ptr + 24);
    const nameLen = buffer.readUInt16LE(ptr + 28);
    const extraLen = buffer.readUInt16LE(ptr + 30);
    const commentLen = buffer.readUInt16LE(ptr + 32);
    const name = buffer.toString("utf8", ptr + 46, ptr + 46 + nameLen);

    entries.push({ name, compressedSize, uncompressedSize });
    ptr += 46 + nameLen + extraLen + commentLen;
  }

  return entries;
}

module.exports = { createZip, readZipEntries, crc32 };
