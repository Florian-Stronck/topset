# Topset server, coach accounts and athlete app

Topset has three parts:

- **The desktop app (Topset.exe)**: where each coach writes programs. It works on the `topset.db` on the coach's own computer, so everything is instant and it works offline.
- **The Topset server**: one website, run by the admin. It hosts:
  - the **athlete app**, where each athlete opens a personal link and gets **Today** (log every set), **History** (done so far and coming up) and **Tools** (plate and e1RM calculators);
  - **coach accounts**, which coaches' desktop apps sign in to, to sync their athletes.
- **The database** behind the server (Turso). Only the server holds its key.

Every coach only ever sees their own athletes. The server checks every read and every change against the signed-in coach. As the admin, you see who has an account, never their athletes.

Both services have free plans:

| What | Service | Free tier |
| --- | --- | --- |
| Database | [Turso](https://turso.tech) | Far more than a handful of coaches need |
| Server | [Vercel](https://vercel.com) | Hobby plan |

> Vercel's Hobby plan is meant for non-commercial use. If you charge for coaching, check Vercel's terms, or host the server anywhere that runs Node.js.

## 1. The database (Turso)

1. Sign up at turso.tech.
2. Create a database, for example `topset`, in the region closest to you.
3. From the database page, copy two values:
   - the **URL**, which looks like `libsql://topset-yourname.turso.io`
   - a **token** with read and write access

## 2. The server (Vercel)

1. Import this repository as a Vercel project.
2. Set these environment variables for **Production**:

   | Name | Value |
   | --- | --- |
   | `TOPSET_ROLE` | `athlete` |
   | `TURSO_DATABASE_URL` | the `libsql://…` URL |
   | `TURSO_AUTH_TOKEN` | the Turso token |
   | `TOPSET_ADMIN_SETUP_CODE` | a long random code; you use it to create the admin account, and it stays your way back in if you forget your password or username — keep it |

3. Deploy. The build (`npm run vercel-build`) brings the database up to date, then builds the site.
4. Note the address, for example `https://topset-yourname.vercel.app`. This is the **server address** that coaches sign in to.

The server only serves the athlete pages and the coach sign-in/sync API. Coach screens, exports and backups all answer *not found*.

## 3. The admin account (you, once)

1. In Topset.exe, go to **Settings → Account and athlete app** and click **New here? Create an account**.
2. Enter the server address, a username (letters, digits, dots, dashes or underscores), a password (at least 8 characters), your name, and the `TOPSET_ADMIN_SETUP_CODE` as the invite code.
3. Click **Create account**.

If the database already holds data from before accounts existed, the admin account takes it over. If that data is already on this computer, nothing changes; otherwise it comes down, and this computer's old copy is kept first in `topset-backups`. If the admin account has no data yet, this computer's athletes are uploaded to it.

The setup code only works while there is no admin, so it can't be used again after this.

## 4. Invite coaches

1. As the admin, go to **Settings → Account and athlete app → Coaches** and click **Invite a coach**. You can add a note saying who it's for.
2. Send the coach the code, the server address, and Topset.zip.
3. The coach opens Topset.exe, clicks **Create account** in the same Settings section, and enters the server address, a username of their choice, a password and the code.

Each code works once, for two weeks. The coach's athletes sync to their own account from then on.

Also under **Settings → Coaches**, the admin can:

- **Withdraw** an invite code nobody has used yet.
- **Reset password**: makes a one-time code for that coach, valid for 48 hours. They enter it with a new password under **Forgot password?** where they sign in. Every computer they were signed in on is signed out.
- **Turn off** a coach's account: they are signed out everywhere, can't sign in or sync, and their athletes' links stop working. Nothing is deleted, and **Turn back on** restores it all.
- **Delete** a coach's account: it and everything in it — athletes, programs, what they logged — is erased from the server, and the username is free to sign up again. It can't be undone. Another admin's account can't be deleted here.

**If you, the admin, forget your password or username:** in Topset.exe go to **Settings → Account and athlete app → Sign in → Forgot password?**. Enter the server address, the `TOPSET_ADMIN_SETUP_CODE` (look it up in Vercel → your project → Settings → Environment Variables) as the reset code, and a new password. Leave the username empty if you've forgotten it: Topset signs you in and shows which account it was. If the setup code is gone too, set a new one in Vercel and redeploy, then use that.

**Accounts made before usernames** signed in with an email. Their username is now the part before the @, lowercased (`Anna@gym.lu` → `anna`), and typing the old email still works. Two accounts that would share a name get the end of their id added (`anna-x7k2`); **Settings → Coaches** lists everyone's username.

Every coach can change their password, sign out their other computers, or delete their own account (with their password) under **Settings → Password and sign-in**. Deleting erases their data on the server; the copy on their computer stays. The server's only admin can't delete their own account.

## 5. Everyday use

- **Coaches** work in Topset.exe as usual. In the background, their changes go up every couple of seconds, and what their athletes logged comes down every few seconds, or straight away with **Refresh** in Tracking or Overview. Settings shows when it last synced. If the connection drops, changes wait on the computer and go up once it's back.
- **Athlete links**: on the **Athletes** page, a coach clicks **Athlete link → Create link** and shares the QR code or link. **New link** replaces an athlete's link and **Turn off** disables it; either way the old one stops working straight away.
- **Another computer**: sign in with the same username and password, and that coach's data comes down.
- **Sign out**: the data stays on the computer; it just stops syncing.

You own the plans and athletes own their logs, so the two never overwrite each other. If a coach corrects a logged weight in Tracking at the same moment the athlete changes it, the athlete's value wins.

Backups and **Restore** work on the local file. A coach's sign-in is kept in `topset-cloud.json` next to `topset.db`, never in the database or in a backup. Desktop apps never hold the Turso key.

## Updating

When a new version changes the database:

1. Redeploy the server first. Its build updates the database.
2. Then hand out the new Topset.zip. Coaches unzip it over their Topset folder; their data beside Topset.exe is kept.
