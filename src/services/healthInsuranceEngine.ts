import type { HealthInsuranceEstimate, SimulationConstants } from '../types/simulation'

// ══════════ 건강보험료 추정 ══════════
//
// 세금이 아니라 보험료지만, 배당으로 먹고사는 구조에서는 종소세보다 먼저 체감되는 고정비다.
//
// [부과 소득]   연 금융소득이 1,000만원을 넘으면 "초과분"이 아니라 "전액"이 부과 대상 소득이 된다.
//               999만원이면 0원, 1,001만원이면 1,001만원 전체가 잡히는 계단식 구조라 문턱 근처에서 급격히 뛴다.
// [피부양자]    합산소득이 2,000만원을 넘으면 피부양자 자격을 잃고 지역가입자로 전환된다.
//               그 아래까지는 부양할 직장가입자가 있다는 전제로 보험료를 0원으로 본다.
// [보험료]      건강보험료 = 월 소득 × 요율(상한 적용), 장기요양보험료 = 건강보험료 × 요율.
//               장기요양은 상한 위에 따로 붙으므로 상한에 걸려도 총액이 완전히 고정되지는 않는다.
// [빠진 것]     재산·자동차 부과분은 이 도구가 자산을 모르므로 계산하지 않는다 (실제 고지액은 이보다 크다).
//               부과 시점도 그 해가 아니라 이듬해 11월 정산분부터 반영되지만, 읽기 편하게 소득이 생긴 해에 붙여 표기한다.

/**
 * 한 해분 건강보험료 추정
 *
 * 1) 금융소득이 부과 기준 이하면 부과 대상 소득 자체가 잡히지 않는다
 * 2) 부과 대상 소득이 피부양자 한도 이하면 자격이 유지되어 보험료가 0원이다
 * 3) 한도를 넘으면 지역가입자 — 월 소득에 요율을 곱하고 상한으로 자른다
 * 4) 장기요양보험료를 건강보험료에 얹어 월·연 납부액을 만든다
 *
 * @param financialIncome 그 해 세전 금융소득(배당) 합계 (원)
 * @param constants 요율·기준금액·상한 등 정책 상수
 */
export function estimateHealthInsurance(
    financialIncome: number,
    constants: SimulationConstants,
): HealthInsuranceEstimate {
    // 1) 부과 대상 소득 판정 — 기준 초과 시 전액, 이하면 0
    const chargeableIncome = financialIncome > constants.healthIncomeThresholdKrw ? financialIncome : 0

    // 2) 피부양자 자격 유지 구간 — 보험료 없음
    if (chargeableIncome <= constants.dependentLimitKrw) {
        return {
            applies: false,
            chargeableIncome,
            monthlyHealth: 0,
            monthlyLongTermCare: 0,
            monthlyTotal: 0,
            yearlyTotal: 0,
            capped: false,
        }
    }

    // 3) 지역가입자 전환 — 월 소득에 요율 적용 후 상한으로 자른다
    const monthlyIncome = chargeableIncome / 12
    const rawHealth = Math.floor(monthlyIncome * (constants.healthRatePercent / 100))
    const capped = rawHealth > constants.healthMonthlyCapKrw
    const monthlyHealth = capped ? constants.healthMonthlyCapKrw : rawHealth

    // 4) 장기요양보험료는 건강보험료 위에 얹힌다 (상한 밖)
    const monthlyLongTermCare = Math.floor(monthlyHealth * (constants.longTermCareRatePercent / 100))
    const monthlyTotal = monthlyHealth + monthlyLongTermCare

    return {
        applies: true,
        chargeableIncome,
        monthlyHealth,
        monthlyLongTermCare,
        monthlyTotal,
        yearlyTotal: monthlyTotal * 12,
        capped,
    }
}
