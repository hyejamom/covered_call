import {
    CALC_ASSET_META,
    type CalcAsset,
    DividendBasis,
    DividendSource,
} from '../constants/assetConstants'
import { Currency, type DividendEvent, type PriceHistory, type WeeklyClose } from '../types/technical'

// ══════════ 통신용 DTO ══════════

/** Yahoo Finance chart 응답 (이력 조회) — 필요한 필드만 선언 */
interface YahooHistoryResponseDto {
    chart: {
        result: {
            meta: {
                regularMarketPrice: number
                /** 시세 통화 — 한국 종목은 KRW 로 온다 */
                currency?: string
                /** 거래소 시간대 — 'America/New_York', 'Asia/Seoul' */
                exchangeTimezoneName?: string
                /** 실제로 내려온 봉 단위 — '1wk' 가 아니면 지표 계산의 전제가 깨진다 */
                dataGranularity?: string
            }
            /** 봉별 시작 시각 UNIX 초 */
            timestamp: number[] | null
            indicators: { quote: { close: (number | null)[] | null }[] | null } | null
            /** 배당 이벤트 — 키가 타임스탬프인 객체로 온다 */
            events?: { dividends?: Record<string, { amount: number, date: number }> }
        }[] | null
        error: unknown
    }
}

/** Yahoo Finance chart 응답 — 필요한 필드만 선언 */
interface YahooChartResponseDto {
    chart: {
        result: {
            meta: {
                symbol: string
                currency: string
                regularMarketPrice: number
                chartPreviousClose: number
                regularMarketTime: number
            }
        }[] | null
        error: unknown
    }
}

/** Nasdaq 배당 내역 1건 */
interface NasdaqDividendRowDto {
    exOrEffDate: string
    amount: string
    type: string
    paymentDate: string
}

/** Nasdaq 배당 정보 응답 — 필요한 필드만 선언 */
interface NasdaqDividendResponseDto {
    data: {
        exDividendDate: string | null
        dividends: { rows: NasdaqDividendRowDto[] | null } | null
    } | null
}

/** open.er-api.com 환율 응답 */
interface ExchangeRateResponseDto {
    result: string
    time_last_update_utc: string
    rates: Record<string, number>
}

// ══════════ 도메인 모델 ══════════

/** 종목 시세 — 금액 단위는 종목 통화(JEPQ = USD, 국내 ETF = KRW)를 따른다 */
export interface QuoteInfo {
    price: number
    previousClose: number
    changeAmount: number
    changeRate: number
}

/** 종목 배당 정보 — 최근 12개월 실지급 내역 기준 */
export interface DividendInfo {
    /** 최근 12개월 주당 배당 합계 — 배당수익률 계산의 분자 */
    ttmDividend: number
    /** 최근 1회 주당 배당금 */
    latestDividend: number
    /**
     * 시뮬레이션에 넣을 "주당 월 배당금".
     * 월배당 종목은 최근 1회 지급액을 그대로 쓰고, 분기·연 배당 종목은 12개월 합계를 12로 나눠 평탄화한다.
     * (연 1회만 주는 국내 ETF 에 최근 1회를 그대로 넣으면 배당이 12배로 부풀어 오른다)
     */
    monthlyDividend: number
    exDividendDate: string
    /** 최근 12개월 안에 실제로 지급된 회차 수 */
    paymentCount: number
}

/** 원/달러 환율 */
export interface ExchangeRateInfo {
    krwPerUsd: number
    updatedAt: string
}

// ══════════ 상수 ══════════

const EXCHANGE_RATE_URL = 'https://open.er-api.com/v6/latest/USD'

/** TTM 배당 합산 대상 회차 수 — 월배당 종목 기준 상한 */
const DIVIDEND_MONTHS = 12

/** 1년을 밀리초로 — Yahoo 배당 이벤트에서 "최근 12개월" 구간을 잘라 낼 때 쓴다 */
const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000

/** 시세 조회 URL — @param symbol Yahoo 심볼 */
function toQuoteUrl(symbol: string): string {
    return `/api/yahoo/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1d`
}

/** Nasdaq 배당 내역 URL — 미국 상장 ETF 전용. @param symbol 티커 */
function toNasdaqDividendUrl(symbol: string): string {
    return `/api/nasdaq/api/quote/${encodeURIComponent(symbol)}/dividends?assetclass=etf`
}

/**
 * Yahoo 배당 이벤트 조회 URL — 국내 종목처럼 Nasdaq 이 못 다루는 종목의 대체 경로.
 * 최근 12개월만 필요하지만 지급이 드문 종목(연 1회)도 잡히도록 2년 구간을 받아 온다.
 * @param symbol Yahoo 심볼
 */
function toYahooDividendUrl(symbol: string): string {
    return `/api/yahoo/v8/finance/chart/${encodeURIComponent(symbol)}?range=2y&interval=1mo&events=div`
}

// ══════════ 유틸 ══════════

/**
 * 상장 이후 전체 주별 종가 + 배당 내역 조회 URL — 기술적 지표를 직접 계산하는 데 쓴다.
 *
 * 기준선이 60주선이라 봉 단위가 주봉이어야 한다. interval=1wk 로 명시하고,
 * 응답 meta.dataGranularity 로 실제 주봉이 왔는지 아래에서 한 번 더 확인한다.
 * (period1=0 → 상장일부터, period2 는 충분히 먼 미래. SPY 처럼 1993년 상장이어도 전체 구간이 온다)
 *
 * @param symbol 종목 코드
 */
function toHistoryUrl(symbol: string): string {
    return `/api/yahoo/v8/finance/chart/${symbol}?period1=0&period2=9999999999&interval=1wk&events=div`
}

/** "$0.70497" 형태의 금액 문자열에서 숫자만 추출 */
function parseAmount(value: string): number {
    return Number(String(value).replace(/[^0-9.]/g, '')) || 0
}

/** 거래소 시간대를 모를 때 쓰는 기본값 — 종목 대부분이 미국 상장이다 */
const DEFAULT_TIME_ZONE = 'America/New_York'

/**
 * UNIX 초 → 'YYYY-MM-DD'
 * 미국 장 마감(현지 16시)은 한국시간으로 다음 날 새벽이라, 거래소 현지 날짜로 읽어야 거래일이 하루씩 밀리지 않는다.
 * 한국 종목(KRX)은 시간대가 반대로 어긋나므로 응답이 알려 준 거래소 시간대를 그대로 쓴다.
 *
 * @param seconds UNIX 초
 * @param timeZone 거래소 시간대 (없으면 뉴욕)
 */
function toDateText(seconds: number, timeZone: string = DEFAULT_TIME_ZONE): string {
    return new Date(seconds * 1000).toLocaleDateString('en-CA', { timeZone })
}

// ══════════ API ══════════

/**
 * 1) 현재가 조회 — Yahoo Finance chart 엔드포인트 (15분 지연 시세)
 * — 국내 종목('133690.KS')과 미국 종목('JEPQ')이 같은 엔드포인트를 쓰므로 심볼만 갈아 끼우면 된다.
 * @param asset 조회할 종목 탭
 */
export async function fetchQuote(asset: CalcAsset): Promise<QuoteInfo> {
    const response = await fetch(toQuoteUrl(CALC_ASSET_META[asset].symbol))
    if (!response.ok) throw new Error(`시세 조회 실패 (${response.status})`)

    const dto: YahooChartResponseDto = await response.json()
    const dtoMeta = dto.chart.result?.[0]?.meta
    if (!dtoMeta) throw new Error('시세 응답 형식이 올바르지 않습니다')

    // 1-1) 전일 종가 대비 등락액/등락률 계산
    const changeAmount = dtoMeta.regularMarketPrice - dtoMeta.chartPreviousClose
    const changeRate = dtoMeta.chartPreviousClose === 0
        ? 0
        : (changeAmount / dtoMeta.chartPreviousClose) * 100

    return {
        price: dtoMeta.regularMarketPrice,
        previousClose: dtoMeta.chartPreviousClose,
        changeAmount,
        changeRate,
    }
}

/**
 * 시뮬레이션에 넣을 주당 월 배당금 산출
 * — 엔진은 매달 배당이 나오는 구조라, 월배당이 아닌 종목은 연 배당을 12로 나눠 평탄화해야 한다.
 * @param ttmDividend 최근 12개월 배당 합계 @param latestDividend 최근 1회 배당액 @param basis 종목별 산출 방식
 */
function toMonthlyDividend(ttmDividend: number, latestDividend: number, basis: DividendBasis): number {
    return basis === DividendBasis.LATEST ? latestDividend : ttmDividend / DIVIDEND_MONTHS
}

/**
 * 2-A) Nasdaq 배당 내역으로 배당 정보 조립 — 미국 상장 종목 전용
 *
 * 응답의 annualizedDividend/yield 필드는 "최근 1회 배당 × 12"로 계산되어
 * 매월 배당액이 변동하는 JEPQ에서는 실제와 크게 어긋난다.
 * (예: 최근 배당 $0.70497 × 12 = $8.45964 → 14.16%, 실제 TTM은 $6.52 → 10.93%)
 * 따라서 헤더 값은 무시하고 실지급 내역 최근 12건을 직접 합산한다.
 *
 * @param symbol 티커 @param basis 주당 월 배당금 산출 방식
 */
async function fetchDividendFromNasdaq(symbol: string, basis: DividendBasis): Promise<DividendInfo> {
    const response = await fetch(toNasdaqDividendUrl(symbol))
    if (!response.ok) throw new Error(`배당 조회 실패 (${response.status})`)

    const dto: NasdaqDividendResponseDto = await response.json()
    const dtoRows = dto.data?.dividends?.rows
    if (!dtoRows || dtoRows.length === 0) throw new Error('배당 내역이 비어 있습니다')

    // 1) 현금 배당만 추린 뒤 최신순 상위 12건 확보 (특별배당/주식배당 제외)
    const cashRows = dtoRows.filter((row) => row.type?.toLowerCase() === 'cash')
    const recentRows = cashRows.slice(0, DIVIDEND_MONTHS)
    if (recentRows.length === 0) throw new Error('현금 배당 내역이 없습니다')

    // 2) "$0.70497" 형태의 금액 문자열을 숫자로 변환해 합산
    const ttmDividend = recentRows.reduce((sum, row) => sum + parseAmount(row.amount), 0)
    const latestDividend = parseAmount(recentRows[0].amount)

    return {
        ttmDividend,
        // 3) 최근 1회 배당 — 배당락일 내림차순 정렬이므로 첫 행이 직전 월 지급분
        latestDividend,
        monthlyDividend: toMonthlyDividend(ttmDividend, latestDividend, basis),
        exDividendDate: dto.data?.exDividendDate ?? recentRows[0].exOrEffDate,
        paymentCount: recentRows.length,
    }
}

/**
 * 2-B) Yahoo 배당 이벤트로 배당 정보 조립 — 국내 종목 등 Nasdaq 이 다루지 못하는 종목용
 *
 * Nasdaq 배당 API 는 미국 상장 종목만 알고 있어 '133690.KS' 같은 심볼에는 아예 응답하지 않는다.
 * Yahoo chart 의 events=div 는 어느 시장이든 배당락일과 주당 지급액을 함께 내려 주므로 이쪽을 쓴다.
 *
 * @param symbol Yahoo 심볼 @param basis 주당 월 배당금 산출 방식
 */
async function fetchDividendFromYahoo(symbol: string, basis: DividendBasis): Promise<DividendInfo> {
    const response = await fetch(toYahooDividendUrl(symbol))
    if (!response.ok) throw new Error(`배당 조회 실패 (${response.status})`)

    const dto: YahooHistoryResponseDto = await response.json()
    const dtoResult = dto.chart.result?.[0]
    if (!dtoResult) throw new Error('배당 응답 형식이 올바르지 않습니다')

    // 1) 배당 이벤트를 배열로 펴고 최신순으로 정렬 — 응답이 타임스탬프 키를 가진 객체로 온다
    const timeZone = dtoResult.meta?.exchangeTimezoneName
    const events = Object.values(dtoResult.events?.dividends ?? {})
        .filter((item) => typeof item.amount === 'number' && item.amount > 0)
        .sort((a, b) => b.date - a.date)
    if (events.length === 0) throw new Error('배당 내역이 비어 있습니다')

    // 2) 최근 12개월 구간만 합산 — 국내 ETF 는 지급 회차가 불규칙해 "최근 N건"으로 자르면 기간이 들쭉날쭉해진다
    const since = (Date.now() - ONE_YEAR_MS) / 1000
    const recentEvents = events.filter((item) => item.date >= since)

    // 2-1) 1년 안에 한 건도 없으면(지급이 밀렸거나 신규 상장) 가장 최근 1건만이라도 잡아 화면이 비지 않게 한다
    const targetEvents = recentEvents.length > 0 ? recentEvents : events.slice(0, 1)
    const ttmDividend = targetEvents.reduce((sum, item) => sum + item.amount, 0)

    return {
        ttmDividend,
        latestDividend: events[0].amount,
        monthlyDividend: toMonthlyDividend(ttmDividend, events[0].amount, basis),
        exDividendDate: toDateText(events[0].date, timeZone),
        paymentCount: targetEvents.length,
    }
}

/**
 * 2) 배당 조회 — 종목이 어느 시장에 상장돼 있느냐에 따라 조회처가 갈린다
 * @param asset 조회할 종목 탭
 */
export async function fetchDividend(asset: CalcAsset): Promise<DividendInfo> {
    const meta = CALC_ASSET_META[asset]

    return meta.dividendSource === DividendSource.NASDAQ
        ? await fetchDividendFromNasdaq(meta.symbol, meta.dividendBasis)
        : await fetchDividendFromYahoo(meta.symbol, meta.dividendBasis)
}

/** 3) 원/달러 환율 조회 — open.er-api.com (키 불필요, CORS 허용되어 직접 호출) */
export async function fetchExchangeRate(): Promise<ExchangeRateInfo> {
    const response = await fetch(EXCHANGE_RATE_URL)
    if (!response.ok) throw new Error(`환율 조회 실패 (${response.status})`)

    const dto: ExchangeRateResponseDto = await response.json()
    const dtoKrw = dto.rates?.KRW
    if (dto.result !== 'success' || typeof dtoKrw !== 'number') {
        throw new Error('환율 응답 형식이 올바르지 않습니다')
    }

    return {
        krwPerUsd: dtoKrw,
        updatedAt: dto.time_last_update_utc,
    }
}

/**
 * 4) 주별 종가 이력 조회 — Yahoo Finance chart 엔드포인트 (상장 이후 전체 주봉 + 배당 이벤트)
 *
 * 지표 제공 사이트마다 이동평균·RSI 값이 다른 이유는 SMA/EMA 를 섞어 쓰거나 갱신 시점이 달라서다.
 * 그래서 지표 API 를 쓰지 않고 원본 종가만 받아 온 뒤 계산은 technicalEngine 에서 직접 한다.
 *
 * @param symbol 종목 코드 — 같은 계산을 여러 종목에 그대로 적용하므로 호출측이 정한다
 */
export async function fetchPriceHistory(symbol: string): Promise<PriceHistory> {
    const response = await fetch(toHistoryUrl(symbol))
    if (!response.ok) throw new Error(`시세 이력 조회 실패 (${response.status})`)

    const dto: YahooHistoryResponseDto = await response.json()
    const dtoResult = dto.chart.result?.[0]
    const dtoTimestamps = dtoResult?.timestamp
    const dtoCloses = dtoResult?.indicators?.quote?.[0]?.close
    if (!dtoResult || !dtoTimestamps || !dtoCloses) throw new Error('시세 이력 응답 형식이 올바르지 않습니다')

    // 4-0) 주봉이 아니면 지표가 통째로 어긋난다(60주선이 60일선이 되는 식) — 조용히 틀린 값을 그리느니 실패시킨다
    const dtoGranularity = dtoResult.meta?.dataGranularity
    if (dtoGranularity !== undefined && dtoGranularity !== '1wk') {
        throw new Error(`주봉이 아닌 ${dtoGranularity} 데이터가 왔습니다`)
    }

    // 4-0-1) 거래소 통화/시간대 — 한국 종목은 KRW · Asia/Seoul 로 온다. 값이 없으면 미국 상장으로 본다
    const currency = dtoResult.meta?.currency ?? Currency.USD
    const timeZone = dtoResult.meta?.exchangeTimezoneName

    // 4-1) 휴장 등으로 종가가 비어 오는 주가 섞이므로 값이 있는 주만 남긴다
    //      마지막 봉은 아직 진행 중인 이번 주다 — 현재가를 반영해야 하므로 그대로 포함한다
    const closes: WeeklyClose[] = []
    dtoTimestamps.forEach((timestamp, index) => {
        const close = dtoCloses[index]
        if (typeof close !== 'number') return
        closes.push({ date: toDateText(timestamp, timeZone), close })
    })
    if (closes.length === 0) throw new Error('시세 이력이 비어 있습니다')

    // 4-2) 배당 이벤트 — 배당락으로 깎인 주가를 되돌려 볼 때 쓴다 (없으면 빈 배열)
    const dividends: DividendEvent[] = Object.values(dtoResult.events?.dividends ?? {})
        .map((item) => ({ date: toDateText(item.date, timeZone), amount: item.amount }))
        .sort((a, b) => (a.date < b.date ? -1 : 1))

    // 4-3) 장중이면 meta 의 현재가가 마지막 주봉 종가보다 최신이다
    const lastClose = closes[closes.length - 1]
    const price = dtoResult.meta?.regularMarketPrice ?? lastClose.close

    // 4-4) 진행 중인 이번 주 봉의 종가를 현재가로 덮어써야 이동평균 끝값과 화면 현재가가 어긋나지 않는다
    closes[closes.length - 1] = { date: lastClose.date, close: price }

    return { symbol, currency, closes, dividends, price, asOf: lastClose.date }
}
