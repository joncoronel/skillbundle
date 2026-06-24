"use client";

import { NuqsAdapter } from "nuqs/adapters/next/app";
import { ClerkProvider } from "@clerk/nextjs";
import { ConvexClientProvider } from "./ConvexClientProvider";
import { ThemeProvider } from "next-themes";

import {
  ToastProvider,
  AnchoredToastProvider,
} from "@/components/ui/cubby-ui/toast/toast";
import { TooltipProvider } from "@/components/ui/cubby-ui/tooltip";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <NuqsAdapter>
      {/*
        prefetchUI={false} stops Clerk from preloading its ~262 KiB prebuilt-UI
        bundle (@clerk/ui: ui-common, vendors_ui, framework_ui, ui.browser). The
        app uses Clerk only through headless hooks (useAuth/useUser/useSignIn/
        etc.) and never mounts a prebuilt component, so the UI bundle is dead
        weight. The core clerk.browser.js still loads for auth state.
      */}
      <ClerkProvider afterSignOutUrl="/sign-in" prefetchUI={false}>
        <ConvexClientProvider>
          <ThemeProvider
            attribute="class"
            defaultTheme="system"
            enableSystem
            disableTransitionOnChange
          >
            <ToastProvider position="bottom-right">
              <AnchoredToastProvider>
                {/*
                  Shared tooltip delay group. Without it each tooltip waits the
                  full open delay every time; inside the provider, once one
                  tooltip has opened, moving the cursor to an adjacent trigger
                  opens the next instantly (within `timeout`, default 400ms).
                  Makes dense clusters (a row's status + copies chips, the bundle
                  bar) feel snappy. `delay` is the first-open wait; tuned a touch
                  below Base UI's 600ms default for a sharper feel.
                */}
                <TooltipProvider delay={400} closeDelay={0}>
                  {children}
                </TooltipProvider>
              </AnchoredToastProvider>
            </ToastProvider>
          </ThemeProvider>
        </ConvexClientProvider>
      </ClerkProvider>
    </NuqsAdapter>
  );
}
