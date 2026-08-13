import { APP_VIEW_META, APP_VIEW_ORDER, AppView } from '../constants/appViewConstants'

interface AppTabBarProps {
    /** 지금 보고 있는 화면 */
    view: AppView
    /** 탭 선택 — @param view 이동할 화면 */
    onSelect: (view: AppView) => void
}

/**
 * 최상위 탭 바 — 화면 상단 중앙에 고정되어 스크롤과 무관하게 항상 노출된다.
 * 1 계산기 · 2 가계부 · 3 분석 순서로 놓고, 지금 보고 있는 탭만 밝게 띄운다.
 */
function AppTabBar(props: AppTabBarProps) {

    return (
        <div className={'app_tab_bar'} role={'tablist'} aria-label={'화면 전환'}>
            {APP_VIEW_ORDER.map((value) => {
                // 1) 탭 표기 정보 — 번호 / 아이콘 / 이름
                const meta = APP_VIEW_META[value]
                const selected = value === props.view

                return (
                    <button
                        key={value}
                        type={'button'}
                        role={'tab'}
                        aria-selected={selected}
                        className={selected ? 'app_tab app_tab_selected' : 'app_tab'}
                        onClick={() => props.onSelect(value)}
                        title={meta.description}
                    >
                        <span className={'app_tab_order'}>{meta.order}</span>
                        <span className={'app_tab_icon'}>{meta.icon}</span>
                        <span className={'app_tab_label'}>{meta.label}</span>
                    </button>
                )
            })}
        </div>
    )
}

export default AppTabBar
