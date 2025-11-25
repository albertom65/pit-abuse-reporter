@echo off
setlocal

set XPI=pit-abuse-reporter.xpi

if exist "%XPI%" del "%XPI%"

REM Crea XPI usando 7-Zip (compressione STORE = zero modifiche ai file)
"C:\Program Files\7-Zip\7z.exe" a -tzip "%XPI%" ^
    background.js ^
    popup.js ^
    popup.html ^
    manifest.json ^
    icon16.png ^
    icon32.png ^
    icon48.png ^
    icon64.png ^
    options.html ^
    options.js ^
    -mx=0

echo -----------------------------------------
echo   Build completato correttamente: %XPI%
echo -----------------------------------------
pause
