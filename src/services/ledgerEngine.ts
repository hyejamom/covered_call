import { LIVING_CATEGORY, monthDiff, toYmOfDate } from '../constants/ledgerConstants'
import {
    FixedCostType,
    LedgerKind,
    type CardMonthlyStatement,
    type CardStatement,
    type FixedCost,
    type FixedCostCharge,
    type FixedIncome,
    type LedgerCard,
    type LedgerCategorySummary,
    type LedgerData,
    type LedgerEntry,
    type LedgerMonthReport,
    type LedgerMonthSummary,
} from '../types/ledger'

// ══════════ 고정비 · 카드 정산 계산 ══════════
//
// [진짜 고정비]  시작 월부터 끝나는 날 없이 매월 같은 금액이 빠진다.
// [할부]        시작 월이 1회차이고, 개월 수만큼만 빠진 뒤 끝난다.
//                입력은 "원금 총액 + 개월 수"로 받고 월 납입금은 여기서 나눈다.
//                나눠떨어지지 않는 나머지는 마지막 회차에 몰아 총액이 정확히 맞아떨어지게 한다.
// [실제 사용액]  카드 명세서 총액(직접 입력) - 그 달 자동 청구분(할부 + 이 카드로 결제되는 고정비).
//                할부는 과거에 쓴 돈이 이번 달에 청구된 것이고, 고정비는 등록해 둔 순간 이미 따로 집계된다.
//                둘 다 걷어내야 "이번 달에 카드로 새로 쓴 돈"만 남고, 월 요약과도 이중 계산되지 않는다.
// [생활비]      카드 사용액 - 직접 입력한 큰 지출.
//                이 가계부는 결제 한 건씩을 다 적는 물건이 아니라, 큰 지출만 적고 나머지는 뭉뚱그려 본다.
//                그래서 설명되지 않은 카드 사용분을 생활비 한 덩어리로 잡아 분류별 지출을 채운다.

// ┣━━━━━━━━━━━━━━━━ 내부 유틸 ━━━━━━━━━━━━━━━━━┫

/**
 * 할부 회차별 납입금
 * @param total 할부 원금 총액
 * @param months 총 개월 수
 * @param round 조회할 회차 (1부터)
 */
function toInstallmentAmount(total: number, months: number, round: number): number {
    if (months <= 0) return 0

    // 1) 기본 회차 금액은 내림 — 남는 원 단위가 회차마다 흩어지지 않게 한다
    const base = Math.floor(total / months)

    // 2) 마지막 회차가 나머지를 전부 떠안아 합계가 원금과 정확히 일치한다
    return round >= months ? total - (base * (months - 1)) : base
}

// ┣━━━━━━━━━━━━━━━━ API ━━━━━━━━━━━━━━━━━━━━━━━┫

/**
 * 고정비 1건이 특정 달에 청구되는지 판정하고, 청구된다면 금액과 회차를 함께 돌려준다.
 * @param cost 고정비 정의
 * @param ym 조회할 달 'YYYY-MM'
 * @returns 청구되지 않는 달이면 null
 */
export function toChargeOfMonth(cost: FixedCost, ym: string): FixedCostCharge | null {
    // 1) 시작 월로부터 몇 번째 달인지 — 시작 월이 1회차
    const round = monthDiff(cost.startYm, ym) + 1
    if (round < 1) return null

    // 2) 진짜 고정비 — 시작 이후 매월 같은 금액. 종료 월을 찍었으면 그 달까지만 청구된다
    if (cost.type === FixedCostType.RECURRING) {
        // 빈 값(옛 저장본에는 필드 자체가 없다)은 '무기한'으로 읽는다
        if (cost.endYm && ym > cost.endYm) return null
        return { cost, amount: cost.amount, round: 0 }
    }

    // 3) 할부 — 개월 수를 넘어서면 청구 종료
    if (round > cost.months) return null
    return { cost, amount: toInstallmentAmount(cost.amount, cost.months, round), round }
}

/**
 * 특정 달에 청구되는 고정비 전체 — 할부를 앞에, 진짜 고정비를 뒤에 둔다
 * @param costs 등록된 고정비 전체
 * @param ym 조회할 달 'YYYY-MM'
 */
export function toChargesOfMonth(costs: FixedCost[], ym: string): FixedCostCharge[] {
    return costs
        .map((cost) => toChargeOfMonth(cost, ym))
        .filter((charge): charge is FixedCostCharge => charge !== null)
        .sort((a, b) => {
            // 1) 할부 먼저 — 이번 달에 끝나는 건이 눈에 띄어야 한다
            if (a.cost.type !== b.cost.type) return a.cost.type === FixedCostType.INSTALLMENT ? -1 : 1
            // 2) 같은 형태끼리는 금액 내림차순
            return b.amount - a.amount
        })
}

/**
 * 특정 달에 들어오는 고정 수입 전체 — 금액 내림차순
 * 고정 수입은 끝나는 시점이 없으므로, 시작 월 이후의 달이면 매월 같은 금액이 잡힌다.
 * @param incomes 등록된 고정 수입 전체
 * @param ym 조회할 달 'YYYY-MM'
 */
export function toIncomesOfMonth(incomes: FixedIncome[], ym: string): FixedIncome[] {
    return incomes
        .filter((income) => monthDiff(income.startYm, ym) >= 0)
        .sort((a, b) => b.amount - a.amount)
}

/**
 * 카드별 그 달 정산 — 명세서 총액에서 자동 청구분(할부 + 이 카드로 빠지는 고정비)을 걷어내
 * "이번 달에 카드로 새로 쓴 금액"을 뽑는다
 * @param cards 등록된 카드 전체
 * @param charges 그 달에 청구되는 고정비 목록 (toChargesOfMonth 결과)
 * @param statements 직접 입력한 카드 월 청구 총액 전체
 * @param ym 조회할 달 'YYYY-MM'
 */
export function toCardStatements(
    cards: LedgerCard[],
    charges: FixedCostCharge[],
    statements: CardStatement[],
    ym: string,
): CardMonthlyStatement[] {
    return cards.map((card) => {
        // 1) 이 카드에 걸린 그 달 청구분을 형태별로 합산
        const ofCard = charges.filter((charge) => charge.cost.cardId === card.id)
        const installment = ofCard
            .filter((charge) => charge.cost.type === FixedCostType.INSTALLMENT)
            .reduce((sum, charge) => sum + charge.amount, 0)
        const recurring = ofCard
            .filter((charge) => charge.cost.type === FixedCostType.RECURRING)
            .reduce((sum, charge) => sum + charge.amount, 0)

        // 2) 이 카드로 그 달 자동으로 빠지는 합계 — 할부 + 고정비
        const autoCharged = installment + recurring

        // 3) 직접 입력한 명세서 총액 — 아직 안 적었으면 실제 사용액도 구할 수 없다
        const found = statements.find((statement) => statement.cardId === card.id && statement.ym === ym)
        const total = found?.total ?? null

        return {
            card,
            total,
            installment,
            recurring,
            autoCharged,
            actual: total === null ? null : total - autoCharged,
        }
    })
}

/**
 * 그 달 카드로 새로 쓴 금액 합계 — 명세서를 적어 넣은 카드만 더한다
 * 카드 패널의 "실제 사용"과 같은 규칙(총액 - 할부·고정비)을 카드 전체에 대해 합산한 값이다.
 * @param charges 그 달에 청구되는 고정비 목록 (toChargesOfMonth 결과)
 * @param statements 직접 입력한 카드 월 청구 총액 전체
 * @param ym 조회할 달 'YYYY-MM'
 */
export function toCardUsedOfMonth(
    charges: FixedCostCharge[],
    statements: CardStatement[],
    ym: string,
): number {
    return statements
        .filter((statement) => statement.ym === ym)
        .reduce((sum, statement) => {
            // 1) 이 카드에 걸린 그 달 자동 청구분 — 할부 + 고정비
            const autoCharged = charges
                .filter((charge) => charge.cost.cardId === statement.cardId)
                .reduce((acc, charge) => acc + charge.amount, 0)

            // 2) 총액을 잘못 적어 음수가 나오면 합계를 끌어내리지 않도록 0으로 막는다
            return sum + Math.max(0, statement.total - autoCharged)
        }, 0)
}

/**
 * 생활비 — 카드로 쓴 돈 중 "따로 적어 둔 큰 지출"로 설명되지 않는 나머지
 * 큰 지출은 대개 카드로 긁으므로 카드 사용액 안에 이미 포함돼 있다고 보고 뺀다.
 * 직접 입력분이 카드 사용액보다 크면(현금·계좌이체로 낸 건이 섞인 경우) 남는 생활비는 없다.
 * @param cardUsed 그 달 카드 사용액 합계
 * @param directExpense 직접 입력한 지출 합계
 */
export function toLivingCost(cardUsed: number, directExpense: number): number {
    return Math.max(0, cardUsed - directExpense)
}

// ┣━━━━━━━━━━━━━━━━ 월 집계 (화면 · 엑셀 공용) ━━━┫

/** 항목 정렬 — 날짜 내림차순, 같은 날이면 나중에 넣은 것이 위로 */
function compareEntries(a: LedgerEntry, b: LedgerEntry): number {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1
    return a.id < b.id ? 1 : -1
}

/**
 * 한 달치 집계 한 벌 — 가계부 화면과 엑셀 내보내기가 같은 값을 보도록 계산을 여기 한 곳에 모은다.
 * @param data 가계부 원본 데이터 한 벌 (저장 스냅샷을 그대로 넘겨도 된다)
 * @param ym 집계할 달 'YYYY-MM'
 */
export function toMonthReport(data: LedgerData, ym: string): LedgerMonthReport {
    // 1) 그 달 직접 입력 항목 — 날짜 내림차순
    const entries = data.entries
        .filter((entry) => toYmOfDate(entry.date) === ym)
        .sort(compareEntries)

    // 2) 자동으로 잡히는 분 — 그 달 고정비·할부 / 고정 수입
    const charges = toChargesOfMonth(data.fixedCosts, ym)
    const incomes = toIncomesOfMonth(data.fixedIncomes, ym)
    const fixedTotal = charges.reduce((sum, charge) => sum + charge.amount, 0)
    const fixedIncomeTotal = incomes.reduce((sum, income) => sum + income.amount, 0)

    // 3) 카드 — 카드별 정산과 그 달 카드 사용액 합계
    const cardStatements = toCardStatements(data.cards, charges, data.statements, ym)
    const cardUsed = toCardUsedOfMonth(charges, data.statements, ym)

    // 4) 월 요약 — 직접 입력분을 수입/지출로 가른 뒤 생활비·총지출·저축 가능액을 세운다
    const summary: LedgerMonthSummary = entries.reduce<LedgerMonthSummary>((acc, entry) => {
        if (entry.kind === LedgerKind.INCOME) acc.income += entry.amount
        else acc.expense += entry.amount
        return acc
    }, {
        income: 0,
        fixedIncome: fixedIncomeTotal,
        expense: 0,
        fixed: fixedTotal,
        cardUsed,
        living: 0,
        total: 0,
        net: 0,
    })
    summary.living = toLivingCost(summary.cardUsed, summary.expense)
    summary.total = summary.fixed + summary.expense + summary.living
    summary.net = (summary.income + summary.fixedIncome) - summary.total

    // 5) 분류별 지출 — 고정비 · 직접 입력한 큰 지출 · 나머지를 뭉친 생활비를 한 통에 담는다
    const expenseByCategory: LedgerCategorySummary[] = Object.entries(
        [
            ...entries
                .filter((entry) => entry.kind === LedgerKind.EXPENSE)
                .map((entry) => ({ category: entry.category, amount: entry.amount })),
            ...charges.map((charge) => ({ category: charge.cost.category, amount: charge.amount })),
            ...(summary.living > 0 ? [{ category: LIVING_CATEGORY, amount: summary.living }] : []),
        ].reduce<Record<string, number>>((acc, item) => {
            acc[item.category] = (acc[item.category] ?? 0) + item.amount
            return acc
        }, {}),
    )
        .map(([category, amount]) => ({
            category,
            amount,
            ratio: summary.total > 0 ? amount / summary.total : 0,
        }))
        .sort((a, b) => b.amount - a.amount)

    return { ym, entries, charges, incomes, cardStatements, summary, expenseByCategory }
}
