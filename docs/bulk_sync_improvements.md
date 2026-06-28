# Feature Plan: Bulk Sync Improvements

We are implementing two specific sync enhancements requested by the user:
1. **Item 2: Guard Upload Selection on Failed Listings:** If a sync provider's listing fails, we must not falsely assume our local notes are missing from that provider (which would trigger unnecessary massive re-upload storms). We will track which provider listings failed and bypass the "missing" check for those failed providers.
2. **Item 3: S3 Bulk Delete:** S3 supports deleting up to 1,000 keys in a single batch request (`deleteObjects`). We will implement `deleteNotesFromS3Bulk` in `src/s3.js` and integrate it into `helpers.js:synchronize` to execute deletes in a single batched S3 request.

---

## 1. Step-by-Step Design for Item 2 (Guard Upload Selection on Failed Listings)

### 1.1 Update `listNotes()` in `src/helpers.js`
Modify `listNotes` to return `failedProviders` listing status:
- Return `failedProviders` object mapping each provider key to a boolean status indicating whether the listing failed.
- A provider is considered failed if its settled promise status is `'rejected'`.

```javascript
// Inside listNotes()
const failedProviders = {
    s3: s3Res.status === 'rejected',
    nostr: nostrRes.status === 'rejected',
    git: gitRes.status === 'rejected',
    gdrive: gdriveRes.status === 'rejected',
    ipfs: ipfsRes.status === 'rejected',
};

return {
    mergedNotes: Array.from(mergedNotes.values()),
    s3Ids: new Set(s3Notes.map(n => n.id)),
    gitIds: new Set(gitNotes.map(n => n.id)),
    // ... maps and sets
    listingSucceeded,
    failedProviders
};
```

### 1.2 Update `synchronize()` upload decision filter in `src/helpers.js`
In `synchronize()`, extract `failedProviders` from the result of `listNotes()`.
When determining `notesToUpload`, check `!failedProviders.<provider_key>` before determining if a note is missing from that provider:

```javascript
const { mergedNotes: remoteNoteMetadata, s3Ids, ..., failedProviders } = await listNotes(...);

// Inside notesToUpload calculation:
if (gitCredentials?.repoUrl && !failedProviders.git) {
    const gitMeta = gitMap.get(localNote.id);
    if (!gitMeta || localDate > new Date(gitMeta.updatedAt || gitMeta.createdAt)) return true;
}
if (credentials.secretAccessKey && !failedProviders.s3) {
    const s3Meta = s3Map.get(localNote.id);
    if (!s3Meta || localDate > new Date(s3Meta.updatedAt)) return true;
}
if (nostrPrivateKey && !failedProviders.nostr) {
    const nostrMeta = nostrMap.get(localNote.id);
    if (!nostrMeta || localDate > new Date(nostrMeta.updatedAt || nostrMeta.createdAt)) return true;
}
if (gdriveStore?.connected && !failedProviders.gdrive) {
    const gdriveMeta = gdriveMap.get(localNote.id);
    if (!gdriveMeta || localDate > new Date(gdriveMeta.updatedAt || gdriveMeta.createdAt)) return true;
}
if ((credentials.pinataJwt || credentials.pinataApiKey || credentials.useDirectIpfs) && !failedProviders.ipfs) {
    const ipfsMeta = ipfsMap.get(localNote.id);
    if (!ipfsMeta || localDate > new Date(ipfsMeta.updatedAt)) return true;
}
```

---

## 2. Step-by-Step Design for Item 3 (S3 Bulk Delete)

### 2.1 Implement `deleteNotesFromS3Bulk` in `src/s3.js`
Implement a new function `deleteNotesFromS3Bulk` that aggregates keys and calls `s3.deleteObjects()` in a single request.
- Ensure flat keys (for backward compatibility) are included in the deletion batch.
- Export `deleteNotesFromS3Bulk` on `_GLOBAL`.

```javascript
const deleteNotesFromS3Bulk = async (notesOrIds, creds) => {
    if (!creds?.secretAccessKey || !notesOrIds || notesOrIds.length === 0) return;

    const s3 = await getS3Client(creds);
    const keysToDelete = new Set();

    notesOrIds.forEach(noteOrId => {
        const id = typeof noteOrId === 'string' ? noteOrId : noteOrId.id;
        const key = getS3ObjectKey(noteOrId.path || noteOrId, creds);
        keysToDelete.add(key);

        const flatKey = getS3ObjectKey(id, creds);
        if (key !== flatKey) {
            keysToDelete.add(flatKey);
        }
    });

    if (keysToDelete.size === 0) return;

    const params = {
        Bucket: creds.bucket,
        Delete: {
            Objects: Array.from(keysToDelete).map(key => ({ Key: key })),
            Quiet: true
        }
    };

    try {
        await s3.deleteObjects(params).promise();
        console.log(`S3 Bulk: Deleted ${keysToDelete.size} objects from S3 successfully.`);
    } catch (err) {
        console.error("S3 Bulk Delete Error:", err);
        throw new Error(`Failed to perform bulk delete in S3: ${err.code} - ${err.message}`);
    }
};

// Export to _GLOBAL
_GLOBAL.deleteNotesFromS3Bulk = deleteNotesFromS3Bulk;
```

### 2.2 Update `deleteNoteFromRemotes` in `src/helpers.js`
Add `skipS3` option to `deleteNoteFromRemotes` to avoid redundant S3 deletion when running S3 bulk delete:
```javascript
async function deleteNoteFromRemotes({noteId, credentials, nostrPrivateKey, nostrRelays, gdriveStore, gitCredentials, remoteMeta, skipS3 = false}) {
    // ...
    if (credentials?.secretAccessKey && !skipS3) {
        promises.push(deleteNoteFromS3(remoteMeta || noteId, credentials));
    }
    // ...
}
```

### 2.3 Integrate S3 Bulk Delete into `synchronize()` in `src/helpers.js`
In the delete step of `synchronize()`:
1. Check if S3 credentials are configured and there are deleted IDs.
2. If so, call `_GLOBAL.deleteNotesFromS3Bulk(s3NotesOrIds, credentials)` as a separate single promise.
3. Call `deleteNoteFromRemotes` with `skipS3: true` for the standard deletions mapping.
4. Wait for all deletions and the S3 bulk delete to complete using `Promise.allSettled()`.

```javascript
		// --- Step 3: Determine which notes to delete from Remotes ---
		let s3DeletePromise = Promise.resolve();
		const hasS3 = !!credentials?.secretAccessKey;
		if (hasS3 && effectiveDeletedNoteIds.length > 0) {
			const s3NotesOrIds = effectiveDeletedNoteIds.map(id => remoteMetaMap.get(id) || id);
			if (typeof _GLOBAL.deleteNotesFromS3Bulk === 'function') {
				s3DeletePromise = _GLOBAL.deleteNotesFromS3Bulk(s3NotesOrIds, credentials);
			}
		}

		const deletePromises = effectiveDeletedNoteIds.map(noteId => {
			const remoteMeta = remoteMetaMap.get(noteId);
			const gdriveMeta = gdriveMap?.get(noteId);
			return deleteNoteFromRemotes({
				noteId, credentials, nostrPrivateKey, nostrRelays, gdriveStore, gitCredentials, remoteMeta: gdriveMeta || remoteMeta,
				skipS3: hasS3
			});
		});

		// --- Step 4: Execute deletes (deletes are fast, run in parallel) ---
		const deleteResults = await Promise.allSettled([...deletePromises, s3DeletePromise]);
```

---

## 3. Backward Compatibility & Verification Strategy

- **Backward Compatibility:** All parameters defaulted (`skipS3 = false`). Legacy calls of `deleteNoteFromRemotes` behave identically.
- **Verification:** Run sync process and check that:
  - If a single listing fails, the other services successfully list and we don't trigger upload storms of local notes.
  - S3 deletes are bundled and executed via `deleteObjects` efficiently.
