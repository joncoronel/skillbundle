import { DashboardContent } from "./dashboard-content";
import { DashboardMasthead } from "./dashboard-masthead";

// Static and public; DashboardContent switches on client auth. The shell holds
// no user data, so it prefetches and paints instantly and costs no function
// invocations. Cold direct loads show the skeleton until Convex connects.

export default function DashboardPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 pt-12 pb-20">
      <div className="space-y-10">
        <DashboardMasthead />
        <DashboardContent />
      </div>
    </div>
  );
}
