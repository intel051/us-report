export const config = {
  // 속도가 빠른 Edge 런타임 사용
  runtime: 'edge', 
};

export default async function handler(req) {
  // POST 요청만 허용
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { 
      status: 405,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    // 프론트엔드(index.html)에서 보낸 데이터 추출
    const body = await req.json();
    const payload = body.payload;
    
    // Vercel 환경 변수에서 구글 API 키 가져오기
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("API 키가 Vercel 환경 변수(Environment Variables)에 설정되지 않았습니다.");
    }

    // Google Gemini API 엔드포인트
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${apiKey}`;

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    
    // 분석 결과를 프론트엔드로 전달
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
    
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { 
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
