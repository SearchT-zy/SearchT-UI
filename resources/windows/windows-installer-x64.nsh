; x64 architecture entry for the NSIS installer.

!include "x64.nsh"

!define SEARCHT_TARGET_ARCH "x64"
!define SEARCHT_RUNTIME_KEY "win32-x64"
!define SEARCHT_EXTRACT_METHOD "7z"

!addincludedir "${PROJECT_DIR}\resources\windows"
!include "installer-common.nsh"

!macro customHeader
  !insertmacro SEARCHT_INSTALLER_CUSTOM_HEADER
!macroend

!macro preInit
  !insertmacro SEARCHT_INSTALLER_PREINIT
!macroend

!macro customFiles_x64
  !insertmacro SEARCHT_LOG_EXTRACT_RESULT "7z"
!macroend

; Architecture guard. Inserted from SEARCHT_INSTALLER_PREINIT (preInit) so it runs before any
; registry mutation, replacing the old .onVerifyInstDir placement which fired after customInit
; had already healed/cleared/repaired an existing install's registry. (Sentry ELECTRON-3BX)
; Rejection policy is unchanged: an x64 build refuses both x86 and ARM64 machines.
!macro SEARCHT_ASSERT_TARGET_ARCH
  Var /GLOBAL SearchtActualArch
  ${If} ${IsNativeARM64}
    !insertmacro SEARCHT_DETECT_NATIVE_ARCH $SearchtActualArch
    !insertmacro SEARCHT_FAIL_UX \
      "${SEARCHT_E_ARCH_MISMATCH}" \
      "target=x64 actual=$SearchtActualArch" \
      "${SEARCHT_MSG_ARCH_MISMATCH_ZH}" \
      "${SEARCHT_MSG_ARCH_MISMATCH_EN}" \
      "${SEARCHT_MSG_ARCH_MISMATCH_ACTION_ZH}" \
      "${SEARCHT_MSG_ARCH_MISMATCH_ACTION_EN}" \
      "target=x64 actual=$SearchtActualArch" \
      "target=x64 actual=$SearchtActualArch"
  ${ElseIfNot} ${RunningX64}
    !insertmacro SEARCHT_DETECT_NATIVE_ARCH $SearchtActualArch
    !insertmacro SEARCHT_FAIL_UX \
      "${SEARCHT_E_ARCH_MISMATCH}" \
      "target=x64 actual=$SearchtActualArch" \
      "${SEARCHT_MSG_ARCH_MISMATCH_ZH}" \
      "${SEARCHT_MSG_ARCH_MISMATCH_EN}" \
      "${SEARCHT_MSG_ARCH_MISMATCH_ACTION_ZH}" \
      "${SEARCHT_MSG_ARCH_MISMATCH_ACTION_EN}" \
      "target=x64 actual=$SearchtActualArch" \
      "target=x64 actual=$SearchtActualArch"
  ${EndIf}
!macroend
