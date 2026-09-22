import type { HealthInsuranceEstimate, SimulationConstants } from '../types/simulation'

// ══════════ 건강보험료 추정 ══════════
//
// 세금이 아니라 보험료지만, 배당으로 먹고사는 구조에서는 종소세보다 먼저 체감되는 고정비다.
//
// [발생 조건]  연 "세전" 배당 합계가 기준금액(2,000만원) 이상인 해에만 붙는다 — 종합과세와 같은 문턱이라
//              "종소세는 없는데 건보료만 나간다"는 어긋난 구간이 생기지 않는다.
// [부과 소득]  기준금액을 뺀 초과분만 부과 대상이다. 전액이 아니라 넘은 만큼만 잡는다.
// [보험료]     초과분 ÷ 12 × 요율.
//              예) 연 2,400만원 → 초과분 400만원 ÷ 12 = 33만 3천원 × 7.19% ≒ 월 2만 4천원
// [납부 시점]  소득이 생긴 해가 아니라 그 다음 해에 매달 나간다 (2027년 배당 → 2028년 1~12월 납부).
//              그래서 화면에서는 이 값을 이듬해 "배당금(세후)" 칸에 월 배지로 붙인다.
// [빠진 것]    재산·자동차 부과분은 이 도구가 자산을 모르므로 계산하지 않는다 (실제 고지액은 이보다 크다).

/**
 * 한 해 소득 기준 건강보험료 추정 — 실제 납부는 이듬해 1~12월에 나눠 낸다
 *
 * 1) 세전 배당이 기준금액 미만이면 부과 자체가 없다
 * 2) 기준금액 초과분만 부과 대상 소득으로 잡는다
 * 3) 초과분을 12개월로 나눈 월 소득에 요율을 곱해 월 보험료를 만든다
 *
 * @param financialIncome 그 해 세전 금융소득(배당) 합계 (원)
 * @param constants 요율·기준금액 등 정책 상수
 */
export function estimateHealthInsurance(
    financialIncome: number,
    constants: SimulationConstants,
): HealthInsuranceEstimate {
    const threshold = constants.healthIncomeThresholdKrw

    // 1) 기준금액 미만 — 부과 대상 소득이 잡히지 않는다
    if (financialIncome < threshold) {
        return {
            applies: false,
            financialIncome,
            chargeableIncome: 0,
            monthlyChargeableIncome: 0,
            monthlyPremium: 0,
            yearlyPremium: 0,
        }
    }

    // 2) 초과분만 부과 대상 — 기준금액까지는 보험료 계산에서 빠진다
    const chargeableIncome = financialIncome - threshold

    // 3) 월 소득 × 요율 = 월 보험료. 기준금액에 딱 걸친 해는 초과분이 0 이라 부과액도 0 이다
    const monthlyChargeableIncome = Math.floor(chargeableIncome / 12)
    const monthlyPremium = Math.floor(monthlyChargeableIncome * (constants.healthRatePercent / 100))

    return {
        applies: monthlyPremium > 0,
        financialIncome,
        chargeableIncome,
        monthlyChargeableIncome,
        monthlyPremium,
        yearlyPremium: monthlyPremium * 12,
    }
}
