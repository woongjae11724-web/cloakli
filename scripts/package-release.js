#!/usr/bin/env node
// dist/production을 Chrome Web Store 제출용 ZIP으로 묶는다. 사람이 파일을 직접 골라
// 압축하지 않고, 이 스크립트 하나로 releases/cloakli-v<version>.zip이 만들어진다.
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { listFilesRecursive } = require("./fs-utils");
const { createZip, readZipEntries } = require("./zip-writer");
const { DEFAULT_DIST_DIR } = require("./validate-release");

const ROOT_DIR = path.join(__dirname, "..");
const RELEASES_DIR = path.join(ROOT_DIR, "releases");

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

// distDir(기본값 dist/production)을 ZIP으로 묶어 releasesDir(기본값 releases/) 아래에 저장한다.
// releasesDir 매개변수는 자동 테스트가 실제 releases/ 폴더를 건드리지 않고 임시 폴더로
// 검증할 수 있게 하기 위한 것이며, CLI에서는 항상 기본값(releases/)을 사용한다.
// 반환값: { zipPath, fileName, version, size, sha256, topLevelEntries, entryCount }
function packageRelease(distDir, releasesDir) {
  const target = distDir || DEFAULT_DIST_DIR;
  const releasesTarget = releasesDir || RELEASES_DIR;

  if (!fs.existsSync(target)) {
    throw new Error("출력 폴더가 없습니다: " + target + " (먼저 build:prod를 실행하세요)");
  }

  const manifestPath = path.join(target, "manifest.json");
  if (!fs.existsSync(manifestPath)) {
    throw new Error("manifest.json이 없습니다: " + manifestPath);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const version = manifest.version;
  if (!version || !/^\d+(\.\d+){0,3}$/.test(version)) {
    throw new Error('manifest.json의 version이 올바르지 않습니다: "' + version + '"');
  }

  // manifest.json을 항상 먼저 담아, ZIP 최상단에서 곧바로 보이게 한다.
  const relFiles = listFilesRecursive(target);
  const orderedRelFiles = [
    "manifest.json",
    ...relFiles.filter((f) => f !== "manifest.json").sort(),
  ];

  const entries = orderedRelFiles.map((relPath) => ({
    name: relPath,
    data: fs.readFileSync(path.join(target, relPath)),
  }));

  if (entries.length === 0) {
    throw new Error("압축할 파일이 없습니다 (빈 빌드 폴더).");
  }

  const zipBuffer = createZip(entries);

  fs.mkdirSync(releasesTarget, { recursive: true });
  const fileName = "cloakli-v" + version + ".zip";
  const zipPath = path.join(releasesTarget, fileName);

  // 같은 버전의 ZIP이 이미 있으면, 오래된 파일을 남겨 두어 혼동하지 않도록 먼저 명확히 지운다.
  if (fs.existsSync(zipPath)) {
    fs.rmSync(zipPath);
  }
  fs.writeFileSync(zipPath, zipBuffer);

  // 방금 만든 ZIP을 스스로 다시 읽어(별도 unzip 도구 없이) 내부 구조를 검증한다.
  const writtenBuffer = fs.readFileSync(zipPath);
  const zipEntries = readZipEntries(writtenBuffer);
  const topLevelNames = zipEntries.map((e) => e.name);

  if (topLevelNames.length === 0) {
    throw new Error("생성된 ZIP이 비어 있습니다.");
  }
  if (topLevelNames[0] !== "manifest.json") {
    throw new Error("ZIP 최상단이 manifest.json이 아닙니다: " + topLevelNames[0]);
  }
  const badEntry = topLevelNames.find(
    (name) =>
      name.startsWith("tests/") ||
      name.includes("node_modules/") ||
      name.startsWith("production/") ||
      name.startsWith("dist/")
  );
  if (badEntry) {
    throw new Error("ZIP 안에 포함되면 안 되는 항목이 있습니다: " + badEntry);
  }

  return {
    zipPath,
    fileName,
    version,
    size: writtenBuffer.length,
    sha256: sha256(writtenBuffer),
    topLevelEntries: topLevelNames,
    entryCount: topLevelNames.length,
  };
}

if (require.main === module) {
  try {
    const result = packageRelease(process.argv[2]);
    console.log("[package] ZIP 생성 완료");
    console.log("  경로: " + path.relative(ROOT_DIR, result.zipPath));
    console.log("  버전: " + result.version);
    console.log("  크기: " + result.size + " bytes");
    console.log("  SHA-256: " + result.sha256);
    console.log("  파일 수: " + result.entryCount);
    console.log("  최상단 항목: " + result.topLevelEntries.slice(0, 5).join(", ") + (result.entryCount > 5 ? " ..." : ""));
  } catch (err) {
    console.error("[package] 실패:", err.message);
    process.exit(1);
  }
}

module.exports = { packageRelease };
