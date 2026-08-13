import express from 'express'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
    LEDGER_FILE_PATH,
    loadLedger,
    saveLedger,
    validateLedger,
} from './ledgerStore.js'
import {
    STATE_FILE_PATH,
    clearSnapshot,
    loadSnapshot,
    saveSnapshot,
    validateSnapshot,
} from './stateStore.js'

// ══════════ 저장 서버 + 시세 중계 ══════════
// 프론트가 보내는 상태를 파일로 보관한다. 파일은 둘로 나눠 둔다.
//   /api/state  → server/data/state.json   (계산기 워크북. 저장 버튼을 눌러야 올라온다)
//   /api/ledger → server/data/ledger.json  (가계부. 입력하면 잠시 뒤 자동으로 올라온다)
// 여기에 더해 외부 시세 API 를 중계한다.
//   /api/yahoo  → query1.finance.yahoo.com  (시세 · 일별 종가 이력)
//   /api/nasdaq → api.nasdaq.com            (배당 내역)
// 개발 중에는 Vite 프록시가 같은 경로를 잡아 주지만, 빌드 후에는 그 프록시가 사라진다.
// 그래서 이 서버가 dist 를 서빙할 때 시세 중계까지 함께 맡아야 화면이 깨지지 않는다.

const PORT = Number(process.env.PORT ?? 3001)
const ROOT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..')
const DIST_DIR = join(ROOT_DIR, 'dist')

/**
 * 중계 대상 — 경로 접두사와 실제 도착지.
 * 두 곳 모두 브라우저에서 직접 부르면 CORS 로 막히거나(둘 다) User-Agent 가 없으면 거부한다(Nasdaq).
 * 그래서 서버가 대신 부르고 응답만 그대로 넘긴다.
 */
const PROXY_TARGETS = [
    { prefix: '/api/yahoo', origin: 'https://query1.finance.yahoo.com' },
    { prefix: '/api/nasdaq', origin: 'https://api.nasdaq.com' },
]

/** 외부 API 응답 대기 한도 (ms) — 상대가 응답하지 않을 때 요청이 매달려 있지 않게 한다 */
const PROXY_TIMEOUT_MS = 10000

const app = express()

// 스냅샷은 워크북·이벤트가 늘어나면 수백 KB까지 커질 수 있어 기본 100kb 제한을 올린다
app.use(express.json({ limit: '5mb' }))

// ══════════ 라우트 ══════════

/** 헬스체크 — 프론트가 서버 연결 여부를 판단하는 데 쓴다 */
app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' })
})

/** 마지막 저장 스냅샷 조회 — 저장 이력이 없으면 204 */
app.get('/api/state', async (_req, res) => {
    try {
        // 1) 파일에서 스냅샷 로드
        const snapshot = await loadSnapshot()

        // 2) 이력이 없으면 본문 없이 204 — 프론트는 로컬 복원본을 그대로 쓴다
        if (snapshot === null) {
            res.status(204).end()
            return
        }

        res.json(snapshot)
    } catch (caught) {
        res.status(500).json({ message: `스냅샷을 읽지 못했습니다: ${caught.message}` })
    }
})

/** 스냅샷 저장 — 기존 내용을 통째로 덮어쓴다 */
app.post('/api/state', async (req, res) => {
    try {
        // 1) 본문 검증 — 깨진 스냅샷이 저장되면 다음 진입 때 화면이 깨진다
        const reason = validateSnapshot(req.body)
        if (reason !== null) {
            res.status(400).json({ message: reason })
            return
        }

        // 2) 원자적 저장 후 저장 시각을 돌려준다
        const snapshot = await saveSnapshot(req.body.workbooks, req.body.activeTabId)
        res.json({ version: snapshot.version, savedAt: snapshot.savedAt })
    } catch (caught) {
        res.status(500).json({ message: `스냅샷을 저장하지 못했습니다: ${caught.message}` })
    }
})

/** 스냅샷 삭제 — 다음 진입 시 기본 상태로 시작한다 */
app.delete('/api/state', async (_req, res) => {
    try {
        await clearSnapshot()
        res.status(204).end()
    } catch (caught) {
        res.status(500).json({ message: `스냅샷을 삭제하지 못했습니다: ${caught.message}` })
    }
})

// ══════════ 가계부 ══════════

/** 저장된 가계부 조회 — 저장 이력이 없으면 204 */
app.get('/api/ledger', async (_req, res) => {
    try {
        // 1) 파일에서 가계부 로드
        const ledger = await loadLedger()

        // 2) 이력이 없으면 본문 없이 204 — 프론트는 로컬 복원본을 그대로 쓰고, 다음 저장 때 이 파일을 세운다
        if (ledger === null) {
            res.status(204).end()
            return
        }

        res.json(ledger)
    } catch (caught) {
        res.status(500).json({ message: `가계부를 읽지 못했습니다: ${caught.message}` })
    }
})

/** 가계부 저장 — 기존 내용을 통째로 덮어쓴다 */
app.post('/api/ledger', async (req, res) => {
    try {
        // 1) 본문 검증 — 깨진 스냅샷이 저장되면 다음 진입 때 기록을 통째로 잃는다
        const reason = validateLedger(req.body)
        if (reason !== null) {
            res.status(400).json({ message: reason })
            return
        }

        // 2) 원자적 저장 후 저장 시각을 돌려준다
        const ledger = await saveLedger(req.body)
        res.json({ version: ledger.version, savedAt: ledger.savedAt })
    } catch (caught) {
        res.status(500).json({ message: `가계부를 저장하지 못했습니다: ${caught.message}` })
    }
})

// ══════════ 시세 중계 ══════════
// 정적 서빙보다 먼저 등록해야 SPA 폴백에 잡아먹히지 않는다.

PROXY_TARGETS.forEach((target) => {
    app.get(`${target.prefix}/*splat`, async (req, res) => {
        // 1) 접두사만 떼고 나머지 경로 + 쿼리스트링을 그대로 붙인다
        const path = req.originalUrl.slice(target.prefix.length)
        const url = `${target.origin}${path}`

        // 2) 상대가 응답하지 않을 때를 대비한 타임아웃
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), PROXY_TIMEOUT_MS)

        try {
            // 3) User-Agent 를 붙여 대신 호출 — 없으면 Nasdaq 이 거부한다
            const upstream = await fetch(url, {
                headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
                signal: controller.signal,
            })

            // 4) 시세는 매번 최신이어야 하므로 중간에서 캐싱하지 않는다
            res.status(upstream.status)
            res.set('Cache-Control', 'no-store')
            res.type(upstream.headers.get('content-type') ?? 'application/json')
            res.send(Buffer.from(await upstream.arrayBuffer()))
        } catch (caught) {
            const reason = caught.name === 'AbortError' ? '응답 시간 초과' : caught.message
            res.status(502).json({ message: `시세 중계 실패 (${target.origin}): ${reason}` })
        } finally {
            clearTimeout(timer)
        }
    })
})

// ══════════ 정적 서빙 (빌드 결과물) ══════════
// 1) dist가 있으면 프론트까지 이 서버 하나로 서빙한다 (npm run build && npm start)
if (existsSync(DIST_DIR)) {
    app.use(express.static(DIST_DIR))

    // 2) SPA 폴백 — /api 이외의 경로는 전부 index.html로 넘긴다
    app.get(/^\/(?!api\/).*/, (_req, res) => {
        res.sendFile(join(DIST_DIR, 'index.html'))
    })
}

app.listen(PORT, () => {
    console.log(`[call] 저장 서버 기동 — http://localhost:${PORT}`)
    console.log(`[call] 스냅샷 파일 — ${STATE_FILE_PATH}`)
    console.log(`[call] 가계부 파일 — ${LEDGER_FILE_PATH}`)
})