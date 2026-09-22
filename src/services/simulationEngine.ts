import { AccountType } from '../constants/assetConstants'
import {
    EventType,
    type InvestEvent,
    InvestTarget,
    type MonthlyResult,
    type SimulationConstants,
    type SimulationResult,
    type WorkbookSimulationResult,
    type WorkbookTabInput,
    type WorkbookYearSummary,
} from '../types/simulation'
import { estimateHealthInsurance } from './healthInsuranceEngine'
import { estimateComprehensiveTax } from './incomeTaxEngine'
import { NO_ISA_LIMIT_STATUS, evaluateIsaLimits } from './isaLimitEngine'

// ══════════ 계산 규칙 요약 ══════════
//
// 이 엔진은 종목 2개(ISA·TIGER 나스닥100커버드콜 / 일반계좌·JEPQ)를 같은 로직으로 굴린다.
// 종목마다 달라지는 값은 전부 SimulationConstants 로 들어오므로, 아래 규칙에 종목 이름을 박지 않는다.
// 갈리는 것은 딱 하나 — 계좌 유형(accountType)이다.
//   · 일반 계좌 : 배당 지급 시점 원천징수 15% + 연 합산 종합과세 + 건보료
//   · ISA 계좌  : 배당에 붙는 세금이 없다(원천징수율 0) + 종합과세·건보료 판정 제외. 남는 제약은 납입한도뿐이다.
//
// [주력 종목 주가] 대상 기간 시작 시점의 주가를 1로 보고 연 주가 변동률만큼 매달 조금씩 움직인다.
//                   주가가 깎이면 주당 배당도 같은 비율로 줄어든다 — 분배금은 NAV 에서 나오므로 배당률 자체는 유지된다.
//                   커버드콜은 기초자산 상승분을 옵션으로 팔아 분배금을 만드는 구조라, 주가를 고정으로 두면
//                   "배당은 다 받고 원금도 안 줄어드는" 과하게 유리한 가정이 된다. 그래서 이 값을 열어 둔다.
// [지급/재투자 시점] 배당은 "전월 말 보유 주식 수" 기준으로 그 달에 지급되며, 같은 달에 즉시 재투자한다.
// [매수 순서]       예수금(이월 잔액) + 이번 달 투입금 + 이번 달 세후 배당 → 전액으로 주식 매수
// [정기매수 중단]   중단 구간이 걸린 달은 그 달 정기 매수액에서 지정 금액만큼 빼고 투입한다.
//                   깎을 수 있는 최대치는 그 달의 정기 매수 총액(예: 20만+40만 → 60만)이며, 0 미만으로는 내려가지 않는다.
// [매수 단위]       1주 단위로만 매수(정수 매수). 1주 값에 못 미치는 금액은 잔액으로 다음 달 이월되므로
//                   잔액은 구조적으로 항상 "1주 가격 미만"을 유지한다 (돈이 차는 즉시 매수).
// [원천징수]        일반 계좌의 미국 배당은 지급 시점에 미국이 15% 를 떼고 나머지만 입금한다 — 금액·연도와 무관하게 항상이다.
//                   따라서 재투자에 쓰는 돈은 언제나 "세후 85%" 이며, 세전 금액이 굴러가는 달은 없다.
//                   ISA 계좌는 이 단계가 통째로 없다(원천징수율 0). 국내 ETF 라 미국이 뗄 것도 없고 계좌 안에서 과세되지도 않아
//                   지급액 전액이 그대로 손에 들어오고, 재투자 구간이면 그 전액이 그대로 재매수에 쓰인다.
// [종합과세]        일반 계좌 전용. 판정 단위는 워크북(엑셀 파일) 전체이고, 그 안 모든 시트의 "연간 세전 배당 합계"가
//                   2,000만원을 넘는 해는 이듬해 5월 종합소득세 신고 대상이 된다.
//                   이때 낼 돈은 위 원천징수와 별개로 추정만 하고 현금흐름에서 빼지 않는다 —
//                   실제 납부는 이듬해 5월이고 재원도 계좌 밖일 수 있어, 표에는 "그 해 옆에 붙는 예상 고지서"로만 둔다.
//                   ISA 계좌의 소득은 애초에 이 합산에 들어가지 않으므로 판정 자체를 건너뛴다.
// [건강보험료]      마찬가지로 일반 계좌 전용. 금융소득이 커지면 피부양자 자격을 잃고 지역가입자 보험료가 붙는다.
//                   세금이 아니라 매수 계산에는 넣지 않지만, 종소세보다 먼저 체감되는 고정비라 연도 요약에 같이 붙여 둔다.
// [ISA 납입한도]   ISA 계좌 전용이자 ISA 에 남는 유일한 제약이다. 연 2,000만원 · 총 1억원을 넘는 계획은
//                   세금이 달라지는 것이 아니라 애초에 그만큼 넣을 수 없어 실행 자체가 불가능하다.
//                   계좌는 사람마다 하나이므로 워크북 합산이 아니라 시트 단위로 판정한다.
// [성장자산 구간]   '월 정기매수(성장자산)'은 주력 종목을 사지 않고 QQQ 같은 성장형 ETF 를 소수점 매수한다고 가정한다.
//                   수익은 두 갈래로 들어온다 — ① 주가상승분과 ② 배당(원천징수 후 전액 재투자).
//                   즉 평가액은 "주가수익 + 세후 배당"만큼 늘고, 이 둘을 합친 것이 총수익이다.
//                   배당은 재투자되어 현금으로 빠지지 않지만 세법상으로는 똑같은 배당소득이라
//                   일반 계좌에서는 그 해 금융소득에 합산되어 종합과세·건보료 판정에 함께 들어간다.
//                   값은 연 단위 복리로만 움직인다 — 적립 시작 후 만 1년이 될 때마다 평가액 전체에 한 번 붙는다.
//                   그 해에 넣은 돈도 같은 해 수익을 온전히 받는다. 연초 가격으로 산 주식이 연말에 함께 오르는 것과 같아서다.
//                   즉 5년 적립이면 평가액 = Σ(그 해 납입액 × (1+N%)^(남은 연차)) 가 된다.
//                   구간 종료월(endYm)이 되면 평가액 전액이 그 달 주력 종목 매수 자금으로 이관된다.
// [투입 대상]      초기 일시금 / 단발성 추가는 대상(target)을 골라 넣는다 — MAIN 이면 그 달 바로 주력 종목을 사고,
//                   확정수익이면 위 확정수익 통으로 들어가 정기 적립분과 한 덩어리로 함께 복리를 받는다.
//                   확정수익 통은 시트당 하나뿐이라 "QQQ 로 굴리다 통째로 이관" 과 "QQQ 만 계속 적립" 이 모두 표현된다.
// [이관 시점]      확정수익 통을 비우는 시점은 확정수익 쪽 이벤트(정기매수(확정수익) / 확정수익 대상 일시금·단발성) 중
//                   어느 하나의 종료 연월이 걸린 달이다. 전부 비워 두면 이관 없이 계속 적립만 한다.
// [절사]            배당금(원)·세액(원)·확정수익(원) 모두 원 단위 절사(Math.floor)

// ┣━━━━━━━━━━━━━━━━ 내부 유틸 ━━━━━━━━━━━━━━━━━┫

/** 'YYYY-MM' 문자열 생성 — 사전순 비교가 곧 시점 비교가 되도록 2자리 패딩 */
export function toYm(year: number, month: number): string {
    return `${year}-${String(month).padStart(2, '0')}`
}

/**
 * 두 연월 사이의 개월 수 (시작월 포함) — 'YYYY-MM' 형식 전제
 * 예) 2026-01 ~ 2030-12 → 60. 확정수익 구간이 만 N년으로 딱 떨어지는지 판정하는 데 쓴다.
 * @param startYm 시작 연월 @param endYm 종료 연월. 둘 중 하나라도 비었거나 역순이면 0
 */
export function countMonths(startYm: string, endYm: string): number {
    if (startYm === '' || endYm === '' || endYm < startYm) return 0

    const [startYear, startMonth] = startYm.split('-').map(Number)
    const [endYear, endMonth] = endYm.split('-').map(Number)
    return (endYear - startYear) * 12 + (endMonth - startMonth) + 1
}

/**
 * 실질가치 환산 계수 — 그 달의 1원이 기준연도 1월 기준으로 몇 원어치인지
 *
 * 1) 기준연도 1월부터 흐른 개월 수를 세고
 * 2) 연 물가상승률을 월 단위로 나눠 복리 할인한다.
 *    연 단위로만 끊으면 12월 → 이듬해 1월에서 값이 계단식으로 꺾여 오해를 부르므로 매달 조금씩 줄어들게 한다.
 * 3) 기준연도 이전 달은 지수가 음수가 되어 계수가 1보다 커진다 (그때 돈이 더 값어치 있었다는 뜻이라 의도한 동작).
 * @param constants 물가상승률 · 기준연도를 담은 고정 상수
 */
export function toRealValueFactor(year: number, month: number, constants: SimulationConstants): number {
    const rate = constants.inflationRatePercent / 100

    // 물가상승률이 -100% 이하로 잘못 들어오면 지수 계산이 깨지므로 환산하지 않는다 (명목 = 실질)
    if (rate <= -1) return 1

    const elapsedMonths = (year - constants.inflationBaseYear) * 12 + (month - 1)
    return 1 / Math.pow(1 + rate, elapsedMonths / 12)
}

/**
 * 그 달의 주력 종목 주가 배율 — 대상 기간 시작 연도 1월을 1로 본다
 *
 * 1) 기준 시점부터 흐른 개월 수를 세고
 * 2) 연 변동률을 월 단위로 나눠 복리로 적용한다 (연 단위로 끊으면 12월 → 1월에서 값이 계단식으로 튄다)
 * 3) 주당 배당에도 같은 배율을 곱해 배당률을 유지한다
 * @param baseYear 배율 1 의 기준이 되는 대상 기간 시작 연도
 */
export function toPriceFactor(year: number, month: number, baseYear: number, constants: SimulationConstants): number {
    const drift = constants.sharePriceDriftPercent / 100

    // 변동률이 -100% 이하로 잘못 들어오면 주가가 0 이하로 내려가 계산이 깨지므로 고정으로 되돌린다
    if (drift <= -1) return 1

    const elapsedMonths = (year - baseYear) * 12 + (month - 1)
    return Math.pow(1 + drift, elapsedMonths / 12)
}

/** 가용 현금으로 살 수 있는 주식 수 — 1주 단위 내림 (부동소수 오차로 1주 손실되는 것 방지) */
function toBuyableShares(cash: number, sharePriceKrw: number): number {
    if (sharePriceKrw <= 0) return 0
    return Math.floor(cash / sharePriceKrw + 1e-9)
}

/** 이벤트가 해당 연월을 포함하는 구간인지 (종료 연월이 비어 있으면 "계속") */
function coversYm(event: InvestEvent, ym: string): boolean {
    return event.startYm !== ''
        && event.startYm <= ym
        && (event.endYm === '' || ym <= event.endYm)
}

/** 일회성 투입(초기 일시금 / 단발성 추가)인지 — 이 두 타입만 투입 대상을 고를 수 있다 */
function isOneShot(event: InvestEvent): boolean {
    return event.type === EventType.INITIAL || event.type === EventType.ONE_TIME
}

/**
 * 확정수익 통으로 들어가는 일회성 투입인지
 * — 예전 저장본에는 target 자체가 없으므로, GROWTH 로 명시된 경우에만 확정수익으로 본다 (기본은 주력 종목).
 */
function isGrowthOneShot(event: InvestEvent): boolean {
    return isOneShot(event) && event.target === InvestTarget.GROWTH
}

/**
 * 확정수익 통에 돈을 넣는 이벤트인지 — 정기매수(확정수익) + 확정수익 대상 일회성 투입
 * 성장률 판정 · 이관 시점 판정 · 확정수익 행 노출 여부를 모두 이 기준으로 통일한다.
 */
function isGrowthSource(event: InvestEvent): boolean {
    return event.type === EventType.RECURRING_GROWTH || isGrowthOneShot(event)
}

/**
 * 특정 달의 "감액 전" 월 정기 매수 금액
 * 1) 그 달에 걸린 정기 매수 이벤트가 하나도 없으면 0 (정기 매수 자체가 없는 달)
 * 2) 그 시점까지 발효된 금액변경 이벤트가 있으면 가장 최근 것이 전체 금액을 대체
 * 3) 없으면 활성 정기 매수 금액을 모두 합산
 */
export function calcRecurringBase(events: InvestEvent[], ym: string): number {
    // 1) 활성 정기 매수 판정
    const activeRecurring = events.filter((event) =>
        event.type === EventType.RECURRING && coversYm(event, ym),
    )
    if (activeRecurring.length === 0) return 0

    // 2) 발효된 금액변경 이벤트 중 가장 최근 것 채택
    const appliedChanges = events
        .filter((event) => event.type === EventType.CHANGE && event.startYm !== '' && event.startYm <= ym)
        .sort((a, b) => a.startYm.localeCompare(b.startYm))

    if (appliedChanges.length > 0) return appliedChanges[appliedChanges.length - 1].amount

    // 3) 변경 이벤트가 없으면 활성 정기 매수 합계
    return activeRecurring.reduce((sum, event) => sum + event.amount, 0)
}

/**
 * 특정 달에 유효한 정기매수 중단(감액) 금액 합계
 * @param excludeId 합계에서 제외할 이벤트 id — 편집 중인 행 자신을 빼고 남은 여유를 구할 때 사용
 */
export function calcRecurringStop(events: InvestEvent[], ym: string, excludeId?: string): number {
    return events
        .filter((event) =>
            event.type === EventType.RECURRING_STOP
            && event.id !== excludeId
            && coversYm(event, ym),
        )
        .reduce((sum, event) => sum + event.amount, 0)
}

/**
 * 특정 달에 "추가로" 중단할 수 있는 최대 금액
 * — 감액 전 정기 매수액에서 다른 중단 이벤트가 이미 깎아 놓은 몫을 뺀 잔여분.
 *   예) 정기 매수가 20만 + 40만이면 상한 60만, 이미 다른 행이 10만을 끊었으면 상한 50만.
 * @param excludeId 상한을 계산할 대상(편집 중인) 이벤트 id
 */
export function calcStopCapacity(events: InvestEvent[], ym: string, excludeId?: string): number {
    if (ym === '') return 0
    return Math.max(0, calcRecurringBase(events, ym) - calcRecurringStop(events, ym, excludeId))
}

/**
 * 특정 달의 총 투입금 계산
 * 1) 초기 일시금 / 단발성 추가는 해당 연월이 일치할 때 가산
 * 2) 정기 매수는 기간에 포함될 때만 가산하되, 금액변경 이벤트가 있으면 그 금액으로 대체
 * 3) 정기매수 중단 구간이 걸려 있으면 그만큼 깎는다 (0 아래로는 내려가지 않음)
 * 4) 초기 일시금이 "그 달 정기분 포함"이면 정기분을 중복 가산하지 않음
 */
function calcContribution(events: InvestEvent[], ym: string): number {
    let total = 0

    // 1) 일회성 투입 합산 — 대상이 확정수익인 건은 주력 종목이 아니라 확정수익 통으로 가므로 여기서 제외한다
    for (const event of events) {
        if (isOneShot(event) && !isGrowthOneShot(event) && event.startYm === ym) total += event.amount
    }

    // 2) 감액 전 월 정기 매수액 — 0이면 정기 매수가 없는 달이므로 이후 처리 불필요
    const recurringBase = calcRecurringBase(events, ym)
    if (recurringBase <= 0) return total

    // 3) 중단(감액) 반영 — 정기 매수액을 초과해 깎여 마이너스 투입이 되지 않도록 0에서 막는다
    const monthlyAmount = Math.max(0, recurringBase - calcRecurringStop(events, ym))

    // 4) 초기 일시금에 그 달 정기분이 포함되어 있으면 건너뜀
    const coveredByInitial = events.some((event) =>
        event.type === EventType.INITIAL && event.startYm === ym && event.includesRecurring,
    )

    if (!coveredByInitial) total += monthlyAmount

    return total
}

/**
 * 특정 달의 확정수익 자산 매수액 합계
 * — 이 돈은 주력 종목 매수에 쓰이지 않고 별도 자산으로 쌓인다. 정기금액 변경/중단 이벤트의 영향도 받지 않는다.
 * 1) 정기매수(확정수익) 구간이 그 달을 덮으면 월 납입액을 더하고
 * 2) 대상이 확정수익인 초기 일시금 · 단발성 추가는 해당 연월에 통째로 합류시킨다.
 */
export function calcGrowthContribution(events: InvestEvent[], ym: string): number {
    return events
        .filter((event) => (
            (event.type === EventType.RECURRING_GROWTH && coversYm(event, ym))
            || (isGrowthOneShot(event) && event.startYm === ym)
        ))
        .reduce((sum, event) => sum + event.amount, 0)
}

/** 성장자산에 적용할 연 수익률 한 쌍 — 주가상승분과 배당수익률 */
export interface GrowthRates {
    /** 연 주가상승률 (%) */
    priceGrowthPercent: number
    /** 연 배당수익률 (%, 세전) */
    dividendYieldPercent: number
}

/**
 * 특정 달에 적용할 성장자산 연 수익률
 * 1) 그 달을 덮는 성장자산 이벤트가 없으면 0 — 평가액이 남아 있어도 더 이상 오르지 않는다
 * 2) 구간이 겹치면 나중에 시작한 구간의 수익률이 이긴다 (재투자 구간과 동일한 덮어쓰기 규칙)
 */
export function calcGrowthRates(events: InvestEvent[], ym: string): GrowthRates {
    const covering = events.filter((event) => isGrowthSource(event) && coversYm(event, ym))
    if (covering.length === 0) return { priceGrowthPercent: 0, dividendYieldPercent: 0 }

    const latest = covering.reduce((acc, event) => (event.startYm > acc.startYm ? event : acc))
    return {
        priceGrowthPercent: latest.priceGrowthPercent,
        dividendYieldPercent: latest.dividendYieldPercent,
    }
}

/**
 * 세후 기준 연 총수익률 (%) — 주가상승률 + 배당수익률 × (1 − 원천징수율)
 * 화면 안내 문구에서 "이 행이 실제로 몇 % 로 굴러가는지" 한 줄로 보여줄 때 쓴다.
 * @param withholdingRatePercent 배당 원천징수 세율 (%) — ISA 계좌면 0 이라 세전 총수익 그대로가 된다
 */
export function toNetTotalReturnPercent(rates: GrowthRates, withholdingRatePercent: number): number {
    return rates.priceGrowthPercent + rates.dividendYieldPercent * (1 - withholdingRatePercent / 100)
}

/**
 * 이번 달이 확정수익 통의 이관월인지 — 이관월에 원금+수익 전액을 주력 종목으로 넘긴다
 * — 정기매수(확정수익) 구간의 종료월뿐 아니라, 확정수익으로 넣은 일시금·단발성의 종료(이관) 연월도 방아쇠가 된다.
 *   통이 하나뿐이라 어느 이벤트가 걸리든 그 달에 통 전체가 비워진다.
 */
function isGrowthMaturing(events: InvestEvent[], ym: string): boolean {
    return events.some((event) => isGrowthSource(event) && event.endYm !== '' && event.endYm === ym)
}

/**
 * 특정 달에 꺼내 쓸 금액 (원) — 그 달을 덮는 월 정액 인출 구간을 모두 더한다
 * @param events 시트의 전체 이벤트 @param ym 대상 연월
 */
export function calcWithdrawAmount(events: InvestEvent[], ym: string): number {
    return events
        .filter((event) => event.type === EventType.WITHDRAW && coversYm(event, ym))
        .reduce((sum, event) => sum + event.amount, 0)
}

/** 이 시트에 월 정액 인출 계획이 있는지 — 고갈 관련 행·배지를 붙일지 판정에 쓴다 */
export function hasWithdrawSchedule(events: InvestEvent[]): boolean {
    return events.some((event) => event.type === EventType.WITHDRAW && event.amount > 0)
}

/** 이 시트에 확정수익 자산이 하나라도 있는지 — 그리드/엑셀에 확정수익 행을 붙일지 판정에 쓴다 */
export function hasGrowthPlan(events: InvestEvent[]): boolean {
    return events.some((event) => isGrowthSource(event))
}

/**
 * 특정 달의 배당 재투자 여부 판정
 * 1) 그 달을 포함하는 재투자 구간들 중 시작이 가장 늦은 것을 채택 (뒤에 지정한 구간이 앞 구간을 덮어씀)
 * 2) 해당하는 구간이 없으면 기본값 "재투자 함"
 */
function isReinvesting(events: InvestEvent[], ym: string): boolean {
    const coveringRules = events.filter((event) =>
        event.type === EventType.REINVEST && coversYm(event, ym),
    )

    if (coveringRules.length === 0) return true

    const latest = coveringRules.reduce((acc, event) => (event.startYm > acc.startYm ? event : acc))
    return latest.reinvest
}

/**
 * 시뮬레이션 개시 연월 — 투입 이벤트 중 가장 빠른 시점 (이벤트가 없으면 null)
 * 재투자 구간과 정기매수 중단 구간은 새 돈이 들어오는 이벤트가 아니라 기존 흐름을 바꾸는 규칙이므로
 * 개시 시점 판정에서 제외한다. (중단 구간만 있는 시트가 그 달부터 시작되어 버리는 것을 막는다)
 */
function findStartYm(events: InvestEvent[]): string | null {
    const validYms = events
        .filter((event) => event.type !== EventType.REINVEST
            && event.type !== EventType.RECURRING_STOP
            // 인출은 새 돈이 들어오는 이벤트가 아니라 있는 돈을 빼는 규칙이라 개시 시점을 만들지 않는다
            && event.type !== EventType.WITHDRAW)
        .map((event) => event.startYm)
        .filter((ym) => ym !== '')

    if (validYms.length === 0) return null
    return validYms.reduce((min, ym) => (ym < min ? ym : min))
}

/** 한 해 시뮬레이션의 이월 상태 */
interface CarryState {
    shares: number
    balance: number
    cumulativePurchase: number
    /** 확정수익 자산 평가액 (원) */
    growthBalance: number
    /** 확정수익 자산 누적 매수 원금 (원) — 평단가의 분자 */
    growthPrincipal: number
    /** 적립을 시작한 뒤 흐른 개월 수 — 12 의 배수가 되는 달에 연 성장률을 적용한다 */
    growthMonths: number
    /**
     * 재투자하지 않고 쌓인 배당 누계 (원) — 해가 바뀌어도 이어져야 하므로 이월 상태로 들고 간다.
     * 연 단위로 리셋되면 인출 재원이 그 해치 배당만 남아 계좌 잔액이 실제보다 작게 찍힌다.
     */
    dividendCashBalance: number
    /** 계좌에 넣은 돈의 누계 (원) — 해를 넘겨도 이어진다. 연 납입한도 판정용 연 합계(contributionTotal)와는 별개다 */
    cumulativeContribution: number
    /** 재투자하지 않고 꺼낸 배당의 누계 (원) — 쓰고 나서도 줄지 않는다 */
    cumulativeDividendTaken: number
}

/** 한 해 시뮬레이션 결과 (과세 적용 여부에 따라 두 번 돌릴 수 있으므로 분리) */
interface YearPass {
    months: MonthlyResult[]
    /** 그 해 주력 종목 세전 배당 합계 (원) */
    grossTotal: number
    /** 그 해 주력 종목 배당 원천징수 세액 합계 (원) */
    taxTotal: number
    /** 그 해 성장자산 세전 배당 합계 (원) — 재투자되지만 금융소득에는 포함된다 */
    growthGrossTotal: number
    /** 그 해 성장자산 배당 원천징수 세액 합계 (원) */
    growthTaxTotal: number
    /** 그 해 계좌 납입액 (원) = 주력 종목 투입금 + 확정수익 자산 투입금. ISA 연 납입한도 판정에 쓴다 */
    contributionTotal: number
    endState: CarryState
}

/**
 * 1개 연도를 월 단위로 시뮬레이션
 * — 미국 원천징수 15% 는 조건 없이 매달 적용된다. 종합과세 여부는 연 합산이 끝난 뒤에 따로 판정하며
 *   그 결과는 현금흐름을 바꾸지 않으므로 여기서 알 필요가 없다.
 */
function simulateYear(
    year: number,
    startState: CarryState,
    events: InvestEvent[],
    constants: SimulationConstants,
    startYm: string | null,
    baseYear: number,
): YearPass {
    const months: MonthlyResult[] = []

    let shares = startState.shares
    let balance = startState.balance
    let cumulativePurchase = startState.cumulativePurchase
    let grossTotal = 0
    let taxTotal = 0
    // 성장자산 배당은 평가액에 재투자되지만 금융소득 합산에는 들어가므로 따로 센다
    let growthGrossTotal = 0
    let growthTaxTotal = 0
    // 계좌 누계 — 납입액은 ISA 연 납입한도 판정에 쓰므로 해마다 0 에서 시작하고,
    // 쌓인 배당은 기간 끝까지 이어지는 잔고이므로 이월 상태에서 그대로 받아 이어 센다.
    let contributionTotal = 0
    let dividendCashBalance = startState.dividendCashBalance

    // 순투입금 누계 — "내 주머니에서 나간 돈 − 돌려받은 배당". 만기까지 이어지는 값이라 둘 다 이월 상태에서 받는다.
    let cumulativeContribution = startState.cumulativeContribution
    let cumulativeDividendTaken = startState.cumulativeDividendTaken

    // 확정수익 자산은 "매년 N% 오르는 주식을 소수점 매수한다"는 가정이라 값이 연 1회만 뛴다.
    // 달력 연도가 아니라 "적립을 시작한 달"부터 개월 수를 세야 구간이 중간에 시작해도 만 1년 단위가 유지된다.
    let growthBalance = startState.growthBalance
    let growthPrincipal = startState.growthPrincipal
    let growthMonths = startState.growthMonths

    for (let month = 1; month <= 12; month += 1) {
        const ym = toYm(year, month)
        const active = startYm !== null && ym >= startYm

        // 1) 개시 이전 달은 계산 없이 빈 행으로 기록
        if (!active) {
            months.push({
                ym, year, month, active: false,
                contribution: 0, dividendGross: 0, dividendTax: 0, dividendNet: 0, dividendReal: 0, reinvested: false, dividendCashBalance: 0,
                cumulativeContribution: 0, cumulativeDividendTaken: 0, netContribution: 0,
                withdrawRequested: 0, withdrawPaid: 0, sharesSold: 0, depleted: false,
                purchaseAmount: 0, cumulativePurchase: 0, shares: 0, balance: 0, sharePriceKrw: 0, valuation: 0, accountRemaining: 0, taxed: false,
                growthContribution: 0, growthGain: 0, growthPrincipal: 0, growthBalance: 0, growthTransfer: 0,
                growthPriceGain: 0, growthDividendGross: 0, growthDividendTax: 0, growthDividendNet: 0,
            })
            continue
        }

        // 1-1) 이번 달 주가·주당 배당 — 주가 변동률이 걸려 있으면 둘 다 같은 배율로 움직인다
        //      원화 종목은 exchangeRate 가 1 로 들어와 환산 없이 그대로 원 단위가 된다
        const priceFactor = toPriceFactor(year, month, baseYear, constants)
        const sharePriceKrw = constants.sharePriceNative * constants.exchangeRate * priceFactor
        const monthlyDividendKrw = constants.monthlyDividendNative * constants.exchangeRate * priceFactor

        // 2) 배당 지급 — 전월 말 보유 주식 수 기준, 원 단위 절사
        //    일반 계좌는 원천징수 15% 가 지급 시점에 무조건 빠져 계좌에 들어오는 돈이 항상 세후 금액이고,
        //    ISA 계좌는 세율이 0 이라 세전 = 세후이고 지급액 전액이 그대로 배당금으로 들어온다.
        const dividendGross = Math.floor(shares * monthlyDividendKrw)
        const dividendTax = Math.floor(dividendGross * (constants.withholdingRatePercent / 100))
        const dividendNet = dividendGross - dividendTax

        // 2-1) 실질가치 환산 — 물가 할인계수를 곱해 기준연도 화폐가치로 되돌린다.
        //      표시 전용 지표이므로 아래 매수/재투자 계산에는 명목 금액(dividendNet)을 그대로 쓴다.
        const dividendReal = Math.floor(dividendNet * toRealValueFactor(year, month, constants))

        // 3) 이벤트 투입금 산출
        const contribution = calcContribution(events, ym)

        // 4) 재투자 구간 판정 — 인출 구간이면 세후 배당을 계좌 밖으로 빼고 매수에 쓰지 않는다
        const reinvested = isReinvesting(events, ym)

        // 4-1) 확정수익 자산 매수 — 이번 달 납입금이 그대로 평가액에 얹힌다 (그 달 가격으로 소수점 매수한 셈)
        const growthContribution = calcGrowthContribution(events, ym)
        growthPrincipal += growthContribution
        growthBalance += growthContribution

        // 4-1-1) 계좌 납입 누계 — 주력 종목 투입금과 확정수익 투입금은 결국 같은 계좌로 들어간 돈이다.
        //        ISA 는 이 값으로 연/총 납입한도와 만기 순이익(평가액 − 원금)을 잡는다.
        contributionTotal += contribution + growthContribution

        // 4-1-2) 재투자하지 않은 배당 누계 — 계좌 유형과 무관하게 그때그때 손에 쥐는 돈이다.
        //        아직 쓰지 않았다면 배당현금으로 남아 있다가, 월 정액 인출이 걸리면 여기서 먼저 빠져나간다.
        if (!reinvested) dividendCashBalance += dividendNet

        // 4-1-3) 순투입금 누계 — 넣은 돈은 그대로 더하고, 재투자하지 않고 꺼낸 배당만큼은 돌려받은 셈이라 뺀다.
        //        예) 20만원 × 20개월 = 400만원을 넣는 동안 배당 2만원을 꺼냈다면 순투입금은 398만원이다.
        //        위 dividendCashBalance 는 그 돈을 쓰면 다시 줄어드는 "잔고"라 이 질문에는 답할 수 없어 따로 센다.
        cumulativeContribution += contribution + growthContribution
        if (!reinvested) cumulativeDividendTaken += dividendNet

        // 4-2) 적립 경과 개월 수 — 첫 매수가 있는 달부터 세기 시작해, 돈이 남아 있는 한 계속 흐른다
        if (growthMonths > 0 || growthContribution > 0) growthMonths += 1

        // 4-3) 만 1년째 되는 달마다 총수익을 반영한다 (그 해 넣은 돈도 같은 해 수익을 온전히 받는다)
        //      ① 주가수익 — 가격이 오른 몫. 팔지 않았으므로 세금이 붙지 않는다.
        //      ② 배당 — 세전 배당에서 미국 원천징수 15% 를 떼고, 남은 전액으로 같은 자산을 다시 사들인다.
        //      두 값을 더한 만큼 평가액이 늘고, 그 합계가 이 자산의 총수익이다.
        let growthPriceGain = 0
        let growthDividendGross = 0
        let growthDividendTax = 0
        let growthDividendNet = 0
        if (growthMonths > 0 && growthMonths % 12 === 0) {
            const rates = calcGrowthRates(events, ym)
            growthPriceGain = Math.floor(growthBalance * (rates.priceGrowthPercent / 100))
            growthDividendGross = Math.floor(growthBalance * (rates.dividendYieldPercent / 100))
            growthDividendTax = Math.floor(growthDividendGross * (constants.withholdingRatePercent / 100))
            growthDividendNet = growthDividendGross - growthDividendTax
            growthBalance += growthPriceGain + growthDividendNet
        }

        // 4-3-1) 평가액에 실제로 얹힌 수익 합계 — 주가수익 + 세후 배당(재투자분)
        const growthGain = growthPriceGain + growthDividendNet

        // 4-3-2) 재투자된 배당도 세법상 배당소득이므로 그 해 금융소득에 합산한다
        growthGrossTotal += growthDividendGross
        growthTaxTotal += growthDividendTax

        // 4-4) 구간 종료월이면 평가액 전액을 주력 종목 매수 자금으로 이관하고 통을 비운다
        const growthTransfer = isGrowthMaturing(events, ym) ? growthBalance : 0
        if (growthTransfer > 0) {
            growthBalance = 0
            growthPrincipal = 0
            growthMonths = 0
        }

        // 5) 가용 현금 = 이월 잔액 + 투입금 + 확정수익 이관분 + (재투자 시에만) 세후 배당
        let cash = balance + contribution + growthTransfer + (reinvested ? dividendNet : 0)

        // 5-1) 월 정액 인출 — 목표액을 채울 때까지 아래 순서로 재원을 턴다.
        //      싼 재원(이미 현금)부터 쓰고, 원금을 헐어야 하는 주식 매도를 마지막에 둔다.
        //        ① 가용 현금(이월 잔액 + 이번 달 투입금 + 재투자분 배당)
        //        ② 계좌에 쌓아 둔 배당현금
        //        ③ 보유 주식 매도 — 여기부터가 "원금을 헐어 쓰는" 구간이다
        //      셋을 다 털어도 모자라면 그 달이 계좌 고갈 시점이다.
        const withdrawRequested = calcWithdrawAmount(events, ym)
        let shortfall = withdrawRequested
        let sharesSold = 0

        if (shortfall > 0) {
            // 5-1-1) ① 가용 현금에서 먼저 꺼낸다
            const fromCash = Math.min(cash, shortfall)
            cash -= fromCash
            shortfall -= fromCash

            // 5-1-2) ② 쌓아 둔 배당현금에서 꺼낸다
            const fromDividendCash = Math.min(dividendCashBalance, shortfall)
            dividendCashBalance -= fromDividendCash
            shortfall -= fromDividendCash

            // 5-1-3) ③ 그래도 모자라면 주식을 판다 — 필요한 만큼만 올림 매도하고, 남은 잔돈은 예수금으로 되돌린다
            if (shortfall > 0 && shares > 0 && sharePriceKrw > 0) {
                sharesSold = Math.min(shares, Math.ceil(shortfall / sharePriceKrw))
                const proceeds = sharesSold * sharePriceKrw
                shares -= sharesSold

                const used = Math.min(proceeds, shortfall)
                shortfall -= used
                cash += proceeds - used
            }
        }

        // 5-2) 목표액을 다 못 채웠으면 이 달이 고갈 시점이다 (재원이 하나도 안 남았다는 뜻)
        const withdrawPaid = withdrawRequested - shortfall
        const depleted = shortfall > 0

        // 6) 인출하고 남은 현금으로 주식 매수 (인출 구간에는 보통 투입금이 없어 자연히 0이 된다)
        const boughtShares = toBuyableShares(cash, sharePriceKrw)
        const purchaseAmount = boughtShares * sharePriceKrw

        // 7) 상태 갱신 — 남은 예수금은 다음 달로 이월
        shares += boughtShares
        balance = cash - purchaseAmount
        cumulativePurchase += purchaseAmount
        grossTotal += dividendGross
        taxTotal += dividendTax

        months.push({
            ym, year, month, active: true,
            contribution, dividendGross, dividendTax, dividendNet, dividendReal, reinvested, dividendCashBalance,
            cumulativeContribution, cumulativeDividendTaken,
            // 순투입금 — 넣은 돈에서 꺼낸 배당을 뺀 값. 배당을 더 꺼내 갔다면 음수가 될 수도 있다(원금 회수 완료)
            netContribution: cumulativeContribution - cumulativeDividendTaken,
            withdrawRequested, withdrawPaid, sharesSold, depleted,
            purchaseAmount, cumulativePurchase, shares, balance,
            sharePriceKrw,
            // 평가액 = 보유주 × 그 시점 주가 + 아직 못 산 예수금
            valuation: shares * sharePriceKrw + balance,
            // 계좌에 남은 총액 — 아직 안 쓴 배당현금까지 더해야 "얼마 남았나"가 된다
            accountRemaining: shares * sharePriceKrw + balance + dividendCashBalance,
            // 종합과세 여부는 워크북 전체 합산이 끝나야 알 수 있어, 연 단위 판정 뒤에 덮어쓴다
            taxed: false,
            growthContribution, growthGain, growthPrincipal, growthBalance, growthTransfer,
            growthPriceGain, growthDividendGross, growthDividendTax, growthDividendNet,
        })
    }

    return {
        months,
        grossTotal,
        taxTotal,
        growthGrossTotal,
        growthTaxTotal,
        contributionTotal,

        // 확정수익 자산은 평가액·원금과 함께 "적립 경과 개월 수"까지 넘겨야 연말에 연차 계산이 끊기지 않는다.
        // 쌓인 배당현금도 해를 넘겨 계속 불어나므로 함께 이월한다.
        endState: {
            shares, balance, cumulativePurchase,
            growthBalance, growthPrincipal, growthMonths, dividendCashBalance,
            cumulativeContribution, cumulativeDividendTaken,
        },
    }
}

// ┣━━━━━━━━━━━━━━━━ 엔진 진입점 ━━━━━━━━━━━━━━━━┫

/** 여러 시트의 그 해 세전 배당 합계 */
function sumGross(passes: YearPass[]): number {
    return passes.reduce((sum, pass) => sum + pass.grossTotal, 0)
}

/**
 * 시트(=계좌) 1개분 ISA 납입한도 판정용 누계 — 대상 기간을 다 돌면서 쌓는다.
 */
interface IsaAccumulator {
    /** 총 납입액 (원) */
    contributionTotal: number
    /** 연 납입한도를 넘긴 연도 목록 */
    overAnnualLimitYears: number[]
}

/**
 * 워크북(엑셀 파일 1개) 단위 시뮬레이션 실행
 *
 * 세금 처리는 계좌 유형에 따라 통째로 갈린다.
 *
 * [일반 계좌] 두 층으로 나뉘고, 현금흐름을 건드리는 것은 첫 번째뿐이다.
 *   1) 원천징수 15% — 배당 지급 시점에 항상 차감. 재투자에 쓰이는 돈은 언제나 세후 금액이다.
 *   2) 금융소득종합과세 — 워크북 전체(모든 시트) 합산 세전 배당이 그 해 2,000만원을 넘으면
 *      이듬해 5월에 종소세를 더 낸다. 이 금액은 추정만 해서 연도 요약에 붙이고 매수 계산에는 넣지 않는다.
 *   예) 시트1(엄마) + 시트2(경아)의 연간 세전 배당 합이 2,000만원을 넘으면
 *       그 해는 두 시트 모두 종합과세 연도로 표시되고, 합산 기준 예상 납부액이 연도 옆에 붙는다.
 *
 * [ISA 계좌] 위 두 층이 모두 없다. 배당은 세금 없이 그대로 받는 현금이고, 종합과세 합산에도
 *   건보료 부과 소득에도 잡히지 않는다. 시트(=계좌)마다 납입한도 초과 여부만 따로 점검한다.
 */
export function runWorkbookSimulation(
    tabs: WorkbookTabInput[],
    constants: SimulationConstants,
    startYear: number,
    endYear: number,
): WorkbookSimulationResult {
    // 0) 계좌 유형 — 아래 과세 판정 전체가 이 한 줄로 갈린다
    const isIsa = constants.accountType === AccountType.ISA

    // 1) 시트별 개시 연월과 이월 상태를 각각 독립적으로 들고 간다
    const startYms = tabs.map((tab) => findStartYm(tab.events))
    const states: CarryState[] = tabs.map(() => ({
        shares: 0, balance: 0, cumulativePurchase: 0,
        growthBalance: 0, growthPrincipal: 0, growthMonths: 0, dividendCashBalance: 0,
        cumulativeContribution: 0, cumulativeDividendTaken: 0,
    }))

    // 1-1) ISA 납입 누계 — 계좌는 사람(시트)마다 하나이므로 시트별로 따로 쌓는다
    const isaAccumulators: IsaAccumulator[] = tabs.map(() => ({
        contributionTotal: 0, overAnnualLimitYears: [],
    }))

    const byTabId: Record<string, SimulationResult> = {}
    tabs.forEach((tab) => {
        byTabId[tab.id] = {
            byYm: {}, byYear: {}, firstTaxedYear: null, isaLimits: NO_ISA_LIMIT_STATUS,
            depletedYm: null, firstSellYm: null,
        }
    })

    const byYear: Record<number, WorkbookYearSummary> = {}
    let firstTaxedYear: number | null = null

    for (let year = startYear; year <= endYear; year += 1) {
        // 2) 시트별 1년치 시뮬레이션 — 원천징수가 조건 없이 적용되므로 한 번만 돌리면 된다
        //    (예전에는 과세 여부가 재투자액을 바꿔 2-pass 수렴이 필요했지만, 이제 그 되먹임이 없다)
        const passes = tabs.map((tab, index) =>
            simulateYear(year, states[index], tab.events, constants, startYms[index], startYear))

        // 3) 워크북 합산 — 종합과세 판정과 종소세·건보료 추정은 파일 전체를 한 덩어리로 본다
        //    성장자산 배당은 현금으로 빠지지 않고 재투자되지만 세법상 배당소득이므로 함께 합산한다
        const yearGross = sumGross(passes)
        const yearTax = passes.reduce((sum, pass) => sum + pass.taxTotal, 0)
        const yearGrowthGross = passes.reduce((sum, pass) => sum + pass.growthGrossTotal, 0)
        const yearGrowthTax = passes.reduce((sum, pass) => sum + pass.growthTaxTotal, 0)

        const financialIncome = yearGross + yearGrowthGross
        const withheldTotal = yearTax + yearGrowthTax

        // 3-1) ISA 계좌의 소득은 종합과세·건보료 어느 쪽에도 잡히지 않는다.
        //      판정에 넣는 금융소득을 0 으로 두면 두 추정이 모두 "해당 없음"으로 떨어져 연도 배지가 사라진다.
        const chargeableIncome = isIsa ? 0 : financialIncome
        const taxed = chargeableIncome > constants.comprehensiveThresholdKrw
        const comprehensiveTax = estimateComprehensiveTax(chargeableIncome, isIsa ? 0 : withheldTotal, constants)
        const healthInsurance = estimateHealthInsurance(chargeableIncome, constants)

        // 4) 시트별 결과 반영 + 다음 해로 상태 이월
        passes.forEach((pass, index) => {
            const tabResult = byTabId[tabs[index].id]
            for (const monthly of pass.months) {
                // 4-1) 종합과세 연도 표시 — 월 계산이 끝난 뒤라야 알 수 있어 여기서 채운다
                monthly.taxed = taxed
                tabResult.byYm[monthly.ym] = monthly

                // 4-1-1) 원금을 헐기 시작한 달 / 계좌가 바닥난 달 — 각각 처음 걸린 시점만 잡는다
                if (monthly.sharesSold > 0 && tabResult.firstSellYm === null) {
                    tabResult.firstSellYm = monthly.ym
                }
                if (monthly.depleted && tabResult.depletedYm === null) {
                    tabResult.depletedYm = monthly.ym
                }
            }

            // 4-2) ISA 납입 누계 갱신 — 연 납입한도를 넘긴 해는 따로 표시해 둔다.
            //      한도 초과는 세액을 바꾸지 않지만, 실제로는 그만큼 넣을 수 없어 계획 자체가 성립하지 않는다.
            const accumulator = isaAccumulators[index]
            accumulator.contributionTotal += pass.contributionTotal

            if (isIsa && pass.contributionTotal > constants.isaAnnualLimitKrw) {
                accumulator.overAnnualLimitYears.push(year)
            }

            // 4-3) 시트별 요약의 종합과세 여부는 워크북 판정을 그대로 따른다
            //      (보유 주식이 없어 그 시트 배당이 0이어도 "종합과세 연도"라는 사실은 동일)
            tabResult.byYear[year] = {
                year,
                dividendGross: pass.grossTotal,
                dividendTax: pass.taxTotal,
                growthDividendGross: pass.growthGrossTotal,
                growthDividendTax: pass.growthTaxTotal,
                financialIncome: pass.grossTotal + pass.growthGrossTotal,
                taxed,
                contribution: pass.contributionTotal,
                contributionCumulative: accumulator.contributionTotal,
            }
            if (taxed && tabResult.firstTaxedYear === null) tabResult.firstTaxedYear = year

            states[index] = pass.endState
        })

        // 5) 워크북 합산 요약 기록 — 5월 종소세 · 건보료 추정을 함께 담아 연도 헤더에 노출한다
        byYear[year] = {
            year,
            dividendGross: yearGross,
            dividendTax: yearTax,
            growthDividendGross: yearGrowthGross,
            growthDividendTax: yearGrowthTax,
            financialIncome,
            taxed,
            comprehensiveTax,
            healthInsurance,
        }
        if (taxed && firstTaxedYear === null) firstTaxedYear = year
    }

    // 6) ISA 납입한도 점검 — 대상 기간을 다 돌고 난 뒤 시트(=계좌)마다 한 번씩 판정한다.
    //    배당에 붙는 세금이 없어 정산할 것이 없고, 남는 것은 "이 계획을 그대로 넣을 수 있는가"뿐이다.
    //    일반 계좌는 여기서 손대지 않고 초기값(NO_ISA_LIMIT_STATUS)을 그대로 둔다.
    if (isIsa) {
        tabs.forEach((tab, index) => {
            const accumulator = isaAccumulators[index]

            byTabId[tab.id].isaLimits = evaluateIsaLimits({
                contributionTotal: accumulator.contributionTotal,
                overAnnualLimitYears: accumulator.overAnnualLimitYears,
            }, constants)
        })
    }

    return { byTabId, byYear, firstTaxedYear }
}
