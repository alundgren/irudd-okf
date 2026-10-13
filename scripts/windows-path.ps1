param([Parameter(Mandatory = $true)][string]$Directory)
$ErrorActionPreference = 'Stop'
$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
$entries = @($userPath -split ';' | Where-Object { $_ })
if (-not ($entries | Where-Object { $_.TrimEnd('\') -eq $Directory.TrimEnd('\') })) {
    [Environment]::SetEnvironmentVariable('Path', (($entries + $Directory) -join ';'), 'User')
}
