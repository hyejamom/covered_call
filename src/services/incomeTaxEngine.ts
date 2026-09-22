import type { ComprehensiveTaxEstimate, SimulationConstants } from '../types/simulation'

// ══════════ 금융소득종합과세 추정 ══════════
//
// [1단계 · 지급 시점]  미국 배당은 지급될 때 미국이 15% 를 떼고 나머지만 입금한다. 금액과 무관하게 항상이다.
//                      → 이 계산은 simulationEngine 이 매달 수행하고, 이 파일은 관여하지 않는다.
// [2단계 · 이듬해 5월] 연간 세전 금융소득이 기준금액(2,000만원) 이상인 해는 종합소득세 신고 대상이 되어
//                      이듬해 5월에 한 번 납부한다. 건보료처럼 매달 나가는 돈이 아니다.
//
// [세액 추정]          누진세율·비교과세·외국납부세액공제를 따지지 않고 "연 세전 배당 × 15%" 로 잡는다.
//                      실제 세액은 다른 소득·공제에 따라 갈리지만, 계획을 세울 때는 넉넉히 잡아 두는 편이
//                      안전하므로 아주 보수적인 단일 세율로 못 박는다.
// [빠진 것]            건강보험료는 세금이 아니므로 여기서 계산하지 않는다 (healthInsuranceEngine 담당).

/**
 * 한 해분 종합소득세(이듬해 5월 신고) 추정
 *
 * 1) 세전 금융소득이 기준금액 미만이면 원천징수로 끝 — 5월에 낼 것이 없다
 * 2) 기준금액 이상이면 금융소득 전액에 추정 세율을 곱한다 (보수적 단순 추정)
 *
 * @param financialIncome 그 해 세전 금융소득(배당) 합계 (원)
 * @param constants 세율·기준금액 등 정책 상수
 */
export function estimateComprehensiveTax(
    financialIncome: number,
    constants: SimulationConstants,
): ComprehensiveTaxEstimate {
    const ratePercent = constants.comprehensiveRatePercent

    // 1) 기준금액 미만 — 종합과세 대상이 아니므로 추가 납부 없음
    if (financialIncome < constants.comprehensiveThresholdKrw) {
        return {
            applies: false,
            financialIncome,
            ratePercent,
            totalDue: 0,
        }
    }

    // 2) 대상 연도 — 공제·누진 구간을 따지지 않고 전액에 세율을 곱한다
    return {
        applies: true,
        financialIncome,
        ratePercent,
        totalDue: Math.floor(financialIncome * (ratePercent / 100)),
    }
}
