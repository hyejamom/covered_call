import { useState } from 'react'
import './App.css'
import AnalysisView from './components/AnalysisView'
import AppTabBar from './components/AppTabBar'
import CalcAssetTabBar from './components/CalcAssetTabBar'
import ExcelDownloadButton from './components/ExcelDownloadButton'
import FilterPanel from './components/FilterPanel'
import LedgerView from './components/LedgerView'
import SaveButton from './components/SaveButton'
import WorkbookGroup from './components/WorkbookGroup'
import { AppView } from './constants/appViewConstants'
import {
    AccountType,
    AssetCurrency,
    CALC_ASSET_META,
    CURRENCY_UNIT_LABEL,
    type CalcAsset,
    DEFAULT_CALC_ASSET,
    DividendBasis,
    DividendSource,
} from './constants/assetConstants'
import {
    MONTH_LABELS,
    MONTH_NUMBERS,
    RowLabel,
    buildGridRows,
    isNominalDividendRow,
    formatShareCount,
} from './constants/gridConstants'
import { INFLATION_POLICY, resolveConstants } from './constants/simulationDefaults'
import { useLedger } from './hooks/useLedger'
import { useMarketInfo } from './hooks/useMarketInfo'
import { useWorkbooks } from './hooks/useWorkbooks'
import { hasGrowthPlan, hasWithdrawSchedule, toYm } from './services/simulationEngine'
import type {
    HealthInsuranceEstimate,
    MonthlyResult,
    SimulationConstants,
    SimulationResult,
    WorkbookYearSummary,
    YearlySummary,
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
    if (rowLabel === RowLabel.GROWTH) {
        return formatKrw(monthly.growthTransfer > 0 ? monthly.growthTransfer : monthly.growthBalance)
    }
    if (rowLabel === RowLabel.CUMULATIVE) return formatKrw(monthly.cumulativePurchase)
    if (rowLabel === RowLabel.BALANCE) return formatKrw(monthly.balance)
    if (rowLabel === RowLabel.NET_CONTRIBUTION) return formatKrw(monthly.netContribution)
    if (rowLabel === RowLabel.WITHDRAW_PAID) return formatKrw(monthly.withdrawPaid)
    if (rowLabel === RowLabel.REMAINING) return formatKrw(monthly.accountRemaining)
    if (rowLabel === RowLabel.DIVIDEND_REAL) return formatKrw(monthly.dividendReal)
    return formatKrw(monthly.dividendNet)
}

/** 배당금 셀 클래스 — 과세 여부와 인출(재투자 안 함) 여부를 색으로 구분 */
function toValueClassName(rowLabel: RowLabel, monthly: MonthlyResult): string {
    // 확정수익 행은 주력 종목으로 이관한 달만 강조해 "여기서 원금이 넘어갔다"를 한눈에 잡히게 한다
    if (rowLabel === RowLabel.GROWTH) {
        return monthly.growthTransfer > 0 || monthly.growthGain > 0
            ? 'grid_cell_value grid_cell_value_growth grid_cell_value_transfer'
            : 'grid_cell_value grid_cell_value_growth'
    }
    // 순투입금은 "내 돈"만 센 값이라 매수금액과 성격이 달라 확정수익 행과 같은 톤으로 구분한다
    if (rowLabel === RowLabel.NET_CONTRIBUTION) return 'grid_cell_value grid_cell_value_growth'
    // 인출 행 — 목표액을 못 채운 달은 계좌가 바닥났다는 뜻이라 경고색으로 뒤집는다
    if (rowLabel === RowLabel.WITHDRAW_PAID) {
        return monthly.depleted ? 'grid_cell_value grid_cell_value_depleted' : 'grid_cell_value'
    }
    // 계좌 잔액 — 0 이 된 시점이 고갈이므로 남은 돈이 없으면 경고색으로 세운다
    if (rowLabel === RowLabel.REMAINING) {
        return monthly.accountRemaining <= 0 ? 'grid_cell_value grid_cell_value_depleted' : 'grid_cell_value'
    }
    // 실질가치 행은 참고 지표라 한 톤 낮춰 표기하되, 인출한 달은 명목 행과 동일하게 흐리게 처리한다
    if (rowLabel === RowLabel.DIVIDEND_REAL) {
        return monthly.reinvested
            ? 'grid_cell_value grid_cell_value_real'
            : 'grid_cell_value grid_cell_value_real grid_cell_value_withdrawn'
    }
    if (!isNominalDividendRow(rowLabel)) return 'grid_cell_value'
    if (!monthly.reinvested) return 'grid_cell_value grid_cell_value_withdrawn'
    return monthly.taxed ? 'grid_cell_value grid_cell_value_taxed' : 'grid_cell_value'
}

/** 구매력 비율 — 명목 대비 실질 금액이 몇 %인지 (명목이 0이면 100%로 본다) */
function toPurchasingPowerPercent(monthly: MonthlyResult): string {
    if (monthly.dividendNet <= 0) return '100.0'
    return ((monthly.dividendReal / monthly.dividendNet) * 100).toFixed(1)
}

/**
 * 항목별 셀 툴팁 — 정확한 원 단위 값과 산출 근거
 * @param rowLabel 행 라벨 @param monthly 그 달 결과 @param assetLabel 주력 종목 표기명(이관 안내 문구용)
 */
function toCellTitle(rowLabel: RowLabel, monthly: MonthlyResult, assetLabel: string, isIsa: boolean): string {
    const head = `${formatYmLabel(monthly.ym)}`
    if (rowLabel === RowLabel.GROWTH) {
        // 평가액과 누적 원금의 차이가 곧 "평단가 대비 얼마나 올랐는지"라 두 값을 함께 읽히게 한다
        const gain = monthly.growthBalance - monthly.growthPrincipal
        const gainPercent = monthly.growthPrincipal > 0
            ? ((gain / monthly.growthPrincipal) * 100).toFixed(1)
            : '0.0'

        // 이관한 달은 잔액이 0으로 떨어지므로, 얼마가 어디로 넘어갔는지 따로 안내한다
        if (monthly.growthTransfer > 0) {
            return `${head} 확정수익 평가액 ${formatKrw(monthly.growthTransfer)}원 전액을 ${assetLabel} 매수 자금으로 이관`
                + ` (원금 ${formatKrw(monthly.growthPrincipal)}원 · 평가수익 ${formatKrw(gain)}원 · 평단가 대비 +${gainPercent}%)`
        }

        return `${head} 확정수익 평가액 ${formatKrw(monthly.growthBalance)}원`
            + ` (누적 원금 ${formatKrw(monthly.growthPrincipal)}원 · 평가수익 ${formatKrw(gain)}원 · 평단가 대비 +${gainPercent}%)`
            + (monthly.growthContribution > 0 ? ` · 이번 달 매수 ${formatKrw(monthly.growthContribution)}원` : '')
            // 연 1회 총수익이 붙는 달은 주가수익과 재투자된 배당을 분해해 보여준다
            + (monthly.growthGain > 0
                ? ` · 이번 달 총수익 반영 +${formatKrw(monthly.growthGain)}원`
                    + ` (주가 +${formatKrw(monthly.growthPriceGain)}원`
                    + ` · 배당 ${formatKrw(monthly.growthDividendGross)}원 − 원천징수 ${formatKrw(monthly.growthDividendTax)}원`
                    + ` = +${formatKrw(monthly.growthDividendNet)}원 재투자)`
                : '')
    }
    if (rowLabel === RowLabel.DIVIDEND_REAL) {
        // ISA 는 배당에 붙는 세금이 없어 "세후"라고 부를 것이 없다 — 받은 금액이 곧 배당금이다
        return `${head} ${isIsa ? '배당' : '세후 배당'} ${formatKrw(monthly.dividendNet)}원은`
            + ` ${INFLATION_POLICY.BASE_YEAR}년 화폐가치로 약 ${formatKrw(monthly.dividendReal)}원`
            + ` (물가상승률 연 ${INFLATION_POLICY.RATE_PERCENT}% 복리 할인 · 구매력 ${toPurchasingPowerPercent(monthly)}%)`
    }
    if (rowLabel === RowLabel.CUMULATIVE) {
        return `${head} 누적 매수금액 ${formatKrw(monthly.cumulativePurchase)}원 · 보유 ${formatShareCount(monthly.shares)}`
            + ` (이번 달 매수 ${formatKrw(monthly.purchaseAmount)}원 · 투입 ${formatKrw(monthly.contribution)}원)`
            // 주가 변동률을 넣으면 단가가 달마다 달라지므로 그 시점 단가와 평가액을 함께 보여준다
            + ` · 1주 ${formatKrw(monthly.sharePriceKrw)}원 → 평가액 ${formatKrw(monthly.valuation)}원`
    }
    if (rowLabel === RowLabel.BALANCE) {
        // 가용현금 = 매수에 쓴 금액 + 남은 잔액 (이월 잔액 + 투입금 + 재투자한 배당)
        const cash = monthly.purchaseAmount + monthly.balance
        return `${head} 가용현금 ${formatKrw(cash)}원 중 ${formatKrw(monthly.purchaseAmount)}원어치 매수 →`
            + ` 1주를 더 사기엔 모자란 ${formatKrw(monthly.balance)}원이 남아 다음 달로 이월`
    }
    if (rowLabel === RowLabel.WITHDRAW_PAID) {
        // 목표액 · 실제 인출액 · 재원을 함께 보여줘야 "언제부터 원금을 헐었는지"가 드러난다
        if (monthly.depleted) {
            return `${head} 꺼내려던 ${formatKrw(monthly.withdrawRequested)}원 중`
                + ` ${formatKrw(monthly.withdrawPaid)}원만 꺼냈습니다 — 계좌에 남은 돈이 없습니다`
        }
        return `${head} 인출 ${formatKrw(monthly.withdrawPaid)}원`
            + (monthly.sharesSold > 0
                ? ` · 배당·예수금으로 모자라 ${formatShareCount(monthly.sharesSold)}를 팔아 채웠습니다 (원금을 허무는 중)`
                : ' · 배당·예수금으로 충당 (원금은 그대로)')
            + ` · 인출 후 계좌 잔액 ${formatKrw(monthly.accountRemaining)}원`
    }
    if (rowLabel === RowLabel.REMAINING) {
        if (monthly.accountRemaining <= 0) {
            return `${head} 계좌 잔액 0원 — 더 이상 꺼낼 돈이 없습니다`
        }
        return `${head} 계좌 잔액 ${formatKrw(monthly.accountRemaining)}원`
            + ` = 주식 평가 ${formatKrw(monthly.shares * monthly.sharePriceKrw)}원`
            + ` + 예수금 ${formatKrw(monthly.balance)}원`
            + (monthly.dividendCashBalance > 0 ? ` + 배당현금 ${formatKrw(monthly.dividendCashBalance)}원` : '')
            + ` · 보유 ${formatShareCount(monthly.shares)}`
    }
    if (rowLabel === RowLabel.NET_CONTRIBUTION) {
        // 누적 매수금액에는 재투자된 배당이 섞여 있다 — "그래서 내 돈은 얼마인가"를 이 행이 답한다
        return `${head} 누적 순투입금 ${formatKrw(monthly.netContribution)}원`
            + ` = 누적 납입 ${formatKrw(monthly.cumulativeContribution)}원`
            + ` − 누적 배당 인출 ${formatKrw(monthly.cumulativeDividendTaken)}원`
            + ` (이번 달 납입 ${formatKrw(monthly.contribution + monthly.growthContribution)}원`
            + ` · 배당 인출 ${monthly.reinvested ? '0' : formatKrw(monthly.dividendNet)}원)`
            + ` · 재투자한 배당은 내 돈이 아니므로 납입에 넣지 않습니다`
    }
    const flow = monthly.reinvested ? '전액 재투자' : '인출 (재투자 안 함)'

    // ISA 계좌는 배당에 붙는 세금이 없어 세전 = 세후다. 지급액이 그대로 배당금이므로 군더더기 없이 금액만 적는다.
    if (isIsa) {
        return `${head} 배당 ${formatKrw(monthly.dividendGross)}원 · ${flow}`
            + (monthly.reinvested ? ' — 전액 재매수' : ' — 현금으로 꺼냅니다')
    }

    return `${head} 세전 ${formatKrw(monthly.dividendGross)}원 · 미국 원천징수 ${formatKrw(monthly.dividendTax)}원`
        + ` · 세후 ${formatKrw(monthly.dividendNet)}원 · ${flow}`
        + (monthly.taxed ? ' (이 해는 금융소득종합과세 대상 — 연도 칸의 5월 종소세 추정액 참고)' : '')
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
    /** 이 시트에 그릴 행 라벨 목록 — 확정수익 구간이 있는 시트에만 확정수익 행이 붙는다 */
    rowLabels: RowLabel[]
    /** 시트 주인의 생년월 — 'YYYY-MM', 빈 문자열이면 나이를 표기하지 않는다 */
    birthYm: string
    result: SimulationResult
    /** 워크북(엑셀 파일) 합산 연간 요약 — 과세 판정 근거 표기용 */
    workbookSummary: WorkbookYearSummary | undefined
    /**
     * 이 해에 "실제로 내는" 건강보험료 — 전년도 소득으로 정해진 추정치다.
     * 건보료는 소득이 생긴 해가 아니라 이듬해 1~12월에 매달 나가므로, 그 해 요약이 아니라 전년도 요약에서 가져온다.
     */
    healthDue: HealthInsuranceEstimate | undefined
    /** 건강보험료율 (%) — 건보료 배지 툴팁의 산출 근거 문구에 들어간다 */
    healthRatePercent: number
    /** 주력 종목 표기명 — 셀 툴팁의 이관 안내 문구에 들어간다 */
    assetLabel: string
    /** ISA 계좌인지 — 연도 배지 구성이 통째로 갈린다 */
    isIsa: boolean
    /** ISA 납입한도 (원) — 연 납입액이 이 값을 넘으면 배지로 경고한다 */
    isaAnnualLimitKrw: number
}

/** 연도 단위 그리드 블록 — 가로 13칸 × 세로 5칸 */
function YearBlock(props: YearBlockProps) {

    // ┣━━━━━━━━━━━━━━━━ Derived ━━━━━━━━━━━━━━━━━━━━┫
    // 1) 그 해 과세 여부 — 워크북 합산 기준으로 판정된 값. 과세 연도는 블록 전체를 주황 톤으로 전환한다
    const summary = props.result.byYear[props.year]
    const taxed = summary?.taxed ?? false

    // 2) 그 해 나이 — 생년월 미지정이면 null
    const age = toAgeInYear(props.birthYm, props.year)

    // 3) 그 해 5월 종소세 추정액 — 워크북(파일) 합산 기준으로 한 번만 계산된 값
    const estimate = props.workbookSummary?.comprehensiveTax
    const taxDue = estimate?.totalDue ?? 0

    // 4) 배지 툴팁 — 판정 근거(합산 배당)와 종소세 산출 내역을 한 번에 읽히게 쌓는다
    const badgeTitle = props.workbookSummary && estimate
        ? [
            `[판정] 파일 합산 연 세전 금융소득 ${formatKrw(props.workbookSummary.financialIncome)}원`
                + ` = ${props.assetLabel} 배당 ${formatKrw(props.workbookSummary.dividendGross)}원`
                + ` + 성장자산 배당 ${formatKrw(props.workbookSummary.growthDividendGross)}원(재투자분)`
                + ` · 미국 원천징수 합계 ${formatKrw(props.workbookSummary.dividendTax + props.workbookSummary.growthDividendTax)}원`,
            `[5월 납부 추정] ${formatKrw(estimate.totalDue)}원`
                + ` = 연 세전 배당 ${formatKrw(estimate.financialIncome)}원 × ${estimate.ratePercent}%`,
            '※ 종합소득세는 1년에 한 번, 이듬해 5월에 몰아서 냅니다 (매달 나가는 건보료와 다릅니다).',
            `※ 누진세율·공제를 따지지 않고 ${estimate.ratePercent}% 로 아주 보수적으로 잡은 추정치이며,`
                + ' 계좌 밖에서 내는 돈이라 매수·재투자 계산에는 반영하지 않습니다.',
        ].join('\n')
        : ''

    // 5) 이 해에 매달 빠지는 건강보험료 — 전년도 소득으로 정해진 값이라 판정 근거도 전년도 기준으로 적는다
    const health = props.healthDue
    const healthTitle = health && health.applies
        ? [
            `[납부] ${props.year}년 1~12월에 매달 빠지는 건강보험료 — ${props.year - 1}년 배당 소득으로 정해집니다`,
            `[판정] ${props.year - 1}년 세전 배당 ${formatKrw(health.financialIncome)}원`
                + ` (${props.assetLabel} 배당 + 재투자된 성장자산 배당)`,
            `[부과 소득] ${formatKrw(health.financialIncome)}원 − 기준 ${formatKrw(health.financialIncome - health.chargeableIncome)}원`
                + ` = ${formatKrw(health.chargeableIncome)}원 → ÷ 12개월 = ${formatKrw(health.monthlyChargeableIncome)}원`,
            `[월 보험료] ${formatKrw(health.monthlyChargeableIncome)}원 × ${props.healthRatePercent}%`
                + ` = ${formatKrw(health.monthlyPremium)}원 (연 ${formatKrw(health.yearlyPremium)}원)`,
            '※ 소득 부과분만 계산한 값입니다. 재산·자동차 부과분은 포함되지 않아 실제 고지액은 이보다 큽니다.',
            '※ 세금이 아니라 보험료이고 계좌 밖에서 나가는 돈이라 매수·재투자 계산에는 넣지 않습니다.',
        ].join('\n')
        : ''

    // 6) ISA 연 납입액 — 계좌는 시트마다 하나이므로 워크북 합산이 아니라 이 시트 값을 본다
    const yearlySummary: YearlySummary | undefined = props.result.byYear[props.year]
    const overAnnualLimit = props.isIsa
        && yearlySummary !== undefined
        && yearlySummary.contribution > props.isaAnnualLimitKrw

    const limitTitle = yearlySummary
        ? [
            `[이 해 납입] ${formatKrw(yearlySummary.contribution)}원`
                + ` (한도 ${formatKrw(props.isaAnnualLimitKrw)}원 · 초과 ${formatKrw(yearlySummary.contribution - props.isaAnnualLimitKrw)}원)`,
            `[누적 납입] ${formatKrw(yearlySummary.contributionCumulative)}원`,
            '※ ISA 는 연 납입한도를 넘겨 넣을 수 없습니다 — 이 계획은 실제로는 그대로 실행되지 않습니다.',
        ].join('\n')
        : ''

    // 7) 인출 이정표 — 원금을 헐기 시작한 해 / 계좌가 바닥난 해에만 배지를 붙인다.
    //    두 시점 사이가 "배당만으로는 모자라 원금을 까먹고 있는" 구간이다.
    const sellYm = props.result.firstSellYm
    const depletedYm = props.result.depletedYm
    const startsSellingThisYear = sellYm !== null && sellYm.slice(0, 4) === String(props.year)
    const depletesThisYear = depletedYm !== null && depletedYm.slice(0, 4) === String(props.year)

    const sellTitle = sellYm !== null
        ? [
            `[${formatYmLabel(sellYm)}] 배당과 예수금만으로는 인출액을 못 채워 이 달부터 주식을 팔기 시작합니다.`,
            '여기서부터가 원금을 허무는 구간입니다 — 보유주가 줄고, 줄어든 만큼 다음 달 배당도 함께 줄어 속도가 붙습니다.',
            depletedYm !== null
                ? `이대로 가면 ${formatYmLabel(depletedYm)}에 계좌가 바닥납니다.`
                : '다만 대상 기간 안에는 바닥나지 않습니다.',
        ].join('\n')
        : ''

    const depletedTitle = depletedYm !== null
        ? [
            `[${formatYmLabel(depletedYm)}] 주식·예수금·배당현금을 모두 털어도 인출액을 채우지 못하는 첫 달입니다.`,
            '이 달부터는 꺼낼 돈이 없습니다 — 인출액을 줄이거나, 인출 시작을 늦추거나, 원금을 더 넣어야 합니다.',
            sellYm !== null ? `원금을 헐기 시작한 시점은 ${formatYmLabel(sellYm)} 였습니다.` : '',
        ].filter((line) => line !== '').join('\n')
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
                    {/* 종합과세 연도 배지 — 1년에 한 번 5월에 몰아서 내는 돈이라 연도 칸에 한 줄로 붙인다.
                        매달 나가는 건보료는 성격이 달라 배당금 행의 월별 칸에 따로 붙는다 */}
                    {taxed && (
                        <span className={'year_tax_badge'} title={badgeTitle}>
                            {`종합과세 대상 · 5월 종소세 ${formatKrw(taxDue)}원`}
                        </span>
                    )}
                    {/* ISA 연 납입한도 초과 — 세금이 아니라 "이 계획을 실행할 수 없다"는 경고다 */}
                    {overAnnualLimit && (
                        <span className={'year_limit_badge'} title={limitTitle}>
                            {`연 납입한도 초과 ${formatKrw(yearlySummary.contribution)}원`}
                        </span>
                    )}
                    {/* 원금을 헐기 시작한 해 — 아직 고갈은 아니지만 여기서 방향이 꺾인다 */}
                    {startsSellingThisYear && (
                        <span className={'year_sell_badge'} title={sellTitle}>
                            {`${formatYmLabel(sellYm)}부터 원금 헐기 시작`}
                        </span>
                    )}
                    {/* 계좌가 바닥난 해 — 이 달 이후로는 꺼낼 돈이 없다 */}
                    {depletesThisYear && (
                        <span className={'year_depleted_badge'} title={depletedTitle}>
                            {`${formatYmLabel(depletedYm)} 계좌 고갈`}
                        </span>
                    )}
                </div>
                {MONTH_LABELS.map((month) => (
                    <div key={month} className={'grid_cell grid_cell_month'}>{month}</div>
                ))}
            </div>

            {/* 2) 1~N행 — 항목 라벨 + 월별 데이터 셀 */}
            {props.rowLabels.map((rowLabel) => (
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
                                title={isActive ? toCellTitle(rowLabel, monthly, props.assetLabel, props.isIsa) : undefined}
                            >
                                {isActive ? (
                                    <div className={'grid_cell_body'}>
                                        <span className={toValueClassName(rowLabel, monthly)}>
                                            {toCellText(rowLabel, monthly)}
                                            {/* 재투자하지 않고 인출한 달의 배당금 — X 배지 */}
                                            {isNominalDividendRow(rowLabel) && !monthly.reinvested && (
                                                <span className={'grid_cell_withdraw_mark'}>X</span>
                                            )}
                                        </span>
                                        {/* 누적 매수금액 칸에는 그 시점 보유주를 함께 표기 */}
                                        {rowLabel === RowLabel.CUMULATIVE && (
                                            <span className={'grid_cell_shares'}>
                                                {formatShareCount(monthly.shares)}
                                            </span>
                                        )}
                                        {/* 건보료 배지 — 전년도 배당으로 정해진 금액을 이 해 매달 낸다.
                                            배당금에서 빠져나가는 돈이라 세후 배당 바로 아래에 붙여 함께 읽히게 한다 */}
                                        {isNominalDividendRow(rowLabel) && health?.applies === true && (
                                            <span className={'grid_cell_health'} title={healthTitle}>
                                                {`건보료 −${formatKrw(health.monthlyPremium)}원`}
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
    const [view, setView] = useState<AppView>(AppView.COVERED_CALL)      // 최상위 화면 — 진입 시 1페이지(계산기)
    const [asset, setAsset] = useState<CalcAsset>(DEFAULT_CALC_ASSET)    // 계산기 종목 탭 — 진입 시 1번 탭(TIGER 커버드콜·ISA)

    // ┣━━━━━━━━━━━━━━━━ CustomHooks ━━━━━━━━━━━━━━━━┫
    // 시세·워크북 훅은 화면 전환과 무관하게 항상 살려 둔다.
    // 가계부로 갔다 오는 사이 언마운트되면 저장하지 않은 편집 내용이 통째로 날아가기 때문이다.
    // 시세는 두 종목을 한꺼번에 받아 두고, 종목 탭을 바꾸면 이미 받아 둔 값에서 골라 쓴다.
    const market = useMarketInfo()
    const { quote, dividend, dividendYield } = market.byAsset[asset]
    const rate = market.rate

    // 가계부 상태도 여기서 한 번만 만든다 — 2페이지(가계부)와 3페이지(분석)가 같은 데이터를 봐야 하고,
    // 탭을 오갈 때마다 훅이 다시 살아나면 localStorage 를 매번 되읽는 낭비가 생긴다.
    const ledger = useLedger()

    // ┣━━━━━━━━━━━━━━━━ Derived ━━━━━━━━━━━━━━━━━━━━┫
    // 0) 선택된 종목 메타 — 카드 라벨 · 통화 · 계좌 세제가 전부 여기서 갈린다
    const assetMeta = CALC_ASSET_META[asset]
    const isKrwAsset = assetMeta.currency === AssetCurrency.KRW
    const isIsa = assetMeta.accountType === AccountType.ISA
    const priceUnit = CURRENCY_UNIT_LABEL[assetMeta.currency]

    // 0-1) 배당 표기 방식 — 조회처마다 배당락일 형식이 다르고, 산출 방식마다 월 배당금의 근거 문구가 다르다
    const usesNasdaqDividend = assetMeta.dividendSource === DividendSource.NASDAQ
    const usesTtmAverage = assetMeta.dividendBasis === DividendBasis.TTM_AVERAGE

    // 1) 시세 등락 방향 판정 — 상승/하락/보합
    const quoteTone: TrendTone = !quote.data || quote.data.changeAmount === 0
        ? TrendTone.FLAT
        : quote.data.changeAmount > 0 ? TrendTone.UP : TrendTone.DOWN

    // 2) 시세가 모두 도착했는지 — 하나라도 없으면 폴백 값으로 계산.
    //    원화 종목은 환율을 쓰지 않으므로 환율 조회 실패를 폴백 판정에 넣지 않는다.
    const usingFallback = quote.data === null
        || dividend.data === null
        || (!isKrwAsset && rate.data === null)

    // 2-1) (아래 워크북 훅 이후 파생값은 CustomHooks(2) 뒤에 이어진다)
    // 3) 시뮬레이션 상수 — 시세는 상단 카드 값을 그대로 쓰고, 계좌 세제는 종목 메타에서 조립
    const constants: SimulationConstants = resolveConstants(
        asset,
        quote.data?.price ?? null,
        dividend.data?.monthlyDividend ?? null,
        rate.data?.krwPerUsd ?? null,
    )

    // ┣━━━━━━━━━━━━━━━━ CustomHooks(2) ━━━━━━━━━━━━━━┫
    // 상수가 확정된 뒤에 워크북을 계산해야 하므로 파생값 아래에서 호출한다.
    // 그리드에 그릴 연도 목록(workbook.years)도 훅이 선택된 파일의 대상 기간에서 파생시켜 함께 돌려준다.
    // 종목 탭마다 파일·시트가 따로 보관되므로 지금 보고 있는 종목을 함께 넘긴다.
    const workbook = useWorkbooks(constants, asset)

    // ┣━━━━━━━━━━━━━━━━ Derived(2) ━━━━━━━━━━━━━━━━━┫
    // 4) 그리드 행 목록 — 확정수익 구간을 쓰는 시트에만 '확정수익 적립금' 행을 얹는다
    const gridRowLabels = buildGridRows({
        hasGrowth: hasGrowthPlan(workbook.events),
        isIsa,
        hasWithdrawSchedule: hasWithdrawSchedule(workbook.events),
    }).map((row) => row.label)

    // 5) 확정수익 통에만 돈이 쌓이고 주력 종목은 한 주도 못 산 시트인지 판정.
    //    확정수익 이벤트에 종료(이관) 연월이 비어 있으면 통이 영원히 비워지지 않아,
    //    매수·배당·잔액 행이 전부 0 으로만 찍힌다 — 계산이 깨진 것처럼 보이므로 따로 짚어 준다.
    const lastMonthly = workbook.result.byYm[toYm(workbook.years[workbook.years.length - 1], 12)]
    const growthNeverTransferred = (lastMonthly?.cumulativePurchase ?? 0) === 0
        && (lastMonthly?.growthBalance ?? 0) > 0

    // ┣━━━━━━━━━━━━━━━━ Handlers ━━━━━━━━━━━━━━━━━━━┫

    /** 탭 이동 — @param next 이동할 화면 (1 계산기 · 2 가계부 · 3 분석) */
    const handleSelectView = (next: AppView) => {
        setView(next)
    }

    /** 계산기 종목 탭 이동 — @param next 이동할 종목 (1 TIGER 커버드콜·ISA · 2 JEPQ·일반) */
    const handleSelectAsset = (next: CalcAsset) => {
        setAsset(next)
    }

    return (
        <div className={'app_root'}>
            {/* 0-1) 상단 탭 바 — 화면 상단 중앙 고정 */}
            <AppTabBar view={view} onSelect={handleSelectView} />

            {/* 0-2) 플로팅 저장 버튼 — 화면 우측 상단 고정. 스크롤과 무관하게 항상 떠 있다.
                    가계부·분석 화면에서도 남겨 둬야 적립 계산기의 미저장 변경을 놓치지 않는다 */}
            <SaveButton
                assets={workbook.assets}
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
                {/* 0-6) 계산기 종목 탭 — 1번 TIGER 나스닥100커버드콜(ISA) / 2번 JEPQ(일반 계좌) */}
                <CalcAssetTabBar asset={asset} onSelect={handleSelectAsset} />

                {/* 1) 상단 요약 정보 — 오늘 금액 / 배당률 / 주당 월배당 / (미국 종목만) 환율
                       원화 종목은 환율이 끼어들 자리가 없어 네 번째 카드를 통째로 뺀다 */}
                <div className={'top_info'}>
                    <InfoCard
                        label={`${assetMeta.shortLabel} 오늘 금액`}
                        value={quote.data ? formatNumber(quote.data.price) : '-'}
                        unit={priceUnit}
                        trend={quote.data
                            ? `전일 ${formatNumber(quote.data.previousClose)} · ${quote.data.changeAmount >= 0 ? '+' : ''}${formatNumber(quote.data.changeAmount)} (${quote.data.changeRate >= 0 ? '+' : ''}${quote.data.changeRate.toFixed(2)}%)`
                            : '-'}
                        accent={'blue'}
                        tone={quoteTone}
                        loading={quote.loading}
                        error={quote.error}
                    />
                    <InfoCard
                        label={`${assetMeta.shortLabel} 배당률`}
                        value={dividendYield.data !== null ? formatNumber(dividendYield.data) : '-'}
                        unit={'%'}
                        trend={dividend.data
                            ? `최근 12개월 ${dividend.data.paymentCount}회 지급 ${formatNumber(dividend.data.ttmDividend)}${priceUnit}`
                                + ` · 배당락 ${usesNasdaqDividend ? formatUsDate(dividend.data.exDividendDate) : dividend.data.exDividendDate}`
                            : '-'}
                        accent={'green'}
                        tone={TrendTone.FLAT}
                        loading={dividendYield.loading}
                        error={dividendYield.error}
                    />
                    <InfoCard
                        label={'월 배당금(주당)'}
                        value={dividend.data ? formatNumber(dividend.data.monthlyDividend) : '-'}
                        unit={priceUnit}
                        trend={dividend.data
                            ? `${formatKrw(dividend.data.monthlyDividend * constants.exchangeRate)}원`
                                + ` · ${usesTtmAverage ? '최근 12개월 합계 ÷ 12' : '최근 1회 지급액 기준'}`
                            : '-'}
                        accent={'violet'}
                        tone={TrendTone.FLAT}
                        loading={dividend.loading}
                        error={dividend.error}
                    />
                    {!isKrwAsset && (
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
                    )}
                </div>

                {/* 2) 시뮬레이션 필터 — 선택된 탭의 고정 상수 + 투입 이벤트 편집 (변경 시 아래 그리드 자동 재계산) */}
                <FilterPanel
                    constants={constants}
                    asset={asset}
                    events={workbook.events}
                    firstTaxedYear={workbook.result.firstTaxedYear}
                    isaLimits={workbook.result.isaLimits}
                    depletedYm={workbook.result.depletedYm}
                    firstSellYm={workbook.result.firstSellYm}
                    hasWithdrawSchedule={hasWithdrawSchedule(workbook.events)}
                    growthNeverTransferred={growthNeverTransferred}
                    usingFallback={usingFallback}
                    workbookName={workbook.activeWorkbook.name}
                    startYear={workbook.startYear}
                    endYear={workbook.endYear}
                    years={workbook.years}
                    sharePriceDriftPercent={workbook.sharePriceDriftPercent}
                    onDriftChange={workbook.handleDriftChange}
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
                                asset={asset}
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

                    <ExcelDownloadButton workbooks={workbook.workbooks} constants={constants} asset={asset} />
                </div>

                {/* 4) 연도별 적립 그리드 — 선택된 파일의 대상 기간 (선택된 탭 기준) */}
                <div className={'bt_grid'}>
                    {workbook.years.map((year) => (
                        <YearBlock
                            key={year}
                            year={year}
                            rowLabels={gridRowLabels}
                            birthYm={workbook.birthYm}
                            result={workbook.result}
                            workbookSummary={workbook.workbookResult.byYear[year]}
                            // 건보료는 전년도 소득으로 정해져 이 해에 매달 나간다 — 그래서 한 해 전 요약에서 가져온다
                            healthDue={workbook.workbookResult.byYear[year - 1]?.healthInsurance}
                            healthRatePercent={constants.healthRatePercent}
                            assetLabel={assetMeta.label}
                            isIsa={isIsa}
                            isaAnnualLimitKrw={constants.isaAnnualLimitKrw}
                        />
                    ))}
                </div>
                </>
            )}
        </div>
    )
}

export default App
