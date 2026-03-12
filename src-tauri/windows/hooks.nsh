; File association hooks for Marka
; Registers .md and .markdown extensions on install, removes on uninstall

!macro NSIS_HOOK_POSTINSTALL
  ; Register .md
  WriteRegStr HKCU "Software\Classes\.md\OpenWithProgids" "Marka.md" ""
  WriteRegStr HKCU "Software\Classes\Marka.md" "" "Markdown Document"
  WriteRegStr HKCU "Software\Classes\Marka.md\DefaultIcon" "" "$INSTDIR\marka.exe,0"
  WriteRegStr HKCU "Software\Classes\Marka.md\shell\open\command" "" '"$INSTDIR\marka.exe" "%1"'

  ; Register .markdown
  WriteRegStr HKCU "Software\Classes\.markdown\OpenWithProgids" "Marka.markdown" ""
  WriteRegStr HKCU "Software\Classes\Marka.markdown" "" "Markdown Document"
  WriteRegStr HKCU "Software\Classes\Marka.markdown\DefaultIcon" "" "$INSTDIR\marka.exe,0"
  WriteRegStr HKCU "Software\Classes\Marka.markdown\shell\open\command" "" '"$INSTDIR\marka.exe" "%1"'

  ; Register in Applications key (for "Open with" dialog)
  WriteRegStr HKCU "Software\Classes\Applications\marka.exe\shell\open\command" "" '"$INSTDIR\marka.exe" "%1"'
  WriteRegStr HKCU "Software\Classes\Applications\marka.exe\SupportedTypes" ".md" ""
  WriteRegStr HKCU "Software\Classes\Applications\marka.exe\SupportedTypes" ".markdown" ""

  ; Notify shell of changes
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0x0000, p 0, p 0)'
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  ; Remove .md association
  DeleteRegValue HKCU "Software\Classes\.md\OpenWithProgids" "Marka.md"
  DeleteRegKey HKCU "Software\Classes\Marka.md"

  ; Remove .markdown association
  DeleteRegValue HKCU "Software\Classes\.markdown\OpenWithProgids" "Marka.markdown"
  DeleteRegKey HKCU "Software\Classes\Marka.markdown"

  ; Remove Applications key
  DeleteRegKey HKCU "Software\Classes\Applications\marka.exe"

  ; Notify shell of changes
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0x0000, p 0, p 0)'
!macroend
