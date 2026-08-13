import { useState } from 'react'
import './App.css'
import AnalysisView from './components/AnalysisView'
import AppTabBar from './components/AppTabBar'
import ExcelDownloadButton from './components/ExcelDownloadButton'
import FilterPanel from './components/FilterPanel'
import LedgerView from './components/LedgerView'
import SaveButton from './components/SaveButton'
import WorkbookGroup from './components/WorkbookGroup'
import { AppView } from './constants/appViewConstants'
import {
    MONTH_LABELS,
    MONTH_NUMBERS,
    ROW_LABELS,
    RowLabel,
    formatShareCount,
} from './constants/gridConstants'
import { INFLATION_POLICY, resolveConstants } from './constants/simulationDefaults'
import { useLedger } from './hooks/useLedger'
import { useMarketInfo } from './hooks/useMarketInfo'
import { useWorkbooks } from './hooks/useWorkbooks'
import { toYm } from './services/simulationEngine'
import type {
    MonthlyResult,
    SimulationConstants,
    SimulationResult,
    WorkbookYearSummary,
} from './types/simulation'
import { formatKrw, formatYmLabel, toAgeInYear } from './utils/format'

// ┣━━━━━━━━━━━━━━━━ Constants ━━━━━━━━━━━━━━━━━━┫

/** 등락 방향 — 카드 하단 문구 색상 결정 */
const TrendTone = {
    UP: 'up',
    DOWN: 'down',
    FLAT: 'flat',
} as const

type TrendTone = (typeof TrendTone)[keyof typeof TrendTone]

// ┣━━━━━━━━━━━━━━━━ Formatters ━━━━━━━━━━━━━━━━━┫

/** 소수 2자리 + 천단위 구분자 포맷 */
function formatNumber(value: number): string {
    return value.toLocaleString('ko-KR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/** MM/DD/YYYY → YYYY-MM-DD 변환 (Nasdaq 배당락일 형식 대응) */
function formatUsDate(value: string): string {
    const parts = value.split('/')
    if (parts.length !== 3) return value
    return `${parts[2]}-${parts[0]}-${parts[1]}`
}

/** UTC 문자열 → 한국시간 "MM/DD HH:mm" 변환 (환율 갱신 시각 표기용) */
function formatUpdatedAt(value: string): string {
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return value
    return date.toLocaleString('ko-KR', {
        month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
    })
}

/** 항목별 셀 표시값 — 원 단위 정수 + 천단위 콤마 (축약 없음) */
function toCellText(rowLabel: RowLabel, monthly: MonthlyResult): string {
    if (rowLabel === RowLabel.CUMULATIVE) return formatKrw(monthly.cumulativePurchase)
    if (rowLabel === RowLabel.BALANCE) return formatKrw(monthly.balance)
    if (rowLabel === RowLabel.DIVIDEND_REAL) return formatKrw(monthly.dividendReal)
    return formatKrw(monthly.dividendNet)
}

/** 배당금 셀 클래스 — 과세 여부와 인출(재투자 안 함) 여부를 색으로 구분 */
function toValueClassName(rowLabel: RowLabel, monthly: MonthlyResult): string {
    // 실질가치 행은 참고 지표라 한 톤 낮춰 표기하되, 인출한 달은 명목 행과 동일하게 흐리게 처리한다
    if (rowLabel === RowLabel.DIVIDEND_REAL) {
        return monthly.reinvested
            ? 'grid_cell_value grid_cell_value_real'
            : 'grid_cell_value grid_cell_value_real grid_cell_value_withdrawn'
    }
    if (rowLabel !== RowLabel.DIVIDEND) return 'grid_cell_value'
    if (!monthly.reinvested) return 'grid_cell_value grid_cell_value_withdrawn'
    return monthly.taxed ? 'grid_cell_value grid_cell_value_taxed' : 'grid_cell_value'
}

/** 구매력 비율 — 명목 대비 실질 금액이 몇 %인지 (명목이 0이면 100%로 본다) */
function toPurchasingPowerPercent(monthly: MonthlyResult): string {
    if (monthly.dividendNet <= 0) return '100.0'
    return ((monthly.dividendReal / monthly.dividendNet) * 100).toFixed(1)
}

/** 항목별 셀 툴팁 — 정확한 원 단위 값과 산출 근거 */
function toCellTitle(rowLabel: RowLabel, monthly: MonthlyResult): string {
    const head = `${formatYmLabel(monthly.ym)}`
    if (rowLabel === RowLabel.DIVIDEND_REAL) {
        return `${head} 세후 배당 ${formatKrw(monthly.dividendNet)}원은`
            + ` ${INFLATION_POLICY.BASE_YEAR}년 화폐가치로 약 ${formatKrw(monthly.dividendReal)}원`
            + ` (물가상승률 연 ${INFLATION_POLICY.RATE_PERCENT}% 복리 할인 · 구매력 ${toPurchasingPowerPercent(monthly)}%)`
    }
    if (rowLabel === RowLabel.CUMULATIVE) {
        return `${head} 누적 매수금액 ${formatKrw(monthly.cumulativePurchase)}원 · 보유 ${formatShareCount(monthly.shares)}`
            + ` (이번 달 매수 ${formatKrw(monthly.purchaseAmount)}원 · 투입 ${formatKrw(monthly.contribution)}원)`
    }
    if (rowLabel === RowLabel.BALANCE) {
        // 가용현금 = 매수에 쓴 금액 + 남은 잔액 (이월 잔액 + 투입금 + 재투자한 배당)
        const cash = monthly.purchaseAmount + monthly.balance
        return `${head} 가용현금 ${formatKrw(cash)}원 중 ${formatKrw(monthly.purchaseAmount)}원어치 매수 →`
            + ` 1주를 더 사기엔 모자란 ${formatKrw(monthly.balance)}원이 남아 다음 달로 이월`
    }
    const flow = monthly.reinvested ? '전액 재투자' : '인출 (재투자 안 함)'
    return `${head} 세전 ${formatKrw(monthly.dividendGross)}원 · 세금 ${formatKrw(monthly.dividendTax)}원 · 세후 ${formatKrw(monthly.dividendNet)}원 · ${flow}`
}

// ┣━━━━━━━━━━━━━━━━ Components ━━━━━━━━━━━━━━━━━┫

interface InfoCardProps {
    label: string
    value: string
    unit: string
    trend: string
    accent: string
    tone: TrendTone
    loading: boolean
    error: string | null
}

/** 상단 정보 카드 — JEPQ 금액 / 배당률 / 환율 공통 카드 */
function InfoCard(props: InfoCardProps) {
    return (
        <div className={`info_card info_card_${props.accent}`}>
            <span className={'info_card_label'}>{props.label}</span>

            {/* 1) 로딩 중에는 스켈레톤, 완료 후 값 노출 */}
            <div className={'info_card_value_row'}>
                {props.loading ? (
                    <span className={'info_card_skeleton'} />
                ) : (
                    <>
                        <strong className={'info_card_value'}>{props.value}</strong>
                        <span className={'info_card_unit'}>{props.unit}</span>
                    </>
                )}
            </div>

            {/* 2) 조회 실패 시 에러 메시지, 성공 시 보조 문구 */}
            {props.error ? (
                <span className={'info_card_trend info_card_trend_error'}>{props.error}</span>
            ) : (
                <span className={`info_card_trend info_card_trend_${props.tone}`}>
                    {props.loading ? '불러오는 중…' : props.trend}
                </span>
            )}
        </div>
    )
}

interface YearBlockProps {
    year: number
    /** 시트 주인의 생년월 — 'YYYY-MM', 빈 문자열이면 나이를 표기하지 않는다 */
    birthYm: string
    result: SimulationResult
    /** 워크북(엑셀 파일) 합산 연간 요약 — 과세 판정 근거 표기용 */
    workbookSummary: WorkbookYearSummary | undefined
}

/** 연도 단위 그리드 블록 — 가로 13칸 × 세로 5칸 */
function YearBlock(props: YearBlockProps) {

    // ┣━━━━━━━━━━━━━━━━ Derived ━━━━━━━━━━━━━━━━━━━━┫
    // 1) 그 해 과세 여부 — 워크북 합산 기준으로 판정된 값. 과세 연도는 블록 전체를 주황 톤으로 전환한다
    const summary = props.result.byYear[props.year]
    const taxed = summary?.taxed ?? false

    // 2) 그 해 나이 — 생년월 미지정이면 null
    const age = toAgeInYear(props.birthYm, props.year)

    // 3) 과세 배지 툴팁 — 이 시트 단독 배당과 워크북 합산 배당을 함께 보여준다
    const badgeTitle = props.workbookSummary
        ? `파일 합산 연 배당 ${formatKrw(props.workbookSummary.dividendGross)}원 · 합산 원천징수 ${formatKrw(props.workbookSummary.dividendTax)}원`
            + ` / 이 시트 ${formatKrw(summary?.dividendGross ?? 0)}원 · 원천징수 ${formatKrw(summary?.dividendTax ?? 0)}원`
        : ''

    return (
        <section className={taxed ? 'year_block year_block_taxed' : 'year_block'}>
            {/* 1) 0행 — 0.0 연도 + 0.1~0.12 월 헤더 */}
            <div className={'grid_row grid_row_head'}>
                <div className={'grid_cell grid_cell_year'}>
                    <span>{props.year}</span>
                    {/* 생년월을 넣었으면 그 해 나이를 함께 표기 — 시뮬레이션 개시 연도와 무관하게 계산 */}
                    {age !== null && (
                        <span className={'year_age'} title={`${formatYmLabel(props.birthYm)}생`}>
                            ({age}세)
                        </span>
                    )}
                    {taxed && (
                        <span className={'year_tax_badge'} title={badgeTitle}>과세</span>
                    )}
                </div>
                {MONTH_LABELS.map((month) => (
                    <div key={month} className={'grid_cell grid_cell_month'}>{month}</div>
                ))}
            </div>

            {/* 2) 1~4행 — 항목 라벨 + 월별 데이터 셀 */}
            {ROW_LABELS.map((rowLabel) => (
                <div key={rowLabel} className={'grid_row'}>
                    <div className={'grid_cell grid_cell_label'}>{rowLabel}</div>
                    {MONTH_NUMBERS.map((month) => {
                        // 2-1) 해당 월 결과 조회 — 개시 이전이면 '-' 처리
                        const monthly = props.result.byYm[toYm(props.year, month)]
                        const isActive = monthly?.active ?? false

                        return (
                            <div
                                key={`${rowLabel}_${month}`}
                                className={'grid_cell grid_cell_data'}
                                title={isActive ? toCellTitle(rowLabel, monthly) : undefined}
                            >
                                {isActive ? (
                                    <div className={'grid_cell_body'}>
                                        <span className={toValueClassName(rowLabel, monthly)}>
                                            {toCellText(rowLabel, monthly)}
                                            {/* 재투자하지 않고 인출한 달의 배당금 — X 배지 */}
                                            {rowLabel === RowLabel.DIVIDEND && !monthly.reinvested && (
                                                <span className={'grid_cell_withdraw_mark'}>X</span>
                                            )}
                                        </span>
                                        {/* 누적 매수금액 칸에는 그 시점 보유주를 함께 표기 */}
                                        {rowLabel === RowLabel.CUMULATIVE && (
                                            <span className={'grid_cell_shares'}>
                                                {formatShareCount(monthly.shares)}
                                            </span>
                                        )}
                                    </div>
                                ) : (
                                    <span className={'grid_cell_empty'}>-</span>
                                )}
                            </div>
                        )
                    })}
                </div>
            ))}
        </section>
    )
}

function App() {

    // ┣━━━━━━━━━━━━━━━━ States ━━━━━━━━━━━━━━━━━━━━━┫
    const [view, setView] = useState<AppView>(AppView.COVERED_CALL)   // 최상위 화면 — 진입 시 1페이지(계산기)

    // ┣━━━━━━━━━━━━━━━━ CustomHooks ━━━━━━━━━━━━━━━━┫
    // 시세·워크북 훅은 화면 전환과 무관하게 항상 살려 둔다.
    // 가계부로 갔다 오는 사이 언마운트되면 저장하지 않은 편집 내용이 통째로 날아가기 때문이다.
    const { quote, dividend, rate, dividendYield } = useMarketInfo()

    // 가계부 상태도 여기서 한 번만 만든다 — 2페이지(가계부)와 3페이지(분석)가 같은 데이터를 봐야 하고,
    // 탭을 오갈 때마다 훅이 다시 살아나면 localStorage 를 매번 되읽는 낭비가 생긴다.
    const ledger = useLedger()

    // ┣━━━━━━━━━━━━━━━━ Derived ━━━━━━━━━━━━━━━━━━━━┫
    // 1) 시세 등락 방향 판정 — 상승/하락/보합
    const quoteTone: TrendTone = !quote.data || quote.data.changeAmount === 0
        ? TrendTone.FLAT
        : quote.data.changeAmount > 0 ? TrendTone.UP : TrendTone.DOWN

    // 2) 시세 3종(주가·월배당·환율)이 모두 도착했는지 — 하나라도 없으면 폴백 값으로 계산
    const usingFallback = quote.data === null || dividend.data === null || rate.data === null

    // 3) 시뮬레이션 상수 — 시세 3종은 상단 카드 값을 그대로 쓰고, 세금 정책은 고정값으로 조립
    const constants: SimulationConstants = resolveConstants(
        quote.data?.price ?? null,
        dividend.data?.latestDividend ?? null,
        rate.data?.krwPerUsd ?? null,
    )

    // ┣━━━━━━━━━━━━━━━━ CustomHooks(2) ━━━━━━━━━━━━━━┫
    // 상수가 확정된 뒤에 워크북을 계산해야 하므로 파생값 아래에서 호출한다.
    // 그리드에 그릴 연도 목록(workbook.years)도 훅이 선택된 파일의 대상 기간에서 파생시켜 함께 돌려준다.
    const workbook = useWorkbooks(constants)

    // ┣━━━━━━━━━━━━━━━━ Handlers ━━━━━━━━━━━━━━━━━━━┫

    /** 탭 이동 — @param next 이동할 화면 (1 계산기 · 2 가계부 · 3 분석) */
    const handleSelectView = (next: AppView) => {
        setView(next)
    }

    return (
        <div className={'app_root'}>
            {/* 0-1) 상단 탭 바 — 화면 상단 중앙 고정 */}
            <AppTabBar view={view} onSelect={handleSelectView} />

            {/* 0-2) 플로팅 저장 버튼 — 화면 우측 상단 고정. 스크롤과 무관하게 항상 떠 있다.
                    가계부·분석 화면에서도 남겨 둬야 적립 계산기의 미저장 변경을 놓치지 않는다 */}
            <SaveButton
                workbooks={workbook.workbooks}
                activeTabId={workbook.activeTabId}
                persisted={workbook.persisted}
                hydrating={workbook.hydrating}
                onPersisted={workbook.handleMarkPersisted}
            />

            {/* 0-3) 2페이지 가계부 — 적립 계산기와 완전히 별개의 데이터를 다룬다 */}
            {view === AppView.LEDGER && <LedgerView ledger={ledger} />}

            {/* 0-4) 3페이지 분석 — 차트를 걷어낸 빈 화면. 탭 전환만 되고 내용은 아직 없다 */}
            {view === AppView.ANALYSIS && <AnalysisView />}

            {/* 0-5) 1페이지 적립 계산기 — 아래 1)~4) 블록이 한 덩어리다 */}
            {view === AppView.COVERED_CALL && (
                <>
                {/* 1) 상단 요약 정보 — JEPQ 오늘 금액 / 배당률 / 오늘 환율 */}
                <div className={'top_info'}>
                    <InfoCard
                        label={'JEPQ 오늘 금액'}
                        value={quote.data ? formatNumber(quote.data.price) : '-'}
                        unit={'USD'}
                        trend={quote.data
                            ? `전일 ${formatNumber(quote.data.previousClose)} · ${quote.data.changeAmount >= 0 ? '+' : ''}${formatNumber(quote.data.changeAmount)} (${quote.data.changeRate >= 0 ? '+' : ''}${quote.data.changeRate.toFixed(2)}%)`
                            : '-'}
                        accent={'blue'}
                        tone={quoteTone}
                        loading={quote.loading}
                        error={quote.error}
                    />
                    <InfoCard
                        label={'JEPQ 배당률'}
                        value={dividendYield.data !== null ? formatNumber(dividendYield.data) : '-'}
                        unit={'%'}
                        trend={dividend.data
                            ? `최근 ${dividend.data.paymentCount}회 배당 $${formatNumber(dividend.data.ttmDividend)} · 배당락 ${formatUsDate(dividend.data.exDividendDate)}`
                            : '-'}
                        accent={'green'}
                        tone={TrendTone.FLAT}
                        loading={dividendYield.loading}
                        error={dividendYield.error}
                    />
                    <InfoCard
                        label={'월 배당금(주당)'}
                        value={dividend.data ? dividend.data.latestDividend.toFixed(5) : '-ㅓ디'}
                        unit={'USD'}
                        trend={dividend.data
                            ? `${formatKrw(dividend.data.latestDividend * constants.exchangeRate)}원 · 최근 1회 지급액 기준`
                            : '-'}
                        accent={'violet'}
                        tone={TrendTone.FLAT}
                        loading={dividend.loading}
                        error={dividend.error}
                    />
                    <InfoCard
                        label={'오늘 환율'}
                        value={rate.data ? formatNumber(rate.data.krwPerUsd) : '-'}
                        unit={'KRW/USD'}
                        trend={rate.data ? `매매기준율 · ${formatUpdatedAt(rate.data.updatedAt)} 갱신` : '-'}
                        accent={'amber'}
                        tone={TrendTone.FLAT}
                        loading={rate.loading}
                        error={rate.error}
                    />
                </div>

                {/* 2) 시뮬레이션 필터 — 선택된 탭의 고정 상수 + 투입 이벤트 편집 (변경 시 아래 그리드 자동 재계산) */}
                <FilterPanel
                    constants={constants}
                    events={workbook.events}
                    firstTaxedYear={workbook.result.firstTaxedYear}
                    usingFallback={usingFallback}
                    workbookName={workbook.activeWorkbook.name}
                    startYear={workbook.startYear}
                    endYear={workbook.endYear}
                    years={workbook.years}
                    onStartYearChange={workbook.handleStartYearChange}
                    onEndYearChange={workbook.handleEndYearChange}
                    birthYm={workbook.birthYm}
                    onBirthYmChange={workbook.handleBirthYmChange}
                    onEventAdd={workbook.handleEventAdd}
                    onEventChange={workbook.handleEventChange}
                    onEventRemove={workbook.handleEventRemove}
                />

                {/* 3) 그리드 툴바 — 좌측 파일 그룹(그룹 1개 = 엑셀 파일 1개) / 우측 전체 다운로드 */}
                <div className={'grid_toolbar'}>
                    <div className={'workbook_group_list'}>
                        {workbook.workbooks.map((item) => (
                            <WorkbookGroup
                                key={item.id}
                                workbook={item}
                                constants={constants}
                                activeTabId={workbook.activeTabId}
                                editingTabId={workbook.editingTabId}
                                editingWorkbookId={workbook.editingWorkbookId}
                                removable={workbook.workbooks.length > 1}
                                onSelectTab={workbook.handleSelectTab}
                                onAddTab={workbook.handleAddTab}
                                onRemoveTab={workbook.handleRemoveTab}
                                onStartRenameTab={workbook.handleStartRenameTab}
                                onCommitRenameTab={workbook.handleCommitRenameTab}
                                onCancelRename={workbook.handleCancelRename}
                                onStartRenameWorkbook={workbook.handleStartRenameWorkbook}
                                onCommitRenameWorkbook={workbook.handleCommitRenameWorkbook}
                                onRemoveWorkbook={workbook.handleRemoveWorkbook}
                                onDuplicateWorkbook={workbook.handleDuplicateWorkbook}
                                onMoveWorkbook={workbook.handleMoveWorkbook}
                                onMoveTab={workbook.handleMoveTab}
                            />
                        ))}

                        {/* 3-1) 새 파일(그룹) 추가 */}
                        <button
                            type={'button'}
                            className={'workbook_add'}
                            onClick={workbook.handleAddWorkbook}
                            title={'엑셀 파일 추가'}
                        >
                            +
                        </button>
                    </div>

                    <ExcelDownloadButton workbooks={workbook.workbooks} constants={constants} />
                </div>

                {/* 4) 연도별 적립 그리드 — 선택된 파일의 대상 기간 (선택된 탭 기준) */}
                <div className={'bt_grid'}>
                    {workbook.years.map((year) => (
                        <YearBlock
                            key={year}
                            year={year}
                            birthYm={workbook.birthYm}
                            result={workbook.result}
                            workbookSummary={workbook.workbookResult.byYear[year]}
                        />
                    ))}
                </div>
                </>
            )}
        </div>
    )
}

export default App
