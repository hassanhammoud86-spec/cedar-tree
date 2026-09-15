<#
.SYNOPSIS
  Registers the Cedar Tree MCP server globally for the current Windows user, so it
  is automatically available to GitHub Copilot agent mode in every workspace opened
  with VS Code and every solution opened with Visual Studio - no per-project setup.

.DESCRIPTION
  This script writes/merges a "cedar-tree" server entry into:
    1. VS Code's global user-level MCP config:  %APPDATA%\Code\User\mcp.json
    2. Visual Studio's global user-level MCP config: %USERPROFILE%\.mcp.json

  It is idempotent: re-running it merges/updates the "cedar-tree" entry in place
  instead of duplicating it, and leaves any other servers already present in those
  files untouched. Existing files are always JSON-parsed and rewritten with the
  merged result rather than blindly overwritten.

.PARAMETER RepoPath
  Path to the Cedar Tree repository (the folder containing package.json / dist).
  Defaults to the parent directory of this script's own location (i.e. assumes this
  script is still sitting in <repo>\scripts\install-global-mcp.ps1).

.PARAMETER WorkspaceRoot
  Optional workspace root the server should default to via CEDAR_TREE_WORKSPACE_ROOT
  when no per-project override is supplied by the client. Defaults to RepoPath.

.EXAMPLE
  # From anywhere, using the checked-out repo's own scripts folder:
  powershell -ExecutionPolicy Bypass -File .\scripts\install-global-mcp.ps1

.EXAMPLE
  # Point at a different checkout / workspace root explicitly:
  powershell -ExecutionPolicy Bypass -File .\scripts\install-global-mcp.ps1 `
    -RepoPath "C:\code\cedar-tree" -WorkspaceRoot "C:\code"
#>

[CmdletBinding()]
param(
  [string]$RepoPath,
  [string]$WorkspaceRoot = $null
)

$ErrorActionPreference = "Stop"

function Write-Info($msg) { Write-Host "[install-global-mcp] $msg" }

# ConvertFrom-Json's -AsHashtable parameter is only available on PowerShell 6+/7+.
# This script targets Windows PowerShell 5.1 too, so PSCustomObject results are
# converted to ordered hashtables manually for uniform read/write handling below.
function ConvertTo-OrderedHashtable {
  param([Parameter(ValueFromPipeline = $true)]$InputObject)
  process {
    if ($null -eq $InputObject) { return $null }
    if ($InputObject -is [System.Collections.IDictionary]) {
      $hash = [ordered]@{}
      foreach ($key in $InputObject.Keys) { $hash[$key] = ConvertTo-OrderedHashtable $InputObject[$key] }
      return $hash
    }
    if ($InputObject -is [string]) { return $InputObject }
    if ($InputObject -is [System.Collections.IEnumerable]) {
      return @($InputObject | ForEach-Object { ConvertTo-OrderedHashtable $_ })
    }
    if ($InputObject -is [psobject] -and $InputObject.PSObject.Properties.Count -gt 0) {
      $hash = [ordered]@{}
      foreach ($prop in $InputObject.PSObject.Properties) { $hash[$prop.Name] = ConvertTo-OrderedHashtable $prop.Value }
      return $hash
    }
    return $InputObject
  }
}

if (-not $RepoPath) {
  $scriptDir = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
  $RepoPath = Split-Path -Parent $scriptDir
}
$RepoPath = (Resolve-Path $RepoPath).Path
if (-not $WorkspaceRoot) { $WorkspaceRoot = $RepoPath }

$serverEntryPath = Join-Path $RepoPath "dist\server.js"
if (-not (Test-Path $serverEntryPath)) {
  Write-Info "WARNING: $serverEntryPath does not exist yet. Run 'npm install && npm run build' in $RepoPath first."
}

# The MCP server definition shared by both VS Code and Visual Studio formats.
# Both tools use the same shape: { command, args, env, type }.
function New-CedarTreeServerDef {
  [ordered]@{
    type    = "stdio"
    command = "node"
    args    = @($serverEntryPath)
    env     = [ordered]@{
      CEDAR_TREE_WORKSPACE_ROOT = $WorkspaceRoot
    }
  }
}

function Merge-McpConfig {
  param(
    [string]$ConfigPath,
    [string]$TopLevelKey
  )

  $dir = Split-Path -Parent $ConfigPath
  if ($dir -and -not (Test-Path $dir)) {
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
  }

  $config = $null
  if (Test-Path $ConfigPath) {
    $raw = Get-Content -Raw -Path $ConfigPath -ErrorAction SilentlyContinue
    if ($raw -and $raw.Trim().Length -gt 0) {
      try {
        $config = ConvertTo-OrderedHashtable ($raw | ConvertFrom-Json)
      } catch {
        Write-Info "WARNING: Existing $ConfigPath is not valid JSON. Backing it up and starting fresh."
        Copy-Item $ConfigPath "$ConfigPath.bak-$(Get-Date -Format yyyyMMddHHmmss)" -Force
        $config = $null
      }
    }
  }

  if (-not $config) { $config = [ordered]@{} }
  if (-not $config.Contains($TopLevelKey)) { $config[$TopLevelKey] = [ordered]@{} }

  $config[$TopLevelKey]["cedar-tree"] = New-CedarTreeServerDef

  # Earlier installer versions wrote the Visual Studio entry to VS Code's
  # "servers" key. Remove only that stale Cedar Tree duplicate; keep any
  # legitimate VS Code server entries intact.
  if ($TopLevelKey -eq "mcpServers" -and $config.Contains("servers") -and
      $config["servers"] -is [System.Collections.IDictionary] -and
      $config["servers"].Contains("cedar-tree")) {
    $config["servers"].Remove("cedar-tree")
    if ($config["servers"].Count -eq 0) { $config.Remove("servers") }
  }

  $json = $config | ConvertTo-Json -Depth 20
  Set-Content -Path $ConfigPath -Value $json -Encoding utf8
  Write-Info "Registered 'cedar-tree' server in $ConfigPath"
}

# 1. VS Code global user config: %APPDATA%\Code\User\mcp.json (top-level key: "servers")
$vscodeMcpPath = Join-Path $env:APPDATA "Code\User\mcp.json"
Merge-McpConfig -ConfigPath $vscodeMcpPath -TopLevelKey "servers"

# 2. Visual Studio global user config: %USERPROFILE%\.mcp.json.
# Visual Studio uses the legacy-compatible "mcpServers" key, unlike VS Code's
# current "servers" schema.
$vsMcpPath = Join-Path $env:USERPROFILE ".mcp.json"
Merge-McpConfig -ConfigPath $vsMcpPath -TopLevelKey "mcpServers"

Write-Info ""
Write-Info "Done. Cedar Tree is now registered globally for this Windows user account:"
Write-Info "  - VS Code:        $vscodeMcpPath"
Write-Info "  - Visual Studio:  $vsMcpPath"
Write-Info ""
Write-Info "Restart VS Code / Visual Studio (or reload the window) to pick up the change."
Write-Info "Copilot agent/autopilot mode auto-discovers servers listed here - no further action needed."
