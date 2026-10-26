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
 */

var SCRIPT_VERSION = 3;
var SHEET_NAME = 'RSVPs';
var HEADERS = ['Submitted', 'Status', 'First Name', 'Last Name', 'Stage Name', 'Instagram',
  'Genre', 'Phone', 'Email', 'YouTube Links', 'Artist Profile', 'Website', 'Repeat', 'Review Note', 'Source',
  'Heard About', 'Ad Tracking', 'Location'];
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
      safe_(clean_(data.location, 70))
    ]);
    SpreadsheetApp.flush();
    var row = sheet.getLastRow();
    notify_(data, row, repeatOf);
    return out_({ ok: true, row: row, status: repeatOf ? 'repeat' : 'new' });
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
