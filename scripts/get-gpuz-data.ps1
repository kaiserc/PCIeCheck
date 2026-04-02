
# =====================================================================
# GPU-Z Shared Memory Reader
# GPU-Z exposes a shared memory API (Local\GPUZShMem) that contains
# the ACTUAL PCIe link width as read from PCI config space registers.
# This catches bifurcation (e.g., x16 slot split to x8/x8) that the
# Windows PnP API cannot see.
# =====================================================================

Add-Type @"
using System;
using System.Collections.Generic;
using System.IO.MemoryMappedFiles;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;

public class GpuZShmReader
{
    private const string SHM_NAME = "Local\\GPUZShMem";
    // GPU-Z SHM header is 24 bytes, each GPUZ_RECORD field is WCHAR[256] = 512 bytes
    private const int HEADER_SIZE     = 24;
    private const int FIELD_SIZE      = 512; // sizeof(WCHAR) * 256
    private const int RECORD_SIZE     = 57344; // From GPU-Z SDK: total per-GPU record

    // Fields within GPUZ_RECORD (each 512 bytes / 256 WCHARs)
    //  0: CardName, 1: CardId, 2: GPUClock, 3: DefaultGPUClock, 4: MemClock
    //  5: DefaultMemClock, 6: GPUTemp, 7: EnvMonStatus, 8: BiosVersion
    //  9: BusType, 10: BusWidth (slot), 11: MemType, 12: MemVendor
    // (layout may vary; we also do a string scan as fallback)
    private const int FIELD_BUS_TYPE  = 9;
    private const int FIELD_BUS_WIDTH = 10; // Slot width e.g. "x16"

    public class GpuInfo
    {
        public bool   GpuZRunning;
        public string CardName;
        public string BusType;
        public string SlotWidth;      // From GPU-Z static field
        public int    CurrentWidth;   // Parsed from regex scan "@ x8"
        public int    MaxWidth;       // Parsed from regex scan "x16"
        public double CurrentSpeed;   // PCIe Gen (5.0 = Gen5)
        public string RawBusInterface; // Full string e.g. "PCIe x16 5.0 @ x8 5.0"
    }

    public static GpuInfo[] ReadGpus()
    {
        var results = new List<GpuInfo>();

        try
        {
            using (var mmf = MemoryMappedFile.OpenExisting(SHM_NAME))
            using (var stream = mmf.CreateViewStream(0, 0, MemoryMappedFileAccess.Read))
            {
                long totalSize = stream.Length > 0 ? stream.Length : 8 * 1024 * 1024;
                byte[] data = new byte[totalSize];
                stream.Read(data, 0, data.Length);

                // ── Structural extraction: read known field offsets ───────────────
                // Jump past 24-byte header to first record
                int maxGpus = 4;
                for (int i = 0; i < maxGpus; i++)
                {
                    int recordBase = HEADER_SIZE + i * RECORD_SIZE;
                    if (recordBase + FIELD_SIZE >= data.Length) break;

                    string cardName = ReadWChar(data, recordBase + 0 * FIELD_SIZE);
                    if (string.IsNullOrWhiteSpace(cardName)) break; // No more GPUs

                    string busType  = ReadWChar(data, recordBase + FIELD_BUS_TYPE  * FIELD_SIZE);
                    string slotWidth= ReadWChar(data, recordBase + FIELD_BUS_WIDTH * FIELD_SIZE);

                    var info = new GpuInfo {
                        GpuZRunning = true,
                        CardName    = cardName,
                        BusType     = busType,
                        SlotWidth   = slotWidth
                    };
                    results.Add(info);
                }

                // ── String-scan fallback: look for "PCIe x16 5.0 @ x8 5.0" pattern ─
                string content = Encoding.Unicode.GetString(data);
                var rx = new Regex(@"PCI-?E\s+x(\d+)\s+([\d.]+)\s*@\s*x(\d+)\s+([\d.]+)", RegexOptions.IgnoreCase);
                var matches = rx.Matches(content);
                foreach (Match m in matches)
                {
                    int slotW   = int.Parse(m.Groups[1].Value);
                    double slotSpd = double.Parse(m.Groups[2].Value, System.Globalization.CultureInfo.InvariantCulture);
                    int curW    = int.Parse(m.Groups[3].Value);
                    double curSpd  = double.Parse(m.Groups[4].Value, System.Globalization.CultureInfo.InvariantCulture);

                    // Match regex result to a structural record (same GPU, by index)
                    bool matched = false;
                    foreach (var gpu in results)
                    {
                        if (gpu.RawBusInterface == null)
                        {
                            gpu.RawBusInterface = m.Value.Trim();
                            gpu.MaxWidth        = slotW;
                            gpu.CurrentWidth    = curW;
                            gpu.CurrentSpeed    = curSpd;
                            matched = true;
                            break;
                        }
                    }
                    // If no structural record was found, create one from regex only
                    if (!matched)
                    {
                        results.Add(new GpuInfo {
                            GpuZRunning    = true,
                            CardName       = "GPU " + (results.Count + 1),
                            BusType        = "PCI-E",
                            RawBusInterface= m.Value.Trim(),
                            MaxWidth       = slotW,
                            CurrentWidth   = curW,
                            CurrentSpeed   = curSpd
                        });
                    }
                }
            }
        }
        catch (Exception ex)
        {
            // GPU-Z is not running (FileNotFoundException) or another error — return empty list
            if (!(ex is System.IO.FileNotFoundException) && !ex.Message.Contains("not find") && !ex.Message.Contains("exist"))
            {
                // Rethrow unexpected errors as a marker in the results list
                results.Add(new GpuInfo { GpuZRunning = false, CardName = "ERROR: " + ex.Message });
            }
        }

        return results.ToArray();
    }

    private static string ReadWChar(byte[] data, int offset)
    {
        if (offset < 0 || offset + 2 > data.Length) return "";
        int end = offset;
        while (end + 1 < data.Length && (data[end] != 0 || data[end + 1] != 0))
            end += 2;
        return Encoding.Unicode.GetString(data, offset, end - offset).Trim();
    }
}
"@

$gpus = [GpuZShmReader]::ReadGpus()

# Only emit records that have a valid bus interface string from the regex scan
$valid = $gpus | Where-Object { $_.GpuZRunning -and $_.RawBusInterface -ne $null -and $_.CurrentWidth -gt 0 }

if ($valid.Count -eq 0) {
    @{ GpuZRunning = $false; Message = "GPU-Z is not running or no PCIe data found. Open GPU-Z for accurate bifurcation detection." } | ConvertTo-Json
} else {
    $output = foreach ($g in $valid) {
        [PSCustomObject]@{
            GpuZRunning      = $true
            # CardName comes from GPU-Z SHM struct (may be wrong if offsets mismatch);
            # the frontend will match by index order to PnP GPU list.
            CardName         = if ($g.CardName -and $g.CardName.Length -gt 3 -and $g.CardName -notmatch "\\\\|:") { $g.CardName } else { "GPU (GPU-Z)" }
            CurrentWidth     = $g.CurrentWidth
            MaxWidth         = $g.MaxWidth
            CurrentSpeed     = [int]$g.CurrentSpeed   # 5.0 -> 5
            RawBusInterface  = $g.RawBusInterface
            IsThrottled      = ($g.CurrentWidth -lt $g.MaxWidth)
        }
    }
    $output | ConvertTo-Json -Depth 2
}
