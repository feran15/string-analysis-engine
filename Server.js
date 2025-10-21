// index.js
const express = require('express');
const bodyParser = require('body-parser');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const morgan = require('morgan');

// File to persist analyzed strings
const DATA_FILE = path.join(__dirname, 'data', 'strings.json');

// Ensure data directory exists
if (!fs.existsSync(path.join(__dirname, 'data'))) {
  fs.mkdirSync(path.join(__dirname, 'data'));
}

// In-memory database
const store = new Map();

// Load persisted data from file (if any)
function loadData() {
  if (fs.existsSync(DATA_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      for (const record of data) store.set(record.id, record);
      console.log(`Loaded ${data.length} strings from storage.`);
    } catch (e) {
      console.error('Error loading data file:', e.message);
    }
  }
}

// Save data to file
function saveData() {
  const allData = Array.from(store.values());
  fs.writeFileSync(DATA_FILE, JSON.stringify(allData, null, 2), 'utf8');
}

// Initialize data
loadData();

const app = express();
app.use(bodyParser.json());
app.use(morgan('dev'));

// Helper to hash strings using SHA-256
function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

// Analyze a string and compute its properties
function analyzeString(value) {
  const length = [...value].length;
  const normalized = value.replace(/\s+/g, '').toLowerCase();
  const is_palindrome = normalized === [...normalized].reverse().join('');
  const characters = [...value];
  const frequency = {};

  for (const ch of characters) frequency[ch] = (frequency[ch] || 0) + 1;

  const unique_characters = Object.keys(frequency).length;
  const word_count = value.trim() === '' ? 0 : value.trim().split(/\s+/).length;
  const sha = sha256(value);

  return {
    length,
    is_palindrome,
    unique_characters,
    word_count,
    sha256_hash: sha,
    character_frequency_map: frequency
  };
}

/* ===========================
   1️⃣  Create/Analyze String
   =========================== */
app.post('/strings', (req, res) => {
  if (!req.body || typeof req.body.value === 'undefined')
    return res.status(400).json({ error: 'Missing "value" field' });

  const { value } = req.body;
  if (typeof value !== 'string')
    return res.status(422).json({ error: '"value" must be a string' });

  const properties = analyzeString(value);
  const id = properties.sha256_hash;

  if (store.has(id)) return res.status(409).json({ error: 'String already exists' });

  const record = {
    id,
    value,
    properties,
    created_at: new Date().toISOString()
  };

  store.set(id, record);
  saveData();
  res.status(201).json(record);
});

/* ===========================
   2️⃣  Get Specific String
   =========================== */
app.get('/strings/:string_value', (req, res) => {
  const value = decodeURIComponent(req.params.string_value);
  const id = sha256(value);
  const record = store.get(id);
  if (!record) return res.status(404).json({ error: 'String not found' });
  res.json(record);
});

/* ===========================
   3️⃣  Get All Strings (Filtering)
   =========================== */
app.get('/strings', (req, res) => {
  const { is_palindrome, min_length, max_length, word_count, contains_character } = req.query;

  let results = Array.from(store.values());

  // Filters
  if (is_palindrome !== undefined) {
    const val = is_palindrome === 'true' || is_palindrome === '1';
    results = results.filter(r => r.properties.is_palindrome === val);
  }

  if (min_length !== undefined)
    results = results.filter(r => r.properties.length >= parseInt(min_length));

  if (max_length !== undefined)
    results = results.filter(r => r.properties.length <= parseInt(max_length));

  if (word_count !== undefined)
    results = results.filter(r => r.properties.word_count === parseInt(word_count));

  if (contains_character !== undefined)
    results = results.filter(r => r.properties.character_frequency_map[contains_character]);

  res.json({
    data: results,
    count: results.length,
    filters_applied: req.query
  });
});

/* ===========================
   4️⃣  Natural Language Filtering
   =========================== */
function parseNaturalLanguageQuery(query) {
  const filters = {};
  const q = query.toLowerCase();

  if (q.includes('palindrom')) filters.is_palindrome = true;
  if (q.includes('single word')) filters.word_count = 1;

  const longer = q.match(/longer than (\\d+)/);
  if (longer) filters.min_length = parseInt(longer[1]) + 1;

  const contains = q.match(/containing the letter ([a-z])/);
  if (contains) filters.contains_character = contains[1];

  if (/first vowel/.test(q)) filters.contains_character = 'a';
  if (/letter z/.test(q)) filters.contains_character = 'z';

  return filters;
}

app.get('/strings/filter-by-natural-language', (req, res) => {
  const { query } = req.query;
  if (!query) return res.status(400).json({ error: 'Missing query' });

  try {
    const parsed = parseNaturalLanguageQuery(query);
    let results = Array.from(store.values());

    results = results.filter(r => {
      const p = r.properties;
      if (parsed.is_palindrome !== undefined && p.is_palindrome !== parsed.is_palindrome)
        return false;
      if (parsed.word_count !== undefined && p.word_count !== parsed.word_count)
        return false;
      if (parsed.min_length !== undefined && p.length < parsed.min_length)
        return false;
      if (parsed.contains_character && !p.character_frequency_map[parsed.contains_character])
        return false;
      return true;
    });

    res.json({
      data: results,
      count: results.length,
      interpreted_query: {
        original: query,
        parsed_filters: parsed
      }
    });
  } catch {
    res.status(400).json({ error: 'Unable to parse natural language query' });
  }
});

/* ===========================
   5️⃣  Delete String
   =========================== */
app.delete('/strings/:string_value', (req, res) => {
  const value = decodeURIComponent(req.params.string_value);
  const id = sha256(value);
  if (!store.has(id)) return res.status(404).json({ error: 'String not found' });
  store.delete(id);
  saveData();
  res.status(204).send();
});

/* ===========================
   Health Check
   =========================== */
app.get('/', (req, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 String Analyzer Service running on port ${PORT}`))