import {
    CALC_ASSET_META,
    CALC_ASSET_ORDER,
    CalcAsset,
    LEGACY_CALC_ASSET_KEY,
    isCalcAsset,
} from '../constants/assetConstants'
import { DEFAULT_END_YEAR, DEFAULT_START_YEAR, clampYear } from '../constants/gridConstants'
import { GROWTH_POLICY } from '../constants/simulationDefaults'
import { EventType, type InvestEvent, InvestTarget } from '../types/simulation'
import type { Workbook } from '../types/workbook'

// ══════════ 로컬 저장소 (localStorage) ══════════
// 서버가 없는 단일 사용자 도구라 브라우저 로컬 저장소에 스냅샷 1벌만 유지한다.
// 계산기가 종목 탭 2개(TIGER 나스닥100커버드콜 · JEPQ)를 오가므로 스냅샷도 종목별로 칸을 나눠 담는다.
// 이 레이어는 순수 I/O만 담당하고, 실패 메시지·토스트는 호출측(컴포넌트)에서 처리한다.

/**
 * 저장 키 — 값 자체를 갈아 끼우는 마이그레이션은 아래 version 으로 처리하므로 키는 고정이다.
 * (키를 바꾸면 과거 데이터가 통째로 버려져 사용자가 짜 둔 계획이 날아간다)
 */
const STORAGE_KEY = 'call_workbook_state_v1'

/**
 * 현재 스냅샷 구조 버전 — 낮은 버전으로 저장된 스냅샷은 로드 시 끌어올린다.
 * v1 → v2: 성장자산 기본 수익률을 연 10% → 9%(주가 8.4% + 배당 0.6%) 로 하향 (GROWTH_POLICY 참고)
 * v2 → v3: 종목 탭 도입. 최상위 workbooks/activeTabId 를 종목별 슬라이스(assets)로 감싼다.
 *          v2 까지의 저장본은 전부 JEPQ 하나만 다루던 데이터이므로 통째로 JEPQ 칸으로 옮긴다.
 */
const STORAGE_VERSION = 3

/** v1 시절의 성장자산 기본 수익률 (%) — 이 값으로 저장된 행만 신규 기본값으로 옮긴다 */
const LEGACY_GROWTH_RATE_PERCENT = 10

/**
 * 주가 변동률 도입 이전 저장본에 채워 넣을 값 (%)
 * — 그때는 주가 고정으로 계산되던 데이터이므로 0 이어야 그 시절 숫자가 그대로 재현된다.
 *   새 파일의 기본값(종목 메타의 defaultDriftPercent)과 일부러 분리해 둔다.
 *   여기에 새 기본값을 쓰면 사용자가 짜 둔 옛 계획의 수치가 조용히 달라진다.
 */
const LEGACY_DRIFT_PERCENT = 0

/** 종목 1개분 저장 단위 — 그 종목 탭에서 보고 있던 파일 목록과 선택 탭 */
export interface AssetStateDto {
    /** 워크북(=엑셀 파일) 전체 목록 */
    workbooks: Workbook[]
    /** 저장 시점에 선택돼 있던 탭 id */
    activeTabId: string
}

/** 종목별 저장 단위 묶음 — 계산기 상태 한 벌 */
export type AssetStateMap = Record<CalcAsset, AssetStateDto>

/** localStorage에 직렬화되는 스냅샷 형태 */
export interface SavedStateDto {
    /** 스냅샷 구조 버전 — 현재 버전보다 높으면(=미래 저장본) 로드하지 않는다 */
    version: number
    /** 저장 시각 (ISO 문자열) */
    savedAt: string
    /** 종목별 워크북 상태 */
    assets: AssetStateMap
}

/** v2 이하 저장본 형태 — 종목 구분 없이 워크북 목록만 들고 있었다 */
interface LegacyStateDto {
    version: number
    savedAt: string
    workbooks: Workbook[]
    activeTabId: string
}

/**
 * 승격 대상 스냅샷 — 로컬 저장본과 서버 응답을 같은 함수로 처리하기 위한 느슨한 입력 형태.
 * v3 면 assets 가, v2 이하면 workbooks/activeTabId 가 채워져 온다.
 */
export interface RestorableSnapshot {
    version: number
    savedAt: string
    assets?: AssetStateMap
    workbooks?: Workbook[]
    activeTabId?: string
}

/** 마지막으로 영속화된 시점 표식 — 미저장 변경 여부 판정에 쓴다 */
export interface PersistedMark {
    /** 저장 시점의 상태 지문 (null이면 저장 이력 없음) */
    signature: string | null
    /** 저장 시각 ISO 문자열 (null이면 저장 이력 없음) */
    at: string | null
}

// ┣━━━━━━━━━━━━━━━━ Helpers ━━━━━━━━━━━━━━━━━━━━┫

/**
 * 저장 상태 비교용 지문 생성
 * — 종목별 워크북 트리와 선택 탭을 통째로 직렬화해 마지막 저장 시점과 같은지 판정한다.
 *   종목 하나만 고쳐도 지문이 달라져야 저장 버튼이 "변경됨"으로 켜진다.
 * @param assets 종목별 워크북 상태
 */
export function toStateSignature(assets: AssetStateMap): string {
    return JSON.stringify(CALC_ASSET_ORDER.map((asset) => assets[asset]))
}

/**
 * 종목 1개분 빈 상태 — 파일 1개 / 시트 1장으로 시작한다
 * @param asset 대상 종목 (기본 주가 변동률을 종목 메타에서 가져온다)
 * @param workbookId 워크북 id @param tabId 시트 id
 */
export function createEmptyAssetState(asset: CalcAsset, workbookId: string, tabId: string): AssetStateDto {
    return {
        workbooks: [{
            id: workbookId,
            name: '파일1',
            startYear: DEFAULT_START_YEAR,
            endYear: DEFAULT_END_YEAR,
            sharePriceDriftPercent: CALC_ASSET_META[asset].defaultDriftPercent,
            tabs: [{ id: tabId, name: '시트1', birthYm: '', events: [] }],
        }],
        activeTabId: tabId,
    }
}

// ┣━━━━━━━━━━━━━━━━ Validators ━━━━━━━━━━━━━━━━━┫

/**
 * 워크북 목록이 복원 가능한 형태인지 검사
 * — 빈 워크북/빈 탭이 복원되면 화면에서 선택 탭을 못 찾아 터지므로 여기서 걸러낸다.
 * @param workbooks 검사할 목록
 */
function isRestorableWorkbooks(workbooks: unknown): workbooks is Workbook[] {
    if (!Array.isArray(workbooks) || workbooks.length === 0) return false

    return workbooks.every((workbook) => (
        typeof workbook?.id === 'string'
        && typeof workbook?.name === 'string'
        && Array.isArray(workbook?.tabs)
        && workbook.tabs.length > 0
        && workbook.tabs.every((tab: unknown) => {
            const candidate = tab as Partial<Workbook['tabs'][number]>
            return typeof candidate?.id === 'string' && Array.isArray(candidate?.events)
        })
    ))
}

/**
 * 파싱된 값이 복원 가능한 스냅샷인지 검사
 * — v3(종목별) 형태와 v2 이하(단일 종목) 형태를 모두 통과시키고, 미래 버전만 막는다.
 * @param parsed JSON.parse 결과
 */
function isRestorable(parsed: unknown): parsed is SavedStateDto | LegacyStateDto {

    // 1) 객체 형태 + 버전 확인 — 구버전은 마이그레이션 대상이라 통과시키고, 미래 버전만 막는다
    if (typeof parsed !== 'object' || parsed === null) return false
    const candidate = parsed as Partial<SavedStateDto & LegacyStateDto>
    if (typeof candidate.version !== 'number') return false
    if (candidate.version < 1 || candidate.version > STORAGE_VERSION) return false

    // 2) v3 — 종목 칸이 전부 정상이어야 복원한다.
    //    이름이 바뀐 종목 키(LEGACY_CALC_ASSET_KEY)도 아는 칸으로 쳐 준다 — 여기서 막으면 저장본이 통째로 버려진다.
    if (typeof candidate.assets === 'object' && candidate.assets !== null) {
        const slices = Object.entries(candidate.assets)
        return slices.length > 0
            && slices.every(([assetKey, slice]) => (
                (isCalcAsset(assetKey) || LEGACY_CALC_ASSET_KEY[assetKey] !== undefined)
                && isRestorableWorkbooks((slice as Partial<AssetStateDto>)?.workbooks)
                && typeof (slice as Partial<AssetStateDto>)?.activeTabId === 'string'
            ))
    }

    // 3) v2 이하 — 최상위에 워크북 목록이 놓여 있던 형태
    return isRestorableWorkbooks(candidate.workbooks) && typeof candidate.activeTabId === 'string'
}

// ┣━━━━━━━━━━━━━━━━ Migrator ━━━━━━━━━━━━━━━━━━━┫

/**
 * 버전 간 값 마이그레이션
 * — 필드 자체는 멀쩡한데 "가정값"이 바뀐 경우를 처리한다. 형태 보정(normalize)과 달리
 *   이미 저장된 사용자 데이터를 실제로 갈아 끼우므로 반드시 저장 버전을 보고 1회만 적용한다.
 * @param workbooks 형태 보정까지 끝난 워크북 목록
 * @param fromVersion 스냅샷이 저장될 때의 구조 버전
 */
function migrateWorkbooks(workbooks: Workbook[], fromVersion: number): Workbook[] {

    // 1) 이미 v2 이상이면 손대지 않는다 — 사용자가 일부러 10% 로 되돌린 행을 다시 깎으면 안 된다
    if (fromVersion >= 2) return workbooks

    // 2) v1 → v2: 옛 기본값(연 10%)으로 저장된 수익률만 새 보수 기본값으로 옮긴다.
    //    총수익 모델로 바뀐 뒤에는 그 값이 형태 보정을 거쳐 주가상승률 칸에 들어와 있으므로 그쪽을 본다.
    //    10% 가 아닌 값은 사용자가 직접 정한 수치이므로 그대로 둔다.
    return workbooks.map((workbook) => ({
        ...workbook,
        tabs: workbook.tabs.map((tab) => ({
            ...tab,
            events: tab.events.map((event) => (
                event.priceGrowthPercent === LEGACY_GROWTH_RATE_PERCENT
                    ? { ...event, priceGrowthPercent: GROWTH_POLICY.DEFAULT_PRICE_GROWTH_PERCENT }
                    : event
            )),
        })),
    }))
}

// ┣━━━━━━━━━━━━━━━━ Normalizer ━━━━━━━━━━━━━━━━━┫

/**
 * 예전 버전에서 저장된 스냅샷 보정
 * — 나중에 추가된 필드(대상 기간, 생년월, 재투자 여부)가 없는 데이터를 그대로 쓰면
 *   화면에서 undefined 를 참조하다 통째로 터지므로 여기서 기본값을 채워 넣는다.
 *   형태를 맞춘 뒤 버전별 값 마이그레이션까지 이어서 적용한다.
 * @param workbooks 복원된(또는 서버에서 받은) 워크북 목록
 * @param fromVersion 스냅샷 저장 시점의 구조 버전 (없으면 최초 버전으로 간주)
 * @param asset 이 워크북이 속한 종목 탭 — 확정수익 자산을 쓰지 않는 종목이면 그 이벤트를 주력 종목 매수로 접는다
 */
export function normalizeWorkbooks(workbooks: Workbook[], fromVersion: number = 1, asset?: CalcAsset): Workbook[] {
    const normalized = normalizeShape(workbooks)
    const migrated = migrateWorkbooks(normalized, fromVersion)
    return asset === undefined ? migrated : foldGrowthEvents(migrated, asset)
}

/**
 * 확정수익 자산을 쓰지 않는 종목(JEPQ)의 저장본 보정
 *
 * 확정수익 통은 이벤트의 종료 연월이 되는 달에만 주력 종목으로 이관된다. 그래서 종료 연월이 비어 있으면
 * 넣은 돈이 통 안에 갇혀 보유주·배당·누적금액이 전부 0 으로만 찍힌다. JEPQ 탭은 애초에 그 통을 쓰지 않으므로,
 * 예전에 확정수익으로 저장된 이벤트를 전부 주력 종목 매수로 되돌려 넣은 돈이 그 달 바로 JEPQ 주식이 되게 한다.
 *   1) 월 정기매수(확정수익) → 월 정기 매수
 *   2) 대상이 확정수익인 일시금·단발성 → 대상을 주력 종목으로. 종료 연월은 이관 시점 표기였으므로 비운다.
 * @param workbooks 형태·버전 보정까지 끝난 워크북 목록
 * @param asset 이 워크북이 속한 종목 탭
 */
function foldGrowthEvents(workbooks: Workbook[], asset: CalcAsset): Workbook[] {

    // 0) 확정수익 자산을 쓰는 종목이면 손대지 않는다
    if (CALC_ASSET_META[asset].supportsGrowthAsset) return workbooks

    return workbooks.map((workbook) => ({
        ...workbook,
        tabs: workbook.tabs.map((tab) => ({
            ...tab,
            events: tab.events.map((event) => {

                // 1) 월 정기매수(확정수익) → 월 정기 매수. 기간·금액은 그대로 두어 계획이 달라지지 않게 한다
                if (event.type === EventType.RECURRING_GROWTH) {
                    return { ...event, type: EventType.RECURRING, target: InvestTarget.MAIN }
                }

                // 2) 대상이 확정수익인 일회성 투입 → 그 달 바로 주력 종목 매수. 이관 연월은 의미를 잃어 비운다
                if (event.target === InvestTarget.GROWTH) {
                    return { ...event, target: InvestTarget.MAIN, endYm: '' }
                }

                return event
            }),
        })),
    }))
}

/**
 * 형태 보정 — 누락 필드를 기본값으로 채워 화면이 undefined 를 참조하지 않게 한다
 * @param workbooks 보정할 워크북 목록
 */
function normalizeShape(workbooks: Workbook[]): Workbook[] {
    return workbooks.map((workbook) => {
        // 1) 대상 기간 — 기간 기능 도입 이전 저장본에는 없으므로 기본값(2026~2050)으로 채운다
        const startYear = clampYear(
            typeof workbook.startYear === 'number' ? workbook.startYear : DEFAULT_START_YEAR,
        )
        const rawEndYear = typeof workbook.endYear === 'number' ? workbook.endYear : DEFAULT_END_YEAR

        return {
            ...workbook,
            startYear,
            // 2) 종료가 시작보다 앞서면 기간이 사라지므로 최소 시작 연도까지 끌어올린다
            endYear: Math.max(startYear, clampYear(rawEndYear)),
            // 2-1) 주가 변동률 — 도입 이전 저장본은 주가 고정(0)으로 돌던 데이터이므로 그 동작을 그대로 유지한다.
            //      새 파일 기본값을 쓰면 사용자가 이미 짜 둔 계획의 숫자가 조용히 달라진다.
            sharePriceDriftPercent: typeof workbook.sharePriceDriftPercent === 'number'
                ? workbook.sharePriceDriftPercent
                : LEGACY_DRIFT_PERCENT,
            tabs: workbook.tabs.map((tab) => ({
                ...tab,
                // 3) 생년월 — 미지정('')이 기본
                birthYm: typeof tab.birthYm === 'string' ? tab.birthYm : '',
                events: tab.events.map((event) => {
                    // 총수익 모델 도입 이전 저장본에만 있던 단일 수익률 필드 — 현재 타입에는 없어 따로 읽는다
                    const legacyRatePercent = (event as InvestEvent & { annualRatePercent?: number }).annualRatePercent

                    return {
                    ...event,
                    // 4) 재투자 여부 — 기존 동작(항상 재투자)과 맞춰 true 가 기본
                    reinvest: typeof event.reinvest === 'boolean' ? event.reinvest : true,
                    // 5) 연 주가상승률 — 총수익 모델 도입 전에는 'annualRatePercent' 한 칸이 수익률 전부를 뜻했으므로
                    //    그 값을 주가상승률로 그대로 이어받는다 (없으면 보수 기본값)
                    priceGrowthPercent: typeof event.priceGrowthPercent === 'number'
                        ? event.priceGrowthPercent
                        : typeof legacyRatePercent === 'number'
                            ? legacyRatePercent
                            : GROWTH_POLICY.DEFAULT_PRICE_GROWTH_PERCENT,
                    // 6) 연 배당수익률 — 총수익 모델 도입 이전에는 없던 개념이라 기본값으로 채운다
                    dividendYieldPercent: typeof event.dividendYieldPercent === 'number'
                        ? event.dividendYieldPercent
                        : GROWTH_POLICY.DEFAULT_DIVIDEND_YIELD_PERCENT,
                    // 7) 투입 대상 — 확정수익으로 명시된 것만 남기고 나머지는 전부 주력 종목 매수로 본다.
                    //    v2 이하 저장본의 'JEPQ' 값도 여기서 자연스럽게 MAIN 으로 흡수된다.
                    target: event.target === InvestTarget.GROWTH ? InvestTarget.GROWTH : InvestTarget.MAIN,
                    }
                }),
            })),
        }
    })
}

/**
 * 이름이 바뀐 종목 키를 현재 키로 옮겨 담는다
 * — 종목 정의가 정정되면(예: 일반 나스닥100 → 나스닥100커버드콜) 키가 달라지는데,
 *   그대로 두면 이미 저장해 둔 계획이 "모르는 칸"으로 취급돼 버려진다.
 * @param source 저장본의 종목 칸 묶음
 */
function renameLegacyAssetKeys(source: Partial<Record<string, AssetStateDto>>): Partial<Record<string, AssetStateDto>> {
    const renamed: Partial<Record<string, AssetStateDto>> = { ...source }

    Object.entries(LEGACY_CALC_ASSET_KEY).forEach(([legacyKey, currentKey]) => {
        const legacySlice = renamed[legacyKey]
        if (legacySlice === undefined) return

        // 옛 키는 지우고, 현재 키가 비어 있을 때만 그 자리로 옮긴다 (둘 다 있으면 현재 키가 정본)
        delete renamed[legacyKey]
        if (renamed[currentKey] === undefined) renamed[currentKey] = legacySlice
    })

    return renamed
}

/**
 * 어떤 버전의 스냅샷이든 현재 형태(종목별 슬라이스)로 끌어올린다
 *
 * 1) v3 스냅샷이면 아는 종목 칸만 골라 형태를 보정하고 (이름이 바뀐 옛 키는 새 키로 옮긴다)
 * 2) v2 이하 스냅샷이면 그 전체를 JEPQ 칸으로 옮긴다 — 그때는 JEPQ 하나만 다루던 도구였다
 * 3) 비어 있는 종목 칸은 빈 파일 1개로 세워, 탭을 눌렀을 때 화면이 깨지지 않게 한다
 *
 * @param parsed 복원 검증까지 끝난 스냅샷
 * @param createEmpty 비어 있는 종목 칸을 채울 기본 상태 생성기 (id 발급은 호출측이 맡는다)
 */
export function toAssetStateMap(
    parsed: RestorableSnapshot,
    createEmpty: (asset: CalcAsset) => AssetStateDto,
): AssetStateMap {
    const version = parsed.version

    // 0) 옛 종목 키를 현재 키로 옮겨 담는다 — 같은 칸이 둘 다 있으면 현재 키 쪽이 이긴다
    const source = parsed.assets === undefined ? undefined : renameLegacyAssetKeys(parsed.assets)

    const map = {} as AssetStateMap
    CALC_ASSET_ORDER.forEach((asset) => {
        // 1) 이 종목 칸의 원본 — v3 면 같은 이름의 칸, v2 이하면 JEPQ 에만 옛 데이터를 얹는다
        const slice = source !== undefined
            ? source[asset]
            : (asset === CalcAsset.JEPQ
                ? { workbooks: parsed.workbooks ?? [], activeTabId: parsed.activeTabId ?? '' }
                : undefined)

        // 2) 원본이 없거나 비어 있으면 빈 상태로 세운다
        if (slice === undefined || !isRestorableWorkbooks(slice.workbooks)) {
            map[asset] = createEmpty(asset)
            return
        }

        map[asset] = {
            workbooks: normalizeWorkbooks(slice.workbooks, version, asset),
            activeTabId: typeof slice.activeTabId === 'string' ? slice.activeTabId : '',
        }
    })

    return map
}

// ┣━━━━━━━━━━━━━━━━ API ━━━━━━━━━━━━━━━━━━━━━━━━┫

/**
 * 현재 상태를 스냅샷으로 저장
 * @param assets 종목별 워크북 상태
 * @param savedAt 저장 시각 덮어쓰기 (ISO). 서버 저장에 성공하면 서버가 찍은 시각을 넘긴다.
 * @returns 저장된 스냅샷 (savedAt 표기에 사용)
 */
export function saveState(assets: AssetStateMap, savedAt?: string): SavedStateDto {

    // 1) 스냅샷 조립 — 시세/상수는 매 진입 시 새로 조회하므로 저장 대상이 아니다
    //    저장 시각은 서버 값을 우선 쓴다. 로컬 시계와 서버 시계가 섞이면
    //    다음 진입 때 "서버본이 더 최신인가" 비교가 어긋나기 때문이다.
    const snapshot: SavedStateDto = {
        version: STORAGE_VERSION,
        savedAt: savedAt ?? new Date().toISOString(),
        assets,
    }

    // 2) 직렬화 후 기록 — 용량 초과(QuotaExceededError) 등은 그대로 던진다
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot))
    return snapshot
}

/**
 * 저장된 스냅샷 로드
 * @param createEmpty 비어 있는 종목 칸을 채울 기본 상태 생성기
 * @returns 복원 가능한 스냅샷. 저장 이력이 없거나 형식이 깨졌으면 null
 */
export function loadState(createEmpty: (asset: CalcAsset) => AssetStateDto): SavedStateDto | null {
    try {
        // 1) 원문 조회 — 저장 이력이 없으면 즉시 종료
        const raw = localStorage.getItem(STORAGE_KEY)
        if (raw === null) return null

        // 2) 파싱 + 형식 검증 — 깨진 데이터는 없는 것으로 취급해 기본 상태로 시작한다
        const parsed: unknown = JSON.parse(raw)
        if (!isRestorable(parsed)) return null

        // 3) 구버전 스냅샷 보정 — 뒤늦게 추가된 필드를 채우고, 종목별 칸으로 끌어올린다.
        //    버전은 현재 값으로 올려 두되 실제 기록은 다음 저장 때 갱신된다 (그전까지는 매 로드마다 동일하게 재적용).
        return {
            version: STORAGE_VERSION,
            savedAt: parsed.savedAt,
            assets: toAssetStateMap(parsed, createEmpty),
        }
    } catch {
        return null
    }
}

/** 저장된 스냅샷 삭제 — 다음 진입 시 기본 상태로 시작한다 */
export function clearState(): void {
    localStorage.removeItem(STORAGE_KEY)
}
