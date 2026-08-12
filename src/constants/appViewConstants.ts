// ══════════ 화면 전환 상수 ══════════
// 한 페이지 안에서 두 화면을 토글로 오간다. (라우터를 붙이지 않은 단일 페이지 도구)
// tsconfig erasableSyntaxOnly 설정으로 enum 문법을 쓸 수 없어 const 객체 + 동일명 타입으로 대체한다.

/** 최상위 화면 */
export const AppView = {
    /** 기본 진입 화면 — JEPQ 적립/배당 시뮬레이션 */
    COVERED_CALL: 'COVERED_CALL',
    /** 가계부 — 월별 수입/지출 기록 */
    LEDGER: 'LEDGER',
} as const

export type AppView = (typeof AppView)[keyof typeof AppView]

/** 화면별 표기 정보 — 토글 버튼이 "지금 화면"과 "갈 화면"을 함께 보여준다 */
export interface AppViewMeta {
    label: string
    icon: string
}

export const APP_VIEW_META: Record<AppView, AppViewMeta> = {
    [AppView.COVERED_CALL]: { label: '적립 계산기', icon: '📈' },
    [AppView.LEDGER]: { label: '가계부', icon: '📒' },
}

/** 토글 대상 화면 — 현재 화면의 반대편 */
export function toOppositeView(view: AppView): AppView {
    return view === AppView.COVERED_CALL ? AppView.LEDGER : AppView.COVERED_CALL
}