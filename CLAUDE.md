# pairplay

## Rules

- Test-driven development: write failing test first (`hooks/*.test.ts(x)`), see it fail, then implement, see it pass.
- End of each feature: give concise UAT steps for user to run in two test terminals (player 1 / player 2 actions + expected result).

## Dev loop

- User tests in two terminals: `USER=alice|bob claude --plugin-dir ~/git/pairplay` (hot-reloads on save; installed `pairplay@pairplay` disabled).
- Before handing off: `claude plugin validate .`, `claude plugin test .`, `tsc -p .`.
