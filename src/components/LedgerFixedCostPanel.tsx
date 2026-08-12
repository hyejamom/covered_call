import { useState, type ChangeEvent, type FormEvent } from 'react'
import { LEDGER_CATEGORIES, formatYmTitle } from '../constants/ledgerConstants'
import {
    FIXED_COST_TYPE_LABEL,
    FixedCostType,
    LedgerKind,
    type FixedCost,
    type FixedCostCharge,
    type LedgerCard,
} from '../types/ledger'
import { formatKrw } from '../utils/format'

/** 카드 미지정 값 — select 의 빈 문자열과 짝을 맞춘다 */
const NO_CARD = ''

interface LedgerFixedCostPanelProps {
    /** 선택된 달 'YYYY-MM' */
    selectedYm: string
    /** 등록된 고정비 전체 */
    fixedCosts: FixedCost[]
    /** 그 달에 실제로 청구되는 건들 */
    charges: FixedCostCharge[]
    /** 등록된 카드 목록 */
    cards: LedgerCard[]
    /** 고정비 등록 — @param draft 폼 입력값 */
    onAddFixedCost: (draft: Omit<FixedCost, 'id'>) => void
    /** 고정비 수정 — @param id 대상 고정비, @param patch 폼 입력값 전체 */
    onUpdateFixedCost: (id: string, patch: Omit<FixedCost, 'id'>) => void
    /** 고정비 삭제 — @param id 대상 고정비 */
    onRemoveFixedCost: (id: string) => void
}

/**
 * 고정비 패널 — 두 형태를 한 곳에서 등록하고 이번 달 청구 상태를 확인한다.
 * ① 진짜 고정비: 교통비·보험처럼 끝나는 날 없이 매월 같은 금액
 * ② 할부: 시작 월부터 정해진 개월 수만큼. 카드와 개월 수를 함께 적고 진행 회차를 표기한다.
 */
function LedgerFixedCostPanel(props: LedgerFixedCostPanelProps) {

    // ┣━━━━━━━━━━━━━━━━ States ━━━━━━━━━━━━━━━━━━━━━┫
    const [type, setType] = useState<FixedCostType>(FixedCostType.RECURRING)   // 등록 폼 형태
    const [name, setName] = useState<string>('')                               // 등록 폼 항목명
    const [cardId, setCardId] = useState<string>(NO_CARD)                      // 등록 폼 결제 카드
    const [category, setCategory] = useState<string>(LEDGER_CATEGORIES[LedgerKind.EXPENSE][0])   // 등록 폼 분류
    const [startYm, setStartYm] = useState<string>(props.selectedYm)           // 등록 폼 시작 월
    const [months, setMonths] = useState<string>('3')                          // 등록 폼 할부 개월 수
    const [amount, setAmount] = useState<string>('')                           // 등록 폼 금액 — 고정비는 월 금액, 할부는 총액
    const [editingId, setEditingId] = useState<string | null>(null)            // 수정 중인 고정비 id. null이면 신규 등록 모드

    // ┣━━━━━━━━━━━━━━━━ Derived ━━━━━━━━━━━━━━━━━━━━┫
    // 1) 입력값 파싱 — 할부는 개월 수까지 유효해야 등록할 수 있다
    const isInstallment = type === FixedCostType.INSTALLMENT
    const parsedAmount = Number(amount)
    const parsedMonths = Number(months)
    const validAmount = amount !== '' && Number.isFinite(parsedAmount) && parsedAmount > 0
    const validMonths = !isInstallment || (Number.isFinite(parsedMonths) && parsedMonths >= 1)
    const submittable = name.trim().length > 0 && validAmount && validMonths

    // 2) 할부 월 납입금 미리보기 — 나눠떨어지지 않으면 마지막 회차가 나머지를 떠안는다
    const monthlyPreview = isInstallment && validAmount && validMonths
        ? Math.floor(parsedAmount / parsedMonths)
        : 0

    // 3) 그 달 청구분 조회용 색인 — 목록에서 "이번 달 청구 여부"를 바로 판정한다
    const chargeByCostId = new Map(props.charges.map((charge) => [charge.cost.id, charge]))

    // 4) 청구되는 건을 위로 올린 목록 — 끝난 할부/시작 전 항목은 아래로 내린다
    const sortedCosts = [...props.fixedCosts].sort((a, b) => {
        const aCharged = chargeByCostId.has(a.id) ? 0 : 1
        const bCharged = chargeByCostId.has(b.id) ? 0 : 1
        if (aCharged !== bCharged) return aCharged - bCharged
        return a.name.localeCompare(b.name)
    })

    // ┣━━━━━━━━━━━━━━━━ Handlers ━━━━━━━━━━━━━━━━━━━┫

    /** 카드 이름 조회 — @param id 카드 id (빈 값이면 '카드 없음') */
    const toCardName = (id: string): string => {
        if (id === NO_CARD) return '카드 없음'
        return props.cards.find((card) => card.id === id)?.name ?? '삭제된 카드'
    }

    /** 형태 변경 — @param event 셀렉트 변경 이벤트. 금액의 의미가 달라지므로 입력값을 비운다 */
    const handleTypeChange = (event: ChangeEvent<HTMLSelectElement>) => {
        setType(event.target.value as FixedCostType)
        setAmount('')
    }

    /** 수정 시작 — @param cost 수정할 고정비. 등록 폼에 값을 그대로 올려 같은 자리에서 고치게 한다 */
    const handleStartEdit = (cost: FixedCost) => {
        setEditingId(cost.id)
        setType(cost.type)
        setName(cost.name)
        setCardId(cost.cardId)
        setCategory(cost.category)
        setStartYm(cost.startYm)
        setMonths(cost.months > 0 ? String(cost.months) : '3')
        setAmount(String(cost.amount))
    }

    /** 수정 취소 — 폼을 신규 등록 상태로 되돌린다 */
    const handleCancelEdit = () => {
        setEditingId(null)
        setName('')
        setAmount('')
    }

    /** 고정비 삭제 — @param id 대상 고정비. 수정 중이던 건을 지우면 폼도 함께 초기화한다 */
    const handleRemove = (id: string) => {
        if (id === editingId) handleCancelEdit()
        props.onRemoveFixedCost(id)
    }

    /**
     * 등록 / 수정 저장 — @param event 폼 제출 이벤트
     * 신규는 항목명·금액만 비워 연속 입력을 잇고, 수정은 저장 후 신규 등록 모드로 빠져나온다.
     */
    const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        if (!submittable) return

        const draft = {
            type,
            name: name.trim(),
            cardId,
            category,
            startYm,
            months: isInstallment ? Math.round(parsedMonths) : 0,
            amount: Math.round(parsedAmount),
        }

        if (editingId === null) {
            props.onAddFixedCost(draft)
            setName('')
            setAmount('')
            return
        }

        props.onUpdateFixedCost(editingId, draft)
        handleCancelEdit()
    }

    return (
        <section className={'ledger_fixed_panel'}>
            {/* 1) 패널 헤더 */}
            <div className={'ledger_section_head'}>
                <h3 className={'ledger_section_title'}>고정비 · 할부</h3>
                <span className={'ledger_section_note'}>
                    {formatYmTitle(props.selectedYm)} 청구 {props.charges.length}건
                </span>
            </div>

            {/* 2) 등록/수정 폼 — 형태에 따라 개월 수 칸이 나타나고 금액의 의미가 바뀐다 */}
            <form
                className={editingId === null ? 'ledger_form' : 'ledger_form ledger_form_editing'}
                onSubmit={handleSubmit}
            >
                <select
                    className={'ledger_field'}
                    value={type}
                    onChange={handleTypeChange}
                    title={'고정비 형태'}
                >
                    {Object.values(FixedCostType).map((value) => (
                        <option key={value} value={value}>{FIXED_COST_TYPE_LABEL[value]}</option>
                    ))}
                </select>
                <input
                    type={'text'}
                    className={'ledger_field ledger_field_memo'}
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder={isInstallment ? '항목명 (예: 노트북 할부)' : '항목명 (예: 교통비)'}
                    maxLength={30}
                />
                <select
                    className={'ledger_field'}
                    value={cardId}
                    onChange={(event) => setCardId(event.target.value)}
                    title={'결제 카드'}
                >
                    <option value={NO_CARD}>카드 없음</option>
                    {props.cards.map((card) => (
                        <option key={card.id} value={card.id}>{card.name}</option>
                    ))}
                </select>
                <select
                    className={'ledger_field'}
                    value={category}
                    onChange={(event) => setCategory(event.target.value)}
                    title={'분류'}
                >
                    {LEDGER_CATEGORIES[LedgerKind.EXPENSE].map((value) => (
                        <option key={value} value={value}>{value}</option>
                    ))}
                </select>
                <input
                    type={'month'}
                    className={'ledger_field'}
                    value={startYm}
                    onChange={(event) => setStartYm(event.target.value)}
                    title={isInstallment ? '할부 1회차 달' : '고정비 시작 달'}
                />
                {isInstallment && (
                    <input
                        type={'number'}
                        className={'ledger_field ledger_field_months'}
                        value={months}
                        onChange={(event) => setMonths(event.target.value)}
                        placeholder={'개월'}
                        min={1}
                        step={1}
                        title={'할부 개월 수'}
                    />
                )}
                <input
                    type={'number'}
                    className={'ledger_field ledger_field_amount'}
                    value={amount}
                    onChange={(event) => setAmount(event.target.value)}
                    placeholder={isInstallment ? '할부 총액' : '월 금액'}
                    min={0}
                    step={1}
                />
                <button
                    type={'submit'}
                    className={'ledger_submit'}
                    disabled={!submittable}
                    title={submittable
                        ? (editingId === null ? '고정비를 등록합니다' : '수정 내용을 저장합니다')
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

                {/* 2-2) 할부 월 납입금 미리보기 — 총액을 개월 수로 나눈 값 */}
                {isInstallment && monthlyPreview > 0 && (
                    <span className={'ledger_form_hint'}>
                        월 {formatKrw(monthlyPreview)}원 × {Math.round(parsedMonths)}개월
                        (나머지는 마지막 회차에 합산)
                    </span>
                )}
            </form>

            {/* 3) 등록된 고정비 목록 — 이번 달 청구되는 건이 위로 온다 */}
            {sortedCosts.length === 0 ? (
                <p className={'ledger_empty'}>등록된 고정비가 없습니다.</p>
            ) : (
                <div className={'ledger_fixed_list'}>
                    {sortedCosts.map((cost) => {
                        // 3-1) 이번 달 청구 여부 — 없으면 끝난 할부이거나 아직 시작 전
                        const charge = chargeByCostId.get(cost.id)
                        const inactive = charge === undefined

                        // 3-2) 청구가 없는 달에는 정의상 월 금액을 흐리게 보여준다 (0원으로 보이면 등록이 안 된 줄 안다)
                        const displayAmount = charge?.amount ?? (
                            cost.type === FixedCostType.INSTALLMENT && cost.months > 0
                                ? Math.floor(cost.amount / cost.months)
                                : cost.amount
                        )

                        // 3-4) 행 상태 클래스 — 수정 중인 행은 강조하고, 청구 없는 행은 흐리게
                        const rowClass = [
                            'ledger_fixed_row',
                            inactive ? ' ledger_fixed_row_inactive' : '',
                            cost.id === editingId ? ' ledger_fixed_row_editing' : '',
                        ].join('')

                        return (
                            <div key={cost.id} className={rowClass}>
                                <span
                                    className={cost.type === FixedCostType.INSTALLMENT
                                        ? 'ledger_fixed_type ledger_fixed_type_installment'
                                        : 'ledger_fixed_type ledger_fixed_type_recurring'}
                                >
                                    {FIXED_COST_TYPE_LABEL[cost.type]}
                                </span>
                                <span className={'ledger_fixed_name'}>{cost.name}</span>
                                <span className={'ledger_fixed_meta'}>{toCardName(cost.cardId)} · {cost.category}</span>

                                {/* 3-3) 할부 진행 회차 — 시작 월 기준으로 몇 번째 달인지 */}
                                <span className={'ledger_fixed_round'}>
                                    {cost.type === FixedCostType.INSTALLMENT
                                        ? (charge !== undefined
                                            ? `${charge.round}/${cost.months}회차`
                                            : `종료 (${cost.months}개월)`)
                                        : (inactive ? `${cost.startYm}~` : '매월')}
                                </span>

                                <span className={'ledger_fixed_amount'}>
                                    {formatKrw(displayAmount)}원
                                </span>
                                <button
                                    type={'button'}
                                    className={'ledger_fixed_edit'}
                                    onClick={() => handleStartEdit(cost)}
                                    title={'이 고정비 수정 — 위 폼에 값이 올라옵니다'}
                                >
                                    ✎
                                </button>
                                <button
                                    type={'button'}
                                    className={'ledger_row_remove'}
                                    onClick={() => handleRemove(cost.id)}
                                    title={'이 고정비 삭제'}
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

export default LedgerFixedCostPanel