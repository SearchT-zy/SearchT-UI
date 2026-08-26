!ifndef SEARCHT_INSTALLER_PROCESS_CONTROL_NSH
!define SEARCHT_INSTALLER_PROCESS_CONTROL_NSH

Var /GLOBAL SearchtStopResult
Var /GLOBAL SearchtLockerResult
Var /GLOBAL SearchtLockerList
Var /GLOBAL SearchtLockerListZh
Var /GLOBAL SearchtLockerListEn
Var /GLOBAL SearchtLockerListFile
Var /GLOBAL SearchtCurrentOutDir

!macro SEARCHT_FIND_APP_PROCESS _RETURN
  nsExec::Exec `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -Command "& { \
    $$ErrorActionPreference = 'SilentlyContinue'; \
    $$log = '$SearchtSessionLogPath'; \
    if (-not $$log) { $$log = Join-Path $$env:TEMP '${SEARCHT_FALLBACK_LOG}' }; \
    $$instDir = [System.IO.Path]::GetFullPath('$INSTDIR'); \
    $$ownedPrefix = $$instDir.TrimEnd('\') + '\'; \
    $$psProc = @(Get-CimInstance -ClassName Win32_Process | Where-Object { $$_.ProcessId -eq $$PID })[0]; \
    $$installerPid = $$psProc.ParentProcessId; \
    function Test-SearchtOwnedProcess($$proc) { \
      $$path = $$proc.ExecutablePath; \
      if (-not $$path) { $$path = $$proc.Path } \
      if (-not $$path) { return $$false } \
      try { $$full = [System.IO.Path]::GetFullPath($$path) } catch { return $$false } \
      return $$proc.ProcessId -ne $$installerPid -and $$full.StartsWith($$ownedPrefix, [System.StringComparison]::CurrentCultureIgnoreCase) \
    } \
    $$hits = @(Get-CimInstance -ClassName Win32_Process | Where-Object { Test-SearchtOwnedProcess $$_ }); \
    $$payload = [ordered]@{ schemaVersion = 1; ts = (Get-Date -Format o); session = '$SearchtSessionId'; version = '${VERSION}'; arch = '${SEARCHT_TARGET_ARCH}'; updated = ('$SearchtIsUpdated' -eq '1'); instDir = '$INSTDIR'; event = 'process-find'; ownedPrefix = $$ownedPrefix; installerPid = $$installerPid; hits = $$hits.Count; owned = ($$hits.Count -gt 0) }; \
    Add-Content -LiteralPath $$log -Encoding UTF8 -Value ($$payload | ConvertTo-Json -Compress -Depth 8); \
    if ($$hits.Count -gt 0) { $$hitPayload = [ordered]@{ schemaVersion = 1; ts = (Get-Date -Format o); session = '$SearchtSessionId'; version = '${VERSION}'; arch = '${SEARCHT_TARGET_ARCH}'; updated = ('$SearchtIsUpdated' -eq '1'); instDir = '$INSTDIR'; event = 'process-find-hits'; processes = @($$hits | Select-Object ProcessId,ParentProcessId,Name,ExecutablePath,Path,CommandLine) }; Add-Content -LiteralPath $$log -Encoding UTF8 -Value ($$hitPayload | ConvertTo-Json -Compress -Depth 10); exit 0 } \
    exit 1 \
  }"`
  Pop ${_RETURN}
!macroend

!macro SEARCHT_STOP_APP_PROCESSES
  nsExec::Exec `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -Command "& { \
    $$ErrorActionPreference = 'SilentlyContinue'; \
    $$log = '$SearchtSessionLogPath'; \
    if (-not $$log) { $$log = Join-Path $$env:TEMP '${SEARCHT_FALLBACK_LOG}' }; \
    $$instDir = [System.IO.Path]::GetFullPath('$INSTDIR'); \
    $$ownedPrefix = $$instDir.TrimEnd('\') + '\'; \
    $$psProc = @(Get-CimInstance -ClassName Win32_Process | Where-Object { $$_.ProcessId -eq $$PID })[0]; \
    $$installerPid = $$psProc.ParentProcessId; \
    function Test-SearchtOwnedProcess($$proc) { \
      $$path = $$proc.ExecutablePath; \
      if (-not $$path) { $$path = $$proc.Path } \
      if (-not $$path) { return $$false } \
      try { $$full = [System.IO.Path]::GetFullPath($$path) } catch { return $$false } \
      return $$proc.ProcessId -ne $$installerPid -and $$full.StartsWith($$ownedPrefix, [System.StringComparison]::CurrentCultureIgnoreCase) \
    } \
    $$all = @(Get-CimInstance -ClassName Win32_Process); \
    $$owned = @($$all | Where-Object { Test-SearchtOwnedProcess $$_ }); \
    $$ids = @($$owned | ForEach-Object { [int]$$_.ProcessId }); \
    $$frontier = @($$ids); \
    while ($$frontier.Count -gt 0) { \
      $$children = @($$all | Where-Object { $$frontier -contains [int]$$_.ParentProcessId -and [int]$$_.ProcessId -ne [int]$$installerPid } | Where-Object { Test-SearchtOwnedProcess $$_ }); \
      $$childIds = @($$children | ForEach-Object { [int]$$_.ProcessId }); \
      $$ids = @($$ids + $$childIds | Select-Object -Unique); \
      $$frontier = $$childIds; \
    } \
    $$payload = [ordered]@{ schemaVersion = 1; ts = (Get-Date -Format o); session = '$SearchtSessionId'; version = '${VERSION}'; arch = '${SEARCHT_TARGET_ARCH}'; updated = ('$SearchtIsUpdated' -eq '1'); instDir = '$INSTDIR'; event = 'process-stop'; ids = @($$ids); result = 'start' }; \
    Add-Content -LiteralPath $$log -Encoding UTF8 -Value ($$payload | ConvertTo-Json -Compress -Depth 8); \
    foreach ($$id in ($$ids | Sort-Object -Descending)) { Stop-Process -Id $$id -Force -ErrorAction SilentlyContinue } \
    $$waitDeadline = (Get-Date).AddSeconds(8); \
    do { \
      $$remaining = @(Get-CimInstance -ClassName Win32_Process -Filter ('ProcessId = ' + ($$ids -join ' OR ProcessId = '))); \
      if ($$remaining.Count -eq 0) { break }; \
      Start-Sleep -Milliseconds 250; \
    } while ((Get-Date) -lt $$waitDeadline); \
    $$payload = [ordered]@{ schemaVersion = 1; ts = (Get-Date -Format o); session = '$SearchtSessionId'; version = '${VERSION}'; arch = '${SEARCHT_TARGET_ARCH}'; updated = ('$SearchtIsUpdated' -eq '1'); instDir = '$INSTDIR'; event = 'process-stop'; ids = @($$ids); result = 'done' }; \
    Add-Content -LiteralPath $$log -Encoding UTF8 -Value ($$payload | ConvertTo-Json -Compress -Depth 8); \
    exit 0 \
  }"`
  Pop $SearchtStopResult
!macroend

!macro SEARCHT_QUERY_LOCKERS_INLINE_LEGACY _TARGET_PATH _RETURN
  nsExec::Exec `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -Command "& { \
    $$ErrorActionPreference = 'SilentlyContinue'; \
    $$log = '$SearchtSessionLogPath'; \
    if (-not $$log) { $$log = Join-Path $$env:TEMP '${SEARCHT_FALLBACK_LOG}' }; \
    $$instDir = [System.IO.Path]::GetFullPath('$INSTDIR'); \
    $$targetPath = '${_TARGET_PATH}'; \
    $$currentOutDir = '$SearchtCurrentOutDir'; \
    $$lockerListPath = '$PLUGINSDIR\searcht-rm-lockers.txt'; \
    [System.IO.File]::WriteAllText($$lockerListPath, '', (New-Object System.Text.UTF8Encoding $$false)); \
    try { \
    function Test-SearchtSamePath($$left, $$right) { \
      if ([string]::IsNullOrWhiteSpace($$left) -or [string]::IsNullOrWhiteSpace($$right)) { return $$false }; \
      try { \
        $$leftFull = [System.IO.Path]::GetFullPath($$left).TrimEnd('\'); \
        $$rightFull = [System.IO.Path]::GetFullPath($$right).TrimEnd('\'); \
        return [string]::Equals($$leftFull, $$rightFull, [System.StringComparison]::CurrentCultureIgnoreCase) \
      } catch { return $$false } \
    } \
    $$psProc = @(Get-CimInstance -ClassName Win32_Process | Where-Object { $$_.ProcessId -eq $$PID })[0]; \
    $$installerPid = if ($$psProc) { [int]$$psProc.ParentProcessId } else { 0 }; \
    $$installerSelfLock = (Test-SearchtSamePath $$currentOutDir $$targetPath) -or (Test-SearchtSamePath $$currentOutDir $$instDir); \
      $$source = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('dXNpbmcgU3lzdGVtOyB1c2luZyBTeXN0ZW0uVGV4dDsgdXNpbmcgU3lzdGVtLlJ1bnRpbWUuSW50ZXJvcFNlcnZpY2VzOyBuYW1lc3BhY2UgQWlvblVpLlJlc3RhcnRNYW5hZ2VyIHsgcHVibGljIGVudW0gUk1fQVBQX1RZUEUgeyBSbVVua25vd25BcHAgPSAwLCBSbU1haW5XaW5kb3cgPSAxLCBSbU90aGVyV2luZG93ID0gMiwgUm1TZXJ2aWNlID0gMywgUm1FeHBsb3JlciA9IDQsIFJtQ29uc29sZSA9IDUsIFJtQ3JpdGljYWwgPSAxMDAwIH0gW1N0cnVjdExheW91dChMYXlvdXRLaW5kLlNlcXVlbnRpYWwpXSBwdWJsaWMgc3RydWN0IFJNX1VOSVFVRV9QUk9DRVNTIHsgcHVibGljIGludCBkd1Byb2Nlc3NJZDsgcHVibGljIFN5c3RlbS5SdW50aW1lLkludGVyb3BTZXJ2aWNlcy5Db21UeXBlcy5GSUxFVElNRSBQcm9jZXNzU3RhcnRUaW1lOyB9IFtTdHJ1Y3RMYXlvdXQoTGF5b3V0S2luZC5TZXF1ZW50aWFsLCBDaGFyU2V0ID0gQ2hhclNldC5Vbmljb2RlKV0gcHVibGljIHN0cnVjdCBSTV9QUk9DRVNTX0lORk8geyBwdWJsaWMgUk1fVU5JUVVFX1BST0NFU1MgUHJvY2VzczsgW01hcnNoYWxBcyhVbm1hbmFnZWRUeXBlLkJ5VmFsVFN0ciwgU2l6ZUNvbnN0ID0gMjU2KV0gcHVibGljIHN0cmluZyBzdHJBcHBOYW1lOyBbTWFyc2hhbEFzKFVubWFuYWdlZFR5cGUuQnlWYWxUU3RyLCBTaXplQ29uc3QgPSA2NCldIHB1YmxpYyBzdHJpbmcgc3RyU2VydmljZVNob3J0TmFtZTsgcHVibGljIFJNX0FQUF9UWVBFIEFwcGxpY2F0aW9uVHlwZTsgcHVibGljIHVpbnQgQXBwU3RhdHVzOyBwdWJsaWMgdWludCBUU1Nlc3Npb25JZDsgW01hcnNoYWxBcyhVbm1hbmFnZWRUeXBlLkJvb2wpXSBwdWJsaWMgYm9vbCBiUmVzdGFydGFibGU7IH0gcHVibGljIHN0YXRpYyBjbGFzcyBOYXRpdmUgeyBbRGxsSW1wb3J0KCJyc3RydG1nci5kbGwiLCBDaGFyU2V0PUNoYXJTZXQuVW5pY29kZSldIHB1YmxpYyBzdGF0aWMgZXh0ZXJuIGludCBSbVN0YXJ0U2Vzc2lvbihvdXQgdWludCBwU2Vzc2lvbkhhbmRsZSwgaW50IGR3U2Vzc2lvbkZsYWdzLCBTdHJpbmdCdWlsZGVyIHN0clNlc3Npb25LZXkpOyBbRGxsSW1wb3J0KCJyc3RydG1nci5kbGwiLCBDaGFyU2V0PUNoYXJTZXQuVW5pY29kZSldIHB1YmxpYyBzdGF0aWMgZXh0ZXJuIGludCBSbVJlZ2lzdGVyUmVzb3VyY2VzKHVpbnQgZHdTZXNzaW9uSGFuZGxlLCBVSW50MzIgbkZpbGVzLCBzdHJpbmdbXSByZ3NGaWxlbmFtZXMsIFVJbnQzMiBuQXBwbGljYXRpb25zLCBJbnRQdHIgcmdBcHBsaWNhdGlvbnMsIFVJbnQzMiBuU2VydmljZXMsIHN0cmluZ1tdIHJnc1NlcnZpY2VOYW1lcyk7IFtEbGxJbXBvcnQoInJzdHJ0bWdyLmRsbCIpXSBwdWJsaWMgc3RhdGljIGV4dGVybiBpbnQgUm1HZXRMaXN0KHVpbnQgZHdTZXNzaW9uSGFuZGxlLCBvdXQgdWludCBwblByb2NJbmZvTmVlZGVkLCByZWYgdWludCBwblByb2NJbmZvLCBbSW4sIE91dF0gUk1fUFJPQ0VTU19JTkZPW10gcmdBZmZlY3RlZEFwcHMsIHJlZiB1aW50IGxwZHdSZWJvb3RSZWFzb25zKTsgW0RsbEltcG9ydCgicnN0cnRtZ3IuZGxsIildIHB1YmxpYyBzdGF0aWMgZXh0ZXJuIGludCBSbUVuZFNlc3Npb24odWludCBwU2Vzc2lvbkhhbmRsZSk7IH0gfQ==')); \
      Add-Type -TypeDefinition $$source -ErrorAction Stop; \
      $$session = [uint32]0; $$key = New-Object System.Text.StringBuilder 64; \
      $$result = [SearchT-UI.RestartManager.Native]::RmStartSession([ref]$$session, 0, $$key); \
      if ($$result -ne 0) { throw \"RmStartSession=$$result\" } \
      try { \
        $$ERROR_MORE_DATA = 234; \
        $$ERROR_ACCESS_DENIED = 5; \
        $$resources = @(); \
        if ($$targetPath -and (Test-Path -LiteralPath $$targetPath -PathType Leaf)) { \
          $$resources = @([System.IO.Path]::GetFullPath($$targetPath)); \
        } elseif ($$targetPath -and (Test-Path -LiteralPath $$targetPath -PathType Container)) { \
          $$root = [System.IO.Path]::GetFullPath($$targetPath); \
          $$topLevel = @(Get-ChildItem -LiteralPath $$root -Force -File -ErrorAction SilentlyContinue | ForEach-Object { $$_.FullName }); \
          $$knownRelative = @('${SEARCHT_APP_EXECUTABLE_FILENAME}', '${UNINSTALL_FILENAME}', 'resources\app.asar', 'resources\app-update.yml', 'resources\bundled-backend\win32-x64\searcht-backend.exe'); \
          $$known = @($$knownRelative | ForEach-Object { Join-Path $$root $$_ } | Where-Object { Test-Path -LiteralPath $$_ -PathType Leaf }); \
          $$resources = @($$topLevel + $$known | Where-Object { $$_ -and $$_.Trim().Length -gt 0 } | Select-Object -Unique | Select-Object -First 512); \
        } \
        $$payload = [ordered]@{ schemaVersion = 1; ts = (Get-Date -Format o); session = '$SearchtSessionId'; version = '${VERSION}'; arch = '${SEARCHT_TARGET_ARCH}'; updated = ('$SearchtIsUpdated' -eq '1'); instDir = '$INSTDIR'; event = 'rm-query-start'; target = $$targetPath; resources = $$resources.Count; outerInstallerPid = $$installerPid; currentOutDir = $$currentOutDir; installerSelfLock = $$installerSelfLock }; \
        Add-Content -LiteralPath $$log -Encoding UTF8 -Value ($$payload | ConvertTo-Json -Compress -Depth 8); \
        if ($$resources.Count -eq 0) { \
          if ($$installerSelfLock -and $$installerPid -gt 0) { \
            $$lockerText = 'SearchT-UI installer(' + $$installerPid + ')'; \
            [System.IO.File]::WriteAllText($$lockerListPath, $$lockerText, (New-Object System.Text.UTF8Encoding $$false)); \
            $$selfLockers = @([pscustomobject]@{ name = 'SearchT-UI installer'; pid = [int]$$installerPid }); \
            $$payload = [ordered]@{ schemaVersion = 1; ts = (Get-Date -Format o); session = '$SearchtSessionId'; version = '${VERSION}'; arch = '${SEARCHT_TARGET_ARCH}'; updated = ('$SearchtIsUpdated' -eq '1'); instDir = '$INSTDIR'; event = 'rm-lockers'; target = $$targetPath; resources = 0; count = 1; blockingProcesses = @($$selfLockers); fallbackReason = 'installer-self-lock'; message = 'The installer process is using the install directory as its current output directory.'; outerInstallerPid = $$installerPid; currentOutDir = $$currentOutDir; installerSelfLock = $$true }; \
            Add-Content -LiteralPath $$log -Encoding UTF8 -Value ($$payload | ConvertTo-Json -Compress -Depth 10); \
            exit 0 \
          }; \
          $$payload = [ordered]@{ schemaVersion = 1; ts = (Get-Date -Format o); session = '$SearchtSessionId'; version = '${VERSION}'; arch = '${SEARCHT_TARGET_ARCH}'; updated = ('$SearchtIsUpdated' -eq '1'); instDir = '$INSTDIR'; event = 'rm-lockers'; target = $$targetPath; resources = 0; count = 0; blockingProcesses = @(); fallbackReason = 'restart-manager-no-resources'; message = 'Restart Manager had no existing files to query for this path.'; outerInstallerPid = $$installerPid; currentOutDir = $$currentOutDir; installerSelfLock = $$installerSelfLock }; \
          Add-Content -LiteralPath $$log -Encoding UTF8 -Value ($$payload | ConvertTo-Json -Compress -Depth 8); \
          exit 1 \
        } \
        for ($$i = 0; $$i -lt $$resources.Count; $$i += 256) { \
          $$end = [Math]::Min($$i + 255, $$resources.Count - 1); \
          $$chunk = [string[]]$$resources[$$i..$$end]; \
          $$result = [SearchT-UI.RestartManager.Native]::RmRegisterResources($$session, [uint32]$$chunk.Count, $$chunk, 0, [IntPtr]::Zero, 0, $$null); \
          if ($$result -ne 0) { throw \"RmRegisterResources=$$result\" } \
        } \
        $$needed = [uint32]0; $$count = [uint32]0; $$reasons = [uint32]0; \
        for ($$attempt = 0; $$attempt -lt 6; $$attempt++) { \
          if ($$attempt -gt 0) { Start-Sleep -Milliseconds (50 * $$attempt) } \
          $$needed = [uint32]0; $$count = [uint32]0; $$reasons = [uint32]0; \
          $$result = [SearchT-UI.RestartManager.Native]::RmGetList($$session, [ref]$$needed, [ref]$$count, $$null, [ref]$$reasons); \
          if ($$result -ne $$ERROR_ACCESS_DENIED) { break } \
        } \
        if ($$result -ne 0 -and $$result -ne 234) { throw \"RmGetList=$$result\" } \
        $$lockers = @(); \
        if ($$result -eq $$ERROR_MORE_DATA -or $$needed -gt 0) { \
          for ($$attempt = 0; $$attempt -lt 6; $$attempt++) { \
            if ($$attempt -gt 0) { Start-Sleep -Milliseconds (50 * $$attempt) } \
            $$count = $$needed; \
            $$apps = New-Object 'SearchT-UI.RestartManager.RM_PROCESS_INFO[]' $$count; \
            $$result = [SearchT-UI.RestartManager.Native]::RmGetList($$session, [ref]$$needed, [ref]$$count, $$apps, [ref]$$reasons); \
            if ($$result -ne $$ERROR_ACCESS_DENIED -and $$result -ne $$ERROR_MORE_DATA) { break } \
          } \
          if ($$result -ne 0) { throw \"RmGetList=$$result\" } \
          $$lockers = @($$apps | Select-Object -First $$count | Where-Object { $$_.Process.dwProcessId -gt 0 } | ForEach-Object { \
            $$name = $$_.strAppName; \
            if (-not $$name) { $$proc = Get-Process -Id $$_.Process.dwProcessId -ErrorAction SilentlyContinue; if ($$proc) { $$name = $$proc.ProcessName } } \
            if (-not $$name) { $$name = 'unknown' } \
            [pscustomobject]@{ name = $$name; pid = [int]$$_.Process.dwProcessId } \
          }); \
        } \
        if ($$lockers.Count -eq 0 -and $$installerSelfLock -and $$installerPid -gt 0) { $$lockers = @([pscustomobject]@{ name = 'SearchT-UI installer'; pid = [int]$$installerPid }) }; \
        $$lockerText = @($$lockers | ForEach-Object { $$_.name + '(' + $$_.pid + ')' }) -join ', '; \
        [System.IO.File]::WriteAllText($$lockerListPath, $$lockerText, (New-Object System.Text.UTF8Encoding $$false)); \
        $$payload = [ordered]@{ schemaVersion = 1; ts = (Get-Date -Format o); session = '$SearchtSessionId'; version = '${VERSION}'; arch = '${SEARCHT_TARGET_ARCH}'; updated = ('$SearchtIsUpdated' -eq '1'); instDir = '$INSTDIR'; event = 'rm-lockers'; target = $$targetPath; resources = $$resources.Count; count = $$needed; blockingProcesses = @($$lockers); fallbackReason = ''; message = ''; outerInstallerPid = $$installerPid; currentOutDir = $$currentOutDir; installerSelfLock = $$installerSelfLock }; \
        if ($$installerSelfLock -and $$lockers.Count -gt 0) { $$payload.fallbackReason = 'installer-self-lock'; $$payload.message = 'The installer process is using the install directory as its current output directory.' } elseif ($$lockers.Count -eq 0) { $$payload.fallbackReason = 'restart-manager-no-process'; $$payload.message = 'Windows did not identify a specific locking process. Close terminals, editors, and file managers opened in the install folder.' }; \
        Add-Content -LiteralPath $$log -Encoding UTF8 -Value ($$payload | ConvertTo-Json -Compress -Depth 10); \
        if ($$lockers.Count -gt 0) { exit 0 } else { exit 1 } \
      } finally { [void][SearchT-UI.RestartManager.Native]::RmEndSession($$session) } \
    } catch { \
      $$payload = [ordered]@{ schemaVersion = 1; ts = (Get-Date -Format o); session = '$SearchtSessionId'; version = '${VERSION}'; arch = '${SEARCHT_TARGET_ARCH}'; updated = ('$SearchtIsUpdated' -eq '1'); instDir = '$INSTDIR'; event = 'rm-error'; target = $$targetPath; error = $$_.Exception.Message }; \
      Add-Content -LiteralPath $$log -Encoding UTF8 -Value ($$payload | ConvertTo-Json -Compress -Depth 8); \
      exit 1 \
    } \
  }"`
  Pop ${_RETURN}
!macroend

!macro SEARCHT_QUERY_LOCKERS _TARGET_PATH _RETURN
  InitPluginsDir
  File /oname=$PLUGINSDIR\searcht-query-lockers.ps1 "${PROJECT_DIR}\resources\windows\support\query-lockers.ps1"
  nsExec::Exec `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "$PLUGINSDIR\searcht-query-lockers.ps1" -LogPath "$SearchtSessionLogPath" -InstDir "$INSTDIR" -TargetPath "${_TARGET_PATH}" -LockerListPath "$PLUGINSDIR\searcht-rm-lockers.txt" -Session "$SearchtSessionId" -Version "${VERSION}" -Arch "${SEARCHT_TARGET_ARCH}" -Updated "$SearchtIsUpdated" -CurrentOutDir "$SearchtCurrentOutDir"`
  Pop ${_RETURN}
!macroend

!macro SEARCHT_CAPTURE_FAILED_PATH_LOCKERS _FAILED_PATH
  !insertmacro SEARCHT_QUERY_LOCKERS "${_FAILED_PATH}" $SearchtLockerResult
  StrCpy $SearchtLockerList ""
  ClearErrors
  SetDetailsPrint none
  FileOpen $SearchtLockerListFile "$PLUGINSDIR\searcht-rm-lockers.txt" r
  ${IfNot} ${Errors}
    FileRead $SearchtLockerListFile $SearchtLockerList
    FileClose $SearchtLockerListFile
  ${EndIf}
  SetDetailsPrint lastused
  ${If} $SearchtLockerList == ""
    ${If} $SearchtLockerResult == 0
      StrCpy $SearchtLockerList "${SEARCHT_MSG_UNKNOWN_PROCESS_EN}"
      StrCpy $SearchtLockerListZh "${SEARCHT_MSG_UNKNOWN_PROCESS_ZH}"
      StrCpy $SearchtLockerListEn "${SEARCHT_MSG_UNKNOWN_PROCESS_EN}"
    ${Else}
      StrCpy $SearchtLockerList "${SEARCHT_MSG_LOCKER_UNKNOWN_EN}"
      StrCpy $SearchtLockerListZh "${SEARCHT_MSG_LOCKER_UNKNOWN_ZH}"
      StrCpy $SearchtLockerListEn "${SEARCHT_MSG_LOCKER_UNKNOWN_EN}"
    ${EndIf}
  ${Else}
    StrCpy $SearchtLockerListZh "$SearchtLockerList"
    StrCpy $SearchtLockerListEn "$SearchtLockerList"
  ${EndIf}
!macroend

!macro SEARCHT_PROMPT_FAILED_PATH_LOCKERS _FAILED_PATH _PHASE _RETRY_LABEL _CANCEL_LABEL _CONTINUE_LABEL
  !insertmacro SEARCHT_CAPTURE_FAILED_PATH_LOCKERS "${_FAILED_PATH}"
  ${If} $SearchtLockerResult == 0
    ${IfNot} ${Silent}
      MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "${SEARCHT_MSG_FILE_OR_FOLDER_IN_USE_ZH}$\r$\n${_FAILED_PATH}$\r$\n$\r$\n${SEARCHT_MSG_APPLICATION_USING_IT_ZH}$\r$\n$SearchtLockerListZh$\r$\n$\r$\n${SEARCHT_MSG_CLOSE_LISTED_RETRY_ZH}$\r$\n$\r$\n${SEARCHT_MSG_INSTALLER_LOG_ZH}:$\r$\n$SearchtSessionLogPath$\r$\n$\r$\n${SEARCHT_MSG_BLOCK_SEPARATOR}$\r$\n$\r$\n${SEARCHT_MSG_FILE_OR_FOLDER_IN_USE_EN}$\r$\n${_FAILED_PATH}$\r$\n$\r$\n${SEARCHT_MSG_APPLICATION_USING_IT_EN}$\r$\n$SearchtLockerListEn$\r$\n$\r$\n${SEARCHT_MSG_CLOSE_LISTED_RETRY_EN}$\r$\n$\r$\n${SEARCHT_MSG_INSTALLER_LOG_EN}:$\r$\n$SearchtSessionLogPath" /SD IDCANCEL IDRETRY ${_RETRY_LABEL} IDCANCEL ${_CANCEL_LABEL}
    ${EndIf}
  ${EndIf}
  Goto ${_CONTINUE_LABEL}
!macroend

!macro SEARCHT_WRITE_INSTALLER_LAST_FAILURE_MARKER
  Push $9
  ${If} $SearchtIsUpdated == "1"
    ${If} ${Silent}
      nsExec::Exec `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -Command "& { \
        $$ErrorActionPreference = 'Stop'; \
        $$appDir = Join-Path $$env:APPDATA 'SearchT-UI'; \
        $$marker = Join-Path $$appDir 'installer-last-failure.json'; \
        $$log = '$SearchtSessionLogPath'; \
        if (-not $$log) { $$log = Join-Path $$env:TEMP '${SEARCHT_FALLBACK_LOG}' }; \
        try { \
          New-Item -ItemType Directory -Path $$appDir -Force | Out-Null; \
          $$payload = [ordered]@{ \
            schemaVersion = 1; \
            kind = 'app-cannot-be-closed'; \
            phase = 'customCheckAppRunning'; \
            silent = $$true; \
            updated = $$true; \
            retryCount = 3; \
            instDir = '$INSTDIR'; \
            logPath = $$log; \
            at = (Get-Date -Format o) \
          }; \
          $$json = $$payload | ConvertTo-Json -Compress -Depth 4; \
          [System.IO.File]::WriteAllText($$marker, $$json, (New-Object System.Text.UTF8Encoding $$false)); \
          $$logPayload = [ordered]@{ schemaVersion = 1; ts = (Get-Date -Format o); session = '$SearchtSessionId'; version = '${VERSION}'; arch = '${SEARCHT_TARGET_ARCH}'; updated = ('$SearchtIsUpdated' -eq '1'); instDir = '$INSTDIR'; event = 'marker-write'; result = 'ok'; path = $$marker; marker = $$payload }; \
          Add-Content -LiteralPath $$log -Encoding UTF8 -Value ($$logPayload | ConvertTo-Json -Compress -Depth 8) \
        } catch { \
          $$logPayload = [ordered]@{ schemaVersion = 1; ts = (Get-Date -Format o); session = '$SearchtSessionId'; version = '${VERSION}'; arch = '${SEARCHT_TARGET_ARCH}'; updated = ('$SearchtIsUpdated' -eq '1'); instDir = '$INSTDIR'; event = 'marker-write'; result = 'failed'; path = $$marker; error = $$_.Exception.Message }; \
          Add-Content -LiteralPath $$log -Encoding UTF8 -Value ($$logPayload | ConvertTo-Json -Compress -Depth 8) \
        } \
      }"`
      Pop $9
    ${EndIf}
  ${EndIf}
  Pop $9
!macroend

!macro customCheckAppRunning
  Var /GLOBAL SearchtCheckResult
  Var /GLOBAL SearchtCloseRetries
  InitPluginsDir
  !insertmacro SEARCHT_SESSION_BEGIN

  !insertmacro SEARCHT_WAIT_FOR_UPDATED_APP_EXIT
  !insertmacro SEARCHT_FIND_APP_PROCESS $SearchtCheckResult
  ${If} $SearchtCheckResult == 0
    MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION "$(appRunning)" /SD IDOK IDOK searcht_do_stop_process
    !insertmacro SEARCHT_CLEAR_ACTIVE_INSTALLER_MARKER
    Quit

    searcht_do_stop_process:
      DetailPrint "$(appClosing)"
      !insertmacro SEARCHT_STOP_APP_PROCESSES
      StrCpy $SearchtCloseRetries 0

    searcht_wait_for_close:
      Sleep 1000
      !insertmacro SEARCHT_FIND_APP_PROCESS $SearchtCheckResult
      ${If} $SearchtCheckResult == 0
        IntOp $SearchtCloseRetries $SearchtCloseRetries + 1
        ${If} $SearchtCloseRetries > 10
          MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "${SEARCHT_MSG_CLOSE_OR_REMOVE_PREVIOUS_ZH}$\r$\n$\r$\n${SEARCHT_MSG_MAY_USE_INSTALL_DIR_ZH}$\r$\n$INSTDIR$\r$\n$\r$\n${SEARCHT_MSG_RETRY_AFTER_CLOSING_DIR_ZH}$\r$\n$\r$\n${SEARCHT_MSG_BLOCK_SEPARATOR}$\r$\n$\r$\n${SEARCHT_MSG_CLOSE_OR_REMOVE_PREVIOUS_EN}$\r$\n$\r$\n${SEARCHT_MSG_MAY_USE_INSTALL_DIR_EN}$\r$\n$INSTDIR$\r$\n$\r$\n${SEARCHT_MSG_RETRY_AFTER_CLOSING_DIR_EN}" /SD IDCANCEL IDRETRY searcht_wait_for_close
          !insertmacro SEARCHT_WRITE_INSTALLER_LAST_FAILURE_MARKER
          !insertmacro SEARCHT_FAIL_REPORTABLE_BILINGUAL_DIAGNOSTICS ${SEARCHT_E_INSTALL_DIR_REMOVE_OR_LOCKED} "event=session-end result=fail code=${SEARCHT_E_INSTALL_DIR_REMOVE_OR_LOCKED} phase=app-cannot-be-closed retryCount=$SearchtCloseRetries instDir=$INSTDIR" "${SEARCHT_MSG_CLOSE_OR_REMOVE_PREVIOUS_EN}" "${SEARCHT_MSG_CLOSE_OR_REMOVE_PREVIOUS_ZH}" "${SEARCHT_MSG_CLOSE_INSTALL_DIR_ACTION_EN}" "${SEARCHT_MSG_CLOSE_INSTALL_DIR_ACTION_ZH}" "app-cannot-be-closed retryCount=$SearchtCloseRetries instDir=$INSTDIR" "app-cannot-be-closed retryCount=$SearchtCloseRetries instDir=$INSTDIR"
        ${Else}
          !insertmacro SEARCHT_STOP_APP_PROCESSES
          Goto searcht_wait_for_close
        ${EndIf}
      ${EndIf}
  ${EndIf}

!macroend

!endif
