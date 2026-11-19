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

| Component        | Technology                                 |
| ---------------- | ------------------------------------------ |
| Runtime          | Cloudflare Workers                         |
| Framework        | Hono                                       |
| Language         | TypeScript                                 |
| Database         | Cloudflare D1 (SQLite)                     |
| ORM              | Prisma                                     |
| Validation       | Zod                                        |
| Authentication   | JWT                                        |
| Testing          | Vitest + Hono testing utilities            |
| Code quality     | ESLint + Prettier                          |
| Containerization | Docker (isolated test and dev environment) |
| Monitoring (APM) | Sentry (`@sentry/hono`)                    |

## Getting started

### Prerequisites

- [Node.js](https://nodejs.org/) 24 LTS
- [pnpm](https://pnpm.io/) 12 (the exact version is pinned in `package.json`)

### Install and run

```bash
pnpm install
cp .dev.vars.example .dev.vars   # then set JWT_SECRET to a long random string
pnpm dev
```

The API is served at `http://localhost:8787`. Check that it is running:

```bash
curl http://localhost:8787/health
# {"status":"ok","env":"local","version":"local","db":"ok"}
```

### Local database

The local D1 database lives in `.wrangler/state`. Create its tables and load the sample menu once:

```bash
pnpm db:migrate:local
pnpm db:seed:local
```

`/health` reports `"db": "ok"` once D1 answers.

The seed also creates two test users (local and Dev only, never Prod):

| Email                     | Password        | Role       |
| ------------------------- | --------------- | ---------- |
| `admin@quickdish.test`    | `Admin12345`    | `ADMIN`    |
| `customer@quickdish.test` | `Customer12345` | `CUSTOMER` |

### Authentication

`POST /auth/login` returns `{ token, user }`. Send the token on protected routes as `Authorization: Bearer <token>`. It is a JWT (HS256) with `sub`, `role` and `exp` (8 hours), signed with the `JWT_SECRET` secret. Set it once per environment:

```bash
pnpm wrangler secret put JWT_SECRET --env dev
pnpm wrangler secret put JWT_SECRET --env prod
```

### Menu catalog

Reading the menu is public; changing it requires an admin token.

| Endpoint                                  | Who    | Notes                                                                                           |
| ----------------------------------------- | ------ | ----------------------------------------------------------------------------------------------- |
| `GET /categories`                         | Public | Active categories by name                                                                       |
| `GET /categories/:id`                     | Public | Inactive → 404                                                                                  |
| `POST /categories`, `PUT /categories/:id` | Admin  | `{ name, description?, active? }`; repeated name → 409                                          |
| `DELETE /categories/:id`                  | Admin  | With products → 409: deactivate it instead                                                      |
| `GET /products?categoryId=&q=`            | Public | Available products of active categories; `q` searches names                                     |
| `GET /products/:id`                       | Public | Hidden from the menu → 404                                                                      |
| `POST /products`, `PUT /products/:id`     | Admin  | `{ name, description?, priceCents, imageUrl?, available?, categoryId }`; unknown category → 404 |
| `PATCH /products/:id/availability`        | Admin  | `{ available }`                                                                                 |
| `DELETE /products/:id`                    | Admin  | In past orders → 409: mark it unavailable instead                                               |

Admins add `?all=true` to both lists to also see inactive categories and unavailable products.

- `PUT` updates only the fields you send; send `null` to clear `description` or `imageUrl`.
- A product can be created in an inactive category. It stays hidden until the category is activated, which lets admins prepare a menu section before publishing it.
- `q` ignores case but not accents: SQLite `LIKE` only folds ASCII, so `cafe` doesn't match `Café`.

### Cart and orders

Every route needs a token. Each user has one cart, created on first use.

| Endpoint                  | Notes                                                                                             |
| ------------------------- | ------------------------------------------------------------------------------------------------- |
| `GET /cart`               | `{ id, items, totalCents }`; each item has `quantity`, `notes`, `subtotalCents` and its `product` |
| `POST /cart/items`        | `{ productId, quantity, notes? }` → 201; a product already in the cart adds to its quantity       |
| `PATCH /cart/items/:id`   | `{ quantity?, notes? }`                                                                           |
| `DELETE /cart/items/:id`  | Removes the item                                                                                  |
| `DELETE /cart`            | Empties the cart → 204                                                                            |
| `POST /orders`            | `{ notes? }` → 201; turns the cart into a `PENDING` order and empties it                          |
| `GET /orders/mine`        | The user's orders, newest first                                                                   |
| `GET /orders/:id`         | The owner's order, or any order for an admin; otherwise 404                                       |
| `POST /orders/:id/cancel` | Owner only, and only while `PENDING`; otherwise 409 `ORDER_NOT_CANCELLABLE`                       |

The cart mutations return the whole updated cart, so the UI can render it without another request.

- Quantities go from 1 to 20 per product. Adding past 20 → 409 `QUANTITY_LIMIT`.
- Adding a product hidden from the menu → 409 `PRODUCT_UNAVAILABLE`. If a product is hidden after it's in the cart, `GET /cart` shows it with `product.available: false` and `POST /orders` answers 409 with those products in `details`.
- Someone else's cart item or order → 404, so ids of other users aren't revealed.
- Cart totals use current prices. An order item keeps `unitPriceCents` from the moment of purchase, so later price changes don't alter past orders.
- The order, its items and the cart cleanup are written in a single D1 batch (`src/lib/order-batch.ts`), which D1 runs as one transaction: a failure never leaves a half-written order.
- The batch first checks that the cart is still exactly as it was read (same items, quantities, notes and prices, all still on the menu). If not, nothing is written and the API answers 409 `CART_CHANGED`. This stops a double submit from creating two orders and keeps units added while the order was being placed.
- `GET /orders/mine` isn't paginated yet; it returns every order of the user.

### Changing the data model

1. Edit `prisma/schema.prisma` and run `pnpm db:generate`.
2. Create an empty migration: `pnpm wrangler d1 migrations create DB <name>`.
3. Fill it with the SQL diff between the local database and the new schema. Point `DATABASE_URL` in `.env` to the local SQLite file (`file:./.wrangler/state/v3/d1/miniflare-D1DatabaseObject/<hash>.sqlite`) and run:

    ```bash
    pnpm prisma migrate diff --config prisma7.config.ts --from-config-datasource --to-schema prisma/schema.prisma --script --output migrations/<file>.sql
    ```

4. Apply it with `pnpm db:migrate:local`. The pipeline applies the same files to Dev and Prod.

## Docker

The `Dockerfile` builds an isolated environment with Node.js, pnpm and the dependencies already installed. CI runs every check inside it, and you can use it to test or run the API without installing anything but Docker.

```bash
docker build -t quickdish-api .

# Run the same checks as CI
docker run --rm quickdish-api pnpm test
docker run --rm quickdish-api pnpm lint

# Serve the API on http://localhost:8787 (applies the migrations and loads the sample menu first)
docker run --rm -p 8787:8787 quickdish-api
```

Without a `.dev.vars`, the container uses `.dev.vars.example` and its placeholder `JWT_SECRET`. To use your own, add `-v "$PWD/.dev.vars:/app/.dev.vars:ro"`. The local database is recreated on every run; add `-v quickdish-api-d1:/app/.wrangler` to keep it between runs.

Rebuild the image after changing the code: it copies the source when it is built.

## Observability

Sentry (organization `iteso-g5`, project `quickdish`) receives the API's errors, traces and logs. Each event carries the environment (`dev` or `prod`) and the release (the deployed commit SHA). Locally and in tests `SENTRY_DSN` is empty, so Sentry stays off.

| What           | Where in Sentry | Source                                                                                                  |
| -------------- | --------------- | ------------------------------------------------------------------------------------------------------- |
| Errors         | Issues          | Unexpected errors and 5xx responses. 4xx answers (`ApiError`) are expected and not reported.            |
| Traces         | Traces          | One per request, with a span for each middleware and D1 query.                                          |
| Logs (message) | Logs            | `order_created`, `order_status_changed` (info) and `login_failed` (warning, without email or password). |

To produce an error on demand, call `GET /debug/error` with an admin token. It answers the usual 500 and the error shows up in Sentry's Issues with a readable stack trace:

```bash
TOKEN=$(curl -s -H "Content-Type: application/json" \
  -d '{"email":"admin@quickdish.test","password":"Admin12345"}' \
  https://quickdish-api-dev.guillermo-romero.workers.dev/auth/login | jq -r .token)
curl -H "Authorization: Bearer $TOKEN" https://quickdish-api-dev.guillermo-romero.workers.dev/debug/error
```

Metrics (requests and CPU time) are in Cloudflare: **Workers & Pages → quickdish-api-prod → Metrics**. To give the charts data before a demo, send some requests:

```bash
sh scripts/traffic.sh https://quickdish-api-prod.guillermo-romero.workers.dev 300
```

## Scripts

| Command                 | Description                                                           |
| ----------------------- | --------------------------------------------------------------------- |
| `pnpm dev`              | Start the local development server with Wrangler                      |
| `pnpm build`            | Bundle the Worker into `dist/` without deploying                      |
| `pnpm run deploy`       | Deploy the Worker to Cloudflare (requires `pnpm wrangler login`)      |
| `pnpm cf-typegen`       | Regenerate binding types after changing `wrangler.jsonc`              |
| `pnpm cf-typegen:check` | Check that `worker-configuration.d.ts` is up to date (used by CI)     |
| `pnpm typecheck`        | Type-check the project with `tsc`                                     |
| `pnpm lint`             | Lint with ESLint (`pnpm lint:fix` to auto-fix)                        |
| `pnpm format`           | Format all files with Prettier (`pnpm format:check` to only check)    |
| `pnpm test`             | Run the unit tests once (`pnpm test:watch` for watch mode)            |
| `pnpm test:ci`          | Run tests with coverage (`coverage/`) and a JUnit report (`reports/`) |
| `pnpm test:coverage`    | Run tests with coverage only                                          |
| `pnpm db:generate`      | Regenerate the Prisma Client after changing the schema                |
| `pnpm db:migrate:local` | Apply the SQL migrations in `migrations/` to the local D1 database    |
| `pnpm db:seed:local`    | Load the sample menu (`seed/seed.sql`) into the local D1 database     |

Use `pnpm run deploy`, not `pnpm deploy`: `pnpm deploy` is a built-in pnpm command that does something else.

## Contributing

### Branch strategy

We use **GitHub Flow**:

1. Create a short-lived branch from `main` named `<type>/<short-description>`, for example `feat/cart-items` or `fix/order-cancel-status`.
2. Open a pull request to `main` and get it approved by a teammate.
3. Merging to `main` runs the pipeline: tests → deploy to Dev → manual approval → deploy to Prod.

### Pipeline

`.github/workflows/pipeline.yml` runs on every pull request and every push to `main`. It builds the Docker image and, inside it:

- **Test:** checks the generated types, type-checks, lints, checks formatting and runs the unit tests with coverage. The run summary shows the test results, and the `test-report` (JUnit) and `coverage-report` artifacts are attached to the run.
- **Build:** bundles the Worker and attaches it as the `worker-bundle` artifact.

Both jobs must pass before a pull request can be merged.

On a push to `main` (a merged pull request), two more jobs deploy the same image's code:

- **Deploy to Development:** applies the D1 migrations to `quickdish-dev`, loads the sample menu and test users (`seed/seed.sql`), deploys the `quickdish-api-dev` Worker and checks that `/health` reports the new commit.
- **Deploy to Production:** waits until a reviewer approves the `Production` environment, then does the same for `quickdish-prod` and `quickdish-api-prod`, **without** the sample data.

Each deploy job links to its Worker URL on the run page. `JWT_SECRET` and `SENTRY_DSN` come from each GitHub environment's secrets and are uploaded with the new version. Before deploying, the job uploads the Worker's source maps to Sentry (repository secret `SENTRY_AUTH_TOKEN`), so error stack traces point to the TypeScript source.

### Commit messages

Commits follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(cart): reject unavailable products

- Return 409 when the product has available = false
- Add unit tests for the availability check
```
