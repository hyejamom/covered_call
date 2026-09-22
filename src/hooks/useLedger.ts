import { useEffect, useRef, useState } from 'react'
import { LIVING_CATEGORY, shiftYm, todayYm, toYmOfDate } from '../constants/ledgerConstants'
import {
    toCardStatements,
    toCardUsedOfMonth,
    toChargesOfMonth,
    toErrandTotalOfMonth,
    toIncomesOfMonth,
    toLivingCost,
} from '../services/ledgerEngine'
import { fetchRemoteLedger, saveRemoteLedger } from '../services/ledgerApiService'
import {
    loadLedger,
    saveLedger,
    toRestoredSnapshot,
    type LedgerSnapshot,
} from '../services/ledgerStorageService'
import {
    FixedCostType,
    LedgerKind,
    type CardErrand,
    type CardMonthlyStatement,
    type CardStatement,
    type FixedCost,
    type FixedCostCharge,
    type FixedIncome,
    type LedgerCard,
    type LedgerCategorySummary,
    type LedgerEntry,
    type LedgerMonthSummary,
} from '../types/ledger'

// ┣━━━━━━━━━━━━━━━━ Constants ━━━━━━━━━━━━━━━━━━┫

/** id 발급용 카운터 — 렌더와 무관한 모듈 스코프 값 */
let idSequence = 0

/** 신규 id 발급 — 같은 밀리초에 여러 건이 들어와도 겹치지 않도록 카운터를 덧붙인다 */
function nextId(prefix: string): string {
    idSequence += 1
    return `${prefix}_${Date.now()}_${idSequence}`
}

/** 항목 정렬 — 날짜 내림차순, 같은 날이면 나중에 넣은 것이 위로 */
function compareEntries(a: LedgerEntry, b: LedgerEntry): number {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1
    return a.id < b.id ? 1 : -1
}

/** 서버 저장 상태 — 화면 상단 문구로 그대로 나간다 */
export const LedgerSyncStatus = {
    /** 서버에 보관된 내용을 불러오는 중 */
    LOADING: 'LOADING',
    /** 서버와 같은 내용 */
    SAVED: 'SAVED',
    /** 바뀐 내용을 올리는 중 */
    SAVING: 'SAVING',
    /** 서버가 안 떠 있음 — 이 브라우저에만 남는다 */
    OFFLINE: 'OFFLINE',
    /** 서버는 응답했지만 저장을 거부함 */
    ERROR: 'ERROR',
} as const

export type LedgerSyncStatus = (typeof LedgerSyncStatus)[keyof typeof LedgerSyncStatus]

/** 서버에 올린 내용과 같은지 비교하기 위한 키 — 필드 순서를 고정해 직렬화한다 */
function toSyncKey(snapshot: LedgerSnapshot): string {
    return JSON.stringify([
        snapshot.entries,
        snapshot.cards,
        snapshot.fixedCosts,
        snapshot.fixedIncomes,
        snapshot.statements,
        snapshot.errands,
    ])
}

/** 입력이 멎고 이만큼 지나면 서버로 올린다 (ms) — 타이핑 한 글자마다 쏘지 않기 위함 */
const SAVE_DEBOUNCE_MS = 800

/** 서버 저장 1회 결과 — 예외를 밖으로 흘리지 않고 상태로 바꿔 돌려준다 */
interface PushResult {
    status: LedgerSyncStatus
    /** 성공 시 서버가 확정한 저장 시각 */
    savedAt: string | null
    /** 실패 사유 (성공이면 null) */
    message: string | null
}

/**
 * 서버 저장 1회 시도
 * — 연결 자체가 안 되는 경우(서버 꺼짐·타임아웃)와 서버가 거부한 경우를 갈라 상태로 돌려준다.
 *   앞은 "서버를 켜면 해결", 뒤는 "내용이 문제"라 사용자가 할 일이 다르기 때문이다.
 * @param snapshot 올릴 가계부 상태
 */
async function pushLedger(snapshot: LedgerSnapshot): Promise<PushResult> {
    try {
        const result = await saveRemoteLedger(snapshot)
        return { status: LedgerSyncStatus.SAVED, savedAt: result.savedAt, message: null }
    } catch (caught) {
        // fetch 는 연결 실패에 TypeError, 타임아웃(abort)에 AbortError 를 던진다
        const offline = caught instanceof TypeError
            || (caught instanceof DOMException && caught.name === 'AbortError')

        return {
            status: offline ? LedgerSyncStatus.OFFLINE : LedgerSyncStatus.ERROR,
            savedAt: null,
            message: caught instanceof Error ? caught.message : '서버에 저장하지 못했습니다',
        }
    }
}

// ┣━━━━━━━━━━━━━━━━ Hook ━━━━━━━━━━━━━━━━━━━━━━━┫

/**
 * 가계부 상태 훅
 * — 입출금 항목 · 카드 · 고정비 · 고정 수입 · 카드 명세서 총액 · 대납(엄마 심부름)을 한 스냅샷으로 들고 있고,
 *   선택된 달로 걸러 화면에 넘긴다.
 * — 저장 버튼이 없다. 입력이 멎으면 서버 파일(server/data/ledger.json)로 올라가고,
 *   localStorage 에는 같은 내용을 즉시 복사해 둔다. 서버가 꺼져 있을 때 기록을 잃지 않기 위한 대비책이다.
 * — 진입 시에는 서버 파일이 이긴다. 다른 기기에서 git pull 로 받은 내용이 그대로 펼쳐져야 하기 때문이다.
 */
export function useLedger() {

    // ┣━━━━━━━━━━━━━━━━ States ━━━━━━━━━━━━━━━━━━━━━┫
    const [snapshot] = useState(() => loadLedger())                                   // 최초 1회 복원한 저장본
    const [entries, setEntries] = useState<LedgerEntry[]>(snapshot.entries)           // 직접 입력한 입출금 항목
    const [cards, setCards] = useState<LedgerCard[]>(snapshot.cards)                  // 등록된 결제 카드
    const [fixedCosts, setFixedCosts] = useState<FixedCost[]>(snapshot.fixedCosts)    // 고정비 · 할부 정의
    const [fixedIncomes, setFixedIncomes] = useState<FixedIncome[]>(snapshot.fixedIncomes) // 고정 수입 정의 (급여 등)
    const [statements, setStatements] = useState<CardStatement[]>(snapshot.statements) // 카드별 월 청구 총액 (직접 입력)
    const [errands, setErrands] = useState<CardErrand[]>(snapshot.errands)           // 대납(엄마 심부름) — 카드값에 섞인 남의 돈
    const [selectedYm, setSelectedYm] = useState<string>(todayYm())                   // 화면에 펼쳐 볼 달 'YYYY-MM'
    const [syncStatus, setSyncStatus] = useState<LedgerSyncStatus>(LedgerSyncStatus.LOADING) // 서버 저장 상태
    const [syncedAt, setSyncedAt] = useState<string | null>(null)                     // 서버가 확정한 마지막 저장 시각 (ISO)
    const [syncError, setSyncError] = useState<string | null>(null)                   // 마지막 실패 사유 — 툴팁으로 보여준다
    const [hydrated, setHydrated] = useState<boolean>(false)                          // 서버 조회가 끝났는지. 끝나기 전에는 저장하지 않는다

    // ┣━━━━━━━━━━━━━━━━ Refs ━━━━━━━━━━━━━━━━━━━━━━━┫
    // 서버에 마지막으로 올린 내용의 키 — 같은 내용을 다시 올려 파일(과 git diff)을 흔들지 않기 위함
    const syncedKeyRef = useRef<string | null>(null)

    // ┣━━━━━━━━━━━━━━━━ Effects ━━━━━━━━━━━━━━━━━━━━┫

    // 1) 서버 복원 — 진입 시 한 번. 서버 파일이 로컬 복원본을 덮어쓴다
    useEffect(() => {
        // 화면을 떠난 뒤 응답이 도착해 이미 없는 컴포넌트의 상태를 건드리는 것을 막는다
        let alive = true

        void (async () => {
            try {
                const remote = await fetchRemoteLedger()
                if (!alive) return

                // 1-1) 서버에 이력이 있으면 그것으로 통째로 갈아 끼운다 (git pull 로 받은 내용이 이 경로로 들어온다).
                //      로컬 복원과 같은 보정을 거쳐야 옛 버전 파일의 빠진 필드가 채워진다.
                if (remote !== null) {
                    const restored = toRestoredSnapshot(remote)
                    setEntries(restored.entries)
                    setCards(restored.cards)
                    setFixedCosts(restored.fixedCosts)
                    setFixedIncomes(restored.fixedIncomes)
                    setStatements(restored.statements)
                    setErrands(restored.errands)

                    // 기준은 받은 원문 그대로 잡는다 — 보정으로 내용이 달라진 옛 파일이면
                    // 아래 저장 효과가 곧바로 "채워진 형태"로 서버 파일을 한 번 갱신하고, 이후로는 조용해진다
                    syncedKeyRef.current = toSyncKey(remote)
                    setSyncedAt(remote.savedAt)
                    setSyncStatus(LedgerSyncStatus.SAVED)
                    return
                }

                // 1-2) 서버에 아직 파일이 없다 — 빈 내용을 기준으로 잡아,
                //      로컬에 뭔가 있으면 아래 저장 효과가 그것을 첫 파일로 올린다
                syncedKeyRef.current = toSyncKey({
                    entries: [], cards: [], fixedCosts: [], fixedIncomes: [], statements: [], errands: [],
                })
                setSyncStatus(LedgerSyncStatus.SAVED)
            } catch (caught) {
                if (!alive) return

                // 1-3) 서버가 안 떠 있음 — 로컬 복원본으로 계속 쓰되, 서버에 없다는 것을 화면에 알린다
                syncedKeyRef.current = null
                setSyncError(caught instanceof Error ? caught.message : '서버에 연결하지 못했습니다')
                setSyncStatus(LedgerSyncStatus.OFFLINE)
            } finally {
                if (alive) setHydrated(true)
            }
        })()

        return () => {
            alive = false
        }
    }, [])

    // 2) 자동 저장 — 여섯 중 무엇이 바뀌든 로컬에 즉시 복사하고, 입력이 멎으면 서버로 올린다
    useEffect(() => {
        // 2-1) 서버 조회가 끝나기 전에 올리면, 읽어 보지도 않은 서버 파일을 로컬 내용으로 덮어쓴다
        if (!hydrated) return

        const snapshot: LedgerSnapshot = { entries, cards, fixedCosts, fixedIncomes, statements, errands }

        // 2-2) 로컬 복사 — 서버가 죽어 있어도 이 브라우저에서는 이어서 쓸 수 있게 한다
        try {
            saveLedger(snapshot)
        } catch {
            // 용량 초과 · 사생활 보호 모드 — 화면 동작은 그대로 두고 로컬 저장만 건너뛴다
        }

        // 2-3) 서버에 올린 내용과 같으면 보내지 않는다 (진입 직후 되쓰기 방지)
        const key = toSyncKey(snapshot)
        if (key === syncedKeyRef.current) return

        // 2-4) 입력이 멎을 때까지 기다렸다가 한 번만 올린다
        setSyncStatus(LedgerSyncStatus.SAVING)
        const timer = window.setTimeout(() => {
            void (async () => {
                const result = await pushLedger(snapshot)
                if (result.status === LedgerSyncStatus.SAVED) syncedKeyRef.current = key

                setSyncedAt((prev) => result.savedAt ?? prev)
                setSyncError(result.message)
                setSyncStatus(result.status)
            })()
        }, SAVE_DEBOUNCE_MS)

        // 2-5) 저장이 나가기 전에 또 바뀌면 앞 예약을 버린다
        return () => window.clearTimeout(timer)
    }, [hydrated, entries, cards, fixedCosts, fixedIncomes, statements, errands])

    // ┣━━━━━━━━━━━━━━━━ Derived ━━━━━━━━━━━━━━━━━━━━┫
    // 1) 선택된 달의 입출금 항목만 추려 정렬 (React Compiler 가 자동 메모이제이션하므로 useMemo 를 쓰지 않는다)
    const monthEntries: LedgerEntry[] = entries
        .filter((entry) => toYmOfDate(entry.date) === selectedYm)
        .sort(compareEntries)

    // 2) 그 달에 청구되는 고정비 — 할부는 회차 범위 안에 든 것만 살아남는다
    const charges: FixedCostCharge[] = toChargesOfMonth(fixedCosts, selectedYm)
    const fixedTotal: number = charges.reduce((sum, charge) => sum + charge.amount, 0)

    // 3) 그 달에 들어오는 고정 수입 — 시작 월 이후면 매월 같은 금액이 잡힌다
    const monthIncomes: FixedIncome[] = toIncomesOfMonth(fixedIncomes, selectedYm)
    const fixedIncomeTotal: number = monthIncomes.reduce((sum, income) => sum + income.amount, 0)

    // 4) 카드별 정산 — 명세서 총액에서 자동 청구분과 대납을 걷어낸 실제 사용액
    const cardStatements: CardMonthlyStatement[] = toCardStatements(cards, charges, statements, errands, selectedYm)

    // 5) 그 달 카드로 새로 쓴 금액 — 명세서를 적어 넣은 카드만 잡힌다
    const cardUsedTotal: number = toCardUsedOfMonth(charges, statements, errands, selectedYm)

    // 5-1) 그 달 대납 합계 — 위 카드 사용액에서 이미 빠진 금액. 얼마를 걷어냈는지 화면에 알리는 용도
    const errandTotal: number = toErrandTotalOfMonth(errands, selectedYm)

    // 6) 월 요약 — "이번 달 얼마 남길 수 있나"를 세운다.
    //    직접 입력한 지출은 대개 카드로 긁은 큰 건이라 카드 사용액 안에 이미 있다.
    //    그래서 지출을 따로 더하는 대신, 카드 사용액에서 직접 입력분을 뺀 나머지를 생활비로 잡아 합산한다.
    //    (직접 입력분이 더 크면 현금·계좌이체가 섞인 것이라 생활비는 0이 되고 직접 입력분이 그대로 총지출에 들어간다)
    const summary: LedgerMonthSummary = monthEntries.reduce<LedgerMonthSummary>((acc, entry) => {
        if (entry.kind === LedgerKind.INCOME) acc.income += entry.amount
        else acc.expense += entry.amount
        return acc
    }, {
        income: 0,
        fixedIncome: fixedIncomeTotal,
        expense: 0,
        fixed: fixedTotal,
        cardUsed: cardUsedTotal,
        errand: errandTotal,
        living: 0,
        total: 0,
        net: 0,
    })
    summary.living = toLivingCost(summary.cardUsed, summary.expense)
    summary.total = summary.fixed + summary.expense + summary.living
    summary.net = (summary.income + summary.fixedIncome) - summary.total

    // 7) 분류별 지출 집계 — 고정비 · 직접 입력한 큰 지출 · 나머지를 뭉친 생활비를 한 통에 담는다
    const expenseByCategory: LedgerCategorySummary[] = Object.entries(
        [
            ...monthEntries
                .filter((entry) => entry.kind === LedgerKind.EXPENSE)
                .map((entry) => ({ category: entry.category, amount: entry.amount })),
            ...charges.map((charge) => ({ category: charge.cost.category, amount: charge.amount })),
            ...(summary.living > 0 ? [{ category: LIVING_CATEGORY, amount: summary.living }] : []),
        ].reduce<Record<string, number>>((acc, item) => {
            acc[item.category] = (acc[item.category] ?? 0) + item.amount
            return acc
        }, {}),
    )
        .map(([category, amount]) => ({
            category,
            amount,
            ratio: summary.total > 0 ? amount / summary.total : 0,
        }))
        .sort((a, b) => b.amount - a.amount)

    // 8) 기록이 있는 달 목록 — 월 이동 시 "여기에 기록이 있다"를 표시하는 데 쓴다
    //    카드 명세서만 적어 둔 달도 기록이 있는 달로 친다 (이 가계부는 카드값 입력이 주된 기록이다)
    const recordedYms: string[] = [...new Set([
        ...entries.map((entry) => toYmOfDate(entry.date)),
        ...statements.map((statement) => statement.ym),
    ])].sort()

    // ┣━━━━━━━━━━━━━━━━ Handlers ━━━━━━━━━━━━━━━━━━━┫

    /**
     * 서버 저장 다시 시도 — 실패한 채로 남아 있는 내용을 지금 곧바로 올린다
     * 서버를 뒤늦게 켠 경우, 다음 입력을 기다리지 않고 여기서 복구할 수 있게 한다.
     */
    const handleRetrySync = () => {
        const snapshot: LedgerSnapshot = { entries, cards, fixedCosts, fixedIncomes, statements, errands }
        const key = toSyncKey(snapshot)

        setSyncStatus(LedgerSyncStatus.SAVING)
        void (async () => {
            const result = await pushLedger(snapshot)
            if (result.status === LedgerSyncStatus.SAVED) syncedKeyRef.current = key

            setSyncedAt((prev) => result.savedAt ?? prev)
            setSyncError(result.message)
            setSyncStatus(result.status)
        })()
    }

    /** 볼 달 직접 선택 — @param ym 'YYYY-MM' (빈 값이면 무시) */
    const handleSelectYm = (ym: string) => {
        if (ym === '') return
        setSelectedYm(ym)
    }

    /** 이전/다음 달 이동 — @param delta 더할 개월 수 (-1 이전, +1 다음) */
    const handleShiftMonth = (delta: number) => {
        setSelectedYm((prev) => shiftYm(prev, delta))
    }

    /** 이번 달로 복귀 */
    const handleGoToday = () => {
        setSelectedYm(todayYm())
    }

    /**
     * 입출금 항목 추가 — @param draft 입력 폼에서 넘어온 값 (id 는 여기서 발급)
     * 다른 달 날짜로 넣으면 그 달로 화면을 옮겨, 방금 넣은 항목이 어디에도 안 보이는 상황을 막는다.
     */
    const handleAddEntry = (draft: Omit<LedgerEntry, 'id'>) => {
        setEntries((prev) => [...prev, { ...draft, id: nextId('led') }])

        const draftYm = toYmOfDate(draft.date)
        if (draftYm !== selectedYm) setSelectedYm(draftYm)
    }

    /**
     * 입출금 항목 수정 — @param id 대상 항목, @param patch 폼에서 새로 넘어온 값 전체
     * 날짜를 다른 달로 옮기면 화면도 그 달로 따라가, 고친 항목이 어디에도 안 보이는 상황을 막는다.
     */
    const handleUpdateEntry = (id: string, patch: Omit<LedgerEntry, 'id'>) => {
        setEntries((prev) => prev.map((entry) => (entry.id === id ? { ...patch, id } : entry)))

        const patchYm = toYmOfDate(patch.date)
        if (patchYm !== selectedYm) setSelectedYm(patchYm)
    }

    /** 입출금 항목 삭제 — @param id 삭제할 항목 id */
    const handleRemoveEntry = (id: string) => {
        setEntries((prev) => prev.filter((entry) => entry.id !== id))
    }

    /** 카드 추가 — @param name 카드 이름 (공백이면 무시) */
    const handleAddCard = (name: string) => {
        const trimmedName = name.trim()
        if (trimmedName.length === 0) return
        setCards((prev) => [...prev, { id: nextId('card'), name: trimmedName }])
    }

    /**
     * 카드 삭제 — @param cardId 삭제할 카드 id
     * 그 카드에 물려 있던 고정비는 지우지 않고 "카드 없음"으로 떨어뜨린다. (기록 자체를 잃지 않도록)
     * 반면 명세서 총액과 대납은 그 카드 없이는 의미가 없는 값이라 함께 지운다.
     */
    const handleRemoveCard = (cardId: string) => {
        setCards((prev) => prev.filter((card) => card.id !== cardId))
        setFixedCosts((prev) => prev.map((cost) => (cost.cardId === cardId ? { ...cost, cardId: '' } : cost)))
        setStatements((prev) => prev.filter((statement) => statement.cardId !== cardId))
        setErrands((prev) => prev.filter((errand) => errand.cardId !== cardId))
    }

    /** 고정비/할부 추가 — @param draft 입력 폼에서 넘어온 값 (id 는 여기서 발급) */
    const handleAddFixedCost = (draft: Omit<FixedCost, 'id'>) => {
        setFixedCosts((prev) => [...prev, {
            ...draft,
            id: nextId('fix'),
            // 진짜 고정비는 개월 수 개념이 없으므로 0으로 못 박는다
            months: draft.type === FixedCostType.INSTALLMENT ? draft.months : 0,
        }])
    }

    /**
     * 고정비/할부 수정 — @param id 대상 고정비, @param patch 폼에서 새로 넘어온 값 전체
     * id 는 유지하고 나머지를 통째로 갈아 끼운다. 등록과 같은 폼을 쓰므로 부분 병합은 하지 않는다.
     */
    const handleUpdateFixedCost = (id: string, patch: Omit<FixedCost, 'id'>) => {
        setFixedCosts((prev) => prev.map((cost) => (cost.id === id ? {
            ...patch,
            id,
            // 진짜 고정비로 바꿔 저장하면 개월 수는 의미가 없어지므로 0으로 되돌린다
            months: patch.type === FixedCostType.INSTALLMENT ? patch.months : 0,
        } : cost)))
    }

    /**
     * 고정비 금액 변경 — 선택된 달부터 새 금액이 적용되게 항목을 둘로 가른다
     * @param id 대상 고정비
     * @param amount 이 달부터 적용할 새 월 금액
     *
     * 1) 기존 항목은 전월까지로 끊는다 → 이미 결산이 끝난 과거 달의 합계가 흔들리지 않는다
     * 2) 이름·카드·분류를 물려받은 새 항목을 선택된 달부터 시작시킨다
     * 3) 선택된 달이 곧 시작 월이면 가를 과거가 없으므로 그냥 금액만 고친다
     */
    const handleChangeFixedCostAmount = (id: string, amount: number) => {
        const target = fixedCosts.find((cost) => cost.id === id)
        if (target === undefined) return

        // 3) 가를 과거가 없는 경우 — 시작 월 이전이거나 시작 월 당월
        if (selectedYm <= target.startYm) {
            setFixedCosts((prev) => prev.map((cost) => (cost.id === id ? { ...cost, amount } : cost)))
            return
        }

        const previousYm = shiftYm(selectedYm, -1)
        setFixedCosts((prev) => [
            // 1) 기존 항목 종료 — 전월까지만 청구
            ...prev.map((cost) => (cost.id === id ? { ...cost, endYm: previousYm } : cost)),
            // 2) 새 금액 항목 — 선택된 달부터. 원래 종료월이 있었다면 그대로 물려받는다
            { ...target, id: nextId('fix'), startYm: selectedYm, amount },
        ])
    }

    /**
     * 고정비 해지 — 선택된 달부터 더는 빠지지 않게 전월까지로 끊는다
     * @param id 대상 고정비
     * 삭제와 다르다. 삭제하면 과거 달에서도 사라져 지난 결산이 함께 틀어진다.
     */
    const handleEndFixedCost = (id: string) => {
        const previousYm = shiftYm(selectedYm, -1)
        setFixedCosts((prev) => prev.map((cost) => (cost.id === id ? { ...cost, endYm: previousYm } : cost)))
    }

    /** 고정비 해지 취소 — 종료월을 지워 다시 무기한으로 되돌린다 @param id 대상 고정비 */
    const handleResumeFixedCost = (id: string) => {
        setFixedCosts((prev) => prev.map((cost) => (cost.id === id ? { ...cost, endYm: '' } : cost)))
    }

    /** 고정비/할부 삭제 — @param id 삭제할 고정비 id */
    const handleRemoveFixedCost = (id: string) => {
        setFixedCosts((prev) => prev.filter((cost) => cost.id !== id))
    }

    /** 고정 수입 추가 — @param draft 입력 폼에서 넘어온 값 (id 는 여기서 발급) */
    const handleAddFixedIncome = (draft: Omit<FixedIncome, 'id'>) => {
        setFixedIncomes((prev) => [...prev, { ...draft, id: nextId('inc') }])
    }

    /**
     * 고정 수입 수정 — @param id 대상 고정 수입, @param patch 폼에서 새로 넘어온 값 전체
     * id 는 유지하고 나머지를 통째로 갈아 끼운다. 등록과 같은 폼을 쓰므로 부분 병합은 하지 않는다.
     */
    const handleUpdateFixedIncome = (id: string, patch: Omit<FixedIncome, 'id'>) => {
        setFixedIncomes((prev) => prev.map((income) => (income.id === id ? { ...patch, id } : income)))
    }

    /** 고정 수입 삭제 — @param id 삭제할 고정 수입 id */
    const handleRemoveFixedIncome = (id: string) => {
        setFixedIncomes((prev) => prev.filter((income) => income.id !== id))
    }

    /**
     * 카드 명세서 총액 입력 — @param cardId 대상 카드, @param total 그 달 청구 총액 (null 이면 입력 취소)
     * 선택된 달에 대해서만 기록한다.
     */
    const handleChangeStatement = (cardId: string, total: number | null) => {
        setStatements((prev) => {
            const rest = prev.filter(
                (statement) => !(statement.cardId === cardId && statement.ym === selectedYm),
            )
            if (total === null) return rest
            return [...rest, { cardId, ym: selectedYm, total }]
        })
    }

    /**
     * 대납 추가 — @param cardId 결제 카드, @param memo 내용, @param amount 금액 (원)
     * 선택된 달에 대해서만 기록한다. 금액이 0 이하면 정산에 영향이 없으므로 넣지 않는다.
     */
    const handleAddErrand = (cardId: string, memo: string, amount: number) => {
        if (!Number.isFinite(amount) || amount <= 0) return
        setErrands((prev) => [...prev, {
            id: nextId('err'),
            cardId,
            ym: selectedYm,
            memo: memo.trim(),
            amount: Math.round(amount),
        }])
    }

    /** 대납 삭제 — @param id 삭제할 대납 id */
    const handleRemoveErrand = (id: string) => {
        setErrands((prev) => prev.filter((errand) => errand.id !== id))
    }

    return {
        entries,
        monthEntries,
        cards,
        fixedCosts,
        charges,
        fixedIncomes,
        monthIncomes,
        statements,
        errands,
        cardStatements,
        selectedYm,
        summary,
        expenseByCategory,
        recordedYms,
        syncStatus,
        syncedAt,
        syncError,
        handleRetrySync,
        handleSelectYm,
        handleShiftMonth,
        handleGoToday,
        handleAddEntry,
        handleUpdateEntry,
        handleRemoveEntry,
        handleAddCard,
        handleRemoveCard,
        handleAddFixedCost,
        handleUpdateFixedCost,
        handleChangeFixedCostAmount,
        handleEndFixedCost,
        handleResumeFixedCost,
        handleRemoveFixedCost,
        handleAddFixedIncome,
        handleUpdateFixedIncome,
        handleRemoveFixedIncome,
        handleChangeStatement,
        handleAddErrand,
        handleRemoveErrand,
    }
}

/**
 * 훅이 돌려주는 가계부 상태 묶음
 * — 가계부 화면과 분석 화면이 같은 데이터를 봐야 하므로 App 에서 한 번만 호출해 두 화면에 내려보낸다.
 *   (화면마다 훅을 따로 부르면 인스턴스가 갈라져 한쪽 수정이 다른 쪽에 안 보인다)
 */
export type LedgerState = ReturnType<typeof useLedger>