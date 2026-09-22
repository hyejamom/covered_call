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
     * 기본값은 종목 성격에 따라 갈린다 (assetConstants 의 defaultDriftPercent).
     *   · 커버드콜(JEPQ)     : 분배금을 NAV 에서 꺼내 쓰는 구조라 상승장에서도 주가가 제자리이거나 서서히 밀린다.
     *                          기본 0 으로 두고, 시나리오마다 음수로 내려 NAV 침식을 반영해 본다.
     *   · 나스닥100(TIGER)   : 분배금이 거의 없는 성장형 지수라 수익 대부분이 주가에서 나온다.
     *                          0 으로 두면 사실상 원금만 쌓는 셈이라 기본값을 장기 평균 상승률로 잡는다.
     * 시나리오 비교용 값이라 파일(워크북)마다 따로 잡는다.
     */
    sharePriceDriftPercent: number
    tabs: SheetTab[]
}

/** 시트 탭 드래그 페이로드 — 어느 파일의 어느 시트를 끌고 있는지 */
export interface SheetTabDragPayload {
    workbookId: string
    tabId: string
}