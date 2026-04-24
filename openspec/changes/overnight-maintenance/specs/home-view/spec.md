## MODIFIED Requirements

### Requirement: Consumption-home layout

When `/` renders in the connected-with-corpus branch, it SHALL compose a vertical stack in the following order: an optional `SinceLastVisit` digest line (see "Since-last-visit digest" requirement), `RightNowRail` (see `home-ranking` capability), `ContinueRail`, `ShelfRail`, and a footer entry-point strip. The masthead title card ("Folio / A personal video magazine") SHALL NOT render; no heading containing the words *magazine*, *issue*, *cover*, *featured*, *brief*, *slot*, *publish*, *draft*, or *masthead* SHALL render.

Each rail SHALL render via a server component that reads SQLite directly through a dedicated helper. No rail SHALL block another's render; one rail returning an empty list SHALL NOT hide any other rail. The `SinceLastVisit` line SHALL render no DOM at all (not a heading, not a wrapper) when its conditions are not met.

#### Scenario: Rail ordering

- **WHEN** `/` renders in the connected-with-corpus branch with all rails populated and a recent successful nightly digest
- **THEN** `SinceLastVisit` SHALL appear first, `RightNowRail` second, `ContinueRail` third, `ShelfRail` fourth, and the entry-point footer last

#### Scenario: Rail ordering when no nightly digest exists

- **WHEN** `/` renders and no `nightly_runs` row exists yet
- **THEN** `SinceLastVisit` SHALL render no DOM
- **AND** `RightNowRail` SHALL be the first visible element below `TopNav`
- **AND** the rest of the rail order is unchanged

#### Scenario: Magazine vocabulary absent

- **WHEN** `/` renders in the connected-with-corpus branch
- **THEN** the rendered HTML SHALL NOT contain any of the words *magazine*, *issue*, *cover*, *featured*, *brief*, *slot*, *publish*, *draft*, or *masthead* in visible text (case-insensitive, word-boundary match)

## ADDED Requirements

### Requirement: Since-last-visit digest

The system SHALL render a `SinceLastVisit` server component above `RightNowRail` on `/` when ALL of the following are true:

1. The connected-with-corpus branch is active.
2. A `nightly_runs` row exists.
3. The latest such row has `status = 'ok'`.
4. The latest such row's `run_at` is within the last 36 hours of the request time.

When all conditions hold, the component SHALL render a single line with the row's `notes` text, prefixed by a small kicker reading `Since last visit`. The line SHALL NOT contain any of the magazine vocabulary listed in the "Consumption-home layout" requirement. When ANY condition fails, the component SHALL render no DOM at all.

#### Scenario: Recent successful digest renders

- **GIVEN** the latest `nightly_runs` row has `status = 'ok'`, `run_at = '2026-04-24T07:00:00Z'`, and `notes = '+12 imported, +8 enriched, +15 embedded, recluster: incremental, +5 candidates.'`
- **WHEN** the operator visits `/` at `2026-04-24T13:00:00Z`
- **THEN** `SinceLastVisit` SHALL render the kicker `Since last visit` followed by the literal `notes` text

#### Scenario: Stale digest is hidden

- **GIVEN** the latest `nightly_runs` row's `run_at` is 50 hours before the request time
- **WHEN** the operator visits `/`
- **THEN** `SinceLastVisit` SHALL render no DOM

#### Scenario: Failed digest is hidden

- **GIVEN** the latest `nightly_runs` row has `status = 'failed'`
- **WHEN** the operator visits `/`
- **THEN** `SinceLastVisit` SHALL render no DOM

#### Scenario: No digest at all is hidden

- **GIVEN** the `nightly_runs` table is empty
- **WHEN** the operator visits `/`
- **THEN** `SinceLastVisit` SHALL render no DOM
- **AND** `RightNowRail` SHALL still be the topmost rendered rail
