' Hermes Workspace Launcher v3
' Starts Dashboard and Workspace without waiting on a fragile port probe.
' The Startup shim calls this file at sign-in.
Option Explicit

Dim sh, fso, q, hermesPath, pnpmPath, workDir, logFile
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
q = Chr(34)

hermesPath = "C:\Users\Peter-B\AppData\Local\hermes\hermes-agent\venv\Scripts\hermes.exe"
pnpmPath  = "C:\Users\Peter-B\AppData\Roaming\npm\pnpm.cmd"
workDir   = "C:\Users\Peter-B\hermes-workspace"
logFile   = sh.ExpandEnvironmentStrings("%TEMP%") & "\hermes-workspace-launcher.log"

Log "=== Hermes Workspace Launcher starting at " & Now & " ==="

' Dashboard is normally started by Hermes Desktop. Start it asynchronously as a
' fallback, but do not wait for its build or run a blocking netstat probe.
RunHidden q & hermesPath & q & " dashboard --port 9119 --host 127.0.0.1 --no-open"
Log "Dashboard launch requested on port 9119"

' Start Workspace independently. Vite enforces port 3000 in vite.config.ts.
' Direct WScript.Shell execution avoids nested cmd.exe quoting failures.
sh.CurrentDirectory = workDir
sh.Environment("PROCESS")("PORT") = "3000"
RunHidden q & pnpmPath & q & " dev"
Log "Workspace launch requested on port 3000"
Log "=== Hermes Workspace Launcher handoff complete at " & Now & " ==="

Sub RunHidden(cmd)
    sh.Run cmd, 0, False
End Sub

Sub Log(msg)
    On Error Resume Next
    Dim f
    Set f = fso.OpenTextFile(logFile, 8, True)
    f.WriteLine Now & "  " & msg
    f.Close
    Set f = Nothing
    On Error GoTo 0
End Sub
