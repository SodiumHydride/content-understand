; Custom NSIS uninstall logic — kill app processes before file deletion.
; electron-builder includes this via nsis.include.

!macro customUnInstall
  ; Kill the sidecar and its entire process tree (ollama, llama-server)
  nsExec::ExecToStack 'taskkill /F /T /IM sidecar.exe'
  nsExec::ExecToStack 'taskkill /F /T /IM sidecar.exe'
  nsExec::ExecToStack 'taskkill /F /T /IM ollama.exe'
  nsExec::ExecToStack 'taskkill /F /T /IM llama-server.exe'
  ; Wait for processes to fully exit and release file locks
  Sleep 2000
!macroend
