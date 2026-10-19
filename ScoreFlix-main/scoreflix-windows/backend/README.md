# ScoreFlix — Backend

API REST em `/api/v1` (contrato em `API.md`), com PostgreSQL e sessões no banco.

## Instalação

    npm install
    cp .env.example .env     # ajuste DATABASE_URL e demais valores
    chmod 600 .env

## Banco

    sudo -u postgres psql -c "CREATE USER scoreflix_app WITH PASSWORD 'senha-forte';"
    sudo -u postgres psql -c "CREATE DATABASE scoreflix OWNER scoreflix_app ENCODING 'UTF8';"
    psql -U postgres -d scoreflix -f sql/schema.sql

## Execução

    npm start

Teste: `curl -i http://127.0.0.1:3000/api/v1/auth/me` deve responder `401`.

## Serviço (systemd)

Crie `/etc/systemd/system/scoreflix.service`:

    [Unit]
    Description=ScoreFlix API
    After=network.target postgresql.service

    [Service]
    WorkingDirectory=/opt/scoreflix-backend
    EnvironmentFile=/opt/scoreflix-backend/.env
    ExecStart=/usr/bin/node src/server.js
    Restart=always
    User=scoreflix

    [Install]
    WantedBy=multi-user.target

Depois: `sudo systemctl enable --now scoreflix`.

## Limpeza de sessões expiradas

Agende no cron (diário):

    DELETE FROM sessions WHERE expires_at < now();
