// Public, unauthenticated feeds; availability and coverage are not guaranteed.
export const MARKETS = {
  US: { name: '미국 뉴욕 증시', zone: 'America/New_York', close: '16:00', indices: [['S&P 500', '^GSPC'], ['나스닥 종합', '^IXIC'], ['다우존스', '^DJI']], fx: ['USD/KRW', 'KRW=X'], query: 'US stock market close Wall Street' },
  KR: { name: '한국 증시', zone: 'Asia/Seoul', close: '15:30', indices: [['코스피', '^KS11'], ['코스닥', '^KQ11']], fx: ['USD/KRW', 'KRW=X'], query: '코스피 코스닥 마감 시황' },
  JP: { name: '일본 증시', zone: 'Asia/Tokyo', close: '15:30', indices: [['닛케이225', '^N225'], ['TOPIX', '^TOPX']], fx: ['USD/JPY', 'JPY=X'], query: '日経平均 TOPIX 大引け' },
};
const cache = new Map();
const pending = new Map();
const UA = { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json, application/xml, text/xml;q=0.9' };
export const UNKNOWN = '확인 불가';
export const dayIn = (timestamp, zone) => new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(timestamp));
export const nextDay = date => new Date(Date.parse(date + 'T12:00:00Z') + 86400000).toISOString().slice(0, 10);
export const direction = percent => percent == null ? 'unknown' : percent > 0 ? 'up' : percent < 0 ? 'down' : 'steady';
export const percentText = percent => percent == null ? UNKNOWN : `${percent > 0 ? '+' : ''}${percent.toFixed(2)}%`;
export const quoteUrl = symbol => `https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}/history/`;

export async function memo(key, ttl, task) {
  const cached = cache.get(key);
  if (cached?.expires > Date.now()) return cached.value;
  if (pending.has(key)) return pending.get(key);
  if (pending.size > 60) throw new Error('PUBLIC_FEED_BUSY');
  const job = Promise.resolve().then(task).then(value => {
    if (cache.size >= 250) cache.delete(cache.keys().next().value);
    // Short negative caching avoids repeatedly hammering an unavailable feed.
    cache.set(key, { value, expires: Date.now() + (value == null ? 30000 : ttl) });
    return value;
  }).finally(() => pending.delete(key));
  pending.set(key, job);
  return job;
}

export async function readPublic(url, format = 'json') {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), format === 'text' ? 8000 : 7000);
  try {
    const response = await fetch(url, { headers: UA, signal: controller.signal });
    if (!response.ok) return null;
    const raw = await response.text();
    if (raw.length > 1_000_000) return null;
    return format === 'json' ? JSON.parse(raw) : raw;
  } catch { return null; } finally { clearTimeout(timer); }
}

export function parseBars(data, fallbackZone) {
  const result = data?.chart?.result?.[0];
  if (!result) return { meta: {}, bars: [] };
  const zone = result.meta?.exchangeTimezoneName || fallbackZone;
  const closes = result.indicators?.quote?.[0]?.close || [];
  const bars = (result.timestamp || []).flatMap((timestamp, index) => {
    const close = closes[index];
    if (!Number.isFinite(timestamp) || !Number.isFinite(close) || close <= 0) return [];
    try { return [{ date: dayIn(timestamp * 1000, zone), close, timestamp }]; } catch { return []; }
  }).sort((a, b) => a.timestamp - b.timestamp);
  return { meta: result.meta || {}, bars };
}

export async function dailyQuote(name, symbol, date, fallbackZone) {
  return memo(`quote:${symbol}:${date}`, 30 * 60000, async () => {
    const start = Math.floor((Date.parse(date + 'T00:00:00Z') - 16 * 86400000) / 1000);
    const end = Math.floor((Date.parse(date + 'T00:00:00Z') + 2 * 86400000) / 1000);
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&period1=${start}&period2=${end}`;
    const data = await readPublic(url);
    const { meta, bars } = parseBars(data, fallbackZone);
    const index = bars.findIndex(bar => bar.date === date);
    if (index < 0) return null; // Never silently substitute another trading date.
    const bar = bars[index];
    const previous = bars[index - 1];
    const percent = previous ? (bar.close / previous.close - 1) * 100 : null;
    return { name, symbol, value: bar.close.toLocaleString('en-US', { maximumFractionDigits: 2 }), change: percentText(percent), status: direction(percent), price: bar.close, percent, date: bar.date, previousDate: previous?.date || null, currency: meta.currency || '', basis: 'Yahoo 일별 봉 종가 · 공급자 현지일', url: quoteUrl(symbol) };
  });
}

export function decodeXml(value) {
  return String(value).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (match, code) => {
    const known = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
    if (known[code]) return known[code];
    const num = code.startsWith('#x') ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
    return Number.isInteger(num) && num >= 0 && num <= 0x10ffff ? String.fromCodePoint(num) : match;
  });
}
const tag = (xml, name) => decodeXml(xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'i'))?.[1] || '').replace(/<[^>]*>/g, '').trim();
export function safeUrl(value) {
  try { const url = new URL(value); return url.protocol === 'https:' ? url.href : null; } catch { return null; }
}

export function parseNews(xml, date, zone) {
  if (typeof xml !== 'string') return [];
  const seen = new Set();
  return [...xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)].flatMap(([, item]) => {
    const title = tag(item, 'title').slice(0, 220);
    const publishedAt = Date.parse(tag(item, 'pubDate'));
    const url = safeUrl(tag(item, 'link'));
    // The feed search operators alone do not guarantee date coverage.
    if (!title || !url || !Number.isFinite(publishedAt) || dayIn(publishedAt, zone) !== date || seen.has(title)) return [];
    seen.add(title);
    return [{ title, source: tag(item, 'source').slice(0, 80) || 'Google News RSS', url, publishedAt: new Date(publishedAt).toISOString(), basis: '기사 제목만 수집 · 본문 미열람' }];
  }).sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)).slice(0, 30);
}

export async function marketNews(market, date) {
  return memo(`news:${market}:${date}`, 30 * 60000, async () => {
    const m = MARKETS[market];
    const query = `${m.query} after:${date} before:${nextDay(date)}`;
    const locale = market === 'KR' ? 'hl=ko&gl=KR&ceid=KR:ko' : market === 'JP' ? 'hl=ja&gl=JP&ceid=JP:ja' : 'hl=en-US&gl=US&ceid=US:en';
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&${locale}`;
    const xml = await readPublic(url, 'text');
    const relevance = market === 'US' ? /s&p|nasdaq|\bdow\b|wall street|u\.?s\.?.*(?:stock|equit)|(?:stock|equit).*u\.?s\.?/i : market === 'KR' ? /코스피|코스닥|한국.*증시|국내.*증시/ : /日経|TOPIX|東証|東京株/i;
    return xml == null ? null : { news: parseNews(xml, date, m.zone).filter(n => relevance.test(n.title)).slice(0, 5), feedUrl: url };
  });
}

export const missingMetric = name => ({ name, value: UNKNOWN, change: UNKNOWN, status: 'unknown' });
export async function collectReport(market, date) {
  const m = MARKETS[market];
  const definitions = [...m.indices, m.fx, ['달러 인덱스', 'DX-Y.NYB'], ['WTI 선물', 'CL=F'], ['금 선물', 'GC=F']];
  const results = await Promise.allSettled([
    ...definitions.map(([name, symbol]) => dailyQuote(name, symbol, date, m.zone)), marketNews(market, date),
  ]);
  const quotes = definitions.map(([name], i) => results[i].status === 'fulfilled' && results[i].value ? results[i].value : missingMetric(name));
  const indices = quotes.slice(0, m.indices.length);
  const fx = quotes[m.indices.length], dollar = quotes[m.indices.length + 1], commodities = quotes.slice(m.indices.length + 2);
  const feed = results.at(-1).status === 'fulfilled' ? results.at(-1).value : null;
  const news = feed?.news || [];
  const available = indices.filter(i => Number.isFinite(i.price));
  const up = available.filter(i => i.status === 'up').length, down = available.filter(i => i.status === 'down').length;
  const description = available.map(i => `${i.name} ${i.value} (${i.change})`).join(', ');
  const warnings = [];
  if (quotes.some(q => q.status === 'unknown')) warnings.push('일부 시세는 확인하지 못했습니다. 휴장·자료 누락·공급자 제한 가능성이 있으며 다른 날짜 수치로 대체하지 않았습니다.');
  if (!news.length) warnings.push('해당 현지 날짜의 관련 기사를 RSS에서 확보하지 못했습니다. 과거 기사 검색 범위에는 제한이 있습니다.');
  warnings.push('환율·원자재는 각 공급자의 일별 종가로, 주식시장 마감과 기준시각이 다릅니다.');
  const sources = quotes.filter(q => q.url).map(q => ({ title: `${q.name} · ${q.date} · ${q.basis}`, url: q.url }));
  sources.push(...news.map(n => ({ title: `${n.source} · ${n.title}`, url: n.url })));
  return {
    marketName: m.name, market, date, indices,
    summary: description || '선택한 현지 거래일의 지수 종가를 확보하지 못했습니다. 휴장 여부나 데이터 공급 상태를 확인해 주세요.',
    sentiment: { score: null, label: available.length ? `상승 ${up} · 하락 ${down} · 보합 ${available.length - up - down}` : '지수 등락 확인 불가' },
    sectors: [], stocks: [], macro: { exchangeRate: fx, dollarIndex: dollar, commodities }, news,
    analysis: available.length ? `주요 지수 ${available.length}개 중 상승 ${up}개, 하락 ${down}개입니다. 이는 종가 등락을 집계한 기본 요약입니다. 기사 제목만으로 변동 원인을 확정하거나 향후 방향을 예측하지 않습니다.` : '시세 수집이 불완전해 시장 방향을 평가하지 않았습니다. 확인된 기사와 출처만 참고해 주세요.',
    sources, warnings, dataStatus: available.length ? 'available' : 'unavailable',
    analysisMode: 'basic', aiStatus: 'not_requested', aiMessage: '공개 데이터 기본 요약 · AI 미사용',
    generatedAt: new Date().toISOString(), usage: { inputTokens: 0, outputTokens: 0, thinkingTokens: 0 },
  };
}

export async function searchStocks(query) {
  return memo(`search:${query.toLowerCase()}`, 6 * 60 * 60000, async () => {
    const data = await readPublic(`https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=5&newsCount=0`);
    if (!data) return null;
    return (data.quotes || []).filter(q => q.symbol && ['EQUITY', 'ETF', 'INDEX'].includes(q.quoteType)).slice(0, 5).map(q => ({ name: q.longname || q.shortname || q.symbol, ticker: q.symbol, exchange: q.exchDisp || q.exchange || '', reason: 'Yahoo 공개 종목검색' }));
  });
}

export async function stockDetail(input) {
  const found = input.ticker ? null : (await searchStocks(input.name))?.[0];
  const symbol = input.ticker || found?.ticker;
  if (!symbol) return null;
  const data = await readPublic(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1mo`);
  const { meta, bars } = parseBars(data, 'America/New_York');
  if (!bars.length) return null;
  const last = bars.at(-1), prev = bars.at(-2), percent = prev ? (last.close / prev.close - 1) * 100 : null;
  return {
    ticker: symbol, info: `${meta.longName || meta.shortName || found?.name || input.name} · ${meta.exchangeName || '거래소 미확인'} · ${meta.currency || '통화 미확인'}. 공개 시세 자료이며 기업 공시 실적 분석은 포함하지 않습니다.`,
    trend: direction(percent), earnings: [`최근 일별 봉: ${last.date} · ${last.close.toLocaleString('en-US', { maximumFractionDigits: 2 })} ${meta.currency || ''}`, `직전 유효 거래일 ${prev?.date || UNKNOWN} 대비 ${percentText(percent)}`, '당일 봉은 장중일 수 있습니다. 실적은 별도 공시를 확인해 주세요.'],
    closeHistory: bars.slice(-8).map(b => b.close), sources: [{ title: `${symbol} · Yahoo 공개 시세`, url: quoteUrl(symbol) }],
    analysisMode: 'basic', aiStatus: 'not_requested', usage: { inputTokens: 0, outputTokens: 0, thinkingTokens: 0 },
  };
}
