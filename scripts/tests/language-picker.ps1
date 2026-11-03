param([Parameter(Mandatory=$true)][int]$AppProcessId,[string]$SelectedPath='',[switch]$Cancel)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$root=[System.Windows.Automation.AutomationElement]::RootElement
$condition=New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty,$AppProcessId)
$dialog=$null
for($attempt=0;$attempt -lt 80;$attempt++) {
  $windows=$root.FindAll([System.Windows.Automation.TreeScope]::Descendants,$condition)
  foreach($window in $windows) { if($window.Current.ClassName -eq '#32770' -and $window.Current.Name -match 'MiniBrowser.data') { $dialog=$window;break } }
  if($dialog) { break }
  Start-Sleep -Milliseconds 100
}
if(-not $dialog) { throw ('Owned file dialog not found: '+(($windows | ForEach-Object { $_.Current.ClassName+':'+$_.Current.Name }) -join ',')) }
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class LanguageDialogProbe {
  public delegate bool Callback(IntPtr hwnd, IntPtr data);
  [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr parent, Callback callback, IntPtr data);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr hwnd, StringBuilder name, int count);
  [DllImport("user32.dll")] static extern int GetDlgCtrlID(IntPtr hwnd);
  [DllImport("user32.dll")] static extern IntPtr GetParent(IntPtr hwnd);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr SendMessage(IntPtr hwnd, uint msg, IntPtr wparam, string text);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hwnd, uint msg, IntPtr wparam, IntPtr lparam);
  public static IntPtr FileName(IntPtr dialog) {
    IntPtr found=IntPtr.Zero;
    EnumChildWindows(dialog,(hwnd,data)=>{
      var name=new StringBuilder(64);GetClassName(hwnd,name,64);
      if(name.ToString()=="Edit") {
        for(var parent=hwnd;parent!=IntPtr.Zero && parent!=dialog;parent=GetParent(parent)) {
          if(GetDlgCtrlID(parent)==1148) { found=hwnd;return false; }
        }
      }
      return true;
    },IntPtr.Zero);
    return found;
  }
}
"@
$handle=[IntPtr]$dialog.Current.NativeWindowHandle
if(-not $Cancel) {
  $edit=[IntPtr]::Zero
  for($attempt=0;$attempt -lt 50;$attempt++) {
    $edit=[LanguageDialogProbe]::FileName($handle)
    if($edit -ne [IntPtr]::Zero) { break }
    Start-Sleep -Milliseconds 100
  }
  if($edit -eq [IntPtr]::Zero) { throw 'Owned filename Edit HWND not found' }
  [void][LanguageDialogProbe]::SendMessage($edit,0x000C,[IntPtr]::Zero,$SelectedPath)
}
$command=if($Cancel){2}else{1}
[void][LanguageDialogProbe]::PostMessage($handle,0x0111,[IntPtr]$command,[IntPtr]::Zero)
