import { AuthenticateWithRedirectCallback } from "@clerk/nextjs";
import { AuthFrame } from "@/components/auth/auth-frame";

export default function SignUpSSOCallbackPage() {
  // For OAuth sign-ups, signUp.create() runs here in the redirect callback, so
  // Clerk's bot-protection CAPTCHA needs the #clerk-captcha element present —
  // otherwise it falls back to an invisible widget that can hard-block real
  // users falsely flagged as bots. The AuthFrame gives a branded loading state
  // instead of a blank screen while the callback resolves.
  return (
    <AuthFrame
      title="Signing you in…"
      description="One moment while we finish setting up your account."
    >
      <div id="clerk-captcha" />
      <AuthenticateWithRedirectCallback />
    </AuthFrame>
  );
}
