## 1. Database

- [x] 1.1 Create `db/migrations/002_watched.sql` — add `watched` table with `id`, `event_id` (unique FK), `watched_at`

## 2. API Routes

- [x] 2.1 Create `src/app/api/lucky/route.ts` — GET endpoint that selects a random YouTube event not in the `watched` table, accepts optional `?category=` param, returns `{ id }` or `{ exhausted: true }`
- [x] 2.2 Create `src/app/api/watched/route.ts` — POST to mark an event as watched (insert or ignore), DELETE to clear all watched (optional `?category=` filter)
- [x] 2.3 Create `src/app/api/watched/[id]/route.ts` — DELETE to remove a single watched entry
- [x] 2.4 Create `src/app/api/channels/route.ts` — POST to add a YouTube channel (validate RSS feed, resolve @handle URLs, create/update `youtube_{category}_user` source), GET to list all channels, DELETE to remove a channel

## 3. Home Page — Lucky Button

- [x] 3.1 Create `src/components/LuckyButton.tsx` — client component that reads the current category from search params, calls `/api/lucky`, and redirects to `/watch/[id]` or shows exhausted message with clear option
- [x] 3.2 Update `src/app/page.tsx` — add the LuckyButton to the home page header area next to the category filters

## 4. Player View — Watched Button

- [x] 4.1 Create `src/components/WatchedButton.tsx` — client component that shows "Mark as watched" or disabled "Watched" state, calls `POST /api/watched` on click
- [x] 4.2 Update `src/app/watch/[id]/page.tsx` — add WatchedButton for YouTube events, pass watched status from a DB query

## 5. History Page

- [x] 5.1 Create `src/app/history/page.tsx` — server component listing watched events with event cards, watched dates, per-entry remove buttons, and a "Clear All" button

## 6. Channels Page

- [x] 6.1 Create `src/app/channels/page.tsx` — server component listing all YouTube channels grouped by category, with an add-channel form (URL/ID input + category dropdown) and remove buttons for user-added channels

## 7. Fetcher Registry Update

- [x] 7.1 Update `src/fetchers/registry.ts` — dynamically register `youtube_{category}_user` sources from the DB so the orchestrator picks them up without hardcoding

## 8. Verification

- [x] 8.1 Run `npm run build` and verify all routes compile, test the lucky pick flow end-to-end, verify watched exclusion works
