import type { Metadata } from "next";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";

/**
 * Nested under `/sign-in` rather than sitting at `/reset-password`, for two
 * reasons that both already exist in the codebase:
 *
 *   - `app/robots.ts` disallows the `/sign-in/` prefix, so this is excluded
 *     from crawling without a new rule, and `lib/sitemap-entries.ts` already
 *     reserves `sign-in` against the `/[org]` catch-all. A root-level
 *     `/reset-password` would have needed both edits.
 *   - `proxy.ts` treats the auth routes as one group.
 */
export const metadata: Metadata = {
  title: "Reset password",
  // A recovery form has nothing to offer search, and the flow it starts is
  // meaningless without the emailed code.
  robots: { index: false, follow: false },
};

export default function ResetPasswordPage() {
  return <ResetPasswordForm />;
}
