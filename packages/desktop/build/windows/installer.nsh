; Windows can keep a UserChoice pointing to this ProgId across upgrades.
!define AUTUMNMARK_PROGID "AutumnMark.Document"

; MUI2's default 50 DLU Next button clips the UAC shield icon and trailing ">"
; when localized labels (e.g. Simplified Chinese "下一步(N) >") carry BCM_SETSHIELD.
!define AUTUMNMARK_NEXT_BTN_EXTRA_DLU 18
!define MUI_CUSTOMFUNCTION_GUIINIT autumnmarkOnGuiInit
!ifdef BUILD_UNINSTALLER
  !define MUI_CUSTOMFUNCTION_UNGUIINIT un.autumnmarkOnGuiInit
!endif

!macro autumnmarkWidenNextButton
  Push $0
  Push $1
  Push $2
  Push $3
  Push $4
  Push $5
  Push $6

  System::Call "*(i 0, i 0, i ${AUTUMNMARK_NEXT_BTN_EXTRA_DLU}, i 0) p .r1"
  ${If} $1 != 0
    System::Call "user32::MapDialogRect(p $HWNDPARENT, p r1) i .r0"
    ${If} $0 != 0
      System::Call "*$1(i, i, i .r2, i)"
      ${If} $2 > 0
        ; Expand Next (ID 1) toward Back while keeping its outer edge aligned with Cancel.
        GetDlgItem $0 $HWNDPARENT 1
        ${If} $0 != 0
          System::Call "user32::GetWindowRect(p r0, p r1)"
          System::Call "user32::MapWindowPoints(p 0, p $HWNDPARENT, p r1, i 2)"
          System::Call "*$1(i .r3, i .r4, i .r5, i .r6)"
          IntOp $5 $5 - $3
          IntOp $6 $6 - $4
          IntOp $3 $3 - $2
          IntOp $5 $5 + $2
          ; SWP_NOZORDER | SWP_NOACTIVATE (0x0014)
          System::Call "user32::SetWindowPos(p r0, p 0, i r3, i r4, i r5, i r6, i 0x0014)"
        ${EndIf}

        ; Shift Back (ID 3) by the same delta so it never overlaps the wider Next button.
        GetDlgItem $0 $HWNDPARENT 3
        ${If} $0 != 0
          System::Call "user32::GetWindowRect(p r0, p r1)"
          System::Call "user32::MapWindowPoints(p 0, p $HWNDPARENT, p r1, i 2)"
          System::Call "*$1(i .r3, i .r4, i, i)"
          IntOp $3 $3 - $2
          ; SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE (0x0015)
          System::Call "user32::SetWindowPos(p r0, p 0, i r3, i r4, i 0, i 0, i 0x0015)"
        ${EndIf}
      ${EndIf}
    ${EndIf}
    System::Free $1
  ${EndIf}

  Pop $6
  Pop $5
  Pop $4
  Pop $3
  Pop $2
  Pop $1
  Pop $0
!macroend

!macro customHeader
  ; NSIS's bundled Chinese .nlf files use SimSun/PMingLiU 9pt, whose tmInternalLeading
  ; is 0 so Win32 STATIC controls pack adjacent lines tightly.
  !ifdef LANG_SIMPCHINESE
    SetFont /LANG=${LANG_SIMPCHINESE} "Microsoft YaHei UI" 9
  !endif
  !ifdef LANG_TRADCHINESE
    SetFont /LANG=${LANG_TRADCHINESE} "Microsoft JhengHei UI" 9
  !endif

  Function autumnmarkOnGuiInit
    !insertmacro autumnmarkWidenNextButton
  FunctionEnd

  !ifdef BUILD_UNINSTALLER
    Function un.autumnmarkOnGuiInit
      !insertmacro autumnmarkWidenNextButton
    FunctionEnd
  !endif
!macroend

; OpenWithProgids lets Explorer offer AutumnMark while preserving the user's default app.
!macro autumnmarkAssociateExtension EXT
  WriteRegNone SHELL_CONTEXT "Software\Classes\${EXT}\OpenWithProgids" "${AUTUMNMARK_PROGID}"
!macroend

!macro autumnmarkUnassociateExtension EXT
  DeleteRegValue SHELL_CONTEXT "Software\Classes\${EXT}\OpenWithProgids" "${AUTUMNMARK_PROGID}"
!macroend

!macro customInstall
  Push $0
  FileOpen $0 "$INSTDIR\resources\nsis-installed" w
  FileWrite $0 "NSIS"
  FileClose $0
  Pop $0

  !insertmacro autumnmarkAssociateExtension ".md"
  !insertmacro autumnmarkAssociateExtension ".markdown"
  !insertmacro autumnmarkAssociateExtension ".mmd"
  !insertmacro autumnmarkAssociateExtension ".mdown"
  !insertmacro autumnmarkAssociateExtension ".mdtxt"
  !insertmacro autumnmarkAssociateExtension ".mdtext"
  !insertmacro autumnmarkAssociateExtension ".mdx"

  WriteRegStr SHELL_CONTEXT "Software\Classes\${AUTUMNMARK_PROGID}" \
    "" "AutumnMark Markdown Document"
  WriteRegExpandStr SHELL_CONTEXT "Software\Classes\${AUTUMNMARK_PROGID}\DefaultIcon" \
    "" "$INSTDIR\resources\icons\md.ico,0"
  WriteRegExpandStr SHELL_CONTEXT "Software\Classes\${AUTUMNMARK_PROGID}\shell\open\command" \
    "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'

  ; Explorer serves file types from a cache that a fresh install otherwise
  ; keeps until the next sign-in.
  System::Call 'shell32::SHChangeNotify(i, i, i, i) v (0x08000000, 0, 0, 0)'
!macroend

!macro customUnInstall
  ; Keep the association and profile intact when an update invokes this uninstaller.
  ${ifNot} ${isUpdated}
    !insertmacro autumnmarkUnassociateExtension ".md"
    !insertmacro autumnmarkUnassociateExtension ".markdown"
    !insertmacro autumnmarkUnassociateExtension ".mmd"
    !insertmacro autumnmarkUnassociateExtension ".mdown"
    !insertmacro autumnmarkUnassociateExtension ".mdtxt"
    !insertmacro autumnmarkUnassociateExtension ".mdtext"
    !insertmacro autumnmarkUnassociateExtension ".mdx"
    DeleteRegKey SHELL_CONTEXT "Software\Classes\${AUTUMNMARK_PROGID}"

    MessageBox MB_YESNO "Do you want to delete user settings?" /SD IDNO IDNO SkipRemoval
      SetShellVarContext current
      RMDir /r "$APPDATA\${APP_PACKAGE_NAME}"
    SkipRemoval:
  ${endIf}
!macroend
