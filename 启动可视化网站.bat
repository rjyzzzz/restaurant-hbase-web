@echo off
setlocal
cd /d "%~dp0"
echo Starting Shanghai Restaurant HBase Spatial Visualization Server...
python server.py --port 8080
pause
endlocal
