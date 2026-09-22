import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
    plugins: [react()],
    server: {
        proxy: {
            // 0) 저장 서버 — 워크북 스냅샷 보관 (server/index.js, 기본 3001)
            '/api/state': {
                target: 'http://localhost:3001',
                changeOrigin: true,
            },
            // 0-1) 저장 서버 — 가계부 보관 (server/data/ledger.json)
            '/api/ledger': {
                target: 'http://localhost:3001',
                changeOrigin: true,
            },
            // 1) Yahoo Finance — 종목 시세 + 국내 종목 배당 내역. CORS 헤더가 없어 개발 서버 프록시 경유
            '/api/yahoo': {
                target: 'https://query1.finance.yahoo.com',
                changeOrigin: true,
                rewrite: (path) => path.replace(/^\/api\/yahoo/, ''),
                headers: {
                    'User-Agent': 'Mozilla/5.0',
                },
            },
            // 2) Nasdaq — 미국 상장 종목(JEPQ) 배당률. CORS 차단 + User-Agent 미지정 시 거부
            //    국내 종목은 이 API 가 모르는 심볼이라 위 Yahoo 배당 이벤트로 대체한다
            '/api/nasdaq': {
                target: 'https://api.nasdaq.com',
                changeOrigin: true,
                rewrite: (path) => path.replace(/^\/api\/nasdaq/, ''),
                headers: {
                    'User-Agent': 'Mozilla/5.0',
                },
            },
        },
    },
})