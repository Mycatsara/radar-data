# radar-data

글감 레이더(radar)의 수집 데이터. GitHub Actions가 30분마다 구글 트렌드 RSS(KR)와 구글 뉴스 RSS 섹션 4개를 스냅샷으로 저장한다.

- `raw/YYYY/MM/DD/HHmm.json` — 30분 스냅샷 (트렌드 10개 + 섹션별 기사 제목·출처·URL)
- `daily/YYYY-MM-DD.json` — 일 집계 (키워드별 등장 횟수·최대 규모·기사 URL ≤5)
- `monthly/`, `yearly/` — 월말·연말 집계
- `status.json` — 마지막 수집 시각·연속 실패 횟수

**공개 데이터만** 담는다 — 기사 본문·API 키·개인정보 없음. 분석과 화면은 별도 로컬 도구(ops-docs `tools/radar/`)에서 돈다.
