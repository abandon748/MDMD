param([string]$ExpectedFilePath, [string]$ReadyFilePath, [ValidateRange(1,600)][int]$TimeoutSeconds=20)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Windows.Forms
$expected=[IO.File]::ReadAllText($ExpectedFilePath,[Text.Encoding]::UTF8).Replace("`r`n","`n")
$original=[Windows.Forms.Clipboard]::GetDataObject()
$snapshot=New-Object Windows.Forms.DataObject
if ($null -ne $original) {
  foreach ($format in $original.GetFormats($false)) {
    $data=$original.GetData($format,$false)
    if ($data -is [IO.MemoryStream]) { $data=New-Object IO.MemoryStream(,$data.ToArray()) }
    elseif ($data -is [Drawing.Image]) { $data=$data.Clone() }
    if ($null -ne $data) { $snapshot.SetData($format,$false,$data) }
  }
}
$matched=$false
$restored=$false
try {
  [IO.File]::WriteAllText($ReadyFilePath,'ready')
  for ($i=0;$i -lt ($TimeoutSeconds*10);$i++) {
    try { $current=[Windows.Forms.Clipboard]::GetText().Replace("`r`n","`n") } catch { Start-Sleep -Milliseconds 100;continue }
    if ($current -ceq $expected) {$matched=$true;break}
    Start-Sleep -Milliseconds 100
  }
} finally {
  if ($matched -and [Windows.Forms.Clipboard]::GetText().Replace("`r`n","`n") -ceq $expected) {
    for ($j=0;$j -lt 10;$j++) {
      try { if ($snapshot.GetFormats($false).Length -eq 0) {[Windows.Forms.Clipboard]::Clear()} else {[Windows.Forms.Clipboard]::SetDataObject($snapshot,$true)};$restored=$true;break } catch {Start-Sleep -Milliseconds 100}
    }
  }
}
@{matched=$matched;restored=$restored} | ConvertTo-Json -Compress
if (-not $matched -or -not $restored) {exit 1}
