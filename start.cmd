@echo off
echo ===================================
echo Iris SYNCD - Starting All Services
echo ===================================
echo.

REM Check if node_modules exist
if not exist "node_modules" (
    echo Installing dependencies...
    call npm install
    echo.
)

REM Start server in background
echo Starting server...
start "Iris SYNCD Server" cmd /k "cd /d "%~dp0server" && npm run dev"

REM Wait for server to start
timeout /t 3 /nobreak >nul

REM Start host dashboard
echo Starting host dashboard...
start "Iris SYNCD Host Dashboard" cmd /k "cd /d "%~dp0host-dashboard" && npm run dev"

REM Start participant page
echo Starting participant page...
start "Iris SYNCD Participant" cmd /k "cd /d "%~dp0participant-page" && npm run dev"

echo.
echo ===================================
echo All services started!
echo ===================================
echo Server:        http://localhost:3001
echo Host Dashboard: http://localhost:5173
echo Participant:   http://localhost:5174
echo ===================================
echo.
echo Press any key to exit this window...
pause >nul
