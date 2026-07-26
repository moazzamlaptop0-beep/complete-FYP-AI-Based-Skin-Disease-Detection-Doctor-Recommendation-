# AI Dermatologist — Frontend

React 19 + Vite + Tailwind. Talks to the Flask backend in `../FYP-backend`.

## Quick start

```bash
npm install
echo "VITE_API_URL=http://localhost:5000" > .env
npm run dev
```

```bash
npm run build     # production bundle
npx vitest run    # unit tests
npm run lint
```

## Layout

```
src/
  App.jsx            the whole route table, derived from routes.js
  routes.js          routes as DATA — navbar, sidebar and tab bar all read this
  components/
    ui/              ~26 primitives (Button, Modal, DataTable, Stepper, ...)
    layout/          AppShell, AppNavbar, DashboardLayout, ProfileMenu, ...
    media/           SensitiveImage — the only way a scan photo is displayed
    auth/            RequireAuth
    landing/ widgets/
  context/           AuthContext, ThemeContext, RealtimeContext
  lib/               api.js (the only HTTP client), endpoints.js, jwt, storage
  features/
    auth/            the single email-first sign-in / sign-up screen
    consult/         the 8-step scan → booking wizard
    patient/ doctor/ admin/
```

### Two rules worth keeping

1. **No component builds a URL.** Every route lives in `lib/endpoints.js` and
   goes through `lib/api.js`, which injects the bearer token and the
   `X-Act-As-User-Id` header, unwraps the response envelope, and refreshes once
   on a 401.
2. **No raw hex.** Colours come from the Tailwind tokens, which is what makes
   dark mode work everywhere rather than in patches.

## Access control

`RequireAuth` guards on **permissions**, never role strings:

```jsx
<RequireAuth permission="scan.read.own">
```

Because the backend roles nest (patient ⊂ doctor ⊂ admin), a doctor can open
their own patient pages on their own account. `WorkspaceSwitcher` moves between
your own surfaces; `ViewAsPicker` (admins only) genuinely acts as another user
and is announced by a persistent banner while active.

## The consult wizard

`/consult` — capture → result → symptoms *(optional)* → doctors *(up to 3)* →
preferred slots *(up to 5, ranked)* → description → review + consent →
confirmation.

One request fans out to several doctors and the first to accept wins; the rest
are withdrawn automatically. Emergency severity raises priority **inside** the
flow rather than being a prerequisite for booking. The draft survives a refresh,
and there are three distinct resets: re-analyze this photo, replace the photo,
or start over.

## Sensitive images

`<SensitiveImage>` never receives a file path. It fetches
`/api/scans/<id>/image?variant=` with the session token; a scan marked sensitive
renders the server-generated blur behind a click-to-reveal overlay that re-blurs
on a timer, on tab-hide and on unmount. Revealing the full image is recorded
server-side.

Deleting a photo destroys the image only — the diagnosis, severity, triage
reasons, doctor's comments and appointments are retained, and the dialog says so
before asking for consent.
