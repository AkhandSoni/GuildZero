"use client";

import { useEffect, useRef } from "react";

const DISCARD = "Discard unsaved mission changes? Your CSV and brief edits will be lost.";

/** Keep data in React only. A same-URL entry catches Back before Next unmounts. */
export function useUnsavedMission(dirty: boolean) {
  const controls = useRef({ setDirty: (value: boolean) => { void value; }, saved: async () => {}, discard: async () => true });
  useEffect(() => {
    let active = false;
    let sentinel = false;
    let pending: Promise<void> | undefined;
    let finishPop: (() => void) | undefined;
    let disposed = false;
    const url = location.href;
    const state = history.state;
    const addEntry = () => {
      if (!sentinel && !pending) { history.pushState(state, "", url); sentinel = true; }
    };
    const removeEntry = async () => {
      active = false;
      if (pending) return pending;
      if (!sentinel) return;
      sentinel = false;
      pending = new Promise<void>((resolve) => {
        finishPop = () => { pending = undefined; resolve(); };
        history.back();
      });
      return pending;
    };
    controls.current = {
      setDirty: (value) => {
        active = value;
        if (value) {
          if (pending) void pending.then(() => { if (active && !disposed) addEntry(); });
          else addEntry();
        } else void removeEntry();
      },
      saved: removeEntry,
      discard: async () => {
        if (active && !window.confirm(DISCARD)) return false;
        await removeEntry();
        return true;
      },
    };
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (active) { event.preventDefault(); event.returnValue = ""; }
    };
    const pop = (event: PopStateEvent) => {
      if (finishPop) {
        event.stopImmediatePropagation();
        const resolve = finishPop; finishPop = undefined; resolve();
        return;
      }
      if (!active) return;
      event.stopImmediatePropagation();
      sentinel = false;
      const destination = location.href;
      if (window.confirm(DISCARD)) {
        active = false;
        if (destination === url) history.back();
        else location.assign(destination);
      } else addEntry();
    };
    const click = (event: MouseEvent) => {
      if (!active || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target instanceof Element ? event.target : null;
      const leaveButton = target?.closest<HTMLButtonElement>("button[data-leave-mission-editor]");
      const anchor = target?.closest<HTMLAnchorElement>("a[href]");
      if (!leaveButton) {
        if (!anchor || anchor.hasAttribute("download") || (anchor.target && anchor.target !== "_self")) return;
        const next = new URL(anchor.href, location.href);
        if (next.origin === location.origin && next.pathname === location.pathname && next.search === location.search) return;
      }
      event.preventDefault(); event.stopImmediatePropagation();
      if (window.confirm(DISCARD)) void removeEntry().then(() => {
        if (leaveButton) leaveButton.click();
        else location.assign(anchor!.href);
      });
    };
    window.addEventListener("beforeunload", beforeUnload);
    window.addEventListener("popstate", pop, true);
    document.addEventListener("click", click, true);
    return () => {
      disposed = true;
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("click", click, true);
      void removeEntry().then(() => window.removeEventListener("popstate", pop, true));
    };
  }, []);
  useEffect(() => { controls.current.setDirty(dirty); }, [dirty]);
  return { saved: () => controls.current.saved(), discard: () => controls.current.discard() };
}
