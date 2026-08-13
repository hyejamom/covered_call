import { useState, type ChangeEvent, type FormEvent } from 'react'
import {
    LEDGER_CATEGORIES,
    LIVING_CATEGORY,
    formatDateShort,
    formatYmTitle,
    toDefaultCategory,
    toDefaultDateOfYm,
    todayYm,
} from '../constants/ledgerConstants'
import { LedgerSyncStatus, type LedgerState } from '../hooks/useLedger'
import { LEDGER_KIND_LABEL, LedgerKind, type LedgerEntry } from '../types/ledger'
import { formatKrw } from '../utils/format'
import LedgerCardPanel from './LedgerCardPanel'
import LedgerExcelButton from './LedgerExcelButton'
import LedgerFixedCostPanel from './LedgerFixedCostPanel'
import LedgerFixedIncomePanel from './LedgerFixedIncomePanel'

interface LedgerViewProps {
    /** 가계부 상태 — 분석 화면과 같은 데이터를 봐야 하므로 App 에서 만들어 내려준다 */
    ledger: LedgerState
}

/** 서버 저장 상태별 표기 문구 — 지금 기록이 어디까지 안전한지를 한 줄로 알린다 */
const SYNC_LABEL: Record<LedgerSyncStatus, string> = {
    [LedgerSyncStatus.LOADING]: '서버에서 불러오는 중…',
    [LedgerSyncStatus.SAVING]: '서버에 저장 중…',
    [LedgerSyncStatus.SAVED]: '서버에 저장됨',
    [LedgerSyncStatus.OFFLINE]: '서버 연결 안 됨 — 이 브라우저에만 남아 있습니다',
    [LedgerSyncStatus.ERROR]: '서버 저장 실패 — 이 브라우저에만 남아 있습니다',
}

/**
 * 가계부 화면 — 월 단위로 수입/지출을 기록하고 합계를 확인한다.
 * 저장 버튼은 없다. 입력이 멎으면 서버 파일(server/data/ledger.json)로 올라가고,
 * 브라우저 로컬 저장소에는 같은 내용이 즉시 복사된다.
 */
function LedgerView(props: LedgerViewProps) {

    // ┣━━━━━━━━━━━━━━━━ Props ━━━━━━━━━━━━━━━━━━━━━━┫
    // 아래 JSX 에서 ledger.xxx 로 자주 참조하므로 한 번만 꺼내 별칭을 둔다
    const ledger = props.ledger

    // ┣━━━━━━━━━━━━━━━━ States ━━━━━━━━━━━━━━━━━━━━━┫
    const [date, setDate] = useState<string>(() => toDefaultDateOfYm(todayYm()))   // 입력 폼 날짜 'YYYY-MM-DD'
    const [kind, setKind] = useState<LedgerKind>(LedgerKind.EXPENSE)               // 입력 폼 구분 — 기록 빈도가 높은 지출을 기본값으로
    const [category, setCategory] = useState<string>(toDefaultCategory(LedgerKind.EXPENSE))   // 입력 폼 분류
    const [memo, setMemo] = useState<string>('')                                  // 입력 폼 내용 메모
    const [amount, setAmount] = useState<string>('')                              // 입력 폼 금액 — 빈 값 허용을 위해 문자열로 들고 있는다
    const [editingId, setEditingId] = useState<string | null>(null)               // 수정 중인 항목 id. null이면 신규 입력 모드

    // ┣━━━━━━━━━━━━━━━━ Derived ━━━━━━━━━━━━━━━━━━━━┫
    // 1) 추가 가능 여부 — 금액이 0보다 커야 한다
    const parsedAmount = Number(amount)
    const submittable = amount !== '' && Number.isFinite(parsedAmount) && parsedAmount > 0

    // 2) 이번 달 잔액 부호 — 흑자/적자 색 구분용
    const netTone = ledger.summary.net < 0 ? 'ledger_summary_value_minus' : 'ledger_summary_value_plus'

    // 3) 서버 저장 상태 — 저장이 안 된 상태만 눈에 띄게 하고, 잘 저장된 동안은 조용히 둔다
    const syncFailed = ledger.syncStatus === LedgerSyncStatus.OFFLINE
        || ledger.syncStatus === LedgerSyncStatus.ERROR
    const syncToneClass = syncFailed ? 'ledger_sync ledger_sync_failed' : 'ledger_sync'
    const syncTitle = ledger.syncError
        ?? (ledger.syncedAt === null
            ? '서버 파일: server/data/ledger.json'
            : `마지막 저장 ${new Date(ledger.syncedAt).toLocaleString('ko-KR')} · server/data/ledger.json`)

    // ┣━━━━━━━━━━━━━━━━ Handlers ━━━━━━━━━━━━━━━━━━━┫

    /** 구분 변경 — @param event 셀렉트 변경 이벤트. 분류 목록이 통째로 바뀌므로 분류도 기본값으로 되돌린다 */
    const handleKindChange = (event: ChangeEvent<HTMLSelectElement>) => {
        const nextKind = event.target.value as LedgerKind
        setKind(nextKind)
        setCategory(toDefaultCategory(nextKind))
    }

    /** 수정 시작 — @param entry 수정할 항목. 입력 폼에 값을 그대로 올려 같은 자리에서 고치게 한다 */
    const handleStartEdit = (entry: LedgerEntry) => {
        setEditingId(entry.id)
        setDate(entry.date)
        setKind(entry.kind)
        setCategory(entry.category)
        setMemo(entry.memo)
        setAmount(String(entry.amount))
    }

    /** 수정 취소 — 폼을 신규 입력 상태로 되돌린다 */
    const handleCancelEdit = () => {
        setEditingId(null)
        setMemo('')
        setAmount('')
    }

    /** 항목 삭제 — @param id 대상 항목. 수정 중이던 건을 지우면 폼도 함께 초기화한다 */
    const handleRemove = (id: string) => {
        if (id === editingId) handleCancelEdit()
        ledger.handleRemoveEntry(id)
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

    /**
     * 항목 추가 / 수정 저장 — @param event 폼 제출 이벤트
     * 신규는 금액·내용만 비워 연속 입력을 잇고(날짜·구분·분류는 유지), 수정은 저장 후 신규 입력 모드로 빠져나온다.
     */
    const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        if (!submittable) return

        const draft = {
            date,
            kind,
            category,
            memo: memo.trim(),
            // 소수점이 섞여 들어와도 원 단위로 맞춘다
            amount: Math.round(parsedAmount),
        }

        if (editingId === null) {
            ledger.handleAddEntry(draft)
            setMemo('')
            setAmount('')
            return
        }

        ledger.handleUpdateEntry(editingId, draft)
        handleCancelEdit()
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

                <div className={'ledger_head_right'}>
                    {/* 저장 상태 — 지금 기록이 서버 파일까지 갔는지 알린다 */}
                    <span className={syncToneClass} title={syncTitle}>
                        <span className={'ledger_sync_dot'} />
                        {SYNC_LABEL[ledger.syncStatus]}
                    </span>

                    {/* 저장에 실패한 동안만 노출 — 서버를 뒤늦게 켠 경우 여기서 복구한다 */}
                    {syncFailed && (
                        <button
                            type={'button'}
                            className={'ledger_sync_retry'}
                            onClick={ledger.handleRetrySync}
                            title={'지금 내용을 서버에 다시 올립니다'}
                        >
                            다시 저장
                        </button>
                    )}

                    <span className={'ledger_head_note'}>
                        기록된 달 {ledger.recordedYms.length}개
                    </span>
                    {/* 엑셀 내보내기 — 기간을 고르면 달마다 시트 1장으로 저장한다 */}
                    <LedgerExcelButton
                        data={{
                            entries: ledger.entries,
                            cards: ledger.cards,
                            fixedCosts: ledger.fixedCosts,
                            fixedIncomes: ledger.fixedIncomes,
                            statements: ledger.statements,
                        }}
                    />
                </div>
            </section>

            {/* 2) 월 요약 — 들어온 돈(수입 · 고정 수입) / 나간 돈(고정비 · 카드 · 총지출) / 저축 가능액 순으로 읽힌다 */}
            <section className={'ledger_summary'}>
                <div className={'ledger_summary_card'} title={'직접 입력한 수입 항목의 합계'}>
                    <span className={'ledger_summary_label'}>수입</span>
                    <strong className={'ledger_summary_value ledger_summary_value_plus'}>
                        {formatKrw(ledger.summary.income)}원
                    </strong>
                </div>
                <div className={'ledger_summary_card'} title={'등록된 고정 수입이 자동으로 합산됩니다'}>
                    <span className={'ledger_summary_label'}>고정 수입</span>
                    <strong className={'ledger_summary_value ledger_summary_value_plus'}>
                        {formatKrw(ledger.summary.fixedIncome)}원
                    </strong>
                </div>
                <div className={'ledger_summary_card'} title={'등록된 고정비와 이번 달 할부가 자동으로 합산됩니다'}>
                    <span className={'ledger_summary_label'}>고정비 · 할부</span>
                    <strong className={'ledger_summary_value ledger_summary_value_minus'}>
                        {formatKrw(ledger.summary.fixed)}원
                    </strong>
                </div>
                <div
                    className={'ledger_summary_card'}
                    title={'카드 명세서 총액에서 할부·고정비를 뺀 금액 — 이번 달 카드로 새로 쓴 돈'}
                >
                    <span className={'ledger_summary_label'}>카드 사용</span>
                    <strong className={'ledger_summary_value ledger_summary_value_minus'}>
                        {formatKrw(ledger.summary.cardUsed)}원
                    </strong>
                    {/* 아래 목록에 적어 둔 큰 지출과, 나머지를 뭉친 생활비로 쪼개 보여 준다 */}
                    <span className={'ledger_summary_sub'}>
                        큰 지출 {formatKrw(ledger.summary.expense)}원 · 생활비 {formatKrw(ledger.summary.living)}원
                    </span>
                </div>
                <div className={'ledger_summary_card'} title={'고정비·할부 + 큰 지출 + 생활비'}>
                    <span className={'ledger_summary_label'}>총지출</span>
                    <strong className={'ledger_summary_value ledger_summary_value_minus'}>
                        {formatKrw(ledger.summary.total)}원
                    </strong>
                </div>
                <div className={'ledger_summary_card'} title={'(수입 + 고정 수입) - 총지출'}>
                    <span className={'ledger_summary_label'}>저축 가능액</span>
                    <strong className={`ledger_summary_value ${netTone}`}>
                        {formatKrw(ledger.summary.net)}원
                    </strong>
                </div>
            </section>

            {/* 3) 고정 수입 — 매달 같은 금액이 들어오는 건을 등록해 두고 자동으로 잡는다 */}
            <LedgerFixedIncomePanel
                selectedYm={ledger.selectedYm}
                fixedIncomes={ledger.fixedIncomes}
                monthIncomes={ledger.monthIncomes}
                onAddFixedIncome={ledger.handleAddFixedIncome}
                onUpdateFixedIncome={ledger.handleUpdateFixedIncome}
                onRemoveFixedIncome={ledger.handleRemoveFixedIncome}
            />

            {/* 4) 고정비 · 할부 — 등록과 이번 달 청구 현황 */}
            <LedgerFixedCostPanel
                selectedYm={ledger.selectedYm}
                fixedCosts={ledger.fixedCosts}
                charges={ledger.charges}
                cards={ledger.cards}
                onAddFixedCost={ledger.handleAddFixedCost}
                onUpdateFixedCost={ledger.handleUpdateFixedCost}
                onChangeFixedCostAmount={ledger.handleChangeFixedCostAmount}
                onEndFixedCost={ledger.handleEndFixedCost}
                onResumeFixedCost={ledger.handleResumeFixedCost}
                onRemoveFixedCost={ledger.handleRemoveFixedCost}
            />

            {/* 5) 카드 정산 — 명세서 총액에서 자동 청구분(할부 + 그 카드로 빠지는 고정비)을 걷어낸 실제 사용액 */}
            <LedgerCardPanel
                selectedYm={ledger.selectedYm}
                cardStatements={ledger.cardStatements}
                onAddCard={ledger.handleAddCard}
                onRemoveCard={ledger.handleRemoveCard}
                onChangeStatement={ledger.handleChangeStatement}
            />

            {/* 6) 입출금 입력/수정 폼 — 날짜 / 구분 / 분류 / 내용 / 금액 */}
            <form
                className={editingId === null
                    ? 'ledger_form ledger_form_entry'
                    : 'ledger_form ledger_form_entry ledger_form_editing'}
                onSubmit={handleSubmit}
            >
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
                    title={submittable
                        ? (editingId === null ? '항목을 추가합니다' : '수정 내용을 저장합니다')
                        : '금액을 입력하세요'}
                >
                    {editingId === null ? '추가' : '수정 저장'}
                </button>

                {/* 6-1) 수정 중에만 노출 — 폼을 신규 입력 상태로 되돌린다 */}
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

            {/* 7) 본문 — 좌측 항목 목록 / 우측 분류별 지출 */}
            <div className={'ledger_body'}>
                <section className={'ledger_list'}>
                    {ledger.monthEntries.length === 0 ? (
                        <p className={'ledger_empty'}>이 달에는 기록이 없습니다. 위에서 첫 항목을 넣어 보세요.</p>
                    ) : (
                        ledger.monthEntries.map((entry) => (
                            <div
                                key={entry.id}
                                className={entry.id === editingId ? 'ledger_row ledger_row_editing' : 'ledger_row'}
                            >
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
                                    className={'ledger_row_edit'}
                                    onClick={() => handleStartEdit(entry)}
                                    title={'이 항목 수정 — 위 폼에 값이 올라옵니다'}
                                >
                                    ✎
                                </button>
                                <button
                                    type={'button'}
                                    className={'ledger_row_remove'}
                                    onClick={() => handleRemove(entry.id)}
                                    title={'이 항목 삭제'}
                                >
                                    ×
                                </button>
                            </div>
                        ))
                    )}
                </section>

                {/* 7-1) 분류별 지출 — 고정비 + 직접 입력한 큰 지출 + 생활비(나머지)로 총지출 전체를 덮는다 */}
                <section className={'ledger_category_panel'}>
                    <h3 className={'ledger_category_title'}>분류별 지출</h3>
                    {ledger.expenseByCategory.length === 0 ? (
                        <p className={'ledger_empty'}>지출 기록이 없습니다.</p>
                    ) : (
                        ledger.expenseByCategory.map((item) => {
                            // 7-2) 생활비는 사람이 적은 값이 아니라 카드 사용액에서 계산된 나머지 — 배지로 구분한다
                            const derived = item.category === LIVING_CATEGORY

                            return (
                                <div key={item.category} className={'ledger_category_row'}>
                                    <div className={'ledger_category_head'}>
                                        <span className={'ledger_category_name'}>
                                            {item.category}
                                            {derived && (
                                                <span
                                                    className={'ledger_category_auto'}
                                                    title={'카드 사용액에서 아래 목록에 적어 둔 큰 지출을 뺀 나머지입니다'}
                                                >
                                                    자동
                                                </span>
                                            )}
                                        </span>
                                        <span className={'ledger_category_amount'}>{formatKrw(item.amount)}원</span>
                                    </div>
                                    <div className={'ledger_category_bar'}>
                                        <div
                                            className={derived
                                                ? 'ledger_category_bar_fill ledger_category_bar_fill_living'
                                                : 'ledger_category_bar_fill'}
                                            style={{ width: `${(item.ratio * 100).toFixed(1)}%` }}
                                        />
                                    </div>
                                    <span className={'ledger_category_ratio'}>{(item.ratio * 100).toFixed(1)}%</span>
                                </div>
                            )
                        })
                    )}
                    <span className={'ledger_section_note'}>
                        큰 지출만 아래에 적으면, 남는 카드 사용액은 생활비로 자동 집계됩니다.
                    </span>
                </section>
            </div>
        </div>
    )
}

export default LedgerView