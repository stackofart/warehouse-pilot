# Cloudflare: авторизация ролей и общая база Warehouse Pilot

## Что уже реализовано

- Cloudflare Access подтверждает email вошедшего пользователя.
- Worker на каждом `/api/*` запросе находит пользователя в D1 и проверяет его роль.
- `admin` видит каталог целиком, импортирует локальные товары, добавляет карточки и управляет пользователями.
- `picker` не получает список каталога и не имеет API экспорта. Ему доступны только ограниченный поиск (до 20 результатов) и точное сопоставление по штрихкоду/מק״ט.
- OpenAI-сверка товара доступна только администратору.

Важно: интерфейс не является границей безопасности. Права проверяются именно в Worker. Не добавляйте административные данные в клиентские файлы или публичные assets.

## 1. Создать D1

В корне проекта выполните:

```bash
npx wrangler d1 create warehouse-pilot-db
```

Команда вернёт `database_id`. Добавьте его в существующий блок `d1_databases` файла `wrangler.jsonc`:

```jsonc
{
  "binding": "DB",
  "database_name": "warehouse-pilot-db",
  "database_id": "ID_ИЗ_КОМАНДЫ",
  "migrations_dir": "migrations"
}
```

Затем примените миграции к удалённой базе:

```bash
npx wrangler d1 migrations apply warehouse-pilot-db --remote
```

## 2. Назначить первого администратора

В Cloudflare Dashboard откройте Worker `warehouse-pilot` → Settings → Variables and Secrets и добавьте обычную переменную:

```text
BOOTSTRAP_ADMIN_EMAIL=ваш-email-для-входа
```

Email должен в точности совпадать с email, который вернёт Cloudflare Access. При первом успешном входе Worker создаст этого пользователя с ролью `admin`. После этого остальных сотрудников добавляйте в разделе «Сборщики» панели администратора.

## 3. Закрыть приложение Cloudflare Access

В Zero Trust → Access → Applications создайте Self-hosted application для адреса опубликованного Worker. Защитите весь домен/path `/*`, а не только API. В policy разрешите только нужные email или ваш домен.

Скопируйте **Application Audience (AUD) Tag** созданного приложения и добавьте ещё две обычные переменные Worker:

```text
TEAM_DOMAIN=https://ИМЯ-ВАШЕЙ-КОМАНДЫ.cloudflareaccess.com
POLICY_AUD=AUD_ИЗ_НАСТРОЕК_ACCESS
```

Проект использует Worker Static Assets, поэтому в production внутренний роутер Cloudflare не передаёт `ctx.access` пользовательскому Worker. Worker проверяет подпись `Cf-Access-Jwt-Assertion` по публичным ключам `TEAM_DOMAIN`, а также проверяет issuer и `POLICY_AUD`. Не заменяйте эту проверку доверенным email-заголовком.

Access отвечает за вход пользователя. Таблица `users` в D1 отвечает за внутреннюю роль и возможность приостановить доступ. Пользователь должен пройти обе проверки.

## 4. Развернуть

```bash
npm test
npm run build
npx wrangler deploy
```

После первого входа администратора:

1. Откройте «Сборщики» и добавьте email сотрудников с ролью `picker`.
2. Откройте «База товаров».
3. Нажмите «Перенести локальные товары», чтобы один раз скопировать текущий IndexedDB-каталог этого устройства в D1.

Импорт добавляет новые карточки и обновляет совпавшие по штрихкоду или מק״ט. Общая база не загружается целиком на устройство сборщика.

## Локальная проверка

```bash
npx wrangler d1 migrations apply warehouse-pilot-db --local
npm run dev
```

В `.dev.vars` можно задать:

```text
DEV_AUTH_EMAIL=admin@local.warehouse
DEV_AUTH_ROLE=admin
```

Локальная подмена работает только для `localhost`/`127.0.0.1`. В опубликованном Worker отсутствие Cloudflare Access identity всегда даёт `401`.
