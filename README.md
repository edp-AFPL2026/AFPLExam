# Aakar Foundry - Internship Aptitude Test (Netlify + Firebase + Google Drive)

Everything runs on **Netlify**:

| Part | Where it lives |
|---|---|
| Website (frontend) | Netlify, files in the `public/` folder |
| API (Node.js / Express) | Netlify Function `netlify/functions/api.js` -> available at `/api/...` |
| Auto-submit when the timer ends | Netlify scheduled function `netlify/functions/autosubmit.js` (every minute) |
| Database (students, questions, attempts, results) | Firebase **Firestore** (free Spark plan is enough for small batches, see "Free limits") |
| Resumes | **Your Google Drive**, one folder per college |
| Company logo | stored inside Firestore (max 300 KB) |

Resume folders are created automatically in the Google account you connect:
```
My Drive / Aakar Internship Aptitude Test - Resumes / <College name> / <Student name> - <contact>.pdf
```

```
aakar-exam/
  netlify.toml              Netlify settings (functions, /api redirect, schedule)
  netlify/functions/api.js        the whole API
  netlify/functions/autosubmit.js scheduled auto-submit
  public/                   the website: student site (index.html), admin dashboard (admin/), css, js, logo
  seed.js                   creates first admin + default settings (run once on your PC)
  src/                      routes (public, student, admin), Drive upload, grading, config
  test/                     npm test (no Firebase / Drive needed)
```

---------------------------------------------------------------------

## The website (frontend) - already included

No build step. It is plain HTML, CSS and JavaScript in the `public/` folder, and Netlify serves it as it is.

| Address | What it is |
|---|---|
| `https://YOUR-SITE.netlify.app/` | **Student site:** company name, About, test rules, student information form, "Start Aptitude Test" button, mock tests with answer review, waiting-room countdown, the exam with timer, and the result page |
| `https://YOUR-SITE.netlify.app/admin/` | **Admin dashboard:** Dashboard (college-wise and place-wise submitted / pending), Exam settings, Questions (add, edit, CSV upload), Colleges and places, Company (information and logo), Students (filters, resume links, shortlist / reject, reset), Results (publish, hide, CSV download) |

```
public/
  index.html            student site
  admin/index.html      admin dashboard
  css/style.css         all styling (colours are the variables at the top of the file)
  js/common.js          shared helpers (server clock, API calls, modals)
  js/student.js         student screens
  js/admin.js           admin screens
  assets/               Aakar logo
```

To change the look, edit the colour variables at the top of `public/css/style.css`.
To try it on your PC: `npm run seed:samples`, `npm start`, then open http://localhost:5000 and http://localhost:5000/admin/.

**First time on exam day:** open `/admin/` -> log in -> Company (check the About text and upload the logo) -> Colleges and places ->
Questions (upload `exam`, `mock1`, `mock2`, `mock3`) -> Exam settings (start time, timer, marking, pass marks, messages) -> Save.
Send students the main site address. After the exam ends: Dashboard (check pending is 0) -> Results -> **Publish results**.

---------------------------------------------------------------------

## Part 1 - Firebase (database only, no Storage needed)

1. https://console.firebase.google.com -> your project -> **Firestore Database** is already created (production mode is correct).
2. **Settings (gear) -> Project settings -> Service accounts -> Generate new private key** -> save the file as
   `serviceAccountKey.json` in this folder (never share it / never upload to GitHub).
3. Put the downloaded file in the project folder, next to `package.json`, and name it exactly `serviceAccountKey.json`.
   The code in `src/firebase.js` loads it the same way as Firebase's own sample code:
   ```js
   var serviceAccount = require("../serviceAccountKey.json");
   admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
   ```
   Nothing about Firebase goes in `.env` when you use the key file.
4. **Deploying with this file:**
   - `netlify.toml` already ships the file with the API function (`included_files`).
   - The file is listed in `.gitignore`, so GitHub does not get it. If you deploy from GitHub, remove the line
     `serviceAccountKey.json` from `.gitignore` and use a **private** repository only. Anyone who can read this file can read and change your whole database.
   - Safer option: deploy with the Netlify CLI (`netlify deploy --prod`), which uploads the file from your PC and never puts it on GitHub.
   - Other option, no key file at all: set `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL` and `FIREBASE_PRIVATE_KEY` in Netlify. They are used only when the file is missing.

## Part 2 - Google Drive (resume storage)

Use the Google account that should own the resumes (for example `aakarfoundry14@gmail.com`).
Files are saved with an OAuth "refresh token" (service accounts cannot upload to a normal My Drive).

**A. Turn on the Drive API**
1. Go to https://console.cloud.google.com and select the **same project** as your Firebase project (top bar).
2. **APIs & Services -> Library** -> search **Google Drive API** -> **Enable**.

**B. OAuth consent screen**
1. **APIs & Services -> OAuth consent screen** (or "Google Auth platform") -> **Get started**.
2. App name `Aakar Exam`, support email = your email. Audience / user type: **External**. Finish.
3. **Data access / Scopes -> Add or remove scopes** -> add `.../auth/drive.file` (Drive: "See, edit, create, and delete only the specific Google Drive files you use with this app") -> Save.
4. **Audience -> Publish app -> In production.**
   **Important:** if the app stays in "Testing", Google expires the refresh token after 7 days and resume uploads will suddenly stop.
   The `drive.file` scope does not need Google verification.

**C. Create the OAuth client**
1. **APIs & Services -> Credentials -> Create credentials -> OAuth client ID**.
2. Application type: **Web application**. Name: `Aakar Exam`.
3. **Authorized redirect URIs -> Add URI:** `https://developers.google.com/oauthplayground`
4. Create. Copy the **Client ID** and **Client secret** into `.env` as `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.

**D. Get the refresh token (OAuth Playground)**
1. Open https://developers.google.com/oauthplayground
2. Click the **gear icon (top right)** -> tick **Use your own OAuth credentials** -> paste your Client ID and Client secret. (Access type should be *Offline*.)
3. In the box "Input your own scopes" (left, step 1) type `https://www.googleapis.com/auth/drive.file` -> **Authorize APIs**.
4. Sign in with the Google account that should own the resumes -> Continue / Allow. (If you see "Google hasn't verified this app", click **Advanced -> Go to ... (unsafe)**; it is your own app.)
5. Step 2: click **Exchange authorization code for tokens**.
6. Copy the **Refresh token** into `.env` as `GOOGLE_REFRESH_TOKEN`.

## Part 3 - Install, seed, and test on your PC

```bash
npm install
cp .env.example .env        # then fill the values from Parts 1 and 2 plus JWT_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD
npm run seed                # creates the admin login + default exam settings + company About text (once)
npm run seed:samples        # optional: demo colleges, places and sample questions
npm test                    # automatic tests for the API, the Netlify function and both web pages (no Firebase or Drive needed)
npm start                   # API on http://localhost:5000/api/health
```
`npm run seed` must be run on your PC (not on Netlify). It writes into the same Firestore that Netlify will use.

## Part 4 - Deploy on Netlify

1. Put the project in a **GitHub** repository (the `.gitignore` already keeps `.env` and `serviceAccountKey.json` out). Do not commit secrets.
2. https://app.netlify.com -> **Add new site -> Import an existing project** -> choose the repo.
   The build settings are read from `netlify.toml` (publish folder `public`, functions `netlify/functions`). Leave the build command empty.
3. Before deploying, open **Site configuration -> Environment variables -> Add a variable** and add:

   | Name | Value |
   |---|---|
   | `JWT_SECRET` | long random text |
   | `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` | from Part 1 (for the private key paste the text **with** the `\n` characters, without the surrounding quotes) |
   | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN` | from Part 2 |
   | `DRIVE_ROOT_FOLDER_NAME` (optional) | main Drive folder name |

   You do **not** need `ADMIN_EMAIL` / `ADMIN_PASSWORD` on Netlify (the seed already created the admin).
4. **Deploy site.** Then open `https://YOUR-SITE.netlify.app/api/health` - you should see `{"ok":true,...}`.
5. **Scheduled function:** after the deploy, open **Logs -> Functions -> autosubmit** (or Functions list). It runs every minute on the published (production) deploy.

Alternative with the Netlify CLI: `npm i -g netlify-cli`, `netlify login`, `netlify init`, `netlify env:import .env`, `netlify deploy --prod`.
Run everything locally like Netlify does with `netlify dev` (http://localhost:8888).

---------------------------------------------------------------------

## Exam flow (same as before)
1. `GET /api/public/landing` -> company name, About, rules, form dropdowns.
2. `POST /api/student/register` (multipart, resume field `resume`, PDF/DOC/DOCX **max 4 MB**) -> token. Returning student: `POST /api/student/login` (email + contact).
3. `GET /api/student/status` -> `mocks_pending` -> `waiting` (countdown `msToStart`) -> `ready` -> `in_progress` -> `submitted`.
   The frontend should run the countdown itself from `msToStart` and call status again only every **30 seconds** (saves database reads).
4. 3 mock tests: `GET /api/student/mocks/:n/questions`, `POST /api/student/mocks/:n/submit` -> shows only attempted questions, correct/wrong, score.
5. `POST /api/student/exam/start` -> questions + `endsAt`. Everyone's timer ends at **scheduled start + duration**.
   Auto-save with `PUT /api/student/exam/answers` about **every 60 seconds** (and when the student leaves a question), then `POST /api/student/exam/submit`.
6. **Auto-submit:** the browser submits when its timer reaches 0. If the student closed the browser, the scheduled function submits the saved answers (about 10-70 seconds after the end). Only attempted questions are graded.
7. Result stays hidden until the admin publishes: `GET /api/student/result`.

## Marking types (`markingType`)
| value | correct | wrong | unattempted |
|---|---|---|---|
| `positive` | `+positiveMarks` | 0 | 0 |
| `negative` | 0 | `-negativeMarks` | 0 |
| `both` | `+positiveMarks` | `-negativeMarks` | 0 |

A single question can override with its own `marks` / `negativeMarks`.

## API reference

**Public:** `GET /api/public/landing`, `GET /api/public/time`

**Student** (`Authorization: Bearer <token>`): `POST /api/student/register`, `POST /api/student/login`, `GET /api/student/status`,
`GET /api/student/mocks/:n/questions`, `POST /api/student/mocks/:n/submit`, `GET /api/student/mocks/:n/result`,
`POST /api/student/exam/start`, `PUT /api/student/exam/answers`, `POST /api/student/exam/submit`, `GET /api/student/result`

**Admin** (`POST /api/admin/login`, then `Authorization: Bearer <token>`):

| Method | URL | Purpose |
|---|---|---|
| POST | `/api/admin/login` , `/api/admin/change-password` | login / change password |
| GET/PUT | `/api/admin/exam-config` | `examName`, `startTime` (`"2026-10-20T10:15"` = India time), `durationMinutes`, `markingType`, `positiveMarks`, `negativeMarks`, `gradeGreatFrom`, `gradeVeryGoodFrom`, `gradeExcellentFrom`, `shortlistFromMarks`, `mockCount`, `requireMocks`, `registrationOpen`, `rules[]`, `testForOptions[]`, `branchOptions[]`, `shortlistMessage`, `rejectMessage` |
| GET/PUT | `/api/admin/company` | name, tagline, about, website, highlights[], address, phone, email |
| POST | `/api/admin/company/logo` | multipart field `logo` (PNG/JPG/WEBP, max 300 KB) |
| GET/POST/PUT/DELETE | `/api/admin/colleges`, `/api/admin/places` | POST `{name}` or `{names:[...]}` |
| GET/POST/PUT/DELETE | `/api/admin/questions` | + `POST /questions/bulk`, `POST /questions/upload` (CSV), `DELETE /questions?set=mock1&confirm=yes` |
| GET | `/api/admin/dashboard` | totals + college-wise + place-wise: registered, attended, submitted, in progress, not started, pending, average score |
| GET | `/api/admin/students` | filters `collegeId, placeId, status, q, page, limit`; each row has the Google Drive `resumeUrl` |
| GET | `/api/admin/students/:id` | one student |
| PATCH | `/api/admin/students/:id/decision` | manual shortlist / reject |
| DELETE | `/api/admin/students/:id/attempt` | let a student restart (technical problem) |
| GET | `/api/admin/results`, `/api/admin/results/export` | ranked list / CSV |
| POST | `/api/admin/results/publish`, `/api/admin/results/unpublish` | publish shortlist/reject results |

Question set names: `exam`, `mock1`, `mock2`, `mock3`. CSV columns:
`question,optionA,optionB,optionC,optionD,correct,marks,negativeMarks,explanation` (`correct` = A/B/C/D).

## Free limits (Firestore Spark plan) - read before exam day
Firestore free quota per day: about **50,000 reads** and **20,000 writes**. Rough use per student: 3-5 writes for registration + mocks,
plus about 1 write per minute of exam time for auto-save. So a 60-minute exam is roughly 65 writes per student:
- up to about **250 students** per day is fine on the free plan,
- for more, switch the Firebase project to the Blaze plan (the same free quota still applies, you only pay above it, usually a few rupees).
Tips: auto-save every 60 s, poll status every 30 s, and open the admin dashboard on demand (it reads every student once per refresh).

## Good to know
- Resume links open only for the Google account that owns the Drive (the account you connected). Share the Drive folder with HR if others need access.
- Netlify limits a request to about 6 MB, so resumes are limited to 4 MB.
- If two students register at the same second on a brand-new college, Drive may create two folders with the same college name. Harmless; just merge them.
- Returning-student login is email + contact number (no OTP).
- Exam start time without a time zone is read as India time (+05:30). Send `2026-10-20T10:15:00+05:30` to be explicit.
- Admin dashboard also closes any still-open attempt after the exam end, so numbers are final even if the scheduler is late.


## Result grades, percentage and shortlist rule

Only the **main exam** decides anything. Mock tests never show a shortlist or reject status.

| Marks (example: 30 marks) | Grade | Status by the marks rule |
|---|---|---|
| 26 to 30 | Excellent | Shortlisted |
| 21 to 25 | Very Good | Shortlisted |
| 15 to 20 | Great | Rejected (admin can move to Shortlisted) |
| 0 to 14 | Fail | Rejected |

- **Percentage** = marks scored / total marks x 100 (15 of 30 = 50%).
- All four limits are set in **Exam settings > Result grades** (the limits are marks, not percentile). To shortlist Great students too, set "Shortlist from" to 15.
- In **Results** the admin sees Marks, Percentage and Grade, can filter "Shortlisted by marks" / "Rejected by marks", and can move any student between the two lists ("Use marks rule" undoes a manual move).
- Students see **nothing** (no grade, no shortlist or reject) until the admin clicks **Publish results**. After that they see marks, percentage, grade and the message.
- The resume is optional on the registration form.

## Result visibility and deleting records

- A student sees a result only after the admin clicks **Publish results**, and only for exams that were submitted before that click. Exams submitted later stay hidden until **Publish again**. If an earlier test left results published, click **Hide results** before the real exam.
- **Delete** (Students and Results pages) removes the student's details, mock scores, exam answers and result, and moves the resume to the Google Drive trash. It cannot be undone.
- Exam answers are kept in the browser (all tabs) and saved to the server a few seconds after each change, when the tab is hidden and every minute.

## Tab-switch rule (live exam only)

If a student switches to another tab or window during the live exam, a warning appears when they return and **all selected answers are cleared** (the timer keeps running). Each switch is counted on the server (shown as "Tab switches" in Students, Results and the CSV). Mock tests follow the same rule (warning + answers cleared) but nothing is counted or stored for the company.
- Turn the clearing off in Admin > Exam settings (the switches are still counted).
- Rule text stored earlier in Firestore is not rewritten automatically: add the new rule in Exam settings > Rules.
- Clicking the browser address bar or Alt+Tab to another app also counts as leaving.

## Marks always come from Exam settings
The "positive marks" and "negative marks" in Admin > Exam settings are used for every question. Per-question `marks` / `negativeMarks` (admin form or CSV) are ignored, so scoring can't differ between questions. To re-grade finished exams after changing the setting, use "Reset exam" for that student.
