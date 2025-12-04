// --- Git Functions (isomorphic-git) ---

// Initialize LightningFS
// Ensure this runs only once or handles re-init gracefully
const fs = new LightningFS('feathernote-fs');
const pfs = fs.promises;

// Note: isomorphic-git v1.x does not use git.plugins.set('fs', ...) or 'http'.
// Instead, we pass 'fs' and 'http' in the options object for each command.

const GIT_DIR = '/repo';

// Helper to get git config object
const getGitConfig = (creds) => {
    const config = {
        fs,
        dir: GIT_DIR,
        corsProxy: creds.corsProxy || 'https://cors.isomorphic-git.org',
        username: creds.username,
        password: creds.token || creds.password, // Support both naming conventions
        author: {
            name: creds.username || 'FeatherNote User',
            email: creds.email || 'user@feathernote.app',
        },
    };

    if (window.GitHttp) {
        config.http = window.GitHttp;
    }
    return config;
};

// Helper to parse Frontmatter
const parseFrontmatter = (text) => {
    const result = { metadata: {}, body: text };
    // Regex for frontmatter
    const match = text.match(/^---\s*[\r\n]+([\s\S]*?)[\r\n]+---\s*[\r\n]+([\s\S]*)$/);
    
    if (match) {
        const yamlBlock = match[1];
        result.body = match[2].trim(); // Remove leading/trailing whitespace from body
        
        yamlBlock.split('\n').forEach(line => {
            const colonIndex = line.indexOf(':');
            if (colonIndex !== -1) {
                const key = line.slice(0, colonIndex).trim();
                let value = line.slice(colonIndex + 1).trim();
                
                // Basic value parsing
                if (value.startsWith('[') && value.endsWith(']')) {
                    value = value.slice(1, -1).split(',').map(v => v.trim()).filter(v => v);
                } else if (value.startsWith('"') && value.endsWith('"')) {
                    value = value.slice(1, -1);
                } else if (value.startsWith("'") && value.endsWith("'")) {
                     value = value.slice(1, -1);
                }
                
                result.metadata[key] = value;
            }
        });
    }
    return result;
};

// Helper to create Markdown with Frontmatter
const createMarkdownContent = (note) => {
    const lines = ['---'];
    lines.push(`id: ${note.id}`);
    lines.push(`title: ${note.title.replace(/:/g, '-')}`); // Basic escaping
    lines.push(`updatedAt: ${note.updatedAt}`);
    if (note.createdAt) lines.push(`createdAt: ${note.createdAt}`);
    if (note.priority) lines.push(`priority: ${note.priority}`);
    if (note.reminder) lines.push(`reminder: ${note.reminder}`);
    
    if (note.tags && note.tags.length > 0) {
        lines.push(`tags: [${note.tags.join(', ')}]`);
    }
    
    lines.push('---');
    lines.push('');
    lines.push(note.content || '');
    
    return lines.join('\n');
};

// --- Exported Functions ---
// Explicitly attach to window to ensure global availability across scripts

window.initGit = async (creds) => {
    if (!creds.repoUrl) return;

    try {
        await pfs.mkdir(GIT_DIR);
    } catch (e) {}

    let isRepo = false;
    try {
        await git.resolveRef({ fs, dir: GIT_DIR, ref: 'HEAD' });
        isRepo = true;
    } catch (e) {}

    if (!isRepo) {
        // Clone
        console.log('Cloning Git Repo...');
        await git.clone({
            ...getGitConfig(creds),
            url: creds.repoUrl,
            ref: creds.branch || 'main',
            singleBranch: true,
            depth: 1,
        });
    } else {
        // Pull
        console.log('Pulling Git Repo...');
        try {
            await git.pull({
                ...getGitConfig(creds),
                url: creds.repoUrl,
                ref: creds.branch || 'main',
                singleBranch: true,
                fastForward: true,
                author: getGitConfig(creds).author // author needed for merge commit if not ff
            });
        } catch (e) {
            console.warn('Git pull failed (might be offline or conflict), continuing with local state:', e);
            // We continue. Synchronization will happen against local FS state.
        }
    }
};

window.listNotesInGit = async (creds) => {
    try {
        // Check if dir exists
        try {
            await pfs.readdir(GIT_DIR);
        } catch (e) {
            return [];
        }

        const files = await pfs.readdir(GIT_DIR);
        const notes = [];
        
        for (const file of files) {
            if (file.endsWith('.md') && !file.startsWith('.')) {
                try {
                    const content = await pfs.readFile(`${GIT_DIR}/${file}`, 'utf8');
                    const stat = await pfs.stat(`${GIT_DIR}/${file}`);
                    const { metadata, body } = parseFrontmatter(content);
                    
                    // ID strategy: Metadata ID -> Filename ID
                    const id = metadata.id || file.replace(/\.md$/, '');
                    
                    // Date strategy: Metadata updatedAt -> File Mtime
                    const updatedAt = metadata.updatedAt || new Date(stat.mtimeMs).toISOString();

                    notes.push({
                        id: id,
                        title: metadata.title || id,
                        content: body,
                        tags: metadata.tags || [],
                        updatedAt: updatedAt,
                        createdAt: metadata.createdAt || new Date(stat.birthtimeMs).toISOString(),
                        reminder: metadata.reminder || null,
                        priority: metadata.priority || 0,
                        source: 'git'
                    });
                } catch (readErr) {
                    console.error(`Error reading/parsing file ${file}:`, readErr);
                }
            }
        }
        return notes;
    } catch (err) {
        console.error('Error listing notes in git:', err);
        return [];
    }
};

window.uploadNoteToGit = async (note, creds) => {
    const filename = `${note.id}.md`;
    const content = createMarkdownContent(note);
    
    // Write to FS
    await pfs.writeFile(`${GIT_DIR}/${filename}`, content, 'utf8');
    
    // Git Add
    await git.add({ fs, dir: GIT_DIR, filepath: filename });
};

window.deleteNoteFromGit = async (noteId, creds) => {
    const filename = `${noteId}.md`;
    try {
        await git.remove({ fs, dir: GIT_DIR, filepath: filename });
    } catch (e) {
        console.log('Git remove failed (file might not exist):', e);
    }
    try {
        // Ensure physical removal if git remove didn't do it (it should, but safety first)
        await pfs.unlink(`${GIT_DIR}/${filename}`);
    } catch (e) {}
};

window.finishGitSync = async (creds) => {
    if (!creds.repoUrl) return;

    // Simple check: try to commit. 
    try {
        const sha = await git.commit({
            ...getGitConfig(creds),
            message: `Sync from FeatherNote: ${new Date().toISOString()}`,
        });
        console.log('Committed:', sha);
        
        // Push
        console.log('Pushing...');
        await git.push({
            ...getGitConfig(creds),
            url: creds.repoUrl,
            ref: creds.branch || 'main',
        });
        console.log('Pushed successfully.');
    } catch (e) {
        if (e.code === 'MissingName') {
             console.error('Git Commit Failed: Missing Author Name/Email');
        } else if (e.message && (e.message.includes('nothing to commit') || e.message.includes('no changes'))) {
            // Ignore
            console.log('Nothing to commit.');
        } else {
            console.error('Git Commit/Push Error:', e);
        }
    }
};