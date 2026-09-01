/**
 * The auth group has no chrome of its own. `AuthFrame` owns both the
 * full-height centering and the `<main>` landmark; see `(auth)/error.tsx` for
 * why the landmark is per-page here rather than on the layout.
 */
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className="min-h-svh bg-background">{children}</div>;
}
