# Architecture

## Overview

PCIe Lane Sentinel uses a three-layer architecture to work around a fundamental limitation of Windows: **the OS cannot reliably report actual PCIe link negotiation results**, especially when bifurcation is involved.

```
┌─────────────────────────────────────────┐
│           React Frontend (Vite)         │
│   Data fusion · Cards · Alerts · UI     │
│         http://localhost:5173           │
└──────────────────┬──────────────────────┘
                   │ fetch()
┌──────────────────▼──────────────────────┐
│         Node.js Express API             │
│            server.js :3001              │
│  /api/pci   /api/gpuz   /api/system     │
└──────┬───────────┬──────────┬───────────┘
       │           │          │
       ▼           ▼          ▼
  get-pci-     get-gpuz-   get-system-
  data.ps1     data.ps1    info.ps1
       │           │          │
  Windows PnP  GPU-Z SHM    WMI
  Bridge API   (C# inline)  Queries
```

---

## Data Sources

### 1. Windows PnP Bridge API (`get-pci-data.ps1`)

Uses `Get-PnpDeviceProperty` with PCIe link width/speed device property keys:

```
DEVPKEY_PciDevice_MaxLinkWidth      → Slot capability (what the slot *can* do)
DEVPKEY_PciDevice_CurrentLinkWidth  → Negotiated width (what it's *actually* doing)
DEVPKEY_PciDevice_MaxLinkSpeed      → Max gen
DEVPKEY_PciDevice_CurrentLinkSpeed  → Current gen
```

**Limitation:** These properties are read from the **PCIe bridge/root port**, not the device itself. When a slot is bifurcated (e.g. x16 → x8+x8), the bridge may still report x16 as its capability. This is why the PnP path shows `source: 'Windows PnP'` in the UI and cannot reliably detect bifurcation.

### 2. GPU-Z Shared Memory (`get-gpuz-data.ps1`)

GPU-Z reads PCIe status directly from **PCI Configuration Space registers** (offset 0x12 in the Link Status register of the PCIe Capability structure). It writes this data into a named shared memory segment:

```
Segment name: Local\GPUZShMem
```

The PowerShell script opens this segment using .NET's `MemoryMappedFile` class (inline C# compiled at runtime) and scans for the characteristic string pattern:

```
PCIe x16 5.0 @ x8 5.0
 ↑ slot max   ↑ actual current
```

This string is **hardware truth** — it cannot be masked by Windows or firmware. If a GPU is in an x16 slot but the CPU's lane controller has split it to x8, this string will say `@ x8`.

**Limitation:** Requires GPU-Z to be running. GPU-Z must open the shared memory segment first.

### 3. WMI Queries (`get-system-info.ps1`)

`Get-PhysicalDisk` (Storage Cmdlets) returns actual device model names for NVMe drives. This avoids the generic `Standard NVM Express Controller` label that Windows assigns to all NVMe controllers at the PCI level.

`Win32_BaseBoard` and `Win32_Processor` give motherboard and CPU information used to generate focused Google search links.

---

## Data Fusion (Frontend)

The frontend merges the three data sources with a clear priority model:

```typescript
// 1. PnP is always the ground truth for device names and topology
// 2. GPU-Z data is overlaid onto the MATCHING PnP GPU by PCIe generation speed
//    (e.g., GPU-Z Gen 5 entry → matches the only Gen 5 GPU in PnP)
// 3. NVMe names are mapped positionally from WMI to PCI controller list
```

**Why match by PCIe generation speed?**

When a system has an iGPU (Gen 4) and a discrete GPU (Gen 5), GPU-Z only reports the discrete GPU. If we matched by array index, the iGPU (index 0) would incorrectly receive the discrete GPU's bifurcation data. Matching by PCIe Gen uniquely identifies the correct card.

---

## Tauri Shell Integration

External URLs (motherboard manual links) require special handling inside Tauri's sandboxed WebView. Standard `<a target="_blank">` links are blocked. The app uses:

```typescript
import { open } from '@tauri-apps/plugin-shell';
await open(url); // Opens in Windows default browser
```

With `shell:allow-open` granted in `src-tauri/capabilities/default.json`.

In browser/dev mode, the dynamic import fails gracefully and falls back to `window.open()`.

---

## Roadmap

### Self-contained `.exe` (no Node.js dependency)

Currently the Tauri `.exe` still requires the Node.js backend (`npm run api`) running separately. The intended next step is to replace the PowerShell→Node.js bridge with **Tauri Commands** — Rust functions that the frontend can call directly via IPC:

```rust
#[tauri::command]
fn get_pci_data() -> Result<Vec<PciDevice>, String> {
    // Run PowerShell, parse result, return typed struct
}
```

This would make the `.exe` fully self-contained without any Node.js installation.

### NVIDIA support via nvidia-smi

For NVIDIA GPU owners without GPU-Z, `nvidia-smi` can provide similar data:

```
nvidia-smi --query-gpu=pcie.link.gen.current,pcie.link.width.current --format=csv
```

### Historical logging

Save timestamped JSON snapshots to `%APPDATA%\PCIeLaneSentinel\history\` so users can compare "before" and "after" moving an NVMe drive.
