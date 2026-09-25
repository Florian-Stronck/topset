# Security

Topset holds athletes' training data, bodyweights and check-in notes, so security reports are taken seriously.

## Reporting a vulnerability

Please **don't open a public issue**. Report it privately through GitHub instead: the repository's **Security** tab → **Report a vulnerability**.

Include what an attacker could do, and the steps to reproduce it. You'll get an answer within a week.

## What's in scope

- The hosted server (`TOPSET_ROLE=athlete`): athlete links, the coach sign-in and sync API, and anything that lets one coach or athlete see or change another's data.
- The desktop app: anything that lets a program file, backup or synced data run code or read files it shouldn't.

The coach side of the desktop app has no login by design. It trusts whoever sits at the computer, so reaching it locally is not a vulnerability.
