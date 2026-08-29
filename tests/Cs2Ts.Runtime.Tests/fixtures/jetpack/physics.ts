// The half of a jetpack that is arithmetic: no game in it, no globals, just numbers.
//
// Splitting it out is what a plugin being a folder is for. This file can be read and
// changed without the rest of the plugin in your head, and the rest of the plugin is
// shorter for not having it inlined.

/** Game units added to a player's height by a full charge. */
export const BOOST_SPEED = 350;

export function clamp(value: number, low: number, high: number): number {
    return Math.min(high, Math.max(low, value));
}

/** Where a boost of this charge puts something currently at `z`. */
export function boostFrom(z: number, charge: number): number {
    return z + BOOST_SPEED * clamp(charge, 0, 1);
}
