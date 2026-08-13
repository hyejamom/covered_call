import type { DailyClose, DividendEvent, PriceHistory } from '../types/technical'

// ══════════ 통신용 DTO ══════════

/** Yahoo Finance chart 응답 (이력 조회) — 필요한 필드만 선언 */
interface YahooHistoryResponseDto {
    chart: {
        result: {
            meta: {
                regularMarketPrice: number
                /** 실제로 내려온 봉 단위 — '1d' 가 아니면 지표 계산의 전제가 깨진다 */
                dataGranularity?: string
            }
            /** 거래일별 UNIX 초 */
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

/** JEPQ 시세 */
export interface QuoteInfo {
    price: number
    previousClose: number
    changeAmount: number
    changeRate: number
}

/** JEPQ 배당 정보 — 최근 12회 실지급액 기준 */
export interface DividendInfo {
    ttmDividend: number
    /** 최근 1회(=직전 월) 주당 배당금 — 시뮬레이션의 "월 배당금(주당)" 입력값 */
    latestDividend: number
    exDividendDate: string
    paymentCount: number
}

/** 원/달러 환율 */
export interface ExchangeRateInfo {
    krwPerUsd: number
    updatedAt: string
}

// ══════════ 상수 ══════════

const SYMBOL = 'JEPQ'
const YAHOO_URL = `/api/yahoo/v8/finance/chart/${SYMBOL}?range=1d&interval=1d`
/**
 * 상장 이후 전체 일별 종가 + 배당 내역 — 기술적 지표를 직접 계산하는 데 쓴다.
 *
 * range=max 를 쓰면 interval=1d 를 줘도 Yahoo 가 주봉(1wk)으로 내려보낸다.
 * 그러면 "50일선"이 사실상 50주선이 되어 지표가 통째로 어긋나므로, period 로 기간을 직접 찍어 일봉을 강제한다.
 * (period1=0 → 상장일부터, period2 는 충분히 먼 미래)
 */
const YAHOO_HISTORY_URL = `/api/yahoo/v8/finance/chart/${SYMBOL}?period1=0&period2=9999999999&interval=1d&events=div`
const NASDAQ_URL = `/api/nasdaq/api/quote/${SYMBOL}/dividends?assetclass=etf`
const EXCHANGE_RATE_URL = 'https://open.er-api.com/v6/latest/USD'

/** TTM 배당 합산 대상 회차 수 — JEPQ는 월배당이므로 12회 */
const DIVIDEND_MONTHS = 12

// ══════════ 유틸 ══════════

/** "$0.70497" 형태의 금액 문자열에서 숫자만 추출 */
function parseAmount(value: string): number {
    return Number(String(value).replace(/[^0-9.]/g, '')) || 0
}

/**
 * UNIX 초 → 'YYYY-MM-DD'
 * 미국 장 마감(현지 16시)은 한국시간으로 다음 날 새벽이라, 현지 날짜로 읽어야 거래일이 하루씩 밀리지 않는다.
 */
function toDateText(seconds: number): string {
    return new Date(seconds * 1000).toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
}

// ══════════ API ══════════

/** 1) JEPQ 현재가 조회 — Yahoo Finance chart 엔드포인트 (15분 지연 시세) */
export async function fetchQuote(): Promise<QuoteInfo> {
    const response = await fetch(YAHOO_URL)
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
 * 2) JEPQ 배당 조회 — Nasdaq 배당 내역 엔드포인트
 *
 * 응답의 annualizedDividend/yield 필드는 "최근 1회 배당 × 12"로 계산되어
 * 매월 배당액이 변동하는 JEPQ에서는 실제와 크게 어긋난다.
 * (예: 최근 배당 $0.70497 × 12 = $8.45964 → 14.16%, 실제 TTM은 $6.52 → 10.93%)
 * 따라서 헤더 값은 무시하고 실지급 내역 최근 12건을 직접 합산한다.
 */
export async function fetchDividend(): Promise<DividendInfo> {
    const response = await fetch(NASDAQ_URL)
    if (!response.ok) throw new Error(`배당 조회 실패 (${response.status})`)

    const dto: NasdaqDividendResponseDto = await response.json()
    const dtoRows = dto.data?.dividends?.rows
    if (!dtoRows || dtoRows.length === 0) throw new Error('배당 내역이 비어 있습니다')

    // 2-1) 현금 배당만 추린 뒤 최신순 상위 12건 확보 (특별배당/주식배당 제외)
    const cashRows = dtoRows.filter((row) => row.type?.toLowerCase() === 'cash')
    const recentRows = cashRows.slice(0, DIVIDEND_MONTHS)
    if (recentRows.length === 0) throw new Error('현금 배당 내역이 없습니다')

    // 2-2) "$0.70497" 형태의 금액 문자열을 숫자로 변환해 합산
    const ttmDividend = recentRows.reduce((sum, row) => sum + parseAmount(row.amount), 0)

    return {
        ttmDividend,
        // 2-3) 최근 1회 배당 — 배당락일 내림차순 정렬이므로 첫 행이 직전 월 지급분
        latestDividend: parseAmount(recentRows[0].amount),
        exDividendDate: dto.data?.exDividendDate ?? recentRows[0].exOrEffDate,
        paymentCount: recentRows.length,
    }
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
 * 4) JEPQ 일별 종가 이력 조회 — Yahoo Finance chart 엔드포인트 (상장 이후 전체 + 배당 이벤트)
 *
 * 지표 제공 사이트마다 이동평균·RSI 값이 다른 이유는 SMA/EMA 를 섞어 쓰거나 갱신 시점이 달라서다.
 * 그래서 지표 API 를 쓰지 않고 원본 종가만 받아 온 뒤 계산은 technicalEngine 에서 직접 한다.
 */
export async function fetchPriceHistory(): Promise<PriceHistory> {
    const response = await fetch(YAHOO_HISTORY_URL)
    if (!response.ok) throw new Error(`시세 이력 조회 실패 (${response.status})`)

    const dto: YahooHistoryResponseDto = await response.json()
    const dtoResult = dto.chart.result?.[0]
    const dtoTimestamps = dtoResult?.timestamp
    const dtoCloses = dtoResult?.indicators?.quote?.[0]?.close
    if (!dtoResult || !dtoTimestamps || !dtoCloses) throw new Error('시세 이력 응답 형식이 올바르지 않습니다')

    // 4-0) 일봉이 아니면 지표가 통째로 어긋난다(50일선이 50주선이 되는 식) — 조용히 틀린 값을 그리느니 실패시킨다
    const dtoGranularity = dtoResult.meta?.dataGranularity
    if (dtoGranularity !== undefined && dtoGranularity !== '1d') {
        throw new Error(`일봉이 아닌 ${dtoGranularity} 데이터가 왔습니다`)
    }

    // 4-1) 휴장일 등으로 종가가 비어 오는 날이 섞이므로 값이 있는 날만 남긴다
    const closes: DailyClose[] = []
    dtoTimestamps.forEach((timestamp, index) => {
        const close = dtoCloses[index]
        if (typeof close !== 'number') return
        closes.push({ date: toDateText(timestamp), close })
    })
    if (closes.length === 0) throw new Error('시세 이력이 비어 있습니다')

    // 4-2) 배당 이벤트 — 배당락으로 깎인 주가를 되돌려 볼 때 쓴다 (없으면 빈 배열)
    const dividends: DividendEvent[] = Object.values(dtoResult.events?.dividends ?? {})
        .map((item) => ({ date: toDateText(item.date), amount: item.amount }))
        .sort((a, b) => (a.date < b.date ? -1 : 1))

    // 4-3) 장중이면 meta 의 현재가가 마지막 종가보다 최신이다
    const lastClose = closes[closes.length - 1]
    const price = dtoResult.meta?.regularMarketPrice ?? lastClose.close

    return { closes, dividends, price, asOf: lastClose.date }
}
