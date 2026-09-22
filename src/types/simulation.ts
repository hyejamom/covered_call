import type { AccountType, AssetCurrency } from '../constants/assetConstants'

// ══════════ 시뮬레이션 도메인 타입 ══════════
// tsconfig erasableSyntaxOnly 설정으로 enum 문법을 쓸 수 없어 const 객체 + 동일명 타입으로 대체한다.
// 계산기는 종목 2개(TIGER 나스닥100커버드콜 · JEPQ)를 같은 엔진으로 굴린다. 종목마다 달라지는 값은
// 전부 SimulationConstants 로 흘러 들어오므로, 아래 타입에는 특정 종목 이름이 박히지 않는다.

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
    /**
     * ⑦ 월 정기매수(성장자산) — 주력 종목 대신 QQQ 같은 성장형 ETF 를 소수점 매수한다고 가정하는 구간.
     * 수익은 "주가상승 + 배당재투자"의 총수익으로 계산한다 — 배당은 원천징수 후 전액 재매수되어 평가액에 녹는다.
     * 현금으로 빼 쓰는 배당이 아니므로 이 구간에서는 주력 종목 보유주가 늘지 않는다.
     * 구간이 끝나는 달(endYm)에 평가액(원금 + 평가수익) 전액을 주력 종목 매수 자금으로 이관한다.
     * 확정수익 자산은 시트당 통 하나이므로, 대상을 확정수익으로 지정한 초기 일시금·단발성 추가도 같은 통에 합류한다.
     */
    RECURRING_GROWTH: 'RECURRING_GROWTH',
    /**
     * ⑧ 월 정액 인출 — 해당 기간 매달 계좌에서 지정 금액을 꺼내 쓴다(생활비).
     *
     * 배당만으로 부족하면 예수금을 헐고, 그래도 모자라면 보유 주식을 팔아서 채운다.
     * 즉 이 이벤트가 있어야 "원금까지 헐어 쓰다가 계좌가 언제 바닥나는가"를 계산할 수 있다.
     * 재원을 다 털어도 목표액을 못 채우는 첫 달이 곧 계좌 고갈 시점이다.
     */
    WITHDRAW: 'WITHDRAW',
} as const

export type EventType = (typeof EventType)[keyof typeof EventType]

/**
 * 투입 대상 자산 — 초기 일시금 / 단발성 추가가 "어느 통에 들어가는지" 지정한다.
 * 정기 매수는 타입 자체가 통을 결정하므로(RECURRING=주력 종목, RECURRING_GROWTH=확정수익) 이 값을 쓰지 않는다.
 */
export const InvestTarget = {
    /**
     * ① 주력 종목 매수 자금으로 투입 — 그 달 바로 주식을 산다.
     * 실제 종목은 계산기에서 고른 탭(TIGER 나스닥100커버드콜 / JEPQ)에 따라 달라지므로 값 이름을 종목에 묶지 않는다.
     */
    MAIN: 'MAIN',
    /** ② 확정수익 자산(QQQ 등)으로 투입 — 배당 없이 연 복리로만 불어나고, 이관 시점에 주력 종목으로 넘어간다 */
    GROWTH: 'GROWTH',
} as const

export type InvestTarget = (typeof InvestTarget)[keyof typeof InvestTarget]

/**
 * 투입 대상별 화면 표기명
 * — 주력 종목 이름은 선택한 탭마다 달라지므로 호출측이 종목명을 넘겨 조립한다.
 * @param target 투입 대상 @param assetLabel 지금 보고 있는 종목의 표기명
 */
export function toInvestTargetLabel(target: InvestTarget, assetLabel: string): string {
    return target === InvestTarget.GROWTH ? '확정수익(QQQ)' : assetLabel
}

/** 이벤트 타입별 화면 표기명 */
export const EVENT_TYPE_LABEL: Record<EventType, string> = {
    [EventType.INITIAL]: '초기 일시금',
    [EventType.RECURRING]: '월 정기 매수',
    [EventType.ONE_TIME]: '단발성 추가',
    [EventType.CHANGE]: '정기금액 변경',
    [EventType.RECURRING_STOP]: '정기매수 중단',
    [EventType.REINVEST]: '재투자 구간',
    [EventType.RECURRING_GROWTH]: '월 정기매수(확정수익)',
    [EventType.WITHDRAW]: '월 정액 인출(생활비)',
}

/** 투입 이벤트 1건 */
export interface InvestEvent {
    /** 리스트 조작용 고유 키 */
    id: string
    type: EventType
    /** 시작(또는 해당) 연월 — 'YYYY-MM' 형식. 문자열 사전순 비교로 시점 대소를 판정한다. */
    startYm: string
    /**
     * 종료 연월 — RECURRING / RECURRING_STOP / REINVEST / RECURRING_GROWTH 구간의 끝.
     * 확정수익 자산으로 넣은 초기 일시금·단발성 추가에서는 "주력 종목 이관 연월"을 뜻한다.
     * 빈 문자열이면 "계속"(= 이관 없음)
     */
    endYm: string
    /** 투입 금액 (원) — RECURRING_STOP 에서는 "빼는 금액(감액분)"을 뜻한다 */
    amount: number
    /**
     * 투입 대상 — INITIAL / ONE_TIME 전용. 나머지 타입은 항상 MAIN(주력 종목)으로 둔다.
     * GROWTH 면 그 돈이 주력 종목이 아니라 확정수익 자산 통으로 들어가, 정기 적립분과 한 덩어리로 함께 불어난다.
     */
    target: InvestTarget
    /** INITIAL 전용 — 일시금 안에 그 달 정기 매수분이 이미 포함되어 있는지 (중복 가산 방지) */
    includesRecurring: boolean
    /** REINVEST 전용 — 이 기간의 배당을 재투자할지(true) 인출할지(false) */
    reinvest: boolean
    /**
     * 확정수익 자산 전용 — 연 주가상승률 (%). 배당을 뺀 "가격만" 오르는 몫이다.
     * QQQ 처럼 배당이 붙는 자산은 아래 dividendYieldPercent 와 합쳐 총수익이 된다.
     */
    priceGrowthPercent: number
    /**
     * 확정수익 자산 전용 — 연 배당수익률 (%, 세전).
     * 받은 배당은 미국 원천징수 15% 를 떼고 남은 금액으로 같은 자산을 다시 사들인다(배당 재투자).
     */
    dividendYieldPercent: number
}

/** 시뮬레이션 고정 상수 — 전 기간 동안 변동 없이 사용 */
export interface SimulationConstants {
    /** 시세 통화 — KRW 종목은 exchangeRate 가 1 로 들어와 환산 없이 그대로 원화가 된다 */
    currency: AssetCurrency
    /** 계좌 유형 — ISA 면 배당 원천징수·종합과세·건보료가 모두 빠진다 (계좌 안에서 과세되지 않는다) */
    accountType: AccountType
    /** 1주 가격 (해당 종목 통화 단위) */
    sharePriceNative: number
    /** 월 배당금 — 주당 (해당 종목 통화 단위) */
    monthlyDividendNative: number
    /** 환율 (원/외화) — 원화 종목은 1 */
    exchangeRate: number
    /**
     * 연 주가 변동률 (%) — 대상 기간 시작 시점의 주가를 1로 보고 매년 이만큼 움직인다.
     * 주가가 깎이면 주당 배당도 같은 비율로 줄어든다 (분배금이 NAV 에서 나오므로 배당률 자체는 유지된다).
     */
    sharePriceDriftPercent: number
    /**
     * 배당 원천징수 세율 (%) — 배당 지급 시점에 금액과 무관하게 항상 차감된다.
     * 미국 상장 종목은 15%, ISA 계좌 안의 국내 ETF 는 떼는 세금이 없어 0 이 들어온다.
     */
    withholdingRatePercent: number
    /** 금융소득종합과세 기준 금액 (원) — 연간 "세전" 배당 합산이 이 값 이상이면 이듬해 5월 종소세 신고 대상 */
    comprehensiveThresholdKrw: number
    /** 종합소득세 추정 세율 (%) — 대상 연도의 연 세전 배당 전액에 곱한다 (보수적 단순 추정) */
    comprehensiveRatePercent: number
    /** 건강보험료율 (%) — 지역가입자 소득 정률 */
    healthRatePercent: number
    /**
     * 건보료 부과 기준 금액 (원) — 연 세전 배당이 이 값 이상인 해에만 부과되며,
     * 보험료는 전액이 아니라 이 금액을 뺀 초과분에만 붙는다. 종합과세 기준과 같은 값이다.
     */
    healthIncomeThresholdKrw: number
    /** 연 물가상승률 (%) — 미래 배당금을 기준연도 화폐가치로 되돌릴 때 쓰는 할인율 */
    inflationRatePercent: number
    /** 실질가치 환산 기준연도 — 이 해 1월의 화폐가치를 1로 본다 */
    inflationBaseYear: number
    /** ISA 연간 납입한도 (원) */
    isaAnnualLimitKrw: number
    /** ISA 총 납입한도 (원) */
    isaTotalLimitKrw: number
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
    /** 이번 달 미국 원천징수 세액 (원) — 세전 배당 × 15%. 금액과 무관하게 매달 떼인다 */
    dividendTax: number
    /** 이번 달 배당금 세후 (원) — 재투자 구간이면 즉시 재투자, 아니면 인출 */
    dividendNet: number
    /**
     * 이번 달 세후 배당금을 기준연도(inflationBaseYear) 화폐가치로 환산한 금액 (원).
     * 명목 금액에 물가 할인계수를 곱한 값이며, 시뮬레이션 계산 자체에는 관여하지 않는 표시 전용 지표다.
     */
    dividendReal: number
    /** 이번 달 배당을 재투자했는지 — false면 매수에 쓰이지 않아 보유주/잔액에 반영되지 않는다 */
    reinvested: boolean
    /**
     * 월말까지 재투자하지 않고 쌓아 둔 배당 누계 (원) — 계좌 유형과 무관하게 같은 뜻이다.
     * 아직 쓰지 않은 배당 현금이며, 월 정액 인출이 걸리면 여기서 먼저 빠져나간다.
     * 이 돈은 주식을 사지 않아 누적 매수금액에 잡히지 않으므로 따로 세워 둔다.
     */
    dividendCashBalance: number
    /**
     * 이 달까지 계좌에 넣은 돈의 누계 (원) — 주력 종목 투입금 + 확정수익 자산 투입금.
     * 재투자된 배당은 내 주머니에서 나온 돈이 아니므로 여기에 들어가지 않는다.
     */
    cumulativeContribution: number
    /**
     * 이 달까지 재투자하지 않고 꺼낸 배당의 누계 (원).
     * dividendCashBalance 와 달리 쓰고 나서도 줄지 않는다 — "지금까지 돌려받은 총액"이기 때문이다.
     */
    cumulativeDividendTaken: number
    /**
     * 누적 순투입금 (원) = cumulativeContribution − cumulativeDividendTaken.
     * "내 돈이 실제로 얼마나 잠겨 있나"를 답하는 값이라 그리드에 행으로 세운다.
     * 누적 매수금액은 재투자된 배당까지 섞여 있어 이 질문에 답하지 못한다.
     */
    netContribution: number
    /** 이번 달 꺼내 쓰려고 한 금액 (원) — 월 정액 인출 이벤트의 목표액 */
    withdrawRequested: number
    /** 이번 달 실제로 꺼낸 금액 (원) — 재원이 모자라면 목표액보다 적다 */
    withdrawPaid: number
    /** 이번 달 인출을 채우려고 판 주식 수 — 원금을 헐기 시작한 시점이 여기서 드러난다 */
    sharesSold: number
    /**
     * 이번 달 목표액을 다 못 꺼냈는지 — 계좌가 바닥났다는 뜻.
     * 처음 true 가 되는 달이 곧 '더 이상 뽑을 수 없는' 시점이다.
     */
    depleted: boolean
    /** 이번 달 주식 매수에 사용한 금액 (원) */
    purchaseAmount: number
    /** 누적 매수금액 (원) */
    cumulativePurchase: number
    /** 월말 보유 주식 수 */
    shares: number
    /** 월말 잔액(예수금, 원) — 다음 달로 이월 */
    balance: number
    /** 이번 달 주력 종목 1주 매수단가 (원) — 주가 변동률이 걸려 있으면 달마다 달라진다 */
    sharePriceKrw: number
    /** 월말 주력 종목 평가액 (원) = 보유주 × 그 시점 주가 + 잔액 */
    valuation: number
    /**
     * 월말 계좌 잔액 (원) = 평가액 + 아직 안 쓴 배당현금.
     * 인출 시나리오에서 "지금 계좌에 얼마 남았나"를 뜻하며, 이 값이 0 이 되는 달이 곧 고갈 시점이다.
     * (누적 매수금액은 주식을 팔아도 줄지 않아 잔액 판단에 쓸 수 없다)
     */
    accountRemaining: number
    /**
     * 이 달이 속한 해가 금융소득종합과세(5월 종소세 신고) 대상인지.
     * 매달 떼이는 미국 원천징수와는 별개다 — 원천징수는 항상 적용되고, 이 값은 "그 해에 종소세가 더 붙는가"를 뜻한다.
     */
    taxed: boolean
    /** 이번 달 확정수익 자산 매수액 (원) — 주력 종목 매수에는 쓰이지 않는다 */
    growthContribution: number
    /**
     * 이번 달 반영된 평가수익 합계 (원) = 주가수익 + 세후 배당(재투자분).
     * 매달 붙는 이자가 아니라 "적립 시작 후 만 1년이 될 때마다" 평가액 전체에 한 번 붙는 값이라
     * 12개월에 한 번만 0 이 아니다.
     */
    growthGain: number
    /** 이번 달 성장자산 주가수익 (원) — 평가액 × 연 주가상승률 */
    growthPriceGain: number
    /** 이번 달 성장자산 배당 세전 (원) — 평가액 × 연 배당수익률 */
    growthDividendGross: number
    /** 이번 달 성장자산 배당의 미국 원천징수 세액 (원) */
    growthDividendTax: number
    /** 이번 달 성장자산 배당 세후 (원) — 전액 같은 자산에 재투자되어 평가액에 더해진다 */
    growthDividendNet: number
    /** 월말까지 확정수익 자산에 넣은 누적 원금 (원) — 평단가의 분자. 주력 종목으로 이관하면 0 으로 초기화된다 */
    growthPrincipal: number
    /** 월말 확정수익 자산 평가액 (원) = 누적 원금 + 누적 평가수익 */
    growthBalance: number
    /** 이번 달 확정수익 자산 → 주력 종목으로 이관한 금액 (원). 이관이 없으면 0 */
    growthTransfer: number
}

/**
 * 이듬해 5월 종합소득세 신고 추정 결과 — 한 해분
 * 1년에 한 번, 5월에 몰아서 내는 돈이라 연 금액 하나로만 잡는다.
 */
export interface ComprehensiveTaxEstimate {
    /** 종합과세 대상 연도인지 — 세전 금융소득이 기준(2,000만원) 이상인지 */
    applies: boolean
    /** 판정 대상이 된 그 해 세전 금융소득 (원) */
    financialIncome: number
    /** 추정에 쓴 세율 (%) — 누진 구간을 따지지 않고 전액에 곱하는 보수적 단일 세율 */
    ratePercent: number
    /** 이듬해 5월에 납부할 추정액 (원) = 세전 금융소득 × 세율 */
    totalDue: number
}

/**
 * 건강보험료 추정 결과 — 한 해 소득 기준
 * 세금이 아니라 보험료이고, 이 소득으로 정해진 금액을 "이듬해" 1~12월에 매달 나눠 낸다.
 */
export interface HealthInsuranceEstimate {
    /** 실제로 보험료가 부과되는지 — 기준금액 초과분이 있어 월 보험료가 붙는지 */
    applies: boolean
    /** 판정 대상이 된 그 해 세전 금융소득 (원) */
    financialIncome: number
    /** 건보료 부과 대상 소득 (원) — 금융소득에서 기준금액(2,000만원)을 뺀 초과분 */
    chargeableIncome: number
    /** 부과 대상 소득의 월 환산액 (원) = 초과분 ÷ 12 */
    monthlyChargeableIncome: number
    /** 월 건강보험료 (원) = 월 환산액 × 요율 */
    monthlyPremium: number
    /** 연 납부 합계 (원) = 월 보험료 × 12 */
    yearlyPremium: number
}

/**
 * ISA 계좌 납입한도 점검 결과 — 시트(계좌) 1개분
 *
 * 이 계좌의 배당은 지급 시점에 그대로 받는 현금으로 본다. 계좌 안에서 세금을 떼지 않으므로
 * 세전·세후를 나눌 것이 없고, 만기에 따로 정산할 것도 없다 — 그래서 과세 관련 항목이 하나도 없다.
 * 남는 것은 "이 계획을 실제로 넣을 수 있는가"뿐이라, 납입한도 초과 여부만 담는다.
 */
export interface IsaLimitStatus {
    /** ISA 계좌인지 — 일반 계좌면 false 이고 나머지 값은 전부 비어 있다 */
    applies: boolean
    /** 총 납입액 (원) — 주력 종목 투입금 + 확정수익 자산 투입금 */
    contributionTotal: number
    /** 연 납입한도를 넘긴 연도 목록 — 실제로는 그만큼 넣을 수 없어 계획 자체가 성립하지 않는다 */
    overAnnualLimitYears: number[]
    /** 총 납입한도 초과액 (원) — 넘지 않았으면 0 */
    overTotalLimit: number
}

/** 연도별 요약 — 과세 여부 판정 근거 표기용 */
export interface YearlySummary {
    year: number
    /** 그 해 주력 종목 세전 배당 합계 (원) */
    dividendGross: number
    /** 그 해 주력 종목 배당의 원천징수 세액 합계 (원) */
    dividendTax: number
    /** 그 해 성장자산(QQQ 등) 세전 배당 합계 (원) — 재투자되지만 세법상으로는 똑같은 배당소득이다 */
    growthDividendGross: number
    /** 그 해 성장자산 배당의 미국 원천징수 세액 합계 (원) */
    growthDividendTax: number
    /** 그 해 세전 금융소득 합계 (원) = 주력 종목 배당 + 성장자산 배당. 종합과세·건보료 판정의 기준값 */
    financialIncome: number
    /** 그 해가 금융소득종합과세 대상인지 */
    taxed: boolean
    /** 그 해 계좌 납입액 (원) = 주력 종목 투입금 + 확정수익 자산 투입금. ISA 연 납입한도 판정에 쓴다 */
    contribution: number
    /** 그 해 말까지의 누적 납입액 (원) — ISA 총 납입한도 판정에 쓴다 */
    contributionCumulative: number
}

/** 시뮬레이션 전체 결과 — 시트(탭) 1장 분 */
export interface SimulationResult {
    /** 'YYYY-MM' → 월별 결과 */
    byYm: Record<string, MonthlyResult>
    /** 연도 → 연간 요약 */
    byYear: Record<number, YearlySummary>
    /** 종합과세가 처음 적용되는 연도 (없으면 null) */
    firstTaxedYear: number | null
    /**
     * ISA 납입한도 점검 결과 — 계좌는 사람(시트)마다 하나이므로 워크북이 아니라 시트 단위로 잡는다.
     * 일반 계좌 종목에서는 applies=false 로 채워진 빈 값이 들어온다.
     */
    isaLimits: IsaLimitStatus
    /**
     * 계좌 고갈 연월 ('YYYY-MM') — 인출 목표액을 처음으로 다 채우지 못한 달.
     * 인출 계획이 없거나 대상 기간 안에 바닥나지 않으면 null.
     */
    depletedYm: string | null
    /**
     * 원금을 헐기 시작한 연월 ('YYYY-MM') — 인출을 채우려고 처음으로 주식을 판 달.
     * 배당만으로 생활비가 감당되지 않기 시작한 시점이라 고갈보다 먼저 온다.
     */
    firstSellYm: string | null
}

/** 워크북(엑셀 파일 1개) 시뮬레이션 입력 — 시트 1장 분 */
export interface WorkbookTabInput {
    id: string
    events: InvestEvent[]
}

/** 워크북 연간 요약 — 종합과세 판정 단위는 시트가 아니라 워크북 전체 합산이다 */
export interface WorkbookYearSummary {
    year: number
    /** 워크북 내 모든 시트의 그 해 주력 종목 세전 배당 합계 (원) */
    dividendGross: number
    /** 모든 시트의 그 해 주력 종목 배당 원천징수 세액 합계 (원) */
    dividendTax: number
    /** 모든 시트의 그 해 성장자산 세전 배당 합계 (원) */
    growthDividendGross: number
    /** 모든 시트의 그 해 성장자산 배당 원천징수 세액 합계 (원) */
    growthDividendTax: number
    /** 그 해 세전 금융소득 합계 (원) — 종합과세·건보료 판정의 기준값 */
    financialIncome: number
    /** 그 해가 금융소득종합과세 대상인지 — 합산액이 기준을 초과하면 모든 시트에 동일 적용 */
    taxed: boolean
    /** 이듬해 5월 종소세 신고 추정 — 워크북 합산 기준으로 한 번만 계산한다 */
    comprehensiveTax: ComprehensiveTaxEstimate
    /** 그 해 소득 기준 건강보험료 추정 — 마찬가지로 워크북 합산 기준. 실제 납부는 이듬해 1~12월에 매달 나눠 낸다 */
    healthInsurance: HealthInsuranceEstimate
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