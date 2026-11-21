/* Squeek Orbit configuration.
 * archive: Squeekchain has shut down, so the site runs as an archived demo. The wheel, rounds and blocks
 *          are simulated in the browser and nothing is fetched from api.squeekchain.com.
 *          Set to false if the Squeekchain API ever comes back.
 * backend: URL of the optional shared server (server/ folder, a Cloudflare Worker). Empty = everything
 *          (leaderboard, raid, polls) stays on this device. Players can still point the app at a server
 *          with ?server=<url>. */
window.SQUEEK_ORBIT_CONFIG = {
  archive: true,
  backend: '',
};
