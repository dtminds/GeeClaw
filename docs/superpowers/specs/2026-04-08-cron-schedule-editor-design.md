# Cron Schedule Editor Design

## Goal

Redesign the schedule section in the Cron create/edit dialog so non-technical users can configure common schedules without writing Cron expressions, while preserving a Cron escape hatch for advanced cases.

## Scope

This design covers the schedule interaction inside the Cron task dialog on [`src/pages/Cron/index.tsx`](/Users/lsave/workspace/AI/ClawX/src/pages/Cron/index.tsx), including:

- New schedule mode structure and fields
- Mapping between UI state and gateway `CronSchedule`
- Editing/backfill behavior for existing jobs
- Validation, preview, and error handling
- Required frontend/electron API shape changes

This design does not change cron job delivery behavior, run history, or list-card layout beyond schedule rendering compatibility.

## Problem

The current dialog only supports:

- A fixed preset button grid
- A raw Cron expression input

That interaction is too limited for common cases such as "every Wednesday at 9:00" and too technical for users who do not know Cron syntax. The backend already supports structured schedule kinds (`every`, `at`, `cron`), but the dialog currently flattens all create requests to `schedule: string` and forces them into `cron`.

## Design Principles

- Match user intent, not backend vocabulary
- Keep the first decision obvious and low-risk
- Preserve full power through advanced Cron mode
- Structure simple schedules as typed data instead of serializing everything into Cron
- Prefer reversible schedules so most existing jobs can be edited through the visual UI

## Recommended Interaction

Replace the current preset/custom toggle with three top-level schedule mode cards:

- `每隔`
- `固定时间`
- `Cron`

Selecting a mode reveals only that mode's fields. The schedule section always shows a single `下次运行时间` preview below the active editor.

No schedule summary text is shown in the dialog preview area.

## Schedule Modes

### 1. `每隔`

This mode is for interval-based repetition.

Fields:

- Interval count: positive integer
- Interval unit: `分钟 | 小时 | 天`

Examples:

- Every 30 minutes
- Every 6 hours
- Every 3 days

Data mapping:

- Submit as `{ kind: 'every', everyMs }`

Constraints:

- Minimum count is `1`
- Only integer values are supported

### 2. `固定时间`

This mode is for calendar-aligned execution.

Subtypes:

- `一次`
- `每天`
- `每周`
- `每月`

#### `一次`

Fields:

- Date picker
- Time picker

Data mapping:

- Submit as `{ kind: 'at', at: ISOString }`

#### `每天`

Fields:

- Time picker

Data mapping:

- Submit as `{ kind: 'cron', expr: 'M H * * *' }`

#### `每周`

Fields:

- Weekday single-select
- Time picker

Data mapping:

- Submit as `{ kind: 'cron', expr: 'M H * * D' }`

Version 1 uses single weekday selection only. Multi-day weekly schedules remain available through Cron mode.

#### `每月`

Fields:

- Day-of-month select: `1-31`
- Time picker

Helper text:

- `当月没有该日期时跳过`

Data mapping:

- Submit as `{ kind: 'cron', expr: 'M H DOM * *' }`

Behavior:

- If a month does not contain the selected day, that month is skipped

### 3. `Cron`

This mode is the advanced escape hatch.

Fields:

- Raw Cron expression input

Support behavior:

- Mark the section as advanced
- Validate syntax before save
- Still show next-run preview when parseable
- Show inline error when expression is invalid or preview cannot be calculated

## Layout Changes

Within the right column of the dialog:

1. Replace the preset button grid with three schedule mode cards
2. Render the active editor inside a shared schedule field section
3. Keep a single preview row beneath the active editor
4. Keep delivery settings below schedule settings with no structural changes

This keeps the dialog information architecture stable while making the schedule interaction significantly more capable.

## State Model

Introduce explicit schedule editor state in the dialog instead of storing only a raw string.

Recommended UI state shape:

- `scheduleMode: 'every' | 'fixed' | 'cron'`
- `fixedSubtype: 'once' | 'daily' | 'weekly' | 'monthly'`
- `everyCount: number`
- `everyUnit: 'minutes' | 'hours' | 'days'`
- `onceDate: string`
- `onceTime: string`
- `dailyTime: string`
- `weeklyDay: string`
- `weeklyTime: string`
- `monthlyDay: number`
- `monthlyTime: string`
- `cronExpr: string`

Submission should build a typed `CronSchedule` object from this editor state.

## Create/Update API Changes

The current create/update path constrains schedule input to `string`. That must be widened so the dialog can submit structured schedules without lossy conversion.

Required changes:

- [`src/types/cron.ts`](/Users/lsave/workspace/AI/ClawX/src/types/cron.ts)
  - Change `CronJobCreateInput.schedule` from `string` to `CronSchedule`
  - Change `CronJobUpdateInput.schedule` from `string` to `CronSchedule`
- [`src/stores/cron.ts`](/Users/lsave/workspace/AI/ClawX/src/stores/cron.ts)
  - Pass structured schedule objects through unchanged
- [`electron/api/routes/cron.ts`](/Users/lsave/workspace/AI/ClawX/electron/api/routes/cron.ts)
  - Accept `schedule: CronSchedule` on POST
  - Stop forcing create requests into `{ kind: 'cron', expr: input.schedule }`
- [`electron/main/ipc-handlers.ts`](/Users/lsave/workspace/AI/ClawX/electron/main/ipc-handlers.ts)
  - Mirror the same widened schedule type

Update behavior already flows through `buildCronUpdatePatch`, so create and edit should share the same typed schedule contract after this change.

## Edit and Backfill Behavior

When opening an existing job for edit:

- If schedule is `{ kind: 'every' }`, open `每隔`
- If schedule is `{ kind: 'at' }`, open `固定时间 -> 一次`
- If schedule is `{ kind: 'cron' }`, attempt structured recognition in this order:
  - Daily: `M H * * *`
  - Weekly: `M H * * D`
  - Monthly: `M H DOM * *`
- If recognized, open the matching fixed-time subtype
- If not recognized, fall back to `Cron`

Supported recognition should be intentionally conservative. If an expression uses unsupported combinations such as multiple weekdays, step values, lists, or ranges, it should remain in `Cron` mode rather than being approximated incorrectly.

## Validation

Validation rules by mode:

`每隔`

- Count must be an integer greater than `0`

`固定时间 -> 一次`

- Date and time are both required
- The composed datetime must be valid

`固定时间 -> 每天`

- Time is required

`固定时间 -> 每周`

- Weekday and time are required

`固定时间 -> 每月`

- Day must be between `1` and `31`
- Time is required

`Cron`

- Expression is required
- Expression must be syntactically valid before save

Validation errors should be inline where possible, with toast fallback only for save failures.

## Next Run Preview

The dialog should show a single next-run preview row below the active schedule editor.

Rules:

- Update live as fields change
- Show localized datetime when preview is resolvable
- For invalid input, show a concise error state instead of stale preview text
- Preview should use the same schedule object that will be submitted, not a separate heuristic string path

Because current preview logic is string-preset-based, it should be replaced with a schedule-object-aware preview helper.

## Rendering in List Cards

The existing card renderer already handles `every`, `at`, and `cron` schedules. It should continue to work, but the natural-language formatter should be extended so:

- Weekly schedules render weekday labels clearly
- Monthly schedules render "每月 X 日 HH:MM"
- Cron fallback remains unchanged for unsupported expressions

## i18n Changes

Add translation keys for:

- Schedule mode labels
- Fixed-time subtype labels
- Interval units
- Monthly skip helper text
- Inline validation messages
- Advanced Cron label and help text

Existing preset-only strings can be reduced or removed once the old UI is replaced.

## Testing

Add focused coverage for:

- Schedule object building from each editor mode
- Existing job backfill into mode/subtype state
- Cron recognition fallback behavior
- Monthly skip-compatible expression generation
- Create/update API requests carrying structured schedules
- Next-run preview for `every`, `at`, daily, weekly, and monthly schedules

Recommended test targets:

- Dialog-level schedule helpers as pure unit tests
- Store/API contract tests for create/update payloads
- One UI interaction test covering mode switching and save payload generation

## Risks and Mitigations

Risk: Incorrectly recognizing complex Cron expressions as simple visual schedules.

Mitigation:

- Only recognize narrow supported patterns
- Fall back to Cron for anything ambiguous

Risk: UI and backend schedule payloads diverge during create vs update.

Mitigation:

- Standardize on `CronSchedule` for both create and update
- Reuse one schedule builder path for preview and submission

Risk: Timezone confusion for `一次` schedules.

Mitigation:

- Use local date/time inputs in the dialog
- Convert to a single ISO timestamp at submit time
- Keep preview localized to the user's environment

## Implementation Notes

This work should be implemented as a focused Cron dialog refactor, not as an incremental extension of the existing preset grid. Presets can be removed entirely once the new mode-based editor is in place.
