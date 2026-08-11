import { DEFAULT_END_YEAR, DEFAULT_START_YEAR, clampYear } from '../constants/gridConstants'
import type { Workbook } from '../types/workbook'

// ══════════ 로컬 저장소 (localStorage) ══════════
// 서버가 없는 단일 사용자 도구라 브라우저 로컬 저장소에 스냅샷 1벌만 유지한다.
// 이 레이어는 순수 I/O만 담당하고, 실패 메시지·토스트는 호출측(컴포넌트)에서 처리한다.

/** 저장 키 — 스냅샷 구조가 바뀌면 접미 버전을 올려 과거 데이터와 분리한다 */
const STORAGE_KEY = 'call_workbook_state_v1'

/** 현재 스냅샷 구조 버전 */
const STORAGE_VERSION = 1

/** localStorage에 직렬화되는 스냅샷 형태 */
export interface SavedStateDto {
    /** 스냅샷 구조 버전 — 불일치 시 로드하지 않는다 */
    version: number
    /** 저장 시각 (ISO 문자열) */
    savedAt: string
    /** 워크북(=엑셀 파일) 전체 목록 */
    workbooks: Workbook[]
    /** 저장 시점에 선택돼 있던 탭 id */
    activeTabId: string
}

/** 마지막으로 영속화된 시점 표식 — 미저장 변경 여부 판정에 쓴다 */
export interface PersistedMark {
    /** 저장 시점의 상태 지문 (null이면 저장 이력 없음) */
    signature: string | null
    /** 저장 시각 ISO 문자열 (null이면 저장 이력 없음) */
    at: string | null
}

// ┣━━━━━━━━━━━━━━━━ Helpers ━━━━━━━━━━━━━━━━━━━━┫

/**
 * 저장 상태 비교용 지문 생성
 * — 워크북 트리와 선택 탭을 직렬화해 마지막 저장 시점과 같은지 판정한다.
 */
export function toStateSignature(workbooks: Workbook[], activeTabId: string): string {
    return JSON.stringify({ workbooks, activeTabId })
}

// ┣━━━━━━━━━━━━━━━━ Validators ━━━━━━━━━━━━━━━━━┫

/**
 * 파싱된 값이 복원 가능한 스냅샷인지 검사
 * — 빈 워크북/빈 탭이 복원되면 화면에서 선택 탭을 못 찾아 터지므로 여기서 걸러낸다.
 */
function isRestorable(parsed: unknown): parsed is SavedStateDto {

    // 1) 객체 형태 + 버전 일치 확인
    if (typeof parsed !== 'object' || parsed === null) return false
    const candidate = parsed as Partial<SavedStateDto>
    if (candidate.version !== STORAGE_VERSION) return false

    // 2) 워크북이 최소 1개, 각 워크북에 탭이 최소 1개 있어야 한다
    if (!Array.isArray(candidate.workbooks) || candidate.workbooks.length === 0) return false
    const validShape = candidate.workbooks.every((workbook) => (
        typeof workbook?.id === 'string'
        && typeof workbook?.name === 'string'
        && Array.isArray(workbook?.tabs)
        && workbook.tabs.length > 0
        && workbook.tabs.every((tab) => typeof tab?.id === 'string' && Array.isArray(tab?.events))
    ))
    if (!validShape) return false

    // 3) 선택 탭 id 존재 여부 — 없으면 복원 후 첫 탭으로 대체되므로 타입만 확인한다
    return typeof candidate.activeTabId === 'string'
}

// ┣━━━━━━━━━━━━━━━━ Normalizer ━━━━━━━━━━━━━━━━━┫

/**
 * 예전 버전에서 저장된 스냅샷 보정
 * — 나중에 추가된 필드(대상 기간, 생년월, 재투자 여부)가 없는 데이터를 그대로 쓰면
 *   화면에서 undefined 를 참조하다 통째로 터지므로 여기서 기본값을 채워 넣는다.
 * @param workbooks 복원된(또는 서버에서 받은) 워크북 목록
 */
export function normalizeWorkbooks(workbooks: Workbook[]): Workbook[] {
    return workbooks.map((workbook) => {
        // 1) 대상 기간 — 기간 기능 도입 이전 저장본에는 없으므로 기본값(2026~2050)으로 채운다
        const startYear = clampYear(
            typeof workbook.startYear === 'number' ? workbook.startYear : DEFAULT_START_YEAR,
        )
        const rawEndYear = typeof workbook.endYear === 'number' ? workbook.endYear : DEFAULT_END_YEAR

        return {
            ...workbook,
            startYear,
            // 2) 종료가 시작보다 앞서면 기간이 사라지므로 최소 시작 연도까지 끌어올린다
            endYear: Math.max(startYear, clampYear(rawEndYear)),
            tabs: workbook.tabs.map((tab) => ({
                ...tab,
                // 3) 생년월 — 미지정('')이 기본
                birthYm: typeof tab.birthYm === 'string' ? tab.birthYm : '',
                events: tab.events.map((event) => ({
                    ...event,
                    // 4) 재투자 여부 — 기존 동작(항상 재투자)과 맞춰 true 가 기본
                    reinvest: typeof event.reinvest === 'boolean' ? event.reinvest : true,
                })),
            })),
        }
    })
}

// ┣━━━━━━━━━━━━━━━━ API ━━━━━━━━━━━━━━━━━━━━━━━━┫

/**
 * 현재 상태를 스냅샷으로 저장
 * @param workbooks 저장할 워크북 전체 목록
 * @param activeTabId 저장 시점의 선택 탭 id
 * @param savedAt 저장 시각 덮어쓰기 (ISO). 서버 저장에 성공하면 서버가 찍은 시각을 넘긴다.
 * @returns 저장된 스냅샷 (savedAt 표기에 사용)
 */
export function saveState(workbooks: Workbook[], activeTabId: string, savedAt?: string): SavedStateDto {

    // 1) 스냅샷 조립 — 시세/상수는 매 진입 시 새로 조회하므로 저장 대상이 아니다
    //    저장 시각은 서버 값을 우선 쓴다. 로컬 시계와 서버 시계가 섞이면
    //    다음 진입 때 "서버본이 더 최신인가" 비교가 어긋나기 때문이다.
    const snapshot: SavedStateDto = {
        version: STORAGE_VERSION,
        savedAt: savedAt ?? new Date().toISOString(),
        workbooks,
        activeTabId,
    }

    // 2) 직렬화 후 기록 — 용량 초과(QuotaExceededError) 등은 그대로 던진다
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot))
    return snapshot
}

/**
 * 저장된 스냅샷 로드
 * @returns 복원 가능한 스냅샷. 저장 이력이 없거나 형식이 깨졌으면 null
 */
export function loadState(): SavedStateDto | null {
    try {
        // 1) 원문 조회 — 저장 이력이 없으면 즉시 종료
        const raw = localStorage.getItem(STORAGE_KEY)
        if (raw === null) return null

        // 2) 파싱 + 형식 검증 — 깨진 데이터는 없는 것으로 취급해 기본 상태로 시작한다
        const parsed: unknown = JSON.parse(raw)
        if (!isRestorable(parsed)) return null

        // 3) 구버전 스냅샷 보정 — 뒤늦게 추가된 필드를 기본값으로 채운다
        return { ...parsed, workbooks: normalizeWorkbooks(parsed.workbooks) }
    } catch {
        return null
    }
}

/** 저장된 스냅샷 삭제 — 다음 진입 시 기본 상태로 시작한다 */
export function clearState(): void {
    localStorage.removeItem(STORAGE_KEY)
}