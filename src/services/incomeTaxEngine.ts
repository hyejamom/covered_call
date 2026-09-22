import { INCOME_TAX_BRACKETS } from '../constants/simulationDefaults'
import type { ComprehensiveTaxEstimate, SimulationConstants } from '../types/simulation'

// ══════════ 금융소득종합과세 추정 ══════════
//
// [1단계 · 지급 시점]  미국 배당은 지급될 때 미국이 15% 를 떼고 나머지만 입금한다. 금액과 무관하게 항상이다.
//                      → 이 계산은 simulationEngine 이 매달 수행하고, 여기서는 그 합계를 "이미 낸 세금"으로만 받는다.
// [2단계 · 이듬해 5월] 연간 세전 금융소득이 2,000만원을 넘은 해는 종합소득세 신고 대상이 된다.
//                      배당 전체를 종합소득에 얹어 누진세율로 다시 계산한 뒤, 이미 낸 미국 원천징수분을
//                      외국납부세액공제로 빼 준다. 남는 차액 + 지방소득세 10% 가 5월에 실제로 낼 돈이다.
//
// [비교과세]           산출세액은 아래 두 방식 중 "큰 쪽"으로 정한다 (소득세법 §62).
//                      ① 종합과세방식 : 기준금액(2,000만원)까지는 14%, 초과분은 다른 종합소득과 합쳐 누진세율
//                      ② 분리과세방식 : 금융소득 전액 × 14% (+ 다른 종합소득에만 누진세율)
//                      금융소득이 크지 않으면 ②가 커서 사실상 14% 로 끝나고, 커질수록 ①이 이겨 세금이 뛴다.
// [외국납부세액공제]   공제 한도 = 산출세액 × (국외원천소득 ÷ 종합소득금액). 한도를 넘는 미국 납부분은
//                      이월공제(5년) 대상이지만 여기서는 잡지 않는다 — 그 해 낼 돈만 보는 추정이라서다.
// [근사한 부분]        지방소득세는 원래 지방분 과세표준으로 따로 계산하지만, 결정세액 × 10% 로 근사한다.
//                      건강보험료(피부양자 탈락 등)는 세금이 아니므로 이 추정에 포함하지 않는다.

/**
 * 과세표준에 누진세율 적용 — 산출세액 = 과세표준 × 세율 − 누진공제액
 * @param taxBase 과세표준 (원). 0 이하면 세금 없음
 */
export function calcProgressiveTax(taxBase: number): number {
    if (taxBase <= 0) return 0

    // 1) 과세표준이 속한 첫 구간을 찾는다 (표는 상한 오름차순)
    const bracket = INCOME_TAX_BRACKETS.find((item) => taxBase <= item.limit)
        ?? INCOME_TAX_BRACKETS[INCOME_TAX_BRACKETS.length - 1]

    // 2) 세율 적용 후 누진공제 차감 — 음수 방지
    return Math.max(0, Math.floor(taxBase * (bracket.ratePercent / 100) - bracket.deduction))
}

/**
 * 한 해분 종합소득세(5월 신고) 추정
 *
 * 1) 세전 금융소득이 기준금액 이하면 분리과세로 끝 — 미국 15% 외에 더 낼 것이 없다
 * 2) 종합과세방식 산출세액 계산 — 기준금액까지 14% + 초과분·기타소득에 누진세율
 * 3) 분리과세방식 산출세액 계산 — 금융소득 전액 14% + 기타소득에만 누진세율
 * 4) 둘 중 큰 값을 산출세액으로 채택 (비교과세)
 * 5) 이미 낸 미국 원천징수를 한도 안에서 공제 → 결정세액
 * 6) 지방소득세 10% 를 얹어 "5월에 낼 돈"을 만든다
 *
 * @param financialIncome 그 해 세전 금융소득(배당) 합계 (원)
 * @param foreignPaidTax 그 해 미국에 이미 낸 원천징수 세액 합계 (원)
 * @param constants 세율·기준금액·기타소득 등 정책 상수
 */
export function estimateComprehensiveTax(
    financialIncome: number,
    foreignPaidTax: number,
    constants: SimulationConstants,
): ComprehensiveTaxEstimate {
    const threshold = constants.comprehensiveThresholdKrw
    const separateRate = constants.separateRatePercent / 100
    const otherIncome = constants.otherIncomeKrw
    const deduction = constants.basicDeductionKrw

    // 1) 기준금액 이하 — 종합과세 대상이 아니므로 추가 납부 없음
    if (financialIncome <= threshold) {
        return {
            applies: false,
            financialIncome,
            progressiveTax: 0,
            separateTax: 0,
            calculatedTax: 0,
            foreignPaidTax,
            foreignCredit: 0,
            incomeTax: 0,
            localTax: 0,
            totalDue: 0,
        }
    }

    // 2) 종합과세방식 — 기준금액 초과분과 기타소득을 합쳐 소득공제를 뺀 금액이 과세표준
    const progressiveBase = Math.max(0, (financialIncome - threshold) + otherIncome - deduction)
    const progressiveTax = calcProgressiveTax(progressiveBase) + Math.floor(threshold * separateRate)

    // 3) 분리과세방식 — 금융소득은 통째로 14%, 누진세율은 기타소득에만
    const separateTax = Math.floor(financialIncome * separateRate)
        + calcProgressiveTax(Math.max(0, otherIncome - deduction))

    // 4) 비교과세 — 큰 쪽을 산출세액으로 확정
    const calculatedTax = Math.max(progressiveTax, separateTax)

    // 5) 외국납부세액공제 — 한도는 "산출세액 × 국외소득 비중". 배당만 있으면 사실상 산출세액 전액이 한도다
    const totalIncome = financialIncome + otherIncome
    const foreignRatio = totalIncome > 0 ? financialIncome / totalIncome : 0
    const creditLimit = Math.floor(calculatedTax * foreignRatio)
    const foreignCredit = Math.min(foreignPaidTax, creditLimit)

    // 6) 결정세액 + 지방소득세 = 5월 납부 추정액
    const incomeTax = Math.max(0, calculatedTax - foreignCredit)
    const localTax = Math.floor(incomeTax * (constants.localRatePercent / 100))

    return {
        applies: true,
        financialIncome,
        progressiveTax,
        separateTax,
        calculatedTax,
        foreignPaidTax,
        foreignCredit,
        incomeTax,
        localTax,
        totalDue: incomeTax + localTax,
    }
}
