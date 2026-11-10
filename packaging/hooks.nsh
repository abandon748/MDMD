; Keep the standard Tauri installer flow, but never terminate the user's editor.
!macroundef CheckIfAppIsRunning
!macro CheckIfAppIsRunning path name
  ${If} ${FileExists} "${path}"
  System::Call 'kernel32::CreateFileW(w "${path}", i 0xC0000000, i 3, p 0, i 3, i 0, p 0) p .r0'
  ${If} $0 == -1
    MessageBox MB_OK|MB_ICONSTOP "Please save and close MDMD, then retry. The executable is busy or not writable. / 请保存并关闭 MDMD 后重试；程序被占用或不可写。" /SD IDOK
    SetErrorLevel 2
    Abort
  ${EndIf}
  System::Call 'kernel32::CloseHandle(p r0)'
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ${If} $UpdateMode <> 1
    ReadRegStr $0 HKCU "${MANUPRODUCTKEY}" ""
    ${If} $0 == $INSTDIR
      DeleteRegValue HKCU "${MANUPRODUCTKEY}" ""
      DeleteRegValue HKCU "${MANUPRODUCTKEY}" "Installer Language"
      DeleteRegKey /ifempty HKCU "${MANUPRODUCTKEY}"
      DeleteRegKey /ifempty HKCU "${MANUKEY}"
    ${EndIf}
  ${EndIf}
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro CheckIfAppIsRunning "$INSTDIR\${MAINBINARYNAME}.exe" "${PRODUCTNAME}"
  ${If} $UpdateMode <> 1
    IfFileExists "$INSTDIR\${MAINBINARYNAME}.exe" 0 cleanup_missing
    ClearErrors
    ExecWait '"$INSTDIR\${MAINBINARYNAME}.exe" --uninstall-integration' $0
    ${If} ${Errors}
    ${OrIf} $0 <> 0
      MessageBox MB_OK|MB_ICONSTOP "MDMD could not safely remove its shell integration. Repair the installation or resolve the registry conflict and retry. Your files are retained. / 系统集成清理失败，请修复安装或解决注册表冲突后重试，文件已保留。" /SD IDOK
      SetErrorLevel 3
      Abort
    ${EndIf}
    Goto cleanup_done
    cleanup_missing:
      MessageBox MB_OK|MB_ICONSTOP "MDMD.exe is missing. Reinstall this version before uninstalling. / 程序缺失，请先重新安装本版本再卸载。" /SD IDOK
      SetErrorLevel 3
      Abort
    cleanup_done:
  ${EndIf}
!macroend
