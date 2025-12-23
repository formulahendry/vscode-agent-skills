/**
 * Marketplace TreeDataProvider - displays available skills from configured repositories
 */

import * as vscode from 'vscode';
import { Skill } from '../types';
import { GitHubSkillsClient } from '../github/skillsClient';

export class SkillTreeItem extends vscode.TreeItem {
    constructor(
        public readonly skill: Skill,
        public readonly isInstalled: boolean = false
    ) {
        super(skill.name, vscode.TreeItemCollapsibleState.None);
        
        this.description = this.truncateDescription(skill.description, 60);
        this.tooltip = new vscode.MarkdownString();
        this.tooltip.appendMarkdown(`**${skill.name}**\n\n`);
        this.tooltip.appendMarkdown(`${skill.description}\n\n`);
        if (skill.license) {
            this.tooltip.appendMarkdown(`*License: ${skill.license}*\n\n`);
        }
        this.tooltip.appendMarkdown(`Source: \`${skill.source.owner}/${skill.source.repo}\``);
        
        this.iconPath = new vscode.ThemeIcon(isInstalled ? 'check' : 'extensions');
        this.contextValue = 'skill';
        
        // Click to view details
        this.command = {
            command: 'agentSkills.viewDetails',
            title: 'View Details',
            arguments: [skill]
        };
    }

    private truncateDescription(text: string, maxLength: number): string {
        if (text.length <= maxLength) {
            return text;
        }
        return text.substring(0, maxLength - 3) + '...';
    }
}

export class SourceTreeItem extends vscode.TreeItem {
    constructor(
        public readonly sourceName: string,
        public readonly skills: Skill[]
    ) {
        super(sourceName, vscode.TreeItemCollapsibleState.Expanded);
        this.iconPath = new vscode.ThemeIcon('github');
        this.description = `${skills.length} skill${skills.length !== 1 ? 's' : ''}`;
        this.contextValue = 'source';
    }
}

export class MarketplaceTreeDataProvider implements vscode.TreeDataProvider<SkillTreeItem | SourceTreeItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<SkillTreeItem | SourceTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private skills: Skill[] = [];
    private searchQuery: string = '';
    private installedSkillNames: Set<string> = new Set();
    private isLoading: boolean = false;
    private groupBySource: boolean = true;

    constructor(
        private readonly githubClient: GitHubSkillsClient,
        private readonly context: vscode.ExtensionContext
    ) {}

    /**
     * Refresh the marketplace data
     */
    async refresh(): Promise<void> {
        this.isLoading = true;
        this._onDidChangeTreeData.fire();
        
        try {
            this.githubClient.clearCache();
            this.skills = await this.githubClient.fetchAllSkills();
        } catch (error) {
            console.error('Failed to refresh marketplace:', error);
            vscode.window.showErrorMessage('Failed to refresh marketplace. Please check your network connection.');
        } finally {
            this.isLoading = false;
            this._onDidChangeTreeData.fire();
        }
    }

    /**
     * Initial load of skills
     */
    async loadSkills(): Promise<void> {
        if (this.skills.length === 0 && !this.isLoading) {
            this.isLoading = true;
            this._onDidChangeTreeData.fire();
            
            try {
                this.skills = await this.githubClient.fetchAllSkills();
            } catch (error) {
                console.error('Failed to load skills:', error);
            } finally {
                this.isLoading = false;
                this._onDidChangeTreeData.fire();
            }
        }
    }

    /**
     * Set search query and filter results
     */
    setSearchQuery(query: string): void {
        this.searchQuery = query.toLowerCase();
        this._onDidChangeTreeData.fire();
        this.updateSearchContext();
    }

    /**
     * Clear search filter
     */
    clearSearch(): void {
        this.searchQuery = '';
        this._onDidChangeTreeData.fire();
        this.updateSearchContext();
    }

    /**
     * Check if search is active
     */
    isSearchActive(): boolean {
        return this.searchQuery.length > 0;
    }

    /**
     * Update VS Code context key for search state
     */
    private updateSearchContext(): void {
        vscode.commands.executeCommand('setContext', 'agentSkills:searchActive', this.isSearchActive());
    }

    /**
     * Update the set of installed skill names
     */
    setInstalledSkills(names: Set<string>): void {
        this.installedSkillNames = names;
        this._onDidChangeTreeData.fire();
    }

    /**
     * Get all loaded skills
     */
    getSkills(): Skill[] {
        return this.skills;
    }

    /**
     * Get a skill by name
     */
    getSkillByName(name: string): Skill | undefined {
        return this.skills.find(s => s.name === name);
    }

    getTreeItem(element: SkillTreeItem | SourceTreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: SkillTreeItem | SourceTreeItem): vscode.ProviderResult<(SkillTreeItem | SourceTreeItem)[]> {
        if (this.isLoading) {
            return [this.createLoadingItem()];
        }

        if (!element) {
            // Root level
            const filteredSkills = this.getFilteredSkills();
            
            if (filteredSkills.length === 0 && this.skills.length === 0) {
                return [this.createEmptyItem()];
            }

            if (filteredSkills.length === 0 && this.searchQuery) {
                return [this.createNoResultsItem()];
            }

            if (this.groupBySource) {
                return this.getSourceGroups(filteredSkills);
            } else {
                return filteredSkills.map(skill => 
                    new SkillTreeItem(skill, this.installedSkillNames.has(skill.name))
                );
            }
        }

        if (element instanceof SourceTreeItem) {
            return element.skills.map(skill => 
                new SkillTreeItem(skill, this.installedSkillNames.has(skill.name))
            );
        }

        return [];
    }

    private getFilteredSkills(): Skill[] {
        if (!this.searchQuery) {
            return this.skills;
        }
        
        return this.skills.filter(skill => 
            skill.name.toLowerCase().includes(this.searchQuery) ||
            skill.description.toLowerCase().includes(this.searchQuery)
        );
    }

    private getSourceGroups(skills: Skill[]): SourceTreeItem[] {
        const groups = new Map<string, Skill[]>();
        
        for (const skill of skills) {
            const key = `${skill.source.owner}/${skill.source.repo}`;
            if (!groups.has(key)) {
                groups.set(key, []);
            }
            groups.get(key)!.push(skill);
        }
        
        return Array.from(groups.entries()).map(
            ([name, skillList]) => new SourceTreeItem(name, skillList)
        );
    }

    private createLoadingItem(): SkillTreeItem {
        const item = new vscode.TreeItem('Loading skills...', vscode.TreeItemCollapsibleState.None);
        item.iconPath = new vscode.ThemeIcon('loading~spin');
        return item as unknown as SkillTreeItem;
    }

    private createEmptyItem(): SkillTreeItem {
        const item = new vscode.TreeItem('No skills available', vscode.TreeItemCollapsibleState.None);
        item.iconPath = new vscode.ThemeIcon('info');
        item.description = 'Click refresh to load skills';
        return item as unknown as SkillTreeItem;
    }

    private createNoResultsItem(): SkillTreeItem {
        const item = new vscode.TreeItem(`No results for "${this.searchQuery}"`, vscode.TreeItemCollapsibleState.None);
        item.iconPath = new vscode.ThemeIcon('search-stop');
        return item as unknown as SkillTreeItem;
    }
}
