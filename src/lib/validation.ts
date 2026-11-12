import { zValidator } from "@hono/zod-validator";
import type { ValidationTargets } from "hono";
import type { ZodType } from "zod";
import { errorBody } from "./errors";

/**
 * `zValidator` that answers invalid input with a 400 in the shared error format.
 * `details` lists each problem as `{ path, message }`.
 *
 * @example app.post("/categories", validate("json", createCategorySchema), handler)
 */
export function validate<
  Target extends keyof ValidationTargets,
  Schema extends ZodType
>(target: Target, schema: Schema) {
  return zValidator(target, schema, (result, c) => {
    if (!result.success) {
      const details = result.error.issues.map(issue => ({
        path: issue.path.join("."),
        message: issue.message
      }));
      return c.json(
        errorBody("VALIDATION_ERROR", "Invalid request", details),
        400
      );
    }
  });
}
