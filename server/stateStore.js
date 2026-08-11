import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// ══════════ 스냅샷 파일 저장소 ══════════
// 워크북 전체 상태를 JSON 파일 1벌로 보관한다. 저장할 때마다 통째로 덮어쓴다.
// DB를 두지 않는 이유: 단일 사용자 도구이고 스냅샷 크기가 수십 KB 수준이라 파일 1개로 충분하다.

const SERVER_DIR = dirname(fileURLToPath(import.meta.url))
const DATA_DIR = join(SERVER_DIR, 'data')
const STATE_FILE = join(DATA_DIR, 'state.json')

/** 임시 파일 — 쓰기 도중 프로세스가 죽어도 원본이 깨지지 않도록 여기에 먼저 쓴다 */
const TEMP_FILE = join(DATA_DIR, 'state.json.tmp')

/** 스냅샷 구조 버전 — 프론트 storageService와 동일하게 유지한다 */
export const STORAGE_VERSION = 1

// ══════════ 검증 ══════════

/**
 * 저장 요청 본문이 스냅샷으로 쓸 수 있는 형태인지 검사
 * @param body 요청 본문
 * @returns 문제가 없으면 null, 있으면 사유 문자열
 */
export function validateSnapshot(body) {

    // 1) 최상위 형태 확인
    if (typeof body !== 'object' || body === null) return '본문이 객체가 아닙니다'
    if (!Array.isArray(body.workbooks) || body.workbooks.length === 0) {
        return 'workbooks는 1개 이상의 배열이어야 합니다'
    }
    if (typeof body.activeTabId !== 'string' || body.activeTabId.length === 0) {
        return 'activeTabId는 비어 있지 않은 문자열이어야 합니다'
    }

    // 2) 워크북 / 탭 형태 확인 — 탭이 0개인 워크북은 프론트에서 선택 탭을 못 찾아 화면이 깨진다
    for (const workbook of body.workbooks) {
        if (typeof workbook?.id !== 'string' || typeof workbook?.name !== 'string') {
            return '워크북에 id 또는 name이 없습니다'
        }
        if (!Array.isArray(workbook.tabs) || workbook.tabs.length === 0) {
            return `워크북 '${workbook.name}'에 탭이 없습니다`
        }
        for (const tab of workbook.tabs) {
            if (typeof tab?.id !== 'string' || !Array.isArray(tab?.events)) {
                return `워크북 '${workbook.name}'의 탭 형식이 올바르지 않습니다`
            }
        }
    }

    return null
}

// ══════════ 파일 I/O ══════════

/** 데이터 디렉터리 보장 — 최초 실행 시 자동 생성 */
async function ensureDataDir() {
    await mkdir(DATA_DIR, { recursive: true })
}

/**
 * 스냅샷 저장 — 원자적 교체(임시 파일 쓰기 → rename)
 * @param workbooks 워크북 전체 목록
 * @param activeTabId 저장 시점의 선택 탭 id
 * @returns 저장된 스냅샷
 */
export async function saveSnapshot(workbooks, activeTabId) {

    // 1) 저장 시각을 서버 기준으로 찍는다 — 클라이언트 시계를 믿지 않는다
    const snapshot = {
        version: STORAGE_VERSION,
        savedAt: new Date().toISOString(),
        workbooks,
        activeTabId,
    }

    // 2) 임시 파일에 먼저 쓰고 rename으로 교체 — 쓰기 중단 시에도 기존 파일이 살아남는다
    await ensureDataDir()
    await writeFile(TEMP_FILE, JSON.stringify(snapshot, null, 2), 'utf8')
    await rename(TEMP_FILE, STATE_FILE)

    return snapshot
}

/**
 * 저장된 스냅샷 조회
 * @returns 스냅샷. 저장 이력이 없거나 파일이 깨졌으면 null
 */
export async function loadSnapshot() {
    try {
        // 1) 파일 읽기 — 없으면 ENOENT로 떨어져 null 반환
        const raw = await readFile(STATE_FILE, 'utf8')
        const parsed = JSON.parse(raw)

        // 2) 버전 불일치 / 형식 파손은 없는 것으로 취급 — 프론트가 로컬 복원본으로 시작한다
        if (parsed?.version !== STORAGE_VERSION) return null
        if (validateSnapshot(parsed) !== null) return null

        return parsed
    } catch {
        return null
    }
}

/** 저장된 스냅샷 삭제 — 파일을 빈 상태로 되돌린다 */
export async function clearSnapshot() {
    await ensureDataDir()
    await writeFile(STATE_FILE, JSON.stringify({ version: STORAGE_VERSION, savedAt: null, workbooks: [], activeTabId: '' }, null, 2), 'utf8')
}

/** 스냅샷 파일 경로 — 기동 로그 표기용 */
export const STATE_FILE_PATH = STATE_FILE