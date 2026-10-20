# Deliver a generated video

Pi Remote renders generated videos as conversation attachments. Tap the preview to load the video, then use the player's controls or **Download video**. Phones that support file sharing open the native share sheet; choose **Save Video** or **Save to Files** on iOS. Other browsers use a download link that cannot replace the chat tab. Saving also works when the browser cannot decode the video. Canceling the share sheet leaves the conversation open.

For still images and screenshots, use the `read` tool on the image file. Image attachments appear directly in the conversation, outside collapsed tool details, and open full size on tap. Do not convert a still image to a video just to display it.

For agents:

1. Finish editing and inspect the export for sensitive information. Do not attach raw inspection frames or the original when the user requested a redacted copy.
2. Copy the finished video into `$PI_REMOTE_HOME/videos/<new UUID>/<filename>`. The default home is `~/.pi/remote`. Create the directory with mode `0700` and the file with mode `0600`. Keep the original unchanged. Do not use symlinks.
3. Use a filename of at most 180 ASCII letters, digits, dots, underscores, or hyphens, with a video extension. Each video must be nonempty and at most 200 MB. Prefer H.264 MP4 for mobile playback.
4. End an assistant message with this exact block, separated from preceding prose by a blank line. Use the actual absolute path, JSON-quoted, one per line. Up to four paths are allowed. Do not use a Markdown code fence or put text after the paths.

```text
Generated video files (on this computer):
"/absolute/remote/home/videos/12345678-1234-1234-1234-123456789abc/edited.mp4"
```

`videoMessage(text, paths, 'assistant')` in `web/videos.js` produces this format for integrations.

Only explicit attachments in the watched conversation can be read. Reads use the authenticated WebSocket, including end-to-end encryption when using a relay. Local paths, Markdown links, tool output, files in another conversation, and symlinks do not grant file access. No public download URL is created. Switching conversations releases player URLs and memory. Watched videos are cached on the device, up to 400 MiB per login, with the oldest downloads removed first. Reopening a video checks its authorization and file revision on the computer before reusing cached bytes. Signing out or changing credentials clears that login's cache. If browser storage is blocked, full, or evicted, playback falls back to downloading again. The cache belongs to the site's origin, so a different tunnel domain has a separate cache. Save to Photos or Files for a permanent copy.
