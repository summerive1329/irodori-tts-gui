param(
    [ValidateSet("cpu", "cu128", "xpu", "rocm")]
    [string]$TorchBackend = "cu128"
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$IrodoriDir = Join-Path $Root "vendor\Irodori-TTS"
$FrontendDir = Join-Path $Root "frontend"
$BackendDir = Join-Path $Root "backend"

function Invoke-CheckedCommand {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Command,
        [Parameter(ValueFromRemainingArguments = $true)]
        [object[]]$Arguments
    )

    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$Command failed with exit code $LASTEXITCODE."
    }
}

if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
    throw "uv is required. Install it from https://docs.astral.sh/uv/"
}
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    throw "Node.js and npm are required."
}

Write-Host "[1/4] Initializing Irodori-TTS submodule..."
Invoke-CheckedCommand -Command git -Arguments @(
    "-C", $Root, "submodule", "update", "--init", "--recursive"
)

Write-Host "[2/4] Installing Irodori-TTS with backend: $TorchBackend"
Invoke-CheckedCommand -Command uv -Arguments @(
    "sync", "--project", $IrodoriDir, "--extra", $TorchBackend
)

$PythonExe = Join-Path $IrodoriDir ".venv\Scripts\python.exe"
if (-not (Test-Path $PythonExe)) {
    throw "Irodori virtual environment was not created: $PythonExe"
}

Write-Host "[3/4] Installing GUI backend into the Irodori environment..."
Invoke-CheckedCommand -Command uv -Arguments @(
    "pip", "install", "--python", $PythonExe, "-e", "$BackendDir[dev]"
)

Write-Host "[4/4] Installing frontend packages..."
Invoke-CheckedCommand -Command npm -Arguments @("--prefix", $FrontendDir, "install")

Write-Host "Setup complete. Double-click run.bat to start Irodori Studio."
