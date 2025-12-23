/**
 * Installed Skills TreeDataProvider - displays skills installed in the workspace
 */

import * as vscode from 'vscode';
import { InstalledSkill, SkillMetadata } from '../types';

export class InstalledSkillTreeItem extends vscode.TreeItem {
    constructor(
        public readonly installedSkill: InstalledSkill
    ) {
        super(installedSkill.name, vscode.TreeItemCollapsibleState.None);
        
        this.description = installedSkill.description;
        this.tooltip = new vscode.MarkdownString();
        this.tooltip.appendMarkdown(`**${installedSkill.name}**\n\n`);
        this.tooltip.appendMarkdown(`${installedSkill.description}\n\n`);
        this.tooltip.appendMarkdown(`*Location: ${installedSkill.location}*`);
        
        this.iconPath = new vscode.ThemeIcon('extensions');
        this.contextValue = 'installedSkill';
    }
}

export class InstalledSkillsTreeDataProvider implements vscode.TreeDataProvider<InstalledSkillTreeItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<InstalledSkillTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private installedSkills: InstalledSkill[] = [];

    constructor(private readonly context: vscode.ExtensionContext) {
        // Scan installed skills on initialization
        this.scanInstalledSkills().then(skills => {
            this.installedSkills = skills;
            this._onDidChangeTreeData.fire();
        });
    }

    /**
     * Refresh the installed skills list
     */
    async refresh(): Promise<void> {
        this.installedSkills = await this.scanInstalledSkills();
        this._onDidChangeTreeData.fire();
    }

    /**
     * Get names of all installed skills
     */
    getInstalledSkillNames(): Set<string> {
        return new Set(this.installedSkills.map(s => s.name));
    }

    /**
     * Get all installed skills
     */
    getInstalledSkills(): InstalledSkill[] {
        return this.installedSkills;
    }

    /**
     * Check if a skill is installed by name
     */
    isSkillInstalled(skillName: string): boolean {
        return this.installedSkills.some(s => s.name === skillName);
    }

    /**
     * Scan workspace for installed skills
     */
    async scanInstalledSkills(): Promise<InstalledSkill[]> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            return [];
        }

        const locations = ['.github/skills', '.claude/skills'];
        const installed: InstalledSkill[] = [];

        for (const location of locations) {
            const dir = vscode.Uri.joinPath(workspaceFolder.uri, location);
            
            try {
                const entries = await vscode.workspace.fs.readDirectory(dir);
                
                for (const [name, type] of entries) {
                    if (type === vscode.FileType.Directory) {
                        const skillMdUri = vscode.Uri.joinPath(dir, name, 'SKILL.md');
                        
                        try {
                            const content = await vscode.workspace.fs.readFile(skillMdUri);
                            const contentStr = new TextDecoder().decode(content);
                            const metadata = this.parseSkillMdMetadata(contentStr);
                            
                            installed.push({
                                name: metadata.name || name,
                                description: metadata.description || 'No description available',
                                location: `${location}/${name}`,
                                installedAt: new Date().toISOString()
                            });
                        } catch {
                            // SKILL.md doesn't exist, not a valid skill
                        }
                    }
                }
            } catch {
                // Directory doesn't exist
            }
        }

        return installed;
    }

    /**
     * Parse SKILL.md to extract basic metadata
     */
    private parseSkillMdMetadata(content: string): Partial<SkillMetadata> {
        const metadata: Partial<SkillMetadata> = {};
        
        const frontmatterMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
        if (!frontmatterMatch) {
            return metadata;
        }

        const yaml = frontmatterMatch[1];
        const nameMatch = yaml.match(/^name:\s*(.+)$/m);
        const descMatch = yaml.match(/^description:\s*(.+)$/m);
        
        if (nameMatch) {
            metadata.name = nameMatch[1].trim();
        }
        if (descMatch) {
            metadata.description = descMatch[1].trim();
        }

        return metadata;
    }

    getTreeItem(element: InstalledSkillTreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: InstalledSkillTreeItem): vscode.ProviderResult<InstalledSkillTreeItem[]> {
        if (element) {
            return [];
        }
        
        if (this.installedSkills.length === 0) {
            return [];
        }
        
        return this.installedSkills.map(skill => new InstalledSkillTreeItem(skill));
    }
}
