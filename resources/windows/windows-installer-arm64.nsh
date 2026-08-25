; ARM64 architecture entry for the NSIS installer.

!include "x64.nsh"

!define SEARCHT_TARGET_ARCH "arm64"
!define SEARCHT_RUNTIME_KEY "win32-arm64"
!define SEARCHT_EXTRACT_METHOD "zip"

!addincludedir "${PROJECT_DIR}\resources\windows"
!include "installer-common.nsh"

!macro customHeader
  !insertmacro SEARCHT_INSTALLER_CUSTOM_HEADER
!macroend

!macro preInit
  !insertmacro SEARCHT_INSTALLER_PREINIT
!macroend

!macro customFiles_arm64
  !insertmacro SEARCHT_LOG_EXTRACT_RESULT "zip"
!macroend

; Architecture guard. Inserted from SEARCHT_INSTALLER_PREINIT (preInit) so it runs before any
; registry mutation, replacing the old .onVerifyInstDir placement which fired after customInit
; had already healed/cleared/repaired an existing install's registry. (Sentry ELECTRON-3BX)
!macro SEARCHT_ASSERT_TARGET_ARCH
  Var /GLOBAL SearchtActualArch
  ${IfNot} ${IsNativeARM64}
    !insertmacro SEARCHT_DETECT_NATIVE_ARCH $SearchtActualArch
    !insertmacro SEARCHT_FAIL_UX \
      "${SEARCHT_E_ARCH_MISMATCH}" \
      "target=arm64 actual=$SearchtActualArch" \
      "${SEARCHT_MSG_ARCH_MISMATCH_ZH}" \
      "${SEARCHT_MSG_ARCH_MISMATCH_EN}" \
      "${SEARCHT_MSG_ARCH_MISMATCH_ACTION_ZH}" \
      "${SEARCHT_MSG_ARCH_MISMATCH_ACTION_EN}" \
      "target=arm64 actual=$SearchtActualArch" \
      "target=arm64 actual=$SearchtActualArch"
  ${EndIf}
!macroend
