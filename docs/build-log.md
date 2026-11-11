# Build log

Where the build stands. Updated at every commit so a resumed session can
pick up from the first unfinished step.

| Step | What | State |
|---|---|---|
| 1 | Architecture note, CLAUDE.md | done |
| 2 | Schema, repos, PGlite tests | done |
| 3 | LiteAPI adapter on recorded fixtures | done |
| 4 | Stay finder, 20 personas | done |
| 5 | Store: actions, reducers, dispatch | next |
| 6 | Jev module and router | |
| 7 | Turn route, Haiku loop, staging, reconcile | |
| 8 | Form-in-chat onboarding, intent scan | |
| 9 | UI: chat, results panel, detail | |
| 10 | Guards, e2e through real OTP | |
| 11 | Cost measurement | |

Milestone Sam asked for: **running locally so he can test.** Not reached.

## Notes for whoever resumes

- Run tests with `./node_modules/.bin/vitest run` and `./node_modules/.bin/tsc --noEmit`.
- `.env` holds `LITE_API_KEY` (sandbox) and `JEV_API_KEY`. No
  `ANTHROPIC_API_KEY` and no `DATABASE_URL` yet.
- node_modules on the shared folder were installed from the Linux build VM.
  On the Mac, `npm install` must run before `npm run dev`.
- A live call to api.typesafe.ai with the Jev key was blocked twice by the
  session's tool-permission layer on 2026-11-11.
