' Starts the Gap <-> Claude bridge (via its supervisor) without a window, logging to bridge.log.
Set sh = CreateObject("WScript.Shell")
dir = "C:\Users\M.H.Rashadi\gap-claude-bridge"
sh.CurrentDirectory = dir
' Rotate the log at start (it cannot be renamed while the supervisor holds it): keep one old copy, ~2 MB max.
Set fso = CreateObject("Scripting.FileSystemObject")
logf = dir & "\bridge.log"
If fso.FileExists(logf) Then
  If fso.GetFile(logf).Size > 2000000 Then
    If fso.FileExists(logf & ".1") Then fso.DeleteFile logf & ".1"
    fso.MoveFile logf, logf & ".1"
  End If
End If
sh.Run "cmd /c node supervisor.mjs >> """ & dir & "\bridge.log"" 2>&1", 0, False
