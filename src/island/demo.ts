/**
 * Demo mode, for screenshots and videos: personal details on screen (network
 * and device names, the weather's town) are replaced with neutral ones and
 * Windows notifications get no banner. Turned on only by hand, in the island's
 * developer tools: localStorage.setItem('kotilo.demo', '1'), then reload.
 */
export const DEMO = (() => {
  try {
    return localStorage.getItem('kotilo.demo') === '1';
  } catch {
    return false;
  }
})();

/** The real value, or the neutral stand-in in demo mode. */
export const demo = <T,>(real: T, standIn: T): T => (DEMO ? standIn : real);
