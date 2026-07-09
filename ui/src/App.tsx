import { useState } from 'react'
import { GitBranch, RefreshCw, CheckCircle2 } from 'lucide-react'
import { Button } from './components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from './components/ui/card'
import { cn } from './lib/utils'

const VERSION = '0.2.21'

const MOCK_REPOS = [
  { name: 'frontend-app', branch: 'main', status: 'ok' as const },
  { name: 'backend-api', branch: 'feature/auth', status: 'ok' as const },
  { name: 'infra', branch: 'main', status: 'error' as const },
  { name: 'shared-lib', branch: 'release/2.0', status: 'ok' as const },
]

function branchColor(branch: string) {
  if (branch === 'main' || branch === 'master') return 'text-green-500'
  if (branch.startsWith('release/')) return 'text-red-500'
  return 'text-yellow-500'
}

export default function App() {
  const [syncing, setSyncing] = useState(false)
  const [synced, setSynced] = useState(false)

  function handleSync() {
    setSyncing(true)
    setSynced(false)
    setTimeout(() => {
      setSyncing(false)
      setSynced(true)
    }, 1500)
  }

  return (
    <div className="min-h-screen bg-background p-8">
      {/* Header */}
      <div className="mx-auto max-w-4xl">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Git Manager Lite</h1>
            <p className="text-muted-foreground mt-1 text-sm">v{VERSION} — managing {MOCK_REPOS.length} repositories</p>
          </div>
          <Button onClick={handleSync} disabled={syncing} className="gap-2">
            {syncing ? (
              <RefreshCw className="h-4 w-4 animate-spin" />
            ) : synced ? (
              <CheckCircle2 className="h-4 w-4" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            {syncing ? 'Syncing...' : synced ? 'Synced!' : 'Sync All'}
          </Button>
        </div>

        {/* Repo cards */}
        <div className="grid gap-4 sm:grid-cols-2">
          {MOCK_REPOS.map((repo) => (
            <Card key={repo.name} className={cn(repo.status === 'error' && 'border-destructive/50')}>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">{repo.name}</CardTitle>
                <CardDescription className={cn('flex items-center gap-1.5 font-mono text-xs', branchColor(repo.branch))}>
                  <GitBranch className="h-3 w-3" />
                  {repo.branch}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {repo.status === 'error' ? (
                  <p className="text-destructive text-xs">Last sync failed</p>
                ) : (
                  <p className="text-muted-foreground text-xs">Up to date</p>
                )}
              </CardContent>
              <CardFooter className="gap-2">
                <Button variant="outline" size="sm">Sync</Button>
                <Button variant="ghost" size="sm">Branches</Button>
              </CardFooter>
            </Card>
          ))}
        </div>

        {/* Footer note */}
        <p className="text-muted-foreground mt-8 text-center text-xs">
          GML Web UI — proof of concept — <span className="font-mono">gml serve</span> running on localhost
        </p>
      </div>
    </div>
  )
}
