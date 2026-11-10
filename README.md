# QuickDish API

Backend API for **QuickDish**, a restaurant ordering platform. Customers browse the menu by category, add dishes to a cart and place orders without a waiter. Admins manage the menu and move each order through its lifecycle: pending → in preparation → ready → delivered.

The API is built with [Hono](https://hono.dev/) and runs on [Cloudflare Workers](https://developers.cloudflare.com/workers/).

## Related repositories

| Repository        | Description                                     |
| ----------------- | ----------------------------------------------- |
| `quickdish-api`   | This repository: REST API on Cloudflare Workers |
| `quickdish-web`   | React frontend on Cloudflare Pages              |
| `quickdish-infra` | Terraform code for the Cloudflare resources     |

## Tech stack

| Component        | Technology                          |
| ---------------- | ----------------------------------- |
| Runtime          | Cloudflare Workers                  |
| Framework        | Hono                                |
| Language         | TypeScript                          |
| Database         | Cloudflare D1 (SQLite)              |
| ORM              | Prisma                              |
| Validation       | Zod                                 |
| Authentication   | JWT                                 |
| Testing          | Vitest + Hono testing utilities     |
| Code quality     | ESLint + Prettier                   |
| Containerization | Docker (image hosted on Docker Hub) |

Some of these are not set up yet; the project is in its initial scaffolding stage.

## Getting started

### Prerequisites

- [Node.js](https://nodejs.org/) 24 LTS
- [pnpm](https://pnpm.io/) 12 (the exact version is pinned in `package.json`)

### Install and run

```bash
pnpm install
pnpm dev
```

The API is served at `http://localhost:8787`. Check that it is running:

```bash
curl http://localhost:8787/health
# {"status":"ok"}
```

## Scripts

| Command           | Description                                                      |
| ----------------- | ---------------------------------------------------------------- |
| `pnpm dev`        | Start the local development server with Wrangler                 |
| `pnpm run deploy` | Deploy the Worker to Cloudflare (requires `pnpm wrangler login`) |
| `pnpm cf-typegen` | Regenerate binding types after changing `wrangler.jsonc`         |

Use `pnpm run deploy`, not `pnpm deploy`: `pnpm deploy` is a built-in pnpm command that does something else.

## Contributing

### Branch strategy

We use **GitHub Flow**:

1. Create a short-lived branch from `main` named `<type>/<short-description>`, for example `feat/cart-items` or `fix/order-cancel-status`.
2. Open a pull request to `main` and get it approved by a teammate.
3. Merging to `main` runs the pipeline: tests → deploy to Dev → manual approval → deploy to Prod.

### Commit messages

Commits follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(cart): reject unavailable products

- Return 409 when the product has available = false
- Add unit tests for the availability check
```
