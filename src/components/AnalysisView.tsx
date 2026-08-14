import { ANALYSIS_SYMBOL_META, ANALYSIS_SYMBOL_ORDER, type AnalysisSymbol } from '../constants/analysisConstants'
import { useTechnical } from '../hooks/useTechnical'
import { PRICE_ZONE_LABEL, PriceZone, type TechnicalReport } from '../types/technical'

/** 구간별 배너 클래스 — 싼 편은 세이지, 비싼 편은 테라코타 */
const ZONE_CLASS: Record<PriceZone, string> = {
    [PriceZone.CHEAP]: 'zone_badge zone_badge_cheap',
    [PriceZone.FAIR]: 'zone_badge zone_badge_fair',
    [PriceZone.EXPENSIVE]: 'zone_badge zone_badge_expensive',
}

/** 달러 표기 — @param value 금액 */
function toUsd(value: number): string {
    return `$${value.toFixed(2)}`
}

/**
 * 분석 화면 — "지금 사도 되는 값인가"만 답한다.
 * 종목별로 상장 이후 일별 종가를 받아 매수/매도 기준가 두 개로 압축해 카드 한 장씩 쌓는다.
 * 종목마다 조회·계산이 완전히 독립이라 카드가 각자 자기 훅을 돌린다(하나가 실패해도 나머지는 그려진다).
 */
function AnalysisView() {
    return (
        <div className={'analysis_view'}>
            {ANALYSIS_SYMBOL_ORDER.map((symbol) => (
                <SymbolVerdictCard key={symbol} symbol={symbol} />
            ))}
        </div>
    )
}

interface SymbolVerdictCardProps {
    /** 판정할 종목 코드 */
    symbol: AnalysisSymbol
}

/** 종목 카드 한 장 — 조회 상태를 스스로 들고 있다가 값이 확정되면 판정 본문으로 넘긴다 */
function SymbolVerdictCard(props: SymbolVerdictCardProps) {

    // ┣━━━━━━━━━━━━━━━━ CustomHooks ━━━━━━━━━━━━━━━━┫
    const technical = useTechnical(props.symbol)

    // 1) 조회 중 / 실패 — 그릴 값이 없으므로 같은 자리에 안내 카드로 대체한다
    if (technical.loading) {
        return <VerdictPlaceholder symbol={props.symbol} message={'시세를 불러와 기준가를 계산하는 중입니다…'} />
    }

    if (technical.error !== null || technical.data === null) {
        return (
            <VerdictPlaceholder
                symbol={props.symbol}
                message={`시세를 불러오지 못했습니다 — ${technical.error ?? '데이터 없음'}`}
            />
        )
    }

    return <PriceVerdict report={technical.data} />
}

interface VerdictPlaceholderProps {
    /** 표기할 종목 코드 */
    symbol: AnalysisSymbol
    /** 본문 대신 보여 줄 안내 문구 */
    message: string
}

/** 판정 전 자리지킴 — 머리띠는 그대로 두어 어느 종목이 대기 중인지 보이게 한다 */
function VerdictPlaceholder(props: VerdictPlaceholderProps) {
    return (
        <section className={'verdict_card'}>
            <VerdictCardHead symbol={props.symbol} />
            <p className={'analysis_empty_page'}>{props.message}</p>
        </section>
    )
}

interface VerdictCardHeadProps {
    /** 표기할 종목 코드 */
    symbol: AnalysisSymbol
    /** 기준일 'YYYY-MM-DD' — 아직 조회 전이면 생략한다 */
    asOf?: string
}

/** 카드 머리띠 — 종목 코드 · 종목 설명 · 기준일 */
function VerdictCardHead(props: VerdictCardHeadProps) {
    return (
        <header className={'verdict_card_head'}>
            <span className={'verdict_head_left'}>
                <span className={'verdict_symbol'}>{props.symbol}</span>
                <span className={'verdict_symbol_name'}>{ANALYSIS_SYMBOL_META[props.symbol].name}</span>
            </span>
            {props.asOf !== undefined && (
                <span className={'verdict_asof'}>기준 {props.asOf} · 종가</span>
            )}
        </header>
    )
}

interface PriceVerdictProps {
    /** 계산이 끝난 판정 결과 */
    report: TechnicalReport
}

/** 판정 본문 — 값이 확정된 뒤에만 그려지므로 null 검사 없이 쓴다 */
function PriceVerdict(props: PriceVerdictProps) {

    // ┣━━━━━━━━━━━━━━━━ Derived ━━━━━━━━━━━━━━━━━━━━┫
    const report = props.report
    const symbol = report.symbol as AnalysisSymbol

    // 1) 막대 위 현재가 위치 — 매수선 아래/매도선 위로 벗어나도 막대 안에 머물게 가둔다
    const span = report.sellLevel - report.buyLevel
    const rawRatio = span > 0 ? (report.price - report.buyLevel) / span : 0.5
    const markerPercent = Math.min(100, Math.max(0, rawRatio * 100))

    // 1-1) 현재가 라벨은 점과 같은 지점에 붙인다. 가운데 정렬로 두면 점과 라벨이 따로 놀아 값이 어긋나 보인다.
    //      다만 양 끝에서는 translateX(-50%) 가 카드 밖으로 삐져나가므로 그때만 끝에 붙인다.
    const nowLabelStyle = markerPercent < 8
        ? { left: 0 }
        : markerPercent > 92
            ? { right: 0 }
            : { left: `${markerPercent}%`, transform: 'translateX(-50%)' }

    // 2) 한 줄 결론 — 지금 사야 하는지, 기다려야 하는지
    const action = report.zone === PriceZone.CHEAP
        ? '200일선까지 눌렸습니다 — 모아 둔 현금을 넣는 자리'
        : report.zone === PriceZone.EXPENSIVE
            ? '과열 구간입니다 — 신규 매수를 멈추고 덜어낼지 판단할 자리'
            : `${(report.gapToBuy * 100).toFixed(1)}% 더 빠져 ${toUsd(report.buyLevel)}에 닿으면 매수 — 그때까지 현금 보유`

    return (
        // 판정 카드 한 장 — 머리띠 / 현재가 / 위치 막대 / 기준가 2열 / 근거 순으로 한 상자 안에 쌓는다
        <section className={'verdict_card'}>

            {/* 1) 머리띠 — 종목과 기준일 */}
            <VerdictCardHead symbol={symbol} asOf={report.asOf} />

            {/* 2) 본문 3열 — 왼쪽에 판정, 오른쪽에 기준가 둘. 넓은 화면을 가로로 채운다 */}
            <div className={'verdict_card_body'}>
                <div className={'verdict_col verdict_col_now'}>
                    <div className={'verdict_price_row'}>
                        <strong className={'verdict_price'}>{toUsd(report.price)}</strong>
                        <span className={ZONE_CLASS[report.zone]}>{PRICE_ZONE_LABEL[report.zone]}</span>
                    </div>
                    <p className={'verdict_action'}>{action}</p>
                </div>

                <div className={'verdict_col level_col_buy'}>
                    <span className={'level_label'}>이 값 이하면 매수 · 200일선</span>
                    <strong className={'level_value'}>{toUsd(report.buyLevel)}</strong>
                    <span className={'level_gap'}>
                        {report.gapToBuy >= 0
                            ? `현재가에서 ${(report.gapToBuy * 100).toFixed(1)}% 아래`
                            : `이미 ${(-report.gapToBuy * 100).toFixed(1)}% 밑으로 내려옴`}
                    </span>
                </div>

                <div className={'verdict_col level_col_sell'}>
                    <span className={'level_label'}>
                        이 값 이상이면 과열 · 200일선 +{(report.sellDisparity * 100).toFixed(1)}%
                    </span>
                    <strong className={'level_value'}>{toUsd(report.sellLevel)}</strong>
                    <span className={'level_gap'}>
                        {report.gapToSell >= 0
                            ? `현재가에서 ${(report.gapToSell * 100).toFixed(1)}% 위`
                            : `이미 ${(-report.gapToSell * 100).toFixed(1)}% 넘어섬`}
                    </span>
                </div>
            </div>

            {/* 3) 위치 막대 — 카드 폭을 꽉 채워야 두 기준선 사이 위치가 정확히 읽힌다 */}
            <div className={'verdict_card_bar'}>
                {/* 3-1) 점과 현재가 라벨은 같은 좌표를 쓴다 */}
                <div className={'level_bar_track'}>
                    <div className={'level_bar'}>
                        <span className={'level_bar_marker'} style={{ left: `${markerPercent}%` }} />
                    </div>
                    <span className={'level_bar_now'} style={nowLabelStyle}>
                        현재 {toUsd(report.price)}
                    </span>
                </div>

                {/* 3-2) 양 끝 눈금 — 막대의 시작과 끝이 각각 무엇인지 */}
                <div className={'level_bar_foot'}>
                    <span>{toUsd(report.buyLevel)} 매수선</span>
                    <span>{toUsd(report.sellLevel)} 매도선</span>
                </div>
            </div>

            {/* 4) 근거 — 카드 바닥에 깔되 톤을 낮춰 본문과 섞이지 않게 한다 */}
            <footer className={'verdict_card_foot'}>
                <p className={'verdict_basis_text'}>
                    매수선은 <b>200일선 그 자체</b>, 과열선은 상장 이후 이격도 상위 10%에 해당하는
                    200일선 +{(report.sellDisparity * 100).toFixed(1)}% 입니다. 지금은 200일선보다
                    {' '}<b>{(report.disparity * 100).toFixed(1)}%</b> 위, 최근 1년 종가 범위의
                    {' '}<b>{(report.yearRatio * 100).toFixed(0)}% 지점</b>입니다.
                </p>
                {/* 기다리는 전략이라 "이 문이 얼마나 드물게 열리는지"와 대기 비용을 반드시 같이 알려 준다 */}
                <p className={'verdict_basis_text'}>
                    최근 1년 중 매수 구간이 열린 날은 <b>{report.buyDaysLastYear}일</b>뿐이었습니다.
                    {' '}{ANALYSIS_SYMBOL_META[symbol].waitingNote}
                </p>
            </footer>
        </section>
    )
}

export default AnalysisView