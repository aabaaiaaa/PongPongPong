@echo off
echo ================================================
echo Setting up 4-Player Pong on Port 80
echo ================================================
echo.

echo Step 1: Stopping IIS (if running)...
iisreset /stop
echo.

echo Step 2: Starting your game on port 80...
cd /d "%~dp0"
pm2 delete 4PlayerPong 2>nul
pm2 start server.js --name "4PlayerPong"
pm2 save
echo.

echo Step 3: Checking status...
pm2 status
echo.

echo ================================================
echo Done! Your game should now be running on port 80
echo.
echo Access at:
echo - http://localhost
echo - http://192.168.1.171
echo ================================================
echo.
pause
