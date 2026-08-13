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
    /**
     * 종료 월 'YYYY-MM' — 이 달까지 청구되고 끝난다. 빈 문자열이면 무기한.
     * RECURRING 전용이다. 할부는 개월 수가 끝을 정하므로 이 값을 보지 않는다.
     *
     * 요금제가 바뀌면 이 값을 전월로 찍고 새 금액의 항목을 다음 달부터 새로 만든다.
     * 금액 하나를 덮어쓰면 이미 결산이 끝난 과거 달의 합계까지 소급해 흔들리기 때문이다.
     */
    endYm: string
    /** 할부 개월 수 — INSTALLMENT 전용. RECURRING 은 0 */
    months: number
    /**
     * 금액 (원)
     * — RECURRING: 매월 빠지는 금액
     * — INSTALLMENT: 할부 원금 총액. 월 납입금은 개월 수로 나눠 자동 산출한다.
     */
    amount: number
}

// ┣━━━━━━━━━━━━━━━━ 고정 수입 ━━━━━━━━━━━━━━━━━━┫

/**
 * 고정 수입 1건 — 급여·월세수입처럼 시작 월부터 매월 같은 금액이 들어온다.
 * 고정비(FixedCost)의 수입 쪽 대칭 개념이라, 등록해 두면 매달 자동으로 그 달 수입에 잡힌다.
 */
export interface FixedIncome {
    id: string
    /** 항목명 — '급여', '월세수입' */
    name: string
    /** 분류 — 수입 분류 목록에서 고른다 */
    category: string
    /** 시작 월 'YYYY-MM' — 이 달부터 매월 잡힌다 */
    startYm: string
    /** 매월 들어오는 금액 (원) */
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
    /** 그 달 이 카드로 자동 빠지는 합계 = 할부 + 고정비 */
    autoCharged: number
    /** 실제 사용한 금액 = 청구 총액 - (할부 + 고정비). 총액 미입력이면 null */
    actual: number | null
}

/**
 * 월 요약 — 이 가계부의 목적인 "이번 달 얼마나 남길 수 있나"를 한 줄로 세운 값
 *
 *   총지출 = 고정비·할부 + 카드 사용 + (카드 밖으로 나간 직접 입력 지출)
 *   저축 가능액 = (수입 + 고정 수입) - 총지출
 *
 * 직접 입력한 지출은 보통 카드로 긁은 큰 건이라 카드 사용액 안에 이미 들어 있다.
 * 그래서 따로 더하지 않고, 카드 사용액에서 직접 입력분을 뺀 나머지를 생활비로 본다.
 */
export interface LedgerMonthSummary {
    /** 직접 입력한 항목의 수입 합계 */
    income: number
    /** 그 달 자동으로 들어오는 고정 수입 합계 */
    fixedIncome: number
    /** 직접 입력한 항목의 지출 합계 — 따로 적어 둔 "큰 지출" */
    expense: number
    /** 그 달 자동 청구되는 고정비 + 할부 합계 */
    fixed: number
    /** 그 달 카드로 새로 쓴 금액 합계 = Σ(명세서 총액 - 그 카드의 할부·고정비) */
    cardUsed: number
    /** 생활비 = 카드 사용액 중 직접 입력한 큰 지출로 설명되지 않는 나머지 */
    living: number
    /** 총지출 = 고정비·할부 + 직접 입력 지출 + 생활비 */
    total: number
    /** 저축 가능액 = (수입 + 고정 수입) - 총지출 (음수면 적자) */
    net: number
}

/** 분류별 지출 집계 1건 — 어디에 얼마를 썼는지 표기용 */
export interface LedgerCategorySummary {
    category: string
    amount: number
    /** 그 달 총지출 대비 비중 (0~1) */
    ratio: number
}

/**
 * 가계부 원본 데이터 한 벌 — 계산에 필요한 입력 전부
 * 저장 스냅샷(LedgerSnapshot)과 같은 모양이라, 저장본을 그대로 계산 함수에 넘길 수 있다.
 */
export interface LedgerData {
    entries: LedgerEntry[]
    cards: LedgerCard[]
    fixedCosts: FixedCost[]
    fixedIncomes: FixedIncome[]
    statements: CardStatement[]
}

/**
 * 한 달치 집계 결과 한 벌 — 화면·엑셀이 같은 값을 보도록 계산을 한 곳에 모은 것
 * 가계부 화면은 선택된 달 하나를, 엑셀 내보내기는 고른 기간의 달마다 하나씩 만들어 쓴다.
 */
export interface LedgerMonthReport {
    /** 대상 월 'YYYY-MM' */
    ym: string
    /** 그 달 직접 입력한 입출금 항목 (날짜 내림차순) */
    entries: LedgerEntry[]
    /** 그 달 청구되는 고정비·할부 */
    charges: FixedCostCharge[]
    /** 그 달 들어오는 고정 수입 */
    incomes: FixedIncome[]
    /** 카드별 그 달 정산 */
    cardStatements: CardMonthlyStatement[]
    summary: LedgerMonthSummary
    expenseByCategory: LedgerCategorySummary[]
}

// ┣━━━━━━━━━━━━━━━━ 분석(차트) 타입 ━━━━━━━━━━━━━┫

/** 분석 차트의 한 점 = 한 달치 집계 */
export interface LedgerMonthPoint {
    /** 대상 월 'YYYY-MM' */
    ym: string
    /** 그 달 수입 = 직접 입력분 + 고정 수입 */
    income: number
    /** 그 달 총지출 = 고정비/할부 + 직접 입력분 + 생활비(카드 사용액의 나머지) */
    expense: number
    /** 수입 - 지출 (음수면 적자) */
    net: number
    /** 기록이 하나라도 있는 달인지 — 아직 안 적은 달을 평균에서 빼는 데 쓴다 */
    recorded: boolean
}

/** 선택한 기간 전체 집계 — 분석 화면이 통째로 받아 쓰는 묶음 */
export interface LedgerRangeSummary {
    /** 기간 내 월별 집계 — 과거 → 현재 순 */
    points: LedgerMonthPoint[]
    /** 기록이 있는 달 수 — 평균의 분모 */
    recordedCount: number
    /** 기간 합계 */
    totalIncome: number
    totalExpense: number
    totalNet: number
    /** 기록이 있는 달 기준 월평균 */
    avgIncome: number
    avgExpense: number
    avgNet: number
    /** 저축률 = 총 순저축 / 총 수입 (수입이 0이면 0) */
    savingRate: number
    /** 기간 내 분류별 지출 순위 */
    categories: LedgerCategorySummary[]
}