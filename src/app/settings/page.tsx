import { SettingsView } from "@/components/SettingsView";
import { Sidebar } from "@/components/Sidebar";
import { getRoster } from "@/lib/queries";
import { loadSettings } from "@/lib/coach-settings";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  await loadSettings();
  const { coach, athletes } = await getRoster();

  return (
    <div className="flex h-screen">
      <Sidebar athletes={athletes} coachUsername={coach.username} coachName={coach.name} section="settings" />
      <main className="min-w-0 flex-1 overflow-auto">
        <SettingsView coachName={coach.name} />
      </main>
    </div>
  );
}
