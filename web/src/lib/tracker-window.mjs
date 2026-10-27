/**
 * Which tracker rows the pipeline table mounts.
 *
 * The current table mounts every filtered row. This module exists so a test can
 * name the window the screen should keep. The stub below is the old behavior
 * on purpose: the test fails until the window is real.
 */

/**
 * @param {{ count: number }} input
 * @returns {{ start: number, end: number }}
 */
export function trackerWindow({ count }) {
  return { start: 0, end: count };
}
