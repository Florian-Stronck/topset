# Pages for the setup wizard, included by electron-builder (nsis.include). The sidebar
# bitmap on the welcome and finish pages is drawn by scripts/make-icon.mjs.
#
# Updates install silently and never show these pages, so the tutorial choice below is
# only ever made by someone sitting at the wizard.

LangString welcomeTitle 1033 "Welcome to Topset"
LangString welcomeTitle 1031 "Willkommen bei Topset"
LangString welcomeTitle 1036 "Bienvenue dans Topset"

LangString welcomeText 1033 "Topset installs for your Windows account only, so no administrator rights are needed.$\r$\n$\r$\nYour athletes and programs are kept in your user folder. Updates and uninstalling leave them alone.$\r$\n$\r$\nClick Next to continue."
LangString welcomeText 1031 "Topset wird nur für dein Windows-Konto installiert, Administratorrechte sind nicht nötig.$\r$\n$\r$\nDeine Athleten und Programme liegen in deinem Benutzerordner. Updates und Deinstallieren lassen sie unangetastet.$\r$\n$\r$\nKlicke auf Weiter, um fortzufahren."
LangString welcomeText 1036 "Topset s'installe pour votre compte Windows uniquement, sans droits d'administrateur.$\r$\n$\r$\nVos athlètes et programmes restent dans votre dossier utilisateur. Les mises à jour et la désinstallation n'y touchent pas.$\r$\n$\r$\nCliquez sur Suivant pour continuer."

LangString finishTitle 1033 "Topset is installed"
LangString finishTitle 1031 "Topset ist installiert"
LangString finishTitle 1036 "Topset est installé"

LangString finishText 1033 "New versions install themselves in the background."
LangString finishText 1031 "Neue Versionen installieren sich im Hintergrund."
LangString finishText 1036 "Les nouvelles versions s'installent en arrière-plan."

LangString tutorialCheckbox 1033 "Show the tutorial on first start"
LangString tutorialCheckbox 1031 "Tutorial beim ersten Start zeigen"
LangString tutorialCheckbox 1036 "Afficher le tutoriel au premier démarrage"

# Topset's own dark colours (src/app/globals.css) instead of the white wizard. MUI paints
# the page backgrounds and headers from these; the window frame, buttons and progress bar
# are darkened by hand below. Classic checkboxes, because themed ones ignore text colour.
!define MUI_BGCOLOR 0A0A0C
!define MUI_TEXTCOLOR E8E8EC
!define MUI_FORCECLASSICCONTROLS

# Per user, always: skips the "only for me / anyone" page, which would ask for admin.
!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
!macroend

!macro customWelcomePage
  # Called as each page shows, since MUI shows the window's own controls again per page:
  # the strip behind the buttons, the title bar (Windows 10 2004 and later), the buttons,
  # and hidden, the light etched lines and the version stamp, which ignore colours.
  Function DarkWindow
    SetCtlColors $HWNDPARENT E8E8EC 0A0A0C
    System::Call 'dwmapi::DwmSetWindowAttribute(p$HWNDPARENT,i20,*i1,i4)'
    ${ForEach} $1 1 3 + 1
      GetDlgItem $0 $HWNDPARENT $1
      System::Call 'UXTHEME::SetWindowTheme(p$0,w"DarkMode_Explorer",p0)'
    ${Next}
    GetDlgItem $0 $HWNDPARENT 1028
    ShowWindow $0 ${SW_HIDE}
    GetDlgItem $0 $HWNDPARENT 1256
    ShowWindow $0 ${SW_HIDE}
    GetDlgItem $0 $HWNDPARENT 1035
    ShowWindow $0 ${SW_HIDE}
    GetDlgItem $0 $HWNDPARENT 1036
    ShowWindow $0 ${SW_HIDE}
    GetDlgItem $0 $HWNDPARENT 1045
    ShowWindow $0 ${SW_HIDE}
  FunctionEnd

  !define MUI_PAGE_CUSTOMFUNCTION_SHOW DarkWindow
  !define MUI_WELCOMEPAGE_TITLE "$(welcomeTitle)"
  !define MUI_WELCOMEPAGE_TEXT "$(welcomeText)"
  !insertmacro MUI_PAGE_WELCOME
!macroend

# Inserted just before the install progress page, which MUI only half darkens: its header.
!macro customPageAfterChangeDir
  Function DarkInstFiles
    Call DarkWindow
    FindWindow $0 "#32770" "" $HWNDPARENT
    SetCtlColors $0 E8E8EC 0A0A0C
    GetDlgItem $1 $0 1006
    SetCtlColors $1 E8E8EC 0A0A0C
    GetDlgItem $1 $HWNDPARENT 1038
    SetCtlColors $1 8B8B98 0A0A0C
    # The bar in the accent; colours are 0xBBGGRR, and only an unthemed bar takes them.
    GetDlgItem $1 $0 1004
    System::Call 'UXTHEME::SetWindowTheme(p$1,w" ",w" ")'
    SendMessage $1 0x0409 0 0x5A36E5
    SendMessage $1 0x2001 0 0x24201E
  FunctionEnd

  !define MUI_PAGE_CUSTOMFUNCTION_SHOW DarkInstFiles
!macroend

# electron-builder's own finish page plus the tutorial checkbox. Its StartApp is copied
# from templates/nsis/assistedInstaller.nsh, since defining this macro replaces it.
!macro customFinishPage
  Function StartApp
    ${if} ${isUpdated}
      StrCpy $1 "--updated"
    ${else}
      StrCpy $1 ""
    ${endif}
    ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" "$1"
  FunctionEnd

  # The checkbox is read on leaving the page instead, so unticking it counts too.
  Function TutorialChecked
  FunctionEnd

  !define MUI_FINISHPAGE_TITLE "$(finishTitle)"
  !define MUI_FINISHPAGE_TEXT "$(finishText)"
  !define MUI_FINISHPAGE_RUN
  !define MUI_FINISHPAGE_RUN_FUNCTION "StartApp"
  !define MUI_FINISHPAGE_SHOWREADME ""
  !define MUI_FINISHPAGE_SHOWREADME_TEXT "$(tutorialCheckbox)"
  !define MUI_FINISHPAGE_SHOWREADME_FUNCTION "TutorialChecked"
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW DarkWindow
  !define MUI_PAGE_CUSTOMFUNCTION_LEAVE "FinishLeave"
  !insertmacro MUI_PAGE_FINISH

  # After the page, which declares the checkbox variable. Picked up and deleted by
  # applyInstallerChoices in electron/main.js on the next start.
  Function FinishLeave
    ${NSD_GetState} $mui.FinishPage.ShowReadme $0
    ${if} $0 == ${BST_CHECKED}
      StrCpy $0 "1"
    ${else}
      StrCpy $0 "0"
    ${endif}
    CreateDirectory "$APPDATA\Topset"
    FileOpen $1 "$APPDATA\Topset\topset-tutorial" w
    FileWrite $1 $0
    FileClose $1
  FunctionEnd
!macroend
