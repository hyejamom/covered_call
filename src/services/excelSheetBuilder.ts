import type { Row, SheetData } from 'write-excel-file/browser'
import {
    GRID_ROWS,
    MONTH_LABELS,
    MONTH_NUMBERS,
    buildYears,
    formatShareCount,
} from '../constants/gridConstants'
import { formatKrw, toAgeInYear } from '../utils/format'
import type { SimulationConstants, SimulationResult } from '../types/simulation'
import type { Workbook } from '../types/workbook'
import { runWorkbookSimulation, toYm } from './simulationEngine'

// ══════════ 스타일 상수 ══════════

const COLOR_HEAD_BG = '#E5EBF8'      // 연도/월 헤더 배경
const COLOR_LABEL_BG = '#F3F5FA'     // 항목 라벨 배경
const COLOR_TAXED_BG = '#FDECEC'     // 과세 적용 연도 강조 배경
const COLOR_BORDER = '#B9C4DC'       // 셀 테두리

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
 * 연도 헤더 문구 — 나이와 과세 여부를 괄호 안에 함께 담는다
 * 예: "2026", "2026 (33세)", "2039 (46세, 과세)"
 */
function toYearHeadText(year: number, birthYm: string, taxed: boolean): string {
    const age = toAgeInYear(birthYm, year)
    const marks = [
        age !== null ? `${age}세` : '',
        taxed ? '과세' : '',
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
 */
function buildSheetData(result: SimulationResult, birthYm: string, years: number[]): SheetData {
    const sheetData: SheetData = []

    years.forEach((year, yearIndex) => {
        // 1) 연도 블록 사이 구분용 빈 행 (첫 블록 앞에는 넣지 않음)
        if (yearIndex > 0) sheetData.push([])

        // 2) 0행 — 연도 + 1월~12월 헤더. 과세 연도는 배경색으로 구분하고 연도 옆에 표기
        const taxed = result.byYear[year]?.taxed === true
        const headBg = taxed ? COLOR_TAXED_BG : COLOR_HEAD_BG
        const headRow: Row = [
            {
                value: toYearHeadText(year, birthYm, taxed),
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

        // 3) 1~4행 — 항목 라벨 + 월별 값
        GRID_ROWS.forEach((rowDef) => {
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

                    // 3-3) 나머지는 서식이 적용된 숫자로 기록 (엑셀에서 그대로 계산 가능)
                    //      배당을 인출한 달은 회색 기울임 + X 표기로 재투자분과 구분한다
                    const withdrawn = rowDef.field === 'dividendNet' && !monthly.reinvested

                    return {
                        ...cellStyle,
                        value: monthly[rowDef.field],
                        type: Number,
                        format: withdrawn ? `${rowDef.excelFormat}" (X)"` : rowDef.excelFormat,
                        ...(withdrawn ? { textColor: '#8A93A6', fontStyle: 'italic' as const } : {}),
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
 */
export function buildWorkbookSheets(workbook: Workbook, constants: SimulationConstants): WorkbookSheet[] {
    // 1) 컬럼 폭 — 0열(항목명)만 넓게, 나머지 12개월 열은 동일 폭
    const columns = [{ width: 22 }, ...MONTH_LABELS.map(() => ({ width: 13 }))]

    // 2) 이 파일에 설정된 대상 기간
    const years = buildYears(workbook.startYear, workbook.endYear)

    // 3) 워크북 전체를 한 번에 시뮬레이션 — 과세 판정이 모든 시트의 배당 합산 기준이므로 시트별로 따로 돌리면 안 된다
    const workbookResult = runWorkbookSimulation(
        workbook.tabs,
        constants,
        workbook.startYear,
        workbook.endYear,
    )

    // 4) 시트별 결과로 워크시트 1장씩 구성 (시트명 중복 방지를 위해 사용된 이름을 누적 추적)
    const usedNames = new Set<string>()
    return workbook.tabs.map((tab, index) => ({
        data: buildSheetData(workbookResult.byTabId[tab.id], tab.birthYm, years),
        sheet: toSheetName(tab.name, index, usedNames),
        columns,
        stickyRowsCount: 1,
    }))
}