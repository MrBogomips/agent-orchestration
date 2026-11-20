export declare function normalizeRemote(url: string | undefined): string | null
export declare function projectId(source?: { remote?: string; root?: string }): Promise<{ id: string; root: string | null } | null>
