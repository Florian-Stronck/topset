# Contributing to Topset

Thanks for helping. Bug reports, translations and pull requests are all welcome.

## Getting set up

```bash
npm install
npm run db:reset   # creates dev.db and loads the demo coach and athletes
npm run dev        # http://localhost:3000
```

The README's **For developers** section explains the layout of the code. Read [AGENTS.md](AGENTS.md) before touching framework-level code: this is a newer Next.js than most guides describe.

## Before you open a pull request

```bash
npm run lint
npx tsc --noEmit
npm test
```

CI runs the same three on every pull request.

- **Schema changes** need a new plain-SQL migration in `prisma/migrations/`. Never edit a migration that has already been merged: desktop apps and the server have already applied it.
- **Text the user sees** goes through `t()` with the English text as the key. Add the German, French and Luxembourgish entries in `src/lib/i18n/` if you can. If you can't, leave them out and say so in the pull request.
- **Coach-only server actions and routes** start with `assertCoach()`. The hosted server runs the same code with `TOPSET_ROLE=athlete` and must never expose coach data.
- Keep pull requests to one change, and describe what a coach or athlete will notice.

## Reporting bugs

Open an issue with what you did, what you expected, and what happened. Include the Topset version and whether it was the desktop app or the athlete page. Never attach a real `topset.db` or backup: they hold your athletes' data.

Security problems go through [SECURITY.md](SECURITY.md), not public issues.

## License

By contributing you agree that your work is licensed under the [AGPL-3.0-or-later](LICENSE), the same as the rest of Topset.
