"use client";

import * as React from "react";
import { useSignIn } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/cubby-ui/input";
import { AuthFrame } from "./auth-frame";
import { OAuthButtons } from "./oauth-buttons";
import {
  AuthCrossLink,
  AuthDivider,
  AuthFieldError,
  AuthFieldLabel,
  AuthFormError,
  AuthSubmitButton,
  resolveClerkErrorMessage,
} from "./shared";

export function SignInForm() {
  const { signIn, errors } = useSignIn();
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const router = useRouter();

  // Cache Components keeps this route mounted via React Activity on
  // navigation, which otherwise preserves input values between visits.
  // Clear form state when the route becomes hidden.
  React.useLayoutEffect(() => {
    return () => {
      setEmail("");
      setPassword("");
    };
  }, []);

  const identifierError = errors?.fields?.identifier;
  const passwordError = errors?.fields?.password;
  const globalErrorMessages =
    errors?.global?.map((e) => resolveClerkErrorMessage(e)) ?? [];

  const submit = async () => {
    const { error } = await signIn.password({
      identifier: email,
      password,
    });
    if (error) return;

    if (signIn.status === "complete") {
      await signIn.finalize({
        navigate: ({ session, decorateUrl }) => {
          if (session?.currentTask) return;
          const url = decorateUrl("/");
          if (url.startsWith("http")) {
            window.location.href = url;
          } else {
            router.push(url);
          }
        },
      });
    }
  };

  return (
    <AuthFrame
      title="Sign in."
      description="Welcome back."
      footer={
        <AuthCrossLink href="/sign-up">
          new here? create account →
        </AuthCrossLink>
      }
    >
      <div className="flex flex-col gap-8">
        <OAuthButtons mode="sign-in" />

        <AuthDivider label="or email" />

        <form action={submit} className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <AuthFieldLabel htmlFor="email">Email</AuthFieldLabel>
            <Input
              id="email"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              aria-invalid={identifierError ? true : undefined}
              aria-describedby={identifierError ? "email-error" : undefined}
            />
            {identifierError && (
              <AuthFieldError
                id="email-error"
                message={resolveClerkErrorMessage(
                  identifierError,
                  "email address",
                )}
              />
            )}
          </div>

          <div className="flex flex-col gap-2">
            <AuthFieldLabel htmlFor="password">Password</AuthFieldLabel>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              aria-invalid={passwordError ? true : undefined}
              aria-describedby={passwordError ? "password-error" : undefined}
            />
            {passwordError && (
              <AuthFieldError
                id="password-error"
                message={resolveClerkErrorMessage(passwordError)}
              />
            )}
          </div>

          <AuthFormError messages={globalErrorMessages} />

          <AuthSubmitButton
            idleLabel="Sign in"
            pendingLabel="Signing in"
            className="mt-2"
          />
        </form>
      </div>
    </AuthFrame>
  );
}
