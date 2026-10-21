@echo off
chcp 65001 >nul
cd /d "%~dp0"
if exist "%~dp0runtime\node.exe" (
  "%~dp0runtime\node.exe" "%~dp0src\app.mjs"
) else (
  node "%~dp0src\app.mjs"
)
if errorlevel 1 pause
