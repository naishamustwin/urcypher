/* URCypher RSVP form
 * Sends the RSVP to /api/rsvp (a Netlify function), which saves it to the Google Sheet.
 * The page only shows "You're in the queue" after the Sheet confirms the row was saved.
 */
(function () {
  "use strict";

  var form = document.getElementById("rsvp-form");
  if (!form) return;

  var TEAM_EMAIL = "URCypherTeam@gmail.com";
  var DRAFT_KEY = "urcypher-rsvp-draft";
  var startedAt = Date.now();
  var submitBtn = document.getElementById("f-submit");
  var summary = document.getElementById("form-summary");
  var done = document.getElementById("done");

  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  var IG_RE = /^[A-Za-z0-9._]{1,30}$/;
  var YT_RE = /^https?:\/\/(www\.|m\.|music\.)?(youtube\.com|youtu\.be)\/\S+$/i;

  var fields = {
    firstName: { el: "f-first", err: "e-first" },
    lastName: { el: "f-last", err: "e-last" },
    stageName: { el: "f-stage", err: "e-stage" },
    instagram: { el: "f-ig", err: "e-ig" },
    genre: { el: "f-genre", err: "e-genre" },
    phone: { el: "f-phone", err: "e-phone" },
    email: { el: "f-email", err: "e-email" },
    youtube: { el: "f-yt", err: "e-yt" },
    profile: { el: "f-profile", err: "e-profile" },
    website: { el: "f-web", err: "e-web" }
  };
  Object.keys(fields).forEach(function (k) {
    fields[k].input = document.getElementById(fields[k].el);
    fields[k].errEl = document.getElementById(fields[k].err);
  });

  function val(k) { return fields[k].input.value.trim(); }

  function normUrl(v) {
    v = v.trim();
    if (!v) return "";
    if (!/^https?:\/\//i.test(v)) v = "https://" + v;
    try {
      var u = new URL(v);
      if (!/\./.test(u.hostname)) return null;
      return u.href;
    } catch (e) { return null; }
  }

  function ytLinks(v) {
    return v.split(/[\s,]+/).map(function (s) { return s.trim(); }).filter(Boolean).map(function (s) {
      return /^https?:\/\//i.test(s) ? s : "https://" + s;
    });
  }

  function validate() {
    var e = {};
    if (!val("firstName")) e.firstName = "Enter your first name.";
    if (!val("lastName")) e.lastName = "Enter your last name.";
    if (!val("stageName")) e.stageName = "Enter your stage name.";
    var ig = val("instagram").replace(/^@+/, "").replace(/^https?:\/\/(www\.)?instagram\.com\//i, "").replace(/\/.*$/, "");
    if (!ig) e.instagram = "Enter your Instagram handle.";
    else if (!IG_RE.test(ig)) e.instagram = "Use only letters, numbers, periods and underscores, like yourname_music.";
    if (!val("genre")) e.genre = "Choose your genre.";
    var digits = val("phone").replace(/\D/g, "");
    if (!digits) e.phone = "Enter your phone number.";
    else if (digits.length < 10 || digits.length > 15) e.phone = "Enter a full phone number with area code.";
    var em = val("email");
    if (!em) e.email = "Enter your email address.";
    else if (!EMAIL_RE.test(em)) e.email = "Check your email address. It should look like name@example.com.";
    var yt = ytLinks(val("youtube"));
    if (!yt.length) e.youtube = "Add at least one YouTube link.";
    else if (yt.length > 5) e.youtube = "Send up to 5 YouTube links.";
    else if (yt.some(function (l) { return !YT_RE.test(l); })) e.youtube = "Each link should be a YouTube link (youtube.com or youtu.be), one per line.";
    var p = val("profile");
    if (!p) e.profile = "Add a link to your artist profile.";
    else if (normUrl(p) === null) e.profile = "Check this link. It should look like https://open.spotify.com/artist/...";
    var w = val("website");
    if (w && normUrl(w) === null) e.website = "Check this link, or leave it empty.";
    return { errors: e, ig: ig, yt: yt };
  }

  function showErrors(errors) {
    var first = null;
    Object.keys(fields).forEach(function (k) {
      var f = fields[k], msg = errors[k];
      if (msg) {
        f.errEl.textContent = msg; f.errEl.hidden = false;
        f.input.setAttribute("aria-invalid", "true");
        if (!first) first = f.input;
      } else {
        f.errEl.textContent = ""; f.errEl.hidden = true;
        f.input.removeAttribute("aria-invalid");
      }
    });
    return first;
  }

  function showSummary(main, sub) {
    summary.innerHTML = "";
    var a = document.createElement("p"); a.textContent = main; summary.appendChild(a);
    if (sub) { var b = document.createElement("p"); b.textContent = sub; summary.appendChild(b); }
    summary.hidden = false;
    summary.scrollIntoView({ block: "center", behavior: "smooth" });
  }

  function setBusy(on) {
    submitBtn.disabled = on;
    document.getElementById("f-submit-label").textContent = on ? "Sending..." : "Send my RSVP";
  }

  // Keep a draft in this browser so nothing typed is lost on a failed send or a refresh.
  function saveDraft() {
    try {
      var d = {};
      Object.keys(fields).forEach(function (k) { d[k] = fields[k].input.value; });
      localStorage.setItem(DRAFT_KEY, JSON.stringify(d));
    } catch (e) {}
  }
  function loadDraft() {
    try {
      var d = JSON.parse(localStorage.getItem(DRAFT_KEY) || "null");
      if (!d) return;
      Object.keys(fields).forEach(function (k) { if (typeof d[k] === "string" && !fields[k].input.value) fields[k].input.value = d[k]; });
    } catch (e) {}
  }
  function clearDraft() { try { localStorage.removeItem(DRAFT_KEY); } catch (e) {} }
  loadDraft();
  form.addEventListener("input", saveDraft);

  form.addEventListener("input", function (ev) {
    var k = Object.keys(fields).find(function (key) { return fields[key].input === ev.target; });
    if (k && fields[k].input.getAttribute("aria-invalid") === "true") {
      var r = validate();
      if (!r.errors[k]) { fields[k].errEl.hidden = true; fields[k].input.removeAttribute("aria-invalid"); }
    }
  });

  function post(payload) {
    return fetch("/api/rsvp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    }).then(function (res) {
      return res.json().catch(function () { return null; }).then(function (data) { return { status: res.status, data: data }; });
    });
  }

  form.addEventListener("submit", function (ev) {
    ev.preventDefault();
    summary.hidden = true;
    var r = validate();
    var first = showErrors(r.errors);
    if (first) {
      var n = Object.keys(r.errors).length;
      showSummary(n === 1 ? "One field needs a fix before you can send." : n + " fields need a fix before you can send.");
      first.focus();
      return;
    }

    var payload = {
      firstName: val("firstName"),
      lastName: val("lastName"),
      stageName: val("stageName"),
      instagram: r.ig,
      genre: val("genre"),
      phone: val("phone"),
      email: val("email"),
      youtube: r.yt,
      profile: normUrl(val("profile")),
      website: val("website") ? normUrl(val("website")) : "",
      trap: document.getElementById("f-trap").value,
      elapsedMs: Date.now() - startedAt
    };

    setBusy(true);
    var attempt = function (n) {
      return post(payload).catch(function () { return { status: 0, data: null }; }).then(function (res) {
        // One quiet retry for network blips and Google timeouts.
        if ((res.status === 0 || res.status >= 502) && n < 1) {
          return new Promise(function (ok) { setTimeout(ok, 1500); }).then(function () { return attempt(n + 1); });
        }
        return res;
      });
    };

    attempt(0).then(function (res) {
      setBusy(false);
      var d = res.data || {};
      if (res.status === 200 && d.ok && d.saved === true) {
        clearDraft();
        if (d.status === "repeat") {
          document.getElementById("done-text").textContent =
            "We already had an RSVP from this email, so we saved this one as an update. A team member will reach out to confirm, then send the date and location to your email.";
        }
        form.hidden = true;
        done.hidden = false;
        done.focus();
        done.scrollIntoView({ block: "center", behavior: "smooth" });
        return;
      }
      if (res.status === 400 && d.field && fields[d.field]) {
        var e = {}; e[d.field] = d.message || "Check this field.";
        var f = showErrors(e);
        showSummary("One field needs a fix before you can send.");
        if (f) f.focus();
        return;
      }
      if (res.status === 429) {
        showSummary("Too many tries in a row. Wait a minute, then send again.", "Your answers are still here.");
        return;
      }
      showSummary("Your RSVP didn't go through. Nothing was saved on our side.",
        "Your answers are still here, so try again in a minute. If it keeps happening, email your submission to " + TEAM_EMAIL + ".");
    });
  });

  // Copy button for the team email
  document.querySelectorAll("[data-copy]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var text = btn.getAttribute("data-copy");
      var flash = function (label) { btn.textContent = label; setTimeout(function () { btn.textContent = "Copy"; }, 1800); };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () { flash("Copied"); }, function () { selectEmail(); flash("Selected"); });
      } else { selectEmail(); flash("Selected"); }
    });
  });
  function selectEmail() {
    var el = document.getElementById("team-email");
    var range = document.createRange(); range.selectNodeContents(el);
    var sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
  }
})();
