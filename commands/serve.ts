import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import index from '../ui/index.html';
import {
  getBranchStatusAsync,
  getDefaultBranch,
  switchToMainCore,
  syncRepoCore,
} from './core';

const DAEMON_STATE_FILE = join(homedir(), '.gml-daemon.json');

type DaemonState = {
  pid: number;
  port: number;
  cwd: string;
  startedAt: string;
};

function writeDaemonState(state: DaemonState) {
  writeFileSync(DAEMON_STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
}

function clearDaemonState() {
  try {
    rmSync(DAEMON_STATE_FILE);
  } catch {
    /* ignore */
  }
}

function parsePort(args: string[]): number {
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a?.startsWith('--port='))
      return Number(a.slice('--port='.length)) || 4321;
    if (a === '--port') return Number(args[i + 1]) || 4321;
  }
  return 4321;
}

function openBrowser(url: string) {
  if (process.platform === 'win32') spawnSync('cmd', ['/c', 'start', url]);
  else if (process.platform === 'darwin') spawnSync('open', [url]);
  else spawnSync('xdg-open', [url]);
}

function statusResponse(state: DaemonState) {
  return Response.json({ ...state, version: '0.2.21' });
}

function getReposFromRoot(root: string): string[] {
  const repos = readdirSync(root)
    .map((name) => join(root, name))
    .filter((p) => existsSync(join(p, '.git')))
    .sort((a, b) => a.localeCompare(b));
  if (existsSync(join(root, '.git'))) repos.unshift(root);
  return repos;
}

export async function serveCommand(args: string[]) {
  const port = parsePort(args);
  const noOpen = args.includes('--no-open');
  const cwd = process.cwd();

  const state: DaemonState = {
    pid: process.pid,
    port,
    cwd,
    startedAt: new Date().toISOString(),
  };
  writeDaemonState(state);

  const cleanup = () => {
    clearDaemonState();
    process.exit(0);
  };
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  const server = Bun.serve({
    port,
    hostname: '127.0.0.1',
    routes: {
      '/api/status': { GET: () => statusResponse(state) },
      '/api/repos/stream': {
        GET: async () => {
          const repoPaths = getReposFromRoot(cwd);
          let controller!: ReadableStreamDefaultController<Uint8Array>;
          const encoder = new TextEncoder();

          const stream = new ReadableStream<Uint8Array>({
            start(c) {
              controller = c;
            },
          });

          // fire all in parallel, emit each as it resolves
          const total = repoPaths.length;
          let done = 0;
          for (const p of repoPaths) {
            (async () => {
              try {
                const status = await getBranchStatusAsync(p);
                const defB = getDefaultBranch(p);
                const repo = {
                  name: basename(p),
                  path: p,
                  branch: status.branch,
                  upstream: status.upstream,
                  ahead: status.ahead,
                  behind: status.behind,
                  uncommitted: status.uncommitted,
                  defaultBranch: defB,
                };
                const data = `data: ${JSON.stringify(repo)}\n\n`;
                controller.enqueue(encoder.encode(data));
              } catch (e: any) {
                const err = `data: ${JSON.stringify({ error: e.message, path: p })}\n\n`;
                controller.enqueue(encoder.encode(err));
              } finally {
                done++;
                if (done === total) {
                  controller.enqueue(encoder.encode('data: {"done":true}\n\n'));
                  controller.close();
                }
              }
            })();
          }

          // handle empty repo list
          if (total === 0) {
            controller!.enqueue(encoder.encode('data: {"done":true}\n\n'));
            controller!.close();
          }

          return new Response(stream, {
            headers: {
              'Content-Type': 'text/event-stream',
              'Cache-Control': 'no-cache',
              Connection: 'keep-alive',
            },
          });
        },
      },
      '/api/repos': {
        GET: async () => {
          try {
            const repoPaths = getReposFromRoot(cwd);
            const repos = await Promise.all(
              repoPaths.map(async (p) => {
                const status = await getBranchStatusAsync(p);
                const defB = getDefaultBranch(p);
                return {
                  name: basename(p),
                  path: p,
                  branch: status.branch,
                  upstream: status.upstream,
                  ahead: status.ahead,
                  behind: status.behind,
                  uncommitted: status.uncommitted,
                  defaultBranch: defB,
                };
              }),
            );
            return Response.json(repos);
          } catch (e: any) {
            return Response.json(
              { error: e.message || String(e) },
              { status: 500 },
            );
          }
        },
      },
      '/api/repos/sync': {
        POST: async (req) => {
          try {
            const body = (await req.json()) as { path?: string };
            const p = body?.path;
            if (!p || typeof p !== 'string') {
              return Response.json(
                { error: 'Missing or invalid path' },
                { status: 400 },
              );
            }
            if (!existsSync(join(p, '.git'))) {
              return Response.json(
                { error: `Not a git repo: ${p}` },
                { status: 400 },
              );
            }
            const randomSessionId = Math.random().toString(36).slice(2, 10);
            const result = await syncRepoCore(p, randomSessionId);
            return Response.json(result);
          } catch (e: any) {
            return Response.json(
              { error: e.message || String(e) },
              { status: 500 },
            );
          }
        },
      },
      '/api/repos/main': {
        POST: async (req) => {
          try {
            const body = (await req.json()) as { path?: string };
            const p = body?.path;
            if (!p || typeof p !== 'string') {
              return Response.json(
                { error: 'Missing or invalid path' },
                { status: 400 },
              );
            }
            if (!existsSync(join(p, '.git'))) {
              return Response.json(
                { error: `Not a git repo: ${p}` },
                { status: 400 },
              );
            }
            const result = await switchToMainCore(p);
            return Response.json(result);
          } catch (e: any) {
            return Response.json(
              { error: e.message || String(e) },
              { status: 500 },
            );
          }
        },
      },
      '/api/sync-all': {
        POST: async () => {
          try {
            const repoPaths = getReposFromRoot(cwd);
            const randomSessionId = Math.random().toString(36).slice(2, 10);
            const results = await Promise.all(
              repoPaths.map(async (p) => {
                const res = await syncRepoCore(p, randomSessionId);
                return {
                  name: basename(p),
                  success: res.success,
                  error: res.error,
                };
              }),
            );
            return Response.json({ results });
          } catch (e: any) {
            return Response.json(
              { error: e.message || String(e) },
              { status: 500 },
            );
          }
        },
      },
      '/api/main-all': {
        POST: async () => {
          try {
            const repoPaths = getReposFromRoot(cwd);
            const results = await Promise.all(
              repoPaths.map(async (p) => {
                const res = await switchToMainCore(p);
                return {
                  name: basename(p),
                  success: res.success,
                  error: res.error,
                };
              }),
            );
            return Response.json({ results });
          } catch (e: any) {
            return Response.json(
              { error: e.message || String(e) },
              { status: 500 },
            );
          }
        },
      },
      '/*': index,
    },
  });

  const url = `http://localhost:${server.port}`;
  console.log(`[gml serve] Listening on ${url}`);
  console.log(`[gml serve] CWD: ${cwd}  PID: ${process.pid}`);
  console.log(`[gml serve] Press Ctrl+C to stop.`);

  if (!noOpen) openBrowser(url);
}
