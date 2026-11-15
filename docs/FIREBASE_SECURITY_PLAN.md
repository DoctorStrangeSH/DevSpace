# DevSpace — безопасная облачная синхронизация

Статус: **временная блокировка всех запросов опубликована пользователем (сообщение от 15.11.2026); это не проверено независимым запросом**. Прототип будущих правил находится в `firestore.rules` и **не применён в Firebase**. Версия сайта 3.62.1 сохраняет данные локально; облачная запись отключена.

## Срочный результат аудита

Исходное правило `allow read, write: if true` делало все документы публичными для чтения, изменения и удаления (оценка 1/5, критический риск). Пользователь сообщил, что заменил его на временное правило `allow read, write: if false`. После восстановления безопасных правил проверьте целостность данных: блокировка не отменяет возможные изменения, сделанные ранее.

Новый `firestore.rules` — **прототип**, а не готовый файл для публикации. В частности, значения вложенной карты `scores` ещё требуют более строгой проверки, а для проектов и настроек запись намеренно запрещена. Не заменяйте им рабочие правила до проверки в эмуляторе и отдельного согласования миграции данных.

## Перед включением

1. В проекте Firebase `devspace-aa564` включить Authentication → Google.
2. Добавить `doctorstrangesh.github.io` в Authentication → Settings → Authorized domains.
3. Войти в DevSpace, проверить фактический UID аккаунта через Firebase Authentication → Users.
4. Сохранить текущие правила Firestore отдельно, затем проверить новые правила в Rules Playground / Emulator.
5. Разворачивать правила и разрешать запись в клиенте **только после успешной проверки**.

## Будущая структура

Новые приватные данные размещаются под `users/{uid}` — никогда не в текущей общей коллекции `projects` с `userId: 'owner'`.

| Путь | Содержимое | Доступ |
|---|---|---|
| `users/{uid}/healthHistory/{date}` | Оценки за день | Только этот UID |
| `users/{uid}/settings/main` | Настройки пользователя | Только этот UID |
| `users/{uid}/projects/{id}` | Проекты владельца | Только этот UID |

Ни email, ни включённый локальный редактор, ни `userId: 'owner'` не являются доказательством прав доступа.

## Фрагмент правил для НОВЫХ путей

Добавить внутрь существующего `match /databases/{database}/documents` после проверки текущих правил. **Не заменять им автоматически все правила:** старые публичные маршруты могут обслуживать портфолио.

```firestore
function isSelf(uid) {
  return request.auth != null && request.auth.uid == uid;
}

match /users/{uid}/healthHistory/{date} {
  allow get, list, delete: if isSelf(uid);
  allow create, update: if isSelf(uid)
    && request.resource.data.keys().hasAll(['date', 'scores', 'updatedAt'])
    && request.resource.data.keys().hasOnly(['date', 'scores', 'updatedAt'])
    && request.resource.data.date == date
    && request.resource.data.scores is map
    && request.resource.data.scores.size() <= 500
    && request.resource.data.updatedAt is timestamp;
}

match /users/{uid}/settings/{documentId} {
  allow read, write: if isSelf(uid);
}

match /users/{uid}/projects/{projectId} {
  allow read, write: if isSelf(uid);
}
```

Для новых приватных документов нужны ограничения размера, типов и состава полей на уровне приложения и правил. Перед публикацией следует ужесточить схемы `projects` и `settings`; пример выше намеренно не включает публичные записи в старые коллекции.

## Проверки перед переключением

- Анонимный клиент не может читать или писать `/users/{uid}/...`.
- Пользователь A не может читать или изменять данные пользователя B.
- Пользователь A может работать только со своим UID.
- Ошибки сети не удаляют локальные проекты; конфликты решаются по отдельным записям, а не заменой всего массива.
- Никакой пароль, service account key и Firebase Admin SDK не попадают в GitHub Pages.
- Старая публичная витрина проектов сохраняет необходимое чтение, но не получает анонимную запись.

Официальные справочники: [Security Rules](https://firebase.google.com/docs/firestore/security/rules-conditions), [поля документов](https://firebase.google.com/docs/firestore/security/rules-fields).
