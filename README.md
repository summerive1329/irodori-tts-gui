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

Development setup and launch instructions are added alongside the runnable MVP.
