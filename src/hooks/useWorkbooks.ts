import { useEffect, useRef, useState } from 'react'
import {
    DEFAULT_END_YEAR,
    DEFAULT_START_YEAR,
    buildYears,
    clampYear,
} from '../constants/gridConstants'
import { createDefaultEvents, createNewEventDefault, nextEventId } from '../constants/simulationDefaults'
import { runWorkbookSimulation } from '../services/simulationEngine'
import { fetchRemoteState } from '../services/stateApiService'
import { loadState, normalizeWorkbooks, saveState, toStateSignature } from '../services/storageService'
import type { PersistedMark } from '../services/storageService'
import type {
    InvestEvent,
    SimulationConstants,
    SimulationResult,
    WorkbookSimulationResult,
} from '../types/simulation'
import type { SheetTab, SheetTabDragPayload, Workbook } from '../types/workbook'

// ┣━━━━━━━━━━━━━━━━ Constants ━━━━━━━━━━━━━━━━━━┫

/** 워크북 / 탭 id 발급용 카운터 — 렌더와 무관한 모듈 스코프 값 */
let workbookSequence = 0
let tabSequence = 0

/**
 * 새 탭 생성
 * @param name 탭 이름
 * @param events 초기 이벤트. 사용자가 새로 만드는 탭은 빈 배열로 시작해 필터에서 직접 채운다.
 */
function createTab(name: string, events: InvestEvent[]): SheetTab {
    tabSequence += 1
    return { id: `tab_${tabSequence}`, name, birthYm: '', events }
}

/**
 * 새 워크북 생성 — 빈 탭 1개를 기본으로 갖는다
 * @param name 파일 이름
 * @param firstTabName 첫 시트 이름
 * @param startYear 대상 기간 시작 연도 — 직전에 보던 파일의 기간을 그대로 물려받는다
 * @param endYear 대상 기간 종료 연도
 */
function createWorkbook(name: string, firstTabName: string, startYear: number, endYear: number): Workbook {
    workbookSequence += 1
    return {
        id: `wb_${workbookSequence}`,
        name,
        startYear,
        endYear,
        tabs: [createTab(firstTabName, [])],
    }
}

/** id 접미 숫자 추출 — 'tab_12' → 12, 형식이 다르면 0 */
function toIdNumber(id: string): number {
    const parsed = Number(id.split('_')[1])
    return Number.isFinite(parsed) ? parsed : 0
}

/**
 * id 발급 카운터를 복원된 최대 번호로 밀어 올린다.
 * — 이걸 안 하면 새로 만드는 파일/탭 id가 복원된 id와 겹쳐 선택·삭제가 엉킨다.
 * @param workbooks 복원된 워크북 목록
 */
function syncSequences(workbooks: Workbook[]): void {
    workbookSequence = Math.max(workbookSequence, ...workbooks.map((workbook) => toIdNumber(workbook.id)))
    tabSequence = Math.max(tabSequence, ...workbooks.flatMap((workbook) => workbook.tabs.map((tab) => toIdNumber(tab.id))))
}

/**
 * 최초 진입 시점의 상태 조립 — 로컬 저장본 기준
 * — 서버 스냅샷은 비동기라 첫 페인트를 막지 않도록 마운트 후 별도로 합류시킨다.
 */
function createInitialState(): { workbooks: Workbook[], activeTabId: string, persisted: PersistedMark } {

    // 1) 로컬 저장 스냅샷 확인 — 형식이 깨졌거나 이력이 없으면 null
    const restored = loadState()
    if (restored !== null) {
        syncSequences(restored.workbooks)
        return {
            workbooks: restored.workbooks,
            activeTabId: restored.activeTabId,
            persisted: {
                signature: toStateSignature(restored.workbooks, restored.activeTabId),
                at: restored.savedAt,
            },
        }
    }

    // 2) 기본 상태 — 파일 1개 / 시트 1장, 첫 탭에만 기본 계획을 채워 둔다
    const workbooks: Workbook[] = [{
        id: 'wb_0',
        name: '파일1',
        startYear: DEFAULT_START_YEAR,
        endYear: DEFAULT_END_YEAR,
        tabs: [createTab('시트1', createDefaultEvents())],
    }]
    return { workbooks, activeTabId: workbooks[0].tabs[0].id, persisted: { signature: null, at: null } }
}

/** 모듈 로드 시점에 1회만 조립되는 초기 상태 */
const INITIAL_STATE = createInitialState()

// ┣━━━━━━━━━━━━━━━━ Hook ━━━━━━━━━━━━━━━━━━━━━━━┫

/**
 * 워크북 목록 상태 훅
 * — 워크북(그룹) = 엑셀 파일 1개, 그 안의 탭 = 워크시트 1장.
 * — 선택된 탭 1개의 이벤트로 화면 그리드용 시뮬레이션 결과를 파생시킨다.
 * @param constants 전 탭 공통 고정 상수 (상단 실시간 시세 + 고정 세금 정책)
 */
export function useWorkbooks(constants: SimulationConstants) {

    // ┣━━━━━━━━━━━━━━━━ States ━━━━━━━━━━━━━━━━━━━━━┫
    const [workbooks, setWorkbooks] = useState<Workbook[]>(INITIAL_STATE.workbooks)               // 워크북(=파일) 목록, 순서 유지
    const [activeTabId, setActiveTabId] = useState<string>(INITIAL_STATE.activeTabId)             // 현재 선택된 탭 (전체 그룹 통틀어 1개)
    const [editingTabId, setEditingTabId] = useState<string | null>(null)                         // 이름 편집 중인 탭
    const [editingWorkbookId, setEditingWorkbookId] = useState<string | null>(null)               // 이름 편집 중인 워크북
    const [hydrating, setHydrating] = useState<boolean>(true)                                     // 서버 스냅샷 합류 대기 중 여부
    const [persisted, setPersisted] = useState<PersistedMark>(INITIAL_STATE.persisted)            // 마지막으로 영속화된 지문 + 시각

    // ┣━━━━━━━━━━━━━━━━ Refs ━━━━━━━━━━━━━━━━━━━━━━━┫
    // 마운트 직후 서버 응답이 도착하기 전에 사용자가 손을 댔는지 — 댔다면 서버 값으로 덮지 않는다
    const editedRef = useRef<boolean>(false)

    // ┣━━━━━━━━━━━━━━━━ Effects ━━━━━━━━━━━━━━━━━━━━┫

    // 1) 서버 스냅샷 합류 — 첫 페인트를 막지 않도록 마운트 후 비동기로 가져온다
    useEffect(() => {
        let cancelled = false

        const hydrate = async () => {
            try {
                // 1-1) 서버 스냅샷 조회 — 서버가 안 떠 있으면 예외로 떨어져 로컬 복원본을 그대로 쓴다
                const remote = await fetchRemoteState()
                if (cancelled || remote === null) return

                // 1-2) 사용자가 이미 편집을 시작했다면 덮어쓰지 않는다 (작업 내용 유실 방지)
                if (editedRef.current) return

                // 1-3) 서버본이 로컬본보다 최신일 때만 교체 — 다른 기기에서 저장한 내용을 끌어온다
                const localSavedAt = INITIAL_STATE.persisted.at
                if (localSavedAt !== null && remote.savedAt <= localSavedAt) return

                // 1-4) 서버 스냅샷도 구버전일 수 있으므로 로컬과 동일하게 보정한 뒤 반영한다
                const remoteWorkbooks = normalizeWorkbooks(remote.workbooks)
                syncSequences(remoteWorkbooks)
                setWorkbooks(remoteWorkbooks)
                setActiveTabId(remote.activeTabId)

                // 1-5) 로컬 캐시도 서버본으로 맞춰 두고, 저장 기준점을 서버 시각으로 옮긴다.
                //      이걸 안 하면 합류 직후 화면이 "변경됨"으로 잘못 표시된다.
                saveState(remoteWorkbooks, remote.activeTabId, remote.savedAt)
                setPersisted({
                    signature: toStateSignature(remoteWorkbooks, remote.activeTabId),
                    at: remote.savedAt,
                })
            } catch {
                // 서버 미기동 / 네트워크 실패 — 로컬 복원본으로 계속 진행한다
            } finally {
                if (!cancelled) setHydrating(false)
            }
        }

        void hydrate()
        return () => { cancelled = true }
    }, [])

    // ┣━━━━━━━━━━━━━━━━ Derived ━━━━━━━━━━━━━━━━━━━━┫
    // 1) 선택된 탭 탐색 — 삭제 직후 등 예외 상황에서는 첫 워크북의 첫 탭으로 대체
    const allTabs: SheetTab[] = workbooks.flatMap((workbook) => workbook.tabs)
    const activeTab: SheetTab = allTabs.find((tab) => tab.id === activeTabId) ?? allTabs[0]

    // 2) 선택된 탭이 속한 워크북 — 과세 판정이 워크북 합산 기준이라 파일 단위로 함께 돌려야 한다
    const activeWorkbook: Workbook = workbooks.find(
        (workbook) => workbook.tabs.some((tab) => tab.id === activeTab.id),
    ) ?? workbooks[0]

    // 3) 워크북 전체(모든 시트) × 대상 기간 전체 재계산
    //    기간이 늘어도 개월수 × 시트수 규모라 연산 비용이 낮고, React Compiler가 자동 메모이제이션하므로 useMemo를 쓰지 않는다.
    const workbookResult: WorkbookSimulationResult = runWorkbookSimulation(
        activeWorkbook.tabs,
        constants,
        activeWorkbook.startYear,
        activeWorkbook.endYear,
    )

    // 4) 화면 그리드는 선택된 시트 1장만 그린다 (과세 여부는 워크북 판정을 그대로 물려받음)
    const result: SimulationResult = workbookResult.byTabId[activeTab.id]

    // 5) 그리드 가로축 / 연월 선택기에 쓸 연도 목록 — 선택된 파일의 대상 기간
    const years: number[] = buildYears(activeWorkbook.startYear, activeWorkbook.endYear)

    // ┣━━━━━━━━━━━━━━━━ Handlers ━━━━━━━━━━━━━━━━━━━┫

    /** 편집 발생 표시 — 서버 스냅샷이 늦게 도착해도 사용자의 작업 내용을 덮지 않도록 잠근다 */
    const markEdited = () => {
        editedRef.current = true
    }

    /**
     * 저장 완료 표시 — 저장 버튼이 영속화에 성공했을 때 호출한다.
     * @param mark 저장된 지문 + 시각
     */
    const handleMarkPersisted = (mark: PersistedMark) => {
        // 저장한 상태가 정본이므로, 뒤늦게 도착한 서버 스냅샷이 덮어쓰지 못하게 함께 잠근다
        markEdited()
        setPersisted(mark)
    }

    /** 특정 워크북만 갱신하는 공통 처리 — @param workbookId 대상 워크북 @param updater 새 워크북을 돌려주는 함수 */
    const updateWorkbook = (workbookId: string, updater: (workbook: Workbook) => Workbook) => {
        markEdited()
        setWorkbooks((prev) => prev.map((workbook) => (workbook.id === workbookId ? updater(workbook) : workbook)))
    }

    /** 선택된 탭만 갱신하는 공통 처리 — @param updater 대상 탭을 받아 새 탭을 돌려주는 함수 */
    const updateActiveTab = (updater: (tab: SheetTab) => SheetTab) => {
        markEdited()
        setWorkbooks((prev) => prev.map((workbook) => ({
            ...workbook,
            tabs: workbook.tabs.map((tab) => (tab.id === activeTab.id ? updater(tab) : tab)),
        })))
    }

    /** 워크북 추가 — 목록 끝에 붙이고 이름 편집 상태로 진입 (기간은 보던 파일에서 물려받는다) */
    const handleAddWorkbook = () => {
        markEdited()
        const newWorkbook = createWorkbook(
            `파일${workbooks.length + 1}`,
            '시트1',
            activeWorkbook.startYear,
            activeWorkbook.endYear,
        )
        setWorkbooks([...workbooks, newWorkbook])
        setActiveTabId(newWorkbook.tabs[0].id)
        setEditingWorkbookId(newWorkbook.id)
    }

    /** 워크북 삭제 — @param workbookId 삭제할 워크북 (마지막 1개는 삭제 불가) */
    const handleRemoveWorkbook = (workbookId: string) => {
        if (workbooks.length <= 1) return
        markEdited()

        // 1) 삭제 후 남는 목록 계산
        const remaining = workbooks.filter((workbook) => workbook.id !== workbookId)
        setWorkbooks(remaining)

        // 2) 선택 중인 탭이 삭제된 워크북에 속해 있었다면 남은 첫 탭으로 선택 이동
        const removed = workbooks.find((workbook) => workbook.id === workbookId)
        if (removed?.tabs.some((tab) => tab.id === activeTabId)) {
            setActiveTabId(remaining[0].tabs[0].id)
        }
    }

    /**
     * 시트 탭 이동 — 같은 파일 내 순서 변경 + 다른 파일로 옮기기 겸용
     * @param source 끌어 온 시트 (소속 파일 id + 탭 id)
     * @param targetWorkbookId 놓은 자리의 파일 id
     * @param targetTabId 놓은 자리의 탭 id. null이면 그 파일 맨 뒤에 붙인다
     * @param before 대상 탭의 앞(왼쪽)에 넣을지 여부. false면 뒤에 넣는다
     */
    const handleMoveTab = (
        source: SheetTabDragPayload,
        targetWorkbookId: string,
        targetTabId: string | null,
        before: boolean,
    ) => {
        if (source.tabId === targetTabId) return
        markEdited()

        setWorkbooks((prev) => {
            // 1) 이동할 탭 확인
            const sourceWorkbook = prev.find((workbook) => workbook.id === source.workbookId)
            const movingTab = sourceWorkbook?.tabs.find((tab) => tab.id === source.tabId)
            if (!sourceWorkbook || !movingTab) return prev

            // 2) 다른 파일로 옮기는 경우, 원본 파일에 시트가 하나뿐이면 거부한다 (시트 0장인 엑셀 파일은 만들 수 없다)
            const crossFile = source.workbookId !== targetWorkbookId
            if (crossFile && sourceWorkbook.tabs.length <= 1) return prev

            return prev.map((workbook) => {
                // 3) 원본 파일에서 먼저 빼낸다 (같은 파일 안 이동이면 이 결과 위에 다시 꽂는다)
                const removed = workbook.id === source.workbookId
                    ? workbook.tabs.filter((tab) => tab.id !== source.tabId)
                    : workbook.tabs
                if (workbook.id !== targetWorkbookId) {
                    return removed === workbook.tabs ? workbook : { ...workbook, tabs: removed }
                }

                // 4) 대상 파일에 끼워 넣는다 — 대상 탭이 없으면(빈 영역에 드롭) 맨 뒤
                const targetIndex = targetTabId === null
                    ? -1
                    : removed.findIndex((tab) => tab.id === targetTabId)
                const insertAt = targetIndex < 0
                    ? removed.length
                    : (before ? targetIndex : targetIndex + 1)

                return {
                    ...workbook,
                    tabs: [...removed.slice(0, insertAt), movingTab, ...removed.slice(insertAt)],
                }
            })
        })

        // 5) 옮긴 시트를 그대로 선택 상태로 둔다 — 엑셀에서 시트를 끌어 옮겼을 때와 같은 동작
        setActiveTabId(source.tabId)
    }

    /** 워크북 이름 편집 시작 — @param workbookId 편집할 워크북 id */
    const handleStartRenameWorkbook = (workbookId: string) => {
        setEditingWorkbookId(workbookId)
    }

    /** 워크북 이름 확정 — @param workbookId 대상 id, @param name 새 이름(공백이면 기존 이름 유지) */
    const handleCommitRenameWorkbook = (workbookId: string, name: string) => {
        const trimmedName = name.trim()
        if (trimmedName.length > 0) {
            updateWorkbook(workbookId, (workbook) => ({ ...workbook, name: trimmedName }))
        }
        setEditingWorkbookId(null)
    }

    /** 탭 선택 — @param tabId 선택할 탭 id */
    const handleSelectTab = (tabId: string) => {
        setActiveTabId(tabId)
    }

    /**
     * 탭 추가 — @param workbookId 탭을 붙일 워크북
     * 새 탭은 이벤트가 비어 있어 필터가 초기 상태로 열리고, 이후 편집은 이 탭에 반영된다.
     */
    const handleAddTab = (workbookId: string) => {
        const target = workbooks.find((workbook) => workbook.id === workbookId)
        if (!target) return

        const newTab = createTab(`시트${target.tabs.length + 1}`, [])
        updateWorkbook(workbookId, (workbook) => ({ ...workbook, tabs: [...workbook.tabs, newTab] }))
        setActiveTabId(newTab.id)
        setEditingTabId(newTab.id)
    }

    /** 탭 삭제 — @param workbookId 소속 워크북, @param tabId 삭제할 탭 (워크북당 마지막 1개는 삭제 불가) */
    const handleRemoveTab = (workbookId: string, tabId: string) => {
        const target = workbooks.find((workbook) => workbook.id === workbookId)
        if (!target || target.tabs.length <= 1) return

        // 1) 삭제 후 남는 탭 목록 계산
        const remainingTabs = target.tabs.filter((tab) => tab.id !== tabId)
        updateWorkbook(workbookId, (workbook) => ({ ...workbook, tabs: remainingTabs }))

        // 2) 삭제한 탭이 선택 중이었다면 같은 워크북의 직전 위치 탭으로 선택 이동
        if (activeTabId === tabId) {
            const removedIndex = target.tabs.findIndex((tab) => tab.id === tabId)
            setActiveTabId(remainingTabs[Math.max(0, removedIndex - 1)].id)
        }
    }

    /** 탭 이름 편집 시작 — @param tabId 편집할 탭 id */
    const handleStartRenameTab = (tabId: string) => {
        setEditingTabId(tabId)
    }

    /** 탭 이름 확정 — @param tabId 대상 탭 id, @param name 새 이름(공백이면 기존 이름 유지) */
    const handleCommitRenameTab = (tabId: string, name: string) => {
        const trimmedName = name.trim()
        if (trimmedName.length > 0) {
            markEdited()
            setWorkbooks((prev) => prev.map((workbook) => ({
                ...workbook,
                tabs: workbook.tabs.map((tab) => (tab.id === tabId ? { ...tab, name: trimmedName } : tab)),
            })))
        }
        setEditingTabId(null)
    }

    /** 이름 편집 취소 — 워크북/탭 공통 */
    const handleCancelRename = () => {
        setEditingTabId(null)
        setEditingWorkbookId(null)
    }

    /**
     * 이벤트 추가 — 선택된 탭의 리스트 끝에 기본값 이벤트 1건 삽입
     * @param patch 기본값 위에 덮어쓸 초기값 (재투자 구간처럼 타입이 정해진 항목을 추가할 때 사용)
     */
    const handleEventAdd = (patch?: Partial<InvestEvent>) => {
        updateActiveTab((tab) => ({
            ...tab,
            events: [
                ...tab.events,
                {
                    id: nextEventId(),
                    ...createNewEventDefault(activeWorkbook.startYear, activeWorkbook.endYear),
                    ...patch,
                },
            ],
        }))
    }

    /** 이벤트 수정 — @param id 대상 이벤트 @param patch 변경할 필드들 */
    const handleEventChange = (id: string, patch: Partial<InvestEvent>) => {
        updateActiveTab((tab) => ({
            ...tab,
            events: tab.events.map((event) => (event.id === id ? { ...event, ...patch } : event)),
        }))
    }

    /** 이벤트 삭제 — @param id 대상 이벤트 */
    const handleEventRemove = (id: string) => {
        updateActiveTab((tab) => ({ ...tab, events: tab.events.filter((event) => event.id !== id) }))
    }

    /** 생년월 변경 — @param birthYm 'YYYY-MM' (빈 문자열이면 미지정). 선택된 시트에만 적용된다 */
    const handleBirthYmChange = (birthYm: string) => {
        updateActiveTab((tab) => ({ ...tab, birthYm }))
    }

    /** 대상 기간 시작 연도 변경 — @param year 선택된 연도. 종료보다 뒤면 종료도 같이 민다 */
    const handleStartYearChange = (year: number) => {
        const startYear = clampYear(year)
        updateWorkbook(activeWorkbook.id, (workbook) => ({
            ...workbook,
            startYear,
            // 기간이 뒤집히면 계산할 달이 없어지므로 종료를 시작에 맞춰 끌어올린다
            endYear: Math.max(startYear, workbook.endYear),
        }))
    }

    /** 대상 기간 종료 연도 변경 — @param year 선택된 연도. 시작보다 앞이면 시작도 같이 당긴다 */
    const handleEndYearChange = (year: number) => {
        const endYear = clampYear(year)
        updateWorkbook(activeWorkbook.id, (workbook) => ({
            ...workbook,
            endYear,
            startYear: Math.min(endYear, workbook.startYear),
        }))
    }

    return {
        workbooks,
        activeTab,
        activeTabId: activeTab.id,
        editingTabId,
        editingWorkbookId,
        events: activeTab.events,
        birthYm: activeTab.birthYm,
        handleBirthYmChange,
        result,
        activeWorkbook,
        workbookResult,
        years,
        startYear: activeWorkbook.startYear,
        endYear: activeWorkbook.endYear,
        handleStartYearChange,
        handleEndYearChange,
        hydrating,
        persisted,
        handleMarkPersisted,
        handleAddWorkbook,
        handleRemoveWorkbook,
        handleMoveTab,
        handleStartRenameWorkbook,
        handleCommitRenameWorkbook,
        handleSelectTab,
        handleAddTab,
        handleRemoveTab,
        handleStartRenameTab,
        handleCommitRenameTab,
        handleCancelRename,
        handleEventAdd,
        handleEventChange,
        handleEventRemove,
    }
}