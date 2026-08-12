// ══════════ 가계부 도메인 타입 ══════════
// tsconfig erasableSyntaxOnly 설정으로 enum 문법을 쓸 수 없어 const 객체 + 동일명 타입으로 대체한다.

/** 입출금 구분 */
export const LedgerKind = {
    /** 들어온 돈 */
    INCOME: 'INCOME',
    /** 나간 돈 */
    EXPENSE: 'EXPENSE',
} as const

export type LedgerKind = (typeof LedgerKind)[keyof typeof LedgerKind]

/** 구분별 화면 표기명 */
export const LEDGER_KIND_LABEL: Record<LedgerKind, string> = {
    [LedgerKind.INCOME]: '수입',
    [LedgerKind.EXPENSE]: '지출',
}

/** 가계부 항목 1건 */
export interface LedgerEntry {
    /** 리스트 조작용 고유 키 */
    id: string
    /** 발생일 — 'YYYY-MM-DD' 형식. 앞 7자리가 곧 소속 월(YYYY-MM)이 된다. */
    date: string
    kind: LedgerKind
    /** 분류 — 구분에 따라 고를 수 있는 목록이 다르다 */
    category: string
    /** 내용 메모 (빈 문자열 허용) */
    memo: string
    /** 금액 (원) — 항상 양수로 보관하고, 수입/지출 방향은 kind 가 담당한다 */
    amount: number
}

// ┣━━━━━━━━━━━━━━━━ 카드 · 고정비 ━━━━━━━━━━━━━━━┫

/** 결제 카드 1장 — 고정비/할부가 어느 카드에서 빠지는지 묶는 단위 */
export interface LedgerCard {
    id: string
    /** 카드 이름 — '신한 딥드림', '현대 M' 처럼 명세서와 대조할 수 있게 적는다 */
    name: string
}

/** 고정비 형태 */
export const FixedCostType = {
    /** ① 진짜 고정비 — 교통비·보험처럼 끝나는 날 없이 매월 같은 금액이 빠진다 */
    RECURRING: 'RECURRING',
    /** ② 할부 — 시작 월부터 정해진 개월 수만큼만 빠지고 끝난다 */
    INSTALLMENT: 'INSTALLMENT',
} as const

export type FixedCostType = (typeof FixedCostType)[keyof typeof FixedCostType]

/** 고정비 형태별 화면 표기명 */
export const FIXED_COST_TYPE_LABEL: Record<FixedCostType, string> = {
    [FixedCostType.RECURRING]: '고정비',
    [FixedCostType.INSTALLMENT]: '할부',
}

/** 고정비 1건 — 매월 자동으로 그 달 지출에 잡힌다 */
export interface FixedCost {
    id: string
    type: FixedCostType
    /** 항목명 — '교통비', '실손보험', '노트북 할부' */
    name: string
    /** 결제 카드 id — 카드가 아닌 계좌이체/현금이면 빈 문자열 */
    cardId: string
    /** 분류 — 지출 분류 목록에서 고른다 (분류별 집계에 함께 잡힌다) */
    category: string
    /** 시작 월 'YYYY-MM' — 할부는 이 달이 1회차다 */
    startYm: string
    /** 할부 개월 수 — INSTALLMENT 전용. RECURRING 은 0 */
    months: number
    /**
     * 금액 (원)
     * — RECURRING: 매월 빠지는 금액
     * — INSTALLMENT: 할부 원금 총액. 월 납입금은 개월 수로 나눠 자동 산출한다.
     */
    amount: number
}

/** 카드 월 청구 총액 — 명세서에 찍힌 금액을 사용자가 직접 적어 넣는다 */
export interface CardStatement {
    cardId: string
    /** 청구 월 'YYYY-MM' */
    ym: string
    /** 그 달 청구 총액 (원) */
    total: number
}

// ┣━━━━━━━━━━━━━━━━ 파생(계산) 타입 ━━━━━━━━━━━━┫

/** 특정 달에 실제로 청구되는 고정비 1건 */
export interface FixedCostCharge {
    cost: FixedCost
    /** 그 달의 청구 금액 (원) — 할부는 월 납입금 */
    amount: number
    /** 할부 진행 회차 (1부터). 진짜 고정비는 0 */
    round: number
}

/** 카드 1장의 그 달 정산 */
export interface CardMonthlyStatement {
    card: LedgerCard
    /** 직접 입력한 청구 총액. 아직 안 적었으면 null */
    total: number | null
    /** 그 달 이 카드에 걸린 할부 합계 */
    installment: number
    /** 그 달 이 카드에 걸린 진짜 고정비 합계 */
    recurring: number
    /** 실제 사용한 금액 = 청구 총액 - 할부 합계. 총액 미입력이면 null */
    actual: number | null
}

/** 월 요약 — 수입/지출 합계와 잔액 */
export interface LedgerMonthSummary {
    income: number
    /** 직접 입력한 항목의 지출 합계 */
    expense: number
    /** 그 달 자동 청구되는 고정비 + 할부 합계 */
    fixed: number
    /** 수입 - 지출 - 고정비 (음수면 적자) */
    net: number
}

/** 분류별 지출 집계 1건 — 어디에 얼마를 썼는지 표기용 */
export interface LedgerCategorySummary {
    category: string
    amount: number
    /** 그 달 총지출 대비 비중 (0~1) */
    ratio: number
}