import { EventType, type InvestEvent } from '../types/simulation'
import YearMonthPicker from './YearMonthPicker'

// ┣━━━━━━━━━━━━━━━━ Constants ━━━━━━━━━━━━━━━━━━┫

/** 재투자 여부 선택지 — select 값은 문자열이므로 'Y' / 'N' 으로 다룬다 */
const REINVEST_YES = 'Y'
const REINVEST_NO = 'N'

// ┣━━━━━━━━━━━━━━━━ Components ━━━━━━━━━━━━━━━━━┫

interface ReinvestRuleRowProps {
    rule: InvestEvent
    /** 선택 가능한 연도 목록 — 파일의 대상 기간 */
    years: number[]
    onChange: (id: string, patch: Partial<InvestEvent>) => void
    onRemove: (id: string) => void
}

/** 재투자 구간 1행 — 시작 ~ 종료 기간과 재투자 여부 */
function ReinvestRuleRow(props: ReinvestRuleRowProps) {

    // ┣━━━━━━━━━━━━━━━━ Handlers ━━━━━━━━━━━━━━━━━━━┫

    /** 연월 변경 — @param key 대상 필드 @param value 'YYYY-MM' 문자열 */
    const handleYmChange = (key: 'startYm' | 'endYm', value: string) => {
        props.onChange(props.rule.id, { [key]: value })
    }

    /** 재투자 여부 변경 — @param value 'Y'면 재투자, 'N'이면 인출 */
    const handleReinvestChange = (value: string) => {
        props.onChange(props.rule.id, { reinvest: value === REINVEST_YES })
    }

    return (
        <div className={'reinvest_row'}>
            {/* 1) 시작 연월 */}
            <YearMonthPicker
                value={props.rule.startYm}
                years={props.years}
                onChange={(value) => handleYmChange('startYm', value)}
            />

            <span className={'reinvest_tilde'}>~</span>

            {/* 2) 종료 연월 — 미지정이면 끝까지 */}
            <YearMonthPicker
                value={props.rule.endYm}
                emptyLabel={'끝까지'}
                years={props.years}
                onChange={(value) => handleYmChange('endYm', value)}
            />

            {/* 3) 재투자 여부 */}
            <select
                className={`event_field reinvest_select ${props.rule.reinvest ? 'reinvest_select_on' : 'reinvest_select_off'}`}
                value={props.rule.reinvest ? REINVEST_YES : REINVEST_NO}
                onChange={(e) => handleReinvestChange(e.target.value)}
            >
                <option value={REINVEST_YES}>재투자 O</option>
                <option value={REINVEST_NO}>재투자 X (인출)</option>
            </select>

            {/* 4) 삭제 */}
            <button className={'event_remove'} type={'button'} onClick={() => props.onRemove(props.rule.id)}>✕</button>
        </div>
    )
}

interface ReinvestSectionProps {
    /** 재투자 구간 목록 (type === REINVEST 인 이벤트만) */
    rules: InvestEvent[]
    /** 선택 가능한 연도 목록 — 파일의 대상 기간 */
    years: number[]
    onAdd: (patch: Partial<InvestEvent>) => void
    onChange: (id: string, patch: Partial<InvestEvent>) => void
    onRemove: (id: string) => void
}

/**
 * 배당 재투자 구간 설정 섹션
 * 기간별로 배당을 재투자할지(O) 인출할지(X) 지정한다. 지정하지 않은 기간은 재투자한다.
 */
function ReinvestSection(props: ReinvestSectionProps) {

    // ┣━━━━━━━━━━━━━━━━ Handlers ━━━━━━━━━━━━━━━━━━━┫

    /** 구간 추가 — 재투자 타입으로 빈 기간 1건 삽입 */
    const handleAdd = () => {
        props.onAdd({
            type: EventType.REINVEST,
            startYm: '',
            endYm: '',
            amount: 0,
            includesRecurring: false,
            reinvest: true,
        })
    }

    return (
        <div className={'reinvest_section'}>
            {/* 1) 섹션 헤더 */}
            <div className={'reinvest_head'}>
                <h3 className={'reinvest_title'}>배당 재투자 구간</h3>
                <span className={'reinvest_desc'}>
                    지정하지 않은 기간은 재투자합니다 · 구간이 겹치면 나중에 시작한 구간이 우선 ·
                    "재투자 X" 기간의 배당은 인출되어 매수·잔액에 반영되지 않습니다 (월 정기 매수는 계속)
                </span>
            </div>

            {/* 2) 구간 목록 — 비어 있으면 컬럼 헤더 없이 안내만 */}
            {props.rules.length > 0 && (
                <div className={'reinvest_row reinvest_row_head'}>
                    <span>시작 연월</span>
                    <span />
                    <span>종료 연월</span>
                    <span>재투자 여부</span>
                    <span />
                </div>
            )}

            {props.rules.map((rule) => (
                <ReinvestRuleRow
                    key={rule.id}
                    rule={rule}
                    years={props.years}
                    onChange={props.onChange}
                    onRemove={props.onRemove}
                />
            ))}

            {/* 3) 구간 추가 */}
            <button
                className={props.rules.length > 0 ? 'event_add' : 'event_add event_add_empty'}
                type={'button'}
                onClick={handleAdd}
            >
                + 재투자 구간 추가
            </button>
        </div>
    )
}

export default ReinvestSection