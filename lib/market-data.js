import { matchFeaturedCompanies, US_SECTORS } from './stock-universe.js';
export { matchFeaturedCompanies };
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
    cache.set(key, { value, expires: Date.now() + (value == null ? 30000 : (typeof ttl === 'function' ? ttl(value) : ttl)) });
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
    try { return [{ date: dayIn(timestamp * 1000, zone), close, timestamp, high: result.indicators.quote[0].high?.[index] ?? null, low: result.indicators.quote[0].low?.[index] ?? null, volume: result.indicators.quote[0].volume?.[index] ?? null }]; } catch { return []; }
  }).sort((a, b) => a.timestamp - b.timestamp);
  return { meta: result.meta || {}, bars };
}

// Parse dated index bars only; never substitute a different trading day.
export function parseNaverIndex(raw) {
  if (typeof raw !== 'string') return [];
  return [...raw.matchAll(/\["(\d{8})",\s*([\d.]+),\s*([\d.]+),\s*([\d.]+),\s*([\d.]+),\s*(\d+)/g)].map(m => ({date:`${m[1].slice(0,4)}-${m[1].slice(4,6)}-${m[1].slice(6,8)}`, high:Number(m[3]),low:Number(m[4]),close:Number(m[5]),volume:Number(m[6])})).filter(b=>b.close>0).sort((a,b)=>a.date.localeCompare(b.date));
}
export function parseJapanIndex(raw) {
  if (typeof raw !== 'string') return [];
  return [...raw.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].flatMap(([,row])=>{
    const date = row.match(/<th\b[^>]*>\s*(\d{4})\/(\d{1,2})\/(\d{1,2})\s*<\/th>/i);
    const cells = [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(m=>Number(m[1].replace(/<[^>]*>/g,'').replace(/[,\s]/g,'')));
    if (!date || cells.length !== 4 || cells.some(n=>!Number.isFinite(n) || n<=0)) return [];
    return [{date:`${date[1]}-${date[2].padStart(2,'0')}-${date[3].padStart(2,'0')}`,high:cells[1],low:cells[2],close:cells[3]}];
  }).sort((a,b)=>a.date.localeCompare(b.date));
}
async function alternateIndex(name,symbol,date) {
  const kr = {'^KS11':'KOSPI','^KQ11':'KOSDAQ'};
  const jp = {'^N225':'998407.O','^TOPX':'998405.T'};
  if (!kr[symbol] && !jp[symbol]) return null;
  const from = new Date(Date.parse(date+'T12:00:00Z')-21*86400000).toISOString().slice(0,10).replace(/-/g,'');
  const to = date.replace(/-/g,'');
  const url = kr[symbol] ? `https://api.finance.naver.com/siseJson.naver?symbol=${kr[symbol]}&requestType=1&startTime=${from}&endTime=${to}&timeframe=day` : `https://finance.yahoo.co.jp/quote/${jp[symbol]}/history?from=${from}&to=${to}&timeFrame=d`;
  const bars = kr[symbol] ? parseNaverIndex(await readPublic(url,'text')) : parseJapanIndex(await readPublic(url,'text'));
  const index=bars.findIndex(b=>b.date===date); if(index<0) return null;
  const bar=bars[index], previous=bars[index-1];
  const percent=previous ? (bar.close/previous.close-1)*100 : null;
  const local=dayIn(Date.now(),kr[symbol]?'Asia/Seoul':'Asia/Tokyo');
  const time=new Intl.DateTimeFormat('en-GB',{timeZone:kr[symbol]?'Asia/Seoul':'Asia/Tokyo',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date());
  const session=local===date && time<'15:30'?'in_progress':'daily_close';
  const source=kr[symbol]?'네이버 금융':'Yahoo Japan';
  return {name,symbol,value:bar.close.toLocaleString('en-US',{maximumFractionDigits:2}),price:bar.close,change:percentText(percent),percent,status:direction(percent),date,previousDate:previous?.date||null,previousPrice:previous?.close??null,currency:kr[symbol]?'KRW':'JPY',session,high:bar.high,low:bar.low,volume:bar.volume??null,history:bars.slice(Math.max(0,index-11),index+1).map(b=>({date:b.date,close:b.close})),basis:`${source} 일별 ${session==='in_progress'?'장중 관측':'종가'} · 현지일`,url:kr[symbol]?`https://finance.naver.com/sise/sise_index_day.naver?code=${kr[symbol]}`:url};
}

export async function dailyQuote(name, symbol, date, fallbackZone) {
  return memo(`quote:${symbol}:${date}`, quote => Number.isFinite(quote.percent) ? 30 * 60000 : 15000, async () => {
    const start = Math.floor((Date.parse(date + 'T00:00:00Z') - 16 * 86400000) / 1000);
    const end = Math.floor((Date.parse(date + 'T00:00:00Z') + 2 * 86400000) / 1000);
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&period1=${start}&period2=${end}`;
    const [data, alternate] = await Promise.all([readPublic(url), alternateIndex(name,symbol,date)]);
    const { meta, bars } = parseBars(data, fallbackZone);
    const index = bars.findIndex(bar => bar.date === date);
    if (index < 0) return alternate; // Never silently substitute another trading date.
    const bar = bars[index];
    const previous = bars[index - 1];
    if (!previous && Number.isFinite(alternate?.previousPrice)) return alternate;
    const percent = previous ? (bar.close / previous.close - 1) * 100 : null;
    const currentEnd = meta.currentTradingPeriod?.regular?.end;
    const session = Number.isFinite(currentEnd) && dayIn(Date.now(), meta.exchangeTimezoneName || fallbackZone) === date && Date.now() < currentEnd * 1000 ? 'in_progress' : 'daily_close';
    return { name, symbol, value: bar.close.toLocaleString('en-US', { maximumFractionDigits: 2 }), change: percentText(percent), status: direction(percent), price: bar.close, percent, date: bar.date, previousDate: previous?.date || null, currency: meta.currency || '', session, previousPrice: previous?.close ?? null, high: bar.high, low: bar.low, volume: bar.volume, history: bars.slice(Math.max(0, index - 11), index + 1).map(b => ({ date: b.date, close: b.close })), basis: session === 'in_progress' ? 'Yahoo 일별 봉 장중 관측 · 확정 종가 아님' : 'Yahoo 일별 봉 종가 · 공급자 현지일', url: quoteUrl(symbol) };
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

export async function featuredNews(market, date) {
  return memo(`featured-news:${market}:${date}`, 30 * 60000, async () => {
    const query = market === 'US' ? '(stocks movers OR Nvidia OR Tesla OR AMD OR earnings shares)' : market === 'KR' ? '특징주' : '個別株 注目株';
    const locale = market === 'KR' ? 'hl=ko&gl=KR&ceid=KR:ko' : market === 'JP' ? 'hl=ja&gl=JP&ceid=JP:ja' : 'hl=en-US&gl=US&ceid=US:en';
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(`${query} after:${date} before:${nextDay(date)}`)}&${locale}`;
    const xml = await readPublic(url, 'text');
    return xml == null ? [] : parseNews(xml, date, MARKETS[market].zone);
  });
}

export async function featuredStocks(market, date, news) {
  const companies = matchFeaturedCompanies(news, market);
  const quotes = await Promise.allSettled(companies.map(c => dailyQuote(c.name, c.ticker, date, MARKETS[market].zone)));
  return companies.map((company, index) => {
    const quote = quotes[index].status === 'fulfilled' ? quotes[index].value : null;
    return { name: company.name, ticker: company.ticker, sector: company.sector, mentions: company.mentions,
      change: quote?.change || UNKNOWN, status: quote?.status || 'unknown', price: quote?.value || UNKNOWN, date,
      history: quote?.history || [], volume: quote?.volume ?? null,
      reason: company.stories[0].title, source: company.stories[0].source, url: company.stories[0].url,
      stories: company.stories.slice(0, 2), selection: '해당 날짜 뉴스 제목에 언급된 종목 · 전체 시장 등락 순위 아님' };
  });
}

export const missingMetric = name => ({ name, value: UNKNOWN, change: UNKNOWN, status: 'unknown' });
export async function collectReport(market, date) {
  const m = MARKETS[market];
  const definitions = [...m.indices, m.fx, ['달러 인덱스', 'DX-Y.NYB'], ['WTI 선물', 'CL=F'], ['금 선물', 'GC=F']];
  const sectorTask = market === 'US' ? Promise.allSettled(US_SECTORS.map(([name, symbol]) => dailyQuote(name, symbol, date, 'America/New_York'))) : Promise.resolve([]);
  const extrasTask = Promise.allSettled([dailyQuote('VIX', '^VIX', date, 'America/New_York'), dailyQuote('미국 10년물', '^TNX', date, 'America/New_York')]);
  const featuredTask = featuredNews(market, date).catch(() => []);
  const results = await Promise.allSettled([
    ...definitions.map(([name, symbol]) => dailyQuote(name, symbol, date, m.zone)), marketNews(market, date),
  ]);
  const quotes = definitions.map(([name], i) => results[i].status === 'fulfilled' && results[i].value ? results[i].value : missingMetric(name));
  const indices = quotes.slice(0, m.indices.length);
  const fx = quotes[m.indices.length], dollar = quotes[m.indices.length + 1], commodities = quotes.slice(m.indices.length + 2);
  const feed = results.at(-1).status === 'fulfilled' ? results.at(-1).value : null;
  const news = feed?.news || [];
  const [featured, sectorResults, extras] = await Promise.all([featuredTask, sectorTask, extrasTask]);
  const stockNews = [...new Map([...featured, ...news].map(n => [n.title, n])).values()];
  const stocks = await featuredStocks(market, date, stockNews);
  const sectorPerformance = sectorResults.filter(r => r.status === 'fulfilled' && r.value && Number.isFinite(r.value.percent)).map(r => ({ ...r.value, proxy: '미국 섹터 ETF 수익률' })).sort((a, b) => b.percent - a.percent);
  const crossAssets = extras.flatMap((r, i) => {
    if (r.status !== 'fulfilled' || !r.value) return [];
    const item = r.value;
    return [{ ...item, value: i === 1 ? item.value + '%' : item.value, change: i === 1 && Number.isFinite(item.previousPrice) ? `${((item.price - item.previousPrice) * 100).toFixed(1)}bp` : item.change }];
  });
  const available = indices.filter(i => Number.isFinite(i.price));
  const up = available.filter(i => i.status === 'up').length, down = available.filter(i => i.status === 'down').length;
  const description = available.map(i => `${i.name} ${i.value} (${i.change})`).join(', ');
  const warnings = [];
  if (quotes.some(q => q.session === 'in_progress')) warnings.push('일부 환율·원자재는 해당 시장이 아직 열려 있어 진행 중인 일별 관측값입니다.');
  if (quotes.some(q => q.status === 'unknown')) warnings.push('일부 시세는 확인하지 못했습니다. 휴장·자료 누락·공급자 제한 가능성이 있으며 다른 날짜 수치로 대체하지 않았습니다.');
  if (!news.length) warnings.push('해당 현지 날짜의 관련 기사를 RSS에서 확보하지 못했습니다. 과거 기사 검색 범위에는 제한이 있습니다.');
  if (stocks.length) warnings.push('특징주는 해당 날짜 기사에 언급된 지원 종목에서 선정합니다. 기사 제목은 변동 원인의 확정 근거가 아니며 전체 시장 순위가 아닙니다.');
  warnings.push('환율·원자재는 각 공급자의 일별 종가로, 주식시장 마감과 기준시각이 다릅니다.');
  const sources = quotes.filter(q => q.url).map(q => ({ title: `${q.name} · ${q.date} · ${q.basis}`, url: q.url }));
  sources.push(...sectorPerformance.map(q => ({ title: `${q.name} · ${q.symbol} · ${date}`, url: q.url })), ...crossAssets.map(q => ({ title: `${q.name} · ${date}`, url: q.url })), ...stocks.map(s => ({ title: `${s.name} · ${s.source}`, url: s.url })));
  sources.push(...news.map(n => ({ title: `${n.source} · ${n.title}`, url: n.url })));
  return {
    marketName: m.name, market, date, indices, title: `${m.name}, 하루의 기록`, reviewSections: [], watchpoints: [],
    summary: description || '선택한 현지 거래일의 지수 종가를 확보하지 못했습니다. 휴장 여부나 데이터 공급 상태를 확인해 주세요.',
    sentiment: { score: null, label: available.length ? `상승 ${up} · 하락 ${down} · 보합 ${available.length - up - down}` : '지수 등락 확인 불가' },
    sectors: sectorPerformance.length ? sectorPerformance.slice(0, 3).map(s => `${s.name} ${s.change}`) : [...new Set(stocks.map(s => s.sector))].slice(0, 3), stocks, sectorPerformance, crossAssets, featuredHeadlines: stockNews.slice(0, 8), macro: { exchangeRate: fx, dollarIndex: dollar, commodities }, news,
    analysis: available.length ? `주요 지수 ${available.length}개 중 상승 ${up}개, 하락 ${down}개입니다. 이는 종가 등락을 집계한 기본 요약입니다. 기사 제목만으로 변동 원인을 확정하거나 향후 방향을 예측하지 않습니다.` : '시세 수집이 불완전해 시장 방향을 평가하지 않았습니다. 확인된 기사와 출처만 참고해 주세요.',
    sources, warnings, dataStatus: available.length ? 'available' : (news.length || stocks.length) ? 'partial' : 'unavailable',
    analysisMode: 'basic', aiStatus: 'not_requested', aiMessage: '시세·뉴스 수집 완료 · 마감시황 작성 대기',
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
  if (input.date) {
    const quote = await dailyQuote(input.name, symbol, input.date, MARKETS[input.market || 'US'].zone);
    if (!quote) return null;
    return { ticker: symbol, info: `${input.name} · ${input.date} 거래일 기준 · ${quote.currency}. 선택한 날의 공개 일별 시세입니다.`, trend: quote.status, earnings: [`종가 ${quote.value} ${quote.currency}`, `직전 유효 거래일 ${quote.previousDate || UNKNOWN} 대비 ${quote.change}`, `거래량 ${Number.isFinite(quote.volume) ? quote.volume.toLocaleString('en-US') : UNKNOWN}`], closeHistory: quote.history.map(b => b.close), sources: [{ title: `${symbol} · ${input.date} 시세`, url: quote.url }], analysisMode: 'basic', aiStatus: 'not_requested', usage: { inputTokens: 0, outputTokens: 0, thinkingTokens: 0 } };
  }
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
