@echo off
setlocal EnableDelayedExpansion

echo ===================================================
echo   XianxiaForge - AI Novel Creation System
echo ===================================================
echo.

cd /d "%~dp0"

:: --- 1. Check Node.js ---
echo [1/6] Checking Node.js ...
where node >nul 2>&1
if %errorlevel% neq 0 goto :no_node
for /f "tokens=*" %%v in ('node -v') do set NODE_VER=%%v
echo        Node.js %NODE_VER% [OK]
echo.
goto :step2

:no_node
echo [ERROR] Node.js not found. Install from: https://nodejs.org/
echo         Recommended: v20 LTS or higher
pause
exit /b 1

:: --- 2. Check pnpm ---
:step2
echo [2/6] Checking pnpm ...
where pnpm >nul 2>&1
if %errorlevel% equ 0 goto :pnpm_ok
echo [INFO] pnpm not found, installing...
call npm install -g pnpm
where pnpm >nul 2>&1
if %errorlevel% neq 0 goto :no_pnpm
goto :pnpm_ok

:no_pnpm
echo [ERROR] pnpm install failed. Try manually: npm install -g pnpm
pause
exit /b 1

:pnpm_ok
for /f "tokens=*" %%v in ('pnpm -v') do set PNPM_VER=%%v
echo        pnpm %PNPM_VER% [OK]
echo.

:: --- 3. Check PostgreSQL ---
echo [3/6] Checking PostgreSQL ...
where pg_isready >nul 2>&1
if %errorlevel% neq 0 goto :skip_pg_check
pg_isready -h localhost -p 5432 >nul 2>&1
if %errorlevel% neq 0 goto :no_pg
echo        PostgreSQL running [OK]
goto :step4

:no_pg
echo [ERROR] PostgreSQL is not running
echo         Try: net start postgresql-x64-16
echo         Or start it from Windows Services
pause
exit /b 1

:skip_pg_check
echo [WARN] pg_isready not found, skipping DB check
echo        Make sure PostgreSQL is running

:: --- 4. Init database ---
:step4
echo.
echo [4/6] Initializing creative database ...
if not exist ".env" (
    if exist ".env.example" (
        copy ".env.example" ".env" >nul
        echo        Created .env from .env.example
    )
)

if exist "node_modules\pg" (
    node scripts/init-db.mjs
) else (
    echo        Skipping DB init, deps not installed yet
    set NEED_DB_INIT=1
)
echo.

:: --- 5. Install dependencies ---
echo [5/6] Installing dependencies ...
call pnpm install
if %errorlevel% equ 0 goto :deps_ok
if exist "node_modules\.pnpm" goto :deps_ok
goto :no_deps

:deps_ok
echo        Dependencies installed [OK]

if defined NEED_DB_INIT (
    echo        Initializing database...
    node scripts/init-db.mjs
)
echo.
goto :step6

:no_deps
echo [ERROR] Dependency install failed
pause
exit /b 1

:: --- 6. Start services ---
:step6
echo [6/6] Starting frontend and backend ...
echo.
echo ===================================================
echo   Frontend: http://localhost:5173
echo   Backend:  http://localhost:3456
echo   Press Ctrl+C to stop
echo ===================================================
echo.

:: Open browser after frontend starts
start http://localhost:5173

:: Start dev servers
call pnpm dev

endlocal