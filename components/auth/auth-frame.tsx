import Link from "next/link";
import * as React from "react";

interface AuthFrameProps {
  title: string;
  description: string;
  footer?: React.ReactNode;
  children: React.ReactNode;
}

export function AuthFrame({
  title,
  description,
  footer,
  children,
}: AuthFrameProps) {
  return (
    <div className="flex min-h-screen flex-col justify-between px-6 py-8 sm:px-10 sm:py-10 lg:px-14">
      <header>
        <Link
          href="/"
          className="group inline-flex items-baseline gap-1.5 font-display text-lg font-medium tracking-tight"
        >
          <span className="inline-block size-1.5 translate-y-[-2px] rounded-full bg-primary transition-transform group-hover:scale-125" />
          skillbundle
        </Link>
      </header>

      <main className="flex flex-1 items-center py-16">
        <div className="mx-auto w-full max-w-md">
          <h1 className="font-display text-[clamp(2.5rem,6vw,3.75rem)] font-medium tracking-tight leading-hero text-balance">
            {title}
          </h1>
          <p className="mt-4 max-w-sm text-sm text-muted-foreground sm:text-base">
            {description}
          </p>

          <div className="mt-10">{children}</div>
        </div>
      </main>

      {footer ? (
        <footer className="flex justify-end font-mono text-label uppercase tracking-eyebrow text-muted-foreground">
          {footer}
        </footer>
      ) : null}
    </div>
  );
}
