/* Meta Pixel for URCypher (dataset "URCypher Website").
 * PageView on every visit; app.js sends "Lead" only after an RSVP is confirmed saved.
 * Kept in its own file because the site's security policy blocks inline scripts.
 * No form answers are sent to Meta from here.
 */
(function (f, b, e, v, n, t, s) {
  if (f.fbq) return;
  n = f.fbq = function () { n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments); };
  if (!f._fbq) f._fbq = n;
  n.push = n; n.loaded = true; n.version = "2.0"; n.queue = [];
  t = b.createElement(e); t.async = true; t.src = v;
  s = b.getElementsByTagName(e)[0]; s.parentNode.insertBefore(t, s);
})(window, document, "script", "https://connect.facebook.net/en_US/fbevents.js");

window.fbq("init", "1030469333406553");
window.fbq("track", "PageView");
