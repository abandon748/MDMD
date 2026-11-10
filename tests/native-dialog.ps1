param([int]$AppProcessId, [string]$FilePath, [switch]$Cancel, [switch]$CloseWindow, [string]$ExpectedFileName, [string]$ExpectedTitle, [switch]$ConfirmOverwrite)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class DialogMessages {
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr SendMessage(IntPtr hwnd, uint msg, IntPtr wParam, string lParam);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr SendMessage(IntPtr hwnd, uint msg, IntPtr wParam, System.Text.StringBuilder lParam);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hwnd, uint msg, IntPtr wParam, IntPtr lParam);
  private delegate bool EnumWindowProc(IntPtr hwnd, IntPtr param);
  [DllImport("user32.dll")] private static extern bool EnumWindows(EnumWindowProc callback, IntPtr param);
  [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
  [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll")] private static extern bool EnumChildWindows(IntPtr hwnd, EnumWindowProc callback, IntPtr param);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] private static extern int GetWindowText(IntPtr hwnd, System.Text.StringBuilder text, int count);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] private static extern int GetClassName(IntPtr hwnd, System.Text.StringBuilder text, int count);
  public static bool ConfirmOverwrite(int processId) {
    bool found = false;
    EnumWindows((hwnd, param) => {
      uint pid;
      GetWindowThreadProcessId(hwnd, out pid);
      if (pid != processId || !IsWindowVisible(hwnd)) return true;
      var cls = new System.Text.StringBuilder(100);
      var title = new System.Text.StringBuilder(100);
      GetClassName(hwnd, cls, 100); GetWindowText(hwnd, title, 100);
      if (cls.ToString() != "#32770" || (title.ToString() != "\u786e\u8ba4\u53e6\u5b58\u4e3a" && title.ToString() != "Confirm Save As")) return true;
      // Windows 11's Yes is nested in DirectUI and has control ID 0.
      EnumChildWindows(hwnd, (child, unused) => {
        var text = new System.Text.StringBuilder(100);
        GetClassName(child, cls, 100); GetWindowText(child, text, 100);
        if (cls.ToString() != "Button" || !IsWindowVisible(child)) return true;
        if (text.ToString() != "\u662f(&Y)" && text.ToString() != "&Yes") return true;
        found = PostMessage(child, 245, IntPtr.Zero, IntPtr.Zero);
        return false;
      }, IntPtr.Zero);
      return !found;
    }, IntPtr.Zero);
    return found;
  }
}
'@
if ($CloseWindow) {
    $mainWindow = (Get-Process -Id $AppProcessId).MainWindowHandle
    [void][DialogMessages]::PostMessage($mainWindow, 16, [IntPtr]::Zero, [IntPtr]::Zero)
    exit 0
}
$automation = [System.Windows.Automation.AutomationElement]
$pidCondition = New-Object System.Windows.Automation.PropertyCondition ($automation::ProcessIdProperty, $AppProcessId)
$dialog = $null
for ($attempt = 0; $attempt -lt 100; $attempt++) {
    $windows = $automation::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children, $pidCondition)
    foreach ($window in $windows) { if ($window.Current.ClassName -eq '#32770') { $dialog = $window; break } }
    if ($dialog) { break }
    Start-Sleep -Milliseconds 100
}
if (!$dialog) { throw 'Application file dialog did not appear.' }
if ($ExpectedTitle -and $dialog.Current.Name -ne $ExpectedTitle) { throw "Expected dialog title '$ExpectedTitle', got '$($dialog.Current.Name)'." }
if (!$Cancel -or $ExpectedFileName) {
    $filenameEdit = $null
    $filenameLabel = [regex]::Unescape('\u6587\u4ef6\u540d')
    for ($attempt = 0; $attempt -lt 5; $attempt++) {
        $edits = $dialog.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
        foreach ($edit in $edits) {
            $parentId = [System.Windows.Automation.TreeWalker]::ControlViewWalker.GetParent($edit).Current.AutomationId
            # Windows 11 folder pickers use Edit 1152; file/save pickers use 1148.
            if (($parentId -eq 'FileNameControlHost' -or $edit.Current.AutomationId -in @('1148','1152')) -and $edit.Current.ClassName -eq 'Edit') { $filenameEdit = $edit; break }
            if ($edit.Current.AutomationId -eq '1148' -or $parentId -eq 'FileNameControlHost' -or $edit.Current.Name -match "$filenameLabel|File name") {
                $valuePattern = $null
                if ($edit.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$valuePattern) -and !$valuePattern.Current.IsReadOnly) { $filenameEdit = $edit; break }
            }
        }
        if ($filenameEdit) { break }
        Start-Sleep -Milliseconds 100
    }
    if (!$filenameEdit) { throw ('Filename input missing: ' + (($edits | ForEach-Object { $_.Current.AutomationId + ':' + $_.Current.Name }) -join ', ')) }
    if ($ExpectedFileName) {
        if ($filenameEdit.Current.NativeWindowHandle) {
            $buffer = New-Object System.Text.StringBuilder 1024
            [void][DialogMessages]::SendMessage([IntPtr]$filenameEdit.Current.NativeWindowHandle, 13, [IntPtr]$buffer.Capacity, $buffer)
            $actualName = $buffer.ToString()
        } else { $actualName = $filenameEdit.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).Current.Value }
        if ($actualName -ne $ExpectedFileName) { throw "Expected default filename '$ExpectedFileName', got '$actualName'." }
    }
    if (!$Cancel -and $filenameEdit.Current.NativeWindowHandle) {
        [void][DialogMessages]::SendMessage([IntPtr]$filenameEdit.Current.NativeWindowHandle, 12, [IntPtr]::Zero, $FilePath)
    } elseif (!$Cancel) { $filenameEdit.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).SetValue($FilePath) }
}
$buttonId = if ($Cancel) { '2' } else { '1' }
$idCondition = New-Object System.Windows.Automation.PropertyCondition ($automation::AutomationIdProperty, $buttonId)
$typeCondition = New-Object System.Windows.Automation.PropertyCondition ($automation::ClassNameProperty, 'Button')
$buttonCondition = New-Object System.Windows.Automation.AndCondition ($idCondition, $typeCondition)
# The dialog HWND can appear before its action buttons enter the UIA tree.
$button = $null
for ($attempt = 0; $attempt -lt 50; $attempt++) {
    $button = $dialog.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $buttonCondition)
    if ($button) { break }
    Start-Sleep -Milliseconds 100
}
if (!$button) { throw ('Dialog action button missing: ' + (($dialog.FindAll([System.Windows.Automation.TreeScope]::Descendants, $idCondition) | ForEach-Object { $_.Current.ClassName + ':' + $_.Current.Name + ':' + $_.Current.NativeWindowHandle }) -join ', ')) }
if (!$Cancel -and $filenameEdit.Current.AutomationId -eq '1152') {
    [void][DialogMessages]::PostMessage([IntPtr]$button.Current.NativeWindowHandle, 245, [IntPtr]::Zero, [IntPtr]::Zero)
} else {
    [void][DialogMessages]::PostMessage([IntPtr]$dialog.Current.NativeWindowHandle, 273, [IntPtr]([int]$buttonId), [IntPtr]$button.Current.NativeWindowHandle)
}
if ($ConfirmOverwrite) {
    # Exercise the application's no-overwrite guard even after the system's Yes.
    for ($attempt = 0; $attempt -lt 100; $attempt++) {
        if ([DialogMessages]::ConfirmOverwrite($AppProcessId)) { exit 0 }
        Start-Sleep -Milliseconds 100
    }
    throw 'Overwrite confirmation did not appear (expected Chinese/English Windows labels).'
}
