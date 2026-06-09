"use client";

import { NuqsAdapter } from "nuqs/adapters/next/app";
import { ClerkProvider } from "@clerk/nextjs";
import { ConvexClientProvider } from "./ConvexClientProvider";
import { ThemeProvider } from "next-themes";

import {
  ToastProvider,
  AnchoredToastProvider,
} from "@/components/ui/cubby-ui/toast/toast";

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
            attribute="data-theme"
            defaultTheme="system"
            enableSystem
            disableTransitionOnChange
          >
            <ToastProvider position="bottom-right">
              <AnchoredToastProvider>{children}</AnchoredToastProvider>
            </ToastProvider>
          </ThemeProvider>
        </ConvexClientProvider>
      </ClerkProvider>
    </NuqsAdapter>
  );
}
