Set fso = CreateObject("Scripting.FileSystemObject")
Set wshShell = CreateObject("WScript.Shell")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
wshShell.CurrentDirectory = scriptDir
exePath = """" & scriptDir & "\tallydaybook.exe"""
argPath = """" & scriptDir & "\dist\index.js"""
wshShell.Run exePath & " " & argPath, 0, False

