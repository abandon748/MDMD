param(
  [Parameter(Mandatory=$true)][Guid]$TestId,
  [Parameter(Mandatory=$true)][ValidateSet('control','conflict','partial','legacy-icons','extra','stale','snapshot','production','cleanup')][string]$Operation,
  [ValidateSet('Default','FailAfter','LaunchFailure')][string]$Name = 'Default',
  [string]$Value = ''
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
$registryRoot = 'Software\MDMD\IntegrationTests\' + $TestId.ToString()
$hkcu = [Microsoft.Win32.Registry]::CurrentUser
function Put-TestValue([string]$relative, [string]$name, [string]$value) {
  $key = $hkcu.CreateSubKey($registryRoot + '\' + $relative)
  try { $key.SetValue($name,$value,[Microsoft.Win32.RegistryValueKind]::String) } finally { $key.Dispose() }
}
function Read-Tree([string]$path) {
  $key = $hkcu.OpenSubKey($path)
  if ($null -eq $key) { return }
  try {
    foreach ($n in ($key.GetValueNames() | Sort-Object)) {
      [pscustomobject]@{ Key=$path;Name=$n;Kind=$key.GetValueKind($n).ToString();Value=$key.GetValue($n,$null,[Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames) }
    }
    foreach ($child in ($key.GetSubKeyNames() | Sort-Object)) { Read-Tree ($path+'\'+$child) }
  } finally { $key.Dispose() }
}
switch ($Operation) {
  'control' {
    if ($Value -ne '') { Put-TestValue 'Control' $Name $Value }
    else { $key=$hkcu.OpenSubKey($registryRoot+'\Control',$true); if($key) { try {$key.DeleteValue($Name,$false)} finally {$key.Dispose()} } }
  }
  'conflict' { Put-TestValue 'Software\Classes\SystemFileAssociations\.md\shell\MDMD.Open\command' '' 'foreign-command' }
  'partial' { $key=$hkcu.OpenSubKey($registryRoot+'\Software\Classes\SystemFileAssociations\.md\shell\MDMD.Open\command',$true); if($key) {try{$key.DeleteValue('',$false)}finally{$key.Dispose()}} }
  'legacy-icons' {
    foreach($item in @(@('Software\MDMD\Capabilities','ApplicationIcon'),@('Software\Classes\MDMD.Markdown\Application','ApplicationName'),@('Software\Classes\MDMD.Markdown\Application','ApplicationIcon'))) {
      $key=$hkcu.OpenSubKey($registryRoot+'\'+$item[0],$true)
      if($key){try{$key.DeleteValue($item[1],$false)}finally{$key.Dispose()}}
    }
  }
  'extra' { Put-TestValue 'Software\Classes\.md\OpenWithProgids' 'Foreign.App' 'preserve'; Put-TestValue 'Software\Classes\SystemFileAssociations\.md\shell\MDMD.Open' 'Foreign.Value' 'preserve' }
  'stale' {
    if (-not [IO.Path]::IsPathRooted($Value) -or (Test-Path -LiteralPath $Value)) { throw 'Expected a missing absolute test executable' }
    Put-TestValue 'Software\Classes\MDMD.Markdown' '' 'MDMD Markdown'
    Put-TestValue 'Software\Classes\MDMD.Markdown' 'MDMD.Owner' $Value
    Put-TestValue 'Software\Classes\MDMD.Markdown\DefaultIcon' '' ('"'+$Value+'",0')
    Put-TestValue 'Software\Classes\MDMD.Markdown\shell\open\command' '' ('"'+$Value+'" "%1"')
    Put-TestValue 'Software\MDMD\Capabilities' 'ApplicationName' 'MDMD'
    Put-TestValue 'Software\MDMD\Capabilities' 'ApplicationDescription' 'MDMD Markdown reader and editor'
    Put-TestValue 'Software\MDMD\Capabilities' 'MDMD.Owner' $Value
    Put-TestValue 'Software\MDMD\Capabilities\FileAssociations' '.md' 'MDMD.Markdown'
    Put-TestValue 'Software\RegisteredApplications' 'MDMD' 'Software\MDMD\Capabilities'
    $key=$hkcu.CreateSubKey($registryRoot+'\Software\Classes\.md\OpenWithProgids')
    try { $key.SetValue('MDMD.Markdown',[byte[]]@(),[Microsoft.Win32.RegistryValueKind]::None) } finally { $key.Dispose() }
  }
  'snapshot' { @(Read-Tree ($registryRoot+'\Software')) | ConvertTo-Json -Depth 8 -Compress }
  'production' {
    $items=@(foreach($path in @('Software\Classes\MDMD.Markdown','Software\Classes\Applications\mdmd.exe','Software\Classes\.md','Software\Classes\SystemFileAssociations\.md','Software\MDMD\Capabilities','Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\.md')) {Read-Tree $path})
    $key=$hkcu.OpenSubKey('Software\RegisteredApplications')
    if($key) {try{$items+= [pscustomobject]@{Key='Software\RegisteredApplications';Name='MDMD';Value=$key.GetValue('MDMD')}}finally{$key.Dispose()}}
    $items | ConvertTo-Json -Depth 8 -Compress
  }
  'cleanup' {
    # The sole deletion target is the validated UUID beneath the fixed test namespace.
    if ($registryRoot -notmatch '^Software\\MDMD\\IntegrationTests\\[0-9a-f-]{36}$') { throw 'Invalid test root' }
    $hkcu.DeleteSubKeyTree($registryRoot,$false)
  }
}
