# Практична робота №6 · Docker Compose

## Запуск

Потрібні запущений Docker Desktop і Docker Compose. З кореня W Store виконайте в PowerShell:

```powershell
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
docker compose config --quiet
docker compose up -d --build
docker compose ps
docker compose logs --tail=50
```

`.env.example` містить демонстраційні значення для локального запуску. Встановіть власний пароль у `.env` перед першим запуском, якщо зберігатимете в базі реальні дані. Git ігнорує `.env`. Команда `docker compose config --quiet` перевіряє конфігурацію без виведення підставлених значень, зокрема пароля.

| Сервіс | Роль і доступ |
| --- | --- |
| `frontend` | Nginx обслуговує [каталог](http://localhost:8080/catalog), JavaScript і передає запити до API в мережі Compose. |
| `api` | Express слухає `api:3000` і підключається до PostgreSQL. З хоста API доступний через Nginx за [`/items`](http://localhost:8080/items) та [`/health`](http://localhost:8080/health). |
| `db` | PostgreSQL слухає `db:5432` у мережі Compose. Іменований том `postgres_data` зберігає товари та записи ідемпотентності. |

Назовні опубліковано порт frontend на `127.0.0.1`. Якщо 8080 зайнято, задайте `FRONTEND_PORT` у `.env` і використовуйте його в URL та командах нижче. API запускається після готовності PostgreSQL, а frontend після готовності API. `GET /health` у Compose виконує `SELECT 1` та повертає `503` у форматі помилок API, якщо база недоступна. Перша ініціалізація PostgreSQL додає п’ять демонстраційних товарів. `POSTGRES_DB`, `POSTGRES_USER` і `POSTGRES_PASSWORD` застосовуються під час створення порожньої бази. Для наявного тому зміна цих значень у `.env` сама по собі не змінює налаштувань PostgreSQL.

## Перевірка

У [каталозі](http://localhost:8080/catalog) натисніть **Load items**. Для перевірки PostgreSQL замініть у команді ім’я й базу, якщо змінювали типові значення.

```powershell
$base = 'http://localhost:8080'
Invoke-RestMethod "$base/health"
Invoke-RestMethod "$base/items"
docker compose exec -T db psql -U w_store -d w_store -c 'SELECT count(*) FROM items;'
```

Приклад CRUD та ідемпотентного повтору:

```powershell
$headers = @{ 'Idempotency-Key' = [guid]::NewGuid().ToString() }
$body = @{ name = 'Lab 6 smoke test'; price = 125.5; stockQuantity = 3 } | ConvertTo-Json
$item = Invoke-RestMethod "$base/items" -Method Post -Headers $headers -ContentType 'application/json' -Body $body
$replay = Invoke-RestMethod "$base/items" -Method Post -Headers $headers -ContentType 'application/json' -Body $body
if ($item.id -ne $replay.id) { throw 'The repeat request returned a different item ID' }
$itemUrl = "$base/items/$($item.id)"
Invoke-RestMethod $itemUrl
$updated = @{ name = 'Lab 6 smoke test'; price = 130; stockQuantity = 4 } | ConvertTo-Json
Invoke-RestMethod $itemUrl -Method Put -ContentType 'application/json' -Body $updated
(Invoke-WebRequest $itemUrl -Method Delete -UseBasicParsing).StatusCode
```

Успішні POST повертають `201` з тим самим ID. GET і PUT повертають `200`, DELETE повертає `204`. Якщо спрацює обмеження практичної №5 (`429`), дочекайтеся часу з заголовка `Retry-After`. Для перевірки збереження даних створіть товар, запам’ятайте його ID, виконайте `docker compose down` і `docker compose up -d --wait`, потім прочитайте товар за тим самим ID та видаліть його.

Практична №5 працює і через Nginx. Для демонстрації встановіть `W_STORE_DEMO_FAULTS=1` у `.env` і виконайте `docker compose up -d`. Перейдіть на [сторінку з демонстраційним 503](http://localhost:8080/catalog?fault=503) і натисніть **Load items**. Журнал покаже дві повторні спроби з урахуванням `Retry-After`. Після трьох невдалих операцій з’явиться банер Degraded Mode. Поверніть `W_STORE_DEMO_FAULTS=0` та знову запустіть `docker compose up -d`. Решта сценаріїв описана у [практичній №5](../lab5/README.md).

## Автоматизовані тести

```powershell
# Усі тести в контейнері API, включно з PostgreSQL
docker compose exec -T -e W_STORE_TEST_POSTGRES=1 api npm test

# Локальні тести SQLite і механізмів практичної №5
Push-Location backend
npm.cmd ci
npm.cmd test
Pop-Location
```

Тест PostgreSQL створює окрему тимчасову схему та перевіряє паралельне створення з одним ключем, конфлікт ключа, відкат невдалої транзакції, повторне підключення, CRUD і повтор після видалення. Локальні тести використовують SQLite в пам’яті або тимчасових файлах. Для звичайної локальної роботи виконайте `npm.cmd start` у `backend` та відкрийте [локальний каталог](http://localhost:3000/catalog). За замовчуванням він використовує `backend/database.sqlite`. Compose створює окрему базу PostgreSQL і не монтує файл SQLite.

## Логи й зупинка

```powershell
docker compose ps
docker compose logs --tail=50
docker compose logs -f api db
docker compose down
```

`Ctrl+C` завершує перегляд логів. `docker compose down` прибирає контейнери та мережу зі збереженням тому PostgreSQL.
