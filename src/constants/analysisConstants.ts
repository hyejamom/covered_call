// ══════════ 3페이지 · 분석 대상 종목 ══════════
// 같은 규칙(200일선 = 매수선, 200일선 + 이격도 상위 10% = 과열선)을 여러 종목에 그대로 적용한다.
// 계산은 전부 동일하고 종목마다 다른 것은 "기다리는 비용"의 성격뿐이라, 그 문구만 여기에 따로 둔다.
// tsconfig erasableSyntaxOnly 설정으로 enum 문법을 쓸 수 없어 const 객체 + 동일명 타입으로 대체한다.

/** 분석 대상 종목 */
export const AnalysisSymbol = {
    /** 커버드콜 ETF — 이 도구의 주 종목 */
    JEPQ: 'JEPQ',
    /** S&P 500 ETF — 같은 잣대로 비교하는 기준 지수 */
    SPY: 'SPY',
} as const

export type AnalysisSymbol = (typeof AnalysisSymbol)[keyof typeof AnalysisSymbol]

/** 종목별 표기 정보 */
export interface AnalysisSymbolMeta {
    /** 카드 머리띠 부제 — 이게 무슨 종목인지 */
    name: string
    /**
     * 기다리는 비용 안내.
     * 두 종목 모두 "쌀 때만 산다"는 같은 규칙을 쓰지만, 기다리는 값을 치르는 방식이 정반대라
     * 이 한 줄을 종목마다 다르게 적어 둔다.
     */
    waitingNote: string
}

export const ANALYSIS_SYMBOL_META: Record<AnalysisSymbol, AnalysisSymbolMeta> = {
    [AnalysisSymbol.JEPQ]: {
        name: '커버드콜 ETF · 월배당',
        waitingNote: '기다리는 동안 현금을 놀리면 못 받은 분배금(연 10%대)이 진입가 이득을 넘어섭니다.'
            + ' 대기 자금은 이자가 붙는 곳에 두셔야 이 규칙이 성립합니다.',
    },
    [AnalysisSymbol.SPY]: {
        name: 'S&P 500 ETF · 분기배당',
        waitingNote: 'SPY는 배당이 연 1%대라 기다리는 값을 분배금이 아니라 상승분으로 치릅니다.'
            + ' 상승장에서는 200일선이 몇 년씩 열리지 않으니, 이 선 하나만 보고 전액을 현금으로 세워 두지는 마세요.',
    },
}

/** 카드 배치 순서 — 위에서 아래로 */
export const ANALYSIS_SYMBOL_ORDER: AnalysisSymbol[] = [AnalysisSymbol.JEPQ, AnalysisSymbol.SPY]
