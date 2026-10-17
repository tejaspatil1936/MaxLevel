# Backlog

Non-blocking findings from reviews and QA. Blocking ones are fixed in the phase that finds them.

## Phase 0

- The AUTH-01 popup tests depend on the Auth emulator's iframe loading `https://apis.google.com/js/api.js`; a slow
  fetch through the network makes them flaky (seen twice in about ten runs). A self-hosted gapi is not possible with
  firebase-tools 15; revisit if CI shows the same.
- Bootstrap writes the custom claims and `userIndex/{uid}` separately; a failure between them leaves them disagreeing
  until the next sign-in repeats bootstrap.
- Admin landing tests other than one per role use the emulator credential helper rather than the popup (test review).
- `nonInstantMotion` in the phase 0 tests also requires animations to be 0 s under reduced motion: every later
  skeleton or spinner on the role homes must stop animating with reduced motion (tokens.css already forces it).
- The sign-in page is checked only at 1280 px in phase 0 tests; the 360 px check comes with UX-12 in phase 1.
- The phase 0 test seed fixture names role keys in titles ("superAdmin home").
