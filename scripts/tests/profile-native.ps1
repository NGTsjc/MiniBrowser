param([Parameter(Mandatory=$true)][int]$AppProcessId, [ValidateSet('sample','move','resize')][string]$Action='sample')
$ErrorActionPreference='Stop'
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class MiniProfile {
  public delegate bool EnumProc(IntPtr window,IntPtr data);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left,Top,Right,Bottom; }
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb,IntPtr data);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr window,out uint process);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr window,StringBuilder text,int size);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr window,out RECT rect);
  [DllImport("user32.dll",SetLastError=true)] public static extern bool SetWindowPos(IntPtr window,IntPtr after,int x,int y,int width,int height,uint flags);
  [DllImport("user32.dll")] public static extern uint GetGuiResources(IntPtr process,uint kind);
  [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
  public static IntPtr FindMain(uint process) {
    IntPtr found=IntPtr.Zero;
    EnumWindows((window,data)=>{uint id;GetWindowThreadProcessId(window,out id);var text=new StringBuilder(256);GetWindowText(window,text,256);
      if(id==process && text.ToString()=="MiniBrowser"){found=window;return false;}return true;},IntPtr.Zero);
    return found;
  }
}
'@
[void][MiniProfile]::SetThreadDpiAwarenessContext([IntPtr](-4))
if($Action -ne 'sample') {
  $window=[MiniProfile]::FindMain($AppProcessId)
  if($window -eq [IntPtr]::Zero){throw 'Profile window not found'}
  $rect=New-Object MiniProfile+RECT
  [void][MiniProfile]::GetWindowRect($window,[ref]$rect)
  $samples=@()
  try {
    for($i=0;$i -lt 48;$i++) {
      $delta=($i%2)*6
      $x=$rect.Left; $y=$rect.Top; $width=$rect.Right-$rect.Left; $height=$rect.Bottom-$rect.Top
      if($Action -eq 'move'){$x+=$delta;$y+=$delta}else{$width+=$delta;$height+=$delta}
      $timer=[Diagnostics.Stopwatch]::StartNew()
      if(-not [MiniProfile]::SetWindowPos($window,[IntPtr]::Zero,$x,$y,$width,$height,0x14)){throw 'Profile move failed'}
      $timer.Stop()
      if($i -ge 8){$samples+=$timer.Elapsed.TotalMilliseconds}
      [Threading.Thread]::Sleep(16)
    }
  } finally {
    [void][MiniProfile]::SetWindowPos($window,[IntPtr]::Zero,$rect.Left,$rect.Top,($rect.Right-$rect.Left),($rect.Bottom-$rect.Top),0x14)
  }
  @{samplesMs=$samples} | ConvertTo-Json -Compress
  return
}
$all=Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId
$ids=[Collections.Generic.HashSet[int]]::new();[void]$ids.Add($AppProcessId)
do { $before=$ids.Count;foreach($process in $all){if($ids.Contains([int]$process.ParentProcessId)){[void]$ids.Add([int]$process.ProcessId)}} } while($ids.Count -ne $before)
$hostProcess=Get-Process -Id $AppProcessId
$totalWorkingSet=0L;$cpu=0.;$threads=0;$count=0
foreach($ownedId in $ids) {
  try {$process=Get-Process -Id $ownedId -ErrorAction Stop;$totalWorkingSet+=$process.WorkingSet64;$cpu+=$process.TotalProcessorTime.TotalMilliseconds;$threads+=$process.Threads.Count;$count++}catch{}
}
@{hostThreads=$hostProcess.Threads.Count;hostWorkingSet=$hostProcess.WorkingSet64;hostGdi=[MiniProfile]::GetGuiResources($hostProcess.Handle,0);hostUserObjects=[MiniProfile]::GetGuiResources($hostProcess.Handle,1);treeWorkingSet=$totalWorkingSet;treeThreads=$threads;treeCpuMs=$cpu;processes=$count} | ConvertTo-Json -Compress
