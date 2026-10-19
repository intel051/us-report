import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const apiSource = readFileSync(new URL('../api/gemini.js', import.meta.url), 'utf8');
const libSource = readFileSync(new URL('../lib/market-data.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const dataUrl = source => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
async function fresh() {
  const libUrl = dataUrl(libSource + '\n//' + Math.random());
  const api = await import(dataUrl(apiSource.replace("'../lib/market-data.js'", JSON.stringify(libUrl)) + '\n//' + Math.random()));
  return { handler: api.default, lib: await import(libUrl) };
}
const request = (payload = { market: 'US', date: '2026-10-16' }, type = 'report') => new Request('https://test/api/gemini', { method: 'POST', body: JSON.stringify({ type, payload }) });
const chart = (closes = [100, 110], dates = ['2026-10-15', '2026-10-16']) => ({ chart: { result: [{ meta: { currency: 'USD', exchangeTimezoneName: 'America/New_York', chartPreviousClose: 999, exchangeName: 'TEST', longName: 'Test Company' }, timestamp: dates.map(date => Date.parse(`${date}T13:30:00Z`) / 1000), indicators: { quote: [{ close: closes }] } }] } });
const item = (title, date = 'Fri, 16 Oct 2026 21:00:00 GMT', link = 'https://news.google.com/rss/articles/item') => `<item><title><![CDATA[${title}]]></title><link>${link}</link><pubDate>${date}</pubDate><source>Reuters</source></item>`;
const rss = '<rss><channel>' + item('Nasdaq rises &amp; US stocks close higher') + item('FTSE closes down') + item('Nasdaq old', 'Thu, 15 Oct 2026 21:00:00 GMT') + '</channel></rss>';
let aiCalls, publicCalls, aiResponder, feedResponder, lastPayload;
const install = () => {
  aiCalls = publicCalls = 0; lastPayload = null;
  aiResponder = () => Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ thought: true, text: 'not json' }, { text: JSON.stringify({ summary: '주요 지수가 상승했습니다.', analysis: '기사 제목은 기술주 관련 재료를 언급합니다. 원인으로 작용했을 가능성이 있습니다. 추가 공시를 확인하세요.' }) }] } }], usageMetadata: { promptTokenCount: 400, candidatesTokenCount: 150 } });
  feedResponder = url => url.includes('/rss/') ? new Response(rss) : url.includes('/search?') ? Response.json({ quotes: [{ symbol: 'AAPL', longname: 'Apple', exchange: 'NASDAQ', quoteType: 'EQUITY' }, { symbol: 'BTC', quoteType: 'CRYPTOCURRENCY' }] }) : Response.json(chart());
  globalThis.fetch = async (url, options) => {
    if (url.includes('generativelanguage')) { aiCalls++; lastPayload = JSON.parse(options.body); return aiResponder(url, options); }
    publicCalls++; return feedResponder(url, options);
  };
  process.env.GEMINI_API_KEY = 'test-secret'; delete process.env.GEMINI_SUMMARY_ENABLED; delete process.env.GEMINI_SUMMARY_MODEL;
};
async function scenario(name, run) { await test(name, async () => { install(); const context = await fresh(); await run(context); }); }
await scenario('default report requires zero Gemini calls, exact date and previous trading close', async ({ handler }) => {
  const response = await handler(request()); const report = await response.json();
  assert.equal(response.status, 200); assert.equal(report.dataStatus, 'available'); assert.equal(aiCalls, 0);
  assert.equal(report.indices[0].change, '+10.00%'); assert.equal(report.indices[0].previousDate, '2026-10-15');
  assert.equal(report.usage.inputTokens, 0); assert.equal(report.analysisMode, 'basic');
  assert.equal(report.news.length, 1); assert(report.news[0].url.startsWith('https://')); assert(report.warnings.length);
});
await scenario('missing API key leaves default and optional report usable', async ({ handler }) => {
  delete process.env.GEMINI_API_KEY; const report = await (await handler(request({ market: 'US', date: '2026-10-16', useAI: true }))).json();
  assert.equal(report.aiStatus, 'not_configured'); assert.equal(aiCalls, 0); assert.equal(report.indices.length, 3);
});
await scenario('successful AI only replaces prose; payload has no search tool and tiny schema', async ({ handler }) => {
  const report = await (await handler(request({ market: 'US', date: '2026-10-16', useAI: true }))).json();
  assert.equal(report.analysisMode, 'ai'); assert.equal(report.indices[0].value, '110'); assert.equal(aiCalls, 1);
  assert(!lastPayload.tools); assert.equal(lastPayload.generationConfig.thinkingConfig.thinkingBudget, 0);
  assert.equal(lastPayload.generationConfig.maxOutputTokens, 1024);
  assert.deepEqual(Object.keys(lastPayload.generationConfig.responseJsonSchema.properties), ['summary', 'analysis']);
  const compact = JSON.parse(lastPayload.contents[0].parts[0].text);
  assert(compact.headlines.length <= 3); assert(JSON.stringify(lastPayload).length < 3000); assert(!JSON.stringify(lastPayload).includes('test-secret'));
});
await scenario('concurrent repeated reports coalesce public fetches and AI; successful interpretation reused', async ({ handler }) => {
  const r = () => handler(request({ market: 'US', date: '2026-10-16', useAI: true }));
  await Promise.all([r(), r(), r()]); const calls = publicCalls;
  const report = await (await r()).json(); assert.equal(aiCalls, 1); assert.equal(publicCalls, calls); assert.equal(report.aiCacheHit, true);
});
await scenario('429 keeps HTTP 200 report and suppresses retry calls', async ({ handler }) => {
  aiResponder = () => Response.json({ error: { message: 'quota' } }, { status: 429, headers: { 'retry-after': '60' } });
  const response = await handler(request({ market: 'US', date: '2026-10-16', useAI: true }));
  const report = await response.json(); assert.equal(response.status, 200); assert.equal(report.aiStatus, 'quota'); assert.equal(report.indices[0].value, '110');
  await handler(request({ market: 'US', date: '2026-10-16', useAI: true })); await handler(request()); assert.equal(aiCalls, 1);
});
for (const [name, responder] of [
  ['truncated AI', () => Response.json({ candidates: [{ finishReason: 'MAX_TOKENS' }] })],
  ['malformed JSON', () => Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '{broken' }] } }] })],
  ['wrong response fields', () => Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '{"summary":42}' }] } }] })],
  ['non JSON upstream', () => new Response('<html>bad gateway</html>')],
  ['network/timeout', () => { throw new DOMException('aborted', 'AbortError'); }],
  ['HTTP failure', () => new Response('unavailable', { status: 503 })],
]) await scenario(`${name}: preserve usable baseline and briefly cache failure`, async ({ handler }) => {
  aiResponder = responder;
  const run = () => handler(request({ market: 'US', date: '2026-10-16', useAI: true }));
  const response = await run(); const report = await response.json(); assert.equal(response.status, 200); assert.equal(report.analysisMode, 'basic'); assert.equal(report.indices[0].value, '110');
  await run(); assert.equal(aiCalls, 1);
});
await scenario('all public feeds fail: explicit missing data, never manufactured prices or AI call', async ({ handler }) => {
  feedResponder = () => new Response('limited', { status: 429 });
  const response = await handler(request({ market: 'US', date: '2026-10-16', useAI: true })); const report = await response.json();
  assert.equal(response.status, 200); assert.equal(report.dataStatus, 'unavailable'); assert.equal(report.aiStatus, 'no_data'); assert.equal(aiCalls, 0);
  assert(report.indices.every(i => i.status === 'unknown' && i.value === '확인 불가')); assert.equal(report.news.length, 0);
});
await scenario('missing exact trading date never uses nearest date', async ({ handler }) => {
  const original = feedResponder; feedResponder = url => url.includes('/chart/') ? Response.json(chart([100, 110], ['2026-10-14', '2026-10-15'])) : original(url);
  const report = await (await handler(request())).json(); assert.equal(report.indices[0].value, '확인 불가');
});
await scenario('invalid/null closes cannot become zero or fabricated percentage', async ({ lib }) => {
  const bars = lib.parseBars(chart([100, null, 0], ['2026-10-14', '2026-10-15', '2026-10-16']), 'UTC'); assert.equal(bars.bars.length, 1);
});
await scenario('RSS: timestamp timezone, CDATA/entities, duplicates and unsafe links', async ({ lib }) => {
  const xml = '<rss>' + item('Nasdaq &amp; S&amp;P') + item('Nasdaq &amp; S&amp;P') + item('Nasdaq unsafe', undefined, 'javascript:alert(1)') + item('Nasdaq previous NY day', 'Fri, 16 Oct 2026 01:00:00 GMT') + '</rss>';
  const news = lib.parseNews(xml, '2026-10-16', 'America/New_York'); assert.equal(news.length, 1); assert.equal(news[0].title, 'Nasdaq & S&P');
});
await scenario('free autocomplete filters unsupported instruments without Gemini', async ({ handler }) => {
  const data = await (await handler(request({ query: 'Apple' }, 'search_stock'))).json(); assert.equal(data.length, 1); assert.equal(data[0].ticker, 'AAPL'); assert.equal(aiCalls, 0);
});
await scenario('stock detail uses real daily values, no generated earnings or random bars', async ({ handler }) => {
  const data = await (await handler(request({ name: 'Apple', ticker: 'AAPL' }, 'stock'))).json(); assert.equal(data.trend, 'up'); assert.deepEqual(data.closeHistory, [100, 110]); assert.equal(aiCalls, 0);
});
await scenario('input validation and POST only', async ({ handler }) => {
  for (const req of [request(null), request({ market: 'US', date: '2026-02-30' }), request({ market: 'US', date: '2999-01-01' }), request({ market: '__proto__', date: '2026-10-16' }), request({ market: 'US', date: '2026-10-16', useAI: 'true' }), request({ query: 'x'.repeat(101) }, 'search_stock'), new Request('https://t', { method: 'POST', body: '{' })]) assert.equal((await handler(req)).status, 400);
  assert.equal((await handler(new Request('https://t'))).status, 405); assert.equal(aiCalls, 0); assert.equal(publicCalls, 0);
});
await scenario('explicitly disabled AI never calls Gemini', async ({ handler }) => {
  process.env.GEMINI_SUMMARY_ENABLED = 'false'; const report = await (await handler(request({ market: 'US', date: '2026-10-16', useAI: true }))).json(); assert.equal(report.aiStatus, 'disabled'); assert.equal(aiCalls, 0);
});
await scenario('frontend scripts parse, default excludes AI, no fabricated stock chart', async () => {
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]); scripts.forEach(s => new vm.Script(s));
  const ctx = vm.createContext({ window: {}, document: { addEventListener() {} }, Date, Intl, setTimeout, clearTimeout, console });
  vm.runInContext(scripts.at(-1), ctx);
  assert.equal(vm.runInContext("escapeHtml('<img>')", ctx), '&lt;img&gt;'); assert.equal(vm.runInContext("formatChangeValue('확인 불가')", ctx), '확인 불가');
  assert(html.includes('useAI: true')); assert(!html.includes('Math.random()')); assert(!html.includes('callGeminiAPI'));
});
await scenario('report UI renders baseline, source links and explicit empty-data states', async () => {
  const ids = new Set([...html.matchAll(/id="([^"]+)"/g)].map(m => m[1]));
  const elements = new Map();
  const node = () => ({ children: [], style: {}, dataset: {}, classList: { add() {}, remove() {} }, appendChild(child) { this.children.push(child); }, replaceChildren() { this.children = []; }, addEventListener() {}, setAttribute() {} });
  const document = { getElementById(id) { assert(ids.has(id), `missing DOM id ${id}`); if (!elements.has(id)) elements.set(id, node()); return elements.get(id); }, createElement: node, querySelectorAll() { return []; }, addEventListener() {} };
  const ctx = vm.createContext({ window: {}, document, Date, Intl, setTimeout, clearTimeout, console, URL, lucide: { createIcons() {} } });
  vm.runInContext([...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)[1], ctx);
  ctx.sample = { market: 'US', marketName: '미국', date: '2026-10-16', summary: '기본 요약', analysis: '종가 집계', sentiment: { score: null, label: '상승 1 · 하락 0' }, sectors: [], stocks: [], news: [], indices: [], macro: { exchangeRate: { value: '확인 불가', change: '확인 불가', status: 'unknown' }, dollarIndex: { value: '100', change: '+1%', status: 'up' }, commodities: [] }, sources: [{ title: '자료', url: 'https://example.com' }], warnings: ['시각 기준 확인'], aiMessage: '공개 데이터 기본 요약', aiStatus: 'not_requested', dataStatus: 'available' };
  vm.runInContext('state.reportData=sample; renderReport();', ctx);
  assert.equal(elements.get('rendered-summary').innerText, '기본 요약'); assert.equal(elements.get('ai-interpret-button').disabled, false);
  assert.equal(elements.get('rendered-sentiment-label').innerText, '상승 1 · 하락 0'); assert(elements.get('rendered-stocks-container').textContent.includes('종목 검색'));
  assert.equal(elements.get('rendered-sources').children[1].href, 'https://example.com/');
  ctx.sample.aiStatus = 'quota'; vm.runInContext('renderReport();', ctx); assert.equal(elements.get('ai-interpret-button').disabled, true); assert.equal(elements.get('rendered-summary').innerText, '기본 요약');
});
await scenario('default date chooses most recent closed local weekday for US/KR', async () => {
  class FixedDate extends Date { constructor(...args) { super(...(args.length ? args : ['2026-10-19T23:11:00Z'])); } }
  const picker = {}; const ctx = vm.createContext({ window: {}, document: { getElementById: () => picker, addEventListener() {} }, Date: FixedDate, Intl, setTimeout, clearTimeout });
  vm.runInContext([...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)[1], ctx);
  vm.runInContext("setDefaultDate('US')", ctx); assert.equal(picker.value, '2026-10-19');
  vm.runInContext("setDefaultDate('KR')", ctx); assert.equal(picker.value, '2026-10-19');
});
