import {
    FixedCostType,
    LedgerKind,
    type CardStatement,
    type FixedCost,
    type FixedIncome,
    type LedgerCard,
    type LedgerEntry,
} from '../types/ledger'

// ══════════ 가계부 로컬 저장소 (localStorage) ══════════
// 적립 계산기 스냅샷과는 완전히 별개의 키로 관리한다. 저장 버튼 없이 변경 즉시 기록하므로
// 이 레이어는 순수 I/O만 담당하고 실패 처리는 호출측(훅)에서 삼킨다.

/**
 * 저장 키
 * — 카드/고정비가 추가되며 구조는 v2가 됐지만 키 이름은 그대로 둔다.
 *   키를 바꾸면 v1로 적어 둔 입출금 기록이 통째로 고아가 되기 때문이다. (아래 migrate 에서 이어받는다)
 */
const STORAGE_KEY = 'call_ledger_state_v1'

/**
 * 현재 스냅샷 구조 버전
 * — 1: 입출금만 / 2: 카드·고정비·명세서 추가 / 3: 고정 수입 추가 / 4: 고정비 종료월(endYm) 추가
 */
const STORAGE_VERSION = 4

/** localStorage에 직렬화되는 스냅샷 형태 */
export interface SavedLedgerDto {
    version: number
    /** 저장 시각 (ISO 문자열) */
    savedAt: string
    entries: LedgerEntry[]
    cards: LedgerCard[]
    fixedCosts: FixedCost[]
    fixedIncomes: FixedIncome[]
    statements: CardStatement[]
}

/** 훅이 주고받는 가계부 전체 상태 — 저장 메타(version/savedAt)를 뺀 알맹이 */
export interface LedgerSnapshot {
    entries: LedgerEntry[]
    cards: LedgerCard[]
    fixedCosts: FixedCost[]
    fixedIncomes: FixedIncome[]
    statements: CardStatement[]
}

/** 빈 가계부 */
const EMPTY_SNAPSHOT: LedgerSnapshot = {
    entries: [],
    cards: [],
    fixedCosts: [],
    fixedIncomes: [],
    statements: [],
}

// ┣━━━━━━━━━━━━━━━━ Validators ━━━━━━━━━━━━━━━━━┫

/** 항목 1건이 복원 가능한 형태인지 — 깨진 항목이 섞이면 그 건만 버린다 */
function isRestorableEntry(value: unknown): value is LedgerEntry {
    if (typeof value !== 'object' || value === null) return false
    const candidate = value as Partial<LedgerEntry>

    return typeof candidate.id === 'string'
        && typeof candidate.date === 'string'
        && (candidate.kind === LedgerKind.INCOME || candidate.kind === LedgerKind.EXPENSE)
        && typeof candidate.category === 'string'
        && typeof candidate.memo === 'string'
        && typeof candidate.amount === 'number'
        && Number.isFinite(candidate.amount)
}

/** 카드 1장이 복원 가능한 형태인지 */
function isRestorableCard(value: unknown): value is LedgerCard {
    if (typeof value !== 'object' || value === null) return false
    const candidate = value as Partial<LedgerCard>

    return typeof candidate.id === 'string' && typeof candidate.name === 'string'
}

/** 고정비 1건이 복원 가능한 형태인지 */
function isRestorableFixedCost(value: unknown): value is FixedCost {
    if (typeof value !== 'object' || value === null) return false
    const candidate = value as Partial<FixedCost>

    // endYm 은 뒤에 추가된 필드라 여기서 요구하지 않는다.
    // 옛 저장본에는 아예 없으므로 필수로 걸면 등록해 둔 고정비가 통째로 버려진다. (아래 toRestoredFixedCost 에서 채운다)
    return typeof candidate.id === 'string'
        && (candidate.type === FixedCostType.RECURRING || candidate.type === FixedCostType.INSTALLMENT)
        && typeof candidate.name === 'string'
        && typeof candidate.cardId === 'string'
        && typeof candidate.category === 'string'
        && typeof candidate.startYm === 'string'
        && typeof candidate.months === 'number'
        && typeof candidate.amount === 'number'
        && Number.isFinite(candidate.amount)
}

/** 옛 저장본 보정 — endYm 이 없던 시절의 고정비는 '무기한'으로 이어받는다 */
function toRestoredFixedCost(cost: FixedCost): FixedCost {
    return { ...cost, endYm: typeof cost.endYm === 'string' ? cost.endYm : '' }
}

/** 고정 수입 1건이 복원 가능한 형태인지 */
function isRestorableFixedIncome(value: unknown): value is FixedIncome {
    if (typeof value !== 'object' || value === null) return false
    const candidate = value as Partial<FixedIncome>

    return typeof candidate.id === 'string'
        && typeof candidate.name === 'string'
        && typeof candidate.category === 'string'
        && typeof candidate.startYm === 'string'
        && typeof candidate.amount === 'number'
        && Number.isFinite(candidate.amount)
}

/** 카드 월 청구 총액 1건이 복원 가능한 형태인지 */
function isRestorableStatement(value: unknown): value is CardStatement {
    if (typeof value !== 'object' || value === null) return false
    const candidate = value as Partial<CardStatement>

    return typeof candidate.cardId === 'string'
        && typeof candidate.ym === 'string'
        && typeof candidate.total === 'number'
        && Number.isFinite(candidate.total)
}

// ┣━━━━━━━━━━━━━━━━ API ━━━━━━━━━━━━━━━━━━━━━━━━┫

/**
 * 가계부 전체 저장 — 무엇이 바뀌든 스냅샷을 통째로 덮어쓴다
 * @param snapshot 저장할 가계부 상태
 */
export function saveLedger(snapshot: LedgerSnapshot): void {
    const dto: SavedLedgerDto = {
        version: STORAGE_VERSION,
        savedAt: new Date().toISOString(),
        ...snapshot,
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(dto))
}

/**
 * 저장된 가계부 로드
 * — v1(입출금만) · v2(고정 수입 없음) 스냅샷은 없는 배열을 빈 배열로 채워 그대로 이어받는다.
 * @returns 복원된 상태. 저장 이력이 없거나 형식이 깨졌으면 빈 가계부
 */
export function loadLedger(): LedgerSnapshot {
    try {
        // 1) 원문 조회 — 저장 이력이 없으면 빈 가계부로 시작
        const raw = localStorage.getItem(STORAGE_KEY)
        if (raw === null) return EMPTY_SNAPSHOT

        // 2) 파싱 + 버전 확인 — 모르는 미래 버전은 건드리지 않는다
        const parsed: unknown = JSON.parse(raw)
        if (typeof parsed !== 'object' || parsed === null) return EMPTY_SNAPSHOT
        const candidate = parsed as Partial<SavedLedgerDto>
        if (typeof candidate.version !== 'number' || candidate.version > STORAGE_VERSION) return EMPTY_SNAPSHOT

        // 3) 항목 단위 검증 + 옛 필드 보정
        return toRestoredSnapshot(candidate)
    } catch {
        return EMPTY_SNAPSHOT
    }
}

/**
 * 스냅샷 복원 — 깨진 항목만 걸러내고 옛 버전에 없던 필드를 채운다
 *
 * localStorage 와 서버 응답이 **같은 함수를 거치게** 하려고 밖으로 뺐다.
 * 한쪽만 보정하면 다른 경로로 들어온 옛 기록이 undefined 를 달고 화면까지 나온다.
 * @param candidate 저장본/응답 본문 (형태가 깨져 있어도 된다)
 */
export function toRestoredSnapshot(candidate: Partial<LedgerSnapshot>): LedgerSnapshot {
    // 옛 버전 스냅샷에는 뒤에 붙은 배열이 아예 없으므로 자연히 빈 배열이 된다
    return {
        entries: (candidate.entries ?? []).filter(isRestorableEntry),
        cards: (candidate.cards ?? []).filter(isRestorableCard),
        fixedCosts: (candidate.fixedCosts ?? []).filter(isRestorableFixedCost).map(toRestoredFixedCost),
        fixedIncomes: (candidate.fixedIncomes ?? []).filter(isRestorableFixedIncome),
        statements: (candidate.statements ?? []).filter(isRestorableStatement),
    }
}