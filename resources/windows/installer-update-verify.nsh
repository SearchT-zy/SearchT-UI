!ifndef SEARCHT_INSTALLER_UPDATE_VERIFY_NSH
!define SEARCHT_INSTALLER_UPDATE_VERIFY_NSH

Var /GLOBAL SearchtUninstallHadErrors
Var /GLOBAL SearchtUninstallLogResult
Var /GLOBAL SearchtVerifyResourceResult
Var /GLOBAL SearchtUpdatedAppExitWaitResult
Var /GLOBAL SearchtActiveMarkerExecResult
Var /GLOBAL SearchtActiveMarkerResult

!define SEARCHT_ACTIVE_INSTALLER_MARKER "searcht-installer-active.marker"

!macro SEARCHT_BRING_UPDATED_INSTALLER_TO_FRONT
  ${If} ${isUpdated}
    BringToFront
    !insertmacro SEARCHT_SLOG "event=updated-installer-foreground action=bring-to-front"
  ${EndIf}
!macroend

!macro SEARCHT_WAIT_FOR_UPDATED_APP_EXIT
  ${If} ${isUpdated}
    !insertmacro SEARCHT_SLOG "event=updated-app-exit-wait phase=start"
    StrCpy $SearchtUpdatedAppExitWaitResult "0"

    nsExec::Exec `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -Command "& { \
      $$ErrorActionPreference = 'SilentlyContinue'; \
      $$deadline = (Get-Date).AddSeconds(10); \
      $$target = [System.IO.Path]::GetFullPath((Join-Path '$INSTDIR' '${SEARCHT_APP_EXECUTABLE_FILENAME}')); \
      do { \
        $$hits = @(Get-CimInstance -ClassName Win32_Process | Where-Object { \
          $$path = $$_.ExecutablePath; \
          if (-not $$path) { $$path = $$_.Path } \
          $$_.Name -ieq '${SEARCHT_APP_EXECUTABLE_FILENAME}' -and $$path -and \
          [string]::Equals([System.IO.Path]::GetFullPath($$path), $$target, [System.StringComparison]::CurrentCultureIgnoreCase) \
        }); \
        if ($$hits.Count -eq 0) { exit 0 }; \
        Start-Sleep -Milliseconds 500; \
      } while ((Get-Date) -lt $$deadline); \
      exit 1 \
    }"`
    Pop $SearchtUpdatedAppExitWaitResult

    ${If} $SearchtUpdatedAppExitWaitResult != 0
      !insertmacro SEARCHT_SLOG "event=updated-app-exit-wait phase=timeout action=stop"
      !insertmacro SEARCHT_STOP_APP_PROCESSES
    ${EndIf}

    !insertmacro SEARCHT_SLOG "event=updated-app-exit-wait phase=done result=$SearchtUpdatedAppExitWaitResult"
  ${EndIf}
!macroend

!macro SEARCHT_RECORD_ACTIVE_INSTALLER_MARKER
  nsExec::ExecToStack `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -Command "& { \
    $$ErrorActionPreference = 'SilentlyContinue'; \
    $$marker = Join-Path $$env:TEMP '${SEARCHT_ACTIVE_INSTALLER_MARKER}'; \
    if (-not (Test-Path -LiteralPath $$marker)) { Write-Output 'missing'; exit 0 }; \
    $$item = Get-Item -LiteralPath $$marker; \
    if ($$item.LastWriteTime -lt (Get-Date).AddHours(-2)) { Write-Output 'stale'; exit 0 }; \
    Write-Output 'active' \
  }"`
  Pop $SearchtActiveMarkerExecResult
  Pop $SearchtActiveMarkerResult
  ${If} $SearchtActiveMarkerResult == "active"
    !insertmacro SEARCHT_SLOG "event=installer-active-marker state=active"
  ${ElseIf} $SearchtActiveMarkerResult == "stale"
    !insertmacro SEARCHT_SLOG "event=installer-active-marker state=stale"
  ${Else}
    !insertmacro SEARCHT_SLOG "event=installer-active-marker state=missing"
  ${EndIf}
!macroend

!macro SEARCHT_WRITE_ACTIVE_INSTALLER_MARKER
  nsExec::Exec `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -Command "& { \
    $$ErrorActionPreference = 'SilentlyContinue'; \
    $$marker = Join-Path $$env:TEMP '${SEARCHT_ACTIVE_INSTALLER_MARKER}'; \
    Set-Content -LiteralPath $$marker -Encoding UTF8 -Value ('pid=' + $$PID + ';session=$SearchtSessionId;started=' + (Get-Date -Format o)) \
  }"`
  Pop $SearchtActiveMarkerResult
!macroend

!macro SEARCHT_CLEAR_ACTIVE_INSTALLER_MARKER
  !ifndef BUILD_UNINSTALLER
    nsExec::Exec `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -Command "& { \
      $$ErrorActionPreference = 'SilentlyContinue'; \
      Remove-Item -LiteralPath (Join-Path $$env:TEMP '${SEARCHT_ACTIVE_INSTALLER_MARKER}') -Force \
    }"`
    Pop $SearchtActiveMarkerResult
  !endif
!macroend

!macro SEARCHT_OVERRIDE_SINGLE_INSTANCE
!macroend

!macro SEARCHT_OVERRIDE_APP_CANNOT_BE_CLOSED_MESSAGE
  !pragma warning disable 6030
  LangString appCannotBeClosed 1033 "${SEARCHT_MSG_APP_CANNOT_BE_CLOSED_ZH}$\r$\n$\r$\n${SEARCHT_MSG_BLOCK_SEPARATOR}$\r$\n$\r$\n${SEARCHT_MSG_APP_CANNOT_BE_CLOSED_EN}"
  LangString appCannotBeClosed 2052 "${SEARCHT_MSG_APP_CANNOT_BE_CLOSED_ZH}$\r$\n$\r$\n${SEARCHT_MSG_BLOCK_SEPARATOR}$\r$\n$\r$\n${SEARCHT_MSG_APP_CANNOT_BE_CLOSED_EN}"
  !pragma warning default 6030
!macroend

!macro SEARCHT_INSTALLER_CUSTOM_HEADER
  !insertmacro SEARCHT_OVERRIDE_SINGLE_INSTANCE
  !insertmacro SEARCHT_OVERRIDE_APP_CANNOT_BE_CLOSED_MESSAGE
!macroend

!macro SEARCHT_RELEASE_INSTALL_DIR_OUTDIR
  InitPluginsDir
  SetOutPath "$PLUGINSDIR"
  StrCpy $SearchtCurrentOutDir "$PLUGINSDIR"
!macroend

; Resolve the machine's real native architecture (arm64 / x64 / x86) for diagnostics.
; Backed by IsWow64Process2 (via x64.nsh), so it reports the true hardware arch even when
; the installer runs under x86/x64 emulation. Replaces the old hardcoded "non-arm64" detail.
!macro SEARCHT_DETECT_NATIVE_ARCH _OUT
  ${If} ${IsNativeARM64}
    StrCpy ${_OUT} "arm64"
  ${ElseIf} ${RunningX64}
    StrCpy ${_OUT} "x64"
  ${Else}
    StrCpy ${_OUT} "x86"
  ${EndIf}
!macroend

!macro SEARCHT_INSTALLER_PREINIT
  !ifdef BUILD_UNINSTALLER
    StrCpy $SearchtSessionId ""
    StrCpy $SearchtIsUpdated "0"
    StrCpy $SearchtSessionLogResult ""
    StrCpy $SearchtSessionLogPath "$TEMP\${SEARCHT_FALLBACK_LOG}"
    StrCpy $SearchtUninstallHadErrors "0"
    StrCpy $SearchtUninstallLogResult ""
    StrCpy $SearchtVerifyResourceResult ""
    StrCpy $SearchtUpdatedAppExitWaitResult ""
    StrCpy $SearchtActiveMarkerExecResult ""
    StrCpy $SearchtActiveMarkerResult ""
    StrCpy $SearchtStopResult ""
    StrCpy $SearchtLockerListZh ""
    StrCpy $SearchtLockerListEn ""
  !else
    !insertmacro SEARCHT_RELEASE_INSTALL_DIR_OUTDIR
    !insertmacro SEARCHT_SESSION_BEGIN
    !insertmacro SEARCHT_SLOG "event=installer-outdir-release outDir=$SearchtCurrentOutDir instDir=$INSTDIR"
    ; Guard target/machine architecture as early as possible: this runs before customInit's
    ; registry heal/clear/repair, so a wrong-arch installer aborts without mutating an existing
    ; correct-arch install's registry or uninstaller state. (Sentry ELECTRON-3BX / code E1040)
    !insertmacro SEARCHT_ASSERT_TARGET_ARCH
    !insertmacro SEARCHT_BRING_UPDATED_INSTALLER_TO_FRONT
    !insertmacro SEARCHT_RECORD_ACTIVE_INSTALLER_MARKER
    !insertmacro SEARCHT_WRITE_ACTIVE_INSTALLER_MARKER
  !endif
!macroend

!macro SEARCHT_VERIFY_REQUIRED_FILE _PATH _LABEL
  ${IfNot} ${FileExists} "${_PATH}"
    !insertmacro SEARCHT_LOG_EVENT "verify-required-file missing label=${_LABEL} path=${_PATH}"
    !insertmacro SEARCHT_FAIL_UX \
      "${SEARCHT_E_CORE_APP_FILES_INCOMPLETE}" \
      "verify-required-file missing label=${_LABEL} path=${_PATH}" \
      "${SEARCHT_MSG_VERIFY_REQUIRED_FILE_ZH} ${_LABEL}" \
      "${SEARCHT_MSG_VERIFY_REQUIRED_FILE_EN} ${_LABEL}" \
      "${SEARCHT_MSG_VERIFY_REQUIRED_FILE_ACTION_ZH}" \
      "${SEARCHT_MSG_VERIFY_REQUIRED_FILE_ACTION_EN}" \
      "verify-required-file missing label=${_LABEL} path=${_PATH}" \
      "verify-required-file missing label=${_LABEL} path=${_PATH}"
  ${Else}
    !insertmacro SEARCHT_LOG_EVENT "verify-required-file ok label=${_LABEL} path=${_PATH}"
  ${EndIf}
!macroend

!macro SEARCHT_VERIFY_CORE_APP_FILES
  !insertmacro SEARCHT_LOG_EVENT "verify-install start instDir=$INSTDIR"
  !insertmacro SEARCHT_VERIFY_REQUIRED_FILE "$INSTDIR\${SEARCHT_APP_EXECUTABLE_FILENAME}" "${SEARCHT_APP_EXECUTABLE_FILENAME}"
  !insertmacro SEARCHT_VERIFY_REQUIRED_FILE "$INSTDIR\ffmpeg.dll" "ffmpeg.dll"
  !insertmacro SEARCHT_VERIFY_REQUIRED_FILE "$INSTDIR\libEGL.dll" "libEGL.dll"
  !insertmacro SEARCHT_VERIFY_REQUIRED_FILE "$INSTDIR\libGLESv2.dll" "libGLESv2.dll"
  !insertmacro SEARCHT_VERIFY_REQUIRED_FILE "$INSTDIR\d3dcompiler_47.dll" "d3dcompiler_47.dll"
  !insertmacro SEARCHT_VERIFY_REQUIRED_FILE "$INSTDIR\dxcompiler.dll" "dxcompiler.dll"
  !insertmacro SEARCHT_VERIFY_REQUIRED_FILE "$INSTDIR\dxil.dll" "dxil.dll"
  !insertmacro SEARCHT_VERIFY_REQUIRED_FILE "$INSTDIR\vk_swiftshader.dll" "vk_swiftshader.dll"
  !insertmacro SEARCHT_VERIFY_REQUIRED_FILE "$INSTDIR\vulkan-1.dll" "vulkan-1.dll"
  !insertmacro SEARCHT_VERIFY_REQUIRED_FILE "$INSTDIR\resources\app.asar" "resources\app.asar"
!macroend

!macro SEARCHT_VERIFY_BUNDLED_AIONCORE_RESOURCES _RUNTIME_KEY
  InitPluginsDir
  File "/oname=$PLUGINSDIR\verify-bundled-aioncore-install.ps1" "${PROJECT_DIR}\resources\windows\support\verify-bundled-aioncore-install.ps1"
  nsExec::Exec `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "$PLUGINSDIR\verify-bundled-aioncore-install.ps1" -InstallDir "$INSTDIR" -RuntimeKey "${_RUNTIME_KEY}" -LogPath "$SearchtSessionLogPath"`
  Pop $SearchtVerifyResourceResult

  ${If} $SearchtVerifyResourceResult != 0
    !insertmacro SEARCHT_FAIL_UX \
      "${SEARCHT_E_BUNDLED_AIONCORE_INCOMPLETE}" \
      "event=session-end result=fail code=${SEARCHT_E_BUNDLED_AIONCORE_INCOMPLETE} detail=bundled-aioncore-incomplete runtime=${_RUNTIME_KEY} result=$SearchtVerifyResourceResult" \
      "${SEARCHT_MSG_BUNDLED_AIONCORE_INCOMPLETE_ZH}" \
      "${SEARCHT_MSG_BUNDLED_AIONCORE_INCOMPLETE_EN}" \
      "${SEARCHT_MSG_BUNDLED_AIONCORE_INCOMPLETE_ACTION_ZH}" \
      "${SEARCHT_MSG_BUNDLED_AIONCORE_INCOMPLETE_ACTION_EN}" \
      "bundled-aioncore-incomplete runtime=${_RUNTIME_KEY} result=$SearchtVerifyResourceResult instDir=$INSTDIR" \
      "bundled-aioncore-incomplete runtime=${_RUNTIME_KEY} result=$SearchtVerifyResourceResult instDir=$INSTDIR"
  ${EndIf}
!macroend

!macro customInstall
  !insertmacro SEARCHT_VERIFY_CORE_APP_FILES
  !insertmacro SEARCHT_VERIFY_BUNDLED_AIONCORE_RESOURCES "${SEARCHT_RUNTIME_KEY}"
  !insertmacro SEARCHT_LOG_EVENT "verify-install ok instDir=$INSTDIR"
  !insertmacro SEARCHT_CLEAR_ACTIVE_INSTALLER_MARKER
  !insertmacro SEARCHT_SESSION_SUCCESS
!macroend

!endif
