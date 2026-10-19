# ScoreFlix — Instalação no Windows Server 2022

## Conteúdo da pasta

| Item | Função |
|---|---|
| `install.ps1` | Instalação completa (banco, API, serviço, IIS, firewall, backup). |
| `backup.ps1` | Backup diário do PostgreSQL (copiado e agendado pelo instalador). |
| `web.config` | Regra do IIS que repassa `/api/` para a API. |
| `backend/` | Código da API e `sql/schema.sql`. |
| `site/` | Arquivos do front-end. |

## 1. Pré-requisitos (uma vez só)

Abra o PowerShell como Administrador:

```powershell
winget install OpenJS.NodeJS.LTS
winget install PostgreSQL.PostgreSQL.16
winget install NSSM.NSSM
```

No Windows Server, instale também o IIS com `Install-WindowsFeature Web-Server -IncludeManagementTools`. No Windows 11, ative o IIS com `Enable-WindowsOptionalFeature -Online -FeatureName IIS-WebServerRole, IIS-WebServer, IIS-ManagementConsole, IIS-ApplicationDevelopment, IIS-ISAPIExtensions, IIS-ISAPIFilter`.

Depois instale, pelo instalador oficial da Microsoft:

- **URL Rewrite**: https://www.iis.net/downloads/microsoft/url-rewrite
- **Application Request Routing (ARR)**: https://www.iis.net/downloads/microsoft/application-request-routing

Feche e abra o PowerShell antes do próximo passo, para que o `node` seja reconhecido.

No Gerenciador do IIS, abra **Application Request Routing Cache**, depois **Server Proxy Settings**, marque **Enable proxy** e clique em **Apply**. O instalador faz isso também, mas vale conferir.

Durante a instalação do PostgreSQL, anote a senha do usuário `postgres`.

## 2. Instalar

Copie a pasta `scoreflix-windows` para o servidor, por exemplo `C:\Temp\scoreflix-windows`. Abra o PowerShell como Administrador dentro dela e execute:

```powershell
Set-ExecutionPolicy -Scope Process Bypass -Force
.\install.ps1 -Dominio "scoreflix.seudominio.com"
```

O script pede a senha do usuário `postgres` e faz o restante sozinho:

1. Verifica Node.js, PostgreSQL, NSSM e IIS.
2. Cria o usuário `scoreflix_app` com senha aleatória e o banco `scoreflix`.
3. Cria as tabelas a partir de `schema.sql`.
4. Copia a API para `C:\scoreflix\backend`, instala as dependências e gera o `.env`.
5. Cria o serviço Windows `ScoreFlixAPI`, que inicia com o servidor e reinicia se cair.
6. Testa a API.
7. Cria o site no IIS apontando para `C:\inetpub\scoreflix`.
8. Libera as portas 80 e 443 no firewall.
9. Agenda o backup diário às 03:00.

Se o script parar com erro, a mensagem indica o que corrigir. Ao rodar de novo, ele reaproveita o que já existe. A senha do banco é regenerada a cada execução e o `.env` é atualizado junto.

Para teste em rede interna sem HTTPS, use `-NodeEnv development`. Em produção, mantenha o padrão `production`: sem HTTPS o login não mantém a sessão, porque o cookie é marcado como `Secure`.

## 3. Testar

1. Abra `http://scoreflix.seudominio.com` no navegador.
2. Crie uma conta na tela de login.
3. Avalie um filme e confira se a nota aparece após recarregar a página.

Verificação pelo terminal:

```powershell
Get-Service ScoreFlixAPI
Get-Content C:\scoreflix\logs\api.log -Tail 20
```

## 4. HTTPS (obrigatório em produção)

O service worker, a instalação como app e o cookie seguro exigem HTTPS.

Use o **win-acme** (https://www.win-acme.com), cliente gratuito do Let's Encrypt. Execute `wacs.exe`, escolha o site **ScoreFlix** e siga as opções padrão. Ele cria o binding 443 no IIS e renova o certificado sozinho.

Depois, para redirecionar HTTP para HTTPS, adicione dentro de `<rules>` no `web.config` do site:

```xml
<rule name="Redirecionar para HTTPS" stopProcessing="true">
  <match url="(.*)" />
  <conditions><add input="{HTTPS}" pattern="off" /></conditions>
  <action type="Redirect" url="https://{HTTP_HOST}/{R:1}" redirectType="Permanent" />
</rule>
```

Coloque essa regra antes da regra `ScoreFlix API`.

## 5. Atualizações

Ao publicar mudanças no site, altere `CACHE_VERSION` em `sw.js` e copie os arquivos de `site\` para `C:\inetpub\scoreflix`. Para atualizar a API, pare o serviço (`nssm stop ScoreFlixAPI`), copie os arquivos de `backend\src` para `C:\scoreflix\backend\src` e inicie de novo (`nssm start ScoreFlixAPI`). Não sobrescreva o `.env`.

## 6. Comandos úteis

```powershell
nssm status ScoreFlixAPI          # situação do serviço
nssm restart ScoreFlixAPI         # reiniciar a API
Start-ScheduledTask "ScoreFlix Backup"   # rodar backup agora
```

Backups ficam em `C:\scoreflix\backups` e são mantidos por 14 dias.

## 7. Problemas comuns

| Sintoma | Solução |
|---|---|
| `Node.js não encontrado` | Feche e abra o PowerShell depois de instalar o Node. |
| `Não consegui conectar no PostgreSQL` | Confira a senha do `postgres` e rode `Get-Service postgresql*`. |
| Erro 502.3 ou 500 no site | Confirme o **Enable proxy** no ARR e `nssm status ScoreFlixAPI`. |
| Login não mantém sessão | Falta HTTPS com `NodeEnv production`. Veja a seção 4. |
| Manifest ou ícones não carregam | Confira se `web.config` foi copiado para `C:\inetpub\scoreflix`. |
| Serviço para logo após iniciar | Leia `C:\scoreflix\logs\api-erro.log`; quase sempre é o `.env` ou o banco. |
| `429 Too Many Requests` no login | Mais de 10 tentativas em 15 minutos. Aguarde ou reinicie o serviço. |
