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
    /**
     * 주력 종목의 연 주가 변동률 (%) — 0 이면 주가 고정, 음수면 매년 그만큼 깎인다.
     * 주가가 움직이면 주당 배당도 같은 비율로 따라가므로(배당률 유지) 총수익만 그만큼 달라진다.
     *
     * 두 종목 모두 커버드콜이지만 콜을 파는 방식이 달라 기본값이 갈린다 (assetConstants 의 defaultDriftPercent).
     *   · TIGER 441680 : 등가격 콜을 100% 파는 구조라 상승 여력이 거의 안 남는다.
     *                    같은 구조인 QYLD 의 12.8년 실적을 따라 기본값이 음수(-2.5%)다.
     *   · JEPQ         : ELN 으로 외가격 콜을 일부만 팔아 상승 여력을 상당 부분 남긴다.
     *                    지금 분배율에서 총수익이 기초지수와 맞물리는 지점인 0% 를 기본값으로 둔다.
     * 시나리오 비교용 값이라 파일(워크북)마다 따로 잡으며,
     * 화면에서는 보수 · 중립 · 낙관 프리셋(assetConstants 의 DRIFT_PRESETS)으로 눌러 바꾼다.
     */
    sharePriceDriftPercent: number
    tabs: SheetTab[]
}

/** 시트 탭 드래그 페이로드 — 어느 파일의 어느 시트를 끌고 있는지 */
export interface SheetTabDragPayload {
    workbookId: string
    tabId: string
}