$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$BackendDir = Join-Path $Root "backend"
$FrontendDir = Join-Path $Root "frontend"
$IrodoriPython = Join-Path $Root "vendor\Irodori-TTS\.venv\Scripts\python.exe"
$BackendPython = Join-Path $BackendDir ".venv\Scripts\python.exe"

. (Join-Path $PSScriptRoot "launch_helpers.ps1")

if (Test-Path $IrodoriPython) {
    $PythonExe = $IrodoriPython
} elseif (Test-Path $BackendPython) {
    $PythonExe = $BackendPython
} else {
    throw "Python environment not found. Run setup.bat first."
}
if (-not (Test-Path (Join-Path $FrontendDir "node_modules"))) {
    throw "Frontend dependencies not found. Run setup.bat first."
}

$env:IRODORI_GUI_DATA_DIR = Join-Path $Root "project_data"
$BackendCommand = "& '$PythonExe' -m uvicorn app.main:app --host 127.0.0.1 --port 8000"
$FrontendCommand = "npm run dev -- --host 127.0.0.1"

Start-Process powershell.exe -WorkingDirectory $BackendDir -ArgumentList @(
    "-NoExit", "-NoProfile", "-Command", $BackendCommand
)
Start-Process powershell.exe -WorkingDirectory $FrontendDir -ArgumentList @(
    "-NoExit", "-NoProfile", "-Command", $FrontendCommand
)

Write-Host "Waiting for the backend..."
Wait-ForHttpEndpoint -Url "http://127.0.0.1:8000/api/health"
Write-Host "Waiting for the frontend..."
Wait-ForHttpEndpoint -Url "http://127.0.0.1:5173"
Start-Process "http://127.0.0.1:5173"
