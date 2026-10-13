$ErrorActionPreference = 'Stop'

function Install-Okf {
    if (-not [Environment]::Is64BitProcess -or $env:PROCESSOR_ARCHITECTURE -ne 'AMD64') {
        throw 'irudd-okf requires x64 Windows and 64-bit PowerShell.'
    }
    if (-not (Get-Command git.exe -ErrorAction SilentlyContinue)) {
        throw 'Install Git for Windows, then run this installer again.'
    }
    $repository = 'https://github.com/alundgren/irudd-okf.git'
    $root = if ($env:OKF_INSTALL_ROOT) { $env:OKF_INSTALL_ROOT } else { Join-Path $env:LOCALAPPDATA 'irudd-okf' }
    $bin = if ($env:OKF_INSTALL_DIR) { $env:OKF_INSTALL_DIR } else { Join-Path $root 'bin' }
    foreach ($directory in @($root, $bin)) {
        if ($directory -notmatch '^(?:[A-Za-z]:[\\/]|\\\\)') { throw 'Installation directories must be absolute.' }
    }
    $root = [IO.Path]::GetFullPath($root)
    $bin = [IO.Path]::GetFullPath($bin)
    New-Item -ItemType Directory -Path $root -Force | Out-Null
    $lock = Join-Path $root '.install-lock'
    try { New-Item -ItemType Directory -Path $lock -ErrorAction Stop | Out-Null }
    catch { throw "Another installation may be running. If it has stopped, remove $lock and retry." }
    $source = Join-Path $root 'source'
    $oldLocation = Get-Location
    $savedEnvironment = @{}
    foreach ($name in @('VP_HOME', 'VP_VERSION', 'VP_NODE_MANAGER', 'CI', 'OKF_VP', 'OKF_SETUP_PATH', 'GIT_TERMINAL_PROMPT')) {
        $savedEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
    }
    function Invoke-Tool($command, $arguments) {
        & $command @arguments | Out-Host
        if ($LASTEXITCODE -ne 0) { throw "$command exited with $LASTEXITCODE." }
    }
    function Read-Git($arguments) {
        $result = & git.exe -C $source @arguments
        if ($LASTEXITCODE -ne 0) { throw "Git exited with $LASTEXITCODE." }
        return ($result -join "`n").Trim()
    }
    try {
        $env:GIT_TERMINAL_PROMPT = '0'
        if (-not (Test-Path -LiteralPath $source)) {
            Invoke-Tool git.exe @('clone', '--branch', 'main', '--single-branch', $repository, $source)
        }
        if ((Read-Git @('config', '--get', 'remote.origin.url')) -ne $repository) {
            throw 'The installation clone has a different Git remote. Move it aside and retry.'
        }
        if ((Read-Git @('branch', '--show-current')) -ne 'main' -or (Read-Git @('status', '--porcelain'))) {
            throw 'The installation clone must be clean and on main. Keep local work in another checkout.'
        }
        Invoke-Tool git.exe @('-C', $source, 'fetch', '--no-tags', 'origin', 'main:refs/remotes/origin/main')
        Invoke-Tool git.exe @('-C', $source, 'merge-base', '--is-ancestor', 'HEAD', 'origin/main')
        Invoke-Tool git.exe @('-C', $source, '-c', 'core.hooksPath=NUL', 'merge', '--ff-only', 'origin/main')

        $vp = $env:OKF_VP
        if (-not $vp) {
            $command = Get-Command vp.exe -ErrorAction SilentlyContinue
            if ($command) { $vp = $command.Source }
        }
        $vpRoot = if ($env:VP_HOME) { $env:VP_HOME } else { Join-Path $env:USERPROFILE '.vite-plus' }
        if (-not $vp) {
            foreach ($candidate in @((Join-Path $vpRoot 'bin\vp.exe'), (Join-Path $env:LOCALAPPDATA 'vite-plus\bin\vp.exe'))) {
                if (Test-Path -LiteralPath $candidate) { $vp = $candidate; break }
            }
        }
        if (-not $vp -or -not (Test-Path -LiteralPath $vp)) {
            $env:VP_HOME = $vpRoot
            $env:VP_VERSION = (Get-Content -LiteralPath (Join-Path $source 'package.json') -Raw | ConvertFrom-Json).devDependencies.'vite-plus'
            if (-not $env:VP_VERSION) { throw 'The source does not specify a Vite+ version.' }
            $env:VP_NODE_MANAGER = 'no'
            $env:CI = 'true'
            $vpInstaller = Join-Path $lock 'vite-plus.ps1'
            Invoke-WebRequest 'https://vite.plus/ps1' -UseBasicParsing -OutFile $vpInstaller
            & $vpInstaller
            $vp = Join-Path $vpRoot 'bin\vp.exe'
        }
        if (-not (Test-Path -LiteralPath $vp)) { throw 'Vite+ installation did not create an executable.' }
        $vp = (Resolve-Path -LiteralPath $vp).Path
        $env:PATH = "$(Split-Path -Parent $vp);$env:PATH"
        $env:OKF_VP = $vp
        $env:OKF_SETUP_PATH = '1'
        Set-Location -LiteralPath $source
        Invoke-Tool $vp @('install', '--frozen-lockfile')
        Invoke-Tool $vp @('run', '--no-cache', 'install:cli', $bin)
        $env:PATH = "$bin;$env:PATH"
        Write-Host 'Open a new terminal, then run irudd-okf context.'
    }
    finally {
        Set-Location $oldLocation
        foreach ($name in $savedEnvironment.Keys) {
            [Environment]::SetEnvironmentVariable($name, $savedEnvironment[$name], 'Process')
        }
        Remove-Item -LiteralPath $lock -Recurse -Force
    }
}

Install-Okf
