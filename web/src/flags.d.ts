/**
 * Build-time switches, replaced by their value when the site is built (see
 * `define` in vite.config.ts), so the code behind an off switch is removed
 * rather than hidden.
 */

/** FIVB's tournament photographs. Off until FIVB agrees to their use. */
declare const __TOURNAMENT_PHOTOS__: boolean;
