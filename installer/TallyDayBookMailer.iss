; Inno Setup Script for TallyDayBookMailer
; Requires Inno Setup 6.0 or later

#define MyAppName "TallyDayBookMailer"
#define MyAppVersion "1.0.0"
#define MyAppPublisher "RANJITH-v-cst"
#define MyAppURL "http://127.0.0.1:9095"
#define MyAppExeName "tallydaybook.exe"

[Setup]
AppId={{8B84F074-912A-4D46-A484-9FD9C694F9C2}}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
AppUpdatesURL={#MyAppURL}
DefaultDirName={autopf}\{#MyAppName}
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir=output
OutputBaseFilename=TallyDayBookMailer-Setup
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Files]
Source: "stage\dist\*"; DestDir: "{app}\dist"; Flags: recursesubdirs createallsubdirs ignoreversion
Source: "stage\node_modules\*"; DestDir: "{app}\node_modules"; Flags: recursesubdirs createallsubdirs ignoreversion
Source: "stage\package.json"; DestDir: "{app}"; Flags: ignoreversion
Source: "stage\config.sample.json"; DestDir: "{app}"; Flags: ignoreversion
Source: "stage\tallydaybook.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "run-hidden.vbs"; DestDir: "{app}"; Flags: ignoreversion

[INI]
Filename: "{app}\Control Center.url"; Section: "InternetShortcut"; Key: "URL"; String: "{#MyAppURL}"
Filename: "{autodesktop}\TallyDayBook Control Center.url"; Section: "InternetShortcut"; Key: "URL"; String: "{#MyAppURL}"
Filename: "{autoprograms}\{#MyAppName}\Open Control Center.url"; Section: "InternetShortcut"; Key: "URL"; String: "{#MyAppURL}"

[Icons]
Name: "{autoprograms}\{#MyAppName}\Start Mailer"; Filename: "wscript.exe"; Parameters: """{app}\run-hidden.vbs"""; WorkingDir: "{app}"
Name: "{autoprograms}\{#MyAppName}\Stop Mailer"; Filename: "taskkill.exe"; Parameters: "/F /IM tallydaybook.exe"; WorkingDir: "{app}"
Name: "{autoprograms}\{#MyAppName}\Uninstall {#MyAppName}"; Filename: "{uninstallexe}"
Name: "{userstartup}\{#MyAppName}"; Filename: "wscript.exe"; Parameters: """{app}\run-hidden.vbs"""; WorkingDir: "{app}"

[Run]
Filename: "wscript.exe"; Parameters: """{app}\run-hidden.vbs"""; Description: "Start {#MyAppName} now"; Flags: postinstall nowait skipifsilent; WorkingDir: "{app}"
Filename: "{#MyAppURL}"; Description: "Open Web Control Center (http://127.0.0.1:9095)"; Flags: postinstall shellexec nowait skipifsilent unchecked

[UninstallRun]
Filename: "taskkill.exe"; Parameters: "/F /IM tallydaybook.exe"; Flags: runhidden; RunOnceId: "StopMailer"

[UninstallDelete]
Type: files; Name: "{autodesktop}\TallyDayBook Control Center.url"
Type: files; Name: "{app}\Control Center.url"
Type: files; Name: "{app}\config.json"
Type: files; Name: "{app}\state.json"
Type: files; Name: "{app}\.key"
Type: filesandordirs; Name: "{app}\logs"
Type: filesandordirs; Name: "{app}\exports"

[Code]
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ResultCode: Integer;
begin
  Exec('taskkill.exe', '/F /IM tallydaybook.exe', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  Result := '';
end;

