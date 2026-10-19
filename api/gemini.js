export const config = {
  runtime: 'edge', 
};

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

    if (!['report', 'search_stock', 'stock'].includes(type)) {
      return new Response(JSON.stringify({ error: '지원하지 않는 type입니다.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!reqData || typeof reqData !== 'object' || Array.isArray(reqData)) {
      return new Response(JSON.stringify({ error: 'payload 객체가 필요합니다.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const requiredFields = {
      report: ['marketText', 'date', 'exchangeTarget'],
      search_stock: ['query'],
      stock: ['name'],
    }[type];
    const missingFields = requiredFields.filter(field =>
      typeof reqData[field] !== 'string' || !reqData[field].trim()
    );
    if (missingFields.length) {
      return new Response(JSON.stringify({ error: `필수 문자열이 누락되었습니다: ${missingFields.join(', ')}` }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'Vercel 환경 변수에 API 키가 설정되지 않았습니다.' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=${apiKey}`;

    let payload = {};

    if (type === 'report') {
      payload = {
        contents: [{ parts: [{ text: `주제: ${reqData.marketText} ${reqData.date} 시황 리포트. 
        [중요] 타임아웃 방지를 위해 구글 검색은 1~2회로 제한하고 빠르고 정확하게 팩트만 요약해.
        
        필수 데이터:
        1. 환율: ${reqData.exchangeTarget} 최신 데이터.
        2. 투자심리: 0~100 점수와 상태(공포/중립/탐욕).
        3. 당일 주도 섹터 3가지.

        응답은 아래 JSON 형식만 정확히 지켜서 출력해. 설명이나 마크다운은 절대 금지:
        {
          "marketName": "시장명", "date": "날짜", "summary": "전체 요약",
          "sentiment": { "score": 50, "label": "중립" },
          "sectors": ["섹터1", "섹터2", "섹터3"],
          "indices": [ { "name": "지수명", "value": "수치", "change": "변동폭", "status": "up|down|steady" } ],
          "macro": {
            "exchangeRate": { "value": "수치", "change": "변동폭", "status": "up|down|steady" },
            "dollarIndex": { "value": "수치", "change": "변동폭", "status": "up|down|steady" },
            "commodities": [ { "name": "원자재명", "value": "수치", "change": "변동폭", "status": "up|down|steady" } ]
          },
          "news": [ { "title": "뉴스 제목", "source": "언론사" } ],
          "stocks": [ { "name": "종목명", "ticker": "티커", "change": "등락", "status": "up|down|steady", "reason": "이유" } ],
          "analysis": "종합 분석"
        }` }] }],
        systemInstruction: { parts: [{ text: '토스증권 애널리스트처럼 군더더기 없이 사실 위주로 빠르게 답변해. 무조건 JSON으로만 출력해야 해.' }] },
        tools: [{ googleSearch: {} }]
      };
    } 
    else if (type === 'search_stock') {
      payload = {
        contents: [{ parts: [{ text: `'${reqData.query}' 검색어와 관련된 상장 기업 최대 5개를 찾아줘. 검색을 최소화하고 시가총액이 큰 순서대로 나열해.
        
        응답은 아래 JSON 배열 형식으로만 출력해:
        [
          { "name": "기업명", "ticker": "티커", "exchange": "거래소", "reason": "이유" }
        ]` }] }],
        systemInstruction: { parts: [{ text: '무조건 JSON 배열로만 대답해.' }] },
        tools: [{ googleSearch: {} }]
      };
    }
    else if (type === 'stock') {
      const searchTarget = reqData.ticker ? `${reqData.name} (${reqData.ticker})` : reqData.name;
      payload = {
        contents: [{ parts: [{ text: `'${searchTarget}'의 최신 소개와 어닝 리포트 핵심 3가지를 빠르게 구글 검색 후 요약해.
        
        응답은 아래 JSON 형식으로만 출력해:
        {
          "info": "기업 소개",
          "trend": "up|down|steady",
          "earnings": ["실적1", "실적2", "실적3"]
        }` }] }],
        systemInstruction: { parts: [{ text: '사실 위주로 빠르게 요약하고, 무조건 JSON으로만 대답해.' }] },
        tools: [{ googleSearch: {} }]
      };
    }

    const aiResponse = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const rawResponse = await aiResponse.text();
    let aiData;

    // Upstream errors may contain the API key in an error message.
    const redact = value => String(value).split(apiKey).join('[REDACTED]');

    try {
      aiData = JSON.parse(rawResponse);
    } catch {
      console.error('Gemini non-JSON response:', {
        status: aiResponse.status,
        body: redact(rawResponse.slice(0, 1000)),
      });
      return new Response(JSON.stringify({
        error: 'Gemini에서 JSON이 아닌 응답을 반환했습니다.',
        upstreamStatus: aiResponse.status,
      }), {
        status: aiResponse.ok ? 502 : aiResponse.status,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!aiResponse.ok || aiData?.error) {
      const upstreamError = aiData?.error;
      const errorMsg = redact(upstreamError?.message || '구글 API 에러');
      console.error('Gemini API error:', {
        httpStatus: aiResponse.status,
        code: upstreamError?.code,
        status: upstreamError?.status,
        message: errorMsg,
      });
      return new Response(JSON.stringify({
        error: `[API 통신 오류] ${errorMsg}`,
        upstreamStatus: aiResponse.status,
        upstreamCode: upstreamError?.code,
        upstreamErrorStatus: upstreamError?.status,
      }), {
        status: aiResponse.ok ? 502 : aiResponse.status,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const candidate = aiData?.candidates?.[0];
    let jsonText = (candidate?.content?.parts ?? [])
      .filter(part => typeof part.text === 'string' && !part.thought)
      .map(part => part.text)
      .join('')
      .trim()
      .replace(/^\x60\x60\x60(?:json)?\s*/i, '')
      .replace(/\s*\x60\x60\x60$/, '')
      .trim();

    if (!jsonText || (candidate?.finishReason && candidate.finishReason !== 'STOP')) {
      return new Response(JSON.stringify({
        error: jsonText
          ? 'AI 응답이 정상적으로 완료되지 않았습니다. 다시 시도해 주세요.'
          : 'AI 응답에 텍스트가 없습니다. 잠시 후 시도해 주세요.',
        finishReason: candidate?.finishReason,
        blockReason: aiData?.promptFeedback?.blockReason,
      }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    
    try {
      JSON.parse(jsonText);
    } catch (e) {
      return new Response(JSON.stringify({ error: '데이터 구조가 손상되었습니다. 다시 분석 버튼을 눌러주세요.' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    
    return new Response(jsonText, {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: `[서버 타임아웃/오류] ${error.message}` }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
