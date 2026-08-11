import { MONTH_LABELS, SELECTABLE_YEARS } from '../constants/gridConstants'

interface YearMonthPickerProps {
    /** 'YYYY-MM' 형식. 빈 문자열이면 미지정 */
    value: string
    /** 지정하면 "미지정"을 허용하고 연도 셀렉트 첫 항목에 이 문구를 표시한다 (예: '끝까지') */
    emptyLabel?: string
    /** 선택 가능한 연도 목록 — 생략하면 전체 선택 가능 범위 */
    years?: number[]
    disabled?: boolean
    onChange: (value: string) => void
}

/**
 * 연월 선택기 — 연도 / 월 셀렉트 2개
 * 네이티브 <input type="month">는 브라우저마다 피커 동작이 달라 쓰기 불편해 직접 조합한다.
 * 넘겨받은 연도 목록(보통 파일의 대상 기간) 밖의 값은 아예 고를 수 없다.
 */
function YearMonthPicker(props: YearMonthPickerProps) {

    // ┣━━━━━━━━━━━━━━━━ Derived ━━━━━━━━━━━━━━━━━━━━┫
    // 1) 'YYYY-MM' 분해 — 형식이 아니면 둘 다 빈 값
    const parts = props.value.split('-')
    const year = parts.length === 2 ? parts[0] : ''
    const month = parts.length === 2 ? parts[1] : ''

    // 2) 미지정 허용 여부
    const allowEmpty = props.emptyLabel !== undefined

    // 3) 선택 가능한 연도 목록 — 지정이 없으면 전체 선택 가능 범위
    const years = props.years ?? SELECTABLE_YEARS

    // 4) 저장된 값이 현재 기간 밖이면(기간을 좁힌 경우) 선택지에 없어 빈칸으로 보이므로 안내용 항목을 덧댄다
    const outOfRange = year !== '' && !years.includes(Number(year))

    // ┣━━━━━━━━━━━━━━━━ Handlers ━━━━━━━━━━━━━━━━━━━┫

    /** 연도 변경 — @param value 선택된 연도(빈 값이면 전체 미지정으로 되돌린다) */
    const handleYearChange = (value: string) => {
        if (value === '') {
            props.onChange('')
            return
        }
        // 월이 아직 없으면 1월을 기본으로 채워 항상 완전한 'YYYY-MM'을 유지한다
        props.onChange(`${value}-${month === '' ? '01' : month}`)
    }

    /** 월 변경 — @param value 선택된 월(2자리). 연도가 없으면 시작 연도로 채운다 */
    const handleMonthChange = (value: string) => {
        props.onChange(`${year === '' ? years[0] : year}-${value}`)
    }

    return (
        <div className={'ym_picker'}>
            {/* 1) 연도 */}
            <select
                className={'event_field ym_picker_year'}
                value={year}
                disabled={props.disabled}
                onChange={(e) => handleYearChange(e.target.value)}
            >
                {allowEmpty && <option value={''}>{props.emptyLabel}</option>}
                {!allowEmpty && year === '' && <option value={''}>연도</option>}
                {/* 기간 밖 연도 — 값이 사라져 보이지 않도록 선택지로 남기되 기간 밖임을 표시한다 */}
                {outOfRange && <option value={year}>{year}년 (기간 밖)</option>}
                {years.map((item) => (
                    <option key={item} value={String(item)}>{item}년</option>
                ))}
            </select>

            {/* 2) 월 — 연도가 정해지지 않은 상태에서는 고를 수 없다 */}
            <select
                className={'event_field ym_picker_month'}
                value={month}
                disabled={props.disabled || (allowEmpty && year === '')}
                onChange={(e) => handleMonthChange(e.target.value)}
            >
                {month === '' && <option value={''}>월</option>}
                {MONTH_LABELS.map((label, index) => (
                    <option key={label} value={String(index + 1).padStart(2, '0')}>{label}</option>
                ))}
            </select>
        </div>
    )
}

export default YearMonthPicker