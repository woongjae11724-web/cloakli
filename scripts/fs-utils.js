// 빌드/검증 스크립트가 공유하는 파일 시스템 보조 함수. Node 내장 모듈만 사용한다.
"use strict";

const fs = require("fs");
const path = require("path");

// dir 아래의 모든 파일 경로(디렉터리 제외)를 재귀적으로 모은다. 항상 "/"로 구분된
// dir 기준 상대 경로를 돌려준다(ZIP/Chrome이 기대하는 구분자와 맞추기 위함).
function listFilesRecursive(dir, baseDir) {
  const base = baseDir || dir;
  let results = [];
  if (!fs.existsSync(dir)) return results;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  entries.forEach((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results = results.concat(listFilesRecursive(fullPath, base));
    } else if (entry.isFile()) {
      const rel = path.relative(base, fullPath).split(path.sep).join("/");
      results.push(rel);
    }
  });
  return results;
}

// src 폴더(또는 파일)를 dest로 재귀 복사한다. src가 존재하지 않으면 조용히 건너뛴다
// (예: 아직 아이콘이 없는 icons/ 폴더).
function copyRecursive(src, dest) {
  if (!fs.existsSync(src)) return;
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    fs.readdirSync(src).forEach((child) => {
      copyRecursive(path.join(src, child), path.join(dest, child));
    });
  } else {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }
}

// 폴더가 있으면 재귀적으로 완전히 비운 뒤 삭제한다. 없으면 아무 것도 하지 않는다.
function removeRecursive(dir) {
  if (!fs.existsSync(dir)) return;
  fs.rmSync(dir, { recursive: true, force: true });
}

module.exports = { listFilesRecursive, copyRecursive, removeRecursive };
