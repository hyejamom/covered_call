import writeXlsxFile from 'write-excel-file/browser'
import type { LedgerData } from '../types/ledger'
import type { SimulationConstants } from '../types/simulation'
import type { Workbook } from '../types/workbook'
import { buildWorkbookSheets } from './excelSheetBuilder'
import { buildLedgerSheets, toYmRange } from './ledgerExcelBuilder'

/** 파일명에 쓸 수 없는 문자 — Windows/macOS 공통 금지 문자 */
const INVALID_FILE_NAME_CHARS = /[\\/:*?"<>|]/g

/** 파일명용 오늘 날짜 YYYYMMDD */
function todayStamp(): string {
    const now = new Date()
    const month = String(now.getMonth() + 1).padStart(2, '0')
    const day = String(now.getDate()).padStart(2, '0')
    return `${now.getFullYear()}${month}${day}`
}

/** 워크북 이름을 파일명으로 변환 — 금지 문자 제거 후 비면 기본명 사용 */
function toFileName(workbookName: string): string {
    const safeName = workbookName.replace(INVALID_FILE_NAME_CHARS, '').trim()
    return `JEPQ_적립계획_${safeName.length > 0 ? safeName : '무제'}_${todayStamp()}.xlsx`
}

/**
 * 워크북 1개를 엑셀 파일 1개로 내려받는다.
 * — 워크북의 탭 순서 = 워크시트 순서, 탭 이름 = 워크시트 이름
 * @param workbook 내보낼 워크북
 * @param constants 전 탭 공통 고정 상수
 */
export async function downloadWorkbook(workbook: Workbook, constants: SimulationConstants): Promise<void> {
    if (workbook.tabs.length === 0) throw new Error('내보낼 탭이 없습니다')

    // 1) 탭별 시뮬레이션 결과로 워크시트 배열 구성
    const sheets = buildWorkbookSheets(workbook, constants)

    // 2) 브라우저 다운로드 트리거
    await writeXlsxFile(sheets).toFile(toFileName(workbook.name))
}

/**
 * 워크북 전체를 각각의 엑셀 파일로 내려받는다. (워크북 N개 → 파일 N개)
 * — 브라우저가 연속 다운로드를 막지 않도록 순차 처리한다.
 * @param workbooks 내보낼 워크북 목록
 * @param constants 전 탭 공통 고정 상수
 */
export async function downloadAllWorkbooks(workbooks: Workbook[], constants: SimulationConstants): Promise<void> {
    if (workbooks.length === 0) throw new Error('내보낼 파일이 없습니다')

    // 1) 파일 저장 대화상자가 겹치지 않도록 순차 실행
    for (const workbook of workbooks) {
        await downloadWorkbook(workbook, constants)
    }
}

/**
 * 가계부를 엑셀 파일 1개로 내려받는다. — 고른 기간의 달마다 시트 1장
 * @param data 가계부 원본 데이터 한 벌
 * @param startYm 시작 월 'YYYY-MM'
 * @param endYm 종료 월 'YYYY-MM'
 */
export async function downloadLedger(data: LedgerData, startYm: string, endYm: string): Promise<void> {
    // 1) 기간 검증 — 시작이 종료보다 뒤면 만들 시트가 없다
    const yms = toYmRange(startYm, endYm)
    if (yms.length === 0) throw new Error('시작 월이 종료 월보다 뒤입니다')

    // 2) 달별 시트 구성 후 브라우저 다운로드 트리거
    const sheets = buildLedgerSheets(data, startYm, endYm)
    await writeXlsxFile(sheets).toFile(`가계부_${startYm}_${endYm}.xlsx`)
}
