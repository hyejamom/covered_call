import { SELL_PERCENTILE, SMA_LONG_WEEKS } from '../constants/analysisConstants'
import { PriceZone, type PriceHistory, type TechnicalReport } from '../types/technical'

// ══════════ 매수 / 매도 기준가 계산 ══════════
//
// 알고 싶은 것은 하나다 — 오늘 값에 사도 되나.
// 매달 적립하는 게 아니라 "괜찮은 값일 때만 사고 아니면 현금을 모으는" 방식이라,
// 기준선을 느슨하게 잡으면 규칙이 있으나 마나 해진다. 그래서 두 선을 모두 60주선 하나에 건다.
//
//   매수선 = 60주선             장기 추세선까지 눌린 자리.
//   매도선 = 60주선 + N%        상장 이후 이격도 상위 20%에 해당하는 과열 수준.
//
// 계산은 종목을 가리지 않는다. 넘어온 이력 하나만 보고 판정하므로 SPY 든 JEPQ 든 같은 잣대가 적용된다.
//
// [왜 60주선인가]
//   주봉 60개 = 약 1년 2개월. 일봉 200일선(약 10개월)보다는 길어 중간 흔들림에 선이 따라 내려오지 않고,
//   처음 잡았던 120주선(2년 4개월)보다는 짧아 몇 년째 오른 종목에서도 매수선이 손 닿는 거리에 있다.
//   그래도 기다리는 값을 치르는 규칙이므로 대기 현금은 반드시 이자 붙는 곳에 둬야 성립한다.
//
// [수정주가를 쓰지 않는 이유]
//   JEPQ 는 연 10%대를 분배해 수정주가 기준선이 무보정보다 눈에 띄게 낮게 나온다.
//   여기서 알고 싶은 것은 "내가 실제로 지불할 가격"이므로 무보정 종가로 계산한다.
//   배당이 적은 SPY 는 두 값 차이가 작지만, 종목마다 기준을 바꾸면 비교가 안 되므로 규칙을 통일한다.

// ┣━━━━━━━━━━━━━━━━ 상수 ━━━━━━━━━━━━━━━━━━━━━━┫

/** 1년 = 주봉 52개 */
const WEEKS_PER_YEAR = 52

// ┣━━━━━━━━━━━━━━━━ 내부 유틸 ━━━━━━━━━━━━━━━━━┫

/**
 * 단순이동평균 — 지정 지점까지의 최근 period 개 평균
 * @param values 주별 종가 배열 (과거 → 최신)
 * @param period 기간
 * @param endIndex 이 지점까지의 이동평균 (생략하면 마지막)
 * @returns 데이터가 모자라면 0
 */
function toSma(values: number[], period: number, endIndex?: number): number {
    const last = endIndex ?? values.length - 1
    if (last + 1 < period) return 0

    let sum = 0
    for (let index = last - period + 1; index <= last; index += 1) sum += values[index]
    return sum / period
}

/**
 * 백분위 값 — 정렬된 배열에서 비율에 해당하는 값 (선형 보간)
 * @param sorted 오름차순 정렬된 배열
 * @param ratio 0~1
 */
function toPercentileValue(sorted: number[], ratio: number): number {
    if (sorted.length === 0) return 0
    const position = (sorted.length - 1) * ratio
    const lower = Math.floor(position)
    const upper = Math.ceil(position)
    if (lower === upper) return sorted[lower]
    return sorted[lower] + ((sorted[upper] - sorted[lower]) * (position - lower))
}

// ┣━━━━━━━━━━━━━━━━ API ━━━━━━━━━━━━━━━━━━━━━━━┫

/**
 * 주별 종가 이력에서 매수/매도 기준가를 뽑는다.
 * @param history 상장 이후 전체 주별 종가
 */
export function toTechnicalReport(history: PriceHistory): TechnicalReport {
    const values = history.closes.map((item) => item.close)
    const price = history.price

    // 1) 축 — 60주 이동평균. 이 선이 곧 매수 기준선이다
    const smaLong = toSma(values, SMA_LONG_WEEKS)

    // 2) 상장 이후 이격도 표본 — 그 주 종가가 그 주의 60주선에서 몇 % 벌어져 있었는지
    const samples: number[] = []
    for (let index = SMA_LONG_WEEKS - 1; index < values.length; index += 1) {
        const ma = toSma(values, SMA_LONG_WEEKS, index)
        if (ma > 0) samples.push((values[index] / ma) - 1)
    }
    samples.sort((a, b) => a - b)

    // 3) 매도선 — 이격도 상위 20% 수준을 오늘의 60주선에 얹어 가격으로 되돌린다
    const sellDisparity = toPercentileValue(samples, SELL_PERCENTILE)
    const buyLevel = smaLong
    const sellLevel = smaLong * (1 + sellDisparity)

    // 4) 오늘의 이격도와 구간 판정
    const disparity = smaLong > 0 ? (price / smaLong) - 1 : 0
    const zone = price <= buyLevel ? PriceZone.CHEAP
        : price >= sellLevel ? PriceZone.EXPENSIVE
            : PriceZone.FAIR

    // 5) 최근 1년(52주) 중 매수 구간이 몇 주였는지 — 이 문이 얼마나 자주 열리는지 보여 준다
    let buyWeeksLastYear = 0
    const from = Math.max(SMA_LONG_WEEKS - 1, values.length - WEEKS_PER_YEAR)
    for (let index = from; index < values.length; index += 1) {
        const ma = toSma(values, SMA_LONG_WEEKS, index)
        if (ma > 0 && values[index] <= ma) buyWeeksLastYear += 1
    }

    // 6) 최근 1년 종가 범위에서의 절대 위치 — 이격도가 놓치는 "고점 근처인가"를 함께 본다
    const yearSlice = values.slice(Math.max(0, values.length - WEEKS_PER_YEAR))
    const yearLow = Math.min(...yearSlice)
    const yearHigh = Math.max(...yearSlice)
    const yearSpan = yearHigh - yearLow
    const yearRatio = yearSpan <= 0 ? 0.5 : Math.min(1, Math.max(0, (price - yearLow) / yearSpan))

    return {
        symbol: history.symbol,
        currency: history.currency,
        asOf: history.asOf,
        price,
        smaLong,
        buyLevel,
        sellLevel,
        sellDisparity,
        disparity,
        zone,
        buyWeeksLastYear,
        gapToBuy: price > 0 ? (price - buyLevel) / price : 0,
        gapToSell: price > 0 ? (sellLevel - price) / price : 0,
        yearRatio,
    }
}