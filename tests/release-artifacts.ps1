$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new()
Add-Type -AssemblyName System.IO.Compression.FileSystem
$root=(Resolve-Path '../../release').Path
$package=Get-Content 'package.json' -Raw -Encoding UTF8 | ConvertFrom-Json
$version=$package.version
$entries=@()
foreach($line in (Get-Content "$root/SHA256.txt" -Encoding UTF8)) {
  if($line -notmatch '^([0-9a-f]{64})  ([^\\/]+)$'){throw "Invalid checksum entry: $line"}
  $name=$Matches[2];$expected=$Matches[1]
  $actual=(Get-FileHash -LiteralPath (Join-Path $root $name) -Algorithm SHA256).Hash
  if($actual -ne $expected){throw "Checksum mismatch: $name"}
  $entries+=@{Name=$name;Bytes=(Get-Item -LiteralPath (Join-Path $root $name)).Length;SHA256=$actual}
}
$zip=[System.IO.Compression.ZipFile]::OpenRead((Join-Path $root "MDMD-$version-x64-portable.zip"))
try {
  if($zip.Entries.Count -ne 7){throw 'Portable ZIP must contain EXE plus six companion files, including license notices'}
  if('LICENSE' -notin $zip.Entries.FullName){throw 'Portable ZIP is missing LICENSE'}
  if('THIRD_PARTY_NOTICES.txt' -notin $zip.Entries.FullName){throw 'Portable ZIP is missing dependency notices'}
  foreach($item in $zip.Entries){
    if($item.FullName -match '[\\/]'){throw 'Unexpected ZIP directory'}
    $stream=$item.Open();$sha=[System.Security.Cryptography.SHA256]::Create()
    try{$actual=[BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-','')}finally{$sha.Dispose();$stream.Dispose()}
    if($actual -ne (Get-FileHash -LiteralPath (Join-Path $root $item.FullName)).Hash){throw "ZIP payload mismatch: $($item.FullName)"}
  }
}finally{$zip.Dispose()}
foreach($name in @('LICENSE','THIRD_PARTY_NOTICES.txt')) {
  if((Get-FileHash -LiteralPath (Join-Path $root $name)).Hash -ne (Get-FileHash -LiteralPath $name).Hash){throw "Release license differs from source: $name"}
}
if((Get-FileHash "$root/MDMD.exe").Hash -ne (Get-FileHash 'src-tauri/target/release/mdmd.exe').Hash){throw 'Target and unified EXE differ'}
if((Get-FileHash "$root/MDMD-$version-x64-setup.exe").Hash -ne (Get-FileHash "src-tauri/target/release/bundle/nsis/MDMD_$($version)_x64-setup.exe").Hash){throw 'Installer differs from target'}
@{Version=$version;Checksums=$entries;PortablePayloadMatches=$true;TargetsMatch=$true} | ConvertTo-Json -Depth 5
