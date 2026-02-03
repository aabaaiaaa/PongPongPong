@echo off
echo Adding firewall rule for 4-Player Pong...
netsh advfirewall firewall add rule name="4-Player Pong" dir=in action=allow protocol=TCP localport=3000
echo.
echo Firewall rule added successfully!
echo.
echo You can now connect from other devices using:
echo http://192.168.1.171:3000
echo.
pause
