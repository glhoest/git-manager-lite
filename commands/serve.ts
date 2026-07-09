import { existsSync, writeFileSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const DAEMON_STATE_FILE = join(homedir(), '.gml-daemon.json')

type DaemonState = {
  pid: number
  port: number
  cwd: string
  startedAt: string
}

function writeDaemonState(state: DaemonState) {
  writeFileSync(DAEMON_STATE_FILE, JSON.stringify(state, null, 2), 'utf-8')
}

function clearDaemonState() {
  try { rmSync(DAEMON_STATE_FILE) } catch { /* ignore */ }
}

function parsePort(args: string[]): number {
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a?.startsWith('--port=')) return Number(a.slice('--port='.length)) || 4321
    if (a === '--port') return Number(args[i + 1]) || 4321
  }
  return 4321
}

function openBrowser(url: string) {
  if (process.platform === 'win32') spawnSync('cmd', ['/c', 'start', url])
  else if (process.platform === 'darwin') spawnSync('open', [url])
  else spawnSync('xdg-open', [url])
}

function statusResponse(state: DaemonState) {
  return Response.json({ ...state, version: '0.2.21' })
}

export async function serveCommand(args: string[]) {
  const port = parsePort(args)
  const noOpen = args.includes('--no-open')
  const cwd = process.cwd()

  const state: DaemonState = { pid: process.pid, port, cwd, startedAt: new Date().toISOString() }
  writeDaemonState(state)

  const cleanup = () => { clearDaemonState(); process.exit(0) }
  process.on('SIGINT', cleanup)
  process.on('SIGTERM', cleanup)

  // Locate ui/dist/ relative to the exe/script, not CWD.
  // import.meta.dir is the directory containing gml.exe (or index.ts in dev).
  const exeDir = import.meta.dir
  const uiDistDir = join(exeDir, 'ui', 'dist')
  const uiDiskPath = join(uiDistDir, 'index.html')
  const uiExists = existsSync(uiDiskPath)

  // biome-ignore lint/suspicious/noExplicitAny: isStandaloneExecutable added in newer Bun, not in current @types/bun
  const isExe = !!(Bun as any).isStandaloneExecutable
  if (!uiExists && !isExe) {
    console.error('[gml serve] ui/dist/index.html not found. Run "bun run build:ui" first.')
    process.exit(1)
  }

  const server = Bun.serve({
    port,
    hostname: '127.0.0.1',
    fetch(req) {
      const url = new URL(req.url)

      // API routes
      if (url.pathname === '/api/status') return statusResponse(state)

      // Serve static assets (JS/CSS bundles) from ui/dist/
      if (uiExists && url.pathname !== '/' && url.pathname !== '') {
        const assetPath = join(uiDistDir, url.pathname)
        if (existsSync(assetPath)) return new Response(Bun.file(assetPath))
      }

      // SPA fallback — index.html for all other routes
      if (uiExists) {
        return new Response(Bun.file(uiDiskPath), { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
      }

      return new Response('UI not available.', { status: 404 })
    },
  })

  const url = `http://localhost:${server.port}`
  console.log(`[gml serve] Listening on ${url}`)
  console.log(`[gml serve] CWD: ${cwd}  PID: ${process.pid}`)
  console.log(`[gml serve] Press Ctrl+C to stop.`)

  if (!noOpen) openBrowser(url)
}
