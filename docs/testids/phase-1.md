# Phase 1 test contract: organizations and people

The phase 1 acceptance tests (tests/acceptance/phase-1/) find elements through the page objects in
tests/acceptance/pages/, by role and accessible name. The implementation must expose exactly these names. The phase 0
contract (docs/testids/phase-0.md) stays valid. A `data-testid` is used only where a role would be ambiguous; those
are listed in "Test IDs" at the end.

Conventions used below:

- "Exactly" means the full accessible name or text with no extra words. Names in a table are exact unless they are
  written as "starts with" or "contains".
- Paths are static-export paths with trailing slashes (WEB-01). IDs travel in search params (WEB-02).
- Numbers shown to people use `en-IN` grouping (`1,026`, `2,000`).
- A "field" is a form control with a visible `<label>` element. Its accessible name is the label text. Required fields
  say so in words: the label ends with ` (required)`, for example `Name (required)` (A11Y-11). Optional fields have no
  marker.
- A field error is shown as visible text next to the field, the field gets `aria-invalid="true"`, and the error text is
  part of the field's accessible description (`aria-describedby`) (UX-09, A11Y-11). Error texts are fixed below.
- Every confirmation of a destructive or status-changing action is an `alertdialog` named as listed. Focus starts on
  `Cancel`; the confirming button sits to the right of `Cancel`; destructive confirm buttons use the `redpen` colour
  (`#B8321F`, `rgb(184, 50, 31)`) as their background (UX-02).
- Every dialog traps focus while open and, when closed (Escape, Cancel or Close), returns focus to the control that
  opened it (A11Y-05). The control that opened a dialog from a menu item is the menu's trigger button.
- Selects listed as "native select" are `<select>` elements (role `combobox`), so tests can choose options by label.
- Every graduation-year select (profile form, Add student, Edit profile) offers the years from the current year minus 1
  to the current year plus 5, where the current year comes from the server clock in the org's timezone (in 2026:
  2025 to 2031, so 2026 and 2027 are always offered).
- Tables are `table` elements named by their caption or `aria-label`; column headers are `columnheader` cells with
  the names listed (a leading selection-checkbox column has no name).

## Requests the tests send directly

Tests call the API with real ID tokens (Auth emulator Google credential, then `POST /v1/session/bootstrap` with body
`{}` and a token refresh), to prove wrong-role refusals, tenant isolation (ORG-05) and super-admin parity (ORG-14).
Super admins add `X-Org-Id`. Bodies the tests send:

| Request | Body | Expected |
| --- | --- | --- |
| `GET /v1/me` | | `200`, body has `preferences` with the fields of PLAN section 5 `Preferences` |
| `PUT /v1/me/preferences` | `{ "textSize": 120, "theme": "dark", "highContrast": false, "reduceMotion": "system", "increasedSpacing": false, "readingRuler": false }` | `400` (120 is not an allowed size) |
| `PUT /v1/me/profile` | `{ "name", "prn", "departmentId", "graduationYear" }` | `403` with error code `PROFILE_LOCKED` when the org locks profiles |
| `POST /v1/platform/orgs` | `{ "name", "slug", "timezone", "departments": string[] }` | `403` for an admin |
| `PATCH /v1/platform/orgs/{orgId}` | `{ "name" }` or `{ "status": "active" \| "suspended" \| "archived" }` | `200` for a status change by a super admin, including restoring an archived org: per docs/DECISIONS.md (2026-10-18, Q9 refinement) every mutation in an archived org is `409 ORG_ARCHIVED` except a super admin's status change on the org itself; so `{ name }` on an archived org is `409 ORG_ARCHIVED` |
| `POST /v1/platform/orgs/{orgId}/admins` | `{ "email", "name" }` | `403` for an admin |
| `PUT /v1/platform/orgs/{orgId}/entitlements` | `{ "featureOverrides": {}, "limitOverrides": {} }` (partial maps) | `403` for an admin |
| `GET /v1/platform/audit` | | `403` for an admin |
| `POST /v1/departments` | `{ "name" }` | `200` or `201` for an admin; refused for a removed admin's old token: `401` when revocation is detected, or `403 ACCOUNT_DISABLED` from the account-status check (revocation compares whole seconds, so a removal in the same second as the token's `auth_time` is caught by the status check); `409 ORG_ARCHIVED` in an archived org |
| `GET /v1/departments` | | `200` |
| `PATCH /v1/departments/{deptId}` | `{ "name" }` | `200` for this org's admin; `404` for another org's department |
| `GET`, `PATCH`, `DELETE /v1/students/{studentId}` | PATCH `{ "name" }` | `200` for this org's admin or a super admin with `X-Org-Id`; `404` for another org's student; `403` for a student token |
| `GET /v1/students` | | `403` for a student token |
| `POST /v1/whitelist/bulk` | `{ "action": "disable" \| "enable" \| "remove", "emails": string[] }` | `200`; `404` when any email is not on this org's whitelist, and then nothing changes |
| `GET /v1/whitelist` | | `200` |
| `POST /v1/whitelist/import` | any | `403` for a student token (role check before body validation) |
| `GET /v1/audit` | | `403` for a student token |

Error bodies follow API-01: `{ "error": { "code", "message", "details" } }`.

## Test-only scenarios (`POST /__test/seed/:scenario`)

| Scenario | Body | Creates | Returns |
| --- | --- | --- | --- |
| `empty-org` | `{}` | Org `org-c`, slug `empty`, name `Empty College of Engineering`, active, `Asia/Kolkata`, plan `standard`, no departments, no whitelist entries, no students; one admin `admin1@c.test` named `Admin 1` | `{ "orgId": "org-c" }` |
| `student-attempts` | `{ "orgId", "studentId" }` | Series `Placement 2026` and a closed test `Day 1: Aptitude` in that org, and one graded attempt by that student with status `submitted`, score 42 of 50 and `strikesCount` 1 | `{ "seriesId", "testId", "attemptId" }` |

## Audit actions

Every action below writes one entry to `organizations/{orgId}/auditLogs` of the organization it changes (platform
actions on an organization go to that organization's log), with `actor { uid, role, email }`, `action`,
`target { type, id }`, `before`, `after` and `createdAt` (AUD-01, ORG-04, ORG-12).

| Action | Target id | Notes |
| --- | --- | --- |
| `org.create`, `org.update` | org ID | |
| `org.suspend`, `org.archive`, `org.restore` | org ID | `before.status` and `after.status` hold the old and new status |
| `org.admin.add`, `org.admin.remove` | admin record ID | |
| `org.entitlements.update` | org ID | `before` and `after` hold `featureOverrides` and `limitOverrides` |
| `org.settings.update` | org ID | for example `profileLocked` |
| `department.create`, `department.update`, `department.archive`, `department.restore`, `department.merge`, `department.delete` | department ID | rename is `department.update` |
| `whitelist.import`, `whitelist.add`, `whitelist.disable`, `whitelist.enable`, `whitelist.remove` | an email, or `bulk` for many | |
| `student.create`, `student.update`, `student.disable`, `student.enable`, `student.delete` | student ID | `before` and `after` hold the changed fields |

## Shared shell (admin workspace and platform console)

| What | Role | Name or text |
| --- | --- | --- |
| Skip link | `link`, the first element reached by Tab | exactly `Skip to main content`; activating it moves focus to `main` |
| Top bar | `banner` (exactly one) | admin workspace: shows the org name as text (phase 0) |
| Accessibility panel opener | `button` in the banner | exactly `Accessibility settings` |
| Sidebar navigation | `navigation` (exactly one) | exactly `Main` |
| Page content | `main` (exactly one) | exactly one level-1 heading inside |
| Admin sidebar links | `link` in `Main` | exactly `Overview` (/admin/), `Whitelist` (/admin/whitelist/), `Students` (/admin/students/), `Departments` (/admin/departments/), `Reports` (/admin/reports/), `Audit log` (/admin/audit/), `Settings` (/admin/settings/) |
| Platform sidebar links | `link` in `Main` | exactly `Organizations` (/platform/), `Audit log` (/platform/audit/) |

- Headings never skip a level (h1, then h2, then h3) (A11Y-07).
- Keyboard focus (`:focus-visible`) on every focusable element computes `outline-style: solid`,
  `outline-width: 2px`, `outline-offset: 2px` and `outline-color: rgb(46, 63, 209)` (ballpoint, light theme) (A11Y-04).
  A focused element is never covered by a sticky top bar, footer bar or bulk-action bar: the element itself is the
  topmost element at its centre point.
- Every visible clickable target (links, buttons, inputs, selects, switches, checkboxes and radios with their label,
  tabs, menu items, options) is at least 44 by 44 CSS px. Links inside running text (`<p>`) are exempt (UX-04, A11Y-16).
- From 1,200 px of viewport width up the `Main` navigation shows text and is at least 160 px wide; below 1,200 px it
  shows icons only, keeps every link's accessible name, and is at most 96 px wide. At 768 px no admin page scrolls
  horizontally (`document.documentElement.scrollWidth <= innerWidth`); wide tables scroll inside their own region
  (UX-12, DECISIONS Q10).
- Every page's primary action sits top-right in the page header: its centre is level with the level-1 heading (within
  40 px vertically) and its right edge is within 64 px of the right edge of `main` (UX-01).
- A disabled feature's sidebar link stays visible and its accessible description is exactly
  `Not included in your organization's plan` (FF-03). Phase 1 shows this for `Reports` (`analytics_reports`, off by
  default).

### Command palette and shortcuts (admin workspace)

| What | Role | Name or text |
| --- | --- | --- |
| Palette, opened by `Ctrl K` or `Meta K` anywhere | `dialog` | exactly `Command palette` |
| Palette input | `combobox` in the palette | exactly `Search students, pages and actions` |
| Results | `option` in a `listbox` | pages: exactly the sidebar link name, for example `Departments`; students: exactly `<full name>, <PRN>`, for example `Rohan Patil, 22010103`; actions: exactly `Add student`, `Add department`, `Upload whitelist` |
| Shortcut list, opened by `?` when focus is not in a text field | `dialog` | exactly `Keyboard shortcuts`; lists `Ctrl K` with `Open the command palette` (admin) and `?` with `Show keyboard shortcuts` (every screen, students too) |

Choosing a page option navigates there. Choosing a student opens `/admin/students/` with that student's detail drawer
open. Choosing `Upload whitelist`, `Add department` or `Add student` opens that dialog on its page (/admin/whitelist/,
/admin/departments/, /admin/students/). `Enter` chooses the
highlighted option; typing filters the list; `Escape` closes the palette and focus returns to where it was.

### Organization switcher (super admins only)

| What | Role | Name or text |
| --- | --- | --- |
| Switcher at the top of the sidebar | `button` | contains `Switch organization`; it sits in the sidebar outside the `Main` navigation element, above it (its bottom edge is at or above the top of `Main`) |
| Its choices | `menuitem` | exactly `Platform`, then each organization's name |
| Workspace notice, inside the `banner`, on every /admin/ page while a super admin works in an org | text | exactly `Working in <org name>` |
| Archived workspace notice, inside `main` | text | exactly `This organization is archived. You can view its data but not change it.` |

- Choosing an organization opens `/admin/` (heading `Overview`) for that organization, with the same sidebar links an
  admin has (ORG-09). The choice survives a reload in the same tab. Choosing `Platform` opens `/platform/`.
- A super admin who opens `/admin/` without having chosen an organization lands on `/platform/`.
- Admins never see the switcher or the `Working in` notice.
- In an archived organization's workspace every mutating control (for example `Add department`) is disabled.

## Platform console

### Organizations list: `/platform/`

| What | Role | Name or text |
| --- | --- | --- |
| Heading | `heading` level 1 | exactly `Organizations` (phase 0) |
| Primary action | `link` or `button` | exactly `New organization` |
| List | `table` | exactly `Organizations`; columns `Name`, `Slug`, `Status`, `Students`, `Admins` |
| Row | `row` | first cell holds a `link` named exactly the org name, to `/platform/org/?id=<orgId>`; `Status` cell exactly `Active`, `Suspended` or `Archived` |

### New organization form (opened by `New organization`)

| What | Role | Name or text |
| --- | --- | --- |
| Heading | `heading` level 1 in main | exactly `New organization` |
| Fields | | `Name (required)` textbox; `URL slug (required)` textbox; `Timezone (required)` native select, value `Asia/Kolkata` by default; `Logo` file input (PNG, JPEG or SVG); `Departments` textbox (multi-line, one department per line) |
| Sticky footer bar | `region` | exactly `Form actions`; CSS `position` `sticky` or `fixed`; holds `Discard` then the primary button `Create organization` at its far right |
| Unsaved changes notice in that bar | `status` | exactly `Unsaved changes` once any field differs from its initial value; `Discard` resets the fields and removes it |

Errors: empty name `Enter the organization's name.`; slug already used
`This slug is already used by another organization. Choose a different one.` After `Create organization` succeeds the
browser shows the new organization's detail page, and the organization is stored with `status: "active"`, the slug,
name and timezone, a `logoPath` when a logo was chosen, and one `departments` record per line.

### Organization detail: `/platform/org/?id=<orgId>`

| What | Role | Name or text |
| --- | --- | --- |
| Heading | `heading` level 1 | exactly the org name |
| Status | test ID `org-status` | exactly `Active`, `Suspended` or `Archived` |
| Logo | `img` | exactly `<org name> logo` (when the org has one) |
| Primary action | `button` | exactly `Edit details`; disabled while archived |
| Edit dialog | `dialog` | exactly `Edit details`; fields `Name (required)`, `Timezone (required)`, `Logo`; button `Save changes` |
| Overflow menu | `button` | exactly `More actions`; `menuitem`s exactly `Suspend organization` (when active), `Archive organization` (active or suspended), `Restore organization` (suspended or archived) |
| Confirmations | `alertdialog` | exactly `Suspend <name>?`, `Archive <name>?`, `Restore <name>?`; confirm button named like the menu item |
| Sections | `heading` level 2 | exactly `Admins`, `Features and limits`, `Usage` |
| Admins | `table` | exactly `Admins`; columns `Email`, `Name`, `Status`; removed admins are not listed |
| Add admin | `button` and `dialog` | `Add admin` opens dialog `Add admin` with `Email (required)`, `Name` and submit button `Add admin` |
| Remove admin | `button` per row | exactly `Actions for <email>`, `menuitem` `Remove admin`, `alertdialog` `Remove <email>?`, confirm `Remove admin` |
| Feature switches | `switch` | exactly `AI question import`, `Question pools`, `Sections`, `Negative marking`, `Per-question timer`, `Phone as second camera`, `Leaderboards`, `Extra time`, `Results export`, `Analytics reports` |
| Limit fields | `spinbutton` | exactly `Max students`, `Max admins`, `AI imports per month`, `AI reports per month`, `Storage (GB)` |
| Save | `button` | exactly `Save features and limits`; afterwards a `status` exactly `Features and limits saved` |
| Usage | `table` | exactly `Usage`; columns `Measure`, `Used`, `Limit`; rows named `Students` (whitelist entries), `Admins`, `Tests run this month`, `AI imports this month`, `Analytics reports this month`, `Storage`; limits as numbers, `No limit` where none applies, storage in GB such as `10 GB` |

Errors: admin already listed `This email is already an admin of this organization.`; a limit below 0 or not whole
`Enter a whole number, 0 or more.`

### Sign-in for suspended and archived organizations (ORG-07, DECISIONS Q9)

On `/`, an admin or student of a suspended organization sees an `alert` with exactly
`This organization is suspended, so you can't sign in. Ask your placement cell for help.` (archived:
`This organization is archived, so you can't sign in. Ask your placement cell for help.`), stays on `/`, and gets no
`role` claim.

### Cross-organization audit log: `/platform/audit/`

As the admin audit log below, plus a native select `Organization` (first option `All organizations`, then org names)
and a column `Organization` holding the org name. The CSV export adds an `organization` column.

## Admin workspace

### Departments: `/admin/departments/`

| What | Role | Name or text |
| --- | --- | --- |
| Heading | `heading` level 1 | exactly `Departments` |
| Primary action | `button` | exactly `Add department`, opens `dialog` `Add department` with `Name (required)` and submit `Add department` |
| List | `table` | exactly `Departments`; columns `Name`, `Students`, `Status` (`Active` or `Archived`) |
| Row menu | `button` | exactly `Actions for <department name>`; `menuitem`s exactly `Rename`, `Merge into another department`, `Archive` (or `Restore` when archived), `Delete` |
| Rename | `dialog` | exactly `Rename <name>`; `Name (required)`; submit `Save` |
| Merge | `dialog` | exactly `Merge <name>`; native select `Merge into (required)` listing the other active departments; submit `Merge departments`. Students move to the chosen department; the merged one becomes `Archived` with 0 students |
| Delete in use | `menuitem` `Delete` | disabled (`aria-disabled="true"`), with visible text in the menu exactly `Used by <n> students. Merge or archive it instead.` |
| Delete unused | `alertdialog` | exactly `Delete <name>?`; confirm `Delete department` |
| Empty state | test ID `empty-state` | exactly `No departments yet. Add the departments your students belong to.` and one button `Add department` |

Archived departments are not offered in the profile form or any department picker. Error: name already used (any
case) `A department with this name already exists.`

### Whitelist: `/admin/whitelist/`

| What | Role | Name or text |
| --- | --- | --- |
| Heading | `heading` level 1 | exactly `Whitelist` |
| Primary action | `button` | exactly `Upload whitelist` |
| Single add | `button` | exactly `Add entry`, opens `dialog` `Add whitelist entry` with `Email (required)`, `PRN`, `Note` and submit `Add entry` |
| Count | test ID `whitelist-count` | exactly `<n> entries` (`1 entry`) for all entries of the org |
| Search | `searchbox` | exactly `Search by email or PRN` |
| Status filter | native select | exactly `Status`; options `All`, `Invited`, `Registered`, `Disabled` |
| List | `table` | exactly `Whitelist`; columns `Email`, `PRN`, `Note`, `Status`; 50 rows per page |
| Row | `row` | `checkbox` exactly `Select <email>`; `Status` cell exactly `Invited`, `Registered` or `Disabled` |
| Bulk-action bar | `toolbar` | exactly `Bulk actions`; shown while rows are selected, fixed to the bottom of the viewport; text `<n> selected`; buttons exactly `Disable`, `Enable`, `Export`, `Remove` |
| Remove confirmation | `alertdialog` | exactly `Remove <n> entries?` (`Remove 1 entry?`); confirm `Remove entries` |
| Export | download | a `.csv` file whose first line is exactly `email,prn,note,status` and one line per selected entry |
| Empty state | test ID `empty-state` | exactly `No students yet. Upload your whitelist to let students sign in.` and one button `Upload whitelist` |
| No search match | test ID `empty-state` | exactly `No entries match your search.` and one button `Clear search` |

Emails are stored lowercase and trimmed (WL-01). Removing a registered student's entry deletes the entry and sets the
student record's `status` to `disabled`; the record and its attempts stay. Error in `Add whitelist entry`: invalid
email `Enter a valid email address, like name@college.edu.`; already listed `This email is already on the whitelist.`

### Upload wizard (`dialog` exactly `Upload whitelist`)

| Step | What | Role | Name or text |
| --- | --- | --- | --- |
| 1 | Step heading | `heading` | exactly `Choose a source` |
| 1 | Source | `radiogroup` `Source` | `radio`s exactly `Upload a file`, `Paste a list` |
| 1 | File | file input | exactly `File (CSV or XLSX)` |
| 1 | Pasted list | textbox | exactly `Emails, one per line` |
| all | Next step | `button` | exactly `Continue` |
| 2 (files only) | Step heading | `heading` | exactly `Match columns` |
| 2 | Mapping | native selects | exactly `Email column (required)`, `PRN column`, `Note column`; options are the file's header names, plus `None` for the optional ones |
| 2 | Preview | `table` | exactly `Preview`; columns `Email`, `PRN`, `Note`; the first 5 data rows as mapped |
| 3 | Step heading | `heading` | exactly `Check before saving` |
| 3 | Report | `list` | exactly `Validation report`; `listitem`s exactly `Ready to add: <n>`, `Invalid emails: <n>`, `Duplicates in the file: <n>`, `Already on the whitelist: <n>` |
| 3 | Problems | `table` | exactly `Problems`; columns `Row`, `Email`, `Problem`; `Problem` exactly `Invalid email`, `Duplicate in the file` or `Already on the whitelist`; `Email` as written in the file |
| 3 | Over the limit | `alert` | exactly `This would bring the whitelist to <total> entries, over your limit of <max_students>. Remove some rows or ask the platform team to raise the limit.`; `Save to whitelist` is then disabled |
| 3 | Save | `button` | exactly `Save to whitelist` (disabled when nothing is ready) |
| after | Result | `status` on the page | exactly `Added <n> entries to the whitelist` |

Pasted lists skip step 2. Duplicates in the file are compared after trimming and lowercasing; the first occurrence is
ready to add and later ones are reported. Error on step 1: a file that is not CSV or XLSX
`This file isn't a CSV or XLSX file. Choose a .csv or .xlsx file.`

### Students: `/admin/students/`

| What | Role | Name or text |
| --- | --- | --- |
| Heading | `heading` level 1 | exactly `Students` |
| Primary action | `button` | exactly `Add student` |
| Search | `searchbox` | exactly `Search by name, email or PRN` |
| Filters | native selects | exactly `Department` (first option `All departments`), `Graduation year` (`All years`), `Status` (`All statuses`, `Invited`, `Registered`, `Disabled`) |
| Column picker | `button` `Columns`, then `menuitemcheckbox`es | exactly `Email`, `PRN`, `Department`, `Graduation year`, `Status` |
| Density | `radiogroup` | exactly `Density`; `radio`s exactly `Comfortable` (default) and `Compact`; compact rows are shorter and still at least 44 px tall |
| List | `table` | exactly `Students`; columns `Name`, `Email`, `PRN`, `Department`, `Graduation year`, `Status`; 50 rows per page |
| Sorting | `button` inside each `columnheader` | named exactly the column name; the `columnheader` carries `aria-sort`; the first press sorts ascending, the next descending |
| Row | `row` | first cell holds a `button` named exactly the student's full name; clicking anywhere on the row opens the drawer; `checkbox` exactly `Select <full name>` |
| Bulk-action bar | `toolbar` | exactly `Bulk actions`, fixed to the bottom of the viewport, text `<n> selected` |
| Loading | | while the list loads, the `Students` table (or its region) has `aria-busy="true"` and shows skeleton rows with test ID `skeleton` (UX-07) |
| Empty state | test ID `empty-state` | exactly `No students yet. Add a student to get started.` and one button `Add student` |
| No search match | test ID `empty-state` | exactly `No students match your search.` and one button `Clear search` |

The directory lists student records: registered and disabled students, and manually added students (status
`Invited`). Whitelist entries without a student record appear only on the Whitelist page.

Add student (`dialog` exactly `Add student`): `Email (required)`, `Full name (required)`, `PRN (required)`,
`Department (required)` (native select), `Graduation year (required)` (native select); submit `Add student`. The new
student is stored with a generated `id`, `status: "invited"` and no `uid`, together with a whitelist entry
(`status: "invited"`, `studentId` set) (STU-09, DATA-01). Errors: PRN used
`This PRN already belongs to another student. Check it and try again.`; email listed
`This email is already on the whitelist.`

Student detail drawer (`dialog` named exactly the student's full name), 560 px wide, against the right edge. It is
non-modal: the list behind it stays visible and readable to assistive technology (no `aria-modal`, the rest of the
page is not made `inert` or `aria-hidden`), and closing it (`Close` or Escape) returns focus to the row control that
opened it (A11Y-05). Confirmation dialogs opened from it are modal `alertdialog`s that trap focus.

| What | Role | Name or text |
| --- | --- | --- |
| Sections | `heading` | exactly `Profile`, `Attempts`, `Change history` |
| Attempts | `table` | exactly `Attempts`; columns `Test`, `Score`, `Strikes`, `Status`; score as `42 / 50`; without attempts the text `No attempts yet.` |
| Change history | `list` | exactly `Change history`; one `listitem` per audit entry for this student, newest first, showing the time, the actor's email and, for edits, the old and new values. With no entries the list is replaced by the text exactly `No changes yet.` |
| Edit | `button` | exactly `Edit profile`; the drawer then shows `Full name (required)`, `PRN (required)`, `Department (required)`, `Graduation year (required)` and `Save changes` |
| Overflow menu | `button` | exactly `More actions`; `menuitem`s exactly `Disable student` (or `Enable student`) and `Delete student`. Destructive items are never shown next to `Edit profile` |
| Disable | `alertdialog` | exactly `Disable <name>?`; confirm `Disable student`. Disabling sets the student record's `status` and their whitelist entry's `status` to `disabled` (and revokes their tokens, AUTH-06); `Enable student` sets both back |
| Delete | `alertdialog` | exactly `Delete <name>?`; confirm `Delete student`. When the student has attempts, a textbox exactly `Type the student's name to confirm` is shown and `Delete student` stays disabled until it holds the exact full name. Deleting removes the student record and keeps attempts |
| Close | `button` | exactly `Close` |

### Settings: `/admin/settings/`

| What | Role | Name or text |
| --- | --- | --- |
| Heading | `heading` level 1 | exactly `Settings` |
| Sections | `heading` level 2 | exactly `Student profiles`, `Plan and features` |
| Profile lock | `switch` | exactly `Lock student profiles`; saves at once and updates optimistically |
| Refused change | `alert` near the switch | starts with `Couldn't save this change.`; the switch returns to its previous state. Shown for any error response from the API (for example `409 ORG_ARCHIVED` when the org was archived meanwhile) |
| Features | `list` | exactly `Features`; one `listitem` per feature with its label (as on the platform switches) and either `Included` or `Not included in your organization's plan` |

### Audit log: `/admin/audit/`

| What | Role | Name or text |
| --- | --- | --- |
| Heading | `heading` level 1 | exactly `Audit log` |
| Primary action | `button` | exactly `Export CSV`; downloads a `.csv` of the entries matching the current filters, with a header line that includes `time`, `actor`, `action`, `target`, `before`, `after` |
| Filters | | textboxes exactly `Actor` (email), `Action`, `Target`; date inputs exactly `From`, `To` (org timezone, inclusive); buttons exactly `Apply filters`, `Clear filters`. `Actor`, `Action` and `Target` match exactly (`Target` against `target.id`) |
| List | `table` | exactly `Audit log`; columns `Time`, `Actor`, `Action`, `Target`, `Change`; `Actor` shows the email, `Action` the action name, `Target` the entry's `target.id` (for example `dept-org-a-it`), `Change` the before and after values |
| Empty | test ID `empty-state` | exactly `No audit entries match these filters.` and one button `Clear filters` |

## Student sign-in, organization choice, consent and profile

### Organization chooser (on `/` after signing in, for an email listed in more than one org)

| What | Role | Name or text |
| --- | --- | --- |
| Heading | `heading` level 1 | exactly `Choose your organization` |
| Choices | `button`s inside a `group` named exactly `Your organizations` | exactly each listed org's name, and no other org; the group holds nothing but these buttons (a `Sign out` button, if any, sits outside it) |

Choosing one repeats `POST /v1/session/bootstrap` for that org; the claims then hold its `orgId` (AUTH-04).

### Student top bar

| What | Role | Name or text |
| --- | --- | --- |
| Accessibility | `button` in the `banner` | exactly `Accessibility settings` |
| Account menu | `button` in the `banner` | exactly `Account menu`; `menuitem`s exactly `Profile`, `Switch organization` (only for students listed in more than one org), `Sign out` |

The student top bar is on every student page, including `/profile/` while the consent notice or profile completion
is shown. `Switch organization` returns to the chooser on `/`.

### Consent notice and profile: `/profile/`

A student without consent, or without a complete profile, is sent to `/profile/` from every student page (STU-01).

| What | Role | Name or text |
| --- | --- | --- |
| Consent heading | `heading` level 1 | exactly `Your data and privacy` (shown first, until consent is given) |
| Consent text | | names what is collected (`name`, `email`, `PRN`, `department`, `graduation year`, test answers, proctoring events), why, and contains `Digital Personal Data Protection Act, 2023` |
| Agree | `button` | exactly `I agree and continue`; stores `consentAt` on the student record |
| Profile heading | `heading` level 1 | exactly `Complete your profile` (first time) or `Your profile` (later) |
| Fields | | `Full name (required)` textbox; `PRN (required)` textbox; `Department (required)` native select of the org's active departments; `Graduation year (required)` native select |
| Save | `button` | exactly `Save and continue` (first time; then the student home) or `Save changes` (later) |
| Locked | text | exactly `Your profile is locked. Ask your placement cell to make changes.`; every field read-only; no `Save changes` |

- A PRN from the whitelist entry is prefilled and read-only (STU-02).
- A record that already holds every profile field (manual add) skips the profile step after consent.
- Errors: empty name `Enter your full name.`; PRN used by another student
  `This PRN is already registered. Check it, or ask your placement cell for help.`
- On success the student record holds `name`, `prn`, `departmentId`, `graduationYear`, `uid` and
  `status: "registered"`, and the whitelist entry's `status` is `registered`.

## Accessibility panel (every top bar: admin, platform, student)

`Accessibility settings` opens a `dialog` exactly `Accessibility settings` with:

| Control | Role | Name and options |
| --- | --- | --- |
| Text size | `radiogroup` | exactly `Text size`; `radio`s exactly `100%`, `115%`, `130%`, `150%` |
| Theme | `radiogroup` | exactly `Theme`; `radio`s exactly `Light`, `Dark`, `Follow system` |
| High contrast | `switch` | exactly `High contrast` |
| Reduce motion | `radiogroup` | exactly `Reduce motion`; `radio`s exactly `On`, `Off`, `Follow system` |
| Increased spacing | `switch` | exactly `Increased spacing` |
| Reading ruler | `switch` | exactly `Reading ruler` |
| Close | `button` | exactly `Close` |

Each change applies at once and is saved with `PUT /v1/me/preferences` (A11Y-02). Observable effects:

- Text size: the `<html>` element's computed `font-size` is 16 px times the size (`16px`, `18.4px`, `20.8px`, `24px`).
- Theme: the `<html>` element's computed `background-color` is the `sheet` colour, `rgb(243, 245, 247)` in light and
  `rgb(15, 19, 38)` in dark; `Follow system` follows `prefers-color-scheme`.
- High contrast: `<html>` background `rgb(255, 255, 255)` and `<body>` text colour `rgb(0, 0, 0)`.
- Reduce motion `On`: every transition and animation is instant (the phase 0 rule) even when the system allows motion.
- Increased spacing: `<body>` computes `letter-spacing` at least 0.12 times, `word-spacing` at least 0.16 times and
  `line-height` at least 1.5 times its font size.
- Reading ruler: an element with test ID `reading-ruler` is visible.
- Preferences are cached in the browser and applied by an inline script before the app's JavaScript runs, so a reload
  shows the saved size and theme before any `/_next/static/**/*.js` file has loaded. A fresh browser that signs in
  gets them from the account.

## Test IDs

| Test ID | Where | Why not a role |
| --- | --- | --- |
| `org-status` | organization detail header | a status badge with no landmark role |
| `whitelist-count` | whitelist page header | a count line with no role |
| `empty-state` | every empty or no-match state | one sentence and one action, no distinct role |
| `skeleton` | loading placeholders | decorative, hidden from assistive technology |
| `reading-ruler` | reading ruler band | decorative, `aria-hidden` |
