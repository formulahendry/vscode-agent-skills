/**
 * Skill Detail Panel - displays rich skill details in editor area as WebviewPanel
 * Similar to VS Code's extension detail view
 */

import * as vscode from 'vscode';
import MarkdownIt from 'markdown-it';
import { Skill } from '../types';
import { InstalledSkillsTreeDataProvider } from './installedProvider';

export class SkillDetailPanel {
    public static readonly viewType = 'agentSkills.skillDetail';
    
    private static panels: Map<string, SkillDetailPanel> = new Map();
    
    private readonly _panel: vscode.WebviewPanel;
    private readonly _skill: Skill;
    private readonly _extensionUri: vscode.Uri;
    private readonly _installedProvider: InstalledSkillsTreeDataProvider;
    private _disposables: vscode.Disposable[] = [];

    private constructor(
        panel: vscode.WebviewPanel,
        skill: Skill,
        extensionUri: vscode.Uri,
        installedProvider: InstalledSkillsTreeDataProvider
    ) {
        this._panel = panel;
        this._skill = skill;
        this._extensionUri = extensionUri;
        this._installedProvider = installedProvider;

        // Set initial content
        this._update();

        // Handle panel disposal
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        // Listen for installed skills changes and refresh the panel
        this._installedProvider.onDidChangeTreeData(() => {
            this._update();
        }, null, this._disposables);

        // Handle messages from the webview
        this._panel.webview.onDidReceiveMessage(
            async (message) => {
                switch (message.command) {
                    case 'install':
                        await vscode.commands.executeCommand('agentSkills.install', this._skill);
                        break;
                    case 'uninstall':
                        await vscode.commands.executeCommand('agentSkills.uninstall', this._skill);
                        break;
                    case 'openExternal':
                        if (message.url) {
                            vscode.env.openExternal(vscode.Uri.parse(message.url));
                        }
                        break;
                }
            },
            null,
            this._disposables
        );
    }

    /**
     * Create or show the skill detail panel
     */
    public static createOrShow(
        skill: Skill,
        extensionUri: vscode.Uri,
        installedProvider: InstalledSkillsTreeDataProvider
    ): SkillDetailPanel {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        // Check if we already have a panel for this skill
        const existingPanel = SkillDetailPanel.panels.get(skill.name);
        if (existingPanel) {
            existingPanel._panel.reveal(column);
            return existingPanel;
        }

        // Create a new panel
        const panel = vscode.window.createWebviewPanel(
            SkillDetailPanel.viewType,
            `Skill: ${skill.name}`,
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                localResourceRoots: [extensionUri],
                retainContextWhenHidden: true
            }
        );

        const skillPanel = new SkillDetailPanel(panel, skill, extensionUri, installedProvider);
        SkillDetailPanel.panels.set(skill.name, skillPanel);
        
        return skillPanel;
    }

    /**
     * Update the webview content
     */
    private _update(): void {
        this._panel.title = `Skill: ${this._skill.name}`;
        this._panel.webview.html = this._getHtmlForWebview();
    }

    /**
     * Generate the HTML content for the webview
     */
    private _getHtmlForWebview(): string {
        const skill = this._skill;
        
        // Validate that skill has required properties
        if (!skill.source || !skill.source.owner || !skill.source.repo) {
            return this._getErrorHtml('Invalid skill data. Please close this panel and try again.');
        }
        
        const sourceUrl = `https://github.com/${skill.source.owner}/${skill.source.repo}/tree/${skill.source.branch}/${skill.skillPath}`;
        const isInstalled = this._installedProvider.isSkillInstalled(skill.name);
        
        // Convert markdown body to HTML
        const bodyHtml = this._markdownToHtml(skill.bodyContent || '');
        
        const nonce = this._getNonce();

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <title>Skill: ${this._escapeHtml(skill.name)}</title>
    <style>
        ${this._getStyles()}
    </style>
</head>
<body>
    <div class="container">
        <div class="skill-header">
            <div class="skill-icon">📦</div>
            <div class="skill-info">
                <h1>${this._escapeHtml(skill.name)}</h1>
                <p class="description">${this._escapeHtml(skill.description)}</p>
                
                <div class="meta">
                    ${skill.license ? `<span class="badge license">📄 ${this._escapeHtml(skill.license)}</span>` : ''}
                    ${skill.compatibility ? `<span class="badge compatibility">🔧 ${this._escapeHtml(skill.compatibility)}</span>` : ''}
                    ${isInstalled ? `<span class="badge installed">✓ Installed</span>` : ''}
                </div>
                
                <div class="actions">
                    ${isInstalled 
                        ? `<button class="btn danger" id="uninstallBtn">
                            <span class="icon">🗑️</span> Uninstall
                        </button>`
                        : `<button class="btn primary" id="installBtn">
                            <span class="icon">⬇️</span> Install
                        </button>`
                    }
                    <button class="btn secondary" id="sourceBtn">
                        <span class="icon">📂</span> View Source
                    </button>
                </div>
            </div>
        </div>
        
        <div class="source-info">
            <span class="label">Source:</span>
            <a href="#" id="sourceLink">
                ${this._escapeHtml(skill.source.owner)}/${this._escapeHtml(skill.source.repo)}/${this._escapeHtml(skill.skillPath)}
            </a>
        </div>
        
        <div class="tabs">
            <button class="tab active" data-tab="readme">README</button>
            <button class="tab" data-tab="raw">Raw SKILL.md</button>
        </div>
        
        <div id="readme" class="tab-content active">
            <div class="skill-content">
                ${bodyHtml}
            </div>
        </div>
        
        <div id="raw" class="tab-content">
            <pre class="raw-content"><code>${this._escapeHtml(skill.fullContent || '')}</code></pre>
        </div>
    </div>
    
    <script nonce="${nonce}">
        (function() {
            const vscode = acquireVsCodeApi();
            const sourceUrl = '${sourceUrl}';
            
            function install() {
                vscode.postMessage({ command: 'install' });
            }
            
            function uninstall() {
                vscode.postMessage({ command: 'uninstall' });
            }
            
            function openSource() {
                vscode.postMessage({ 
                    command: 'openExternal', 
                    url: sourceUrl
                });
            }
            
            function showTab(tabId) {
                // Update tab buttons
                document.querySelectorAll('.tab').forEach(function(tab) {
                    tab.classList.remove('active');
                });
                document.querySelector('[data-tab="' + tabId + '"]').classList.add('active');
                
                // Update tab content
                document.querySelectorAll('.tab-content').forEach(function(content) {
                    content.classList.remove('active');
                });
                document.getElementById(tabId).classList.add('active');
            }
            
            // Attach event listeners
            const installBtn = document.getElementById('installBtn');
            if (installBtn) {
                installBtn.addEventListener('click', install);
            }
            
            const uninstallBtn = document.getElementById('uninstallBtn');
            if (uninstallBtn) {
                uninstallBtn.addEventListener('click', uninstall);
            }
            
            document.getElementById('sourceBtn').addEventListener('click', openSource);
            document.getElementById('sourceLink').addEventListener('click', function(e) {
                e.preventDefault();
                openSource();
            });
            
            // Tab switching
            document.querySelectorAll('.tab').forEach(function(tab) {
                tab.addEventListener('click', function() {
                    showTab(this.getAttribute('data-tab'));
                });
            });
        })();
    </script>
</body>
</html>`;
    }

    /**
     * Generate error HTML
     */
    private _getErrorHtml(message: string): string {
        const nonce = this._getNonce();
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';">
    <title>Error</title>
    <style>
        * {
            box-sizing: border-box;
        }
        body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
            padding: 20px;
            margin: 0;
        }
        .error {
            color: var(--vscode-errorForeground);
            background-color: var(--vscode-inputValidation-errorBackground);
            padding: 12px;
            border-radius: 4px;
            border: 1px solid var(--vscode-inputValidation-errorBorder);
        }
    </style>
</head>
<body>
    <div class="error">
        <strong>Error:</strong> ${this._escapeHtml(message)}
    </div>
</body>
</html>`;
    }

    /**
     * Get CSS styles for the webview
     */
    private _getStyles(): string {
        return `
            * {
                box-sizing: border-box;
            }
            
            body {
                font-family: var(--vscode-font-family);
                font-size: var(--vscode-font-size);
                color: var(--vscode-foreground);
                background-color: var(--vscode-editor-background);
                padding: 0;
                margin: 0;
                line-height: 1.6;
            }
            
            .container {
                max-width: 900px;
                margin: 0 auto;
                padding: 24px;
            }
            
            .skill-header {
                display: flex;
                gap: 20px;
                margin-bottom: 20px;
                padding-bottom: 20px;
                border-bottom: 1px solid var(--vscode-panel-border);
            }
            
            .skill-icon {
                font-size: 64px;
                line-height: 1;
            }
            
            .skill-info {
                flex: 1;
            }
            
            h1 {
                font-size: 1.8em;
                margin: 0 0 8px 0;
                color: var(--vscode-foreground);
                font-weight: 600;
            }
            
            h2 {
                font-size: 1.3em;
                margin: 24px 0 12px 0;
                color: var(--vscode-foreground);
                border-bottom: 1px solid var(--vscode-panel-border);
                padding-bottom: 6px;
            }
            
            h3 {
                font-size: 1.1em;
                margin: 16px 0 8px 0;
                color: var(--vscode-foreground);
            }
            
            .description {
                color: var(--vscode-descriptionForeground);
                margin: 0 0 12px 0;
                font-size: 1.1em;
            }
            
            .meta {
                display: flex;
                flex-wrap: wrap;
                gap: 8px;
                margin-bottom: 16px;
            }
            
            .badge {
                display: inline-block;
                padding: 4px 10px;
                background-color: var(--vscode-badge-background);
                color: var(--vscode-badge-foreground);
                border-radius: 4px;
                font-size: 0.85em;
            }
            
            .badge.installed {
                background-color: var(--vscode-diffEditor-insertedTextBackground);
            }
            
            .actions {
                display: flex;
                gap: 8px;
            }
            
            .btn {
                display: inline-flex;
                align-items: center;
                gap: 6px;
                padding: 8px 16px;
                border: none;
                border-radius: 4px;
                cursor: pointer;
                font-size: 1em;
                font-family: inherit;
            }
            
            .btn.primary {
                background-color: var(--vscode-button-background);
                color: var(--vscode-button-foreground);
            }
            
            .btn.primary:hover {
                background-color: var(--vscode-button-hoverBackground);
            }
            
            .btn.secondary {
                background-color: var(--vscode-button-secondaryBackground);
                color: var(--vscode-button-secondaryForeground);
            }
            
            .btn.secondary:hover {
                background-color: var(--vscode-button-secondaryHoverBackground);
            }
            
            .btn.danger {
                background-color: var(--vscode-inputValidation-errorBackground);
                color: var(--vscode-inputValidation-errorForeground);
            }
            
            .btn.danger:hover {
                opacity: 0.8;
            }
            
            .btn .icon {
                font-size: 1em;
            }
            
            .source-info {
                background-color: var(--vscode-textBlockQuote-background);
                padding: 8px 12px;
                border-radius: 4px;
                margin-bottom: 16px;
                font-size: 0.9em;
            }
            
            .source-info .label {
                color: var(--vscode-descriptionForeground);
            }
            
            .source-info a {
                color: var(--vscode-textLink-foreground);
                text-decoration: none;
            }
            
            .source-info a:hover {
                color: var(--vscode-textLink-activeForeground);
                text-decoration: underline;
            }
            
            .tabs {
                display: flex;
                gap: 0;
                border-bottom: 1px solid var(--vscode-panel-border);
                margin-bottom: 16px;
            }
            
            .tab {
                padding: 8px 16px;
                background: none;
                border: none;
                border-bottom: 2px solid transparent;
                color: var(--vscode-foreground);
                cursor: pointer;
                font-size: 1em;
                font-family: inherit;
                opacity: 0.7;
            }
            
            .tab:hover {
                opacity: 1;
            }
            
            .tab.active {
                border-bottom-color: var(--vscode-focusBorder);
                opacity: 1;
            }
            
            .tab-content {
                display: none;
            }
            
            .tab-content.active {
                display: block;
            }
            
            .skill-content {
                line-height: 1.7;
            }
            
            .raw-content {
                background-color: var(--vscode-textCodeBlock-background);
                padding: 16px;
                border-radius: 4px;
                overflow-x: auto;
                font-size: 0.9em;
            }
            
            code {
                background-color: var(--vscode-textCodeBlock-background);
                padding: 2px 6px;
                border-radius: 3px;
                font-family: var(--vscode-editor-font-family);
                font-size: 0.9em;
            }
            
            pre {
                background-color: var(--vscode-textCodeBlock-background);
                padding: 16px;
                border-radius: 4px;
                overflow-x: auto;
            }
            
            pre code {
                background-color: transparent;
                padding: 0;
            }
            
            ul, ol {
                padding-left: 24px;
                margin: 12px 0;
            }
            
            li {
                margin: 6px 0;
            }
            
            a {
                color: var(--vscode-textLink-foreground);
            }
            
            a:hover {
                color: var(--vscode-textLink-activeForeground);
            }
            
            blockquote {
                border-left: 4px solid var(--vscode-textBlockQuote-border);
                margin: 12px 0;
                padding: 8px 16px;
                background-color: var(--vscode-textBlockQuote-background);
                color: var(--vscode-textBlockQuote-foreground);
            }
            
            table {
                border-collapse: collapse;
                width: 100%;
                margin: 12px 0;
            }
            
            th, td {
                border: 1px solid var(--vscode-panel-border);
                padding: 8px 12px;
                text-align: left;
            }
            
            th {
                background-color: var(--vscode-textBlockQuote-background);
            }
            
            .table-container {
                overflow-x: auto;
                margin: 12px 0;
            }
        `;
    }

    /**
     * Simple markdown to HTML converter using markdown-it
     */
    private _markdownToHtml(markdown: string): string {
        if (!markdown) {
            return '<p><em>No additional details available.</em></p>';
        }

        // Create markdown-it instance with GitHub Flavored Markdown support
        const md = new MarkdownIt({
            html: false,  // Don't allow raw HTML for security
            linkify: true,  // Auto-detect URLs
            typographer: true  // Smart quotes and other typography
        });

        // Enable table plugin (built-in)
        md.enable('table');

        // Render markdown to HTML
        let html = md.render(markdown);

        // Wrap table in a container for better styling
        html = html.replace(/<table>/g, '<div class="table-container"><table>');
        html = html.replace(/<\/table>/g, '</table></div>');

        return html;
    }

    /**
     * Escape HTML special characters
     */
    private _escapeHtml(text: string): string {
        const map: Record<string, string> = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#039;'
        };
        return text.replace(/[&<>"']/g, m => map[m]);
    }

    /**
     * Generate a nonce for CSP
     */
    private _getNonce(): string {
        let text = '';
        const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        for (let i = 0; i < 32; i++) {
            text += possible.charAt(Math.floor(Math.random() * possible.length));
        }
        return text;
    }

    /**
     * Dispose of the panel
     */
    public dispose(): void {
        SkillDetailPanel.panels.delete(this._skill.name);
        this._panel.dispose();

        while (this._disposables.length) {
            const disposable = this._disposables.pop();
            if (disposable) {
                disposable.dispose();
            }
        }
    }
}
