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
      return new Response(JSON.stringify({ error: 'API 키가 등록되지 않았습니다.' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${apiKey}`;

    let payload = {};

    if (type === 'report') {
      payload = {
        contents: [{ parts: [{ text: `주제: ${reqData.marketText} ${reqData.date} 마감 시황 리포트 작성. 반드시 google_search를 활용해 정확한 수치를 찾을 것.
        요구사항:
        1. 거시 지표 환율은 반드시 해당 시장에 맞는 '${reqData.exchangeTarget}' 데이터를 추출해라.
        2. 시장 참여자들의 투자 심리 점수를 0~100 사이(100이 탐욕)로 평가하고 상태 라벨(공포, 중립, 탐욕 등)을 작성해라.
        3. 당일 시장을 주도한 핵심 테마 혹은 섹터 3가지를 도출해라.` }] }],
        systemInstruction: { parts: [{ text: '당신은 토스증권 스타일의 간결한 문체를 사용하는 애널리스트입니다.' }] },
        tools: [{ 'google_search': {} }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: 'OBJECT',
            properties: {
              marketName: { type: 'STRING' }, date: { type: 'STRING' }, summary: { type: 'STRING' },
              sentiment: { type: 'OBJECT', properties: { score: { type: 'NUMBER' }, label: { type: 'STRING' } }, required: ['score', 'label'] },
              sectors: { type: 'ARRAY', items: { type: 'STRING' } },
              indices: { type: 'ARRAY', items: { type: 'OBJECT', properties: { name: { type: 'STRING' }, value: { type: 'STRING' }, change: { type: 'STRING' }, status: { type: 'STRING', enum: ['up', 'down', 'steady'] } } } },
              macro: { type: 'OBJECT', properties: {
                exchangeRate: { type: 'OBJECT', properties: { value: { type: 'STRING' }, change: { type: 'STRING' }, status: { type: 'STRING', enum: ['up', 'down', 'steady'] } } },
                dollarIndex: { type: 'OBJECT', properties: { value: { type: 'STRING' }, change: { type: 'STRING' }, status: { type: 'STRING', enum: ['up', 'down', 'steady'] } } },
                commodities: { type: 'ARRAY', items: { type: 'OBJECT', properties: { name: { type: 'STRING' }, value: { type: 'STRING' }, change: { type: 'STRING' }, status: { type: 'STRING', enum: ['up', 'down', 'steady'] } } } }
              } },
              news: { type: 'ARRAY', items: { type: 'OBJECT', properties: { title: { type: 'STRING' }, source: { type: 'STRING' } } } },
              stocks: { type: 'ARRAY', items: { type: 'OBJECT', properties: { name: { type: 'STRING' }, ticker: { type: 'STRING' }, change: { type: 'STRING' }, status: { type: 'STRING', enum: ['up', 'down', 'steady'] }, reason: { type: 'STRING' } } } },
              analysis: { type: 'STRING' }
            }
          }
        }
      };
    } 
    else if (type === 'stock') {
      payload = {
        contents: [{ parts: [{ text: `'${reqData.name}' 기업의 최신 기업 소개와 최근 발표된 실적(어닝 리포트) 핵심 내용 3가지를 구글 검색으로 찾아 요약해줘.` }] }],
        systemInstruction: { parts: [{ text: '토스증권처럼 쉽고 간결한 문체로 응답하라.' }] },
        tools: [{ 'google_search': {} }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: 'OBJECT',
            properties: {
              info: { type: 'STRING' },
              trend: { type: 'STRING', enum: ['up', 'down', 'steady'] },
              earnings: { type: 'ARRAY', items: { type: 'STRING' } }
            }
          }
        }
      };
    }

    const aiResponse = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const aiData = await aiResponse.json();
    
    let jsonText = aiData.candidates[0].content.parts[0].text.trim();
    if (jsonText.startsWith('```')) {
      jsonText = jsonText.replace(/^```(json)?|```$/g, '').trim();
    }
    
    return new Response(jsonText, {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
