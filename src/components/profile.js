// Username and profile picture, shown in the header, the profile menu and on shared P&L cards.
// Pictures are stored on the paper server as small data: URLs, so they also render on the FOMO
// page, whose content policy blocks image hosts but allows data: images.
import { escapeHtml } from './format.js';

export const NAME_MIN = 2;
export const NAME_MAX = 24;
const AVATAR_PX = 128;
const MAX_FILE_BYTES = 8 * 1024 * 1024;

/** Whatever is wrong with `name`, in a sentence, or null when it is fine. */
export function nameError(name) {
  const trimmed = String(name ?? '').trim();
  if (trimmed.length < NAME_MIN) return `Your username needs at least ${NAME_MIN} characters.`;
  if (trimmed.length > NAME_MAX) return `Your username can be at most ${NAME_MAX} characters.`;
  return null;
}

/** A name to show before the user has picked one (the part of their email before the @). */
export const suggestedName = (user) => (user?.displayName || user?.email || '').split('@')[0].slice(0, NAME_MAX);

/**
 * Reads a picked image file and returns a square data: URL, downscaled to 128px and
 * compressed, so the upload stays a few kilobytes rather than several megabytes.
 */
export async function fileToAvatarDataUrl(file) {
  if (!file || !file.type.startsWith('image/')) throw new Error('Choose an image file.');
  if (file.size > MAX_FILE_BYTES) throw new Error('That image is too large. Choose one under 8 MB.');

  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error("That image couldn't be read. Try a PNG or JPEG.");
  });
  const canvas = document.createElement('canvas');
  canvas.width = AVATAR_PX;
  canvas.height = AVATAR_PX;
  const ctx = canvas.getContext('2d');
  // Cover: fill the square from the middle of the image, no stretching.
  const side = Math.min(bitmap.width, bitmap.height);
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, AVATAR_PX, AVATAR_PX);
  bitmap.close?.();

  for (const quality of [0.85, 0.7, 0.5]) {
    const url = canvas.toDataURL('image/webp', quality);
    if (url.startsWith('data:image/webp')) return url;
  }
  return canvas.toDataURL('image/png');
}

/** Round avatar for the settings screens: the picture when there is one, the initial otherwise. */
export function avatarPreview(user, { size = 56 } = {}) {
  const initial = escapeHtml((user?.displayName || user?.email || '?').trim().slice(0, 1).toUpperCase());
  const style = `width:${size}px;height:${size}px`;
  return user?.photoUrl
    ? `<img class="pfp" src="${escapeHtml(user.photoUrl)}" alt="" width="${size}" height="${size}" style="${style}" referrerpolicy="no-referrer" />`
    : `<span class="pfp letter" style="${style}" aria-hidden="true">${initial}</span>`;
}
