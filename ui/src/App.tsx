import { AlertCircle, GitBranch, Loader2, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from './components/ui/button';

const VERSION = '0.2.21';

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

function branchColor(branch: string) {
  if (branch === 'main' || branch === 'master') return 'text-green-500';
  if (branch.startsWith('release/')) return 'text-red-500';
  return 'text-yellow-500';
}

export default function App() {
  const [repos, setRepos] = useState<RepoInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [actingPaths, setActingPaths] = useState<Set<string>>(new Set());
  const [globalActing, setGlobalActing] = useState(false);

  useEffect(() => {
    const fetchRepos = async () => {
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
    fetchRepos();
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
    <div className="min-h-screen bg-background p-8">
      <div className="mx-auto max-w-5xl">
        {/* Header */}
        <div className="mb-8 flex items-center justify-between border-b pb-6">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">
              Git Manager Lite
            </h1>
            <p className="text-muted-foreground mt-1 text-sm">
              v{VERSION} — {repos.length} repositories
            </p>
          </div>
          <div className="flex gap-3">
            <Button
              onClick={handleSyncAll}
              disabled={globalActing || loading}
              className="gap-2"
            >
              {globalActing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              Sync All
            </Button>
            <Button
              variant="destructive"
              onClick={handleMainAll}
              disabled={globalActing || loading}
            >
              Reset All to Main
            </Button>
          </div>
        </div>

        {/* Filter input */}
        <div className="mb-6">
          <input
            type="text"
            placeholder="Filter repositories or branches..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="w-full max-w-md rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          />
        </div>

        {/* Loading and Error */}
        {loading && repos.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Loading repositories...
            </p>
          </div>
        )}

        {error && (
          <div className="flex items-center gap-2 rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-destructive mb-6">
            <AlertCircle className="h-5 w-5" />
            <span className="text-sm font-medium">{error}</span>
            <Button
              variant="outline"
              size="sm"
              onClick={triggerFetchRepos}
              className="ml-auto text-foreground"
            >
              Retry
            </Button>
          </div>
        )}

        {/* Repo Table */}
        {!loading && filteredRepos.length === 0 && (
          <div className="text-center py-10 border border-dashed rounded-lg">
            <p className="text-sm text-muted-foreground">
              No repositories found matching the filter.
            </p>
          </div>
        )}

        {filteredRepos.length > 0 && (
          <div className="rounded-md border bg-card">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b bg-muted/50 text-muted-foreground text-xs font-semibold uppercase tracking-wider">
                  <th className="p-4">Repo</th>
                  <th className="p-4">Branch</th>
                  <th className="p-4">Status</th>
                  <th className="p-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y text-sm">
                {filteredRepos.map((repo) => {
                  const isActing = actingPaths.has(repo.path) || globalActing;
                  const showSyncStatus =
                    repo.ahead > 0 || repo.behind > 0 || repo.uncommitted > 0;
                  return (
                    <tr
                      key={repo.path}
                      className="hover:bg-muted/30 transition-colors"
                    >
                      <td className="p-4 font-semibold">{repo.name}</td>
                      <td className="p-4 font-mono text-xs">
                        <span className={branchColor(repo.branch)}>
                          <GitBranch className="inline h-3 w-3 mr-1 align-text-top" />
                          {repo.branch}
                        </span>
                      </td>
                      <td className="p-4">
                        {showSyncStatus ? (
                          <div className="flex gap-2 text-xs font-mono text-muted-foreground">
                            {repo.ahead > 0 && (
                              <span className="text-green-500">
                                ↑{repo.ahead}
                              </span>
                            )}
                            {repo.behind > 0 && (
                              <span className="text-red-500">
                                ↓{repo.behind}
                              </span>
                            )}
                            {repo.uncommitted > 0 && (
                              <span className="text-yellow-500">
                                ~{repo.uncommitted}
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-green-500 text-xs font-mono">
                            ✓
                          </span>
                        )}
                      </td>
                      <td className="p-4 text-right">
                        <div className="flex justify-end gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleMainRepo(repo)}
                            disabled={isActing}
                          >
                            {repo.defaultBranch}
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleSyncRepo(repo)}
                            disabled={isActing}
                            className="gap-1"
                          >
                            {actingPaths.has(repo.path) ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <RefreshCw className="h-3 w-3" />
                            )}
                            Sync
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled
                            className="opacity-50"
                          >
                            Manage
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Footer note */}
        <p className="text-muted-foreground mt-8 text-center text-xs">
          GML Web UI — <span className="font-mono">gml serve</span> running on
          localhost
        </p>
      </div>
    </div>
  );
}
