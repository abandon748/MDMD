param([Parameter(Mandatory=$true)][ValidateSet('create','read','native','readonly','writable')][string]$Operation,[string]$Root,[string]$Executable,[int]$AppProcessId)
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new()
if($Operation -eq 'native') {
 Add-Type -AssemblyName System.Drawing
 Add-Type @'
using System; using System.Runtime.InteropServices;
public static class IconMessages {
 [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr hwnd,uint msg,IntPtr wp,IntPtr lp);
}
'@
 $hwnd=(Get-Process -Id $AppProcessId).MainWindowHandle
 $handle=[IconMessages]::SendMessage($hwnd,127,[IntPtr]::Zero,[IntPtr]::Zero)
 if($handle -eq [IntPtr]::Zero){throw 'No native small icon'}
 $icon=[System.Drawing.Icon]::FromHandle($handle)
 $bitmap=$icon.ToBitmap()
 try { @{Handle=$handle.ToInt64();Color=$bitmap.GetPixel(8,8).ToArgb().ToString('X8')} | ConvertTo-Json -Compress } finally {$bitmap.Dispose();$icon.Dispose()}
 exit 0
}
$testRoot=[System.IO.Path]::GetFullPath($Root)
$workspace=[System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\test-results'))+'\'
if(!$testRoot.StartsWith($workspace,[StringComparison]::OrdinalIgnoreCase) -or $testRoot -notmatch '\\run-[0-9]+\\app-data\\appearance\\test-shortcuts$'){throw 'Not an isolated test shortcut root'}
$shell=New-Object -ComObject WScript.Shell
if($Operation -eq 'create') {
 foreach($folder in @('Desktop','Programs','TaskBar')) {
   $dir=Join-Path $testRoot $folder
   New-Item -ItemType Directory -Path $dir -Force | Out-Null
   $link=$shell.CreateShortcut((Join-Path $dir '中文 MDMD.lnk'))
   $link.TargetPath=$Executable;$link.Arguments='"中文 文件.md"';$link.WorkingDirectory=Split-Path $Executable;$link.Description='keep description';$link.IconLocation=$Executable+',0';$link.Save()
 }
 $foreign=$shell.CreateShortcut((Join-Path $testRoot 'Other.lnk'));$foreign.TargetPath=Join-Path $env:WINDIR 'System32\notepad.exe';$foreign.IconLocation=$foreign.TargetPath+',0';$foreign.Save()
} elseif($Operation -in @('readonly','writable')) {
 $path=Join-Path $testRoot 'Desktop\中文 MDMD.lnk'
 (Get-Item -LiteralPath $path).IsReadOnly=($Operation -eq 'readonly')
} else {
 @(Get-ChildItem -LiteralPath $testRoot -Filter '*.lnk' -File -Recurse | Sort-Object FullName | ForEach-Object {
   $link=$shell.CreateShortcut($_.FullName)
   $sha=[Security.Cryptography.SHA256]::Create()
   try {$digest=[BitConverter]::ToString($sha.ComputeHash([IO.File]::ReadAllBytes($_.FullName))).Replace('-','')} finally {$sha.Dispose()}
   @{Path=$_.FullName;Target=$link.TargetPath;Icon=$link.IconLocation;Arguments=$link.Arguments;Description=$link.Description;SHA256=$digest}
 }) | ConvertTo-Json -Depth 4 -Compress
}
