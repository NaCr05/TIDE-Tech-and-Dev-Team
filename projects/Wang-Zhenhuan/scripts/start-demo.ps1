[CmdletBinding()]
param(
  [switch]$NoBuild,
  [ValidateRange(30, 600)]
  [int]$TimeoutSeconds = 180
)

$ErrorActionPreference = "Stop"

$scriptDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = (Resolve-Path (Join-Path $scriptDirectory "..")).Path
$originalLocation = Get-Location

function Get-DotEnvValue {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Name,
    [Parameter(Mandatory = $true)]
    [string]$DefaultValue
  )

  $line = Get-Content (Join-Path $projectRoot ".env") |
    Where-Object { $_ -match "^\s*$([regex]::Escape($Name))\s*=" } |
    Select-Object -First 1

  if (-not $line) {
    return $DefaultValue
  }

  $value = ($line -split "=", 2)[1].Trim()
  if (-not $value) {
    return $DefaultValue
  }

  return $value
}

function Invoke-Docker {
  param(
    [Parameter(Mandatory = $true)]
    [string[]]$Arguments,
    [Parameter(Mandatory = $true)]
    [string]$Description
  )

  Write-Host "`n==> $Description" -ForegroundColor Cyan
  & docker @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "$Description failed with exit code $LASTEXITCODE."
  }
}

function Wait-HttpEndpoint {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Name,
    [Parameter(Mandatory = $true)]
    [string]$Uri
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  do {
    try {
      $response = Invoke-WebRequest -UseBasicParsing -Uri $Uri -TimeoutSec 5
      if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 400) {
        Write-Host "[OK] $Name -> $Uri" -ForegroundColor Green
        return
      }
    }
    catch {
      # The service may still be applying migrations or starting Vite.
    }

    Start-Sleep -Seconds 2
  } while ((Get-Date) -lt $deadline)

  throw "$Name did not become ready within $TimeoutSeconds seconds: $Uri"
}

function Wait-ContainerHealth {
  param(
    [Parameter(Mandatory = $true)]
    [string[]]$Services
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  do {
    $allHealthy = $true

    foreach ($service in $Services) {
      $containerId = & docker compose ps -q $service
      if (-not $containerId) {
        $allHealthy = $false
        break
      }

      $health = & docker inspect `
        --format "{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}" `
        $containerId
      if ($health -ne "healthy") {
        $allHealthy = $false
        break
      }
    }

    if ($allHealthy) {
      Write-Host "[OK] All Compose services are healthy." -ForegroundColor Green
      return
    }

    Start-Sleep -Seconds 2
  } while ((Get-Date) -lt $deadline)

  throw "Compose services did not all become healthy within $TimeoutSeconds seconds."
}

try {
  Set-Location $projectRoot

  if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw "Docker CLI was not found. Start Docker Desktop and reopen PowerShell."
  }

  Write-Host "Checking Docker Desktop..." -ForegroundColor Cyan
  & docker info --format "{{.ServerVersion}}" *> $null
  if ($LASTEXITCODE -ne 0) {
    throw "Docker Desktop is not running or the Docker engine is unavailable."
  }

  $envFile = Join-Path $projectRoot ".env"
  if (-not (Test-Path $envFile)) {
    Copy-Item (Join-Path $projectRoot ".env.example") $envFile
    Write-Host "Created .env from .env.example." -ForegroundColor Yellow
    Write-Warning "Configure MATTERMOST_SLASH_TOKEN before testing /ds commands."
  }

  Invoke-Docker -Arguments @("compose", "config", "--quiet") `
    -Description "Validating Docker Compose configuration"

  $composeArguments = @("compose", "up", "-d")
  if (-not $NoBuild) {
    $composeArguments += "--build"
  }

  try {
    Invoke-Docker -Arguments $composeArguments `
      -Description "Starting services and initializing the database"
  }
  catch {
    if ($NoBuild) {
      throw
    }

    Write-Warning "Image build failed, usually because Docker Hub is temporarily unreachable."
    Write-Host "Retrying with locally cached images..." -ForegroundColor Yellow
    Invoke-Docker -Arguments @("compose", "up", "-d", "--no-build") `
      -Description "Starting services from locally cached images"
  }

  $backendPort = Get-DotEnvValue -Name "BACKEND_PORT" -DefaultValue "3001"
  $frontendPort = Get-DotEnvValue -Name "FRONTEND_PORT" -DefaultValue "5173"
  $agentPort = Get-DotEnvValue -Name "AGENT_PORT" -DefaultValue "8000"

  Write-Host "`nWaiting for application health checks..." -ForegroundColor Cyan
  Wait-HttpEndpoint -Name "Backend" -Uri "http://localhost:$backendPort/health"
  Wait-HttpEndpoint -Name "Agent" -Uri "http://localhost:$agentPort/health"
  Wait-HttpEndpoint -Name "Frontend" -Uri "http://localhost:$frontendPort"
  Wait-ContainerHealth -Services @("db", "agent", "backend", "frontend")

  Invoke-Docker -Arguments @("compose", "ps") `
    -Description "Showing final container status"

  Write-Host "`nTIDE demo is ready." -ForegroundColor Green
  Write-Host "Frontend : http://localhost:$frontendPort"
  Write-Host "Backend  : http://localhost:$backendPort/health"
  Write-Host "Agent    : http://localhost:$agentPort/health"
  Write-Host ""
  Write-Host "Prisma migrations and seed data are applied automatically by the backend container."
}
finally {
  Set-Location $originalLocation
}
