/**
 * Admin Routes - Protected maintenance dashboard
 * Requires authentication via ADMIN_PASSWORD env variable
 */

const express = require('express');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const router = express.Router();

// Helper to strip ANSI color codes from output
// eslint-disable-next-line no-control-regex
const ANSI_REGEX = /\x1b\[[0-9;]*m/g;
function stripAnsi(str) {
  return str.replace(ANSI_REGEX, '');
}

// Auth middleware - reads password at request time for flexibility
function getAdminPassword() {
  return process.env.ADMIN_PASSWORD;
}

function requireAuth(req, res, next) {
  if (!getAdminPassword()) {
    return res.status(503).render('admin/disabled');
  }
  if (req.session && req.session.isAdmin) {
    return next();
  }
  res.redirect('/admin/login');
}

// Login page
router.get('/login', (req, res) => {
  if (!getAdminPassword()) {
    return res.status(503).render('admin/disabled');
  }
  res.render('admin/login', { error: null });
});

// Login handler
router.post('/login', (req, res) => {
  if (!getAdminPassword()) {
    return res.status(503).render('admin/disabled');
  }

  const { password } = req.body;

  if (password === getAdminPassword()) {
    req.session.isAdmin = true;
    req.session.loginTime = new Date().toISOString();
    res.redirect('/admin');
  } else {
    res.render('admin/login', { error: 'Invalid password' });
  }
});

// Logout
router.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/admin/login');
});

// Dashboard
router.get('/', requireAuth, async (req, res) => {
  try {
    // Load database stats
    const dbPath = path.join(__dirname, '..', 'chainhoist_data', 'chainhoist_database.json');
    const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    const data = Array.isArray(db) ? db : db.data || [];

    // Calculate stats
    const stats = {
      total: data.length,
      manufacturers: new Set(data.map(p => p.manufacturer)).size,
      withImages: data.filter(p => p.images && p.images.length > 0).length,
      withPdfs: data.filter(p => p.pdfs && p.pdfs.length > 0).length,
      withCapacity: data.filter(p => p.loadCapacity).length,
      withSpeed: data.filter(p => p.liftingSpeed).length
    };

    // Load backup info
    const backupDir = path.join(__dirname, '..', 'backups');
    let backups = [];
    if (fs.existsSync(backupDir)) {
      backups = fs.readdirSync(backupDir)
        .filter(f => f.startsWith('backup_') && f.endsWith('.json'))
        .sort()
        .reverse()
        .slice(0, 5)
        .map(f => {
          const stat = fs.statSync(path.join(backupDir, f));
          return {
            name: f,
            date: f.replace('backup_', '').replace('.json', '').replace(/-/g, ':').slice(0, 16),
            size: (stat.size / 1024).toFixed(1) + ' KB'
          };
        });
    }

    res.render('admin/dashboard', { stats, backups, loginTime: req.session.loginTime });
  } catch (err) {
    res.render('admin/dashboard', { stats: null, backups: [], error: err.message });
  }
});

// API endpoints for admin actions
router.post('/api/run-task', requireAuth, (req, res) => {
  const { task } = req.body;

  // Whitelist allowed tasks
  const allowedTasks = [
    'report:health',
    'report:stats',
    'report:missing',
    'cleanup:duplicates',
    'cleanup:empty',
    'cleanup:stale',
    'cleanup:invalid',
    'maintain:backup',
    'maintain:process'
  ];

  if (!allowedTasks.includes(task)) {
    return res.status(400).json({ error: 'Invalid task' });
  }

  // Run the maintenance task
  const args = ['maintenance.js', task];

  // Add --apply only for backup and process (safe operations)
  if (task === 'maintain:backup' || task === 'maintain:process') {
    args.push('--apply');
  }

  const child = spawn('node', args, {
    cwd: path.join(__dirname, '..'),
    env: process.env
  });

  let output = '';
  let errorOutput = '';

  child.stdout.on('data', (data) => {
    output += data.toString();
  });

  child.stderr.on('data', (data) => {
    errorOutput += data.toString();
  });

  child.on('close', (code) => {
    // Strip ANSI color codes for JSON response
    const cleanOutput = stripAnsi(output);
    res.json({
      success: code === 0,
      output: cleanOutput,
      error: errorOutput || null
    });
  });
});

// Cleanup with confirmation (destructive operations)
router.post('/api/cleanup', requireAuth, (req, res) => {
  const { task, confirm } = req.body;

  if (confirm !== 'CONFIRM') {
    return res.status(400).json({ error: 'Confirmation required. Send confirm: "CONFIRM"' });
  }

  const allowedCleanup = ['cleanup:empty', 'cleanup:invalid'];
  if (!allowedCleanup.includes(task)) {
    return res.status(400).json({ error: 'Invalid cleanup task' });
  }

  const child = spawn('node', ['maintenance.js', task, '--apply'], {
    cwd: path.join(__dirname, '..'),
    env: process.env,
    stdio: ['pipe', 'pipe', 'pipe']
  });

  // Auto-confirm the prompt
  child.stdin.write('yes\n');
  child.stdin.end();

  let output = '';

  child.stdout.on('data', (data) => {
    output += data.toString();
  });

  child.on('close', (code) => {
    const cleanOutput = stripAnsi(output);
    res.json({
      success: code === 0,
      output: cleanOutput
    });
  });
});

module.exports = router;
