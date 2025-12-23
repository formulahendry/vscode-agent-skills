/**
 * Agent Skills type definitions
 */

/**
 * Configuration for a skill repository source
 */
export interface SkillRepository {
    owner: string;
    repo: string;
    path: string;
    branch: string;
    singleSkill?: boolean;
}

/**
 * Parsed SKILL.md frontmatter metadata
 */
export interface SkillMetadata {
    name: string;
    description: string;
    license?: string;
    compatibility?: string;
    metadata?: Record<string, string>;
    allowedTools?: string;
}

/**
 * Full skill information including source
 */
export interface Skill {
    name: string;
    description: string;
    license?: string;
    compatibility?: string;
    source: SkillRepository;
    skillPath: string;
    fullContent?: string;
    bodyContent?: string;
}

/**
 * Installed skill with local path information
 */
export interface InstalledSkill {
    name: string;
    description: string;
    location: string;
    installedAt: string;
    source?: SkillRepository;
}

/**
 * GitHub API directory content item
 */
export interface GitHubContentItem {
    name: string;
    path: string;
    sha: string;
    type: 'file' | 'dir';
    download_url: string | null;
    url: string;
    size?: number;
}

/**
 * GitHub API tree item for recursive fetches
 */
export interface GitHubTreeItem {
    path: string;
    mode: string;
    type: 'blob' | 'tree';
    sha: string;
    size?: number;
    url: string;
}

/**
 * Cache entry for marketplace data
 */
export interface CacheEntry<T> {
    data: T;
    timestamp: number;
    etag?: string;
}
