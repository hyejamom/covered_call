import { AccountType, AssetCurrency, CALC_ASSET_META, type CalcAsset } from './assetConstants'
import { EventType, type InvestEvent, InvestTarget, type SimulationConstants } from '../types/simulation'

// ══════════ 시뮬레이션 기본값 ══════════
// 시세 3종(주가·월배당·환율)은 상단 top_info 카드의 실시간 값을 그대로 쓰고,
// 세금 정책은 바뀔 일이 거의 없어 아래 고정값으로 못 박는다.
// 이벤트는 탭별로 독립 관리되며, 새 탭은 이벤트가 하나도 없는 빈 상태로 시작한다.
// 종목마다 달라지는 값(시세 폴백·통화·계좌 유형·기본 주가 변동률)은 assetConstants 가 들고 있다.

/**
 * 환율 조회 실패 시 쓸 폴백 (원/USD) — 원화 종목에서는 쓰이지 않는다.
 *
 * 폴백 시세(주가·월배당)는 2026-08-10 기준이지만 환율만 따로 1,380원으로 잡아 둔다.
 * 다만 이 값이 결과를 흔들지는 않는다 — 투입이 원화 정액이라 환율이 낮아지면 주가도 배당도 같은 비율로 줄어
 * "150만원어치 사서 받는 원화 배당"은 그대로이고, 보유 주식 수만 달라진다.
 * (1,420 → 1,380 으로 내려도 연 세전배당 2,000만원 도달 시점은 같은 해다)
 */
export const FALLBACK_EXCHANGE_RATE = 1380

/**
 * 세금 정책 — 고정 상수
 * 미국 주식 배당은 두 단계로 세금을 맞는다.
 * 1) 지급 시점: 미국이 15% 를 떼고 나머지만 입금한다 — 금액과 무관하게 "항상" 적용된다.
 * 2) 이듬해 5월: 연간 세전 금융소득이 2,000만원 이상인 해는 종합소득세 신고 대상이 되어
 *    1년에 한 번 몰아서 낸다. 세액은 누진 구간을 따지지 않고 "연 세전 배당 × 15%" 로 보수적으로 잡는다.
 */
export const TAX_POLICY = {
    /** 미국 원천징수 세율 (%) — 배당 지급 시점에 무조건 차감 */
    WITHHOLDING_RATE_PERCENT: 15,
    /** 금융소득종합과세 기준 (원) — 연간 "세전" 배당 합계가 이 값 이상이면 이듬해 5월 종소세 신고 대상 */
    COMPREHENSIVE_THRESHOLD_KRW: 20_000_000,
    /** 종합소득세 추정 세율 (%) — 대상 연도의 연 세전 배당 전액에 곱하는 보수적 단일 세율 */
    COMPREHENSIVE_RATE_PERCENT: 15,
} as const

/**
 * 건강보험료 정책 — 고정 상수
 *
 * 종합과세와 같은 문턱을 쓴다 — 연 세전 배당이 2,000만원 이상인 해에만 부과되므로
 * "종소세는 없는데 건보료만 나간다"는 어긋난 구간이 생기지 않는다.
 * 보험료는 전액이 아니라 기준금액을 뺀 초과분에만 붙고, 그 초과분을 12로 나눈 월 소득에 요율을 곱한다.
 * 실제 납부는 소득이 생긴 해가 아니라 이듬해 1~12월에 매달 나눠 낸다.
 * 요율은 해마다 바뀌므로 값만 갈아 끼우면 전 구간이 다시 계산된다.
 */
export const HEALTH_INSURANCE_POLICY = {
    /** 건강보험료율 (%) — 지역가입자 소득 정률 부과 */
    RATE_PERCENT: 7.19,
    /** 부과 기준 (원) — 연 세전 배당이 이 값 이상일 때만 부과되고, 초과분만 부과 대상 소득이 된다 */
    INCOME_THRESHOLD_KRW: 20_000_000,
} as const

/**
 * 물가 정책 — 고정 상수
 * 미래에 받을 배당금이 "지금 돈으로는 얼마인지"를 함께 보여주기 위한 값이며, 매수·재투자 계산에는 전혀 관여하지 않는다.
 * BASE_YEAR 를 바꾸면 gridConstants 의 RowLabel.DIVIDEND_REAL 라벨 문구도 자동으로 따라간다.
 */
export const INFLATION_POLICY = {
    /** 연 물가상승률 (%) — 한국은행 물가안정목표 2% 보다 한 단계 보수적으로 잡은 값 */
    RATE_PERCENT: 3,
    /** 실질가치 환산 기준연도 — 이 해 1월의 화폐가치를 1로 본다 */
    BASE_YEAR: 2026,
} as const

/**
 * 성장자산 정책 — 기본값
 * '월 정기매수(성장자산)' 이벤트를 새로 만들 때 채워 넣는 연 수익률이며, 행마다 자유롭게 바꿀 수 있다.
 *
 * 기준 근거 — QQQ 의 지난 27년 실적은 약 13배(+1300%)이고, 이는 연 복리로 환산하면 약 10% 다.
 * 1) 과거 최고 구간의 실적을 그대로 미래 가정으로 쓰면 낙관 편향이 생기고,
 * 2) 이 엔진은 "그 해 넣은 돈도 그 해 수익을 온전히 받는" 방식이라 실제 적립식보다 반년치 수익이 더 붙는다.
 * 3) 그래서 27년 기준 약 10배(+1000%) 수준으로 한 단계 깎은 연 9% 를 보수적 기본값으로 쓴다.
 *    (연 9% × 27년 ≒ 10.2배 · 연 10% × 27년 ≒ 13.1배)
 *
 * 총수익 분해 — 위 9% 는 "주가상승 + 배당"을 합친 세전 총수익이다.
 * QQQ 실적 배당률이 연 0.6% 안팎이므로 주가상승 8.4% + 배당 0.6% 로 나눠 담아 총합 9% 를 유지한다.
 * 배당은 미국 원천징수 15% 를 떼고 재투자되므로 실제로 굴러가는 총수익은 8.4 + 0.6×0.85 = 연 8.91% 가 된다.
 */
export const GROWTH_POLICY = {
    /** 기본 연 주가상승률 (%) — 배당을 뺀 가격 상승분만 (총수익 9% − 배당 0.6%) */
    DEFAULT_PRICE_GROWTH_PERCENT: 8.4,
    /** 기본 연 배당수익률 (%, 세전) — QQQ 실적 배당률 수준 */
    DEFAULT_DIVIDEND_YIELD_PERCENT: 0.6,
} as const

/**
 * ISA(개인종합자산관리계좌) 정책 — 고정 상수
 *
 * 이 계좌의 배당은 지급 시점에 그대로 받는 현금으로 본다. 국내 상장 ETF 라 미국 원천징수 15% 가 없고,
 * 계좌 안이라 배당에 붙는 세금도 없다. 금융소득종합과세에도 건강보험료 부과 소득에도 잡히지 않는다.
 * 그래서 세율 상수가 하나도 없고, ISA 에만 남는 제약인 납입한도만 상수로 둔다.
 */
export const ISA_POLICY = {
    /** 연간 납입한도 (원) */
    ANNUAL_LIMIT_KRW: 20_000_000,
    /** 총 납입한도 (원) */
    TOTAL_LIMIT_KRW: 100_000_000,
} as const

/**
 * 주가 변동률 입력 정책 — 파일(워크북) 단위 설정
 *
 * 커버드콜 ETF(JEPQ)의 분배금은 기초자산 상승분을 옵션으로 팔아 만든 돈이라, 그만큼 주가 상승 여력이 깎인다.
 * 주가를 고정(0%)으로 두면 "배당은 다 받고 원금도 그대로"인 과하게 유리한 가정이 되므로
 * 시나리오마다 이 값을 음수로 내려 NAV 침식을 반영해 볼 수 있게 열어 둔다.
 * 반대로 나스닥100 같은 성장형 지수는 0 으로 두면 과하게 불리해지므로 종목 기본값이 양수로 들어온다.
 * (종목별 기본값은 assetConstants 의 defaultDriftPercent 를 따른다)
 */
export const PRICE_DRIFT_POLICY = {
    /** 입력 가능한 연 주가 변동률 범위 (%) */
    MIN_PERCENT: -20,
    MAX_PERCENT: 20,
} as const

/**
 * 실시간 시세 + 고정 세금 정책 → 시뮬레이션 상수 조립
 * — 아직 도착하지 않았거나 조회 실패한 항목은 종목별 폴백 값으로 대체한다.
 * — 계좌 유형에 따라 배당 원천징수율이 갈린다. ISA 계좌(국내 ETF)는 배당에 붙는 세금이 아예 없다.
 * @param asset 지금 보고 있는 종목 탭
 * @param sharePrice 조회된 1주 가격 (종목 통화 단위) — 없으면 폴백
 * @param monthlyDividend 조회된 주당 월 배당금 (종목 통화 단위) — 없으면 폴백
 * @param exchangeRate 조회된 원/달러 환율 — 원화 종목에서는 무시되고 1 이 들어간다
 */
export function resolveConstants(
    asset: CalcAsset,
    sharePrice: number | null,
    monthlyDividend: number | null,
    exchangeRate: number | null,
): SimulationConstants {
    const meta = CALC_ASSET_META[asset]
    const isIsa = meta.accountType === AccountType.ISA

    return {
        currency: meta.currency,
        accountType: meta.accountType,
        sharePriceNative: sharePrice ?? meta.fallback.sharePrice,
        monthlyDividendNative: monthlyDividend ?? meta.fallback.monthlyDividend,
        // 원화 종목은 이미 원 단위 시세라 환산할 것이 없다 — 환율 1 로 두면 아래 계산식이 그대로 성립한다
        exchangeRate: meta.currency === AssetCurrency.KRW
            ? 1
            : exchangeRate ?? FALLBACK_EXCHANGE_RATE,
        // 주가 변동률은 파일(워크북)마다 잡는 값이라 여기서는 종목 기본값을 두고 호출측에서 덮어쓴다
        sharePriceDriftPercent: meta.defaultDriftPercent,
        // ISA 계좌 안의 배당은 뗄 세금이 없어 지급액 전액이 그대로 들어온다
        withholdingRatePercent: isIsa ? 0 : TAX_POLICY.WITHHOLDING_RATE_PERCENT,
        comprehensiveThresholdKrw: TAX_POLICY.COMPREHENSIVE_THRESHOLD_KRW,
        comprehensiveRatePercent: TAX_POLICY.COMPREHENSIVE_RATE_PERCENT,
        healthRatePercent: HEALTH_INSURANCE_POLICY.RATE_PERCENT,
        healthIncomeThresholdKrw: HEALTH_INSURANCE_POLICY.INCOME_THRESHOLD_KRW,
        inflationRatePercent: INFLATION_POLICY.RATE_PERCENT,
        inflationBaseYear: INFLATION_POLICY.BASE_YEAR,
        isaAnnualLimitKrw: ISA_POLICY.ANNUAL_LIMIT_KRW,
        isaTotalLimitKrw: ISA_POLICY.TOTAL_LIMIT_KRW,
    }
}

/**
 * 새 이벤트 추가 시 채워 넣을 초기값
 * — 시작 연월은 파일의 대상 기간에 맞춘다. 오늘이 기간 안이면 이번 달, 밖이면 기간 첫 해 1월.
 *   기간이 2040~2060인 파일에 2026년짜리 이벤트가 생기면 아무 달에도 안 잡히기 때문이다.
 * @param startYear 대상 기간 시작 연도
 * @param endYear 대상 기간 종료 연도
 */
export function createNewEventDefault(startYear: number, endYear: number): Omit<InvestEvent, 'id'> {

    // 1) 오늘 연월이 대상 기간 안에 드는지 판정
    const now = new Date()
    const nowYear = now.getFullYear()
    const inRange = nowYear >= startYear && nowYear <= endYear

    // 2) 기간 안이면 이번 달, 밖이면 기간 첫 해 1월
    const startYm = inRange
        ? `${nowYear}-${String(now.getMonth() + 1).padStart(2, '0')}`
        : `${startYear}-01`

    return {
        type: EventType.ONE_TIME,
        startYm,
        endYm: '',
        amount: 0,
        // 투입 대상 기본값 — 주력 종목 매수. 확정수익 자산으로 굴리려면 행에서 대상을 바꾼다
        target: InvestTarget.MAIN,
        includesRecurring: false,
        // 재투자 구간으로 바꿨을 때의 기본값 — 기본 동작(재투자 함)과 일치시킨다
        reinvest: true,
        // 성장자산으로 바꿨을 때의 기본 연 주가상승률 / 배당수익률
        priceGrowthPercent: GROWTH_POLICY.DEFAULT_PRICE_GROWTH_PERCENT,
        dividendYieldPercent: GROWTH_POLICY.DEFAULT_DIVIDEND_YIELD_PERCENT,
    }
}

/** 이벤트 id 발급용 카운터 — 렌더 간 안정적인 key 보장 */
let eventSeq = 0

/** 신규 이벤트 id 발급 */
export function nextEventId(): string {
    eventSeq += 1
    return `evt_${Date.now()}_${eventSeq}`
}

/**
 * 탭 1개분 기본 이벤트 생성
 * — 새 탭은 항상 빈 상태로 시작한다. 사용자가 "+ 이벤트 추가"로 직접 채운다.
 */
export function createDefaultEvents(): InvestEvent[] {
    return []
}