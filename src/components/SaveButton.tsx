import { useEffect, useState } from 'react'
import { saveRemoteState } from '../services/stateApiService'
import { saveState, toStateSignature } from '../services/storageService'
import type { AssetStateMap, PersistedMark } from '../services/storageService'

// ┣━━━━━━━━━━━━━━━━ Constants ━━━━━━━━━━━━━━━━━━┫

/** 저장 결과 문구를 띄워 두는 시간 (ms) */
const SAVED_FLASH_MS = 2200

/** 저장 결과 — 서버까지 갔는지, 로컬에만 남았는지 구분 */
const SaveTarget = {
    /** 아직 저장한 적 없음 */
    NONE: 'NONE',
    /** 서버 + 로컬 모두 기록됨 */
    REMOTE: 'REMOTE',
    /** 서버 실패로 로컬에만 기록됨 */
    LOCAL: 'LOCAL',
} as const

type SaveTarget = (typeof SaveTarget)[keyof typeof SaveTarget]

// ┣━━━━━━━━━━━━━━━━ Helpers ━━━━━━━━━━━━━━━━━━━━┫

/** ISO 시각 → "MM/DD HH:mm" 표기 */
function formatSavedAt(value: string): string {
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return ''
    return date.toLocaleString('ko-KR', {
        month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
    })
}

interface SaveButtonProps {
    /**
     * 저장 대상 — 종목별 워크북 상태 한 벌.
     * 지금 보고 있는 종목만이 아니라 두 종목을 통째로 올린다. 탭을 오가며 고친 내용을
     * 한 번의 저장으로 함께 남겨야 다른 탭의 변경이 조용히 사라지지 않는다.
     */
    assets: AssetStateMap
    /** 마지막으로 영속화된 지문 + 시각 — 미저장 변경 여부 판정 기준 */
    persisted: PersistedMark
    /** 서버 스냅샷 합류 대기 중 여부 — 합류 전 저장은 막는다 */
    hydrating: boolean
    /** 저장 성공 통보 — @param mark 저장된 지문 + 시각 */
    onPersisted: (mark: PersistedMark) => void
}

/**
 * 플로팅 저장 버튼 — 화면 우측 상단에 고정되어 스크롤과 무관하게 항상 노출된다.
 * 저장 시 브라우저 로컬 저장소에 먼저 기록하고, 이어서 저장 서버(/api/state)로 올린다.
 */
function SaveButton(props: SaveButtonProps) {

    // ┣━━━━━━━━━━━━━━━━ States ━━━━━━━━━━━━━━━━━━━━━┫
    const [target, setTarget] = useState<SaveTarget>(SaveTarget.NONE)   // 마지막 저장이 어디까지 갔는지
    const [saving, setSaving] = useState<boolean>(false)                // 서버 전송 중 여부
    const [flashing, setFlashing] = useState<boolean>(false)            // 저장 직후 결과 문구 노출 여부
    const [error, setError] = useState<string | null>(null)             // 저장 실패 메시지

    // ┣━━━━━━━━━━━━━━━━ Derived ━━━━━━━━━━━━━━━━━━━━┫
    // 1) 현재 상태 지문 — 마지막 저장 지문과 다르면 미저장 변경이 있는 것 (종목 두 칸을 통째로 비교한다)
    const currentSignature = toStateSignature(props.assets)
    const dirty = currentSignature !== props.persisted.signature

    // 2) 저장 위치 배지 문구 — 마지막 저장이 서버까지 갔는지 표기
    const targetLabel = target === SaveTarget.REMOTE ? '서버' : '로컬'

    // ┣━━━━━━━━━━━━━━━━ Effects ━━━━━━━━━━━━━━━━━━━━┫

    // 1) 결과 문구 자동 소거 — 저장 직후에만 타이머를 건다
    useEffect(() => {
        if (!flashing) return
        const timer = window.setTimeout(() => setFlashing(false), SAVED_FLASH_MS)
        return () => window.clearTimeout(timer)
    }, [flashing])

    // 2) 미저장 변경이 있는 상태에서 새로고침/닫기 시 브라우저 기본 확인창 노출
    useEffect(() => {
        if (!dirty) return
        const handleBeforeUnload = (event: BeforeUnloadEvent) => {
            event.preventDefault()
        }
        window.addEventListener('beforeunload', handleBeforeUnload)
        return () => window.removeEventListener('beforeunload', handleBeforeUnload)
    }, [dirty])

    // ┣━━━━━━━━━━━━━━━━ Handlers ━━━━━━━━━━━━━━━━━━━┫

    /** 저장 실행 — 로컬에 먼저 기록한 뒤 서버로 올린다 */
    const handleSave = async () => {
        setSaving(true)
        const signature = currentSignature

        // 1) 로컬 우선 저장 — 서버가 꺼져 있어도 작업 내용은 브라우저에 남긴다
        let localSavedAt: string | null = null
        try {
            localSavedAt = saveState(props.assets).savedAt
        } catch {
            // 용량 초과·사생활 보호 모드 — 판정은 아래 서버 저장 결과로 넘긴다
        }

        // 2) 서버 저장 — 저장 시각은 서버가 찍은 값을 정본으로 쓴다
        try {
            const remote = await saveRemoteState(props.assets)

            // 2-1) 로컬 캐시의 저장 시각을 서버 시각으로 다시 찍는다.
            //      로컬 시계와 서버 시계가 섞이면 다음 진입 때 최신본 판정이 어긋난다.
            saveState(props.assets, remote.savedAt)

            props.onPersisted({ signature, at: remote.savedAt })
            setTarget(SaveTarget.REMOTE)
            setError(null)
        } catch (caught) {
            // 2-1) 서버 실패 — 로컬 기록이라도 성공했으면 저장된 것으로 처리하고 경고만 남긴다
            const message = caught instanceof Error ? caught.message : '서버 저장에 실패했습니다'
            if (localSavedAt !== null) {
                props.onPersisted({ signature, at: localSavedAt })
                setTarget(SaveTarget.LOCAL)
                setError(`서버 저장 실패 — 브라우저에만 저장됨 (${message})`)
            } else {
                setTarget(SaveTarget.NONE)
                setError(`저장 실패 — ${message}`)
            }
        } finally {
            setSaving(false)
            setFlashing(true)
        }
    }

    return (
        <div className={'save_button'}>
            {/* 1) 상태 문구 — 저장 중 > 실패 > 저장 직후 > 미저장 > 마지막 저장 시각 순으로 우선 표기 */}
            <span className={'save_button_meta'}>
                {saving && <span className={'save_button_meta_saving'}>저장 중…</span>}
                {!saving && error !== null && (
                    <span className={'save_button_meta_error'} title={error}>{error}</span>
                )}
                {!saving && error === null && flashing && (
                    <span className={'save_button_meta_done'}>{targetLabel}에 저장됨</span>
                )}
                {!saving && error === null && !flashing && dirty && (
                    <span className={'save_button_meta_dirty'}>변경됨</span>
                )}
                {!saving && error === null && !flashing && !dirty && props.persisted.at !== null && (
                    <span className={'save_button_meta_time'}>{formatSavedAt(props.persisted.at)} 저장</span>
                )}
            </span>

            {/* 2) 저장 버튼 — 미저장 변경이 있을 때 강조, 전송/합류 중에는 잠근다 */}
            <button
                type={'button'}
                className={dirty ? 'save_button_action save_button_action_dirty' : 'save_button_action'}
                onClick={handleSave}
                disabled={saving || props.hydrating}
                title={dirty ? '변경 내용을 서버에 저장합니다' : '모든 변경 내용이 저장되어 있습니다'}
            >
                <span className={'save_button_icon'}>💾</span>
                {saving ? '저장 중' : '저장'}
            </button>
        </div>
    )
}

export default SaveButton