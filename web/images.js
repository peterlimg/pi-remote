export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
export const MAX_IMAGES = 4;
// Keep base64 plus prompt and relay envelopes below the 4 MiB WebSocket limit.
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
export const IMAGE_LIMIT = 'Attach up to 4 images, 2 MB total. Use JPEG, PNG, GIF or WebP.';

export function validateImages(images = []) {
  if (!Array.isArray(images) || images.length > MAX_IMAGES) throw new Error(IMAGE_LIMIT);
  let bytes = 0;
  return images.map(image => {
    if (image?.type !== 'image' || !IMAGE_TYPES.includes(image.mimeType) || typeof image.data !== 'string' ||
      !image.data.length || image.data.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 || image.data.length % 4 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(image.data)) throw new Error(IMAGE_LIMIT);
    bytes += image.data.length / 4 * 3 - (image.data.endsWith('==') ? 2 : image.data.endsWith('=') ? 1 : 0);
    if (bytes > MAX_IMAGE_BYTES) throw new Error(IMAGE_LIMIT);
    return { type: 'image', data: image.data, mimeType: image.mimeType };
  });
}
