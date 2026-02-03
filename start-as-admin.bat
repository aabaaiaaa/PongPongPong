@echo off
echo Restarting 4-Player Pong on port 80 with administrator privileges...
echo.

cd /d "%~dp0"

pm2 delete 4PlayerPong
pm2 start server.js --name "4PlayerPong"
pm2 save

echo.
echo Game is now running on port 80!
echo.
echo Access at:
echo - http://localhost
echo - http://192.168.1.171
echo.
pause
