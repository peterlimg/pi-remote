# Deliver a generated video

Pi Remote renders generated videos as conversation attachments. Tap the preview to load the video, then use the player's controls or **Download video**. Downloads also work when the browser cannot decode the video. On iOS, the browser may open a preview or share sheet instead of saving directly.

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

Only explicit attachments in the watched conversation can be read. Reads use the authenticated WebSocket, including end-to-end encryption when using a relay. Local paths, Markdown links, tool output, files in another conversation, and symlinks do not grant file access. No public download URL is created. Switching conversations releases browser video blobs.
