param([ValidateSet('read','cancel','startup-error')][string]$Mode='read', [int]$AppProcessId)
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new()
if($Mode -eq 'read') {
  $uninstall=Get-ItemProperty 'HKCU:/Software/Microsoft/Windows/CurrentVersion/Uninstall/MDMD' -ErrorAction SilentlyContinue
  $location=Get-ItemProperty 'HKCU:/Software/MDMD/MDMD' -ErrorAction SilentlyContinue
  @{Version=$uninstall.DisplayVersion;Location=$location.'(default)';Uninstall=$uninstall.UninstallString} | ConvertTo-Json -Compress
  exit
}
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class InstallerDialog {
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hwnd, uint msg, IntPtr wParam, IntPtr lParam);
}
'@
$automation=[System.Windows.Automation.AutomationElement]
$condition=[System.Windows.Automation.PropertyCondition]::new($automation::ProcessIdProperty,$AppProcessId)
for($i=0;$i -lt 100;$i++) {
  $windows=$automation::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children,$condition)
  foreach($window in $windows) {
    if($Mode -eq 'startup-error' -and $window.Current.Name -notmatch 'Startup failed') {continue}
    $id='2'
    $button=$window.FindFirst([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.PropertyCondition]::new($automation::AutomationIdProperty,$id))
    if($button -and $button.Current.IsEnabled) {
      $texts=$window.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition)
      ($texts | ForEach-Object {$_.Current.Name}) -join "`n"
      if($button.Current.NativeWindowHandle -eq 0){throw 'Native dialog button handle missing'}
      [void][InstallerDialog]::PostMessage([IntPtr]$button.Current.NativeWindowHandle,245,[IntPtr]::Zero,[IntPtr]::Zero)
      exit
    }
  }
  Start-Sleep -Milliseconds 100
}
throw 'Expected installer/runtime dialog did not appear'
