\xEF\xBB\xBF# ScoreFlix — backup diário do PostgreSQL (executado pela tarefa agendada).
param(
  [string]$Raiz = 'C:\scoreflix',
  [string]$PgBin = 'C:\Program Files\PostgreSQL\16\bin',
  [string]$Destino = 'C:\scoreflix\backups',
  [int]$DiasParaManter = 14
)

$ErrorActionPreference = 'Stop'
$env:PGPASSFILE = Join-Path $Raiz 'pgpass.conf'
New-Item -ItemType Directory -Force -Path $Destino | Out-Null

$arquivo = Join-Path $Destino ("scoreflix-{0}.dump" -f (Get-Date -Format 'yyyyMMdd-HHmm'))
& (Join-Path $PgBin 'pg_dump.exe') -h localhost -U scoreflix_app -d scoreflix -F c -f $arquivo
if ($LASTEXITCODE -ne 0) { throw 'pg_dump falhou. Veja a mensagem acima.' }

Get-ChildItem $Destino -Filter 'scoreflix-*.dump' |
  Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-$DiasParaManter) } |
  Remove-Item -Force

Write-Host "Backup criado: $arquivo"
