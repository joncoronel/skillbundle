import { AuthenticateWithRedirectCallback } from "@clerk/nextjs";
import { AuthFrame } from "@/components/auth/auth-frame";

export default function SignInSSOCallbackPage() {
  // OAuth sign-in for a not-yet-registered user transfers into sign-up, whose
  // bot-protection CAPTCHA completes here — so #clerk-captcha must be present
  // (without it Clerk's invisible fallback can hard-block falsely-flagged
  // users). The AuthFrame avoids a blank screen while the callback resolves.
  return (
    <AuthFrame title="Signing you in…" description="One moment.">
      <div id="clerk-captcha" />
      <AuthenticateWithRedirectCallback />
    </AuthFrame>
  );
}
