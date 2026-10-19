# Exam-day runbook

What the on-duty team does on a day with a scheduled exam slot (REL-07). It covers pre-warming, monitoring, the
extra-time policy for outages, who to call, and how timing relates to accessibility. Times are IST. Keep this file
next to the live view (`/admin/live/`) on exam day.

Before the day:

- The k6 scenario `tests/load/exam-500.js` passed against staging since the last change to the exam path (PERF-07,
  docs/MANUAL_CHECKS.md).
- No deploy is planned during the slot. The production deploy job stops while a test is live (REL-01); override it
  only for a fix the exam needs.
- The tests of the day are published (status `scheduled`), with the right date, window and eligibility.

## Pre-warming

The API's Cloud Run minimum instances are raised 30 minutes before each slot (PERF-06, spec 9.6), so the start burst
(500 starts in 2 minutes) never waits for cold instances.

- How it is queued: **Publish test** queues one Cloud Tasks task per slot, named
  `prewarm-<orgId>-<testId>-<windowStart>`, at the window start minus 30 minutes (or at once when the test is
  published later than that). A test moved to another date goes back to review; publishing it again queues a task for
  the new slot, and the old task does nothing when it runs.
- What it does: the worker's `/tasks/prewarm` handler sets the API minimum instances to one per 100 eligible students,
  at least the usual 2 and at most the maximum of 20, until the window end. A second run of the same task changes
  nothing (REL-04).
- How to check it happened, 25 minutes before the slot:
  1. Cloud Tasks queue: the `prewarm-…` task for the slot has run with a 2xx response.
  2. Worker logs: an entry `task done` with `task: "prewarm"` and `outcome: "raised"` for the test.
  3. Cloud Run, service `api`: the current revision shows the raised minimum instances, and the instance count on
     the exam-day dashboard has risen.
- If it did not happen: raise the API minimum instances by hand in Cloud Run (same number as above), note the time
  and the reason in the incident notes, and tell the platform owner. After the slot, set it back to 2.

## Monitoring

Watch the **Exam day** Cloud Monitoring dashboard (OBS-05) from 30 minutes before the slot until every attempt is
finished. It shows active attempts, requests per second, latency, errors, instances and Firestore errors. Keep the
live view (`/admin/live/?test=<testId>`) open beside it for the students themselves.

The alerts (OBS-04) page the platform on-call:

| Alert | Fires when | First response |
| --- | --- | --- |
| API 5xx rate | 5xx responses above 1% of requests for 5 minutes | Check the dashboard's errors and the API logs by route; if a new revision caused it, shift traffic back to the previous revision (REL-02, takes seconds). |
| Answer-save p95 | `PUT /v1/attempts/{id}/answers` p95 latency above 300 ms | Check instances and Firestore errors; raise minimum instances if they are at the floor. Answers are queued on the student's device and sync when the API recovers. |
| Failed auto-submit | any `/tasks/auto-submit` task fails | Look up the attempt in the worker logs; the task retries on its own. If it keeps failing, the attempt can be finished by the student's own submit or by **Terminate attempt** with a reason. |
| Worker failures | repeated failures of any worker task (release results, leaderboard, export, pre-warm) | Check the worker logs and the Cloud Tasks queue; tasks are idempotent and safe to retry (REL-04). Exams are not affected by leaderboard or export delays. |

Other signs to watch in the live view: many students `Offline for more than 60 s` at once (a network problem at the
venue, not ours), or phone strikes paused because Realtime Database is unreachable (REL-05: exams continue and no
student is penalized).

## Extra-time policy for outages

Grant extra time when students lost exam time for a reason that was not theirs to control:

- an outage on our side (the alerts above, an API or Firestore incident, a failed deploy), or
- a venue problem the placement cell confirms (power, network, a lab machine failing).

Do not grant extra time for a student's own late arrival, or for time lost to strikes the rules counted.

How to grant it:

1. In the live view, open the student's row menu and choose **Grant extra time** (OPS-06). Grant the minutes lost,
   rounded up to whole minutes; for an outage that hit everyone, grant each affected student the same minutes.
2. Every grant needs a reason (OPS-09). Write what happened and when, for example
   `API outage 10:12 to 10:19 IST, 7 minutes lost`. The grant is audit-logged with the reason and the minutes.
3. A grant longer than the test's duration asks for a second confirmation (OPS-08); check the number before you
   confirm it.
4. The student's timer moves within 5 seconds and they see `Your time was extended by <n> minutes.` The auto-submit
   task follows the new deadline, which may pass the window end.

For an attempt ended by mistake, **Reinstate attempt** (with a reason) lets the student continue with their saved
answers. **Reset attempt** (with a reason) is for a student who must start again; the old attempt is kept for the
record. After the slot, write the incident notes: what happened, which students, the minutes granted.

## Contacts

Call in this order, by role. The names and numbers for each role are kept in the organization's exam-day contact
sheet, which the placement cell updates before each exam season; this file names roles only.

| Role | Call for | When |
| --- | --- | --- |
| Placement cell exam coordinator (the org admin on duty) | students who can't sign in, venue problems, extra-time decisions, terminations | first, for anything at the venue |
| Lab or IT staff at the venue | power, network, lab machines, cameras | venue hardware problems |
| Platform on-call engineer | alerts, errors, slow saves, pre-warming that did not run, failed tasks | any alert, or anything the dashboard shows |
| Platform owner (super admin) | an outage longer than 10 minutes, a rollback, a deploy-freeze override, a decision to move the slot | escalation from the on-call engineer |
| Google Cloud support (through the console) | a Google Cloud or Firebase incident confirmed on the status page | only when the platform owner asks |

## Timing and accessibility

Timed exams fall under WCAG's exception for real-time events (WCAG 2.2, success criterion 2.2.1 Timing Adjustable):
the time limit is an essential part of a timed, proctored test, so students cannot turn off or extend the timer
themselves (A11Y-18).

Adjustable time is still provided in two ways:

- **Extra time grants** during an attempt, by an admin with a reason (OPS-06), as above.
- **Standing accommodations**: a student's accommodation for a series (a percentage of the duration or a number of
  extra minutes) is added to every attempt of that series when it starts, also past the window end (OPS-07,
  A11Y-17). Check before the day that every student with an approved accommodation has it recorded in their student
  drawer under `Accommodations`.

The public accessibility statement at `/accessibility/` (A11Y-22) repeats this note. Point students and staff who ask
about timing, extra time or an accommodation to it, and to their placement cell.
