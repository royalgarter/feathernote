# Bookmarklet Feature Plan

## Goal
Create a browser bookmarklet that allows users to quickly share the current page (URL, title, and description/selection) to FeatherNote.

## Implementation Details

### Bookmarklet JavaScript Code
The bookmarklet will be a `javascript:` URL that:
1.  Extracts `document.title`.
2.  Extracts `window.location.href`.
3.  Extracts selected text using `window.getSelection().toString()`.
4.  If no text is selected, it falls back to the content of `<meta name="description">`.
5.  Opens a new window pointing to `[FeatherNote Origin]/share` with the extracted data as query parameters.

```javascript
javascript:(function(){
  var title = document.title;
  var url = window.location.href;
  var text = window.getSelection().toString();
  if (!text) {
    var meta = document.querySelector('meta[name="description"]');
    if (meta) text = meta.content;
  }
  var baseUrl = "https://feathernote.newsrss.org"; // To be replaced dynamically
  var shareUrl = baseUrl + "/share?title=" + encodeURIComponent(title) + "&url=" + encodeURIComponent(url) + "&text=" + encodeURIComponent(text);
  window.open(shareUrl, '_blank');
})();
```

### UI Integration
- Add a "Bookmarklet" section in the Settings dialog.
- Display a link that users can drag to their bookmarks bar.
- The link's `href` will be dynamically generated based on `window.location.origin`.

### Data Handling
The `/share` route is already handled by the service worker and `server.js`.
- `serviceworker.js` handles GET and POST requests to `/share`.
- It extracts `title`, `url`, and `text`.
- it creates or updates a "Shared Inbox" note.

## Verification Plan
1.  Open FeatherNote settings.
2.  Find the bookmarklet link.
3.  Drag it to the bookmarks bar.
4.  Navigate to a different website.
5.  Click the bookmarklet.
6.  Verify that a new tab opens FeatherNote and the page info is added to the "Shared Inbox".
