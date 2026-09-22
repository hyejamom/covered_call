// ══════════ 계산기 종목 상수 ══════════
// 계산기(1페이지)는 종목 2개를 각각의 탭으로 나눠 굴린다. 두 탭은 화면 구성 · 이벤트 · 엑셀까지
// 완전히 같은 레파토리를 쓰고, 아래 메타로 갈리는 부분만 달라진다.
//
// 둘 다 나스닥100 을 기초로 콜을 파는 커버드콜 ETF 라 배당 성격(월배당 · 연 10%대 분배율)은 같다.
// 진짜 차이는 "어느 계좌에 담느냐"이고, 그게 세금 흐름 전체를 가른다.
//   1) ISA 계좌 · TIGER 미국나스닥100커버드콜(합성) — 국내 상장 원화 ETF.
//      국내 종목이라 미국 원천징수 15% 가 없고, ISA 계좌 안이라 분배금에 붙는 세금도 없다.
//      그 소득이 금융소득종합과세에도 건보료에도 잡히지 않는 것이 이 계좌를 쓰는 이유다.
//   2) 일반 계좌 · JEPQ — 미국 상장 ETF. 배당마다 미국이 15% 를 떼고,
//      연 금융소득이 커지면 종합과세 · 건보료가 따라붙는다.
// tsconfig erasableSyntaxOnly 설정으로 enum 문법을 쓸 수 없어 const 객체 + 동일명 타입으로 대체한다.

/** 계산기에서 굴릴 수 있는 종목 */
export const CalcAsset = {
    /** 1번 탭 — ISA 계좌로 담는 TIGER 미국나스닥100커버드콜(합성) */
    TIGER_NASDAQ100_CC: 'TIGER_NASDAQ100_CC',
    /** 2번 탭 — 일반 계좌로 담는 JEPQ */
    JEPQ: 'JEPQ',
} as const

export type CalcAsset = (typeof CalcAsset)[keyof typeof CalcAsset]

/**
 * 계좌 유형 — 세금 흐름 전체가 여기서 갈린다.
 * ISA 계좌 안의 국내 ETF 분배금에는 붙는 세금이 없어 지급액이 그대로 들어오고,
 * 그 소득이 금융소득종합과세·건보료 산정에도 잡히지 않는다.
 */
export const AccountType = {
    /** 중개형 ISA — 배당에 붙는 세금 없음. 남는 제약은 연 2,000만원 · 총 1억원 납입한도뿐 */
    ISA: 'ISA',
    /** 일반 위탁 계좌 — 배당 지급 시점 원천징수 + 연 합산 종합과세 */
    GENERAL: 'GENERAL',
} as const

export type AccountType = (typeof AccountType)[keyof typeof AccountType]

/** 시세 통화 — KRW 종목은 환율을 곱하지 않는다 */
export const AssetCurrency = {
    KRW: 'KRW',
    USD: 'USD',
} as const

export type AssetCurrency = (typeof AssetCurrency)[keyof typeof AssetCurrency]

/**
 * 시뮬레이션에 넣을 "주당 월 배당금" 산출 방식
 * — 엔진은 매달 배당이 나오는 구조로 계산하므로, 월배당이 아닌 종목은 연 배당을 12로 나눠 평탄화한다.
 */
export const DividendBasis = {
    /** 최근 1회 지급액을 그대로 월 배당으로 쓴다 — 월배당 종목(JEPQ) */
    LATEST: 'LATEST',
    /** 최근 12개월 지급액 합계 ÷ 12 — 분기·연 배당 종목(국내 ETF) */
    TTM_AVERAGE: 'TTM_AVERAGE',
} as const

export type DividendBasis = (typeof DividendBasis)[keyof typeof DividendBasis]

/** 배당 내역 조회처 — Nasdaq 배당 API 는 국내 종목을 지원하지 않아 종목별로 갈라 쓴다 */
export const DividendSource = {
    /** api.nasdaq.com 배당 내역 — 미국 상장 종목 전용 */
    NASDAQ: 'NASDAQ',
    /** Yahoo chart events=div — 국내 종목 포함 어디서나 동작하지만 지급액 정밀도가 낮다 */
    YAHOO: 'YAHOO',
} as const

export type DividendSource = (typeof DividendSource)[keyof typeof DividendSource]

/**
 * 100% 커버드콜(ATM 매도) 계열의 기본 연 주가 변동률 (%) — TIGER 441680 탭이 이 값에서 출발한다.
 *
 * 커버드콜은 기초자산 상승분을 옵션으로 팔아 분배금을 만든다. 즉 분배금의 재원은 상승 여력이고,
 * 그래서 주가는 장기적으로 조금씩 밀린다. 이 값을 0 으로 두면
 * "분배율 12% 를 수십 년 받으면서 원금은 한 푼도 안 깎인다"는, 성립할 수 없는 가정이 된다.
 *
 * 근거 — 나스닥100 커버드콜 ETF 의 실제 주가 이력 (2026-09 기준)
 *   · QYLD      2013-12 $25.54 → 2026-09 $18.34 (12.8년)  주가 CAGR -2.56%
 *   · JEPQ      2022-05 $49.19 → 2026-09 $59.78 ( 4.4년)  주가 CAGR +4.57%
 *   · 441680    2022-08 9,945원 → 2026-09 10,405원 ( 4.0년)  주가 CAGR +1.13%
 * 뒤 둘은 2022년 저점 이후 강세장만 담긴 짧은 구간이라 장기 가정으로 쓰기에 편향돼 있다.
 * 하락장(2022)을 포함한 온전한 사이클을 가진 QYLD 를 기준으로 삼아 -2.5% 를 기본값으로 둔다.
 *
 * 이 값을 넣으면 세후 총수익이 연 9% 대가 된다 (기초지수보다 낮고 0 보다는 현실적인 구간).
 * 어디까지나 출발점이므로, 시나리오마다 필터에서 직접 바꿔 가며 비교하는 것을 전제로 한다.
 */
export const DEFAULT_COVERED_CALL_DRIFT_PERCENT = -2.5

/**
 * JEPQ 의 기본 연 주가 변동률 (%)
 *
 * JEPQ 는 QYLD 와 구조가 다르다. 포트폴리오 전체에 등가격 콜을 기계적으로 파는 대신,
 * ELN 으로 외가격 콜을 일부에만 매도해 상승 여력을 상당 부분 남긴다. 그래서 NAV 가 깎이지 않고 올랐다.
 *   · JEPQ 2022-05 $49.19 → 2026-09 $59.78 (4.4년)  주가 CAGR +4.57%
 * 다만 이 구간은 2022년 저점 이후 강세장만 담겨 있어 그대로 장기 가정으로 쓰기엔 편향돼 있다.
 * 사용자 판단(연 7% 수준)을 기본값으로 두되, 아래를 알고 쓰는 것을 전제로 한다.
 *
 * ※ 주의 — 이 엔진은 주가가 오르면 주당 배당도 같은 비율로 올린다(분배율 유지).
 *   그래서 주가 +7% 를 넣으면 세후 총수익이 연 20% 안팎으로 잡히는데, 이는 기초지수인 나스닥100
 *   장기 수익률(연 13% 안팎)을 크게 웃돈다. 커버드콜은 상승분을 팔아 분배금을 만드는 구조라
 *   기초지수를 장기적으로 이길 수 없다. 즉 "주가 +7%" 와 "분배율 12~14%" 는 동시에 성립하기 어렵다.
 *   필터의 미리보기에 이 총수익률이 함께 찍히므로, 그 숫자를 보고 값을 조정하는 것을 권한다.
 */
export const DEFAULT_JEPQ_DRIFT_PERCENT = 7

/**
 * 기초지수(나스닥100)의 장기 연 수익률 (%) — 가정이 과한지 판정하는 천장값.
 *
 * 커버드콜은 기초자산의 상승 여력을 옵션으로 팔아 분배금을 만드는 구조라, 장기적으로 기초지수를 이길 수 없다.
 * 그래서 "주가 변동률 + 세후 분배율"이 이 값을 넘어서면 성립하기 어려운 가정이며, 화면에서 그렇게 표시한다.
 * 세금·수수료 전 기준이고, 구간을 어디로 잡느냐에 따라 달라지므로 엄밀한 상한이 아니라 눈금으로만 쓴다.
 */
export const UNDERLYING_LONG_RUN_RETURN_PERCENT = 13

/** 시세 조회 실패 시 쓸 폴백 값 — 화면이 빈칸으로 멈추지 않게 하는 용도 */
export interface AssetFallbackMarket {
    /** 1주 가격 (해당 종목 통화 단위) */
    sharePrice: number
    /** 주당 월 배당금 (해당 종목 통화 단위) */
    monthlyDividend: number
}

/** 종목별 메타 — 화면 표기 · 시세 조회 · 세금 정책이 모두 여기서 파생된다 */
export interface CalcAssetMeta {
    /** 탭 번호 — 사용자가 "1번 탭"으로 부르는 순번 */
    order: number
    /** 화면 표기명 — 카드 라벨 · 필터 문구 · 이벤트 대상 이름에 두루 쓰인다 */
    label: string
    /** 탭에 붙는 짧은 이름 */
    shortLabel: string
    /** 시세 조회에 쓰는 심볼 — Yahoo Finance 기준 (국내 종목은 '.KS' 접미) */
    symbol: string
    /** 화면에 노출하는 티커 */
    ticker: string
    /** 엑셀 파일명 접두 — 금지 문자가 없는 형태로 둔다 */
    fileTag: string
    currency: AssetCurrency
    accountType: AccountType
    /** 계좌 표기명 — 탭과 배지에 함께 노출한다 */
    accountLabel: string
    icon: string
    /** 탭 툴팁 */
    description: string
    dividendBasis: DividendBasis
    dividendSource: DividendSource
    /**
     * 확정수익 자산(QQQ 같은 성장형 ETF 를 따로 굴리다 한꺼번에 이관하는 통)을 쓸 수 있는 종목인지.
     * false 면 이 탭에서는 투입금이 무조건 주력 종목 매수로 바로 들어간다 —
     * 이벤트 목록에서 확정수익 타입·대상이 사라지고, 예전에 저장된 확정수익 이벤트도 주력 종목 매수로 접힌다.
     */
    supportsGrowthAsset: boolean
    /**
     * 새 파일의 기본 연 주가 변동률 (%) — DEFAULT_COVERED_CALL_DRIFT_PERCENT 참고.
     * 커버드콜은 분배금을 NAV 에서 꺼내 쓰는 구조라 이 값이 0 이면 계산이 통째로 낙관 쪽으로 기운다.
     */
    defaultDriftPercent: number
    fallback: AssetFallbackMarket
}

/**
 * 종목별 메타 정의
 *
 * TIGER 미국나스닥100커버드콜(합성) — 441680, 국내 상장 원화 ETF. 월배당이고 분배율이 연 12% 안팎이라
 *   배당 성격은 JEPQ 와 거의 같다. 다른 것은 계좌다 — ISA 안에서는 분배금에 세금이 붙지 않아
 *   지급액 전액이 그대로 들어오고, 그 소득이 종합과세·건보료 어디에도 잡히지 않는다.
 *   환율은 ETF 안에서 흡수되므로 곱하지 않는다.
 *
 * JEPQ — 미국 상장 커버드콜 ETF. 배당 지급 시점에 미국이 15% 를 떼고, 연 금융소득이 커지면
 *   종합과세 · 건보료가 따라붙는다. 지금까지 이 계산기가 다뤄 온 기준 종목이다.
 */
export const CALC_ASSET_META: Record<CalcAsset, CalcAssetMeta> = {
    [CalcAsset.TIGER_NASDAQ100_CC]: {
        order: 1,
        label: 'TIGER 미국나스닥100커버드콜',
        shortLabel: 'TIGER 나스닥100커버드콜',
        symbol: '441680.KS',
        ticker: '441680',
        fileTag: 'TIGER나스닥100커버드콜_ISA',
        currency: AssetCurrency.KRW,
        accountType: AccountType.ISA,
        accountLabel: 'ISA 계좌',
        icon: '🇰🇷',
        description: 'ISA 계좌 · TIGER 미국나스닥100커버드콜(합성) 적립 시뮬레이션',
        // 월배당 종목이라 최근 1회 지급액이 곧 월 배당금이다
        dividendBasis: DividendBasis.LATEST,
        dividendSource: DividendSource.YAHOO,
        // 납입한도가 걸린 계좌라 "언제 얼마를 어디에 넣을지"를 나눠 굴릴 여지가 있다
        supportsGrowthAsset: true,
        // 나스닥100 커버드콜 공통 가정 — QYLD 12.8년 실적 기준 (근거는 상수 정의 참고)
        defaultDriftPercent: DEFAULT_COVERED_CALL_DRIFT_PERCENT,
        // 시세 조회 실패 시 폴백 — 2026-09-10 기준 (원). 최근 12회 분배금 합계 1,340원 (분배율 약 12.9%)
        fallback: { sharePrice: 10_415, monthlyDividend: 108 },
    },
    [CalcAsset.JEPQ]: {
        order: 2,
        label: 'JEPQ',
        shortLabel: 'JEPQ',
        symbol: 'JEPQ',
        ticker: 'JEPQ',
        fileTag: 'JEPQ',
        currency: AssetCurrency.USD,
        accountType: AccountType.GENERAL,
        accountLabel: '일반 계좌',
        icon: '🇺🇸',
        description: '일반 계좌 · JEPQ 적립·배당 시뮬레이션',
        dividendBasis: DividendBasis.LATEST,
        dividendSource: DividendSource.NASDAQ,
        // JEPQ 탭은 "넣은 돈이 곧바로 JEPQ 주식이 되고 그 배당을 다시 JEPQ 에 넣는다"는 한 갈래만 본다.
        // 중간에 다른 자산을 끼우면 보유주·배당이 늘지 않아 정작 보려던 배당 복리가 가려진다.
        supportsGrowthAsset: false,
        // 같은 커버드콜이지만 상승 여력을 남기는 설계라 TIGER 탭과 가정을 분리한다 (상수 정의 참고)
        defaultDriftPercent: DEFAULT_JEPQ_DRIFT_PERCENT,
        // 2026-08-10 기준 (USD)
        fallback: { sharePrice: 59.74, monthlyDividend: 0.70497 },
    },
}

/** 탭 배치 순서 — 왼쪽부터 1번(TIGER 커버드콜 · ISA), 2번(JEPQ · 일반) */
export const CALC_ASSET_ORDER: CalcAsset[] = [CalcAsset.TIGER_NASDAQ100_CC, CalcAsset.JEPQ]

/** 진입 시 기본으로 열리는 종목 탭 */
export const DEFAULT_CALC_ASSET: CalcAsset = CalcAsset.TIGER_NASDAQ100_CC

/**
 * 예전 저장본에 쓰이던 종목 키 → 현재 키
 * — 종목 키를 갈아 끼울 때 이미 저장된 칸이 통째로 버려지지 않도록 여기서 흡수한다.
 *   (v3 도입 직후 1번 탭이 'TIGER_NASDAQ100'(일반 나스닥100)이었다가 커버드콜로 정정됐다)
 */
export const LEGACY_CALC_ASSET_KEY: Record<string, CalcAsset> = {
    TIGER_NASDAQ100: CalcAsset.TIGER_NASDAQ100_CC,
}

/** 통화별 금액 단위 표기 — 상단 카드의 unit 칸에 쓴다 */
export const CURRENCY_UNIT_LABEL: Record<AssetCurrency, string> = {
    [AssetCurrency.KRW]: '원',
    [AssetCurrency.USD]: 'USD',
}

/**
 * 저장된 문자열이 아는 종목인지 판정 — 스냅샷 복원 시 낯선 키를 걸러내는 데 쓴다
 * @param value 검사할 값
 */
export function isCalcAsset(value: unknown): value is CalcAsset {
    return typeof value === 'string' && Object.prototype.hasOwnProperty.call(CALC_ASSET_META, value)
}
