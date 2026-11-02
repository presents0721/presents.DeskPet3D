# Download ARDY-mini browser weights (fp32, ~684 MiB compressed) for the 3D desk pet.
# Called by the plugin (right-click menu -> "download generative motion resources").
#   powershell -NoProfile -ExecutionPolicy Bypass -File download-ardy-fp32.ps1 -Dst "<...>\Storage\ThreeDeskPet\Ardy"
# Notes:
#  * fp32 is required: the runtime asks for shader-f16 for fp16, which most GPUs/drivers here do not expose.
#  * Both sources are tried: huggingface.co first, hf-mirror.com as fallback (mainland networks often need it).
#  * curl.exe with resume + low-speed reconnect is used because the mirror stalls on big files.
#  * ASCII only on purpose: Windows PowerShell 5.1 reads BOM-less files as ANSI.

param(
    [string]$Dst = ""
)

$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'

if ([string]::IsNullOrWhiteSpace($Dst)) {
    $Dst = Join-Path $env:USERPROFILE 'Documents\Alife\Storage\ThreeDeskPet\Ardy'
}

$repo = 'intsuc/Llama-3-ARDY-Mini-Core40-Browser'
$rev  = '1c21362effeecec0454bfc0d818661525ae6b387'
$bases = @(
    ('https://huggingface.co/' + $repo + '/resolve/' + $rev),
    ('https://hf-mirror.com/' + $repo + '/resolve/' + $rev)
)

$list = @(
    'SHA256SUMS',
    'config.json',
    'README.md',
    'MODEL_TERMS.md',
    'NOTICE',
    'fp32/model.json.gz',
    'fp32/tokenizer/tokenizer.json.gz',
    'fp32/tokenizer/tokenizer_config.json.gz',
    'fp32/text_encoder.onnx.gz',
    'fp32/decoder.onnx.gz',
    'fp32/denoiser.onnx.gz'
)

Write-Host ('Target: ' + $Dst)
New-Item -ItemType Directory -Force -Path (Join-Path $Dst 'fp32\tokenizer') | Out-Null

$curl = (Get-Command curl.exe -ErrorAction SilentlyContinue)
if (-not $curl) { Write-Host 'curl.exe not found - falling back to Invoke-WebRequest (no resume).' }

foreach ($f in $list) {
    $out = Join-Path $Dst ($f -replace '/', '\')
    Write-Host ('=== GET ' + $f)
    $ok = $false

    if ($curl) {
        $u0 = $bases[0] + '/' + $f
        $head = & $curl.Source -sIL --fail --connect-timeout 30 $u0 2>$null
        $remoteLen = 0
        foreach ($line in $head) { if ($line -match '^content-length:\s*(\d+)') { $remoteLen = [int64]$Matches[1] } }
        if ($remoteLen -gt 0 -and (Test-Path $out) -and ((Get-Item $out).Length -eq $remoteLen)) {
            Write-Host ('  already complete (' + $remoteLen + ' bytes), skip')
            $ok = $true
        } elseif ($remoteLen -gt 0 -and (Test-Path $out) -and ((Get-Item $out).Length -gt $remoteLen)) {
            Write-Host '  local file larger than remote -> refetch'
            Remove-Item $out -Force -ErrorAction SilentlyContinue
        }
    }

    if (-not $ok -and $curl) {
        for ($try = 1; $try -le 80 -and -not $ok; $try++) {
            $u = $bases[($try - 1) % $bases.Count] + '/' + $f
            if ((Test-Path $out) -and ((Get-Item $out).Length -gt 0)) {
                Write-Host ('  try ' + $try + ' (resume, ' + (Get-Item $out).Length + ' bytes)')
                & $curl.Source -L --fail --retry 3 --retry-delay 2 --retry-all-errors -C - --connect-timeout 30 --speed-limit 2048 --speed-time 30 -o $out $u
            } else {
                Remove-Item $out -Force -ErrorAction SilentlyContinue
                Write-Host ('  try ' + $try)
                & $curl.Source -L --fail --retry 3 --retry-delay 2 --retry-all-errors --connect-timeout 30 --speed-limit 2048 --speed-time 30 -o $out $u
            }
            if ($LASTEXITCODE -eq 0 -or $LASTEXITCODE -eq 33) { $ok = $true } else { Start-Sleep -Seconds 5 }
        }
    }

    if (-not $ok) {
        try {
            Write-Host '  falling back to Invoke-WebRequest'
            Invoke-WebRequest -Uri ($bases[1] + '/' + $f) -OutFile $out -UseBasicParsing -TimeoutSec 3600
            $ok = $true
        } catch { Write-Host ('  IWR failed: ' + $_.Exception.Message) }
    }

    if ($ok) { Write-Host ('  OK ' + $f) } else { Write-Host ('  !! FAILED ' + $f) }
}

Write-Host ''
$m = Get-ChildItem $Dst -Recurse -File | Measure-Object -Property Length -Sum
Write-Host ('DONE. total = ' + [string][math]::Round(($m.Sum / 1MB), 1) + ' MB in ' + $m.Count + ' files')
Write-Host 'Close this window, then reopen the desk pet window to use generative motion.'
Write-Host 'License: composite terms (NVIDIA Open Model License + Meta Llama 3 + Apache-2.0/CC-BY-4.0).'
Write-Host 'Read MODEL_TERMS.md and NOTICE in the download folder before redistribution.'
