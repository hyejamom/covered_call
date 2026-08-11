import { EventType, type InvestEvent, type SimulationConstants } from '../types/simulation'

// ══════════ 시뮬레이션 기본값 ══════════
// 시세 3종(주가·월배당·환율)은 상단 top_info 카드의 실시간 값을 그대로 쓰고,
// 세금 정책은 바뀔 일이 거의 없어 아래 고정값으로 못 박는다.
// 이벤트는 탭별로 독립 관리되며, 새 탭은 이벤트가 하나도 없는 빈 상태로 시작한다.

/** 세금 정책 — 고정 상수 (금융소득종합과세 기준 2,000만원 / 원천징수 15%) */
export const TAX_POLICY = {
    /** 연간 배당 합산 과세 기준 (원) */
    THRESHOLD_KRW: 20_000_000,
    /** 원천징수 세율 (%) */
    RATE_PERCENT: 15,
} as const

/** 시세 조회 실패 시 사용할 폴백 값 — 2026-08-10 기준 */
export const FALLBACK_MARKET = {
    sharePriceUsd: 59.74,
    monthlyDividendUsd: 0.70497,
    exchangeRate: 1420,
} as const

/**
 * 실시간 시세 + 고정 세금 정책 → 시뮬레이션 상수 조립
 * — 아직 도착하지 않았거나 조회 실패한 항목은 폴백 값으로 대체한다.
 */
export function resolveConstants(
    sharePriceUsd: number | null,
    monthlyDividendUsd: number | null,
    exchangeRate: number | null,
): SimulationConstants {
    return {
        sharePriceUsd: sharePriceUsd ?? FALLBACK_MARKET.sharePriceUsd,
        monthlyDividendUsd: monthlyDividendUsd ?? FALLBACK_MARKET.monthlyDividendUsd,
        exchangeRate: exchangeRate ?? FALLBACK_MARKET.exchangeRate,
        taxThresholdKrw: TAX_POLICY.THRESHOLD_KRW,
        taxRatePercent: TAX_POLICY.RATE_PERCENT,
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
        includesRecurring: false,
        // 재투자 구간으로 바꿨을 때의 기본값 — 기본 동작(재투자 함)과 일치시킨다
        reinvest: true,
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