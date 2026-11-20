# DevSpace

DevSpace — персональное портфолио разработчика и браузерная мастерская для учёта проектов, задач, заметок и прогресса.

## Что входит

- Публичное портфолио и истории проектов.
- Галереи изображений и адаптивная навигация.
- Локальная мастерская: проекты, задачи, заметки, теги, избранное, таймер и дорожные карты.
- Экспорт и импорт локальной резервной копии.
- PWA с офлайн-кешированием через Service Worker.

## Технологии

Проект — статическое приложение на HTML, CSS и JavaScript. Обязательной сборки и package manager для запуска нет. GitHub Pages публикует корень ветки `main` по адресу:

https://doctorstrangesh.github.io/DevSpace/

## Локальный запуск

Можно открыть `index.html` через локальный HTTP-сервер. Например, с Python:

```bash
python -m http.server 8000
```

Затем открыть http://localhost:8000/.

Для проверки PWA используйте localhost или HTTPS: Service Worker не работает из обычного `file://`.

## Проверки

Требуется Node.js 22:

```bash
node --test tests/safety.test.cjs
node --check js/app.js
```

Firestore Rules проверяются отдельно через локальный эмулятор Firebase; CI использует тестовый проект `demo-devspace-rules` и не подключается к production-базе.

## Архитектура и безопасность

- [ARCHITECTURE.md](ARCHITECTURE.md) — структура приложения, публикация и ограничения.
- [docs/RELEASE_1.0_CHECKLIST.md](docs/RELEASE_1.0_CHECKLIST.md) — конечный список приёмки 1.0.
- [docs/FIREBASE_SECURITY_PLAN.md](docs/FIREBASE_SECURITY_PLAN.md) — статус и условия безопасной облачной синхронизации.

Локальный режим редактирования хранит изменения в браузере. Он не является серверной авторизацией. Облачная запись Firebase в текущей версии отключена; не включайте её без отдельной проверки production Firestore Rules и Firebase Authentication.

## Разработка

- Рабочая ветка для изменений — отдельная feature/fix/chore-ветка.
- `main` — источник опубликованной версии GitHub Pages.
- Изменения проходят через Pull Request и обязательные GitHub Actions checks.
- При изменении активных ресурсов PWA обновляйте версию кеша в `sw.js`.
