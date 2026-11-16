# Agent guide

## Scope

Read `ideation.md`, `PRD.md`, and `TRD.md` before changing product behavior. The user explicitly requested the basic MVP: username/password, editable link profile, host teams, direct invitation join and announcement inbox. Preserve historical planning and feedback-loop proposals; AI and LinkedIn import remain unconfigured, not working features.

The current release sections supersede older approval-flow/magic-link/PostgreSQL proposals. Documentation-only tasks must not trigger deployment. Only SMCC Table Storage Standard LRS was explicitly approved as new paid storage; do not infer approval for other resources. Operator/support information belongs in runtime settings, not the public repository.

Limit file work to this SMCC folder and repository `kimhyunbin08/SMCC`. Do not inspect or modify other folders/repositories. Azure changes must remain in this project's resource group. The existing smcc.global website is separate; do not alter its domain or copy its assets.

## Conventions

Latest user requirements keep synthetic previews separate from anonymously browsable Home/Coffee chats/Cafes/Profile service tabs. Coffee-chat applications offer guest receipt or authenticated-member paths. Public listing requires host opt-in. Guest receipt possession never grants membership/host access. Guest/member seats share atomic capacity; cafes are host-provided guidance, not scraped/verified listings.

- Visual system: use the warm editorial paper/clay direction, with semantic CSS custom properties in `public/styles.css` for canvas, surfaces, text, borders, actions, focus and status. Consume those tokens throughout components instead of introducing per-component color literals. Use Korean-friendly local/system heading and body font stacks; do not fetch external fonts or copy another site's assets. Preserve high-contrast text, visible keyboard focus and compact mobile navigation.
- Use Node.js 24 LTS and plain HTML/CSS/JavaScript; official Azure identity/Table SDKs are the only runtime dependencies.
- Keep UI copy in Korean, responsive and accessible. Do not add fake working flows.
- Serve only allowlisted public assets; never expose source, documents or environment files.
- Log unexpected operational errors and return an appropriate failure response.
- Keep `/healthz` backward compatible and expose `APP_REVISION` for deployment verification.
- Minimize personal data and require separate opt-in for public/team profile sharing. Do not infer profiles from social links. Future AI text requires user review and approval.
- Never commit secrets, Azure tokens, publish profiles or `.env` files.
- Update related docs when changing HTTP contracts, container ports or deployment.

## Validation

Run `npm ci --ignore-scripts`, `npm test` and `docker compose config --quiet`. For container changes, also run `docker compose up --build -d --wait`, verify `/`, `/healthz` and the actual MVP workflow, then `docker compose down` without deleting the data volume. Use `HOST_PORT=3187` when port 3000 is occupied. There is no frontend build step. Live E2E uses only synthetic data and must delete its fixture afterward.

Browser E2E: `PLAYWRIGHT_BROWSERS_PATH="$PWD/.playwright-browsers" npx playwright install chromium` then `PLAYWRIGHT_BROWSERS_PATH="$PWD/.playwright-browsers" npm run test:browser`. Tests use synthetic in-memory storage and dedicated port3190. Never weaken production rate limits. Keep binaries/reports out of Git/container images.

## Deployment

Only main deploys through `.github/workflows/deploy.yml`. Use immutable SHA image tags and project-scoped OIDC. Do not broaden Azure roles to subscription scope. Keep Compose local; Container Apps runs the same Dockerfile, not the Compose YAML. `scripts/setup-azure.sh` creates billable project resources: run it only for an explicitly requested deployment and do not delete resources outside the project's resource group. Do not open a PR unless requested.
