param(
    [int]$AppProcessId=0,
    [string]$ExecutablePath='',
    [ValidateSet('inspect','clickGear','dragToolbar','resize','edgeResize','hotkey','close','moveBeyond','releaseBounds','inspectMenu','dismissMenu','menuRefresh','menuHide','menuRestore','menuClose','menuRestart','clickOutsideMenu')][string]$Action='inspect'
)
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[System.Text.Encoding]::UTF8
if ($AppProcessId -eq 0) {
    $ownedProcess=Get-CimInstance Win32_Process -Filter "name = 'MiniBrowser.exe'" | Where-Object { $_.ExecutablePath -eq $ExecutablePath } | Select-Object -First 1
    if (-not $ownedProcess) { throw 'Test application not found' }
    $AppProcessId=$ownedProcess.ProcessId
}
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class MiniProbe {
    public delegate bool EnumProc(IntPtr window, IntPtr data);
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
    [StructLayout(LayoutKind.Sequential)] public struct MONITORINFO { public uint Size; public RECT Monitor, Work; public uint Flags; }
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc callback, IntPtr data);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr window, StringBuilder text, int max);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr window, out RECT rect);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr window, int index);
    [DllImport("user32.dll")] public static extern bool GetLayeredWindowAttributes(IntPtr window, out uint color, out byte alpha, out uint flags);
    [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr window, IntPtr after, int x, int y, int width, int height, uint flags);
    [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr window, uint message, IntPtr wparam, IntPtr lparam);
    [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT point);
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint x, uint y, uint data, UIntPtr extra);
    [DllImport("user32.dll")] public static extern void keybd_event(byte key, byte scan, uint flags, UIntPtr extra);
    [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr window);
    [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
    [DllImport("user32.dll")] public static extern IntPtr MonitorFromWindow(IntPtr window, uint flags);
    [DllImport("user32.dll")] public static extern bool GetMonitorInfo(IntPtr monitor, ref MONITORINFO info);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr window, StringBuilder text, int max);
    [DllImport("user32.dll")] public static extern int GetMenuItemCount(IntPtr menu);
    [DllImport("user32.dll")] public static extern bool GetMenuItemRect(IntPtr window, IntPtr menu, uint item, out RECT rect);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetMenuString(IntPtr menu, uint item, StringBuilder text, int max, uint flags);
    public static IntPtr FindPopup(int process) {
        IntPtr found=IntPtr.Zero;
        EnumWindows((window, _) => {
            uint owner; GetWindowThreadProcessId(window, out owner);
            var name=new StringBuilder(128); GetClassName(window,name,name.Capacity);
            if (owner==process && name.ToString()=="#32768" && IsWindowVisible(window)) found=window;
            return true;
        },IntPtr.Zero);
        return found;
    }
    public static string[] PopupItems(int process) {
        var window=FindPopup(process); if(window==IntPtr.Zero) return new string[0];
        var menu=SendMessage(window,0x01E1,IntPtr.Zero,IntPtr.Zero);
        var items=new List<string>();
        for(uint i=0;i<GetMenuItemCount(menu);i++) {
            var label=new StringBuilder(256); GetMenuString(menu,i,label,label.Capacity,0x400); items.Add(label.ToString());
        }
        return items.ToArray();
    }
    public static RECT PopupItemRect(int process,uint index) {
        var window=FindPopup(process);
        if(window==IntPtr.Zero) throw new InvalidOperationException("Native popup is not open");
        var menu=SendMessage(window,0x01E1,IntPtr.Zero,IntPtr.Zero);
        RECT rect;
        if(!GetMenuItemRect(IntPtr.Zero,menu,index,out rect)) throw new InvalidOperationException("Menu item bounds unavailable");
        return rect;
    }
    public static Dictionary<string, IntPtr> Find(int process) {
        var windows = new Dictionary<string, IntPtr>();
        EnumWindows((window, _) => {
            uint owner; GetWindowThreadProcessId(window, out owner);
            if (owner == process) {
                var text = new StringBuilder(256); GetWindowText(window, text, text.Capacity);
                if (text.Length > 0) windows[text.ToString()] = window;
            }
            return true;
        }, IntPtr.Zero);
        return windows;
    }
}
'@
[void][MiniProbe]::SetThreadDpiAwarenessContext([IntPtr](-4))
$hosts=[MiniProbe]::Find($AppProcessId)
if (-not $hosts.ContainsKey('MiniBrowser')) { throw 'Browser host not found' }
$browser=$hosts['MiniBrowser']
$controlTitle=$hosts.Keys | Where-Object { $_ -like 'MiniBrowser *' } | Select-Object -First 1
$controls=$hosts[$controlTitle]

$monitorInfo=New-Object MiniProbe+MONITORINFO
$monitorInfo.Size=[Runtime.InteropServices.Marshal]::SizeOf($monitorInfo)
[void][MiniProbe]::GetMonitorInfo([MiniProbe]::MonitorFromWindow($browser,2),[ref]$monitorInfo)
if ($Action -eq 'clickOutsideMenu') {
    $mainRect=New-Object MiniProbe+RECT
    $menuRect=New-Object MiniProbe+RECT
    [void][MiniProbe]::GetWindowRect($browser,[ref]$mainRect)
    [void][MiniProbe]::GetWindowRect($controls,[ref]$menuRect)
    $points=@(@(($mainRect.Right-20),($mainRect.Bottom-20)),@(($mainRect.Left+20),($mainRect.Bottom-20)),@(($mainRect.Right-20),($mainRect.Top+20)),@(($mainRect.Left+20),($mainRect.Top+20)))
    $point=$points | Where-Object { $_[0] -lt $menuRect.Left -or $_[0] -ge $menuRect.Right -or $_[1] -lt $menuRect.Top -or $_[1] -ge $menuRect.Bottom } | Select-Object -First 1
    if (-not $point) { throw 'No browser point outside popup' }
    $cursor=New-Object MiniProbe+POINT
    [void][MiniProbe]::GetCursorPos([ref]$cursor)
    try {
        [void][MiniProbe]::SetCursorPos($point[0],$point[1])
        [System.Threading.Thread]::Sleep(120)
        [MiniProbe]::mouse_event(2,0,0,0,[UIntPtr]::Zero)
        [System.Threading.Thread]::Sleep(60)
    } finally {
        [MiniProbe]::mouse_event(4,0,0,0,[UIntPtr]::Zero)
        [System.Threading.Thread]::Sleep(180)
        [void][MiniProbe]::SetCursorPos($cursor.X,$cursor.Y)
    }
} elseif ($Action -eq 'moveBeyond') {
    [void][MiniProbe]::SendMessage($browser,0x231,[IntPtr]::Zero,[IntPtr]::Zero)
    [void][MiniProbe]::SetWindowPos($browser,[IntPtr]::Zero,$monitorInfo.Work.Right-50,$monitorInfo.Work.Top+40,0,0,0x15)
} elseif ($Action -eq 'releaseBounds') {
    [void][MiniProbe]::SendMessage($browser,0x232,[IntPtr]::Zero,[IntPtr]::Zero)
} elseif ($Action -eq 'dismissMenu') {
    [MiniProbe]::keybd_event(0x1B,0,0,[UIntPtr]::Zero)
    [MiniProbe]::keybd_event(0x1B,0,2,[UIntPtr]::Zero)
} elseif ($Action -like 'menu*') {
    $index=0
    if ($Action -eq 'menuHide') { $index=1 }
    if ($Action -eq 'menuRestore') { $index=3 }
    if ($Action -eq 'menuClose') { $index=2 }
    if ($Action -eq 'menuRestart') { $index=4 }
    $item=[MiniProbe]::PopupItemRect($AppProcessId,$index)
    $cursor=New-Object MiniProbe+POINT
    [void][MiniProbe]::GetCursorPos([ref]$cursor)
    try {
        [void][MiniProbe]::SetCursorPos(($item.Left+$item.Right)/2,($item.Top+$item.Bottom)/2)
        [System.Threading.Thread]::Sleep(120)
        [MiniProbe]::mouse_event(2,0,0,0,[UIntPtr]::Zero)
        [System.Threading.Thread]::Sleep(60)
    } finally {
        [MiniProbe]::mouse_event(4,0,0,0,[UIntPtr]::Zero)
        [System.Threading.Thread]::Sleep(180)
        [void][MiniProbe]::SetCursorPos($cursor.X,$cursor.Y)
    }
} elseif ($Action -eq 'close') {
    [void][MiniProbe]::SendMessage($browser,0x10,[IntPtr]::Zero,[IntPtr]::Zero)
} elseif ($Action -eq 'resize') {
    $scale=[MiniProbe]::GetDpiForWindow($browser)/96.0
    [void][MiniProbe]::SetWindowPos($browser,[IntPtr]::Zero,0,0,[int](560*$scale),[int](500*$scale),0x16)
} elseif ($Action -eq 'clickGear' -or $Action -eq 'dragToolbar' -or $Action -eq 'edgeResize') {
    $rect=New-Object MiniProbe+RECT
    [void][MiniProbe]::GetWindowRect($controls,[ref]$rect)
    if ($Action -eq 'edgeResize') { [void][MiniProbe]::GetWindowRect($browser,[ref]$rect) }
    $cursor=New-Object MiniProbe+POINT
    [void][MiniProbe]::GetCursorPos([ref]$cursor)
    $x=$rect.Left+($rect.Right-$rect.Left)/2
    $y=$rect.Top+($rect.Bottom-$rect.Top)/2
    $scale=[MiniProbe]::GetDpiForWindow($browser)/96.0
    if ($Action -eq 'dragToolbar') { $x=$rect.Left+58*$scale }
    if ($Action -eq 'clickGear') { $x=$rect.Left+20*$scale }
    if ($Action -eq 'edgeResize') { $x=$rect.Right-2 }
    try {
        [void][MiniProbe]::SetCursorPos([int]$x,[int]$y)
        [System.Threading.Thread]::Sleep(100)
        [MiniProbe]::mouse_event(2,0,0,0,[UIntPtr]::Zero)
        if ($Action -ne 'clickGear') {
            [System.Threading.Thread]::Sleep(40)
            [void][MiniProbe]::SetCursorPos([int]$x+12,[int]$y+8)
            [System.Threading.Thread]::Sleep(180)
            [void][MiniProbe]::SetCursorPos([int]$x+65,[int]$y+45)
            [System.Threading.Thread]::Sleep(180)
        } else { [System.Threading.Thread]::Sleep(60) }
    } finally {
        [MiniProbe]::mouse_event(4,0,0,0,[UIntPtr]::Zero)
        [System.Threading.Thread]::Sleep(180)
        [void][MiniProbe]::SetCursorPos($cursor.X,$cursor.Y)
    }
} elseif ($Action -eq 'hotkey') {
    try {
        foreach($key in @(0x11,0x12,0x4D)) { [MiniProbe]::keybd_event($key,0,0,[UIntPtr]::Zero) }
        [System.Threading.Thread]::Sleep(100)
    } finally {
        foreach($key in @(0x4D,0x12,0x11)) { [MiniProbe]::keybd_event($key,0,2,[UIntPtr]::Zero) }
    }
}
[System.Threading.Thread]::Sleep(250)
$output=@{processId=$AppProcessId; menuItems=@([MiniProbe]::PopupItems($AppProcessId)); workArea=@{x=$monitorInfo.Work.Left;y=$monitorInfo.Work.Top;width=$monitorInfo.Work.Right-$monitorInfo.Work.Left;height=$monitorInfo.Work.Bottom-$monitorInfo.Work.Top}}
$controlMonitor=New-Object MiniProbe+MONITORINFO
$controlMonitor.Size=[Runtime.InteropServices.Marshal]::SizeOf($controlMonitor)
[void][MiniProbe]::GetMonitorInfo([MiniProbe]::MonitorFromWindow($controls,2),[ref]$controlMonitor)
$output.controlWorkArea=@{x=$controlMonitor.Work.Left;y=$controlMonitor.Work.Top;width=$controlMonitor.Work.Right-$controlMonitor.Work.Left;height=$controlMonitor.Work.Bottom-$controlMonitor.Work.Top}
foreach($entry in $hosts.GetEnumerator()) {
    $rect=New-Object MiniProbe+RECT
    [void][MiniProbe]::GetWindowRect($entry.Value,[ref]$rect)
    [uint32]$color=0; [byte]$alpha=0; [uint32]$flags=0
    $layered=[MiniProbe]::GetLayeredWindowAttributes($entry.Value,[ref]$color,[ref]$alpha,[ref]$flags)
    $point=($rect.Left+1) -bor (($rect.Top+[int](($rect.Bottom-$rect.Top)/2)) -shl 16)
    $hit=[MiniProbe]::SendMessage($entry.Value,0x84,[IntPtr]::Zero,[IntPtr]$point)
    $output[$entry.Key]=@{ x=$rect.Left; y=$rect.Top; width=$rect.Right-$rect.Left; height=$rect.Bottom-$rect.Top; visible=[MiniProbe]::IsWindowVisible($entry.Value); alpha=if($layered){[int]$alpha}else{255}; style=[MiniProbe]::GetWindowLong($entry.Value,-16); extendedStyle=[MiniProbe]::GetWindowLong($entry.Value,-20); edgeHit=$hit.ToInt64() }
}
$output | ConvertTo-Json -Compress
