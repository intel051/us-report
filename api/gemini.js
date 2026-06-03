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
    const body = await req.json();
    const type = body.type;
    const reqData = body.payload;
    
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'Vercel 환경 변수에 API 키가 설정되지 않았습니다.' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

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

    const aiData = await aiResponse.json();
    
    if (!aiResponse.ok || aiData.error) {
      const errorMsg = aiData.error?.message || '구글 API 에러';
      return new Response(JSON.stringify({ error: `[API 통신 오류] ${errorMsg}` }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!aiData.candidates || aiData.candidates.length === 0) {
      return new Response(JSON.stringify({ error: 'AI가 데이터를 생성하지 못했습니다. 잠시 후 시도해 주세요.' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    
    let jsonText = aiData.candidates[0].content.parts[0].text.trim();
    if (jsonText.startsWith('```')) {
      jsonText = jsonText
