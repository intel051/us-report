import { SEC_SNAPSHOT } from './sec-snapshot.js';
import { memo, readPublic, parseNews, nextDay, MARKETS } from './market-data.js';
// SEC permits public server-side API access without an API key. Be an identifiable, low-rate client.
const AGENT = 'ClosingNote/1.0 (https://us-report.vercel.app; https://github.com/intel051/us-report/issues)';
const COMMON = { AAPL:320193, MSFT:789019, NVDA:1045810, AMZN:1018724, TSLA:1318605, META:1326801, GOOGL:1652044, GOOG:1652044 };
async function sec(url, format = 'json') {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 6000);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': process.env.SEC_USER_AGENT || AGENT, Accept: format === 'json' ? 'application/json' : 'text/html' } });
    if (!res.ok) return null;
    const reader = res.body.getReader(), chunks = []; let size = 0;
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength; if (size > 10000000) { await reader.cancel(); return null; } chunks.push(value);
    }
    const raw = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { raw.set(chunk, offset); offset += chunk.length; }
    const result = new TextDecoder().decode(raw);
    return format === 'json' ? JSON.parse(result) : result;
  } catch { return null; } finally { clearTimeout(timer); }
}
const duration = row => (Date.parse(row.end) - Date.parse(row.start)) / 86400000;
const periodKind = row => duration(row) >= 70 && duration(row) <= 110 ? 'quarter' : duration(row) >= 330 && duration(row) <= 390 ? 'annual' : null;
const eligible = (rows, date) => (rows || []).filter(r => Number.isFinite(r.val) && /^\d{4}-\d{2}-\d{2}$/.test(r.filed || '') && r.filed <= date && r.end <= date && ['10-K','10-Q','10-K/A','10-Q/A'].includes(r.form) && periodKind(r));
const order = (a,b) => b.end.localeCompare(a.end) || b.filed.localeCompare(a.filed);
const revenueTags = ['RevenueFromContractWithCustomerExcludingAssessedTax','Revenues','SalesRevenueNet','RevenueFromContractWithCustomerIncludingAssessedTax'];
export function extractEarnings(data, date, cik) {
  const facts = data?.facts?.['us-gaap']; if (!facts) return null;
  const revenues = revenueTags.flatMap(tag => eligible(facts[tag]?.units?.USD, date).map(r => ({ ...r, tag })));
  const epsRows = eligible(facts.EarningsPerShareDiluted?.units?.['USD/shares'], date);
  // A single comparable period: never mix YTD revenue with quarterly EPS or subtract annual EPS.
  const candidates = [...revenues, ...epsRows].sort(order);
  if (!candidates.length) return null;
  const latest = candidates[0], kind = periodKind(latest);
  const same = r => r.start === latest.start && r.end === latest.end;
  const revenue = revenues.filter(same).sort(order)[0], eps = epsRows.filter(same).sort(order)[0];
  const metric = (row, rows, unit) => {
    if (!row) return null;
    const prior = rows.filter(r => r.tag === row.tag && periodKind(r) === kind && Math.abs((Date.parse(row.end)-Date.parse(r.end))/86400000 - 365) <= 8 && Math.abs(duration(r)-duration(row)) <= 8).sort(order)[0];
    // A negative/zero EPS comparison has no conventional percentage growth interpretation.
    const yoy = prior && prior.val > 0 ? (row.val / prior.val - 1) * 100 : null;
    return { value:row.val, unit, filed:row.filed, yoy, priorValue:prior?.val ?? null, priorEnd:prior?.end ?? null, url:`https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${String(row.accn || '').replace(/-/g,'')}/` };
  };
  return { start:latest.start, end:latest.end, period:kind === 'quarter' ? '분기' : '연간', basis:'SEC XBRL · GAAP · 공시일 기준(실적 발표일과 다를 수 있음)', revenue:metric(revenue, revenues, 'USD'), eps:metric(eps, epsRows, 'USD/주'), guidance:null, consensus:null };
}
export function businessExcerpt(html) {
  if (typeof html !== 'string') return '';
  const plain = html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi,' ').replace(/<\/?(?:span|font|b|i|strong|em|a|ix:[\w.-]+)\b[^>]*>/gi,'').replace(/<[^>]+>/g,' ').replace(/&#(?:160|xA0);|&nbsp;/gi,' ').replace(/&amp;/g,'&').replace(/&#(x[0-9a-f]+|[0-9]+);/gi,(_,code)=>{ const n = code[0].toLowerCase() === 'x' ? parseInt(code.slice(1),16) : Number(code); return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : ' '; }).replace(/\s+/g,' ');
  // Reject short table-of-contents matches; only use the business section itself.
  for (const match of plain.matchAll(/\bITEM\s*1\s*[.:–—-]?\s*BUSINESS\b/gi)) {
    const rest = plain.slice(match.index + match[0].length);
    const end = rest.search(/\bITEM\s*1A\s*[.:–—-]?\s*RISK/i);
    if (end > 600) return rest.slice(0, Math.min(end,2200)).trim();
  }
  return '';
}
async function filings(symbol, date) {
  const saved = SEC_SNAPSHOT[symbol.toUpperCase() === 'GOOG' ? 'GOOGL' : symbol.toUpperCase()];
  const fallback = () => {
    const earnings = extractEarnings(saved?.facts,date,saved?.cik);
    if (earnings) earnings.basis += ` · 보조자료 수집 ${saved.retrievedAt} (이후 공시 누락 가능)`;
    return {earnings,business:saved?.business?.filed <= date ? {...saved.business,retrievedAt:saved.retrievedAt} : null};
  };
  let cik = COMMON[symbol.toUpperCase()] || saved?.cik;
  if (!cik) {
    const map = await memo('sec:tickers', 86400000, () => sec('https://www.sec.gov/files/company_tickers.json'));
    cik = Object.values(map || {}).find(r => r.ticker === symbol.toUpperCase().replace('.','-'))?.cik_str;
  }
  if (!cik) return fallback();
  const id = String(cik).padStart(10,'0');
  const [facts, submissions] = await Promise.all([
    memo(`sec:facts:${id}`, 6*3600000, () => sec(`https://data.sec.gov/api/xbrl/companyfacts/CIK${id}.json`)),
    memo(`sec:submissions:${id}`, 6*3600000, () => sec(`https://data.sec.gov/submissions/CIK${id}.json`)),
  ]);
  const earnings = extractEarnings(facts, date, cik);
  const recent = submissions?.filings?.recent;
  const index = recent?.form?.findIndex((form,i) => form === '10-K' && recent.filingDate[i] <= date);
  let business = null;
  if (index >= 0 && /^[\w.-]+\.html?$/.test(recent.primaryDocument[index] || '')) {
    const url = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${recent.accessionNumber[index].replace(/-/g,'')}/${recent.primaryDocument[index]}`;
    const html = await memo(`sec:business:${url}`, 86400000, () => sec(url,'text'));
    const excerpt = businessExcerpt(html);
    if (excerpt) business = { excerpt, filed:recent.filingDate[index], url };
  }
  const backup = fallback();
  return { earnings:earnings || backup.earnings, business:business || backup.business };
}
export async function companyData(input) {
  const { ticker, name, date, market = 'US' } = input;
  const m = MARKETS[market];
  const query = `"${name}" "${ticker}" after:${date} before:${nextDay(date)}`;
  const locale = market === 'KR' ? 'hl=ko&gl=KR&ceid=KR:ko' : market === 'JP' ? 'hl=ja&gl=JP&ceid=JP:ja' : 'hl=en-US&gl=US&ceid=US:en';
  const [filing, news] = await Promise.all([
    market === 'US' && /^[A-Za-z][A-Za-z0-9.-]{0,12}$/.test(ticker) ? filings(ticker,date) : Promise.resolve({earnings:null,business:null}),
    memo(`company-news:${market}:${ticker}:${date}`, 30*60000, async () => {
      const xml = await readPublic(`https://news.google.com/rss/search?q=${encodeURIComponent(query)}&${locale}`, 'text');
      // Search operators are hints; validate both the publication day and company mention.
      return parseNews(xml, date, m.zone).filter(n => n.title.toLowerCase().includes(name.toLowerCase()) || new RegExp(`\\b${ticker.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}\\b`,'i').test(n.title)).slice(0,3);
    }),
  ]);
  return { ...filing, news:news || [] };
}
