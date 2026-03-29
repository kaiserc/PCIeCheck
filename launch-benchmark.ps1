
# =====================================================================
# PCIe Lane Sentinel - Benchmark Launcher
# Checks for FurMark and HeavyLoad, launches the first one found.
# Returns JSON with launch status and which tool was started.
# =====================================================================

$furmarkPaths = @(
    "$env:ProgramFiles\FurMark_2\FurMark_GUI.exe",
    "$env:ProgramFiles\Geeks3D\FurMark_1\FurMark.exe",
    "$env:ProgramFiles\FurMark\FurMark.exe",
    "$env:ProgramFiles\Geeks3D\Benchmarks\FurMark\FurMark.exe",
    "${env:ProgramFiles(x86)}\FurMark\FurMark.exe"
)

$heavyloadPaths = @(
    "$env:ProgramFiles\JAM Software\HeavyLoad\HeavyLoad.exe",
    "${env:ProgramFiles(x86)}\JAM Software\HeavyLoad\HeavyLoad.exe"
)

function Find-Tool($paths) {
    foreach ($p in $paths) {
        if (Test-Path $p) { return $p }
    }
    return $null
}

$furmark   = Find-Tool $furmarkPaths
$heavyload = Find-Tool $heavyloadPaths

# Check if either is already running
$furmarkRunning   = ($null -ne (Get-Process -Name "FurMark*" -ErrorAction SilentlyContinue))
$heavyloadRunning = ($null -ne (Get-Process -Name "HeavyLoad*" -ErrorAction SilentlyContinue))

if ($furmarkRunning) {
    @{ Launched = $false; AlreadyRunning = $true; Tool = "FurMark";
       Message = "FurMark is already running — GPU should be at full load." } | ConvertTo-Json
    exit
}

if ($heavyloadRunning) {
    @{ Launched = $false; AlreadyRunning = $true; Tool = "HeavyLoad";
       Message = "HeavyLoad is already running — GPU should be at full load." } | ConvertTo-Json
    exit
}

if ($furmark) {
    Start-Process -FilePath $furmark -ErrorAction SilentlyContinue
    @{ Launched = $true; Tool = "FurMark"; Path = $furmark;
       Message = "FurMark launched. Wait 10–15 seconds for the GPU to reach full load, then refresh." } | ConvertTo-Json
    exit
}

if ($heavyload) {
    Start-Process -FilePath $heavyload -ErrorAction SilentlyContinue
    @{ Launched = $true; Tool = "HeavyLoad"; Path = $heavyload;
       Message = "HeavyLoad launched. Wait 10–15 seconds for the GPU to reach full load, then refresh." } | ConvertTo-Json
    exit
}

# Nothing found — return download links
@{
    Launched      = $false
    AlreadyRunning = $false
    Tool          = $null
    Message       = "No benchmark tool found. Install FurMark or HeavyLoad to use this feature."
    DownloadUrls  = @{
        FurMark   = "https://geeks3d.com/furmark/"
        HeavyLoad = "https://www.jam-software.com/heavyload"
    }
} | ConvertTo-Json
