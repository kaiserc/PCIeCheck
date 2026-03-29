# PCIe Lane Sentinel

> Detect PCIe bottlenecks your motherboard manual warned you about — but you never read.

![PCIe Lane Sentinel](https://img.shields.io/badge/Platform-Windows-blue?style=flat-square&logo=windows)
![Tauri](https://img.shields.io/badge/Built_with-Tauri_v2-gold?style=flat-square&logo=tauri)
![License](https://img.shields.io/badge/License-MIT-green?style=flat-square)

**PCIe Lane Sentinel** is a Windows desktop app that detects PCIe lane bottlenecks caused by hardware bifurcation — specifically the common scenario where placing an NVMe drive in the wrong M.2 slot drops your GPU from PCIe x16 to x8 without any warning.

---

## The Problem

Modern AMD and Intel motherboards share CPU PCIe lanes between the primary GPU slot and adjacent M.2 slots. When you populate a specific M.2 slot, the motherboard controller **automatically splits** the x16 slot into two x8 connections. Your GPU ends up running at half its potential bandwidth — silently, with no warning in Windows.

Windows itself cannot detect this. The PnP API reports the slot's *potential*, not the *actual negotiated* link width. GPU-Z can see it — and this app uses GPU-Z's shared memory interface to read the real values directly from PCI config space registers.

---

## Features

- 🔍 **True bifurcation detection** — reads GPU PCIe link width directly from hardware registers via GPU-Z shared memory (not Windows PnP API estimates)
- 💾 **NVMe drive identification** — shows real drive model names (e.g. "Samsung 990 Pro 2TB") instead of generic "Standard NVM Express Controller"
- 🖥️ **Motherboard panel** — displays your board make/model with one-click links to the PCIe lane map, PDF manual, and manufacturer support page
- ⚠️ **Bottleneck alerts** — cards highlight in red when a GPU or NVMe is throttled, with a plain-English explanation of why
- 🏷️ **Dual data source badges** — "GPU-Z Verified" vs "Windows PnP" so you know how reliable each reading is
- ⚡ **Real-time refresh** — re-scan at any time; run a GPU benchmark first for accurate active link width
- 🪟 **Standalone Windows app** — packaged as a native `.exe` via Tauri (no Node.js or terminal needed to run)

---

## Screenshots

> Dashboard showing GPU running at x8 in an x16 slot due to NVMe bifurcation:

```
AMD Radeon RX 9070           [GPU-Z Verified] [THROTTLED]
PCIe Link Width: x8 / x16 max  ████████░░░░░░░░
PCIe Speed: Gen 5 (32 GT/s)
⚠ Bottleneck Detected: Running at x8 but capable of x16.
  Caused by PCIe bifurcation — an M.2 drive is sharing CPU lanes
  with the GPU slot. Check your motherboard manual below.
```

---

## Requirements

### To run the pre-built `.exe`
- Windows 10/11 x64
- [GPU-Z](https://www.techpowerup.com/gpuz/) running in the background (for accurate GPU bifurcation detection)
- The Node.js backend (`npm run api`) running alongside the app (see note below)

> **Note on architecture:** The `.exe` is a Tauri-wrapped frontend. It still depends on the Node.js/PowerShell backend for hardware data. See [ARCHITECTURE.md](docs/ARCHITECTURE.md) for details and the roadmap for making it fully self-contained.

### To build from source
- [Node.js](https://nodejs.org/) ≥ 18
- [Rust](https://rustup.rs/) (stable toolchain)
- Windows 10/11 x64

---

## Quick Start

### Option A — Browser Dashboard (Dev Mode)

```powershell
git clone https://github.com/kaiserc/PCIeCheck.git
cd PCIeCheck
npm install
npm run start
```

Then open `http://localhost:5173` in your browser. Make sure GPU-Z is open in the background for bifurcation detection.

### Option B — Build the Windows `.exe`

```powershell
npm install
npm run tauri:build
```

The installer will be at:
```
src-tauri\target\release\bundle\nsis\PCIe Lane Sentinel_0.1.0_x64-setup.exe
```

---

## How It Works

| Layer | What it does |
|---|---|
| **GPU-Z Shared Memory** | Opens the `Local\GPUZShMem` shared memory segment that GPU-Z populates with real PCI config space register values. This is the only way to read the actual negotiated link width without a kernel driver. |
| **Windows PnP API** | PowerShell queries `Get-PnpDeviceProperty` on PCIe bridge devices to get topology, NVMe controller relationships, and device names. |
| **WMI** | `Get-PhysicalDisk` provides actual NVMe drive model names (`Samsung 990 Pro`) to replace generic Windows controller names. |
| **React Frontend** | Merges both data sources — GPU-Z data overlaid onto PnP topology by matching PCIe generation speed — then renders the dashboard. |

For a full technical deep-dive, see [docs/HOW-IT-WORKS.md](docs/HOW-IT-WORKS.md).

---

## Project Structure

```
PCIeCheck/
├── src/                    # React + TypeScript frontend
│   ├── App.tsx             # Main dashboard, data fusion logic
│   └── index.css           # Dark-mode UI styles
├── server.js               # Express API bridge (Node.js)
├── get-pci-data.ps1        # PowerShell: Windows PnP bridge scan
├── get-gpuz-data.ps1       # PowerShell: GPU-Z shared memory reader (C# inline)
├── get-system-info.ps1     # PowerShell: Motherboard, CPU, NVMe names
├── src-tauri/              # Tauri (Rust) desktop wrapper
│   ├── src/lib.rs          # Tauri app entry point
│   ├── tauri.conf.json     # App config, window size, bundle targets
│   └── capabilities/       # Tauri permission grants (shell:allow-open etc.)
└── docs/
    ├── ARCHITECTURE.md     # System design and data flow
    └── HOW-IT-WORKS.md     # Technical deep-dive
```

---

## Scripts

| Command | Description |
|---|---|
| `npm run start` | Run frontend + API backend concurrently (dev mode) |
| `npm run dev` | Frontend only (Vite HMR) |
| `npm run api` | Backend API only (Node.js on port 3001) |
| `npm run tauri:build` | Build production `.exe` + `.msi` installer |
| `npm run tauri:dev` | Tauri dev window (live-reload) |

---

## API Endpoints

The Node.js backend exposes three endpoints on `http://localhost:3001`:

| Endpoint | Description |
|---|---|
| `GET /api/pci` | All PCIe devices from Windows PnP (GPUs, NVMe, bridges) |
| `GET /api/gpuz` | GPU PCIe data from GPU-Z shared memory (bifurcation-aware) |
| `GET /api/system` | Motherboard make/model, CPU name, NVMe friendly names |

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

---

## License

MIT — see [LICENSE](LICENSE).

---

## Acknowledgements

- [GPU-Z by TechPowerUp](https://www.techpowerup.com/gpuz/) — the shared memory API that makes accurate bifurcation detection possible
- [Tauri](https://tauri.app/) — for making Rust-powered native Windows apps painless
- The countless builders who discovered their GPU was running at x8 *after* the build
