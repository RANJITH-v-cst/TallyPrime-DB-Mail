@echo off
setlocal enabledelayedexpansion

echo ===================================================
echo     TallyDayBookMailer - Installer Build Script
echo ===================================================
echo.

cd /d "%~dp0\.."
set "ROOT_DIR=%CD%"
echo Working Directory: %ROOT_DIR%
echo.

REM --- Step 1: Build TypeScript project ---
echo [1/6] Building project (npm run build)...
call npm run build
if %errorlevel% neq 0 (
    echo [ERROR] Project build failed. Aborting.
    exit /b %errorlevel%
)

REM --- Step 2: Prepare Stage Directory ---
echo.
echo [2/6] Preparing installer\stage directory...
if exist "installer\stage" (
    echo Removing old stage directory...
    rd /s /q "installer\stage"
)
mkdir "installer\stage"
if %errorlevel% neq 0 (
    echo [ERROR] Failed to create installer\stage.
    exit /b %errorlevel%
)

echo Copying built files to stage...
xcopy /s /e /i /y "dist" "installer\stage\dist" >nul
copy /y "package.json" "installer\stage\" >nul
copy /y "package-lock.json" "installer\stage\" >nul
copy /y "config.sample.json" "installer\stage\" >nul

REM --- Step 3: Install Production Dependencies Only in Stage ---
echo.
echo [3/6] Installing production dependencies in stage (npm ci --omit=dev)...
cd /d "%ROOT_DIR%\installer\stage"
call npm ci --omit=dev
if %errorlevel% neq 0 (
    echo [ERROR] Failed to install production dependencies in stage.
    cd /d "%ROOT_DIR%"
    exit /b %errorlevel%
)
cd /d "%ROOT_DIR%"

REM --- Step 4: Bundle Node.js Runtime ---
echo.
echo [4/6] Bundling Node.js runtime as tallydaybook.exe...
set "NODE_EXE="
for /f "delims=" %%I in ('where node.exe 2^>nul') do (
    if not defined NODE_EXE set "NODE_EXE=%%I"
)
if not defined NODE_EXE if exist "C:\Program Files\nodejs\node.exe" set "NODE_EXE=C:\Program Files\nodejs\node.exe"

if not defined NODE_EXE (
    echo [ERROR] node.exe not found on PATH or in C:\Program Files\nodejs.
    exit /b 1
)
echo Found node.exe at: %NODE_EXE%
copy /y "%NODE_EXE%" "installer\stage\tallydaybook.exe" >nul
if %errorlevel% neq 0 (
    echo [ERROR] Failed to copy node.exe to installer\stage\tallydaybook.exe.
    exit /b %errorlevel%
)

REM --- Step 5: Locate Inno Setup Compiler ---
echo.
echo [5/6] Locating Inno Setup 6 compiler...
set "ISCC="
if exist "%LOCALAPPDATA%\Programs\Inno Setup 6\ISCC.exe" set "ISCC=%LOCALAPPDATA%\Programs\Inno Setup 6\ISCC.exe"
if not defined ISCC if exist "%ProgramFiles%\Inno Setup 6\ISCC.exe" set "ISCC=%ProgramFiles%\Inno Setup 6\ISCC.exe"
if not defined ISCC if exist "C:\Program Files (x86)\Inno Setup 6\ISCC.exe" set "ISCC=C:\Program Files (x86)\Inno Setup 6\ISCC.exe"
if not defined ISCC (
    for /f "delims=" %%I in ('where ISCC.exe 2^>nul') do (
        if not defined ISCC set "ISCC=%%I"
    )
)

if not defined ISCC (
    echo.
    echo [ERROR] Inno Setup 6 compiler was not found!
    echo Please install Inno Setup 6 from: https://jrsoftware.org/isdl.php
    exit /b 1
)
echo Found Inno Setup Compiler: %ISCC%

REM --- Step 6: Compile Installer ---
echo.
echo [6/6] Compiling installer with Inno Setup...
if not exist "installer\output" mkdir "installer\output"

"%ISCC%" "installer\TallyDayBookMailer.iss"
if %errorlevel% neq 0 (
    echo [ERROR] Inno Setup compilation failed!
    exit /b %errorlevel%
)

echo.
echo ===================================================
echo     BUILD COMPLETED SUCCESSFULLY
echo ===================================================
if exist "installer\output\TallyDayBookMailer-Setup.exe" (
    echo Output File : %ROOT_DIR%\installer\output\TallyDayBookMailer-Setup.exe
    for %%F in ("installer\output\TallyDayBookMailer-Setup.exe") do (
        echo File Size   : %%~zF bytes
    )
    echo.
    echo You can now distribute TallyDayBookMailer-Setup.exe to any client PC.
) else (
    echo [WARNING] Setup file not found at expected location.
)
echo.
