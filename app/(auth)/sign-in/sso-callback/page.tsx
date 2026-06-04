import { AuthenticateWithRedirectCallback } from "@clerk/nextjs";

export default function SignInSSOCallbackPage() {
  // A sign-in via OAuth for a not-yet-registered user transfers into sign-up,
  // whose bot-protection challenge completes here. Provide #clerk-captcha so
  // Smart CAPTCHA can mount rather than falling back to the Invisible widget.
  return (
    <>
      <AuthenticateWithRedirectCallback />
      <div id="clerk-captcha" />
    </>
  );
}
