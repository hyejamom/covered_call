import type { SimulationConstants } from '../types/simulation'
import type { SheetTabDragPayload, Workbook } from '../types/workbook'
import ExcelDownloadButton from './ExcelDownloadButton'
import RenameInput from './RenameInput'
import SheetTabBar from './SheetTabBar'

interface WorkbookGroupProps {
    workbook: Workbook
    /** 전 탭 공통 고정 상수 — 그룹 단독 다운로드에 사용 */
    constants: SimulationConstants
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
 * 상단에 파일명(더블클릭 편집) + 단독 다운로드, 하단에 그 파일에 들어갈 시트 탭 목록을 둔다.
 */
function WorkbookGroup(props: WorkbookGroupProps) {

    // ┣━━━━━━━━━━━━━━━━ Derived ━━━━━━━━━━━━━━━━━━━━┫
    const isEditing = props.editingWorkbookId === props.workbook.id

    return (
        <section className={'workbook_group'}>
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
                        onDoubleClick={() => props.onStartRenameWorkbook(props.workbook.id)}
                        title={'더블클릭하면 파일명을 바꿀 수 있습니다'}
                    >
                        {props.workbook.name}
                        <span className={'workbook_group_count'}>시트 {props.workbook.tabs.length}</span>
                    </span>
                )}

                <div className={'workbook_group_actions'}>
                    <ExcelDownloadButton
                        workbooks={[props.workbook]}
                        constants={props.constants}
                        compact
                    />
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