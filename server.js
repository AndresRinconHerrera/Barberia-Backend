const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const path = require('path');
const bcrypt = require('bcrypt');

const app = express();
app.use(cors());
app.use(express.json());

let db;

// 1. Inicializar la base de datos y sus tablas
async function iniciarBaseDeDatos() {
  try {
    db = await open({
      filename: './barberia.db',
      driver: sqlite3.Database
    });

    await db.exec(`
      CREATE TABLE IF NOT EXISTS citas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        cliente TEXT,
        barbero TEXT,
        servicio TEXT,
        fecha TEXT,
        hora TEXT,
        estado TEXT DEFAULT 'Pendiente'
      )
    `);

    await db.exec(`
      CREATE TABLE IF NOT EXISTS barberos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nombre TEXT,
        especialidad TEXT,
        experiencia TEXT,
        foto TEXT
      )
    `);

    await db.exec(`
      CREATE TABLE IF NOT EXISTS servicios (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nombre TEXT,
        precio INTEGER,
        duracion TEXT
      )
    `);

    await db.exec(`
      CREATE TABLE IF NOT EXISTS bloqueos_horarios (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        barbero TEXT,
        fecha TEXT,
        hora TEXT
      )
    `);

    await db.exec(`
      CREATE TABLE IF NOT EXISTS usuarios (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE,
        password TEXT,
        nombre TEXT,
        rol TEXT
      )
    `);

    const adminExistente = await db.get('SELECT * FROM usuarios WHERE email = ?', ['admin@monarch.com']);
    if (!adminExistente) {
      const hashedPassword = await bcrypt.hash('admin123', 10);
      await db.run(
        'INSERT INTO usuarios (email, password, nombre, rol) VALUES (?, ?, ?, ?)',
        ['admin@monarch.com', hashedPassword, 'Administrador', 'admin']
      );
      console.log('🛡️ Administrador por defecto creado de forma segura.');
    }

    console.log('✅ Base de datos SQLite conectada correctamente con todas las tablas.');
  } catch (err) {
    console.error('❌ Error al inicializar la base de datos:', err);
  }
}

// ==================== RUTAS ====================

app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const usuario = await db.get('SELECT * FROM usuarios WHERE email = ?', [email]);
    if (usuario && await bcrypt.compare(password, usuario.password)) {
      return res.json({ 
        success: true, 
        usuario: { id: usuario.id, nombre: usuario.nombre, email: usuario.email, rol: usuario.rol } 
      });
    }
    res.status(401).json({ success: false, message: 'Correo o contraseña incorrectos' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/citas', async (req, res) => {
  const citas = await db.all('SELECT * FROM citas');
  res.json(citas);
});

app.get('/api/citas-ocupadas', async (req, res) => {
  const { barbero, fecha } = req.query;
  try {
    const rows = await db.all(`SELECT hora FROM citas WHERE barbero = ? AND fecha = ? AND estado != 'Cancelada'`, [barbero, fecha]);
    res.json(rows.map(row => row.hora));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/citas', async (req, res) => {
  const { cliente, barbero, servicio, fecha, hora } = req.body;
  const result = await db.run(
    'INSERT INTO citas (cliente, barbero, servicio, fecha, hora) VALUES (?, ?, ?, ?, ?)',
    [cliente, barbero, servicio, fecha, hora]
  );
  res.json({ id: result.lastID, cliente, barbero, servicio, fecha, hora, estado: 'Pendiente' });
});

app.put('/api/citas/:id', async (req, res) => {
  const { id } = req.params;
  const { estado } = req.body;
  await db.run('UPDATE citas SET estado = ? WHERE id = ?', [estado, id]);
  res.json({ message: 'Estado actualizado correctamente' });
});

app.get('/api/barberos', async (req, res) => {
  const barberos = await db.all('SELECT * FROM barberos');
  res.json(barberos);
});

app.post('/api/barberos', async (req, res) => {
  const { nombre, especialidad, experiencia, foto } = req.body;
  const result = await db.run(
    'INSERT INTO barberos (nombre, especialidad, experiencia, foto) VALUES (?, ?, ?, ?)',
    [nombre, especialidad, experiencia, foto]
  );
  res.json({ id: result.lastID, nombre, especialidad, experiencia, foto });
});

app.delete('/api/barberos/:id', async (req, res) => {
  await db.run('DELETE FROM barberos WHERE id = ?', [req.params.id]);
  res.json({ message: 'Barbero eliminado correctamente' });
});

app.get('/api/servicios', async (req, res) => {
  const servicios = await db.all('SELECT * FROM servicios');
  res.json(servicios);
});

app.post('/api/servicios', async (req, res) => {
  const { nombre, precio, duracion } = req.body;
  const result = await db.run(
    'INSERT INTO servicios (nombre, precio, duracion) VALUES (?, ?, ?)',
    [nombre, precio, duracion]
  );
  res.json({ id: result.lastID, nombre, precio, duracion });
});

app.get('/api/bloqueos', async (req, res) => {
  const bloqueos = await db.all('SELECT * FROM bloqueos_horarios');
  res.json(bloqueos);
});

app.post('/api/bloqueos', async (req, res) => {
  const { barbero, fecha, hora } = req.body;
  const result = await db.run(
    'INSERT INTO bloqueos_horarios (barbero, fecha, hora) VALUES (?, ?, ?)',
    [barbero, fecha, hora]
  );
  res.json({ id: result.lastID, barbero, fecha, hora });
});

app.delete('/api/bloqueos/:id', async (req, res) => {
  await db.run('DELETE FROM bloqueos_horarios WHERE id = ?', [req.params.id]);
  res.json({ message: 'Bloqueo eliminado correctamente' });
});

app.use(express.static(path.join(__dirname, 'dist')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

// 2. Iniciar base de datos y luego encender el servidor HTTP
iniciarBaseDeDatos().then(() => {
  const PORT = process.env.PORT || 3001;
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Servidor corriendo en 0.0.0.0:${PORT}`);
  });
});