import { useState, type ChangeEvent, type FormEvent } from 'react'
import {
    LEDGER_CATEGORIES,
    formatDateShort,
    formatYmTitle,
    toDefaultCategory,
    toDefaultDateOfYm,
    todayYm,
} from '../constants/ledgerConstants'
import { useLedger } from '../hooks/useLedger'
import { LEDGER_KIND_LABEL, LedgerKind } from '../types/ledger'
import { formatKrw } from '../utils/format'
import LedgerCardPanel from './LedgerCardPanel'
import LedgerFixedCostPanel from './LedgerFixedCostPanel'

/**
 * 가계부 화면 — 월 단위로 수입/지출을 기록하고 합계를 확인한다.
 * 저장 버튼은 없다. 항목을 넣고 지우는 즉시 브라우저 로컬 저장소에 기록된다.
 */
function LedgerView() {

    // ┣━━━━━━━━━━━━━━━━ CustomHooks ━━━━━━━━━━━━━━━━┫
    const ledger = useLedger()

    // ┣━━━━━━━━━━━━━━━━ States ━━━━━━━━━━━━━━━━━━━━━┫
    const [date, setDate] = useState<string>(() => toDefaultDateOfYm(todayYm()))   // 입력 폼 날짜 'YYYY-MM-DD'
    const [kind, setKind] = useState<LedgerKind>(LedgerKind.EXPENSE)               // 입력 폼 구분 — 기록 빈도가 높은 지출을 기본값으로
    const [category, setCategory] = useState<string>(toDefaultCategory(LedgerKind.EXPENSE))   // 입력 폼 분류
    const [memo, setMemo] = useState<string>('')                                  // 입력 폼 내용 메모
    const [amount, setAmount] = useState<string>('')                              // 입력 폼 금액 — 빈 값 허용을 위해 문자열로 들고 있는다

    // ┣━━━━━━━━━━━━━━━━ Derived ━━━━━━━━━━━━━━━━━━━━┫
    // 1) 추가 가능 여부 — 금액이 0보다 커야 한다
    const parsedAmount = Number(amount)
    const submittable = amount !== '' && Number.isFinite(parsedAmount) && parsedAmount > 0

    // 2) 이번 달 잔액 부호 — 흑자/적자 색 구분용
    const netTone = ledger.summary.net < 0 ? 'ledger_summary_value_minus' : 'ledger_summary_value_plus'

    // ┣━━━━━━━━━━━━━━━━ Handlers ━━━━━━━━━━━━━━━━━━━┫

    /** 구분 변경 — @param event 셀렉트 변경 이벤트. 분류 목록이 통째로 바뀌므로 분류도 기본값으로 되돌린다 */
    const handleKindChange = (event: ChangeEvent<HTMLSelectElement>) => {
        const nextKind = event.target.value as LedgerKind
        setKind(nextKind)
        setCategory(toDefaultCategory(nextKind))
    }

    /** 볼 달 변경 — @param ym 선택된 'YYYY-MM'. 입력 폼 날짜도 그 달로 옮겨 매번 고쳐 넣지 않게 한다 */
    const handleMonthChange = (ym: string) => {
        ledger.handleSelectYm(ym)
        if (ym !== '') setDate(toDefaultDateOfYm(ym))
    }

    /** 이전/다음 달 이동 — @param delta 더할 개월 수 (-1 이전, +1 다음) */
    const handleShiftMonth = (delta: number) => {
        ledger.handleShiftMonth(delta)
    }

    /** 항목 추가 — @param event 폼 제출 이벤트. 금액·내용만 비우고 날짜/구분/분류는 연속 입력을 위해 유지한다 */
    const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        if (!submittable) return

        ledger.handleAddEntry({
            date,
            kind,
            category,
            memo: memo.trim(),
            // 소수점이 섞여 들어와도 원 단위로 맞춘다
            amount: Math.round(parsedAmount),
        })
        setMemo('')
        setAmount('')
    }

    return (
        <div className={'ledger_view'}>
            {/* 1) 헤더 — 월 이동 + 이번 달 복귀 */}
            <section className={'ledger_head'}>
                <div className={'ledger_month'}>
                    <button
                        type={'button'}
                        className={'ledger_month_nav'}
                        onClick={() => handleShiftMonth(-1)}
                        title={'이전 달'}
                    >
                        ‹
                    </button>
                    <h2 className={'ledger_month_title'}>{formatYmTitle(ledger.selectedYm)}</h2>
                    <button
                        type={'button'}
                        className={'ledger_month_nav'}
                        onClick={() => handleShiftMonth(1)}
                        title={'다음 달'}
                    >
                        ›
                    </button>

                    <input
                        type={'month'}
                        className={'ledger_month_picker'}
                        value={ledger.selectedYm}
                        onChange={(event) => handleMonthChange(event.target.value)}
                        title={'달 직접 선택'}
                    />
                    {ledger.selectedYm !== todayYm() && (
                        <button
                            type={'button'}
                            className={'ledger_month_today'}
                            onClick={ledger.handleGoToday}
                            title={'이번 달로 돌아갑니다'}
                        >
                            이번 달
                        </button>
                    )}
                </div>

                <span className={'ledger_head_note'}>
                    입력 즉시 이 브라우저에 저장됩니다 · 기록된 달 {ledger.recordedYms.length}개
                </span>
            </section>

            {/* 2) 월 요약 — 수입 / 직접 입력 지출 / 자동 청구 고정비 / 잔액 */}
            <section className={'ledger_summary'}>
                <div className={'ledger_summary_card'}>
                    <span className={'ledger_summary_label'}>수입</span>
                    <strong className={'ledger_summary_value ledger_summary_value_plus'}>
                        {formatKrw(ledger.summary.income)}원
                    </strong>
                </div>
                <div className={'ledger_summary_card'}>
                    <span className={'ledger_summary_label'}>지출</span>
                    <strong className={'ledger_summary_value ledger_summary_value_minus'}>
                        {formatKrw(ledger.summary.expense)}원
                    </strong>
                </div>
                <div className={'ledger_summary_card'} title={'등록된 고정비와 이번 달 할부가 자동으로 합산됩니다'}>
                    <span className={'ledger_summary_label'}>고정비 · 할부</span>
                    <strong className={'ledger_summary_value ledger_summary_value_minus'}>
                        {formatKrw(ledger.summary.fixed)}원
                    </strong>
                </div>
                <div className={'ledger_summary_card'} title={'수입 - 지출 - 고정비'}>
                    <span className={'ledger_summary_label'}>잔액</span>
                    <strong className={`ledger_summary_value ${netTone}`}>
                        {formatKrw(ledger.summary.net)}원
                    </strong>
                </div>
            </section>

            {/* 3) 고정비 · 할부 — 등록과 이번 달 청구 현황 */}
            <LedgerFixedCostPanel
                selectedYm={ledger.selectedYm}
                fixedCosts={ledger.fixedCosts}
                charges={ledger.charges}
                cards={ledger.cards}
                onAddFixedCost={ledger.handleAddFixedCost}
                onUpdateFixedCost={ledger.handleUpdateFixedCost}
                onRemoveFixedCost={ledger.handleRemoveFixedCost}
            />

            {/* 4) 카드 정산 — 명세서 총액에서 할부를 걷어낸 실제 사용액 */}
            <LedgerCardPanel
                selectedYm={ledger.selectedYm}
                cardStatements={ledger.cardStatements}
                onAddCard={ledger.handleAddCard}
                onRemoveCard={ledger.handleRemoveCard}
                onChangeStatement={ledger.handleChangeStatement}
            />

            {/* 5) 입출금 입력 폼 — 날짜 / 구분 / 분류 / 내용 / 금액 */}
            <form className={'ledger_form ledger_form_entry'} onSubmit={handleSubmit}>
                <input
                    type={'date'}
                    className={'ledger_field ledger_field_date'}
                    value={date}
                    onChange={(event) => setDate(event.target.value)}
                    title={'발생일'}
                />
                <select
                    className={'ledger_field ledger_field_kind'}
                    value={kind}
                    onChange={handleKindChange}
                    title={'수입/지출 구분'}
                >
                    {Object.values(LedgerKind).map((value) => (
                        <option key={value} value={value}>{LEDGER_KIND_LABEL[value]}</option>
                    ))}
                </select>
                <select
                    className={'ledger_field ledger_field_category'}
                    value={category}
                    onChange={(event) => setCategory(event.target.value)}
                    title={'분류'}
                >
                    {LEDGER_CATEGORIES[kind].map((value) => (
                        <option key={value} value={value}>{value}</option>
                    ))}
                </select>
                <input
                    type={'text'}
                    className={'ledger_field ledger_field_memo'}
                    value={memo}
                    onChange={(event) => setMemo(event.target.value)}
                    placeholder={'내용 (선택)'}
                    maxLength={40}
                />
                <input
                    type={'number'}
                    className={'ledger_field ledger_field_amount'}
                    value={amount}
                    onChange={(event) => setAmount(event.target.value)}
                    placeholder={'금액'}
                    min={0}
                    step={1}
                />
                <button
                    type={'submit'}
                    className={'ledger_submit'}
                    disabled={!submittable}
                    title={submittable ? '항목을 추가합니다' : '금액을 입력하세요'}
                >
                    추가
                </button>
            </form>

            {/* 6) 본문 — 좌측 항목 목록 / 우측 분류별 지출 */}
            <div className={'ledger_body'}>
                <section className={'ledger_list'}>
                    {ledger.monthEntries.length === 0 ? (
                        <p className={'ledger_empty'}>이 달에는 기록이 없습니다. 위에서 첫 항목을 넣어 보세요.</p>
                    ) : (
                        ledger.monthEntries.map((entry) => (
                            <div key={entry.id} className={'ledger_row'}>
                                <span className={'ledger_row_date'}>{formatDateShort(entry.date)}</span>
                                <span
                                    className={entry.kind === LedgerKind.INCOME
                                        ? 'ledger_row_kind ledger_row_kind_income'
                                        : 'ledger_row_kind ledger_row_kind_expense'}
                                >
                                    {LEDGER_KIND_LABEL[entry.kind]}
                                </span>
                                <span className={'ledger_row_category'}>{entry.category}</span>
                                <span className={'ledger_row_memo'} title={entry.memo}>{entry.memo}</span>
                                <span
                                    className={entry.kind === LedgerKind.INCOME
                                        ? 'ledger_row_amount ledger_row_amount_income'
                                        : 'ledger_row_amount ledger_row_amount_expense'}
                                >
                                    {entry.kind === LedgerKind.INCOME ? '+' : '−'}{formatKrw(entry.amount)}원
                                </span>
                                <button
                                    type={'button'}
                                    className={'ledger_row_remove'}
                                    onClick={() => ledger.handleRemoveEntry(entry.id)}
                                    title={'이 항목 삭제'}
                                >
                                    ×
                                </button>
                            </div>
                        ))
                    )}
                </section>

                {/* 6-1) 분류별 지출 — 직접 입력분 + 고정비를 합쳐 비중을 막대로 표기 */}
                <section className={'ledger_category_panel'}>
                    <h3 className={'ledger_category_title'}>분류별 지출</h3>
                    {ledger.expenseByCategory.length === 0 ? (
                        <p className={'ledger_empty'}>지출 기록이 없습니다.</p>
                    ) : (
                        ledger.expenseByCategory.map((item) => (
                            <div key={item.category} className={'ledger_category_row'}>
                                <div className={'ledger_category_head'}>
                                    <span className={'ledger_category_name'}>{item.category}</span>
                                    <span className={'ledger_category_amount'}>{formatKrw(item.amount)}원</span>
                                </div>
                                <div className={'ledger_category_bar'}>
                                    <div
                                        className={'ledger_category_bar_fill'}
                                        style={{ width: `${(item.ratio * 100).toFixed(1)}%` }}
                                    />
                                </div>
                                <span className={'ledger_category_ratio'}>{(item.ratio * 100).toFixed(1)}%</span>
                            </div>
                        ))
                    )}
                </section>
            </div>
        </div>
    )
}

export default LedgerView