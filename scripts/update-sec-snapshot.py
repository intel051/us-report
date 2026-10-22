"""Refresh free SEC fallback data. Run: python scripts/update-sec-snapshot.py
The snapshot has its own retrieval date; the app never treats it as a live quote.
"""
import concurrent.futures, datetime, html, json, pathlib, re, time, urllib.request
ROOT = pathlib.Path(__file__).resolve().parents[1]
TARGET = ROOT / 'lib/sec-snapshot.js'
TODAY = datetime.date.today().isoformat()
AGENT = 'ClosingNote/1.0 (https://us-report.vercel.app; https://github.com/intel051/us-report/issues)'
TAGS = ['RevenueFromContractWithCustomerExcludingAssessedTax','Revenues','SalesRevenueNet','RevenueFromContractWithCustomerIncludingAssessedTax','EarningsPerShareDiluted']

def fetch(url):
    for attempt in range(2):
        try:
            with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':AGENT}),timeout=18) as res:
                raw = res.read(10000001)
                if len(raw)>10000000: return None
                return raw.decode('utf-8')
        except Exception:
            if attempt == 0: time.sleep(1)
    return None

def business_excerpt(raw):
    if not raw: return ''
    text = re.sub(r'<(script|style)\b[^>]*>[\s\S]*?</\1>', ' ', raw, flags=re.I)
    text = re.sub(r'</?(?:span|font|b|i|strong|em|a|ix:[\w.-]+)\b[^>]*>', '', text, flags=re.I)
    text = re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', ' ', text)))
    for match in re.finditer(r'\bITEM\s*1\s*[.:–—-]?\s*BUSINESS\b',text,re.I):
        rest = text[match.end():]
        end = re.search(r'\bITEM\s*1A\s*[.:–—-]?\s*RISK',rest,re.I)
        if end and end.start()>600: return rest[:min(end.start(),2200)].strip()
    return ''

def update(pair):
    ticker,cik = pair
    ident = str(cik).zfill(10)
    raw = fetch(f'https://data.sec.gov/api/xbrl/companyfacts/CIK{ident}.json')
    if not raw: return ticker,None
    data = json.loads(raw); facts = {}
    for tag in TAGS:
        unit = 'USD/shares' if tag == 'EarningsPerShareDiluted' else 'USD'
        rows = data.get('facts',{}).get('us-gaap',{}).get(tag,{}).get('units',{}).get(unit,[])
        compact = {}
        for r in rows:
            if not ('2022-01-01' <= r.get('filed','') <= TODAY and r.get('form') in ['10-K','10-Q','10-K/A','10-Q/A']): continue
            try: days = (datetime.date.fromisoformat(r['end'])-datetime.date.fromisoformat(r['start'])).days
            except (ValueError,KeyError): continue
            if not (70<=days<=110 or 330<=days<=390): continue
            row = {k:r[k] for k in ['start','end','val','filed','form','accn']}
            key = json.dumps([row['start'],row['end'],row['val']])
            if key not in compact or row['filed'] < compact[key]['filed']: compact[key] = row
        if compact: facts[tag] = {'units':{unit:list(compact.values())}}
    raw = fetch(f'https://data.sec.gov/submissions/CIK{ident}.json')
    business = None
    if raw:
        recent = json.loads(raw).get('filings',{}).get('recent',{})
        for i,form in enumerate(recent.get('form',[])):
            if form != '10-K' or recent['filingDate'][i] > TODAY: continue
            url = f"https://www.sec.gov/Archives/edgar/data/{cik}/{recent['accessionNumber'][i].replace('-','')}/{recent['primaryDocument'][i]}"
            excerpt = business_excerpt(fetch(url))
            if excerpt: business = {'excerpt':excerpt,'filed':recent['filingDate'][i],'url':url}
            break
    result = {'cik':cik,'retrievedAt':TODAY,'facts':{'facts':{'us-gaap':facts}},'business':business}
    print(ticker,'facts',len(facts),'business',bool(business),flush=True)
    return ticker,result

def main():
    # Keep prior successful data if a provider temporarily refuses a request.
    previous = {}
    if TARGET.exists(): previous = json.loads(TARGET.read_text().split('export const SEC_SNAPSHOT = ',1)[1].rstrip(';\n'))
    raw = fetch('https://www.sec.gov/files/company_tickers.json')
    if not raw: raise SystemExit('SEC ticker map unavailable; existing snapshot retained')
    mapping = {r['ticker']:r['cik_str'] for r in json.loads(raw).values()}
    universe = (ROOT/'lib/stock-universe.js').read_text().split('  US: [',1)[1].split('  KR:',1)[0]
    tickers = re.findall(r"\['([^']+)'",universe)
    pairs = [(t,mapping[t]) for t in tickers if t in mapping]
    # At most three simultaneous requests, well below SEC's 10 requests/second policy.
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        for ticker,result in pool.map(update,pairs):
            if result: previous[ticker] = result
    TARGET.write_text('// Public SEC fallback. Refresh with scripts/update-sec-snapshot.py; preserve filing dates.\nexport const SEC_SNAPSHOT = '+json.dumps(previous,ensure_ascii=False,separators=(',',':'))+';\n')
    print('Saved',len(previous),'tickers,',TARGET.stat().st_size,'bytes')

if __name__ == '__main__': main()
