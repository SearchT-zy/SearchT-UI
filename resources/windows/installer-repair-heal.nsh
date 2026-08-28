!ifndef SEARCHT_INSTALLER_REPAIR_HEAL_NSH
!define SEARCHT_INSTALLER_REPAIR_HEAL_NSH

Var /GLOBAL SearchtRegistryInstallIsValid
Var /GLOBAL SearchtInnerFailureSummary
Var /GLOBAL SearchtInnerRootCode
Var /GLOBAL SearchtInnerFailureReadResult

!macro SEARCHT_READ_LAST_INNER_FAILURE
  InitPluginsDir
  StrCpy $SearchtInnerRootCode ""
  StrCpy $SearchtInnerFailureSummary "No specific locking process was identified. Close SearchT, terminals, editors, and file managers opened in the install folder."
  nsExec::ExecToStack `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -Command "& { \
    $$ErrorActionPreference = 'SilentlyContinue'; \
    $$logPath = '$SearchtSessionLogPath'; \
    $$summary = 'No specific locking process was identified. Close SearchT, terminals, editors, and file managers opened in the install folder.'; \
    $$code = ''; \
    if ($$logPath -and (Test-Path -LiteralPath $$logPath)) { \
      $$events = @(Get-Content -LiteralPath $$logPath -ErrorAction SilentlyContinue | ForEach-Object { try { $$_ | ConvertFrom-Json } catch { $$null } } | Where-Object { $$_ }); \
      $$failure = @($$events | Where-Object { $$_.event -eq 'failure' -and $$_.updated -eq $$true } | Select-Object -Last 1)[0]; \
      if (-not $$failure) { $$failure = @($$events | Where-Object { $$_.event -eq 'failure' } | Select-Object -Last 1)[0] }; \
      if ($$failure) { \
        $$code = ([string]$$failure.code).Trim(); \
        $$phase = ([string]$$failure.phase).Trim(); \
        $$path = ([string]$$failure.failedPath).Trim(); \
        $$blocking = ''; \
        $$processes = @($$failure.blockingProcesses); \
        if ($$processes.Count -gt 0) { $$blocking = (@($$processes | ForEach-Object { if ($$_.pid) { [string]$$_.name + '(' + [string]$$_.pid + ')' } else { [string]$$_.name } }) -join ', ') }; \
        if (-not $$blocking) { $$blocking = ([string]$$failure.message).Trim() }; \
        if (-not $$blocking) { $$blocking = 'Windows did not identify a specific locking process. Close terminals, editors, and file managers opened in the install folder.' }; \
        $$parts = @('- Outer installer: previous uninstaller exited with code $R0', ('- Inner failure: ' + $$code + ' phase ' + $$phase)); \
        if ($$path) { $$parts += ('- File or folder: ' + $$path) }; \
        $$parts += ('- Blocking process: ' + $$blocking); \
        $$summary = $$parts -join [Environment]::NewLine; \
      } \
    }; \
    if (-not $$code) { $$code = '-----' }; \
    [Console]::Out.Write($$code + '|' + $$summary) \
  }"`
  Pop $SearchtInnerFailureReadResult
  Pop $SearchtInnerFailureReadResult
  StrCpy $SearchtInnerRootCode $SearchtInnerFailureReadResult 5
  ${If} $SearchtInnerRootCode == "-----"
    StrCpy $SearchtInnerRootCode ""
  ${EndIf}
  StrCpy $SearchtInnerFailureSummary $SearchtInnerFailureReadResult 4096 6
!macroend

!macro SEARCHT_LOG_UNINSTALLER_REPAIR _PHASE
  nsExec::Exec `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -Command "& { \
    $$ErrorActionPreference = 'SilentlyContinue'; \
    $$log = '$SearchtSessionLogPath'; \
    if (-not $$log) { $$log = Join-Path $$env:TEMP '${SEARCHT_FALLBACK_LOG}' }; \
    $$path = '$INSTDIR\${UNINSTALL_FILENAME}'; \
    $$item = Get-Item -LiteralPath $$path -ErrorAction SilentlyContinue; \
    $$version = if ($$item) { $$item.VersionInfo.ProductVersion } else { '' }; \
    $$length = if ($$item) { $$item.Length } else { '' }; \
    $$payload = [ordered]@{ schemaVersion = 1; ts = (Get-Date -Format o); session = '$SearchtSessionId'; version = '${VERSION}'; arch = '${SEARCHT_TARGET_ARCH}'; updated = ('$SearchtIsUpdated' -eq '1'); instDir = '$INSTDIR'; event = 'uninstaller-repair'; phase = '${_PHASE}'; path = $$path; exists = [bool]$$item; productVersion = $$version; length = $$length }; \
    Add-Content -LiteralPath $$log -Encoding UTF8 -Value ($$payload | ConvertTo-Json -Compress -Depth 8) \
  }"`
  Pop $SearchtRepairLogResult
!macroend

!macro SEARCHT_REPAIR_INSTALLED_UNINSTALLER
  Var /GLOBAL SearchtInstalledUninstaller
  Var /GLOBAL SearchtBundledUninstaller
  Var /GLOBAL SearchtRepairLogResult

  !insertmacro SEARCHT_LOG_UNINSTALLER_REPAIR "before"
  StrCpy $SearchtInstalledUninstaller "$INSTDIR\${UNINSTALL_FILENAME}"

  InitPluginsDir
  StrCpy $SearchtBundledUninstaller "$PLUGINSDIR\SearchT-fixed-uninstaller.exe"
  SetOverwrite on
  File "/oname=$PLUGINSDIR\SearchT-fixed-uninstaller.exe" "${UNINSTALLER_OUT_FILE}"

  ${If} ${FileExists} "$SearchtInstalledUninstaller"
    ClearErrors
    CopyFiles /SILENT "$SearchtBundledUninstaller" "$SearchtInstalledUninstaller"
    ${If} ${Errors}
      !insertmacro SEARCHT_LOG_UNINSTALLER_REPAIR "copy-failed-retry"
      !insertmacro SEARCHT_STOP_APP_PROCESSES
      Sleep 1000

      ClearErrors
      CopyFiles /SILENT "$SearchtBundledUninstaller" "$SearchtInstalledUninstaller"
      ${If} ${Errors}
        ${If} ${FileExists} "$SearchtBundledUninstaller"
          !insertmacro SEARCHT_LOG_UNINSTALLER_REPAIR "copy-failed-using-bundled"
          !insertmacro SEARCHT_LOG_EVENT "event=uninstaller-repair phase=copy-failed-using-bundled"
        ${Else}
          !insertmacro SEARCHT_FAIL_REPORTABLE_BILINGUAL ${SEARCHT_E_UNINSTALLER_COPY_OR_REBUILD_FAILED} "uninstaller-repair copy-failed-retry-bundled-missing" "${SEARCHT_MSG_UNINSTALLER_COPY_LOCKED_EN}" "${SEARCHT_MSG_UNINSTALLER_COPY_LOCKED_ZH}" "${SEARCHT_MSG_UNINSTALLER_REPAIR_ACTION_EN}" "${SEARCHT_MSG_UNINSTALLER_REPAIR_ACTION_ZH}"
        ${EndIf}
      ${Else}
        !insertmacro SEARCHT_LOG_UNINSTALLER_REPAIR "after-copy-retry"
      ${EndIf}
    ${Else}
      !insertmacro SEARCHT_LOG_UNINSTALLER_REPAIR "after-copy"
    ${EndIf}
  ${Else}
    ClearErrors
    CopyFiles /SILENT "$SearchtBundledUninstaller" "$SearchtInstalledUninstaller"
    ${If} ${Errors}
      !insertmacro SEARCHT_FAIL_REPORTABLE_BILINGUAL ${SEARCHT_E_UNINSTALLER_COPY_OR_REBUILD_FAILED} "uninstaller-repair rebuild-failed" "${SEARCHT_MSG_UNINSTALLER_REBUILD_FAILED_EN}" "${SEARCHT_MSG_UNINSTALLER_REBUILD_FAILED_ZH}" "${SEARCHT_MSG_UNINSTALLER_REPAIR_ACTION_EN}" "${SEARCHT_MSG_UNINSTALLER_REPAIR_ACTION_ZH}"
    ${EndIf}

    ${IfNot} ${FileExists} "$SearchtInstalledUninstaller"
      !insertmacro SEARCHT_FAIL_REPORTABLE_BILINGUAL ${SEARCHT_E_UNINSTALLER_COPY_OR_REBUILD_FAILED} "uninstaller-repair rebuild-missing-after-copy" "${SEARCHT_MSG_UNINSTALLER_REBUILD_MISSING_EN}" "${SEARCHT_MSG_UNINSTALLER_REBUILD_MISSING_ZH}" "${SEARCHT_MSG_UNINSTALLER_REPAIR_ACTION_EN}" "${SEARCHT_MSG_UNINSTALLER_REPAIR_ACTION_ZH}"
    ${EndIf}

    !insertmacro SEARCHT_LOG_UNINSTALLER_REPAIR "rebuilt"
    !insertmacro SEARCHT_LOG_EVENT "event=uninstaller-repair phase=rebuilt"
  ${EndIf}
!macroend

!macro SEARCHT_HEAL_INSTALL_REGISTRY
  Var /GLOBAL SearchtRegInstallLocation
  Var /GLOBAL SearchtRegUninstallString
  Var /GLOBAL SearchtRegInstallExe

  StrCpy $SearchtRegistryInstallIsValid "0"

  ReadRegStr $SearchtRegInstallLocation SHCTX "${INSTALL_REGISTRY_KEY}" "InstallLocation"
  ReadRegStr $SearchtRegUninstallString SHCTX "${UNINSTALL_REGISTRY_KEY}" "UninstallString"

  ${If} $SearchtRegInstallLocation == ""
    !insertmacro SEARCHT_LOG_EVENT "event=registry-heal phase=missing-install-location uninstallString=$SearchtRegUninstallString"
    !insertmacro SEARCHT_CLEAR_INSTALL_REGISTRY "missing-install-location"
  ${Else}
    StrCpy $SearchtRegInstallExe "$SearchtRegInstallLocation\${SEARCHT_APP_EXECUTABLE_FILENAME}"
    ${If} ${FileExists} "$SearchtRegInstallExe"
      StrCpy $INSTDIR "$SearchtRegInstallLocation"
      StrCpy $SearchtRegistryInstallIsValid "1"
      !insertmacro SEARCHT_LOG_EVENT "event=registry-heal phase=valid-install-location instDir=$INSTDIR uninstallString=$SearchtRegUninstallString"
    ${Else}
      !insertmacro SEARCHT_LOG_EVENT "event=registry-heal phase=stale-install-location installLocation=$SearchtRegInstallLocation uninstallString=$SearchtRegUninstallString"
      !insertmacro SEARCHT_CLEAR_INSTALL_REGISTRY "stale-install-location"
    ${EndIf}
  ${EndIf}
!macroend

!macro SEARCHT_LOG_UNINSTALL_RESULT _ROOT_KEY _HAD_ERRORS
  nsExec::Exec `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -Command "& { \
    $$ErrorActionPreference = 'SilentlyContinue'; \
    $$log = '$SearchtSessionLogPath'; \
    if (-not $$log) { $$log = Join-Path $$env:TEMP '${SEARCHT_FALLBACK_LOG}' }; \
    $$payload = [ordered]@{ schemaVersion = 1; ts = (Get-Date -Format o); session = '$SearchtSessionId'; version = '${VERSION}'; arch = '${SEARCHT_TARGET_ARCH}'; updated = ('$SearchtIsUpdated' -eq '1'); instDir = '$INSTDIR'; event = 'uninstall-result'; root = '${_ROOT_KEY}'; launchErrors = '${_HAD_ERRORS}'; exitCode = '$R0' }; \
    Add-Content -LiteralPath $$log -Encoding UTF8 -Value ($$payload | ConvertTo-Json -Compress -Depth 8) \
  }"`
  Pop $SearchtUninstallLogResult
!macroend

!macro SEARCHT_HANDLE_UNINSTALL_RESULT _ROOT_KEY _LABEL_PREFIX
  ${If} ${Errors}
    StrCpy $SearchtUninstallHadErrors "1"
  ${Else}
    StrCpy $SearchtUninstallHadErrors "0"
  ${EndIf}

  !insertmacro SEARCHT_LOG_UNINSTALL_RESULT "${_ROOT_KEY}" "$SearchtUninstallHadErrors"

  ${If} $SearchtUninstallHadErrors == "1"
    DetailPrint `Uninstall was not successful. Not able to launch uninstaller!`
    Return
  ${EndIf}

  ${If} $R0 != 0
      DetailPrint `Uninstall was not successful. Uninstaller error code: $R0.`
      !insertmacro SEARCHT_READ_LAST_INNER_FAILURE
      ${If} $SearchtLockerList != ""
        StrCpy $SearchtInnerFailureSummary "- Failure: previous uninstaller failed with exit code $R0$\r$\n- File or folder: $INSTDIR$\r$\n- Blocking process: $SearchtLockerList"
      ${EndIf}
      !insertmacro SEARCHT_LOG_EVENT "event=old-uninstaller-failed action=report exitCode=$R0 lockers=$SearchtLockerList uninstallerDetail=$SearchtInnerFailureSummary"
      ${If} $SearchtInnerRootCode != ""
        !insertmacro SEARCHT_FAIL_REPORTABLE_ROOTED_BILINGUAL_DIAGNOSTICS "$SearchtInnerRootCode" ${SEARCHT_E_OLD_UNINSTALL_FAILED} "old-uninstaller exitCode=$R0 lockers=$SearchtLockerList uninstallerDetail=$SearchtInnerFailureSummary" "${SEARCHT_MSG_OLD_UNINSTALL_FAILED_EN}" "${SEARCHT_MSG_OLD_UNINSTALL_FAILED_ZH}" "${SEARCHT_MSG_OLD_UNINSTALL_ACTION_EN}" "${SEARCHT_MSG_OLD_UNINSTALL_ACTION_ZH}" "$SearchtInnerFailureSummary" "$SearchtInnerFailureSummary"
      ${Else}
        !insertmacro SEARCHT_FAIL_REPORTABLE_BILINGUAL_DIAGNOSTICS ${SEARCHT_E_OLD_UNINSTALL_FAILED} "old-uninstaller exitCode=$R0 lockers=$SearchtLockerList uninstallerDetail=$SearchtInnerFailureSummary" "${SEARCHT_MSG_OLD_UNINSTALL_FAILED_EN}" "${SEARCHT_MSG_OLD_UNINSTALL_FAILED_ZH}" "${SEARCHT_MSG_OLD_UNINSTALL_ACTION_EN}" "${SEARCHT_MSG_OLD_UNINSTALL_ACTION_ZH}" "$SearchtInnerFailureSummary" "$SearchtInnerFailureSummary"
      ${EndIf}
  ${EndIf}
!macroend

!macro customInit
  ; Normalize a drive-relative INSTDIR (e.g. "D:searcht" — some programmatic
  ; callers lose the backslash after /D=). Resolve it against the drive root
  ; so registry InstallLocation and file layout stay deterministic.
  StrCpy $R0 $INSTDIR 1
  StrCpy $R1 $INSTDIR 1 1
  StrCpy $R2 $INSTDIR 1 2
  ${If} $R0 != ""
  ${AndIf} $R1 == ":"
  ${AndIf} $R2 != "\"
  ${AndIf} $R2 != "/"
    StrCpy $R3 $INSTDIR 2 ""
    StrCpy $R4 $INSTDIR "" 2
    StrCpy $INSTDIR "$R3\$R4"
  ${EndIf}
  !insertmacro SEARCHT_HEAL_INSTALL_REGISTRY
  ${If} $SearchtRegistryInstallIsValid == "1"
    !insertmacro SEARCHT_REPAIR_INSTALLED_UNINSTALLER
  ${EndIf}
!macroend

!macro customUnInstallCheck
  !insertmacro SEARCHT_HANDLE_UNINSTALL_RESULT "SHELL_CONTEXT" "shctx"
!macroend

!macro customUnInstallCheckCurrentUser
  !insertmacro SEARCHT_HANDLE_UNINSTALL_RESULT "HKEY_CURRENT_USER" "hkcu"
!macroend

!endif
