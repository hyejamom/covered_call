import type { LedgerSnapshot } from './ledgerStorageService'

// ══════════ 통신용 DTO ══════════

/** GET /api/ledger 응답 — 서버 파일에 보관된 가계부 전문 */
export interface RemoteLedgerDto extends LedgerSnapshot {
    version: number
    /** 서버 기준 저장 시각 (ISO) */
    savedAt: string
}

/** POST /api/ledger 응답 — 저장 결과 메타만 돌려받는다 */
export interface RemoteLedgerSaveResultDto {
    version: number
    savedAt: string
}

/** 에러 응답 본문 */
interface ErrorResponseDto {
    message: string
}

// ══════════ 상수 ══════════

const LEDGER_ENDPOINT = '/api/ledger'

/** 서버가 안 떠 있을 때 오래 매달리지 않도록 하는 타임아웃 (ms) */
const REQUEST_TIMEOUT_MS = 5000

// ══════════ 내부 헬퍼 ══════════

/**
 * 타임아웃이 걸린 fetch
 * @param path 요청 경로
 * @param init fetch 옵션
 */
async function fetchWithTimeout(path: string, init?: RequestInit): Promise<Response> {
    const controller = new AbortController()
    const timer = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    try {
        return await fetch(path, { ...init, signal: controller.signal })
    } finally {
        window.clearTimeout(timer)
    }
}

/** 실패 응답에서 서버 메시지 추출 — 본문이 없으면 상태 코드로 대체 */
async function toErrorMessage(response: Response): Promise<string> {
    try {
        const body: ErrorResponseDto = await response.json()
        return body.message
    } catch {
        return `서버 응답 오류 (${response.status})`
    }
}

// ══════════ API ══════════
// 이 레이어는 통신만 담당한다. 실패 시 예외를 그대로 던지고, 상태 표시는 호출측(훅)에서 처리한다.

/**
 * 서버 파일에 보관된 가계부 조회
 * @returns 가계부. 저장 이력이 없으면(204) null
 */
export async function fetchRemoteLedger(): Promise<RemoteLedgerDto | null> {
    const response = await fetchWithTimeout(LEDGER_ENDPOINT)

    // 1) 저장 이력 없음 — 본문이 비어 있다
    if (response.status === 204) return null

    // 2) 그 외 실패는 예외로 올린다
    if (!response.ok) throw new Error(await toErrorMessage(response))

    return await response.json()
}

/**
 * 현재 가계부를 서버에 저장 (기존 파일 덮어쓰기)
 * @param snapshot 저장할 가계부 상태
 * @returns 서버가 확정한 저장 시각
 */
export async function saveRemoteLedger(snapshot: LedgerSnapshot): Promise<RemoteLedgerSaveResultDto> {
    const response = await fetchWithTimeout(LEDGER_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(snapshot),
    })

    if (!response.ok) throw new Error(await toErrorMessage(response))

    return await response.json()
}
