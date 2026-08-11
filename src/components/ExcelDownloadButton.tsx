import { useState } from 'react'
import { downloadAllWorkbooks } from '../services/excelService'
import type { SimulationConstants } from '../types/simulation'
import type { Workbook } from '../types/workbook'

interface ExcelDownloadButtonProps {
    /** 내려받을 워크북 목록 — 워크북 1개당 엑셀 파일 1개가 생성된다 */
    workbooks: Workbook[]
    /** 전 탭 공통 고정 상수 — 내보내기 시점의 시세로 다시 계산한다 */
    constants: SimulationConstants
    /** 그룹 내부에 놓이는 작은 아이콘 버튼 여부 */
    compact?: boolean
}

/** 엑셀 다운로드 버튼 — 워크북 1개 = 파일 1개로 내려받는다 */
function ExcelDownloadButton(props: ExcelDownloadButtonProps) {

    // ┣━━━━━━━━━━━━━━━━ States ━━━━━━━━━━━━━━━━━━━━━┫
    const [downloading, setDownloading] = useState<boolean>(false)   // 파일 생성 중 여부
    const [error, setError] = useState<string | null>(null)          // 생성 실패 메시지

    // ┣━━━━━━━━━━━━━━━━ Handlers ━━━━━━━━━━━━━━━━━━━┫

    /** 다운로드 실행 — 워크북마다 엑셀 파일 1개씩 순차 저장 */
    const handleDownload = async () => {
        setDownloading(true)
        setError(null)
        try {
            await downloadAllWorkbooks(props.workbooks, props.constants)
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : '엑셀 생성에 실패했습니다')
        } finally {
            setDownloading(false)
        }
    }

    // 1) 그룹 내부용 — 아이콘만 있는 작은 버튼
    if (props.compact) {
        return (
            <button
                type={'button'}
                className={'excel_download_compact'}
                onClick={handleDownload}
                disabled={downloading}
                title={error ?? '이 파일만 엑셀로 내려받기'}
            >
                {downloading ? '…' : '⤓'}
            </button>
        )
    }

    // 2) 툴바 우측용 — 전체 파일 일괄 다운로드
    const fileCount = props.workbooks.length
    return (
        <div className={'excel_download'}>
            {error && <span className={'excel_download_error'}>{error}</span>}
            <button
                type={'button'}
                className={'excel_download_button'}
                onClick={handleDownload}
                disabled={downloading}
                title={`파일 ${fileCount}개를 각각 내려받습니다`}
            >
                <span className={'excel_download_icon'}>⤓</span>
                {downloading ? '생성 중…' : `엑셀 다운로드${fileCount > 1 ? ` (${fileCount})` : ''}`}
            </button>
        </div>
    )
}

export default ExcelDownloadButton