# Makes the screen dark WITHOUT turning the display off (owner, 2026-11-18).
# Why: on this laptop (Modern Standby / S0 Low Power Idle) a real display-off sends Windows into Modern
# Standby within seconds: Wi-Fi disconnects and desktop processes (agents) get paused. So instead:
# brightness 0 + a black topmost full-screen window + a "display required" power request that keeps
# Windows out of standby. Any key, click or real mouse move closes it and restores brightness.
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
Add-Type -Name P -Namespace Dark -MemberDefinition '[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(int f);'

# ES_CONTINUOUS | ES_SYSTEM_REQUIRED | ES_DISPLAY_REQUIRED
[Dark.P]::SetThreadExecutionState(0x80000003) | Out-Null

$old = $null
try { $old = (Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightness -ErrorAction Stop | Select-Object -First 1).CurrentBrightness } catch {}
function Set-Bright($v) { try { Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightnessMethods -ErrorAction Stop | Invoke-CimMethod -MethodName WmiSetBrightness -Arguments @{ Timeout = 1; Brightness = [byte]$v } | Out-Null } catch {} }
Set-Bright 0

$b = [System.Windows.Forms.SystemInformation]::VirtualScreen
$f = New-Object System.Windows.Forms.Form
$f.FormBorderStyle = 'None'; $f.StartPosition = 'Manual'; $f.Bounds = $b
$f.BackColor = [System.Drawing.Color]::Black; $f.TopMost = $true; $f.ShowInTaskbar = $false
$f.KeyPreview = $true

$start = [System.Windows.Forms.Cursor]::Position
$armed = $false   # ignore input during the first second (the command itself may jiggle the mouse)
$t = New-Object System.Windows.Forms.Timer; $t.Interval = 1000
$t.Add_Tick({ $script:armed = $true; $script:start = [System.Windows.Forms.Cursor]::Position; $t.Stop() })
$close = { if ($script:armed) { $f.Close() } }
$f.Add_KeyDown($close); $f.Add_MouseDown($close)
$f.Add_MouseMove({
  $p = [System.Windows.Forms.Cursor]::Position
  if ($script:armed -and ([math]::Abs($p.X - $script:start.X) + [math]::Abs($p.Y - $script:start.Y)) -gt 15) { $f.Close() }
})
$f.Add_Shown({ [System.Windows.Forms.Cursor]::Hide(); $f.Activate(); $t.Start() })
$f.Add_FormClosed({
  [System.Windows.Forms.Cursor]::Show()
  if ($null -ne $old) { Set-Bright $old } else { Set-Bright 70 }
  [Dark.P]::SetThreadExecutionState(0x80000000) | Out-Null
})
[System.Windows.Forms.Application]::Run($f)
