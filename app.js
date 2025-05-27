// server.js
const express = require('express');
const path = require('path');
const bodyParser = require('body-parser');
const fs = require('fs');
const session = require('express-session');
const { runBot } = require('./bot.js');

const app = express();
app.set('trust proxy', 1); // Penting jika di belakang reverse proxy
const port = process.env.PORT || 3005;

// Setup EJS
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Middleware untuk parsing body permintaan (berlaku global)
app.use(bodyParser.urlencoded({ extended: true }));

// Konfigurasi session
app.use(session({
    secret: 'coca-cola-bot-secret-key-change-this-in-production',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: false,
        maxAge: 24 * 60 * 60 * 1000 // 24 jam
    }
}));

// Fungsi untuk membaca dan menulis data users
function readUsers() {
    try {
        if (fs.existsSync('users.json')) {
            const data = fs.readFileSync('users.json', 'utf8');
            return JSON.parse(data);
        }
        return [];
    } catch (error) {
        console.error('Error reading users.json:', error);
        return [];
    }
}

function writeUsers(users) {
    try {
        fs.writeFileSync('users.json', JSON.stringify(users, null, 2), 'utf8');
        return true;
    } catch (error) {
        console.error('Error writing users.json:', error);
        return false;
    }
}

// Fungsi untuk membaca dan menulis data sessions
function readSessions() {
    try {
        if (fs.existsSync('sessions.json')) {
            const data = fs.readFileSync('sessions.json', 'utf8');
            return JSON.parse(data);
        }
        return [];
    } catch (error) {
        console.error('Error reading sessions.json:', error);
        return [];
    }
}

function writeSessions(sessions) {
    try {
        fs.writeFileSync('sessions.json', JSON.stringify(sessions, null, 2), 'utf8');
        return true;
    } catch (error) {
        console.error('Error writing sessions.json:', error);
        return false;
    }
}

// Middleware untuk autentikasi
function requireAuth(req, res, next) {
    if (req.session && req.session.user) {
        return next();
    } else {
        return res.redirect('/login');
    }
}

// Middleware untuk admin only
function requireAdmin(req, res, next) {
    if (req.session && req.session.user && req.session.user.isAdmin) {
        return next();
    } else {
        return res.status(403).send('Access denied. Admin only.');
    }
}

// Rute untuk login
app.get('/login', (req, res) => {
    res.render('login', { error: null });
});

app.post('/login', (req, res) => {
    const { accessCode } = req.body;
    
    if (!accessCode) {
        return res.render('login', { error: 'Kode akses harus diisi.' });
    }
    
    const users = readUsers();
    const user = users.find(u => u.accessCode === accessCode && u.isActive);
    
    if (!user) {
        return res.render('login', { error: 'Kode akses tidak valid atau akun tidak aktif.' });
    }
    
    // Simpan user ke session
    req.session.user = user;
    
    // Simpan session info
    const sessions = readSessions();
    const sessionInfo = {
        sessionId: req.sessionID,
        userId: user.id,
        accessCode: user.accessCode,
        loginTime: new Date().toISOString(),
        ip: req.ip || req.connection.remoteAddress,
        userAgent: req.get('User-Agent') || 'Unknown'
    };
    
    // Hapus session lama untuk user yang sama
    const filteredSessions = sessions.filter(s => s.userId !== user.id);
    filteredSessions.push(sessionInfo);
    writeSessions(filteredSessions);
    
    if (user.isAdmin) {
        res.redirect('/admin');
    } else {
        res.redirect('/voucher');
    }
});

// Rute untuk form voucher (untuk user biasa)
app.get('/voucher', requireAuth, (req, res) => {
    if (req.session.user.isAdmin) {
        return res.redirect('/admin');
    }
    res.render('voucher_form', {
        inputValues: { manualVoucherCode: '', manualShortUrl: '' },
        user: req.session.user
    });
});

// Endpoint untuk menjalankan bot
app.post('/run-bot', requireAuth, async (req, res) => {
    const { manualVoucherCode, manualShortUrl } = req.body;

    if (!manualVoucherCode || !manualShortUrl) {
        return res.status(400).type('text/plain').send('Kode Voucher dan Link Akun harus diisi.');
    }

    console.log(`[Server - /run-bot] User: ${req.session.user.accessCode}`);
    console.log(`[Server - /run-bot] Menerima permintaan: Kode=${manualVoucherCode}, Link=${manualShortUrl}`);

    try {
        const botOutput = await runBot(manualVoucherCode, manualShortUrl, req.session.user.accessCode, true);
        console.log("[Server - /run-bot] Proses bot selesai. Mengirimkan hasil ke klien.");
        res.type('text/plain').send(botOutput);
    } catch (error) {
        console.error("[Server - /run-bot] Error saat menjalankan bot:", error);
        res.status(500).type('text/plain').send(`Terjadi kesalahan pada server: ${error.message}\n\nPastikan FIREBASE_API_KEY sudah benar dan konfigurasi proxy (jika digunakan) valid.`);
    }
});

// Rute untuk admin panel
app.get('/admin', requireAuth, requireAdmin, (req, res) => {
    const users = readUsers();
    const sessions = readSessions();
    
    res.render('admin', { users, sessions });
});

// API untuk membuat user baru (admin only)
app.post('/admin/create-user', requireAuth, requireAdmin, (req, res) => {
    const { accessCode, proxy } = req.body;
    
    if (!accessCode) {
        return res.json({ success: false, error: 'Kode akses harus diisi.' });
    }
    
    const users = readUsers();
    
    // Cek apakah access code sudah ada
    if (users.find(u => u.accessCode === accessCode)) {
        return res.json({ success: false, error: 'Kode akses sudah digunakan.' });
    }
    
    const newUser = {
        id: users.length > 0 ? Math.max(...users.map(u => u.id)) + 1 : 1,
        accessCode: accessCode.trim(),
        proxy: proxy ? proxy.trim() : '',
        createdAt: new Date().toISOString(),
        isActive: true,
        isAdmin: false
    };
    
    users.push(newUser);
    
    if (writeUsers(users)) {
        res.json({ success: true, user: newUser });
    } else {
        res.json({ success: false, error: 'Gagal menyimpan data.' });
    }
});

// API untuk toggle user status
app.post('/admin/toggle-user', requireAuth, requireAdmin, (req, res) => {
    const { userId } = req.body;
    
    const users = readUsers();
    const userIndex = users.findIndex(u => u.id === parseInt(userId));
    
    if (userIndex === -1) {
        return res.json({ success: false, error: 'User tidak ditemukan.' });
    }
    
    if (users[userIndex].isAdmin) {
        return res.json({ success: false, error: 'Tidak dapat mengubah status admin.' });
    }
    
    users[userIndex].isActive = !users[userIndex].isActive;
    
    if (writeUsers(users)) {
        // Jika user dinonaktifkan, hapus session aktifnya
        if (!users[userIndex].isActive) {
            const sessions = readSessions();
            const filteredSessions = sessions.filter(s => s.userId !== parseInt(userId));
            writeSessions(filteredSessions);
        }
        
        res.json({ 
            success: true, 
            isActive: users[userIndex].isActive 
        });
    } else {
        res.json({ success: false, error: 'Gagal menyimpan perubahan.' });
    }
});

// API untuk delete user
app.post('/admin/delete-user', requireAuth, requireAdmin, (req, res) => {
    const { userId } = req.body;
    
    const users = readUsers();
    const userIndex = users.findIndex(u => u.id === parseInt(userId));
    
    if (userIndex === -1) {
        return res.json({ success: false, error: 'User tidak ditemukan.' });
    }
    
    if (users[userIndex].isAdmin) {
        return res.json({ success: false, error: 'Tidak dapat menghapus admin.' });
    }
    
    users.splice(userIndex, 1);
    
    if (writeUsers(users)) {
        // Hapus session user yang dihapus
        const sessions = readSessions();
        const filteredSessions = sessions.filter(s => s.userId !== parseInt(userId));
        writeSessions(filteredSessions);
        
        res.json({ success: true });
    } else {
        res.json({ success: false, error: 'Gagal menyimpan perubahan.' });
    }
});

// API untuk update user
app.post('/admin/update-user', requireAuth, requireAdmin, (req, res) => {
    const { userId, accessCode, proxy } = req.body;
    
    const users = readUsers();
    const userIndex = users.findIndex(u => u.id === parseInt(userId));
    
    if (userIndex === -1) {
        return res.json({ success: false, error: 'User tidak ditemukan.' });
    }
    
    if (users[userIndex].isAdmin) {
        return res.json({ success: false, error: 'Tidak dapat mengubah data admin.' });
    }
    
    // Cek apakah access code sudah digunakan user lain
    const existingUser = users.find(u => u.accessCode === accessCode && u.id !== parseInt(userId));
    if (existingUser) {
        return res.json({ success: false, error: 'Kode akses sudah digunakan user lain.' });
    }
    
    users[userIndex].accessCode = accessCode.trim();
    users[userIndex].proxy = proxy ? proxy.trim() : '';
    
    if (writeUsers(users)) {
        res.json({ success: true, user: users[userIndex] });
    } else {
        res.json({ success: false, error: 'Gagal menyimpan perubahan.' });
    }
});

// Rute untuk logout
app.get('/logout', (req, res) => {
    if (req.session && req.session.user) {
        const userId = req.session.user.id;
        
        // Hapus session dari file
        const sessions = readSessions();
        const filteredSessions = sessions.filter(s => s.userId !== userId);
        writeSessions(filteredSessions);
        
        // Destroy session
        req.session.destroy((err) => {
            if (err) {
                console.error('Error destroying session:', err);
            }
            res.redirect('/login');
        });
    } else {
        res.redirect('/login');
    }
});

// Redirect root ke login
app.get('/', (req, res) => {
    if (req.session && req.session.user) {
        if (req.session.user.isAdmin) {
            res.redirect('/admin');
        } else {
            res.redirect('/voucher');
        }
    } else {
        res.redirect('/login');
    }
});

app.listen(port, () => {
    console.log(`Server berjalan di http://localhost:${port}`);
});