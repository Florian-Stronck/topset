/**
 * Shown the moment a tab is tapped while the server renders it. Having it also lets Next
 * prefetch the tabs up to here, so the nav answers at once instead of after a round trip.
 */
export default function Loading() {
  return (
    <div className="animate-pulse space-y-3" aria-busy="true">
      <div className="h-6 w-1/3 rounded-md bg-surface-2" />
      <div className="h-24 rounded-2xl bg-surface" />
      <div className="h-40 rounded-2xl bg-surface" />
      <div className="h-40 rounded-2xl bg-surface" />
    </div>
  );
}
