# OpenClaw Browser Usage (Tool + CLI)

## Agent Tool Actions
All browser tool calls accept `target`, `node`, `profile`, and `targetId` when relevant.

Actions:
- `status`: browser service status.
- `start`: launch or attach to the browser.
- `stop`: stop the browser service.
- `profiles`: list configured browser profiles.
- `tabs`: list tabs for a profile.
- `open`: open a tab (`targetUrl`).
- `focus`: focus a tab (`targetId`).
- `close`: close a tab (`targetId`).
- `snapshot`: capture UI snapshot (`snapshotFormat`, `mode`, `refs`, `interactive`, `compact`, `depth`, `selector`, `frame`, `labels`, `limit`, `maxChars`).
- `screenshot`: capture pixels (`fullPage`, `ref`, `element`, `type`).
- `navigate`: navigate a tab (`targetUrl`, `targetId`).
- `console`: read console messages (`level`, `targetId`).
- `pdf`: save a PDF (`targetId`).
- `upload`: arm file chooser or set file inputs (`paths`, `ref`, `inputRef`, `element`, `targetId`, `timeoutMs`).
- `dialog`: arm JS dialog handling (`accept`, `promptText`).
- `act`: perform a UI action (`request`).

## browser.act Kinds (request payload)
- `click`: `ref`, `doubleClick`, `button`, `modifiers`.
- `type`: `ref`, `text`, `submit`, `slowly`.
- `press`: `key`.
- `hover`: `ref`.
- `drag`: `startRef`, `endRef`.
- `select`: `ref`, `values`.
- `fill`: `fields` array with `{ ref, type, value }`.
- `resize`: `width`, `height`.
- `wait`: `timeMs`, `text`, `textGone`, `selector`, `url`, `loadState`, `fn`, `timeoutMs`.
- `evaluate`: `ref` plus `fn` (JS), when enabled.
- `close`: close current tab (`targetId`).

## Snapshot Options
- `snapshotFormat`: `ai` (default, numeric refs) or `aria` (accessibility tree, no refs).
- `mode`: `efficient` for smaller, faster role snapshots.
- `refs`: `role` or `aria` for ref resolution.
- `interactive`: role snapshot of interactive elements only.
- `compact`: compact role snapshot.
- `depth`: max depth for role snapshot.
- `selector`: scope role snapshot to CSS selector.
- `frame`: scope role snapshot to iframe selector.
- `labels`: adds a labeled screenshot overlay.
- `limit`: max nodes (aria snapshot).
- `maxChars`: max characters for AI snapshot.

## Screenshot Options
- `fullPage`: capture full scrollable page.
- `ref`: capture the element referenced by a snapshot ref.
- `element`: capture a CSS selector.
- `type`: `png` or `jpeg` (prefer `png` for quality).

Note: `fullPage` is not supported with `ref` or `element` screenshots.

## Targets And Profiles
- `target`: `sandbox`, `host`, or `node`.
- `profile`: `openclaw` (managed), `chrome` (extension relay), or custom profiles.

## CLI Quick Reference
All commands accept `--browser-profile <name>` and `--json`.

Basics:
- `openclaw browser status`
- `openclaw browser start`
- `openclaw browser stop`
- `openclaw browser tabs`
- `openclaw browser tab`
- `openclaw browser tab new`
- `openclaw browser tab select 2`
- `openclaw browser tab close 2`
- `openclaw browser open https://example.com`
- `openclaw browser focus abcd1234`
- `openclaw browser close abcd1234`

Inspection:
- `openclaw browser screenshot`
- `openclaw browser screenshot --full-page`
- `openclaw browser screenshot --ref 12`
- `openclaw browser snapshot`
- `openclaw browser snapshot --format aria --limit 200`
- `openclaw browser snapshot --interactive --compact --depth 6`
- `openclaw browser snapshot --efficient`
- `openclaw browser snapshot --labels`
- `openclaw browser snapshot --selector "#main" --interactive`
- `openclaw browser snapshot --frame "iframe#main" --interactive`
- `openclaw browser console --level error`
- `openclaw browser errors --clear`
- `openclaw browser requests --filter api --clear`
- `openclaw browser pdf`
- `openclaw browser responsebody "**/api" --max-chars 5000`

Actions:
- `openclaw browser navigate https://example.com`
- `openclaw browser resize 1280 720`
- `openclaw browser click 12 --double`
- `openclaw browser type 23 "hello" --submit`
- `openclaw browser press Enter`
- `openclaw browser hover 44`
- `openclaw browser scrollintoview e12`
- `openclaw browser drag 10 11`
- `openclaw browser select 9 OptionA OptionB`
- `openclaw browser download e12 /tmp/report.pdf`
- `openclaw browser waitfordownload /tmp/report.pdf`
- `openclaw browser upload /tmp/file.pdf`
- `openclaw browser fill --fields '[{"ref":"1","type":"text","value":"Ada"}]'`
- `openclaw browser dialog --accept`
- `openclaw browser wait --text "Done"`
- `openclaw browser wait "#main" --url "**/dash" --load networkidle --fn "window.ready===true"`
- `openclaw browser evaluate --fn '(el) => el.textContent' --ref 7`
- `openclaw browser highlight e12`
- `openclaw browser trace start`
- `openclaw browser trace stop`

State:
- `openclaw browser cookies`
- `openclaw browser cookies set session abc123 --url "https://example.com"`
- `openclaw browser cookies clear`
- `openclaw browser storage local get`
- `openclaw browser storage local set theme dark`
- `openclaw browser storage session clear`
- `openclaw browser set offline on`
- `openclaw browser set headers --json '{"X-Debug":"1"}'`
- `openclaw browser set credentials user pass`
- `openclaw browser set credentials --clear`
- `openclaw browser set geo 37.7749 -122.4194 --origin "https://example.com"`
- `openclaw browser set geo --clear`
- `openclaw browser set media dark`
- `openclaw browser set timezone America/New_York`
- `openclaw browser set locale en-US`
- `openclaw browser set device "iPhone 14"`
- `openclaw browser set viewport 1280 720`
