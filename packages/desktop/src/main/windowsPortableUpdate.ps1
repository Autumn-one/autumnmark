param([switch]$Apply)

$ErrorActionPreference = 'Stop'
if ((Split-Path -Leaf $PSScriptRoot) -cnotmatch '^\.autumnmark-update-[A-Za-z0-9]+$') {
  throw 'Invalid portable update directory'
}
$root = Split-Path -Parent $PSScriptRoot
$config = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'update.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$staged = Join-Path $PSScriptRoot 'staged'
$backup = Join-Path $PSScriptRoot 'backup'
$exe = Join-Path $root $config.executable
$asar = Join-Path $root 'resources\app.asar'
$snapshot = Join-Path $PSScriptRoot 'app-snapshot.txt'

function Get-AppSnapshot {
  $archive = Get-Item -LiteralPath $asar
  return "$($archive.Length):$($archive.LastWriteTimeUtc.Ticks)"
}

function Move-Entry($source, $destination, $name) {
  $from = Join-Path $source $name
  $to = Join-Path $destination $name
  if ([IO.Directory]::Exists($from)) {
    [IO.Directory]::Move($from, $to)
  } else {
    [IO.File]::Move($from, $to)
  }
}

function Start-AutumnMark {
  $startInfo = New-Object Diagnostics.ProcessStartInfo
  $startInfo.FileName = $exe
  $startInfo.WorkingDirectory = $root
  $startInfo.Arguments = $config.restartArgs
  $startInfo.UseShellExecute = $false
  [Diagnostics.Process]::Start($startInfo).Dispose()
}

if (!$Apply) {
  Set-Content -LiteralPath $snapshot -Value (Get-AppSnapshot)
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  [IO.Compression.ZipFile]::ExtractToDirectory($config.archive, $staged)
  if (!(Test-Path -LiteralPath (Join-Path $staged 'autumnmark.exe') -PathType Leaf) -or
      !(Test-Path -LiteralPath (Join-Path $staged 'resources\app.asar') -PathType Leaf) -or
      (Test-Path -LiteralPath (Join-Path $staged 'resources\nsis-installed'))) {
    throw 'The archive is not a portable AutumnMark package'
  }
  if ($config.executable -ine 'autumnmark.exe') {
    [IO.File]::Move((Join-Path $staged 'autumnmark.exe'), (Join-Path $staged $config.executable))
  }
  foreach ($entry in Get-ChildItem -LiteralPath $staged -Force) {
    $destination = Join-Path $root $entry.Name
    if ($config.userData.Equals($destination, [StringComparison]::OrdinalIgnoreCase) -or
        $config.userData.StartsWith("$destination\", [StringComparison]::OrdinalIgnoreCase)) {
      throw "The update would replace the user data directory: $destination"
    }
  }
  exit
}

$oldEntries = New-Object 'System.Collections.Generic.List[string]'
$newEntries = New-Object 'System.Collections.Generic.List[string]'
$lock = $null
$appExited = $false
$keepBackup = $false
try {
  $parent = Get-Process -Id $config.parentPid -ErrorAction SilentlyContinue
  if ($parent -and !$parent.WaitForExit(30000)) { throw 'AutumnMark did not exit' }

  $lockPath = Join-Path $root '.autumnmark-update.lock'
  $lock = [IO.File]::Open($lockPath, 'OpenOrCreate', 'Write', 'None')
  $otherCopy = Get-Process -Name ([IO.Path]::GetFileNameWithoutExtension($exe)) -ErrorAction SilentlyContinue |
    Where-Object { $_.Path -ieq $exe } | Select-Object -First 1
  if ($otherCopy) { throw 'AutumnMark is still running from this directory' }
  if (Test-Path -LiteralPath (Join-Path $root 'resources\nsis-installed')) {
    throw 'This directory now contains an installed copy of AutumnMark'
  }
  $appExited = $true
  if ((Get-Content -LiteralPath $snapshot) -ne (Get-AppSnapshot)) {
    throw 'AutumnMark changed while this update was being prepared'
  }
  $entries = @(Get-ChildItem -LiteralPath $staged -Force -Name | Where-Object { $_ -ine $config.executable })
  [void][IO.Directory]::CreateDirectory($backup)

  # Keep the launcher unavailable until all of the matching runtime files are in place.
  foreach ($name in (@($config.executable) + $entries)) {
    $existing = Get-Item -LiteralPath (Join-Path $root $name) -Force -ErrorAction SilentlyContinue
    if ($existing) {
      if ($existing.Attributes -band [IO.FileAttributes]::ReparsePoint) {
        throw "The application entry is a link: $($existing.FullName)"
      }
      Move-Entry $root $backup $name
      $oldEntries.Add($name)
    }
  }
  foreach ($name in ($entries + @($config.executable))) {
    Move-Entry $staged $root $name
    $newEntries.Add($name)
  }
  Start-AutumnMark
} catch {
  $message = "$($config.failureMessage)`n`n$($_.Exception.Message)"
  try {
    $newEntries.Reverse()
    foreach ($name in $newEntries) { Move-Entry $root $staged $name }
    $oldEntries.Reverse()
    foreach ($name in $oldEntries) { Move-Entry $backup $root $name }
  } catch {
    $keepBackup = $true
    $message += "`n`n$($_.Exception.Message)`n$backup"
  }
  if ($appExited -and !$keepBackup) {
    try { Start-AutumnMark } catch { $message += "`n`n$($_.Exception.Message)" }
  }
  Add-Type -AssemblyName System.Windows.Forms
  [void][Windows.Forms.MessageBox]::Show($message, $config.title, 'OK', 'Error')
  exit 1
} finally {
  if ($lock) {
    $lock.Dispose()
    Remove-Item -LiteralPath $lockPath -Force -ErrorAction SilentlyContinue
  }
  if (!$keepBackup) {
    # Directory.Delete removes junctions in the old package without visiting their targets.
    try { [IO.Directory]::Delete($PSScriptRoot, $true) } catch { Write-Warning $_.Exception.Message }
  }
}
