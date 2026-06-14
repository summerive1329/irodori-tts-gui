# Irodori Studio

Local browser UI for managing multi-line, multi-reference Irodori-TTS generation.

## Repository Layout

- `vendor/Irodori-TTS`: upstream inference engine as a Git submodule
- `backend`: FastAPI project storage and inference API
- `frontend`: React matrix editor

Clone with submodules enabled:

```powershell
git clone --recurse-submodules <repository-url>
```

## Quick Start (Windows)

1. Run `setup.bat`. NVIDIA users can keep the default CUDA 12.8 setup.
2. Run `run.bat`.
3. The browser opens at `http://127.0.0.1:5173`.

Other PyTorch backends can be selected from a terminal:

```powershell
.\setup.bat cpu
.\setup.bat xpu
```

Project JSON, uploaded references, generated cells and exports are stored under
`project_data/` and are not committed to Git.

## Workflow

- Add several reference audio files. Each reference becomes a matrix column.
- Paste dialogue or drop `.txt`, `.md`, `.csv` or `.tsv` files. Non-empty lines
  are appended without replacing existing dialogue.
- Generate missing cells. The backend keeps the Irodori model in memory and
  reuses one encoded latent per reference audio.
- Regenerate only the exact `dialogue x reference` cell that needs another take.
- Select one result per dialogue row, reorder the rows, then export a joined WAV.

## Development

The test-only backend environment can be prepared without the Irodori model:

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -e ".[dev]"
.\.venv\Scripts\python.exe -m pytest
```

Frontend checks:

```powershell
cd frontend
npm install
npm test
npm run build
```
