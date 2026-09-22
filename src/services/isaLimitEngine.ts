import type { IsaLimitStatus, SimulationConstants } from '../types/simulation'

// ══════════ ISA 납입한도 점검 ══════════
//
// 이 계좌의 배당은 지급 시점에 그대로 받는 현금으로 본다.
// 국내 상장 ETF 라 미국 원천징수 15% 가 없고, ISA 계좌 안이라 배당에 붙는 세금도 없다.
// 그래서 세전·세후를 나눌 것이 없고, 만기에 따로 정산할 것도 없다 — 이 파일에 과세 계산이 하나도 없는 이유다.
//
// 대신 ISA 에만 있는 제약이 하나 남는다. 납입한도다.
//   [연 한도]  한 해에 2,000만원까지만 넣을 수 있다.
//   [총 한도]  누적 1억원까지만 넣을 수 있다.
// 한도를 넘긴 계획은 세금이 달라지는 것이 아니라 애초에 실행이 불가능하다.
// 그래서 세액이 아니라 "이 계획을 그대로 넣을 수 있는가"를 따로 짚어 준다.

/** 한도 점검에 필요한 계좌 누계 — 시뮬레이션이 대상 기간 전체를 돌고 나서 넘겨준다 */
export interface IsaLimitInput {
    /** 총 납입액 (원) — 주력 종목 투입금 + 확정수익 자산 투입금 */
    contributionTotal: number
    /** 연 납입한도를 넘긴 연도 목록 — 해마다 판정해 쌓아 온 결과 */
    overAnnualLimitYears: number[]
}

/** 일반 계좌용 빈 결과 — applies=false 로 두면 화면·엑셀이 ISA 표기를 통째로 건너뛴다 */
export const NO_ISA_LIMIT_STATUS: IsaLimitStatus = {
    applies: false,
    contributionTotal: 0,
    overAnnualLimitYears: [],
    overTotalLimit: 0,
}

/**
 * ISA 납입한도 점검
 *
 * 1) 연 한도 초과 연도는 시뮬레이션이 해마다 판정해 넘겨준 목록을 그대로 쓴다
 * 2) 총 한도 초과액은 누적 납입액에서 총 한도를 뺀 값 — 넘지 않았으면 0
 *
 * @param input 대상 기간을 다 돌고 난 계좌 누계
 * @param constants 납입한도 정책 상수
 */
export function evaluateIsaLimits(
    input: IsaLimitInput,
    constants: SimulationConstants,
): IsaLimitStatus {

    // 1) 총 납입한도 초과분 — 넘지 않았으면 0
    const overTotalLimit = Math.max(0, input.contributionTotal - constants.isaTotalLimitKrw)

    return {
        applies: true,
        contributionTotal: input.contributionTotal,
        // 2) 연 한도 초과 연도는 시뮬레이션 루프가 이미 판정해 둔 목록을 그대로 전달한다
        overAnnualLimitYears: input.overAnnualLimitYears,
        overTotalLimit,
    }
}
