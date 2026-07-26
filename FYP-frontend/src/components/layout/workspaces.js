/**
 * Workspace matching — a PURE module, deliberately not in the .jsx.
 *
 * Vite's Fast Refresh only hot-swaps modules whose exports are ALL React
 * components; a helper exported beside the component forces a full page reload
 * on every edit, discarding whatever you were part-way through. See
 * ./notifications.js for the same reasoning.
 */

/**
 * The workspace whose route best matches the current URL.
 *
 * @param {Array<{key:string,label:string,route:string}>|null} workspaces
 * @param {string} pathname
 * @returns {object|null}
 */
export function activeWorkspace(workspaces, pathname) {
  if (!Array.isArray(workspaces) || !workspaces.length) return null;
  const matches = workspaces
    .filter((workspace) => pathname === workspace.route || pathname.startsWith(`${workspace.route}/`))
    // Longest prefix wins, so '/doctor/ratings' does not match '/'.
    .sort((a, b) => b.route.length - a.route.length);
  return matches[0] || null;
}

export default activeWorkspace;
