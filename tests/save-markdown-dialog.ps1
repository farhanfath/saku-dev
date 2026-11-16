param([Parameter(Mandatory=$true)][int]$AppProcessId, [Parameter(Mandatory=$true)][string]$TargetPath)
$ErrorActionPreference = 'Stop'
$resolved = [IO.Path]::GetFullPath($TargetPath)
$folder = [IO.Path]::GetDirectoryName($resolved)
if ([IO.Path]::GetDirectoryName($folder).TrimEnd('\') -ne [IO.Path]::GetTempPath().TrimEnd('\') -or [IO.Path]::GetFileName($folder) -notlike 'desktop-local-tools-markdown-*') { throw 'Save dialog test target must stay in the created fixture folder.' }
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class MarkdownDialogNative {
    [DllImport("user32.dll", EntryPoint="SendMessageW", CharSet=CharSet.Unicode)] public static extern IntPtr ReplaceText(IntPtr handle, uint message, IntPtr wparam, string value);
    [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr handle, uint message, IntPtr wparam, IntPtr lparam);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr handle);
}
'@
$root = [System.Windows.Automation.AutomationElement]::RootElement
$condition = [System.Windows.Automation.AndCondition]::new(
    [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $AppProcessId),
    [System.Windows.Automation.AndCondition]::new(
        [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::NameProperty, 'Simpan Markdown'),
        [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Window)
    )
)
$dialog = $null
for ($attempt = 0; $attempt -lt 100; $attempt++) {
    $dialog = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $condition)
    if ($dialog) { break }
    Start-Sleep -Milliseconds 100
}
if (-not $dialog) { throw 'Native Save dialog did not open.' }
$fieldCondition = [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::AutomationIdProperty, '1001')
$field = $null
for ($attempt = 0; $attempt -lt 80; $attempt++) {
    $field = $dialog.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $fieldCondition)
    if ($field) { break }
    Start-Sleep -Milliseconds 100
}
if (-not $field) {
    $dialog.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition) | ForEach-Object {
        if ($_.Current.ControlType -in @([System.Windows.Automation.ControlType]::Edit, [System.Windows.Automation.ControlType]::ComboBox, [System.Windows.Automation.ControlType]::Button)) { Write-Output ("CONTROL: {0} | {1} | {2}" -f $_.Current.ControlType.ProgrammaticName, $_.Current.AutomationId, $_.Current.Name) }
    }
    throw 'Native filename input was not found.'
}
$valuePattern = $null
if (-not $field.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$valuePattern)) {
    if ($field.Current.ClassName -ne 'Edit' -or $field.Current.NativeWindowHandle -eq 0) { throw 'Filename input does not expose a supported edit handle.' }
    [void][MarkdownDialogNative]::SendMessage([IntPtr]$field.Current.NativeWindowHandle, 0x00B1, [IntPtr]::Zero, [IntPtr](-1))
    [void][MarkdownDialogNative]::ReplaceText([IntPtr]$field.Current.NativeWindowHandle, 0x00C2, [IntPtr]1, $resolved)
} else {
    ([System.Windows.Automation.ValuePattern]$valuePattern).SetValue($resolved)
}
$buttonCondition = [System.Windows.Automation.AndCondition]::new(
    [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::AutomationIdProperty, '1'),
    [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ClassNameProperty, 'Button')
)
$button = $dialog.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $buttonCondition)
if (-not $button) { throw 'Native Save button was not found.' }
if ($button.Current.ClassName -ne 'Button') { throw 'Save control is not the native dialog button.' }
[void][MarkdownDialogNative]::SendMessage([IntPtr]$dialog.Current.NativeWindowHandle, 0x0111, [IntPtr]1, [IntPtr]$button.Current.NativeWindowHandle)
for ($attempt = 0; $attempt -lt 50; $attempt++) {
    if (-not [MarkdownDialogNative]::IsWindowVisible([IntPtr]$dialog.Current.NativeWindowHandle)) { break }
    Start-Sleep -Milliseconds 100
}
if ([MarkdownDialogNative]::IsWindowVisible([IntPtr]$dialog.Current.NativeWindowHandle)) { throw 'Native Save dialog did not finish after accepting the filename.' }
Write-Output 'PASS: native Save As dialog accepted fixture path.'
