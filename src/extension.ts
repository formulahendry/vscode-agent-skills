/**
 * Agent Skills VS Code Extension
 * Provides a marketplace for browsing, installing, and managing Agent Skills
 */

import * as vscode from 'vscode';
import { GitHubSkillsClient } from './github/skillsClient';
import { MarketplaceTreeDataProvider, SkillTreeItem } from './views/marketplaceProvider';
import { InstalledSkillsTreeDataProvider, InstalledSkillTreeItem } from './views/installedProvider';
import { SkillDetailPanel } from './views/skillDetailPanel';
import { SkillInstallationService } from './services/installationService';
import { Skill, InstalledSkill } from './types';

export function activate(context: vscode.ExtensionContext) {
    console.log('Agent Skills extension is now active!');

    // Initialize services
    const githubClient = new GitHubSkillsClient(context);
    const installationService = new SkillInstallationService(githubClient, context);

    // Initialize view providers
    const marketplaceProvider = new MarketplaceTreeDataProvider(githubClient, context);
    const installedProvider = new InstalledSkillsTreeDataProvider(context);

    // Register TreeViews
    const marketplaceTreeView = vscode.window.createTreeView('agentSkills.marketplace', {
        treeDataProvider: marketplaceProvider,
        showCollapseAll: true
    });

    const installedTreeView = vscode.window.createTreeView('agentSkills.installed', {
        treeDataProvider: installedProvider
    });

    // Helper to sync installed status with marketplace
    const syncInstalledStatus = async () => {
        await installedProvider.refresh();
        marketplaceProvider.setInstalledSkills(installedProvider.getInstalledSkillNames());
    };

    // Register commands
    const commands = [
        // Search skills
        vscode.commands.registerCommand('agentSkills.search', async () => {
            const query = await vscode.window.showInputBox({
                prompt: 'Search skills',
                placeHolder: 'Enter skill name or keyword...'
            });
            if (query !== undefined) {
                marketplaceProvider.setSearchQuery(query);
            }
        }),

        // Clear search
        vscode.commands.registerCommand('agentSkills.clearSearch', () => {
            marketplaceProvider.clearSearch();
        }),

        // Refresh marketplace and installed
        vscode.commands.registerCommand('agentSkills.refresh', async () => {
            await Promise.all([
                marketplaceProvider.refresh(),
                installedProvider.refresh()
            ]);
            await syncInstalledStatus();
        }),

        // View skill details - opens in editor area as WebviewPanel
        vscode.commands.registerCommand('agentSkills.viewDetails', (item: SkillTreeItem | Skill | unknown) => {
            if (!item) {
                vscode.window.showErrorMessage('No skill selected.');
                return;
            }

            try {
                let skill: Skill | undefined;
                
                // Handle different input types
                if (item instanceof SkillTreeItem) {
                    skill = item.skill;
                } else {
                    // Try to cast to Skill
                    const skillData = item as Skill;
                    if (skillData.source) {
                        skill = skillData;
                    }
                }
                
                if (!skill || !skill.source) {
                    vscode.window.showErrorMessage('Invalid skill data. Please try again.');
                    return;
                }
                
                SkillDetailPanel.createOrShow(skill, context.extensionUri, installedProvider);
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                vscode.window.showErrorMessage(`Failed to open skill details: ${message}`);
            }
        }),

        // Install skill
        vscode.commands.registerCommand('agentSkills.install', async (item: SkillTreeItem | Skill) => {
            const skill = item instanceof SkillTreeItem ? item.skill : item;
            if (skill) {
                const success = await installationService.installSkill(skill);
                if (success) {
                    await syncInstalledStatus();
                }
            }
        }),

        // Uninstall skill
        vscode.commands.registerCommand('agentSkills.uninstall', async (item: InstalledSkillTreeItem | InstalledSkill | Skill) => {
            let installedSkill: InstalledSkill | undefined;
            
            // Handle different input types
            if (item instanceof InstalledSkillTreeItem) {
                installedSkill = item.installedSkill;
            } else if ('location' in item) {
                // It's an InstalledSkill
                installedSkill = item as InstalledSkill;
            } else {
                // It's a Skill - find the corresponding InstalledSkill
                const skill = item as Skill;
                installedSkill = installedProvider.getInstalledSkills().find(s => s.name === skill.name);
            }
            
            if (installedSkill) {
                const success = await installationService.uninstallSkill(installedSkill);
                if (success) {
                    await syncInstalledStatus();
                }
            }
        }),

        // Open skill folder
        vscode.commands.registerCommand('agentSkills.openSkillFolder', async (item: InstalledSkillTreeItem) => {
            if (item?.installedSkill) {
                await installationService.openSkillFolder(item.installedSkill);
            }
        }),

        // Focus marketplace view (used in welcome message)
        vscode.commands.registerCommand('agentSkills.focusMarketplace', () => {
            marketplaceTreeView.reveal(undefined as unknown as SkillTreeItem, { focus: true });
        })
    ];

    context.subscriptions.push(...commands, marketplaceTreeView, installedTreeView);

    // Watch for workspace skill folder changes
    const skillsWatcher = vscode.workspace.createFileSystemWatcher('**/.github/skills/*/SKILL.md');
    const claudeSkillsWatcher = vscode.workspace.createFileSystemWatcher('**/.claude/skills/*/SKILL.md');

    skillsWatcher.onDidCreate(() => syncInstalledStatus());
    skillsWatcher.onDidDelete(() => syncInstalledStatus());
    claudeSkillsWatcher.onDidCreate(() => syncInstalledStatus());
    claudeSkillsWatcher.onDidDelete(() => syncInstalledStatus());

    context.subscriptions.push(skillsWatcher, claudeSkillsWatcher);

    // Listen for configuration changes
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('agentSkills.skillRepositories')) {
                marketplaceProvider.refresh();
            }
        })
    );

    // Initial load - load installed skills and marketplace in parallel
    Promise.all([
        installedProvider.refresh(),
        marketplaceProvider.loadSkills()
    ]).then(() => {
        marketplaceProvider.setInstalledSkills(installedProvider.getInstalledSkillNames());
    });
}

export function deactivate() {}
