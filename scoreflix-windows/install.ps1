\xEF\xBB\xBF#Requires -RunAsAdministrator
<#
  ScoreFlix — instalação no Windows Server 2022.

  Execute no PowerShell como Administrador, dentro da pasta scoreflix-windows:

    .\install.ps1 -Dominio "scoreflix.seudominio.com"

  Para testar em rede interna sem HTTPS, use -NodeEnv development.
  Pré-requisitos: Node.js 20+, PostgreSQL 16+, IIS com URL Rewrite e ARR, NSSM.
  Antes de rodar, defina a senha do usuário postgres (será pedida no início).
#>
param(
  [Parameter(Mandatory)] [string]$Dominio,
  [string]$PgBin = 'C:\Program Files\PostgreSQL\16\bin',
  [string]$Raiz = 'C:\scoreflix',
  [string]$SiteDir = 'C:\inetpub\scoreflix',
  [ValidateSet('production', 'development')] [string]$NodeEnv = 'production',
  [string]$ServicoNome = 'ScoreFlixAPI'
)

$ErrorActionPreference = 'Stop'
$Origem = $PSScriptRoot
$backendDest = Join-Path $Raiz 'backend'

function Passo($t) { Write-Host "`n==> $t" -ForegroundColor Cyan }
function Ok($t) { Write-Host "    OK: $t" -ForegroundColor Green }
function Falha($t) { throw $t }

function Nova-Senha([int]$tamanho = 32) {
  $chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
  $bytes = New-Object byte[] $tamanho
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  -join ($bytes | ForEach-Object { $chars[$_ % $chars.Length] })
}

# ---------- 1. Pré-requisitos ----------
Passo 'Verificando pré-requisitos'

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { Falha 'Node.js não encontrado. Instale com: winget install OpenJS.NodeJS.LTS' }
$versaoNode = [int]((& node -p 'process.versions.node').Split('.')[0])
if ($versaoNode -lt 20) { Falha "Node.js $versaoNode encontrado. É necessário a versão 20 ou superior." }
Ok "Node.js $versaoNode"

$psql = Join-Path $PgBin 'psql.exe'
if (-not (Test-Path $psql)) { Falha "psql não encontrado em $PgBin. Use o parâmetro -PgBin." }
Ok 'PostgreSQL encontrado'

if (-not (Get-Command nssm -ErrorAction SilentlyContinue)) { Falha 'NSSM não encontrado. Instale com: winget install NSSM.NSSM' }
Ok 'NSSM encontrado'

if (-not (Get-Service W3SVC -ErrorAction SilentlyContinue)) {
  Falha 'IIS não instalado. Rode: Install-WindowsFeature Web-Server -IncludeManagementTools'
}
Import-Module WebAdministration
if (-not (Get-WebGlobalModule | Where-Object { $_.Name -eq 'RewriteModule' })) { Falha 'URL Rewrite não instalado.' }
if (-not (Get-WebGlobalModule | Where-Object { $_.Name -eq 'ApplicationRequestRouting' })) { Falha 'Application Request Routing (ARR) não instalado.' }
Ok 'IIS, URL Rewrite e ARR encontrados'

# ---------- 2. PostgreSQL: usuário, banco e tabelas ----------
Passo 'Configurando o PostgreSQL'

$senhaAdmin = Read-Host 'Senha do usuário postgres' -AsSecureString
$env:PGPASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
  [Runtime.InteropServices.Marshal]::SecureStringToBSTR($senhaAdmin))

function Consulta([string]$sql) {
  $r = & $psql -h localhost -U postgres -tAc $sql
  return ([string]($r -join '')).Trim()
}

function Psql-Admin {
  & $psql -h localhost -U postgres -v ON_ERROR_STOP=1 @args
  if ($LASTEXITCODE -ne 0) { Falha 'Comando no PostgreSQL falhou. Veja a mensagem acima.' }
}

try {
  $teste = & $psql -h localhost -U postgres -tAc 'SELECT 1'
  if ($LASTEXITCODE -ne 0) { Falha 'Não consegui conectar no PostgreSQL. Confira a senha do postgres e se o serviço está ativo.' }
  Ok 'Conexão como postgres'

  $dbSenha = Nova-Senha
  $existeRole = Consulta "SELECT 1 FROM pg_roles WHERE rolname='scoreflix_app'"
  if ($existeRole -eq '1') {
    Psql-Admin -c "ALTER USER scoreflix_app WITH PASSWORD '$dbSenha';"
  } else {
    Psql-Admin -c "CREATE USER scoreflix_app WITH PASSWORD '$dbSenha';"
  }
  Ok 'Usuário scoreflix_app pronto'

  $existeBanco = Consulta "SELECT 1 FROM pg_database WHERE datname='scoreflix'"
  if ($existeBanco -ne '1') {
    Psql-Admin -c "CREATE DATABASE scoreflix OWNER scoreflix_app ENCODING 'UTF8' TEMPLATE template0;"
  }
  Ok 'Banco scoreflix pronto'

  New-Item -ItemType Directory -Force -Path $Raiz, "$Raiz\logs", $SiteDir | Out-Null
  Copy-Item -Path "$Origem\backend" -Destination $Raiz -Recurse -Force
  Psql-Admin -d scoreflix -f "$backendDest\sql\schema.sql"
  Ok 'Tabelas criadas'
}
finally {
  Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
}

# ---------- 3. Arquivos e dependências ----------
Passo 'Instalando arquivos e dependências'

Push-Location $backendDest
try {
  & npm install --omit=dev
  if ($LASTEXITCODE -ne 0) { Falha 'npm install falhou. Verifique a conexão e as ferramentas de build.' }
} finally { Pop-Location }
Ok 'Dependências instaladas'

$envConteudo = @"
DATABASE_URL=postgres://scoreflix_app:$dbSenha@localhost:5432/scoreflix
SESSION_DAYS=30
NODE_ENV=$NodeEnv
PORT=3000
"@
Set-Content -Path "$backendDest\.env" -Value $envConteudo -Encoding ascii
icacls "$backendDest\.env" /inheritance:r /grant:r '*S-1-5-32-544:(R)' '*S-1-5-18:(R)' | Out-Null

# pgpass para o backup (tarefa agendada roda como SYSTEM)
$pgpass = Join-Path $Raiz 'pgpass.conf'
Set-Content -Path $pgpass -Value "localhost:5432:scoreflix:scoreflix_app:$dbSenha" -Encoding ascii
icacls $pgpass /inheritance:r /grant:r '*S-1-5-32-544:(R)' '*S-1-5-18:(R)' | Out-Null
Ok 'Arquivos .env e pgpass.conf protegidos'

Copy-Item -Path "$Origem\site\*" -Destination $SiteDir -Recurse -Force
Copy-Item -Path "$Origem\web.config" -Destination $SiteDir -Force
Ok "Site copiado para $SiteDir"

# ---------- 4. Serviço da API (NSSM) ----------
Passo 'Configurando o serviço da API'

if (Get-Service -Name $ServicoNome -ErrorAction SilentlyContinue) {
  & nssm stop $ServicoNome | Out-Null
  & nssm remove $ServicoNome confirm | Out-Null
}
& nssm install $ServicoNome $node.Source 'src\server.js'
if ($LASTEXITCODE -ne 0) { Falha 'nssm install falhou.' }

& nssm set $ServicoNome AppDirectory $backendDest | Out-Null
& nssm set $ServicoNome DisplayName 'ScoreFlix API' | Out-Null
& nssm set $ServicoNome Description 'API do ScoreFlix (Node.js + PostgreSQL)' | Out-Null
& nssm set $ServicoNome Start SERVICE_AUTO_START | Out-Null
& nssm set $ServicoNome AppStdout "$Raiz\logs\api.log" | Out-Null
& nssm set $ServicoNome AppStderr "$Raiz\logs\api-erro.log" | Out-Null
& nssm set $ServicoNome AppRotateFiles 1 | Out-Null
& nssm set $ServicoNome AppRotateBytes 10485760 | Out-Null
& nssm start $ServicoNome | Out-Null
Ok "Serviço $ServicoNome iniciado"

Start-Sleep -Seconds 5
$status = $null
try {
  Invoke-WebRequest -Uri 'http://127.0.0.1:3000/api/v1/auth/me' -UseBasicParsing | Out-Null
  $status = 200
} catch {
  $status = [int]$_.Exception.Response.StatusCode
}
if ($status -ne 401) {
  Falha "A API não respondeu como esperado (status $status). Veja $Raiz\logs\api-erro.log"
}
Ok 'API respondendo (401 sem sessão, como esperado)'

# ---------- 5. IIS ----------
Passo 'Configurando o site no IIS'

Set-WebConfigurationProperty -PSPath 'MACHINE/WEBROOT/APPHOST' -Filter 'system.webServer/proxy' -Name 'enabled' -Value $true
if (Get-Website -Name 'ScoreFlix' -ErrorAction SilentlyContinue) { Remove-Website -Name 'ScoreFlix' }
New-Website -Name 'ScoreFlix' -PhysicalPath $SiteDir -Port 80 -HostHeader $Dominio -Force | Out-Null
Ok "Site ScoreFlix criado para $Dominio (porta 80)"

# ---------- 6. Firewall ----------
Passo 'Liberando portas no firewall'
foreach ($porta in 80, 443) {
  $nome = "ScoreFlix HTTP $porta"
  Remove-NetFirewallRule -DisplayName $nome -ErrorAction SilentlyContinue
  New-NetFirewallRule -DisplayName $nome -Direction Inbound -Protocol TCP -LocalPort $porta -Action Allow | Out-Null
}
Ok 'Portas 80 e 443 liberadas (a 3000 fica fechada)'

# ---------- 7. Backup diário ----------
Passo 'Agendando backup diário'
Copy-Item -Path "$Origem\backup.ps1" -Destination $Raiz -Force
$acao = New-ScheduledTaskAction -Execute 'powershell.exe' `
  -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$Raiz\backup.ps1`" -Raiz `"$Raiz`" -PgBin `"$PgBin`""
$gatilho = New-ScheduledTaskTrigger -Daily -At 3am
Register-ScheduledTask -TaskName 'ScoreFlix Backup' -Action $acao -Trigger $gatilho `
  -User 'SYSTEM' -RunLevel Highest -Force | Out-Null
Ok 'Tarefa "ScoreFlix Backup" às 03:00 (backups em C:\scoreflix\backups)'

# ---------- Resumo ----------
Write-Host "`nInstalação concluída." -ForegroundColor Green
Write-Host "Acesse: http://$Dominio"
Write-Host "Logs da API: $Raiz\logs"
Write-Host "Próximo passo: configurar HTTPS (veja LEIA-ME.md, seção HTTPS)."
