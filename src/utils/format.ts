// ══════════ 표시용 포맷터 ══════════

/** 원 단위 정수 + 천단위 콤마 — 그리드 셀·툴팁·입력 보조 문구 공통 */
export function formatKrw(value: number): string {
    return Math.round(value).toLocaleString('ko-KR')
}

/** 보유 주식 수 — 1주 단위로만 매수하므로 정수 표기 */
export function formatShares(value: number): string {
    return Math.round(value).toLocaleString('ko-KR')
}

/**
 * 생년월 + 대상 연도 → 그 해 만 나이
 * — 그 해 생일이 지난 시점을 기준으로 하므로 "연도 - 출생연도"가 된다.
 *   (예: 1993년 1월생 → 2026년 33세). 시뮬레이션 개시 연도와는 무관하게 계산한다.
 * @param birthYm 'YYYY-MM' 생년월 (빈 값/형식 불일치면 null)
 * @param year 대상 연도
 */
export function toAgeInYear(birthYm: string, year: number): number | null {
    const parts = birthYm.split('-')
    if (parts.length !== 2) return null

    const birthYear = Number(parts[0])
    if (!Number.isFinite(birthYear)) return null

    const age = year - birthYear
    return age >= 0 ? age : null
}

/** 'YYYY-MM' → '2026년 8월' 형태로 변환 (툴팁용) */
export function formatYmLabel(ym: string): string {
    const parts = ym.split('-')
    if (parts.length !== 2) return ym
    return `${parts[0]}년 ${Number(parts[1])}월`
}