# amzai-platform

Amzai Operations Platform. Internal tool for running executive events and demand programmes.

- `SPEC.md` — what the product is, the data model, the rules.
- `DESIGN.md` — the design system.
- `CLAUDE.md` — how to work in this repo.

## Running it locally

You need Node 20 or newer. Check with `node --version`.

1. Install the dependencies. Once, and again whenever they change.

   ```
   npm install
   ```

2. Create your local settings file. Copy `.env.example` and name the copy `.env.local`, then fill in the three values from the Supabase dashboard. `.env.example` explains where each one is found.

   `.env.local` is ignored by git and never leaves your machine.

3. Start the app.

   ```
   npm run dev
   ```

4. Open <http://localhost:3000>. It opens the programme list. The environment check, which lists the three variables and whether each is set without ever showing their values, is at <http://localhost:3000/health>.

Stop the server with `Ctrl` and `C` in the same terminal.

## The other commands

| Command | What it does |
|---|---|
| `npm run dev` | Runs the app locally with live reload. The one you will use. |
| `npm run build` | Checks the whole app compiles. Run before committing. |
| `npm run typecheck` | Checks the types only. Faster than a build. |
| `npm run lint` | Checks code style. |
| `npm run cf:build` | Builds the Cloudflare Worker version. Not needed yet. |
| `npm run cf:preview` | Runs the Cloudflare version locally. Not needed yet. |
| `npm run cf:deploy` | Deploys to Cloudflare. Not until there is something to deploy. |

Stop `npm run dev` before running `npm run build`. Both write to the same `.next` folder, and running them together can leave duplicate generated files that make `npm run typecheck` report errors that are not in your code. If that happens, delete the `.next` folder and build again.

## The styleguide

`http://localhost:3000/styleguide` renders every shared component in every state, with a live contrast audit computed from the current token values. Check it after any change to `app/globals.css` or anything in `/components`.

## Status

Scaffold only. No database tables, no design system, no screens yet.
