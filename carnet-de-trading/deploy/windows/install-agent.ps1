# Installation de l'agent MT5 sur le nœud Windows (PowerShell, en administrateur).
#
#   .\install-agent.ps1 -BridgeToken "jeton-long-aleatoire" -Port 8787
#
# L'agent écoute uniquement sur 127.0.0.1 : le VPS le joint par tunnel SSH
# inverse ou VPN. Le terminal MT5 doit être installé, lancé et connecté à un
# compte DÉMO avant de démarrer l'agent.
#
# Sécurité : le jeton est stocké dans un fichier dont l'ACL est restreinte aux
# administrateurs et à SYSTEM ; il n'apparaît jamais dans la ligne de commande
# de la tâche planifiée (visible par tout utilisateur local).

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][ValidateLength(16, 256)][string]$BridgeToken,
    [int]$Port = 8787,
    [string]$SymbolSuffix = "",
    [string]$InstallDir = "C:\CarnetMt5Agent",
    [string]$Python = "py"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $PSCommandPath)
$agentSource = Join-Path $root "scripts\mt5_agent.py"

if (-not (Test-Path $agentSource)) {
    throw "scripts\mt5_agent.py introuvable : exécutez ce script depuis le dépôt."
}
if (-not (Get-Command $Python -ErrorAction SilentlyContinue)) {
    throw "Python introuvable. Installez Python 3.10+ puis : py -3 -m pip install MetaTrader5"
}

New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
Copy-Item $agentSource (Join-Path $InstallDir "mt5_agent.py") -Force

$tokenFile = Join-Path $InstallDir "bridge_token.txt"
Set-Content -Path $tokenFile -Value $BridgeToken -NoNewline -Encoding ascii
icacls $tokenFile /inheritance:r /grant:r "Administrators:F" "SYSTEM:F" | Out-Null

$runner = Join-Path $InstallDir "run-agent.ps1"
@"
# Généré par install-agent.ps1 — ne pas éditer à la main.
`$ErrorActionPreference = "Stop"
`$token = Get-Content -Raw (Join-Path `$PSScriptRoot "bridge_token.txt")
Set-Location `$PSScriptRoot
& $Python -3 mt5_agent.py --host 127.0.0.1 --port $Port --token `$token --symbol-suffix "$SymbolSuffix"
"@ | Set-Content -Path $runner -Encoding utf8

$action = New-ScheduledTaskAction -Execute "powershell.exe" `
    -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$runner`""
$trigger = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -RestartCount 5 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit (New-TimeSpan -Days 0)

Register-ScheduledTask -TaskName "CarnetMt5Agent" -Action $action -Trigger $trigger `
    -Principal $principal -Settings $settings -Description "Pont MT5 démo pour Carnet de Trading" `
    -Force | Out-Null

Start-ScheduledTask -TaskName "CarnetMt5Agent"
Write-Host "Agent installé et démarré (tâche CarnetMt5Agent, port $Port, boucle locale)."
Write-Host ""
Write-Host "Étape suivante — tunnel depuis le VPS (aucune exposition publique) :"
Write-Host "  ssh -N -L 8787:127.0.0.1:8787 utilisateur@windows-node"
Write-Host "  puis, dans l'interface Carnet : URL du pont = http://127.0.0.1:8787"
Write-Host ""
Write-Host "Seuls les comptes démo sont acceptés. Vérifiez : Get-ScheduledTask CarnetMt5Agent"
