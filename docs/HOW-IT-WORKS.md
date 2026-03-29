# How It Works — Technical Deep Dive

## The Core Problem

When you build a PC and seat a GPU in the primary x16 slot, you expect it to run at x16. But many motherboards — especially AMD X670E/B650 and Intel Z790 — share CPU PCIe lanes between the primary GPU slot and adjacent M.2 sockets.

If you populate M.2_2 (or whichever slot your manual flags as "shares bandwidth with PCIEX16_1"), the motherboard's PCIe switch **automatically bifurcates** the x16 connection into two x8 connections. One goes to the GPU, one goes to the NVMe drive.

Your GPU runs at x8. Windows says nothing. GPU-Z shows it. Most people never check.

---

## Why Windows Can't See It

When Windows queries PCIe link width, it asks the **PCIe Root Port** (the bridge chip between the CPU and the slot). The Root Port reports:

- **MaxLinkWidth**: what the physical slot *is wired for* (x16 traces on the PCB)
- **CurrentLinkWidth**: what the Root Port *currently negotiated*

Here's the trap: after bifurcation, the Root Port may still report `CurrentLinkWidth = 16` because from the Root Port's perspective, it has a x16 connection — to the bifurcation switch. The switch then splits that into two x8 links downstream. The downstream links are where the x8 negotiation happens, and Windows PnP doesn't walk that far down the tree by default.

**Result**: `Get-PnpDeviceProperty` says x16. GPU-Z says x8. GPU-Z is correct.

---

## GPU-Z Shared Memory — The Real Source

GPU-Z bypasses the Windows driver stack entirely. It uses direct PCI Configuration Space access (via a kernel-mode driver it installs) to read the **Link Status Register** from the PCIe Capability Structure of each GPU:

```
PCI Config Space Offset: Capability base + 0x12
Bits [9:4]: Negotiated Link Width
```

This register is set by the PCIe hardware handshake during enumeration and cannot be spoofed by firmware or Windows. If the hardware negotiated x8, this register says x8.

GPU-Z writes this into a named shared memory block (`Local\GPUZShMem`) that any process can read — no elevated privileges needed.

### Reading the Shared Memory

The `get-gpuz-data.ps1` script compiles a small C# class at runtime using `Add-Type` to access .NET's `MemoryMappedFile`:

```csharp
using (var mmf = MemoryMappedFile.OpenExisting("Local\\GPUZShMem"))
using (var stream = mmf.CreateViewStream(0, 0, MemoryMappedFileAccess.Read))
{
    // Read entire segment as bytes, convert to Unicode string, scan with regex
    var rx = new Regex(@"PCI-?E\s+x(\d+)\s+([\d.]+)\s*@\s*x(\d+)\s+([\d.]+)");
    // Matches: "PCIe x16 5.0 @ x8 5.0"
    //           ↑ slot   ↑gen  ↑ actual ↑gen
}
```

The regex scan is the reliable path. The struct-based field reading (by fixed byte offsets from the GPU-Z SDK spec) is used as a supplement but can have offset mismatches between GPU-Z versions.

---

## Matching GPU-Z Data to the Right GPU Card

A system with an iGPU and discrete GPU will have two GPUs in the PnP device list. GPU-Z's shared memory may only have data for the discrete GPU. We can't match by card name (the name in SHM may be malformed due to struct offset differences between GPU-Z versions).

**Solution: match by PCIe generation speed.**

GPU-Z reports `CurrentSpeed: 5` (PCIe Gen 5) for the RX 9070. The PnP API also reports `DeviceSpeed: 5` for the same card and `DeviceSpeed: 4` for the iGPU. This is a unique discriminator:

```typescript
const gpuzBySpeed = new Map<number, GpuZResult>();
gpuzGpus.forEach(g => { if (g.CurrentSpeed) gpuzBySpeed.set(g.CurrentSpeed, g); });

// For each PnP GPU:
const gpuZ = gpuzBySpeed.get(d.DeviceSpeed) ?? gpuzBySpeed.get(d.SlotSpeed);
```

This correctly overlays bifurcation data onto the RX 9070 while leaving the iGPU card sourced from PnP.

---

## NVMe Drive Name Resolution

At the PCIe level, all NVMe drives appear as `Standard NVM Express Controller`. The actual drive model (e.g., "Netac NVMe SSD 4TB") lives in the storage stack, accessible via the Storage Cmdlets:

```powershell
Get-PhysicalDisk | Where-Object { $_.BusType -eq 'NVMe' } | Sort-Object DeviceId
```

These are matched positionally to the PnP NVMe controller list — the first physical NVMe disk corresponds to the first NVMe PCI controller in enumeration order.

---

## GPU Idle State Warning

Modern GPUs drop to PCIe x1 or x4 when idle to save power (AMD's ULPS, NVIDIA's Gen switching). If you scan while the GPU is idle, you'll see x4 and think there's a bifurcation problem when there isn't.

The recommended flow:
1. Launch a GPU-intensive game or stress test (FurMark, 3DMark)
2. Alt-Tab back
3. Click Refresh in the dashboard

The GPU will be at full load and the PCIe link will be at its full negotiated width.

---

## The Bifurcation Fix

If your GPU is confirmed at x8 in an x16 slot:

1. Open your motherboard manual and search for "M.2 bandwidth sharing" or "PCIe lane allocation"
2. Find which M.2 slot is sharing lanes with your primary GPU slot
3. Move that NVMe drive to a different M.2 slot (usually one served by chipset lanes, not CPU lanes)
4. Reboot and re-scan — the GPU should now show x16

> **Note:** Chipset-connected M.2 slots max out at PCIe Gen 3 or Gen 4 depending on the platform. A PCIe Gen 5 NVMe drive in a chipset slot will be speed-limited, but your GPU will recover its full x16 bandwidth. For most games and workloads, a GPU at x16 vs x8 matters more than the NVMe speed difference.
