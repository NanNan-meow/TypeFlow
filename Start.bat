@echo off
setlocal
cd /d "%~dp0"
title TypeFlow - Local Typing Studio
where python >nul 2>nul
if errorlevel 1 goto try_py
python -c "import sys; assert sys.version_info >= (3, 10)" >nul 2>nul
if errorlevel 1 goto try_py
python launcher.py %*
if errorlevel 1 pause
exit /b
:try_py
where py >nul 2>nul
if errorlevel 1 goto missing
py -3 -c "import sys; assert sys.version_info >= (3, 10)" >nul 2>nul
if errorlevel 1 goto missing
py -3 launcher.py %*
if errorlevel 1 pause
exit /b
:missing
echo Python 3.10 or newer is required. Install Python and enable Add to PATH.
pause
