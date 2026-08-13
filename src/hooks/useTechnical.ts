import { useEffect, useState } from 'react'
import { fetchPriceHistory } from '../services/marketService'
import { toTechnicalReport } from '../services/technicalEngine'
import type { TechnicalReport } from '../types/technical'
import type { AsyncState } from './useMarketInfo'

/**
 * JEPQ 기술적 지표 판독 훅
 * — 상장 이후 일별 종가를 한 번 받아 오고, 이동평균·RSI·MACD·범위 내 위치를 전부 직접 계산한다.
 * — 지표 API 를 쓰지 않는 이유는 제공처마다 값이 갈리기 때문이다. 원본 종가 하나만 신뢰한다.
 */
export function useTechnical() {

    // ┣━━━━━━━━━━━━━━━━ States ━━━━━━━━━━━━━━━━━━━━━┫
    const [report, setReport] = useState<AsyncState<TechnicalReport>>({
        data: null,
        loading: true,
        error: null,
    })

    // ┣━━━━━━━━━━━━━━━━ Effects ━━━━━━━━━━━━━━━━━━━━┫

    // 1) 최초 1회 조회 — 화면에 들어올 때마다 다시 받지 않도록 App 이 아니라 이 화면에서만 돈다
    useEffect(() => {
        let alive = true

        fetchPriceHistory()
            .then((history) => {
                if (!alive) return
                setReport({ data: toTechnicalReport(history), loading: false, error: null })
            })
            .catch((error: unknown) => {
                if (!alive) return
                const message = error instanceof Error ? error.message : '알 수 없는 오류'
                setReport({ data: null, loading: false, error: message })
            })

        return () => {
            alive = false
        }
    }, [])

    return report
}