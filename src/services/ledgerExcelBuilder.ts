import type { Row, SheetData } from 'write-excel-file/browser'
import { FIXED_COST_TYPE_LABEL, LedgerKind, type LedgerMonthReport } from '../types/ledger'
import { ERRAND_LABEL, formatDateShort, monthDiff, shiftYm } from '../constants/ledgerConstants'
import { toMonthReport } from './ledgerEngine'
import type { LedgerData } from '../types/ledger'
import type { WorkbookSheet } from './excelSheetBuilder'

// ══════════ 가계부 엑셀 시트 생성 ══════════
//
// 고른 기간의 "달마다 시트 1장"을 만든다. 2026-01 ~ 2026-08 을 고르면 시트는 앞에서부터 8장이다.
// 한 장에 담기는 것은 가계부 화면과 같은 순서 — 요약 / 고정 수입 / 고정비·할부 / 카드 정산 / 분류별 지출 / 입출금 내역.
// 금액은 전부 "서식이 적용된 숫자"로 넣어 엑셀에서 그대로 합계를 낼 수 있게 한다.

// ┣━━━━━━━━━━━━━━━━ 스타일 상수 ━━━━━━━━━━━━━━━┫
// 화면과 같은 컨셉 팔레트(A0937D · E7D4B5 · F6E6CB · B6C7AA)

const COLOR_SECTION_BG = '#E7D4B5'   // 구획 제목 줄 — 탄
const COLOR_HEAD_BG = '#F6E6CB'      // 표 머리글 — 크림
const COLOR_TOTAL_BG = '#B6C7AA'     // 저축 가능액 등 결론 줄 — 세이지
const COLOR_BORDER = '#A0937D'       // 셀 테두리 — 토프

/** 원 단위 정수 서식 — 천단위 콤마 */
const MONEY_FORMAT = '#,##0'

/** 열 폭 — 7열 구성 (항목 / 분류 / 카드·메모 / 값1 / 값2 / 값3 / 값4) */
const COLUMNS = [{ width: 18 }, { width: 20 }, { width: 24 }, { width: 16 }, { width: 16 }, { width: 16 }, { width: 16 }]

// ┣━━━━━━━━━━━━━━━━ 셀 유틸 ━━━━━━━━━━━━━━━━━━━┫

/** 구획 제목 셀 — @param text 제목. 한 줄 전체를 탄 배경으로 깐다 */
function sectionCell(text: string) {
    return {
        value: text,
        fontWeight: 'bold' as const,
        fontSize: 12,
        align: 'left' as const,
        backgroundColor: COLOR_SECTION_BG,
        borderColor: COLOR_BORDER,
        borderStyle: 'thin' as const,
    }
}

/** 표 머리글 셀 — @param text 열 이름, @param align 정렬 */
function headCell(text: string, align: 'left' | 'right' | 'center' = 'left') {
    return {
        value: text,
        fontWeight: 'bold' as const,
        align,
        backgroundColor: COLOR_HEAD_BG,
        borderColor: COLOR_BORDER,
        borderStyle: 'thin' as const,
    }
}

/** 글자 셀 — @param text 값(빈 값이면 테두리만 있는 빈 칸), @param bold 굵게 여부 */
function textCell(text: string, bold = false) {
    const base = {
        align: 'left' as const,
        fontWeight: bold ? ('bold' as const) : undefined,
        borderColor: COLOR_BORDER,
        borderStyle: 'thin' as const,
    }
    // 값 없는 셀에 type 을 함께 넘기면 라이브러리가 예외를 던지므로 반드시 제외한다
    return text === '' ? base : { ...base, value: text, type: String }
}

/** 금액 셀 — @param amount 원 단위 금액(null 이면 빈 칸), @param bold 굵게 여부 */
function moneyCell(amount: number | null, bold = false) {
    const base = {
        align: 'right' as const,
        fontWeight: bold ? ('bold' as const) : undefined,
        borderColor: COLOR_BORDER,
        borderStyle: 'thin' as const,
    }
    return amount === null ? base : { ...base, value: amount, type: Number, format: MONEY_FORMAT }
}

/** 결론 줄 셀(저축 가능액) — @param text 라벨, @param amount 금액 */
function totalRow(text: string, amount: number): Row {
    const style = {
        fontWeight: 'bold' as const,
        fontSize: 12,
        backgroundColor: COLOR_TOTAL_BG,
        borderColor: COLOR_BORDER,
        borderStyle: 'thin' as const,
    }
    return [
        { ...style, value: text, type: String, align: 'left' as const },
        { ...style, value: amount, type: Number, format: MONEY_FORMAT, align: 'right' as const },
    ]
}

// ┣━━━━━━━━━━━━━━━━ 시트 데이터 ━━━━━━━━━━━━━━━┫

/**
 * 한 달치 시트 데이터 — 화면의 가계부와 같은 순서로 쌓는다
 * @param report 그 달 집계 결과 (toMonthReport 결과)
 */
function buildMonthSheet(report: LedgerMonthReport): SheetData {
    const rows: SheetData = []
    const summary = report.summary

    // 1) 월 요약 — 들어온 돈 / 나간 돈 / 저축 가능액
    rows.push([sectionCell(`${report.ym} 요약`)])
    rows.push([headCell('구분'), headCell('금액', 'right')])
    rows.push([textCell('수입 (직접 입력)'), moneyCell(summary.income)])
    rows.push([textCell('고정 수입'), moneyCell(summary.fixedIncome)])
    rows.push([textCell('고정비 · 할부'), moneyCell(summary.fixed)])
    rows.push([textCell('카드 사용'), moneyCell(summary.cardUsed)])
    // 1-1) 심부름으로 걷어낸 몫 — 위 카드 사용에서 이미 빠져 있다. 명세서 총액과 대조할 때 필요해 함께 적는다
    if (summary.errand > 0) rows.push([textCell(`└ ${ERRAND_LABEL} (카드 사용에서 제외됨)`), moneyCell(summary.errand)])
    rows.push([textCell('└ 큰 지출 (직접 입력)'), moneyCell(summary.expense)])
    rows.push([textCell('└ 생활비 (나머지)'), moneyCell(summary.living)])
    rows.push([textCell('총지출', true), moneyCell(summary.total, true)])
    rows.push(totalRow('저축 가능액', summary.net))

    // 2) 고정 수입 — 그 달 자동으로 잡힌 건
    if (report.incomes.length > 0) {
        rows.push([])
        rows.push([sectionCell('고정 수입')])
        rows.push([headCell('항목'), headCell('분류'), headCell('시작'), headCell('금액', 'right')])
        report.incomes.forEach((income) => {
            rows.push([
                textCell(income.name),
                textCell(income.category),
                textCell(income.startYm),
                moneyCell(income.amount),
            ])
        })
    }

    // 3) 고정비 · 할부 — 할부는 진행 회차를 함께 적는다
    if (report.charges.length > 0) {
        rows.push([])
        rows.push([sectionCell('고정비 · 할부')])
        rows.push([
            headCell('형태'),
            headCell('항목'),
            headCell('분류'),
            headCell('회차'),
            headCell('이번 달 금액', 'right'),
        ])
        report.charges.forEach((charge) => {
            rows.push([
                textCell(FIXED_COST_TYPE_LABEL[charge.cost.type]),
                textCell(charge.cost.name),
                textCell(charge.cost.category),
                textCell(charge.round > 0 ? `${charge.round}/${charge.cost.months}` : '-'),
                moneyCell(charge.amount),
            ])
        })
    }

    // 4) 카드 정산 — 청구 총액에서 자동 청구분과 엄마 심부름을 걷어낸 실제 사용액
    if (report.cardStatements.length > 0) {
        rows.push([])
        rows.push([sectionCell('카드 정산')])
        rows.push([
            headCell('카드'),
            headCell('청구 총액', 'right'),
            headCell('할부', 'right'),
            headCell('고정비', 'right'),
            headCell(ERRAND_LABEL, 'right'),
            headCell('실제 사용', 'right'),
        ])
        report.cardStatements.forEach((statement) => {
            rows.push([
                textCell(statement.card.name),
                moneyCell(statement.total),
                moneyCell(statement.installment),
                moneyCell(statement.recurring),
                moneyCell(statement.errand),
                moneyCell(statement.actual, true),
            ])

            // 4-1) 심부름은 건별로 적어 둔 값이라 카드 줄 아래에 내역을 펼쳐 둔다 (엑셀에서 대조할 수 있게)
            statement.errands.forEach((errand) => {
                rows.push([
                    textCell(''),
                    textCell(`└ ${errand.memo === '' ? '(내용 없음)' : errand.memo}`),
                    textCell(''),
                    textCell(''),
                    moneyCell(errand.amount),
                ])
            })
        })
    }

    // 5) 분류별 지출 — 총지출 대비 비중까지 (생활비 포함)
    if (report.expenseByCategory.length > 0) {
        rows.push([])
        rows.push([sectionCell('분류별 지출')])
        rows.push([headCell('분류'), headCell('금액', 'right'), headCell('비중', 'right')])
        report.expenseByCategory.forEach((item) => {
            rows.push([
                textCell(item.category),
                moneyCell(item.amount),
                { ...moneyCell(item.ratio), format: '0.0%' },
            ])
        })
    }

    // 6) 입출금 내역 — 직접 적어 넣은 건만
    rows.push([])
    rows.push([sectionCell('입출금 내역 (직접 입력)')])
    if (report.entries.length === 0) {
        rows.push([textCell('기록 없음')])
        return rows
    }

    rows.push([headCell('날짜'), headCell('구분'), headCell('분류'), headCell('내용'), headCell('금액', 'right')])
    report.entries.forEach((entry) => {
        rows.push([
            textCell(formatDateShort(entry.date)),
            textCell(entry.kind === LedgerKind.INCOME ? '수입' : '지출'),
            textCell(entry.category),
            textCell(entry.memo),
            moneyCell(entry.amount),
        ])
    })

    return rows
}

// ┣━━━━━━━━━━━━━━━━ API ━━━━━━━━━━━━━━━━━━━━━━━┫

/**
 * 기간에 포함되는 달 목록 — 시작 월부터 종료 월까지 오름차순
 * @param startYm 시작 월 'YYYY-MM'
 * @param endYm 종료 월 'YYYY-MM'
 * @returns 시작이 종료보다 뒤면 빈 배열
 */
export function toYmRange(startYm: string, endYm: string): string[] {
    const span = monthDiff(startYm, endYm)
    if (span < 0) return []
    return Array.from({ length: span + 1 }, (_, index) => shiftYm(startYm, index))
}

/**
 * 시트명 — 기간이 한 해 안이면 "8월", 해를 넘기면 "2026-08" 로 적어 같은 이름이 겹치지 않게 한다
 * @param ym 대상 월 'YYYY-MM'
 * @param sameYear 기간 전체가 같은 해인지
 */
function toSheetName(ym: string, sameYear: boolean): string {
    const parts = ym.split('-')
    return sameYear ? `${Number(parts[1])}월` : ym
}

/**
 * 가계부를 월별 시트로 변환 — 시트 1장 = 한 달
 * @param data 가계부 원본 데이터 한 벌
 * @param startYm 시작 월 'YYYY-MM'
 * @param endYm 종료 월 'YYYY-MM'
 */
export function buildLedgerSheets(data: LedgerData, startYm: string, endYm: string): WorkbookSheet[] {
    const yms = toYmRange(startYm, endYm)

    // 1) 기간이 한 해 안에 들어오는지 — 시트명 표기를 가른다
    const sameYear = yms.every((ym) => ym.slice(0, 4) === yms[0].slice(0, 4))

    // 2) 달마다 화면과 같은 규칙으로 집계해 시트 1장씩 만든다
    return yms.map((ym) => ({
        data: buildMonthSheet(toMonthReport(data, ym)),
        sheet: toSheetName(ym, sameYear),
        columns: COLUMNS,
        stickyRowsCount: 1,
    }))
}