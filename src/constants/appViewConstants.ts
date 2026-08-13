// ══════════ 화면 전환 상수 ══════════
// 한 페이지 안에서 세 화면을 상단 탭으로 오간다. (라우터를 붙이지 않은 단일 페이지 도구)
// tsconfig erasableSyntaxOnly 설정으로 enum 문법을 쓸 수 없어 const 객체 + 동일명 타입으로 대체한다.

/** 최상위 화면 */
export const AppView = {
    /** 1페이지 · 기본 진입 화면 — JEPQ 적립/배당 시뮬레이션 */
    COVERED_CALL: 'COVERED_CALL',
    /** 2페이지 — 가계부. 월별 수입/지출 기록 */
    LEDGER: 'LEDGER',
    /** 3페이지 — 분석. 차트를 걷어내 지금은 비어 있고 탭 전환만 된다 */
    ANALYSIS: 'ANALYSIS',
} as const

export type AppView = (typeof AppView)[keyof typeof AppView]

/** 화면별 표기 정보 — 탭에 번호·아이콘·이름을 함께 붙인다 */
export interface AppViewMeta {
    /** 탭 번호 — 사용자가 "1페이지"로 부르는 순번 */
    order: number
    label: string
    icon: string
    /** 탭 툴팁 — 그 화면이 무엇을 다루는지 */
    description: string
}

export const APP_VIEW_META: Record<AppView, AppViewMeta> = {
    [AppView.COVERED_CALL]: {
        order: 1,
        label: '계산기',
        icon: '📈',
        description: 'JEPQ 적립·배당 시뮬레이션',
    },
    [AppView.LEDGER]: {
        order: 2,
        label: '가계부',
        icon: '📒',
        description: '월별 수입·지출 기록',
    },
    [AppView.ANALYSIS]: {
        order: 3,
        label: '분석',
        icon: '📊',
        description: '준비 중',
    },
}

/** 탭 배치 순서 — 화면 왼쪽부터 1, 2, 3페이지 */
export const APP_VIEW_ORDER: AppView[] = [AppView.COVERED_CALL, AppView.LEDGER, AppView.ANALYSIS]
