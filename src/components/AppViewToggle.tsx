import { APP_VIEW_META, AppView, toOppositeView } from '../constants/appViewConstants'

interface AppViewToggleProps {
    /** 지금 보고 있는 화면 */
    view: AppView
    /** 반대편 화면으로 전환 */
    onToggle: () => void
}

/**
 * 화면 전환 토글 — 화면 좌측 상단에 고정되어 스크롤과 무관하게 항상 노출된다.
 * 버튼에는 "지금 화면"과 "누르면 갈 화면"을 함께 표기해, 무엇으로 바뀌는지 눌러 보기 전에 알 수 있게 한다.
 */
function AppViewToggle(props: AppViewToggleProps) {

    // ┣━━━━━━━━━━━━━━━━ Derived ━━━━━━━━━━━━━━━━━━━━┫
    const current = APP_VIEW_META[props.view]
    const next = APP_VIEW_META[toOppositeView(props.view)]

    return (
        <button
            type={'button'}
            className={'app_view_toggle'}
            onClick={props.onToggle}
            title={`${next.label} 화면으로 전환합니다`}
        >
            {/* 1) 현재 화면 — 지금 어디에 있는지 */}
            <span className={'app_view_toggle_current'}>
                <span className={'app_view_toggle_icon'}>{current.icon}</span>
                {current.label}
            </span>

            {/* 2) 전환 대상 — 누르면 갈 곳 */}
            <span className={'app_view_toggle_arrow'}>→</span>
            <span className={'app_view_toggle_next'}>
                <span className={'app_view_toggle_icon'}>{next.icon}</span>
                {next.label}
            </span>
        </button>
    )
}

export default AppViewToggle