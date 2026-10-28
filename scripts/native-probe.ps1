param(
    [int]$AppProcessId=0,
    [string]$ExecutablePath='',
    [int]$ClickX=100,
    [int]$ClickY=35,
    [ValidateRange(1,8)][int]$WheelTicks=1,
    [ValidateSet('inspect','clickGear','dragToolbar','resize','edgeResize','hotkey','close','moveBeyond','releaseBounds','inspectMenu','dismissMenu','menuRefresh','menuHide','menuRestore','menuClose','menuRestart','clickOutsideMenu','inspectDevtools','closeDevtools','rightClickPage','rightClickControl','ctrlClickPage','middleClickPage','clickPage','openTrayMenu','trayReset','captureWindow','minimumResize','cornerResizeTL','cornerResizeTR','cornerResizeBL','cornerResizeBR','inspectChildren','zoomIn','zoomOut','zoomReset','zoomPlus','zoomMinus','zoomControl','scrollPage')][string]$Action='inspect'
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
    [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr parent, EnumProc callback, IntPtr data);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr window, StringBuilder text, int max);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr window, out RECT rect);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr window);
    [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr window, int index);
    [DllImport("user32.dll")] public static extern bool GetLayeredWindowAttributes(IntPtr window, out uint color, out byte alpha, out uint flags);
    [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr window, IntPtr after, int x, int y, int width, int height, uint flags);
    [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr window, uint message, IntPtr wparam, IntPtr lparam);
    [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr window, uint message, IntPtr wparam, IntPtr lparam);
    [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT point);
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint x, uint y, uint data, UIntPtr extra);
    [DllImport("user32.dll")] public static extern void keybd_event(byte key, byte scan, uint flags, UIntPtr extra);
    [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr window);
    [DllImport("user32.dll")] public static extern int GetWindowRgn(IntPtr window,IntPtr region);
    [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT point);
    [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr window,uint flags);
    [DllImport("gdi32.dll")] public static extern IntPtr CreateRectRgn(int left,int top,int right,int bottom);
    [DllImport("gdi32.dll")] public static extern bool DeleteObject(IntPtr value);
    [DllImport("gdi32.dll")] public static extern bool PtInRegion(IntPtr region,int x,int y);
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
    public static IntPtr FindTray(int process) {
        IntPtr found=IntPtr.Zero;
        EnumWindows((window, _) => {
            uint owner; GetWindowThreadProcessId(window, out owner);
            var name=new StringBuilder(128); GetClassName(window,name,name.Capacity);
            if(owner==process && name.ToString()=="tray_icon_app") found=window;
            return true;
        },IntPtr.Zero);
        return found;
    }
    public static string[] Children(IntPtr parent) {
        var found=new List<string>();
        EnumChildWindows(parent,(window,_)=>{
            uint process;var thread=GetWindowThreadProcessId(window,out process);
            var name=new StringBuilder(128);GetClassName(window,name,name.Capacity);
            var extra="";
            if(name.ToString()=="TAURI_DRAG_RESIZE_BORDERS") {
                RECT r;GetWindowRect(window,out r);var region=CreateRectRgn(0,0,0,0);var kind=GetWindowRgn(window,region);
                var inset=(int)(12*GetDpiForWindow(parent)/96.0);var p=new POINT{X=r.Right-inset,Y=r.Top+inset};
                var packed=new IntPtr((p.X & 65535)|((p.Y & 65535)<<16));
                extra=" region="+kind+" corner="+PtInRegion(region,r.Right-r.Left-inset,inset)+" hit="+SendMessage(window,0x84,IntPtr.Zero,packed)+" target="+WindowFromPoint(p);
                DeleteObject(region);
            }
            found.Add(window+" "+process+" "+thread+" "+name+extra);
            return true;
        },IntPtr.Zero);
        return found.ToArray();
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
if ($Action -eq 'inspectChildren') {
    @{browserChildren=[MiniProbe]::Children($browser);controlChildren=[MiniProbe]::Children($controls);processId=$AppProcessId} | ConvertTo-Json -Compress
    return
}

if ($Action -in @('inspectDevtools','closeDevtools')) {
    # Only inspect this test application's process tree, never other browsers.
    $processes=Get-CimInstance Win32_Process
    $ownedIds=New-Object 'System.Collections.Generic.HashSet[uint32]'
    [void]$ownedIds.Add([uint32]$AppProcessId)
    do {
        $previousCount=$ownedIds.Count
        foreach ($runtime in $processes) {
            if ($ownedIds.Contains([uint32]$runtime.ParentProcessId)) { [void]$ownedIds.Add([uint32]$runtime.ProcessId) }
        }
    } while ($ownedIds.Count -gt $previousCount)
    $tools=@(foreach ($ownedId in $ownedIds) {
        foreach ($entry in [MiniProbe]::Find($ownedId).GetEnumerator()) {
            if ($entry.Key -match 'DevTools|开发人员工具|开发者工具' -and [MiniProbe]::IsWindowVisible($entry.Value)) {
                @{title=$entry.Key; processId=$ownedId}
                if ($Action -eq 'closeDevtools') { [void][MiniProbe]::SendMessage($entry.Value,0x10,[IntPtr]::Zero,[IntPtr]::Zero) }
            }
        }
    })
    @{devtools=$tools} | ConvertTo-Json -Compress -Depth 4
    return
}

$monitorInfo=New-Object MiniProbe+MONITORINFO
$monitorInfo.Size=[Runtime.InteropServices.Marshal]::SizeOf($monitorInfo)
[void][MiniProbe]::GetMonitorInfo([MiniProbe]::MonitorFromWindow($browser,2),[ref]$monitorInfo)
if ($Action -like 'zoom*' -or $Action -eq 'scrollPage') {
    $targetWindow=if($Action -eq 'zoomControl'){$controls}else{$browser}
    $inputRect=New-Object MiniProbe+RECT
    [void][MiniProbe]::GetWindowRect($targetWindow,[ref]$inputRect)
    $inputScale=[MiniProbe]::GetDpiForWindow($targetWindow)/96.0
    $previousCursor=New-Object MiniProbe+POINT
    [void][MiniProbe]::GetCursorPos([ref]$previousCursor)
    $ctrl=$Action -ne 'scrollPage'
    try {
        [void][MiniProbe]::SetForegroundWindow($targetWindow)
        [void][MiniProbe]::SetCursorPos([int]($inputRect.Left+$ClickX*$inputScale),[int]($inputRect.Top+$ClickY*$inputScale))
        [System.Threading.Thread]::Sleep(100)
        if ($Action -ne 'zoomControl') {
            [MiniProbe]::mouse_event(2,0,0,0,[UIntPtr]::Zero)
            [MiniProbe]::mouse_event(4,0,0,0,[UIntPtr]::Zero)
        }
        if ($ctrl) { [MiniProbe]::keybd_event(0x11,0,0,[UIntPtr]::Zero); [System.Threading.Thread]::Sleep(50) }
        if ($Action -in @('zoomReset','zoomPlus','zoomMinus')) {
            $key=if($Action -eq 'zoomReset'){0x30}elseif($Action -eq 'zoomPlus'){0xBB}else{0xBD}
            [MiniProbe]::keybd_event($key,0,0,[UIntPtr]::Zero)
            [MiniProbe]::keybd_event($key,0,2,[UIntPtr]::Zero)
            [System.Threading.Thread]::Sleep(50)
        } else {
            [uint32]$wheel=if($Action -in @('zoomOut','scrollPage')){4294967176}else{120}
            for ($tick=0;$tick -lt $WheelTicks;$tick++) {
                [MiniProbe]::mouse_event(0x800,0,0,$wheel,[UIntPtr]::Zero)
                [System.Threading.Thread]::Sleep(60)
            }
        }
    } finally {
        if ($ctrl) { [MiniProbe]::keybd_event(0x11,0,2,[UIntPtr]::Zero) }
        [void][MiniProbe]::SetCursorPos($previousCursor.X,$previousCursor.Y)
    }
} elseif ($Action -eq 'captureWindow') {
    Add-Type -AssemblyName System.Drawing
    $captureRect=New-Object MiniProbe+RECT
    [void][MiniProbe]::GetWindowRect($browser,[ref]$captureRect)
    $captureImage=New-Object System.Drawing.Bitmap(($captureRect.Right-$captureRect.Left),($captureRect.Bottom-$captureRect.Top))
    $captureGraphics=[System.Drawing.Graphics]::FromImage($captureImage)
    try {
        $captureGraphics.CopyFromScreen($captureRect.Left,$captureRect.Top,0,0,$captureImage.Size)
        $captureImage.Save((Join-Path (Split-Path -Parent $ExecutablePath) 'rounded-window.png'))
    } finally { $captureGraphics.Dispose(); $captureImage.Dispose() }
} elseif ($Action -eq 'openTrayMenu') {
    $tray=[MiniProbe]::FindTray($AppProcessId)
    if ($tray -eq [IntPtr]::Zero) { throw 'Tray host not found' }
    # tray-icon 0.21.3's registered Shell notification message, delivered only
    # to this test process. Exercise the real tray menu and its normal handler.
    [void][MiniProbe]::PostMessage($tray,6002,[IntPtr]::Zero,[IntPtr]0x205)
    for ($attempt=0;$attempt -lt 30;$attempt++) {
        if ([MiniProbe]::FindPopup($AppProcessId) -ne [IntPtr]::Zero) { break }
        [System.Threading.Thread]::Sleep(50)
    }
} elseif ($Action -in @('rightClickPage','rightClickControl','ctrlClickPage','middleClickPage','clickPage')) {
    $rect=New-Object MiniProbe+RECT
    $targetWindow=if($Action -eq 'rightClickControl'){$controls}else{$browser}
    [void][MiniProbe]::GetWindowRect($targetWindow,[ref]$rect)
    $scale=[MiniProbe]::GetDpiForWindow($browser)/96.0
    [void][MiniProbe]::SetCursorPos([int]($rect.Left+$ClickX*$scale),[int]($rect.Top+$ClickY*$scale))
    [System.Threading.Thread]::Sleep(120)
    [void][MiniProbe]::SetForegroundWindow($targetWindow)
    if($Action -eq 'ctrlClickPage'){[MiniProbe]::keybd_event(0x11,0,0,[UIntPtr]::Zero);[System.Threading.Thread]::Sleep(80)}
    $down=if($Action -eq 'middleClickPage'){32}elseif($Action -in @('clickPage','ctrlClickPage')){2}else{8}
    $up=if($Action -eq 'middleClickPage'){64}elseif($Action -in @('clickPage','ctrlClickPage')){4}else{16}
    try {
        [MiniProbe]::mouse_event($down,0,0,0,[UIntPtr]::Zero)
        [System.Threading.Thread]::Sleep(80)
    } finally {
        [MiniProbe]::mouse_event($up,0,0,0,[UIntPtr]::Zero)
        if($Action -eq 'ctrlClickPage'){[MiniProbe]::keybd_event(0x11,0,2,[UIntPtr]::Zero)}
    }
} elseif ($Action -eq 'clickOutsideMenu') {
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
} elseif ($Action -like 'menu*' -or $Action -eq 'trayReset') {
    $index=0
    if ($Action -eq 'trayReset') { $index=1 }
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
} elseif ($Action -eq 'resize' -or $Action -eq 'minimumResize') {
    $scale=[MiniProbe]::GetDpiForWindow($browser)/96.0
    $targetWidth=560; $targetHeight=500
    if ($Action -eq 'minimumResize') { $targetWidth=280; $targetHeight=200 }
    [void][MiniProbe]::SetWindowPos($browser,[IntPtr]::Zero,0,0,[int]($targetWidth*$scale),[int]($targetHeight*$scale),0x16)
} elseif ($Action -eq 'clickGear' -or $Action -eq 'dragToolbar' -or $Action -eq 'edgeResize' -or $Action -like 'cornerResize*') {
    $rect=New-Object MiniProbe+RECT
    [void][MiniProbe]::GetWindowRect($controls,[ref]$rect)
    if ($Action -eq 'edgeResize' -or $Action -like 'cornerResize*') { [void][MiniProbe]::GetWindowRect($browser,[ref]$rect) }
    $cursor=New-Object MiniProbe+POINT
    [void][MiniProbe]::GetCursorPos([ref]$cursor)
    $x=$rect.Left+($rect.Right-$rect.Left)/2
    $y=$rect.Top+($rect.Bottom-$rect.Top)/2
    $scale=[MiniProbe]::GetDpiForWindow($browser)/96.0
    if ($Action -eq 'dragToolbar' -and $PSBoundParameters.ContainsKey('ClickX')) { $x=$rect.Left+$ClickX*$scale; $y=$rect.Top+$ClickY*$scale }
    if ($Action -eq 'clickGear') { $x=$rect.Left+20*$scale }
    if ($Action -eq 'edgeResize') { $x=$rect.Right-2 }
    $moveX=65; $moveY=45
    if ($Action -like 'cornerResize*') {
        $leftCorner=$Action.EndsWith('L'); $topCorner=$Action.EndsWith('TL') -or $Action.EndsWith('TR')
        $resizeInset=if($PSBoundParameters.ContainsKey('ClickX')){$ClickX}else{12}
        $x=if($leftCorner){$rect.Left+$resizeInset*$scale}else{$rect.Right-$resizeInset*$scale}
        $y=if($topCorner){$rect.Top+$resizeInset*$scale}else{$rect.Bottom-$resizeInset*$scale}
        if($leftCorner){$moveX=-65}; if($topCorner){$moveY=-45}
    }
    try {
        [void][MiniProbe]::SetCursorPos([int]$x,[int]$y)
        [System.Threading.Thread]::Sleep(100)
        [MiniProbe]::mouse_event(2,0,0,0,[UIntPtr]::Zero)
        if ($Action -ne 'clickGear') {
            [System.Threading.Thread]::Sleep($(if($Action -like 'cornerResize*'){150}else{40}))
            [void][MiniProbe]::SetCursorPos([int]$x+[int]($moveX/5),[int]$y+[int]($moveY/5))
            [System.Threading.Thread]::Sleep(180)
            [void][MiniProbe]::SetCursorPos([int]$x+$moveX,[int]$y+$moveY)
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
    $region=[MiniProbe]::CreateRectRgn(0,0,0,0)
    try {
        $kind=[MiniProbe]::GetWindowRgn($entry.Value,$region)
        $width=$rect.Right-$rect.Left; $height=$rect.Bottom-$rect.Top
        $output[$entry.Key].regionKind=$kind
        $output[$entry.Key].cornersInside=@([MiniProbe]::PtInRegion($region,1,1),[MiniProbe]::PtInRegion($region,($width-2),1),[MiniProbe]::PtInRegion($region,1,($height-2)),[MiniProbe]::PtInRegion($region,($width-2),($height-2)))
        $output[$entry.Key].centerInside=[MiniProbe]::PtInRegion($region,([int]($width/2)),([int]($height/2)))
        $inset=0; while ($inset -lt [int]($width/2) -and -not [MiniProbe]::PtInRegion($region,$inset,1)) { $inset++ }
        $output[$entry.Key].cornerTopInset=$inset
        $testPoint=New-Object MiniProbe+POINT; $testPoint.X=$rect.Left+1; $testPoint.Y=$rect.Top+1
        $cornerWindow=[MiniProbe]::WindowFromPoint($testPoint)
        $cornerWindow=[MiniProbe]::GetAncestor($cornerWindow,2)
        $output[$entry.Key].cornerHitsApp=($cornerWindow -eq $browser -or $cornerWindow -eq $controls)
        $output[$entry.Key].scale=[MiniProbe]::GetDpiForWindow($entry.Value)/96.0
        $sampleX=[int]($ClickX*$output[$entry.Key].scale); $sampleY=[int]($ClickY*$output[$entry.Key].scale)
        $output[$entry.Key].sampleInside=[MiniProbe]::PtInRegion($region,$sampleX,$sampleY)
        $samplePoint=New-Object MiniProbe+POINT; $samplePoint.X=$rect.Left+$sampleX; $samplePoint.Y=$rect.Top+$sampleY
        $sampleWindow=[MiniProbe]::GetAncestor([MiniProbe]::WindowFromPoint($samplePoint),2)
        $output[$entry.Key].sampleHitsControl=($sampleWindow -eq $controls)
    } finally { [void][MiniProbe]::DeleteObject($region) }
}
$output | ConvertTo-Json -Compress
