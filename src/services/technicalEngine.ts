import { PriceZone, type PriceHistory, type TechnicalReport } from '../types/technical'

// ══════════ 매수 / 매도 기준가 계산 ══════════
//
// 알고 싶은 것은 하나다 — 오늘 값에 사도 되나.
// 매달 적립하는 게 아니라 "괜찮은 값일 때만 사고 아니면 현금을 모으는" 방식이라,
// 기준선을 느슨하게 잡으면 규칙이 있으나 마나 해진다. 그래서 두 선을 모두 200일선 하나에 건다.
//
//   매수선 = 200일선            장기 추세선까지 눌린 자리. 상장 이후 전체의 약 18% 기간만 열렸다.
//   매도선 = 200일선 + N%       상장 이후 이격도 상위 10%에 해당하는 과열 수준.
//
// [왜 200일선인가]
//   상장 이후 실데이터로 "매달 매수 / 200일선 터치 / 이격도 하위 20% / 200일선 -3%"를 비교한 결과,
//   기다리는 규칙 중에서는 200일선 터치가 평균단가와 최종 수익률 모두 가장 나았다.
//   단 대기 현금을 놀리면 못 받은 분배금이 진입가 이득을 넘어선다. 현금은 이자 붙는 곳에 둬야 성립하는 규칙이다.
//
// [수정주가를 쓰지 않는 이유]
//   JEPQ 는 연 10%대를 분배해 수정주가 200일선이 무보정보다 $2 이상 낮게 나온다.
//   여기서 알고 싶은 것은 "내가 실제로 지불할 가격"이므로 무보정 종가로 계산한다.

// ┣━━━━━━━━━━━━━━━━ 상수 ━━━━━━━━━━━━━━━━━━━━━━┫

/** 기준선의 축이 되는 이동평균 기간 */
const SMA_LONG = 200

/** 52주 = 거래일 기준 약 252일 */
const TRADING_DAYS_PER_YEAR = 252

/** 매도선 백분위 — 상장 이후 이격도 분포에서 이 지점을 과열로 본다 */
const SELL_PERCENTILE = 0.9

// ┣━━━━━━━━━━━━━━━━ 내부 유틸 ━━━━━━━━━━━━━━━━━┫

/**
 * 단순이동평균 — 지정 지점까지의 최근 period 개 평균
 * @param values 종가 배열 (과거 → 최신)
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
 * 일별 종가 이력에서 매수/매도 기준가를 뽑는다.
 * @param history 상장 이후 전체 일별 종가
 */
export function toTechnicalReport(history: PriceHistory): TechnicalReport {
    const values = history.closes.map((item) => item.close)
    const price = history.price

    // 1) 축 — 200일 이동평균. 이 선이 곧 매수 기준선이다
    const sma200 = toSma(values, SMA_LONG)

    // 2) 상장 이후 이격도 표본 — 그날 종가가 그날의 200일선에서 몇 % 벌어져 있었는지
    const samples: number[] = []
    for (let index = SMA_LONG - 1; index < values.length; index += 1) {
        const ma = toSma(values, SMA_LONG, index)
        if (ma > 0) samples.push((values[index] / ma) - 1)
    }
    samples.sort((a, b) => a - b)

    // 3) 매도선 — 이격도 상위 10% 수준을 오늘의 200일선에 얹어 가격으로 되돌린다
    const sellDisparity = toPercentileValue(samples, SELL_PERCENTILE)
    const buyLevel = sma200
    const sellLevel = sma200 * (1 + sellDisparity)

    // 4) 오늘의 이격도와 구간 판정
    const disparity = sma200 > 0 ? (price / sma200) - 1 : 0
    const zone = price <= buyLevel ? PriceZone.CHEAP
        : price >= sellLevel ? PriceZone.EXPENSIVE
            : PriceZone.FAIR

    // 5) 최근 1년 중 매수 구간이 며칠이었는지 — 이 문이 얼마나 드물게 열리는지 보여 준다
    let buyDaysLastYear = 0
    const from = Math.max(SMA_LONG - 1, values.length - TRADING_DAYS_PER_YEAR)
    for (let index = from; index < values.length; index += 1) {
        const ma = toSma(values, SMA_LONG, index)
        if (ma > 0 && values[index] <= ma) buyDaysLastYear += 1
    }

    // 6) 최근 1년 종가 범위에서의 절대 위치 — 이격도가 놓치는 "고점 근처인가"를 함께 본다
    const yearSlice = values.slice(Math.max(0, values.length - TRADING_DAYS_PER_YEAR))
    const yearLow = Math.min(...yearSlice)
    const yearHigh = Math.max(...yearSlice)
    const yearSpan = yearHigh - yearLow
    const yearRatio = yearSpan <= 0 ? 0.5 : Math.min(1, Math.max(0, (price - yearLow) / yearSpan))

    return {
        asOf: history.asOf,
        price,
        sma200,
        buyLevel,
        sellLevel,
        sellDisparity,
        disparity,
        zone,
        gapToBuy: price > 0 ? (price - buyLevel) / price : 0,
        gapToSell: price > 0 ? (sellLevel - price) / price : 0,
        buyDaysLastYear,
        yearRatio,
    }
}