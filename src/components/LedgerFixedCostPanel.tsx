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
import { isFixedCostEnded } from '../services/ledgerEngine'
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
    /** 선택된 달부터 금액 변경 — @param id 대상 고정비, @param amount 새 월 금액 */
    onChangeFixedCostAmount: (id: string, amount: number) => void
    /** 선택된 달부터 해지 — @param id 대상 고정비 */
    onEndFixedCost: (id: string) => void
    /** 해지 취소(무기한으로 되돌리기) — @param id 대상 고정비 */
    onResumeFixedCost: (id: string) => void
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
    const [endYm, setEndYm] = useState<string>('')                             // 수정 중인 항목의 종료월 — 폼에 칸은 없고 저장 시 그대로 되돌려준다
    const [editingId, setEditingId] = useState<string | null>(null)            // 수정 중인 고정비 id. null이면 신규 등록 모드
    const [changingId, setChangingId] = useState<string | null>(null)          // 금액 변경 중인 고정비 id — 선택된 달부터 새 금액을 적용한다
    const [showEnded, setShowEnded] = useState<boolean>(false)                 // 청구가 끝난 건을 펼쳐 볼지 — 기본은 접어 둔다

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

    // 3-1) 금액 변경 중인 항목 — 폼 문구와 저장 동작이 통째로 바뀐다
    const changingCost = changingId === null
        ? null
        : props.fixedCosts.find((cost) => cost.id === changingId) ?? null

    // 4) 청구가 끝난 건 — 해지한 고정비와 다 갚은 할부는 매달 쌓이기만 하므로 목록에서 내린다.
    //    다만 지금 폼에 올라가 있는 건은 수정 중에 사라지지 않게 남긴다.
    const endedCosts = props.fixedCosts.filter((cost) => isFixedCostEnded(cost, props.selectedYm))
    const listedCosts = showEnded
        ? props.fixedCosts
        : props.fixedCosts.filter((cost) => (
            !isFixedCostEnded(cost, props.selectedYm) || cost.id === editingId || cost.id === changingId
        ))

    // 5) 카드 정렬 순번 — 카드 없음이 맨 위, 그 뒤로 등록된 카드 순서. 삭제된 카드는 맨 아래로 밀린다
    const cardOrder = new Map<string, number>([[NO_CARD, 0]])
    props.cards.forEach((card, index) => cardOrder.set(card.id, index + 1))
    const toCardOrder = (id: string): number => cardOrder.get(id) ?? props.cards.length + 1

    // 6) 목록 정렬 — 1) 카드 묶음 2) 이번 달 청구되는 건 3) 항목명
    const sortedCosts = [...listedCosts].sort((a, b) => {
        const aCard = toCardOrder(a.cardId)
        const bCard = toCardOrder(b.cardId)
        if (aCard !== bCard) return aCard - bCard

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

    /** 폼에 항목 올리기 — @param cost 대상 고정비. 수정·금액 변경이 같은 폼을 쓰므로 채우는 값도 같다 */
    const handleFillForm = (cost: FixedCost) => {
        setType(cost.type)
        setName(cost.name)
        setCardId(cost.cardId)
        setCategory(cost.category)
        setStartYm(cost.startYm)
        setEndYm(cost.endYm)
        setMonths(cost.months > 0 ? String(cost.months) : '3')
        setAmount(String(cost.amount))
    }

    /** 수정 시작 — @param cost 수정할 고정비. 등록 폼에 값을 그대로 올려 같은 자리에서 고치게 한다 */
    const handleStartEdit = (cost: FixedCost) => {
        setChangingId(null)
        setEditingId(cost.id)
        handleFillForm(cost)
    }

    /**
     * 금액 변경 시작 — @param cost 대상 고정비
     * 수정과 달리 과거를 건드리지 않는다. 저장하면 전월까지로 끊고 이 달부터 새 금액으로 다시 시작한다.
     */
    const handleStartChange = (cost: FixedCost) => {
        setEditingId(null)
        setChangingId(cost.id)
        handleFillForm(cost)
        // 새로 적을 금액이라 비워 둔다 — 기존 금액이 남아 있으면 그대로 저장해 버리기 쉽다
        setAmount('')
    }

    /** 수정·변경 취소 — 폼을 신규 등록 상태로 되돌린다 */
    const handleCancelEdit = () => {
        setEditingId(null)
        setChangingId(null)
        setName('')
        setAmount('')
        setEndYm('')
    }

    /** 고정비 삭제 — @param id 대상 고정비. 폼에 올라가 있던 건을 지우면 폼도 함께 초기화한다 */
    const handleRemove = (id: string) => {
        if (id === editingId || id === changingId) handleCancelEdit()
        props.onRemoveFixedCost(id)
    }

    /**
     * 해지 — @param cost 대상 고정비
     * 선택된 달부터 안 빠지게 전월까지로 끊는다. 삭제와 다르다는 것을 확인 문구로 못 박는다.
     */
    const handleEnd = (cost: FixedCost) => {
        const confirmed = window.confirm(
            `'${cost.name}'를 ${formatYmTitle(props.selectedYm)}부터 해지합니다.`
            + '\n이전 달들은 그대로 남습니다. (기록을 지우려면 × 를 쓰세요)',
        )
        if (!confirmed) return

        if (cost.id === editingId || cost.id === changingId) handleCancelEdit()
        props.onEndFixedCost(cost.id)
    }

    /**
     * 등록 / 수정 저장 / 금액 변경 — @param event 폼 제출 이벤트
     * 신규는 항목명·금액만 비워 연속 입력을 잇고, 수정·변경은 저장 후 신규 등록 모드로 빠져나온다.
     */
    const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        if (!submittable) return

        // 1) 금액 변경 — 나머지 값은 훅이 기존 항목에서 물려받으므로 새 금액만 넘긴다
        if (changingId !== null) {
            props.onChangeFixedCostAmount(changingId, Math.round(parsedAmount))
            handleCancelEdit()
            return
        }

        const draft = {
            type,
            name: name.trim(),
            cardId,
            category,
            startYm,
            // 2) 종료월은 폼에 칸이 없다 — 수정 중이면 원래 값을 그대로 돌려주고, 신규는 무기한으로 시작한다
            endYm: editingId === null ? '' : endYm,
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

            {/* 2) 등록/수정/변경 폼 — 형태에 따라 개월 수 칸이 나타나고 금액의 의미가 바뀐다.
                    금액 변경 중에는 금액 칸만 열어 두고 나머지는 잠근다 (그 값들은 기존 항목에서 그대로 물려받는다) */}
            <form
                className={editingId === null && changingId === null
                    ? 'ledger_form'
                    : 'ledger_form ledger_form_editing'}
                onSubmit={handleSubmit}
            >
                <select
                    className={'ledger_field'}
                    value={type}
                    onChange={handleTypeChange}
                    disabled={changingId !== null}
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
                    disabled={changingId !== null}
                />
                <select
                    className={'ledger_field'}
                    value={cardId}
                    onChange={(event) => setCardId(event.target.value)}
                    disabled={changingId !== null}
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
                    disabled={changingId !== null}
                    title={'분류'}
                >
                    {LEDGER_CATEGORIES[LedgerKind.EXPENSE].map((value) => (
                        <option key={value} value={value}>{value}</option>
                    ))}
                </select>
                <input
                    type={'month'}
                    className={'ledger_field'}
                    value={changingId === null ? startYm : props.selectedYm}
                    onChange={(event) => setStartYm(event.target.value)}
                    disabled={changingId !== null}
                    title={changingId !== null
                        ? '이 달부터 새 금액이 적용됩니다'
                        : (isInstallment ? '할부 1회차 달' : '고정비 시작 달')}
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
                    placeholder={changingId !== null
                        ? '바뀐 월 금액'
                        : (isInstallment ? '할부 총액' : '월 금액')}
                    min={0}
                    step={1}
                    autoFocus={changingId !== null}
                />
                <button
                    type={'submit'}
                    className={'ledger_submit'}
                    disabled={!submittable}
                    title={submittable
                        ? (changingId !== null
                            ? `${formatYmTitle(props.selectedYm)}부터 새 금액으로 바꿉니다`
                            : (editingId === null ? '고정비를 등록합니다' : '수정 내용을 저장합니다'))
                        : '항목명과 금액을 입력하세요'}
                >
                    {changingId !== null ? '변경 적용' : (editingId === null ? '등록' : '수정 저장')}
                </button>

                {/* 2-1) 수정·변경 중에만 노출 — 폼을 신규 등록 상태로 되돌린다 */}
                {(editingId !== null || changingId !== null) && (
                    <button
                        type={'button'}
                        className={'ledger_cancel'}
                        onClick={handleCancelEdit}
                        title={'되돌립니다'}
                    >
                        취소
                    </button>
                )}

                {/* 2-2) 금액 변경 안내 — 과거가 그대로 남는다는 점을 저장 전에 못 박는다 */}
                {changingCost !== null && (
                    <span className={'ledger_form_hint'}>
                        &lsquo;{changingCost.name}&rsquo; — {formatYmTitle(props.selectedYm)}부터 새 금액으로 바뀝니다.
                        {props.selectedYm > changingCost.startYm
                            ? ` 이전 달은 ${formatKrw(changingCost.amount)}원으로 그대로 남습니다.`
                            : ' (시작 월이라 가를 과거가 없어 금액만 고쳐집니다)'}
                    </span>
                )}

                {/* 2-3) 할부 월 납입금 미리보기 — 총액을 개월 수로 나눈 값 */}
                {changingId === null && isInstallment && monthlyPreview > 0 && (
                    <span className={'ledger_form_hint'}>
                        월 {formatKrw(monthlyPreview)}원 × {Math.round(parsedMonths)}개월
                        (나머지는 마지막 회차에 합산)
                    </span>
                )}
            </form>

            {/* 3) 등록된 고정비 목록 — 카드 없음 → 등록된 카드 순으로 묶고, 묶음 안에서 이번 달 청구되는 건이 위로 온다 */}
            {sortedCosts.length === 0 ? (
                <p className={'ledger_empty'}>
                    {endedCosts.length > 0
                        ? '이 달에 청구되는 고정비가 없습니다.'
                        : '등록된 고정비가 없습니다.'}
                </p>
            ) : (
                <div className={'ledger_fixed_list'}>
                    {sortedCosts.map((cost, index) => {
                        // 3-1) 이번 달 청구 여부 — 없으면 끝난 할부이거나 아직 시작 전
                        const charge = chargeByCostId.get(cost.id)
                        const inactive = charge === undefined

                        // 3-1-1) 카드 묶음의 첫 행 — 앞 행과 카드가 달라지는 지점에 구분선을 준다
                        const cardName = toCardName(cost.cardId)
                        const groupStart = index === 0 || sortedCosts[index - 1].cardId !== cost.cardId

                        // 3-2) 청구가 없는 달에는 정의상 월 금액을 흐리게 보여준다 (0원으로 보이면 등록이 안 된 줄 안다)
                        const displayAmount = charge?.amount ?? (
                            cost.type === FixedCostType.INSTALLMENT && cost.months > 0
                                ? Math.floor(cost.amount / cost.months)
                                : cost.amount
                        )

                        // 3-4) 행 상태 클래스 — 폼에 올라간 행은 강조하고, 청구 없는 행은 흐리게
                        const rowClass = [
                            'ledger_fixed_row',
                            inactive ? ' ledger_fixed_row_inactive' : '',
                            groupStart ? ' ledger_fixed_row_card_start' : '',
                            cost.id === editingId || cost.id === changingId ? ' ledger_fixed_row_editing' : '',
                        ].join('')

                        // 3-5) 진짜 고정비만 기간 개념이 있다 — 할부는 개월 수가 끝을 정한다
                        const isRecurring = cost.type === FixedCostType.RECURRING
                        // 종료월이 빈 값이면 무기한 — 옛 저장본에는 필드 자체가 없어 Boolean 으로 받는다
                        const ended = isRecurring && Boolean(cost.endYm)

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

                                {/* 3-2-1) 결제 수단 — 어느 카드에서 빠지는지 행마다 못 박는다 (미지정이면 '카드 없음') */}
                                <span className={'ledger_fixed_meta'} title={`${cardName} · ${cost.category}`}>
                                    <span
                                        className={cost.cardId === NO_CARD
                                            ? 'ledger_fixed_card ledger_fixed_card_none'
                                            : 'ledger_fixed_card'}
                                    >
                                        {cardName}
                                    </span>
                                    {' · '}
                                    {cost.category}
                                </span>

                                {/* 3-3) 청구 기간 — 할부는 진행 회차, 고정비는 시작·종료 월 */}
                                <span
                                    className={'ledger_fixed_round'}
                                    title={ended
                                        ? `${cost.startYm} ~ ${cost.endYm} 청구 후 종료`
                                        : `${cost.startYm} 부터 매월 청구`}
                                >
                                    {cost.type === FixedCostType.INSTALLMENT
                                        ? (charge !== undefined
                                            ? `${charge.round}/${cost.months}회차`
                                            : `종료 (${cost.months}개월)`)
                                        : ended
                                            ? `~${cost.endYm}`
                                            : (inactive ? `${cost.startYm}~` : '매월')}
                                </span>

                                <span className={'ledger_fixed_amount'}>
                                    {formatKrw(displayAmount)}원
                                </span>

                                {/* 3-6) 행 동작 — 수정(소급) / 이 달부터 변경 / 해지 / 삭제 */}
                                <span className={'ledger_fixed_actions'}>
                                    <button
                                        type={'button'}
                                        className={'ledger_fixed_edit'}
                                        onClick={() => handleStartEdit(cost)}
                                        title={'수정 — 잘못 적은 값을 과거까지 통째로 바로잡습니다'}
                                    >
                                        ✎
                                    </button>

                                    {/* 금액이 바뀐 시점부터만 반영하는 동작 — 진짜 고정비에만 있다 */}
                                    {isRecurring ? (
                                        <button
                                            type={'button'}
                                            className={'ledger_fixed_action'}
                                            onClick={() => handleStartChange(cost)}
                                            title={`${formatYmTitle(props.selectedYm)}부터 금액 변경 — 이전 달은 그대로 남습니다`}
                                        >
                                            변경
                                        </button>
                                    ): (<div style={{width: '40px'}}/>)}

                                    {isRecurring ? (ended ? (
                                        <button
                                            type={'button'}
                                            className={'ledger_fixed_action'}
                                            onClick={() => props.onResumeFixedCost(cost.id)}
                                            title={`${cost.endYm} 로 찍힌 종료를 취소하고 다시 매월 청구합니다`}
                                        >
                                            취소
                                        </button>
                                    ) : (
                                        <button
                                            type={'button'}
                                            className={'ledger_fixed_action'}
                                            onClick={() => handleEnd(cost)}
                                            title={`${formatYmTitle(props.selectedYm)}부터 해지 — 이전 달은 그대로 남습니다`}
                                        >
                                            해지
                                        </button>
                                    )): (
                                        <div style={{width: '40px'}}/>
                                    )}

                                    <button
                                        type={'button'}
                                        className={'ledger_row_remove'}
                                        onClick={() => handleRemove(cost.id)}
                                        title={'삭제 — 과거 달에서도 사라집니다'}
                                    >
                                        ×
                                    </button>
                                </span>
                            </div>
                        )
                    })}
                </div>
            )}

            {/* 4) 종료 항목 펼치기 — 평소엔 접어 두고, 지우거나 되살릴 때만 꺼낸다 */}
            {endedCosts.length > 0 && (
                <button
                    type={'button'}
                    className={'ledger_fixed_ended_toggle'}
                    onClick={() => setShowEnded(!showEnded)}
                    title={'해지한 고정비와 다 갚은 할부입니다'}
                >
                    {showEnded
                        ? `종료된 ${endedCosts.length}건 접기`
                        : `종료된 ${endedCosts.length}건 보기`}
                </button>
            )}
        </section>
    )
}

export default LedgerFixedCostPanel