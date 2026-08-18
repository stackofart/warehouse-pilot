# Warehouse Pilot

Локальное React/Vite-приложение для распознавания складских заказов, ведения справочника товаров, расчёта маршрута и компоновки паллет.

## Локальный запуск

```bash
npm ci
npm run dev
```

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
