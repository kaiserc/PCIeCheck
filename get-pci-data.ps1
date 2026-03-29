
# =====================================================================
# PCIe Lane Sentinel - Enhanced PCI Data Fetcher
# Strategy: Walk the device tree. For GPUs and NVMe drives, find the
# PARENT bridge/root port and read ITS CurrentLinkWidth. The bridge
# is the "slot" — it shows what the motherboard actually gave the device.
# This is how we catch bifurcation (e.g. x16 slot split to x8/x8).
# =====================================================================

function Get-PciProperty($instanceId, $key) {
    $val = Get-PnpDeviceProperty -InstanceId $instanceId -KeyName $key -ErrorAction SilentlyContinue
    if ($val -and $val.Data) { return $val.Data }
    return $null
}

function Get-ParentDevice($instanceId) {
    $parent = Get-PnpDeviceProperty -InstanceId $instanceId -KeyName "DEVPKEY_Device_Parent" -ErrorAction SilentlyContinue
    if ($parent) { return $parent.Data }
    return $null
}

# Classify whether a PCIe device is connected via CPU lanes or chipset lanes.
# Strategy: walk up the parent chain to find the root port and match its Device ID.
# CPU PCIe root ports have well-known Vendor:Device IDs distinct from chipset PCIe.
function Get-LaneSource($instanceId, [ref]$slotMaxSpeedHint) {
    $current = $instanceId
    for ($i = 0; $i -lt 6; $i++) {
        $parent = (Get-PnpDeviceProperty -InstanceId $current -KeyName "DEVPKEY_Device_Parent" -ErrorAction SilentlyContinue).Data
        if (-not $parent -or $parent -notlike "PCI*") { break }

        # ── AMD CPU PCIe Root Ports (direct from Ryzen die) ────────────────────
        # Ryzen 5000 (Vermeer/Cezanne): 1022:1483, 1484
        # Ryzen 7000 (Raphael):         1022:14A0–14B9 range
        # Ryzen 9000 (Granite Ridge):   1022:150x, 15AB range
        if ($parent -match "VEN_1022&DEV_1483|VEN_1022&DEV_1484")            { return "CPU" }
        if ($parent -match "VEN_1022&DEV_14[A-F][0-9A-F]")                   { return "CPU" }
        if ($parent -match "VEN_1022&DEV_15[0-9A-F][0-9A-F]")                { return "CPU" }

        # ── AMD Chipset / FCH PCIe Ports ────────────────────────────────────────
        # X570 chipset: 1022:43CA–43CB; B550: 1022:43C6; X670/X870: 1022:57AD, 57A4
        if ($parent -match "VEN_1022&DEV_43[C-F][0-9A-F]")                   { return "Chipset" }
        if ($parent -match "VEN_1022&DEV_57[0-9A-F][0-9A-F]")                { return "Chipset" }

        # ── Intel CPU PCIe Root Ports (Alder/Raptor/Meteor Lake) ───────────────
        # 12th/13th gen: 8086:460C, 460D, 4620, 4621 etc.
        # 14th gen: 8086:A74C, 7D00 etc.
        if ($parent -match "VEN_8086&DEV_46[0-9A-F][0-9A-F]")                { return "CPU" }
        if ($parent -match "VEN_8086&DEV_[7A][0-9A-F][0-9A-F][0-9A-F]" -and
            $parent -notmatch "VEN_8086&DEV_7A3[0-9A-F]")                    { return "CPU" }

        # ── Intel PCH (Z790/Z690/H770 chipset ports) ───────────────────────────
        if ($parent -match "VEN_8086&DEV_7A3[0-9A-F]")                       { return "Chipset" }
        if ($parent -match "VEN_8086&DEV_[AB][0-9A-F]{3}")                   { return "Chipset" }

        $current = $parent
    }

    # Fallback heuristic: Gen 5 slots can only be CPU on current platforms
    $hint = $slotMaxSpeedHint.Value
    if ($hint -ge 5) { return "CPU" }
    if ($hint -le 3) { return "Chipset" }   # Gen 3 or less is always chipset on modern boards
    return "Unknown"
}

# Build a device info lookup by InstanceId for fast parent resolution
$allDevices = Get-PnpDevice -PresentOnly -ErrorAction SilentlyContinue
$deviceMap = @{}
foreach ($d in $allDevices) { $deviceMap[$d.InstanceId] = $d }

# Filter to PCI devices with a CurrentLinkWidth
$pciDevices = $allDevices | Where-Object { $_.InstanceId -like "PCI*" }

$results = foreach ($dev in $pciDevices) {
    $currentWidth = Get-PciProperty $dev.InstanceId "DEVPKEY_PciDevice_CurrentLinkWidth"
    if ($null -eq $currentWidth -or $currentWidth -eq 0) { continue }

    $maxWidth    = Get-PciProperty $dev.InstanceId "DEVPKEY_PciDevice_MaxLinkWidth"
    $currentSpeed = Get-PciProperty $dev.InstanceId "DEVPKEY_PciDevice_CurrentLinkSpeed"
    $maxSpeed    = Get-PciProperty $dev.InstanceId "DEVPKEY_PciDevice_MaxLinkSpeed"

    # Determine category
    $category = "Other"
    if ($dev.Class -eq "Display") { $category = "GPU" }
    elseif ($dev.Class -eq "SCSIAdapter" -or $dev.FriendlyName -like "*NVMe*" -or $dev.FriendlyName -like "*NVM*") {
        $category = "NVMe"
    }

    # Slot-level check: find the parent PCI bridge for this device.
    # The bridge negotiates the actual PCIe link to the slot.
    # If the bridge's CurrentWidth < device's MaxWidth, that's the real bottleneck.
    $slotWidth    = $currentWidth
    $slotMaxWidth = $maxWidth
    $slotSpeed    = $currentSpeed
    $slotMaxSpeed = $maxSpeed
    $parentId     = Get-ParentDevice $dev.InstanceId

    if ($parentId -and $deviceMap.ContainsKey($parentId)) {
        $parentDev = $deviceMap[$parentId]
        if ($parentDev.InstanceId -like "PCI*") {
            $pWidth  = Get-PciProperty $parentDev.InstanceId "DEVPKEY_PciDevice_CurrentLinkWidth"
            $pmWidth = Get-PciProperty $parentDev.InstanceId "DEVPKEY_PciDevice_MaxLinkWidth"
            $pSpeed  = Get-PciProperty $parentDev.InstanceId "DEVPKEY_PciDevice_CurrentLinkSpeed"
            $pmSpeed = Get-PciProperty $parentDev.InstanceId "DEVPKEY_PciDevice_MaxLinkSpeed"

            if ($pWidth -and $pWidth -gt 0) {
                $slotWidth    = $pWidth
                $slotMaxWidth = if ($pmWidth) { $pmWidth } else { $maxWidth }
                $slotSpeed    = if ($pSpeed)  { $pSpeed  } else { $currentSpeed }
                $slotMaxSpeed = if ($pmSpeed) { $pmSpeed } else { $maxSpeed }
            }
        }
    }

    $widthThrottled = ($slotWidth -lt $slotMaxWidth)
    $speedThrottled = ($slotSpeed -lt $slotMaxSpeed)
    $laneSource     = Get-LaneSource $dev.InstanceId ([ref]$slotMaxSpeed)

    [PSCustomObject]@{
        Name             = $dev.FriendlyName
        Category         = $category
        Class            = $dev.Class
        Status           = $dev.Status.ToString()
        InstanceId       = $dev.InstanceId
        # Device self-reported
        DeviceWidth      = $currentWidth
        DeviceMaxWidth   = $maxWidth
        DeviceSpeed      = $currentSpeed
        DeviceMaxSpeed   = $maxSpeed
        # Slot/bridge-level (actual physical link)
        SlotWidth        = $slotWidth
        SlotMaxWidth     = $slotMaxWidth
        SlotSpeed        = $slotSpeed
        SlotMaxSpeed     = $slotMaxSpeed
        # Throttle flags
        WidthThrottled   = $widthThrottled
        SpeedThrottled   = $speedThrottled
        IsThrottled      = ($widthThrottled -or $speedThrottled)
        ParentId         = $parentId
        # Lane source: CPU (direct die PCIe) or Chipset (via DMI/A-Link)
        LaneSource       = $laneSource
    }
}

$results | ConvertTo-Json -Depth 3
