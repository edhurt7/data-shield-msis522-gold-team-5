# Welcome to your Lovable project

## Project info

**URL**: https://lovable.dev/projects/REPLACE_WITH_PROJECT_ID

## How can I edit this code?

There are several ways of editing your application.

**Use Lovable**

Simply visit the [Lovable Project](https://lovable.dev/projects/REPLACE_WITH_PROJECT_ID) and start prompting.

Changes made via Lovable will be committed automatically to this repo.

**Use your preferred IDE**

If you want to work locally using your own IDE, you can clone this repo and push changes. Pushed changes will also be reflected in Lovable.

The only requirement is having Node.js & npm installed - [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating)

Follow these steps:

```sh
# Step 1: Clone the repository using the project's Git URL.
git clone <YOUR_GIT_URL>

# Step 2: Navigate to the project directory.
cd <YOUR_PROJECT_NAME>

# Step 3: Install the necessary dependencies.
npm i

# Step 4: Start the development server with auto-reloading and an instant preview.
npm run dev
```

**Edit a file directly in GitHub**

- Navigate to the desired file(s).
- Click the "Edit" button (pencil icon) at the top right of the file view.
- Make your changes and commit the changes.

**Use GitHub Codespaces**

- Navigate to the main page of your repository.
- Click on the "Code" button (green button) near the top right.
- Select the "Codespaces" tab.
- Click on "New codespace" to launch a new Codespace environment.
- Edit files directly within the Codespace and commit and push your changes once you're done.

## What technologies are used for this project?

This project is built with:

- Vite
- TypeScript
- React
- shadcn-ui
- Tailwind CSS

## How can I deploy this project?

Simply open [Lovable](https://lovable.dev/projects/REPLACE_WITH_PROJECT_ID) and click on Share -> Publish.

## Can I connect a custom domain to my Lovable project?

Yes, you can!

To connect a domain, navigate to Project > Settings > Domains and click Connect Domain.

Read more here: [Setting up a custom domain](https://docs.lovable.dev/features/custom-domain#custom-domain)

## Local milestone run

To run the current FastPeopleSearch local milestone harness with the live LLM path:

```sh
$env:AGENT_LLM_BASE_URL="https://api.openai.com/v1"
$env:AGENT_LLM_API_KEY="YOUR_KEY"
$env:AGENT_LLM_MODEL="gpt-4.1-mini"
npm run milestone:fps
```

By default this uses a fixture confirmation browser so the broker-specific workflow, handoff, automation adapter, and result interpretation complete locally without a backend. The run summary is written to `artifacts/milestones/fastpeoplesearch-latest.json`.

Optional:

```sh
$env:AGENT_FPS_BROWSER_MODE="live_browser"
npm run milestone:fps
```

`live_browser` attempts a real Playwright browser run against the site and may fail due to anti-bot controls.

## Local demo recording flow

If you want to drive the prototype UI for a recorded demo without a deployed backend, run two local processes:

```sh
# terminal 1
$env:AGENT_LLM_BASE_URL="https://api.openai.com/v1"
$env:AGENT_LLM_API_KEY="YOUR_KEY"
$env:AGENT_LLM_MODEL="gpt-4.1-mini"
npm run demo:server

# terminal 2
npm run dev
```

Then open the dashboard in the browser and use the `Local Demo Runner` panel:

- `Run Demo Success Path`: live LLM workflow + local deterministic confirmation browser
- `Run Live Site Attempt`: live LLM workflow + real Playwright browser attempt against FastPeopleSearch

The localhost demo server listens on `http://127.0.0.1:8787` and exposes:

- `POST /demo/run-fastpeoplesearch`
- `GET /demo/run-fastpeoplesearch/latest`
- `POST /demo/runs`
- `GET /demo/runs/latest`

`POST /demo/runs` accepts an optional JSON body:

```json
{
  "browserMode": "fixture_confirmation",
  "siteIds": ["spokeo", "whitepages", "truepeoplesearch", "fastpeoplesearch", "radaris"]
}
```

If `siteIds` is omitted, the multi-site harness runs every supported demo adapter.
