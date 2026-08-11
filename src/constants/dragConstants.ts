// ══════════ 드래그 앤 드롭 MIME 타입 ══════════
// dragover 시점에는 브라우저가 dataTransfer.getData()를 막아두고 types 목록만 열어준다.
// 그래서 "지금 무엇을 끌고 있는지"는 MIME 타입으로 구분해 드롭 허용 여부를 판단한다.
// 브라우저가 커스텀 타입을 소문자로 정규화하므로 상수도 소문자로 정의한다.

export const DragMime = {
    /** 워크북(엑셀 파일) 그룹 이동 — payload: 워크북 id 문자열 */
    WORKBOOK: 'application/x-covered-call-workbook',
    /** 시트 탭 이동 — payload: SheetTabDragPayload JSON */
    SHEET_TAB: 'application/x-covered-call-sheet-tab',
} as const
