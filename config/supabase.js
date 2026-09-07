const { createClient } = require('@supabase/supabase-js');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', 'api.env') });
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SECRET_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.warn('Supabase is not configured. Persistence routes will use local fallback where possible.');
  module.exports = null;
  return;
}

const supabase = createClient(supabaseUrl, supabaseKey);

module.exports = supabase;
