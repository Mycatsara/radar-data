// 월말(KST)에 daily → monthly 집계, 12월 말에는 yearly까지. 말일이 아니면 아무것도 하지 않는다.
const fs = require("fs");
const path = require("path");
const force = process.argv.includes("--force");
const k = new Date(Date.now() + 9 * 3600e3);
const y = k.getUTCFullYear(), m = k.getUTCMonth() + 1;
const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
if (k.getUTCDate() !== lastDay && !force) { console.log("말일 아님 — 건너뜀"); process.exit(0); }

const mm = String(m).padStart(2, "0");
const out = { month: `${y}-${mm}`, keywords: {} };
if (fs.existsSync("daily")) for (const f of fs.readdirSync("daily")) {
  if (!f.startsWith(`${y}-${mm}`)) continue;
  const d = JSON.parse(fs.readFileSync(path.join("daily", f), "utf8"));
  for (const [kw, e] of Object.entries(d.keywords || {})) {
    const o = out.keywords[kw] || { days: 0, count: 0, maxTraffic: 0 };
    o.days++; o.count += e.count; o.maxTraffic = Math.max(o.maxTraffic, e.maxTraffic);
    out.keywords[kw] = o;
  }
}
fs.mkdirSync("monthly", { recursive: true });
fs.writeFileSync(`monthly/${y}-${mm}.json`, JSON.stringify(out, null, 2) + "\n");
console.log("월간 집계", out.month, Object.keys(out.keywords).length, "키워드");

if (m === 12) {
  const yr = { year: y, keywords: {} };
  for (const f of fs.readdirSync("monthly")) {
    if (!f.startsWith(String(y))) continue;
    const d = JSON.parse(fs.readFileSync(path.join("monthly", f), "utf8"));
    for (const [kw, e] of Object.entries(d.keywords)) {
      const o = yr.keywords[kw] || { months: 0, count: 0 };
      o.months++; o.count += e.count; yr.keywords[kw] = o;
    }
  }
  fs.mkdirSync("yearly", { recursive: true });
  fs.writeFileSync(`yearly/${y}.json`, JSON.stringify(yr, null, 2) + "\n");
  console.log("연간 집계", y, Object.keys(yr.keywords).length, "키워드");
}
