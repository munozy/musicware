/**
 * A non-blocking banner shown whenever the latest save to localStorage failed (DEBT-034 high
 * finding). Before this, a full-quota write was swallowed silently and the user lost work on
 * next launch. Subscribes to the shared persist-health signal so it reacts to any store.
 */

import { useSyncExternalStore } from "react";
import { persistFailed, subscribePersist } from "./persistHealth";

export default function StorageBanner() {
  const failed = useSyncExternalStore(subscribePersist, persistFailed, persistFailed);
  if (!failed) return null;
  return (
    <div className="storage-banner" role="alert">
      <span aria-hidden="true">⚠</span>
      <span>
        <b>Couldn&apos;t save your latest changes</b> — device storage looks full. Export your
        song or project to a file to keep it safe, then free up some space.
      </span>
    </div>
  );
}
