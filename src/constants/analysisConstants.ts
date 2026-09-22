// ══════════ 3페이지 · 분석 대상 종목 ══════════
// 같은 규칙(60주선 = 매수선, 60주선 + 이격도 상위 20% = 과열선)을 여러 종목에 그대로 적용한다.
// 계산은 전부 동일하고 종목마다 다른 것은 "기다리는 비용"의 성격뿐이라, 그 문구만 여기에 따로 둔다.
// tsconfig erasableSyntaxOnly 설정으로 enum 문법을 쓸 수 없어 const 객체 + 동일명 타입으로 대체한다.

/**
 * 기준선의 축이 되는 이동평균 기간 — 주봉 60개(약 1년 2개월).
 * 계산(technicalEngine)과 화면 표기(AnalysisView)가 같은 값을 봐야 하므로 여기 한 곳에만 둔다.
 *
 * [왜 120주에서 줄였나]
 *   2년 4개월 평균은 몇 년째 오른 종목에서 현재가 한참 아래에 깔려 매수선이 사실상 닿지 않았다.
 *   (NVDA -27%, 삼성전자 -56%, SK하이닉스 -64%) 기다리는 규칙이라도 열리지 않는 문은 규칙이 아니다.
 */
export const SMA_LONG_WEEKS = 60

/** 기준선 표기명 — "60주선" */
export const BASELINE_LABEL = `${SMA_LONG_WEEKS}주선`

/**
 * 매도선을 만드는 이격도 백분위 — 상장 이후 분포에서 이 지점부터 과열로 본다.
 *
 * 상위 10%는 AI 랠리 같은 극단값을 그대로 물고 와 매도선이 현재가보다 배 이상 위로 떠올랐다.
 * (TSLA +171%, PLTR +119%) 상위 20%로 낮춰 두 기준선 사이 폭을 평균 86% → 32% 로 좁혔다.
 * 계산(technicalEngine)과 근거 문구(AnalysisView)가 같은 값을 봐야 하므로 여기 한 곳에만 둔다.
 */
export const SELL_PERCENTILE = 0.8

/** 매도선 표기명 — "상위 20%" */
export const SELL_ZONE_LABEL = `상위 ${Math.round((1 - SELL_PERCENTILE) * 100)}%`

/**
 * 분석 대상 종목 — 값은 Yahoo Finance 조회 심볼 그대로다.
 * 한국 종목은 '종목코드.KS'(KOSPI) 형태여야 조회가 되고, 시세도 원화로 내려온다.
 */
export const AnalysisSymbol = {
    /** 커버드콜 ETF — 이 도구의 주 종목 */
    JEPQ: 'JEPQ',
    /** S&P 500 ETF — 같은 잣대로 비교하는 기준 지수 */
    SPY: 'SPY',
    /** 나스닥 100 ETF — JEPQ가 콜을 파는 바로 그 기초지수 */
    QQQ: 'QQQ',
    /** 알파벳 클래스 A — 의결권이 있는 구글 주식 */
    GOOGL: 'GOOGL',
    /** 메타 플랫폼스 */
    META: 'META',
    /** 엔비디아 */
    NVDA: 'NVDA',
    /** 테슬라 */
    TSLA: 'TSLA',
    /** 팔란티어 테크놀로지스 */
    PLTR: 'PLTR',
    /** 삼성전자 (KOSPI 005930) — 원화 시세 */
    SAMSUNG: '005930.KS',
    /** SK하이닉스 (KOSPI 000660) — 원화 시세 */
    SK_HYNIX: '000660.KS',
} as const

export type AnalysisSymbol = (typeof AnalysisSymbol)[keyof typeof AnalysisSymbol]

/** 종목별 표기 정보 */
export interface AnalysisSymbolMeta {
    /**
     * 카드 머리띠에 크게 찍는 표기용 코드.
     * 조회 심볼과 다를 수 있다 — '005930.KS'를 그대로 보여 주면 무슨 종목인지 읽히지 않는다.
     */
    ticker: string
    /** 카드 머리띠 부제 — 이게 무슨 종목인지 */
    name: string
    /**
     * 기다리는 비용 안내.
     * 모든 종목이 "쌀 때만 산다"는 같은 규칙을 쓰지만, 기다리는 값을 치르는 방식이 종목마다 달라
     * 이 한 줄을 종목마다 다르게 적어 둔다.
     */
    waitingNote: string
}

export const ANALYSIS_SYMBOL_META: Record<AnalysisSymbol, AnalysisSymbolMeta> = {
    [AnalysisSymbol.JEPQ]: {
        ticker: 'JEPQ',
        name: '커버드콜 ETF · 월배당',
        waitingNote: '기다리는 동안 현금을 놀리면 못 받은 분배금(연 10%대)이 진입가 이득을 넘어섭니다.'
            + ' 대기 자금은 이자가 붙는 곳에 두셔야 이 규칙이 성립합니다.',
    },
    [AnalysisSymbol.SPY]: {
        ticker: 'SPY',
        name: 'S&P 500 ETF · 분기배당',
        waitingNote: 'SPY는 배당이 연 1%대라 기다리는 값을 분배금이 아니라 상승분으로 치릅니다.'
            + ` 상승장에서는 ${SMA_LONG_WEEKS}주선이 몇 달씩 열리지 않으니, 이 선 하나만 보고 전액을 현금으로 세워 두지는 마세요.`,
    },
    [AnalysisSymbol.QQQ]: {
        ticker: 'QQQ',
        name: '나스닥 100 ETF · 분기배당',
        waitingNote: 'QQQ는 배당이 연 0.5%대라 기다리는 값을 사실상 전부 놓친 상승분으로 치릅니다.'
            + ' 변동이 SPY보다 커서 문이 열릴 때는 깊게 열리지만, 열리지 않는 기간도 그만큼 깁니다.',
    },
    [AnalysisSymbol.GOOGL]: {
        ticker: 'GOOGL',
        name: '알파벳 A · 개별 종목',
        waitingNote: '지수와 달리 회사 하나의 사정으로 선이 무너질 수 있는 개별 종목입니다.'
            + ` ${SMA_LONG_WEEKS}주선 아래로 내려온 이유가 단순 조정인지 실적 훼손인지는 이 지표가 구분해 주지 못합니다.`,
    },
    [AnalysisSymbol.META]: {
        ticker: 'META',
        name: '메타 플랫폼스 · 개별 종목',
        waitingNote: '반년 만에 70% 빠졌다가 되돌린 이력(2022년)이 있어 이격도 폭 자체가 넓습니다.'
            + ' 매수선이 열려도 한참 더 내려갈 수 있으니 한 번에 전액을 넣는 방식과는 맞지 않습니다.',
    },
    [AnalysisSymbol.NVDA]: {
        ticker: 'NVDA',
        name: '엔비디아 · 개별 종목',
        waitingNote: '몇 년째 추세가 가팔라 기준선이 현재가에서 한참 아래에 깔려 있습니다.'
            + ' 매수선이 열린다면 그건 싸진 게 아니라 추세가 꺾였다는 뜻일 수 있으니 값만 보고 들어가지 마세요.',
    },
    [AnalysisSymbol.TSLA]: {
        ticker: 'TSLA',
        name: '테슬라 · 개별 종목',
        waitingNote: '고점 대비 반토막을 여러 번 겪은 종목이라 과열선과 매수선 사이 간격이 유난히 넓습니다.'
            + ' 무배당이라 기다리는 동안 받는 것이 없고, 구간 안에서 머무는 시간도 짧습니다.',
    },
    [AnalysisSymbol.PLTR]: {
        ticker: 'PLTR',
        name: '팔란티어 · 개별 종목',
        waitingNote: '2020년 상장이라 표본 기간이 짧고 변동이 극단적이어서 기준선의 신뢰도가 다른 종목보다 낮습니다.'
            + ' 무배당이라 기다리는 동안 받는 것도 없으니 참고용 이상으로 쓰지 마세요.',
    },
    [AnalysisSymbol.SAMSUNG]: {
        ticker: '삼성전자',
        name: 'KOSPI 005930 · 원화 시세',
        waitingNote: '원화 종목이라 카드의 모든 값이 원 단위입니다 — 달러 종목과 금액을 직접 비교하지 마세요.'
            + ' 배당은 연 2%대라 기다리는 비용이 JEPQ보다 훨씬 가볍습니다.',
    },
    [AnalysisSymbol.SK_HYNIX]: {
        ticker: 'SK하이닉스',
        name: 'KOSPI 000660 · 원화 시세',
        waitingNote: '메모리 사이클을 타는 종목이라 실적이 적자와 사상 최대를 몇 년 주기로 오갑니다.'
            + ` 업황 바닥에서는 ${SMA_LONG_WEEKS}주선 아래에 오래 머무니, 선에 닿았다고 한 번에 담지 마세요.`,
    },
}

/** 카드 배치 순서 — 위에서 아래로 (ETF → 미국 개별 종목 → 한국 개별 종목) */
export const ANALYSIS_SYMBOL_ORDER: AnalysisSymbol[] = [
    AnalysisSymbol.JEPQ,
    AnalysisSymbol.SPY,
    AnalysisSymbol.QQQ,
    AnalysisSymbol.GOOGL,
    AnalysisSymbol.META,
    AnalysisSymbol.NVDA,
    AnalysisSymbol.TSLA,
    AnalysisSymbol.PLTR,
    AnalysisSymbol.SAMSUNG,
    AnalysisSymbol.SK_HYNIX,
]
