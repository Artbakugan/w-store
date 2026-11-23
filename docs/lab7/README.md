# Практична робота №7 — CI/CD W Store

## Коли запускається workflow

| Подія | Перевірки та Docker build | Публікація в GHCR |
| --- | --- | --- |
| Pull request до `main` | Backend, PostgreSQL, frontend, обидва образи | `skipped` |
| Push до `main` | Усі перевірки | Обидва образи з тегом `sha-<повний SHA коміту>` |
| Push Git-тегу `vX.Y.Z` | Усі перевірки | Обидва образи з тегами `vX.Y.Z` і `sha-<повний SHA коміту>` |

[`W Store CI/CD`](../../.github/workflows/ci.yml) скасовує попередній запуск того самого workflow для того самого Git ref через `cancel-in-progress: true`. Окремі PR, гілка `main` і теги мають власні групи запусків.

## Що перевіряє CI

1. **Backend.** Node.js 24 і `npm ci` у `backend/`. `setup-node` кешує завантаження npm за `backend/package-lock.json`. `npm test` запускає всі тести, зокрема SQLite і PostgreSQL. Для PostgreSQL workflow піднімає тимчасовий сервіс `postgres:17-alpine`, чекає на `pg_isready` і передає тестам `W_STORE_TEST_POSTGRES=1` та призначений runner порт. Сервіс використовує `trust` у межах одноразового GitHub-hosted runner. Інтеграційний тест створює і прибирає власну схему.
2. **Frontend.** Сторінка статична й не потребує npm-залежностей. `node --check` перевіряє `resilience.js`. Наявні тести перевіряють вбудований скрипт каталогу, повторні запити й режим деградації.
3. **Docker.** API збирається з кореневого контексту через `backend/Dockerfile`, frontend — з контексту `frontend/`. `nginx -t` перевіряє конфігурацію в зібраному образі frontend. На push обидва образи передаються через артефакт до завдання публікації.

## Публікація образів

GHCR отримує образи `ghcr.io/artbakugan/w-store-api` і `ghcr.io/artbakugan/w-store-frontend` після успішного завершення всіх трьох завдань CI. Завдання публікації завантажує вже зібрані образи, входить до GHCR через вбудований `GITHUB_TOKEN` і додає відповідні теги. Образи мають OCI-мітки з URL репозиторію та SHA коміту.

Завдання CI мають `contents: read`. Завдання публікації має лише `packages: write`, а Job Summary працює з `permissions: {}`. Інструкції щодо доступу до реєстру описані в [документації GitHub Packages](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry).

## Локальна перевірка

Команди для Bash або Git Bash запускаються з кореня репозиторію. Потрібні Node.js 24, npm, Docker та `actionlint`.

```bash
actionlint .github/workflows/ci.yml
npm --prefix backend ci
node --check frontend/resilience.js
node --test backend/tests/catalog.test.js backend/tests/resilience.test.js
```

Повний backend-набір із тимчасовим PostgreSQL на випадковому локальному порту запускається в окремій підоболонці. Дані цього контейнера зберігаються в `tmpfs`.

```bash
(
  set -e
  pg=$(MSYS_NO_PATHCONV=1 docker run --rm -d -p 127.0.0.1::5432 \
    --tmpfs /var/lib/postgresql/data \
    -e POSTGRES_HOST_AUTH_METHOD=trust -e POSTGRES_USER=w_store_ci \
    -e POSTGRES_DB=w_store_ci postgres:17-alpine)
  trap 'docker stop "$pg" >/dev/null' EXIT
  until docker exec "$pg" pg_isready -h 127.0.0.1 -U w_store_ci -d w_store_ci; do
    sleep 1
  done
  pg_port=$(docker port "$pg" 5432/tcp | cut -d: -f2)
  W_STORE_TEST_POSTGRES=1 PGHOST=127.0.0.1 PGPORT="$pg_port" \
    PGDATABASE=w_store_ci PGUSER=w_store_ci npm --prefix backend test
)
```

Локальні Docker-збірки використовують ті самі контексти, що й workflow.

```bash
docker build -f backend/Dockerfile -t w-store-api:lab7-check .
docker build -t w-store-frontend:lab7-check frontend
docker run --rm w-store-frontend:lab7-check nginx -t
```

Локально пройшли 28 тестів повного набору з PostgreSQL і 16 окремих перевірок frontend. Обидва образи зібралися без кешу. Після запуску через nginx маршрути `/catalog`, `/catalog/resilience.js`, `/health` і `/items` відповіли HTTP 200.

## Style points

- [Dependabot](../../.github/dependabot.yml) щотижня перевіряє GitHub Actions і npm-залежності в `backend/`.
- **Job Summary** показує статуси backend, frontend, Docker і публікації на сторінці запуску. Завдання публікації додає повні імена й теги образів у міру їх успішного завантаження.

## Запуск і перевірка на GitHub

1. Перед комітом перевір `git status --short`, `git diff` і вміст нових файлів. Переконайся, що до майбутнього коміту входять тільки зміни лабораторної, а `.env`, локальні бази та секрети відсутні. Перевір також `git diff --cached` після підготовки коміту.
2. Перевір, що GitHub Actions дозволені в [Settings → Actions → General](https://github.com/Artbakugan/w-store/settings/actions). Відкрий PR до `main` для перевірки PR-сценарію. У його запуску мають пройти всі перевірки, а публікація має бути `skipped`.
3. Після злиття PR або push до `main` відкрий запуск у Actions. Перевір статуси й появу обох образів із тегом `sha-…` у Packages. Якщо однойменний пакет існував раніше, перевір, чи має `Artbakugan/w-store` доступ до нього в **Package settings → Manage Actions access**.
4. На коміті в `main`, що містить workflow, створи і надішли Git-тег. Приклад для вільної версії `v1.0.0`.

   ```bash
   git fetch origin main
   git tag -a v1.0.0 -m "W Store v1.0.0" origin/main
   git push origin refs/tags/v1.0.0
   ```

5. Перевір, що обидва пакети мають теги `v1.0.0` і `sha-…` для цього коміту. За наявності доступу до пакетів перевір завантаження через `docker pull ghcr.io/artbakugan/w-store-api:v1.0.0` і `docker pull ghcr.io/artbakugan/w-store-frontend:v1.0.0`. Для приватних пакетів потрібна автентифікація Docker в GHCR.

Сторінки, де з’являться результати після push.

- [W Store CI/CD у GitHub Actions](https://github.com/Artbakugan/w-store/actions/workflows/ci.yml)
- [Теги репозиторію](https://github.com/Artbakugan/w-store/tags)
- [Пакети GHCR власника репозиторію](https://github.com/Artbakugan?tab=packages)
