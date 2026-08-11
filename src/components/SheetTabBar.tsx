import { type MouseEvent } from 'react'
import type { SheetTab } from '../types/workbook'
import RenameInput from './RenameInput'

interface SheetTabBarProps {
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
}

/**
 * 시트 탭 바 — 엑셀 하단 시트 탭과 동일한 조작 방식
 * 탭 클릭으로 선택, 더블클릭으로 이름 변경, + 버튼으로 탭 추가.
 */
function SheetTabBar(props: SheetTabBarProps) {

    // ┣━━━━━━━━━━━━━━━━ Handlers ━━━━━━━━━━━━━━━━━━━┫

    /** 탭 삭제 버튼 클릭 — @param event 클릭 이벤트, @param tabId 삭제할 탭 id */
    const handleRemoveClick = (event: MouseEvent<HTMLButtonElement>, tabId: string) => {
        event.stopPropagation()   // 탭 선택으로 전파되지 않도록 차단
        props.onRemove(tabId)
    }

    return (
        <div className={'sheet_tab_bar'}>
            {props.tabs.map((tab) => {
                const isActive = tab.id === props.activeTabId
                const isEditing = tab.id === props.editingTabId

                // 1) 편집 중인 탭은 입력창으로 대체
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

                // 2) 일반 상태 탭 — 클릭 선택 / 더블클릭 이름 변경
                return (
                    <div
                        key={tab.id}
                        className={`sheet_tab${isActive ? ' sheet_tab_active' : ''}`}
                        onClick={() => props.onSelect(tab.id)}
                        onDoubleClick={() => props.onStartRename(tab.id)}
                        title={'더블클릭하면 이름을 바꿀 수 있습니다'}
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

            {/* 3) 탭 추가 버튼 */}
            <button type={'button'} className={'sheet_tab_add'} onClick={props.onAdd} title={'탭 추가'}>
                +
            </button>
        </div>
    )
}

export default SheetTabBar