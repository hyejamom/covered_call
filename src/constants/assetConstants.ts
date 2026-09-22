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
 * DRIFT_PRESETS 의 '중립' 과 같은 값이라, 여기를 바꾸면 중립 프리셋도 함께 따라간다.
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
 * JEPQ 의 기본 연 주가 변동률 (%) — DRIFT_PRESETS 의 '중립' 과 같은 값
 *
 * JEPQ 는 QYLD 와 구조가 다르다. 포트폴리오 전체에 등가격 콜을 기계적으로 파는 대신,
 * ELN 으로 외가격 콜을 일부에만 매도해 상승 여력을 상당 부분 남긴다. 그래서 NAV 가 깎이지 않고 올랐다.
 *   · JEPQ 2022-05 $49.19 → 2026-09 $59.78 (4.4년)  주가 CAGR +4.57%
 * 다만 이 구간은 2022년 저점 이후 강세장만 담겨 있어 그대로 장기 가정으로 쓰기엔 편향돼 있다.
 *
 * 그래서 중립값은 실적치가 아니라 "총수익이 기초지수와 맞아떨어지는 지점"으로 잡는다.
 * 이 엔진은 주가가 오르면 주당 배당도 같은 비율로 올리므로(분배율 유지),
 * 지금 분배율(연 14% 대)에서 주가를 0 으로 둬야 세후 총수익이 연 12% 대 — 나스닥100 장기 수익률 아래 — 가 된다.
 * 여기서 주가를 더 올리려면 분배율이 지금보다 낮아지는 경우를 함께 생각해야 한다.
 * (실적 CAGR 을 그대로 쓰고 싶으면 '낙관' 프리셋이 그 값이다)
 */
export const DEFAULT_JEPQ_DRIFT_PERCENT = 0

/**
 * 기초지수(나스닥100)의 장기 연 수익률 (%) — 가정이 과한지 판정하는 천장값.
 *
 * 커버드콜은 기초자산의 상승 여력을 옵션으로 팔아 분배금을 만드는 구조라, 장기적으로 기초지수를 이길 수 없다.
 * 그래서 "주가 변동률 + 세후 분배율"이 이 값을 넘어서면 성립하기 어려운 가정이며, 화면에서 그렇게 표시한다.
 * 세금·수수료 전 기준이고, 구간을 어디로 잡느냐에 따라 달라지므로 엄밀한 상한이 아니라 눈금으로만 쓴다.
 */
export const UNDERLYING_LONG_RUN_RETURN_PERCENT = 13

// ══════════ 주가 변동률 시나리오 프리셋 ══════════
// 주가 변동률은 이 계산기의 결과를 가장 크게 흔드는 단 하나의 가정이다.
// 연 -2.5% 와 연 7% 는 20년 뒤 자산이 5배 넘게 갈린다. 그래서 값 하나를 "정답"으로 박아 두는 대신
// 근거가 붙은 세 갈래(보수 · 중립 · 낙관)를 눌러 가며 비교하게 한다.
//
// 프리셋이 담는 것은 "주가 변동률" 하나뿐이다. 분배율은 실시간 시세에서 오고 엔진이 주가와 같은 비율로 끌고 가므로,
// 최종 총수익률은 (프리셋 × 그때의 분배율)로 정해진다 — 그 결과는 화면 미리보기에 함께 찍힌다.
//
// 왜 값이 0 근처이거나 음수인가 — "지수는 오르는데 왜 주가가 안 오르냐"에 대한 답이다.
//   커버드콜의 분배금은 공짜가 아니라 주가 상승분을 옵션으로 팔아 만든 현금이다. 즉 총수익 = 주가 + 분배금 이고,
//   이 둘은 한 파이를 나눠 갖는다. 매년 NAV 의 12% 를 현금으로 퍼내면 주가로는 남는 것이 거의 없다.
//
// 실측 (Yahoo Finance, 2026-09 기준) — 같은 구간에서 지수와 커버드콜이 어떻게 갈렸는지
//   · 2014-01~2026-09 (12.7년)  QQQ 주가 +759%(8.59배)  ↔  QYLD 주가 -26%
//     같은 기간 QYLD 총수익은 +8.65%/년(2.86배) — 돈이 사라진 게 아니라 전부 현금으로 나갔다 (분배 몫 11.02%p).
//   · 2022-09~2026-09 (4.0년)   QQQ 주가 +29.06%/년  ↔  JEPQ +10.01% · QYLD +4.30% · 441680 +2.26%
//     지수가 장기 평균의 세 배로 뛴 초강세장에서조차 커버드콜 주가는 이만큼밖에 못 올랐다.
//   · 2021-12~2023-12 (2.0년)   QQQ 주가 +1.46%/년   ↔  QYLD -11.61%/년
//     오를 땐 콜에 잘려 조금만 먹고 빠질 땐 그대로 맞는 비대칭 때문에, 횡보장에서 NAV 가 가장 빨리 깎인다.
//
// 산식으로도 같은 답이 나온다 — 주가 = 총수익 − 분배율 이고, 커버드콜 총수익은 구조상 지수를 넘을 수 없다.
//   주가 ≤ 10.7%(QQQ 27.4년 총수익) − 12.4%(TIGER 분배율) = -1.7%
//   즉 분배율이 지수의 장기 총수익보다 높은 한, 주가 가정은 0 근처이거나 음수일 수밖에 없다.

/** 주가 변동률 시나리오 — 보수 · 중립 · 낙관 세 갈래 */
export const DriftScenario = {
    /** 보수 — 옵션 프리미엄이 줄고 NAV 도 함께 밀리는 구간까지 감안한 하단 */
    CONSERVATIVE: 'CONSERVATIVE',
    /** 중립 — 새 파일의 기본값. 실적 또는 구조상 성립하는 중심값 */
    NEUTRAL: 'NEUTRAL',
    /** 낙관 — 지금까지의 최고 구간이 그대로 이어진다고 볼 때의 상단 */
    OPTIMISTIC: 'OPTIMISTIC',
} as const

export type DriftScenario = (typeof DriftScenario)[keyof typeof DriftScenario]

/** 프리셋 1개 — 화면의 버튼 하나에 대응 */
export interface DriftPreset {
    /** 버튼에 찍히는 이름 */
    label: string
    /** 연 주가 변동률 (%) */
    percent: number
    /** 이 값을 왜 이렇게 잡았는지 — 버튼 툴팁으로 그대로 노출된다 */
    reason: string
}

/** 버튼 배치 순서 — 왼쪽부터 보수 → 중립 → 낙관 */
export const DRIFT_SCENARIO_ORDER: DriftScenario[] = [
    DriftScenario.CONSERVATIVE,
    DriftScenario.NEUTRAL,
    DriftScenario.OPTIMISTIC,
]

/**
 * 종목별 시나리오 프리셋
 * — 같은 커버드콜이라도 콜을 파는 방식이 달라서, 이름이 같아도 값이 갈린다.
 *   TIGER 441680 은 등가격 콜을 100% 파는 구조라 상승 여력이 거의 안 남고,
 *   JEPQ 는 ELN 으로 외가격 콜을 일부만 팔아 상승 여력을 상당 부분 남긴다.
 */
export const DRIFT_PRESETS: Record<CalcAsset, Record<DriftScenario, DriftPreset>> = {
    [CalcAsset.TIGER_NASDAQ100_CC]: {
        [DriftScenario.CONSERVATIVE]: {
            label: '보수',
            percent: -4,
            reason: '지수가 횡보하는 구간 — 오를 땐 콜에 잘려 조금만 먹고 빠질 땐 그대로 맞는 비대칭이 가장 아프게 나온다.'
                + ' 실제로 QQQ 가 제자리였던 2021-12~2023-12 에 QYLD 주가는 연 -11.6% 였다. 그보다는 훨씬 완만하게 잡은 값이다.',
        },
        [DriftScenario.NEUTRAL]: {
            label: '중립',
            percent: DEFAULT_COVERED_CALL_DRIFT_PERCENT,
            reason: '같은 등가격 100% 매도 구조인 QYLD 의 실적 —'
                + ' 2014-01 $25.13 → 2026-09 $18.53, 12.7년 주가 CAGR -2.38% (같은 기간 QQQ 는 +759%).'
                + ' 산식으로도 맞물린다 — 주가 = 총수익 − 분배율 ≤ 10.7%(QQQ 27.4년 총수익) − 12.4%(분배율) = -1.7%.',
        },
        [DriftScenario.OPTIMISTIC]: {
            label: '낙관',
            percent: 2.5,
            reason: '441680 자기 실적 — 2022-09 9,965원 → 2026-09 10,875원, 4.0년 주가 CAGR +2.26%.'
                + ' 다만 이 구간은 나스닥100 이 연 29% 오른 초강세장이었고, 그런 장에서도 2.26% 밖에 못 올랐다.'
                + ' 즉 "앞으로도 지수가 연 29% 씩 오른다"에 거는 가정이다.',
        },
    },
    [CalcAsset.JEPQ]: {
        [DriftScenario.CONSERVATIVE]: {
            label: '보수',
            percent: -3,
            reason: '지수가 횡보하고 변동성도 낮아 ELN 프리미엄까지 줄어드는 구간 —'
                + ' 상승 여력을 남기는 구조라 QYLD 만큼 깎이지는 않지만, 분배율을 그대로 유지하면 NAV 는 밀린다.',
        },
        [DriftScenario.NEUTRAL]: {
            label: '중립',
            percent: DEFAULT_JEPQ_DRIFT_PERCENT,
            reason: '주가 보합 — 지금 분배율(연 14% 대)을 그대로 유지한다면'
                + ' 세후 총수익이 연 12% 대가 되어 나스닥100 장기 수익률 바로 아래에 맞물리는 지점이다.',
        },
        [DriftScenario.OPTIMISTIC]: {
            label: '낙관',
            percent: 5,
            reason: 'JEPQ 상장 이후 실적 — 2022-05 $49.21 → 2026-09 $61.01, 4.3년 주가 CAGR +5.08%.'
                + ' 같은 구간 나스닥100 이 연 29% 오른 초강세장이라, 그 장이 계속된다고 보는 가정이다'
                + ' (총수익이 기초지수를 넘어 미리보기에 경고가 함께 뜬다).',
        },
    },
}

/**
 * 지금 잡혀 있는 변동률이 어느 프리셋과 같은지 판정 — 어느 것과도 다르면 null (직접 입력한 값)
 * @param asset 지금 보고 있는 종목 탭
 * @param percent 현재 연 주가 변동률 (%)
 */
export function toActiveDriftScenario(asset: CalcAsset, percent: number): DriftScenario | null {
    const presets = DRIFT_PRESETS[asset]

    // 소수점이 붙는 값(-2.5 · 4.5)이라 부동소수 오차를 흡수하고 비교한다
    const matched = DRIFT_SCENARIO_ORDER.find((scenario) => Math.abs(presets[scenario].percent - percent) < 1e-9)
    return matched ?? null
}

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
