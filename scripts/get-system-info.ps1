
# =====================================================================
# System Info Fetcher
# Returns:
#   - Motherboard make/model + search URLs
#   - CPU name
#   - List of NVMe physical drives with friendly names + sizes
# =====================================================================

# ── Motherboard ──────────────────────────────────────────────────────
$mb  = Get-WmiObject Win32_BaseBoard -ErrorAction SilentlyContinue
$cpu = Get-WmiObject Win32_Processor -ErrorAction SilentlyContinue | Select-Object -First 1

$mbMake    = if ($mb) { $mb.Manufacturer.Trim() } else { "Unknown" }
$mbModel   = if ($mb) { $mb.Product.Trim() }       else { "Unknown" }
$cpuName   = if ($cpu) { $cpu.Name.Trim() }         else { "Unknown" }

# Build search URLs
$query         = [Uri]::EscapeDataString("$mbMake $mbModel PCIe M.2 slots manual")
$googleUrl     = "https://www.google.com/search?q=$query"
$manualQuery   = [Uri]::EscapeDataString("$mbMake $mbModel manual filetype:pdf")
$manualPdfUrl  = "https://www.google.com/search?q=$manualQuery"

# Try to make a direct manufacturer support URL
$mfgUrl = switch -Wildcard ($mbMake) {
    "*ASUS*"         { "https://www.asus.com/support/download-center/" }
    "*ASRock*"       { "https://www.asrock.com/support/index.asp"      }
    "*Micro-Star*"   { "https://www.msi.com/support"                   }
    "*MSI*"          { "https://www.msi.com/support"                   }
    "*Gigabyte*"     { "https://www.gigabyte.com/Support"               }
    default          { $googleUrl }
}

# ── NVMe Physical Drives ─────────────────────────────────────────────
$nvmeDrives = Get-PhysicalDisk -ErrorAction SilentlyContinue |
    Where-Object { $_.BusType -eq 'NVMe' } |
    Sort-Object DeviceId |
    ForEach-Object {
        [PSCustomObject]@{
            FriendlyName = $_.FriendlyName
            SizeGB       = [math]::Round($_.Size / 1GB, 0)
            MediaType    = $_.MediaType
        }
    }

# ── Output ───────────────────────────────────────────────────────────
[PSCustomObject]@{
    Motherboard = [PSCustomObject]@{
        Make        = $mbMake
        Model       = $mbModel
        SearchUrl   = $googleUrl
        ManualUrl   = $manualPdfUrl
        MfgUrl      = $mfgUrl
    }
    CPU         = $cpuName
    NvmeDrives  = @($nvmeDrives)
} | ConvertTo-Json -Depth 3
