import { useState, type DragEvent, type MouseEvent } from 'react'
import { DragMime } from '../constants/dragConstants'
import type { SheetTab, SheetTabDragPayload } from '../types/workbook'
import RenameInput from './RenameInput'

interface SheetTabBarProps {
    /** 이 탭 바가 속한 워크북(엑셀 파일) id — 드래그 출발/도착 파일 판별에 쓴다 */
    workbookId: string
    tabs: SheetTab[]
    activeTabId: string
    editingTabId: string | null
    /** 탭이 2개 이상일 때만 삭제 허용 */
    removable: boolean
    onSelect: (tabId: string) => void
    onAdd: () => void
    onStartRename: (tabId: string) => void
    onCommitRename: (tabId: string, name: string) => void
    onCancelRename: () => void
    onRemove: (tabId: string) => void
    /** 시트 이동 — @param targetTabId null이면 이 파일 맨 뒤, @param before 대상 탭 앞에 넣을지 여부 */
    onMove: (
        source: SheetTabDragPayload,
        targetWorkbookId: string,
        targetTabId: string | null,
        before: boolean,
    ) => void
}

/**
 * 시트 탭 바 — 엑셀 하단 시트 탭과 동일한 조작 방식
 * 탭 클릭으로 선택, 더블클릭으로 이름 변경, + 버튼으로 탭 추가, 드래그로 순서 변경 및 다른 파일로 이동.
 */
function SheetTabBar(props: SheetTabBarProps) {

    // ┣━━━━━━━━━━━━━━━━ States ━━━━━━━━━━━━━━━━━━━━━┫
    const [draggingTabId, setDraggingTabId] = useState<string | null>(null)      // 이 탭 바에서 끌기 시작한 탭 (반투명 처리용)
    const [dropTabId, setDropTabId] = useState<string | null>(null)              // 삽입선을 그릴 대상 탭. null이면 탭 위가 아님
    const [dropBefore, setDropBefore] = useState<boolean>(true)                  // 대상 탭의 앞(왼쪽)에 넣을지 여부
    const [dropAtEnd, setDropAtEnd] = useState<boolean>(false)                   // 탭 바 빈 영역에 놓는 중 — 맨 뒤로 이동

    // ┣━━━━━━━━━━━━━━━━ Handlers ━━━━━━━━━━━━━━━━━━━┫

    /** 탭 삭제 버튼 클릭 — @param event 클릭 이벤트, @param tabId 삭제할 탭 id */
    const handleRemoveClick = (event: MouseEvent<HTMLButtonElement>, tabId: string) => {
        event.stopPropagation()   // 탭 선택으로 전파되지 않도록 차단
        props.onRemove(tabId)
    }

    /** 드래그 표시 상태 초기화 — 드롭/취소/이탈 공통 */
    const clearDropMark = () => {
        setDropTabId(null)
        setDropAtEnd(false)
    }

    /** 시트 탭 끌기 시작 — @param event 드래그 이벤트, @param tabId 끌기 시작한 탭 id */
    const handleDragStart = (event: DragEvent<HTMLDivElement>, tabId: string) => {
        const payload: SheetTabDragPayload = { workbookId: props.workbookId, tabId }
        event.dataTransfer.setData(DragMime.SHEET_TAB, JSON.stringify(payload))
        event.dataTransfer.effectAllowed = 'move'
        setDraggingTabId(tabId)
    }

    /** 끌기 종료 — 성공/실패 무관하게 표시 상태를 되돌린다 */
    const handleDragEnd = () => {
        setDraggingTabId(null)
        clearDropMark()
    }

    /** 탭 위 드래그 — @param event 드래그 이벤트, @param tabId 지나가는 대상 탭 id */
    const handleDragOverTab = (event: DragEvent<HTMLDivElement>, tabId: string) => {
        // 1) 시트 탭이 아닌 드래그(파일 그룹 등)는 여기서 받지 않는다
        if (!event.dataTransfer.types.includes(DragMime.SHEET_TAB)) return
        event.preventDefault()
        event.stopPropagation()   // 탭 바 빈 영역 처리로 전파되지 않도록 차단
        event.dataTransfer.dropEffect = 'move'

        // 2) 포인터가 탭의 좌/우 어느 쪽에 있는지로 삽입 위치를 정한다
        const rect = event.currentTarget.getBoundingClientRect()
        setDropTabId(tabId)
        setDropAtEnd(false)
        setDropBefore(event.clientX < rect.left + rect.width / 2)
    }

    /** 탭 위 드롭 — @param event 드래그 이벤트, @param tabId 놓은 자리의 탭 id */
    const handleDropOnTab = (event: DragEvent<HTMLDivElement>, tabId: string) => {
        const raw = event.dataTransfer.getData(DragMime.SHEET_TAB)
        if (!raw) return
        event.preventDefault()
        event.stopPropagation()
        clearDropMark()

        // 드롭 순간의 좌표로 삽입 위치를 다시 계산한다 (상태 갱신 시점과 무관하게 정확)
        const rect = event.currentTarget.getBoundingClientRect()
        const before = event.clientX < rect.left + rect.width / 2
        props.onMove(JSON.parse(raw) as SheetTabDragPayload, props.workbookId, tabId, before)
    }

    /** 탭 바 빈 영역 드래그 — 맨 뒤로 붙이는 드롭 지점 */
    const handleDragOverBar = (event: DragEvent<HTMLDivElement>) => {
        if (!event.dataTransfer.types.includes(DragMime.SHEET_TAB)) return
        event.preventDefault()
        event.dataTransfer.dropEffect = 'move'
        setDropTabId(null)
        setDropAtEnd(true)
    }

    /** 탭 바 빈 영역 드롭 — 이 파일 맨 뒤로 이동 */
    const handleDropOnBar = (event: DragEvent<HTMLDivElement>) => {
        const raw = event.dataTransfer.getData(DragMime.SHEET_TAB)
        if (!raw) return
        event.preventDefault()
        clearDropMark()
        props.onMove(JSON.parse(raw) as SheetTabDragPayload, props.workbookId, null, false)
    }

    /** 탭 바 밖으로 이탈 — 자식 요소 간 이동은 무시하고 바깥으로 나갔을 때만 표시를 지운다 */
    const handleDragLeaveBar = (event: DragEvent<HTMLDivElement>) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
        clearDropMark()
    }

    return (
        <div
            className={dropAtEnd ? 'sheet_tab_bar sheet_tab_bar_drop_end' : 'sheet_tab_bar'}
            onDragOver={handleDragOverBar}
            onDrop={handleDropOnBar}
            onDragLeave={handleDragLeaveBar}
        >
            {props.tabs.map((tab) => {
                const isActive = tab.id === props.activeTabId
                const isEditing = tab.id === props.editingTabId

                // 1) 편집 중인 탭은 입력창으로 대체 (편집 중에는 드래그를 걸지 않는다 — 텍스트 선택이 막힌다)
                if (isEditing) {
                    return (
                        <div key={tab.id} className={'sheet_tab sheet_tab_active sheet_tab_editing'}>
                            <RenameInput
                                className={'sheet_tab_input'}
                                defaultValue={tab.name}
                                maxLength={31}
                                onCommit={(name) => props.onCommitRename(tab.id, name)}
                                onCancel={props.onCancelRename}
                            />
                        </div>
                    )
                }

                // 2) 드래그 상태에 따른 클래스 조립 — 끌고 있는 탭은 반투명, 드롭 대상 탭에는 삽입선
                const dragClass = [
                    tab.id === draggingTabId ? ' sheet_tab_dragging' : '',
                    tab.id === dropTabId ? (dropBefore ? ' sheet_tab_drop_before' : ' sheet_tab_drop_after') : '',
                ].join('')

                // 3) 일반 상태 탭 — 클릭 선택 / 더블클릭 이름 변경 / 드래그 이동
                return (
                    <div
                        key={tab.id}
                        className={`sheet_tab${isActive ? ' sheet_tab_active' : ''}${dragClass}`}
                        draggable
                        onDragStart={(event) => handleDragStart(event, tab.id)}
                        onDragEnd={handleDragEnd}
                        onDragOver={(event) => handleDragOverTab(event, tab.id)}
                        onDrop={(event) => handleDropOnTab(event, tab.id)}
                        onClick={() => props.onSelect(tab.id)}
                        onDoubleClick={() => props.onStartRename(tab.id)}
                        title={'드래그로 순서를 바꾸거나 다른 파일로 옮길 수 있습니다 · 더블클릭하면 이름 변경'}
                    >
                        <span className={'sheet_tab_name'}>{tab.name}</span>
                        {props.removable && (
                            <button
                                type={'button'}
                                className={'sheet_tab_remove'}
                                onClick={(event) => handleRemoveClick(event, tab.id)}
                                title={'탭 삭제'}
                            >
                                ×
                            </button>
                        )}
                    </div>
                )
            })}

            {/* 4) 탭 추가 버튼 */}
            <button type={'button'} className={'sheet_tab_add'} onClick={props.onAdd} title={'탭 추가'}>
                +
            </button>
        </div>
    )
}

export default SheetTabBar
