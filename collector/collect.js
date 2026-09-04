// 수집 — 트렌드·뉴스 RSS를 스냅샷으로 저장하고 일 집계·status를 갱신한다.
// Actions(radar-data)와 로컬 양쪽에서 같은 코드가 돈다. 네이버 키는 여기서 절대 쓰지 않는다.
// 사용법: node collect.js <dataDir>
const fs = require("fs");
const path = require("path");
const sources = require("./sources");

function kstParts(date = new Date()) {
  const k = new Date(date.getTime() + 9 * 3600 * 1000);
  const p = (n) => String(n).padStart(2, "0");
  const y = k.getUTCFullYear(), m = p(k.getUTCMonth() + 1), d = p(k.getUTCDate()), hh = p(k.getUTCHours()), mm = p(k.getUTCMinutes());
  return { y: String(y), m, d, hh, mm, dateStr: `${y}-${m}-${d}`, iso: `${y}-${m}-${d}T${hh}:${mm}:00+09:00` };
}

function readJson(f, fallback) {
  try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return fallback; }
}
function writeJson(f, obj) {
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify(obj, null, 2) + "\n");
}

function mergeDaily(daily, snap) {
  for (const t of snap.trends || []) {
    const e = daily.keywords[t.keyword] || { count: 0, maxTraffic: 0, firstSeen: snap.at, lastSeen: snap.at, news: [] };
    e.count += 1;
    e.maxTraffic = Math.max(e.maxTraffic, t.trafficNum || 0);
    e.lastSeen = snap.at;
    const seen = new Set(e.news.map((n) => n.url));
    for (const n of t.news || []) if (n.url && !seen.has(n.url) && e.news.length < 5) { e.news.push(n); seen.add(n.url); }
    daily.keywords[t.keyword] = e;
  }
  for (const [sec, arts] of Object.entries(snap.news || {})) {
    const cur = daily.sections[sec] || [];
    const seen = new Set(cur.map((a) => a.url));
    for (const a of arts) if (a.url && !seen.has(a.url) && cur.length < 50) { cur.push(a); seen.add(a.url); }
    daily.sections[sec] = cur;
  }
  return daily;
}

async function collect(dataDir, opts = {}) {
  const now = opts.now || new Date();
  const f = opts.fetchers || sources;
  const statusFile = path.join(dataDir, "status.json");
  const status = readJson(statusFile, { lastRun: null, lastOk: null, failStreak: 0, latestRaw: null });
  const kp = kstParts(now);
  status.lastRun = kp.iso;

  try {
    const trends = await f.fetchTrends();
    const news = {};
    for (const sec of sources.SECTIONS) {
      try { news[sec] = await f.fetchNewsSection(sec); } catch (e) { news[sec] = []; status.lastWarning = `${sec}: ${e.message}`; }
    }
    const snap = { at: kp.iso, trends, news };
    const rel = ["raw", kp.y, kp.m, kp.d, `${kp.hh}${kp.mm}.json`].join("/");
    const rawPath = path.join(dataDir, ...rel.split("/"));
    writeJson(rawPath, snap);

    const dailyPath = path.join(dataDir, "daily", `${kp.dateStr}.json`);
    const daily = readJson(dailyPath, { date: kp.dateStr, keywords: {}, sections: {} });
    writeJson(dailyPath, mergeDaily(daily, snap));

    status.lastOk = kp.iso; status.failStreak = 0; status.latestRaw = rel; delete status.lastError;
    writeJson(statusFile, status);
    return { rawPath, dailyPath, status };
  } catch (e) {
    status.failStreak = (status.failStreak || 0) + 1;
    status.lastError = e.message;
    writeJson(statusFile, status);
    return { rawPath: null, dailyPath: null, status };
  }
}

module.exports = { collect, kstParts, mergeDaily };

if (require.main === module) {
  const dir = process.argv[2] || path.join(__dirname, "data");
  collect(dir).then((r) => {
    if (r.rawPath) console.log("저장:", r.rawPath, "| 트렌드", JSON.parse(fs.readFileSync(r.rawPath, "utf8")).trends.length, "개");
    else { console.error("수집 실패:", r.status.lastError, "| 연속 실패", r.status.failStreak); process.exit(1); }
  });
}
