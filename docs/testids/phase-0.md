# Phase 0 test contract: sign-in, role landing, guards, reduced motion

The phase 0 acceptance tests (tests/acceptance/phase-0/) find elements only by role and accessible name, through the
page objects in tests/acceptance/pages/. The implementation must expose exactly these names. They stay stable through
phases 1 to 8 because the phase 0 tests are locked. No data-testid is needed in phase 0.

Paths are static-export paths with trailing slashes (WEB-01). "Exactly" means the full accessible name or text, with
no extra words.

## Sign-in page: `/`

| What | Role | Accessible name or text |
| --- | --- | --- |
| Page content | `main` | (one main landmark) |
| Page title | `heading`, level 1, inside main | exactly `Sign in` |
| Google sign-in | `button` | exactly `Sign in with Google` |
| Unlisted account message (AUTH-03) | `alert` | text exactly `This Google account isn't on any organization's list. Ask your placement cell to add it.` |

- The message appears only after an unlisted account tries to sign in (the `alert` region itself may exist empty
  beforehand, which helps screen readers announce it). Its text is then the message and nothing else
  (no error code, HTTP status or Firebase error text anywhere on the page). The user stays on `/` with the
  **Sign in with Google** button still available.
- **Sign in with Google** calls `signInWithPopup(GoogleAuthProvider)`; on the Auth emulator the popup is the
  emulator's account chooser (docs/TEST_ENV.md).
- `window.__e2e.signIn(email, name?)` (emulator builds only) leads to the same result as the button: bootstrap,
  token refresh, then navigation to the role home, or the unlisted alert.
- The **Sign in with Google** button is a `packages/ui` Button and keeps its small-feedback colour transition
  (UI-10, 120 ms) when motion is allowed, so its computed `transition-duration` is above 0 s without reduced motion.

## Role homes (landing after sign-in, PLAN section 7)

| Role | Path | Level-1 heading inside `main`, exactly |
| --- | --- | --- |
| Super admin | `/platform/` | `Organizations` |
| Admin (org A or org B) | `/admin/` | `Overview` |
| Registered student | `/student/` | `Your tests` |

Each home has exactly one `main` landmark and one level-1 heading inside it.

In the admin workspace the shell's top bar is a `banner` landmark that shows the name of the organization being
worked in, as text: `MIT Academy of Engineering` for org A admins, `College of Engineering Pune` for org B admins.
It never shows another organization's name.

## How the signed-in role is observable

1. The landing path and level-1 heading above.
2. The Auth emulator account's custom claims after bootstrap (ORG-02, AUTH-02):
   - super admin: `role: "superAdmin"`
   - admin: `role: "admin"`, `orgId` of their organization (`org-a` or `org-b`)
   - student: `role: "student"`, `orgId` of their organization, `studentId` equal to the ID of their record
     `organizations/{orgId}/students/{studentId}`
3. Stored links (DATA-01, DECISIONS Q5): after first sign-in, the matching `superAdmins/*`,
   `organizations/{orgId}/admins/*` or `organizations/{orgId}/students/{studentId}` record has `uid` equal to the
   Auth emulator account's `localId`.
4. An unlisted account still has its Auth emulator account (the sign-in happened) but gets no `role` claim.

## Client guards (WEB-03)

| Who | Opens | Ends on |
| --- | --- | --- |
| Signed-in student | `/admin/` or `/platform/` | `/student/` (student home heading visible, no admin or platform heading) |
| Signed-in admin | `/platform/` or `/student/` | `/admin/` |
| Signed-in super admin | `/student/` | `/platform/` |
| Unlisted account (signed in to Google, no role) | `/student/`, `/admin/` or `/platform/` | `/` (sign-in page) |
| Signed-out visitor | `/student/`, `/admin/` or `/platform/` | `/` (sign-in page) |

In every case the target page's level-1 heading is not shown.

## Reduced motion (UI-12)

With `prefers-reduced-motion: reduce` emulated, every element and every `::before` and `::after` pseudo-element on
the sign-in page and on the role homes computes `transition-duration` and `animation-duration` to zero (every
comma-separated value, for example `0s, 0s`). Values such as `0.01ms` do not count as instant. Tests load the page
after setting the emulated preference, so reading the preference once before first paint is fine.
