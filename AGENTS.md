# Agent guide

## Scope

Read `ideation.md`, `PRD.md`, and `TRD.md` before changing product behavior. This release is a deployable skeleton, not the full MVP. Preserve existing documents. Keep host, invitation, participant, profile, auth, database and AI features as explicit placeholders until requested.

Limit file work to this SMCC folder and repository `kimhyunbin08/SMCC`. Do not inspect or modify other folders/repositories. Azure changes must remain in this project's resource group. The existing smcc.global website is separate; do not alter its domain or copy its assets.

## Conventions

- Use Node.js 24 LTS built-ins and plain HTML/CSS for the current skeleton.
- Keep UI copy in Korean, responsive and accessible. Do not add fake working flows.
- Serve only allowlisted public assets; never expose source, documents or environment files.
- Log unexpected operational errors and return an appropriate failure response.
- Keep `/healthz` backward compatible and expose `APP_REVISION` for deployment verification.
- Do not store personal data or infer profiles from social links. Future AI text requires user review and approval.
- Never commit secrets, Azure tokens, publish profiles or `.env` files.
- Update related docs when changing HTTP contracts, container ports or deployment.

## Validation

Run `npm test` and `docker compose config --quiet`. For container changes, also run `docker compose up --build -d --wait`, verify `/` and `/healthz` on localhost:3000, then `docker compose down`. There is no dependency installation or build step currently.

## Deployment

Only main deploys through `.github/workflows/deploy.yml`. Use immutable SHA image tags and project-scoped OIDC. Do not broaden Azure roles to subscription scope. Keep Compose local; Container Apps runs the same Dockerfile, not the Compose YAML. `scripts/setup-azure.sh` creates billable project resources: run it only for an explicitly requested deployment and do not delete resources outside the project's resource group. Do not open a PR unless requested.
