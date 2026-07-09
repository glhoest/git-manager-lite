import { writeFileSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
// @ts-ignore — Bun HTML import bundled at compile time; no TS types for this
import index from '../ui/index.html'

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

  const server = Bun.serve({
    port,
    hostname: '127.0.0.1',
    routes: {
      '/api/status': { GET: () => statusResponse(state) },
      '/*': index,
    },
  })

  const url = `http://localhost:${server.port}`
  console.log(`[gml serve] Listening on ${url}`)
  console.log(`[gml serve] CWD: ${cwd}  PID: ${process.pid}`)
  console.log(`[gml serve] Press Ctrl+C to stop.`)

  if (!noOpen) openBrowser(url)
}
