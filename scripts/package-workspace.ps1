$ErrorActionPreference = 'Stop'
$studioRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$studioFiles = @(
  'README.md', 'package.json', 'tsconfig.json', 'pages/cloud.ts', 'pages/main.tsx', 'pages/deployment.json',
  'app/inspiration-app.tsx', 'app/project-workspace.tsx', 'app/project-workspace.css',
  'lib/shooting.ts', 'supabase/project-workspace.sql', 'supabase/check-workspace.sql',
  'supabase/config.toml', 'supabase/functions/_shared/agent.ts',
  'supabase/functions/shooting-agent/index.ts', 'scripts/test-pages.mjs',
  'scripts/test-workspace.mjs', 'scripts/test-agent-edge.mjs', 'scripts/test-project-flow.mjs',
  'scripts/qa/index.html', 'scripts/qa/main.tsx', 'scripts/qa/vite.config.ts',
  'scripts/package-workspace.ps1', 'docs/PROJECT-STUDIO-DEPLOY.md',
  '.github/workflows/pages.yml', 'scripts/test-downloader.mjs',
  'services/xhs/core.py', 'services/xhs/main.py', 'services/xhs/Dockerfile',
  'services/xhs/.dockerignore', 'services/xhs/test_importer.py', 'services/xhs/README.md'
)
$studioStamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$studioOutput = Join-Path $studioRoot 'outputs'
$studioStage = Join-Path $studioOutput ('project-studio-source-' + $studioStamp)
$studioArchive = Join-Path $studioOutput ('portrait-muse-project-studio-' + $studioStamp + '.zip')
New-Item -ItemType Directory -Path $studioStage -Force | Out-Null
$studioManifest = foreach ($relative in $studioFiles) {
  $source = [IO.Path]::GetFullPath((Join-Path $studioRoot $relative))
  if (-not $source.StartsWith($studioRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Source path outside project' }
  $target = Join-Path $studioStage $relative
  New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($target)) -Force | Out-Null
  Copy-Item -LiteralPath $source -Destination $target
  @{ path = $relative; sha256 = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant() }
}
@{ baseCommit = '495e32470dffb1a3b42257923f0b785cce1956cb'; status = 'local-only-not-deployed'; containsPrivateData = $false; files = $studioManifest } | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $studioStage 'PACKAGE-MANIFEST.json') -Encoding utf8
Add-Type -AssemblyName System.IO.Compression.FileSystem
[IO.Compression.ZipFile]::CreateFromDirectory($studioStage, $studioArchive)
@{ archive = $studioArchive; sourceFiles = $studioFiles.Count; sizeBytes = (Get-Item -LiteralPath $studioArchive).Length } | ConvertTo-Json
