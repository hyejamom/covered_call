// ══════════ 통신용 DTO ══════════

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
const NASDAQ_URL = `/api/nasdaq/api/quote/${SYMBOL}/dividends?assetclass=etf`
const EXCHANGE_RATE_URL = 'https://open.er-api.com/v6/latest/USD'

/** TTM 배당 합산 대상 회차 수 — JEPQ는 월배당이므로 12회 */
const DIVIDEND_MONTHS = 12

// ══════════ 유틸 ══════════

/** "$0.70497" 형태의 금액 문자열에서 숫자만 추출 */
function parseAmount(value: string): number {
    return Number(String(value).replace(/[^0-9.]/g, '')) || 0
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