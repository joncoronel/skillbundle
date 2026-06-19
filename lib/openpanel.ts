import { OpenPanel } from "@openpanel/nextjs";

// Server-side OpenPanel client for tracking custom events (e.g. from route
// handlers or the proxy). Page views are handled client-side by the
// OpenPanelComponent in app/layout.tsx.
export const opServer = new OpenPanel({
  clientId: process.env.NEXT_PUBLIC_OPENPANEL_CLIENT_ID!,
  clientSecret: process.env.OPENPANEL_CLIENT_SECRET!,
});
