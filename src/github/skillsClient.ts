/**
 * GitHub API client for fetching Agent Skills from repositories
 * 
 * OPTIMIZATION: Uses Git Trees API (1 call per repo) + raw.githubusercontent.com 
 * (no rate limit) to minimize GitHub API usage.
 * 
 * Before: O(N) API calls where N = total skills across all repos
 * After: O(R) API calls where R = number of repositories (typically 1-4)
 */

import * as vscode from 'vscode';
import { Skill, SkillRepository, SkillMetadata, CacheEntry } from '../types';

/**
 * GitHub Git Tree item from Trees API
 */
interface GitTreeItem {
    path: string;
    mode: string;
    type: 'blob' | 'tree';
    sha: string;
    size?: number;
    url?: string;
}

/**
 * GitHub Git Trees API response
 */
interface GitTreeResponse {
    sha: string;
    url: string;
    tree: GitTreeItem[];
    truncated: boolean;
}

export class GitHubSkillsClient {
    private static readonly BASE_URL = 'https://api.github.com';
    private static readonly RAW_URL = 'https://raw.githubusercontent.com';
    private cache: Map<string, CacheEntry<unknown>> = new Map();

    constructor(private readonly context: vscode.ExtensionContext) {}

    /**
     * Fetch all skills from configured repositories
     * 
     * API calls: 1 per repository (using Git Trees API)
     * File content: Fetched via raw.githubusercontent.com (no API limit)
     */
    async fetchAllSkills(): Promise<Skill[]> {
        const config = vscode.workspace.getConfiguration('agentSkills');
        const repositories = config.get<SkillRepository[]>('skillRepositories', []);
        
        const allSkills: Skill[] = [];
        const errors: string[] = [];

        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Window,
            title: 'Fetching skills...',
        }, async (progress) => {
            // Fetch all repositories in parallel
            const results = await Promise.allSettled(
                repositories.map(async (repo) => {
                    progress.report({ message: `${repo.owner}/${repo.repo}` });
                    return this.fetchSkillsFromRepo(repo);
                })
            );

            for (let i = 0; i < results.length; i++) {
                const result = results[i];
                if (result.status === 'fulfilled') {
                    allSkills.push(...result.value);
                } else {
                    const repo = repositories[i];
                    errors.push(`${repo.owner}/${repo.repo}: ${result.reason}`);
                    console.error(`Failed to fetch skills from ${repo.owner}/${repo.repo}:`, result.reason);
                }
            }
        });

        if (errors.length > 0 && allSkills.length === 0) {
            vscode.window.showWarningMessage(
                `Failed to fetch some skills: ${errors[0]}${errors.length > 1 ? ` (+${errors.length - 1} more)` : ''}`
            );
        }

        return allSkills;
    }

    /**
     * Fetch skills from a single repository using Git Trees API
     * 
     * API calls: 1 (Git Trees API with recursive=1)
     */
    async fetchSkillsFromRepo(repo: SkillRepository): Promise<Skill[]> {
        if (repo.singleSkill) {
            return this.fetchSingleSkill(repo);
        }

        // Use Git Trees API to get entire directory structure in ONE call
        const tree = await this.fetchRepoTree(repo.owner, repo.repo, repo.branch);
        
        // Find all SKILL.md files under the configured path
        const skillMdFiles = tree.tree.filter(item => 
            item.type === 'blob' && 
            item.path.startsWith(repo.path + '/') &&
            item.path.endsWith('/SKILL.md')
        );

        // Extract skill directory paths
        const skillPaths = skillMdFiles.map(item => {
            // e.g., "skills/pdf-processing/SKILL.md" -> "skills/pdf-processing"
            return item.path.substring(0, item.path.lastIndexOf('/'));
        });

        // Fetch all SKILL.md contents in parallel using raw.githubusercontent.com (no API limit)
        const skills = await Promise.all(
            skillPaths.map(async (skillPath) => {
                try {
                    const skillName = skillPath.split('/').pop() || skillPath;
                    return await this.fetchSkillMetadataRaw(repo, skillName, skillPath);
                } catch (error) {
                    console.warn(`Failed to fetch skill at ${skillPath}:`, error);
                    return null;
                }
            })
        );

        return skills.filter((s): s is Skill => s !== null);
    }

    /**
     * Fetch Git Trees API response (recursive)
     * 
     * API calls: 1
     */
    private async fetchRepoTree(owner: string, repo: string, branch: string): Promise<GitTreeResponse> {
        const cacheKey = `tree:${owner}/${repo}@${branch}`;
        const cached = this.getFromCache<GitTreeResponse>(cacheKey);
        if (cached) {
            return cached;
        }

        const url = `${GitHubSkillsClient.BASE_URL}/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`;
        const response = await this.fetchWithAuth(url);
        
        if (!response.ok) {
            if (response.status === 404) {
                throw new Error(`Repository or branch not found: ${owner}/${repo}@${branch}`);
            }
            throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
        }

        this.checkRateLimit(response);
        
        const data = await response.json() as GitTreeResponse;
        
        if (data.truncated) {
            console.warn(`Tree for ${owner}/${repo} was truncated. Some skills may be missing.`);
        }
        
        this.setCache(cacheKey, data);
        return data;
    }

    /**
     * Fetch a single skill when path points directly to skill folder
     */
    private async fetchSingleSkill(repo: SkillRepository): Promise<Skill[]> {
        try {
            const skillName = repo.path.split('/').pop() || repo.path;
            const skill = await this.fetchSkillMetadataRaw(repo, skillName, repo.path);
            return skill ? [skill] : [];
        } catch (error) {
            console.warn(`Failed to fetch single skill from ${repo.path}:`, error);
            return [];
        }
    }

    /**
     * Fetch and parse SKILL.md using raw.githubusercontent.com (bypasses API rate limit)
     * 
     * API calls: 0 (uses raw content URL)
     */
    async fetchSkillMetadataRaw(repo: SkillRepository, skillName: string, skillPath: string): Promise<Skill | null> {
        const skillMdPath = `${skillPath}/SKILL.md`;
        
        try {
            const content = await this.fetchRawContent(repo.owner, repo.repo, skillMdPath, repo.branch);
            const parsed = this.parseSkillMd(content);
            
            return {
                name: parsed.metadata.name || skillName,
                description: parsed.metadata.description || 'No description available',
                license: parsed.metadata.license,
                compatibility: parsed.metadata.compatibility,
                source: repo,
                skillPath: skillPath,
                fullContent: content,
                bodyContent: parsed.body
            };
        } catch (error) {
            console.warn(`No SKILL.md found for ${skillName}`);
            return null;
        }
    }

    /**
     * Fetch raw file content from raw.githubusercontent.com
     * 
     * This endpoint does NOT count against GitHub API rate limits!
     */
    private async fetchRawContent(owner: string, repo: string, path: string, branch: string): Promise<string> {
        const cacheKey = `raw:${owner}/${repo}/${path}@${branch}`;
        const cached = this.getFromCache<string>(cacheKey);
        if (cached) {
            return cached;
        }

        const url = `${GitHubSkillsClient.RAW_URL}/${owner}/${repo}/${branch}/${path}`;
        const response = await fetch(url);
        
        if (!response.ok) {
            throw new Error(`Failed to fetch file: ${response.status}`);
        }
        
        const content = await response.text();
        this.setCache(cacheKey, content);
        return content;
    }

    /**
     * Fetch raw file content (kept for backward compatibility)
     */
    async fetchFileContent(owner: string, repo: string, path: string, branch: string): Promise<string> {
        // Use raw.githubusercontent.com for efficiency
        return this.fetchRawContent(owner, repo, path, branch);
    }

    /**
     * Fetch all files in a skill directory for installation
     * Uses Git Trees API for efficiency
     */
    async fetchSkillFiles(skill: Skill): Promise<{ path: string; content: string }[]> {
        const { owner, repo, branch } = skill.source;
        
        // Get tree (likely cached from earlier fetch)
        const tree = await this.fetchRepoTree(owner, repo, branch);
        
        // Find all files under this skill's path
        const skillFiles = tree.tree.filter(item => 
            item.type === 'blob' && 
            item.path.startsWith(skill.skillPath + '/')
        );

        // Fetch all file contents in parallel using raw URLs
        const files = await Promise.all(
            skillFiles.map(async (item) => {
                const relativePath = item.path.substring(skill.skillPath.length + 1);
                const content = await this.fetchRawContent(owner, repo, item.path, branch);
                return { path: relativePath, content };
            })
        );

        return files;
    }

    /**
     * Parse SKILL.md content into metadata and body
     */
    private parseSkillMd(content: string): { metadata: SkillMetadata; body: string } {
        const frontmatterMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
        
        if (!frontmatterMatch) {
            // Try to extract basic info even without frontmatter
            return {
                metadata: { name: '', description: '' },
                body: content
            };
        }

        const yamlContent = frontmatterMatch[1];
        const body = frontmatterMatch[2];
        
        const metadata = this.parseYamlFrontmatter(yamlContent);
        
        return { metadata, body };
    }

    /**
     * Simple YAML frontmatter parser
     */
    private parseYamlFrontmatter(yaml: string): SkillMetadata {
        const metadata: SkillMetadata = { name: '', description: '' };
        
        const lines = yaml.split('\n');
        let currentKey = '';
        let multilineValue = '';
        
        for (const line of lines) {
            // Check for key: value pattern
            const keyMatch = line.match(/^(\w+(?:-\w+)*):\s*(.*)$/);
            
            if (keyMatch) {
                // Save previous multiline value if any
                if (currentKey && multilineValue) {
                    this.setMetadataValue(metadata, currentKey, multilineValue.trim());
                }
                
                currentKey = keyMatch[1];
                const value = keyMatch[2].trim();
                
                if (value) {
                    this.setMetadataValue(metadata, currentKey, value);
                    currentKey = '';
                    multilineValue = '';
                } else {
                    multilineValue = '';
                }
            } else if (currentKey && line.startsWith('  ')) {
                multilineValue += line.trim() + ' ';
            }
        }
        
        // Handle last multiline value
        if (currentKey && multilineValue) {
            this.setMetadataValue(metadata, currentKey, multilineValue.trim());
        }
        
        return metadata;
    }

    private setMetadataValue(metadata: SkillMetadata, key: string, value: string): void {
        switch (key) {
            case 'name':
                metadata.name = value;
                break;
            case 'description':
                metadata.description = value;
                break;
            case 'license':
                metadata.license = value;
                break;
            case 'compatibility':
                metadata.compatibility = value;
                break;
            case 'allowed-tools':
                metadata.allowedTools = value;
                break;
        }
    }

    /**
     * Fetch with GitHub authentication if token is configured
     */
    private async fetchWithAuth(url: string, additionalHeaders?: Record<string, string>): Promise<Response> {
        const config = vscode.workspace.getConfiguration('agentSkills');
        const token = config.get<string>('githubToken', '');
        
        const headers: Record<string, string> = {
            'Accept': 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
            ...additionalHeaders
        };
        
        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }
        
        return fetch(url, { headers });
    }

    /**
     * Check and warn about rate limits
     */
    private checkRateLimit(response: Response): void {
        const remaining = response.headers.get('x-ratelimit-remaining');
        const reset = response.headers.get('x-ratelimit-reset');
        
        if (remaining && parseInt(remaining) < 10) {
            const resetDate = reset ? new Date(parseInt(reset) * 1000) : new Date();
            vscode.window.showWarningMessage(
                `GitHub API rate limit low (${remaining} remaining). Resets at ${resetDate.toLocaleTimeString()}`
            );
        }
    }

    /**
     * Get data from cache if not expired
     */
    private getFromCache<T>(key: string): T | null {
        const entry = this.cache.get(key) as CacheEntry<T> | undefined;
        if (!entry) {
            return null;
        }
        
        const config = vscode.workspace.getConfiguration('agentSkills');
        const timeout = config.get<number>('cacheTimeout', 3600) * 1000;
        
        if (Date.now() - entry.timestamp > timeout) {
            this.cache.delete(key);
            return null;
        }
        
        return entry.data;
    }

    /**
     * Store data in cache
     */
    private setCache<T>(key: string, data: T): void {
        this.cache.set(key, {
            data,
            timestamp: Date.now()
        });
    }

    /**
     * Clear all cached data
     */
    clearCache(): void {
        this.cache.clear();
    }
}
