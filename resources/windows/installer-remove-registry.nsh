!ifndef SEARCHT_INSTALLER_REMOVE_REGISTRY_NSH
!define SEARCHT_INSTALLER_REMOVE_REGISTRY_NSH

!macro SEARCHT_CLEAR_INSTALL_REGISTRY _REASON
  DeleteRegKey SHCTX "${UNINSTALL_REGISTRY_KEY}"
  DeleteRegKey SHCTX "${INSTALL_REGISTRY_KEY}"
  !insertmacro SEARCHT_LOG_EVENT "event=registry-clear reason=${_REASON} uninstallKey=${UNINSTALL_REGISTRY_KEY} installKey=${INSTALL_REGISTRY_KEY}"
!macroend

!macro SEARCHT_LOG_ATOMIC_REMOVE_FAILURE
  Push $9
  nsExec::Exec `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -Command "& { \
    $$ErrorActionPreference = 'SilentlyContinue'; \
    $$log = '$SearchtSessionLogPath'; \
    if (-not $$log) { $$log = Join-Path $$env:TEMP '${SEARCHT_FALLBACK_LOG}' }; \
    $$failed = '$SearchtAtomicFailedPath'; \
    $$instDir = '$INSTDIR'; \
    $$oldInstallDir = '$SearchtAtomicStagingDir'; \
    $$relative = $$failed; \
    if ($$failed.StartsWith($$instDir, [System.StringComparison]::CurrentCultureIgnoreCase)) { $$relative = $$failed.Substring($$instDir.Length).TrimStart('\') }; \
    $$tempCandidate = if ($$relative -and $$relative -ne $$failed) { Join-Path $$oldInstallDir $$relative } else { '' }; \
    $$kind = if ($$tempCandidate.Length -ge 260) { 'likely-long-path' } else { 'unknown' }; \
    $$payload = [ordered]@{ schemaVersion = 1; ts = (Get-Date -Format o); session = '$SearchtSessionId'; version = '${VERSION}'; arch = '${SEARCHT_TARGET_ARCH}'; updated = ('$SearchtIsUpdated' -eq '1'); instDir = '$INSTDIR'; event = 'remove-atomic-failed'; kind = $$kind; pathLength = $$failed.Length; tempCandidateLength = $$tempCandidate.Length; atomicFailedPath = $$failed; tempCandidate = $$tempCandidate }; \
    Add-Content -LiteralPath $$log -Encoding UTF8 -Value ($$payload | ConvertTo-Json -Compress -Depth 8) \
  }"`
  Pop $9
  Pop $9
!macroend

!macro SEARCHT_LOG_REMOVE_FAILURE_JSON _PHASE _FATAL _FAILED_PATH _EXTRA_FIELDS
  !insertmacro SEARCHT_LOG_JSON_EVENT "failure" "$$lockerText = '$SearchtLockerList'; $$processes = @(); if ($$lockerText -and $$lockerText -notlike 'Windows did not identify*' -and $$lockerText -ne 'unknown process') { $$processes = @($$lockerText -split ',\s*' | Where-Object { $$_ } | ForEach-Object { if ($$_ -match '^(.*)\(([0-9]+)\)$$') { [ordered]@{ name = $$Matches[1]; pid = [int]$$Matches[2] } } else { [ordered]@{ name = $$_; pid = $$null } } }) }; $$payload.code = '${SEARCHT_E_INSTALL_DIR_REMOVE_OR_LOCKED}'; $$payload.phase = '${_PHASE}'; $$payload.failedPath = '${_FAILED_PATH}'; $$payload.blockingProcesses = @($$processes); if ($$lockerText -like 'SearchT installer(*)') { $$payload.fallbackReason = 'installer-self-lock'; $$payload.message = 'The installer process is using the install directory as its current output directory.' } elseif ($$processes.Count -eq 0) { $$payload.fallbackReason = 'restart-manager-no-process'; $$payload.message = 'Windows did not identify a specific locking process. Close terminals, editors, and file managers opened in the install folder.' } else { $$payload.fallbackReason = ''; $$payload.message = '' }; $$payload.fatal = ('${_FATAL}' -eq '1'); ${_EXTRA_FIELDS}"
!macroend

!macro SEARCHT_REMOVE_INSTALL_DIR
  StrCpy $SearchtRemoveResidueCount "0"
  ${If} $SearchtRemoveResidueRoot == ""
    StrCpy $SearchtRemoveResidueRoot "$INSTDIR"
  ${EndIf}
  StrCpy $SearchtRemoveFirstFailedPath ""
  nsExec::Exec `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -Command "& { \
    $$ErrorActionPreference = 'Continue'; \
    $$log = '$SearchtSessionLogPath'; \
    if (-not $$log) { $$log = Join-Path $$env:TEMP '${SEARCHT_FALLBACK_LOG}' }; \
    $$path = [System.IO.Path]::GetFullPath('$SearchtRemoveResidueRoot'); \
    $$firstFailedFile = '$PLUGINSDIR\searcht-remove-first-failed.txt'; \
    Set-Content -LiteralPath $$firstFailedFile -Encoding UTF8 -NoNewline -Value ''; \
    function Write-InstallerLog($$message) { $$payload = [ordered]@{ schemaVersion = 1; ts = (Get-Date -Format o); session = '$SearchtSessionId'; version = '${VERSION}'; arch = '${SEARCHT_TARGET_ARCH}'; updated = ('$SearchtIsUpdated' -eq '1'); instDir = '$INSTDIR'; event = 'remove-log'; message = $$message }; if ($$message -match '(^|\s)event=([^\s]+)') { $$payload.event = $$Matches[2] }; Add-Content -LiteralPath $$log -Encoding UTF8 -Value ($$payload | ConvertTo-Json -Compress -Depth 8) } \
    function Convert-LongPath($$itemPath) { if ($$itemPath.StartsWith('\\')) { return '\\?\UNC\' + $$itemPath.TrimStart('\') } return '\\?\' + $$itemPath } \
    function Remove-WithRetries($$item, $$isDir) { \
      $$delays = @(200,500,1000,1000,1500,1500,2000,2000); \
      for ($$i = 0; $$i -lt $$delays.Count; $$i++) { \
        try { \
          if ($$isDir) { [System.IO.Directory]::Delete((Convert-LongPath $$item), $$false) } else { [System.IO.File]::Delete((Convert-LongPath $$item)) } \
          return $$true \
        } catch { \
          if ($$i -lt $$delays.Count - 1) { Start-Sleep -Milliseconds $$delays[$$i] } else { Write-InstallerLog ('event=remove-resilient-leftover path=' + $$item + ' attempts=' + $$delays.Count + ' error=' + $$_.Exception.GetType().FullName + ': ' + $$_.Exception.Message); return $$false } \
        } \
      } \
      return $$false \
    } \
    try { \
      if (-not (Test-Path -LiteralPath $$path)) { Write-InstallerLog ('remove-longpath result=0 instDir=' + $$path); exit 0 } \
      $$failed = New-Object System.Collections.Generic.List[string]; \
      foreach ($$file in @(Get-ChildItem -LiteralPath $$path -Force -Recurse -File -ErrorAction SilentlyContinue | Sort-Object FullName -Descending)) { if (-not (Remove-WithRetries $$file.FullName $$false)) { $$failed.Add($$file.FullName) } } \
      foreach ($$dir in @(Get-ChildItem -LiteralPath $$path -Force -Recurse -Directory -ErrorAction SilentlyContinue | Sort-Object FullName -Descending)) { if (-not (Remove-WithRetries $$dir.FullName $$true)) { $$failed.Add($$dir.FullName) } } \
      if (-not (Remove-WithRetries $$path $$true)) { $$failed.Add($$path) } \
      Write-InstallerLog ('event=remove-resilient-summary failedCount=' + $$failed.Count + ' root=' + $$path); \
      if ($$failed.Count -gt 0) { Set-Content -LiteralPath $$firstFailedFile -Encoding UTF8 -NoNewline -Value $$failed[0]; exit $$failed.Count } \
      Write-InstallerLog ('remove-longpath result=0 instDir=' + $$path); \
      exit 0 \
    } catch { \
      Write-InstallerLog ('remove-longpath result=1 instDir=' + $$path + ' error=' + $$_.Exception.GetType().FullName + ': ' + $$_.Exception.Message); \
      exit 1 \
    } \
  }"`
  Pop $SearchtRemoveDirResult

  ClearErrors
  SetDetailsPrint none
  FileOpen $SearchtRemoveFirstFailedFile "$PLUGINSDIR\searcht-remove-first-failed.txt" r
  ${IfNot} ${Errors}
    FileRead $SearchtRemoveFirstFailedFile $SearchtRemoveFirstFailedPath
    FileClose $SearchtRemoveFirstFailedFile
  ${EndIf}
  SetDetailsPrint lastused

  ${If} $SearchtRemoveDirResult == "error"
    !insertmacro SEARCHT_LOG_EVENT "event=remove-longpath fallback=RMDir reason=no-powershell root=$INSTDIR"
    RMDir /r "$SearchtRemoveResidueRoot"
    ${If} ${FileExists} "$SearchtRemoveResidueRoot\*.*"
      StrCpy $SearchtRemoveDirResult "1"
    ${Else}
      StrCpy $SearchtRemoveDirResult "0"
    ${EndIf}
  ${EndIf}

  ${If} $SearchtRemoveDirResult != 0
    StrCpy $SearchtRemoveResidueCount $SearchtRemoveDirResult
  ${EndIf}
!macroend

!macro customRemoveFiles
  !insertmacro SEARCHT_LOG_EVENT "remove-start instDir=$INSTDIR"
  Var /GLOBAL SearchtRemoveDirResult
  Var /GLOBAL SearchtAtomicFailedPath
  Var /GLOBAL SearchtAtomicRemoveSucceeded
  Var /GLOBAL SearchtAtomicStagingDir
  Var /GLOBAL SearchtRemoveResidueCount
  Var /GLOBAL SearchtRemoveResidueRoot
  Var /GLOBAL SearchtRemoveFirstFailedPath
  Var /GLOBAL SearchtRemoveFirstFailedFile
  StrCpy $SearchtAtomicFailedPath ""
  StrCpy $SearchtAtomicRemoveSucceeded "0"
  StrCpy $SearchtAtomicStagingDir ""
  StrCpy $SearchtRemoveResidueCount "0"
  StrCpy $SearchtRemoveResidueRoot "$INSTDIR"
  StrCpy $SearchtRemoveFirstFailedPath ""

  SetOutPath $TEMP
  StrCpy $SearchtCurrentOutDir "$TEMP"

  ${if} ${isUpdated}
    StrCpy $SearchtAtomicStagingDir "$INSTDIR.__old"
    ${If} ${FileExists} "$SearchtAtomicStagingDir\*.*"
      StrCpy $SearchtRemoveResidueRoot "$SearchtAtomicStagingDir"
      !insertmacro SEARCHT_LOG_EVENT "remove-stale-staging start root=$SearchtRemoveResidueRoot"
      !insertmacro SEARCHT_REMOVE_INSTALL_DIR
      StrCpy $SearchtRemoveResidueRoot "$INSTDIR"
    ${EndIf}

    searcht_retry_atomic_rename:
      ClearErrors
      Rename "$INSTDIR" "$SearchtAtomicStagingDir"
    ${if} ${Errors}
      DetailPrint "Atomic update cleanup failed before replacing previous installation: $INSTDIR"
      StrCpy $SearchtAtomicFailedPath "$INSTDIR"
      !insertmacro SEARCHT_LOG_ATOMIC_REMOVE_FAILURE
      !insertmacro SEARCHT_CAPTURE_FAILED_PATH_LOCKERS "$SearchtAtomicFailedPath"
      ${IfNot} ${Silent}
        !insertmacro SEARCHT_PROMPT_FAILED_PATH_LOCKERS "$SearchtAtomicFailedPath" "atomic-failed" searcht_retry_atomic_rename searcht_cancel_atomic_rename searcht_continue_atomic_failed
        searcht_cancel_atomic_rename:
      ${EndIf}
      searcht_continue_atomic_failed:
      !insertmacro SEARCHT_LOG_REMOVE_FAILURE_JSON "atomic-failed" "1" "$SearchtAtomicFailedPath" "$$payload.atomicFailedPath = '$SearchtAtomicFailedPath'"
      !insertmacro SEARCHT_LOG_EVENT "code=${SEARCHT_E_INSTALL_DIR_REMOVE_OR_LOCKED} phase=atomic-failed fatal=1 degraded=none firstFailed=$SearchtAtomicFailedPath atomicFailedPath=$SearchtAtomicFailedPath"
      !insertmacro SEARCHT_CLEAR_INSTALL_REGISTRY "remove-failed-before-quit"
      !insertmacro SEARCHT_FAIL_REPORTABLE_BILINGUAL ${SEARCHT_E_INSTALL_DIR_REMOVE_OR_LOCKED} "event=session-end result=fail code=${SEARCHT_E_INSTALL_DIR_REMOVE_OR_LOCKED} phase=atomic-failed fatal=1 firstFailed=$SearchtAtomicFailedPath lockers=$SearchtLockerList" "${SEARCHT_MSG_REPLACE_LOCKED_EN}" "${SEARCHT_MSG_REPLACE_LOCKED_ZH}" "${SEARCHT_MSG_CLOSE_SHOWN_FILE_ACTION_EN}" "${SEARCHT_MSG_CLOSE_SHOWN_FILE_ACTION_ZH}"
    ${else}
      !insertmacro SEARCHT_LOG_EVENT "remove-atomic result=0 staging=$SearchtAtomicStagingDir"
      StrCpy $SearchtAtomicRemoveSucceeded "1"
      StrCpy $SearchtRemoveResidueRoot "$SearchtAtomicStagingDir"
    ${endif}
  ${endif}

  searcht_retry_remove_install_dir:
    !insertmacro SEARCHT_REMOVE_INSTALL_DIR
  ${if} $SearchtRemoveDirResult != 0
    !insertmacro SEARCHT_CAPTURE_FAILED_PATH_LOCKERS "$SearchtRemoveFirstFailedPath"
    ${if} $SearchtAtomicRemoveSucceeded == "1"
      ${IfNot} ${Silent}
        !insertmacro SEARCHT_PROMPT_FAILED_PATH_LOCKERS "$SearchtRemoveFirstFailedPath" "residual-delete-failed" searcht_retry_remove_install_dir searcht_cancel_remove_after_rm searcht_continue_after_rm
        searcht_cancel_remove_after_rm:
          !insertmacro SEARCHT_LOG_REMOVE_FAILURE_JSON "residual-delete-failed" "1" "$SearchtRemoveFirstFailedPath" "$$payload.residueRoot = '$SearchtRemoveResidueRoot'; $$payload.failedCount = '$SearchtRemoveResidueCount'; $$payload.removeDirResult = '$SearchtRemoveDirResult'; $$payload.atomicSucceeded = ('$SearchtAtomicRemoveSucceeded' -eq '1')"
          !insertmacro SEARCHT_LOG_EVENT "code=${SEARCHT_E_INSTALL_DIR_REMOVE_OR_LOCKED} phase=residual-delete-failed userAction=cancel fatal=1 residueRoot=$SearchtRemoveResidueRoot failedCount=$SearchtRemoveResidueCount firstFailed=$SearchtRemoveFirstFailedPath removeDirResult=$SearchtRemoveDirResult removeResidueCount=$SearchtRemoveResidueCount atomicFailedPath=$SearchtAtomicFailedPath atomicSucceeded=$SearchtAtomicRemoveSucceeded"
          !insertmacro SEARCHT_FAIL_REPORTABLE_BILINGUAL ${SEARCHT_E_INSTALL_DIR_REMOVE_OR_LOCKED} "event=session-end result=fail code=${SEARCHT_E_INSTALL_DIR_REMOVE_OR_LOCKED} phase=residual-delete-failed userAction=cancel fatal=1 firstFailed=$SearchtRemoveFirstFailedPath lockers=$SearchtLockerList" "${SEARCHT_MSG_PREVIOUS_FILE_OPEN_EN}" "${SEARCHT_MSG_PREVIOUS_FILE_OPEN_ZH}" "${SEARCHT_MSG_CLOSE_SHOWN_FILE_ACTION_EN}" "${SEARCHT_MSG_CLOSE_SHOWN_FILE_ACTION_ZH}"
      ${EndIf}
      searcht_continue_after_rm:
      DetailPrint `SearchT previous installation had locked residual files; continuing after atomic cleanup succeeded: $INSTDIR`
      !insertmacro SEARCHT_LOG_EVENT "code=${SEARCHT_E_INSTALL_DIR_REMOVE_OR_LOCKED} phase=residual-delete-failed degraded=continue fatal=0 residueRoot=$SearchtRemoveResidueRoot failedCount=$SearchtRemoveResidueCount firstFailed=$SearchtRemoveFirstFailedPath removeDirResult=$SearchtRemoveDirResult removeResidueCount=$SearchtRemoveResidueCount atomicFailedPath=$SearchtAtomicFailedPath atomicSucceeded=$SearchtAtomicRemoveSucceeded"
    ${else}
      DetailPrint `Can't safely remove previous installation without atomic cleanup proof: $INSTDIR`
      ${IfNot} ${Silent}
        !insertmacro SEARCHT_PROMPT_FAILED_PATH_LOCKERS "$SearchtRemoveFirstFailedPath" "residual-delete-failed-no-atomic-proof" searcht_retry_remove_install_dir searcht_cancel_remove_no_atomic searcht_continue_remove_no_atomic
        searcht_cancel_remove_no_atomic:
      ${EndIf}
      searcht_continue_remove_no_atomic:
      !insertmacro SEARCHT_LOG_REMOVE_FAILURE_JSON "residual-delete-failed-no-atomic-proof" "1" "$SearchtRemoveFirstFailedPath" "$$payload.residueRoot = '$SearchtRemoveResidueRoot'; $$payload.failedCount = '$SearchtRemoveResidueCount'; $$payload.removeDirResult = '$SearchtRemoveDirResult'; $$payload.atomicSucceeded = ('$SearchtAtomicRemoveSucceeded' -eq '1')"
      !insertmacro SEARCHT_LOG_EVENT "code=${SEARCHT_E_INSTALL_DIR_REMOVE_OR_LOCKED} phase=residual-delete-failed-no-atomic-proof degraded=none fatal=1 residueRoot=$SearchtRemoveResidueRoot failedCount=$SearchtRemoveResidueCount firstFailed=$SearchtRemoveFirstFailedPath removeDirResult=$SearchtRemoveDirResult removeResidueCount=$SearchtRemoveResidueCount atomicFailedPath=$SearchtAtomicFailedPath atomicSucceeded=$SearchtAtomicRemoveSucceeded"
      !insertmacro SEARCHT_CLEAR_INSTALL_REGISTRY "remove-failed-before-quit"
      !insertmacro SEARCHT_FAIL_REPORTABLE_BILINGUAL ${SEARCHT_E_INSTALL_DIR_REMOVE_OR_LOCKED} "event=session-end result=fail code=${SEARCHT_E_INSTALL_DIR_REMOVE_OR_LOCKED} phase=residual-delete-failed-no-atomic-proof fatal=1 firstFailed=$SearchtRemoveFirstFailedPath removeDirResult=$SearchtRemoveDirResult lockers=$SearchtLockerList" "${SEARCHT_MSG_REMOVE_PREVIOUS_DIR_EN}" "${SEARCHT_MSG_REMOVE_PREVIOUS_DIR_ZH}" "${SEARCHT_MSG_CLOSE_INSTALL_DIR_ACTION_EN}" "${SEARCHT_MSG_CLOSE_INSTALL_DIR_ACTION_ZH}"
    ${endif}
  ${else}
    !insertmacro SEARCHT_LOG_EVENT "remove-final errors=0 instDir=$INSTDIR removeDirResult=$SearchtRemoveDirResult removeResidueCount=$SearchtRemoveResidueCount removeResidueRoot=$SearchtRemoveResidueRoot atomicFailedPath=$SearchtAtomicFailedPath atomicSucceeded=$SearchtAtomicRemoveSucceeded"
  ${endif}
!macroend

!macro customUnInit
  !insertmacro SEARCHT_LOG_EVENT "uninit instDir=$INSTDIR"
!macroend

!macro customUnInstall
  !insertmacro SEARCHT_LOG_EVENT "uninstall-section start instDir=$INSTDIR"
!macroend

!endif
