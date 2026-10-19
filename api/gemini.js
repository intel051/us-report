javascript
export const config = {
  runtime: 'edge', 
};

/**
 * 실시간 공공/무료 API 헬퍼 함수
 */
async function fetchExchangeRate(targetSymbol = 'KRW') {
  try {
    const res = await fetch(`https://open.er-api.com/v6/latest/USD`);
    if (!res.ok) return null;
    const data = await res.json();
    return data?.rates?.[targetSymbol] || null;
  } catch {
    return null;
  }
}

async function fetchStockQuote(ticker) {
  try {
    const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=5d`);
    if (!res.ok) return null;
    const data = await res.json();
    const result = data?.chart?.result?.[0];
    if (!result) return null;

    const meta = result.meta;
    const previousClose = meta.chartPreviousClose || meta.previousClose;
    const currentPrice = meta.regularMarketPrice;
    const change = currentPrice - previousClose;
    const changePercent = previousClose ? ((change / previousClose) * 100).toFixed(2) : '0.00';

    return {
      symbol: meta.symbol,
      currency: meta.currency,
      price: currentPrice,
      change: change.toFixed(2),
      changePercent: `${changePercent}%`,
      status: change > 0 ? 'up' : change < 0 ? 'down' : 'steady'
    };
  } catch {
    return null;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchGeminiWithRetry(endpoint, payload, maxRetries = 2) {
  let delay = 1000;

  for (let i = 0; i < maxRetries; i++) {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (response.status === 429 && i < maxRetries - 1) {
      await sleep(delay);
      delay *= 2;
      continue;
    }

    return response;
  }
}

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'POST 메서드만 지원합니다.' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    let body;
    try {
      body = await req.json();
    } catch {
      return new Response(JSON.stringify({ error: '올바른 JSON 요청이 필요합니다.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const type = body?.type;
    const reqData = body?.payload;

    if (!['report', 'search_stock', 'stock'].includes(type) || !reqData) {
      return new Response(JSON.stringify({ error: '잘못된 요청 형식입니다.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'Vercel 환경 변수에 GEMINI_API_KEY가 없습니다.' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // gemini-3.8-flash 엔드포인트 유지
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=${apiKey}`;

    let payload = {};

    if (type === 'report') {
      const exchangeData = await fetchExchangeRate('KRW');
      const exchangeStr = exchangeData ? `1 USD = ${exchangeData} KRW` : '1 USD = 1,350 KRW';

      payload = {
        contents: [{
          parts: [{
            text: `주제: ${reqData.marketText} (${reqData.date})
참고 환율: ${exchangeStr}

위 주제의 시황 리포트를 아래 JSON 규격으로만 간결하게 출력:
{
  "marketName": "${reqData.marketText}",
  "date": "${reqData.date}",
  "summary": "핵심 요약 1~2문장",
  "sentiment": { "score": 50, "label": "중립" },
  "sectors": ["주요섹터1", "주요섹터2", "주요섹터3"],
  "indices": [ { "name": "지수", "value": "수치", "change": "변동", "status": "up|down|steady" } ],
  "macro": {
    "exchangeRate": { "value": "${exchangeStr}", "change": "0", "status": "steady" },
    "dollarIndex": { "value": "104.5", "change": "0", "status": "steady" },
    "commodities": [ { "name": "WTI", "value": "75.0", "change": "0", "status": "steady" } ]
  },
  "news": [ { "title": "주요 이슈 요약", "source": "시황 분석" } ],
  "stocks": [ { "name": "대표종목", "ticker": "TICKER", "change": "0%", "status": "steady", "reason": "이유" } ],
  "analysis": "종합 평"
}`
          }]
        }],
        systemInstruction: { parts: [{ text: 'JSON만 출력해.' }] }
      };
    } 
    else if (type === 'search_stock') {
      payload = {
        contents: [{
          parts: [{
            text: `'${reqData.query}' 관련 상장기업 5개를 JSON 배열로 출력:
[ { "name": "기업명", "ticker": "티커", "exchange": "거래소", "reason": "이유" } ]`
          }]
        }],
        systemInstruction: { parts: [{ text: 'JSON 배열만 출력해.' }] }
      };
    }
    else if (type === 'stock') {
      const ticker = reqData.ticker || reqData.name;
      const quote = await fetchStockQuote(ticker);

      payload = {
        contents: [{
          parts: [{
            text: `종목: ${reqData.name} (${ticker})
시세: ${quote ? JSON.stringify(quote) : '정보 없음'}

기업 요약 및 투자 핵심 3가지를 JSON으로 출력:
{
  "info": "기업 요약",
  "trend": "${quote?.status || 'steady'}",
  "earnings": ["핵심1", "핵심2", "핵심3"]
}`
          }]
        }],
        systemInstruction: { parts: [{ text: 'JSON만 출력해.' }] }
      };
    }

    const aiResponse = await fetchGeminiWithRetry(endpoint, payload);
    const rawResponse = await aiResponse.text();

    const redact = value => String(value).split(apiKey).join('[REDACTED]');

    let aiData;
    try {
      aiData = JSON.parse(rawResponse);
    } catch {
      return new Response(JSON.stringify({
        error: 'Gemini 응답 형식이 올바르지 않습니다.',
        upstreamStatus: aiResponse.status,
      }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!aiResponse.ok || aiData?.error) {
      const upstreamError = aiData?.error;
      const errorMsg = redact(upstreamError?.message || '구글 API 오류');

      if (aiResponse.status === 429) {
        return new Response(JSON.stringify({
          error: '무료 API 처리 한도(Quota)를 초과했습니다. Google AI Studio에서 새 API 키를 발급받거나 결제 수단을 등록해주세요.',
          upstreamStatus: 429
        }), {
          status: 429,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({
        error: `[API 오류] ${errorMsg}`,
        upstreamStatus: aiResponse.status,
      }), {
        status: aiResponse.ok ? 502 : aiResponse.status,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const candidate = aiData?.candidates?.[0];
    let jsonText = (candidate?.content?.parts ?? [])
      .filter(part => typeof part.text === 'string')
      .map(part => part.text)
      .join('')
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '')
      .trim();

    try {
      JSON.parse(jsonText);
    } catch {
      return new Response(JSON.stringify({ error: '생성된 JSON 구조가 파싱되지 않습니다.' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(jsonText, {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: `[서버 오류] ${error.message}` }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
