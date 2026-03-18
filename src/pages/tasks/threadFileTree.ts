import type { ThreadFileEntry } from "./threadTypes";

export type ThreadFileTreeNode = {
  id: string;
  name: string;
  path: string;
  kind: "directory" | "file";
  changed: boolean;
  children?: ThreadFileTreeNode[];
};

type MutableTreeNode = ThreadFileTreeNode & {
  children?: MutableTreeNode[];
};

function sortNodes(nodes: MutableTreeNode[]): ThreadFileTreeNode[] {
  return nodes
    .sort((left, right) => {
      if (left.kind !== right.kind) {
        return left.kind === "directory" ? -1 : 1;
      }
      return left.name.localeCompare(right.name);
    })
    .map((node) => ({
      ...node,
      children: node.children ? sortNodes(node.children) : undefined,
    }));
}

export function buildThreadFileTree(files: ThreadFileEntry[]): ThreadFileTreeNode[] {
  const root: MutableTreeNode[] = [];
  const directories = new Map<string, MutableTreeNode>();

  const ensureDirectory = (path: string, name: string, parent: MutableTreeNode[]) => {
    const existing = directories.get(path);
    if (existing) {
      return existing;
    }
    const node: MutableTreeNode = {
      id: `dir:${path}`,
      name,
      path,
      kind: "directory",
      changed: false,
      children: [],
    };
    parent.push(node);
    directories.set(path, node);
    return node;
  };

  for (const file of files) {
    const normalizedPath = String(file.path ?? "").trim().replace(/\\/g, "/");
    if (!normalizedPath) {
      continue;
    }
    const segments = normalizedPath.split("/").filter(Boolean);
    let currentPath = "";
    let parent = root;
    let directoryAncestors: MutableTreeNode[] = [];
    for (const segment of segments.slice(0, -1)) {
      currentPath = currentPath ? `${currentPath}/${segment}` : segment;
      const directory = ensureDirectory(currentPath, segment, parent);
      directoryAncestors.push(directory);
      parent = directory.children!;
    }
    const fileNode: MutableTreeNode = {
      id: `file:${normalizedPath}`,
      name: segments[segments.length - 1] || normalizedPath,
      path: normalizedPath,
      kind: "file",
      changed: Boolean(file.changed),
    };
    parent.push(fileNode);
    if (file.changed) {
      for (const directory of directoryAncestors) {
        directory.changed = true;
      }
    }
  }

  return sortNodes(root);
}
