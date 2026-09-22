import { useEffect, useState } from 'react'
import { CALC_ASSET_ORDER, type CalcAsset } from '../constants/assetConstants'
import {
    fetchDividend,
    fetchExchangeRate,
    fetchQuote,
    type DividendInfo,
    type ExchangeRateInfo,
    type QuoteInfo,
} from '../services/marketService'

/** 비동기 조회 상태 공통 형태 */
export interface AsyncState<T> {
    data: T | null
    loading: boolean
    error: string | null
}

/** 종목 1개분 시세 묶음 — 상단 카드 3장(주가 / 배당률 / 주당 월배당)이 이 값을 그대로 읽는다 */
export interface AssetMarketInfo {
    quote: AsyncState<QuoteInfo>
    dividend: AsyncState<DividendInfo>
    /** 배당수익률 (%) — 주가와 배당이 모두 도착해야 계산되므로 두 상태를 합성해 만든다 */
    dividendYield: AsyncState<number>
}

const INITIAL_STATE = { data: null, loading: true, error: null }

/** 종목별 상태 맵 초기값 — 모든 종목을 '불러오는 중'으로 세워 둔다 */
function createInitialMap<T>(): Record<CalcAsset, AsyncState<T>> {
    const map = {} as Record<CalcAsset, AsyncState<T>>
    CALC_ASSET_ORDER.forEach((asset) => {
        map[asset] = INITIAL_STATE
    })
    return map
}

/** 에러 객체에서 표시용 메시지 추출 */
function toErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : '알 수 없는 오류'
}

/**
 * 상단 카드용 시장 정보 조회 훅
 *
 * — 계산기가 종목 탭 2개를 오가므로, 탭을 바꿀 때마다 다시 부르지 않도록 마운트 시 두 종목을 한꺼번에 조회한다.
 *   탭 전환은 이미 받아 둔 값을 골라 쓰는 것뿐이라 즉시 그려지고, 조회 횟수도 진입당 한 번으로 끝난다.
 * — 시세 / 배당 / 환율을 각각 독립 상태로 관리해 하나가 실패해도 나머지는 표시된다.
 */
export function useMarketInfo() {

    // ┣━━━━━━━━━━━━━━━━ States ━━━━━━━━━━━━━━━━━━━━━┫
    const [quotes, setQuotes] = useState<Record<CalcAsset, AsyncState<QuoteInfo>>>(createInitialMap)          // 종목별 현재가
    const [dividends, setDividends] = useState<Record<CalcAsset, AsyncState<DividendInfo>>>(createInitialMap) // 종목별 배당 내역
    const [rate, setRate] = useState<AsyncState<ExchangeRateInfo>>(INITIAL_STATE)                             // 원/달러 환율 (미국 종목 전용)

    // ┣━━━━━━━━━━━━━━━━ Effects ━━━━━━━━━━━━━━━━━━━━┫
    useEffect(() => {
        // 1) 언마운트 이후 setState 방지용 플래그
        let alive = true

        /** 종목 1개 상태만 교체하는 공통 처리 — @param asset 대상 종목 @param next 새 상태 */
        const putQuote = (asset: CalcAsset, next: AsyncState<QuoteInfo>) => {
            if (alive) setQuotes((prev) => ({ ...prev, [asset]: next }))
        }
        const putDividend = (asset: CalcAsset, next: AsyncState<DividendInfo>) => {
            if (alive) setDividends((prev) => ({ ...prev, [asset]: next }))
        }

        // 2) 종목마다 시세·배당을 동시에 호출하고 각각 도착하는 대로 상태 반영
        CALC_ASSET_ORDER.forEach((asset) => {
            fetchQuote(asset)
                .then((data) => putQuote(asset, { data, loading: false, error: null }))
                .catch((error) => putQuote(asset, { data: null, loading: false, error: toErrorMessage(error) }))

            fetchDividend(asset)
                .then((data) => putDividend(asset, { data, loading: false, error: null }))
                .catch((error) => putDividend(asset, { data: null, loading: false, error: toErrorMessage(error) }))
        })

        // 3) 환율은 종목과 무관하게 한 번만 부른다 (원화 종목은 쓰지 않고, 미국 종목만 곱한다)
        fetchExchangeRate()
            .then((data) => alive && setRate({ data, loading: false, error: null }))
            .catch((error) => alive && setRate({ data: null, loading: false, error: toErrorMessage(error) }))

        return () => {
            alive = false
        }
    }, [])

    // ┣━━━━━━━━━━━━━━━━ Derived ━━━━━━━━━━━━━━━━━━━━┫
    // 1) 종목별로 배당수익률까지 붙인 묶음 — 화면은 선택된 탭의 항목 하나만 꺼내 쓴다
    //    배당수익률 = 최근 12개월 배당 합계 ÷ 현재가 (같은 통화끼리 나누므로 환율이 끼어들지 않는다)
    const byAsset = {} as Record<CalcAsset, AssetMarketInfo>
    CALC_ASSET_ORDER.forEach((asset) => {
        const quote = quotes[asset]
        const dividend = dividends[asset]

        const yieldPercent = quote.data && dividend.data && quote.data.price > 0
            ? (dividend.data.ttmDividend / quote.data.price) * 100
            : null

        byAsset[asset] = {
            quote,
            dividend,
            // 배당률 카드는 두 API에 모두 의존하므로 로딩/에러 상태를 합성한다
            dividendYield: {
                data: yieldPercent,
                loading: dividend.loading || quote.loading,
                error: dividend.error ?? quote.error,
            },
        }
    })

    return { byAsset, rate }
}
