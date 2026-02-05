# Quality-First Browser Capture Guidelines

## Checklist
- Use the managed `openclaw` profile unless the user explicitly requests extension relay.
- Resize viewport close to the maximum long edge (`2000x1400` is a solid baseline).
- Apply a high-DPR device preset when clarity matters (Playwright 1.58.1 highest DPR is `Galaxy S9+`).
- Prefer `png` screenshots for sharp text and UI edges.
- Use element or ref screenshots for fine detail instead of full-page captures.
- Re-run `snapshot` after navigation or large DOM changes.

## Known Limits
- OpenClaw normalizes browser screenshots to a max side of `2000px` and max size of `5MB`.
- Oversized screenshots will be downscaled or recompressed; use large viewports and targeted element captures to keep detail.
- `fullPage` screenshots are often downscaled; use them only when you need the entire page.

## Recipes
1. Crisp page capture. Resize viewport to `2000x1400`, set device to `Galaxy S9+`, then use `browser screenshot` with `type="png"`.
2. Crisp element capture. Run `snapshot --interactive` to get a ref, then use `browser screenshot` with `ref=<ref>` and `type="png"`.
3. Clarity for actions. Run `snapshot --labels` and keep the labeled screenshot for visual verification.
