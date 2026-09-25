/**
 * Widths the workspace shares. Past `SHELL_MAX_WIDTH` an ultrawide only adds margin:
 * a line of prescription that runs 3000px wide is unreadable, and the eye loses the
 * row it is on between the exercise name and the coach note.
 */
export const SHELL_MAX_WIDTH = 1680;

/** Fixed left columns (500) plus the narrowest a week block is allowed to be (532). */
export const GRID_MIN_WIDTH = 1032;
