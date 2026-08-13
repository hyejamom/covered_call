import { useState, type FormEvent } from 'react'
import { LEDGER_CATEGORIES, formatYmTitle, monthDiff } from '../constants/ledgerConstants'
import { LedgerKind, type FixedIncome } from '../types/ledger'
import { formatKrw } from '../utils/format'

interface LedgerFixedIncomePanelProps {
    /** 선택된 달 'YYYY-MM' */
    selectedYm: string
    /** 등록된 고정 수입 전체 */
    fixedIncomes: FixedIncome[]
    /** 그 달에 실제로 들어오는 건들 */
    monthIncomes: FixedIncome[]
    /** 고정 수입 등록 — @param draft 폼 입력값 */
    onAddFixedIncome: (draft: Omit<FixedIncome, 'id'>) => void
    /** 고정 수입 수정 — @param id 대상 고정 수입, @param patch 폼 입력값 전체 */
    onUpdateFixedIncome: (id: string, patch: Omit<FixedIncome, 'id'>) => void
    /** 고정 수입 삭제 — @param id 대상 고정 수입 */
    onRemoveFixedIncome: (id: string) => void
}

/**
 * 고정 수입 패널 — 급여·월세수입처럼 매달 같은 금액이 들어오는 건을 한 번 등록해 두고 쓴다.
 * 고정비 패널의 수입 쪽 대칭이라, 시작 월 이후의 달을 펼치면 매번 적지 않아도 자동으로 수입에 잡힌다.
 */
function LedgerFixedIncomePanel(props: LedgerFixedIncomePanelProps) {

    // ┣━━━━━━━━━━━━━━━━ States ━━━━━━━━━━━━━━━━━━━━━┫
    const [name, setName] = useState<string>('')                                             // 등록 폼 항목명
    const [category, setCategory] = useState<string>(LEDGER_CATEGORIES[LedgerKind.INCOME][0]) // 등록 폼 분류
    const [startYm, setStartYm] = useState<string>(props.selectedYm)                         // 등록 폼 시작 월
    const [amount, setAmount] = useState<string>('')                                         // 등록 폼 월 금액
    const [editingId, setEditingId] = useState<string | null>(null)                          // 수정 중인 고정 수입 id. null이면 신규 등록 모드

    // ┣━━━━━━━━━━━━━━━━ Derived ━━━━━━━━━━━━━━━━━━━━┫
    // 1) 등록 가능 여부 — 항목명과 0보다 큰 금액이 모두 있어야 한다
    const parsedAmount = Number(amount)
    const validAmount = amount !== '' && Number.isFinite(parsedAmount) && parsedAmount > 0
    const submittable = name.trim().length > 0 && validAmount

    // 2) 그 달에 들어오는 건 조회용 색인 — 목록에서 "이번 달 수입 여부"를 바로 판정한다
    const activeIds = new Set(props.monthIncomes.map((income) => income.id))

    // 3) 이번 달 합계 — 헤더에 붙여 등록해 둔 금액을 바로 확인하게 한다
    const monthTotal = props.monthIncomes.reduce((sum, income) => sum + income.amount, 0)

    // 4) 이번 달에 들어오는 건을 위로 올린 목록 — 아직 시작 전인 건은 아래로 내린다
    const sortedIncomes = [...props.fixedIncomes].sort((a, b) => {
        const aActive = activeIds.has(a.id) ? 0 : 1
        const bActive = activeIds.has(b.id) ? 0 : 1
        if (aActive !== bActive) return aActive - bActive
        return b.amount - a.amount
    })

    // ┣━━━━━━━━━━━━━━━━ Handlers ━━━━━━━━━━━━━━━━━━━┫

    /** 수정 시작 — @param income 수정할 고정 수입. 등록 폼에 값을 그대로 올려 같은 자리에서 고치게 한다 */
    const handleStartEdit = (income: FixedIncome) => {
        setEditingId(income.id)
        setName(income.name)
        setCategory(income.category)
        setStartYm(income.startYm)
        setAmount(String(income.amount))
    }

    /** 수정 취소 — 폼을 신규 등록 상태로 되돌린다 */
    const handleCancelEdit = () => {
        setEditingId(null)
        setName('')
        setAmount('')
    }

    /** 고정 수입 삭제 — @param id 대상 고정 수입. 수정 중이던 건을 지우면 폼도 함께 초기화한다 */
    const handleRemove = (id: string) => {
        if (id === editingId) handleCancelEdit()
        props.onRemoveFixedIncome(id)
    }

    /**
     * 등록 / 수정 저장 — @param event 폼 제출 이벤트
     * 신규는 항목명·금액만 비워 연속 입력을 잇고(분류·시작 월은 유지), 수정은 저장 후 신규 등록 모드로 빠져나온다.
     */
    const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        if (!submittable) return

        const draft = {
            name: name.trim(),
            category,
            startYm,
            // 소수점이 섞여 들어와도 원 단위로 맞춘다
            amount: Math.round(parsedAmount),
        }

        if (editingId === null) {
            props.onAddFixedIncome(draft)
            setName('')
            setAmount('')
            return
        }

        props.onUpdateFixedIncome(editingId, draft)
        handleCancelEdit()
    }

    return (
        <section className={'ledger_fixed_income_panel'}>
            {/* 1) 패널 헤더 — 이번 달에 들어오는 건수와 합계 */}
            <div className={'ledger_section_head'}>
                <h3 className={'ledger_section_title'}>고정 수입</h3>
                <span className={'ledger_section_note'}>
                    {formatYmTitle(props.selectedYm)} {props.monthIncomes.length}건 · {formatKrw(monthTotal)}원
                </span>
            </div>

            {/* 2) 등록/수정 폼 — 항목명 / 분류 / 시작 월 / 월 금액 */}
            <form
                className={editingId === null ? 'ledger_form' : 'ledger_form ledger_form_editing'}
                onSubmit={handleSubmit}
            >
                <input
                    type={'text'}
                    className={'ledger_field ledger_field_memo'}
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder={'항목명 (예: 급여)'}
                    maxLength={30}
                />
                <select
                    className={'ledger_field'}
                    value={category}
                    onChange={(event) => setCategory(event.target.value)}
                    title={'분류'}
                >
                    {LEDGER_CATEGORIES[LedgerKind.INCOME].map((value) => (
                        <option key={value} value={value}>{value}</option>
                    ))}
                </select>
                <input
                    type={'month'}
                    className={'ledger_field'}
                    value={startYm}
                    onChange={(event) => setStartYm(event.target.value)}
                    title={'이 달부터 매월 수입에 잡힙니다'}
                />
                <input
                    type={'number'}
                    className={'ledger_field ledger_field_amount'}
                    value={amount}
                    onChange={(event) => setAmount(event.target.value)}
                    placeholder={'월 금액'}
                    min={0}
                    step={1}
                />
                <button
                    type={'submit'}
                    className={'ledger_submit'}
                    disabled={!submittable}
                    title={submittable
                        ? (editingId === null ? '고정 수입을 등록합니다' : '수정 내용을 저장합니다')
                        : '항목명과 금액을 입력하세요'}
                >
                    {editingId === null ? '등록' : '수정 저장'}
                </button>

                {/* 2-1) 수정 중에만 노출 — 폼을 신규 등록 상태로 되돌린다 */}
                {editingId !== null && (
                    <button
                        type={'button'}
                        className={'ledger_cancel'}
                        onClick={handleCancelEdit}
                        title={'수정을 취소합니다'}
                    >
                        취소
                    </button>
                )}
            </form>

            {/* 3) 등록된 고정 수입 목록 — 이번 달에 들어오는 건이 위로 온다 */}
            {sortedIncomes.length === 0 ? (
                <p className={'ledger_empty'}>
                    등록된 고정 수입이 없습니다. 급여처럼 매달 들어오는 돈을 한 번만 넣어 두세요.
                </p>
            ) : (
                <div className={'ledger_fixed_list'}>
                    {sortedIncomes.map((income) => {
                        // 3-1) 이번 달 수입 여부 — 아직 시작 월이 오지 않았으면 흐리게 내린다
                        const inactive = !activeIds.has(income.id)

                        // 3-2) 시작 이후 몇 번째 달인지 — 시작 월이 1개월째 (수입은 끝이 없으므로 경과만 표기)
                        const round = monthDiff(income.startYm, props.selectedYm) + 1

                        // 3-3) 행 상태 클래스 — 수정 중인 행은 강조하고, 아직 시작 전인 행은 흐리게
                        const rowClass = [
                            'ledger_income_row',
                            inactive ? ' ledger_fixed_row_inactive' : '',
                            income.id === editingId ? ' ledger_fixed_row_editing' : '',
                        ].join('')

                        return (
                            <div key={income.id} className={rowClass}>
                                <span className={'ledger_fixed_type ledger_fixed_type_income'}>수입</span>
                                <span className={'ledger_fixed_name'}>{income.name}</span>
                                <span className={'ledger_fixed_meta'}>{income.category}</span>
                                <span className={'ledger_fixed_round'}>
                                    {inactive ? `${income.startYm}~` : `${round}개월째`}
                                </span>
                                <span className={'ledger_income_amount'}>
                                    +{formatKrw(income.amount)}원
                                </span>
                                <button
                                    type={'button'}
                                    className={'ledger_fixed_edit'}
                                    onClick={() => handleStartEdit(income)}
                                    title={'이 고정 수입 수정 — 위 폼에 값이 올라옵니다'}
                                >
                                    ✎
                                </button>
                                <button
                                    type={'button'}
                                    className={'ledger_row_remove'}
                                    onClick={() => handleRemove(income.id)}
                                    title={'이 고정 수입 삭제'}
                                >
                                    ×
                                </button>
                            </div>
                        )
                    })}
                </div>
            )}
        </section>
    )
}

export default LedgerFixedIncomePanel
