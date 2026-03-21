import { useRef, type ReactNode } from "react";

export function resolveCachedWorkspaceChildren(
  active: boolean,
  cached: ReactNode | undefined,
  next: ReactNode,
): ReactNode {
  if (active) {
    return next;
  }
  return cached ?? next;
}

type WorkspaceTabCacheProps = {
  active: boolean;
  children: ReactNode;
};

export function WorkspaceTabCache({ active, children }: WorkspaceTabCacheProps) {
  const cachedChildrenRef = useRef<ReactNode | undefined>(children);
  cachedChildrenRef.current = resolveCachedWorkspaceChildren(active, cachedChildrenRef.current, children);
  return <div hidden={!active}>{cachedChildrenRef.current}</div>;
}
