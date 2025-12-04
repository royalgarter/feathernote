// --- Git Functions (isomorphic-git) ---

// Initialize LightningFS
// Ensure this runs only once or handles re-init gracefully
const fs = new LightningFS('feathernote-fs');
const pfs = fs.promises;

// Setup Git plugin
// We rely on window.git and window.GitHttp being available from loaded libs
if (window.git && window.GitHttp) {
    git.plugins.set('fs', fs);
    git.plugins.set('http', window.GitHttp);
}

const GIT_DIR = '/repo';

// Helper to get git config object
const getGitConfig = (creds) => {
    return {
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
};

// Helper to parse Frontmatter
const parseFrontmatter = (text) => {
    const result = { metadata: {}, body: text };
    // Basic regex for frontmatter. Matches --- 
 content 
 ---
    const match = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    
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

const initGit = async (creds) => {
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

const listNotesInGit = async (creds) => {
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
                    
                    const id = metadata.id || file.replace(/\.md$/, '');
                    
                    notes.push({
                        id: id,
                        title: metadata.title || id,
                        content: body,
                        tags: metadata.tags || [],
                        updatedAt: metadata.updatedAt || new Date(stat.mtimeMs).toISOString(),
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

const uploadNoteToGit = async (note, creds) => {
    const filename = `${note.id}.md`;
    const content = createMarkdownContent(note);
    
    // Write to FS
    await pfs.writeFile(`${GIT_DIR}/${filename}`, content, 'utf8');
    
    // Git Add
    await git.add({ fs, dir: GIT_DIR, filepath: filename });
};

const deleteNoteFromGit = async (noteId, creds) => {
    const filename = `${noteId}.md`;
    try {
        await git.remove({ fs, dir: GIT_DIR, filepath: filename });
    } catch (e) {
        console.log('Git remove failed (file might not exist):', e);
    }
    try {
        await pfs.unlink(`${GIT_DIR}/${filename}`);
    } catch (e) {}
};

const finishGitSync = async (creds) => {
    if (!creds.repoUrl) return;

    // Check status
    const status = await git.statusMatrix({ fs, dir: GIT_DIR });
    // status row: [filepath, head, workdir, stage]
    // modified: [file, 1, 2, 2] or [file, 1, 2, 3] ... 
    // we are looking for differences. 
    // actually git.add handles staging.
    // we just need to commit if there are staged changes.
    
    // Simple check: assume we did changes if we called upload/delete.
    // But for correctness let's try to commit. If nothing to commit, it throws or creates empty?
    // isomorphic-git commit allows empty? No default.
    
    // We can just try to commit.
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
             // Nothing to commit? or User name missing
        } else if (e.message && e.message.includes('nothing to commit')) {
            // Ignore
        } else {
            console.error('Git Commit/Push Error:', e);
        }
    }
};

const syncGit = async (localNotes, deletedNoteIds, creds) => {
    if (!creds.repoUrl) return { success: false, error: 'No Repo URL' };
    
    const report = {
        uploadedCount: 0,
        downloadedCount: 0,
        deletedRemoteCount: 0,
        deletedLocalCount: 0,
        updatedNotes: [],
        notesToDeleteLocally: [],
        successfulDeletedIds: []
    };

    try {
        // 1. Pull (Fetch + Merge)
        await initGit(creds);

        // 2. List Remote (FS) Notes
        const remoteNotes = await listNotesInGit();
        const remoteNoteMap = new Map(remoteNotes.map(n => [n.id, n]));

        // 3. Upload (Local -> FS)
        const localNoteMap = new Map(localNotes.map(n => [n.id, n]));
        const uploadedIds = new Set();
        
        for (const note of localNotes) {
            if (deletedNoteIds.includes(note.id)) continue;

            const remoteNote = remoteNoteMap.get(note.id);
            let shouldUpload = false;

            if (!remoteNote) {
                shouldUpload = true;
            } else {
                const localTime = new Date(note.updatedAt).getTime();
                const remoteTime = new Date(remoteNote.updatedAt).getTime();
                if (localTime > remoteTime) {
                    shouldUpload = true;
                }
            }

            if (shouldUpload) {
                await uploadNoteToGit(note, creds);
                report.uploadedCount++;
                uploadedIds.add(note.id);
            }
        }

        // 4. Delete Remote (Deleted Local -> Remove from FS)
        for (const id of deletedNoteIds) {
            // If it exists in remote, delete it.
            // If it doesn't, it might have been already deleted or never existed.
            await deleteNoteFromGit(id, creds);
            report.deletedRemoteCount++;
            report.successfulDeletedIds.push(id);
        }

        // 5. Commit & Push
        await finishGitSync(creds);

        // 6. Download (FS -> Local) & Delete Local
        // Logic: 
        // - If in Remote and (Missing Local OR Remote Newer): Download
        // - If in Local and Missing Remote (and not just uploaded, and not marked for delete): Delete Local
        
        for (const remoteNote of remoteNotes) {
             if (uploadedIds.has(remoteNote.id)) continue;
             if (deletedNoteIds.includes(remoteNote.id)) continue;

             const localNote = localNoteMap.get(remoteNote.id);
             
             if (!localNote) {
                 // New from remote
                 report.updatedNotes.push(remoteNote);
                 report.downloadedCount++;
             } else {
                 const localTime = new Date(localNote.updatedAt).getTime();
                 const remoteTime = new Date(remoteNote.updatedAt).getTime();
                 
                 if (remoteTime > localTime) {
                     report.updatedNotes.push(remoteNote);
                     report.downloadedCount++;
                 }
             }
        }
        
        // Delete Local Logic
        // Iterate Local Notes. If not in RemoteMap, and not uploaded, and not in deletedIds -> Delete Local
        // Note: remoteNoteMap is pre-upload state.
        // If we uploaded a new note, it won't be in remoteNoteMap, but it is in uploadedIds.
        // If we deleted a note locally, it is in deletedNoteIds.
        // So if a note exists locally, is NOT in remoteNoteMap, NOT in uploadedIds, NOT in deletedNoteIds...
        // It means it was deleted on remote (FS) before we started sync.
        
        for (const note of localNotes) {
            if (!remoteNoteMap.has(note.id) && !uploadedIds.has(note.id) && !deletedNoteIds.includes(note.id)) {
                report.notesToDeleteLocally.push(note.id);
                report.deletedLocalCount++;
            }
        }

        report.success = true;

    } catch (e) {
        console.error("Git Sync Error", e);
        return { success: false, error: e.message };
    }
    
    return report;
};
