import {
  AlertCircle,
  GitBranch,
  GitFork,
  Loader2,
  RefreshCw,
  Search,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from './components/ui/button';

type RepoInfo = {
  name: string;
  path: string;
  branch: string;
  upstream?: string;
  ahead: number;
  behind: number;
  uncommitted: number;
  defaultBranch: string;
};

type StatusResponse = {
  cwd: string;
  version: string;
};

function branchBadgeClass(branch: string) {
  const base =
    'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-mono font-medium border';
  if (branch === 'main' || branch === 'master') {
    return `${base} bg-green-50 text-green-700 border-green-200`;
  }
  if (branch.startsWith('release/')) {
    return `${base} bg-red-50 text-red-700 border-red-200`;
  }
  return `${base} bg-amber-50 text-amber-700 border-amber-200`;
}

function SkeletonRow() {
  return (
    <tr className="border-b">
      <td className="py-2.5 px-4">
        <div className="h-4 bg-muted rounded w-32 animate-pulse" />
      </td>
      <td className="py-2.5 px-4">
        <div className="h-5 bg-muted rounded-full w-24 animate-pulse" />
      </td>
      <td className="py-2.5 px-4"><div className="h-4 bg-muted rounded w-6 mx-auto animate-pulse" /></td>
      <td className="py-2.5 px-4"><div className="h-4 bg-muted rounded w-6 mx-auto animate-pulse" /></td>
      <td className="py-2.5 px-4"><div className="h-4 bg-muted rounded w-6 mx-auto animate-pulse" /></td>
      <td className="py-2.5 px-4 text-right">
        <div className="flex justify-end gap-1.5">
          <div className="h-7 bg-muted rounded w-14 animate-pulse" />
          <div className="h-7 bg-muted rounded w-14 animate-pulse" />
        </div>
      </td>
    </tr>
  );
}

export default function App() {
  const [repos, setRepos] = useState<RepoInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [actingPaths, setActingPaths] = useState<Set<string>>(new Set());
  const [globalActing, setGlobalActing] = useState(false);
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [managingRepo, setManagingRepo] = useState<RepoInfo | null>(null);

  useEffect(() => {
    setLoading(true);
    setRepos([]);
    setError(null);

    const es = new EventSource('/api/repos/stream');

    es.onmessage = (e) => {
      const data = JSON.parse(e.data);
      if (data.done) {
        setLoading(false);
        es.close();
        return;
      }
      if (data.error) return; // skip errored repos silently
      setRepos((prev) => {
        // insert in sorted order by name
        const next = [...prev, data as RepoInfo];
        next.sort((a, b) => a.name.localeCompare(b.name));
        return next;
      });
    };

    es.onerror = () => {
      setError('Failed to connect to server');
      setLoading(false);
      es.close();
    };

    // fetch status separately
    fetch('/api/status')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d) setStatus(d);
      })
      .catch(() => {});

    return () => es.close();
  }, []);

  const triggerFetchRepos = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch('/api/repos');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setRepos(data);
    } catch (err: any) {
      setError(err.message || String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleSyncAll = async () => {
    try {
      setGlobalActing(true);
      const res = await fetch('/api/sync-all', { method: 'POST' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await triggerFetchRepos();
    } catch (err: any) {
      alert(`Sync All failed: ${err.message || String(err)}`);
    } finally {
      setGlobalActing(false);
    }
  };

  const handleMainAll = async () => {
    if (
      !window.confirm(
        'Reset ALL repositories to their main/master branch? All local changes will be discarded!',
      )
    ) {
      return;
    }
    try {
      setGlobalActing(true);
      const res = await fetch('/api/main-all', { method: 'POST' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await triggerFetchRepos();
    } catch (err: any) {
      alert(`Reset All failed: ${err.message || String(err)}`);
    } finally {
      setGlobalActing(false);
    }
  };

  const handleSyncRepo = async (repo: RepoInfo) => {
    setActingPaths((prev) => {
      const next = new Set(prev);
      next.add(repo.path);
      return next;
    });
    try {
      const res = await fetch('/api/repos/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: repo.path }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      // Update individual repo status by fetching again
      const updateRes = await fetch('/api/repos');
      if (updateRes.ok) {
        const data = await updateRes.json();
        setRepos(data);
      }
    } catch (err: any) {
      alert(`Sync ${repo.name} failed: ${err.message || String(err)}`);
    } finally {
      setActingPaths((prev) => {
        const next = new Set(prev);
        next.delete(repo.path);
        return next;
      });
    }
  };

  const handleMainRepo = async (repo: RepoInfo) => {
    if (
      !window.confirm(
        `Switch ${repo.name} to ${repo.defaultBranch}? Local changes will be discarded.`,
      )
    ) {
      return;
    }
    setActingPaths((prev) => {
      const next = new Set(prev);
      next.add(repo.path);
      return next;
    });
    try {
      const res = await fetch('/api/repos/main', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: repo.path }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const updateRes = await fetch('/api/repos');
      if (updateRes.ok) {
        const data = await updateRes.json();
        setRepos(data);
      }
    } catch (err: any) {
      alert(`Reset ${repo.name} to Main failed: ${err.message || String(err)}`);
    } finally {
      setActingPaths((prev) => {
        const next = new Set(prev);
        next.delete(repo.path);
        return next;
      });
    }
  };

  const filteredRepos = repos.filter(
    (r) =>
      r.name.toLowerCase().includes(filter.toLowerCase()) ||
      r.branch.toLowerCase().includes(filter.toLowerCase()),
  );

  return (
    <div className="min-h-screen bg-background">
      {/* Sticky Header */}
      <header className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b">
        <div className="mx-auto max-w-6xl px-6 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg border bg-muted">
              <GitFork className="h-5 w-5 text-foreground" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold tracking-tight text-lg text-foreground">
                  Git Manager Lite
                </span>
                <span className="inline-flex items-center rounded bg-muted px-1.5 py-0.5 text-xs font-mono font-medium text-muted-foreground border">
                  v{status?.version ?? '...'}
                </span>
                <span className="inline-flex items-center rounded bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground border">
                  {repos.length} repos
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3 self-end sm:self-auto w-full sm:w-auto">
            {/* Filter Input */}
            <div className="relative flex-1 sm:w-64">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                placeholder="Filter repos..."
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                className="w-full rounded-md border border-input bg-background pl-9 pr-3 py-1.5 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:border-ring"
              />
            </div>

            <Button
              onClick={handleSyncAll}
              disabled={globalActing || loading}
              size="sm"
              className="gap-1.5"
            >
              {globalActing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              Sync All
            </Button>
            <Button
              variant="outline"
              onClick={handleMainAll}
              disabled={globalActing || loading}
              size="sm"
              className="text-destructive border-destructive/40 hover:bg-destructive/5"
            >
              Reset All to Main
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-6">
        {/* Error State */}
        {error && (
          <div className="flex items-start gap-3 rounded-lg border-l-4 border-l-destructive border border-border bg-card p-4 mb-6 shadow-sm">
            <AlertCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
            <div className="flex-1">
              <h3 className="text-sm font-semibold text-foreground">
                Sync Error
              </h3>
              <p className="text-sm text-muted-foreground mt-0.5">{error}</p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={triggerFetchRepos}
              className="shrink-0"
            >
              Retry
            </Button>
          </div>
        )}

        {/* Error State */}
        {error && (
          <div className="flex items-start gap-3 rounded-lg border-l-4 border-l-destructive border border-border bg-card p-4 mb-6 shadow-sm">
            <AlertCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
            <div className="flex-1">
              <h3 className="text-sm font-semibold text-foreground">
                Sync Error
              </h3>
              <p className="text-sm text-muted-foreground mt-0.5">{error}</p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={triggerFetchRepos}
              className="shrink-0"
            >
              Retry
            </Button>
          </div>
        )}

        {/* Empty Search Result State */}
        {!loading && filteredRepos.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 border border-dashed rounded-lg bg-card text-center px-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted mb-4">
              <Search className="h-5 w-5 text-muted-foreground" />
            </div>
            <h3 className="text-sm font-semibold text-foreground">
              No matches found
            </h3>
            <p className="text-xs text-muted-foreground mt-1 max-w-xs">
              No repositories or branches match your search criteria. Try a
              different term.
            </p>
          </div>
        )}

        {/* Repo Table */}
        <div className="rounded-lg border bg-card overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b bg-muted/40 text-muted-foreground text-[11px] font-bold uppercase tracking-wider">
                  <th className="py-3 px-4">Repo</th>
                  <th className="py-3 px-4">Branch</th>
                  <th className="py-3 px-4 text-center">Ahead</th>
                  <th className="py-3 px-4 text-center">Behind</th>
                  <th className="py-3 px-4 text-center">Dirty</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y text-sm">
                {filteredRepos.map((repo) => {
                  const isActing = actingPaths.has(repo.path) || globalActing;
                  return (
                    <tr
                      key={repo.path}
                      className="hover:bg-muted/10 transition-colors"
                    >
                      <td className="py-2.5 px-4 font-medium text-foreground">
                        {repo.name}
                      </td>
                      <td className="py-2.5 px-4">
                        <span className={branchBadgeClass(repo.branch)}>
                          <GitBranch className="h-3 w-3" />
                          {repo.branch}
                        </span>
                      </td>
                      <td className="py-2.5 px-4 text-center">
                        {repo.ahead > 0 ? (
                          <span className="inline-flex items-center gap-0.5 text-xs font-mono font-medium text-green-700">
                            <span>↑</span>{repo.ahead}
                          </span>
                        ) : (
                          <span className="text-muted-foreground text-xs">—</span>
                        )}
                      </td>
                      <td className="py-2.5 px-4 text-center">
                        {repo.behind > 0 ? (
                          <span className="inline-flex items-center gap-0.5 text-xs font-mono font-medium text-red-700">
                            <span>↓</span>{repo.behind}
                          </span>
                        ) : (
                          <span className="text-muted-foreground text-xs">—</span>
                        )}
                      </td>
                      <td className="py-2.5 px-4 text-center">
                        {repo.uncommitted > 0 ? (
                          <span className="inline-flex items-center gap-0.5 text-xs font-mono font-medium text-amber-700">
                            <span>~</span>{repo.uncommitted}
                          </span>
                        ) : (
                          <span className="text-muted-foreground text-xs">—</span>
                        )}
                      </td>
                      <td className="py-2.5 px-4 text-right">
                        <div className="flex justify-end gap-1.5">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleMainRepo(repo)}
                            disabled={isActing}
                            className="font-mono text-xs hover:bg-muted"
                          >
                            {repo.defaultBranch}
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleSyncRepo(repo)}
                            disabled={isActing}
                            className="gap-1 shadow-none border-border/80 hover:bg-muted"
                          >
                            {actingPaths.has(repo.path) ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <RefreshCw className="h-3 w-3" />
                            )}
                            Sync
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setManagingRepo(repo)}
                            className="text-muted-foreground hover:bg-muted"
                          >
                            Manage
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {loading &&
                  Array.from({ length: Math.max(0, 6 - repos.length) }).map(
                    (_, i) => <SkeletonRow key={`row-${repos.length}-${i}`} />,
                  )}
              </tbody>
            </table>
          </div>
        </div>
      </main>

      {managingRepo && (
        <div className="fixed inset-y-0 right-0 w-80 bg-card border-l border-border shadow-xl z-50 flex flex-col">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <span className="font-semibold text-sm">{managingRepo.name}</span>
            <button
              type="button"
              onClick={() => setManagingRepo(null)}
              className="text-muted-foreground hover:text-foreground"
            >
              ✕
            </button>
          </div>
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-muted-foreground p-6 text-center">
            <GitBranch className="h-8 w-8" />
            <p className="text-sm font-medium">Branch management</p>
            <p className="text-xs">Coming soon</p>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="border-t py-6 mt-12 bg-muted/10">
        <div className="mx-auto max-w-6xl px-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-muted-foreground">
          <span>GML Web UI — running on localhost</span>
          {status?.cwd && (
            <span className="font-mono bg-muted/50 px-2 py-1 rounded border">
              CWD: {status.cwd}
            </span>
          )}
        </div>
      </footer>
    </div>
  );
}
