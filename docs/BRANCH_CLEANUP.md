# Устаревшие Git-ветки DevSpace

Проверка: 20.11.2026. Основная ветка: `main`.

Все перечисленные ниже 45 ветки проверены относительно объединённых PR и содержимого текущей `main`. Ни одна из них не является текущей рабочей веткой. Их удаление не удаляет коммиты из `main`.

## Ветки из объединённых PR (41)

- `chore/remove-orphan-modules-v2`
- `chore/repository-hygiene`
- `docs/branch-cleanup-audit`
- `docs/cleanup-after-pr38`
- `docs/final-branch-audit-count`
- `docs/release-1.0-acceptance`
- `docs/release-checklist-automation-status`
- `docs/update-post-pr35-audit`
- `feat/compact-section-dock-clean`
- `feat/complete-backup-data`
- `fix/backup-import-transaction`
- `fix/backup-import-validation`
- `fix/backup-restore-ui-state`
- `fix/backup-storage-failure-reporting`
- `fix/backup-version-follows-app`
- `fix/bulk-notes-atomic-persistence`
- `fix/checklist-rollback-on-storage-failure`
- `fix/cloud-sync-storage-rollback`
- `fix/history-undo-save-rollback`
- `fix/mobile-menu-escape-focus`
- `fix/notes-rollback-on-storage-failure`
- `fix/notes-safe-render-and-links`
- `fix/project-save-failure-keeps-form`
- `fix/pwa-atomic-precache`
- `fix/pwa-precache-cleanup-race`
- `fix/remove-legacy-github-token-storage`
- `fix/roadmap-save-failure-feedback`
- `fix/secondary-mutations-storage-failure-v2`
- `fix/state-mutations-on-storage-failure`
- `fix/storage-clear-all-prefixed-data`
- `fix/storage-has-safe-access`
- `fix/strict-backup-health-history-validation`
- `fix/sync-reconnect-handler`
- `fix/sync-storage-async-init`
- `fix/theme-persist-same-selection`
- `fix/theme-persistence-failure-rebased`
- `test/backup-project-save-failure-rollback`
- `test/backup-rollback-failure-warning`
- `test/full-backup-roundtrip`
- `test/pwa-install-rollback-behavior`
- `test/pwa-precache-integrity`

Эти ветки относятся к PR, которые уже объединены: #1, #3–#28, #30, #31, #33 и #37–#44.

## Заменённые ветки (4)

- `feat/compact-section-dock` — PR #2 закрыт без объединения и прямо помечен как заменённый PR #3; описание PR #2 подтверждает перенос изменений. Содержимое актуальной реализации находится в `main`.
- `fix/secondary-mutations-storage-failure` — устаревший вариант перед PR #25. Проверены файлы `favorites.js`, `tags.js`, `timetracker.js`: их blob SHA совпадает с `main`; все тесты из старой ветки присутствуют в текущем `tests/safety.test.cjs`.
- `fix/theme-persistence-failure` — старый PR #29 закрыт, заменён PR #31. Blob SHA обоих изменённых файлов (`js/modules/theme.js`, `tests/safety.test.cjs`) совпадает с `main`.
- `chore/remove-orphan-modules` — старый PR #32 закрыт и заменён PR #33. Актуальное удаление файлов и отметка чек-листа находятся в `main`.

## Команда удаления

Запускать из локального клона именно этого репозитория после проверки `git remote -v`:

```powershell
git fetch --prune origin
git push origin --delete chore/remove-orphan-modules chore/remove-orphan-modules-v2 chore/repository-hygiene docs/branch-cleanup-audit docs/cleanup-after-pr38 docs/final-branch-audit-count docs/release-1.0-acceptance docs/release-checklist-automation-status docs/update-post-pr35-audit feat/compact-section-dock feat/compact-section-dock-clean feat/complete-backup-data fix/backup-import-transaction fix/backup-import-validation fix/backup-restore-ui-state fix/backup-storage-failure-reporting fix/backup-version-follows-app fix/bulk-notes-atomic-persistence fix/checklist-rollback-on-storage-failure fix/cloud-sync-storage-rollback fix/history-undo-save-rollback fix/mobile-menu-escape-focus fix/notes-rollback-on-storage-failure fix/notes-safe-render-and-links fix/project-save-failure-keeps-form fix/pwa-atomic-precache fix/pwa-precache-cleanup-race fix/remove-legacy-github-token-storage fix/roadmap-save-failure-feedback fix/secondary-mutations-storage-failure fix/secondary-mutations-storage-failure-v2 fix/state-mutations-on-storage-failure fix/storage-clear-all-prefixed-data fix/storage-has-safe-access fix/strict-backup-health-history-validation fix/sync-reconnect-handler fix/sync-storage-async-init fix/theme-persist-same-selection fix/theme-persistence-failure fix/theme-persistence-failure-rebased test/backup-project-save-failure-rollback test/backup-rollback-failure-warning test/full-backup-roundtrip test/pwa-install-rollback-behavior test/pwa-precache-integrity
```

Команда удаляет только перечисленные удалённые ветки. Ветка `main` не затрагивается. Если GitHub сообщает, что отдельная ветка уже удалена, это не мешает удалению остальных.

Альтернатива — удалить те же ветки в GitHub → Branches. Не удалять ветки, если после этой проверки в них появились новые коммиты.
