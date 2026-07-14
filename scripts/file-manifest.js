// 출시(Chrome Web Store) 패키지에 포함될 파일 목록을 이 파일 한 곳에서만 관리한다.
// scripts/build.js(복사할 파일)와 scripts/validate-release.js(필수 파일 존재 확인)가
// 모두 이 목록을 그대로 재사용해, "무엇을 포함할지" 기준이 두 곳에서 어긋나지 않게 한다.
"use strict";

// 실제 확장 프로그램 실행에 필요한 파일만 나열한다. 테스트, 문서, 빌드 스크립트 자체는
// 포함하지 않는다.
const RELEASE_FILES = [
  "manifest.json",
  "popup.html",
  "popup.css",
  "popup.js",
  "options.html",
  "options.css",
  "options.js",
  "content.js",
  "content-core.js",
  "content.css",
  "background.js",
  "tab-actions.js",
  "entitlement.js",
  "license-client.js",
  "build-config.js",
];

// 파일뿐 아니라 폴더째로 복사해야 하는 정적 자산(아이콘 등). 폴더가 비어 있어도(현재
// icons/에는 아이콘 파일이 없다) 오류 없이 건너뛴다.
const RELEASE_DIRS = ["icons"];

module.exports = { RELEASE_FILES, RELEASE_DIRS };
