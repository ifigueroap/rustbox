; Prefer Just me unless a previous all-users install recorded itself.
; Existing per-user installs (the 0.3.x default) did not write that flag, so an
; upgrade stays on the current user and replaces %LOCALAPPDATA%\Rustbox.
!define MULTIUSER_INSTALLMODE_DEFAULT_CURRENTUSER

!macro NSIS_HOOK_PREINSTALL
  !if "${INSTALLMODE}" == "both"
    ; All users is a different folder (Program Files). Remove the older per-user
    ; program files first. Silent uninstall leaves %APPDATA%\${BUNDLEID} alone
    ; because Delete app data stays unchecked.
    ${If} $MultiUser.InstallMode == "AllUsers"
      ReadRegStr $R8 HKCU "${UNINSTKEY}" "UninstallString"
      ReadRegStr $R9 HKCU "${MANUPRODUCTKEY}" ""
      ${If} $R8 != ""
      ${AndIf} $R9 != ""
        ExecWait '$R8 /S _?=$R9'
      ${EndIf}
    ${EndIf}
  !endif
!macroend

!macro NSIS_HOOK_POSTINSTALL
  !if "${INSTALLMODE}" == "both"
    ; MultiUser treats a non-empty "CurrentUser" value as "last install was
    ; per-user". An all-users install writes that flag under HKLM so the next
    ; upgrade stays on All users instead of falling back to Just me.
    ${If} $MultiUser.InstallMode == "AllUsers"
      WriteRegStr HKLM "${UNINSTKEY}" "CurrentUser" "1"
    ${EndIf}
  !endif
!macroend
