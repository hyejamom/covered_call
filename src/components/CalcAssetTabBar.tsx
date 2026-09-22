import { CALC_ASSET_META, CALC_ASSET_ORDER, type CalcAsset } from '../constants/assetConstants'

interface CalcAssetTabBarProps {
    /** 지금 보고 있는 종목 탭 */
    asset: CalcAsset
    /** 탭 선택 — @param asset 이동할 종목 탭 */
    onSelect: (asset: CalcAsset) => void
}

/**
 * 계산기 종목 탭 바 — 1번 TIGER 나스닥100커버드콜(ISA) / 2번 JEPQ(일반 계좌)
 * 두 탭은 화면 구성과 기능이 완전히 같고, 굴리는 종목과 계좌 세제만 다르다.
 * 파일·시트·이벤트도 탭마다 따로 보관되므로 탭을 옮겨도 서로의 계획이 섞이지 않는다.
 */
function CalcAssetTabBar(props: CalcAssetTabBarProps) {

    return (
        <div className={'calc_asset_tab_bar'} role={'tablist'} aria-label={'계산기 종목 전환'}>
            {CALC_ASSET_ORDER.map((value) => {
                // 1) 탭 표기 정보 — 번호 / 아이콘 / 종목명 / 계좌
                const meta = CALC_ASSET_META[value]
                const selected = value === props.asset

                return (
                    <button
                        key={value}
                        type={'button'}
                        role={'tab'}
                        aria-selected={selected}
                        className={selected ? 'calc_asset_tab calc_asset_tab_selected' : 'calc_asset_tab'}
                        onClick={() => props.onSelect(value)}
                        title={meta.description}
                    >
                        <span className={'calc_asset_tab_order'}>{meta.order}</span>
                        <span className={'calc_asset_tab_icon'}>{meta.icon}</span>

                        {/* 2) 종목명 + 계좌 — 계좌가 곧 세금 규칙이라 이름과 같은 비중으로 붙여 둔다 */}
                        <span className={'calc_asset_tab_text'}>
                            <span className={'calc_asset_tab_label'}>{meta.shortLabel}</span>
                            <span className={'calc_asset_tab_account'}>{meta.accountLabel}</span>
                        </span>

                        <span className={'calc_asset_tab_ticker'}>{meta.ticker}</span>
                    </button>
                )
            })}
        </div>
    )
}

export default CalcAssetTabBar
