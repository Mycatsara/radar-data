// 바깥 데이터를 표준 모양으로 — RSS 파서(순수) + 네트워크 어댑터
// 기사 본문은 어디서도 가져오지 않는다. 제목·출처·날짜·URL만.
const https = require("https");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

// ── 공통 ────────────────────────────────────────────────
function decode(s) {
  return String(s || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, "&")
    .trim();
}

function pick(block, tag) {
  const m = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`));
  return m ? decode(m[1]) : "";
}
function items(xml) {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => m[1]);
}
function trafficToNum(t) {
  const m = String(t || "").match(/\d+/);
  return m ? Number(m[0]) : 0;
}
function toDate(s) {
  const d = new Date(s);
  return isNaN(d) ? "" : d.toISOString().slice(0, 10);
}

// ── 파서 ────────────────────────────────────────────────
function parseTrends(xml) {
  return items(xml).map((it) => {
    const newsBlocks = [...it.matchAll(/<ht:news_item>([\s\S]*?)<\/ht:news_item>/g)].map((m) => m[1]);
    const traffic = pick(it, "ht:approx_traffic");
    const date = toDate(pick(it, "pubDate"));
    return {
      keyword: pick(it, "title"),
      traffic,
      trafficNum: trafficToNum(traffic),
      pubDate: pick(it, "pubDate"),
      news: newsBlocks.map((nb) => ({
        title: pick(nb, "ht:news_item_title"),
        url: pick(nb, "ht:news_item_url"),
        source: pick(nb, "ht:news_item_source"),
        date,
      })),
    };
  });
}

function parseNews(xml) {
  return items(xml)
    .map((it) => {
      let title = pick(it, "title");
      let source = pick(it, "source");
      if (source && title.endsWith(" - " + source)) {
        title = title.slice(0, -(" - " + source).length).trim(); // 출처 태그가 있으면 그 값으로 정확히 떼어냄
      } else {
        const m = title.match(/^(.*?)\s+-\s+([^-]{2,40})$/);
        if (m) {
          title = m[1];
          source = source || m[2];
        }
      }
      return { title, url: pick(it, "link"), source, date: toDate(pick(it, "pubDate")) };
    })
    .filter((a) => a.title && a.title !== "Google 뉴스");
}

// ── 네트워크 ────────────────────────────────────────────
function get(url, headers = {}, depth = 0) {
  return new Promise((resolve, reject) => {
    if (depth > 4) return reject(new Error("리다이렉트 과다: " + url));
    const req = https.get(url, { headers: { "User-Agent": "Mozilla/5.0", ...headers }, timeout: 20000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const next = res.headers.location.startsWith("http") ? res.headers.location : new URL(res.headers.location, url).href;
        res.resume();
        return resolve(get(next, headers, depth + 1));
      }
      let b = "";
      res.on("data", (c) => (b += c));
      res.on("end", () => (res.statusCode === 200 ? resolve(b) : reject(new Error(`HTTP ${res.statusCode} ${url}`))));
    });
    req.on("timeout", () => req.destroy(new Error("시간 초과: " + url)));
    req.on("error", reject);
  });
}

const SECTIONS = ["BUSINESS", "TECHNOLOGY", "ENTERTAINMENT", "SPORTS"];

async function fetchTrends(geo = "KR") {
  return parseTrends(await get(`https://trends.google.com/trending/rss?geo=${geo}`));
}
async function fetchNewsSection(section) {
  return parseNews(await get(`https://news.google.com/rss/headlines/section/topic/${section}?hl=ko&gl=KR&ceid=KR:ko`));
}
async function searchNews(keyword, limit = 3) {
  const q = encodeURIComponent(keyword);
  const arts = parseNews(await get(`https://news.google.com/rss/search?q=${q}&hl=ko&gl=KR&ceid=KR:ko`));
  const spam = /내기|카지노|토토|성인|바카라/; // 스팸성 제목 제외
  return arts.filter((a) => !spam.test(a.title)).slice(0, limit);
}

// 네이버 검색광고 — keyword-volume.js와 같은 서명 방식. 최대 5개/호출. 키는 홈 폴더에서만.
function naverCreds() {
  return JSON.parse(fs.readFileSync(path.join(os.homedir(), ".naver_searchad.json"), "utf8"));
}
async function naverVolumes(keywords) {
  if (keywords.length === 0) return new Map();
  if (keywords.length > 5) throw new Error("naverVolumes: 최대 5개");
  const creds = naverCreds();
  const timestamp = Date.now().toString();
  const uri = "/keywordstool";
  const sig = crypto.createHmac("sha256", creds.secretKey).update(`${timestamp}.GET.${uri}`).digest("base64");
  const hints = keywords.map((k) => k.replace(/\s+/g, ""));
  const body = await get(
    `https://api.searchad.naver.com${uri}?hintKeywords=${encodeURIComponent(hints.join(","))}&showDetail=1`,
    { "X-Timestamp": timestamp, "X-API-KEY": creds.apiKey, "X-Customer": creds.customerId, "X-Signature": sig }
  );
  const num = (v) => (typeof v === "number" ? v : 5); // "< 10" → 5로 근사
  const list = JSON.parse(body).keywordList || [];
  const all = list.map((k) => ({ kw: k.relKeyword, total: num(k.monthlyPcQcCnt) + num(k.monthlyMobileQcCnt), comp: k.compIdx }));
  const map = new Map();
  for (let i = 0; i < keywords.length; i++) {
    const hit = all.find((a) => a.kw === hints[i]);
    map.set(keywords[i], {
      total: hit ? hit.total : null,
      comp: hit ? hit.comp : null,
      related: all.filter((a) => !hints.includes(a.kw)).sort((x, y) => y.total - x.total).slice(0, 15),
    });
  }
  return map;
}

module.exports = { decode, trafficToNum, parseTrends, parseNews, get, SECTIONS, fetchTrends, fetchNewsSection, searchNews, naverVolumes };
