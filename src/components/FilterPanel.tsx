import {
    EVENT_TYPE_LABEL,
    EventType,
    type InvestEvent,
    type SimulationConstants,
} from '../types/simulation'
import { SELECTABLE_YEARS } from '../constants/gridConstants'
import { calcRecurringBase, calcStopCapacity } from '../services/simulationEngine'
import { formatKrw, toAgeInYear } from '../utils/format'
import ReinvestSection from './ReinvestSection'
import YearMonthPicker from './YearMonthPicker'

// ┣━━━━━━━━━━━━━━━━ Constants ━━━━━━━━━━━━━━━━━━┫

/** 생년월 선택 가능 하한 연도 */
const BIRTH_MIN_YEAR = 1940

/**
 * 생년월 선택용 연도 목록 — 1940년부터 대상 기간 시작 연도까지 (최신 연도가 위로 오게 내림차순)
 * @param startYear 대상 기간 시작 연도
 */
function buildBirthYears(startYear: number): number[] {
    const length = Math.max(1, startYear - BIRTH_MIN_YEAR + 1)
    return Array.from({ length }, (_, index) => startYear - index)
}

/**
 * 선택 가능한 이벤트 타입 순서
 * 재투자 구간(REINVEST)은 투입 이벤트가 아니라 배당 처리 규칙이므로 아래 전용 섹션에서 따로 관리한다.
 */
const EVENT_TYPE_OPTIONS: EventType[] = [
    EventType.INITIAL,
    EventType.RECURRING,
    EventType.ONE_TIME,
    EventType.CHANGE,
    EventType.RECURRING_STOP,
]

/** 종료 연월(구간)을 쓰는 타입 — 나머지는 단일 시점 이벤트라 종료 연월이 무의미하다 */
function usesEndYm(type: EventType): boolean {
    return type === EventType.RECURRING || type === EventType.RECURRING_STOP
}

// ┣━━━━━━━━━━━━━━━━ Components ━━━━━━━━━━━━━━━━━┫

interface EventRowProps {
    event: InvestEvent
    /** 같은 시트의 전체 이벤트 — 정기매수 중단 행의 감액 상한을 계산하는 데 필요하다 */
    allEvents: InvestEvent[]
    /** 선택 가능한 연도 목록 — 파일의 대상 기간 */
    years: number[]
    onChange: (id: string, patch: Partial<InvestEvent>) => void
    onRemove: (id: string) => void
}

/** 이벤트 리스트 1행 — 타입에 따라 필요한 입력만 활성화한다 */
function EventRow(props: EventRowProps) {

    // ┣━━━━━━━━━━━━━━━━ Derived ━━━━━━━━━━━━━━━━━━━━┫
    // 1) 타입별 입력 가능 필드 판정 (재투자 구간은 전용 섹션에서 다루므로 여기 오지 않는다)
    const isInitial = props.event.type === EventType.INITIAL
    const isStop = props.event.type === EventType.RECURRING_STOP
    const hasEndYm = usesEndYm(props.event.type)

    // 2) 정기매수 중단 행의 감액 상한 — 시작 연월 시점의 정기 매수 총액에서 다른 중단분을 뺀 잔여
    //    예) 정기 매수 20만 + 40만이면 이 행에는 최대 60만까지만 적을 수 있다.
    const stopCapacity = isStop
        ? calcStopCapacity(props.allEvents, props.event.startYm, props.event.id)
        : 0

    // 3) 시작 연월 시점의 감액 전 정기 매수액 — 안내 문구에 "현재 정기 N원" 으로 표기
    const recurringBase = isStop ? calcRecurringBase(props.allEvents, props.event.startYm) : 0

    // ┣━━━━━━━━━━━━━━━━ Handlers ━━━━━━━━━━━━━━━━━━━┫

    /**
     * 정기매수 중단 금액을 상한(그 시점 정기 매수 잔여분) 안으로 자른다
     * @param amount 자를 금액 @param ym 상한 판정 기준 연월
     */
    const clampStopAmount = (amount: number, ym: string): number => {
        const capacity = calcStopCapacity(props.allEvents, ym, props.event.id)
        return Math.min(Math.max(0, amount), capacity)
    }

    /** 이벤트 타입 변경 — @param value 선택된 타입 값 */
    const handleTypeChange = (value: string) => {
        // 1) 구간 타입이 아니면 종료 연월은 의미가 없으므로 비운다.
        const nextType = value as EventType
        // 2) 중단 타입으로 바뀌면 기존 금액이 상한을 넘을 수 있어 즉시 잘라 넣는다.
        const nextAmount = nextType === EventType.RECURRING_STOP
            ? clampStopAmount(props.event.amount, props.event.startYm)
            : props.event.amount

        props.onChange(props.event.id, {
            type: nextType,
            endYm: usesEndYm(nextType) ? props.event.endYm : '',
            amount: nextAmount,
            includesRecurring: nextType === EventType.INITIAL ? props.event.includesRecurring : false,
        })
    }

    /** 연월 변경 — @param key 대상 필드 @param value 'YYYY-MM' 문자열 */
    const handleYmChange = (key: 'startYm' | 'endYm', value: string) => {
        // 시작 연월이 바뀌면 그 시점의 정기 매수액이 달라져 상한도 함께 바뀐다 — 초과분을 다시 잘라 준다.
        if (isStop && key === 'startYm') {
            props.onChange(props.event.id, {
                startYm: value,
                amount: clampStopAmount(props.event.amount, value),
            })
            return
        }
        props.onChange(props.event.id, { [key]: value })
    }

    /** 금액 변경 — @param value 입력된 원 단위 문자열 */
    const handleAmountChange = (value: string) => {
        const nextAmount = Number(value) || 0
        props.onChange(props.event.id, {
            amount: isStop ? clampStopAmount(nextAmount, props.event.startYm) : nextAmount,
        })
    }

    /** 정기분 포함 여부 토글 — @param checked 체크 상태 */
    const handleIncludesRecurringChange = (checked: boolean) => {
        props.onChange(props.event.id, { includesRecurring: checked })
    }

    /** 이벤트 삭제 */
    const handleRemove = () => {
        props.onRemove(props.event.id)
    }

    return (
        <div className={'event_row'}>
            {/* 1) 타입 선택 */}
            <select
                className={'event_field event_field_type'}
                value={props.event.type}
                onChange={(e) => handleTypeChange(e.target.value)}
            >
                {EVENT_TYPE_OPTIONS.map((type) => (
                    <option key={type} value={type}>{EVENT_TYPE_LABEL[type]}</option>
                ))}
            </select>

            {/* 2) 시작(해당) 연월 */}
            <YearMonthPicker
                value={props.event.startYm}
                onChange={(value) => handleYmChange('startYm', value)}
            />

            {/* 3) 종료 연월 — 구간 타입(정기 매수 / 정기매수 중단)에서만 사용, 미지정이면 "계속" */}
            <YearMonthPicker
                value={props.event.endYm}
                emptyLabel={'계속'}
                disabled={!hasEndYm}
                onChange={(value) => handleYmChange('endYm', value)}
            />

            {/* 4) 금액 — 정기매수 중단이면 "깎을 금액"이며 그 시점 정기 매수액이 상한이 된다 */}
            <div className={'event_field_amount'}>
                <input
                    className={'event_field event_field_number'}
                    type={'number'}
                    step={10000}
                    min={0}
                    max={isStop ? stopCapacity : undefined}
                    value={props.event.amount}
                    onChange={(e) => handleAmountChange(e.target.value)}
                />
                {isStop ? (
                    <span className={'event_hint event_hint_stop'}>
                        {recurringBase > 0
                            ? `−${formatKrw(props.event.amount)}원 · 최대 ${formatKrw(stopCapacity)}원 (정기 ${formatKrw(recurringBase)}원)`
                            : '이 시점에 정기 매수가 없습니다'}
                    </span>
                ) : (
                    <span className={'event_hint'}>{formatKrw(props.event.amount)}원</span>
                )}
            </div>

            {/* 5) 초기 일시금 전용 옵션 — 일시금에 그 달 정기분이 포함되어 중복 가산을 막을지 */}
            <label className={`event_check ${isInitial ? '' : 'event_check_off'}`}>
                <input
                    type={'checkbox'}
                    checked={props.event.includesRecurring}
                    disabled={!isInitial}
                    onChange={(e) => handleIncludesRecurringChange(e.target.checked)}
                />
                <span>정기분 포함</span>
            </label>

            {/* 6) 삭제 */}
            <button className={'event_remove'} type={'button'} onClick={handleRemove}>✕</button>
        </div>
    )
}

interface FilterPanelProps {
    /** 상단 실시간 시세 + 고정 세금 정책으로 조립된 상수 (이 패널에서는 읽기 전용) */
    constants: SimulationConstants
    events: InvestEvent[]
    /** 과세가 처음 적용되는 연도 — 없으면 null */
    firstTaxedYear: number | null
    /** 시세 조회 실패/대기로 폴백 값을 쓰는 중인지 */
    usingFallback: boolean
    /** 선택된 파일(워크북) 이름 — 기간이 파일 단위 설정임을 안내 문구로 알리는 용도 */
    workbookName: string
    /** 선택된 파일(워크북)의 대상 기간 시작 연도 */
    startYear: number
    /** 선택된 파일(워크북)의 대상 기간 종료 연도 */
    endYear: number
    /** 대상 기간 연도 목록 — 이벤트 연월 선택기의 선택지로 내려간다 */
    years: number[]
    onStartYearChange: (year: number) => void
    onEndYearChange: (year: number) => void
    /** 선택된 시트 주인의 생년월 — 'YYYY-MM', 빈 문자열이면 미지정 */
    birthYm: string
    onBirthYmChange: (value: string) => void
    /** @param patch 신규 이벤트에 덮어쓸 초기값 (재투자 구간 추가에 사용) */
    onEventAdd: (patch?: Partial<InvestEvent>) => void
    onEventChange: (id: string, patch: Partial<InvestEvent>) => void
    onEventRemove: (id: string) => void
}

/** top_info 와 bt_grid 사이 필터 — 투입 이벤트 리스트를 편집한다 (시세·세금 조건은 읽기 전용 표기) */
function FilterPanel(props: FilterPanelProps) {

    // ┣━━━━━━━━━━━━━━━━ Derived ━━━━━━━━━━━━━━━━━━━━┫
    // 1) 주가 × 환율 = 1주당 원화 매수단가 (요약 문구용)
    const sharePriceKrw = props.constants.sharePriceUsd * props.constants.exchangeRate

    // 2) 주당 월 배당의 원화 환산액
    const monthlyDividendKrw = props.constants.monthlyDividendUsd * props.constants.exchangeRate

    // 3) 투입 이벤트와 재투자 구간은 성격이 달라 목록을 분리해 보여준다
    const investEvents = props.events.filter((event) => event.type !== EventType.REINVEST)
    const reinvestRules = props.events.filter((event) => event.type === EventType.REINVEST)

    // 4) 이벤트 유무 — 비어 있으면 컬럼 헤더를 숨기고 추가 버튼만 남긴다
    const hasEvents = investEvents.length > 0

    // 5) 대상 기간 시작 연도 기준 나이 — 생년월을 넣었을 때만 안내 문구로 보여준다
    const startAge = toAgeInYear(props.birthYm, props.startYear)

    // 6) 생년월 선택지 — 대상 기간 시작 연도까지만 고를 수 있게 한다
    const birthYears = buildBirthYears(props.startYear)

    // 7) 대상 기간 길이 — 기간 설정 옆에 "N년간"으로 표기
    const yearSpan = props.endYear - props.startYear + 1

    return (
        <section className={'sim_filter'}>
            {/* 1) 헤더 — 제목 + 고정 세금 정책 메타 배지 */}
            <div className={'sim_filter_head'}>
                <h2 className={'sim_filter_title'}>시뮬레이션 조건</h2>
                <div className={'sim_meta'}>
                    <span className={'sim_meta_item'}>
                        <span className={'sim_meta_key'}>과세 기준</span>
                        <span className={'sim_meta_value'}>{formatKrw(props.constants.taxThresholdKrw)}원 / 년</span>
                    </span>
                    <span className={'sim_meta_item'}>
                        <span className={'sim_meta_key'}>원천징수</span>
                        <span className={'sim_meta_value'}>{props.constants.taxRatePercent}%</span>
                    </span>
                    <span className={'sim_meta_item sim_meta_item_source'} title={'주가·월배당·환율은 상단 카드의 실시간 조회값을 그대로 사용합니다'}>
                        <span className={'sim_meta_key'}>시세</span>
                        <span className={'sim_meta_value'}>{props.usingFallback ? '기준값(2026-08-10)' : '상단 실시간'}</span>
                    </span>
                </div>
            </div>

            {/* 2) 조건 요약 — 상단 시세로 환산한 단가 / 과세 시작 연도 */}
            <div className={'sim_summary'}>
                <span>1주 매수단가 <strong>{formatKrw(sharePriceKrw)}원</strong></span>
                <span>주당 월배당 <strong>{formatKrw(monthlyDividendKrw)}원</strong></span>
                <span title={'같은 엑셀 파일(워크북) 안의 모든 시트 배당을 합산해 판정합니다'}>
                    과세 시작(파일 합산)
                    <strong>
                        {props.firstTaxedYear !== null ? ` ${props.firstTaxedYear}년부터` : ' 해당 없음'}
                    </strong>
                </span>
            </div>

            {/* 3) 대상 기간 — 파일(엑셀 파일 1개) 단위 설정. 이 파일의 모든 시트가 같은 기간을 쓴다 */}
            <div className={'range_field'}>
                <span className={'range_label'}>대상 기간</span>
                <div className={'range_picker'}>
                    <select
                        className={'event_field range_select'}
                        value={props.startYear}
                        onChange={(e) => props.onStartYearChange(Number(e.target.value))}
                    >
                        {SELECTABLE_YEARS.map((year) => (
                            <option key={year} value={year}>{year}년</option>
                        ))}
                    </select>

                    <span className={'range_tilde'}>~</span>

                    <select
                        className={'event_field range_select'}
                        value={props.endYear}
                        onChange={(e) => props.onEndYearChange(Number(e.target.value))}
                    >
                        {SELECTABLE_YEARS.map((year) => (
                            <option key={year} value={year}>{year}년</option>
                        ))}
                    </select>

                    <span className={'range_span'}>{yearSpan}년간</span>
                </div>
                <span className={'range_hint'}>
                    이 파일(<b>{props.workbookName}</b>)의 모든 시트에 함께 적용됩니다 · 과세 판정이 파일 합산 기준이라 시트별로 나눌 수 없습니다
                </span>
            </div>

            {/* 4) 생년월 — 연도 헤더에 나이를 함께 표기하기 위한 값 (시트별로 따로 지정) */}
            <div className={'birth_field'}>
                <span className={'birth_label'}>생년월</span>
                <YearMonthPicker
                    value={props.birthYm}
                    emptyLabel={'미지정'}
                    years={birthYears}
                    onChange={props.onBirthYmChange}
                />
                <span className={'birth_hint'}>
                    {startAge !== null
                        ? `${props.startYear}년에 만 ${startAge}세 — 연도 헤더에 나이가 함께 표시됩니다`
                        : '입력하면 연도 헤더에 "2026 (33세)"처럼 나이가 함께 표시됩니다'}
                </span>
            </div>

            {/* 4) 이벤트 리스트 — 빈 탭에서는 컬럼 헤더 없이 추가 버튼만 노출 */}
            <div className={'sim_events'}>
                {hasEvents && (
                    <div className={'event_row event_row_head'}>
                        <span>타입</span>
                        <span>시작(해당) 연월</span>
                        <span>종료 연월</span>
                        <span>금액(원)</span>
                        <span>옵션</span>
                        <span />
                    </div>
                )}

                {investEvents.map((event) => (
                    <EventRow
                        key={event.id}
                        event={event}
                        allEvents={props.events}
                        years={props.years}
                        onChange={props.onEventChange}
                        onRemove={props.onEventRemove}
                    />
                ))}

                <button
                    className={hasEvents ? 'event_add' : 'event_add event_add_empty'}
                    type={'button'}
                    onClick={() => props.onEventAdd()}
                >
                    + 이벤트 추가
                </button>
            </div>

            {/* 5) 배당 재투자 구간 — 기간별 재투자 O / X 설정 */}
            <ReinvestSection
                rules={reinvestRules}
                years={props.years}
                onAdd={props.onEventAdd}
                onChange={props.onEventChange}
                onRemove={props.onEventRemove}
            />

            {/* 6) 계산 규칙 안내 */}
            <p className={'sim_filter_note'}>
                <b>정기매수 중단</b>은 그 기간 동안 월 정기 매수액에서 적은 금액만큼 빼고 투입합니다
                (정기 매수가 20만·40만이면 최대 60만까지 · 60만을 적으면 그 기간 정기 매수 전면 중단) ·
                배당은 전월 말 보유 주식 기준으로 매달 지급되어 <b>그 달에 즉시 재투자</b>합니다
                (위 <b>배당 재투자 구간</b>에서 "재투자 X"로 지정한 기간은 <b>인출</b>되어 매수·잔액에 반영되지 않음) ·
                <b>1주 단위</b>로 살 수 있는 만큼 매수하고 남은 예수금은 다음 달로 이월(잔액은 항상 1주 가격 미만) ·
                연간 세전 배당 합계가 과세 기준을 초과하는 해부터 그 해 배당 전체에 세율 적용(원 단위 절사)
            </p>
        </section>
    )
}

export default FilterPanel