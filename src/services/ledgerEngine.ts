import { monthDiff } from '../constants/ledgerConstants'
import {
    FixedCostType,
    type CardMonthlyStatement,
    type CardStatement,
    type FixedCost,
    type FixedCostCharge,
    type LedgerCard,
} from '../types/ledger'

// ══════════ 고정비 · 카드 정산 계산 ══════════
//
// [진짜 고정비]  시작 월부터 끝나는 날 없이 매월 같은 금액이 빠진다.
// [할부]        시작 월이 1회차이고, 개월 수만큼만 빠진 뒤 끝난다.
//                입력은 "원금 총액 + 개월 수"로 받고 월 납입금은 여기서 나눈다.
//                나눠떨어지지 않는 나머지는 마지막 회차에 몰아 총액이 정확히 맞아떨어지게 한다.
// [실제 사용액]  카드 명세서 총액(직접 입력) - 그 달 할부 합계.
//                할부는 과거에 쓴 돈이 이번 달에 청구된 것이라, 빼야 "이번 달에 새로 쓴 돈"이 남는다.

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

    // 2) 진짜 고정비 — 끝나는 시점이 없으므로 시작 이후 매월 같은 금액
    if (cost.type === FixedCostType.RECURRING) {
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
 * 카드별 그 달 정산 — 명세서 총액에서 할부를 걷어내 "이번 달에 새로 쓴 금액"을 뽑는다
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

        // 2) 직접 입력한 명세서 총액 — 아직 안 적었으면 실제 사용액도 구할 수 없다
        const found = statements.find((statement) => statement.cardId === card.id && statement.ym === ym)
        const total = found?.total ?? null

        return {
            card,
            total,
            installment,
            recurring,
            actual: total === null ? null : total - installment,
        }
    })
}