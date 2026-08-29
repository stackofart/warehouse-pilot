# Warehouse Pilot

React/Vite-приложение для распознавания складских заказов, ведения справочника товаров, расчёта маршрута и компоновки паллет. Заказы и товары хранятся локально в IndexedDB; распознавание доступно через OpenAI или локальный Tesseract.

## Локальный запуск

```bash
npm ci
npm run dev
```

`npm run dev` поднимает одновременно Vite и локальный Cloudflare Worker, поэтому маршруты `/api/*` работают без отдельного процесса Wrangler. Для функций OpenAI сначала скопируйте `.dev.vars.example` в `.dev.vars` и замените тестовое значение `OPENAI_API_KEY` своим ключом. Файл `.dev.vars` исключён из Git.

Проверка перед публикацией:

```bash
npm test
npm run lint
npm run build
```

## Публикация на GitHub Pages

Проект уже содержит workflow `.github/workflows/deploy-pages.yml`. Он проверяет проект, вычисляет правильный базовый URL для имени репозитория, собирает Vite и публикует папку `dist`.

1. Создайте на GitHub новый пустой репозиторий, например `warehouse-pilot`. Не добавляйте через GitHub README, `.gitignore` или лицензию.
2. В этой директории выполните, заменив `YOUR_GITHUB_LOGIN` и имя репозитория:

```bash
git init
git branch -M main
git add .
git commit -m "Initial Warehouse Pilot"
git remote add origin https://github.com/YOUR_GITHUB_LOGIN/warehouse-pilot.git
git push -u origin main
```

3. На GitHub откройте **Settings → Pages** и в **Build and deployment → Source** выберите **GitHub Actions**.
4. Откройте вкладку **Actions** и дождитесь успешного выполнения `Test and deploy to GitHub Pages`.
5. Адрес сайта будет `https://YOUR_GITHUB_LOGIN.github.io/warehouse-pilot/`. Он также появится в результате шага `Deploy`.

Каждый следующий `git push` в `main` автоматически проверяет и обновляет сайт.

## Автономная работа

Приложение регистрирует service worker только в production-сборке. После первого полного открытия интерфейс доступен без сети. Заказы, товары и настройки сохраняются локально в IndexedDB и не синхронизируются между устройствами.

OCR-модели и OpenCV достаточно большие, поэтому они кэшируются при первом фактическом распознавании. Чтобы гарантировать OCR без сети, один раз откройте опубликованный сайт при наличии интернета и выполните распознавание тестового изображения. После обновления версии приложения повторите этот шаг.

На iPhone откройте сайт в Safari, нажмите **Поделиться → На экран «Домой»**. GitHub Pages обслуживается по HTTPS, что позволяет установить приложение как PWA.

## Распознавание через OpenAI на Cloudflare

Фронтенд отправляет выбранную фотографию на `POST /api/recognize-order`. Cloudflare Worker обращается к OpenAI Responses API и возвращает структурированный заказ. API-ключ хранится только в секрете Worker и не попадает в браузер или сборку Vite.

В Cloudflare откройте **Workers & Pages → warehouse-pilot → Settings → Variables and Secrets** и добавьте:

- секрет `OPENAI_API_KEY` — API-ключ проекта OpenAI;
- необязательную обычную переменную `OPENAI_VISION_MODEL` — модель распознавания, по умолчанию `gpt-5.6-luna`.
- необязательную обычную переменную `OPENAI_PRODUCT_MODEL` — модель интернет-сверки товара, по умолчанию `gpt-5.6-terra`.

То же самое можно сделать через Wrangler:

```bash
npx wrangler secret put OPENAI_API_KEY
```

Для локальной разработки скопируйте `.dev.vars.example` в `.dev.vars`, укажите тестовый ключ и выполните:

```bash
npm run dev
```

Файл `.dev.vars` исключён из Git. Не добавляйте ключ в `VITE_*`, исходный код или GitHub Actions build variables: такие значения становятся доступны клиентскому JavaScript.
