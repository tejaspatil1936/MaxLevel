Harness files: unchanged (lock OK). Locked acceptance tests: unchanged (1 phase(s) locked).

# Verification: full --phase 0 — PASS

Commit ceda7d7e111ac3c1a82ae8a589eb51ed15dae122. Failed steps: none. Working tree clean: yes.
Tests: 126 passed, 0 failed, 0 skipped.

## Features

| Feature | Phase | Passing |
| --- | --- | --- |
| F-0.01 Design tokens with contrast and scale checks | 0 | yes |
| F-0.02 Core components and Storybook catalogue | 0 | yes |
| F-0.03 Static export, headers and repo rules | 0 | yes |
| F-0.04 API conventions: errors, server time, schemas, CORS, logs, shutdown | 0 | yes |
| F-0.05 Token verification and session bootstrap | 0 | yes |
| F-0.06 Tenancy guards and route-table checks | 0 | yes |
| F-0.07 Feature flags, limits and usage counters | 0 | yes |
| F-0.08 Audit writer | 0 | yes |
| F-0.09 Security rules and platform infrastructure | 0 | yes |
| F-0.10 Google sign-in and role landing | 0 | yes |

## Requirements

| REQ | Phase | Kind | Result | Tests | Evidence |
| --- | --- | --- | --- | --- | --- |
| ORG-01 | 0 | integration | pass | ✓ organization scope ORG-01 every record under organizations/{orgId} carries that orgId |   |
| ORG-02 | 0 | integration | pass | ✓ claims drive the request context ORG-02 after bootstrap and a token refresh, /v1/me reports role and org from the verified claims<br>✓ claims drive the request context ORG-02 a token without role claims cannot read /v1/me |   |
| ORG-03 | 0 | static | pass | ✓ data-access layer ORG-03 every org-scoped data function takes orgId first |   |
| ORG-04 | 0 | integration | pass | ✓ organization scope ORG-04 a super admin acting in org A writes the audit entry into org A with themselves as actor |   |
| ORG-05 | 0 | integration | pass | ✓ admin route table ORG-05 an admin of org A gets 404 for every org B resource, and X-Org-Id cannot move them |   |
| ORG-11 | 0 | integration | pass | ✓ admin route table ORG-11 admin route guards allow the admin of the org or a super admin, never other roles |   |
| ORG-14 | 0 | integration | pass | ✓ admin route table ORG-14 every admin route answers the same for an admin token and a super-admin token with X-Org-Id |   |
| FF-01 | 0 | unit | pass | ✓ resolveEntitlements FF-01 with nothing set, every feature is on except analytics reports, and limits take system defaults<br>✓ resolveEntitlements FF-01 the plan overrides the system default<br>✓ resolveEntitlements FF-01 the organization override wins over the plan |   |
| FF-02 | 0 | integration | pass | ✓ feature gate FF-02 a route behind a disabled feature returns 403 FEATURE_DISABLED for the admin and the super admin<br>✓ feature gate FF-02 an org override turns the feature on, and a plan can turn one off<br>✓ feature gate FF-02 GET /v1/me reports the effective flags and limits so the UI can lock features |   |
| FF-04 | 0 | integration | pass | ✓ usage counters FF-04 concurrent jobs take a monthly allowance atomically and stop exactly at the limit<br>✓ usage counters FF-04 a job past the limit is refused before it starts, and a new month starts from zero<br>✓ monthKey FF-04 counts by calendar month in the organization timezone |   |
| AUTH-01 | 0 | e2e | pass | ✓ AUTH-01 US-ST-01 a whitelisted student signs in through the Google popup and lands on the student home [desktop]<br>✓ AUTH-01 a super admin signs in through the Google popup and lands on the platform console [desktop]<br>✓ AUTH-01 an admin of org A signs in and lands on the admin overview of org A [desktop]<br>✓ AUTH-01 an admin of org B signs in and lands on the admin overview of org B [desktop]<br>✓ AUTH-01 US-ST-01 a whitelisted student of org B signs in and lands on the student home [desktop]<br>✓ AUTH-01 the sign-in page offers Google sign-in to a signed-out visitor [desktop]<br>✓ AUTH-01 US-ST-01 signing in again with the same account after a failed attempt finishes sign-in [desktop] |   |
| AUTH-02 | 0 | integration | pass | ✓ session bootstrap AUTH-02 a super-admin email resolves to superAdmin before any admin or whitelist record<br>✓ session bootstrap AUTH-02 an admin email resolves to admin of its org before a whitelist entry<br>✓ session bootstrap AUTH-02 a whitelisted student gets role, org and studentId, and the uid is linked<br>✓ session bootstrap AUTH-02 an email on no list is refused with the plain message and gets no claims<br>✓ session bootstrap AUTH-02 only verified Google accounts are resolved; other sign-in methods get no role<br>✓ session bootstrap AUTH-02 a disabled whitelist entry is refused like an unlisted email<br>✓ session bootstrap AUTH-02 an email in two orgs is asked to choose, then gets the chosen org<br>✓ session bootstrap AUTH-02 asking again to choose clears the previous choice, so a reload cannot slip into the old org |   |
| AUTH-03 | 0 | e2e | pass | ✓ AUTH-03 US-ST-01 an unlisted Google account sees the contact message and stays on the sign-in page [desktop]<br>✓ AUTH-03 WEB-03 an unlisted account that opens /student/ is sent back to sign-in [desktop]<br>✓ AUTH-03 WEB-03 an unlisted account that opens /admin/ is sent back to sign-in [desktop]<br>✓ AUTH-03 WEB-03 an unlisted account that opens /platform/ is sent back to sign-in [desktop] |   |
| AUTH-05 | 0 | integration | pass | ✓ token verification AUTH-05 requests without a token or with a bad token get 401<br>✓ token verification AUTH-05 admin mutations refuse a token issued before revocation |   |
| AUD-01 | 0 | integration | pass | ✓ audit entries AUD-01 an admin change records actor, org, action, target, before, after, time, IP, user agent and request ID<br>✓ audit entries AUD-01 sensitive fields are removed from before and after values<br>✓ scrubForAudit AUD-01 removes answer keys, explanations and tokens at any depth |   |
| AUD-02 | 0 | integration | pass | ✓ audit atomicity AUD-02 the entry commits in the same batch as the change: a failed change leaves no entry |   |
| AUD-04 | 0 | integration | pass | ✓ append-only log AUD-04 no route can edit or delete audit entries and the data layer only appends |   |
| WEB-01 | 0 | static | pass | ✓ static export WEB-01 next.config exports static files with unoptimized images<br>✓ static export WEB-01 no route handlers, middleware or server actions exist |   |
| WEB-02 | 0 | static | pass | ✓ static export WEB-02 no dynamic path segments; IDs travel in search params |   |
| WEB-03 | 0 | e2e | pass | ✓ AUTH-03 WEB-03 an unlisted account that opens /student/ is sent back to sign-in [desktop]<br>✓ AUTH-03 WEB-03 an unlisted account that opens /admin/ is sent back to sign-in [desktop]<br>✓ AUTH-03 WEB-03 an unlisted account that opens /platform/ is sent back to sign-in [desktop]<br>✓ WEB-03 a signed-in student who opens /admin/ is sent back to their own home [desktop]<br>✓ WEB-03 a signed-in student who opens /platform/ is sent back to their own home [desktop]<br>✓ WEB-03 a signed-in admin who opens /platform/ is sent back to their own home [desktop]<br>✓ WEB-03 a signed-in admin who opens /student/ is sent back to their own home [desktop]<br>✓ WEB-03 a signed-in super admin who opens /student/ is sent back to their own home [desktop]<br>✓ WEB-03 a signed-out visitor who opens /student/ is sent to the sign-in page [desktop]<br>✓ WEB-03 a signed-out visitor who opens /admin/ is sent to the sign-in page [desktop]<br>✓ WEB-03 a signed-out visitor who opens /platform/ is sent to the sign-in page [desktop] |   |
| WEB-04 | 0 | static | pass | ✓ security headers WEB-04 vercel.json sets CSP, Permissions-Policy for the camera, Referrer-Policy and HSTS<br>✓ security headers WEB-04 the CSP allows WebAssembly for MediaPipe but never eval, objects or framing |   |
| WEB-05 | 0 | static | pass | ✓ data fetching WEB-05 query keys are built only by the org-scoped key helper |   |
| DATA-08 | 0 | integration | pass | ✓ Firestore rules DATA-08 deny every client read and write, signed in or not |   |
| DATA-09 | 0 | integration | pass | ✓ Storage rules DATA-09 deny every client read and write |   |
| DATA-11 | 0 | infra | manual check (docs/MANUAL_CHECKS.md) |   |   |
| API-01 | 0 | integration | pass | ✓ error shape API-01 unknown routes, validation failures and domain errors share one shape<br>✓ error shape API-01 unexpected errors become INTERNAL without leaking the cause<br>✓ route access API-01 an empty settings change is a validation error, not a server error<br>✓ api skeleton API-01 unknown routes use the error shape |   |
| API-03 | 0 | integration | pass | ✓ server time API-03 every response, success or error, carries X-Server-Time from the clock<br>✓ server time API-03 browsers on the app origin may read X-Server-Time<br>✓ api skeleton API-03 GET /health answers with X-Server-Time from the injected clock |   |
| API-04 | 0 | integration | pass | ✓ claims drive the request context API-04 admins act in their claim org and super admins in the org named by X-Org-Id |   |
| SEC-01 | 0 | static | pass | ✓ repository hygiene SEC-01 no service account keys or private keys are committed |   |
| SEC-02 | 0 | infra | manual check (docs/MANUAL_CHECKS.md) |   |   |
| SEC-03 | 0 | infra | manual check (docs/MANUAL_CHECKS.md) |   |   |
| SEC-04 | 0 | integration | pass | ✓ schemas SEC-04 every route declares a response schema and every write route a body schema<br>✓ schemas SEC-04 fields missing from the response schema are stripped from output<br>✓ route access SEC-04 every /v1 route declares who may call it, and an undeclared one fails closed |   |
| SEC-05 | 0 | integration | pass | ✓ CORS SEC-05 allows the configured app origin and nothing else |   |
| SEC-07 | 0 | unit | pass | ✓ request logs OBS-01 attempt routes log the attempt ID and SEC-07 bodies with emails stay hashed<br>✓ log redaction SEC-07 emails and PRNs are hashed, answers and tokens dropped<br>✓ log redaction SEC-07 the same identifier always hashes to the same value<br>✓ log redaction SEC-07 authorization headers never reach the log |   |
| SEC-09 | 0 | static | pass | ✓ repository hygiene SEC-09 Renovate is configured and every dependency is pinned by version |   |
| PERF-02 | 0 | unit | pass | ✓ TtlCache PERF-02 serves a cached value for 60 seconds on the injected clock, then reloads<br>✓ TtlCache PERF-02 keeps keys apart, can be invalidated, and never caches a failure<br>✓ TtlCache failures PERF-02 a late failure does not evict a newer entry for the same key |   |
| REL-03 | 0 | integration | pass | ✓ graceful shutdown REL-03 SIGTERM stops new requests and lets in-flight ones finish<br>✓ graceful shutdown REL-03 gives up after the timeout when a request hangs |   |
| OBS-01 | 0 | integration | pass | ✓ request logs OBS-01 each request logs requestId, orgId, attemptId and route<br>✓ request logs OBS-01 attempt routes log the attempt ID and SEC-07 bodies with emails stay hashed |   |
| OBS-02 | 0 | infra | manual check (docs/MANUAL_CHECKS.md) |   |   |
| CI-01 | 0 | infra | manual check (docs/MANUAL_CHECKS.md) |   |   |
| CI-02 | 0 | static | pass | ✓ repository hygiene CI-02 CI runs lint, typecheck, unit, emulator integration and Playwright on pull requests |   |
| UI-01 | 0 | unit | pass | ✓ colour tokens UI-01 text colours reach 4.5:1 on sheet and surface in light, dropout 3:1<br>✓ colour tokens UI-01 text colours reach 4.5:1 on sheet and surface in dark, dropout 3:1<br>✓ colour tokens UI-01 ballpoint reaches about 7:1 in light mode |   |
| UI-02 | 0 | static | manual check (docs/MANUAL_CHECKS.md) |   |   |
| UI-03 | 0 | unit | pass | ✓ no decorative effects UI-03 no gradients, glass or blur in any stylesheet or component |   |
| UI-04 | 0 | static | manual check (docs/MANUAL_CHECKS.md) |   |   |
| UI-05 | 0 | unit | pass | ✓ scale tokens UI-05 body text measure is 72 characters |   |
| UI-06 | 0 | static | manual check (docs/MANUAL_CHECKS.md) |   |   |
| UI-07 | 0 | unit | pass | ✓ scale tokens UI-07 spacing scale and layout widths |   |
| UI-08 | 0 | unit | pass | ✓ scale tokens UI-08 corner radius follows hierarchy |   |
| UI-09 | 0 | unit | pass | ✓ scale tokens UI-09 one overlay shadow token and no other shadows |   |
| UI-10 | 0 | unit | pass | ✓ scale tokens UI-10 motion durations and easing |   |
| UI-11 | 0 | static | manual check (docs/MANUAL_CHECKS.md) |   |   |
| UI-12 | 0 | e2e | pass | ✓ UI-12 with reduced motion emulated every transition on the sign-in page computes to 0s [desktop]<br>✓ UI-12 the sign-in button transition is instant only while reduced motion is on [desktop]<br>✓ UI-12 with reduced motion emulated every transition on the student home computes to 0s [desktop]<br>✓ UI-12 with reduced motion emulated every transition on the admin home computes to 0s [desktop]<br>✓ UI-12 with reduced motion emulated every transition on the superAdmin home computes to 0s [desktop] |   |
| UI-13 | 0 | static | pass | ✓ colour tokens UI-13 light defines every colour token as a CSS variable<br>✓ colour tokens UI-13 dark defines every colour token as a CSS variable<br>✓ colour tokens UI-13 high contrast defines every colour token as a CSS variable<br>✓ colour tokens UI-13 the Tailwind theme exposes every colour token |   |
| UI-14 | 0 | static | pass | ✓ component catalogue UI-14 every component module has a Storybook story<br>✓ component catalogue UI-14 every story renders in light, dark and high contrast |   |
| UX-13 | 0 | static | manual check (docs/MANUAL_CHECKS.md) |   |   |
| UX-14 | 0 | static | manual check (docs/MANUAL_CHECKS.md) |   |   |
| A11Y-07 | 1 | e2e | pass | ✓ A11Y-07 every page has its own document title [desktop]<br>✓ A11Y-07 admin and platform homes are titled too [desktop] |   |
| A11Y-13 | 0 | unit | pass | ✓ colour tokens A11Y-13 light: text 4.5:1 and outlines 3:1<br>✓ colour tokens A11Y-13 dark: text 4.5:1 and outlines 3:1<br>✓ colour tokens A11Y-13 high contrast: text 4.5:1 and outlines 3:1<br>✓ colour tokens A11Y-13 high contrast is pure black text on white with 2 px borders |   |
| A11Y-21 | 0 | static | pass | ✓ accessibility tooling A11Y-21 the axe helper fails on serious and critical issues and CI runs the suite |   |
| A11Y-23 | 0 | static | pass | ✓ accessibility tooling A11Y-23 interface text must come from the translation layer |   |
| US-ST-01 | 0 | e2e | pass | ✓ AUTH-01 US-ST-01 a whitelisted student signs in through the Google popup and lands on the student home [desktop]<br>✓ AUTH-01 US-ST-01 a whitelisted student of org B signs in and lands on the student home [desktop]<br>✓ AUTH-03 US-ST-01 an unlisted Google account sees the contact message and stays on the sign-in page [desktop]<br>✓ AUTH-01 US-ST-01 signing in again with the same account after a failed attempt finishes sign-in [desktop] |   |

## Start the stack for manual checks

```bash
scripts/stack.sh start     # emulators, base seed, API :4000, worker :4001, web :3000 (built with tests/web.env)
scripts/stack.sh stop
```

Sign in at http://localhost:3000 with any seeded account from docs/TEST_ENV.md (the Auth emulator account chooser
opens in the sign-in popup). Reseed with `pnpm seed`. Playwright traces: `pnpm exec playwright show-trace <trace.zip>`.
