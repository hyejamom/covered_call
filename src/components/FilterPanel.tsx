import {
    EVENT_TYPE_LABEL,
    EventType,
    type InvestEvent,
    InvestTarget,
    type IsaLimitStatus,
    type SimulationConstants,
    toInvestTargetLabel,
} from '../types/simulation'
import {
    AccountType,
    CALC_ASSET_META,
    type CalcAsset,
    DRIFT_PRESETS,
    DRIFT_SCENARIO_ORDER,
    UNDERLYING_LONG_RUN_RETURN_PERCENT,
    toActiveDriftScenario,
} from '../constants/assetConstants'
import { SELECTABLE_YEARS } from '../constants/gridConstants'
import { PRICE_DRIFT_POLICY } from '../constants/simulationDefaults'
import { calcRecurringBase, calcStopCapacity, countMonths } from '../services/simulationEngine'
import { formatKrw, formatYmLabel, toAgeInYear } from '../utils/format'
import ReinvestSection from './ReinvestSection'
import YearMonthPicker from './YearMonthPicker'

// ┣━━━━━━━━━━━━━━━━ Constants ━━━━━━━━━━━━━━━━━━┫

/** 생년월 선택 가능 하한 연도 */
const BIRTH_MIN_YEAR = 1940

/**
 * 부호를 붙인 % 표기 — 프리셋 버튼에 '-2.5%' / '0%' / '+4.5%' 로 찍는다
 * @param percent 연 주가 변동률 (%)
 */
function toSignedPercentLabel(percent: number): string {
    if (percent === 0) return '0%'
    return `${percent > 0 ? '+' : ''}${percent}%`
}

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
    EventType.RECURRING_GROWTH,
    EventType.ONE_TIME,
    EventType.CHANGE,
    EventType.RECURRING_STOP,
    EventType.WITHDRAW,
]

/**
 * 이 종목 탭에서 고를 수 있는 이벤트 타입
 * — 확정수익 자산을 쓰지 않는 종목(JEPQ)에서는 '월 정기매수(확정수익)' 자체를 목록에서 뺀다.
 * @param supportsGrowth 이 종목이 확정수익 통을 쓰는지
 */
function toEventTypeOptions(supportsGrowth: boolean): EventType[] {
    if (supportsGrowth) return EVENT_TYPE_OPTIONS
    return EVENT_TYPE_OPTIONS.filter((type) => type !== EventType.RECURRING_GROWTH)
}

/** 종료 연월(구간)을 쓰는 타입 — 나머지는 단일 시점 이벤트라 종료 연월이 무의미하다 */
function usesEndYm(type: EventType): boolean {
    return type === EventType.RECURRING
        || type === EventType.RECURRING_STOP
        || type === EventType.RECURRING_GROWTH
        || type === EventType.WITHDRAW
}

/** 투입 대상(주력 종목 / 확정수익)을 고를 수 있는 타입 — 일회성 투입만 통을 직접 정한다 */
function usesTarget(type: EventType): boolean {
    return type === EventType.INITIAL || type === EventType.ONE_TIME
}

/** 대상이 확정수익인 일회성 투입인지 — 그 돈은 주력 종목이 아니라 확정수익 통으로 합류한다 */
function isGrowthOneShot(event: InvestEvent): boolean {
    return usesTarget(event.type) && event.target === InvestTarget.GROWTH
}

/**
 * 종료 연월 입력을 열어 줄지
 * — 구간 타입이거나, 확정수익 통에 넣은 일회성 투입(이때 종료 연월은 "주력 종목 이관 연월"이 된다)
 */
function allowsEndYm(event: InvestEvent): boolean {
    return usesEndYm(event.type) || isGrowthOneShot(event)
}

// ┣━━━━━━━━━━━━━━━━ Components ━━━━━━━━━━━━━━━━━┫

interface EventRowProps {
    event: InvestEvent
    /** 배당 원천징수 세율 (%) — 성장자산 배당의 세후 수익률을 안내 문구에 환산할 때 쓴다 (ISA 면 0) */
    withholdingRatePercent: number
    /** 주력 종목 표기명 — 투입 대상 선택지와 "이관" 안내 문구에 들어간다 */
    assetLabel: string
    /** 이 종목이 확정수익 통을 쓰는지 — false 면 투입 대상·수익률 칸 자체가 사라진다 */
    supportsGrowth: boolean
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
    // const isInitial = props.event.type === EventType.INITIAL
    const isStop = props.event.type === EventType.RECURRING_STOP
    const isWithdraw = props.event.type === EventType.WITHDRAW
    const isRecurringGrowth = props.event.type === EventType.RECURRING_GROWTH
    // 확정수익 통에 들어가는 행 — 정기 적립이든 일회성 투입이든 연 수익률을 직접 정할 수 있다
    const isGrowthOne = isGrowthOneShot(props.event)
    const isGrowth = isRecurringGrowth || isGrowthOne
    const hasTarget = usesTarget(props.event.type)
    const hasEndYm = allowsEndYm(props.event)

    // 2) 정기매수 중단 행의 감액 상한 — 시작 연월 시점의 정기 매수 총액에서 다른 중단분을 뺀 잔여
    //    예) 정기 매수 20만 + 40만이면 이 행에는 최대 60만까지만 적을 수 있다.
    const stopCapacity = isStop
        ? calcStopCapacity(props.allEvents, props.event.startYm, props.event.id)
        : 0

    // 3) 시작 연월 시점의 감액 전 정기 매수액 — 안내 문구에 "현재 정기 N원" 으로 표기
    const recurringBase = isStop ? calcRecurringBase(props.allEvents, props.event.startYm) : 0

    // 4) 세후 총수익 — 주가상승분은 그대로, 배당은 원천징수를 떼고 재투자되므로 그만큼만 수익이 된다 (ISA 는 세율 0 이라 전액)
    const netDividendYield = props.event.dividendYieldPercent * (1 - props.withholdingRatePercent / 100)
    const netTotalReturn = props.event.priceGrowthPercent + netDividendYield

    // 5) 확정수익 구간 길이 — 성장률이 만 1년째마다 붙으므로 12개월로 나누어떨어지지 않으면 마지막 해 수익이 빠진다
    const growthMonths = isRecurringGrowth ? countMonths(props.event.startYm, props.event.endYm) : 0
    const growthYears = Math.floor(growthMonths / 12)
    const growthOddMonths = growthMonths % 12

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

        // 3) 일회성 투입이 아닌 타입으로 바뀌면 통은 타입이 결정하므로 대상을 주력 종목으로 되돌린다.
        const nextTarget = usesTarget(nextType) ? props.event.target : InvestTarget.MAIN
        // 4) 바뀐 타입/대상 조합에서 종료 연월을 쓰지 않으면 남은 값이 오작동을 부르므로 비운다.
        const keepsEndYm = usesEndYm(nextType) || (usesTarget(nextType) && nextTarget === InvestTarget.GROWTH)

        props.onChange(props.event.id, {
            type: nextType,
            target: nextTarget,
            endYm: keepsEndYm ? props.event.endYm : '',
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

    /** 투입 대상 변경 — @param value 선택된 대상(주력 종목 / 확정수익) 값 */
    const handleTargetChange = (value: string) => {
        // 주력 종목으로 되돌리면 그 달 바로 매수하는 단일 시점 투입이라 이관 연월이 무의미해진다 — 함께 비운다.
        const nextTarget = value as InvestTarget
        props.onChange(props.event.id, {
            target: nextTarget,
            endYm: nextTarget === InvestTarget.GROWTH ? props.event.endYm : '',
        })
    }

    /** 금액 변경 — @param value 입력된 원 단위 문자열 */
    const handleAmountChange = (value: string) => {
        const nextAmount = Number(value) || 0
        props.onChange(props.event.id, {
            amount: isStop ? clampStopAmount(nextAmount, props.event.startYm) : nextAmount,
        })
    }

    /** 연 주가상승률 변경 — @param value 입력된 % 문자열 */
    const handlePriceGrowthChange = (value: string) => {
        props.onChange(props.event.id, { priceGrowthPercent: Number(value) || 0 })
    }

    /** 연 배당수익률 변경 — @param value 입력된 % 문자열 */
    const handleDividendYieldChange = (value: string) => {
        props.onChange(props.event.id, { dividendYieldPercent: Number(value) || 0 })
    }

    /** 정기분 포함 여부 토글 — @param checked 체크 상태 */
    // const handleIncludesRecurringChange = (checked: boolean) => {
    //     props.onChange(props.event.id, { includesRecurring: checked })
    // }

    /** 이벤트 삭제 */
    const handleRemove = () => {
        props.onRemove(props.event.id)
    }

    return (
        <div className={props.supportsGrowth ? 'event_row' : 'event_row event_row_simple'}>
            {/* 1) 타입 선택 */}
            <select
                className={'event_field event_field_type'}
                value={props.event.type}
                onChange={(e) => handleTypeChange(e.target.value)}
            >
                {toEventTypeOptions(props.supportsGrowth).map((type) => (
                    <option key={type} value={type}>{EVENT_TYPE_LABEL[type]}</option>
                ))}
            </select>

            {/* 2) 투입 대상 — 확정수익 통을 쓰는 종목에서만 고를 거리가 생긴다.
                   통이 없는 종목(JEPQ)은 넣은 돈이 무조건 주력 종목 매수라 칸 자체를 세우지 않는다 */}
            {props.supportsGrowth && (
                <select
                    className={'event_field event_field_target'}
                    value={hasTarget ? props.event.target : InvestTarget.MAIN}
                    disabled={!hasTarget}
                    onChange={(e) => handleTargetChange(e.target.value)}
                >
                    {Object.values(InvestTarget).map((target) => (
                        <option key={target} value={target}>{toInvestTargetLabel(target, props.assetLabel)}</option>
                    ))}
                </select>
            )}

            {/* 3) 시작(해당) 연월 */}
            <YearMonthPicker
                value={props.event.startYm}
                onChange={(value) => handleYmChange('startYm', value)}
            />

            {/* 4) 종료 연월 — 구간 타입에서는 구간의 끝, 확정수익 대상 일회성에서는 주력 종목 이관 연월. 미지정이면 "계속" */}
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
            </div>
            {/* 6~7) 확정수익 자산의 연 수익률 — 그 통을 쓰는 종목에서만 세운다.
                   통이 없는 종목(JEPQ)은 주가·배당을 상단 실시간 시세에서 그대로 받아 쓰므로 입력할 것이 없다 */}
            {props.supportsGrowth && (
                <>
                    {/* 6) 연 주가상승률 — 확정수익 행에서만 입력 가능. 나머지 타입은 비활성 칸으로 자리만 지킨다 */}
                    <div className={'event_field_rate'}>
                        <input
                            className={'event_field event_field_number'}
                            type={'number'}
                            step={0.5}
                            min={0}
                            disabled={!isGrowth}
                            value={isGrowth ? props.event.priceGrowthPercent : ''}
                            onChange={(e) => handlePriceGrowthChange(e.target.value)}
                        />
                        <span className={'event_rate_unit'}>%</span>
                    </div>

                    {/* 7) 연 배당수익률 — 받은 배당은 원천징수 후 전액 같은 자산에 재투자된다 (ISA 는 세율 0) */}
                    <div className={'event_field_rate'}>
                        <input
                            className={'event_field event_field_number'}
                            type={'number'}
                            step={0.1}
                            min={0}
                            disabled={!isGrowth}
                            value={isGrowth ? props.event.dividendYieldPercent : ''}
                            onChange={(e) => handleDividendYieldChange(e.target.value)}
                        />
                        <span className={'event_rate_unit'}>%</span>
                    </div>
                </>
            )}

            {/* 6) 안내 문구 — 타입별로 읽어야 할 정보가 달라 분기한다 */}
            {isWithdraw ? (
                <span className={'event_hint event_hint_withdraw'}>
                    {`매달 ${formatKrw(props.event.amount)}원 꺼내 씀`}
                    <br />
                    {'배당 → 예수금 → 주식 매도 순으로 채웁니다'}
                    <br />
                    {'다 털어도 모자라는 달이 계좌 고갈 시점입니다'}
                </span>
            ) : isStop ? (
                <span className={'event_hint event_hint_stop'}>
                        {recurringBase > 0
                            ? `−${formatKrw(props.event.amount)}원 · 최대 ${formatKrw(stopCapacity)}원 (정기 ${formatKrw(recurringBase)}원)`
                            : '이 시점에 정기 매수가 없습니다'}
                    </span>
            ) : isRecurringGrowth ? (
                <span className={'event_hint event_hint_growth'}>
                    {`${formatKrw(props.event.amount)}원/월 · 총수익 연 ${netTotalReturn.toFixed(2)}% 복리`}
                    <br />
                    {`주가 ${props.event.priceGrowthPercent}% + 배당 ${props.event.dividendYieldPercent}%(세후 ${netDividendYield.toFixed(2)}%, 재투자)`}
                    <br />
                    {props.event.endYm === ''
                        ? `${props.assetLabel} 이관 없음(계속 적립)`
                        : `${growthYears}년차 · ${formatYmLabel(props.event.endYm)}에 ${props.assetLabel} 이관`}
                    {/* 만 1년으로 안 떨어지는 꼬리 개월은 성장률이 붙지 않아 손해로 보이므로 짚어 준다 */}
                    {growthOddMonths > 0 && (
                        <>
                            <br />
                            <b className={'event_hint_warn'}>{`+${growthOddMonths}개월은 성장 미반영`}</b>
                        </>
                    )}
                </span>
            ) : isGrowthOne ? (
                <span className={'event_hint event_hint_growth'}>
                    {`${formatKrw(props.event.amount)}원 → 성장자산 통 · 총수익 연 ${netTotalReturn.toFixed(2)}% 복리`}
                    <br />
                    {`주가 ${props.event.priceGrowthPercent}% + 배당 ${props.event.dividendYieldPercent}%(세후 ${netDividendYield.toFixed(2)}%, 재투자)`}
                    <br />
                    {props.event.endYm === ''
                        ? `${props.assetLabel} 이관 없음(계속 적립)`
                        : `${formatYmLabel(props.event.endYm)}에 ${props.assetLabel} 이관`}
                </span>
            ) : (
                <span className={'event_hint'}>{formatKrw(props.event.amount)}원</span>
            )}

            {/* 5) 초기 일시금 전용 옵션 — 일시금에 그 달 정기분이 포함되어 중복 가산을 막을지 */}
            {/*<label className={`event_check ${isInitial ? '' : 'event_check_off'}`}>*/}
            {/*    <input*/}
            {/*        type={'checkbox'}*/}
            {/*        checked={props.event.includesRecurring}*/}
            {/*        disabled={!isInitial}*/}
            {/*        onChange={(e) => handleIncludesRecurringChange(e.target.checked)}*/}
            {/*    />*/}
            {/*    <span>정기분 포함</span>*/}
            {/*</label>*/}

            {/* 6) 삭제 */}
            <button className={'event_remove'} type={'button'} onClick={handleRemove}>✕</button>
        </div>
    )
}

interface FilterPanelProps {
    /** 상단 실시간 시세 + 고정 세금 정책으로 조립된 상수 (이 패널에서는 읽기 전용) */
    constants: SimulationConstants
    /** 지금 보고 있는 종목 탭 — 표기명과 세제 안내가 여기서 갈린다 */
    asset: CalcAsset
    events: InvestEvent[]
    /** 과세가 처음 적용되는 연도 — 없으면 null */
    firstTaxedYear: number | null
    /** 선택된 시트의 ISA 납입한도 점검 결과 — 일반 계좌면 applies=false */
    isaLimits: IsaLimitStatus
    /** 계좌 고갈 연월 — 인출 계획이 없거나 기간 안에 바닥나지 않으면 null */
    depletedYm: string | null
    /** 원금을 헐기 시작한 연월 — 배당만으로 인출액이 감당 안 되는 첫 시점 */
    firstSellYm: string | null
    /** 이 시트에 월 정액 인출 계획이 있는지 — 없으면 고갈 표기 자체를 숨긴다 */
    hasWithdrawSchedule: boolean
    /**
     * 확정수익 통에만 돈이 쌓이고 주력 종목은 한 주도 못 산 시트인지.
     * 확정수익 이벤트에 종료(이관) 연월이 없으면 통이 비워지지 않아 매수·배당·잔액이 전부 0 으로 찍힌다.
     */
    growthNeverTransferred: boolean
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
    /** 선택된 파일의 연 주가 변동률 (%) — 0 이면 주가 고정 */
    sharePriceDriftPercent: number
    onDriftChange: (percent: number) => void
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
    // 0) 종목 메타 / 계좌 유형 — 아래 안내 문구가 두 갈래로 갈린다
    const meta = CALC_ASSET_META[props.asset]
    const isIsa = props.constants.accountType === AccountType.ISA
    // 0-1) 확정수익 통을 쓰는 종목인지 — 이벤트 행의 컬럼 구성이 통째로 갈린다
    const supportsGrowth = meta.supportsGrowthAsset

    // 1) 주가 × 환율 = 1주당 원화 매수단가 (요약 문구용). 원화 종목은 환율이 1이라 그대로 통과한다
    const sharePriceKrw = props.constants.sharePriceNative * props.constants.exchangeRate

    // 2) 주당 월 배당의 원화 환산액
    const monthlyDividendKrw = props.constants.monthlyDividendNative * props.constants.exchangeRate

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

    // 8) 주가 변동률 미리보기 — 기간 끝 주가 배수와, 그 변동을 얹은 세후 총수익률
    //    주가와 주당 배당이 같은 배율로 움직이므로 총수익 = (1 + 주가변동) × (1 + 세후 배당률) − 1 이 된다
    const drift = props.sharePriceDriftPercent / 100
    const driftMultiple = Math.pow(1 + drift, Math.max(0, yearSpan - 1))
    const netYield = (monthlyDividendKrw * 12 / sharePriceKrw) * (1 - props.constants.withholdingRatePercent / 100)
    const netTotalWithDrift = ((1 + drift) * (1 + netYield) - 1) * 100

    // 8-1) 연 변동률을 월 복리로 환산한 값 — 엔진이 실제로 매달 곱하는 비율이라 미리보기에 그대로 적는다
    const monthlyDriftPercent = (Math.pow(1 + drift, 1 / 12) - 1) * 100

    // 8-2) 기초지수 장기 수익률을 넘는 가정인지 — 커버드콜은 상승분을 팔아 분배금을 만드므로 지수를 이길 수 없다
    const overOptimistic = netTotalWithDrift > UNDERLYING_LONG_RUN_RETURN_PERCENT

    // 8-3) 지금 잡혀 있는 변동률이 어느 시나리오 프리셋과 같은지 — 어느 것도 아니면 '직접 입력'으로 표기한다
    const activeScenario = toActiveDriftScenario(props.asset, props.sharePriceDriftPercent)

    // ┣━━━━━━━━━━━━━━━━ Handlers ━━━━━━━━━━━━━━━━━━━┫

    /** 주가 시나리오 프리셋 선택 — @param percent 그 시나리오의 연 주가 변동률 (%) */
    const handleDriftPresetClick = (percent: number) => {
        props.onDriftChange(percent)
    }

    return (
        <section className={'sim_filter'}>
            {/* 1) 헤더 — 제목 + 고정 세금 정책 메타 배지 */}
            <div className={'sim_filter_head'}>
                <h2 className={'sim_filter_title'}>시뮬레이션 조건</h2>
                <div className={'sim_meta'}>
                    {/* 1-0) 종목 · 계좌 — 아래 세제 배지가 왜 이렇게 생겼는지의 출발점이라 맨 앞에 둔다 */}
                    <span
                        className={'sim_meta_item sim_meta_item_asset'}
                        title={`${meta.description} · 티커 ${meta.ticker} · 시세 통화 ${meta.currency}`}
                    >
                        <span className={'sim_meta_key'}>{meta.accountLabel}</span>
                        <span className={'sim_meta_value'}>{meta.label}</span>
                    </span>

                    {/* 1-1) 세제 배지 — ISA 계좌는 배당에 붙는 세금 자체가 없어 남는 것이 납입한도뿐이다 */}
                    {isIsa ? (
                        <>
                            <span
                                className={'sim_meta_item'}
                                title={'국내 상장 ETF 라 미국 원천징수 15% 가 없고, ISA 계좌 안이라 분배금에 붙는 세금도 없습니다.'
                                    + ' 지급액 전액이 그대로 배당금으로 들어옵니다.'
                                    + ' 금융소득종합과세에 합산되지 않고 건강보험료 부과 소득에도 잡히지 않습니다.'}
                            >
                                <span className={'sim_meta_key'}>배당 과세</span>
                                <span className={'sim_meta_value'}>없음 (전액 수령)</span>
                            </span>
                            <span
                                className={'sim_meta_item'}
                                title={`연 ${formatKrw(props.constants.isaAnnualLimitKrw)}원 · 총 ${formatKrw(props.constants.isaTotalLimitKrw)}원까지만 넣을 수 있습니다.`
                                    + ' 한도를 넘긴 계획은 세금이 달라지는 것이 아니라 애초에 그만큼 넣을 수 없습니다.'}
                            >
                                <span className={'sim_meta_key'}>납입한도</span>
                                <span className={'sim_meta_value'}>
                                    연 {formatKrw(props.constants.isaAnnualLimitKrw)}원 · 총 {formatKrw(props.constants.isaTotalLimitKrw)}원
                                </span>
                            </span>
                        </>
                    ) : (
                        <>
                            <span
                                className={'sim_meta_item'}
                                title={'미국이 배당 지급 시점에 떼는 세금입니다. 금액·연도와 무관하게 항상 차감되며, 재투자에 쓰이는 돈은 언제나 세후 금액입니다.'}
                            >
                                <span className={'sim_meta_key'}>미국 원천징수</span>
                                <span className={'sim_meta_value'}>{props.constants.withholdingRatePercent}% (항상)</span>
                            </span>
                            <span
                                className={'sim_meta_item'}
                                title={'연간 세전 배당 합계가 이 금액 이상이면 이듬해 5월 종합소득세 신고 대상이 됩니다.'
                                    + ` 세액은 누진세율·공제를 따지지 않고 "연 세전 배당 × ${props.constants.comprehensiveRatePercent}%" 로 아주 보수적으로 잡습니다.`
                                    + ' 1년에 한 번, 5월에 몰아서 내는 돈이라 연도 칸에 배지로 붙습니다.'}
                            >
                                <span className={'sim_meta_key'}>종합과세 기준</span>
                                <span className={'sim_meta_value'}>
                                    {formatKrw(props.constants.comprehensiveThresholdKrw)}원 / 년 · {props.constants.comprehensiveRatePercent}%
                                </span>
                            </span>
                            <span
                                className={'sim_meta_item'}
                                title={`연 세전 배당이 ${formatKrw(props.constants.healthIncomeThresholdKrw)}원 이상인 해에만 부과되며(종합과세와 같은 문턱),`
                                    + ' 전액이 아니라 그 기준금액을 뺀 초과분에만 붙습니다.'
                                    + ` 초과분 ÷ 12개월 × ${props.constants.healthRatePercent}% 가 월 보험료입니다.`
                                    + ' 납부는 이듬해 1~12월에 매달 나눠 내므로 배당금 칸에 월 배지로 붙습니다.'
                                    + ' 소득 부과분만 계산하며 재산·자동차 부과분은 빠져 있습니다.'}
                            >
                                <span className={'sim_meta_key'}>건보료</span>
                                <span className={'sim_meta_value'}>
                                    {formatKrw(props.constants.healthIncomeThresholdKrw)}원 초과분 × {props.constants.healthRatePercent}%
                                </span>
                            </span>
                        </>
                    )}
                    <span
                        className={'sim_meta_item'}
                        title={`그리드의 "배당금(${props.constants.inflationBaseYear}년 가치)" 행에만 쓰이는 값입니다.`
                            + ' 미래에 받을 배당이 지금 돈으로 얼마인지 환산할 뿐, 매수·재투자 계산에는 영향을 주지 않습니다.'}
                    >
                        <span className={'sim_meta_key'}>물가상승률</span>
                        <span className={'sim_meta_value'}>
                            연 {props.constants.inflationRatePercent}% ({props.constants.inflationBaseYear}년 기준)
                        </span>
                    </span>
                    <span className={'sim_meta_item sim_meta_item_source'} title={'주가·월배당·환율은 상단 카드의 실시간 조회값을 그대로 사용합니다'}>
                        <span className={'sim_meta_key'}>시세</span>
                        <span className={'sim_meta_value'}>{props.usingFallback ? '기준값(2026-08-10)' : '상단 실시간'}</span>
                    </span>
                </div>
            </div>

            {/* 2) 조건 요약 — 상단 시세로 환산한 단가 / 계좌별로 "결국 얼마를 내는가" 한 줄 */}
            <div className={'sim_summary'}>
                <span>1주 매수단가 <strong>{formatKrw(sharePriceKrw)}원</strong></span>
                <span>주당 월배당 <strong>{formatKrw(monthlyDividendKrw)}원</strong></span>

                {/* 2-1) ISA 는 배당에 붙는 세금이 없어 "언제부터 세금을 내나"가 아예 없다. 대신 한도가 걸린 누적 납입액을 세운다 (선택된 시트 기준) */}
                {isIsa ? (
                    <span
                        title={'선택한 시트(계좌)에 대상 기간 동안 넣은 돈의 합계입니다'
                            + ' (주력 종목 투입금 + 확정수익 자산 투입금).'
                            + ` 총 납입한도 ${formatKrw(props.constants.isaTotalLimitKrw)}원까지만 넣을 수 있습니다.`}
                    >
                        누적 납입액
                        <strong>{` ${formatKrw(props.isaLimits.contributionTotal)}원`}</strong>
                    </span>
                ) : (
                    <span title={'같은 엑셀 파일(워크북) 안의 모든 시트 배당을 합산해 판정합니다'}>
                        종합과세 시작(파일 합산)
                        <strong>
                            {props.firstTaxedYear !== null ? ` ${props.firstTaxedYear}년부터` : ' 해당 없음'}
                        </strong>
                    </span>
                )}

                {/* 2-1-1) 인출 계획이 있으면 "언제까지 버티나"가 가장 궁금한 값이라 앞자리에 세운다 */}
                {props.hasWithdrawSchedule && (
                    <>
                        <span
                            className={props.depletedYm !== null ? 'sim_summary_warn' : undefined}
                            title={props.depletedYm !== null
                                ? '주식·예수금·배당현금을 모두 털어도 인출액을 채우지 못하는 첫 달입니다.'
                                    + ' 이 달부터는 꺼낼 돈이 없습니다.'
                                : '대상 기간이 끝날 때까지 계좌가 바닥나지 않습니다.'
                                    + ' 기간을 더 늘려 보면 실제로 언제 바닥나는지 확인할 수 있습니다.'}
                        >
                            계좌 고갈
                            <strong>
                                {props.depletedYm !== null
                                    ? ` ${formatYmLabel(props.depletedYm)}`
                                    : ` ${props.endYear}년까지 버팀`}
                            </strong>
                        </span>
                        <span
                            title={props.firstSellYm !== null
                                ? '배당과 예수금만으로는 인출액을 못 채워 이 달부터 주식을 팔기 시작합니다.'
                                    + ' 보유주가 줄면 다음 달 배당도 함께 줄어 이후 속도가 붙습니다.'
                                : '배당만으로 인출액이 감당되어 원금을 헐지 않습니다.'}
                        >
                            원금 헐기 시작
                            <strong>
                                {props.firstSellYm !== null
                                    ? ` ${formatYmLabel(props.firstSellYm)}`
                                    : ' 없음(배당으로 충당)'}
                            </strong>
                        </span>
                    </>
                )}

                {/* 2-2) 확정수익 통에만 돈이 갇힌 시트 — 표가 전부 0 으로 찍히는 원인이라 맨 앞에 세운다 */}
                {props.growthNeverTransferred && (
                    <span
                        className={'sim_summary_warn'}
                        title={'투입금이 전부 확정수익 자산으로 들어갔고, 대상 기간이 끝날 때까지 ' + meta.label + ' 매수로 한 번도 넘어가지 않았습니다.'
                            + ' 확정수익 통은 이벤트의 종료 연월이 되는 달에만 전액이 이관되는데, 그 값이 비어 있으면 통이 영원히 비워지지 않습니다.'
                            + ' 확정수익 이벤트(정기매수(확정수익) · 대상이 확정수익인 일시금)의 종료 연월을 채워 주세요.'}
                    >
                        확정수익만 쌓임
                        <strong>{` ${meta.label} 매수 0원`}</strong>
                    </span>
                )}

                {/* 2-3) 실행 가능성 경고 — 세액과 무관하지만 한도를 넘으면 계획 자체가 성립하지 않는다 */}
                {isIsa && props.isaLimits.overAnnualLimitYears.length > 0 && (
                    <span
                        className={'sim_summary_warn'}
                        title={`한도를 넘긴 해: ${props.isaLimits.overAnnualLimitYears.join(', ')}년`}
                    >
                        연 납입한도 초과
                        <strong>{` ${props.isaLimits.overAnnualLimitYears.length}개 연도`}</strong>
                    </span>
                )}
                {isIsa && props.isaLimits.overTotalLimit > 0 && (
                    <span
                        className={'sim_summary_warn'}
                        title={`총 납입한도 ${formatKrw(props.constants.isaTotalLimitKrw)}원을 넘어선 금액입니다`}
                    >
                        총 납입한도 초과
                        <strong>{` ${formatKrw(props.isaLimits.overTotalLimit)}원`}</strong>
                    </span>
                )}
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

            {/* 3-1) 연 주가 변동률 — 종목 성격에 맞는 주가 시나리오를 잡는 값 (파일 단위).
                미리보기 문구가 길어 한 줄에 다 붙지 않으므로, 이 칸만 세로 3단(입력줄 / 미리보기 / 안내)으로 쌓는다 */}
            <div className={'range_field range_field_drift'}>

                {/* 3-1-1) 입력줄 — 직접 입력 칸 + 시나리오 프리셋 버튼 */}
                <div className={'drift_head'}>
                    <span className={'range_label'}>{meta.shortLabel} 주가</span>
                    <div className={'range_picker'}>
                        <input
                            className={'event_field drift_input'}
                            type={'number'}
                            step={0.5}
                            min={PRICE_DRIFT_POLICY.MIN_PERCENT}
                            max={PRICE_DRIFT_POLICY.MAX_PERCENT}
                            value={props.sharePriceDriftPercent}
                            onChange={(e) => props.onDriftChange(Number(e.target.value))}
                        />
                        <span className={'range_span'}>% / 년</span>

                        {/* 시나리오 프리셋 — 값 하나를 정답으로 박아 두지 않고, 근거가 붙은 세 갈래를 눌러 가며 비교한다.
                            각 버튼의 title 에 그 값을 그렇게 잡은 근거가 그대로 달려 있다 */}
                        <div className={'drift_preset_row'}>
                            {DRIFT_SCENARIO_ORDER.map((scenario) => {
                                const preset = DRIFT_PRESETS[props.asset][scenario]
                                const active = scenario === activeScenario

                                return (
                                    <button
                                        key={scenario}
                                        type={'button'}
                                        className={active ? 'drift_preset_btn drift_preset_btn_active' : 'drift_preset_btn'}
                                        title={preset.reason}
                                        onClick={() => handleDriftPresetClick(preset.percent)}
                                    >
                                        <span className={'drift_preset_name'}>{preset.label}</span>
                                        <span className={'drift_preset_value'}>{toSignedPercentLabel(preset.percent)}</span>
                                    </button>
                                )
                            })}
                        </div>

                        {/* 세 프리셋 어느 것과도 다른 값을 직접 넣은 상태 — 근거가 붙지 않은 가정임을 짚어 준다 */}
                        {activeScenario === null && (
                            <span
                                className={'drift_preset_custom'}
                                title={'세 시나리오 어느 것과도 다른 값입니다. 버튼을 누르면 근거가 있는 값으로 되돌릴 수 있습니다.'}
                            >
                                직접 입력
                            </span>
                        )}
                    </div>
                </div>

                {/* 3-1-2) 미리보기 — 입력한 연 변동률이 월 복리로 얼마나 쌓이는지와,
                    그 가정이 만들어 내는 세후 총수익률을 함께 보여 준다.
                    총수익률이 기초지수 장기 수익률(연 13% 안팎)을 넘어서면 성립하기 어려운 가정이므로 경고 톤으로 바꾼다 */}
                <span className={overOptimistic ? 'drift_preview drift_preview_warn' : 'drift_preview'}>
                    {props.sharePriceDriftPercent === 0
                        ? '주가 고정 — 배당수익률 그대로가 총수익'
                        : `월 ${monthlyDriftPercent.toFixed(3)}% 복리 · ${yearSpan}년 후 주가 ${driftMultiple.toFixed(2)}배`
                            + ` · 세후 총수익 연 ${netTotalWithDrift.toFixed(2)}%`}
                    {overOptimistic && ` — 나스닥100 장기 수익률(연 ${UNDERLYING_LONG_RUN_RETURN_PERCENT}% 안팎)을 넘습니다`}
                </span>

                {/* 3-1-3) 안내 — 이 값이 무엇을 움직이는지와, 프리셋 버튼의 성격 */}
                <span className={'range_hint'}>
                    <b>보수 · 중립 · 낙관</b> 버튼은 종목 구조와 실제 주가 이력에 근거를 둔 값입니다 — 버튼에 마우스를 올리면 그 근거가 나옵니다 ·
                    입력한 연 변동률은 <b>월 복리</b>로 나눠 매달 조금씩 적용됩니다 (연 -2.5% → 월 -0.211%) ·
                    주가가 움직이면 주당 배당도 같은 비율로 따라가 <b>분배율은 유지되고 총수익만</b> 달라집니다 ·
                    커버드콜은 상승분을 팔아 분배금을 만드는 구조라 <b>기초지수를 장기적으로 이기기 어렵습니다</b> —
                    위 "세후 총수익"이 나스닥100 장기 수익률을 넘으면 그만큼 낙관적인 가정입니다 ·
                    이 파일의 모든 시트에 함께 적용됩니다
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
                    <div className={supportsGrowth ? 'event_row event_row_head' : 'event_row event_row_simple event_row_head'}>
                        <span>타입</span>
                        {/* 확정수익 통이 없는 종목은 대상·수익률 칸 자체가 없으므로 헤더도 함께 접는다 */}
                        {supportsGrowth && <span>투입 대상</span>}
                        <span>시작(해당) 연월</span>
                        <span>종료 연월</span>
                        <span>금액(원)</span>
                        {supportsGrowth && <span>주가상승률</span>}
                        {supportsGrowth && <span>배당수익률</span>}
                        <span>옵션</span>
                        <span />
                    </div>
                )}

                {investEvents.map((event) => (
                    <EventRow
                        key={event.id}
                        event={event}
                        withholdingRatePercent={props.constants.withholdingRatePercent}
                        assetLabel={meta.label}
                        supportsGrowth={supportsGrowth}
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

        </section>
    )
}

export default FilterPanel