
# =====================================================================
# nvidia-smi PCIe Data Reader
# Queries NVIDIA's official CLI tool for GPU PCIe link width/speed.
# This gives bifurcation-aware data for NVIDIA users without GPU-Z.
# Falls back gracefully if nvidia-smi is not installed.
# =====================================================================

function Find-NvidiaSmi {
    # Check PATH first
    $fromPath = Get-Command "nvidia-smi.exe" -ErrorAction SilentlyContinue
    if ($fromPath) { return $fromPath.Source }

    # Common install locations
    $candidates = @(
        "$env:SystemRoot\System32\nvidia-smi.exe",
        "$env:ProgramFiles\NVIDIA Corporation\NVSMI\nvidia-smi.exe",
        "$env:ProgramW6432\NVIDIA Corporation\NVSMI\nvidia-smi.exe"
    )
    foreach ($c in $candidates) {
        if (Test-Path $c) { return $c }
    }
    return $null
}

$nvSmi = Find-NvidiaSmi

if (-not $nvSmi) {
    @{
        NvidiaSmiAvailable = $false
        Message = "nvidia-smi not found. NVIDIA GPU data requires the NVIDIA driver to be installed."
    } | ConvertTo-Json
    exit
}

# Query all relevant PCIe fields in one pass
$fields = "gpu_name,pcie.link.gen.current,pcie.link.gen.max,pcie.link.width.current,pcie.link.width.max"
$raw = & $nvSmi --query-gpu=$fields --format=csv,noheader,nounits 2>&1

if ($LASTEXITCODE -ne 0 -or -not $raw) {
    @{
        NvidiaSmiAvailable = $false
        Message = "nvidia-smi failed to return data. Error: $raw"
    } | ConvertTo-Json
    exit
}

$gpus = foreach ($line in ($raw -split "`n" | Where-Object { $_.Trim() })) {
    $parts = $line -split "," | ForEach-Object { $_.Trim() }
    if ($parts.Count -lt 5) { continue }

    $cardName    = $parts[0]
    $currentGen  = [int]$parts[1]
    $maxGen      = [int]$parts[2]
    $currentWidth = [int]$parts[3]
    $maxWidth    = [int]$parts[4]

    [PSCustomObject]@{
        NvidiaSmiAvailable = $true
        CardName           = $cardName
        CurrentWidth       = $currentWidth
        MaxWidth           = $maxWidth
        CurrentSpeed       = $currentGen
        MaxSpeed           = $maxGen
        RawBusInterface    = "PCIe x$maxWidth $maxGen.0 @ x$currentWidth $currentGen.0"
        IsThrottled        = ($currentWidth -lt $maxWidth)
    }
}

if (-not $gpus) {
    @{
        NvidiaSmiAvailable = $false
        Message = "nvidia-smi ran but returned no GPU data."
    } | ConvertTo-Json
} else {
    $gpus | ConvertTo-Json -Depth 2
}
