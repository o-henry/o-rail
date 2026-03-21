import { describe, expect, it, vi } from "vitest";
import { ensureResearcherCollectionArtifacts } from "./researcherCollectionArtifacts";

describe("ensureResearcherCollectionArtifacts", () => {
  it("writes fallback collection artifacts when they are missing", async () => {
    const writes: Array<{ name: string; content: string }> = [];
    const invokeFn = (vi.fn(async (command: string, args?: Record<string, unknown>) => {
      if (command !== "workspace_write_text") {
        throw new Error(`unexpected command: ${command}`);
      }
      writes.push({
        name: String(args?.name ?? ""),
        content: String(args?.content ?? ""),
      });
      return `${String(args?.cwd)}/${String(args?.name)}`;
    }) as unknown) as <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

    const paths = await ensureResearcherCollectionArtifacts({
      invokeFn,
      artifactDir: "/tmp/role-run",
      existingArtifactPaths: [],
      findingsMarkdown: `
## 조사 결론
- 인기 장르 1위는 \`슈터/FPS\`입니다.

## 핵심 근거
- Steam 공식 통계는 [Steam Stats](https://store.steampowered.com/stats/stats/)에서 확인됩니다.
`,
    });

    expect(paths).toContain("/tmp/role-run/research_collection.md");
    expect(paths).toContain("/tmp/role-run/research_collection.json");
    const jsonWrite = writes.find((row) => row.name === "research_collection.json");
    expect(jsonWrite?.content).toContain("\"topSources\"");
    expect(jsonWrite?.content).toContain("Steam Stats");
  });

  it("does not rewrite collection artifacts when they already exist", async () => {
    const invokeFn = (vi.fn(async () => {
      throw new Error("should not write");
    }) as unknown) as <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

    const paths = await ensureResearcherCollectionArtifacts({
      invokeFn,
      artifactDir: "/tmp/role-run",
      existingArtifactPaths: [
        "/tmp/role-run/research_collection.md",
        "/tmp/role-run/research_collection.json",
      ],
      findingsMarkdown: "## 조사 결론\n- 유지되어야 합니다.",
    });

    expect(paths).toEqual([
      "/tmp/role-run/research_collection.md",
      "/tmp/role-run/research_collection.json",
    ]);
    expect(invokeFn).not.toHaveBeenCalled();
  });
});
