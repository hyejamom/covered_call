// ══════════ 시뮬레이션 도메인 타입 ══════════
// tsconfig erasableSyntaxOnly 설정으로 enum 문법을 쓸 수 없어 const 객체 + 동일명 타입으로 대체한다.

/** 투입 이벤트 타입 */
export const EventType = {
    /** ① 초기 일시금 — 시작 시점에 한 번 투입 */
    INITIAL: 'INITIAL',
    /** ② 월 정기 매수 — 시작~종료(또는 계속) 매월 반복 투입 */
    RECURRING: 'RECURRING',
    /** ③ 단발성 추가 매수 — 특정 달에 한 번만 추가 투입 */
    ONE_TIME: 'ONE_TIME',
    /** ④ 월 정기 매수 금액 변경 — 특정 시점부터 정기 금액 교체 */
    CHANGE: 'CHANGE',
    /** ⑤ 정기매수 중단/감액 — 해당 기간 동안 월 정기 매수액에서 지정 금액만큼 빼고 투입 */
    RECURRING_STOP: 'RECURRING_STOP',
    /** ⑥ 배당 재투자 구간 — 해당 기간의 배당을 재투자할지 인출할지 지정 */
    REINVEST: 'REINVEST',
} as const

export type EventType = (typeof EventType)[keyof typeof EventType]

/** 이벤트 타입별 화면 표기명 */
export const EVENT_TYPE_LABEL: Record<EventType, string> = {
    [EventType.INITIAL]: '초기 일시금',
    [EventType.RECURRING]: '월 정기 매수',
    [EventType.ONE_TIME]: '단발성 추가',
    [EventType.CHANGE]: '정기금액 변경',
    [EventType.RECURRING_STOP]: '정기매수 중단',
    [EventType.REINVEST]: '재투자 구간',
}

/** 투입 이벤트 1건 */
export interface InvestEvent {
    /** 리스트 조작용 고유 키 */
    id: string
    type: EventType
    /** 시작(또는 해당) 연월 — 'YYYY-MM' 형식. 문자열 사전순 비교로 시점 대소를 판정한다. */
    startYm: string
    /** 종료 연월 — RECURRING / RECURRING_STOP / REINVEST 전용. 빈 문자열이면 "계속" */
    endYm: string
    /** 투입 금액 (원) — RECURRING_STOP 에서는 "빼는 금액(감액분)"을 뜻한다 */
    amount: number
    /** INITIAL 전용 — 일시금 안에 그 달 정기 매수분이 이미 포함되어 있는지 (중복 가산 방지) */
    includesRecurring: boolean
    /** REINVEST 전용 — 이 기간의 배당을 재투자할지(true) 인출할지(false) */
    reinvest: boolean
}

/** 시뮬레이션 고정 상수 — 전 기간 동안 변동 없이 사용 */
export interface SimulationConstants {
    /** JEPQ 주가 (USD) */
    sharePriceUsd: number
    /** 월 배당금 — 주당 (USD) */
    monthlyDividendUsd: number
    /** 환율 (원/USD) */
    exchangeRate: number
    /** 배당 과세 기준 금액 (원) — 연간 배당 합산이 이 값을 초과하면 과세 */
    taxThresholdKrw: number
    /** 원천징수 세율 (%) */
    taxRatePercent: number
}

/** 월별 시뮬레이션 결과 1건 */
export interface MonthlyResult {
    /** 'YYYY-MM' */
    ym: string
    year: number
    /** 1~12 */
    month: number
    /** 시뮬레이션 개시 이전 달이면 false — 표에 '-'로 표기 */
    active: boolean
    /** 이번 달 이벤트 투입금 (원) */
    contribution: number
    /** 이번 달 배당금 세전 (원) */
    dividendGross: number
    /** 이번 달 원천징수 세액 (원) */
    dividendTax: number
    /** 이번 달 배당금 세후 (원) — 재투자 구간이면 즉시 재투자, 아니면 인출 */
    dividendNet: number
    /** 이번 달 배당을 재투자했는지 — false면 인출되어 보유주/잔액에 반영되지 않는다 */
    reinvested: boolean
    /** 이번 달 주식 매수에 사용한 금액 (원) */
    purchaseAmount: number
    /** 누적 매수금액 (원) */
    cumulativePurchase: number
    /** 월말 보유 주식 수 */
    shares: number
    /** 월말 잔액(예수금, 원) — 다음 달로 이월 */
    balance: number
    /** 이번 달 배당에 세금이 적용되었는지 */
    taxed: boolean
}

/** 연도별 요약 — 과세 여부 판정 근거 표기용 */
export interface YearlySummary {
    year: number
    /** 그 해 세전 배당 합계 (원) */
    dividendGross: number
    /** 그 해 원천징수 세액 합계 (원) */
    dividendTax: number
    /** 그 해 과세 적용 여부 */
    taxed: boolean
}

/** 시뮬레이션 전체 결과 — 시트(탭) 1장 분 */
export interface SimulationResult {
    /** 'YYYY-MM' → 월별 결과 */
    byYm: Record<string, MonthlyResult>
    /** 연도 → 연간 요약 */
    byYear: Record<number, YearlySummary>
    /** 과세가 처음 적용되는 연도 (없으면 null) */
    firstTaxedYear: number | null
}

/** 워크북(엑셀 파일 1개) 시뮬레이션 입력 — 시트 1장 분 */
export interface WorkbookTabInput {
    id: string
    events: InvestEvent[]
}

/** 워크북 연간 요약 — 과세 판정 단위는 시트가 아니라 워크북 전체 합산이다 */
export interface WorkbookYearSummary {
    year: number
    /** 워크북 내 모든 시트의 그 해 세전 배당 합계 (원) */
    dividendGross: number
    /** 모든 시트의 그 해 원천징수 세액 합계 (원) */
    dividendTax: number
    /** 그 해 과세 적용 여부 — 합산액이 과세 기준을 초과하면 모든 시트에 동일 적용 */
    taxed: boolean
}

/** 워크북 전체 시뮬레이션 결과 */
export interface WorkbookSimulationResult {
    /** 탭 id → 그 시트의 시뮬레이션 결과 */
    byTabId: Record<string, SimulationResult>
    /** 연도 → 워크북 합산 요약 */
    byYear: Record<number, WorkbookYearSummary>
    /** 과세가 처음 적용되는 연도 (없으면 null) */
    firstTaxedYear: number | null
}