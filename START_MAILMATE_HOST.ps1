param([switch]$NoBrowser)

$ErrorActionPreference = "Stop"

if (-not (Test-Path ".\app.py")) {
    Write-Host "Run this from the Mailmate repository root." -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "Mailmate single-process host" -ForegroundColor Cyan
Write-Host "----------------------------"

try {
    $res = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:2806/v1/models" -TimeoutSec 2
    if ($res.StatusCode -ge 200 -and $res.StatusCode -lt 300) {
        Write-Host "LM Studio: READY on 127.0.0.1:2806" -ForegroundColor Green
    }
} catch {
    Write-Host "LM Studio: OFFLINE" -ForegroundColor Yellow
    Write-Host "Start LM Studio Local API Server on port 2806." -ForegroundColor Yellow
}

$appListening = Get-NetTCPConnection -LocalPort 5000 -State Listen -ErrorAction SilentlyContinue
if (-not $appListening) {
    Write-Host "Starting Mailmate Flask on :5000..." -ForegroundColor Cyan
    Start-Process powershell.exe -ArgumentList @(
        "-NoExit",
        "-Command",
        "Set-Location -LiteralPath '$((Get-Location).Path)'; py app.py"
    )
} else {
    Write-Host "Mailmate Flask: already listening on :5000" -ForegroundColor Green
}

Start-Sleep -Seconds 2
if (-not $NoBrowser) { Start-Process "http://localhost:5000/dashboard.html" }

Write-Host ""
Write-Host "Local app:       http://localhost:5000"
Write-Host "Team compute:    http://100.114.2.88:5000/api/compute"
Write-Host "LM Studio:       http://127.0.0.1:2806"
Write-Host "No separate worker process is required." -ForegroundColor Green
