import { SkillBundlePanel } from "@/components/auth/skill-bundle-panel";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(420px,45%)]">
      {children}
      <SkillBundlePanel />
    </div>
  );
}
