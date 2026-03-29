# Contributing to PCIe Lane Sentinel

Thanks for your interest in contributing! This project exists because one too many people built a PC and never noticed their GPU was running at half bandwidth. Every improvement helps real builders.

---

## What We're Looking For

### High Priority
- **NVIDIA support via `nvidia-smi`** — GPU-Z works but requires it to be open. `nvidia-smi` can provide bifurcation data without a separate app.
- **Self-contained `.exe`** — Currently the Tauri `.exe` still depends on the Node.js backend running separately. Migrating the PowerShell scripts to Tauri Commands (Rust IPC) would make it fully standalone.
- **Automatic GPU-Z launch** — Detect if GPU-Z is installed but not running, and offer a "Launch GPU-Z" button.

### Medium Priority
- **Historical logging** — Save scan results to `%APPDATA%\PCIeLaneSentinel\` with timestamps, so users can compare before/after fixing bifurcation.
- **Better NVMe ↔ controller matching** — The current positional matching is fragile on systems with external PCIe expansion cards. A more robust method using device instance IDs would be better.
- **Multi-GPU support** — Tested with iGPU + dGPU. Behaviour with 2× dGPUs (SLI-era boards or workstation cards) is untested.

### Nice to Have
- **Dark/light mode toggle**
- **"Copy report" button** — exports all readings as plain text for forum posts
- **Localisation** — currently English only

---

## Development Setup

### Prerequisites

- [Node.js](https://nodejs.org/) ≥ 18
- [Rust](https://rustup.rs/) (stable, for Tauri builds)
- Windows 10/11 x64 (the app is Windows-only by design)
- [GPU-Z](https://www.techpowerup.com/gpuz/) for testing bifurcation detection

### Running Locally

```powershell
git clone https://github.com/yourusername/PCIeCheck.git
cd PCIeCheck
npm install
npm run start   # Starts Vite frontend + Node.js API concurrently
```

Frontend: `http://localhost:5173`  
API: `http://localhost:3001`

### Testing the PowerShell Scripts Directly

```powershell
# Test PnP device scan
powershell -ExecutionPolicy Bypass -File get-pci-data.ps1

# Test GPU-Z shared memory (requires GPU-Z open)
powershell -ExecutionPolicy Bypass -File get-gpuz-data.ps1

# Test system info (motherboard, NVMe names)
powershell -ExecutionPolicy Bypass -File get-system-info.ps1
```

### Building the Desktop App

```powershell
npm run tauri:build
# Outputs to: src-tauri\target\release\bundle\nsis\
```

First build takes ~5–15 minutes (Rust compiles from scratch). Subsequent builds are fast.

---

## Code Structure

| File | Responsibility |
|---|---|
| `src/App.tsx` | All frontend logic — data fetching, GPU-Z + PnP fusion, render |
| `src/index.css` | All styles (no Tailwind — vanilla CSS with CSS variables) |
| `server.js` | Express API bridge — runs PowerShell scripts, parses JSON |
| `get-pci-data.ps1` | Windows PnP bridge scan |
| `get-gpuz-data.ps1` | GPU-Z SHM reader (C# compiled inline via `Add-Type`) |
| `get-system-info.ps1` | Motherboard, CPU, NVMe names via WMI |
| `src-tauri/` | Tauri Rust wrapper, capabilities, config |

---

## Guidelines

### PowerShell Scripts
- Must be compatible with Windows PowerShell 5.1 (the built-in version)
- Avoid C# 6+ features (exception filters, `nameof`, etc.) — the `Add-Type` compiler uses an older Roslyn
- Always output valid JSON — the Node.js server parses with `JSON.parse()`
- Return `{ GpuZRunning: false }` or empty arrays on failure, not `null`

### Frontend (React / TypeScript)
- Keep the `fetchData` function as the single data-fetch entry point
- Source of truth for device names is always PnP — GPU-Z data is overlaid, never primary
- All styles go in `index.css` using CSS custom properties — no inline style objects for colours
- `source: 'gpuz' | 'pnp'` must be set correctly on every `DisplayDevice` — it drives the badge and the trust level shown to the user

### Tauri
- Any new external URL opening must use `openUrl()` (the Tauri shell plugin wrapper in `App.tsx`), not bare anchor tags
- New permissions must be added to `src-tauri/capabilities/default.json`

---

## Pull Request Process

1. Fork the repo and create a feature branch: `git checkout -b feature/nvidia-smi-support`
2. Make your changes with clear, focused commits
3. Test on a real Windows machine — the app reads actual hardware, emulation won't cover it
4. Update `docs/` if you change architecture or add a new data source
5. Open a PR with a clear description of what changed and why

---

## Reporting Issues

Please include:
- Windows version (`winver`)
- CPU and motherboard model
- GPU model(s)
- Whether GPU-Z was open when you scanned
- The raw output of `powershell -ExecutionPolicy Bypass -File get-gpuz-data.ps1` if GPU detection is wrong
