# AGENTS.md

Guidance for AI coding agents working in this repository.

## Project context

QuickDish is a restaurant ordering platform built as the final project for the ITESO course "Infraestructura para el Desarrollo Continuo" (DevOps). Customers browse a menu by category, add dishes to a cart, and place orders without a waiter. Admins manage the menu (categories, products, availability) from a panel and move each order through its lifecycle. There are two roles, customer and admin, with authentication. Real payments are out of scope.

This repo is **only the backend API**. The project is split across three repos:

| Repo                       | Contents                                 | Hosting                 |
| -------------------------- | ---------------------------------------- | ----------------------- |
| `quickdish-api` (this one) | Hono REST API                            | Cloudflare Workers + D1 |
| `quickdish-web`            | React + TypeScript + Vite + Tailwind SPA | Cloudflare Pages        |
| `quickdish-infra`          | Terraform for the Cloudflare resources   | —                       |

The frontend and backend are deliberately separate deployments. Don't merge them into one Worker with static assets.

## Commands

The package manager is **pnpm**.

```bash
pnpm install
pnpm dev            # local server via wrangler dev (http://localhost:8787)
pnpm run deploy     # wrangler deploy --minify  (NOT `pnpm deploy`, a different built-in pnpm command)
pnpm cf-typegen     # regenerate worker-configuration.d.ts from wrangler.jsonc
```

Lint, format, typecheck, test and build scripts are not set up yet. Check `package.json` for what exists before running anything.

## Architecture

- `src/index.ts` exports a Hono app as the Worker's default export. The only route so far is `GET /health`.
- Bindings (D1, secrets, vars) are declared in `wrangler.jsonc` and typed through the global `CloudflareBindings` interface in `worker-configuration.d.ts`, which is generated. Use `new Hono<{ Bindings: CloudflareBindings }>()` and access bindings via `c.env`. After any change to `wrangler.jsonc`, rerun `pnpm cf-typegen` and commit the regenerated file. Never edit it by hand.
- The code runs in the Workers runtime, not Node.js. Node-only libraries (native addons such as `bcrypt`, `fs`-dependent packages) won't work. Prefer Web Standard APIs (`crypto.subtle`, `fetch`, `Request`/`Response`), and keep per-request CPU low: the free plan has tight CPU-time limits.
- `observability.enabled` in `wrangler.jsonc` turns on Workers logs and traces. Keep it enabled.
- Planned stack: D1 (SQLite) through Prisma ORM, Zod for validation, JWT for authentication, Vitest with Hono's `app.request()` for tests, ESLint + Prettier, and a Docker image published to Docker Hub. Prisma on D1 needs the D1 driver adapter. Schema changes are applied as SQL migrations with `wrangler d1 migrations apply`, not with `prisma migrate deploy`.
- Planned environments: separate Dev and Prod Workers, each bound to its own D1 database. Terraform in `quickdish-infra` creates those databases.

## Domain model (starting point)

These entities and rules are a starting point that the team will refine. Don't treat them as fixed requirements.

**All code is in English**: entities, fields, variables, enum values, routes, and database tables and columns.

| Entity                | Notes                                                                                    |
| --------------------- | ---------------------------------------------------------------------------------------- |
| `User`                | name, email, passwordHash, role, createdAt                                               |
| `Role`                | `CUSTOMER`, `ADMIN`                                                                      |
| `Category`            | name, description, active; groups products                                               |
| `Product`             | name, description, price, imageUrl, available, categoryId                                |
| `Cart` / `CartItem`   | a user has at most one cart; an item has productId, quantity, notes                      |
| `Order` / `OrderItem` | an order has status, total, notes, createdAt; an item has productId, quantity, unitPrice |
| `OrderStatus`         | `PENDING` → `IN_PREPARATION` → `READY` → `DELIVERED`, plus `CANCELLED`                   |

Business rules:

- An order can only be cancelled while it is `PENDING`.
- `OrderItem` stores the `unitPrice` at purchase time, so later product price changes don't alter past orders.
- Products with `available = false` cannot be added to a cart.
- Orders are created from the cart. Customers create and cancel their own orders; admins change order status.

## Git conventions

The branch strategy is **GitHub Flow**:

- `main` is the only long-lived branch and must always be deployable.
- Work happens on short-lived branches created from `main`, named `<type>/<short-description>`, where `<type>` is a Conventional Commits type (e.g. `feat/cart-items`, `fix/order-cancel-status`).
- Changes reach `main` through a pull request approved by a teammate.
- Every merge to `main` runs the pipeline: tests → deploy to Dev → manual approval → deploy to Prod.

Commits:

- Use [Conventional Commits](https://www.conventionalcommits.org/) (`type(scope): subject`). When a commit needs a body, write it as bullet points.
- Never add a `Co-Authored-By` trailer or any other AI attribution to commits or PRs.
