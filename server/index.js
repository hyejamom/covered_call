import express from 'express'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
    STATE_FILE_PATH,
    clearSnapshot,
    loadSnapshot,
    saveSnapshot,
    validateSnapshot,
} from './stateStore.js'

// ══════════ 저장 서버 ══════════
// 프론트의 저장 버튼이 보내는 워크북 스냅샷을 파일로 보관한다.
// 개발 중에는 Vite 프록시(/api/state → 이 서버)를 타고, 빌드 후에는 이 서버가 dist까지 함께 서빙한다.

const PORT = Number(process.env.PORT ?? 3001)
const ROOT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..')
const DIST_DIR = join(ROOT_DIR, 'dist')

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
})