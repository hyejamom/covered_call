import {
    EventType,
    type InvestEvent,
    type MonthlyResult,
    type SimulationConstants,
    type SimulationResult,
    type WorkbookSimulationResult,
    type WorkbookTabInput,
    type WorkbookYearSummary,
} from '../types/simulation'

// ══════════ 계산 규칙 요약 ══════════
//
// [지급/재투자 시점] 배당은 "전월 말 보유 주식 수" 기준으로 그 달에 지급되며, 같은 달에 즉시 재투자한다.
// [매수 순서]       예수금(이월 잔액) + 이번 달 투입금 + 이번 달 세후 배당 → 전액으로 주식 매수
// [매수 단위]       1주 단위로만 매수(정수 매수). 1주 값에 못 미치는 금액은 잔액으로 다음 달 이월되므로
//                   잔액은 구조적으로 항상 "1주 가격 미만"을 유지한다 (돈이 차는 즉시 매수).
// [과세]            판정 단위는 워크북(엑셀 파일) 전체. 그 안 모든 시트의 "연간 세전 배당 합계"가
//                   과세 기준(2,000만원)을 넘는 연도부터, 그 해 배당 전체에 세율을 적용한다.
// [절사]            배당금(원)·세액(원) 모두 원 단위 절사(Math.floor)

// ┣━━━━━━━━━━━━━━━━ 내부 유틸 ━━━━━━━━━━━━━━━━━┫

/** 'YYYY-MM' 문자열 생성 — 사전순 비교가 곧 시점 비교가 되도록 2자리 패딩 */
export function toYm(year: number, month: number): string {
    return `${year}-${String(month).padStart(2, '0')}`
}

/** 가용 현금으로 살 수 있는 주식 수 — 1주 단위 내림 (부동소수 오차로 1주 손실되는 것 방지) */
function toBuyableShares(cash: number, sharePriceKrw: number): number {
    if (sharePriceKrw <= 0) return 0
    return Math.floor(cash / sharePriceKrw + 1e-9)
}

/**
 * 특정 달의 총 투입금 계산
 * 1) 초기 일시금 / 단발성 추가는 해당 연월이 일치할 때 가산
 * 2) 정기 매수는 기간에 포함될 때만 가산하되, 금액변경 이벤트가 있으면 그 금액으로 대체
 * 3) 초기 일시금이 "그 달 정기분 포함"이면 정기분을 중복 가산하지 않음
 */
function calcContribution(events: InvestEvent[], ym: string): number {
    let total = 0

    // 1) 일회성 투입 합산
    for (const event of events) {
        const isOneShot = event.type === EventType.INITIAL || event.type === EventType.ONE_TIME
        if (isOneShot && event.startYm === ym) total += event.amount
    }

    // 2) 정기 매수 활성 여부 판정 (종료 연월이 비어 있으면 "계속")
    const activeRecurring = events.filter((event) =>
        event.type === EventType.RECURRING
        && event.startYm !== ''
        && event.startYm <= ym
        && (event.endYm === '' || ym <= event.endYm),
    )

    if (activeRecurring.length > 0) {
        // 2-1) 현재 시점까지 발효된 금액변경 이벤트 중 가장 최근 것을 채택
        const appliedChanges = events
            .filter((event) => event.type === EventType.CHANGE && event.startYm !== '' && event.startYm <= ym)
            .sort((a, b) => a.startYm.localeCompare(b.startYm))

        const monthlyAmount = appliedChanges.length > 0
            ? appliedChanges[appliedChanges.length - 1].amount
            : activeRecurring.reduce((sum, event) => sum + event.amount, 0)

        // 3) 초기 일시금에 그 달 정기분이 포함되어 있으면 건너뜀
        const coveredByInitial = events.some((event) =>
            event.type === EventType.INITIAL && event.startYm === ym && event.includesRecurring,
        )

        if (!coveredByInitial) total += monthlyAmount
    }

    return total
}

/**
 * 특정 달의 배당 재투자 여부 판정
 * 1) 그 달을 포함하는 재투자 구간들 중 시작이 가장 늦은 것을 채택 (뒤에 지정한 구간이 앞 구간을 덮어씀)
 * 2) 해당하는 구간이 없으면 기본값 "재투자 함"
 */
function isReinvesting(events: InvestEvent[], ym: string): boolean {
    const coveringRules = events.filter((event) =>
        event.type === EventType.REINVEST
        && event.startYm !== ''
        && event.startYm <= ym
        && (event.endYm === '' || ym <= event.endYm),
    )

    if (coveringRules.length === 0) return true

    const latest = coveringRules.reduce((acc, event) => (event.startYm > acc.startYm ? event : acc))
    return latest.reinvest
}

/**
 * 시뮬레이션 개시 연월 — 투입 이벤트 중 가장 빠른 시점 (이벤트가 없으면 null)
 * 재투자 구간은 투입이 아니라 배당 처리 방식만 바꾸는 규칙이므로 개시 시점 판정에서 제외한다.
 */
function findStartYm(events: InvestEvent[]): string | null {
    const validYms = events
        .filter((event) => event.type !== EventType.REINVEST)
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
}

/** 한 해 시뮬레이션 결과 (과세 적용 여부에 따라 두 번 돌릴 수 있으므로 분리) */
interface YearPass {
    months: MonthlyResult[]
    grossTotal: number
    taxTotal: number
    endState: CarryState
}

/**
 * 1개 연도를 월 단위로 시뮬레이션
 * @param applyTax 이 해 배당에 원천징수를 적용할지 (연간 합산 판정 결과를 외부에서 주입)
 */
function simulateYear(
    year: number,
    startState: CarryState,
    events: InvestEvent[],
    constants: SimulationConstants,
    startYm: string | null,
    applyTax: boolean,
): YearPass {
    const months: MonthlyResult[] = []
    const sharePriceKrw = constants.sharePriceUsd * constants.exchangeRate

    let shares = startState.shares
    let balance = startState.balance
    let cumulativePurchase = startState.cumulativePurchase
    let grossTotal = 0
    let taxTotal = 0

    for (let month = 1; month <= 12; month += 1) {
        const ym = toYm(year, month)
        const active = startYm !== null && ym >= startYm

        // 1) 개시 이전 달은 계산 없이 빈 행으로 기록
        if (!active) {
            months.push({
                ym, year, month, active: false,
                contribution: 0, dividendGross: 0, dividendTax: 0, dividendNet: 0, reinvested: false,
                purchaseAmount: 0, cumulativePurchase: 0, shares: 0, balance: 0, taxed: false,
            })
            continue
        }

        // 2) 배당 지급 — 전월 말 보유 주식 수 기준, 원 단위 절사
        const dividendGross = Math.floor(shares * constants.monthlyDividendUsd * constants.exchangeRate)
        const dividendTax = applyTax
            ? Math.floor(dividendGross * (constants.taxRatePercent / 100))
            : 0
        const dividendNet = dividendGross - dividendTax

        // 3) 이벤트 투입금 산출
        const contribution = calcContribution(events, ym)

        // 4) 재투자 구간 판정 — 인출 구간이면 세후 배당을 계좌 밖으로 빼고 매수에 쓰지 않는다
        const reinvested = isReinvesting(events, ym)

        // 5) 가용 현금 = 이월 잔액 + 투입금 + (재투자 시에만) 세후 배당
        const cash = balance + contribution + (reinvested ? dividendNet : 0)
        const boughtShares = toBuyableShares(cash, sharePriceKrw)
        const purchaseAmount = boughtShares * sharePriceKrw

        // 6) 상태 갱신 — 남은 예수금은 다음 달로 이월
        shares += boughtShares
        balance = cash - purchaseAmount
        cumulativePurchase += purchaseAmount
        grossTotal += dividendGross
        taxTotal += dividendTax

        months.push({
            ym, year, month, active: true,
            contribution, dividendGross, dividendTax, dividendNet, reinvested,
            purchaseAmount, cumulativePurchase, shares, balance,
            taxed: applyTax,
        })
    }

    return {
        months,
        grossTotal,
        taxTotal,
        endState: { shares, balance, cumulativePurchase },
    }
}

// ┣━━━━━━━━━━━━━━━━ 엔진 진입점 ━━━━━━━━━━━━━━━━┫

/** 여러 시트의 그 해 세전 배당 합계 */
function sumGross(passes: YearPass[]): number {
    return passes.reduce((sum, pass) => sum + pass.grossTotal, 0)
}

/**
 * 워크북(엑셀 파일 1개) 단위 시뮬레이션 실행
 *
 * 과세 판정 단위가 시트가 아니라 "워크북 전체 합산"이라는 점이 핵심이다.
 * 예) 시트1(엄마) + 시트2(경아)의 연간 배당 합이 2,000만원을 넘으면
 *     그 해에는 두 시트 모두 15% 원천징수가 적용되고, 재투자액도 함께 줄어든다.
 *
 * 세금이 다시 재투자액(→ 이듬해 배당)에 영향을 주므로 연도마다 2-pass 로 수렴시킨다.
 * 1) 전 시트를 비과세로 돌려 합산 배당을 구하고
 * 2) 합산이 기준을 넘으면 전 시트를 과세로 다시 돌린 뒤
 * 3) 과세 후에도 여전히 기준을 넘을 때만 과세 결과를 채택한다.
 *    (과세로 합산이 기준 아래로 내려가면 애초에 과세 조건이 성립하지 않으므로 1-pass 결과 유지)
 */
export function runWorkbookSimulation(
    tabs: WorkbookTabInput[],
    constants: SimulationConstants,
    startYear: number,
    endYear: number,
): WorkbookSimulationResult {
    // 1) 시트별 개시 연월과 이월 상태를 각각 독립적으로 들고 간다
    const startYms = tabs.map((tab) => findStartYm(tab.events))
    const states: CarryState[] = tabs.map(() => ({ shares: 0, balance: 0, cumulativePurchase: 0 }))

    const byTabId: Record<string, SimulationResult> = {}
    tabs.forEach((tab) => {
        byTabId[tab.id] = { byYm: {}, byYear: {}, firstTaxedYear: null }
    })

    const byYear: Record<number, WorkbookYearSummary> = {}
    let firstTaxedYear: number | null = null

    for (let year = startYear; year <= endYear; year += 1) {
        // 2) 1-pass — 전 시트 비과세
        const untaxedPasses = tabs.map((tab, index) =>
            simulateYear(year, states[index], tab.events, constants, startYms[index], false))

        // 3) 워크북 합산이 기준 초과면 2-pass — 전 시트에 동일하게 과세 적용
        let passes = untaxedPasses
        let taxed = false
        if (sumGross(untaxedPasses) > constants.taxThresholdKrw) {
            const taxedPasses = tabs.map((tab, index) =>
                simulateYear(year, states[index], tab.events, constants, startYms[index], true))
            if (sumGross(taxedPasses) > constants.taxThresholdKrw) {
                passes = taxedPasses
                taxed = true
            }
        }

        // 4) 시트별 결과 반영 + 다음 해로 상태 이월
        let yearGross = 0
        let yearTax = 0
        passes.forEach((pass, index) => {
            const tabResult = byTabId[tabs[index].id]
            for (const monthly of pass.months) tabResult.byYm[monthly.ym] = monthly

            // 4-1) 시트별 요약의 과세 여부는 워크북 판정을 그대로 따른다
            //      (보유 주식이 없어 그 시트의 세액이 0이어도 "과세 연도"라는 사실은 동일)
            tabResult.byYear[year] = {
                year,
                dividendGross: pass.grossTotal,
                dividendTax: pass.taxTotal,
                taxed,
            }
            if (taxed && tabResult.firstTaxedYear === null) tabResult.firstTaxedYear = year

            states[index] = pass.endState
            yearGross += pass.grossTotal
            yearTax += pass.taxTotal
        })

        // 5) 워크북 합산 요약 기록
        byYear[year] = { year, dividendGross: yearGross, dividendTax: yearTax, taxed }
        if (taxed && firstTaxedYear === null) firstTaxedYear = year
    }

    return { byTabId, byYear, firstTaxedYear }
}