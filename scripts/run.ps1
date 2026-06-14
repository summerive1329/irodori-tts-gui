$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$BackendDir = Join-Path $Root "backend"
$FrontendDir = Join-Path $Root "frontend"
$IrodoriPython = Join-Path $Root "vendor\Irodori-TTS\.venv\Scripts\python.exe"
$BackendPython = Join-Path $BackendDir ".venv\Scripts\python.exe"

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

Start-Sleep -Seconds 2
Start-Process "http://127.0.0.1:5173"
