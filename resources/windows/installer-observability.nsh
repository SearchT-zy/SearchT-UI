!ifndef SEARCHT_INSTALLER_OBSERVABILITY_NSH
!define SEARCHT_INSTALLER_OBSERVABILITY_NSH

!define SEARCHT_APP_EXECUTABLE_FILENAME "SearchT.exe"
!define SEARCHT_FALLBACK_LOG "searcht-installer-${VERSION}-fallback-log.jsonl"

!pragma warning disable 6001
Var /GLOBAL SearchtSessionId
Var /GLOBAL SearchtIsUpdated
Var /GLOBAL SearchtSessionLogResult
Var /GLOBAL SearchtSessionLogPath

!macro SEARCHT_SESSION_HEADER
  !insertmacro SEARCHT_SLOG "event=header arch=${SEARCHT_TARGET_ARCH} updated=$SearchtIsUpdated instDir=$INSTDIR version=${VERSION} log=$SearchtSessionLogPath detail=customHeader"
!macroend

!macro SEARCHT_SLOG _MESSAGE
  Push $9
  nsExec::Exec `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -Command "& { \
    $$ErrorActionPreference = 'SilentlyContinue'; \
    $$log = '$SearchtSessionLogPath'; \
    if (-not $$log) { $$log = Join-Path $$env:TEMP '${SEARCHT_FALLBACK_LOG}' }; \
    $$session = '$SearchtSessionId'; \
    if (-not $$session) { $$session = 'uninitialized' }; \
    $$message = '${_MESSAGE}'; \
    $$event = 'log'; \
    if ($$message -match '(^|\s)event=([^\s]+)') { $$event = $$Matches[2] } else { $$first = @($$message -split '\s+', 2)[0]; if ($$first -and $$first -notmatch '=') { $$event = $$first } }; \
    $$payload = [ordered]@{ schemaVersion = 1; ts = (Get-Date -Format o); session = $$session; version = '${VERSION}'; arch = '${SEARCHT_TARGET_ARCH}'; updated = ('$SearchtIsUpdated' -eq '1'); instDir = '$INSTDIR'; event = $$event; message = $$message }; \
    $$json = $$payload | ConvertTo-Json -Compress -Depth 8; \
    Add-Content -LiteralPath $$log -Encoding UTF8 -Value $$json \
  }"`
  Pop $9
  Pop $9
!macroend

!macro SEARCHT_LOG_EVENT _MESSAGE
  Push $9
  nsExec::Exec `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -Command "& { \
    $$ErrorActionPreference = 'SilentlyContinue'; \
    $$log = '$SearchtSessionLogPath'; \
    if (-not $$log) { $$log = Join-Path $$env:TEMP '${SEARCHT_FALLBACK_LOG}' }; \
    $$session = '$SearchtSessionId'; \
    if (-not $$session) { $$session = 'uninitialized' }; \
    $$message = '${_MESSAGE}'; \
    $$event = 'log'; \
    if ($$message -match '(^|\s)event=([^\s]+)') { $$event = $$Matches[2] } else { $$first = @($$message -split '\s+', 2)[0]; if ($$first -and $$first -notmatch '=') { $$event = $$first } }; \
    $$payload = [ordered]@{ schemaVersion = 1; ts = (Get-Date -Format o); session = $$session; version = '${VERSION}'; arch = '${SEARCHT_TARGET_ARCH}'; updated = ('$SearchtIsUpdated' -eq '1'); instDir = '$INSTDIR'; event = $$event; message = $$message }; \
    $$json = $$payload | ConvertTo-Json -Compress -Depth 8; \
    Add-Content -LiteralPath $$log -Encoding UTF8 -Value $$json \
  }"`
  Pop $9
  Pop $9
!macroend

!macro SEARCHT_LOG_JSON_EVENT _EVENT _JSON_FIELDS
  Push $9
  nsExec::Exec `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -Command "& { \
    $$ErrorActionPreference = 'SilentlyContinue'; \
    $$log = '$SearchtSessionLogPath'; \
    if (-not $$log) { $$log = Join-Path $$env:TEMP '${SEARCHT_FALLBACK_LOG}' }; \
    $$session = '$SearchtSessionId'; \
    if (-not $$session) { $$session = 'uninitialized' }; \
    $$payload = [ordered]@{ schemaVersion = 1; ts = (Get-Date -Format o); session = $$session; version = '${VERSION}'; arch = '${SEARCHT_TARGET_ARCH}'; updated = ('$SearchtIsUpdated' -eq '1'); instDir = '$INSTDIR'; event = '${_EVENT}' }; \
    ${_JSON_FIELDS}; \
    $$json = $$payload | ConvertTo-Json -Compress -Depth 8; \
    Add-Content -LiteralPath $$log -Encoding UTF8 -Value $$json \
  }"`
  Pop $9
  Pop $9
!macroend

!macro SEARCHT_SESSION_BEGIN
  ${GetParameters} $R9
  ClearErrors
  ${GetOptions} $R9 "--installer-log=" $R8
  ${IfNot} ${Errors}
    StrCpy $SearchtSessionLogPath $R8
  ${EndIf}
  ClearErrors
  ${GetOptions} $R9 "--installer-session=" $R8
  ${IfNot} ${Errors}
    StrCpy $SearchtSessionId $R8
  ${EndIf}

  ${If} $SearchtSessionLogPath == ""
    nsExec::ExecToStack `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -Command "$$id = '$SearchtSessionId'; if (-not $$id) { $$id = [guid]::NewGuid().ToString('N').Substring(0,12) }; $$stamp = Get-Date -Format 'yyyyMMdd'; $$name = 'searcht-installer-${VERSION}-' + $$stamp + '-log.jsonl'; $$log = Join-Path $$env:TEMP $$name; [Console]::Out.Write($$id + '|' + $$log)"`
    Pop $SearchtSessionLogResult
    Pop $SearchtSessionLogResult
    StrCpy $SearchtSessionId $SearchtSessionLogResult 12
    StrCpy $SearchtSessionLogPath $SearchtSessionLogResult 1024 13
  ${ElseIf} $SearchtSessionId == ""
    nsExec::ExecToStack `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -Command "[Console]::Out.Write([guid]::NewGuid().ToString('N').Substring(0,12))"`
    Pop $SearchtSessionLogResult
    Pop $SearchtSessionLogResult
    StrCpy $SearchtSessionId $SearchtSessionLogResult
  ${EndIf}

  ClearErrors
  ${GetOptions} $R9 "--updated" $R8
  StrCpy $SearchtIsUpdated "0"
  ${IfNot} ${Errors}
    StrCpy $SearchtIsUpdated "1"
  ${EndIf}

  !insertmacro SEARCHT_SLOG "event=session-begin detail=preInit"
!macroend

!macro SEARCHT_LOG_EXTRACT_RESULT _METHOD
  ${IfNot} ${FileExists} "$INSTDIR\${SEARCHT_APP_EXECUTABLE_FILENAME}"
    !insertmacro SEARCHT_FAIL_UX \
      "${SEARCHT_E_EXTRACT_FAILED}" \
      "event=extract result=fail method=${_METHOD} missing=${SEARCHT_APP_EXECUTABLE_FILENAME}" \
      "${SEARCHT_MSG_EXTRACT_FAILED_ZH}" \
      "${SEARCHT_MSG_EXTRACT_FAILED_EN}" \
      "${SEARCHT_MSG_EXTRACT_FAILED_ACTION_ZH}" \
      "${SEARCHT_MSG_EXTRACT_FAILED_ACTION_EN}" \
      "extract result=fail method=${_METHOD} missing=${SEARCHT_APP_EXECUTABLE_FILENAME} instDir=$INSTDIR" \
      "extract result=fail method=${_METHOD} missing=${SEARCHT_APP_EXECUTABLE_FILENAME} instDir=$INSTDIR"
  ${Else}
    !insertmacro SEARCHT_SLOG "event=extract result=ok method=${_METHOD} detail=customFiles_${SEARCHT_TARGET_ARCH}"
  ${EndIf}
!macroend

!macro SEARCHT_SESSION_SUCCESS
  !insertmacro SEARCHT_SLOG "event=session-end result=success detail=customInstall"
!macroend

!endif
