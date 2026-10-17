# Camera fixtures

Chromium plays these as the webcam (`--use-file-for-fake-video-capture`, see playwright.config.ts).

| File | Content | Source |
| --- | --- | --- |
| `no-face.y4m` | A plain grey frame, 320 x 240, 5 frames, looped by Chromium | Generated: `ffmpeg -f lavfi -i "color=c=0x8a8f99:s=320x240:r=5" -t 1 -pix_fmt yuv420p no-face.y4m` |
| `one-face.y4m` | The owner's face looking at the screen, about 5 seconds | Owner (docs/OWNER_SETUP.md 3.1) |
| `two-faces.y4m` | Two faces in frame, about 5 seconds | Owner (docs/OWNER_SETUP.md 3.1) |

Convert a phone or webcam recording with:

```bash
ffmpeg -i in.mp4 -pix_fmt yuv420p -s 640x480 -r 15 out.y4m
```

Tests that need `one-face.y4m` or `two-faces.y4m` skip with a reason until the files exist (docs/MANUAL_CHECKS.md).
