import type { InvestEvent } from './simulation'

// ══════════ 워크북 도메인 타입 ══════════
// 화면 구조와 엑셀 산출물이 1:1로 대응한다.
//   워크북(그룹) 1개  = 엑셀 파일 1개
//   워크북 안의 탭 1개 = 엑셀 워크시트 1장

/** 시트 탭 1개 — 엑셀 워크시트 1장에 대응 */
export interface SheetTab {
    id: string
    name: string
    /**
     * 이 시트 주인의 생년월 — 'YYYY-MM' 형식, 빈 문자열이면 미지정.
     * 연도 헤더에 나이를 함께 표기하는 데만 쓰이며 시뮬레이션 계산에는 영향이 없다.
     */
    birthYm: string
    /** 이 탭만의 투입 이벤트. 고정 상수(시세·세금)는 전 탭 공통이라 여기 담지 않는다. */
    events: InvestEvent[]
}

/** 워크북 1개 — 엑셀 파일 1개에 대응 */
export interface Workbook {
    id: string
    /** 다운로드 파일명에 쓰이는 이름 */
    name: string
    /**
     * 시뮬레이션 / 그리드 대상 시작 연도.
     * 과세 판정이 파일 안 모든 시트의 배당 합산 기준이라, 기간도 시트별이 아니라 파일 단위로 잡는다.
     */
    startYear: number
    /** 시뮬레이션 / 그리드 대상 종료 연도 (시작 연도 이상) */
    endYear: number
    tabs: SheetTab[]
}

/** 시트 탭 드래그 페이로드 — 어느 파일의 어느 시트를 끌고 있는지 */
export interface SheetTabDragPayload {
    workbookId: string
    tabId: string
}