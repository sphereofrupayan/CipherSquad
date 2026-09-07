const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const gmail = read('services/gmailService.js');
const supabase = read('services/supabaseService.js');
const server = read('server.js');
const migration = read('SUPABASE_PRIVACY_MIGRATION.sql');

assert.match(gmail, /format: includeBody \? 'full' : 'metadata'/);
assert.match(gmail, /module\.exports = \{ fetchUserEmails, fetchUserEmail \}/);
assert.doesNotMatch(supabase.match(/async function saveEmails[\s\S]*?async function getEmailsByUser/)?.[0] || '', /body:\s|snippet:\s/);
assert.match(supabase, /encrypted_access_token/);
assert.match(server, /Authentication required\./);
assert.match(server, /authorizedUserId\(req/);
assert.match(server, /Cache-Control', 'no-store/);
assert.match(migration, /drop column if exists body/);
assert.match(migration, /drop column if exists snippet/);
assert.match(migration, /create policy emails_owner/);
assert.match(migration, /create policy processed_context_owner/);

console.log('Privacy architecture tests: ok');
