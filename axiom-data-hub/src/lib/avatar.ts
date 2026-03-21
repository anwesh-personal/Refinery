// ═══════════════════════════════════════════════════════════════
// Avatar URL Resolution
//
// Provides a deterministic, beautiful fallback avatar for any user
// who hasn't uploaded their own. Uses DiceBear's "notionists-neutral"
// style — clean, professional, gender-neutral illustrations.
//
// Priority:
//   1. User's custom avatar_url (uploaded or pasted URL)
//   2. Generated DiceBear avatar seeded from email (deterministic)
//
// The seed ensures the same user always gets the same generated
// avatar — across sessions, devices, and page loads.
// ═══════════════════════════════════════════════════════════════

const DICEBEAR_STYLE = 'notionists-neutral';
const DICEBEAR_VERSION = '9.x';
const DICEBEAR_BASE = `https://api.dicebear.com/${DICEBEAR_VERSION}/${DICEBEAR_STYLE}`;

// Soft background palette that works in both light and dark themes
const BACKGROUNDS = 'b6e3f4,c0aede,d1d4f9,ffd5dc,ffdfbf';

/**
 * Resolve the best avatar URL for a user.
 *
 * @param avatarUrl - The user's stored avatar_url (may be null/empty)
 * @param seed     - A stable identifier to seed the generated avatar (email is ideal)
 * @param size     - Pixel size of the generated avatar (default 128)
 * @returns        - A usable image URL — guaranteed non-null
 */
export function getAvatarUrl(
    avatarUrl: string | null | undefined,
    seed: string,
    size: number = 128,
): string {
    // If the user has a real avatar, use it
    if (avatarUrl && avatarUrl.trim().length > 0) return avatarUrl;

    // Generate a deterministic DiceBear avatar from the seed
    return `${DICEBEAR_BASE}/svg?seed=${encodeURIComponent(seed)}&size=${size}&backgroundColor=${BACKGROUNDS}`;
}

/**
 * Build a DiceBear URL for persisting to the database.
 * Used on user creation when no avatar is provided.
 */
export function generateDefaultAvatarUrl(email: string): string {
    return `${DICEBEAR_BASE}/svg?seed=${encodeURIComponent(email)}&size=256&backgroundColor=${BACKGROUNDS}`;
}
