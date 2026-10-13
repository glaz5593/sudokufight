# Moshe's TODO: live server, two test phones, first Google Play version

Written 2026-10-11, after stage 14. Every external fact (prices, limits, menu names, commands) was checked against the
official docs on that date; the links are in the "Sources" list at the end of each part. Consoles change their menus
from time to time: if a button has moved, use the console's own search box.

## How to use this list

1. Work top to bottom. Part A first, today: some accounts take days to verify, and nothing else waits on you meanwhile.
2. Each task has a checkbox (`- [ ] A1 ...`). Tick it in this file (or tell Claude "A1 done") when you see what "You're done when" describes.
3. Who does what: **you** do everything in web consoles, payments, phones and secrets. Where a step says **"say '...'"**, Claude can run it on this PC once you are logged in to `fly`/`eas`; Claude always asks before anything that creates or changes things on Fly, Neon, EAS or Google Play. "Then tell Claude" marks the hand-over points.
4. Secrets (database URLs, admin passwords, private keys) go only into a password manager, `fly secrets`, or EAS. **Never paste them into the chat, a commit, or any file in the repo.** Commands below that handle secrets are meant for your own PowerShell window, not Claude's. Everything that is *not* secret (the EAS project ID, server host names, this file) goes into git: Claude commits and pushes those changes to GitHub, and commits before each deploy or build, so what runs is always a known commit.
5. Commands are Windows PowerShell. A code block that needs a particular folder starts with its `cd`; blocks without one (`adb`, `fly ... -a <app>`) run in any folder. In PowerShell, `curl` is not real curl: always type `curl.exe`.

---

## Glossary (plain words) and what each costs

| Term | What it is | Cost (ballpark, Oct 2026) |
|---|---|---|
| **Firebase** | Google's backend kit. We use 3 parts: **Authentication** (email and password accounts, verification emails), **Crashlytics** (crash reports from phones), **Analytics** (usage events). | Spark plan: $0. Authentication is free up to 50K monthly active users. |
| **`google-services.json`** | A small config file that tells the Android app which Firebase project it belongs to. It holds identifiers, not passwords, but by this repo's rule it never goes into git: it sits in `apps/mobile/config/firebase/` (gitignored) and is uploaded to EAS as a "file variable". | $0 |
| **FCM / push notifications** | Firebase Cloud Messaging: how a server makes a phone show a notification. **Not in V1** (spec §25: push comes in V1.1). The server-side key for it (a "service account" JSON) is **not needed now**; see Part H. | $0 |
| **Expo / EAS** | Expo is the React Native framework the app uses. **EAS** (Expo Application Services) is Expo's cloud: it builds the app, stores the signing key, and can upload to the stores. | Free plan: $0. |
| **EAS Build** | Builds the APK/AAB on Expo's servers, so your nearly full drive C never runs Gradle. | Free plan: 15 Android + 15 iOS builds per month, low-priority queue (Expo warns of 90+ minute waits at peak times), 45-minute build limit. Starter: $19/month plus usage. |
| **EAS environment variables** | Settings stored on Expo's servers and handed to a build. Each one belongs to one or more **environments** (`development`, `preview`, `production`); each build profile in `apps/mobile/eas.json` names its environment. A **file** variable uploads a whole file (our `google-services.json`): during the build, the variable holds the path of that file. | $0 |
| **APK vs AAB** | **APK** = an installable file; you put it on a phone with ADB (our `preview` profile). **AAB** (Android App Bundle) = what Google Play wants; Play turns it into APKs per device (our `production` profile). You can't install an AAB directly. | $0 |
| **ADB** | Android Debug Bridge: the command-line tool that talks to a phone over USB or Wi-Fi (install apps, take screenshots, read logs). Already on this PC (`%LOCALAPPDATA%\Android\Sdk\platform-tools`, on PATH). | $0 |
| **Fly.io** | A hosting company that runs our game server (a Docker image) on a small machine in Frankfurt, with HTTPS at `https://<app>.fly.dev`. One "app" for staging, one for production. | No free tier. Trial: 2 machine-hours or 7 days, then a card is needed. A shared-cpu-1x 512 MB machine is $3.69/month in base regions, Frankfurt about 15% more (about $4.25). Staging + production: about $8.50/month, plus $0.02/GB of traffic in Europe. The shared IPv4 address is free; don't buy a dedicated IPv4 ($2/month), it isn't needed. |
| **Neon** | A company that hosts **Postgres** databases for us (managed: backups and upgrades are theirs). One Neon "project" for staging, one for production. | Free plan: $0, 100 CU-hours per project per month (a CU, "compute unit", is Neon's measure of how big the database machine is; CU-hours = size × hours running. That is about 400 hours of the smallest size, 0.25 CU; the database sleeps after 5 minutes without queries, so that is plenty for a beta), 1 GB storage per project, 6-hour restore window. If a project uses up its CU-hours, Neon suspends it until next month (the server then loses its database). Paid "Launch": pay as you go, $0.106 per CU-hour, $0.35 per GB-month, no minimum, restore window up to 7 days. |
| **Postgres** | The database (accounts, ratings, games, admin data). The server creates its tables by itself on every start (migrations). | (in Neon) |
| **Docker image** | A packaged copy of the server and everything it needs (`Dockerfile` at the repo root). Fly builds it on its own builders: no Docker on your PC. | $0 |
| **Secrets** | Settings that must stay private (the database URL; an admin session secret or password, if you set one). On Fly they are set with `fly secrets set` and are invisible afterwards (only names and digests are shown). We also keep a few public settings there (the Firebase project, the admin site's Google sign-in), so they stay out of the public repo. | $0 |
| **Staging vs production** | Two separate copies of the server, each with its own database. **Staging** = for us and our test APKs (the `preview` build). **Production** = for Play testers and real players (the `production` build). A bug on staging never touches real players' data. | (two Fly apps, two Neon projects) |
| **Play Console tracks** | Release channels on Google Play: **Internal testing** (up to 100 testers you name, almost no review), **Closed testing** (invited testers, reviewed; for new personal accounts, the 12-tester / 14-day requirement happens here), **Open testing** (anyone can join), **Production** (everyone). | (in the $25) |
| **Play App Signing / upload key** | Google keeps the real **app signing key** and signs what users download. We sign uploads with an **upload key** that EAS creates and keeps on its servers. Consequence: an APK you install with ADB and the app from Play have different signatures; switching between them requires uninstalling first. | $0 |
| **Google Play Console** | Google's developer account and website for publishing. | US$25 once. |
| **Sentry (optional)** | Error reports from the server (crashes, 500s), without personal data. | Developer plan: $0, 5k errors/month, 1 user. Team plan: $26/month. |
| **Own domain (optional)** | e.g. `api.yourdomain.com` instead of `sudoku-fight-prod.fly.dev`. | Roughly $10 to $20/year for a `.com` (not checked here: compare a few registrars, and look at the renewal price, not only the first year). |
| **Apple Developer Program** | Needed only for iOS (Part I, later). | US$99/year. |

---

## The plan at a glance

| When | Part | What | Your time | Waiting (no work from you) |
|---|---|---|---|---|
| Today | **A** | Open accounts: Google Play Console, Expo, Fly.io, Neon, (Sentry). Start collecting testers. | about 1.5 h | **Play identity verification: usually a few days, sometimes longer.** |
| Day 1 to 2 | **B** | Firebase project, email sign-in, Hebrew emails, the Android app and `google-services.json`; B6: Google sign-in for the admin site. | about 1 h, plus 10 min for B6 | none |
| Day 1 to 2 | **C** | 5 decisions that block these goals. | 30 to 60 min | the avatar-license search may take longer |
| Day 2 | **D1 to D7** | Staging server: Neon database, Fly app, secrets, deploy, ranked puzzles, checks. **Goal 1 done.** | about 1 h with Claude | Fly's first build: about 5 min |
| Day 2 to 3 | **E** | EAS: link the project, upload the Firebase file, build the APK, install on 2 phones with ADB, play. **Goal 2 done.** | 2 to 3 h | EAS free queue: from minutes up to 90+ min at peak, plus 10 to 30 min of build |
| After Play verifies you | **D8 to D12** | Production server (same steps, separate app and database). | about 1 h | |
| Same days | **F1 to F9** | Play: create the app, listing, graphics, forms, production AAB, Internal testing, demo accounts. **Goal 3 (a first version uploaded to Google Play) done at F7.** | about half a day | |
| 14 days | **F10, F11** | Closed testing with at least 12 testers opted in for 14 days in a row. | a few minutes a day | Closed-testing review: hours to a few days, then **14 days, no shortcut** |
| Then | **F12, F13** | Apply for production, then the first public release. | 30 min | Google's review: usually 7 days or less |
| Later | **G, H, I** | In-app purchases, push notifications, iOS. | | |

Earliest public Play release from today: about 3 to 4 weeks, almost all of it waiting.

---

## Part A. Accounts to open today (the long waits first)

### A1. Before you start: password manager, personal Google account, support mailbox

- [x] **A1** Password manager ready, personal Google account chosen, support mailbox created

**Why.** You are about to create about 10 passwords and secrets. The Google account you use for Play Console and Firebase becomes the owner of the app forever, and the support email is published on Google Play and on the legal pages.

**Steps**
1. Pick one password manager (Bitwarden is free; any is fine) and create entries as you go: Play Console, Expo, Fly.io, Neon, Sentry, "Admin password staging", "Admin password production", "Neon URL staging", "Neon URL production", "Demo account 1", "Demo account 2".
2. Use your **personal Google account** (not a work account) for Play Console and Firebase. Turn on 2-Step Verification for it: https://myaccount.google.com/security.
3. Create a dedicated, public-facing mailbox for the game, for example a new Gmail such as `sudokufight.support@gmail.com` (any free name), or `support@<your domain>` if you choose your own domain in C1. It is used for: the Play "Contact email" (public), `LEGAL_CONTACT_EMAIL` (shown on the privacy page), the IARC rating email, and tester feedback.

**You're done when** the password manager is open, and you can log in to the new mailbox.

**Pitfalls**
- Don't use your private or work email as the public contact: it is shown to every user (DECISIONS-PENDING 1.3).

### A2. Google Play Console developer account (start first: verification takes days)

- [x] **A2** Play Console account created, paid, identity verified, Android device verified

**Why.** Goal 3 needs it, and Google verifies your identity before you can create apps. With a **personal** account created after 13 Nov 2023, Google also requires a closed test with at least 12 testers for 14 days before production (Part F).

**Decide first: personal or organization** (DECISIONS-PENDING 1.4).
- **Personal:** fastest. Google shows your **legal name, your country and the developer email** on Google Play. **Once you monetize (in-app purchases, Part G), Google also shows your full address.** Needs the 12 testers x 14 days.
- **Organization:** needs a registered business with a **D-U-N-S number** (free, can take weeks), and a website. Google shows the business name, address, email and **phone**. No 12-tester rule.
- A personal account can be converted to an organization later (Developer account → About you → Change account type; needs D-U-N-S and a verified website; afterwards Google asks you to wait 72 hours before submitting new apps). Organization to personal is not possible.
- Recommendation (from DECISIONS-PENDING): personal, unless you already have a company with a D-U-N-S number. Think now about the public address once purchases arrive (Part G).

**Steps** (Google's order; the screens may group them differently)
1. Open https://play.google.com/console/signup and sign in with the Google account from A1.
2. Accept the **Developer Distribution Agreement**.
3. Pay the **US$25** one-time registration fee with a credit or debit card **in your legal name**.
4. Choose the account type: **Yourself** (personal) or **An organization or business**.
5. Fill in the developer name (shown under the app title on Google Play), the public developer email (the support mailbox from A1), your legal name and address, and a contact email. Answer the questions about your experience and plans honestly (say you plan in-app purchases later).
6. **Identity verification:** upload a government ID (Israeli ID card, passport or driver's license) when asked. The name must match the legal name you entered and the card's name.
7. Wait for the email that says your identity is verified (usually a few days).
8. Then **device verification** (new personal accounts): on Play Console **Home**, find the task **"Verify that you have access to an Android mobile device"** → **View details** → scan the QR code with one of your phones (a physical phone with Android 10 or newer, not rooted; emulators are not accepted) → install the **Play Console** app → sign in as the account owner → select your developer account → **Verify** and follow the screens.
9. Then **phone verification** (it unlocks only after identity and device verification): enter your phone number in international format (`+972...`), choose SMS or voice call, enter the 6-digit code → **Verify**.

**You're done when** Play Console Home shows no open verification tasks, and the **Create app** button works (don't create the app yet: that's F1).

**Pitfalls**
- Open **one** developer account only.
- Don't use a work Google account: the account owns the app permanently.

### A3. Expo account (for EAS Build)

- [x] **A3** Expo account created

**Why.** EAS builds the APK and the AAB in the cloud, and keeps the Android signing key.

**Steps**
1. https://expo.dev/signup. Choose a username (it appears in build links, `expo.dev/accounts/<username>/...`).
2. Account settings → enable two-factor authentication.
3. No plan to choose: the Free plan is the default. No card needed.

**You're done when** you can log in at https://expo.dev.

### A4. Fly.io account, with a card

- [x] **A4** Fly.io account created and a payment method added

**Why.** Fly runs the game server. There is no free tier: the trial ends after 2 machine-hours or 7 days, whichever comes first, and our server runs non-stop, so without a card it would stop within hours.

**Steps**
1. https://fly.io/app/sign-up (email, or "Sign up with GitHub").
2. In the dashboard: **Billing** → add a credit card. Adding a card lifts the trial limits; from then on you pay for usage (about $4.25/month per always-on 512 MB machine in Frankfurt; two apps, staging and production, about $8.50/month).
3. Don't create anything in the dashboard. Apps are created from the command line (D3), and never with `fly launch` (it overwrites our `fly.toml` and suggests 2 machines).

**You're done when** the dashboard shows your "personal" organization with a payment method.

### A5. Neon account

- [x] **A5** Neon account created

**Why.** Neon hosts the two Postgres databases (staging and production).

**Steps**
1. https://console.neon.tech/signup (GitHub, Google or email). No card needed for the Free plan.
2. If the sign-up wizard insists on creating a first project, do D2 right there (name `sudoku-fight-staging`, region **AWS Europe (Frankfurt)**).

**You're done when** you can log in to https://console.neon.tech.

### A6. (Optional) Sentry account

- [x] **A6** Sentry account created, or decided to skip for now

**Why.** Server error reports by email. The server runs fine without it (the log then says `Sentry off (no SENTRY_DSN)`); you can add it any time.

**Steps**
1. https://sentry.io/signup/ → Developer (free) plan. If asked where to store data, choose the EU.
2. The project itself is created in D8.

### A7. Start collecting 15 to 20 testers (for the 14-day closed test)

- [x] **A7** A list of at least 15 people who agreed to test

**Why.** Google needs **at least 12 testers opted in for 14 days in a row**. People who leave early don't count, so recruit 15 to 20. This is the slowest human part; start now.

**Steps**
1. Ask family, friends and colleagues. Each needs: **an Android phone** (iPhone users don't count for Google), a Google account (Gmail), and willingness to install from a link, keep the app installed and stay a tester for 14 days, and play a few ranked games a week.
2. Keep the list (name + the Gmail address they use on their phone) in a private note or a spreadsheet outside the repo. Don't commit tester emails.
3. Optional: a Google Group (https://groups.google.com → **Create group**, e.g. "Sudoku Fight testers") so people can join themselves and you add one address to Play instead of 20.

**You're done when** at least 15 people said yes and you have their Gmail addresses.

### Sources (Part A)
- Play Console sign-up, fee, account types, identity verification: https://support.google.com/googleplay/android-developer/answer/6112435
- Device verification steps (Android 10+, physical, not rooted): https://support.google.com/googleplay/android-developer/answer/14316361
- Phone verification after identity and device verification: https://support.google.com/googleplay/android-developer/answer/10841920
- 12 testers / 14 days (personal accounts created after 13 Nov 2023): https://support.google.com/googleplay/android-developer/answer/14151465
- What Google displays for personal vs organization accounts (full address when monetizing): https://support.google.com/googleplay/android-developer/answer/13628312
- Changing personal to organization: https://support.google.com/googleplay/android-developer/answer/16260648
- Expo pricing (15 + 15 builds, low-priority queue with 90+ minute peaks, 45-minute timeout, Starter $19): https://expo.dev/pricing
- Fly.io pricing (card required, $3.69 base, Frankfurt multiplier, shared IPv4 free) and trial: https://docs.fly.io/about/pricing and https://docs.fly.io/about/free-trial
- Neon plans (100 CU-hours and 1 GB per project, suspended when used up, 6-hour restore): https://neon.com/docs/introduction/plans
- Sentry pricing: https://sentry.io/pricing/

---

## Part B. Firebase

**About "the JSON file for notifications" you mentioned.** There are two different JSON files, and only one is needed now:

| File | What it is | Needed now? | Where it goes |
|---|---|---|---|
| `google-services.json` | The Android app's Firebase config (identifiers, not passwords). | **Yes**, for sign-in, verification emails, Crashlytics and Analytics. | `apps/mobile/config/firebase/` on this PC (gitignored), and an EAS file variable (E2). |
| `GoogleService-Info.plist` | The same for iOS. | No: iOS is later (Part I). | Same folder, `GOOGLE_SERVICE_INFO_PLIST` on EAS. |
| Service-account private key (JSON, "Generate new private key") | A **secret** key that lets a server act as your Firebase project, e.g. to send push notifications. | **No.** Push is V1.1 (spec §25). Our server checks sign-ins with Google's public keys and only needs the Project ID. | Later: EAS credentials or a Fly secret, **never** git or chat (Part H). |

"Giving the Firebase file to Claude" means saving it in the folder in B3. Don't paste it into the chat.

The full Hebrew guide is `docs/FIREBASE-SETUP.md`; the steps below follow it, Android only.

### B1. Create the Firebase project, with Google Analytics

- [x] **B1** Project "Sudoku Fight" exists, with Analytics; Project ID written down

**Why.** One project serves staging and production. Its Project ID goes into the server (`FIREBASE_PROJECT_ID`).

**Steps**
1. https://console.firebase.google.com, signed in with the personal Google account from A1.
2. **Create a project** (or "Get started with a Firebase project"). Name: `Sudoku Fight`.
3. Google Analytics: **on**. Create a new Analytics account named `Sudoku Fight`; Analytics location: Israel; accept the terms.
4. Turn off any optional extras the wizard offers (AI assistants etc.); they are not used.
5. **Create project**, wait.
6. Gear icon next to **Project Overview** → **Project settings** → **General** → copy the **Project ID** (e.g. `sudoku-fight-1a2b3`; Firebase often adds a suffix to the name). Write it in your password manager notes; it is not a secret.

**You're done when** you see the project dashboard and have the Project ID.

### B2. Email/password sign-in, and Hebrew emails

- [x] **B2** Email/Password enabled; verification and reset emails in Hebrew

**Steps**
1. Left menu: **Authentication** (it may sit under "Build" or "Security"; or type "Authentication" in the console's search box) → **Get started**.
2. **Sign-in method** tab → **Email/Password** → turn on the first switch (**Email/Password**). Leave **Email link (passwordless sign-in)** off → **Save**. Don't enable other providers here (B6 adds Google, for the admin site only).
3. **Settings** tab → **User actions**: keep **Email enumeration protection** on (the default).
4. **Templates** tab → at the bottom, **Template language** → **Hebrew**.
5. **Email address verification** → pencil icon: Sender name `סודוקו פייט`, Subject e.g. `אימות כתובת המייל שלך בסודוקו פייט`. If you edit the message, keep `%LINK%` in it. **Save**.
6. **Password reset** → pencil: same sender name, subject e.g. `איפוס הסיסמה שלך בסודוקו פייט` → **Save**.

**You're done when** Sign-in method shows Email/Password "Enabled", and both templates are Hebrew.

### B3. Add the Android app and save `google-services.json`

- [x] **B3** Android app registered; the file is in `apps/mobile/config/firebase/` and git ignores it

**Steps**
1. **Project Overview** → **Add app** → the Android icon.
2. **Android package name:** `com.mosheg.sudokufight` (exactly; it must equal `android.package` in `apps/mobile/app.json`).
3. **App nickname:** `Sudoku Fight Android`. **Debug signing certificate SHA-1:** leave empty (email/password sign-in doesn't need it).
4. **Register app** → **Download google-services.json**.
5. Skip the "add the SDK" screens (**Next**, **Next**, **Continue to console**): Expo's config plugins do that part.
6. Move the file into the repo and check that git ignores it:
   ```powershell
   cd C:\Users\mosheg\Documents\ReactNative\sudoku-fight
   New-Item -ItemType Directory -Force apps\mobile\config\firebase | Out-Null
   Move-Item "$env:USERPROFILE\Downloads\google-services.json" apps\mobile\config\firebase\google-services.json
   Select-String -Path apps\mobile\config\firebase\google-services.json -Pattern '"package_name"'
   git check-ignore -v apps/mobile/config/firebase/google-services.json
   git status --short
   ```
7. Keep a backup copy of the file in your password manager (as an attachment or a secure note): once uploaded to EAS as "secret" it can't be downloaded back.

**You're done when**
- `Select-String` prints a line with `"package_name": "com.mosheg.sudokufight"`.
- `git check-ignore -v` prints a line from `.gitignore` ending in `google-services.json`.
- `git status --short` does **not** list the file.

**Pitfalls**
- Wrong package name: Firebase can't rename it. Delete the Android app in Project settings and add it again.
- The browser saved it as `google-services (1).json`: rename it to exactly `google-services.json`.
- Never take this file (or anything else) from PureTrack or another project.

### B4. Crashlytics and Analytics settings

- [x] **B4** Crashlytics enabled; Google signals off; data retention 2 months; no Ads/AdMob link

**Steps**
1. Console search box → **Crashlytics** → choose the Android app → **Enable Crashlytics** if the button appears. It will "wait for data" until a release build reports; that's normal (preview and production builds report, Development Builds don't).
2. https://analytics.google.com → the Sudoku Fight property → **Admin** → **Data collection and modification** → **Data collection**: **Google signals** off. Then **Data retention**: 2 months → Save.
3. Do **not** link Firebase to Google Ads or AdMob (Project settings → Integrations): the privacy forms say there are no ads.

**You're done when** Crashlytics shows the Android app (waiting for data is fine) and the two Analytics settings are saved.

### B5. Hand over to Claude

- [x] **B5** Claude has the Project ID

**Then tell Claude:** "Firebase is ready. Project ID = `<your project id>`. The file is in `apps/mobile/config/firebase/`." (The Project ID is not a secret.) Claude uses it in D4/D11 and uploads the file to EAS in E2.

### B6. Google sign-in for the admin site (new, small)

- [ ] **B6** Google provider on; web app "Sudoku Fight Admin" added; both fly.dev domains authorized; Claude has the apiKey, the appId and your admin addresses

**Why.** On the real servers you sign in to the admin site (`/admin`) **with your Google account**, and only the accounts on a list kept on the server (`ADMIN_EMAILS`) get in. No admin password to generate or store. Full Hebrew guide: `docs/FIREBASE-SETUP.md` §9א.

**What it does to the app's accounts.** The admin's Google sign-in runs in the game's own Firebase project. So every Google account that completes Google's window on `/admin` becomes a user of that project (**Authentication → Users**, provider Google), even one the server then refuses. Firebase's default is one account per email address, and the app has no Google button, so:
- An address that signed in to `/admin` can't sign up in the app with email and password (`auth/email-already-in-use`). For app accounts (E7, F8), use other addresses: a Gmail `+` alias such as `you+sf1@gmail.com` is a different address for Firebase, and its mail reaches the same inbox.
- The other way round: an app account on that same address whose email is not verified yet can lose its password when that address signs in to `/admin` with Google (Firebase trusts Google for Gmail addresses).
- A stray user (say, someone who tried `/admin` with their own Google account) can be deleted under **Authentication → Users**. It counts as an active user for that month, nothing more.

**Steps** (Firebase console, project "Sudoku Fight")
1. **Authentication** → **Sign-in method** → **Add new provider** → **Google** → **Enable** → **Project support email**: pick your email → **Save**.
2. Gear icon → **Project settings** → **General** → **Your apps** → **Add app** → the Web icon (`</>`). **App nickname:** `Sudoku Fight Admin`. Do **not** tick "Also set up Firebase Hosting". **Register app**.
3. From the `firebaseConfig` it shows, copy **`apiKey`** (starts with `AIza`) and **`appId`** (`1:<number>:web:<letters and digits>`). Then **Continue to console** (no SDK to install).
4. **Authentication** → **Settings** → **Authorized domains** → **Add domain**: `sudoku-fight-staging.fly.dev`, then again for `sudoku-fight-prod.fly.dev` (`localhost` is already there).

**You're done when** Sign-in method shows Google "Enabled", the web app appears under Your apps, and Authorized domains lists both fly.dev names.

**Then tell Claude:** the `apiKey`, the `appId`, and the Google addresses that may enter the admin site (yours, up to 3). They are not secrets (the admin page receives the apiKey and appId anyway), so the chat is fine; Claude sets them as Fly secrets in D4/D11 and **never writes them into the repo**. Write each address exactly as Google shows it.

### Sources (Part B)
- Firebase pricing (Spark, 50K MAU): https://firebase.google.com/pricing
- File variables in EAS (`GOOGLE_SERVICES_JSON` holds a path during the build): https://docs.expo.dev/eas/environment-variables/faq/
- FCM service-account key (later only): https://docs.expo.dev/push-notifications/fcm-credentials/
- Google sign-in on the web with Firebase (B6; provider, web app, authorized domains): https://firebase.google.com/docs/auth/web/google-signin

---

## Part C. Decisions needed before the first public build

Only the ones that block these three goals. Everything else in `docs/DECISIONS-PENDING.md` is built with a sensible default and can wait. Answer by editing the item in `docs/DECISIONS-PENDING.md` (☐ → ✓, or write your choice), or just tell Claude "C1: fly.dev" and so on.

| # | Decision | Blocks | Details |
|---|---|---|---|
| **C1** | **Server address:** your own domain (`api.<domain>`) or stay on `sudoku-fight-prod.fly.dev`. The address is compiled into the app; changing it later needs a new version in the stores. | The first **production** build (F6). Not the APK test (that uses staging). | DECISIONS-PENDING 1.6, DEPLOY-PRODUCTION §11. If you choose a domain: buy it at any registrar, then D10 step 4. |
| **C2** | **Legal contact email and operator name** (`LEGAL_CONTACT_EMAIL`, `LEGAL_OPERATOR_NAME`) shown on the privacy, terms and delete-account pages. Use the support mailbox from A1; the name should match the Play developer account (personal: your legal name). | Production server without the "draft" banner (D11), and every Play form that needs the privacy URL (F5). | DECISIONS-PENDING 1.3. |
| **C3** | **Avatars license.** The 50 avatars came from an unknown "freebie" pack. Find the source and license (30 min: old downloads and emails from 2022, Google Lens on one avatar), or let Claude replace them with a CC0 set. Same 5 minutes for the 690 "fast" puzzles (Kaggle "1 million Sudoku games" license page). | Uploading to **Closed testing** (F10), which Google reviews and which real people install. Internal testing (F7) is OK meanwhile. **Settle it before the store screenshots (F4)**: they show avatars, and replaced avatars mean new screenshots. | DECISIONS-PENDING 1.1 and 1.8, `docs/store/ASSET-LICENSES.md` §1 and §4. |
| **C4** | **"Report a player" and "Block".** Google Play's user-generated-content policy asks for in-app reporting and blocking where users see each other's content (here: display names). Options A/B/C in the proposal; recommended A (about 2.5 days of Claude's work). | Realistically the **Closed testing** review (F10) and the store review. Not the APK test. | DECISIONS-PENDING 1.2, `docs/store/UGC-PROPOSAL.md`. |
| **C5** | **Store name:** `Sudoku Fight: Live PvP Sudoku` (better in Play search, 29 of 30 characters) or plain `Sudoku Fight`. The launcher label under the icon stays `Sudoku Fight`. | F1 (you can rename later in the listing). | DECISIONS-PENDING 1.5, `docs/store/LISTING-GOOGLE.md` §1. |

**Quick yes/no that saves a rebuild (optional, before E3):**
- DECISIONS-PENDING 2.13: add `expo-network` (a native module) so "no internet" and "server not answering" are told apart. If yes, it should go in before the first EAS build; adding it later costs another build.
- DECISIONS-PENDING 2.8: "Play with a friend by code" in V1. Not required, but it makes the closed test easier (testers can meet without waiting in the ranked queue).
- DECISIONS-PENDING 1.7: production database on Neon (the recommendation, and what this list assumes) or Fly Postgres. With Fly Postgres, D9 and the puzzle loading in D12 change (`fly proxy` instead of a direct connection, `docs/DEPLOY-PRODUCTION.md` §2 and §7), and Claude must remove Neon from the privacy policy first.

- [x] **C1** server address decided
- [x] **C2** legal email and operator name decided
- [x] **C3** avatars (and 690 puzzles) license settled
- [x] **C4** report/block decided
- [x] **C5** store name decided

**Decided 2026-10-12:**
- **C1:** stay on `sudoku-fight-prod.fly.dev` (already in `apps/mobile/eas.json`).
- **C2:** `LEGAL_CONTACT_EMAIL=mosh.gl.dev@gmail.com`, `LEGAL_OPERATOR_NAME=Moshe Glazman` (filled in D4 and D11).
- **C3:** the avatars are our own (`packages/avatars`); the old 50 "freebie" avatars are removed from the app. The 690 "fast" puzzles: verified, Kaggle "1 million Sudoku games" by Kyubyong Park (`bryanpark/sudoku`), license **CC0: Public Domain**; our first puzzle is that file's first row.
- **C4:** option A (report a player + block), built by Claude.
- **C5:** `Sudoku Fight: Live PvP Sudoku`.

**Then tell Claude** your answers. Claude updates the spec table, `eas.json` (C1), the legal settings (C2), and implements C3/C4 if needed.

### Sources (Part C)
- Google Play User Generated Content policy (reporting and blocking): https://support.google.com/googleplay/android-developer/answer/9876937

---

## Part D. Deploy the server

Staging first (D1 to D7): it's what the APK in Part E talks to. Production (D8 to D12) is needed before the Play builds in Part F.

### D1. Install flyctl and log in

- [x] **D1** `fly auth whoami` prints your email

**What flyctl is.** Fly's command-line tool (`fly` / `flyctl`). Everything on Fly in this list is done with it; the website is only for billing and viewing.

**Steps**
1. In PowerShell (any folder):
   ```powershell
   powershell -Command "iwr https://fly.io/install.ps1 -useb | iex"
   ```
   (Fly's docs show the same line with `pwsh`, PowerShell 7, which isn't installed on this PC; their docs say `powershell` works instead.) It installs into `%USERPROFILE%\.fly\bin` and adds that folder to your user PATH.
2. **A Windows "User Account Control" window appears** (it creates `fly.exe` as a link to `flyctl.exe`, which needs administrator rights): click **Yes**. If you can't or you clicked No, nothing breaks: type `flyctl` wherever this list says `fly`.
3. **Close the window and open a new PowerShell**, so the new PATH is picked up. Also restart VS Code / the Claude session, so Claude's shell finds `fly` too.
4. ```powershell
   fly version
   fly auth login
   fly auth whoami
   ```
   `fly auth login` opens the browser; approve there.

**You're done when** `fly auth whoami` prints the email of your Fly account.

**Then tell Claude:** "fly is installed and logged in." From now on Claude can run `fly` commands on this PC (asking before each change).

**Pitfalls**
- `fly : The term 'fly' is not recognized`: you're in a window opened before the install (open a new one), or the UAC window was declined (use `flyctl`).

### D2. Neon: the staging database and its connection string

- [x] **D2** Project `sudoku-fight-staging` in Frankfurt; direct connection string saved in the password manager

**What you're making.** A Neon **project** is one Postgres database server with its own address and password. The **connection string** is one line that holds the address, the user name, the password and the database name: it is how the game server finds and logs in to the database, so it is a secret.

**Steps**
1. https://console.neon.tech → **New project** (or the creation wizard):
   - **Project name:** `sudoku-fight-staging`
   - **Postgres version:** the default.
   - **Cloud provider:** AWS. **Region:** **AWS Europe (Frankfurt)** (`aws-eu-central-1`), next to Fly's `fra`.
   - Leave optional extras (e.g. Neon Auth) off. → **Create project**.
2. On the project dashboard, click **Connect**. Keep the defaults (branch `main`/`production`, database `neondb`, role `neondb_owner`), and keep the snippet type on **Connection string** (not a language snippet).
3. Turn **Connection pooling** **off**. The host name must **not** contain `-pooler`. (Why: the server runs its migrations and keeps a few long-lived connections; it wants a direct connection.)
4. Show the password, copy the string.
5. If it ends with `&channel_binding=require`, **delete that part**, so it ends with `?sslmode=require`. (Neon adds it by default. Our Postgres driver, postgres.js, has no such option and would pass it on to the database as a setting; without it the connection is still encrypted, by `sslmode=require`.) The result looks like:
   `postgresql://neondb_owner:<password>@ep-<words>-<id>.eu-central-1.aws.neon.tech/neondb?sslmode=require`
6. Save it in the password manager as "Neon URL staging".

**You're done when** the saved string starts with `postgresql://`, its host has no `-pooler` and contains `eu-central-1`, and it ends with `?sslmode=require`.

**Pitfalls**
- Pooled URL (`-pooler` in the host): turn the toggle off and copy again.
- Don't create tables by hand: the server does it on start.
- It contains the database password: never in chat, git, or a file in the repo.
- Free-plan budget: Neon console → the project → **Monitoring** / **Usage** shows the CU-hours used this month. Staging sleeps most of the time; keep an eye on production during the closed test (D9).

### D3. Create the Fly app for staging

- [x] **D3** `fly apps list` shows `sudoku-fight-staging`

**What a Fly "app" is.** A named slot on Fly with its own address (`https://<name>.fly.dev`), secrets and machines. Creating it doesn't run anything yet and costs nothing until the first deploy (D6) starts a machine.

**Steps** (you, or say "create the staging app" and Claude runs it)
```powershell
cd C:\Users\mosheg\Documents\ReactNative\sudoku-fight
fly apps create sudoku-fight-staging --org personal
fly apps list
```
(`personal` is the organization every Fly account has.)

**You're done when** `fly apps list` shows `sudoku-fight-staging`. Its address will be `https://sudoku-fight-staging.fly.dev`.

**Pitfalls**
- "Name already taken": tell Claude the name you got instead. Three places in the repo must change together (`app` in `fly.toml`, the `preview` host in `apps/mobile/eas.json`, and `apps/server/test/deploy.test.ts`), and one in Firebase: add `<the new name>.fly.dev` to **Authorized domains** (B6 step 4). Without it, Google sign-in to the admin site fails with `auth/unauthorized-domain`, and with Google only there is no other way in.
- Never `fly launch`.

### D4. Staging secrets (you: only the database; Claude: the rest)

- [x] **D4** `fly secrets list -a sudoku-fight-staging` shows DATABASE_URL, FIREBASE_PROJECT_ID, ADMIN_EMAILS, FIREBASE_WEB_API_KEY, FIREBASE_WEB_APP_ID, LEGAL_CONTACT_EMAIL, LEGAL_OPERATOR_NAME

**Why.** The server refuses to start in production mode without `DATABASE_URL`; without `FIREBASE_PROJECT_ID` all accounts answer 503 `disabled`; the admin site signs you in with Google (B6) only with `ADMIN_EMAILS`, `FIREBASE_WEB_API_KEY` (and `FIREBASE_WEB_APP_ID`) set, and stays off without a sign-in method.

**Steps.**
1. **You, in your own PowerShell window** (not through Claude): the one real secret, the database URL, so it never shows up in the chat. `Read-Host` input is not saved in PowerShell's history.
   ```powershell
   cd C:\Users\mosheg\Documents\ReactNative\sudoku-fight
   $db = Read-Host "Paste the STAGING Neon connection string"
   fly secrets set --stage -a sudoku-fight-staging "DATABASE_URL=$db"
   Remove-Variable db
   ```
2. **Claude** (say "set the staging settings"; needs B6 done): the rest are not secret, so Claude sets them with `fly secrets set --stage -a sudoku-fight-staging`:
   - `FIREBASE_PROJECT_ID=sudoku-fight-dd416` (from B1)
   - `ADMIN_EMAILS=` your admin Google addresses (from B6; Claude sets them, they are never written in this file or the repo)
   - `FIREBASE_WEB_API_KEY` and `FIREBASE_WEB_APP_ID` (the web app's `apiKey` and `appId`, from B6)
   - `LEGAL_CONTACT_EMAIL=mosh.gl.dev@gmail.com` and `LEGAL_OPERATOR_NAME=Moshe Glazman` (C2; they remove the "draft" banner from the legal pages)
3. `fly secrets list -a sudoku-fight-staging`

Not needed any more: a generated admin password. Optional extras, only if you want them, **both real secrets: you set them yourself in your own window, like the database URL, never through the chat**:
- `ADMIN_PASSWORD`: a password sign-in next to Google (at least 8 characters, not `sudoku-admin-dev`).
- `ADMIN_SESSION_SECRET` (at least 32 characters): keeps you signed in to the admin site across deploys and restarts; without it you just sign in with Google again. With Google sign-in only, this secret alone signs the admin sessions: whoever knows it can make one for any address on `ADMIN_EMAILS`. So: generated, never shown, and a **different** one for staging and production:
  ```powershell
  $session = node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  fly secrets set --stage -a sudoku-fight-staging "ADMIN_SESSION_SECRET=$session"
  Remove-Variable session
  ```

**You're done when** `fly secrets list` shows the 7 names (values are never shown, only digests). Showing that output to Claude is safe.

**Pitfalls**
- `NODE_ENV`, `TRUST_PROXY=1`, `PORT`, `ADMIN_TZ` and `SENTRY_ENVIRONMENT` are already in `fly.toml`; don't set them as secrets. **`FIREBASE_PROJECT_ID`, `ADMIN_EMAILS` and `FIREBASE_WEB_*` must not go into `fly.toml`** (a test forbids it): they are Fly secrets.
- `--stage` stores without restarting; the deploy in D6 picks everything up. Without `--stage` on a running app, each `fly secrets set` restarts the machine.

### D5. Load the ranked puzzles into the staging database

- [x] **D5** The seed reports 2000 puzzles for each game type, written to Postgres

**Why.** Ranked games only use puzzles from the server-side ranked pool (they never ship in the app). Without them, no ranked game starts, and the log warns `no ranked puzzles`.

**Steps** (you, because it needs the database URL)
```powershell
cd C:\Users\mosheg\Documents\ReactNative\sudoku-fight
$env:DATABASE_URL = Read-Host "Paste the STAGING Neon connection string"
npm run db:seed-puzzles
Remove-Item Env:DATABASE_URL
```

**You're done when** the output says `... ranked puzzles from ... written to Postgres (DATABASE_URL) ...` followed by `fast 2000 in the pool`, `normal 2000 in the pool`, `hard 2000 in the pool`.

**Pitfalls**
- If the output names a folder (`...\.data\pglite`) instead of `Postgres (DATABASE_URL)`, the variable wasn't set and it seeded your local dev database. Run it again.
- It can run before or after the first deploy (it runs the migrations first). Running it again is safe: it only updates. If you load the puzzles *after* a deploy, the `no ranked puzzles` line stays in that start's log; ranked games work anyway, and the next restart or deploy logs cleanly.
- It hangs, then fails with a timeout (`CONNECT_TIMEOUT`, `ETIMEDOUT`): your network blocks outgoing port 5432 (common on office networks). Run it from home or through a phone hotspot.
- `PostgresError: password authentication failed`: the string was cut while pasting. Copy it again from the password manager.

### D6. Deploy staging

- [x] **D6** First deploy finished

**Steps.** Say **"deploy staging"** and Claude runs it, or run it yourself:
```powershell
cd C:\Users\mosheg\Documents\ReactNative\sudoku-fight
fly deploy --ha=false --env GIT_SHA=$(git rev-parse --short HEAD)
```
The image is built on Fly's builders (no Docker on this PC). The first time takes a few minutes. `GIT_SHA` tells Sentry which commit is running; Claude commits before deploying, so it is exact. On the first deploy Fly gives the app a free shared IPv4 and an IPv6 address; if it offers a dedicated IPv4, say no (it costs $2/month and isn't needed).

**You're done when** the command ends without an error and prints the app's address (`https://sudoku-fight-staging.fly.dev/`). D7 then confirms it is healthy.

**Pitfalls**
- **Always `--ha=false`.** Without it the first deploy creates 2 machines, and since game rooms and matchmaking live in one process's memory, two machines are two separate worlds. If it happened: `fly scale count 1 -a sudoku-fight-staging`. Never `fly scale count 2`.
- Every deploy replaces the machine: games running at that moment end (closed as `serverRestart`, no rating change).

### D7. Check staging

- [x] **D7** Health, logs, admin site and legal page all OK

**Steps**
```powershell
cd C:\Users\mosheg\Documents\ReactNative\sudoku-fight
fly status -a sudoku-fight-staging
curl.exe https://sudoku-fight-staging.fly.dev/health
fly logs -a sudoku-fight-staging --no-tail
```
(`--no-tail` prints the recent log and stops; without it `fly logs` keeps streaming until Ctrl+C.) Then in a browser:
- https://sudoku-fight-staging.fly.dev/admin → **sign in with Google**, with one of your admin accounts. (The admin site is in Hebrew; the **English** button at the top switches language.)
- https://sudoku-fight-staging.fly.dev/legal/privacy?lang=en (and without `?lang=en` for Hebrew).

**You're done when**
- `fly status`: **one** machine, state `started`, check `passing`.
- `/health` returns `{"ok":true,"engine":"...","protocol":...}`.
- The log has `[server] production, database Postgres, admin site on (Google sign-in for 3 addresses), Sentry off (no SENTRY_DSN)` (the number is how many addresses `ADMIN_EMAILS` has; `Sentry on (staging, ...)` after D8), and **none** of: `accounts disabled`, `admin site disabled`, `admin Google sign-in off`, `no ranked puzzles`, `LEGAL_CONTACT_EMAIL or LEGAL_OPERATOR_NAME is not set`. (`ADMIN_SESSION_SECRET is not set` is fine: you sign in again after each deploy.)
- The Google sign-in opens the admin site (empty lists are fine), and the log shows `admin sign-in: <your address>`. A Google account that is not on the list is refused.
- The privacy page loads with your email and name, without a red placeholder or a "draft" note.

**Then tell Claude:** "staging is up" (or paste the log lines; they contain no secrets). **Goal 1 (a server version deployed) is done.**

**If something is wrong:** `fly logs -a sudoku-fight-staging --no-tail` prints the reason at start (e.g. `Invalid server settings: DATABASE_URL: ...`). A bad secret is fixed with `fly secrets set -a sudoku-fight-staging NAME=value` (restarts the machine). The log never contains secret values, so you can paste it to Claude.

### D8. (Optional) Sentry for the server

- [ ] **D8** Sentry project created and `SENTRY_DSN` set on staging (and later production)

**Steps** (details in `docs/DEPLOY-PRODUCTION.md` §3)
1. Sentry → **Create Project** → platform **Node.js** → name `sudoku-fight-server`.
2. **Project Settings → Client Keys (DSN)** → copy the DSN (`https://<key>@<org>.ingest...sentry.io/<id>`).
3. **Project Settings → Security & Privacy:** Data Scrubber on, Use Default Scrubbers on, Prevent Storing of IP Addresses on.
4. **Alerts → Create Alert** → Issues → "A new issue is created" → email to you.
5. In your PowerShell:
   ```powershell
   $dsn = Read-Host "Paste the Sentry DSN"
   fly secrets set -a sudoku-fight-staging "SENTRY_DSN=$dsn"
   Remove-Variable dsn
   ```
   The same DSN is used for production in D11; reports are separated by `SENTRY_ENVIRONMENT` (already in the two `fly*.toml` files).

**You're done when** the staging log says `Sentry on (staging, ...)`.

### D9. Neon: the production database

- [ ] **D9** Project `sudoku-fight-prod` in Frankfurt; direct connection string saved as "Neon URL production"

Same as D2, with the name `sudoku-fight-prod`. A separate project, so testers' and players' data never mixes with staging.

Backups: Neon's Free plan keeps a 6-hour restore window. Before the public launch, consider the Launch plan (up to 7 days), and see `docs/DEPLOY-PRODUCTION.md` §2 for manual `pg_dump` backups.

Budget: production is busier than staging. During the closed test, look at the project's CU-hours (Neon console → **Usage**) once a week; if it heads for 100 before the month ends, move this project to Launch, or the database stops until next month. (Launch at the smallest size costs at most about $20/month even if the database never sleeps: 0.25 CU × 730 hours ≈ 183 CU-hours × $0.106, plus $0.35 per GB stored.)

### D10. Create the Fly production app (and your domain, if C1 = own domain)

- [ ] **D10** `fly apps list` shows `sudoku-fight-prod`

**Steps** (you, or "create the production app" and Claude runs it)
1. ```powershell
   cd C:\Users\mosheg\Documents\ReactNative\sudoku-fight
   fly apps create sudoku-fight-prod --org personal
   ```
2. If the name is taken: tell Claude the new name (it changes `app` in `fly.production.toml` and `EXPO_PUBLIC_SERVER_HOST` in the `production` profile of `apps/mobile/eas.json`), and add `<the new name>.fly.dev` to Firebase **Authorized domains** yourself (B6 step 4), or the admin site's Google sign-in fails there (`auth/unauthorized-domain`).
3. Never `fly deploy` for production without `--config fly.production.toml` (without it, it deploys to staging).
4. **Only if C1 = own domain:** after the first production deploy (D12),
   ```powershell
   fly certs add api.<your-domain> -a sudoku-fight-prod
   ```
   Add the DNS records it prints at your domain registrar, then wait for `fly certs show api.<your-domain> -a sudoku-fight-prod` to report the certificate as issued. Tell Claude the host name; Claude updates the `production` profile in `eas.json` **before** F6.
   Also add `api.<your-domain>` to Firebase → Authentication → Settings → **Authorized domains** (as in B6 step 4), or the admin site's Google sign-in fails on that address (`auth/unauthorized-domain`).

### D11. Production secrets (you: only the database; Claude: the rest)

- [ ] **D11** `fly secrets list -a sudoku-fight-prod` shows all required names

Needs C2 decided (the legal values) and B6 done (Google sign-in).
1. **You, in your own PowerShell window:** the production database URL, the only real secret.
   ```powershell
   cd C:\Users\mosheg\Documents\ReactNative\sudoku-fight
   $db = Read-Host "Paste the PRODUCTION Neon connection string"
   fly secrets set --stage -a sudoku-fight-prod "DATABASE_URL=$db"
   Remove-Variable db
   ```
2. **Claude** (say "set the production settings"): `fly secrets set --stage -a sudoku-fight-prod` with `FIREBASE_PROJECT_ID=sudoku-fight-dd416`, `ADMIN_EMAILS` (your admin Google addresses, set by Claude, never written here), `FIREBASE_WEB_API_KEY` and `FIREBASE_WEB_APP_ID` (B6; the same web app as staging), `LEGAL_CONTACT_EMAIL=mosh.gl.dev@gmail.com`, `LEGAL_OPERATOR_NAME=Moshe Glazman`.
3. `fly secrets list -a sudoku-fight-prod`

Optional: `SENTRY_DSN` (D8, you set it like the database URL) and `INVITE_URL=https://...` (the "invite friends" link; Claude can set it; without it the button is hidden). `ADMIN_PASSWORD` (8+ characters) and `ADMIN_SESSION_SECRET` only if you want them, set by you as in D4 (with `-a sudoku-fight-prod`), each **different** from staging's.

**You're done when** `fly secrets list` shows `DATABASE_URL`, `FIREBASE_PROJECT_ID`, `ADMIN_EMAILS`, `FIREBASE_WEB_API_KEY`, `FIREBASE_WEB_APP_ID`, `LEGAL_CONTACT_EMAIL`, `LEGAL_OPERATOR_NAME` (and the optional ones you set).

**Pitfalls**
- If you do set an admin password or a session secret, use a **different** one than on staging: a value copied from staging would open production's admin site too.
- `RATING_OPTION` [D7] is in `fly.production.toml` (`"B"`); not a secret.

### D12. Production: puzzles, deploy, checks

- [ ] **D12** Production healthy; legal pages without "draft"

**Steps**
1. Puzzles (you):
   ```powershell
   cd C:\Users\mosheg\Documents\ReactNative\sudoku-fight
   $env:DATABASE_URL = Read-Host "Paste the PRODUCTION Neon connection string"
   npm run db:seed-puzzles
   Remove-Item Env:DATABASE_URL
   ```
2. Deploy: say **"deploy production"** (Claude asks before running it), or:
   ```powershell
   cd C:\Users\mosheg\Documents\ReactNative\sudoku-fight
   fly deploy --config fly.production.toml --ha=false --env GIT_SHA=$(git rev-parse --short HEAD)
   ```
3. Checks:
   ```powershell
   fly status -a sudoku-fight-prod
   curl.exe https://sudoku-fight-prod.fly.dev/health
   fly logs -a sudoku-fight-prod --no-tail
   ```
4. Open in a browser:
   - https://sudoku-fight-prod.fly.dev/admin (sign in with Google)
   - https://sudoku-fight-prod.fly.dev/legal/privacy?lang=en and https://sudoku-fight-prod.fly.dev/legal/privacy
   - https://sudoku-fight-prod.fly.dev/legal/terms?lang=en
   - https://sudoku-fight-prod.fly.dev/legal/delete-account?lang=en

**You're done when** one machine is `started`/`passing`, `/health` answers `{"ok":true,...}`, the log has `[server] production, database Postgres, admin site on (Google sign-in for ...), ...` without `accounts disabled`, `admin site disabled`, `admin Google sign-in off`, `no ranked puzzles` or `LEGAL_CONTACT_EMAIL or LEGAL_OPERATOR_NAME is not set`, the Google sign-in opens the admin site, and the three legal pages show your email and name, **with no red placeholder and no "draft" note**, in English and Hebrew.

(With your own domain, replace `sudoku-fight-prod.fly.dev` with `api.<your-domain>` everywhere from here on, and make sure it is in Firebase **Authorized domains**: D10 step 4.)

### Sources (Part D)
- flyctl install (`pwsh`, or `powershell` instead; `~\.fly`): https://docs.fly.io/flyctl/install, and the script itself (user PATH, the UAC prompt for the `fly.exe` link): https://fly.io/install.ps1
- `fly logs --no-tail`: https://docs.fly.io/flyctl/logs
- `fly deploy` flags (`--ha` "Create spare machines ... (default true)", `--config`, `--env`): https://docs.fly.io/flyctl/deploy
- `fly apps create <name> --org`: https://docs.fly.io/flyctl/apps-create
- Secrets (`--stage`, list shows digests only, set restarts machines): https://docs.fly.io/apps/secrets
- Neon regions (AWS Europe (Frankfurt), `aws-eu-central-1`): https://neon.com/docs/introduction/regions
- Neon Connect modal, pooling toggle, `-pooler` host, `channel_binding=require` in the default string: https://neon.com/docs/connect/connect-from-any-app
- Neon scale to zero after 5 minutes without activity: https://neon.com/docs/introduction/scale-to-zero and https://neon.com/docs/introduction/compute-lifecycle
- Neon's note that most non-libpq drivers don't use `channel_binding`: https://neon.com/blog/postgres-needs-better-connection-security-defaults

---

## Part E. Build the APK with EAS, install on two phones with ADB, and test

### E1. Install EAS CLI, log in, link the project

- [ ] **E1** `eas whoami` prints your username; Claude has the EAS project ID

**Steps**
1. ```powershell
   npm install --global eas-cli
   eas --version
   eas login
   eas whoami
   ```
   `eas login` opens the browser by default.
2. Link the app to an EAS project:
   ```powershell
   cd C:\Users\mosheg\Documents\ReactNative\sudoku-fight\apps\mobile
   eas init
   ```
   Answer **Yes** to creating the project `@<your-username>/sudoku-fight`. Then one of two things happens:
   - **Usually:** `eas init` writes the project ID into `apps/mobile/app.json` by itself (`extra.eas.projectId`, a UUID; it may also copy an `extra.firebase` entry and add `owner`). It can do that because `app.config.ts` builds on `app.json`.
   - **Or** it prints `Warning: Your project uses dynamic app configuration, and the EAS project ID can't automatically be added to it.` with a block containing `"projectId": "1234abcd-..."`. Copy that UUID (it's not a secret).
3. Check:
   ```powershell
   cd C:\Users\mosheg\Documents\ReactNative\sudoku-fight
   git diff apps/mobile/app.json
   ```

**You're done when** `eas whoami` prints your username, and either `git diff` shows `"projectId"` in `app.json` or you copied the UUID from the warning.

**Then tell Claude:** "eas init done" (plus the UUID if it printed the warning). Claude checks `app.json` (keeps `extra.eas.projectId`, removes anything copied that `app.config.ts` computes), runs the tests, and commits and pushes it. `eas env:set` (E2) and `eas build` (E3) need this project ID.

**Pitfalls**
- `eas : The term 'eas' is not recognized`: open a new PowerShell window (the npm global folder, `%APPDATA%\npm`, joins PATH for new windows).
- Run `eas init` only once. A second project would get a different ID, and builds and variables would split between the two.

### E2. Upload `google-services.json` to EAS

- [ ] **E2** `eas env:list` shows `GOOGLE_SERVICES_JSON` in development, preview and production

**Why.** EAS builds from your code, but gitignored files aren't uploaded. The Firebase file therefore goes up as an EAS **file variable**; during the build, `GOOGLE_SERVICES_JSON` holds the path of the file, and `app.config.ts` uses it. A `production` build fails on purpose without it. **A `preview` build does not fail: it silently builds an app without Firebase ("Development mode" accounts on the phone only), and the staging server, which runs in production mode, refuses those development sign-ins.** So the APK test needs real Firebase too: upload it for all three environments.

**Steps** (you, or say "upload the Firebase file to EAS" and Claude runs it):
```powershell
cd C:\Users\mosheg\Documents\ReactNative\sudoku-fight\apps\mobile
eas env:set --scope project --name GOOGLE_SERVICES_JSON --type file --value .\config\firebase\google-services.json --visibility secret --environment development --environment preview --environment production
eas env:list --environment preview
eas env:list --environment production
```
If `eas` asks instead of taking a flag: type **file**, visibility **secret**, environments: all three.

**You're done when** both lists show `GOOGLE_SERVICES_JSON` (its value hidden).

**Pitfalls**
- `eas env:create` (in `docs/FIREBASE-SETUP.md` §7) is deprecated in eas-cli 24: it still works but warns. `eas env:set` creates or updates.
- "Secret" variables can't be read back, not even by you, and exist only on Expo's build servers. Keep the backup from B3, **and keep the local copy** in `apps/mobile/config/firebase/`: `eas build` first reads the app config on this PC, where a secret variable isn't available, so it uses the local file there.
- If you ever replace the file (e.g. a new Firebase app), run the same `eas env:set` again.
- `eas env:set` says the project isn't configured: E1 isn't finished (the project ID isn't in `app.json` yet).

### E3. Build the preview APK

- [ ] **E3** A finished Android build with profile `preview` on expo.dev

**What the `preview` profile is** (`apps/mobile/eas.json`): an installable **APK**, `distribution: internal`, EAS environment `preview`, server `sudoku-fight-staging.fly.dev:443` over TLS. A release build (no Metro, no dev menu), like what testers will get.

**Steps.** Say **"build the preview APK"** (Claude asks, then runs it), or:
```powershell
cd C:\Users\mosheg\Documents\ReactNative\sudoku-fight\apps\mobile
eas build --profile preview --platform android
```
First-build questions:
- **"Generate a new Android Keystore?"** → **Yes.** EAS creates the key that signs your builds (for Google Play it becomes the **upload key**, see the glossary) and keeps it on its servers. Never use a keystore from PureTrack or anywhere else.
- The version code needs no answer: EAS starts it at 1 by itself (`Initialized versionCode with 1`).
- If asked about EAS Update / channels: **No** (no over-the-air updates in V1).

The CLI uploads the project (about 16 MB), prints a link to the build page and waits. On the free plan the queue can take from a few minutes to 90+ minutes at peak times, plus the build itself (often 10 to 30 minutes). You can close the window: the build continues, and the link (and https://expo.dev → your project → Builds) shows progress.

**You're done when** the build page shows **Finished** and an APK artifact.

**Optional, once: back up the signing key.** EAS keeps it, but a copy in your password manager protects you if the Expo account is ever lost:
```powershell
cd C:\Users\mosheg\Documents\ReactNative\sudoku-fight\apps\mobile
eas credentials --platform android
```
→ choose the build profile → **Keystore: Manage everything needed to build your project** → **Download existing keystore** → confirm showing the passwords. It saves a `.jks` file in `apps\mobile` (git ignores `*.jks`) and prints the keystore password, key alias and key password. Put the file and the three values in the password manager, then delete the `.jks` from the folder. Never in chat or git.

**Pitfalls**
- Each build uses one of the **15 free Android builds per month**. Don't start builds "just to see".
- If it fails, send Claude the build page link: Claude can read the logs (`eas build:view`).

### E4. Download the APK

- [ ] **E4** The APK file is on this PC

**Steps**
- Easiest: on the build page click **Download** (or the "Install" button, which shows a QR code). Save as `%USERPROFILE%\Downloads\sudoku-fight-preview.apk`.
- Or from PowerShell (or say "download the APK" and Claude runs it):
  ```powershell
  cd C:\Users\mosheg\Documents\ReactNative\sudoku-fight\apps\mobile
  $b = eas build:list --platform android --build-profile preview --status finished --limit 1 --json --non-interactive | ConvertFrom-Json
  curl.exe -L -o "$env:USERPROFILE\Downloads\sudoku-fight-preview.apk" $b[0].artifacts.buildUrl
  ```
  (`curl.exe`, not `Invoke-WebRequest`: in Windows PowerShell 5.1 the latter's progress bar slows big downloads a lot.)

**You're done when** `Get-Item "$env:USERPROFILE\Downloads\sudoku-fight-preview.apk"` shows a file of tens of MB.

### E5. Prepare both phones for ADB

- [ ] **E5** `adb devices -l` lists both phones as `device`

**Steps** (on each phone)
1. **Settings → About phone → Build number**: tap it 7 times (Samsung: **Settings → About phone → Software information → Build number**). "You are now a developer".
2. **Settings → System → Developer options** (Samsung: at the bottom of Settings) → **USB debugging** on.
3. Connect with USB. On the phone, accept **"Allow USB debugging?"** and tick **"Always allow from this computer"**.
4. On the PC:
   ```powershell
   adb devices -l
   ```
   You should see two lines ending in `device`, each with a serial (e.g. `R58N12ABCDE  device ... model:SM_A546E`). Write down which serial is which phone.
5. **Remove the old Development Build** if a phone has one (it's signed with a different key, so the APK can't install over it). This deletes that app's local data on the phone:
   ```powershell
   adb -s <SERIAL_1> uninstall com.mosheg.sudokufight
   adb -s <SERIAL_2> uninstall com.mosheg.sudokufight
   ```
   `Success`, or an error saying the package isn't installed, are both fine.

**Only one USB cable? Wireless debugging (Android 11+), same Wi-Fi as the PC:**
1. Phone: **Developer options → Wireless debugging** → on → **Pair device with pairing code**. It shows an IP:port and a 6-digit code.
2. PC: `adb pair 192.168.1.23:37099` (the pairing IP:port) → type the code.
3. PC: `adb connect 192.168.1.23:<port>` with the port shown on the main **Wireless debugging** screen (it is **not** the pairing port).
4. `adb devices -l` now lists `192.168.1.23:<port>  device`. Use that as the serial.

**Pitfalls**
- `unauthorized`: unlock the phone and accept the prompt; or Developer options → **Revoke USB debugging authorizations**, unplug, replug.
- Phone not listed at all: try another cable/port (some cables only charge); for Samsung install the Samsung USB driver; for Pixel the Google USB Driver (Android Studio → SDK Manager → SDK Tools).
- **Samsung (One UI 6 and later): Auto Blocker** blocks commands over USB and app installs from outside the stores. Turn it off for the test: **Settings → Security and privacy → Auto Blocker → off** (turn it back on afterwards if you like).
- **Xiaomi / Redmi / POCO:** in Developer options also turn on **Install via USB** (and **USB debugging (Security settings)** if you want screenshots); Xiaomi may ask you to sign in to a Mi account for that.
- During `adb install` keep the phone unlocked and watch its screen: some phones ask "Install this app?" or show a Play Protect scan, and the install waits for your answer.

### E6. Install the APK on both phones

- [ ] **E6** The app opens on both phones

```powershell
$apk = "$env:USERPROFILE\Downloads\sudoku-fight-preview.apk"
adb -s <SERIAL_1> install -r $apk
adb -s <SERIAL_2> install -r $apk
```
(`-r` reinstalls and keeps the app's data, for the next APKs.)

**You're done when** both print `Success`, and the app opens on both phones with the splash screen, then the sign-in screen **without the "Development mode" badge** ("מצב פיתוח").

**Pitfalls**
- `INSTALL_FAILED_UPDATE_INCOMPATIBLE`: an app with the same package but another signature is installed (old Development Build, or later the Play version). `adb -s <SERIAL> uninstall com.mosheg.sudokufight`, then install again.
- Google Play Protect may warn about an unknown app: **More details → Install anyway** (it's your app, not from Play).
- The "Development mode" badge is visible: the build has no Firebase. E2 was missed for `preview`; fix it and rebuild (E3).

### E7. The two-phone test

- [ ] **E7** All steps below pass, or failures were reported to Claude

**Why two phones and real emails.** The staging server runs in production mode: it takes only real Firebase sign-ins, and ranked games only from **verified** emails (`RANKED_REQUIRES_VERIFIED_EMAIL`, on by default). So the development shortcuts (local "Development mode" accounts, the `fake-client` script used on this PC) can't play the second side; two real accounts on two phones can.

Two accounts with **real** email addresses you can read. Tip: Gmail ignores `+tags`, so `you+sf1@gmail.com` and `you+sf2@gmail.com` are two different accounts for Firebase but arrive in one inbox. Don't reuse these addresses later for the demo accounts (F8): staging and production share one Firebase project. And not an address you sign in to `/admin` with (B6): it is already a Google user of the project, so the app's sign-up refuses it ("email already in use"). In **Authentication → Users**, your admin Google accounts are listed too; that's expected.

Labels: the app follows the phone's language; Hebrew label first, English in brackets.

**Accounts**
1. [ ] Phone 1: **הרשמה** (Sign up) → step 1: name, avatar, country → step 2: email `...+sf1`, password → you reach Home with a rating card of 1200 "provisional" (זמני).
2. [ ] Phone 2: the same with `...+sf2` and another display name.
3. [ ] Both phones show the banner "המייל שלך עוד לא מאומת" (Your email isn't verified yet).
4. [ ] Open the Hebrew verification email (sender "סודוקו פייט"; check Spam), tap the link, back in the app tap **אימתתי** (I verified). The banner disappears. Do it for both.
5. [ ] Firebase console → **Authentication → Users** lists both emails (next to your admin Google accounts from B6).

**Practice (works offline too)**
6. [ ] Phone 1: **שחק** (Play) → **אימון לבד** (Solo practice) → any type → play a few moves or finish.
7. [ ] Phone 2: **שחק** → **אימון מול בוט** (Practice vs bot) → pick a bot → play to the end (or surrender).

**Ranked between the two phones**
8. [ ] On **both** phones, within a few seconds: **שחק** → **מדורג · 2 שחקנים** (Ranked · 2 players) → **מהיר** (Fast) → **מצא יריב** (Find an opponent). Same type and the same player count on both, or they wait in different queues.
9. [ ] "נמצא יריב!" (opponent found) on both: VS screen with both names, flags and ratings; "me" in the P1 color with ●, the opponent with ▲; then 3-2-1-GO at the same moment on both.
10. [ ] Play: locks, correct and wrong digits, an interference and a reaction show on the other phone.
11. [ ] Finish (fill the board, or **כניעה** (Surrender) on one phone). Results: win on one, loss on the other. For two new provisional accounts the winner goes 1200 → **1232** and the loser 1200 → **1168**.
12. [ ] **היסטוריה** (History) → **מדורג** (Ranked) → the game → Replay opens with explanations.
13. [ ] Leaderboard shows both players.
14. [ ] Staging admin site (https://sudoku-fight-staging.fly.dev/admin): **משתמשים** (Users) shows both (email, country, rating); the user page → ratings → `fast` equals the phone; **משחקים** (Games) → the game → both participants with score, place, rating before → after.

**Connection**
15. [ ] Start another ranked game. Mid-game, phone 2: airplane mode for **5 seconds**, then off. Phone 1 shows the opponent disconnecting and "Reconnecting... 15" counting down with the game frozen; after phone 2's Wi-Fi is back: "back in the game, synced", same board and score on both.
16. [ ] Mid-game, phone 2: airplane mode for **20 seconds**. Phone 1: the countdown reaches 0, then "<name> left the game" and a win by abandonment. Phone 2 after reconnecting: a connection error with "Try again", or straight to a loss.
17. [ ] Phone 1 only: Ranked · 2 → Fast → Find an opponent, and wait. At **1:00**: "no opponent at your level yet" with **שחק מול בוט בינתיים** (Play a bot meanwhile); tap it and a bot game starts.
18. [ ] Airplane mode, then **שחק**: a "no internet" banner, ranked cards dimmed ("requires connection"), practice still available. Airplane off: within about 10 s the banner goes away by itself.

**Account screens**
19. [ ] Settings → **מידע ומשפטי** (About and legal): privacy and terms open (staging may show the "draft" banner until `LEGAL_*` is set there).
20. [ ] Sign out, **שכחתי סיסמה** (Forgot password): a Hebrew reset email arrives.
21. [ ] Optional: register a third throwaway account, then Settings → **מחיקת חשבון** (Delete account) → password. It disappears from Firebase Users, and the admin site marks it deleted.

**You're done when** all boxes are ticked. **Goal 2 is done.** (More scenarios: `docs/STAGE7-DEVICE-CHECKS.md`, `docs/STAGE9-10-DEVICE-CHECKS.md`, `docs/QA-CHECKLIST.md`.)

**Pitfalls**
- Step 8 shows "משחק מדורג דורש מייל מאומת" (Ranked games need a verified email) with the button **אמת את המייל** (Verify email): that phone's link wasn't opened, or **אימתתי** (I verified) wasn't tapped after opening it. Tap the button, open the link from the email, tap **אימתתי**, and search again.
- The two phones never find each other: they chose a different game type or player count, or one search ended (1 minute) before the other started. Start both again within a few seconds.
- Keep the phones on USB (or not connected at all) for steps 15 to 18: with wireless ADB, airplane mode also cuts ADB.

### E8. Report results (and logs if something failed)

- [ ] **E8** Claude has the results

**When something fails**, note the small error code on the error screen (e.g. `network`, `alreadyQueued-4215`, `emailNotVerified`), and save the phone's log:
```powershell
adb -s <SERIAL_1> logcat -c
# reproduce the problem on the phone, then:
adb -s <SERIAL_1> logcat -d -v time ReactNativeJS:V AndroidRuntime:E *:S | Out-File -Encoding utf8 "$env:USERPROFILE\Desktop\sf-log-phone1.txt"
```
The app never logs tokens or passwords.

**Then tell Claude:** which steps passed, which failed (step number, phone, error code), and the log file path. Claude can also check the server side with `fly logs -a sudoku-fight-staging`.

### Sources (Part E)
- EAS Build setup (`npm install --global eas-cli`, `eas login`, `eas whoami`, EAS-generated keystore): https://docs.expo.dev/build/setup/
- APK builds (`buildType: apk`) and installing with adb: https://docs.expo.dev/build-reference/apk/
- EAS environment variables (environments `development`/`preview`/`production`, the `environment` field in eas.json, visibility `plaintext`/`sensitive`/`secret`): https://docs.expo.dev/eas/environment-variables/ and https://docs.expo.dev/eas/environment-variables/manage/
- eas-cli 24.12.1 command reference (`env:set --type string|file`, `env:create` deprecated, `build:list --json` with `artifacts.buildUrl`, `init`, `login` opens the browser by default, `credentials`): https://github.com/expo/eas-cli/blob/main/packages/eas-cli/README.md (checked against the published 24.12.1 package)
- Which EAS environment a profile uses, and secret variables not being readable on your PC: https://docs.expo.dev/eas/environment-variables/usage/
- Dynamic app config (the page the `eas init` warning links to): https://docs.expo.dev/workflow/configuration/#dynamic-configuration-with-appconfigjs
- Samsung Auto Blocker (Settings → Security and privacy → Auto Blocker; blocks USB commands and outside installs): https://www.samsung.com/uk/support/mobile-devices/protect-your-galaxy-device-with-the-new-auto-blocker-feature/
- ADB (USB debugging, `-s <serial>`, `install -r`, wireless pairing, screencap): https://developer.android.com/tools/adb

---

## Part F. Google Play: the first version

Prerequisites: A2 verified; C1, C2 and C5 decided (C3 before F4's screenshots, C3 and C4 before F10); production server healthy (D12); E1 and E2 done.

Order: F1 to F5 set up the store page and forms; F6 and F7 put the first build on **Internal testing**. Internal testing doesn't need the listing and forms to be finished (Google shows a temporary name for up to 48 hours), so if you're waiting on something in F3 to F5 you can do F6 and F7 first. Closed testing (F10) needs everything.

### F1. Create the app

- [ ] **F1** The app exists in Play Console

**Steps**
1. Play Console → **Home** → **Create app**.
2. **App name:** per C5, e.g. `Sudoku Fight: Live PvP Sudoku` (30 characters max).
3. **Default language:** English (United States) – en-US (Hebrew is added as a translation in F3).
4. **App or game:** **Game**.
5. **Free or paid:** **Free**. Important: a free app can never become paid, but a free app **can** sell in-app purchases (Part G). Paid-to-download is not the plan, so Free is right.
6. Tick the declarations (Developer Program Policies, US export laws, Play App Signing terms) → **Create app**.

**You're done when** the app's Dashboard opens with a "Set up your app" checklist.

### F2. Store settings: category, tags, contact

- [ ] **F2** Category, tags and contact email saved

Left menu **Grow users → Store presence → Store settings** (or from the Dashboard checklist):
- **App category:** Game → **Puzzle** (the alternative is Board). **Tags:** up to 5 from Play's list; `docs/store/LISTING-GOOGLE.md` §2 suggests Sudoku, Multiplayer, Puzzle, Logic, Competitive (pick the closest names Play offers).
- **Contact details:** Email = the support mailbox, `mosh.gl.dev@gmail.com` (public). Website optional. Phone: leave empty.

### F3. Main store listing: texts in English and Hebrew

- [ ] **F3** Listing texts saved in en-US and iw-IL

**Grow users → Store presence → Store listings → Main store listing.** All texts are ready in `docs/store/LISTING-GOOGLE.md` §1:
- **App name** (30), **Short description** (80): copy the English cells.
- **Full description** (4,000): the "Description" from `docs/store/LISTING-APPLE.md` §1 (the same text fits both stores).
- Rules: no "#1", "Best", "Free" or emoji in the name or the short description; no "Download now".
- Translations: **Manage translations → Add your own translations → Hebrew – iw-IL**, then paste the Hebrew cells.

### F4. Graphics: icon, feature graphic, phone screenshots

- [ ] **F4** Icon, feature graphic and at least 4 phone screenshots per language uploaded

| Asset | Google's rule | Use |
|---|---|---|
| App icon | 512 x 512, 32-bit PNG (with alpha), max 1024 KB | `apps/mobile/assets/brand/play-icon-512.png` (512 x 512, 14 KB, no transparent pixels) |
| Feature graphic (required) | 1024 x 500, JPEG or 24-bit PNG, **no alpha** | `apps/mobile/assets/brand/feature-graphic.png` (1024 x 500, RGB) |
| Phone screenshots | 2 to 8; JPEG or 24-bit PNG, **no alpha**; each side 320 to 3840 px; **the long side at most 2x the short side**. To be eligible for Play's recommendations: at least 4 screenshots of at least 1080 px, portrait 9:16 at least 1080 x 1920; for games, at least 3 of them showing real gameplay. Google's page sets no file-size limit for these | 1080 x 1920 each, made from the phones (below) |

**Take the screenshots** (with the preview APK or the Play build; use bot names and the demo accounts, never testers' real names). The suggested list of 8, in order, with captions, is in `docs/store/ASSETS.md` §5. Take them twice: once with the app in English (Settings → Language), once in Hebrew.
```powershell
$shots = "$env:USERPROFILE\Pictures\sudoku-fight-shots"
New-Item -ItemType Directory -Force $shots | Out-Null
adb -s <SERIAL_1> shell screencap -p /sdcard/sf.png
adb -s <SERIAL_1> pull /sdcard/sf.png "$shots\en-01-game.png"
adb -s <SERIAL_1> shell rm /sdcard/sf.png
```
Repeat the three `adb` lines for each screen, changing the file name (`en-02-...`, `he-01-...`).

**Make them fit Play's rules.** Most phones today are 20:9, e.g. 1080 x 2400: **too tall** (2400 is more than 2 x 1080). And Android screenshots are PNGs **with an alpha channel**, which Play refuses. Two ways:
- **Easiest:** say "make the Play screenshots from `%USERPROFILE%\Pictures\sudoku-fight-shots`". Claude writes a small Node script (no installs) that places each one on a 1080 x 1920 canvas in the app's colors, with the caption from `ASSETS.md` §5 (Google recommends captions take at most 20% of the image), and saves 24-bit PNGs without alpha. You review them.
- **By hand (Paint):** open the PNG → **Select** a rectangle 1080 wide and at most 2160 high (the size shows in the status bar; cut the status bar and the navigation bar) → **Crop** → **File → Save as → JPEG picture** (JPEG has no alpha).

**Pitfalls**
- Don't redirect binary output in PowerShell 5.1 (`adb exec-out screencap -p > file.png` writes a broken file there). Use `shell screencap` + `pull` as above, or run that line inside `cmd /c "..."`.
- The first two screenshots appear in search results: start with the game board (ASSETS.md §5), not the cartoon avatars or the "cats" interference (they can make the listing look aimed at children, see F5).
- No "Download now", "#1", prices or awards in screenshots or captions (Play's rules for store graphics).
- Real people's names: only bots and the demo accounts. Take the screenshots after C3 (if the avatars change, the screenshots must be taken again).

### F5. App content forms (all but App access)

- [ ] **F5** Every App content declaration except App access is complete

Open them from the Dashboard's **"Set up your app"** list (or left menu **Policy and programs → App content**; if it moved, type "App content" in the console's search). Answers, with reasons, are in `docs/store/LISTING-GOOGLE.md` §3 to §5 and `docs/store/DATA-SAFETY.md`. Production host below = `sudoku-fight-prod.fly.dev`, or `api.<your-domain>` (C1).

| Form | Answer |
|---|---|
| **Privacy policy** | `https://sudoku-fight-prod.fly.dev/legal/privacy?lang=en` (D12 must show no "draft" note) |
| **Ads** | No, my app does not contain ads |
| **App access** | Later, in F8 (needs the demo accounts) |
| **Content rating** | Start the IARC questionnaire: email = support mailbox; category **Game**; answers per LISTING-GOOGLE §4 (all No, except **"Users can interact or exchange content": Yes**; location sharing No; digital purchases No). Expected: PEGI 3 / ESRB Everyone, with "Users Interact" |
| **Target audience** | Age groups **13–15, 16–17, 18+** only (nothing under 13, which would bring the Families policy); "Could the store listing unintentionally appeal to children?" **No** |
| **News app** | No |
| **Data safety** | Fill it exactly per `docs/store/DATA-SAFETY.md` §1 and §2. **Delete account URL:** `https://sudoku-fight-prod.fly.dev/legal/delete-account?lang=en` |
| **Advertising ID** | **No** (the build blocks the `AD_ID` permission). Confirm in F7 step 7 before submitting it |
| **Government apps** | No |
| **Financial features** | My app doesn't provide any financial features |
| **Health** | My app doesn't have health features |

**You're done when** the Dashboard's setup list shows everything ticked except App access.

**Pitfalls**
- Data safety must match what the app really does; `DATA-SAFETY.md` was written from the code. If something is unclear in the form, ask Claude rather than guessing.

### F6. Build the production AAB

- [ ] **F6** A finished `production` Android build (an `.aab`)

**Before:** D12 healthy; C1 final (the host in the `production` profile of `eas.json` is the one you'll keep); E2 shows `GOOGLE_SERVICES_JSON` in `production`; the projectId is in `app.json` (E1).

Say **"build the production AAB"**, or:
```powershell
cd C:\Users\mosheg\Documents\ReactNative\sudoku-fight\apps\mobile
eas build --profile production --platform android
```
The version code is kept on EAS and goes up by itself on every production build (`autoIncrement`, `appVersionSource: remote`). The visible version is `0.1.0` (`app.json`).

**You're done when** the build page shows **Finished** with an `.aab`. Download it (**Download** button).

**Pitfalls**
- The build **stops on purpose** if Firebase is missing for Android in the `production` environment, or if the server host is `localhost`, a LAN address, a placeholder, or not `SECURE=true`. The message says what to fix.
- The AAB can't be installed with ADB; it only goes to Play.

### F7. First upload: Internal testing (by hand)

- [ ] **F7** Version rolled out to Internal testing and installed from Play on your phone

**Why by hand:** Google's API (used by `eas submit`) can't create an app's very first release; the first upload is done in the browser.

**Steps**
1. **Test and release → Testing → Internal testing → Testers** tab → **Create email list** → name "Core", add your Gmail (the one on your phone) and maybe 2 or 3 close people → **Save**.
2. **Releases** (same page) → **Create new release**.
3. Play App Signing: keep the default (**Google generates and keeps the app signing key**).
4. **Upload** the `.aab` from F6.
5. Release name: keep the default. Release notes (en-US): e.g. `First internal build.`
6. **Next** → fix any errors shown (warnings can usually wait) → **Save** → **Start rollout to Internal testing**.
7. Check the permissions: **Test and release → Latest releases and bundles → All app versions → App bundle explorer** → the version → **Details**: **`com.google.android.gms.permission.AD_ID` must not be listed**, and the target SDK is 36 (Play requires API 36 for new apps and updates since 31 Aug 2026). If `AD_ID` is there, tell Claude before you submit the Advertising ID form.
8. **Testers** tab → copy the **join link** → open it on your phone (signed in with the same Gmail) → **Accept / Become a tester** → **Download it on Google Play** → install.

**You're done when** the app installed from Play opens on your phone. **Goal 3 (a first version on Google Play) is done**; the rest of Part F takes it to the public.

**Pitfalls**
- **Uninstall the ADB-installed APK first** (`adb -s <SERIAL> uninstall com.mosheg.sudokufight`): Play's copy is signed with Google's key, so Play can't update over yours. Going back to an APK later also needs an uninstall.
- An internal release can take some minutes to reach the Play app; if "Install" isn't there yet, wait and reopen the link.

### F8. Demo accounts for Google's reviewers, then the App access form

- [ ] **F8** `demo1` and `demo2` exist on production, verified, with one ranked game; App access form saved

**Steps**
1. With the Play-installed app (production server), register **demo1** on one phone and **demo2** on the other: emails you can read but **not used before** (e.g. `you+demo1@gmail.com`), strong passwords → password manager only. Why new addresses: staging and production share the Firebase project, so an address from E7 already exists there; the production app would answer "This email already has an account" and send you through sign-in. That works, but clean accounts are simpler to hand to Google.
2. Verify both emails (link + "I verified").
3. Play one ranked game between them, and one practice game (gives the reviewer history, Replay and a leaderboard).
4. Play Console → **App content → App access** → **All or some functionality in my app is restricted** → **Add instructions**: name "Demo account", username = demo1 email, password = demo1 password, and in **Any other information required to access your app** paste the English text from `docs/store/LISTING-GOOGLE.md` §3 ("App access"), with demo2's email and password filled in **only here**. Google's reviewers must be able to sign in with these at any time: no expiring passwords, no codes sent to your phone.
5. Don't delete these accounts or change their passwords while a version is in review. If a reviewer deletes one (to test deletion), recreate it before the next submission.

**You're done when** the App access form is saved and the Dashboard setup list is complete.

**Pitfall:** the demo credentials go only into Play Console (and later App Store Connect). Never into the repo, an issue, or the chat.

### F9. (Once, optional but handy) A service-account key for `eas submit`

- [ ] **F9** `eas credentials` shows a Google Service Account key for Play submissions

**Why.** From the second build on, `eas submit` uploads the AAB for you (to Internal testing, as a draft, per `eas.json`). It needs a Google service-account key. This key is a **secret**.

**Steps** (from Expo's guide)
1. https://console.cloud.google.com → pick a project (the Firebase project's Google Cloud project is fine) → **IAM & Admin → Service Accounts → Create service account** → name `eas-submit` → **Create and close** (or **Create and continue**, skip the optional steps, **Done**). Copy its email (`eas-submit@<project>.iam.gserviceaccount.com`).
2. Open it (or its **⋮** menu) → **Manage keys → Add key → Create new key → JSON → Create** → it downloads. **Save it outside the repo folder** (e.g. `Documents\keys\`).
3. Enable the API: https://console.cloud.google.com/apis/library/androidpublisher.googleapis.com (same project) → **Enable**.
4. Play Console → **Users and permissions → Invite new users** → paste the service account email → **App permissions → Add app → Sudoku Fight** with: View app information (read-only), Edit and delete draft apps, Release to production, exclude devices, and use Play App Signing, Release apps to testing tracks, Manage testing tracks and edit tester lists, Manage store presence → **Invite user**.
5. Upload it to EAS:
   ```powershell
   cd C:\Users\mosheg\Documents\ReactNative\sudoku-fight\apps\mobile
   eas credentials --platform android
   ```
   → choose the **production** profile → **Google Service Account** → **Manage your Google Service Account Key for Play Store Submissions** → **Set up a Google Service Account Key for Play Store Submissions** → **Upload a Google Service Account Key** → type the path of the JSON file.
6. Then attach the JSON file to your password manager entry and delete the downloaded copy.

**You're done when** `eas credentials` shows the key under the Play Store submission section.

**From then on, each new version:**
```powershell
cd C:\Users\mosheg\Documents\ReactNative\sudoku-fight\apps\mobile
eas build --profile production --platform android
eas submit --profile production --platform android --latest
```
It lands in Internal testing as a **draft**; open it in Play Console and roll it out, or promote it to Closed testing.

**Pitfalls**
- The downloaded key is named like `<project>-1a2b3c.json`, which `.gitignore` does **not** match (it only catches `service-account*.json`). Never save it inside the repo.
- This is not the push-notification key (Part H). Different purpose, different permissions.

### F10. Closed testing: track, countries, testers, review

- [ ] **F10** Closed testing release sent for review, then available; opt-in link copied

Needs C3 and C4 settled (licenses and report/block), and F5 + F8 complete.

**Steps**
1. **Test and release → Testing → Closed testing** → the default track ("Closed testing - Alpha") → **Manage track**.
2. **Countries / regions:** add Israel, plus any country where a tester lives.
3. **Testers** tab → **Email lists** → **Create email list** ("Closed testers") with the 15 to 20 Gmail addresses from A7 (or **Google Groups**: the group's email). Add a feedback email (the support mailbox) → **Save**.
4. **Releases** → **Promote release** from Internal testing to this track (or **Create new release** with the same AAB). Release notes (en-US) from `docs/store/LISTING-GOOGLE.md` §6.
5. **Review release** → **Start rollout to Closed testing**. Then **Publishing overview** → **Send changes for review** if it asks (when "Managed publishing" is on).
6. Wait for the review (hours to a few days). When it's approved, copy the **opt-in link** from the Testers tab.

**You're done when** the track shows the release as available and you have the opt-in link.

### F11. Run the 14-day closed test

- [ ] **F11** At least 12 testers opted in for 14 days in a row (Day 0 = ____, Day 14 = ____)

**Steps**
1. Send every tester the opt-in link with short instructions: open it on the phone (or on a computer signed in with the **same Gmail** as the phone) → **Become a tester** → **Download it on Google Play** → install → register and verify the email → play some ranked games each week → **don't leave the test** for 14 days.
2. **Day 0** is the day the 12th tester opted in. Write it down. Testers who opt in, test fewer than 14 days and opt out don't count, so keep extras.
3. During the 14 days: play ranked games together at agreed times (with few players the ranked queue is often empty), collect feedback, and ship at least one improved build (F9 commands, then promote to Closed testing). Google's production application asks what you tested and what you changed.
4. Watch the server: admin site (users, games), `fly logs -a sudoku-fight-prod`, Firebase Crashlytics, Sentry (if D8).

**You're done when** the Dashboard shows the closed-test requirement as met (12+ testers, 14 days).

### F12. Apply for production access

- [ ] **F12** Application submitted, then approved

**Steps**
1. Play Console → **Dashboard** → **Apply for production** (it becomes available once F11 is met).
2. Answer the three sections: about your closed test (how you recruited testers, what they tested, the feedback), about the app (audience, what it does), and production readiness (what you changed and why you're ready). Be concrete; your notes from F11 help.
3. Submit. Review usually takes 7 days or less.

**You're done when** Google's email says production access is granted. The app can now go public (F13).

### F13. After approval: the first production release (pointer)

- [ ] **F13** First production release sent for review

**Test and release → Production → Create new release** (or promote from Closed testing) → countries → a **staged rollout** (e.g. 20%) → review → **Send for review**. Before that, run the Go/No-go list in `docs/RELEASE-CHECKLIST.md` (stage יג) and consider the Neon Launch plan (D9).

### Sources (Part F)
- Create app (name 30 chars, app or game, free or paid, declarations): https://support.google.com/googleplay/android-developer/answer/9859152
- Free can't become paid: https://support.google.com/googleplay/android-developer/answer/6334373
- Graphic assets (icon 512 32-bit ≤1024 KB, feature graphic 1024 x 500 no alpha, screenshots 2 to 8, 320 to 3840 px, 2x rule, 4 x 1080 px and 3 gameplay shots for recommendations, captions ≤20%): https://support.google.com/googleplay/android-developer/answer/9866151
- App content page (privacy policy, ads, sign-in details, target audience, content ratings): https://support.google.com/googleplay/android-developer/answer/9859455
- Data safety form: https://support.google.com/googleplay/android-developer/answer/10787469
- Account deletion requirements (in-app path and a web link, entered in Data safety): https://support.google.com/googleplay/android-developer/answer/13327111
- Testing tracks (internal up to 100 testers; closed testing lists up to 2,000 users each, Google Groups): https://support.google.com/googleplay/android-developer/answer/9845334
- First internal release before the listing is complete (temporary name for up to 48 hours): https://support.google.com/googleplay/android-developer/answer/3131213
- Store settings path (Grow users → Store presence → Store settings, up to 5 tags): https://support.google.com/googleplay/android-developer/answer/9859673
- App bundle explorer path: https://support.google.com/googleplay/android-developer/answer/9006925
- 12 testers / 14 days and "Apply for production" (review usually 7 days or less): https://support.google.com/googleplay/android-developer/answer/14151465
- Play App Signing (app signing key vs upload key): https://support.google.com/googleplay/android-developer/answer/7384423
- Target API level (API 36 for new apps and updates from 31 Aug 2026): https://support.google.com/googleplay/android-developer/answer/11926878
- EAS Submit for Android, first upload manual, service account (steps and the six permissions): https://docs.expo.dev/submit/android/ and https://github.com/expo/fyi/blob/main/creating-google-service-account.md
- ADB screencap: https://developer.android.com/tools/adb

---

## Part G. Later: in-app purchases

The spec lists in-app purchases as **outside V1** (`docs/01-SPEC.md` §25), and the original spec doesn't mention them. So: **plan now, build later**, after you approve a spec change (Claude will draft it: what is sold, prices, what free players keep).

### G1. Now: choices that keep the door open

- [ ] **G1** Done by following F1 and A2

- **The app is created as Free** (F1). Correct for purchases: a free app can sell in-app products and subscriptions; a free app can never become "paid to download".
- **Account type and privacy** (A2): with a personal account, **once you monetize, Google shows your full address** on Google Play. If you don't want your home address public, look into an organization account (D-U-N-S) before the first purchase goes live; converting personal to organization is possible.

### G2. Now or later: the Google payments profile

- [ ] **G2** Payments profile created and linked (bank account verified)

**Steps**
1. Play Console → **Settings → Payments profile** → **Create payments profile**.
2. Legal name, legal address (no P.O. box), primary contact, public business info (customer-support email = support mailbox, the name shown on buyers' card statements).
3. Tax information, and a **bank account in the same country** as the profile (Israel). Google verifies the bank account before paying out.
4. The business country can't be changed afterwards (the public merchant details can).
5. Know the fee: Google keeps a service fee on each sale. For developers enrolled in the 15% tier it is 15% of the first US$1M each year (30% above that) and 15% on auto-renewing subscriptions; Google is changing the model in some markets, so check the current page before setting prices.

### G3. Later: what changes when purchases are built

- [ ] **G3** (later) Purchases live on Internal testing

**Claude's part (after your approval):**
- Add a billing library: **RevenueCat** (`react-native-purchases`; a hosted service that validates purchases and tracks subscriptions) or a direct library (`react-native-iap` / `expo-iap`, with our server verifying purchases through the Google Play Developer API). Claude will present both with costs.
- It's native code: a **new EAS build** is needed (no over-the-air update). The library adds the `com.android.vending.BILLING` permission.
- Server: record entitlements; verify purchases (a Play service account with financial permissions → a **Fly secret**, never git).
- Update the privacy policy, `DATA-SAFETY.md` (Financial info → Purchase history), `APP-PRIVACY.md`, and the store texts ("The app has no in-app purchases" in the reviewer notes must go).

**Your part (later):**
1. Upload a build that contains billing to a testing track (Internal is enough). **Google lets you create products only after a build with the BILLING permission is uploaded.**
2. **Monetize with Play → Products → In-app products** (Google is renaming these "one-time products") and/or **Subscriptions**: product IDs exactly as Claude defines them, prices, Hebrew and English names. The payments profile (G2) must exist first.
3. **Settings → License testing**: add your and the testers' Gmail addresses, so they can buy without being charged.
4. Redo the content rating questionnaire ("Allows purchase of digital goods": **Yes**), and update Data safety per the new `DATA-SAFETY.md`.
5. iOS later: App Store Connect → Agreements, Tax, and Banking (Paid Apps agreement) and in-app purchase products.

### Sources (Part G)
- Free can't become paid: https://support.google.com/googleplay/android-developer/answer/6334373
- Payments profile: https://support.google.com/googleplay/android-developer/answer/7161426
- In-app products (payments profile, BILLING permission in the uploaded bundle, Monetize with Play → Products): https://support.google.com/googleplay/android-developer/answer/1153481
- Service fees: https://support.google.com/googleplay/android-developer/answer/112622
- What's public for personal accounts that monetize: https://support.google.com/googleplay/android-developer/answer/13628312

---

## Part H. Later: push notifications (V1.1)

- [ ] **H1** (later) Push approved in the spec, and the key stored safely

Not needed for these three goals. When push is approved:
1. **Android, through Expo's push service:** Firebase console → Project settings → **Service accounts** → **Generate new private key** → a JSON file. This **is a secret**: it is uploaded to EAS with `eas credentials --platform android` → production → **Google Service Account** → **Manage your Google Service Account Key for Push Notifications (FCM V1)** → **Set up a Google Service Account Key for Push Notifications (FCM V1)**. Not into git, not into the chat. It is a different key from the Play-submission key in F9. (`google-services.json` from B3 is still needed alongside it; you already have it.)
2. **If our own server sends the notifications** instead: the same kind of key goes into a **Fly secret** on the production app, never into a file in the repo. Claude will give you the exact command then (a JSON key is usually stored base64-encoded, because Windows PowerShell 5.1 mangles quotes inside command-line arguments).
3. **iOS:** an APNs key (`.p8`) from the Apple Developer account, also uploaded to EAS credentials.
4. Claude adds `expo-notifications` (native: a new build), asks permission at a sensible moment (not at first launch), updates the privacy policy and Data safety.

Source: https://docs.expo.dev/push-notifications/fcm-credentials/

---

## Part I. Later: iOS and the App Store (pointer)

- [ ] **I1** (later) iOS track started

The full list is in `docs/RELEASE-CHECKLIST.md` (stages ב, ג, ז, ח, יא) with `docs/store/LISTING-APPLE.md` and `docs/store/APP-PRIVACY.md`. In short:
1. Apple Developer Program, US$99/year (personal is quick; an organization needs D-U-N-S).
2. Firebase: add the iOS app (`com.mosheg.sudokufight`) and `GoogleService-Info.plist` (FIREBASE-SETUP §5); upload it to EAS:
   `eas env:set --scope project --name GOOGLE_SERVICE_INFO_PLIST --type file --value .\config\firebase\GoogleService-Info.plist --visibility secret --environment development --environment preview --environment production`
3. No Mac needed: `eas build --profile production --platform ios` builds in the cloud and manages certificates; `eas submit --platform ios` uploads to TestFlight.
4. Testing on an iPhone happens through TestFlight.

---

## Values cheat sheet

### App and accounts

| What | Value |
|---|---|
| Android package / iOS bundle ID | `com.mosheg.sudokufight` |
| Name under the icon | `Sudoku Fight` (`name` in `apps/mobile/app.json`) |
| Play listing name | `Sudoku Fight: Live PvP Sudoku` (C5, decided) |
| Expo slug / scheme | `sudoku-fight` / `sudokufight` |
| Visible version | `0.1.0` (`app.json`); version code kept on EAS, auto-incremented by production builds |
| Firebase project | "Sudoku Fight", Project ID `sudoku-fight-dd416` (one project for staging and production) |
| EAS project | `@<your Expo username>/sudoku-fight`, project ID (UUID) in `apps/mobile/app.json` → `extra.eas.projectId` (E1) |
| Git remote | https://github.com/glaz5593/sudokufight |

### Servers

| | Staging | Production |
|---|---|---|
| Fly app | `sudoku-fight-staging` | `sudoku-fight-prod` |
| Config file | `fly.toml` | `fly.production.toml` |
| Deploy | `fly deploy --ha=false` | `fly deploy --config fly.production.toml --ha=false` |
| Address | https://sudoku-fight-staging.fly.dev | https://sudoku-fight-prod.fly.dev (C1: stays on fly.dev) |
| Machine | 1 x shared-cpu-1x, 512 MB, `fra` | same |
| Neon project | `sudoku-fight-staging`, AWS Europe (Frankfurt) | `sudoku-fight-prod`, same region |
| Used by | `preview` APK | `production` AAB (Play) |
| Admin site | `/admin` (sign in with Google; the address must be in Firebase **Authorized domains**, B6) | `/admin` (same; a new name or your own domain goes there too) |
| Legal pages | `/legal/privacy`, `/legal/terms`, `/legal/delete-account` (`?lang=en` or `?lang=he`) | same |

### Server settings: where each one comes from

| Variable | Where it is set | Value / source | Required? |
|---|---|---|---|
| `NODE_ENV` | `fly.toml` / `fly.production.toml` `[env]` (and the Dockerfile) | `production` | yes (already set) |
| `PORT` | `[env]` | `2567` | already set |
| `TRUST_PROXY` | `[env]` | `1` (Fly's one proxy hop; not `true`) | already set |
| `ADMIN_TZ` | `[env]` | `Asia/Jerusalem` | already set |
| `SENTRY_ENVIRONMENT` | `[env]` | `staging` / `production` | already set |
| `RATING_OPTION` | `fly.production.toml` `[env]` | `B` [D7] (staging uses the default, B) | already set |
| `DATABASE_URL` | `fly secrets`, **by you** (`Read-Host`, your own PowerShell window) | Neon, direct (no `-pooler`), ending `?sslmode=require` | yes |
| `FIREBASE_PROJECT_ID` | `fly secrets`, by Claude (**not** `fly.toml`: a test forbids it) | `sudoku-fight-dd416` (Firebase → Project settings → Project ID) | yes |
| `ADMIN_EMAILS` | `fly secrets`, by Claude (it checks each entry is an address first) | your admin Google addresses, comma-separated (B6); never written in the repo. A bad entry turns Google sign-in off (log: `admin Google sign-in off`), not the server | yes (admin site) |
| `FIREBASE_WEB_API_KEY` | `fly secrets`, by Claude | the "Sudoku Fight Admin" web app's `apiKey` (B6); public by design, kept out of the repo | yes (admin site) |
| `FIREBASE_WEB_APP_ID` | `fly secrets`, by Claude | the same web app's `appId` (B6) | recommended |
| `LEGAL_CONTACT_EMAIL` | `fly secrets`, by Claude | `mosh.gl.dev@gmail.com` (C2) | yes for production |
| `LEGAL_OPERATOR_NAME` | `fly secrets`, by Claude | `Moshe Glazman` (C2) | yes for production |
| `ADMIN_PASSWORD` | `fly secrets`, by you (your own window) | only if you want a password next to Google: at least 8 characters, not `sudoku-admin-dev`; a different one per server | no |
| `ADMIN_SESSION_SECRET` | `fly secrets`, by you (your own window, generated, D4) | a real secret: with Google only, it alone signs admin sessions. At least 32 characters, a different one per server; without it you sign in with Google again after each deploy or restart | no |
| `SENTRY_DSN` | `fly secrets`, by you (`Read-Host`, D8) | Sentry → Project settings → Client Keys (D8) | optional |
| `INVITE_URL` | `fly secrets` | the "invite friends" link [D27] | optional |
| `GIT_SHA` | `fly deploy --env GIT_SHA=$(git rev-parse --short HEAD)` | the deployed commit | optional |
| `RANKED_REQUIRES_VERIFIED_EMAIL`, `PRACTICE_XP_DAILY_CAP`, `CHEAT_FAST_THINK_MS`, `CHEAT_FAST_THINK_MOVES`, `ACCOUNT_DELETE_MAX_AUTH_AGE_MS`, `SENTRY_TRACES_SAMPLE_RATE` | not set | defaults (`true`, `1500`, `1200`, `20`, `300000`, `0.05`); explained in `apps/server/.env.example` | no |
| `SENTRY_RELEASE`, `PGLITE_DIR` | not set | Sentry's release name is built from the version and `GIT_SHA`; `PGLITE_DIR` is for local development only (never set it on Fly) | no |

### EAS

| Profile | Output | Distribution | EAS environment | Server it talks to |
|---|---|---|---|---|
| `development` | Development Build (dev client) | internal | `development` | whatever `apps/mobile/.env.local` says (Metro on this PC) |
| `preview` | **APK** | internal | `preview` | `sudoku-fight-staging.fly.dev`, port 443, TLS |
| `production` | **AAB** | store | `production` | `sudoku-fight-prod.fly.dev`, port 443, TLS (C1: fly.dev); auto-increments the version code |
| submit `production` (Android) | | track `internal`, release status `draft` | | |

| EAS variable | Type / visibility | Environments | From |
|---|---|---|---|
| `GOOGLE_SERVICES_JSON` | file / secret | development, preview, production | `apps/mobile/config/firebase/google-services.json` (B3, E2) |
| `GOOGLE_SERVICE_INFO_PLIST` | file / secret | the same (later, iOS) | `apps/mobile/config/firebase/GoogleService-Info.plist` |

### Files and folders

| Path | What |
|---|---|
| `apps/mobile/config/firebase/google-services.json` | Firebase Android config (gitignored) |
| `apps/mobile/app.json` (`extra.eas.projectId`), `apps/mobile/eas.json` | EAS project link (E1); build and submit profiles |
| `fly.toml`, `fly.production.toml`, `Dockerfile` | Staging app, production app, the server image |
| `apps/mobile/assets/brand/play-icon-512.png` | Play hi-res icon |
| `apps/mobile/assets/brand/feature-graphic.png` | Play feature graphic |
| `docs/store/LISTING-GOOGLE.md` | Listing texts, App content answers, IARC, target audience, closed-test notes |
| `docs/store/DATA-SAFETY.md` | Data safety answers |
| `docs/store/ASSETS.md` | Icon rules, screenshot sizes and the 8 suggested screenshots with captions |
| `docs/store/ASSET-LICENSES.md`, `docs/store/UGC-PROPOSAL.md` | C3 and C4 |
| `docs/DECISIONS-PENDING.md` | All open decisions |
| `docs/DEPLOY-PRODUCTION.md`, `README.md` ("פריסה ל־Fly.io (Staging)") | Server deployment details |
| `docs/FIREBASE-SETUP.md` | Firebase in full (Hebrew) |
| `docs/RELEASE-CHECKLIST.md` | The full release list, including iOS and the Go/No-go |

### Commands you'll use again

| Command (folder) | What it does |
|---|---|
| `fly deploy --ha=false` (repo root) | Deploy staging |
| `fly deploy --config fly.production.toml --ha=false` (repo root) | Deploy production |
| `fly logs -a <app>` / `fly logs -a <app> --no-tail` / `fly status -a <app>` | Live log (Ctrl+C) / recent log and stop / machine state |
| `fly secrets list -a <app>` | Secret names (no values) |
| `fly scale count 1 -a <app>` | Repair if a second machine appeared |
| `eas build --profile preview --platform android` (`apps\mobile`) | New test APK |
| `eas build --profile production --platform android` (`apps\mobile`) | New Play AAB |
| `eas submit --profile production --platform android --latest` (`apps\mobile`) | Upload the latest AAB to Internal testing (after F9) |
| `adb devices -l` | List phones |
| `adb -s <serial> install -r <apk>` | Install or update the APK on one phone |
| `adb -s <serial> uninstall com.mosheg.sudokufight` | Remove the app (needed when switching between ADB and Play installs) |
