import { useEffect, useState } from 'react'
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

const INITIAL_STATE = { data: null, loading: true, error: null }

/** 에러 객체에서 표시용 메시지 추출 */
function toErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : '알 수 없는 오류'
}

/**
 * 상단 카드용 시장 정보 조회 훅
 * — 시세 / 배당률 / 환율을 각각 독립 상태로 관리해 하나가 실패해도 나머지는 표시된다.
 */
export function useMarketInfo() {

    // ┣━━━━━━━━━━━━━━━━ States ━━━━━━━━━━━━━━━━━━━━━┫
    const [quote, setQuote] = useState<AsyncState<QuoteInfo>>(INITIAL_STATE)             // JEPQ 현재가
    const [dividend, setDividend] = useState<AsyncState<DividendInfo>>(INITIAL_STATE)    // JEPQ 배당률
    const [rate, setRate] = useState<AsyncState<ExchangeRateInfo>>(INITIAL_STATE)        // 원/달러 환율

    // ┣━━━━━━━━━━━━━━━━ Effects ━━━━━━━━━━━━━━━━━━━━┫
    useEffect(() => {
        // 1) 언마운트 이후 setState 방지용 플래그
        let alive = true

        // 2) 세 API를 동시에 호출하고 각각 도착하는 대로 상태 반영
        fetchQuote()
            .then((data) => alive && setQuote({ data, loading: false, error: null }))
            .catch((error) => alive && setQuote({ data: null, loading: false, error: toErrorMessage(error) }))

        fetchDividend()
            .then((data) => alive && setDividend({ data, loading: false, error: null }))
            .catch((error) => alive && setDividend({ data: null, loading: false, error: toErrorMessage(error) }))

        fetchExchangeRate()
            .then((data) => alive && setRate({ data, loading: false, error: null }))
            .catch((error) => alive && setRate({ data: null, loading: false, error: toErrorMessage(error) }))

        return () => {
            alive = false
        }
    }, [])

    // ┣━━━━━━━━━━━━━━━━ Derived ━━━━━━━━━━━━━━━━━━━━┫
    // 1) 배당수익률 = 최근 12회 배당 합계 ÷ 현재가 — 시세와 배당이 모두 도착해야 계산 가능
    const yieldPercent = quote.data && dividend.data && quote.data.price > 0
        ? (dividend.data.ttmDividend / quote.data.price) * 100
        : null

    // 2) 배당률 카드는 두 API에 모두 의존하므로 로딩/에러 상태를 합성
    const dividendYield: AsyncState<number> = {
        data: yieldPercent,
        loading: dividend.loading || quote.loading,
        error: dividend.error ?? quote.error,
    }

    return { quote, dividend, rate, dividendYield }
}