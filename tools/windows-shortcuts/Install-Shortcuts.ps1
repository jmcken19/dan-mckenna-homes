# Puts a "Dan McKenna Homes" folder on the desktop with two shortcuts:
#   Website         – opens Dan's public website
#   Website Editor  – opens the editor (Cloudflare sign-in first)
# Safe to run again: it just refreshes the shortcuts. Windows only.

$WebsiteUrl = 'https://jmcken19.github.io/dan-mckenna-homes/'   # change to https://www.danmckennahomes.com/ at launch
$EditorUrl  = 'https://dmh-owner.danmckenna.workers.dev/'

$ErrorActionPreference = 'Stop'
$here    = Split-Path -Parent $MyInvocation.MyCommand.Path
$iconDir = Join-Path $env:LOCALAPPDATA 'DanMcKennaHomes'
$desktop = [Environment]::GetFolderPath('Desktop')          # works with OneDrive desktops too
$folder  = Join-Path $desktop 'Dan McKenna Homes'

New-Item -ItemType Directory -Force -Path $iconDir, $folder | Out-Null
Copy-Item (Join-Path $here 'website.ico') (Join-Path $iconDir 'website.ico') -Force
Copy-Item (Join-Path $here 'editor.ico')  (Join-Path $iconDir 'editor.ico')  -Force

function New-UrlShortcut($name, $url, $icon) {
  $path = Join-Path $folder "$name.url"
  $text = "[InternetShortcut]`r`nURL=$url`r`nIconFile=$icon`r`nIconIndex=0`r`n"
  [IO.File]::WriteAllText($path, $text, [Text.Encoding]::ASCII)
}
New-UrlShortcut 'Website'        $WebsiteUrl (Join-Path $iconDir 'website.ico')
New-UrlShortcut 'Website Editor' $EditorUrl  (Join-Path $iconDir 'editor.ico')

# Give the folder itself the KW icon.
$ini = Join-Path $folder 'desktop.ini'
if (Test-Path $ini) { attrib -s -h $ini }
[IO.File]::WriteAllText($ini, "[.ShellClassInfo]`r`nIconResource=$(Join-Path $iconDir 'website.ico'),0`r`n", [Text.Encoding]::Unicode)
attrib +s +h $ini
attrib +r $folder

Write-Host ''
Write-Host 'Done! A "Dan McKenna Homes" folder is now on the desktop with:' -ForegroundColor Green
Write-Host '  - Website'
Write-Host '  - Website Editor'
Write-Host ''
Write-Host '(If the icons look blank, they appear after a refresh or a sign-out/in.)'
