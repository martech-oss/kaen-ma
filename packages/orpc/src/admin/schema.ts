import * as z from "zod";

function isAdminRequestPath(path: string): boolean {
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\")) {
    return false;
  }
  try {
    const url = new URL(path, "http://kaenma.internal");
    return (
      url.origin === "http://kaenma.internal" &&
      !url.pathname.startsWith("/api/") &&
      !url.pathname.startsWith("/auth")
    );
  } catch {
    return false;
  }
}

const adminRequestPathSchema = z
  .string()
  .min(1)
  .max(2048)
  .refine(isAdminRequestPath, "管理画面APIの相対パスを指定してください");

export const adminRequestInputSchema = z.object({
  path: adminRequestPathSchema,
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
  body: z.string().optional(),
});

export type AdminRequestInput = z.infer<typeof adminRequestInputSchema>;

export const adminRequestOutputSchema = z.object({
  status: z.number().int().min(100).max(599),
  payload: z.unknown(),
});

export type AdminRequestOutput = z.infer<typeof adminRequestOutputSchema>;
