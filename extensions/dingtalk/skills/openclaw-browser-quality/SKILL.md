---
name: openclaw-browser-quality
description: Quality-first OpenClaw browser automation and screenshot capture. Use when a task involves the OpenClaw `browser` tool or CLI browser commands, especially when visual fidelity, clear screenshots, stable refs, or reliable tab control matters (snapshots, screenshots, navigation, actions, debugging).
---

# OpenClaw Browser Quality

## Overview
Prioritize visual fidelity and reliable UI control when driving OpenClaw browser tooling.

## Quality-First Workflow
1. Select the correct browser surface. Prefer `profile="openclaw"` for the isolated managed browser and use `profile="chrome"` only when the user explicitly wants extension relay control of their real tabs. If the session is sandboxed and host control is required, set `target="host"` and ensure sandbox host control is allowed.
2. Ensure the browser is running. Call `browser status`, then `browser start` if it is not running; open or focus a tab and keep the `targetId` stable across steps.
3. Set a quality baseline. Resize the viewport close to the maximum long edge (for example `2000x1400`) and apply a high-DPR device when needed (Playwright 1.58.1 highest DPR is `Galaxy S9+`). Avoid `snapshot` efficient mode unless the user asks for speed over detail.
4. Generate stable refs. Use `snapshot` with `snapshotFormat="ai"` (default) for numeric refs, and set `interactive=true` when you need actionable elements. Add `labels=true` when you need a labeled screenshot for clarity.
5. Execute actions carefully. Use `browser act` with refs; re-run `snapshot` after navigation or major DOM changes; use `wait` with `networkidle`, URL, or text predicates to stabilize before capture.
6. Capture final screenshots. Prefer `type="png"`; use `fullPage=true` only when required; use `ref` or `element` screenshots for crisp detail.
7. Debug quality or reliability. Use `console`, `errors`, `requests`, `trace`, and `highlight` when elements are ambiguous or screenshots look wrong.

## Quality Knobs
- Maximize viewport size up to the 2000px long-edge limit to avoid downscaling.
- Choose a high-DPR device (`Galaxy S9+`) to sharpen text.
- Prefer PNG output to avoid JPEG artifacts.
- Use element or ref screenshots for fine detail instead of full-page shots.

## Limits And Tradeoffs
- Screenshots are normalized to max side `2000` and max size `5MB`. Pushing beyond this will downscale or recompress; compensate with large viewports and element captures.
- Refs are not stable across navigation; always re-run `snapshot` after page changes.

## References
- Read `references/browser-usage.md` for the full browser tool and CLI usage map.
- Read `references/quality-guidelines.md` for detailed quality-first recipes and limits.
