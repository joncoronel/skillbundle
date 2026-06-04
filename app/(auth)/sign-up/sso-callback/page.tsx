import { AuthenticateWithRedirectCallback } from "@clerk/nextjs";

export default function SignUpSSOCallbackPage() {
  // Bot protection runs during account creation, which for OAuth completes
  // here in the redirect callback. Render the #clerk-captcha element so Clerk's
  // Smart CAPTCHA can mount instead of falling back to the Invisible widget.
  return (
    <>
      <AuthenticateWithRedirectCallback />
      <div id="clerk-captcha" />
    </>
  );
}
