// Explicit company aliases prevent treating arbitrary headline words as ticker symbols.
export const STOCK_UNIVERSE = {
  US: [
    ['NVDA','엔비디아','Nvidia|엔비디아','반도체'],['AMD','AMD','Advanced Micro Devices|\\bAMD\\b','반도체'],['AAPL','애플','\\bApple\\b|애플','기술'],['MSFT','마이크로소프트','Microsoft|마이크로소프트','기술'],
    ['TSLA','테슬라','Tesla|테슬라','자동차'],['AMZN','아마존','Amazon|아마존','소비'],['META','메타','\\bMeta\\b|메타','커뮤니케이션'],['GOOGL','알파벳','Alphabet|Google|알파벳','커뮤니케이션'],
    ['AVGO','브로드컴','Broadcom|브로드컴','반도체'],['ORCL','오라클','Oracle|오라클','기술'],['PLTR','팔란티어','Palantir|팔란티어','기술'],['NFLX','넷플릭스','Netflix|넷플릭스','커뮤니케이션'],
    ['INTC','인텔','\\bIntel\\b|인텔','반도체'],['MU','마이크론','Micron|마이크론','반도체'],['TSM','TSMC','\\bTSMC\\b|Taiwan Semiconductor','반도체'],['ARM','Arm','\\bArm Holdings\\b|\\bArm shares\\b','반도체'],
    ['DDOG','데이터독','Datadog|데이터독','기술'],['CRWV','코어위브','CoreWeave|코어위브','기술'],['CLF','클리블랜드클리프스','Cleveland.Cliffs','소재'],['JPM','JP모건','JPMorgan|JP Morgan|JP모건','금융'],
    ['GS','골드만삭스','Goldman Sachs|골드만삭스','금융'],['BAC','뱅크오브아메리카','Bank of America','금융'],['XOM','엑슨모빌','Exxon|엑슨','에너지'],['CVX','셰브런','Chevron|셰브런','에너지'],
    ['LLY','일라이릴리','Eli Lilly|일라이릴리','헬스케어'],['UNH','유나이티드헬스','UnitedHealth','헬스케어'],['WMT','월마트','Walmart|월마트','소비'],['BA','보잉','\\bBoeing\\b|보잉','산업재'],
    ['COIN','코인베이스','Coinbase|코인베이스','금융'],['MSTR','스트래티지','MicroStrategy|Strategy shares|스트래티지','기술'],['SMCI','슈퍼마이크로','Super Micro|Supermicro','기술'],['QCOM','퀄컴','Qualcomm|퀄컴','반도체'],
  ],
  KR: [
    ['005930.KS','삼성전자','삼성전자','반도체'],['000660.KS','SK하이닉스','SK하이닉스|SK 하이닉스','반도체'],['042700.KS','한미반도체','한미반도체','반도체'],['009150.KS','삼성전기','삼성전기','전자'],
    ['005380.KS','현대차','현대차|현대자동차','자동차'],['000270.KS','기아','기아','자동차'],['064350.KS','현대로템','현대로템','방산'],['012450.KS','한화에어로스페이스','한화에어로','방산'],
    ['047810.KS','한국항공우주','한국항공우주','방산'],['079550.KS','LIG넥스원','LIG넥스원','방산'],['034020.KS','두산에너빌리티','두산에너빌리티','에너지'],['267260.KS','HD현대일렉트릭','HD현대일렉트릭','전력'],
    ['373220.KS','LG에너지솔루션','LG에너지솔루션','이차전지'],['006400.KS','삼성SDI','삼성SDI','이차전지'],['051910.KS','LG화학','LG화학','소재'],['003670.KS','포스코퓨처엠','포스코퓨처엠','이차전지'],
    ['247540.KQ','에코프로비엠','에코프로비엠','이차전지'],['086520.KQ','에코프로','에코프로(?!비엠)','이차전지'],['035420.KS','NAVER','네이버|NAVER','인터넷'],['035720.KS','카카오','카카오','인터넷'],
    ['207940.KS','삼성바이오로직스','삼성바이오로직스','바이오'],['068270.KS','셀트리온','셀트리온','바이오'],['196170.KQ','알테오젠','알테오젠','바이오'],['028300.KQ','HLB','\\bHLB\\b','바이오'],
    ['105560.KS','KB금융','KB금융','금융'],['055550.KS','신한지주','신한지주','금융'],['042660.KS','한화오션','한화오션','조선'],['329180.KS','HD현대중공업','HD현대중공업','조선'],
    ['010140.KS','삼성중공업','삼성중공업','조선'],['298040.KS','효성중공업','효성중공업','전력'],['010120.KS','LS ELECTRIC','LS ELECTRIC|LS일렉트릭','전력'],
  ],
  JP: [
    ['9984.T','소프트뱅크그룹','ソフトバンクG|ソフトバンクグループ|SoftBank','기술'],['9983.T','패스트리테일링','ファーストリテイリング|ファストリ','소비'],['8035.T','도쿄일렉트론','東京エレクトロン|Tokyo Electron','반도체'],
    ['6857.T','어드반테스트','アドバンテスト|Advantest','반도체'],['6920.T','레이저텍','レーザーテック|Lasertec','반도체'],['285A.T','키옥시아','キオクシア|Kioxia','반도체'],['6146.T','디스코','ディスコ|DISCO','반도체'],
    ['7203.T','도요타','トヨタ|Toyota','자동차'],['7267.T','혼다','ホンダ|Honda','자동차'],['6758.T','소니','ソニー|Sony','전자'],['7974.T','닌텐도','任天堂|Nintendo','게임'],
    ['8306.T','미쓰비시UFJ','三菱UFJ|Mitsubishi UFJ','금융'],['8316.T','미쓰이스미토모','三井住友','금융'],['8411.T','미즈호','みずほ|Mizuho','금융'],['6501.T','히타치','日立|Hitachi','산업재'],
    ['7011.T','미쓰비시중공업','三菱重工','산업재'],['7012.T','가와사키중공업','川崎重工','산업재'],['4063.T','신에쓰화학','信越化学','소재'],['9432.T','NTT','\\bNTT\\b','통신'],['9433.T','KDDI','\\bKDDI\\b','통신'],
  ],
};

export function matchFeaturedCompanies(news, market) {
  const matches = (STOCK_UNIVERSE[market] || []).flatMap(([ticker, name, aliases, sector]) => {
    const expression = new RegExp(aliases, 'i');
    const stories = news.filter(n => expression.test(n.title));
    return stories.length ? [{ ticker, name, sector, stories, mentions: stories.length }] : [];
  });
  return matches.sort((a, b) => b.mentions - a.mentions || a.ticker.localeCompare(b.ticker)).slice(0, 6);
}
export const US_SECTORS = [['기술','XLK'],['커뮤니케이션','XLC'],['경기소비재','XLY'],['필수소비재','XLP'],['금융','XLF'],['헬스케어','XLV'],['산업재','XLI'],['에너지','XLE'],['소재','XLB'],['부동산','XLRE'],['유틸리티','XLU']];
