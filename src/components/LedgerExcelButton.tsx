import { useEffect, useState } from 'react'
import { formatYmTitle, monthDiff, shiftYm, todayYm } from '../constants/ledgerConstants'
import { downloadLedger } from '../services/excelService'
import type { LedgerData } from '../types/ledger'

/** 시작 월 선택 범위 — 오늘 기준 몇 년 전까지 거슬러 고를 수 있는지 */
const SELECTABLE_YEARS_BACK = 10

/** 달마다 시트를 1장씩 만들므로, 이 이상 고르면 파일이 지나치게 커진다는 경고를 띄운다 */
const MANY_SHEETS_THRESHOLD = 36

interface LedgerExcelButtonProps {
    /** 내보낼 가계부 원본 데이터 한 벌 */
    data: LedgerData
}

/**
 * 가계부 엑셀 내보내기 — 버튼을 누르면 기간 선택 모달이 뜨고, 고른 기간의 달마다 시트 1장으로 저장한다.
 * 종료 월은 이번 달을 넘길 수 없다. 아직 오지 않은 달은 고정비만 찍혀 나와 오해를 부르기 때문이다.
 */
function LedgerExcelButton(props: LedgerExcelButtonProps) {

    // ┣━━━━━━━━━━━━━━━━ States ━━━━━━━━━━━━━━━━━━━━━┫
    const [open, setOpen] = useState<boolean>(false)                     // 기간 선택 모달 노출 여부
    const [startYm, setStartYm] = useState<string>(() => shiftYm(todayYm(), -11))   // 시작 월 — 기본 최근 12개월
    const [endYm, setEndYm] = useState<string>(() => todayYm())          // 종료 월 — 기본 이번 달
    const [downloading, setDownloading] = useState<boolean>(false)       // 파일 생성 중 여부
    const [error, setError] = useState<string | null>(null)              // 생성 실패 메시지

    // ┣━━━━━━━━━━━━━━━━ Effects ━━━━━━━━━━━━━━━━━━━━┫

    // 1) ESC 로 닫기 — 파일을 만드는 중에는 무시한다
    useEffect(() => {
        if (!open) return

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape' && !downloading) setOpen(false)
        }

        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [open, downloading])

    // ┣━━━━━━━━━━━━━━━━ Derived ━━━━━━━━━━━━━━━━━━━━┫
    // 1) 고를 수 있는 상한 — 이번 달. 이보다 뒤는 선택지 자체를 만들지 않는다
    const maxYm = todayYm()

    // 2) 만들어질 시트 수 = 기간에 포함된 달 수. 시작이 종료보다 뒤면 0
    const span = monthDiff(startYm, endYm)
    const sheetCount = span < 0 ? 0 : span + 1

    // 3) 내려받기 가능 여부
    const downloadable = sheetCount > 0 && !downloading

    // ┣━━━━━━━━━━━━━━━━ Handlers ━━━━━━━━━━━━━━━━━━━┫

    /** 모달 열기 — 이전 실패 메시지는 지우고 연다 */
    const handleOpen = () => {
        setError(null)
        setOpen(true)
    }

    /** 모달 닫기 — 내려받는 중에는 닫지 않는다 */
    const handleClose = () => {
        if (downloading) return
        setOpen(false)
    }

    /** 시작 월 변경 — @param value 'YYYY-MM'. 종료 월보다 뒤로 가면 종료 월을 같이 밀어 준다 */
    const handleStartChange = (value: string) => {
        setStartYm(value)
        if (monthDiff(value, endYm) < 0) setEndYm(value)
    }

    /** 종료 월 변경 — @param value 'YYYY-MM'. 시작 월보다 앞이면 시작 월을 같이 당겨 준다 */
    const handleEndChange = (value: string) => {
        setEndYm(value)
        if (monthDiff(startYm, value) < 0) setStartYm(value)
    }

    /** 다운로드 실행 — 성공하면 모달을 닫는다 */
    const handleDownload = async () => {
        setDownloading(true)
        setError(null)
        try {
            await downloadLedger(props.data, startYm, endYm)
            setOpen(false)
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : '엑셀 생성에 실패했습니다')
        } finally {
            setDownloading(false)
        }
    }

    return (
        <div className={'ledger_excel'}>
            {/* 1) 트리거 버튼 — 기간을 먼저 고르게 하려고 바로 받지 않고 모달을 연다 */}
            <button
                type={'button'}
                className={'ledger_excel_button'}
                onClick={handleOpen}
                title={'기간을 골라 월별 시트로 내려받습니다'}
            >
                <span className={'ledger_excel_icon'}>⤓</span>
                엑셀 다운로드
            </button>

            {/* 2) 기간 선택 모달 — 배경을 누르면 닫힌다 */}
            {open && (
                <div className={'ledger_modal_backdrop'} onClick={handleClose}>
                    <div
                        className={'ledger_modal'}
                        role={'dialog'}
                        aria-modal={'true'}
                        aria-label={'가계부 엑셀 다운로드'}
                        onClick={(event) => event.stopPropagation()}
                    >
                        <div className={'ledger_modal_head'}>
                            <h3 className={'ledger_modal_title'}>가계부 엑셀 다운로드</h3>
                            <button
                                type={'button'}
                                className={'ledger_modal_close'}
                                onClick={handleClose}
                                title={'닫기'}
                            >
                                ×
                            </button>
                        </div>

                        {/* 2-1) 기간 선택 — 시작 ~ 종료. 종료는 이번 달이 상한 */}
                        <div className={'ledger_modal_body'}>
                            <div className={'ledger_modal_range'}>
                                <label className={'ledger_modal_field'}>
                                    <span className={'ledger_modal_label'}>시작</span>
                                    <MonthSelect
                                        value={startYm}
                                        maxYm={maxYm}
                                        disabled={downloading}
                                        onChange={handleStartChange}
                                    />
                                </label>
                                <span className={'ledger_modal_tilde'}>~</span>
                                <label className={'ledger_modal_field'}>
                                    <span className={'ledger_modal_label'}>종료</span>
                                    <MonthSelect
                                        value={endYm}
                                        maxYm={maxYm}
                                        disabled={downloading}
                                        onChange={handleEndChange}
                                    />
                                </label>
                            </div>

                            {/* 2-2) 결과 미리 알리기 — 몇 장짜리 파일이 나오는지 */}
                            <p className={'ledger_modal_note'}>
                                {sheetCount > 0
                                    ? `${formatYmTitle(startYm)} ~ ${formatYmTitle(endYm)} · 시트 ${sheetCount}장 (한 달에 1장)`
                                    : '시작 월이 종료 월보다 뒤입니다'}
                            </p>
                            {sheetCount > MANY_SHEETS_THRESHOLD && (
                                <p className={'ledger_modal_warn'}>
                                    기간이 길어 시트가 {sheetCount}장 만들어집니다. 파일 생성에 시간이 걸릴 수 있습니다.
                                </p>
                            )}
                            {error && <p className={'ledger_modal_error'}>{error}</p>}
                        </div>

                        {/* 2-3) 하단 버튼 */}
                        <div className={'ledger_modal_foot'}>
                            <button
                                type={'button'}
                                className={'ledger_cancel'}
                                onClick={handleClose}
                                disabled={downloading}
                            >
                                취소
                            </button>
                            <button
                                type={'button'}
                                className={'ledger_submit'}
                                onClick={handleDownload}
                                disabled={!downloadable}
                            >
                                {downloading ? '생성 중…' : '다운로드'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}

interface MonthSelectProps {
    /** 'YYYY-MM' */
    value: string
    /** 고를 수 있는 상한 'YYYY-MM' — 이 달까지만 선택지에 넣는다 */
    maxYm: string
    disabled: boolean
    onChange: (value: string) => void
}

/**
 * 연 / 월 셀렉트 한 쌍 — 상한(maxYm)을 넘는 달은 선택지에서 아예 빼 버린다.
 * 상한과 같은 해를 고르면 월 목록이 상한 월까지만 나오므로, 미래 달을 고를 방법이 없다.
 */
function MonthSelect(props: MonthSelectProps) {

    // ┣━━━━━━━━━━━━━━━━ Derived ━━━━━━━━━━━━━━━━━━━━┫
    // 1) 'YYYY-MM' 분해
    const parts = props.value.split('-')
    const year = Number(parts[0])
    const month = Number(parts[1])

    // 2) 상한 분해 — 상한 연도와 같은 해면 월 목록을 잘라 낸다
    const maxParts = props.maxYm.split('-')
    const maxYear = Number(maxParts[0])
    const maxMonth = Number(maxParts[1])

    // 3) 연도 목록 — 상한 연도부터 SELECTABLE_YEARS_BACK 년 전까지 (최신이 위로)
    const years = Array.from({ length: SELECTABLE_YEARS_BACK + 1 }, (_, index) => maxYear - index)

    // 4) 월 목록 — 상한 연도를 고른 상태면 상한 월까지만
    const lastMonth = year === maxYear ? maxMonth : 12
    const months = Array.from({ length: lastMonth }, (_, index) => index + 1)

    // ┣━━━━━━━━━━━━━━━━ Handlers ━━━━━━━━━━━━━━━━━━━┫

    /** 연도 변경 — @param value 선택된 연도. 상한 연도로 옮기며 월이 상한을 넘으면 상한 월로 당긴다 */
    const handleYearChange = (value: string) => {
        const nextYear = Number(value)
        const nextMonth = nextYear === maxYear && month > maxMonth ? maxMonth : month
        props.onChange(`${nextYear}-${String(nextMonth).padStart(2, '0')}`)
    }

    /** 월 변경 — @param value 선택된 월(2자리) */
    const handleMonthChange = (value: string) => {
        props.onChange(`${year}-${value}`)
    }

    return (
        <div className={'ledger_modal_picker'}>
            <select
                className={'ledger_field'}
                value={String(year)}
                disabled={props.disabled}
                onChange={(event) => handleYearChange(event.target.value)}
            >
                {years.map((item) => (
                    <option key={item} value={String(item)}>{item}년</option>
                ))}
            </select>
            <select
                className={'ledger_field'}
                value={String(month).padStart(2, '0')}
                disabled={props.disabled}
                onChange={(event) => handleMonthChange(event.target.value)}
            >
                {months.map((item) => (
                    <option key={item} value={String(item).padStart(2, '0')}>{item}월</option>
                ))}
            </select>
        </div>
    )
}

export default LedgerExcelButton