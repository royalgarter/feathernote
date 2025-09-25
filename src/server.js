require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { TextEncoder } = require('util');
const multer = require('multer');
const { marked } = require('marked');
const openKv = (process.env.PUBLISH_USE_DENOKV === 'true') ? require('@deno/kv').openKv : null;

const CFKV = {
	HOST: (k) => `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/storage/kv/namespaces/${process.env.CLOUDFLARE_KV_NAMESPACE_ID}/values/${k}`,
	HEADERS: {
		'Authorization': `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`
	},
	put: async (k, v, e) => {
		const form = new FormData();
		form.append('value', v);

		return fetch(CFKV.HOST(k) + `?expiration_ttl=${e || ''}`, {
			method: 'PUT',
			headers: CFKV.HEADERS,
			body: form
		}).then(r => r.json()).catch();
	},
	get: async (k) => {
		return fetch(CFKV.HOST(k), {
			method: 'GET',
			headers: CFKV.HEADERS,
		}).then(r => r.text()).catch();
	},
	del: async (k) => {
		return fetch(CFKV.HOST(k), {
			method: 'DELETE',
			headers: CFKV.HEADERS,
		}).then(r => r.json()).catch();
	},
}

const getAppVersion = async () => {
	try {
		const hash = crypto.createHash('sha1');
		const keyFiles = fs.readdirSync(__dirname).filter(x => x.includes('.js') || x.includes('.htm') || x.includes('.cs'));

		for (const fileName of keyFiles) {
			const filePath = path.join(__dirname, fileName);
			const content = await fs.promises.readFile(filePath);
			hash.update(content);
		}

		return hash.digest('hex').slice(0, 7);
	} catch (error) {
		console.error('Failed to generate version hash:', error);
		return 'unknown';
	}
};

const app = express();
const port = process.env.PORT || 7347;
const upload = multer();
const DENO_KV_SIZE_LIMIT = 65536;



const generateHtmlPage = (title, bodyContent) => {
	return `
		<!DOCTYPE html>
		<html lang="en">
		<head>
			<meta charset="UTF-8">
			<meta name="viewport" content="width=device-width, initial-scale=1.0">
			<title>${title} on FeatherNote</title>
			<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@picocss/pico@1/css/pico.min.css">
			<style>
				main.container { max-width: 100%; padding: 0; }
				article { margin: 1%; white-space: pre-wrap; word-break: break-word; }
				article img { max-width: 100%; }
			</style>
		</head>
		<body>
			<main class="container">
				<article>
					${bodyContent}
				</article>
			</main>
		</body>
		</html>
	`;
};

// Create a directory for published notes if it doesn't exist
const publishedNotesDir = path.join(__dirname, 'published_notes');
if (!fs.existsSync(publishedNotesDir)) fs.mkdirSync(publishedNotesDir);

try {
	const filePath = path.join(publishedNotesDir, `uptime.json`);
	fs.writeFileSync(filePath, JSON.stringify({date: new Date()}));
} catch (ex) {console.log(ex)}

app.use(express.json()); // Middleware to parse JSON request bodies

app.get('/api/proxy', async (req, res) => {
	const urlToFetch = req.query.url;
	if (!urlToFetch) {
		return res.status(400).json({ error: 'URL parameter is required.' });
	}

	try {
		// Use the built-in fetch in modern Node.js
		const response = await fetch(urlToFetch, {
			headers: { 'User-Agent': 'FeatherNote/1.0' } // Set a user-agent
		});

		if (!response.ok) {
			// Forward the status and statusText from the target server
			return res.status(response.status).send(response.statusText);
		}

		const html = await response.text();
		res.send(html);
	} catch (error) {
		console.error(`Proxy error for ${urlToFetch}:`, error);
		res.status(500).json({ error: 'Failed to fetch the URL through proxy.' });
	}
});

// --- Share/Publish Endpoints ---
const PUBLISHED = {};
app.post('/api/publish', async (req, res) => {
	const { title, content } = req.body;
	if (!content) {
		return res.status(400).json({ error: 'Content cannot be empty.' });
	}

	const noteId = crypto.randomBytes(8).toString('hex');
	const noteData = { title: title || 'Untitled Note', content };
	const noteString = JSON.stringify(noteData);
	const noteSize = new TextEncoder().encode(noteString).length;

	try {
		if (process.env.PUBLISH_USE_CLOUDFLAREKV === 'true') {
			const { CLOUDFLARE_KV_NAMESPACE_ID, CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID } = process.env;
			if (!CLOUDFLARE_KV_NAMESPACE_ID || !CLOUDFLARE_API_TOKEN || !CLOUDFLARE_ACCOUNT_ID) {
				throw new Error('Cloudflare KV environment variables are not set.');
			}

			await CFKV.put(noteId, noteString);
		} else if (process.env.PUBLISH_USE_DENOKV === 'true' && noteSize <= DENO_KV_SIZE_LIMIT) {
			if (!process.env.PUBLISH_DENO_KV_URL || !process.env.PUBLISH_DENO_KV_ACCESS_TOKEN) {
				throw new Error('Deno KV environment variables are not set.');
			}
			const kv = await openKv(process.env.PUBLISH_DENO_KV_URL, { accessToken: process.env.PUBLISH_DENO_KV_ACCESS_TOKEN });
			await kv.set(['published_notes', noteId], noteData);
		} else {
			// Fallback to filesystem for large notes or if Deno KV is not configured
			const filePath = path.join(publishedNotesDir, `${noteId}.json`);
			if (!fs.existsSync(publishedNotesDir)) fs.mkdirSync(publishedNotesDir);
			fs.writeFile(filePath, noteString, error => {
				console.log(error);
				PUBLISHED[noteId] = noteData;
			});
		}
		res.json({ url: `/publish/${noteId}` });
	} catch (err) {
		console.error('Failed to save note:', err);
		res.status(500).json({ error: 'Failed to save note.' });
	}
});

app.get('/publish/:noteId', async (req, res) => {
	const { noteId } = req.params;
	if (!/^[a-f0-9]{16}$/.test(noteId)) {
		return res.status(400).send('Invalid note ID format.');
	}

	try {
		let note = null;

		if (process.env.PUBLISH_USE_CLOUDFLAREKV === 'true') {
			const { CLOUDFLARE_KV_NAMESPACE_ID, CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID } = process.env;
			if (!CLOUDFLARE_KV_NAMESPACE_ID || !CLOUDFLARE_API_TOKEN || !CLOUDFLARE_ACCOUNT_ID) {
				throw new Error('Cloudflare KV environment variables are not set.');
			}

			const value = await CFKV.get(noteId);
			if (value) {
				note = JSON.parse(value);
			}
		}

		// First, try to fetch from Deno KV if it's enabled
		if (!note && process.env.PUBLISH_USE_DENOKV === 'true') {
			if (!process.env.PUBLISH_DENO_KV_URL || !process.env.PUBLISH_DENO_KV_ACCESS_TOKEN) {
				throw new Error('Deno KV environment variables are not set.');
			}
			const kv = await openKv(process.env.PUBLISH_DENO_KV_URL, { accessToken: process.env.PUBLISH_DENO_KV_ACCESS_TOKEN });
			const result = await kv.get(['published_notes', noteId]);
			if (result.value) {
				note = result.value;
			}
		}

		// If not found in Deno KV, or if Deno KV is not enabled, try the filesystem
		if (!note) {
			const filePath = path.join(publishedNotesDir, `${noteId}.json`);
			if (fs.existsSync(filePath)) {
				const data = fs.readFileSync(filePath, 'utf8');
				note = JSON.parse(data);
			} else {
				note = PUBLISHED[noteId];
			}
		}

		// If note is still not found, return 404
		if (!note) {
			return res.status(404).send('Note not found.');
		}

		const htmlContent = marked.parse(note.content);
		res.send(generateHtmlPage(note.title, `<h1>${note.title}</h1>\n${htmlContent}`));
	} catch (err) {
		console.error('Failed to retrieve note:', err);
		res.status(500).send('Failed to retrieve note.');
	}
});

app.get('/about', (req, res) => {
	const readmePath = path.join(__dirname, '..', 'README.md');
	fs.readFile(readmePath, 'utf8', (err, markdown) => {
		if (err) {
			console.error('Failed to read README.md:', err);
			return res.status(500).send('Could not load about page.');
		}
		const htmlContent = marked.parse(markdown);
		res.set('Cache-Control', 'public, max-age=604800'); // 1 week
		res.send(generateHtmlPage('About FeatherNote', htmlContent));
	});
});

// Route for the main application page
app.get('/', (req, res) => HTML_INDEX ? res.send(HTML_INDEX) : res.sendFile(path.join(__dirname, 'index.html')) );

// Serve static files from the 'src' directory
app.use(express.static(path.join(__dirname), { maxAge: '7d' }));

// Handle shared content from PWA
app.post('/share', upload.none(), (req, res) => {
	// The service worker will handle this, but we have a server-side route as a fallback.
	// In a real app, you might save this to a temporary session or user-specific store.
	console.log('Shared content received on server:', req.body);
	res.redirect('/');
});

app.get('/api/version', (req, res) => {
	res.json({ version: appVersion || 'unknown' });
});

let appVersion;
let HTML_INDEX = fs.readFileSync(path.join(__dirname, 'index.html'), {encoding: 'utf8'});
(async () => {
	appVersion = await getAppVersion();

	if (process.argv[2] === '--version') {
		console.log(appVersion);
		process.exit(0);
	}

	HTML_INDEX = HTML_INDEX?.replaceAll?.('___VERSION___', appVersion);

	app.listen(port, () => {
		console.log(`Server listening at http://localhost:${port}/?v=${appVersion}&d=${publishedNotesDir}`);
	});
})();


