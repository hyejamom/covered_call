import { INFLATION_POLICY } from './simulationDefaults'
import type { MonthlyResult } from '../types/simulation'

// ══════════ 그리드 공용 상수 ══════════
// 화면(App.tsx)과 엑셀 내보내기(excelService.ts)가 동일한 정의를 공유한다.

/**
 * 시뮬레이션 / 그리드 대상 기간의 기본값
 * — 실제 기간은 파일(워크북)마다 따로 들고 있고, 필터에서 사용자가 바꾼다.
 *   여기 값은 새 파일을 만들거나 예전 저장본에 기간 정보가 없을 때만 쓰인다.
 */
export const DEFAULT_START_YEAR = 2026
export const DEFAULT_END_YEAR = 2050

/** 기간 드롭다운에서 고를 수 있는 연도의 상·하한 */
export const MIN_SELECTABLE_YEAR = 2000
export const MAX_SELECTABLE_YEAR = 2100

/**
 * 시작~종료 연도 목록 생성
 * @param startYear 시작 연도
 * @param endYear 종료 연도. 시작보다 작으면 시작 연도 1개짜리 목록을 돌려준다.
 */
export function buildYears(startYear: number, endYear: number): number[] {
    if (endYear < startYear) return [startYear]
    return Array.from({ length: endYear - startYear + 1 }, (_, index) => startYear + index)
}

/**
 * 연도를 선택 가능 범위 안으로 가둔다
 * @param year 검사할 연도
 */
export function clampYear(year: number): number {
    if (!Number.isFinite(year)) return DEFAULT_START_YEAR
    return Math.min(MAX_SELECTABLE_YEAR, Math.max(MIN_SELECTABLE_YEAR, Math.round(year)))
}

/** 1) 기간 드롭다운용 선택 가능 연도 목록 */
export const SELECTABLE_YEARS: number[] = buildYears(MIN_SELECTABLE_YEAR, MAX_SELECTABLE_YEAR)

/** 2) 가로 13칸 중 1~12칸에 들어갈 월 라벨 (하드코딩) */
export const MONTH_LABELS: string[] = [
    '1월', '2월', '3월', '4월', '5월', '6월',
    '7월', '8월', '9월', '10월', '11월', '12월',
]

/** 3) 1~12월 인덱스 목록 — 셀 렌더 루프용 */
export const MONTH_NUMBERS: number[] = Array.from({ length: 12 }, (_, index) => index + 1)

/** 그리드 세로 라벨 (0열에 표시되는 항목명) — tsconfig erasableSyntaxOnly 로 enum 대신 const 객체 사용 */
export const RowLabel = {
    /** 확정수익 자산 평가액 — 확정수익 구간이 있는 시트에서만 노출된다 */
    GROWTH: '확정수익 평가액',
    /** 누적 매수금액 + 그 시점 보유주를 한 칸에 함께 표기 */
    CUMULATIVE: '누적금액(보유주)',
    /**
     * ISA 계좌 전용 — 내 주머니에서 실제로 나간 돈의 누계 (누적 납입금 − 누적 배당 인출액).
     * '누적금액'은 재투자된 배당까지 섞여 있어 "내가 얼마를 넣었나"를 답해 주지 못한다.
     * 예) 20만원 × 20개월 = 400만원을 넣고 그 사이 배당 2만원을 꺼냈다면 이 행은 398만원이다.
     * 일반 계좌(JEPQ)에는 붙이지 않는다 — 납입한도가 없어 "얼마를 넣었나"를 따로 세울 이유가 없다.
     */
    NET_CONTRIBUTION: '순금액(납입−배당)',
    BALANCE: '잔액(예수금)',
    /** 세후 배당을 기준연도 화폐가치로 환산한 금액 — 라벨의 물가상승률은 INFLATION_POLICY.RATE_PERCENT 를 따라간다 */
    DIVIDEND_REAL: `배당금(물가상승률${INFLATION_POLICY.RATE_PERCENT}%)`,
    /** 일반 계좌 — 지급 시점에 원천징수를 떼고 계좌에 들어온 금액 */
    DIVIDEND: '배당금(세후)',
    /**
     * ISA 계좌 — 지급 시점에 떼는 세금이 아예 없어 세전·세후를 나눌 것이 없다.
     * 그래서 꾸밈말 없이 "배당금"으로만 둔다 (일반 계좌만 "세후"를 붙인다).
     */
    DIVIDEND_ISA: '배당금',
    /** 월 정액 인출 구간에서만 노출 — 그 달 실제로 꺼낸 금액 */
    WITHDRAW_PAID: '인출액(생활비)',
    /**
     * 월 정액 인출 구간에서만 노출 — 계좌에 남은 총액(주식 평가 + 예수금 + 배당현금).
     * 인출 시나리오에서는 "얼마 남았나"가 핵심이고, 이 값이 0 이 되는 달이 곧 고갈 시점이다.
     * 누적 매수금액은 주식을 팔아도 줄지 않으므로 잔액 판단에 쓸 수 없다.
     */
    REMAINING: '계좌 잔액(평가액)',
} as const

export type RowLabel = (typeof RowLabel)[keyof typeof RowLabel]

/**
 * 명목 배당 행인지 — 계좌 유형에 따라 라벨이 둘로 갈리므로 판정을 한곳에 모은다
 * @param label 검사할 행 라벨
 */
export function isNominalDividendRow(label: RowLabel): boolean {
    return label === RowLabel.DIVIDEND || label === RowLabel.DIVIDEND_ISA
}

/** 그리드 1개 행 정의 — 라벨 / 월별 결과에서 뽑을 필드 / 엑셀 표시 형식 */
export interface GridRowDef {
    label: RowLabel
    /**
     * 엑셀에 숫자로 기록할 필드.
     * 누적 매수금액 행은 금액과 보유주를 한 칸에 합쳐 쓰므로 숫자 필드가 없다(문자열로 기록).
     */
    field?: keyof Pick<
        MonthlyResult,
        'balance' | 'dividendNet' | 'dividendReal' | 'growthBalance' | 'netContribution'
        | 'withdrawPaid' | 'accountRemaining'
    >
    excelFormat?: string
}

/**
 * 4) 일반 계좌(JEPQ) 기준 행 정의 (0행은 연도 헤더)
 * — 배당 행은 미국 원천징수 15% 를 떼고 계좌에 실제로 들어온 금액(dividendNet)이라 라벨에 "세후"가 붙는다.
 */
export const GRID_ROWS: GridRowDef[] = [
    { label: RowLabel.CUMULATIVE },
    { label: RowLabel.BALANCE, field: 'balance', excelFormat: '#,##0' },
    // 실질가치 행은 명목 배당 바로 위에 두어 "이 금액이 지금 돈으로는 얼마인지"를 나란히 읽게 한다
    { label: RowLabel.DIVIDEND_REAL, field: 'dividendReal', excelFormat: '#,##0' },
    { label: RowLabel.DIVIDEND, field: 'dividendNet', excelFormat: '#,##0' },
]

/**
 * 4-1) ISA 계좌용 행 정의 — 일반 계좌와 두 군데가 다르다.
 *   1) 뗄 세금이 없어 배당 행 라벨에서 "세후"가 떨어진다
 *   2) 납입한도가 걸린 계좌라 "내가 넣은 돈이 얼마인지"가 중요해 순금액 행이 하나 더 붙는다
 */
export const ISA_GRID_ROWS: GridRowDef[] = [
    { label: RowLabel.CUMULATIVE },
    // 누적금액 바로 아래에 두어 "이 중 내 돈은 얼마인지"를 나란히 읽게 한다
    { label: RowLabel.NET_CONTRIBUTION, field: 'netContribution', excelFormat: '#,##0' },
    { label: RowLabel.BALANCE, field: 'balance', excelFormat: '#,##0' },
    { label: RowLabel.DIVIDEND_REAL, field: 'dividendReal', excelFormat: '#,##0' },
    { label: RowLabel.DIVIDEND_ISA, field: 'dividendNet', excelFormat: '#,##0' },
]

/**
 * 확정수익 행 정의 — 모든 시트에 필요한 행이 아니라서 GRID_ROWS 와 분리해 둔다.
 * 확정수익 구간을 쓰지 않는 시트에 붙이면 0 만 늘어선 행이 생겨 오히려 표가 지저분해진다.
 */
export const GROWTH_ROW: GridRowDef = {
    label: RowLabel.GROWTH,
    field: 'growthBalance',
    excelFormat: '#,##0',
}

/**
 * 월 정액 인출 행 정의 — 인출 계획이 있는 시트에만 붙인다.
 * 그 달 실제로 꺼낸 금액이라, 재원이 모자란 달에는 목표액보다 작게 찍히고 끝내 0 이 된다.
 */
export const WITHDRAW_PAID_ROW: GridRowDef = {
    label: RowLabel.WITHDRAW_PAID,
    field: 'withdrawPaid',
    excelFormat: '#,##0',
}

/**
 * 계좌 잔액 행 정의 — 인출 계획이 있는 시트에만 붙인다.
 * 이 행이 0 으로 떨어지는 달이 곧 "더 이상 뽑을 수 없는" 시점이다.
 */
export const REMAINING_ROW: GridRowDef = {
    label: RowLabel.REMAINING,
    field: 'accountRemaining',
    excelFormat: '#,##0',
}

/** 그리드 행 구성 조건 — 시트마다 붙는 행이 달라 인자를 묶어 넘긴다 */
export interface GridRowOptions {
    /** 이 시트에 확정수익 구간이 있는지. true 면 확정수익 행을 맨 위에 얹는다 */
    hasGrowth: boolean
    /** ISA 계좌인지. 배당 행 라벨에서 "세후"가 떨어지고 순금액 행이 하나 더 붙는다 */
    isIsa: boolean
    /** 월 정액 인출 계획이 있는지. true 면 인출액 + 계좌 잔액 행을 얹는다 */
    hasWithdrawSchedule: boolean
}

/**
 * 시트 상황에 맞는 행 목록 조립 — 화면 그리드와 엑셀이 같은 함수를 쓴다
 * @param options 확정수익 구간 / 계좌 유형 / 인출 계획 여부
 */
export function buildGridRows(options: GridRowOptions): GridRowDef[] {
    const rows = [...(options.isIsa ? ISA_GRID_ROWS : GRID_ROWS)]

    // 1) 인출 계획이 있으면 "얼마 꺼냈고 얼마 남았는지"를 맨 아래에 이어 붙인다.
    //    계좌 잔액을 마지막에 두어 0 으로 떨어지는 지점이 표 끝에서 바로 읽히게 한다.
    if (options.hasWithdrawSchedule) rows.push(WITHDRAW_PAID_ROW, REMAINING_ROW)

    // 2) 확정수익 평가액은 성격이 다른 별도 통이라 맨 위에 올린다
    return options.hasGrowth ? [GROWTH_ROW, ...rows] : rows
}

/** 화면 렌더용 라벨 목록 (확정수익 행 제외 기본 구성) */
export const ROW_LABELS: RowLabel[] = GRID_ROWS.map((row) => row.label)

/** 보유주 수 표기 — 1주 단위로만 매수하므로 정수 + 천단위 콤마 */
export function formatShareCount(shares: number): string {
    return `${Math.round(shares).toLocaleString('ko-KR')}개`
}