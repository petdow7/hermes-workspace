' Hermes Workspace Launcher v2
' Starts the dashboard (prerequisite) and the Workspace dev server
' Runs hidden on Windows boot via Startup folder shim
' Logs startup output to %TEMP%\hermes-workspace-launcher.log

Option Explicit

Dim hermesPath, pnpmPath, workDir, logFile, fso

' --- Paths ---
hermesPath = "C:\Users\Peter-B\AppData\Local\hermes\hermes-agent\venv\Scripts\hermes.exe"
pnpmPath  = "C:\Users\Peter-B\AppData\Roaming\npm\pnpm.cmd"
workDir   = "C:\Users\Peter-B\hermes-workspace"
logFile   = CreateObject("WScript.Shell").ExpandEnvironmentStrings("%TEMP%") & "\hermes-workspace-launcher.log"

Set fso = CreateObject("Scripting.FileSystemObject")

Log "=== Hermes Workspace Launcher starting at " & Now & " ==="

' --- Step 1: Start Hermes Dashboard (port 9119) ---
If IsPortListening(9119) Then
    Log "Dashboard already listening on port 9119 — skipping"
Else
    Log "Starting dashboard on port 9119..."
    RunHidden "cmd.exe /c """"" & hermesPath & """ dashboard --port 9119 --host 127.0.0.1 --no-open >> """ & logFile & """ 2>&1"""
    WScript.Sleep 4000
    If IsPortListening(9119) Then
        Log "Dashboard started successfully"
    Else
        Log "WARNING: Dashboard may not have started — port 9119 not listening after 4s"
    End If
End If

' --- Step 2: Kill stale workspace if port 3000 is in use by a node process ---
If IsPortListening(3000) Then
    Log "Port 3000 already in use — checking if it's a stale workspace..."
    KillProcessOnPort 3000
    WScript.Sleep 2000
End If

' --- Step 3: Start Workspace dev server (port 3000) ---
Log "Starting Workspace on port 3000..."
RunHidden "cmd.exe /c ""cd /d " & workDir & " && set PORT=3000 && """ & pnpmPath & """ dev >> """ & logFile & """ 2>&1"""
WScript.Sleep 5000
If IsPortListening(3000) Then
    Log "Workspace started successfully on port 3000"
Else
    Log "WARNING: Workspace may not have started — port 3000 not listening after 5s"
End If

Log "=== Hermes Workspace Launcher finished at " & Now & " ==="

Set fso = Nothing

' --- Helpers ---

Sub RunHidden(cmd)
    Dim shell
    Set shell = CreateObject("WScript.Shell")
    shell.Run cmd, 0, False
    Set shell = Nothing
End Sub

Function IsPortListening(port)
    ' Matches any bind address (0.0.0.0, 127.0.0.1, [::]) on the given port
    Dim shell, exec, output, exitCode
    Set shell = CreateObject("WScript.Shell")
    exitCode = shell.Run("cmd.exe /c netstat -ano | findstr "":"" & port & "" "" | findstr LISTENING > nul", 0, True)
    Set shell = Nothing
    IsPortListening = (exitCode = 0)
End Function

Sub KillProcessOnPort(port)
    ' Kill the node.exe process listening on this port (stale workspace)
    Dim shell, exec, output, pid, lines, line, parts
    Set shell = CreateObject("WScript.Shell")
    Set exec = shell.Exec("cmd.exe /c netstat -ano | findstr "":"" & port & "" "" | findstr LISTENING")
    output = exec.StdOut.ReadAll
    Set exec = Nothing
    If Len(output) > 0 Then
        lines = Split(output, vbCrLf)
        For Each line In lines
            If Len(Trim(line)) > 0 Then
                parts = Split(Trim(line), " ")
                pid = parts(UBound(parts))
                If IsNumeric(pid) And CLng(pid) > 0 Then
                    Log "Killing stale process on port " & port & " (PID " & pid & ")"
                    shell.Run "cmd.exe /c taskkill /F /PID " & pid & " > nul 2>&1", 0, True
                End If
            End If
        Next
    End If
    Set shell = Nothing
End Sub

Sub Log(msg)
    On Error Resume Next
    Dim f
    Set f = fso.OpenTextFile(logFile, 8, True)  ' 8 = ForAppending, True = create if missing
    f.WriteLine Now & "  " & msg
    f.Close
    Set f = Nothing
    On Error GoTo 0
End Sub
