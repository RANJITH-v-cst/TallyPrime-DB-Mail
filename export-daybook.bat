@echo off
setlocal
cd /d "c:\Users\ranji\OneDrive\Desktop\Tally Daybook Export Automatic"

if "%~1"=="" (
    echo [INFO] No dates specified. Exporting current day (Today)...
    node scripts\directExport.js
) else if "%~2"=="" (
    echo [INFO] Single date specified: %~1
    node scripts\directExport.js %~1 %~1
) else (
    echo [INFO] Date range specified: %~1 to %~2
    node scripts\directExport.js %~1 %~2
)

pause
