/**
 * URCypher RSVP receiver (Google Apps Script)
 * ----------------------------------------------------------------
 * Paste this whole file into Extensions > Apps Script in the Google
 * Sheet that collects RSVPs. Setup steps are in README.md.
 *
 * Only the Netlify function calls this, and it must send the secret
 * saved in Project Settings > Script properties as RSVP_SECRET.
 *
 * Optional: add a script property NOTIFY_EMAIL (for example
 * URCypherTeam@gmail.com) to get an email for every new RSVP.
 *
 * Every new RSVP also gets the branded "We got your RSVP" email, sent from
 * the Google account that owns this Sheet, with replies going to
 * URCypherTeam@gmail.com. To pause it, add a script property
 * ARTIST_EMAIL = off. The result is written to the Confirmation Email column.
 */

var SCRIPT_VERSION = 5;
var REPLY_TO = 'URCypherTeam@gmail.com';
var SHEET_NAME = 'RSVPs';
var HEADERS = ['Submitted', 'Status', 'First Name', 'Last Name', 'Stage Name', 'Instagram',
  'Genre', 'Phone', 'Email', 'YouTube Links', 'Artist Profile', 'Website', 'Repeat', 'Review Note', 'Source',
  'Heard About', 'Ad Tracking', 'Location', 'Confirmation Email'];
var STATUSES = ['New', 'Review', 'Confirmed', 'Waitlist', 'Declined', 'Details sent'];
var EMAIL_COL = 9;

function doPost(e) {
  var data;
  try {
    data = JSON.parse(e.postData.contents);
  } catch (err) {
    return out_({ ok: false, error: 'bad_json' });
  }

  var secret = PropertiesService.getScriptProperties().getProperty('RSVP_SECRET');
  if (!secret || data.secret !== secret) return out_({ ok: false, error: 'unauthorized' });

  if (data.action === 'ping') {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var tab = ss.getSheetByName(SHEET_NAME);
    if (tab) addMissingHeaders_(tab);
    return out_({ ok: true, sheetReady: !!tab, version: SCRIPT_VERSION });
  }
  if (data.action !== 'rsvp') return out_({ ok: false, error: 'unknown_action' });

  var email = String(data.email || '').trim().toLowerCase();
  if (!data.firstName || !data.stageName || !email) return out_({ ok: false, error: 'missing_fields' });

  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
  } catch (err) {
    return out_({ ok: false, error: 'busy' });
  }

  try {
    var sheet = sheet_();
    var repeatOf = '';
    var last = sheet.getLastRow();
    if (last > 1) {
      var emails = sheet.getRange(2, EMAIL_COL, last - 1, 1).getValues();
      for (var i = 0; i < emails.length; i++) {
        if (String(emails[i][0]).replace(/^'/, '').trim().toLowerCase() === email) {
          repeatOf = 'Yes, also row ' + (i + 2);
          break;
        }
      }
    }
    var links = (data.youtube || []).map(function (l) { return clean_(l, 300); }).join('\n');
    sheet.appendRow([
      new Date(),
      data.review ? 'Review' : 'New',
      safe_(clean_(data.firstName, 60)),
      safe_(clean_(data.lastName, 60)),
      safe_(clean_(data.stageName, 80)),
      safe_('@' + clean_(data.instagram, 40)),
      safe_(clean_(data.genre, 30)),
      safe_(clean_(data.phone, 25)),
      safe_(email),
      safe_(links),
      safe_(clean_(data.profile, 300)),
      safe_(clean_(data.website, 300)),
      repeatOf,
      safe_(clean_(data.review, 120)),
      safe_(clean_(data.source, 80)),
      safe_(clean_(data.heardFrom, 40)),
      safe_(clean_(data.tracking, 200)),
      safe_(clean_(data.location, 70)),
      ''
    ]);
    SpreadsheetApp.flush();
    var row = sheet.getLastRow();
    var emailed = sendArtistEmail_(data, email);
    sheet.getRange(row, HEADERS.indexOf('Confirmation Email') + 1).setValue(emailed);
    notify_(data, row, repeatOf);
    return out_({ ok: true, row: row, status: repeatOf ? 'repeat' : 'new', email: emailed });
  } finally {
    lock.releaseLock();
  }
}

/** Opening the web app URL in a browser shows this, never your data. */
function doGet() {
  return out_({ ok: true, service: 'URCypher RSVP receiver' });
}

function sheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME, 0);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold').setBackground('#2B4BF2').setFontColor('#E8E6DF');
    var rule = SpreadsheetApp.newDataValidation().requireValueInList(STATUSES, true).setAllowInvalid(false).build();
    sheet.getRange(2, 2, sheet.getMaxRows() - 1, 1).setDataValidation(rule);
    sheet.getRange(2, 10, sheet.getMaxRows() - 1, 1).setWrap(true);
    sheet.setColumnWidth(10, 320);
  } else {
    addMissingHeaders_(sheet);
  }
  return sheet;
}

/** Adds headers for columns added in later versions (e.g. Heard About) without touching existing rows. */
function addMissingHeaders_(sheet) {
  var lastCol = sheet.getLastColumn();
  if (lastCol >= HEADERS.length) return;
  for (var c = lastCol + 1; c <= HEADERS.length; c++) {
    sheet.getRange(1, c).setValue(HEADERS[c - 1]).setFontWeight('bold').setBackground('#2B4BF2').setFontColor('#E8E6DF');
  }
}

/**
 * Sends the branded "We got your RSVP" email to the artist.
 * Never throws: whatever happens is returned as a short note for the Sheet.
 */
function sendArtistEmail_(data, email) {
  var props = PropertiesService.getScriptProperties();
  if (String(props.getProperty('ARTIST_EMAIL') || 'on').toLowerCase() === 'off') return 'Off';
  if (data.review) return 'Not sent (in review, send manually if real)';
  try {
    if (MailApp.getRemainingDailyQuota() < 1) return 'Not sent: Gmail daily limit reached';
    var stage = clean_(data.stageName, 80);
    MailApp.sendEmail({
      to: email,
      subject: ARTIST_EMAIL_SUBJECT.replace(/\{\{stage_name\}\}/g, stage),
      htmlBody: ARTIST_EMAIL_HTML.replace(/\{\{stage_name\}\}/g, escHtml_(stage)),
      body: ARTIST_EMAIL_TEXT.replace(/\{\{stage_name\}\}/g, stage),
      name: 'URCypher',
      replyTo: REPLY_TO
    });
    return 'Sent ' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'MMM d, h:mm a');
  } catch (err) {
    return 'Failed: ' + String(err && err.message || err).slice(0, 80);
  }
}

function escHtml_(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function notify_(data, row, repeatOf) {
  var to = PropertiesService.getScriptProperties().getProperty('NOTIFY_EMAIL');
  if (!to) return;
  try {
    MailApp.sendEmail({
      to: to,
      subject: 'New URCypher RSVP: ' + clean_(data.stageName, 80) + (data.review ? ' (needs review)' : ''),
      body: clean_(data.stageName, 80) + ' (' + clean_(data.genre, 30) + ') just sent an RSVP.\n\n' +
        'Instagram: @' + clean_(data.instagram, 40) + '\n' +
        'Location: ' + clean_(data.location, 70) + '\n' +
        'Heard about it: ' + clean_(data.heardFrom, 40) + (data.tracking ? ' (' + clean_(data.tracking, 200) + ')' : '') + '\n' +
        'Row ' + row + ' in the RSVPs tab.' + (repeatOf ? '\nRepeat: ' + repeatOf : '') +
        (data.review ? '\nReview note: ' + clean_(data.review, 120) : '') + '\n\n' +
        SpreadsheetApp.getActiveSpreadsheet().getUrl()
    });
  } catch (err) {
    // The RSVP is already saved. A failed email never blocks it.
    console.warn('Notify email failed: ' + err);
  }
}

function clean_(v, max) {
  return String(v == null ? '' : v).replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, ' ').trim().slice(0, max);
}

/**
 * Stops spreadsheet formula injection. A leading apostrophe makes the cell plain text;
 * Sheets hides it, so "+1 954..." and "@handle" still display as typed.
 */
function safe_(v) {
  v = String(v == null ? '' : v);
  return /^[=+\-@]/.test(v) ? "'" + v : v;
}

function out_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/** Run once from the editor: creates the RSVPs tab, headers and Status dropdown, and puts the tab first. */
function setup() {
  var sheet = sheet_();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ss.setActiveSheet(sheet);
  ss.moveActiveSheet(1);
}

// --- ARTIST EMAIL (generated from email/rsvp-received.* by scripts/embed-email.py; edit those files, not this block) ---
var ARTIST_EMAIL_SUBJECT = "We got your RSVP, {{stage_name}}";
var ARTIST_EMAIL_TEXT = "URCYPHER / INVITE ONLY\n\nYou're in the queue.\n\nHi {{stage_name}},\n\nWe got your RSVP for URCypher, South Florida's biggest cypher. Thanks for putting your name in.\n\nA member of the URCypher team will be listening to the music you sent us. This is invite only, so the date and location go out privately to confirmed artists.\n\nNOW: The team listens\nWe go through every submission and the links you sent.\n\nNEXT: We reach out\nIf you're confirmed, you'll hear from us at this email address.\n\nTHEN: You get the details\nDate and location, sent only to you. Add URCypherTeam@gmail.com to your contacts so that email doesn't end up in spam.\n\nWhile you wait, follow URCypher on Instagram for cypher clips, updates and behind-the-scenes:\nhttps://www.instagram.com/urcypher.tv/\n\n--\nAn Urban Relations production\nInvite only / South Florida\n\nQuestions? Reply to this email or write to URCypherTeam@gmail.com.\nYou're getting this because you sent an RSVP at urcypher.com.\n";
var ARTIST_EMAIL_HTML = "<!doctype html>\n<html lang=\"en\" xmlns=\"http://www.w3.org/1999/xhtml\">\n<head>\n<meta charset=\"utf-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n<meta name=\"x-apple-disable-message-reformatting\">\n<meta name=\"color-scheme\" content=\"light only\">\n<meta name=\"supported-color-schemes\" content=\"light\">\n<title>We got your RSVP</title>\n<style>\n  body { margin: 0; padding: 0; background: #E8E6DF; }\n  table { border-collapse: collapse; }\n  img { border: 0; display: block; }\n  a { color: #2B4BF2; }\n  @media (max-width: 620px) {\n    .wrap { width: 100% !important; }\n    .px { padding-left: 24px !important; padding-right: 24px !important; }\n    .h1 { font-size: 44px !important; line-height: 42px !important; }\n    .btn a { display: block !important; text-align: center !important; padding: 18px 14px !important; font-size: 15px !important; font-stretch: 100% !important; }\n    .logo { width: 180px !important; height: 24px !important; }\n  }\n</style>\n</head>\n<body style=\"margin:0; padding:0; background:#E8E6DF;\">\n<div style=\"display:none; max-height:0; overflow:hidden; mso-hide:all; font-size:1px; line-height:1px; color:#E8E6DF;\">Your music is in the queue. A URCypher team member will be listening.</div>\n<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" style=\"background:#E8E6DF;\">\n<tr><td align=\"center\" style=\"padding:24px 12px;\">\n<table role=\"presentation\" class=\"wrap\" width=\"600\" cellpadding=\"0\" cellspacing=\"0\" style=\"width:600px; max-width:600px;\">\n  <tr><td class=\"px\" style=\"background:#2B4BF2; padding:28px 40px 24px;\">\n    <table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\">\n      <tr>\n        <td valign=\"middle\">\n          <img class=\"logo\" src=\"https://urcypher.com/email/urcypher-wordmark.png\" width=\"239\" height=\"32\" alt=\"URCypher\" style=\"width:239px; height:32px; color:#E8E6DF; font-family:'Archivo', Arial Black, Arial, sans-serif; font-size:28px; font-weight:900;\">\n        </td>\n        <td valign=\"middle\" align=\"right\" style=\"font-family:'IBM Plex Mono', Menlo, Consolas, monospace; font-size:11px; letter-spacing:1.2px; text-transform:uppercase; color:#E8E6DF;\">Invite only</td>\n      </tr>\n    </table>\n  </td></tr>\n  <tr><td style=\"background:#2B4BF2; padding:0 40px;\" class=\"px\"><div style=\"height:2px; line-height:2px; font-size:2px; background:#E8E6DF;\">&nbsp;</div></td></tr>\n  <tr><td class=\"px\" style=\"background:#2B4BF2; padding:36px 40px 12px; font-family:'IBM Plex Mono', Menlo, Consolas, monospace; font-size:12px; letter-spacing:1.4px; text-transform:uppercase; color:#E8E6DF;\">Submission received</td></tr>\n  <tr><td class=\"px h1\" style=\"background:#2B4BF2; padding:0 40px 28px; font-family:'Archivo', 'Arial Black', Arial, sans-serif; font-stretch:115%; font-weight:900; font-size:56px; line-height:52px; letter-spacing:-0.5px; text-transform:uppercase; color:#E8E6DF;\">You&#8217;re in<br>the queue.</td></tr>\n  <tr><td class=\"px\" style=\"background:#2B4BF2; padding:0 40px 32px;\">\n    <table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" style=\"table-layout:fixed;\"><tr valign=\"bottom\">\n      <td width=\"6.25%\" style=\"padding-right:4px;\"><div style=\"height:12px; background:#E8E6DF; font-size:0; line-height:0;\">&nbsp;</div></td>\n      <td width=\"6.25%\" style=\"padding-right:4px;\"><div style=\"height:20px; background:#E8E6DF; font-size:0; line-height:0;\">&nbsp;</div></td>\n      <td width=\"6.25%\" style=\"padding-right:4px;\"><div style=\"height:28px; background:#E8E6DF; font-size:0; line-height:0;\">&nbsp;</div></td>\n      <td width=\"6.25%\" style=\"padding-right:4px;\"><div style=\"height:16px; background:#E8E6DF; font-size:0; line-height:0;\">&nbsp;</div></td>\n      <td width=\"6.25%\" style=\"padding-right:4px;\"><div style=\"height:32px; background:#E8E6DF; font-size:0; line-height:0;\">&nbsp;</div></td>\n      <td width=\"6.25%\" style=\"padding-right:4px;\"><div style=\"height:22px; background:#E8E6DF; font-size:0; line-height:0;\">&nbsp;</div></td>\n      <td width=\"6.25%\" style=\"padding-right:4px;\"><div style=\"height:35px; background:#E8E6DF; font-size:0; line-height:0;\">&nbsp;</div></td>\n      <td width=\"6.25%\" style=\"padding-right:4px;\"><div style=\"height:14px; background:#E8E6DF; font-size:0; line-height:0;\">&nbsp;</div></td>\n      <td width=\"6.25%\" style=\"padding-right:4px;\"><div style=\"height:25px; background:#E8E6DF; font-size:0; line-height:0;\">&nbsp;</div></td>\n      <td width=\"6.25%\" style=\"padding-right:4px;\"><div style=\"height:31px; background:#E8E6DF; font-size:0; line-height:0;\">&nbsp;</div></td>\n      <td width=\"6.25%\" style=\"padding-right:4px;\"><div style=\"height:18px; background:#E8E6DF; font-size:0; line-height:0;\">&nbsp;</div></td>\n      <td width=\"6.25%\" style=\"padding-right:4px;\"><div style=\"height:34px; background:#E8E6DF; font-size:0; line-height:0;\">&nbsp;</div></td>\n      <td width=\"6.25%\" style=\"padding-right:4px;\"><div style=\"height:21px; background:#E8E6DF; font-size:0; line-height:0;\">&nbsp;</div></td>\n      <td width=\"6.25%\" style=\"padding-right:4px;\"><div style=\"height:13px; background:#E8E6DF; font-size:0; line-height:0;\">&nbsp;</div></td>\n      <td width=\"6.25%\" style=\"padding-right:4px;\"><div style=\"height:29px; background:#E8E6DF; font-size:0; line-height:0;\">&nbsp;</div></td>\n      <td width=\"6.25%\" style=\"padding-right:4px;\"><div style=\"height:24px; background:#E8E6DF; font-size:0; line-height:0;\">&nbsp;</div></td>\n    </tr></table>\n  </td></tr>\n  <tr><td class=\"px\" style=\"background:#F3F2EC; padding:36px 40px 8px; font-family:'Archivo', Helvetica, Arial, sans-serif; font-size:17px; line-height:27px; color:#121211;\">\n    <p style=\"margin:0 0 16px;\">Hi {{stage_name}},</p>\n    <p style=\"margin:0 0 16px;\">We got your RSVP for URCypher, South Florida&#8217;s biggest cypher. Thanks for putting your name in.</p>\n    <p style=\"margin:0;\">A member of the URCypher team will be listening to the music you sent us. This is invite only, so the date and location go out privately to confirmed artists.</p>\n  </td></tr>\n  <tr><td class=\"px\" style=\"background:#F3F2EC; padding:28px 40px 8px;\">\n    <table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" style=\"border-top:2px solid #121211;\">\n      <tr><td style=\"padding:16px 0; border-bottom:2px solid #121211;\">\n        <div style=\"font-family:'IBM Plex Mono', Menlo, Consolas, monospace; font-size:11px; letter-spacing:1.4px; text-transform:uppercase; color:#2B4BF2;\">Now</div>\n        <div style=\"font-family:'Archivo', 'Arial Narrow', Arial, sans-serif; font-stretch:62%; font-weight:900; font-size:24px; line-height:26px; text-transform:uppercase; color:#121211; padding-top:4px;\">The team listens</div>\n        <div style=\"font-family:'Archivo', Helvetica, Arial, sans-serif; font-size:15px; line-height:23px; color:#55544F; padding-top:4px;\">We go through every submission and the links you sent.</div>\n      </td></tr>\n      <tr><td style=\"padding:16px 0; border-bottom:2px solid #121211;\">\n        <div style=\"font-family:'IBM Plex Mono', Menlo, Consolas, monospace; font-size:11px; letter-spacing:1.4px; text-transform:uppercase; color:#2B4BF2;\">Next</div>\n        <div style=\"font-family:'Archivo', 'Arial Narrow', Arial, sans-serif; font-stretch:62%; font-weight:900; font-size:24px; line-height:26px; text-transform:uppercase; color:#121211; padding-top:4px;\">We reach out</div>\n        <div style=\"font-family:'Archivo', Helvetica, Arial, sans-serif; font-size:15px; line-height:23px; color:#55544F; padding-top:4px;\">If you&#8217;re confirmed, you&#8217;ll hear from us at this email address.</div>\n      </td></tr>\n      <tr><td style=\"padding:16px 0; border-bottom:2px solid #121211;\">\n        <div style=\"font-family:'IBM Plex Mono', Menlo, Consolas, monospace; font-size:11px; letter-spacing:1.4px; text-transform:uppercase; color:#2B4BF2;\">Then</div>\n        <div style=\"font-family:'Archivo', 'Arial Narrow', Arial, sans-serif; font-stretch:62%; font-weight:900; font-size:24px; line-height:26px; text-transform:uppercase; color:#121211; padding-top:4px;\">You get the details</div>\n        <div style=\"font-family:'Archivo', Helvetica, Arial, sans-serif; font-size:15px; line-height:23px; color:#55544F; padding-top:4px;\">Date and location, sent only to you. Add <strong style=\"color:#121211;\">URCypherTeam@gmail.com</strong> to your contacts so that email doesn&#8217;t end up in spam.</div>\n      </td></tr>\n    </table>\n  </td></tr>\n  <tr><td class=\"px\" style=\"background:#F3F2EC; padding:32px 40px 8px; font-family:'Archivo', Helvetica, Arial, sans-serif; font-size:17px; line-height:27px; color:#121211;\">\n    While you wait, follow URCypher on Instagram for cypher clips, updates and behind-the-scenes.\n  </td></tr>\n  <tr><td class=\"px btn\" style=\"background:#F3F2EC; padding:16px 40px 40px;\">\n    <table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\"><tr>\n      <td style=\"background:#121211;\">\n        <a href=\"https://www.instagram.com/urcypher.tv/\" target=\"_blank\" style=\"display:inline-block; padding:18px 26px; font-family:'Archivo', 'Arial Black', Arial, sans-serif; font-stretch:115%; font-weight:900; font-size:18px; line-height:18px; letter-spacing:0.2px; text-transform:uppercase; color:#E8E6DF; text-decoration:none;\">Follow @urcypher.tv &#8594;</a>\n      </td>\n    </tr></table>\n  </td></tr>\n  <tr><td class=\"px\" style=\"background:#121211; padding:28px 40px; font-family:'IBM Plex Mono', Menlo, Consolas, monospace; font-size:11px; line-height:18px; letter-spacing:1.2px; text-transform:uppercase; color:#E8E6DF;\">\n    An Urban Relations production<br>\n    Invite only / South Florida\n    <div style=\"padding-top:16px; text-transform:none; letter-spacing:0.3px; font-size:12px; color:#BDBBB3;\">\n      Questions? Reply to this email or write to <a href=\"mailto:URCypherTeam@gmail.com\" style=\"color:#E8E6DF;\">URCypherTeam@gmail.com</a>.<br>\n      You&#8217;re getting this because you sent an RSVP at <a href=\"https://urcypher.com\" style=\"color:#E8E6DF;\">urcypher.com</a>.\n    </div>\n  </td></tr>\n</table>\n</td></tr>\n</table>\n</body>\n</html>\n";
// --- END ARTIST EMAIL ---
