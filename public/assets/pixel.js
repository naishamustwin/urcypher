/*
 * Meta Pixel for URCypher.com.
 * Turns on only when <meta name="meta-pixel-id"> in index.html holds a pixel (dataset) ID.
 * Sends PageView when the page opens, and Lead only after the Sheet confirms a new RSVP.
 * No names, emails, phone numbers or form answers are ever sent to Meta.
 */
(function () {
  window.urcTrackLead = function () {};

  var tag = document.querySelector('meta[name="meta-pixel-id"]');
  var id = tag ? tag.getAttribute("content").trim() : "";
  if (!/^\d{10,20}$/.test(id)) return;

  var fbq = window.fbq = function () {
    fbq.callMethod ? fbq.callMethod.apply(fbq, arguments) : fbq.queue.push(arguments);
  };
  if (!window._fbq) window._fbq = fbq;
  fbq.push = fbq;
  fbq.loaded = true;
  fbq.version = "2.0";
  fbq.queue = [];

  var s = document.createElement("script");
  s.async = true;
  s.src = "https://connect.facebook.net/en_US/fbevents.js";
  document.head.appendChild(s);

  fbq("init", id);
  fbq("track", "PageView");

  // A repeat RSVP from the same email is an update, not a new artist, so it isn't counted.
  window.urcTrackLead = function (isRepeat) {
    if (isRepeat) return;
    fbq("track", "Lead", { content_name: "URCypher RSVP" });
  };
})();
