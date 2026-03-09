// --- Git Functions (isomorphic-git) ---

// Initialize LightningFS
// Ensure this runs only once or handles re-init gracefully
const fs = new LightningFS('feathernote-fs');
const pfs = fs.promises;

// Note: isomorphic-git v1.x does not use git.plugins.set('fs', ...) or 'http'.
// Instead, we pass 'fs' and 'http' in the options object for each command.

const GIT_DIR = '/repo';

// Helper to get recursive file list
const readdirRecursive = async (dir, baseDir = dir) => {
    let results = [];
    const list = await pfs.readdir(dir);
    for (const file of list) {
        const path = `${dir}/${file}`;
        const stat = await pfs.stat(path);
        if (stat.type === 'dir') {
            results = results.concat(await readdirRecursive(path, baseDir));
        } else {
            results.push(path.replace(`${baseDir}/`, ''));
        }
    }
    return results;
};

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
        headers: {},
    };

    if (window.GitHttp) {
        config.http = window.GitHttp;
    }

    // Explicitly add Basic Auth header to ensure it passes through proxies
    if (config.username && config.password) {
        try {
            const authString = btoa(`${config.username}:${config.password}`);
            config.headers['Authorization'] = `Basic ${authString}`;
        } catch (e) {
            console.error('Error constructing auth header:', e);
        }
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
        console.log('GIT: Cloning...');
        await git.clone({
            ...getGitConfig(creds),
            url: creds.repoUrl,
            ref: creds.branch || 'main',
            singleBranch: true,
            depth: 1,
        });
    } else {
        // Pull
        console.log('GIT: Pulling...');
        try {
            await git.pull({
                ...getGitConfig(creds),
                url: creds.repoUrl,
                ref: creds.branch || 'main',
                singleBranch: true,
                // fastForward: true, // Removed to allow merge
                author: getGitConfig(creds).author
            });

            console.log('GIT: Pulled (and Merged)');
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

        const files = await readdirRecursive(GIT_DIR);
        const notes = [];
        
        for (const file of files) {
            if (file.endsWith('.md') && !file.split('/').pop().startsWith('.')) {
                try {
                    const content = await pfs.readFile(`${GIT_DIR}/${file}`, 'utf8');
                    const stat = await pfs.stat(`${GIT_DIR}/${file}`);
                    const { metadata, body } = parseFrontmatter(content);
                    
                    // ID strategy: Metadata ID -> Filename ID
                    const id = metadata.id || file.split('/').pop().replace(/\.md$/, '');
                    
                    // Date strategy: Metadata updatedAt -> File Mtime
                    let updatedAt = metadata.updatedAt;
                    if (!updatedAt) {
                        const mDate = new Date(stat.mtimeMs);
                        if (isNaN(mDate.getTime())) {
                            console.warn(`Skipping ${file}: Invalid mtimeMs timestamp`);
                            continue;
                        }
                        updatedAt = mDate.toISOString();
                    }

                    let createdAt = metadata.createdAt;
                    if (!createdAt) {
                        const bDate = new Date(stat.birthtimeMs || stat.mtimeMs);
                        if (isNaN(bDate.getTime())) {
                            console.warn(`Skipping ${file}: Invalid birthtimeMs timestamp`);
                            continue;
                        }
                        createdAt = bDate.toISOString();
                    }

                    notes.push({
                        id: id,
                        path: file,
                        title: metadata.title || id,
                        content: body,
                        tags: metadata.tags || [],
                        updatedAt: updatedAt,
                        createdAt: createdAt,
                        reminder: metadata.reminder || null,
                        priority: metadata.priority || 0,
                        source: 'git'
                    });
                } catch (readErr) {
                    console.error(`GIT: Error reading/parsing file ${file}:`, readErr.message);
                }
            }
        }
        return notes;
    } catch (err) {
        console.error('GIT: Error listing notes in git:', err);
        return [];
    }
};

window.uploadNoteToGit = async (note, creds) => {
    const date = new Date(note.createdAt || note.updatedAt || Date.now());
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    const relDir = `${y}/${m}/${d}`;
    const filename = `${relDir}/${note.id}.md`;
    const content = createMarkdownContent(note);
    
    // 1. Ensure directory exists (only if it doesn't already)
    const parts = relDir.split('/');
    let currentPath = GIT_DIR;
    for (const part of parts) {
        currentPath += '/' + part;
        try {
            const stat = await pfs.stat(currentPath);
            if (stat.type !== 'dir') throw new Error('Not a directory');
        } catch (e) {
            await pfs.mkdir(currentPath);
        }
    }

    // 2. Write to FS
    await pfs.writeFile(`${GIT_DIR}/${filename}`, content, 'utf8');
    
    // 3. Git Add
    await git.add({ fs, dir: GIT_DIR, filepath: filename });

    // 4. Backward Compatibility: Remove old flat file if it exists
    const oldFilename = `${note.id}.md`;
    if (filename !== oldFilename) {
        try {
            await pfs.stat(`${GIT_DIR}/${oldFilename}`);
            await git.remove({ fs, dir: GIT_DIR, filepath: oldFilename });
            await pfs.unlink(`${GIT_DIR}/${oldFilename}`);
            console.log(`GIT: Migrated ${oldFilename} to ${filename}`);
        } catch (e) {
            // File doesn't exist or already removed, ignore silently
        }
    }
};

window.deleteNoteFromGit = async (noteIdOrPath, creds) => {
    const filename = noteIdOrPath.endsWith('.md') ? noteIdOrPath : `${noteIdOrPath}.md`;
    const fullPath = `${GIT_DIR}/${filename}`;
    
    try {
        // Only attempt removal if the file exists in FS or Git index
        const status = await git.status({ fs, dir: GIT_DIR, filepath: filename });
        if (status !== 'absent' && status !== 'undefined') {
            await git.remove({ fs, dir: GIT_DIR, filepath: filename });
            console.log(`GIT: Removed ${filename} from git index`);
        }
    } catch (e) {
        // Ignore errors for already removed files
    }

    try {
        await pfs.unlink(fullPath);
    } catch (e) {
        // Ignore ENOENT (file already gone)
    }
};
    
    window.uploadDeletedNotesToGit = async (deletedIds, creds) => {
    	const filename = 'deleted-notes.json';
    	const content = JSON.stringify({ ids: deletedIds, updatedAt: new Date().toISOString() }, null, 2);
    	
    	await pfs.writeFile(`${GIT_DIR}/${filename}`, content, 'utf8');
    	await git.add({ fs, dir: GIT_DIR, filepath: filename });
    };
    
    window.downloadDeletedNotesFromGit = async (creds) => {
    	const filename = 'deleted-notes.json';
    	const filepath = `${GIT_DIR}/${filename}`;
    	try {
    		const content = await pfs.readFile(filepath, 'utf8');
    		const parsed = JSON.parse(content);
    		// Prefer the timestamp from the file content, but fall back to file system stat
    		const stat = await pfs.stat(filepath);
    		return {
    			ids: parsed.ids || [],
    			updatedAt: parsed.updatedAt || new Date(stat.mtimeMs).toISOString()
    		};
    	} catch (e) {
    		return { ids: [], updatedAt: '1970-01-01T00:00:00.000Z' };
    	}
    };    window.finishGitSync = async (creds) => {
        if (!creds.repoUrl) return;

        try {
            const config = getGitConfig(creds);
            const remoteRef = creds.branch || 'main';

            // 0. Check for staged changes to avoid empty commits
            // Instead of a full matrix scan, we can use statusMatrix with a filter or check if any files were added/removed
            // For simplicity and correctness with isomorphic-git, we check status of common files or use a limited matrix
            const matrix = await git.statusMatrix({ fs, dir: GIT_DIR });
            const hasStagedChanges = matrix.some(row => row[1] !== row[3]);
            
            // 1. Commit if changes exist
            if (hasStagedChanges) {
                            try {
                                const sha = await git.commit({
                                    ...config,
                                    message: `Sync from FeatherNote: ${new Date().toISOString()}`,
                                });
                                console.log('GIT: Committed:', sha);
                            } catch (e) {
                                if (e.message && (e.message.includes('nothing to commit') || e.message.includes('no changes'))) {
                                    console.log('GIT: Nothing to commit.');
                                } else {
                                    throw e;
                                }
                            }
                        } else {
                            console.log('GIT: Nothing to commit (staged index matches HEAD).');
                        }
                        
                        // 2. Push with Fallbacks (always try, to push any existing local commits or merges)
                        const pushOptions = { ...config, url: creds.repoUrl, ref: remoteRef };
                    try {
            // Attempt 1: Standard Push
            console.log('GIT: Pushing...');
            await git.push(pushOptions);
            console.log('GIT: Pushed successfully.');

        } catch (pushErr) {
            console.warn('GIT: Push failed, attempting to pull and retry:', pushErr);
            
            try {
                // Attempt 2: Pull (Fetch + Merge) then Push
                await git.pull({
                    ...pushOptions,
                    singleBranch: true,
                    author: config.author
                });
                console.log('GIT: Pull successful. Retrying push...');
                
                await git.push(pushOptions);
                console.log('GIT: Pushed successfully after merge.');

            } catch (retryErr) {
                // Attempt 3: Force Push
                console.warn('GIT: Standard push failed after merge. Attempting force push as final fallback:', retryErr);
                await git.push({ ...pushOptions, force: true });
                console.log('GIT: Force push successful.');
            }
        }
    } catch (e) {
        if (e.code === 'MissingName') {
             console.error('GIT: Git Commit Failed: Missing Author Name/Email');
        } else {
            console.error('GIT: Git Sync Error:', e);
        }
    }
};