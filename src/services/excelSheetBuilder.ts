import type { Row, SheetData } from 'write-excel-file/browser'
import { AccountType, CALC_ASSET_META, type CalcAsset } from '../constants/assetConstants'
import {
    MONTH_LABELS,
    MONTH_NUMBERS,
    buildGridRows,
    buildYears,
    formatShareCount,
} from '../constants/gridConstants'
import { formatKrw, toAgeInYear } from '../utils/format'
import type { GridRowDef } from '../constants/gridConstants'
import type {
    IsaLimitStatus,
    SimulationConstants,
    SimulationResult,
    WorkbookYearSummary,
} from '../types/simulation'
import type { Workbook } from '../types/workbook'
import { hasGrowthPlan, hasWithdrawSchedule, runWorkbookSimulation, toYm } from './simulationEngine'

// ══════════ 스타일 상수 ══════════

// 화면과 같은 컨셉 팔레트(A0937D · E7D4B5 · F6E6CB · B6C7AA)를 엑셀에도 그대로 쓴다
const COLOR_HEAD_BG = '#E7D4B5'      // 연도/월 헤더 배경 — 탄
const COLOR_LABEL_BG = '#F6E6CB'     // 항목 라벨 배경 — 크림
const COLOR_TAXED_BG = '#F0DCAF'     // 종합과세 연도 강조 배경 — 황토
const COLOR_BORDER = '#A0937D'       // 셀 테두리 — 토프

/** 엑셀 시트명 금지 문자 — : \ / ? * [ ] */
const INVALID_SHEET_NAME_CHARS = /[:\\/?*[\]]/g

/** 엑셀 시트명 최대 길이 (Excel 사양) */
const MAX_SHEET_NAME_LENGTH = 31

/** 워크시트 1장 구성 — write-excel-file 의 다중 시트 입력 형태 */
export interface WorkbookSheet {
    data: SheetData
    sheet: string
    columns: { width: number }[]
    stickyRowsCount: number
}

// ══════════ 유틸 ══════════

/**
 * 탭 이름을 엑셀 시트명 규칙에 맞게 변환
 * — 금지문자 제거 / 31자 제한 / 빈 이름 대체 / 중복 시 뒤에 (2), (3) 부여
 */
export function toSheetName(rawName: string, index: number, usedNames: Set<string>): string {
    // 1) 금지 문자 제거 후 길이 제한
    let name = rawName.replace(INVALID_SHEET_NAME_CHARS, '').trim().slice(0, MAX_SHEET_NAME_LENGTH)

    // 2) 전부 걸러져 빈 문자열이 되면 순번으로 대체
    if (name.length === 0) name = `시트${index + 1}`

    // 3) 이미 쓰인 이름이면 접미사를 붙여 유일하게 만든다
    if (usedNames.has(name)) {
        const withSuffix = (suffix: number) => {
            const tail = ` (${suffix})`
            return name.slice(0, MAX_SHEET_NAME_LENGTH - tail.length) + tail
        }

        let suffix = 2
        let candidate = withSuffix(suffix)
        while (usedNames.has(candidate)) {
            suffix += 1
            candidate = withSuffix(suffix)
        }
        name = candidate
    }

    usedNames.add(name)
    return name
}

/**
 * 연도 헤더 문구 — 나이와 그 해에 따라붙는 돈을 괄호 안에 함께 담는다
 *
 * 계좌 유형에 따라 붙는 내용이 갈린다.
 *   · 일반 계좌 : "2039 (46세, 5월 종소세 22,759,000원, 건보료 월 1,644,000원)"
 *   · ISA 계좌  : 내는 돈이 아예 없으므로 나이만 적고, 납입한도를 넘긴 해에만 경고를 붙인다
 *
 * @param year 연도 @param birthYm 시트 주인의 생년월
 * @param summary 워크북 합산 연간 요약 — 종합과세 판정과 종소세 추정액의 출처
 * @param isa 이 시트의 ISA 납입한도 점검 결과 (일반 계좌면 applies=false)
 * @param firstSellYm 원금을 헐기 시작한 연월 (인출 계획이 없으면 null)
 * @param depletedYm 계좌가 바닥난 연월 (없으면 null)
 */
function toYearHeadText(
    year: number,
    birthYm: string,
    summary: WorkbookYearSummary | undefined,
    isa: IsaLimitStatus,
    firstSellYm: string | null,
    depletedYm: string | null,
): string {
    const age = toAgeInYear(birthYm, year)
    const marks = [
        age !== null ? `${age}세` : '',
        // 종합과세 연도만 표기 — 기준 이하인 해는 원천징수로 끝나 5월에 낼 돈이 없다.
        // 대상 연도라도 산출세액이 미국 원천징수(15%)에 전부 상계되면 낼 돈이 0 이라, 그 경우는 금액 대신 사실만 적는다.
        summary?.taxed === true
            ? (summary.comprehensiveTax.totalDue > 0
                ? `5월 종소세 ${formatKrw(summary.comprehensiveTax.totalDue)}원`
                : '종합과세 대상(추가 납부 없음)')
            : '',
        // 건보료는 피부양자 자격을 잃은 해부터 붙는다 (매달 나가는 돈이라 월 금액으로 적는다)
        summary?.healthInsurance.applies === true
            ? `건보료 월 ${formatKrw(summary.healthInsurance.monthlyTotal)}원`
            : '',
        // ISA 연 납입한도를 넘긴 해 — 세액과 무관하지만 실제로는 그만큼 넣을 수 없는 계획이다
        isa.applies && isa.overAnnualLimitYears.includes(year) ? '연 납입한도 초과' : '',
        // 인출 이정표 — 원금을 헐기 시작한 해와 계좌가 바닥난 해에만 붙는다
        firstSellYm !== null && firstSellYm.slice(0, 4) === String(year) ? `${firstSellYm} 원금 헐기 시작` : '',
        depletedYm !== null && depletedYm.slice(0, 4) === String(year) ? `${depletedYm} 계좌 고갈` : '',
    ].filter((mark) => mark !== '')

    return marks.length > 0 ? `${year} (${marks.join(', ')})` : String(year)
}

// ══════════ 시트 데이터 생성 ══════════

/**
 * 시트 1장의 데이터 생성
 * — 화면 그리드와 동일하게 연도별 5행(헤더 + 4항목)을 대상 기간만큼 반복한다.
 * — 셀에는 서식이 적용된 "숫자"를 넣어 엑셀에서 그대로 계산에 쓸 수 있게 한다.
 * @param result 시트 1장 분 시뮬레이션 결과
 * @param birthYm 시트 주인의 생년월 (연도 헤더 나이 표기용)
 * @param years 대상 기간 연도 목록
 * @param rows 이 시트에 기록할 행 정의 — 확정수익 구간이 있는 시트에만 확정수익 행이 포함된다
 * @param byYear 워크북 합산 연간 요약 — 종소세·건보료 표기의 출처
 * @param assetLabel 주력 종목 표기명 — 확정수익 이관 셀의 "→ 종목명" 문구에 쓴다
 */
function buildSheetData(
    result: SimulationResult,
    birthYm: string,
    years: number[],
    rows: GridRowDef[],
    byYear: Record<number, WorkbookYearSummary>,
    assetLabel: string,
): SheetData {
    const sheetData: SheetData = []

    years.forEach((year, yearIndex) => {
        // 1) 연도 블록 사이 구분용 빈 행 (첫 블록 앞에는 넣지 않음)
        if (yearIndex > 0) sheetData.push([])

        // 2) 0행 — 연도 + 1월~12월 헤더. 종합과세 연도는 배경색으로 구분하고 예상 세액을 연도 옆에 적는다
        const yearSummary = byYear[year]
        const taxed = result.byYear[year]?.taxed === true
        const headBg = taxed ? COLOR_TAXED_BG : COLOR_HEAD_BG
        const headRow: Row = [
            {
                value: toYearHeadText(year, birthYm, yearSummary, result.isaLimits, result.firstSellYm, result.depletedYm),
                fontWeight: 'bold',
                fontSize: 12,
                align: 'left',
                backgroundColor: headBg,
                borderColor: COLOR_BORDER,
                borderStyle: 'thin',
            },
            ...MONTH_LABELS.map((month) => ({
                value: month,
                fontWeight: 'bold' as const,
                align: 'center' as const,
                backgroundColor: headBg,
                borderColor: COLOR_BORDER,
                borderStyle: 'thin' as const,
            })),
        ]
        sheetData.push(headRow)

        // 3) 1~N행 — 항목 라벨 + 월별 값
        rows.forEach((rowDef) => {
            const dataRow: Row = [
                {
                    value: rowDef.label,
                    fontWeight: 'bold',
                    align: 'left',
                    backgroundColor: COLOR_LABEL_BG,
                    borderColor: COLOR_BORDER,
                    borderStyle: 'thin',
                },
                ...MONTH_NUMBERS.map((month) => {
                    const cellStyle = {
                        align: 'right' as const,
                        borderColor: COLOR_BORDER,
                        borderStyle: 'thin' as const,
                    }

                    // 3-1) 개시 이전 달은 값 없는 빈 셀로 둔다.
                    //      값이 없는 셀에 format 을 함께 넘기면 라이브러리가 예외를 던지므로 반드시 제외한다.
                    const monthly = result.byYm[toYm(year, month)]
                    if (monthly === undefined || !monthly.active) return cellStyle

                    // 3-2) 숫자 필드가 없는 행(누적 매수금액)은 화면과 동일하게 금액 + 보유주를 한 칸에 문자열로 기록
                    if (rowDef.field === undefined) {
                        return {
                            ...cellStyle,
                            value: `${formatKrw(monthly.cumulativePurchase)} (${formatShareCount(monthly.shares)})`,
                            type: String,
                        }
                    }

                    // 3-2-1) 확정수익 행은 평가액을 적되, 주력 종목으로 이관한 달만 이관액 + 굵게로 전환 시점을 눈에 띄게 한다
                    if (rowDef.field === 'growthBalance') {
                        const transferred = monthly.growthTransfer > 0
                        return {
                            ...cellStyle,
                            value: transferred ? monthly.growthTransfer : monthly.growthBalance,
                            type: Number,
                            format: transferred ? `${rowDef.excelFormat}" → ${assetLabel}"` : rowDef.excelFormat,
                            ...(transferred ? { fontWeight: 'bold' as const, textColor: '#5C6B4A' } : {}),
                        }
                    }

                    // 3-3) 나머지는 서식이 적용된 숫자로 기록 (엑셀에서 그대로 계산 가능)
                    //      배당을 인출한 달은 회색 기울임 + X 표기로 재투자분과 구분한다 (명목·실질 두 행 모두 동일 처리)
                    const isDividendRow = rowDef.field === 'dividendNet' || rowDef.field === 'dividendReal'
                    const withdrawn = isDividendRow && !monthly.reinvested

                    return {
                        ...cellStyle,
                        value: monthly[rowDef.field],
                        type: Number,
                        format: withdrawn ? `${rowDef.excelFormat}" (X)"` : rowDef.excelFormat,
                        ...(withdrawn ? { textColor: '#9C8558', fontStyle: 'italic' as const } : {}),
                    }
                }),
            ]
            sheetData.push(dataRow)
        })
    })

    return sheetData
}

// ══════════ API ══════════

/**
 * 탭 목록을 워크시트 배열로 변환
 * — 탭 순서 = 워크시트 순서, 탭 이름 = 워크시트 이름
 * — 탭마다 자기 이벤트 + 공통 상수로 시뮬레이션을 다시 돌려 결과를 채운다.
 * @param workbook 내보낼 워크북 (대상 기간과 시트 목록을 함께 들고 있다)
 * @param constants 전 탭 공통 고정 상수
 * @param asset 내보내는 종목 탭 — 시트 안 표기(이관 문구)에 종목명을 넣는 데 쓴다
 */
export function buildWorkbookSheets(
    workbook: Workbook,
    constants: SimulationConstants,
    asset: CalcAsset,
): WorkbookSheet[] {
    const meta = CALC_ASSET_META[asset]
    // 1) 컬럼 폭 — 0열(항목명)만 넓게, 나머지 12개월 열은 동일 폭
    const columns = [{ width: 22 }, ...MONTH_LABELS.map(() => ({ width: 13 }))]

    // 2) 이 파일에 설정된 대상 기간
    const years = buildYears(workbook.startYear, workbook.endYear)

    // 3) 워크북 전체를 한 번에 시뮬레이션 — 종합과세 판정이 모든 시트의 배당 합산 기준이므로 시트별로 따로 돌리면 안 된다
    //    주가 변동률은 파일마다 다른 가정이라 화면과 동일하게 공통 상수 위에 덮어써서 넘긴다
    const workbookResult = runWorkbookSimulation(
        workbook.tabs,
        { ...constants, sharePriceDriftPercent: workbook.sharePriceDriftPercent },
        workbook.startYear,
        workbook.endYear,
    )

    // 4) 시트별 결과로 워크시트 1장씩 구성 (시트명 중복 방지를 위해 사용된 이름을 누적 추적)
    const usedNames = new Set<string>()
    return workbook.tabs.map((tab, index) => ({
        // 4-1) 확정수익 구간은 시트마다 있을 수도 없을 수도 있어 행 구성을 시트별로 따로 조립한다
        data: buildSheetData(
            workbookResult.byTabId[tab.id],
            tab.birthYm,
            years,
            buildGridRows({
                hasGrowth: hasGrowthPlan(tab.events),
                isIsa: constants.accountType === AccountType.ISA,
                hasWithdrawSchedule: hasWithdrawSchedule(tab.events),
            }),
            // 4-2) 종소세 추정은 파일 합산 기준이라 모든 시트가 같은 연간 요약을 공유한다
            //      (ISA 계좌에서는 판정 자체가 없어 이 요약이 전부 '해당 없음'으로 채워져 온다)
            workbookResult.byYear,
            meta.label,
        ),
        sheet: toSheetName(tab.name, index, usedNames),
        columns,
        stickyRowsCount: 1,
    }))
}