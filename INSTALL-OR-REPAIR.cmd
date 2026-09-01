@echo off
setlocal
set "SCRIPT_DIR=%~dp0"
set "REPAIR_PS1=%SCRIPT_DIR%scripts\install-or-repair.ps1"

if not exist "%REPAIR_PS1%" (
  echo [ERROR] Repair script not found: "%REPAIR_PS1%"
  pause
  exit /b 1
)

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%REPAIR_PS1%"
set "EXIT_CODE=%ERRORLEVEL%"

if not "%EXIT_CODE%"=="0" (
  echo.
  echo [ERROR] Repair failed with exit code %EXIT_CODE%.
  pause
)

exit /b %EXIT_CODE%
