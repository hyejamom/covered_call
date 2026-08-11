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
    /** 누적 매수금액 + 그 시점 보유주를 한 칸에 함께 표기 */
    CUMULATIVE: '누적 매수금액(보유주)',
    BALANCE: '잔액(예수금)',
    DIVIDEND: '배당금(세후)',
} as const

export type RowLabel = (typeof RowLabel)[keyof typeof RowLabel]

/** 그리드 1개 행 정의 — 라벨 / 월별 결과에서 뽑을 필드 / 엑셀 표시 형식 */
export interface GridRowDef {
    label: RowLabel
    /**
     * 엑셀에 숫자로 기록할 필드.
     * 누적 매수금액 행은 금액과 보유주를 한 칸에 합쳐 쓰므로 숫자 필드가 없다(문자열로 기록).
     */
    field?: keyof Pick<MonthlyResult, 'balance' | 'dividendNet'>
    excelFormat?: string
}

/** 4) 세로 4칸 중 1~3행 정의 (0행은 연도 헤더) */
export const GRID_ROWS: GridRowDef[] = [
    { label: RowLabel.CUMULATIVE },
    { label: RowLabel.BALANCE, field: 'balance', excelFormat: '#,##0' },
    { label: RowLabel.DIVIDEND, field: 'dividendNet', excelFormat: '#,##0' },
]

/** 화면 렌더용 라벨 목록 */
export const ROW_LABELS: RowLabel[] = GRID_ROWS.map((row) => row.label)

/** 보유주 수 표기 — 1주 단위로만 매수하므로 정수 + 천단위 콤마 */
export function formatShareCount(shares: number): string {
    return `${Math.round(shares).toLocaleString('ko-KR')}개`
}