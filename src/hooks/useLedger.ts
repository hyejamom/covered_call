import { useEffect, useRef, useState } from 'react'
import { shiftYm, todayYm, toYmOfDate } from '../constants/ledgerConstants'
import { toCardStatements, toChargesOfMonth } from '../services/ledgerEngine'
import { loadLedger, saveLedger } from '../services/ledgerStorageService'
import {
    FixedCostType,
    LedgerKind,
    type CardMonthlyStatement,
    type CardStatement,
    type FixedCost,
    type FixedCostCharge,
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

// ┣━━━━━━━━━━━━━━━━ Hook ━━━━━━━━━━━━━━━━━━━━━━━┫

/**
 * 가계부 상태 훅
 * — 입출금 항목 · 카드 · 고정비 · 카드 명세서 총액을 한 스냅샷으로 들고 있고, 선택된 달로 걸러 화면에 넘긴다.
 * — 저장 버튼 없이 변경 즉시 localStorage 에 기록한다. (적립 계산기 스냅샷과는 별개의 저장소)
 */
export function useLedger() {

    // ┣━━━━━━━━━━━━━━━━ States ━━━━━━━━━━━━━━━━━━━━━┫
    const [snapshot] = useState(() => loadLedger())                                   // 최초 1회 복원한 저장본
    const [entries, setEntries] = useState<LedgerEntry[]>(snapshot.entries)           // 직접 입력한 입출금 항목
    const [cards, setCards] = useState<LedgerCard[]>(snapshot.cards)                  // 등록된 결제 카드
    const [fixedCosts, setFixedCosts] = useState<FixedCost[]>(snapshot.fixedCosts)    // 고정비 · 할부 정의
    const [statements, setStatements] = useState<CardStatement[]>(snapshot.statements) // 카드별 월 청구 총액 (직접 입력)
    const [selectedYm, setSelectedYm] = useState<string>(todayYm())                   // 화면에 펼쳐 볼 달 'YYYY-MM'

    // ┣━━━━━━━━━━━━━━━━ Refs ━━━━━━━━━━━━━━━━━━━━━━━┫
    // 첫 렌더에서 곧바로 저장이 돌면, 로컬에 있던 내용을 초기값으로 되쓰는 무의미한 기록이 남는다
    const hydratedRef = useRef<boolean>(false)

    // ┣━━━━━━━━━━━━━━━━ Effects ━━━━━━━━━━━━━━━━━━━━┫

    // 1) 자동 저장 — 넷 중 무엇이 바뀌든 스냅샷을 통째로 덮어쓴다
    useEffect(() => {
        if (!hydratedRef.current) {
            hydratedRef.current = true
            return
        }

        try {
            saveLedger({ entries, cards, fixedCosts, statements })
        } catch {
            // 용량 초과 · 사생활 보호 모드 — 화면 동작은 그대로 두고 저장만 건너뛴다
        }
    }, [entries, cards, fixedCosts, statements])

    // ┣━━━━━━━━━━━━━━━━ Derived ━━━━━━━━━━━━━━━━━━━━┫
    // 1) 선택된 달의 입출금 항목만 추려 정렬 (React Compiler 가 자동 메모이제이션하므로 useMemo 를 쓰지 않는다)
    const monthEntries: LedgerEntry[] = entries
        .filter((entry) => toYmOfDate(entry.date) === selectedYm)
        .sort(compareEntries)

    // 2) 그 달에 청구되는 고정비 — 할부는 회차 범위 안에 든 것만 살아남는다
    const charges: FixedCostCharge[] = toChargesOfMonth(fixedCosts, selectedYm)
    const fixedTotal: number = charges.reduce((sum, charge) => sum + charge.amount, 0)

    // 3) 카드별 정산 — 명세서 총액에서 할부를 걷어낸 실제 사용액
    const cardStatements: CardMonthlyStatement[] = toCardStatements(cards, charges, statements, selectedYm)

    // 4) 월 요약 — 직접 입력분과 고정비를 나눠 잡는다.
    //    카드 명세서 총액은 대조용 참고 수치라 합계에 넣지 않는다 (넣으면 할부·고정비와 이중 계산된다)
    const summary: LedgerMonthSummary = monthEntries.reduce<LedgerMonthSummary>((acc, entry) => {
        if (entry.kind === LedgerKind.INCOME) acc.income += entry.amount
        else acc.expense += entry.amount
        return acc
    }, { income: 0, expense: 0, fixed: fixedTotal, net: 0 })
    summary.net = summary.income - summary.expense - summary.fixed

    // 5) 분류별 지출 집계 — 직접 입력한 지출 + 그 달 고정비를 함께 담는다
    const expenseTotal = summary.expense + summary.fixed
    const expenseByCategory: LedgerCategorySummary[] = Object.entries(
        [
            ...monthEntries
                .filter((entry) => entry.kind === LedgerKind.EXPENSE)
                .map((entry) => ({ category: entry.category, amount: entry.amount })),
            ...charges.map((charge) => ({ category: charge.cost.category, amount: charge.amount })),
        ].reduce<Record<string, number>>((acc, item) => {
            acc[item.category] = (acc[item.category] ?? 0) + item.amount
            return acc
        }, {}),
    )
        .map(([category, amount]) => ({
            category,
            amount,
            ratio: expenseTotal > 0 ? amount / expenseTotal : 0,
        }))
        .sort((a, b) => b.amount - a.amount)

    // 6) 기록이 있는 달 목록 — 월 이동 시 "여기에 기록이 있다"를 표시하는 데 쓴다
    const recordedYms: string[] = [...new Set(entries.map((entry) => toYmOfDate(entry.date)))].sort()

    // ┣━━━━━━━━━━━━━━━━ Handlers ━━━━━━━━━━━━━━━━━━━┫

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
     */
    const handleRemoveCard = (cardId: string) => {
        setCards((prev) => prev.filter((card) => card.id !== cardId))
        setFixedCosts((prev) => prev.map((cost) => (cost.cardId === cardId ? { ...cost, cardId: '' } : cost)))
        setStatements((prev) => prev.filter((statement) => statement.cardId !== cardId))
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

    /** 고정비/할부 삭제 — @param id 삭제할 고정비 id */
    const handleRemoveFixedCost = (id: string) => {
        setFixedCosts((prev) => prev.filter((cost) => cost.id !== id))
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

    return {
        entries,
        monthEntries,
        cards,
        fixedCosts,
        charges,
        cardStatements,
        selectedYm,
        summary,
        expenseByCategory,
        recordedYms,
        handleSelectYm,
        handleShiftMonth,
        handleGoToday,
        handleAddEntry,
        handleRemoveEntry,
        handleAddCard,
        handleRemoveCard,
        handleAddFixedCost,
        handleUpdateFixedCost,
        handleRemoveFixedCost,
        handleChangeStatement,
    }
}