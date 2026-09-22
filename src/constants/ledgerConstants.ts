import { LedgerKind } from '../types/ledger'

// ══════════ 가계부 공용 상수 ══════════

/** 구분별 분류 목록 — 직접 입력 대신 목록에서 고르게 해서 집계가 흩어지지 않게 한다 */
export const LEDGER_CATEGORIES: Record<LedgerKind, string[]> = {
    [LedgerKind.INCOME]: ['급여', '상여', '배당', '금융수익', '부수입', '기타수입'],
    [LedgerKind.EXPENSE]: [
        '식비', '주거/관리', '교통', '통신', '의료', '보험',
        '교육', '문화/여가', '여행', '쇼핑', '경조사', '저축/투자', '혜자', '기타지출',
    ],
}

/**
 * 생활비 분류명 — 사람이 고르는 값이 아니라 계산으로 채워지는 자리다.
 * 카드로 쓴 돈 중 "따로 적어 둔 큰 지출"로 설명되지 않는 나머지를 여기로 몰아,
 * 자잘한 결제를 한 건씩 적지 않아도 분류별 지출이 그 달 카드값 전체를 덮게 한다.
 */
export const LIVING_CATEGORY = '생활비'

/**
 * 대납 표기명 — 카드 정산에서 "내 돈이 아닌 결제"를 부르는 이름
 * 엄마 심부름으로 산 물건처럼, 카드값에는 들어 있지만 엄마 용돈에서 그만큼 빠지는 금액이다.
 */
export const ERRAND_LABEL = '엄마'

/** 구분 변경 시 기본으로 잡히는 분류 — 목록 첫 항목 */
export function toDefaultCategory(kind: LedgerKind): string {
    return LEDGER_CATEGORIES[kind][0]
}

/** 오늘 날짜 'YYYY-MM-DD' */
export function todayDate(): string {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

/** 오늘이 속한 달 'YYYY-MM' */
export function todayYm(): string {
    return todayDate().slice(0, 7)
}

/** 날짜 문자열에서 소속 월 추출 — '2026-08-12' → '2026-08' */
export function toYmOfDate(date: string): string {
    return date.slice(0, 7)
}

/**
 * 월 이동 — 'YYYY-MM' 에 개월 수를 더한 값
 * @param ym 기준 월
 * @param delta 더할 개월 수 (음수면 과거로)
 */
export function shiftYm(ym: string, delta: number): string {
    const parts = ym.split('-')
    const year = Number(parts[0])
    const month = Number(parts[1])
    if (!Number.isFinite(year) || !Number.isFinite(month)) return ym

    // 1) 0-based 월로 바꿔 계산한 뒤 다시 1-based 로 되돌린다 (연도 넘김을 Date 없이 처리)
    const zeroBased = (year * 12) + (month - 1) + delta
    return `${Math.floor(zeroBased / 12)}-${String((zeroBased % 12) + 1).padStart(2, '0')}`
}

/**
 * 두 달 사이의 개월 차 — toYm - fromYm
 * @param fromYm 기준 월 'YYYY-MM'
 * @param toYm 대상 월 'YYYY-MM'. 기준보다 과거면 음수를 돌려준다.
 */
export function monthDiff(fromYm: string, toYm: string): number {
    const from = fromYm.split('-')
    const to = toYm.split('-')
    const fromMonths = (Number(from[0]) * 12) + Number(from[1])
    const toMonths = (Number(to[0]) * 12) + Number(to[1])
    if (!Number.isFinite(fromMonths) || !Number.isFinite(toMonths)) return 0

    return toMonths - fromMonths
}

/** 그 달의 기본 입력 날짜 — 이번 달이면 오늘, 다른 달이면 1일 */
export function toDefaultDateOfYm(ym: string): string {
    return ym === todayYm() ? todayDate() : `${ym}-01`
}

/** 'YYYY-MM' → '2026년 8월' (제목 표기용) */
export function formatYmTitle(ym: string): string {
    const parts = ym.split('-')
    if (parts.length !== 2) return ym
    return `${parts[0]}년 ${Number(parts[1])}월`
}

/** 'YYYY-MM-DD' → '8/12' (목록 표기용) */
export function formatDateShort(date: string): string {
    const parts = date.split('-')
    if (parts.length !== 3) return date
    return `${Number(parts[1])}/${Number(parts[2])}`
}
