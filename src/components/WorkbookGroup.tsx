import { useState, type DragEvent } from 'react'
import type { CalcAsset } from '../constants/assetConstants'
import { DragMime } from '../constants/dragConstants'
import type { SimulationConstants } from '../types/simulation'
import type { SheetTabDragPayload, Workbook } from '../types/workbook'
import ExcelDownloadButton from './ExcelDownloadButton'
import RenameInput from './RenameInput'
import SheetTabBar from './SheetTabBar'

// ┣━━━━━━━━━━━━━━━━ Constants ━━━━━━━━━━━━━━━━━━┫

/** 삽입선 위치 — 드롭 대상 그룹의 왼쪽/오른쪽 (tsconfig erasableSyntaxOnly 로 enum 대신 const 객체 사용) */
const DropEdge = {
    BEFORE: 'before',
    AFTER: 'after',
} as const

type DropEdge = (typeof DropEdge)[keyof typeof DropEdge]

interface WorkbookGroupProps {
    workbook: Workbook
    /** 전 탭 공통 고정 상수 — 그룹 단독 다운로드에 사용 */
    constants: SimulationConstants
    /** 지금 보고 있는 종목 탭 — 단독 다운로드 파일명에 반영된다 */
    asset: CalcAsset
    activeTabId: string
    editingTabId: string | null
    editingWorkbookId: string | null
    /** 워크북이 2개 이상일 때만 삭제 허용 */
    removable: boolean
    onSelectTab: (tabId: string) => void
    onAddTab: (workbookId: string) => void
    onRemoveTab: (workbookId: string, tabId: string) => void
    onStartRenameTab: (tabId: string) => void
    onCommitRenameTab: (tabId: string, name: string) => void
    onCancelRename: () => void
    onStartRenameWorkbook: (workbookId: string) => void
    onCommitRenameWorkbook: (workbookId: string, name: string) => void
    onRemoveWorkbook: (workbookId: string) => void
    /** 파일 복제 — 시트 · 이벤트까지 그대로 복사한 파일을 원본 뒤에 만든다 */
    onDuplicateWorkbook: (workbookId: string) => void
    /** 파일 그룹 드래그 이동 — @param before 대상 그룹의 앞(왼쪽)에 넣을지 여부 */
    onMoveWorkbook: (sourceWorkbookId: string, targetWorkbookId: string, before: boolean) => void
    /** 시트 탭 드래그 이동 — 같은 파일 내 순서 변경 + 다른 파일로 옮기기 겸용 */
    onMoveTab: (
        source: SheetTabDragPayload,
        targetWorkbookId: string,
        targetTabId: string | null,
        before: boolean,
    ) => void
}

/**
 * 워크북 그룹 — 엑셀 파일 1개 단위
 * 상단에 파일명(더블클릭 편집 / 드래그로 파일 순서 변경) + 단독 다운로드, 하단에 그 파일에 들어갈 시트 탭 목록을 둔다.
 */
function WorkbookGroup(props: WorkbookGroupProps) {

    // ┣━━━━━━━━━━━━━━━━ States ━━━━━━━━━━━━━━━━━━━━━┫
    const [dragging, setDragging] = useState<boolean>(false)             // 이 그룹을 끌고 있는 중 (반투명 처리 + 자기 위 드롭 표시 억제용)
    const [dropEdge, setDropEdge] = useState<DropEdge | null>(null)      // 삽입선을 그릴 위치. null이면 이 그룹은 드롭 대상이 아님

    // ┣━━━━━━━━━━━━━━━━ Derived ━━━━━━━━━━━━━━━━━━━━┫
    const isEditing = props.editingWorkbookId === props.workbook.id

    // 드래그 상태에 따른 클래스 조립 — 끌고 있는 그룹은 반투명, 드롭 대상 그룹에는 삽입선
    const dragClass = [
        dragging ? ' workbook_group_dragging' : '',
        dropEdge === null ? '' : ` workbook_group_drop_${dropEdge}`,
    ].join('')

    // ┣━━━━━━━━━━━━━━━━ Handlers ━━━━━━━━━━━━━━━━━━━┫

    /** 파일 그룹 끌기 시작 — @param event 드래그 이벤트 */
    const handleDragStart = (event: DragEvent<HTMLSpanElement>) => {
        event.dataTransfer.setData(DragMime.WORKBOOK, props.workbook.id)
        event.dataTransfer.effectAllowed = 'move'
        setDragging(true)
    }

    /** 끌기 종료 — 성공/실패 무관하게 표시 상태를 되돌린다 */
    const handleDragEnd = () => {
        setDragging(false)
        setDropEdge(null)
    }

    /** 그룹 위 드래그 — @param event 드래그 이벤트 */
    const handleDragOver = (event: DragEvent<HTMLElement>) => {
        // 1) 파일 그룹이 아닌 드래그(시트 탭 등)는 여기서 받지 않는다
        if (!event.dataTransfer.types.includes(DragMime.WORKBOOK)) return
        event.preventDefault()
        event.dataTransfer.dropEffect = 'move'

        // 2) 끌고 있는 그룹 자신 위에서는 삽입선을 그리지 않는다 (제자리 이동)
        if (dragging) return

        // 3) 포인터가 그룹의 좌/우 어느 쪽에 있는지로 삽입 위치를 정한다
        const rect = event.currentTarget.getBoundingClientRect()
        setDropEdge(event.clientX < rect.left + rect.width / 2 ? DropEdge.BEFORE : DropEdge.AFTER)
    }

    /** 그룹 위 드롭 — @param event 드래그 이벤트 */
    const handleDrop = (event: DragEvent<HTMLElement>) => {
        const sourceWorkbookId = event.dataTransfer.getData(DragMime.WORKBOOK)
        if (!sourceWorkbookId) return
        event.preventDefault()
        setDropEdge(null)

        // 드롭 순간의 좌표로 삽입 위치를 다시 계산한다 (상태 갱신 시점과 무관하게 정확)
        const rect = event.currentTarget.getBoundingClientRect()
        const before = event.clientX < rect.left + rect.width / 2
        props.onMoveWorkbook(sourceWorkbookId, props.workbook.id, before)
    }

    /** 그룹 밖으로 이탈 — 자식 요소 간 이동은 무시하고 바깥으로 나갔을 때만 표시를 지운다 */
    const handleDragLeave = (event: DragEvent<HTMLElement>) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
        setDropEdge(null)
    }

    return (
        <section
            className={`workbook_group${dragClass}`}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            onDragLeave={handleDragLeave}
        >
            {/* 1) 그룹 헤더 — 파일명 / 단독 다운로드 / 그룹 삭제 */}
            <div className={'workbook_group_head'}>
                {isEditing ? (
                    <RenameInput
                        className={'workbook_group_input'}
                        defaultValue={props.workbook.name}
                        maxLength={40}
                        onCommit={(name) => props.onCommitRenameWorkbook(props.workbook.id, name)}
                        onCancel={props.onCancelRename}
                    />
                ) : (
                    <span
                        className={'workbook_group_name'}
                        draggable
                        onDragStart={handleDragStart}
                        onDragEnd={handleDragEnd}
                        onDoubleClick={() => props.onStartRenameWorkbook(props.workbook.id)}
                        title={'파일명을 드래그하면 파일 순서를 바꿀 수 있습니다 · 더블클릭하면 파일명 변경'}
                    >
                        {props.workbook.name}
                        <span className={'workbook_group_count'}>시트 {props.workbook.tabs.length}</span>
                    </span>
                )}

                <div className={'workbook_group_actions'}>
                    <ExcelDownloadButton
                        workbooks={[props.workbook]}
                        constants={props.constants}
                        asset={props.asset}
                        compact
                    />
                    <button
                        type={'button'}
                        className={'workbook_group_duplicate'}
                        onClick={() => props.onDuplicateWorkbook(props.workbook.id)}
                        title={`이 파일 복제 — 시트 ${props.workbook.tabs.length}장을 그대로 복사합니다`}
                    >
                        ⧉
                    </button>
                    {props.removable && (
                        <button
                            type={'button'}
                            className={'workbook_group_remove'}
                            onClick={() => props.onRemoveWorkbook(props.workbook.id)}
                            title={'이 파일 삭제'}
                        >
                            ×
                        </button>
                    )}
                </div>
            </div>

            {/* 2) 이 파일에 들어갈 시트 탭 목록 — 드래그로 순서 변경 / 다른 파일로 이동 */}
            <SheetTabBar
                workbookId={props.workbook.id}
                tabs={props.workbook.tabs}
                activeTabId={props.activeTabId}
                editingTabId={props.editingTabId}
                removable={props.workbook.tabs.length > 1}
                onSelect={props.onSelectTab}
                onAdd={() => props.onAddTab(props.workbook.id)}
                onStartRename={props.onStartRenameTab}
                onCommitRename={props.onCommitRenameTab}
                onCancelRename={props.onCancelRename}
                onRemove={(tabId) => props.onRemoveTab(props.workbook.id, tabId)}
                onMove={props.onMoveTab}
            />
        </section>
    )
}

export default WorkbookGroup