import { useState, type ChangeEvent, type FormEvent } from 'react'
import { ERRAND_LABEL } from '../constants/ledgerConstants'
import type { CardErrand, CardMonthlyStatement } from '../types/ledger'
import { formatKrw } from '../utils/format'

interface LedgerCardPanelProps {
    /** 선택된 달 'YYYY-MM' — 청구 총액을 어느 달에 적는지 표기용 */
    selectedYm: string
    /** 카드별 그 달 정산 결과 */
    cardStatements: CardMonthlyStatement[]
    /** 카드 등록 — @param name 카드 이름 */
    onAddCard: (name: string) => void
    /** 카드 삭제 — @param cardId 대상 카드 */
    onRemoveCard: (cardId: string) => void
    /** 청구 총액 입력 — @param cardId 대상 카드, @param total 총액 (null 이면 입력 지움) */
    onChangeStatement: (cardId: string, total: number | null) => void
    /** 대납 추가 — @param cardId 대상 카드, @param memo 내용, @param amount 금액 */
    onAddErrand: (cardId: string, memo: string, amount: number) => void
    /** 대납 삭제 — @param errandId 대상 대납 */
    onRemoveErrand: (errandId: string) => void
}

/**
 * 카드 정산 패널 — 카드별로 "이번 달 명세서 총액"을 직접 적고, 내 돈이 아닌 몫을 걷어낸 실제 사용액을 확인한다.
 * 할부는 과거에 쓴 돈이 이번 달에 청구된 것이고, 이 카드로 빠지는 고정비는 이미 고정비로 따로 잡혀 있다.
 * 엄마 심부름으로 산 물건도 엄마 용돈에서 그만큼 빠지므로 내 지출이 아니다.
 * 셋 다 빼야 이번 달에 내 돈으로 카드에서 새로 쓴 금액만 남는다.
 */
function LedgerCardPanel(props: LedgerCardPanelProps) {

    // ┣━━━━━━━━━━━━━━━━ States ━━━━━━━━━━━━━━━━━━━━━┫
    const [cardName, setCardName] = useState<string>('')   // 카드 등록 입력값

    // ┣━━━━━━━━━━━━━━━━ Handlers ━━━━━━━━━━━━━━━━━━━┫

    /** 카드 등록 — @param event 폼 제출 이벤트. 등록 후 입력창을 비운다 */
    const handleAddCard = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        if (cardName.trim().length === 0) return

        props.onAddCard(cardName)
        setCardName('')
    }

    /** 청구 총액 변경 — @param event 입력 이벤트, @param cardId 대상 카드. 빈 값이면 기록 자체를 지운다 */
    const handleTotalChange = (event: ChangeEvent<HTMLInputElement>, cardId: string) => {
        const raw = event.target.value
        if (raw === '') {
            props.onChangeStatement(cardId, null)
            return
        }

        const parsed = Number(raw)
        if (!Number.isFinite(parsed) || parsed < 0) return
        props.onChangeStatement(cardId, Math.round(parsed))
    }

    return (
        <section className={'ledger_card_panel'}>
            {/* 1) 패널 헤더 — 카드 등록 */}
            <div className={'ledger_section_head'}>
                <h3 className={'ledger_section_title'}>카드 정산</h3>
                <form className={'ledger_card_add'} onSubmit={handleAddCard}>
                    <input
                        type={'text'}
                        className={'ledger_field'}
                        value={cardName}
                        onChange={(event) => setCardName(event.target.value)}
                        placeholder={'카드 이름 (예: 신한 딥드림)'}
                        maxLength={20}
                    />
                    <button
                        type={'submit'}
                        className={'ledger_submit'}
                        disabled={cardName.trim().length === 0}
                        title={'카드를 등록합니다'}
                    >
                        카드 추가
                    </button>
                </form>
            </div>

            {/* 2) 카드별 정산 — 청구 총액(직접 입력) − 할부 − 고정비 − 엄마 심부름 = 실제 사용액 */}
            {props.cardStatements.length === 0 ? (
                <p className={'ledger_empty'}>등록된 카드가 없습니다. 카드를 먼저 등록하면 고정비·할부를 묶을 수 있습니다.</p>
            ) : (
                <div className={'ledger_card_list'}>
                    {props.cardStatements.map((statement) => {
                        // 2-1) 실제 사용액이 음수면 청구 총액을 잘못 적었거나 할부·고정비·심부름 등록이 어긋난 것 — 눈에 띄게 표시
                        const invalid = statement.actual !== null && statement.actual < 0

                        return (
                            <div key={statement.card.id} className={'ledger_card_item'}>
                                <div className={'ledger_card_item_head'}>
                                    <span className={'ledger_card_name'}>{statement.card.name}</span>
                                    <button
                                        type={'button'}
                                        className={'ledger_card_remove'}
                                        onClick={() => props.onRemoveCard(statement.card.id)}
                                        title={'이 카드 삭제 — 물려 있던 고정비는 "카드 없음"으로 남습니다'}
                                    >
                                        ×
                                    </button>
                                </div>

                                {/* 2-2) 명세서 총액 — 유일하게 사람이 직접 적는 값 */}
                                <label className={'ledger_card_row'}>
                                    <span className={'ledger_card_row_label'}>청구 총액</span>
                                    <input
                                        type={'number'}
                                        className={'ledger_field ledger_card_total'}
                                        value={statement.total ?? ''}
                                        onChange={(event) => handleTotalChange(event, statement.card.id)}
                                        placeholder={'명세서 금액 입력'}
                                        min={0}
                                        step={1}
                                    />
                                </label>

                                {/* 2-3) 자동 계산 ① — 그 달 이 카드에 걸린 할부 합계 */}
                                <div className={'ledger_card_row'}>
                                    <span className={'ledger_card_row_label'}>− 할부</span>
                                    <span className={'ledger_card_row_value'}>{formatKrw(statement.installment)}원</span>
                                </div>

                                {/* 2-4) 자동 계산 ② — 이 카드로 결제되는 고정비 합계. 명세서 총액에 이미 섞여 있으니 함께 걷어낸다 */}
                                <div className={'ledger_card_row'}>
                                    <span className={'ledger_card_row_label'}>− 고정비</span>
                                    <span className={'ledger_card_row_value'}>{formatKrw(statement.recurring)}원</span>
                                </div>

                                {/* 2-5) 대납 — 엄마 심부름으로 산 물건. 카드값에는 있지만 엄마 용돈에서 빠지는 몫 */}
                                <LedgerCardErrandBox
                                    cardId={statement.card.id}
                                    errands={statement.errands}
                                    errand={statement.errand}
                                    onAddErrand={props.onAddErrand}
                                    onRemoveErrand={props.onRemoveErrand}
                                />

                                {/* 2-6) 결과 — 이번 달에 내 돈으로 카드에서 새로 쓴 금액 */}
                                <div className={'ledger_card_row ledger_card_row_result'}>
                                    <span className={'ledger_card_row_label'}>= 실제 사용</span>
                                    <span
                                        className={invalid
                                            ? 'ledger_card_row_value ledger_card_actual ledger_card_actual_invalid'
                                            : 'ledger_card_row_value ledger_card_actual'}
                                        title={invalid ? '할부＋고정비＋심부름 합계가 청구 총액보다 큽니다. 총액이나 등록 내용을 확인하세요.' : ''}
                                    >
                                        {statement.total === null ? '총액 입력 필요' : `${formatKrw(statement.actual ?? 0)}원`}
                                    </span>
                                </div>

                                {/* 2-7) 참고 — 내 지출에서 빠지는 몫이 얼마인지 한 줄로 요약 */}
                                {(statement.autoCharged > 0 || statement.errand > 0) && (
                                    <span className={'ledger_card_note'}>
                                        자동 청구 {formatKrw(statement.autoCharged)}원 (할부 {formatKrw(statement.installment)}원 + 고정비 {formatKrw(statement.recurring)}원)
                                        {statement.errand > 0 && ` · ${ERRAND_LABEL} ${formatKrw(statement.errand)}원`}
                                    </span>
                                )}
                            </div>
                        )
                    })}
                </div>
            )}

            <span className={'ledger_section_note'}>
                청구 총액과 {ERRAND_LABEL}은 {props.selectedYm} 명세서 기준으로 달마다 따로 기록됩니다.
            </span>
        </section>
    )
}

interface LedgerCardErrandBoxProps {
    /** 대상 카드 id */
    cardId: string
    /** 그 달 이 카드에 적어 둔 대납 목록 */
    errands: CardErrand[]
    /** 그 달 이 카드의 대납 합계 */
    errand: number
    /** 대납 추가 — @param cardId 대상 카드, @param memo 내용, @param amount 금액 */
    onAddErrand: (cardId: string, memo: string, amount: number) => void
    /** 대납 삭제 — @param errandId 대상 대납 */
    onRemoveErrand: (errandId: string) => void
}

/**
 * 카드 1장의 대납(엄마 심부름) 입력함 — 카드값 안에 섞여 있지만 내 돈이 아닌 결제를 건별로 적는다.
 * 입력 상태를 카드마다 따로 들고 있어야 해서 카드 항목과 분리했다.
 * (한 컴포넌트에서 카드별 입력값을 맵으로 들고 있으면 카드가 늘 때마다 상태 관리가 지저분해진다)
 */
function LedgerCardErrandBox(props: LedgerCardErrandBoxProps) {

    // ┣━━━━━━━━━━━━━━━━ States ━━━━━━━━━━━━━━━━━━━━━┫
    const [memo, setMemo] = useState<string>('')       // 대납 입력 폼 내용 메모
    const [amount, setAmount] = useState<string>('')   // 대납 입력 폼 금액 — 빈 값 허용을 위해 문자열로 들고 있는다
    const [open, setOpen] = useState<boolean>(false)   // 입력 폼 펼침 여부. 심부름이 없는 달에는 접어 둔다

    // ┣━━━━━━━━━━━━━━━━ Derived ━━━━━━━━━━━━━━━━━━━━┫
    // 1) 추가 가능 여부 — 금액이 0보다 커야 한다
    const parsedAmount = Number(amount)
    const submittable = amount !== '' && Number.isFinite(parsedAmount) && parsedAmount > 0

    // 2) 목록/폼 노출 여부 — 이미 적어 둔 건이 있으면 접지 않는다
    const expanded = open || props.errands.length > 0

    // ┣━━━━━━━━━━━━━━━━ Handlers ━━━━━━━━━━━━━━━━━━━┫

    /** 입력 폼 펼치기/접기 — 이미 적어 둔 건이 있으면 접어도 목록은 남는다 */
    const handleToggle = () => {
        setOpen((prev) => !prev)
    }

    /** 대납 추가 — @param event 폼 제출 이벤트. 추가 후 입력창을 비워 연속 입력을 잇는다 */
    const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        if (!submittable) return

        props.onAddErrand(props.cardId, memo, parsedAmount)
        setMemo('')
        setAmount('')
    }

    return (
        <div className={'ledger_errand_box'}>
            {/* 1) 합계 줄 — 다른 차감 항목(할부·고정비)과 같은 모양으로 맞춘다 */}
            <div className={'ledger_card_row'}>
                <span className={'ledger_card_row_label'}>
                    − {ERRAND_LABEL}
                    <button
                        type={'button'}
                        className={'ledger_errand_toggle'}
                        onClick={handleToggle}
                        title={'엄마 심부름으로 산 물건 — 카드값에는 있지만 엄마 용돈에서 빠지는 금액입니다'}
                    >
                        {open ? '접기' : '＋ 추가'}
                    </button>
                </span>
                <span className={'ledger_card_row_value'}>{formatKrw(props.errand)}원</span>
            </div>

            {/* 2) 건별 목록 + 입력 폼 — 적어 둔 건이 있거나 추가를 누른 동안만 펼친다 */}
            {expanded && (
                <div className={'ledger_errand_body'}>
                    {props.errands.map((errand) => (
                        <div key={errand.id} className={'ledger_errand_row'}>
                            <span className={'ledger_errand_memo'} title={errand.memo}>
                                {errand.memo === '' ? '(내용 없음)' : errand.memo}
                            </span>
                            <span className={'ledger_errand_amount'}>{formatKrw(errand.amount)}원</span>
                            <button
                                type={'button'}
                                className={'ledger_errand_remove'}
                                onClick={() => props.onRemoveErrand(errand.id)}
                                title={'이 심부름 삭제'}
                            >
                                ×
                            </button>
                        </div>
                    ))}

                    {/* 2-1) 입력 폼 — 접혀 있어도 목록은 보이지만, 폼은 추가를 눌렀을 때만 연다 */}
                    {open && (
                        <form className={'ledger_errand_form'} onSubmit={handleSubmit}>
                            <input
                                type={'text'}
                                className={'ledger_field ledger_errand_field_memo'}
                                value={memo}
                                onChange={(event) => setMemo(event.target.value)}
                                placeholder={'내용 (예: 약국 심부름)'}
                                maxLength={30}
                            />
                            <input
                                type={'number'}
                                className={'ledger_field ledger_errand_field_amount'}
                                value={amount}
                                onChange={(event) => setAmount(event.target.value)}
                                placeholder={'금액'}
                                min={0}
                                step={1}
                            />
                            <button
                                type={'submit'}
                                className={'ledger_submit ledger_errand_submit'}
                                disabled={!submittable}
                                title={submittable ? '심부름 금액을 추가합니다' : '금액을 입력하세요'}
                            >
                                추가
                            </button>
                        </form>
                    )}
                </div>
            )}
        </div>
    )
}

export default LedgerCardPanel
