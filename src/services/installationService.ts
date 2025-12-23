/**
 * Skill Installation Service - handles installing and uninstalling skills
 */

import * as vscode from 'vscode';
import { Skill, InstalledSkill } from '../types';
import { GitHubSkillsClient } from '../github/skillsClient';

export class SkillInstallationService {
    constructor(
        private readonly githubClient: GitHubSkillsClient,
        private readonly context: vscode.ExtensionContext
    ) {}

    /**
     * Install a skill to the workspace
     */
    async installSkill(skill: Skill): Promise<boolean> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            vscode.window.showErrorMessage('No workspace folder open. Please open a folder first.');
            return false;
        }

        const config = vscode.workspace.getConfiguration('agentSkills');
        const installLocation = config.get<string>('installLocation', '.github/skills');
        
        const targetDir = vscode.Uri.joinPath(
            workspaceFolder.uri,
            installLocation,
            skill.name
        );

        // Check if already installed
        try {
            await vscode.workspace.fs.stat(targetDir);
            const overwrite = await vscode.window.showWarningMessage(
                `Skill "${skill.name}" is already installed. Overwrite?`,
                { modal: true },
                'Overwrite'
            );
            if (overwrite !== 'Overwrite') {
                return false;
            }
            // Delete existing
            await vscode.workspace.fs.delete(targetDir, { recursive: true });
        } catch {
            // Not installed, continue
        }

        return vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `Installing ${skill.name}...`,
            cancellable: true
        }, async (progress, token) => {
            try {
                progress.report({ increment: 0, message: 'Fetching skill files...' });
                
                if (token.isCancellationRequested) {
                    return false;
                }

                // Fetch all files
                const files = await this.githubClient.fetchSkillFiles(skill);
                
                if (token.isCancellationRequested) {
                    return false;
                }

                progress.report({ increment: 50, message: 'Writing files...' });
                
                // Create target directory
                await vscode.workspace.fs.createDirectory(targetDir);
                
                // Write all files
                let written = 0;
                for (const file of files) {
                    if (token.isCancellationRequested) {
                        // Cleanup partial installation
                        await vscode.workspace.fs.delete(targetDir, { recursive: true });
                        return false;
                    }
                    
                    const filePath = vscode.Uri.joinPath(targetDir, file.path);
                    
                    // Ensure parent directory exists
                    const parentDir = vscode.Uri.joinPath(filePath, '..');
                    await vscode.workspace.fs.createDirectory(parentDir);
                    
                    // Write file
                    await vscode.workspace.fs.writeFile(
                        filePath,
                        new TextEncoder().encode(file.content)
                    );
                    
                    written++;
                    progress.report({ 
                        increment: 50 * (written / files.length),
                        message: `Writing ${file.path}...`
                    });
                }

                vscode.window.showInformationMessage(`Successfully installed skill "${skill.name}"`);
                return true;
                
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                vscode.window.showErrorMessage(`Failed to install skill: ${message}`);
                
                // Cleanup on error
                try {
                    await vscode.workspace.fs.delete(targetDir, { recursive: true });
                } catch {
                    // Ignore cleanup errors
                }
                
                return false;
            }
        });
    }

    /**
     * Uninstall a skill from the workspace
     */
    async uninstallSkill(skill: InstalledSkill): Promise<boolean> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            return false;
        }

        const confirm = await vscode.window.showWarningMessage(
            `Uninstall skill "${skill.name}"? This will delete the skill folder.`,
            { modal: true },
            'Uninstall'
        );

        if (confirm !== 'Uninstall') {
            return false;
        }

        try {
            const skillDir = vscode.Uri.joinPath(workspaceFolder.uri, skill.location);
            await vscode.workspace.fs.delete(skillDir, { recursive: true, useTrash: true });
            vscode.window.showInformationMessage(`Successfully uninstalled skill "${skill.name}"`);
            return true;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Failed to uninstall skill: ${message}`);
            return false;
        }
    }

    /**
     * Open the skill folder in the explorer
     */
    async openSkillFolder(skill: InstalledSkill): Promise<void> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            return;
        }

        const skillDir = vscode.Uri.joinPath(workspaceFolder.uri, skill.location);
        const skillMd = vscode.Uri.joinPath(skillDir, 'SKILL.md');
        
        try {
            await vscode.commands.executeCommand('revealInExplorer', skillDir);
            await vscode.window.showTextDocument(skillMd);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to open skill folder`);
        }
    }
}
