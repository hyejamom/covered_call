// ══════════ 매수/매도 기준가 판정 타입 ══════════
// tsconfig erasableSyntaxOnly 설정으로 enum 문법을 쓸 수 없어 const 객체 + 동일명 타입으로 대체한다.

/** 주별 종가 1건 — 주봉 하나(그 주의 마지막 거래일 종가) */
export interface WeeklyClose {
    /** 'YYYY-MM-DD' — 해당 주봉의 시작일(월요일) */
    date: string
    close: number
}

/** 배당 지급 1건 */
export interface DividendEvent {
    /** 'YYYY-MM-DD' (배당락일) */
    date: string
    amount: number
}

/** 표기 통화 — 한국 종목이 섞이면서 종목마다 값의 단위가 달라졌다 */
export const Currency = {
    USD: 'USD',
    KRW: 'KRW',
} as const

export type Currency = (typeof Currency)[keyof typeof Currency]

/** 조회해 온 원본 시세 이력 — 상장 이후 전체 주봉 */
export interface PriceHistory {
    /** 조회한 종목 코드 — 판정 결과까지 그대로 실려 화면 표기에 쓰인다 */
    symbol: string
    /** 시세의 통화 — 거래소가 알려 준 값 그대로 (USD / KRW) */
    currency: string
    closes: WeeklyClose[]
    dividends: DividendEvent[]
    /** 가장 최근 종가 (혹은 장중 현재가) */
    price: number
    /** 최근 데이터 날짜 'YYYY-MM-DD' */
    asOf: string
}

/** 현재가가 어느 구간인지 */
export const PriceZone = {
    /** 60주선 이하 — 매수 구간 */
    CHEAP: 'CHEAP',
    /** 두 기준선 사이 — 기다리는 구간 */
    FAIR: 'FAIR',
    /** 과열 기준선 이상 — 매도 구간 */
    EXPENSIVE: 'EXPENSIVE',
} as const

export type PriceZone = (typeof PriceZone)[keyof typeof PriceZone]

/** 구간별 화면 표기명 */
export const PRICE_ZONE_LABEL: Record<PriceZone, string> = {
    [PriceZone.CHEAP]: '매수 구간',
    [PriceZone.FAIR]: '대기',
    [PriceZone.EXPENSIVE]: '과열',
}

/**
 * 판정 결과 — 화면은 이 값만 쓴다.
 *
 * 두 기준선을 모두 60주선 하나에 걸어 둔다.
 *   매수선 = 60주선 그 자체 (장기 추세선까지 눌린 자리)
 *   매도선 = 60주선 + N% (상장 이후 그만큼 벌어진 적이 20%뿐인 과열 수준)
 * 규칙을 한 축에 모아야 "무슨 근거로 산다는 건지"가 한 문장으로 설명된다.
 */
export interface TechnicalReport {
    /** 판정한 종목 코드 */
    symbol: string
    /** 시세의 통화 — 화면이 $ 로 찍을지 원으로 찍을지 이 값으로 정한다 */
    currency: string
    /** 기준일 'YYYY-MM-DD' */
    asOf: string
    price: number
    /** 60주 이동평균 — 두 기준선의 축 */
    smaLong: number
    /** 매수 기준선 = 60주선 */
    buyLevel: number
    /** 매도 기준선 = 60주선 × (1 + sellDisparity) */
    sellLevel: number
    /** 매도선을 만드는 이격도 (0.084 = 60주선 +8.4%) */
    sellDisparity: number
    /** 현재 이격도 = (현재가 / 60주선) - 1 */
    disparity: number
    zone: PriceZone
    /**
     * 최근 1년 중 매수 구간(60주선 이하)이었던 주 수 (최대 52).
     * 기다리는 전략이라 "얼마나 드물게 열리는 문인지"를 알고 있어야 한다.
     */
    buyWeeksLastYear: number
    /** 매수 기준선까지 남은 거리 (비율). 이미 밑이면 음수 */
    gapToBuy: number
    /** 매도 기준선까지 남은 거리 (비율). 이미 위면 음수 */
    gapToSell: number
    /** 최근 1년 종가 범위(저점~고점)에서의 위치 (0~1) — 절대 가격 감각용 */
    yearRatio: number
}