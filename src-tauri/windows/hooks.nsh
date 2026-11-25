; The installer closes a running dock by force, which leaves the Windows taskbar hidden.
; Each hook asks the installed exe to put it back (a no-op when it was not hidden).

!macro NSIS_HOOK_POSTINSTALL
  ExecWait '"$INSTDIR\${MAINBINARYNAME}.exe" --restore-taskbar'
!macroend

; runs before the template's own check, and the dock must be gone before restoring
!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro CheckIfAppIsRunning "$INSTDIR\${MAINBINARYNAME}.exe" "${PRODUCTNAME}"
  ExecWait '"$INSTDIR\${MAINBINARYNAME}.exe" --restore-taskbar'
!macroend
