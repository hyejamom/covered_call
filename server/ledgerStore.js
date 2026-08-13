import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// ══════════ 가계부 파일 저장소 ══════════
// 가계부 전체 상태를 JSON 파일 1벌로 보관한다. 저장할 때마다 통째로 덮어쓴다.
//
// 계산기 스냅샷(state.json)과 파일을 나눈 이유:
//   ① 저장 주기가 다르다 — 계산기는 저장 버튼, 가계부는 입력 즉시.
//   ② 이 파일은 git 으로 따라다녀야 한다. 한 파일에 섞으면 계산기를 만질 때마다 가계부 diff 가 붙는다.
//
// 사람이 읽고 git diff 로 비교할 파일이라 들여쓰기를 준 채로 저장한다.

const SERVER_DIR = dirname(fileURLToPath(import.meta.url))
const DATA_DIR = join(SERVER_DIR, 'data')
const LEDGER_FILE = join(DATA_DIR, 'ledger.json')

/** 임시 파일 — 쓰기 도중 프로세스가 죽어도 원본이 깨지지 않도록 여기에 먼저 쓴다 */
const TEMP_FILE = join(DATA_DIR, 'ledger.json.tmp')

/** 가계부 구조 버전 — 프론트 ledgerStorageService 와 동일하게 유지한다 */
export const LEDGER_VERSION = 4

/** 스냅샷을 이루는 배열 이름 — 검증과 기본값 생성에 함께 쓴다 */
const LEDGER_ARRAYS = ['entries', 'cards', 'fixedCosts', 'fixedIncomes', 'statements']

// ══════════ 검증 ══════════

/**
 * 저장 요청 본문이 가계부 스냅샷으로 쓸 수 있는 형태인지 검사
 * 항목 하나하나의 필드까지는 보지 않는다. 그 판정은 프론트 복원 단계가 항목 단위로 하고,
 * 여기서는 "통째로 깨진 본문"만 걸러 파일이 못 쓰는 상태가 되는 것을 막는다.
 * @param body 요청 본문
 * @returns 문제가 없으면 null, 있으면 사유 문자열
 */
export function validateLedger(body) {

    // 1) 최상위 형태 확인
    if (typeof body !== 'object' || body === null) return '본문이 객체가 아닙니다'

    // 2) 다섯 배열이 모두 배열인지 — 하나라도 빠지면 프론트 복원이 무너진다
    for (const name of LEDGER_ARRAYS) {
        if (!Array.isArray(body[name])) return `${name}는 배열이어야 합니다`
    }

    // 3) 각 항목은 최소한 id 를 가진 객체여야 한다 (통계 계산이 id 기준으로 돈다)
    for (const name of LEDGER_ARRAYS) {
        // 카드 명세서(statements)만 id 없이 카드id+월로 식별한다
        if (name === 'statements') continue
        for (const item of body[name]) {
            if (typeof item?.id !== 'string' || item.id.length === 0) {
                return `${name}에 id 없는 항목이 있습니다`
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
 * 가계부 저장 — 원자적 교체(임시 파일 쓰기 → rename)
 * @param body 프론트가 보낸 스냅샷 (entries · cards · fixedCosts · fixedIncomes · statements)
 * @returns 저장된 스냅샷
 */
export async function saveLedger(body) {

    // 1) 저장 시각을 서버 기준으로 찍는다 — 클라이언트 시계를 믿지 않는다
    const snapshot = {
        version: LEDGER_VERSION,
        savedAt: new Date().toISOString(),
        entries: body.entries,
        cards: body.cards,
        fixedCosts: body.fixedCosts,
        fixedIncomes: body.fixedIncomes,
        statements: body.statements,
    }

    // 2) 임시 파일에 먼저 쓰고 rename 으로 교체 — 쓰기 중단 시에도 기존 파일이 살아남는다
    await ensureDataDir()
    await writeFile(TEMP_FILE, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8')
    await rename(TEMP_FILE, LEDGER_FILE)

    return snapshot
}

/**
 * 저장된 가계부 조회
 * @returns 스냅샷. 저장 이력이 없거나 파일이 깨졌으면 null
 */
export async function loadLedger() {
    try {
        // 1) 파일 읽기 — 없으면 ENOENT 로 떨어져 null 반환
        const raw = await readFile(LEDGER_FILE, 'utf8')
        const parsed = JSON.parse(raw)

        // 2) 모르는 미래 버전이거나 형식이 깨졌으면 없는 것으로 취급한다.
        //    (프론트가 로컬 복원본으로 시작하고, 다음 저장 때 이 파일을 다시 세운다)
        if (typeof parsed?.version !== 'number' || parsed.version > LEDGER_VERSION) return null
        if (validateLedger(parsed) !== null) return null

        return parsed
    } catch {
        return null
    }
}

/** 가계부 파일 경로 — 기동 로그 표기용 */
export const LEDGER_FILE_PATH = LEDGER_FILE
