# Rumo — cada real com destino

Servidor Node.js + banco SQLite. **Sem dependências**: não precisa de `npm install`.

## Rodar
    npm start            # http://localhost:3000

Requer Node 22.5 ou superior.

## Variáveis de ambiente
| Variável | Padrão | Para que serve |
|---|---|---|
| `PORT` | 3000 | Porta do servidor |
| `DATA_DIR` | `./data` | Pasta do banco (`rumo.db`). **Precisa ser um disco persistente** |
| `NODE_ENV` | — | Use `production` (liga cookie `Secure` e HSTS; exige HTTPS) |
| `TRUST_PROXY` | — | Use `1` se estiver atrás de proxy/Render/Railway/Fly (para o limite de tentativas ler o IP certo) |

## Hospedagem
Serve qualquer lugar que rode Node ou Docker (VPS, Railway, Fly.io, Render).
O essencial: **monte um volume persistente em `DATA_DIR`**; sem isso os dados somem a cada deploy.
Plataformas com disco efêmero (Vercel, Netlify) não servem para este banco.

Com Docker:

    docker build -t rumo .
    docker run -d -p 3000:3000 -v rumo-data:/data rumo

## Backup
    sqlite3 data/rumo.db ".backup backup.db"
Copiar o arquivo com o app rodando também funciona se incluir `rumo.db-wal`; prefira o comando acima.

## O que o banco guarda
- `users`: e-mail único, nome, senha com hash scrypt + sal
- `sessions`: sessões (só o hash do token), expiram em 30 dias
- `budgets`: renda em centavos (inteiro)
- `allocations`: percentual por categoria, validado (0–100)

Mudanças futuras de estrutura: acrescente um item em `MIGRATIONS` no `server.js`.

## API
`POST /api/register` · `POST /api/login` · `POST /api/logout` · `GET /api/me` · `PUT /api/budget` · `DELETE /api/me` (exclui a conta e os dados) · `GET /healthz`
