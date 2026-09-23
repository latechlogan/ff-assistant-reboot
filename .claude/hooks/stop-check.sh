#!/usr/bin/env bash
# Stop hook: block finishing (exit 2) when `pnpm check` fails — but only once.
#
# If the check still fails on the retry that block forced (`stop_hook_active` in the
# hook's stdin JSON), exit 1 instead: the failure is still shown, but Claude may stop.
# Without this, a check Claude cannot fix without a human decision — tests written
# first and red until Logan approves the implementation — loops until the hook is
# killed. That happened on 2026-09-22 (ticket 007).
#
# stdout goes to stderr because pnpm prints failures on stdout, and hook feedback only
# surfaces stderr.
[ -f package.json ] || exit 0
retry=$(jq -r '.stop_hook_active // false')
pnpm check 1>&2 && exit 0
[ "$retry" = true ] && exit 1
exit 2
