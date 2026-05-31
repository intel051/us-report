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

    // 안정적인 2.5 플래시 모델 사용
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

    let payload = {};

    if (type === 'report') {
      payload = {
        contents: [{ parts: [{ text: `주제: ${reqData.marketText} ${reqData.date} 마감 시황 리포트 작성. 반드시 googleSearch를 활용해 최신 데이터를 찾을 것.
        
        요구사항:
        1. 거시 지표 환율은 반드시 해당 시장에 맞는 '${reqData.exchangeTarget}' 데이터를 추출해.
        2. 투자 심리 점수(0~100)와 상태(공포/중립/탐욕)를 작성해.
        3. 당일 주도 섹터 3가지를 도출해.

        [중요] 응답은 반드시 아래의 JSON 형식으로만 출력해. 마크다운 코드블럭이나 다른 설명은 절대 넣지 마:
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
        systemInstruction: { parts: [{ text: '당신은 토스증권 스타일의 간결한 문체를 사용하는 애널리스트입니다. 무조건 JSON으로만 대답하세요.' }] },
        tools: [{ googleSearch: {} }]
      };
    } 
    else if (type === 'search_stock') {
      payload = {
        contents: [{ parts: [{ text: `'${reqData.query}' 검색어와 관련된 상장 기업 최대 5개를 googleSearch로 찾아줘.
        
        [중요] 응답은 반드시 아래 JSON 배열 형식으로만 출력해:
        [
          { "name": "기업명", "ticker": "티커", "exchange": "거래소", "reason": "추천 이유" }
        ]` }] }],
        systemInstruction: { parts: [{ text: '무조건 JSON으로만 대답하세요.' }] },
        tools: [{ googleSearch: {} }]
      };
    }
    else if (type === 'stock') {
      const searchTarget = reqData.ticker ? `${reqData.name} (${reqData.ticker})` : reqData.name;
      payload = {
        contents: [{ parts: [{ text: `'${searchTarget}' 기업의 최신 소개와 어닝 리포트 핵심 3가지를 구글 검색으로 찾아 요약해줘.
        
        [중요] 응답은 반드시 아래 JSON 형식으로만 출력해:
        {
          "info": "기업 소개",
          "trend": "up|down|steady",
          "earnings": ["실적1", "실적2", "실적3"]
        }` }] }],
        systemInstruction: { parts: [{ text: '토스증권처럼 간결하게, 무조건 JSON으로만 대답하세요.' }] },
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
      const errorMsg = aiData.error?.message || '응답 에러가 발생했습니다.';
      return new Response(JSON.stringify({ error: `[API 오류] ${errorMsg}` }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!aiData.candidates || aiData.candidates.length === 0) {
      return new Response(JSON.stringify({ error: '데이터를 생성하지 못했습니다. 다시 시도해 주세요.' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    
    // 마크다운 코드블럭(```json)이 섞여 들어오면 깔끔하게 제거
    let jsonText = aiData.candidates[0].content.parts[0].text.trim();
    if (jsonText.startsWith('```')) {
      jsonText = jsonText.replace(/^```(json)?|```$/g, '').trim();
    }
    
    // JSON 파싱 검증
    try {
      JSON.parse(jsonText);
    } catch (e) {
      return new Response(JSON.stringify({ error: 'AI가 잘못된 형태의 데이터를 반환했습니다. 다시 시도해 주세요.' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    
    return new Response(jsonText, {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: `[서버 내부 오류] ${error.message}` }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
