# Next-gen proctoring

Built 2026-10-23 from the owner's "Next-Gen Proctoring Innovations" plan. Decisions are in docs/DECISIONS.md
(2026-10-23); the test contract change it needs is in TEST_CHANGE_REQUESTS.md.

| Plan item | Built | Where |
| --- | --- | --- |
| Voice and whisper detection, on by default, admin switch | Yes. `audioProctoring` setting (series default and test override); tests published before it read as off | `packages/shared/src/settings.ts`, authoring Settings |
| On-device detection, no paid API | Yes. Voice band 85 Hz to 3.5 kHz and whisper band 2 to 5 kHz against an adaptive noise floor, 10 frames a second; tones, clicks and steady noise rejected | `apps/web/src/features/proctoring/voice-detector.ts` |
| 5-second proof clip | Yes. Recorded after talking has lasted 2.5 s, Opus or AAC, uploaded with the event's clip ID | `audio-watch.ts`, `useAudioWatch.ts`, `POST /v1/attempts/{id}/audio-proof` |
| Strike for talking | Changed: logged for review with the clip, never a strike | `voice_detected` |
| 14-day cleanup and storage console | Yes. One Cloud Task per clip; storage console shows and clears the audio category | `/tasks/audio-cleanup`, storage console |
| Dual monitor detection with hot-plug | Yes, with the lockdown on: `screen.isExtended` and the screen `change` event, one strike per incident, blocking dialog | `display-watch.ts`, `useDisplayWatch.ts` |
| HDMI splitter, mirrored display, screen-sharing apps | Not possible from a web page: they are invisible to the browser | — |
| Virtual capture devices | Yes, as a virtual camera strike (OBS, ManyCam, XSplit and similar on the camera label), warned in preflight | `isVirtualCamera` |
| Typing biometrics, paste injection | Changed: the exam has no text input. Scripted (untrusted) answers and keys are stopped; the first is one strike | `input-guard.ts` |
| Rules screen disclosure | Yes. "What this test monitors", listing only what the test turns on | `RulesScreen.tsx` |
| Timeline audio player and labels | Yes. Play recording on `voice_detected`, whisper marked, labels for every new event | `TimelineDrawer.tsx` |

## What each event does

| Event | Strike | When |
| --- | --- | --- |
| `dual_monitor` | Yes | A second screen extends the desktop (lockdown on); again after an unplug and replug |
| `virtual_camera` | Yes | The exam camera's label names a virtual camera (laptop camera on) |
| `automated_input` | Yes, once per exam session | A script sends keys or answers an option |
| `voice_detected` | No, review with the clip | Talking fills most of 2.5 s; at most one report a minute |
| `mic_unavailable` | No | The microphone is refused or stops (voice detection on); it is tried again every 30 s |

## Limits worth knowing

- Firefox and Safari do not expose `screen.isExtended`, so second screens are detected in Chrome and Edge only.
- Voice detection thresholds favour missing quiet speech over flagging silence; tune them from pilot recordings
  (`voice-detector.ts` constants).
- A refused microphone does not block the exam until the preflight Microphone row in TEST_CHANGE_REQUESTS.md is
  approved; it is reported as `mic_unavailable`.
