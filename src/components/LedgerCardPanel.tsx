import { useState, type ChangeEvent, type FormEvent } from 'react'
import type { CardMonthlyStatement } from '../types/ledger'
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
}

/**
 * 카드 정산 패널 — 카드별로 "이번 달 명세서 총액"을 직접 적고, 자동 청구분을 걷어낸 실제 사용액을 확인한다.
 * 할부는 과거에 쓴 돈이 이번 달에 청구된 것이고, 이 카드로 빠지는 고정비는 이미 고정비로 따로 잡혀 있다.
 * 둘 다 빼야 이번 달에 카드로 새로 쓴 금액만 남는다.
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

            {/* 2) 카드별 정산 — 청구 총액(직접 입력) − 할부 − 고정비 = 실제 사용액 */}
            {props.cardStatements.length === 0 ? (
                <p className={'ledger_empty'}>등록된 카드가 없습니다. 카드를 먼저 등록하면 고정비·할부를 묶을 수 있습니다.</p>
            ) : (
                <div className={'ledger_card_list'}>
                    {props.cardStatements.map((statement) => {
                        // 2-1) 실제 사용액이 음수면 청구 총액을 잘못 적었거나 할부·고정비 등록이 어긋난 것 — 눈에 띄게 표시
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

                                {/* 2-5) 결과 — 이번 달에 카드로 새로 쓴 금액 */}
                                <div className={'ledger_card_row ledger_card_row_result'}>
                                    <span className={'ledger_card_row_label'}>= 실제 사용</span>
                                    <span
                                        className={invalid
                                            ? 'ledger_card_row_value ledger_card_actual ledger_card_actual_invalid'
                                            : 'ledger_card_row_value ledger_card_actual'}
                                        title={invalid ? '할부＋고정비 합계가 청구 총액보다 큽니다. 총액이나 고정비·할부 등록을 확인하세요.' : ''}
                                    >
                                        {statement.total === null ? '총액 입력 필요' : `${formatKrw(statement.actual ?? 0)}원`}
                                    </span>
                                </div>

                                {/* 2-6) 참고 — 자동으로 빠지는 몫이 얼마인지 한 줄로 요약 */}
                                {statement.autoCharged > 0 && (
                                    <span className={'ledger_card_note'}>
                                        자동 청구 {formatKrw(statement.autoCharged)}원 (할부 {formatKrw(statement.installment)}원 + 고정비 {formatKrw(statement.recurring)}원)
                                    </span>
                                )}
                            </div>
                        )
                    })}
                </div>
            )}

            <span className={'ledger_section_note'}>
                청구 총액은 {props.selectedYm} 명세서 기준으로 달마다 따로 기록됩니다.
            </span>
        </section>
    )
}

export default LedgerCardPanel