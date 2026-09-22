import { LIVING_CATEGORY, shiftYm, toYmOfDate } from '../constants/ledgerConstants'
import { toCardUsedOfMonth, toChargesOfMonth, toIncomesOfMonth, toLivingCost } from './ledgerEngine'
import {
    LedgerKind,
    type CardErrand,
    type CardStatement,
    type FixedCost,
    type FixedIncome,
    type LedgerCategorySummary,
    type LedgerEntry,
    type LedgerMonthPoint,
    type LedgerRangeSummary,
} from '../types/ledger'

// ══════════ 가계부 분석 집계 ══════════
//
// 가계부 화면은 "선택한 한 달"만 계산하지만, 분석 화면은 여러 달을 나란히 놓고 본다.
// 그래서 월 요약과 똑같은 규칙을 달마다 반복 적용해 시계열로 편다.
//
//   수입   = 직접 입력 수입 + 고정 수입
//   총지출 = 고정비·할부 + 직접 입력 지출 + 생활비(카드 사용액 중 직접 입력분으로 설명 안 되는 나머지)
//
// [기록 없는 달] 아직 아무것도 안 적은 달은 0원으로 그리되 평균의 분모에서는 빼야 한다.
//                안 그러면 가계부를 늦게 시작했다는 이유만으로 월평균이 반토막 난다.

/** 분석 화면에서 고를 수 있는 기간 (개월 수) */
export const ANALYSIS_RANGES: number[] = [6, 12, 24]

// ┣━━━━━━━━━━━━━━━━ 내부 유틸 ━━━━━━━━━━━━━━━━━┫

/**
 * 기간에 포함되는 달 목록 — 과거 → 현재 순
 * @param endYm 마지막 달 'YYYY-MM' (보통 이번 달)
 * @param months 개월 수
 */
function toYmRange(endYm: string, months: number): string[] {
    return Array.from({ length: months }, (_, index) => shiftYm(endYm, index - (months - 1)))
}

// ┣━━━━━━━━━━━━━━━━ API ━━━━━━━━━━━━━━━━━━━━━━━┫

/**
 * 기간 집계 — 월별 시계열 + 합계/평균 + 분류별 지출 순위를 한 번에 만든다
 * @param entries 직접 입력한 입출금 항목 전체
 * @param fixedCosts 등록된 고정비/할부 전체
 * @param fixedIncomes 등록된 고정 수입 전체
 * @param statements 직접 입력한 카드 월 청구 총액 전체 (생활비 산출용)
 * @param errands 직접 입력한 대납(엄마 심부름) 전체 — 카드 사용액에서 걷어낸다
 * @param endYm 기간의 마지막 달 'YYYY-MM'
 * @param months 기간 길이 (개월)
 */
export function toRangeSummary(
    entries: LedgerEntry[],
    fixedCosts: FixedCost[],
    fixedIncomes: FixedIncome[],
    statements: CardStatement[],
    errands: CardErrand[],
    endYm: string,
    months: number,
): LedgerRangeSummary {
    // 1) 달마다 훑지 않도록 입출금 항목을 월별로 한 번만 묶어 둔다
    const entriesByYm = entries.reduce<Record<string, LedgerEntry[]>>((acc, entry) => {
        const ym = toYmOfDate(entry.date)
        acc[ym] = acc[ym] ?? []
        acc[ym].push(entry)
        return acc
    }, {})

    // 2) 분류별 지출 누적 — 기간 전체를 훑으며 여기에 쌓는다
    const categoryTotals: Record<string, number> = {}

    /** 분류별 누적에 한 건 더하기 — @param category 분류, @param amount 금액 */
    const addCategory = (category: string, amount: number) => {
        categoryTotals[category] = (categoryTotals[category] ?? 0) + amount
    }

    // 3) 월별 집계 — 가계부 화면과 같은 규칙을 달마다 적용한다
    const points: LedgerMonthPoint[] = toYmRange(endYm, months).map((ym) => {
        const ofMonth = entriesByYm[ym] ?? []

        // 3-1) 직접 입력분 — 수입/지출로 갈라 합산
        const directIncome = ofMonth
            .filter((entry) => entry.kind === LedgerKind.INCOME)
            .reduce((sum, entry) => sum + entry.amount, 0)
        const directExpense = ofMonth
            .filter((entry) => entry.kind === LedgerKind.EXPENSE)
            .reduce((sum, entry) => sum + entry.amount, 0)

        // 3-2) 자동으로 잡히는 분 — 그 달 고정 수입 / 고정비·할부
        const charges = toChargesOfMonth(fixedCosts, ym)
        const fixedExpense = charges.reduce((sum, charge) => sum + charge.amount, 0)
        const fixedIncome = toIncomesOfMonth(fixedIncomes, ym)
            .reduce((sum, income) => sum + income.amount, 0)

        // 3-3) 생활비 — 카드로 쓴 돈 중 직접 입력한 큰 지출로 설명되지 않는 나머지
        //      카드 사용액에서 대납(엄마 심부름)은 이미 빠져 있다 — 엄마 용돈으로 이미 한 번 잡힌 돈이다
        const cardUsed = toCardUsedOfMonth(charges, statements, errands, ym)
        const living = toLivingCost(cardUsed, directExpense)

        // 3-4) 분류별 누적 — 고정비 · 직접 입력분 · 뭉친 생활비를 한 통에 담는다
        ofMonth
            .filter((entry) => entry.kind === LedgerKind.EXPENSE)
            .forEach((entry) => addCategory(entry.category, entry.amount))
        charges.forEach((charge) => addCategory(charge.cost.category, charge.amount))
        if (living > 0) addCategory(LIVING_CATEGORY, living)

        const income = directIncome + fixedIncome
        const expense = fixedExpense + directExpense + living

        return {
            ym,
            income,
            expense,
            net: income - expense,
            // 3-5) 기록 판정 — 직접 입력이든 자동 청구든 카드 명세서든 무엇이든 잡혔으면 "기록이 있는 달"
            recorded: ofMonth.length > 0 || fixedExpense > 0 || fixedIncome > 0 || cardUsed > 0,
        }
    })

    // 4) 합계 — 기간 전체
    const totalIncome = points.reduce((sum, point) => sum + point.income, 0)
    const totalExpense = points.reduce((sum, point) => sum + point.expense, 0)

    // 5) 평균 — 기록이 있는 달만 분모로 쓴다 (0으로 나누지 않도록 최소 1)
    const recordedCount = points.filter((point) => point.recorded).length
    const divisor = Math.max(recordedCount, 1)

    // 6) 분류별 지출 순위 — 기간 총지출 대비 비중
    const categories: LedgerCategorySummary[] = Object.entries(categoryTotals)
        .map(([category, amount]) => ({
            category,
            amount,
            ratio: totalExpense > 0 ? amount / totalExpense : 0,
        }))
        .sort((a, b) => b.amount - a.amount)

    return {
        points,
        recordedCount,
        totalIncome,
        totalExpense,
        totalNet: totalIncome - totalExpense,
        avgIncome: Math.round(totalIncome / divisor),
        avgExpense: Math.round(totalExpense / divisor),
        avgNet: Math.round((totalIncome - totalExpense) / divisor),
        savingRate: totalIncome > 0 ? (totalIncome - totalExpense) / totalIncome : 0,
        categories,
    }
}
