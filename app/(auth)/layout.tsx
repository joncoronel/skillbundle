import { SkillStackPanel } from "@/components/auth/skill-stack-panel";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(420px,45%)]">
      {children}
      <SkillStackPanel />
    </div>
  );
}
