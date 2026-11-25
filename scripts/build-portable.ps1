# Builds a smartdock installer that can be copied to any Windows 10/11 PC, and checks that
# nothing from this machine (user name, home folder, project path) is baked into it.
#   powershell -ExecutionPolicy Bypass -File scripts\build-portable.ps1
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

# Rust writes absolute source paths (panic locations) into the binary; map them to neutral ones.
$cargoHome = if ($env:CARGO_HOME) { $env:CARGO_HOME } else { Join-Path $env:USERPROFILE '.cargo' }
$env:RUSTFLAGS = "--remap-path-prefix=$cargoHome=/cargo --remap-path-prefix=$env:USERPROFILE=/home --remap-path-prefix=$root=/src"

npx tauri build
if ($LASTEXITCODE -ne 0) { throw 'tauri build failed' }

$exe = Join-Path $root 'src-tauri\target\release\smartdock.exe'
$setup = Get-ChildItem (Join-Path $root 'src-tauri\target\release\bundle\nsis') -Filter '*-setup.exe' |
  Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $setup) { throw 'installer not found' }

# privacy check: the binary must not mention this user or this machine
# (short names such as "PC" would match unrelated bytes, so only names of 4+ characters are searched)
$needles = @($env:USERNAME, (Split-Path -Leaf $env:USERPROFILE), $env:USERPROFILE, $env:COMPUTERNAME, $root) |
  Where-Object { $_ -and $_.Length -ge 4 } | Select-Object -Unique
$bytes = [IO.File]::ReadAllBytes($exe)
$ascii = [Text.Encoding]::ASCII.GetString($bytes)
$utf16 = [Text.Encoding]::Unicode.GetString($bytes)
$hits = foreach ($n in $needles) {
  if ($ascii.IndexOf($n, [StringComparison]::OrdinalIgnoreCase) -ge 0 -or $utf16.IndexOf($n, [StringComparison]::OrdinalIgnoreCase) -ge 0) { $n }
}
if ($hits) { throw "Personal information found in the binary: $($hits -join ', ')" }

$out = Join-Path $root 'dist'
New-Item -ItemType Directory -Force $out | Out-Null
Copy-Item $setup.FullName $out -Force
Write-Host "Clean. Installer: $(Join-Path $out $setup.Name)"
Write-Host 'Settings are created in each user''s own AppData folder; this installer contains none of yours.'
