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
            // 1) Yahoo Finance — JEPQ 시세. CORS 헤더가 없어 개발 서버 프록시 경유
            '/api/yahoo': {
                target: 'https://query1.finance.yahoo.com',
                changeOrigin: true,
                rewrite: (path) => path.replace(/^\/api\/yahoo/, ''),
                headers: {
                    'User-Agent': 'Mozilla/5.0',
                },
            },
            // 2) Nasdaq — JEPQ 배당률. CORS 차단 + User-Agent 미지정 시 거부
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