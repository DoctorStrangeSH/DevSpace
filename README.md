<div align="center">

<img src="images/icons/devspace-mark.svg" alt="DevSpace" width="88" height="88">

# DevSpace

**Личное портфолио разработчика и цифровая мастерская для проектов, задач и идей.**

[![CI](https://github.com/DoctorStrangeSH/DevSpace/actions/workflows/tests.yml/badge.svg?branch=main)](https://github.com/DoctorStrangeSH/DevSpace/actions/workflows/tests.yml)
[![Live](https://img.shields.io/badge/Live-GitHub%20Pages-6366f1?logo=githubpages&logoColor=white)](https://doctorstrangesh.github.io/DevSpace/)
[![PWA](https://img.shields.io/badge/PWA-installable-8b5cf6)](https://doctorstrangesh.github.io/DevSpace/)
[![Node](https://img.shields.io/badge/Node.js-22-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/)

[Открыть DevSpace](https://doctorstrangesh.github.io/DevSpace/) · [Архитектура](ARCHITECTURE.md) · [План версии 1.0](docs/RELEASE_1.0_CHECKLIST.md)

</div>

---

## О проекте

DevSpace объединяет две части в одном лёгком веб-приложении:

- **Публичное портфолио** — проекты, истории разработки, галереи, ссылки на исходный код и публикации.
- **Личная мастерская** — локальное пространство для проектов, задач, заметок, тегов, избранного, таймера и прогресса.

Приложение работает как статический сайт: без обязательного backend-сервера, сборщика и установки зависимостей для обычного запуска. Его можно открыть в браузере или установить как PWA.

## Возможности

| Раздел | Что умеет |
| --- | --- |
| Портфолио | Адаптивные страницы проектов, поиск, навигация и прямые ссылки |
| Галереи | Просмотр изображений, клавиатурная навигация и мобильные жесты |
| Мастерская | Проекты, чек-листы, заметки, теги, избранное и история |
| Планирование | Дорожные карты, прогресс и учёт времени |
| Резервные копии | Экспорт, импорт, проверка целостности и автоматические снимки |
| Диагностика | Проверка локальных данных и безопасные рекомендации |
| Repair Center | Предпросмотр исправлений, журнал операций и условный откат |
| PWA | Установка, офлайн-кеширование и обновление приложения |

## Технологии

- HTML5 и CSS3 — интерфейс и адаптивная компоновка.
- Vanilla JavaScript — модули приложения без тяжёлого runtime.
- Bootstrap — базовые компоненты интерфейса.
- LocalStorage и IndexedDB — локальные данные и резервные копии.
- Service Worker и Web App Manifest — PWA и офлайн-режим.
- Firebase — изолированные правила Firestore и отдельные сценарии идентификации.
- GitHub Actions — регрессионные тесты, проверка Firestore Rules и контроль сборки/публикации.

## Быстрый старт

Для просмотра сайта достаточно открыть [опубликованную версию](https://doctorstrangesh.github.io/DevSpace/).

Для локальной разработки:

```bash
git clone https://github.com/DoctorStrangeSH/DevSpace.git
cd DevSpace
python -m http.server 8000
```

Откройте http://localhost:8000/.

> Для проверки Service Worker и установки PWA используйте localhost или HTTPS. Протокол `file://` не поддерживает Service Worker.

## Проверки качества

Требуется Node.js 22.

```bash
# Основные регрессионные сценарии
node --test tests/safety.test.cjs

# Быстрая проверка синтаксиса приложения
node --check js/app.js
```

Firestore Rules проверяются отдельно в локальном эмуляторе Firebase. CI запускает оба набора правил на тестовом проекте `demo-devspace-rules`; production Firestore не используется.

Перед отправкой изменений:

```bash
git diff --check
```

## Структура репозитория

```text
.
├── .github/workflows/   # CI: Node.js и Firestore Emulator
├── css/                 # Глобальные стили и компоненты интерфейса
├── data/                # Начальные данные мастерской
├── docs/                # Архитектура, безопасность и release checklist
├── images/icons/        # Логотип и иконки PWA
├── js/
│   ├── core/            # Состояние, события, хранилище и синхронизация
│   ├── modules/         # Функциональные модули мастерской
│   ├── services/        # Firebase, GitHub и локальные сервисы
│   ├── ui/              # Рендеринг и представления
│   └── utils/           # Общие утилиты и валидаторы
├── tests/               # Регрессии и Firestore Rules tests
├── index.html           # Точка входа
├── manifest.json        # PWA manifest
└── sw.js                # Service Worker
```

## Архитектура и безопасность

- [ARCHITECTURE.md](ARCHITECTURE.md) описывает границы модулей, публикацию и ограничения.
- [docs/RELEASE_1.0_CHECKLIST.md](docs/RELEASE_1.0_CHECKLIST.md) — проверяемый список приёмки версии 1.0.
- [docs/FIREBASE_SECURITY_PLAN.md](docs/FIREBASE_SECURITY_PLAN.md) — политика и ограничения облачной части.
- [docs/BRANCH_CLEANUP.md](docs/BRANCH_CLEANUP.md) — безопасная процедура аудита Git-веток.

**Важно:** локальное редактирование не является серверной авторизацией. Автоматическая облачная синхронизация и запись отключены. Ручной перенос проектов в Firebase ограничен отдельным подтверждаемым сценарием и зависит от production Firestore Rules. CI не доказывает состояние правил в Firebase Console. Не включайте клиентскую запись только на основании успешных тестов эмулятора.

## Процесс разработки

1. Создавайте отдельную ветку `feat/*`, `fix/*`, `docs/*` или `chore/*`.
2. Не коммитьте напрямую в `main`.
3. Обновляйте тесты и документацию вместе с изменением поведения.
4. При изменении кешируемых ресурсов повышайте версию приложения и namespace в `sw.js`.
5. Объединяйте PR только после успешных обязательных CI-проверок.

---

<div align="center">

**DevSpace** · Сделано с вниманием к удобству, надёжности и сохранности данных.

</div>
