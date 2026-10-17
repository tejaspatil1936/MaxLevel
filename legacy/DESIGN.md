---
name: MITAOE Prep
description: Institutional placement examination platform with clear, calm academic ergonomics, single navy accent, and strict zero-trust proctoring integrity.
colors:
  paper: "#F9FAFB" 
  surface: "#FFFFFF"
  ink: "#111827"
  ink-muted: "#4B5563"
  line: "#E5E7EB"
  pen: "#1E3A8A"
  red: "#DC2626"
  green: "#16A34A"
typography:
  fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
  weights: [400, 600]
  timer: "font-mono tabular-nums"
rounded:
  default: "8px"
spacing:
  scale: [4, 8, 12, 16, 24, 32]
---

## Design System & Principles

MITAOE Prep is designed for institutional clarity, focus, and calm. During high-stakes assessments, students need an interface that is completely free of distraction, artificial urgency, and generic template clutter.

### 1. Typography & Hierarchy
- **Font**: Google Inter (or system sans-serif). Sentence case everywhere. No ALL-CAPS labels or artificial letter-spacing (`tracking-*`).
- **Weights**: 400 (regular body and descriptions) and 600 (headings and emphasized labels) only.
- **Scale**: Maximum of three font sizes per screen to preserve clean visual hierarchy.
- **Monospace Restriction**: Monospace (`font-mono tabular-nums`) is used **strictly and exclusively** for countdown timer digits to prevent layout jitter, and for raw code/JSON input textareas. All PRNs, scores, timestamps, and badges use clean sans-serif.

### 2. Color Palette
- **Paper (`#F9FAFB` / `gray-50`)**: Clean, neutral, glare-free background.
- **Surface (`#FFFFFF`)**: Pure white cards and test surfaces.
- **Ink (`#111827` / `gray-900`)**: Deep charcoal for headlines, labels, and primary text.
- **Ink Muted (`#4B5563` / `gray-600`)**: Calm neutral gray for secondary copy, hints, and structural notes (fully WCAG AA compliant).
- **Line (`#E5E7EB` / `gray-200`)**: Crisp 1px structural hairline borders defining cards and sections without noisy drop shadows.
- **Pen (`#1E3A8A` / Oxford Navy)**: The single primary accent color used for primary actions, selected answer states, and primary navigational links.
- **Red (`#DC2626`)**: Reserved strictly for genuine hardware/permission errors, destructive actions (e.g. reset attempt), and the final exhausted strike (3 of 3).
- **Green (`#16A34A`)**: Reserved strictly for confirmed success states and correct answer reviews.
- **No Amber/Orange/Beige**: Warning states use neutral gray info bars and calm descriptive text rather than harsh amber alert boxes.

### 3. Geometry & Spacing
- **Corner Radius**: Standardized 8px (`rounded-lg`) across all buttons, cards, inputs, notices, and modals.
- **Borders**: 1px solid `var(--color-line)`.
- **Shadows**: Subtle or none (`shadow-xs` / `shadow-sm`), relying primarily on crisp hairline borders.
- **Spacing Scale**: 4px, 8px, 12px, 16px, 24px, 32px.

### 4. Shared Core Primitives
- `<Card>`: Surface white, 8px radius, 1px border.
- `<Button>`: Primary (pen navy), Secondary (neutral border), Text/Ghost (clean link style).
- `<Notice>`: Plain neutral info bar with `aria-live="polite"` and subtle icon or text.
- `<Badge>`: Plain small text with subtle colored dot indicator, without thick pill borders.

### 5. Tone & Copy
- Friendly, clear, plain English for students.
- Short sentences, zero robotic jargon (no "proctoring engine", "integrity limits exceeded", or "breach detected").
- Proactive, calm guidance: e.g. "Your test was submitted automatically. You left the test window too many times. Everything you saved before that is recorded."
