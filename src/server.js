try { require('dotenv').config(); } catch (e) { /* dotenv optional on Deno Deploy */ }
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const net = require('net');
const http = require('http');
const https = require('https');
const dns = require('dns').promises;
const { TextEncoder } = require('util');
const multer = require('multer');
const { marked, Marked } = require('marked');
let openKv = null; // lazy-loaded only when Deno KV publish is enabled
const _getOpenKv = () => {
	if (!openKv) openKv = require('@deno/kv').openKv;
	return openKv;
};

// --- YAML Fallback for Server ---
const YAML = {
	stringify: (obj) => JSON.stringify(obj, null, 2),
	parse: (str) => JSON.parse(str)
};

// console.log('CLOUDFLARE_ACCOUNT_ID=' + Deno.env.get('CLOUDFLARE_ACCOUNT_ID'))
// console.log('CLOUDFLARE_API_TOKEN=' + Deno.env.get('CLOUDFLARE_API_TOKEN'))
// console.log('CLOUDFLARE_KV_NAMESPACE_ID=' + Deno.env.get('CLOUDFLARE_KV_NAMESPACE_ID'))
// console.log('GOOGLE_CLIENT_ID=' + Deno.env.get('GOOGLE_CLIENT_ID'))
// console.log('NEXT_PUBLIC_GOOGLE_CLIENT_ID=' + Deno.env.get('NEXT_PUBLIC_GOOGLE_CLIENT_ID'))
// console.log('NODE_ENV=' + Deno.env.get('NODE_ENV'))
// console.log('PUBLISH_DENO_KV_ACCESS_TOKEN=' + Deno.env.get('PUBLISH_DENO_KV_ACCESS_TOKEN'))
// console.log('PUBLISH_DENO_KV_URL=' + Deno.env.get('PUBLISH_DENO_KV_URL'))
// console.log('PUBLISH_USE_CLOUDFLAREKV=' + Deno.env.get('PUBLISH_USE_CLOUDFLAREKV'))	

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
const port = process.env.PORT || process.env.DENO_DEPLOY_PORT || 8000;
const upload = multer();
const DENO_KV_SIZE_LIMIT = 65536;



const escapeHtml = (value) => String(value ?? '')
	.replace(/&/g, '&amp;')
	.replace(/</g, '&lt;')
	.replace(/>/g, '&gt;')
	.replace(/"/g, '&quot;')
	.replace(/'/g, '&#39;');

const SAFE_URL_SCHEMES = ['http', 'https', 'mailto'];

// Decode entities and strip whitespace/control chars before reading the scheme, as browsers do.
const isUnsafeUrl = (href) => {
	const normalized = String(href || '')
		.replace(/&#x([0-9a-f]+);?/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
		.replace(/&#(\d+);?/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)))
		.replace(/&colon;/gi, ':')
		.replace(/&[a-z]+;/gi, '') // &Tab;, &NewLine; etc.
		.replace(/[\s\u0000-\u001f]/g, '');
	const scheme = normalized.match(/^([a-z][a-z0-9+.-]*):/i);
	return !!scheme && !SAFE_URL_SCHEMES.includes(scheme[1].toLowerCase());
};

// Published notes are user-submitted (POST /publish is open), so raw HTML and script URLs are neutralised.
const safeMarked = new Marked({
	renderer: {
		html(token) {
			return escapeHtml(typeof token === 'string' ? token : token.text);
		},
	},
	walkTokens(token) {
		if ((token.type === 'link' || token.type === 'image') && isUnsafeUrl(token.href)) {
			token.href = '#';
		}
	},
});

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

// Published notes persist to Deno Deploy's writable /tmp dir; falls back to in-memory.
const os = require('os');
const publishedNotesDir = process.env.DENO_DEPLOYMENT_ID ? path.join(os.tmpdir(), 'published_notes') : path.join(__dirname, 'published_notes');
try { if (!fs.existsSync(publishedNotesDir)) fs.mkdirSync(publishedNotesDir, { recursive: true }); } catch (e) { console.warn('published_notes dir init skipped:', e.message); }

try {
	const filePath = path.join(publishedNotesDir, `uptime.json`);
	fs.writeFileSync(filePath, JSON.stringify({date: new Date()}));
} catch (ex) { console.warn('uptime write skipped:', ex.message); }

app.use(express.json()); // Middleware to parse JSON request bodies

// --- Firebase Admin SDK Init (lazy: only loads when configured, never crashes boot) ---
let admin = null;
let isFirebaseInitialized = false;

try {
	if (process.env.FIREBASE_SERVICE_ACCOUNT) {
		admin = require('firebase-admin');
		const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
		admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
		isFirebaseInitialized = true;
		console.log('Firebase Admin initialized via env var.');
	} else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
		admin = require('firebase-admin');
		admin.initializeApp();
		isFirebaseInitialized = true;
		console.log('Firebase Admin initialized via GOOGLE_APPLICATION_CREDENTIALS.');
	}
} catch (e) {
	console.warn('Firebase Admin init skipped:', e.message);
}

// --- Scheduled Tasks Management (CFKV Persistence) ---
let scheduledTasks = {};

const loadScheduledTasks = async () => {
	try {
		if (!process.env.CLOUDFLARE_ACCOUNT_ID) return;
		
		const data = await CFKV.get('scheduled_tasks');
		if (data) {
			try {
				const tasks = JSON.parse(data);
				Object.values(tasks).forEach(task => scheduleTaskExecution(task));
				console.log(`Loaded ${Object.keys(tasks).length} scheduled tasks from CFKV.`);
			} catch (e) {
				console.warn('No valid scheduled tasks found in CFKV or parse error.');
			}
		}
	} catch (e) {
		console.error('Failed to load scheduled tasks from CFKV:', e);
	}
};

const saveScheduledTasks = async () => {
	try {
		if (!process.env.CLOUDFLARE_ACCOUNT_ID) return;

		const serializable = {};
		for (const [id, task] of Object.entries(scheduledTasks)) {
			const { timeoutId, ...rest } = task;
			serializable[id] = rest;
		}
		await CFKV.put('scheduled_tasks', JSON.stringify(serializable));
	} catch (e) {
		console.error('Failed to save scheduled tasks to CFKV:', e);
	}
};

const executeTask = async (task) => {
	const { id, token, title, body, url } = task;
	
	if (scheduledTasks[id]) {
		clearTimeout(scheduledTasks[id].timeoutId);
		delete scheduledTasks[id];
		await saveScheduledTasks();
	}

	if (!isFirebaseInitialized) {
		console.warn(`Cannot send task ${id}: Firebase not initialized.`);
		return;
	}

	try {
		await admin.messaging().send({
			token: token,
			notification: { title, body },
			data: { url: url || '/' },
			webpush: {
				fcm_options: { link: url || '/' },
				headers: { Urgency: 'high' }
			}
		});
		console.log(`Notification sent for task ${id}: "${title}"`);
	} catch (e) {
		console.error(`Failed to send notification for task ${id}:`, e);
	}
};

const scheduleTaskExecution = (task) => {
	const now = Date.now();
	const scheduledTime = new Date(task.scheduledTime).getTime();
	const delay = Math.max(0, scheduledTime - now);
	const id = task.id || crypto.randomBytes(8).toString('hex');
	
	const timeoutId = setTimeout(() => executeTask({ ...task, id }), delay);

	scheduledTasks[id] = { ...task, id, timeoutId };
};

app.post('/api/schedule-notification', async (req, res) => {
	const { token, noteId, title, body, scheduledTime, url } = req.body;
	if (!token || !scheduledTime) {
		return res.status(400).json({ error: 'Missing token or scheduledTime' });
	}

	const task = { id: noteId, token, title, body, scheduledTime, url };
	scheduleTaskExecution(task);
	await saveScheduledTasks();

	res.json({ success: true });
});

// SSRF guard for /api/proxy and /api/resolve-url: every hop is followed manually and must resolve only to public IPs.
// The check runs inside the socket's own DNS lookup, so the validated IP is the one connected to (no DNS rebinding window).
const RESOLVE_URL_MAX_HOPS = 5;
const RESOLVE_URL_TIMEOUT_MS = 4000;
const PROXY_MAX_BYTES = 5 * 1024 * 1024;

const _isPrivateIPv4 = (ip) => {
	const [a, b] = ip.split('.').map(Number);
	return a === 0 || a === 10 || a === 127 || a >= 224
		|| (a === 100 && b >= 64 && b <= 127)
		|| (a === 169 && b === 254)
		|| (a === 172 && b >= 16 && b <= 31)
		|| (a === 192 && (b === 168 || b === 0))
		|| (a === 198 && (b === 18 || b === 19));
};

const _isPrivateAddress = (ip) => {
	if (net.isIPv4(ip)) return _isPrivateIPv4(ip);
	const lower = ip.toLowerCase();
	const mappedIPv4 = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
	if (mappedIPv4) return _isPrivateIPv4(mappedIPv4);
	return lower === '::' || lower === '::1' || lower.startsWith('::ffff:')
		|| /^f[cd]/.test(lower) || /^fe[89ab]/.test(lower) || lower.startsWith('ff');
};

/** True when the URL is http(s) and its host resolves only to public addresses. */
const _isPublicHttpUrl = async (url) => {
	let parsed;
	try {
		parsed = new URL(url);
	} catch (e) {
		return false;
	}
	if (!['http:', 'https:'].includes(parsed.protocol)) return false;
	const hostname = parsed.hostname.replace(/^\[|\]$/g, '');
	if (net.isIP(hostname)) return !_isPrivateAddress(hostname);
	try {
		const addresses = await dns.lookup(hostname, { all: true });
		return addresses.length > 0 && addresses.every(({ address }) => !_isPrivateAddress(address));
	} catch (e) {
		return false;
	}
};

/** dns.lookup replacement for http(s).request: resolves once and refuses private addresses. */
const _publicOnlyLookup = (hostname, options, callback) => {
	dns.lookup(hostname, { all: true, family: options.family || 0 }).then(addresses => {
		if (!addresses.length || addresses.some(({ address }) => _isPrivateAddress(address))) {
			return callback(new Error(`Blocked non-public address for ${hostname}`));
		}
		if (options.all) return callback(null, addresses);
		callback(null, addresses[0].address, addresses[0].family);
	}).catch(callback);
};

/** One request (no redirect following) whose connection is pinned to a validated public IP. */
const _requestPublic = (url, method) => new Promise((resolve, reject) => {
	const client = url.startsWith('https:') ? https : http;
	const req = client.request(url, {
		method,
		lookup: _publicOnlyLookup,
		headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36' },
		timeout: RESOLVE_URL_TIMEOUT_MS,
	}, resolve);
	req.on('timeout', () => req.destroy(new Error('Request timed out')));
	req.on('error', reject);
	req.end();
});

/** Read a response body as text, refusing bodies larger than maxBytes. */
const _readBody = (response, maxBytes) => new Promise((resolve, reject) => {
	const chunks = [];
	let size = 0;
	response.on('data', chunk => {
		size += chunk.length;
		if (size > maxBytes) return response.destroy(new Error('Response too large'));
		chunks.push(chunk);
	});
	response.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
	response.on('error', reject);
});

/** Follow redirects manually, refusing any hop to a non-public address. Returns the final (unread) response. */
const _fetchPublic = async (startUrl, method = 'GET') => {
	let currentUrl = startUrl;
	for (let hop = 0; hop <= RESOLVE_URL_MAX_HOPS; hop++) {
		if (!await _isPublicHttpUrl(currentUrl)) throw new Error('Blocked non-public URL');
		const response = await _requestPublic(currentUrl, method);
		const location = response.headers.location;
		if (response.statusCode < 300 || response.statusCode >= 400 || !location) return { response, url: currentUrl };
		response.resume();
		currentUrl = new URL(location, currentUrl).href;
	}
	throw new Error('Too many redirects');
};

const META_REFRESH_SCAN_BYTES = 64 * 1024;

/** Read at most maxBytes of a response as text, then drop the rest (unlike _readBody, never fails on size). */
const _readHead = (response, maxBytes) => new Promise((resolve) => {
	const chunks = [];
	let size = 0;
	const finish = () => {
		response.destroy();
		resolve(Buffer.concat(chunks).toString('utf8'));
	};
	response.on('data', chunk => {
		chunks.push(chunk);
		size += chunk.length;
		if (size >= maxBytes) finish();
	});
	response.on('end', finish);
	response.on('error', finish);
});

/** URL from <meta http-equiv="refresh" content="0; url=..."> (used by t.co, lnkd.in and other shorteners). */
const _getMetaRefreshUrl = (html) => {
	for (const [tag] of html.matchAll(/<meta\b[^>]*>/gi)) {
		if (!/http-equiv\s*=\s*["']?refresh/i.test(tag)) continue;
		const target = tag.match(/content\s*=\s*["']?\s*\d*\s*;?\s*url\s*=\s*['"]?([^"'>\s]+)/i)?.[1];
		if (target) return target.replace(/&amp;/g, '&');
	}
	return '';
};

/** Final destination URL: HTTP redirects plus HTML meta-refresh redirects, every hop SSRF-checked. */
const _resolveFinalUrl = async (startUrl) => {
	let currentUrl = startUrl;
	for (let hop = 0; hop <= RESOLVE_URL_MAX_HOPS; hop++) {
		const { response, url } = await _fetchPublic(currentUrl, 'GET');
		const isHtml = /text\/html/i.test(response.headers['content-type'] || '');
		const refreshUrl = isHtml ? _getMetaRefreshUrl(await _readHead(response, META_REFRESH_SCAN_BYTES)) : (response.destroy(), '');
		if (!refreshUrl) return url;
		currentUrl = new URL(refreshUrl, url).href;
	}
	return currentUrl;
};

app.get('/api/proxy', async (req, res) => {
	const urlToFetch = req.query.url;
	if (typeof urlToFetch !== 'string' || !await _isPublicHttpUrl(urlToFetch)) {
		return res.status(400).json({ error: 'A public http(s) url parameter is required.' });
	}

	try {
		const { response, url: finalUrl } = await _fetchPublic(urlToFetch);

		if (response.statusCode < 200 || response.statusCode >= 300) {
			// Forward the status and statusText from the target server
			response.resume();
			return res.status(response.statusCode).send(response.statusMessage);
		}

		const html = await _readBody(response, PROXY_MAX_BYTES);
		res.setHeader('X-Final-Url', finalUrl);
		res.send(html);
	} catch (error) {
		console.error(`Proxy error for ${urlToFetch}:`, error);
		res.status(500).json({ error: 'Failed to fetch the URL through proxy.' });
	}
});

// Follow redirects and return the final URL, used to tag shares by their real hostname.
app.get('/api/resolve-url', async (req, res) => {
	const url = req.query.url;
	if (typeof url !== 'string' || !await _isPublicHttpUrl(url)) {
		return res.status(400).json({ error: 'A public http(s) url parameter is required.' });
	}

	try {
		// GET (not HEAD): some servers reject HEAD, and meta-refresh shorteners need the HTML.
		const finalUrl = await _resolveFinalUrl(url);
		res.json({ url: finalUrl });
	} catch (error) {
		res.json({ url });
	}
});

// --- Share/Publish Endpoints ---
const PUBLISHED = {};
app.post('/api/publish', async (req, res) => {
	const { title, content, isEncrypted } = req.body;
	if (!content) {
		return res.status(400).json({ error: 'Content cannot be empty.' });
	}

	const noteId = crypto.randomBytes(8).toString('hex');
	const noteData = { title: title || 'Untitled Note', content, isEncrypted: !!isEncrypted };
	const noteString = YAML.stringify(noteData);
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
			const kv = await _getOpenKv()(process.env.PUBLISH_DENO_KV_URL, { accessToken: process.env.PUBLISH_DENO_KV_ACCESS_TOKEN });
			await kv.set(['published_notes', noteId], noteData);
		} else {
			// Fallback to filesystem for large notes or if Deno KV is not configured
			PUBLISHED[noteId] = noteData;
			try {
				const filePath = path.join(publishedNotesDir, `${noteId}.json`);
				if (!fs.existsSync(publishedNotesDir)) fs.mkdirSync(publishedNotesDir, { recursive: true });
				fs.writeFile(filePath, noteString, error => { if (error) console.warn('publish write skipped:', error.message); });
			} catch (e) { console.warn('publish write skipped:', e.message); }
		}
		res.json({ url: `/publish/${noteId}` });
	} catch (err) {
		console.error('Failed to save note:', err);
		res.status(500).json({ error: 'Failed to save note.' });
	}
});

app.get('/publish/:noteId', async (req, res) => {
	const { noteId } = req.params;

	try {
		let note = null;

		if (process.env.PUBLISH_USE_CLOUDFLAREKV === 'true') {
			const { CLOUDFLARE_KV_NAMESPACE_ID, CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID } = process.env;
			if (!CLOUDFLARE_KV_NAMESPACE_ID || !CLOUDFLARE_API_TOKEN || !CLOUDFLARE_ACCOUNT_ID) {
				throw new Error('Cloudflare KV environment variables are not set.');
			}

			const value = await CFKV.get(noteId);
			if (value) {
				note = YAML.parse(value);
			}
		}

		// First, try to fetch from Deno KV if it's enabled
		if (!note && process.env.PUBLISH_USE_DENOKV === 'true') {
			if (!process.env.PUBLISH_DENO_KV_URL || !process.env.PUBLISH_DENO_KV_ACCESS_TOKEN) {
				throw new Error('Deno KV environment variables are not set.');
			}
			const kv = await _getOpenKv()(process.env.PUBLISH_DENO_KV_URL, { accessToken: process.env.PUBLISH_DENO_KV_ACCESS_TOKEN });
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
				note = YAML.parse(data);
			} else {
				note = PUBLISHED[noteId];
			}
		}

		// If note is still not found, return 404
		if (!note) {
			return res.status(404).send('Note not found.');
		}

		if (note.isEncrypted) {
			// Payload lands inside a JS string literal; only base64 is valid ciphertext.
			if (!/^[A-Za-z0-9+/=]*$/.test(note.content || '')) {
				return res.status(400).send('Invalid encrypted payload.');
			}
			try {
				const templatePath = path.join(__dirname, 'self-decrypting.html');
				const template = fs.readFileSync(templatePath, 'utf8');
				const selfDecryptingHtml = template
					.replaceAll('{{TITLE}}', () => escapeHtml(note.title))
					.replace('{{ENCRYPTED_PAYLOAD}}', () => note.content);
				return res.send(selfDecryptingHtml);
			} catch (e) {
				console.error('Failed to load self-decrypting template:', e);
				return res.status(500).send('Internal server error loading encrypted template.');
			}
		}

		const htmlContent = safeMarked.parse(note.content || '');
		const safeTitle = escapeHtml(note.title);
		res.send(generateHtmlPage(safeTitle, `<h1>${safeTitle}</h1>\n${htmlContent}`));
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
	console.log('Shared content received on server (POST):', req.body);
	const { title, url, text } = req.body;
	const redirectUrl = `/?title=${encodeURIComponent(title || '')}&url=${encodeURIComponent(url || '')}&text=${encodeURIComponent(text || '')}`;
	res.redirect(redirectUrl);
});

app.get('/share', (req, res) => {
	console.log('Shared content received on server (GET):', req.query);
	const { title, url, text } = req.query;
	const redirectUrl = `/?title=${encodeURIComponent(title || '')}&url=${encodeURIComponent(url || '')}&text=${encodeURIComponent(text || '')}`;
	res.redirect(redirectUrl);
});

app.get('/api/version', (req, res) => {
	res.json({ version: appVersion || 'unknown' });
});

let appVersion;
let HTML_INDEX = null;
try { HTML_INDEX = fs.readFileSync(path.join(__dirname, 'index.html'), {encoding: 'utf8'}); } catch (e) { console.warn('index.html preload skipped:', e.message); }
(async () => {
	try { appVersion = await getAppVersion(); } catch (e) { console.warn('version hash skipped:', e.message); appVersion = 'unknown'; }
	try { await loadScheduledTasks(); } catch (e) { console.warn('scheduled tasks skipped:', e.message); }

	if (process.argv[2] === '--version') {
		console.log(appVersion);
		process.exit(0);
	}

	try {
		const readmePath = path.join(__dirname, '..', 'README.md');
		const readmeMarkdown = fs.readFileSync(readmePath, 'utf8');
		const introMarkdown = readmeMarkdown.split('## Philosophy')[0];
		const welcomeHtml = marked.parse(introMarkdown);

		HTML_INDEX = (HTML_INDEX || '')
					.replaceAll?.('___VERSION___', appVersion)
					.replaceAll?.('___GOOGLE_CLIENT_ID___', process.env.GOOGLE_CLIENT_ID || '')
					.replace('<!--WELCOME_CONTENT-->', welcomeHtml);
	} catch (e) { console.warn('welcome content skipped:', e.message); }

	app.listen(port, '0.0.0.0', () => {
		console.log(`Server openned: http://localhost:${port}`);
		console.log()
		console.log(`Versioning url: http://localhost:${port}/?v=${appVersion}`);
	});
})();


