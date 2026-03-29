
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
    }
}

$results | ConvertTo-Json -Depth 3
