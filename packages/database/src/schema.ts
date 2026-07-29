import { authSchema } from "./auth-schema";
import * as businessSchema from "./business-schema";

export * from "./auth-schema";
export * from "./business-schema";

export const schema = {
  ...authSchema,
  ...businessSchema,
};
